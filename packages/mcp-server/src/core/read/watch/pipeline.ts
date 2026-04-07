/**
 * Watcher Pipeline — extracted step logic from handleBatch.
 *
 * Each step is a method on PipelineRunner. Critical steps throw on failure.
 * Non-critical steps use the runStep() wrapper (try-catch + tracker).
 *
 * Data flows between steps via instance fields (entitiesAfter, linkDiffs, etc.).
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { StateDb } from '@velvetmonkey/vault-core';
import {
  getAllEntitiesFromDb,
  findEntityMatches,
  getProtectedZones,
  rangeOverlapsProtectedZone,
  detectImplicitEntities,
  recordEntityMention,
  type EntitySearchResult,
} from '@velvetmonkey/vault-core';

import type { VaultIndex, VaultNote } from '../types.js';
import type { CoalescedEvent, RenameEvent, EventBatch } from './types.js';
import { processBatch } from './batchProcessor.js';
import type { FlywheelConfig } from '../config.js';
import type { VaultContext } from '../../../vault-registry.js';
import type { IndexState } from '../graph.js';
import type { IntegrityWorkerResult } from '../integrity.js';

// Shared modules
import { serverLog } from '../../shared/serverLog.js';
import { createStepTracker, recordIndexEvent, computeEntityDiff, type IndexEventTrigger, type StepRunResult } from '../../shared/indexActivity.js';
import { exportHubScores } from '../../shared/hubExport.js';
import { buildRecencyIndex, loadRecencyFromStateDb, saveRecencyToStateDb } from '../../shared/recency.js';
import { mineCooccurrences, saveCooccurrenceToStateDb } from '../../shared/cooccurrence.js';
import { setCooccurrenceIndex, suggestRelatedLinks, applyProactiveSuggestions } from '../../write/wikilinks.js';
import { enqueueProactiveSuggestions, drainProactiveQueue, type QueueEntry } from '../../write/proactiveQueue.js';
import { mineRetrievalCooccurrence } from '../../shared/retrievalCooccurrence.js';
import { updateFTS5Incremental, countFTS5Mentions } from '../fts5.js';
import { recordProspectSightings, refreshProspectSummaries, cleanStaleProspects, type ProspectSighting } from '../../shared/prospects.js';

// Read modules
import { getForwardLinksForNote } from '../graph.js';
import {
  updateEmbedding,
  removeEmbedding,
  hasEmbeddingsIndex,
  updateEntityEmbedding,
  hasEntityEmbeddingsIndex,
  removeOrphanedNoteEmbeddings,
  removeOrphanedEntityEmbeddings,
} from '../embeddings.js';
import { updateTaskCacheForFile, removeTaskCacheForFile } from '../taskCache.js';
import { saveVaultIndexToCache } from '../graph.js';

// Write modules
import {
  updateSuppressionList,
  getTrackedApplications,
  processImplicitFeedback,
  getStoredNoteLinks,
  updateStoredNoteLinks,
  diffNoteLinks,
  recordFeedback,
  getStoredNoteTags,
  updateStoredNoteTags,
  isSuppressed,
  getAllSuppressionPenalties,
  trackWikilinkApplications,
} from '../../write/wikilinkFeedback.js';
import { processPendingCorrections } from '../../write/corrections.js';
import { recomputeEdgeWeights } from '../../write/edgeWeights.js';

// ── Deferred Step Scheduler ───────────────────────────────────────────
//
// When the watcher pipeline throttles a step (e.g. "co-occurrence < 1hr old"),
// the scheduler sets a timer to run that step at its TTL expiry. If another
// watcher batch fires before the timer, the timer is cancelled and rescheduled.
// This ensures throttled steps eventually run even when no more edits arrive.

export type DeferredStepName = 'entity_scan' | 'hub_scores' | 'recency' | 'cooccurrence' | 'edge_weights';

export interface DeferredStepExecutor {
  ctx: VaultContext;
  vp: string;
  sd: StateDb | null;
  getVaultIndex: () => VaultIndex;
  updateEntitiesInStateDb: (vp: string, sd: StateDb | null) => Promise<void>;
}

export class DeferredStepScheduler {
  private timers = new Map<DeferredStepName, ReturnType<typeof setTimeout>>();
  private executor: DeferredStepExecutor | null = null;

  /** Set the executor context (called once during watcher setup) */
  setExecutor(exec: DeferredStepExecutor): void {
    this.executor = exec;
  }

  /** Schedule a deferred step to run after delayMs. Cancels any existing timer for this step. */
  schedule(step: DeferredStepName, delayMs: number): void {
    this.cancel(step);
    const timer = setTimeout(() => {
      this.timers.delete(step);
      this.executeStep(step);
    }, delayMs);
    timer.unref(); // Don't prevent process exit
    this.timers.set(step, timer);
    serverLog('deferred', `Scheduled ${step} in ${Math.round(delayMs / 1000)}s`);
  }

  /** Cancel a pending deferred step */
  cancel(step: DeferredStepName): void {
    const existing = this.timers.get(step);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(step);
    }
  }

  /** Cancel all pending deferred steps (called on shutdown) */
  cancelAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /** Check if any steps are pending */
  get pendingCount(): number { return this.timers.size; }

  private async executeStep(step: DeferredStepName): Promise<void> {
    const exec = this.executor;
    if (!exec) return;

    // Don't run if pipeline is busy
    if (exec.ctx.pipelineActivity.busy) {
      serverLog('deferred', `Skipping ${step}: pipeline busy`);
      return;
    }

    const start = Date.now();
    try {
      switch (step) {
        case 'entity_scan': {
          await exec.updateEntitiesInStateDb(exec.vp, exec.sd);
          exec.ctx.lastEntityScanAt = Date.now();
          if (exec.sd) {
            await exportHubScores(exec.getVaultIndex(), exec.sd);
            exec.ctx.lastHubScoreRebuildAt = Date.now();
          }
          break;
        }
        case 'hub_scores': {
          await exportHubScores(exec.getVaultIndex(), exec.sd);
          exec.ctx.lastHubScoreRebuildAt = Date.now();
          break;
        }
        case 'recency': {
          const entities = exec.sd ? getAllEntitiesFromDb(exec.sd) : [];
          const entityInput = entities.map(e => ({ name: e.name, path: e.path, aliases: e.aliases }));
          const recencyIndex = await buildRecencyIndex(exec.vp, entityInput);
          saveRecencyToStateDb(recencyIndex, exec.sd ?? undefined);
          break;
        }
        case 'cooccurrence': {
          const entities = exec.sd ? getAllEntitiesFromDb(exec.sd) : [];
          const entityNames = entities.map(e => e.name);
          const cooccurrenceIdx = await mineCooccurrences(exec.vp, entityNames);
          setCooccurrenceIndex(cooccurrenceIdx);
          exec.ctx.lastCooccurrenceRebuildAt = Date.now();
          exec.ctx.cooccurrenceIndex = cooccurrenceIdx;
          if (exec.sd) saveCooccurrenceToStateDb(exec.sd, cooccurrenceIdx);
          break;
        }
        case 'edge_weights': {
          if (exec.sd) {
            recomputeEdgeWeights(exec.sd);
            exec.ctx.lastEdgeWeightRebuildAt = Date.now();
          }
          break;
        }
      }
      const duration = Date.now() - start;
      serverLog('deferred', `Completed ${step} in ${duration}ms`);
      if (exec.sd) {
        recordIndexEvent(exec.sd, {
          trigger: 'deferred',
          duration_ms: duration,
          note_count: exec.getVaultIndex().notes.size,
        });
      }
    } catch (err) {
      serverLog('deferred', `Failed ${step}: ${err instanceof Error ? err.message : err}`, 'error');
    }
  }
}

