/**
 * Watcher glue (arch-review S9 — extracted verbatim from index.ts).
 *
 * Owns the write-side watcher wiring that used to live inline in
 * runPostIndexWork():
 *   - handleBatch: symlink/WSL path normalization, mute filtering, sha256
 *     content-hash gating, rename bookkeeping (note_moves + path-reference
 *     SQL updates), and delegation to PipelineRunner.
 *   - The startup catch-up batch builder (files modified while offline).
 *   - createVaultWatcher wiring, muted-path reconciliation, deferred step
 *     scheduler setup, stale proactive-queue expiry, watcher.start().
 *
 * index.ts builds a WatchGlueDeps object (its module-scoped closures and
 * state) and calls setupVaultWatcher(); all logic lives here.
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  loadContentHashes,
  saveContentHashBatch,
  renameContentHash,
  type StateDb,
} from '@velvetmonkey/vault-core';

import { serverLog } from '../../shared/serverLog.js';
import { getRecentPipelineEvent } from '../../shared/indexActivity.js';
import { normalizePath } from '../../read/watch/pathFilter.js';
import {
  createVaultWatcher,
  parseWatcherConfig,
  type BatchHandler,
} from '../../read/watch/index.js';
import type { CoalescedEvent, RenameEvent, VaultWatcher } from '../../read/watch/types.js';
import type { VaultFile } from '../../read/vault.js';
import { buildVaultIndex } from '../../read/graph.js';
import type { IntegrityWorkerResult } from '../../read/integrity.js';
import type { VaultContext } from '../../../vault-types.js';
import { PipelineRunner } from './runner.js';
import { DeferredStepScheduler } from './scheduler.js';
import type { IndexStateUpdater, VaultIndexUpdater, EntitiesUpdater } from './context.js';

/**
 * Everything the watcher glue used to capture from index.ts scope.
 * Module-level imports (createVaultWatcher, PipelineRunner, …) are imported
 * directly; only index.ts-local closures and state are injected.
 */
export interface WatchGlueDeps {
  /** Per-vault context (mutable state: watcher, deferredScheduler, muted paths, flywheelConfig, vaultIndex, …) */
  ctx: VaultContext;
  /** Vault path (absolute) */
  vp: string;
  /** Realpath-resolved vault path (symlink/WSL mount normalization) */
  rvp: string;
  /** StateDb handle (per-vault) */
  sd: StateDb | null;
  /** Runs fn inside the vault's ALS scope: runInVaultScope(buildVaultScope(ctx), fn) */
  runWithVaultScope: <T>(fn: () => T) => T;
  /** runPostIndexWork-local updater: ctx.indexState + module globals when vault is active */
  updateIndexState: IndexStateUpdater;
  /** runPostIndexWork-local updater: ctx.vaultIndex + module globals when vault is active */
  updateVaultIndex: VaultIndexUpdater;
  /** index.ts module-level entity scanner (StateDb/vaultPath fallbacks) */
  updateEntitiesInStateDb: EntitiesUpdater;
  /** Shared async integrity runner (index.ts-scoped: dedupes in-flight runs per vault) */
  runIntegrityCheck: (ctx: VaultContext, source: string, options?: { force?: boolean }) => Promise<IntegrityWorkerResult>;
  /** Scanned vault files from bootVault — reused by startup catch-up to avoid duplicate filesystem walk */
  startupScanFiles: VaultFile[] | null;
  /** Keeps index.ts's module-level watcherInstance fallback in sync */
  setWatcherInstance: (watcher: VaultWatcher) => void;
}

/**
 * Returns CoalescedEvents for vault .md files modified after sinceMs.
 * Used on startup to catch up on edits made while the server was offline.
 *
 * If preScannedFiles is provided (from the earlier scanVault call in bootVault),
 * uses those instead of re-walking the filesystem.
 */
export function buildStartupCatchupBatch(
  vaultPath: string,
  sinceMs: number,
  preScannedFiles: VaultFile[] | null
): CoalescedEvent[] {
  if (preScannedFiles) {
    return preScannedFiles
      .filter(f => f.modified.getTime() > sinceMs)
      .map(f => ({ type: 'upsert' as const, path: f.path, originalEvents: [] }));
  }

  // Fallback: should not happen in normal startup, but kept for safety
  return [];
}

