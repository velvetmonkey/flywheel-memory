/**
 * Deferred Step Scheduler (arch-review S9 — moved from core/read/watch/pipeline.ts).
 *
 * When the watcher pipeline throttles a step (e.g. "co-occurrence < 1hr old"),
 * the scheduler sets a timer to run that step at its TTL expiry. If another
 * watcher batch fires before the timer, the timer is cancelled and rescheduled.
 * This ensures throttled steps eventually run even when no more edits arrive.
 *
 * Kept `implements`-free on purpose: it must stay structurally compatible
 * with DeferredStepSchedulerHandle from src/vault-types.ts (leaf module).
 */

import { getAllEntitiesFromDb } from '@velvetmonkey/vault-core';
import type { DeferredStepName, DeferredStepExecutor } from '../../../vault-types.js';
import { serverLog } from '../../shared/serverLog.js';
import { recordIndexEvent } from '../../shared/indexActivity.js';
import { exportHubScores } from '../../shared/hubExport.js';
import { buildRecencyIndex, saveRecencyToStateDb } from '../../shared/recency.js';
import { mineCooccurrences, saveCooccurrenceToStateDb } from '../../shared/cooccurrence.js';
import { setCooccurrenceIndex } from '../wikilinks.js';
import { recomputeEdgeWeights } from '../edgeWeights.js';

export type { DeferredStepName, DeferredStepExecutor, DeferredStepSchedulerHandle } from '../../../vault-types.js';

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
      const run = exec.runWithScope ?? ((fn: () => Promise<void>) => fn());
      await run(async () => {
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
      });
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