// ── Pipeline Activity (process-local runtime status) ────────────────

/** Total number of steps in the pipeline (used for progress reporting) */
const PIPELINE_TOTAL_STEPS = 22;

export interface PipelineActivity {
  busy: boolean;
  trigger: IndexEventTrigger | null;
  started_at: number | null;
  current_step: string | null;
  completed_steps: number;
  total_steps: number;
  pending_events: number;
  last_completed_at: number | null;
  last_completed_trigger: IndexEventTrigger | null;
  last_completed_duration_ms: number | null;
  last_completed_files: number | null;
  last_completed_steps: string[];
}

export function createEmptyPipelineActivity(): PipelineActivity {
  return {
    busy: false,
    trigger: null,
    started_at: null,
    current_step: null,
    completed_steps: 0,
    total_steps: PIPELINE_TOTAL_STEPS,
    pending_events: 0,
    last_completed_at: null,
    last_completed_trigger: null,
    last_completed_duration_ms: null,
    last_completed_files: null,
    last_completed_steps: [],
  };
}

// Re-exported from index.ts — these are module-level functions that update both globals and VaultContext
export type IndexStateUpdater = (state: IndexState, error?: Error | null) => void;
export type VaultIndexUpdater = (index: VaultIndex) => void;
export type EntitiesUpdater = (vp?: string, sd?: StateDb | null) => Promise<void>;

export interface PipelineContext {
  /** Vault path (absolute) */
  vp: string;
  /** StateDb handle (per-vault) */
  sd: StateDb | null;
  /** VaultContext for per-vault mutable state */
  ctx: VaultContext;
  /** Filtered events (post content-hash gate) */
  events: CoalescedEvent[];
  /** Detected renames */
  renames: RenameEvent[];
  /** Original batch (for processBatch) */
  batch: EventBatch;
  /** Changed file paths (for logging/recording) */
  changedPaths: string[];
  /** Current flywheel config */
  flywheelConfig: FlywheelConfig;
  /** Module-level updaters (injected from index.ts) */
  updateIndexState: IndexStateUpdater;
  updateVaultIndex: VaultIndexUpdater;
  updateEntitiesInStateDb: EntitiesUpdater;
  /** Module-level vaultIndex getter */
  getVaultIndex: () => VaultIndex;
  /** buildVaultIndex function */
  buildVaultIndex: (vaultPath: string) => Promise<VaultIndex>;
  /** Deferred step scheduler (optional — set when watcher is active) */
  deferredScheduler?: DeferredStepScheduler;
  /** Shared async integrity runner */
  runIntegrityCheck: (ctx: VaultContext, source: string, options?: { force?: boolean }) => Promise<IntegrityWorkerResult>;
}

type StepTracker = ReturnType<typeof createStepTracker>;

/** Non-critical step wrapper: try-catch + tracker.start/end. Supports StepRunResult for skip semantics. */
async function runStep(
  name: string,
  tracker: StepTracker,
  meta: Record<string, unknown>,
  fn: () => Promise<Record<string, unknown> | StepRunResult>,
): Promise<void> {
  tracker.start(name, meta);
  try {
    const result = await fn();
    // Handle tagged StepRunResult
    if (result && 'kind' in result) {
      const tagged = result as StepRunResult;
      if (tagged.kind === 'skipped') {
        tracker.skipCurrent(tagged.reason, tagged.output);
      } else {
        tracker.end(tagged.output);
      }
    } else {
      tracker.end(result);
    }
  } catch (e) {
    tracker.end({ error: String(e) });
    serverLog('watcher', `${name}: failed: ${e}`, 'error');
  }
}

/**
 * Runs the 19-step watcher pipeline for a single batch of file changes.
 *
 * Steps (in order):
 * 0.5. drain_proactive_queue (apply deferred links from previous batch),
 * 1. index_rebuild, 1.5. note_moves, 2. entity_scan, 3. hub_scores,
 * 3.5. recency, 3.6. cooccurrence, 3.7. edge_weights,
 * 4. note_embeddings, 5. entity_embeddings, 6. index_cache, 7. task_cache,
 * 8. forward_links, 9. wikilink_check, 10. implicit_feedback,
 * 10.5. corrections, 11. prospect_scan, 12. suggestion_scoring,
 * 12.5. proactive_enqueue, 13. tag_scan, 19. retrieval_cooccurrence
 */
export class PipelineRunner {
  private tracker: StepTracker;
  private batchStart: number;
  private activity: PipelineActivity;

  // Shared state between steps
  private entitiesAfter: EntitySearchResult[] = [];
  private entitiesBefore: EntitySearchResult[] = [];
  private hubBefore = new Map<string, number>();
  private hasEntityRelevantChanges = false;
  private forwardLinkResults: Array<{ file: string; resolved: string[]; dead: string[] }> = [];
  private linkDiffs: Array<{ file: string; added: string[]; removed: string[] }> = [];
  private survivedLinks: Array<{ entity: string; file: string; count: number }> = [];
  private suggestionResults: Array<{ file: string; top: Array<{ entity: string; score: number; confidence: string }> }> = [];

  constructor(private p: PipelineContext) {
    this.activity = p.ctx.pipelineActivity;
    const baseTracker = createStepTracker();
    // Wrap tracker to update pipeline activity on every step transition
    this.tracker = {
      steps: baseTracker.steps,
      start: (name: string, input: Record<string, unknown>) => {
        this.activity.current_step = name;
        baseTracker.start(name, input);
      },
      end: (output: Record<string, unknown>) => {
        baseTracker.end(output);
        this.activity.completed_steps = baseTracker.steps.length;
      },
      skipCurrent: (reason: string, output?: Record<string, unknown>) => {
        baseTracker.skipCurrent(reason, output);
        this.activity.completed_steps = baseTracker.steps.length;
      },
      skip: (name: string, reason: string) => {
        baseTracker.skip(name, reason);
        this.activity.completed_steps = baseTracker.steps.length;
      },
    };
    this.batchStart = Date.now();
  }

