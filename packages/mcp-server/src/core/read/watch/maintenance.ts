/**
 * Periodic Maintenance — background aggregate refresh
 *
 * Runs on a setTimeout-chained loop (default every 2 hours, ±15% jitter).
 * Only executes aggregate/global steps that the watcher throttles:
 *   - Entity scan + hub scores
 *   - Recency index
 *   - Co-occurrence index
 *   - Edge weights
 *   - Config inference
 *   - Graph snapshot
 *
 * Does NOT re-walk the vault filesystem, rebuild FTS5, or re-embed notes
 * (the watcher handles those incrementally).
 *
 * Skips if:
 *   - Pipeline is currently busy
 *   - A full rebuild (startup/manual) happened within 1 hour
 *   - Server is not idle (MCP request within last 30 seconds)
 */

import type { StateDb } from '@velvetmonkey/vault-core';
import { getAllEntitiesFromDb } from '@velvetmonkey/vault-core';
import type { VaultIndex } from '../types.js';
import type { VaultContext } from '../../../vault-registry.js';
import { serverLog } from '../../shared/serverLog.js';
import { recordIndexEvent, createStepTracker } from '../../shared/indexActivity.js';
import { exportHubScores } from '../../shared/hubExport.js';
import { buildRecencyIndex, loadRecencyFromStateDb, saveRecencyToStateDb } from '../../shared/recency.js';
import { mineCooccurrences, saveCooccurrenceToStateDb } from '../../shared/cooccurrence.js';
import { setCooccurrenceIndex } from '../../write/wikilinks.js';
import { recomputeEdgeWeights } from '../../write/edgeWeights.js';
import { loadConfig, inferConfig, saveConfig } from '../config.js';
import { computeGraphMetrics, recordGraphSnapshot } from '../../shared/graphSnapshots.js';
import { saveVaultIndexToCache } from '../graph.js';

/** Default maintenance interval: 2 hours */
const DEFAULT_INTERVAL_MS = 2 * 60 * 60 * 1000;

/** Minimum interval between maintenance runs */
const MIN_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/** Jitter factor: ±15% */
const JITTER_FACTOR = 0.15;

/** Skip maintenance if a full rebuild happened within this window */
const RECENT_REBUILD_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

/** Skip if an MCP request happened within this window */
const IDLE_THRESHOLD_MS = 30 * 1000; // 30 seconds

/** TTL thresholds for individual steps */
const STEP_TTLS = {
  entity_scan: 5 * 60 * 1000,      // 5 minutes
  hub_scores: 5 * 60 * 1000,       // 5 minutes
  recency: 60 * 60 * 1000,         // 1 hour
  cooccurrence: 60 * 60 * 1000,    // 1 hour
  edge_weights: 60 * 60 * 1000,    // 1 hour
  config_inference: 2 * 60 * 60 * 1000, // 2 hours (only runs during maintenance)
} as const;

export interface MaintenanceConfig {
  ctx: VaultContext;
  vp: string;
  sd: StateDb | null;
  getVaultIndex: () => VaultIndex;
  updateEntitiesInStateDb: (vp: string, sd: StateDb | null) => Promise<void>;
  updateFlywheelConfig: (config: any) => void;
  getLastMcpRequestAt: () => number;
  getLastFullRebuildAt: () => number;
  runWithScope?: <T>(fn: () => T) => T;
}

interface MaintenanceRuntime {
  config: MaintenanceConfig | null;
  timer: ReturnType<typeof setTimeout> | null;
  lastConfigInferenceAt: number;
}

const runtimes = new Map<string, MaintenanceRuntime>();

function resolveRuntimeKey(cfgOrKey?: MaintenanceConfig | string): string {
  if (typeof cfgOrKey === 'string') return cfgOrKey;
  return cfgOrKey?.ctx.name ?? 'default';
}

function getRuntime(key: string): MaintenanceRuntime {
  let runtime = runtimes.get(key);
  if (!runtime) {
    runtime = {
      config: null,
      timer: null,
      lastConfigInferenceAt: 0,
    };
    runtimes.set(key, runtime);
  }
  return runtime;
}

function addJitter(interval: number): number {
  const jitter = interval * JITTER_FACTOR * (2 * Math.random() - 1);
  return Math.max(MIN_INTERVAL_MS, interval + jitter);
}

/**
 * Start the periodic maintenance loop.
 * Schedules the first run after one interval (with jitter).
 */
