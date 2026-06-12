/**
 * Post-index work (arch-review S10 — extracted verbatim from index.ts).
 *
 * Everything that runs after a vault's index is ready: entity scan, hub
 * export, metrics, graph snapshot, suppression list, config inference
 * kickoff, task cache, the embeddings auto-build retry orchestration
 * (council residual b — collaborators injected via EmbeddingsAutoBuildDeps),
 * watcher setup (wiring itself lives in core/write/pipeline/watchGlue.ts
 * since S9), sweep/maintenance timer setup, and the periodic purge timers.
 */

import { realpathSync } from 'fs';
import type { IndexState } from './../core/read/graph.js';
import type { VaultIndex } from './../core/read/types.js';
import { loadConfig, inferConfig, saveConfig, getExcludeTags, type FlywheelConfig } from './../core/read/config.js';
import { exportHubScores } from './../core/shared/hubExport.js';
import { initializeEntityIndex } from './../core/write/wikilinks.js';
import {
  buildEmbeddingsIndex,
  buildEntityEmbeddingsIndex,
  hasEmbeddingsIndex,
  setEmbeddingsBuilding,
  setEmbeddingsBuildState,
  loadEntityEmbeddingsToMemory,
  getStoredEmbeddingModel,
  getActiveModelId,
  getStoredTextVersion,
  clearEmbeddingsForRebuild,
  classifyUncategorizedEntities,
  saveInferredCategories,
  EMBEDDING_TEXT_VERSION,
} from './../core/read/embeddings.js';
import {
  refreshIfStale,
  isTaskCacheStale,
} from './../core/read/taskCache.js';
import { loadEffectivenessSnapshot } from './../core/read/toolRouting.js';
import { getToolEffectivenessScores } from './../core/shared/toolSelectionFeedback.js';
import { getAllEntitiesFromDb, type StateDb } from '@velvetmonkey/vault-core';
import { sweepExpiredMemories, decayMemoryConfidence, pruneSupersededMemories } from './../core/write/memoryMaintenance.js';
import { startSweepTimer } from './../core/read/sweep.js';
import { startMaintenanceTimer } from './../core/write/pipeline/maintenance.js';
import { setupVaultWatcher } from './../core/write/pipeline/watchGlue.js';
import { computeMetrics, recordMetrics, purgeOldMetrics } from './../core/shared/metrics.js';
import { purgeOldBenchmarks } from './../core/shared/benchmarks.js';
import { purgeOldIndexEvents, purgeOldSuggestionEvents, purgeOldNoteLinkHistory } from './../core/shared/indexActivity.js';
import { purgeOldInvocations } from './../core/shared/toolTracking.js';
import { computeGraphMetrics, recordGraphSnapshot, purgeOldSnapshots } from './../core/shared/graphSnapshots.js';
import { serverLog } from './../core/shared/serverLog.js';
import { updateSuppressionList } from './../core/write/wikilinkFeedback.js';
import { pruneStaleRetrievalCooccurrence } from './../core/shared/retrievalCooccurrence.js';
import type { VaultContext } from './../vault-registry.js';
import { runInVaultScope, setFallbackScope, getActiveScopeOrNull } from './../vault-scope.js';
import {
  buildVaultScope,
  activateVault,
  updateIndexState,
  updateVaultIndex,
  updateFlywheelConfig,
  updateEntitiesInStateDb,
} from './registryContext.js';
import { runIntegrityCheck } from './integrity.js';
import {
  startupScanFiles,
  setStartupScanFiles,
  setWatcherInstance,
  lastMcpRequestAt,
  lastFullRebuildAt,
} from './state.js';

// ============================================================================
// Periodic Maintenance (runs on sweep timer — every 5 min)
// ============================================================================

/**
 * Periodic maintenance callback for the sweep timer.
 * Memory lifecycle runs every call (cheap SQL on small tables).
 * Purges run once per day (not urgent, just prevent unbounded growth).
 */
export function runPeriodicMaintenance(ctx: VaultContext, db: StateDb): void {
  // Memory lifecycle — cheap, run every sweep (5 min)
  sweepExpiredMemories(db);
  decayMemoryConfidence(db);
  pruneSupersededMemories(db, 90);

  // Refresh effectiveness snapshot for active vault (T15b)
  try {
    const vaultName = getActiveScopeOrNull()?.name;
    if (vaultName) {
      const scores = getToolEffectivenessScores(db);
      loadEffectivenessSnapshot(vaultName, scores);
    }
  } catch { /* table may not exist on older DBs */ }

  // Purges — run once per day
  const now = Date.now();
  if (now - ctx.lastPurgeAt > 24 * 60 * 60 * 1000) {
    purgeOldMetrics(db, 90);
    purgeOldBenchmarks(db, 90);
    purgeOldIndexEvents(db, 90);
    purgeOldInvocations(db, 90);
    purgeOldSuggestionEvents(db, 30);
    purgeOldNoteLinkHistory(db, 90);
    purgeOldSnapshots(db, 90);
    pruneStaleRetrievalCooccurrence(db, 30);
    ctx.lastPurgeAt = now;
    serverLog('server', 'Daily purge complete');
  }
}