  async run(): Promise<void> {
    const { p, tracker } = this;

    if (p.ctx.integrityState === 'failed') {
      serverLog('watcher', `Skipping batch for ${p.ctx.name}: StateDb integrity failed`, 'warn');
      this.activity.busy = false;
      this.activity.current_step = null;
      this.activity.last_completed_at = Date.now();
      this.activity.last_completed_trigger = 'watcher';
      this.activity.last_completed_duration_ms = 0;
      this.activity.last_completed_files = p.events.length;
      this.activity.last_completed_steps = [];
      return;
    }

    // Set pipeline activity to busy
    this.activity.busy = true;
    this.activity.trigger = 'watcher';
    this.activity.started_at = this.batchStart;
    this.activity.current_step = null;
    this.activity.completed_steps = 0;
    this.activity.total_steps = PIPELINE_TOTAL_STEPS;
    this.activity.pending_events = p.events.length;

    try {
      // Step 0.5: Drain deferred proactive queue (before any file processing)
      await runStep('drain_proactive_queue', tracker, {}, () => this.drainQueue());

      // Critical steps (throw on failure)
      await this.indexRebuild();
      this.fts5Incremental();
      this.noteMoves();
      await this.entityScan();

      // Non-critical steps (catch and log)
      await runStep('hub_scores', tracker, { entity_count: this.entitiesAfter.length }, () => this.hubScores());
      await runStep('recency', tracker, { entity_count: this.entitiesAfter.length }, () => this.recency());
      await runStep('cooccurrence', tracker, { entity_count: this.entitiesAfter.length }, () => this.cooccurrence());
      if (p.sd) {
        await runStep('edge_weights', tracker, {}, () => this.edgeWeights());
      }
      await runStep('note_embeddings', tracker, { files: p.events.length }, () => this.noteEmbeddings());
      await runStep('entity_embeddings', tracker, { files: p.events.length }, () => this.entityEmbeddings());
      await this.indexCache();
      await this.taskCache();
      await runStep('forward_links', tracker, { files: p.events.length }, () => this.forwardLinks());
      await this.wikilinkCheck();
      await this.implicitFeedback();
      await runStep('incremental_recency', tracker, { files: p.events.length }, () => this.incrementalRecency());
      await runStep('corrections', tracker, {}, () => this.corrections());
      await runStep('prospect_scan', tracker, { files: p.events.length }, () => this.prospectScan());
      await this.suggestionScoring();
      await this.proactiveLinking();
      await runStep('tag_scan', tracker, { files: p.events.length }, () => this.tagScan());
      await runStep('retrieval_cooccurrence', tracker, {}, () => this.retrievalCooccurrence());
      await runStep('integrity_check', tracker, {}, () => this.integrityCheck());
      await runStep('maintenance', tracker, {}, () => this.maintenance());

      // Record success
      const duration = Date.now() - this.batchStart;
      if (p.sd) {
        recordIndexEvent(p.sd, {
          trigger: 'watcher',
          duration_ms: duration,
          note_count: p.getVaultIndex().notes.size,
          files_changed: p.events.length,
          changed_paths: p.changedPaths,
          steps: tracker.steps,
        });
      }

      // Update pipeline activity — mark completed
      this.activity.busy = false;
      this.activity.current_step = null;
      this.activity.last_completed_at = Date.now();
      this.activity.last_completed_trigger = 'watcher';
      this.activity.last_completed_duration_ms = duration;
      this.activity.last_completed_files = p.events.length;
      this.activity.last_completed_steps = tracker.steps.map(s => s.name);

      serverLog('watcher', `Batch complete: ${p.events.length} files, ${duration}ms, ${tracker.steps.length} steps`);
    } catch (err) {
      p.updateIndexState('error', err instanceof Error ? err : new Error(String(err)));
      const duration = Date.now() - this.batchStart;
      if (p.sd) {
        recordIndexEvent(p.sd, {
          trigger: 'watcher',
          duration_ms: duration,
          success: false,
          files_changed: p.events.length,
          changed_paths: p.changedPaths,
          error: err instanceof Error ? err.message : String(err),
          steps: tracker.steps,
        });
      }

      // Update pipeline activity — mark completed (with failure)
      this.activity.busy = false;
      this.activity.current_step = null;
      this.activity.last_completed_at = Date.now();
      this.activity.last_completed_trigger = 'watcher';
      this.activity.last_completed_duration_ms = duration;
      this.activity.last_completed_files = p.events.length;
      this.activity.last_completed_steps = tracker.steps.map(s => s.name);

      serverLog('watcher', `Failed to rebuild index: ${err instanceof Error ? err.message : err}`, 'error');
    }
  }

  // ── Step 1: Index rebuild (critical) ──────────────────────────────

  private async indexRebuild(): Promise<void> {
    const { p, tracker } = this;
    const vaultIndex = p.getVaultIndex();

    tracker.start('index_rebuild', { files_changed: p.events.length, changed_paths: p.changedPaths });
    if (!vaultIndex) {
      const rebuilt = await p.buildVaultIndex(p.vp);
      p.updateVaultIndex(rebuilt);
      this.hasEntityRelevantChanges = true; // full rebuild — entity state unknown
      serverLog('watcher', `Index rebuilt (full): ${rebuilt.notes.size} notes, ${rebuilt.entities.size} entities`);
    } else {
      // Pass events with relative paths directly — batchProcessor handles joining with vaultPath
      const relativeBatch = {
        ...p.batch,
        events: p.events,
      };
      const batchResult = await processBatch(vaultIndex, p.vp, relativeBatch, {
        onError: (filePath, error) => {
          serverLog('watcher', `File processing error: ${filePath}: ${error.message}`, 'error');
        },
      });
      this.hasEntityRelevantChanges = batchResult.hasEntityRelevantChanges;
      // Update builtAt so freshness checks reflect the incremental update
      vaultIndex.builtAt = new Date();
      serverLog('watcher', `Incremental: ${batchResult.successful}/${batchResult.total} files in ${batchResult.durationMs}ms`);
    }
    p.updateIndexState('ready');
    const idx = p.getVaultIndex();
    tracker.end({ note_count: idx.notes.size, entity_count: idx.entities.size, tag_count: idx.tags.size });
  }

  // ── Step 1.1: FTS5 incremental update ──────────────────────────────

  private fts5Incremental(): void {
    const { p, tracker } = this;
    const changed = p.events.filter(e => e.type === 'upsert').map(e => e.path);
    const deleted = [
      ...p.events.filter(e => e.type === 'delete').map(e => e.path),
      ...p.renames.map(r => r.oldPath),
    ];
    if (changed.length === 0 && deleted.length === 0) {
      tracker.start('fts5_incremental', {});
      tracker.skip('fts5_incremental', 'no changes');
      return;
    }
    tracker.start('fts5_incremental', { changed: changed.length, deleted: deleted.length });
    const result = updateFTS5Incremental(p.vp, changed, deleted);
    tracker.end(result);
    if (result.updated > 0 || result.removed > 0) {
      serverLog('watcher', `FTS5: ${result.updated} updated, ${result.removed} removed`);
    }
  }

  // ── Step 1.5: Note moves ──────────────────────────────────────────

  private noteMoves(): void {
    const { p, tracker } = this;
    tracker.start('note_moves', { count: p.renames.length });
    tracker.end({
      renames: p.renames.map(r => ({ oldPath: r.oldPath, newPath: r.newPath })),
    });
    if (p.renames.length > 0) {
      serverLog('watcher', `Note moves: ${p.renames.length} rename(s) recorded`);
    }
  }

  // ── Step 2: Entity scan (critical) ────────────────────────────────

