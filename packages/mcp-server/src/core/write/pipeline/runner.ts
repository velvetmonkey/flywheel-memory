/**
 * Watcher Pipeline runner — extracted step logic from handleBatch
 * (arch-review S9: moved from core/read/watch/pipeline.ts; step
 * implementations live in steps-index.ts / steps-linking.ts /
 * steps-learning.ts / steps-maintenance.ts).
 *
 * Critical steps throw on failure. Non-critical steps use the runStep()
 * wrapper (try-catch + tracker).
 *
 * Data flows between steps via PipelineRunner fields (entitiesAfter,
 * linkDiffs, etc.) — the runner is structurally a PipelineState.
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import matter from 'gray-matter';
import type { EntitySearchResult } from '@velvetmonkey/vault-core';

import type { CoalescedEvent, PipelineActivity } from '../../read/watch/types.js';
import { serverLog } from '../../shared/serverLog.js';
import { createStepTracker, recordIndexEvent, type StepRunResult } from '../../shared/indexActivity.js';
import { PIPELINE_TOTAL_STEPS } from './activity.js';
import type { PipelineContext, StepTracker } from './context.js';
import {
  indexRebuild,
  fts5Incremental,
  noteMoves,
  entityScan,
  hubScores,
  recency,
  cooccurrence,
  edgeWeights,
  noteEmbeddings,
  entityEmbeddings,
  indexCache,
  taskCache,
} from './steps-index.js';
import {
  forwardLinks,
  wikilinkCheck,
  implicitFeedback,
  incrementalRecency,
  corrections,
} from './steps-linking.js';
import {
  drainQueue,
  prospectScan,
  suggestionScoring,
  proactiveLinking,
  tagScan,
  retrievalCooccurrence,
} from './steps-learning.js';
import { integrityCheck, maintenance } from './steps-maintenance.js';

export type {
  PipelineContext,
  PipelineState,
  StepTracker,
  IndexStateUpdater,
  VaultIndexUpdater,
  EntitiesUpdater,
} from './context.js';

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
  tracker: StepTracker;
  private batchStart: number;
  private activity: PipelineActivity;

  // Shared state between steps
  entitiesAfter: EntitySearchResult[] = [];
  entitiesBefore: EntitySearchResult[] = [];
  hubBefore = new Map<string, number>();
  hasEntityRelevantChanges = false;
  forwardLinkResults: Array<{ file: string; resolved: string[]; dead: string[] }> = [];
  linkDiffs: Array<{ file: string; added: string[]; removed: string[] }> = [];
  survivedLinks: Array<{ entity: string; file: string; count: number }> = [];
  suggestionResults: Array<{ file: string; top: Array<{ entity: string; score: number; confidence: string }> }> = [];
  lightIndexPaths = new Set<string>();

  constructor(public p: PipelineContext) {
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

  private isLightIndexPath(filePath: string): boolean {
    return this.lightIndexPaths.has(filePath);
  }

  normalEvents(): CoalescedEvent[] {
    return this.p.events.filter(e => !this.isLightIndexPath(e.path));
  }

  private async detectLightIndexFiles(): Promise<void> {
    const { p } = this;
    this.lightIndexPaths.clear();

    for (const event of p.events) {
      if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
      try {
        const raw = await fs.readFile(path.join(p.vp, event.path), 'utf-8');
        const parsed = matter(raw);
        if (
          parsed.data?.flywheel_indexing === 'light' ||
          parsed.data?.type === 'daily-log-shard'
        ) {
          this.lightIndexPaths.add(event.path);
        }
      } catch {
        // Light-index detection is an optimisation, not a critical path.
      }
    }

    if (this.lightIndexPaths.size > 0) {
      serverLog('watcher', `Light-index files: ${this.lightIndexPaths.size} (${[...this.lightIndexPaths].slice(0, 5).join(', ')})`);
    }
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
      await this.detectLightIndexFiles();

      // Step 0.5: Drain deferred proactive queue (before any file processing)
      await runStep('drain_proactive_queue', tracker, {}, () => drainQueue(this));

      // Critical steps (throw on failure)
      await indexRebuild(this);
      fts5Incremental(this);
      noteMoves(this);
      await entityScan(this);

      // Non-critical steps (catch and log)
      await runStep('hub_scores', tracker, { entity_count: this.entitiesAfter.length }, () => hubScores(this));
      await runStep('recency', tracker, { entity_count: this.entitiesAfter.length }, () => recency(this));
      await runStep('cooccurrence', tracker, { entity_count: this.entitiesAfter.length }, () => cooccurrence(this));
      if (p.sd) {
        await runStep('edge_weights', tracker, {}, () => edgeWeights(this));
      }
      await runStep('note_embeddings', tracker, { files: p.events.length }, () => noteEmbeddings(this));
      await runStep('entity_embeddings', tracker, { files: p.events.length }, () => entityEmbeddings(this));
      await indexCache(this);
      await taskCache(this);
      await runStep('forward_links', tracker, { files: p.events.length }, () => forwardLinks(this));
      await wikilinkCheck(this);
      await implicitFeedback(this);
      await runStep('incremental_recency', tracker, { files: p.events.length }, () => incrementalRecency(this));
      await runStep('corrections', tracker, {}, () => corrections(this));
      await runStep('prospect_scan', tracker, { files: p.events.length }, () => prospectScan(this));
      await suggestionScoring(this);
      await proactiveLinking(this);
      await runStep('tag_scan', tracker, { files: p.events.length }, () => tagScan(this));
      await runStep('retrieval_cooccurrence', tracker, {}, () => retrievalCooccurrence(this));
      await runStep('integrity_check', tracker, {}, () => integrityCheck(this));
      await runStep('maintenance', tracker, {}, () => maintenance(this));

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
}