// ============================================================================
// Embeddings auto-build retry orchestration (council residual b)
// ============================================================================

/**
 * Collaborators for the embeddings auto-build retry orchestration.
 * Injected explicitly so the retry sequencing + mid-build re-activation
 * calls can be pinned by a unit test without loading the real model
 * (test/boot/embeddings-retry.test.ts).
 */
export interface EmbeddingsAutoBuildDeps {
  hasEmbeddingsIndex: typeof hasEmbeddingsIndex;
  getStoredEmbeddingModel: typeof getStoredEmbeddingModel;
  getStoredTextVersion: typeof getStoredTextVersion;
  getActiveModelId: typeof getActiveModelId;
  /** EMBEDDING_TEXT_VERSION */
  embeddingTextVersion: number;
  clearEmbeddingsForRebuild: typeof clearEmbeddingsForRebuild;
  loadEntityEmbeddingsToMemory: typeof loadEntityEmbeddingsToMemory;
  buildEmbeddingsIndex: typeof buildEmbeddingsIndex;
  buildEntityEmbeddingsIndex: typeof buildEntityEmbeddingsIndex;
  setEmbeddingsBuilding: typeof setEmbeddingsBuilding;
  setEmbeddingsBuildState: typeof setEmbeddingsBuildState;
  getAllEntitiesFromDb: typeof getAllEntitiesFromDb;
  classifyUncategorizedEntities: typeof classifyUncategorizedEntities;
  saveInferredCategories: typeof saveInferredCategories;
  activateVault: typeof activateVault;
  serverLog: typeof serverLog;
}

/** The production collaborators (the same module imports runPostIndexWork used inline). */
export function defaultEmbeddingsAutoBuildDeps(): EmbeddingsAutoBuildDeps {
  return {
    hasEmbeddingsIndex,
    getStoredEmbeddingModel,
    getStoredTextVersion,
    getActiveModelId,
    embeddingTextVersion: EMBEDDING_TEXT_VERSION,
    clearEmbeddingsForRebuild,
    loadEntityEmbeddingsToMemory,
    buildEmbeddingsIndex,
    buildEntityEmbeddingsIndex,
    setEmbeddingsBuilding,
    setEmbeddingsBuildState,
    getAllEntitiesFromDb,
    classifyUncategorizedEntities,
    saveInferredCategories,
    activateVault,
    serverLog,
  };
}

/**
 * Auto-build embeddings in background (fire-and-forget).
 * Moved verbatim from runPostIndexWork (the FLYWHEEL_SKIP_EMBEDDINGS-guarded
 * block) — collaborators arrive via the explicit deps parameter.
 */
