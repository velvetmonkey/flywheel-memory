/**
 * Vault boot (arch-review S10 — extracted verbatim from index.ts).
 *
 * Owns vault initialization and the main() boot phases:
 *   - resolveVaultEnvironment — vault path resolution + validation (phase 0)
 *   - initializePrimaryVault — registry + StateDb open (phase 1)
 *   - loadToolRoutingState — routing manifest + effectiveness (phase 1b/1c)
 *   - bootPrimaryVault — integrity kick + co-occurrence + boot (phase 3)
 *   - bootSecondaryVaultsInBackground — secondary vaults (phase 4)
 *   - initializeVault / bootVault / loadVaultCooccurrence / setBootState
 *
 * index.ts is the composition root: its main() sequences these phases.
 */

import { realpathSync, existsSync } from 'fs';
import type { VaultIndex } from './../core/read/types.js';
import {
  buildVaultIndex,
  loadVaultIndexFromCache,
  saveVaultIndexToCache,
  type IndexState,
} from './../core/read/graph.js';
import { scanVault } from './../core/read/vault.js';
import { detectCaseInsensitive, setModuleCaseInsensitive } from './../core/read/caseSensitivity.js';
import { findVaultRoot } from './../core/read/vaultRoot.js';
import { createEmptyPipelineActivity } from './../core/write/pipeline/activity.js';
import { initializeLogger as initializeReadLogger, getLogger } from './../core/read/logging.js';
import { initializeLogger as initializeWriteLogger } from './../core/write/logging.js';
import { buildFTS5Index, isIndexStale } from './../core/read/fts5.js';
import { initToolRouting, loadEffectivenessSnapshot } from './../core/read/toolRouting.js';
import { getToolEffectivenessScores } from './../core/shared/toolSelectionFeedback.js';
import { openStateDb } from '@velvetmonkey/vault-core';
import { recordIndexEvent } from './../core/shared/indexActivity.js';
import { serverLog } from './../core/shared/serverLog.js';
import { loadCooccurrenceFromStateDb } from './../core/shared/cooccurrence.js';
import {
  VaultRegistry,
  parseVaultConfig,
  type VaultBootState,
  type VaultContext,
} from './../vault-registry.js';
import { setFallbackScope } from './../vault-scope.js';
import { buildVaultScope, activateVault, updateIndexState, updateVaultIndex } from './registryContext.js';
import { hydrateIntegrityMetadata, runIntegrityCheck } from './integrity.js';
import { runPostIndexWork } from './postIndex.js';
import { invalidateHttpPool } from './serverFactory.js';
import {
  pkg,
  vaultPath,
  setVaultPath,
  resolvedVaultPath,
  setResolvedVaultPath,
  vaultIndex,
  stateDb,
  setStateDb,
  vaultRegistry,
  setVaultRegistry,
  setServerReady,
  setStartupScanFiles,
  setLastFullRebuildAt,
} from './state.js';

export type VaultConfigs = Array<{ name: string; path: string }> | null;

// ============================================================================
// Multi-Vault Initialization (MV.2 + MV.3)
// ============================================================================

/** Load cached co-occurrence index for a single vault context. */
export function loadVaultCooccurrence(ctx: VaultContext): void {
  if (!ctx.stateDb) return;
  const cachedCooc = loadCooccurrenceFromStateDb(ctx.stateDb);
  if (cachedCooc) {
    ctx.cooccurrenceIndex = cachedCooc.index;
    ctx.lastCooccurrenceRebuildAt = cachedCooc.builtAt;
    serverLog('index', `[${ctx.name}] Co-occurrence: loaded from cache (${Object.keys(cachedCooc.index.associations).length} entities, ${cachedCooc.index._metadata.total_associations} associations)`);
  }
}

export function setBootState(ctx: VaultContext, state: VaultBootState): void {
  ctx.bootState = state;
  if ((globalThis as any).__flywheel_active_vault === ctx.name) {
    setFallbackScope(buildVaultScope(ctx));
  }
}

/**
 * Initialize a vault: open StateDb (fast).
 * Returns a VaultContext with StateDb ready. Does NOT build indexes.
 * Integrity check is deferred to after transport connects (see runIntegrityCheck).
 */