export function startMaintenanceTimer(cfg: MaintenanceConfig, intervalMs?: number): void {
  const runtime = getRuntime(resolveRuntimeKey(cfg));
  runtime.config = cfg;
  if (runtime.timer) {
    clearTimeout(runtime.timer);
    runtime.timer = null;
  }
  const baseInterval = Math.max(intervalMs ?? DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS);
  scheduleNext(resolveRuntimeKey(cfg), baseInterval);
  serverLog('maintenance', `Timer started (interval ~${Math.round(baseInterval / 60000)}min)`);
}

/** Stop the maintenance timer */
export function stopMaintenanceTimer(key?: string): void {
  if (key) {
    const runtime = runtimes.get(resolveRuntimeKey(key));
    if (!runtime) return;
    if (runtime.timer) {
      clearTimeout(runtime.timer);
      runtime.timer = null;
    }
    runtime.config = null;
    return;
  }

  for (const runtime of runtimes.values()) {
    if (runtime.timer) {
      clearTimeout(runtime.timer);
      runtime.timer = null;
    }
    runtime.config = null;
  }
}

function scheduleNext(key: string, baseInterval: number): void {
  const runtime = getRuntime(key);
  runtime.timer = setTimeout(() => {
    runMaintenance(key, baseInterval);
  }, addJitter(baseInterval));
  runtime.timer.unref();
}

async function runMaintenance(key: string, baseInterval: number): Promise<void> {
  const runtime = getRuntime(key);
  const cfg = runtime.config;
  if (!cfg) return;

  const run = cfg.runWithScope ?? ((fn: () => Promise<void>) => fn());
  await run(async () => {
    await runMaintenanceInScope(key, cfg, baseInterval);
  });
}