  private async entityScan(): Promise<void> {
    const { p, tracker } = this;
    const vaultIndex = p.getVaultIndex();

    // Capture hub scores BEFORE entity scan resets them
    if (p.sd) {
      const rows = p.sd.db.prepare('SELECT name, hub_score FROM entities').all() as Array<{ name: string; hub_score: number }>;
      for (const r of rows) this.hubBefore.set(r.name, r.hub_score);
    }

    // Throttle: full entity scan is expensive (recursive directory walk).
    // Skip if scanned within 5 minutes; downstream steps still get entities from DB.
    const entityScanAgeMs = p.ctx.lastEntityScanAt > 0
      ? Date.now() - p.ctx.lastEntityScanAt : Infinity;
    if (entityScanAgeMs < 5 * 60 * 1000 && !this.hasEntityRelevantChanges) {
      tracker.start('entity_scan', {});
      tracker.skip('entity_scan', `cache valid (${Math.round(entityScanAgeMs / 1000)}s old)`);
      this.entitiesBefore = p.sd ? getAllEntitiesFromDb(p.sd) : [];
      this.entitiesAfter = this.entitiesBefore;
      p.deferredScheduler?.schedule('entity_scan', 5 * 60 * 1000 - entityScanAgeMs);
      serverLog('watcher', `Entity scan: throttled (${Math.round(entityScanAgeMs / 1000)}s old)`);
      return;
    }

    this.entitiesBefore = p.sd ? getAllEntitiesFromDb(p.sd) : [];
    tracker.start('entity_scan', { note_count: vaultIndex.notes.size });
    await p.updateEntitiesInStateDb(p.vp, p.sd);
    p.ctx.lastEntityScanAt = Date.now();
    this.entitiesAfter = p.sd ? getAllEntitiesFromDb(p.sd) : [];
    const entityDiff = computeEntityDiff(this.entitiesBefore, this.entitiesAfter);

    // Detect category/description changes and record in entity_changes audit log
    // Uses INSERT OR IGNORE + ms-precision timestamps to avoid UNIQUE constraint crashes
    const categoryChanges: Array<{ entity: string; from: string; to: string }> = [];
    const descriptionChanges: Array<{ entity: string; from: string | null; to: string | null }> = [];
    if (p.sd) {
      const beforeMap = new Map(this.entitiesBefore.map(e => [e.name, e]));
      const insertChange = p.sd.db.prepare(
        'INSERT OR IGNORE INTO entity_changes (entity, field, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?)'
      );
      try {
        const now = new Date().toISOString();
        for (const after of this.entitiesAfter) {
          const before = beforeMap.get(after.name);
          if (before && before.category !== after.category) {
            insertChange.run(after.name, 'category', before.category, after.category, now);
            categoryChanges.push({ entity: after.name, from: before.category, to: after.category });
          }
          if (before) {
            const oldDesc = before.description ?? null;
            const newDesc = after.description ?? null;
            if (oldDesc !== newDesc) {
              insertChange.run(after.name, 'description', oldDesc, newDesc, now);
              descriptionChanges.push({ entity: after.name, from: oldDesc, to: newDesc });
            }
          }
        }
      } catch (e) {
        serverLog('watcher', `entity_changes audit failed: ${e}`, 'error');
      }
    }

    tracker.end({ entity_count: this.entitiesAfter.length, ...entityDiff, category_changes: categoryChanges, description_changes: descriptionChanges });
    serverLog('watcher', `Entity scan: ${this.entitiesAfter.length} entities`);
  }

  // ── Step 3: Hub scores ────────────────────────────────────────────

  private async hubScores(): Promise<Record<string, unknown>> {
    const { p } = this;

    // Throttle: hub score computation iterates all notes + power iteration.
    // Skip if computed within 5 minutes.
    const hubAgeMs = p.ctx.lastHubScoreRebuildAt > 0
      ? Date.now() - p.ctx.lastHubScoreRebuildAt : Infinity;
    if (hubAgeMs < 5 * 60 * 1000) {
      p.deferredScheduler?.schedule('hub_scores', 5 * 60 * 1000 - hubAgeMs);
      serverLog('watcher', `Hub scores: throttled (${Math.round(hubAgeMs / 1000)}s old)`);
      return { skipped: true, age_ms: hubAgeMs };
    }

    const vaultIndex = p.getVaultIndex();
    const hubUpdated = await exportHubScores(vaultIndex, p.sd);
    const hubDiffs: Array<{ entity: string; before: number; after: number }> = [];
    if (p.sd) {
      const rows = p.sd.db.prepare('SELECT name, hub_score FROM entities').all() as Array<{ name: string; hub_score: number }>;
      for (const r of rows) {
        const prev = this.hubBefore.get(r.name) ?? 0;
        if (prev !== r.hub_score) hubDiffs.push({ entity: r.name, before: prev, after: r.hub_score });
      }
    }
    p.ctx.lastHubScoreRebuildAt = Date.now();
    serverLog('watcher', `Hub scores: ${hubUpdated ?? 0} updated`);
    return { updated: hubUpdated ?? 0, diffs: hubDiffs.slice(0, 10) };
  }

  // ── Step 3.5: Recency ─────────────────────────────────────────────

  private async recency(): Promise<Record<string, unknown>> {
    const { p } = this;
    const cachedRecency = loadRecencyFromStateDb(p.sd ?? undefined);
    const cacheAgeMs = cachedRecency ? Date.now() - (cachedRecency.lastUpdated ?? 0) : Infinity;
    if (cacheAgeMs >= 60 * 60 * 1000) {
      const entities = this.entitiesAfter.map(e => ({ name: e.name, path: e.path, aliases: e.aliases }));
      const recencyIndex = await buildRecencyIndex(p.vp, entities);
      saveRecencyToStateDb(recencyIndex, p.sd ?? undefined);
      serverLog('watcher', `Recency: rebuilt ${recencyIndex.lastMentioned.size} entities`);
      return { rebuilt: true, entities: recencyIndex.lastMentioned.size };
    }
    p.deferredScheduler?.schedule('recency', 60 * 60 * 1000 - cacheAgeMs);
    serverLog('watcher', `Recency: cache valid (${Math.round(cacheAgeMs / 1000)}s old)`);
    return { rebuilt: false, cached_age_ms: cacheAgeMs };
  }

  // ── Step 3.6: Co-occurrence ───────────────────────────────────────

  private async cooccurrence(): Promise<Record<string, unknown>> {
    const { p } = this;
    const cooccurrenceAgeMs = p.ctx.lastCooccurrenceRebuildAt > 0
      ? Date.now() - p.ctx.lastCooccurrenceRebuildAt
      : Infinity;
    if (cooccurrenceAgeMs >= 60 * 60 * 1000) {
      const entityNames = this.entitiesAfter.map(e => e.name);
      const cooccurrenceIdx = await mineCooccurrences(p.vp, entityNames);
      setCooccurrenceIndex(cooccurrenceIdx);
      p.ctx.lastCooccurrenceRebuildAt = Date.now();
      p.ctx.cooccurrenceIndex = cooccurrenceIdx;
      if (p.sd) {
        saveCooccurrenceToStateDb(p.sd, cooccurrenceIdx);
      }
      serverLog('watcher', `Co-occurrence: rebuilt ${cooccurrenceIdx._metadata.total_associations} associations`);
      return { rebuilt: true, associations: cooccurrenceIdx._metadata.total_associations };
    }
    p.deferredScheduler?.schedule('cooccurrence', 60 * 60 * 1000 - cooccurrenceAgeMs);
    serverLog('watcher', `Co-occurrence: cache valid (${Math.round(cooccurrenceAgeMs / 1000)}s old)`);
    return { rebuilt: false, age_ms: cooccurrenceAgeMs };
  }

  // ── Step 3.7: Edge weights ────────────────────────────────────────