/**
 * Builds the watcher batch handler: path normalization, mute filtering,
 * sha256 content-hash gating, rename bookkeeping, PipelineRunner delegation.
 */
export function createWatchBatchHandler(
  deps: WatchGlueDeps,
  lastContentHashes: Map<string, string>,
  deferredScheduler: DeferredStepScheduler,
): BatchHandler {
  const { ctx, vp, rvp, sd, runWithVaultScope, updateIndexState, updateVaultIndex, updateEntitiesInStateDb, runIntegrityCheck } = deps;

  const handleBatch: BatchHandler = async (batch) => {
    return runWithVaultScope(async () => {
      // Convert event paths from absolute to vault-relative
      // Handles symlink mismatches (e.g., WSL /mnt/c/ vs /home/user/ mounts)
      const vaultPrefixes = new Set([
        normalizePath(vp),
        normalizePath(rvp),
      ]);
      /** Normalize a single path from absolute to vault-relative */
      const normalizeEventPath = (rawPath: string): string => {
        const normalized = normalizePath(rawPath);
        for (const prefix of vaultPrefixes) {
          if (normalized.startsWith(prefix + '/')) {
            return normalized.slice(prefix.length + 1);
          }
        }
        // Try resolving the path itself (handles other symlink layouts)
        try {
          const resolved = realpathSync(rawPath).replace(/\\/g, '/');
          for (const prefix of vaultPrefixes) {
            if (resolved.startsWith(prefix + '/')) {
              return resolved.slice(prefix.length + 1);
            }
          }
        } catch { /* deleted file — try parent */
          try {
            const dir = path.dirname(rawPath);
            const base = path.basename(rawPath);
            const resolvedDir = realpathSync(dir).replace(/\\/g, '/');
            for (const prefix of vaultPrefixes) {
              if (resolvedDir.startsWith(prefix + '/') || resolvedDir === prefix) {
                const relDir = resolvedDir === prefix ? '' : resolvedDir.slice(prefix.length + 1);
                return relDir ? `${relDir}/${base}` : base;
              }
            }
          } catch { /* give up, return as-is */ }
        }
        return normalized;
      };

      for (const event of batch.events) {
        event.path = normalizeEventPath(event.path);
      }

      // Normalize rename paths too
      const batchRenames: RenameEvent[] = (batch.renames ?? []).map(r => ({
        ...r,
        oldPath: normalizeEventPath(r.oldPath),
        newPath: normalizeEventPath(r.newPath),
      }));

      const mutedPaths = ctx.mutedWatcherPaths;
      const dirtyMutedPaths = ctx.dirtyMutedWatcherPaths;
      const visibleEvents = batch.events.filter((event) => {
        if (!mutedPaths.has(event.path)) return true;
        dirtyMutedPaths.add(event.path);
        return false;
      });
      const visibleRenames = batchRenames.filter((rename) => {
        const muted = mutedPaths.has(rename.oldPath) || mutedPaths.has(rename.newPath);
        if (muted) {
          dirtyMutedPaths.add(rename.oldPath);
          dirtyMutedPaths.add(rename.newPath);
        }
        return !muted;
      });

      // Content hash gate: skip files that haven't changed since last batch
      const filteredEvents: CoalescedEvent[] = [];
      const hashUpserts: Array<{ path: string; hash: string }> = [];
      const hashDeletes: string[] = [];
      for (const event of visibleEvents) {
        if (event.type === 'delete') {
          filteredEvents.push(event);
          lastContentHashes.delete(event.path);
          hashDeletes.push(event.path);
          continue;
        }
        try {
          const content = await fs.readFile(path.join(vp, event.path), 'utf-8');
          const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
          if (lastContentHashes.get(event.path) === hash) {
            serverLog('watcher', `Hash unchanged, skipping: ${event.path}`);
            continue;
          }
          lastContentHashes.set(event.path, hash);
          hashUpserts.push({ path: event.path, hash });
          filteredEvents.push(event);
        } catch {
          filteredEvents.push(event); // File may have been deleted mid-batch
        }
      }
      if (sd && (hashUpserts.length || hashDeletes.length)) {
        saveContentHashBatch(sd, hashUpserts, hashDeletes);
      }

      // Process rename events: record moves and update path references in DB
      if (visibleRenames.length > 0 && sd) {
        try {
          const insertMove = sd.db.prepare(`
            INSERT INTO note_moves (old_path, new_path, old_folder, new_folder)
            VALUES (?, ?, ?, ?)
          `);
          const renameNoteLinks = sd.db.prepare(
            'UPDATE note_links SET note_path = ? WHERE note_path = ?'
          );
          const renameNoteTags = sd.db.prepare(
            'UPDATE note_tags SET note_path = ? WHERE note_path = ?'
          );
          const renameNoteLinkHistory = sd.db.prepare(
            'UPDATE note_link_history SET note_path = ? WHERE note_path = ?'
          );
          const renameWikilinkApplications = sd.db.prepare(
            'UPDATE wikilink_applications SET note_path = ? WHERE note_path = ?'
          );
          const renameProactiveQueue = sd.db.prepare(
            'UPDATE proactive_queue SET note_path = ? WHERE note_path = ? AND status = \'pending\''
          );
          for (const rename of visibleRenames) {
            const oldFolder = rename.oldPath.includes('/') ? rename.oldPath.split('/').slice(0, -1).join('/') : '';
            const newFolder = rename.newPath.includes('/') ? rename.newPath.split('/').slice(0, -1).join('/') : '';
            insertMove.run(rename.oldPath, rename.newPath, oldFolder || null, newFolder || null);
            renameNoteLinks.run(rename.newPath, rename.oldPath);
            renameNoteTags.run(rename.newPath, rename.oldPath);
            renameNoteLinkHistory.run(rename.newPath, rename.oldPath);
            renameWikilinkApplications.run(rename.newPath, rename.oldPath);
            renameProactiveQueue.run(rename.newPath, rename.oldPath);
            // Also update the content hash map (in-memory + persisted)
            const oldHash = lastContentHashes.get(rename.oldPath);
            if (oldHash !== undefined) {
              lastContentHashes.set(rename.newPath, oldHash);
              lastContentHashes.delete(rename.oldPath);
              renameContentHash(sd, rename.oldPath, rename.newPath);
            }
          }
          serverLog('watcher', `Renames: recorded ${visibleRenames.length} move(s) in note_moves`);
        } catch (err) {
          serverLog('watcher', `Rename recording failed: ${err instanceof Error ? err.message : err}`, 'error');
        }
      }

      if (filteredEvents.length === 0 && visibleRenames.length === 0) {
        if (visibleEvents.length === 0 && visibleRenames.length === 0 && dirtyMutedPaths.size > 0) {
          serverLog('watcher', `Muted ${dirtyMutedPaths.size} watcher path(s) during policy execution`);
        }
        serverLog('watcher', 'All files unchanged (hash gate), skipping batch');
        return;
      }

      // Synthesize upsert events for renamed files so the full pipeline refreshes in-memory state
      if (filteredEvents.length === 0 && visibleRenames.length > 0) {
        for (const rename of visibleRenames) {
          filteredEvents.push({
            type: 'upsert' as const,
            path: rename.newPath,
            originalEvents: [],
          });
        }
      }

      serverLog('watcher', `Processing ${filteredEvents.length} file changes`);
      const changedPaths = filteredEvents.map(e => e.path);

      // Delegate to PipelineRunner (extracted step logic)
      const runner = new PipelineRunner({
        vp,
        sd,
        ctx,
        events: filteredEvents,
        renames: visibleRenames,
        batch,
        changedPaths,
        flywheelConfig: ctx.flywheelConfig,
        updateIndexState,
        updateVaultIndex,
        updateEntitiesInStateDb,
        getVaultIndex: () => ctx.vaultIndex,
        buildVaultIndex,
        deferredScheduler,
        runIntegrityCheck,
      });
      await runner.run();
    });
  };

  return handleBatch;
}