async function runMaintenanceInScope(key: string, cfg: MaintenanceConfig, baseInterval: number): Promise<void> {
  const runtime = getRuntime(key);

  const { ctx, sd } = cfg;

  // Skip if pipeline is busy
  if (ctx.pipelineActivity.busy) {
    serverLog('maintenance', 'Skipped: pipeline busy');
    scheduleNext(key, baseInterval);
    return;
  }

  // Skip if a full rebuild happened recently
  const lastFullRebuild = cfg.getLastFullRebuildAt();
  if (lastFullRebuild > 0 && Date.now() - lastFullRebuild < RECENT_REBUILD_THRESHOLD_MS) {
    serverLog('maintenance', `Skipped: full rebuild ${Math.round((Date.now() - lastFullRebuild) / 60000)}min ago`);
    scheduleNext(key, baseInterval);
    return;
  }

  // Skip if not idle
  const lastRequest = cfg.getLastMcpRequestAt();
  if (lastRequest > 0 && Date.now() - lastRequest < IDLE_THRESHOLD_MS) {
    serverLog('maintenance', 'Skipped: server not idle, retrying in 1min');
    // Retry sooner — server was recently active
    runtime.timer = setTimeout(() => runMaintenance(key, baseInterval), 60 * 1000);
    runtime.timer.unref();
    return;
  }

  const start = Date.now();
  const stepsRun: string[] = [];
  const tracker = createStepTracker();

  try {
    const now = Date.now();

    // Entity scan (if stale)
    const entityAge = ctx.lastEntityScanAt > 0 ? now - ctx.lastEntityScanAt : Infinity;
    if (entityAge >= STEP_TTLS.entity_scan) {
      tracker.start('entity_scan', {});
      await cfg.updateEntitiesInStateDb(cfg.vp, sd);
      ctx.lastEntityScanAt = Date.now();
      const entities = sd ? getAllEntitiesFromDb(sd) : [];
      tracker.end({ entity_count: entities.length });
      stepsRun.push('entity_scan');
    }

    // Hub scores (if stale)
    const hubAge = ctx.lastHubScoreRebuildAt > 0 ? now - ctx.lastHubScoreRebuildAt : Infinity;
    if (hubAge >= STEP_TTLS.hub_scores) {
      tracker.start('hub_scores', {});
      const updated = await exportHubScores(cfg.getVaultIndex(), sd);
      ctx.lastHubScoreRebuildAt = Date.now();
      tracker.end({ updated: updated ?? 0 });
      stepsRun.push('hub_scores');
    }

    // Recency (if stale)
    const cachedRecency = loadRecencyFromStateDb(sd ?? undefined);
    const recencyAge = cachedRecency ? now - (cachedRecency.lastUpdated ?? 0) : Infinity;
    if (recencyAge >= STEP_TTLS.recency) {
      tracker.start('recency', {});
      const entities = sd ? getAllEntitiesFromDb(sd) : [];
      const entityInput = entities.map(e => ({ name: e.name, path: e.path, aliases: e.aliases }));
      const recencyIndex = await buildRecencyIndex(cfg.vp, entityInput);
      saveRecencyToStateDb(recencyIndex, sd ?? undefined);
      tracker.end({ entities: recencyIndex.lastMentioned.size });
      stepsRun.push('recency');
    }

    // Co-occurrence (if stale)
    const cooccurrenceAge = ctx.lastCooccurrenceRebuildAt > 0 ? now - ctx.lastCooccurrenceRebuildAt : Infinity;
    if (cooccurrenceAge >= STEP_TTLS.cooccurrence) {
      tracker.start('cooccurrence', {});
      const entities = sd ? getAllEntitiesFromDb(sd) : [];
      const entityNames = entities.map(e => e.name);
      const cooccurrenceIdx = await mineCooccurrences(cfg.vp, entityNames);
      setCooccurrenceIndex(cooccurrenceIdx);
      ctx.lastCooccurrenceRebuildAt = Date.now();
      ctx.cooccurrenceIndex = cooccurrenceIdx;
      if (sd) saveCooccurrenceToStateDb(sd, cooccurrenceIdx);
      tracker.end({ associations: cooccurrenceIdx._metadata.total_associations });
      stepsRun.push('cooccurrence');
    }

    // Edge weights (if stale)
    const edgeWeightAge = ctx.lastEdgeWeightRebuildAt > 0 ? now - ctx.lastEdgeWeightRebuildAt : Infinity;
    if (sd && edgeWeightAge >= STEP_TTLS.edge_weights) {
      tracker.start('edge_weights', {});
      const result = recomputeEdgeWeights(sd);
      ctx.lastEdgeWeightRebuildAt = Date.now();
      tracker.end({ edges: result.edges_updated });
      stepsRun.push('edge_weights');
    }

    // Config inference (only during maintenance — watcher never does this)
    const configAge = runtime.lastConfigInferenceAt > 0 ? now - runtime.lastConfigInferenceAt : Infinity;
    if (sd && configAge >= STEP_TTLS.config_inference) {
      tracker.start('config_inference', {});
      const existing = loadConfig(sd);
      const inferred = inferConfig(cfg.getVaultIndex(), cfg.vp);
      saveConfig(sd, inferred, existing);
      cfg.updateFlywheelConfig(loadConfig(sd));
      runtime.lastConfigInferenceAt = Date.now();
      tracker.end({ inferred: true });
      stepsRun.push('config_inference');
    }

    // Graph snapshot
    if (sd && stepsRun.length > 0) {
      try {
        tracker.start('graph_snapshot', {});
        const graphMetrics = computeGraphMetrics(cfg.getVaultIndex());
        recordGraphSnapshot(sd, graphMetrics);
        tracker.end({ recorded: true });
        stepsRun.push('graph_snapshot');
      } catch (err) {
        tracker.end({ error: String(err) });
      }
    }

    // Save index cache if we ran any steps
    if (sd && stepsRun.length > 0) {
      try {
        saveVaultIndexToCache(sd, cfg.getVaultIndex());
        ctx.lastIndexCacheSaveAt = Date.now();
      } catch { /* best-effort */ }
    }

    const duration = Date.now() - start;
    if (stepsRun.length > 0) {
      serverLog('maintenance', `Completed ${stepsRun.length} steps in ${duration}ms: ${stepsRun.join(', ')}`);
      if (sd) {
        recordIndexEvent(sd, {
          trigger: 'maintenance',
          duration_ms: duration,
          note_count: cfg.getVaultIndex().notes.size,
          steps: tracker.steps,
        });
      }
    } else {
      serverLog('maintenance', `All steps fresh, nothing to do (${duration}ms)`);
    }
  } catch (err) {
    const duration = Date.now() - start;
    serverLog('maintenance', `Failed after ${duration}ms: ${err instanceof Error ? err.message : err}`, 'error');
    if (sd) {
      recordIndexEvent(sd, {
        trigger: 'maintenance',
        duration_ms: duration,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        steps: tracker.steps,
      });
    }
  }

  // Schedule next run
  scheduleNext(key, baseInterval);
}