  private async edgeWeights(): Promise<Record<string, unknown>> {
    const { p } = this;
    if (!p.sd) return { skipped: true };
    const edgeWeightAgeMs = p.ctx.lastEdgeWeightRebuildAt > 0
      ? Date.now() - p.ctx.lastEdgeWeightRebuildAt
      : Infinity;
    if (edgeWeightAgeMs >= 60 * 60 * 1000) {
      const result = recomputeEdgeWeights(p.sd);
      p.ctx.lastEdgeWeightRebuildAt = Date.now();
      serverLog('watcher', `Edge weights: ${result.edges_updated} edges in ${result.duration_ms}ms`);
      return {
        rebuilt: true,
        edges: result.edges_updated,
        duration_ms: result.duration_ms,
        total_weighted: result.total_weighted,
        avg_weight: result.avg_weight,
        strong_count: result.strong_count,
        top_changes: result.top_changes,
      };
    }
    p.deferredScheduler?.schedule('edge_weights', 60 * 60 * 1000 - edgeWeightAgeMs);
    serverLog('watcher', `Edge weights: cache valid (${Math.round(edgeWeightAgeMs / 1000)}s old)`);
    return { rebuilt: false, age_ms: edgeWeightAgeMs };
  }

  // ── Step 4: Note embeddings ───────────────────────────────────────

  private async noteEmbeddings(): Promise<StepRunResult> {
    const { p } = this;
    if (!hasEmbeddingsIndex()) {
      return { kind: 'skipped', reason: 'not built' };
    }
    let embUpdated = 0;
    let embRemoved = 0;
    for (const event of p.events) {
      try {
        if (event.type === 'delete') {
          removeEmbedding(event.path);
          embRemoved++;
        } else if (event.path.endsWith('.md')) {
          const absPath = path.join(p.vp, event.path);
          await updateEmbedding(event.path, absPath);
          embUpdated++;
        }
      } catch {
        // Don't let per-event embedding errors affect watcher
      }
    }
    let orphansRemoved = 0;
    try {
      orphansRemoved = removeOrphanedNoteEmbeddings();
    } catch (e) {
      serverLog('watcher', `Note embedding orphan cleanup failed: ${e}`, 'error');
    }
    serverLog('watcher', `Note embeddings: ${embUpdated} updated, ${embRemoved} removed, ${orphansRemoved} orphans cleaned`);
    return { kind: 'done', output: { updated: embUpdated, removed: embRemoved, orphans_removed: orphansRemoved } };
  }

  // ── Step 5: Entity embeddings ─────────────────────────────────────

  private async entityEmbeddings(): Promise<StepRunResult> {
    const { p } = this;
    if (!hasEntityEmbeddingsIndex() || !p.sd) {
      return { kind: 'skipped', reason: !p.sd ? 'no sd' : 'not built' };
    }
    let entEmbUpdated = 0;
    let entEmbOrphansRemoved = 0;
    const entEmbNames: string[] = [];
    try {
      const allEntities = getAllEntitiesFromDb(p.sd);
      for (const event of p.events) {
        if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
        const matching = allEntities.filter(e => e.path === event.path);
        for (const entity of matching) {
          await updateEntityEmbedding(entity.name, {
            name: entity.name,
            path: entity.path,
            category: entity.category,
            aliases: entity.aliases,
          }, p.vp);
          entEmbUpdated++;
          entEmbNames.push(entity.name);
        }
      }
      // Clean up embeddings for entities no longer in the database
      const currentNames = new Set(allEntities.map(e => e.name));
      entEmbOrphansRemoved = removeOrphanedEntityEmbeddings(currentNames);
    } catch (e) {
      serverLog('watcher', `Entity embedding update/orphan cleanup failed: ${e}`, 'error');
    }
    serverLog('watcher', `Entity embeddings: ${entEmbUpdated} updated, ${entEmbOrphansRemoved} orphans cleaned`);
    return { kind: 'done', output: { updated: entEmbUpdated, updated_entities: entEmbNames.slice(0, 10), orphans_removed: entEmbOrphansRemoved } };
  }

  // ── Step 6: Index cache ───────────────────────────────────────────

  private async indexCache(): Promise<void> {
    const { p, tracker } = this;
    const vaultIndex = p.getVaultIndex();
    if (p.sd) {
      // Throttle: full index serialization to SQLite is expensive for large vaults.
      // Skip if saved within 30 seconds.
      const cacheAgeMs = p.ctx.lastIndexCacheSaveAt > 0
        ? Date.now() - p.ctx.lastIndexCacheSaveAt : Infinity;
      if (cacheAgeMs < 30 * 1000) {
        tracker.start('index_cache', {});
        tracker.skip('index_cache', `saved recently (${Math.round(cacheAgeMs / 1000)}s ago)`);
        return;
      }
      tracker.start('index_cache', { note_count: vaultIndex.notes.size });
      try {
        saveVaultIndexToCache(p.sd, vaultIndex);
        p.ctx.lastIndexCacheSaveAt = Date.now();
        tracker.end({ saved: true });
        serverLog('watcher', 'Index cache saved');
      } catch (err) {
        tracker.end({ saved: false, error: err instanceof Error ? err.message : String(err) });
        serverLog('index', `Failed to update index cache: ${err instanceof Error ? err.message : err}`, 'error');
      }
    } else {
      tracker.skip('index_cache', 'no sd');
    }
  }

  // ── Step 7: Task cache ────────────────────────────────────────────

  private async taskCache(): Promise<void> {
    const { p, tracker } = this;
    tracker.start('task_cache', { files: p.events.length });
    let taskUpdated = 0;
    let taskRemoved = 0;
    for (const event of p.events) {
      try {
        if (event.type === 'delete') {
          removeTaskCacheForFile(event.path);
          taskRemoved++;
        } else if (event.path.endsWith('.md')) {
          await updateTaskCacheForFile(p.vp, event.path);
          taskUpdated++;
        }
      } catch {
        // Don't let task cache errors affect watcher
      }
    }
    tracker.end({ updated: taskUpdated, removed: taskRemoved });
    serverLog('watcher', `Task cache: ${taskUpdated} updated, ${taskRemoved} removed`);
  }

  // ── Step 8: Forward links ─────────────────────────────────────────