export function runEmbeddingsAutoBuild(
  ctx: VaultContext,
  vp: string,
  sd: StateDb | null,
  deps: EmbeddingsAutoBuildDeps,
): void {
  // Auto-build embeddings in background (fire-and-forget)
  // Fast pre-check avoids model loading when embeddings are already current
  if (process.env.FLYWHEEL_SKIP_EMBEDDINGS !== 'true') {
    const hasIndex = deps.hasEmbeddingsIndex();
    const storedModel = deps.getStoredEmbeddingModel();
    const storedVersion = deps.getStoredTextVersion();
    const modelChanged = storedModel !== null && storedModel !== deps.getActiveModelId();
    const versionChanged = storedVersion !== null && storedVersion !== deps.embeddingTextVersion;

    if (hasIndex && !modelChanged && !versionChanged) {
      // Everything current — skip model load, just load entity embeddings to memory
      deps.serverLog('semantic', 'Embeddings up-to-date, skipping build');
      deps.loadEntityEmbeddingsToMemory();
      if (sd) {
        const entities = deps.getAllEntitiesFromDb(sd);
        if (entities.length > 0) {
          deps.saveInferredCategories(deps.classifyUncategorizedEntities(
            entities.map(entity => ({
              entity: {
                name: entity.name,
                path: entity.path,
                aliases: entity.aliases,
              },
              category: entity.category,
            }))
          ));
        }
      }
    } else {
      // Something needs updating — model load required
      if (modelChanged) {
        deps.serverLog('semantic', `Model changed ${storedModel} → ${deps.getActiveModelId()}, clearing`);
        deps.clearEmbeddingsForRebuild();
      } else if (versionChanged) {
        deps.serverLog('semantic', `Text version changed v${storedVersion} → v${deps.embeddingTextVersion}`);
      } else if (!hasIndex) {
        deps.serverLog('semantic', 'No embeddings found, building');
      } else {
        // storedVersion is null — migration from pre-version-tracking
        deps.serverLog('semantic', 'No stored version, running build to verify/update');
      }

      const MAX_BUILD_RETRIES = 2;

      const attemptBuild = async (attempt: number): Promise<void> => {
        // Re-activate this vault's context before each attempt — in multi-vault mode,
        // another vault's boot may have swapped the module-level DB handles since this
        // fire-and-forget build was launched.
        deps.activateVault(ctx);
        deps.setEmbeddingsBuilding(true);
        ctx.embeddingsBuilding = true;
        try {
          await deps.buildEmbeddingsIndex(vp, (p) => {
            if (p.current % 100 === 0 || p.current === p.total) {
              deps.serverLog('semantic', `Embedding ${p.current}/${p.total} notes...`);
            }
          });
          if (sd) {
            const entities = deps.getAllEntitiesFromDb(sd);
            if (entities.length > 0) {
              const entityMap = new Map(entities.map(e => [e.name, {
                name: e.name,
                path: e.path,
                category: e.category,
                aliases: e.aliases,
              }]));
              // Re-activate before entity embeddings (may have been swapped during note build)
              deps.activateVault(ctx);
              await deps.buildEntityEmbeddingsIndex(vp, entityMap);
            }
          }
          deps.activateVault(ctx);
          deps.loadEntityEmbeddingsToMemory();
          if (sd) {
            const entities = deps.getAllEntitiesFromDb(sd);
            if (entities.length > 0) {
              deps.saveInferredCategories(deps.classifyUncategorizedEntities(
                entities.map(entity => ({
                  entity: {
                    name: entity.name,
                    path: entity.path,
                    aliases: entity.aliases,
                  },
                  category: entity.category,
                }))
              ));
            }
          }
          deps.setEmbeddingsBuildState('complete');
          deps.serverLog('semantic', 'Embeddings ready — searches now use hybrid ranking');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (attempt < MAX_BUILD_RETRIES) {
            const delay = 10_000;
            deps.serverLog('semantic', `Build failed (attempt ${attempt}/${MAX_BUILD_RETRIES}): ${msg}. Retrying in ${delay / 1000}s...`, 'error');
            await new Promise(resolve => setTimeout(resolve, delay));
            return attemptBuild(attempt + 1);
          }
          deps.serverLog('semantic', `Embeddings build failed after ${MAX_BUILD_RETRIES} attempts: ${msg}`, 'error');
          deps.serverLog('semantic', 'Keyword search (BM25) remains fully available', 'error');
        } finally {
          deps.activateVault(ctx);
          deps.setEmbeddingsBuilding(false);
          ctx.embeddingsBuilding = false;
        }
      };

      attemptBuild(1);
    }
  } else {
    deps.serverLog('semantic', 'Skipping — FLYWHEEL_SKIP_EMBEDDINGS');
  }
}

// ============================================================================
// Post-index work
// ============================================================================

/**
 * Post-index work: config inference, hub export, file watcher.
 * Accepts VaultContext so all state is scoped per-vault (multi-vault safe).
 */