export async function initializeVault(name: string, vaultPathArg: string): Promise<VaultContext> {
  const caseInsensitive = detectCaseInsensitive(vaultPathArg);
  const ctx: VaultContext = {
    name,
    vaultPath: vaultPathArg,
    caseInsensitive,
    stateDb: null,
    vaultIndex: undefined as unknown as VaultIndex,
    flywheelConfig: {},
    watcher: null,
    cooccurrenceIndex: null,
    embeddingsBuilding: false,
    writeEntityIndex: null,
    writeEntityIndexReady: false,
    writeEntityIndexError: null,
    writeEntityIndexLastLoadedAt: 0,
    writeRecencyIndex: null,
    taskCacheBuilding: false,
    entityEmbeddingsMap: new Map(),
    inferredCategoriesMap: new Map(),
    mutedWatcherPaths: new Set(),
    dirtyMutedWatcherPaths: new Set(),
    reconcileMutedWatcherPaths: null,
    deferredScheduler: null,
    lastPurgeAt: Date.now(),
    indexState: 'building',
    indexError: null,
    lastCooccurrenceRebuildAt: 0,
    lastEdgeWeightRebuildAt: 0,
    lastEntityScanAt: 0,
    lastHubScoreRebuildAt: 0,
    lastIndexCacheSaveAt: 0,
    pipelineActivity: createEmptyPipelineActivity(),
    bootState: 'booting',
    integrityState: 'unknown',
    integrityCheckInProgress: false,
    integrityStartedAt: null,
    integritySource: null,
    lastIntegrityCheckedAt: null,
    lastIntegrityDurationMs: null,
    lastIntegrityDetail: null,
    lastBackupAt: null,
  };

  try {
    ctx.stateDb = openStateDb(vaultPathArg);
    serverLog('statedb', `[${name}] StateDb initialized`);
    hydrateIntegrityMetadata(ctx);

    // Nudge if vault_init has never been run
    const vaultInitRow = ctx.stateDb.getMetadataValue.get('vault_init_last_run_at') as { value: string } | undefined;
    if (!vaultInitRow) {
      serverLog('server', `[${name}] Vault not initialized — call vault_init to enrich legacy notes`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    serverLog('statedb', `[${name}] StateDb initialization failed: ${msg}`, 'error');
    serverLog('server', `[${name}] Auto-wikilinks will be disabled for this session`, 'warn');
  }

  return ctx;
}

/**
 * Boot a single vault: logging, FTS5, index build, post-index work.
 * Called once per vault in the registry (sequentially — module-level state is correct).
 */
export async function bootVault(ctx: VaultContext, startTime: number): Promise<void> {
  const vp = ctx.vaultPath;
  const sd = ctx.stateDb;
  const updateCtxIndexState = (state: IndexState, error?: Error | null): void => {
    ctx.indexState = state;
    if (error !== undefined) ctx.indexError = error;
    if ((globalThis as any).__flywheel_active_vault === ctx.name) {
      updateIndexState(state, error);
      setFallbackScope(buildVaultScope(ctx));
    }
  };
  const updateCtxVaultIndex = (index: VaultIndex): void => {
    ctx.vaultIndex = index;
    if ((globalThis as any).__flywheel_active_vault === ctx.name) {
      updateVaultIndex(index);
      setFallbackScope(buildVaultScope(ctx));
    }
  };

  // Initialize logging
  initializeReadLogger(vp).then(() => {
    const logger = getLogger();
    if (logger?.enabled) {
      serverLog('server', `[${ctx.name}] Unified logging enabled`);
    }
  }).catch(() => {});

  initializeWriteLogger(vp).catch(err => {
    serverLog('server', `[${ctx.name}] Write logger initialization failed: ${err}`, 'error');
  });

  // Kick off FTS5 immediately (fire-and-forget, parallel with graph build)
  if (process.env.FLYWHEEL_SKIP_FTS5 !== 'true') {
    if (isIndexStale(vp)) {
      buildFTS5Index(vp).then(() => {
        serverLog('fts5', `[${ctx.name}] Search index ready`);
      }).catch(err => {
        serverLog('fts5', `[${ctx.name}] Build failed: ${err instanceof Error ? err.message : err}`, 'error');
      });
    } else {
      serverLog('fts5', `[${ctx.name}] Search index already fresh, skipping rebuild`);
    }
  } else {
    serverLog('fts5', 'Skipping — FLYWHEEL_SKIP_FTS5');
  }

  // Try loading index from cache
  let cachedIndex: VaultIndex | null = null;
  if (sd) {
    try {
      const files = await scanVault(vp);
      setStartupScanFiles(files);  // reused by startup catch-up to avoid duplicate walk
      const noteCount = files.length;
      serverLog('index', `[${ctx.name}] Found ${noteCount} markdown files`);
      const newestMtime = files.reduce((max, f) => f.modified > max ? f.modified : max, new Date(0));
      cachedIndex = loadVaultIndexFromCache(sd, noteCount, undefined, undefined, newestMtime);
    } catch (err) {
      serverLog('index', `[${ctx.name}] Cache check failed: ${err instanceof Error ? err.message : err}`, 'warn');
    }
  }

  if (cachedIndex) {
    updateCtxVaultIndex(cachedIndex);
    updateCtxIndexState('ready');
    const duration = Date.now() - startTime;
    const cacheAge = cachedIndex.builtAt ? Math.round((Date.now() - cachedIndex.builtAt.getTime()) / 1000) : 0;
    serverLog('index', `[${ctx.name}] Cache hit: ${cachedIndex.notes.size} notes, ${cacheAge}s old — loaded in ${duration}ms`);
    if (sd) {
      recordIndexEvent(sd, {
        trigger: 'startup_cache',
        duration_ms: duration,
        note_count: cachedIndex.notes.size,
      });
    }
    setLastFullRebuildAt(Date.now());
    await runPostIndexWork(ctx);
  } else {
    serverLog('index', `[${ctx.name}] Cache miss: building from scratch`);
    try {
      const built = await buildVaultIndex(vp);
      updateCtxVaultIndex(built);
      updateCtxIndexState('ready');
      const duration = Date.now() - startTime;
      serverLog('index', `[${ctx.name}] Vault index ready in ${duration}ms — ${vaultIndex.notes.size} notes`);
      if (sd) {
        recordIndexEvent(sd, {
          trigger: 'startup_build',
          duration_ms: duration,
          note_count: vaultIndex.notes.size,
        });
      }
      if (sd) {
        try {
          saveVaultIndexToCache(sd, vaultIndex);
          serverLog('index', `[${ctx.name}] Index cache saved`);
        } catch (err) {
          serverLog('index', `[${ctx.name}] Failed to save index cache: ${err instanceof Error ? err.message : err}`, 'error');
        }
      }
      setLastFullRebuildAt(Date.now());
      await runPostIndexWork(ctx);
    } catch (err) {
      updateCtxIndexState('error', err instanceof Error ? err : new Error(String(err)));
      const duration = Date.now() - startTime;
      if (sd) {
        recordIndexEvent(sd, {
          trigger: 'startup_build',
          duration_ms: duration,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      serverLog('index', `[${ctx.name}] Failed to build vault index: ${err instanceof Error ? err.message : err}`, 'error');
    }
  }

  if (ctx.bootState !== 'degraded') {
    setBootState(ctx, 'ready');
  }
}

// ============================================================================
// main() boot phases (sequenced by index.ts)
// ============================================================================

/** Resolve vault path at startup (not import time) so env changes between import and main() take effect. */
export function resolveVaultEnvironment(): { vaultConfigs: VaultConfigs; startTime: number } {
  const vaultConfigs = parseVaultConfig();
  setVaultPath(vaultConfigs
    ? vaultConfigs[0].path
    : (process.env.PROJECT_PATH || process.env.VAULT_PATH || process.env.OBSIDIAN_VAULT || findVaultRoot()));
  try { setResolvedVaultPath(realpathSync(vaultPath).replace(/\\/g, '/')); } catch { setResolvedVaultPath(vaultPath.replace(/\\/g, '/')); }

  // Validate vault path exists
  if (!existsSync(resolvedVaultPath)) {
    console.error(`[flywheel] Fatal: vault path does not exist: ${resolvedVaultPath}`);
    console.error(`[flywheel] Set PROJECT_PATH, VAULT_PATH, or OBSIDIAN_VAULT to a valid Obsidian vault directory.`);
    process.exit(1);
  }

  serverLog('server', `Starting Flywheel Memory v${pkg.version}...`);
  serverLog('server', `Vault: ${vaultPath}`);
  const startTime = Date.now();
  return { vaultConfigs, startTime };
}

/** ── Phase 1: Initialize primary vault (StateDb only — fast) ── */
export async function initializePrimaryVault(vaultConfigs: VaultConfigs, startTime: number): Promise<void> {
  if (vaultConfigs) {
    setVaultRegistry(new VaultRegistry(vaultConfigs[0].name));
    serverLog('server', `Multi-vault mode: ${vaultConfigs.map(v => v.name).join(', ')}`);

    // Initialize primary vault first (just StateDb open + integrity check)
    const primaryCtx = await initializeVault(vaultConfigs[0].name, vaultConfigs[0].path);
    vaultRegistry!.addContext(primaryCtx);
    setStateDb(primaryCtx.stateDb);
    setModuleCaseInsensitive(primaryCtx.caseInsensitive);
    activateVault(primaryCtx, true);  // skip embedding load — defer until after transport connects
    serverLog('server', `[${primaryCtx.name}] stateDb_open=${Date.now() - startTime}ms case_insensitive_fs=${primaryCtx.caseInsensitive}`);
  } else {
    setVaultRegistry(new VaultRegistry('default'));
    const ctx = await initializeVault('default', vaultPath);
    vaultRegistry!.addContext(ctx);
    setStateDb(ctx.stateDb);
    setModuleCaseInsensitive(ctx.caseInsensitive);
    activateVault(ctx, true);  // skip embedding load — defer until after transport connects
    serverLog('server', `[${ctx.name}] stateDb_open=${Date.now() - startTime}ms case_insensitive_fs=${ctx.caseInsensitive}`);
  }
}

/** ── Phase 1b/1c: tool routing manifest + effectiveness snapshots (T15b) ── */
export async function loadToolRoutingState(startTime: number): Promise<void> {
  // ── Phase 1b: Load tool routing manifest (non-blocking) ──
  await initToolRouting();
  serverLog('server', `tool_routing=${Date.now() - startTime}ms`);

  // ── Phase 1c: Load effectiveness snapshots for T15b routing ──
  if (stateDb) {
    try {
      const vaultName = vaultRegistry?.primaryName ?? 'default';
      const scores = getToolEffectivenessScores(stateDb);
      loadEffectivenessSnapshot(vaultName, scores);
    } catch {
      // Table may not exist yet on older databases — safe to skip
    }
  }
}

/** ── Phase 3: integrity kick + co-occurrence load + primary vault boot ── */
export async function bootPrimaryVault(startTime: number): Promise<void> {
  const primaryCtx = vaultRegistry!.getContext();
  setBootState(primaryCtx, 'transport_connected');
  serverLog('server', `[${primaryCtx.name}] transport_connect=${Date.now() - startTime}ms`);
  serverLog('server', `[${primaryCtx.name}] integrity_check_started=${Date.now() - startTime}ms`);
  void runIntegrityCheck(primaryCtx, 'startup');

  // ── Phase 3: Load co-occurrence + boot primary vault ──
  setBootState(primaryCtx, 'booting');
  loadVaultCooccurrence(primaryCtx);
  activateVault(primaryCtx);
  await bootVault(primaryCtx, startTime);
  // Re-activate after boot so fallback scope reflects post-boot state (config, index, etc.)
  activateVault(primaryCtx);
  serverLog('server', `[${primaryCtx.name}] boot_complete=${Date.now() - startTime}ms`);

  setServerReady(true);
}

/** ── Phase 4: Initialize + boot secondary vaults (background) ── */
export function bootSecondaryVaultsInBackground(vaultConfigs: VaultConfigs, startTime: number): void {
  if (vaultConfigs && vaultConfigs.length > 1) {
    const secondaryConfigs = vaultConfigs.slice(1);
    // Don't await — secondary vaults boot in background
    (async () => {
      for (const vc of secondaryConfigs) {
        try {
          const ctx = await initializeVault(vc.name, vc.path);
          vaultRegistry!.addContext(ctx);
          invalidateHttpPool();
          setBootState(ctx, 'transport_connected');
          void runIntegrityCheck(ctx, 'startup');
          setBootState(ctx, 'booting');
          loadVaultCooccurrence(ctx);
          activateVault(ctx);
          await bootVault(ctx, startTime);
          serverLog('server', `[${vc.name}] Secondary vault ready`);
        } catch (err) {
          serverLog('server', `[${vc.name}] Secondary vault boot failed: ${err}`, 'error');
        }
      }
      // Re-activate primary after all secondaries are booted
      activateVault(vaultRegistry!.getContext());
    })();
  }
}