  private async forwardLinks(): Promise<Record<string, unknown>> {
    const { p } = this;
    const vaultIndex = p.getVaultIndex();
    let totalResolved = 0;
    let totalDead = 0;

    for (const event of p.events) {
      if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
      try {
        const links = getForwardLinksForNote(vaultIndex, event.path);
        const resolved: string[] = [];
        const dead: string[] = [];
        const seen = new Set<string>();
        for (const link of links) {
          const name = link.target;
          if (seen.has(name.toLowerCase())) continue;
          seen.add(name.toLowerCase());
          if (link.exists) resolved.push(name);
          else dead.push(name);
        }
        if (resolved.length > 0 || dead.length > 0) {
          this.forwardLinkResults.push({ file: event.path, resolved, dead });
        }
        totalResolved += resolved.length;
        totalDead += dead.length;
      } catch { /* ignore */ }
    }

    // Diff against stored links to detect additions/removals
    if (p.sd) {
      const upsertHistory = p.sd.db.prepare(`
        INSERT INTO note_link_history (note_path, target) VALUES (?, ?)
        ON CONFLICT(note_path, target) DO UPDATE SET edits_survived = edits_survived + 1
      `);
      const checkThreshold = p.sd.db.prepare(`
        SELECT target FROM note_link_history
        WHERE note_path = ? AND target = ? AND edits_survived >= 3 AND last_positive_at IS NULL
      `);
      const markPositive = p.sd.db.prepare(`
        UPDATE note_link_history SET last_positive_at = datetime('now') WHERE note_path = ? AND target = ?
      `);
      const getEdgeCount = p.sd.db.prepare(
        'SELECT edits_survived FROM note_link_history WHERE note_path=? AND target=?'
      );

      for (const entry of this.forwardLinkResults) {
        const currentSet = new Set([
          ...entry.resolved.map(n => n.toLowerCase()),
          ...entry.dead.map(n => n.toLowerCase()),
        ]);
        const previousSet = getStoredNoteLinks(p.sd, entry.file);
        if (previousSet.size === 0) {
          updateStoredNoteLinks(p.sd, entry.file, currentSet);
          continue;
        }
        const diff = diffNoteLinks(previousSet, currentSet);
        if (diff.added.length > 0 || diff.removed.length > 0) {
          this.linkDiffs.push({ file: entry.file, ...diff });
        }
        updateStoredNoteLinks(p.sd, entry.file, currentSet);

        if (diff.removed.length === 0) continue;
        for (const link of currentSet) {
          if (!previousSet.has(link)) continue;
          upsertHistory.run(entry.file, link);
          const countRow = getEdgeCount.get(entry.file, link) as { edits_survived: number } | undefined;
          if (countRow) {
            this.survivedLinks.push({ entity: link, file: entry.file, count: countRow.edits_survived });
          }
          const hit = checkThreshold.get(entry.file, link) as { target: string } | undefined;
          if (hit) {
            const entity = this.entitiesAfter.find(
              e => e.nameLower === link ||
                   (e.aliases ?? []).some((a: string) => a.toLowerCase() === link)
            );
            if (entity) {
              recordFeedback(p.sd, entity.name, 'implicit:kept', entry.file, true, 0.8);
              markPositive.run(entry.file, link);
            }
          }
        }
      }

      // Handle deleted files
      for (const event of p.events) {
        if (event.type === 'delete') {
          const previousSet = getStoredNoteLinks(p.sd, event.path);
          if (previousSet.size > 0) {
            this.linkDiffs.push({ file: event.path, added: [], removed: [...previousSet] });
            updateStoredNoteLinks(p.sd, event.path, new Set());
          }
        }
      }

      // Handle upserts where all wikilinks were removed
      const processedFiles = new Set(this.forwardLinkResults.map(r => r.file));
      for (const event of p.events) {
        if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
        if (processedFiles.has(event.path)) continue;
        const previousSet = getStoredNoteLinks(p.sd, event.path);
        if (previousSet.size > 0) {
          this.linkDiffs.push({ file: event.path, added: [], removed: [...previousSet] });
          updateStoredNoteLinks(p.sd, event.path, new Set());
        }
      }
    }

    // Highlight new dead links
    const newDeadLinks: Array<{ file: string; targets: string[] }> = [];
    const vaultIdx = p.getVaultIndex();
    for (const diff of this.linkDiffs) {
      const newDead = diff.added.filter(target => !vaultIdx.entities.has(target.toLowerCase()));
      if (newDead.length > 0) {
        newDeadLinks.push({ file: diff.file, targets: newDead });
      }
    }

    serverLog('watcher', `Forward links: ${totalResolved} resolved, ${totalDead} dead${newDeadLinks.length > 0 ? `, ${newDeadLinks.reduce((s, d) => s + d.targets.length, 0)} new dead` : ''}`);
    return {
      total_resolved: totalResolved,
      total_dead: totalDead,
      links: this.forwardLinkResults,
      link_diffs: this.linkDiffs,
      survived: this.survivedLinks,
      new_dead_links: newDeadLinks,
    };
  }

  // ── Step 9: Wikilink check ────────────────────────────────────────

  private async wikilinkCheck(): Promise<void> {
    const { p, tracker } = this;
    const vaultIndex = p.getVaultIndex();
    tracker.start('wikilink_check', { files: p.events.length });
    const trackedLinks: Array<{ file: string; entities: string[] }> = [];

    if (p.sd) {
      for (const event of p.events) {
        if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
        try {
          const apps = getTrackedApplications(p.sd, event.path);
          if (apps.length > 0) trackedLinks.push({ file: event.path, entities: apps });
        } catch { /* ignore */ }
      }
    }

    // Include manual wikilink additions from forward_links diff
    for (const diff of this.linkDiffs) {
      if (diff.added.length === 0) continue;
      const existing = trackedLinks.find(t => t.file === diff.file);
      if (existing) {
        const set = new Set(existing.entities.map(e => e.toLowerCase()));
        for (const a of diff.added) {
          if (!set.has(a)) {
            existing.entities.push(a);
            set.add(a);
          }
        }
      } else {
        trackedLinks.push({ file: diff.file, entities: diff.added });
      }
    }

    // Detect unwikified entity mentions in changed files
    const mentionResults: Array<{ file: string; entities: string[] }> = [];
    for (const event of p.events) {
      if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
      try {
        const content = await fs.readFile(path.join(p.vp, event.path), 'utf-8');
        const zones = getProtectedZones(content);
        const linked = new Set(
          (this.forwardLinkResults.find(r => r.file === event.path)?.resolved ?? [])
            .map(n => n.toLowerCase())
        );
        const mentions: string[] = [];
        for (const entity of this.entitiesAfter) {
          if (linked.has(entity.nameLower)) continue;
          if (p.sd && isSuppressed(p.sd, entity.name)) continue;
          const matches = findEntityMatches(content, entity.name, true);
          const valid = matches.some(m => !rangeOverlapsProtectedZone(m.start, m.end, zones));
          if (valid) {
            mentions.push(entity.name);
            continue;
          }
          for (const alias of (entity.aliases ?? [])) {
            const aliasMatches = findEntityMatches(content, alias, true);
            if (aliasMatches.some(m => !rangeOverlapsProtectedZone(m.start, m.end, zones))) {
              mentions.push(entity.name);
              break;
            }
          }
        }
        if (mentions.length > 0) {
          mentionResults.push({ file: event.path, entities: mentions });
        }
      } catch { /* ignore */ }
    }

    tracker.end({ tracked: trackedLinks, mentions: mentionResults });
    serverLog('watcher', `Wikilink check: ${trackedLinks.reduce((s, t) => s + t.entities.length, 0)} tracked links in ${trackedLinks.length} files, ${mentionResults.reduce((s, m) => s + m.entities.length, 0)} unwikified mentions`);
  }

  // ── Step 10: Implicit feedback ────────────────────────────────────