export async function runPostIndexWork(ctx: VaultContext) {
  const index = ctx.vaultIndex;
  const vp = ctx.vaultPath;
  const sd = ctx.stateDb;
  const runWithVaultScope = <T>(fn: () => T): T => runInVaultScope(buildVaultScope(ctx), fn);
  const updateCtxIndexState = (state: IndexState, error?: Error | null): void => {
    ctx.indexState = state;
    if (error !== undefined) ctx.indexError = error;
    if ((globalThis as any).__flywheel_active_vault === ctx.name) {
      updateIndexState(state, error);
      setFallbackScope(buildVaultScope(ctx));
    }
  };
  const updateCtxVaultIndex = (nextIndex: VaultIndex): void => {
    ctx.vaultIndex = nextIndex;
    if ((globalThis as any).__flywheel_active_vault === ctx.name) {
      updateVaultIndex(nextIndex);
      setFallbackScope(buildVaultScope(ctx));
    }
  };
  const updateCtxFlywheelConfig = (config: FlywheelConfig): void => {
    ctx.flywheelConfig = config;
    if ((globalThis as any).__flywheel_active_vault === ctx.name) {
      updateFlywheelConfig(config);
    }
  };
  let rvp: string;
  try { rvp = realpathSync(vp).replace(/\\/g, '/'); } catch { rvp = vp.replace(/\\/g, '/'); }
  const postStart = Date.now();

  // Scan and save entities to StateDb
  serverLog('index', 'Scanning entities...');
  await updateEntitiesInStateDb(vp, sd);

  // Initialize wikilink entity index from StateDb (now populated)
  await initializeEntityIndex(vp);
  serverLog('index', 'Entity index initialized');

  // Export hub scores
  await exportHubScores(index, sd);
  serverLog('index', 'Hub scores exported');

  // Record growth metrics
  if (sd) {
    try {
      const metrics = computeMetrics(index, sd);
      recordMetrics(sd, metrics);
      purgeOldMetrics(sd, 90);
      purgeOldIndexEvents(sd, 90);
      purgeOldInvocations(sd, 90);
      purgeOldSuggestionEvents(sd, 30);
      purgeOldNoteLinkHistory(sd, 90);
      // Memory lifecycle maintenance
      sweepExpiredMemories(sd);
      decayMemoryConfidence(sd);
      pruneSupersededMemories(sd, 90);
      serverLog('server', 'Growth metrics recorded');
    } catch (err) {
      serverLog('server', `Failed to record metrics: ${err instanceof Error ? err.message : err}`, 'error');
    }
  }

  // Record graph topology snapshot
  if (sd) {
    try {
      const graphMetrics = computeGraphMetrics(index);
      recordGraphSnapshot(sd, graphMetrics);
      purgeOldSnapshots(sd, 90);
    } catch (err) {
      serverLog('server', `Failed to record graph snapshot: ${err instanceof Error ? err.message : err}`, 'error');
    }
  }

  // Update wikilink suppression list
  if (sd) {
    try {
      updateSuppressionList(sd);
      serverLog('index', 'Suppression list updated');
    } catch (err) {
      serverLog('server', `Failed to update suppression list: ${err instanceof Error ? err.message : err}`, 'error');
    }
  }

  // Load/infer config early so task cache can use exclude tags
  const existing = loadConfig(sd);
  const inferred = inferConfig(index, vp);
  if (sd) {
    saveConfig(sd, inferred, existing);
  }
  updateCtxFlywheelConfig(loadConfig(sd));
  const configKeys = Object.keys(ctx.flywheelConfig).filter(k => (ctx.flywheelConfig as Record<string, unknown>)[k] != null);
  serverLog('config', `Config inferred: ${configKeys.join(', ')}`);

  // Build task cache (skip rebuild if SQLite cache is already fresh)
  if (sd) {
    if (isTaskCacheStale()) {
      serverLog('tasks', 'Task cache stale, rebuilding...');
      refreshIfStale(vp, index, getExcludeTags(ctx.flywheelConfig));
    } else {
      serverLog('tasks', 'Task cache fresh, skipping rebuild');
    }
  }

  if (ctx.flywheelConfig.vault_name) {
    serverLog('config', `Vault: ${ctx.flywheelConfig.vault_name}`);
  }

  // Embeddings auto-build (retry orchestration extracted above — S10 residual b)
  runEmbeddingsAutoBuild(ctx, vp, sd, defaultEmbeddingsAutoBuildDeps());

  // Setup file watcher (wiring moved to core/write/pipeline/watchGlue.ts — arch-review S9;
  // index.ts only builds the deps object from its module-scoped closures/state)
  if (process.env.FLYWHEEL_WATCH !== 'false') {
    await setupVaultWatcher({
      ctx,
      vp,
      rvp,
      sd,
      runWithVaultScope,
      updateIndexState: updateCtxIndexState,
      updateVaultIndex: updateCtxVaultIndex,
      updateEntitiesInStateDb,
      runIntegrityCheck,
      startupScanFiles,
      setWatcherInstance,
    });
  }

  // Free startup scan files — no longer needed after catch-up
  setStartupScanFiles(null);

  // Start periodic sweep for graph hygiene metrics (only when watcher is active)
  if (process.env.FLYWHEEL_WATCH !== 'false') {
    startSweepTimer(() => ctx.vaultIndex, undefined, () => {
      if (sd) runPeriodicMaintenance(ctx, sd);
    }, runWithVaultScope, ctx.name);
    serverLog('server', 'Sweep timer started (5 min interval)');

    // Start periodic maintenance for aggregate step refresh
    const maintenanceIntervalMs = parseInt(process.env.FLYWHEEL_MAINTENANCE_INTERVAL_MINUTES ?? '120', 10) * 60 * 1000;
    startMaintenanceTimer({
      ctx,
      vp,
      sd,
      getVaultIndex: () => ctx.vaultIndex,
      updateEntitiesInStateDb,
      updateFlywheelConfig: updateCtxFlywheelConfig,
      getLastMcpRequestAt: () => lastMcpRequestAt,
      getLastFullRebuildAt: () => lastFullRebuildAt,
      runWithScope: runWithVaultScope,
    }, maintenanceIntervalMs);
    serverLog('server', `Maintenance timer started (~${Math.round(maintenanceIntervalMs / 60000)}min interval)`);
  }

  const postDuration = Date.now() - postStart;
  serverLog('server', `Post-index work complete in ${postDuration}ms`);
}