/**
 * Full watcher wiring: content-hash hydration, deferred step scheduler,
 * batch handler, createVaultWatcher, muted-path reconciliation, startup
 * catch-up, stale proactive-queue expiry, watcher.start().
 *
 * Returns the started watcher (also assigned to ctx.watcher and pushed
 * through deps.setWatcherInstance at the same point the inline code did).
 */
export async function setupVaultWatcher(deps: WatchGlueDeps): Promise<VaultWatcher> {
  const { ctx, vp, sd, runWithVaultScope, updateEntitiesInStateDb, startupScanFiles } = deps;

  const config = parseWatcherConfig();
  const lastContentHashes = new Map<string, string>();
  if (sd) {
    const persisted = loadContentHashes(sd);
    for (const [p, h] of persisted) lastContentHashes.set(p, h);
    if (persisted.size > 0) {
      serverLog('watcher', `Loaded ${persisted.size} persisted content hashes`);
    }
  }
  serverLog('watcher', `File watcher enabled (debounce: ${config.debounceMs}ms)`);

  // Set up deferred step scheduler for throttled pipeline steps
  const deferredScheduler = new DeferredStepScheduler();
  ctx.deferredScheduler = deferredScheduler;
  deferredScheduler.setExecutor({
    ctx,
    vp,
    sd,
    getVaultIndex: () => ctx.vaultIndex,
    updateEntitiesInStateDb,
    runWithScope: runWithVaultScope,
  });

  // Define before createVaultWatcher so we can call it directly for catch-up
  const handleBatch = createWatchBatchHandler(deps, lastContentHashes, deferredScheduler);

  const watcher = createVaultWatcher({
    vaultPath: vp,
    config,
    onBatch: handleBatch,
    onStateChange: (status) => {
      if (status.state === 'dirty') {
        serverLog('watcher', 'Index may be stale', 'warn');
      }
    },
    onError: (err) => {
      serverLog('watcher', `Watcher error: ${err.message}`, 'error');
    },
  });
  ctx.watcher = watcher;
  deps.setWatcherInstance(watcher);
  ctx.reconcileMutedWatcherPaths = async (paths: string[]) => {
    if (paths.length === 0) return;
    const deduped = Array.from(new Set(paths));
    const reconciledEvents: CoalescedEvent[] = [];
    for (const filePath of deduped) {
      try {
        await fs.access(path.join(vp, filePath));
        reconciledEvents.push({ type: 'upsert', path: filePath, originalEvents: [] });
      } catch {
        reconciledEvents.push({ type: 'delete', path: filePath, originalEvents: [] });
      }
    }
    if (reconciledEvents.length === 0) return;
    serverLog('policy', `Reconciling ${reconciledEvents.length} watcher-muted path(s)`);
    await handleBatch({ events: reconciledEvents, renames: [], timestamp: Date.now() });
  };

  // Startup catch-up: process files that were modified while the server was offline.
  // getRecentPipelineEvent returns the last event with steps (i.e. last watcher run).
  // Files with mtime > that timestamp were not seen by the watcher last session.
  if (sd) {
    const lastPipelineEvent = getRecentPipelineEvent(sd);
    if (lastPipelineEvent) {
      const catchupEvents = buildStartupCatchupBatch(vp, lastPipelineEvent.timestamp, startupScanFiles);
      if (catchupEvents.length > 0) {
        // eslint-disable-next-line no-console
        console.error(`[Flywheel] Startup catch-up: ${catchupEvents.length} file(s) modified while offline`);
        await handleBatch({ events: catchupEvents, renames: [], timestamp: Date.now() });
      }
    }
  }

  // Expire stale proactive queue entries from previous session
  if (sd) {
    try {
      const { expireStaleEntries } = await import('../proactiveQueue.js');
      const expired = expireStaleEntries(sd);
      if (expired > 0) {
        serverLog('watcher', `Startup: expired ${expired} stale proactive queue entries`);
      }
    } catch { /* non-critical */ }
  }

  watcher.start();
  serverLog('watcher', 'File watcher started');

  return watcher;
}