  private async implicitFeedback(): Promise<void> {
    const { p, tracker } = this;
    tracker.start('implicit_feedback', { files: p.events.length });

    const deletedFiles = new Set(
      p.events.filter(e => e.type === 'delete').map(e => e.path)
    );
    const preSuppressed = p.sd ? new Set(getAllSuppressionPenalties(p.sd).keys()) : new Set<string>();
    const feedbackResults: Array<{ entity: string; file: string }> = [];

    if (p.sd) {
      for (const event of p.events) {
        if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
        try {
          const content = await fs.readFile(path.join(p.vp, event.path), 'utf-8');
          const removed = processImplicitFeedback(p.sd, event.path, content);
          for (const entity of removed) feedbackResults.push({ entity, file: event.path });
        } catch { /* ignore */ }
      }
    }

    // Manual wikilink removals via forward_links diff
    if (p.sd && this.linkDiffs.length > 0) {
      for (const diff of this.linkDiffs) {
        if (deletedFiles.has(diff.file)) continue;
        for (const target of diff.removed) {
          if (feedbackResults.some(r => r.entity === target && r.file === diff.file)) continue;
          const entity = this.entitiesAfter.find(
            e => e.nameLower === target ||
              (e.aliases ?? []).some((a: string) => a.toLowerCase() === target)
          );
          if (entity) {
            recordFeedback(p.sd, entity.name, 'implicit:removed', diff.file, false);
            feedbackResults.push({ entity: entity.name, file: diff.file });
          }
        }
      }
    }

    // Manual wikilink additions via forward_links diff
    const additionResults: Array<{ entity: string; file: string }> = [];
    if (p.sd && this.linkDiffs.length > 0) {
      const checkApplication = p.sd.db.prepare(
        `SELECT 1 FROM wikilink_applications WHERE LOWER(entity) = LOWER(?) AND note_path = ? AND status = 'applied'`
      );
      for (const diff of this.linkDiffs) {
        if (deletedFiles.has(diff.file)) continue;
        const newlyTracked: Array<{ entity: string; matchedTerm?: string }> = [];
        for (const target of diff.added) {
          if (checkApplication.get(target, diff.file)) continue;
          const entity = this.entitiesAfter.find(
            e => e.nameLower === target ||
              (e.aliases ?? []).some((a: string) => a.toLowerCase() === target)
          );
          if (entity) {
            recordFeedback(p.sd, entity.name, 'implicit:manual_added', diff.file, true);
            additionResults.push({ entity: entity.name, file: diff.file });
            newlyTracked.push({
              entity: entity.name,
              matchedTerm: entity.nameLower === target ? undefined : target,
            });
          }
        }
        // Track applications so removal detection works on subsequent edits
        if (newlyTracked.length > 0) {
          trackWikilinkApplications(p.sd, diff.file, newlyTracked, 'manual_detected');
        }
      }
    }

    // Detect newly suppressed entities
    const newlySuppressed: string[] = [];
    if (p.sd) {
      const postSuppressed = getAllSuppressionPenalties(p.sd);
      for (const entity of postSuppressed.keys()) {
        if (!preSuppressed.has(entity)) {
          newlySuppressed.push(entity);
        }
      }
    }

    tracker.end({ removals: feedbackResults, additions: additionResults, newly_suppressed: newlySuppressed });
    if (feedbackResults.length > 0 || additionResults.length > 0) {
      serverLog('watcher', `Implicit feedback: ${feedbackResults.length} removals, ${additionResults.length} manual additions detected`);
    }
    if (newlySuppressed.length > 0) {
      serverLog('watcher', `Suppression: ${newlySuppressed.length} entities newly suppressed: ${newlySuppressed.join(', ')}`);
    }
  }

  // ── Step 10.1: Incremental recency ──────────────────────────────

  private async incrementalRecency(): Promise<Record<string, unknown>> {
    const { p } = this;
    if (!p.sd) return { skipped: true };

    let updated = 0;
    const now = new Date();
    for (const entry of this.forwardLinkResults) {
      for (const target of entry.resolved) {
        recordEntityMention(p.sd, target, now);
        updated++;
      }
    }
    return { entities_updated: updated };
  }

  // ── Step 10.5: Corrections ────────────────────────────────────────

  private async corrections(): Promise<Record<string, unknown>> {
    const { p } = this;
    if (!p.sd) return { skipped: true };
    const corrProcessed = processPendingCorrections(p.sd);
    if (corrProcessed > 0) {
      updateSuppressionList(p.sd);
      serverLog('watcher', `Corrections: ${corrProcessed} processed`);
    }
    return { processed: corrProcessed };
  }

  // ── Step 11: Prospect scan ────────────────────────────────────────

  private async prospectScan(): Promise<Record<string, unknown>> {
    const { p } = this;
    const vaultIndex = p.getVaultIndex();
    const prospectResults: Array<{
      file: string;
      implicit: string[];
      deadLinkMatches: string[];
    }> = [];

    for (const event of p.events) {
      if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
      try {
        const content = await fs.readFile(path.join(p.vp, event.path), 'utf-8');
        const zones = getProtectedZones(content);
        const linkedSet = new Set(
          (this.forwardLinkResults.find(r => r.file === event.path)?.resolved ?? [])
            .concat(this.forwardLinkResults.find(r => r.file === event.path)?.dead ?? [])
            .map(n => n.toLowerCase())
        );
        const knownEntitySet = new Set(this.entitiesAfter.map(e => e.nameLower));

        const implicitMatches = detectImplicitEntities(content);
        const implicitNames = implicitMatches
          .filter(imp => !linkedSet.has(imp.text.toLowerCase()) && !knownEntitySet.has(imp.text.toLowerCase()))
          .map(imp => imp.text);

        const deadLinkMatches: string[] = [];
        for (const [key, links] of vaultIndex.backlinks) {
          if (links.length < 2 || vaultIndex.entities.has(key) || linkedSet.has(key)) continue;
          const matches = findEntityMatches(content, key, true);
          if (matches.some(m => !rangeOverlapsProtectedZone(m.start, m.end, zones))) {
            deadLinkMatches.push(key);
          }
        }

        if (implicitNames.length > 0 || deadLinkMatches.length > 0) {
          prospectResults.push({ file: event.path, implicit: implicitNames, deadLinkMatches });
        }
      } catch { /* ignore */ }
    }

    if (prospectResults.length > 0) {
      const implicitCount = prospectResults.reduce((s, p) => s + p.implicit.length, 0);
      const deadCount = prospectResults.reduce((s, p) => s + p.deadLinkMatches.length, 0);
      serverLog('watcher', `Prospect scan: ${implicitCount} implicit entities, ${deadCount} dead link matches across ${prospectResults.length} files`);

      // Persist prospect sightings to ledger
      const sightings: ProspectSighting[] = [];
      for (const result of prospectResults) {
        for (const name of result.implicit) {
          sightings.push({
            term: name.toLowerCase(),
            displayName: name,
            notePath: result.file,
            source: 'implicit',
            confidence: 'low',
          });
        }
        for (const target of result.deadLinkMatches) {
          const backlinkCount = vaultIndex.backlinks.get(target)?.length ?? 0;
          const ftsCount = countFTS5Mentions(target);
          const isHighScore = backlinkCount >= 3 && ftsCount >= 3;
          sightings.push({
            term: target.toLowerCase(),
            displayName: target,
            notePath: result.file,
            source: isHighScore ? 'high_score' : 'dead_link',
            confidence: backlinkCount >= 3 ? 'high' : 'medium',
            backlinkCount,
            score: isHighScore ? ftsCount : 0,
          });
        }
      }
      if (sightings.length > 0) {
        recordProspectSightings(sightings);
        const affectedTerms = [...new Set(sightings.map(s => s.term))];
        refreshProspectSummaries(affectedTerms);
      }
      cleanStaleProspects();
    }
    return { prospects: prospectResults };
  }

  // ── Step 12: Suggestion scoring ───────────────────────────────────

  private async suggestionScoring(): Promise<void> {
    const { p, tracker } = this;
    tracker.start('suggestion_scoring', { files: p.events.length });

    for (const event of p.events) {
      if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
      try {
        const rawContent = await fs.readFile(path.join(p.vp, event.path), 'utf-8');
        const content = rawContent.replace(/ → \[\[.*$/gm, '');
        const result = await suggestRelatedLinks(content, {
          maxSuggestions: 5,
          notePath: event.path,
          detail: true,
        });
        if (result.detailed && result.detailed.length > 0) {
          this.suggestionResults.push({
            file: event.path,
            top: result.detailed.slice(0, 5).map(s => ({
              entity: s.entity,
              score: s.totalScore,
              confidence: s.confidence,
            })),
          });
        }
      } catch { /* ignore */ }
    }

    tracker.end({ scored_files: this.suggestionResults.length, suggestions: this.suggestionResults });
    if (this.suggestionResults.length > 0) {
      serverLog('watcher', `Suggestion scoring: ${this.suggestionResults.length} files scored`);
    }
  }

  // ── Step 0.5: Drain proactive queue ──────────────────────────────

  private async drainQueue(): Promise<Record<string, unknown>> {
    const { p } = this;
    if (!p.sd || p.flywheelConfig?.proactive_linking === false) {
      return { skipped: true };
    }

    const result = await drainProactiveQueue(
      p.sd,
      p.vp,
      {
        minScore: p.flywheelConfig?.proactive_min_score ?? 20,
        maxPerFile: p.flywheelConfig?.proactive_max_per_file ?? 5,
        maxPerDay: p.flywheelConfig?.proactive_max_per_day ?? 10,
      },
      applyProactiveSuggestions,
    );

    const totalApplied = result.applied.reduce((s, r) => s + r.entities.length, 0);
    if (totalApplied > 0) {
      serverLog('watcher', `Proactive drain: applied ${totalApplied} links in ${result.applied.length} files`);
    }

    return {
      applied: result.applied,
      total_applied: totalApplied,
      expired: result.expired,
      skipped_active: result.skippedActiveEdit,
      skipped_mtime: result.skippedMtimeGuard,
      skipped_daily_cap: result.skippedDailyCap,
    };
  }

  // ── Step 12.5: Proactive enqueue ───────────────────────────────────

  private async proactiveLinking(): Promise<void> {
    const { p, tracker } = this;
    if (p.flywheelConfig?.proactive_linking === false || this.suggestionResults.length === 0) return;
    if (!p.sd) return;

    tracker.start('proactive_enqueue', { files: this.suggestionResults.length });
    try {
      const minScore = p.flywheelConfig?.proactive_min_score ?? 20;
      const maxPerFile = p.flywheelConfig?.proactive_max_per_file ?? 5;
      const entries: QueueEntry[] = [];

      for (const { file, top } of this.suggestionResults) {
        const candidates = top
          .filter(s => s.score >= minScore && s.confidence === 'high')
          .slice(0, maxPerFile);

        for (const c of candidates) {
          entries.push({ notePath: file, entity: c.entity, score: c.score, confidence: c.confidence });
        }
      }

      const enqueued = enqueueProactiveSuggestions(p.sd, entries);
      tracker.end({ enqueued, total_candidates: entries.length });
      if (enqueued > 0) {
        serverLog('watcher', `Proactive enqueue: ${enqueued} suggestions queued for deferred application`);
      }
    } catch (e) {
      tracker.end({ error: String(e) });
      serverLog('watcher', `Proactive enqueue failed: ${e}`, 'error');
    }
  }

  // ── Step 13: Tag scan ─────────────────────────────────────────────

  private async tagScan(): Promise<Record<string, unknown>> {
    const { p } = this;
    const vaultIndex = p.getVaultIndex();
    const tagDiffs: Array<{ file: string; added: string[]; removed: string[] }> = [];

    if (p.sd) {
      const noteTagsForward = new Map<string, Set<string>>();
      for (const [tag, paths] of vaultIndex.tags) {
        for (const notePath of paths) {
          if (!noteTagsForward.has(notePath)) noteTagsForward.set(notePath, new Set());
          noteTagsForward.get(notePath)!.add(tag);
        }
      }

      for (const event of p.events) {
        if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
        const currentSet = noteTagsForward.get(event.path) ?? new Set<string>();
        const previousSet = getStoredNoteTags(p.sd, event.path);
        if (previousSet.size === 0 && currentSet.size > 0) {
          updateStoredNoteTags(p.sd, event.path, currentSet);
          continue;
        }
        const added = [...currentSet].filter(t => !previousSet.has(t));
        const removed = [...previousSet].filter(t => !currentSet.has(t));
        if (added.length > 0 || removed.length > 0) {
          tagDiffs.push({ file: event.path, added, removed });
        }
        updateStoredNoteTags(p.sd, event.path, currentSet);
      }

      for (const event of p.events) {
        if (event.type === 'delete') {
          const previousSet = getStoredNoteTags(p.sd, event.path);
          if (previousSet.size > 0) {
            tagDiffs.push({ file: event.path, added: [], removed: [...previousSet] });
            updateStoredNoteTags(p.sd, event.path, new Set());
          }
        }
      }
    }

    const totalTagsAdded = tagDiffs.reduce((s, d) => s + d.added.length, 0);
    const totalTagsRemoved = tagDiffs.reduce((s, d) => s + d.removed.length, 0);
    if (tagDiffs.length > 0) {
      serverLog('watcher', `Tag scan: ${totalTagsAdded} added, ${totalTagsRemoved} removed across ${tagDiffs.length} files`);
    }
    return { total_added: totalTagsAdded, total_removed: totalTagsRemoved, tag_diffs: tagDiffs };
  }

  // ── Step 19: Retrieval co-occurrence ──────────────────────────────

  private async retrievalCooccurrence(): Promise<Record<string, unknown>> {
    const { p } = this;
    if (!p.sd) return { skipped: 'no sd' };
    const inserted = mineRetrievalCooccurrence(p.sd);
    if (inserted > 0) {
      serverLog('watcher', `Retrieval co-occurrence: ${inserted} new pairs`);
    }
    return { pairs_inserted: inserted };
  }

  /** Periodic integrity check — staleness-gated to once every 6 hours. */
  private async integrityCheck(): Promise<Record<string, unknown>> {
    const { p } = this;
    if (!p.sd) return { skipped: true, reason: 'no statedb' };
    const result = await p.runIntegrityCheck(p.ctx, 'watcher');
    if (result.status === 'healthy') {
      return { integrity: 'ok', backed_up: result.backupCreated };
    }
    if (result.status === 'failed') {
      serverLog('watcher', `Integrity check FAILED: ${result.detail}`, 'error');
      return { integrity: 'failed', detail: result.detail };
    }
    return { skipped: true, reason: result.detail ?? 'integrity runner unavailable' };
  }

  // ── Maintenance: periodic incremental vacuum ─────────────────────

  private async maintenance(): Promise<Record<string, unknown>> {
    const { p } = this;
    if (!p.sd) return { skipped: true, reason: 'no statedb' };

    const VACUUM_INTERVAL_MS = 60 * 60 * 1000; // hourly
    const lastRow = p.sd.getMetadataValue.get('last_incremental_vacuum') as { value: string } | undefined;
    const lastVacuum = lastRow ? parseInt(lastRow.value, 10) : 0;

    if (Date.now() - lastVacuum < VACUUM_INTERVAL_MS) {
      return { skipped: true, reason: 'vacuumed recently' };
    }

    p.sd.db.pragma('incremental_vacuum');
    const walResult = p.sd.db.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number; log: number; checkpointed: number }>;
    const checkpointed = walResult?.[0]?.busy === 0;

    if (checkpointed) {
      p.sd.setMetadataValue.run('last_incremental_vacuum', String(Date.now()));
      serverLog('watcher', 'Incremental vacuum + WAL checkpoint completed');
    } else {
      serverLog('watcher', 'Incremental vacuum done, WAL checkpoint skipped (busy readers)');
    }
    return { vacuumed: true, wal_checkpointed: checkpointed };
  }
}
