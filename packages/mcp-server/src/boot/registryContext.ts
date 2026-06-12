/**
 * Registry context + vault activation (arch-review S10 — extracted verbatim
 * from index.ts).
 *
 * Owns the glue between the per-vault VaultContext objects and the
 * module-level singletons in boot/state.ts:
 *   - buildRegistryContext / buildVaultCallbacks — what tool registration sees
 *   - buildVaultScope — VaultContext → VaultScope snapshot for ALS scoping
 *   - activateVault — swaps the module-level singletons (multi-vault)
 *   - updateIndexState / updateVaultIndex / updateFlywheelConfig — mirror
 *     module-level state changes back to the active VaultContext
 *   - updateEntitiesInStateDb — entity scan → StateDb
 */

import {
  setIndexState,
  setIndexError,
  type IndexState,
} from './../core/read/graph.js';
import type { VaultIndex } from './../core/read/types.js';
import { loadConfig, DEFAULT_ENTITY_EXCLUDE_FOLDERS, type FlywheelConfig } from './../core/read/config.js';
import { setWriteStateDb, setWikilinkConfig, setCooccurrenceIndex } from './../core/write/wikilinks.js';
import { setFTS5Database } from './../core/read/fts5.js';
import {
  setEmbeddingsDatabase,
  setEmbeddingsBuilding,
  loadEntityEmbeddingsToMemory,
} from './../core/read/embeddings.js';
import { setProspectStateDb } from './../core/shared/prospects.js';
import { serverLog } from './../core/shared/serverLog.js';
import { scanVaultEntities, type StateDb } from '@velvetmonkey/vault-core';
import type { VaultContext } from './../vault-registry.js';
import { getActiveScopeOrNull, setFallbackScope, type VaultScope } from './../vault-scope.js';
import type { ToolRegistryContext, VaultActivationCallbacks } from './../tool-registry.js';
import {
  vaultPath,
  vaultIndex,
  stateDb,
  flywheelConfig,
  vaultRegistry,
  getWatcherStatus,
  setVaultIndex,
  setFlywheelConfig,
} from './state.js';

/** Build the ToolRegistryContext from module-level singletons (scope-aware getters). */
export function buildRegistryContext(): ToolRegistryContext {
  return {
    getVaultPath: () => getActiveScopeOrNull()?.vaultPath ?? vaultPath,
    getVaultIndex: () => getActiveScopeOrNull()?.vaultIndex ?? vaultIndex,
    getStateDb: () => getActiveScopeOrNull()?.stateDb ?? stateDb,
    getFlywheelConfig: () => getActiveScopeOrNull()?.flywheelConfig ?? flywheelConfig,
    getWatcherStatus,
    getPipelineActivity: () => getActiveScopeOrNull()?.pipelineActivity ?? null,
    getVaultRuntimeState: () => {
      const scope = getActiveScopeOrNull();
      return {
        bootState: scope?.bootState ?? 'booting',
        integrityState: scope?.integrityState ?? 'unknown',
        integrityCheckInProgress: scope?.integrityCheckInProgress ?? false,
        integrityStartedAt: scope?.integrityStartedAt ?? null,
        integritySource: scope?.integritySource ?? null,
        lastIntegrityCheckedAt: scope?.lastIntegrityCheckedAt ?? null,
        lastIntegrityDurationMs: scope?.lastIntegrityDurationMs ?? null,
        lastIntegrityDetail: scope?.lastIntegrityDetail ?? null,
        lastBackupAt: scope?.lastBackupAt ?? null,
      };
    },
    updateVaultIndex,
    updateFlywheelConfig,
  };
}

/** Build vault activation callbacks for multi-vault gating. */
export function buildVaultCallbacks(): VaultActivationCallbacks {
  return { activateVault, buildVaultScope };
}

/** Build a VaultScope snapshot from a VaultContext (for runInVaultScope). */
export function buildVaultScope(ctx: VaultContext): VaultScope {
  return {
    name: ctx.name,
    vaultPath: ctx.vaultPath,
    stateDb: ctx.stateDb,
    flywheelConfig: ctx.flywheelConfig,
    vaultIndex: ctx.vaultIndex,
    get cooccurrenceIndex() { return ctx.cooccurrenceIndex; },
    set cooccurrenceIndex(value) { ctx.cooccurrenceIndex = value; },
    get indexState() { return ctx.indexState; },
    set indexState(value) { ctx.indexState = value; },
    get indexError() { return ctx.indexError; },
    set indexError(value) { ctx.indexError = value; },
    get embeddingsBuilding() { return ctx.embeddingsBuilding; },
    set embeddingsBuilding(value) { ctx.embeddingsBuilding = value; },
    get writeEntityIndex() { return ctx.writeEntityIndex; },
    set writeEntityIndex(value) { ctx.writeEntityIndex = value; },
    get writeEntityIndexReady() { return ctx.writeEntityIndexReady; },
    set writeEntityIndexReady(value) { ctx.writeEntityIndexReady = value; },
    get writeEntityIndexError() { return ctx.writeEntityIndexError; },
    set writeEntityIndexError(value) { ctx.writeEntityIndexError = value; },
    get writeEntityIndexLastLoadedAt() { return ctx.writeEntityIndexLastLoadedAt; },
    set writeEntityIndexLastLoadedAt(value) { ctx.writeEntityIndexLastLoadedAt = value; },
    get writeRecencyIndex() { return ctx.writeRecencyIndex; },
    set writeRecencyIndex(value) { ctx.writeRecencyIndex = value; },
    get taskCacheBuilding() { return ctx.taskCacheBuilding; },
    set taskCacheBuilding(value) { ctx.taskCacheBuilding = value; },
    get entityEmbeddingsMap() { return ctx.entityEmbeddingsMap; },
    set entityEmbeddingsMap(value) { ctx.entityEmbeddingsMap = value; },
    get inferredCategoriesMap() { return ctx.inferredCategoriesMap; },
    set inferredCategoriesMap(value) { ctx.inferredCategoriesMap = value; },
    get mutedWatcherPaths() { return ctx.mutedWatcherPaths; },
    set mutedWatcherPaths(value) { ctx.mutedWatcherPaths = value; },
    get dirtyMutedWatcherPaths() { return ctx.dirtyMutedWatcherPaths; },
    set dirtyMutedWatcherPaths(value) { ctx.dirtyMutedWatcherPaths = value; },
    get reconcileMutedWatcherPaths() { return ctx.reconcileMutedWatcherPaths; },
    set reconcileMutedWatcherPaths(value) { ctx.reconcileMutedWatcherPaths = value; },
    pipelineActivity: ctx.pipelineActivity,
    get bootState() { return ctx.bootState; },
    set bootState(value) { ctx.bootState = value; },
    get integrityState() { return ctx.integrityState; },
    set integrityState(value) { ctx.integrityState = value; },
    get integrityCheckInProgress() { return ctx.integrityCheckInProgress; },
    set integrityCheckInProgress(value) { ctx.integrityCheckInProgress = value; },
    get integrityStartedAt() { return ctx.integrityStartedAt; },
    set integrityStartedAt(value) { ctx.integrityStartedAt = value; },
    get integritySource() { return ctx.integritySource; },
    set integritySource(value) { ctx.integritySource = value; },
    get lastIntegrityCheckedAt() { return ctx.lastIntegrityCheckedAt; },
    set lastIntegrityCheckedAt(value) { ctx.lastIntegrityCheckedAt = value; },
    get lastIntegrityDurationMs() { return ctx.lastIntegrityDurationMs; },
    set lastIntegrityDurationMs(value) { ctx.lastIntegrityDurationMs = value; },
    get lastIntegrityDetail() { return ctx.lastIntegrityDetail; },
    set lastIntegrityDetail(value) { ctx.lastIntegrityDetail = value; },
    get lastBackupAt() { return ctx.lastBackupAt; },
    set lastBackupAt(value) { ctx.lastBackupAt = value; },
  };
}

/**
 * Activate a vault context by swapping all module-level singletons.
 * Also sets the fallback VaultScope for boot-time compatibility outside ALS context.
 * Requests, watcher batches, and background jobs should run inside runInVaultScope().
 *
 * @param skipEmbeddingLoad - Skip loading entity embeddings into memory (used during
 *   early startup to avoid blocking the event loop before transport connects)
 */
export function activateVault(ctx: VaultContext, skipEmbeddingLoad = false): void {
  // Update module-level state
  (globalThis as any).__flywheel_active_vault = ctx.name;

  // Set the fallback VaultScope first so scope-aware caches populate per-vault state.
  setFallbackScope(buildVaultScope(ctx));

  if (ctx.stateDb) {
    setWriteStateDb(ctx.stateDb);
    setFTS5Database(ctx.stateDb.db);
    setProspectStateDb(ctx.stateDb);
    setEmbeddingsDatabase(ctx.stateDb.db);
    if (!skipEmbeddingLoad) {
      loadEntityEmbeddingsToMemory();
    }
  }

  // Swap state that was previously not per-vault
  setWikilinkConfig(ctx.flywheelConfig);
  setCooccurrenceIndex(ctx.cooccurrenceIndex);
  setIndexState(ctx.indexState);
  setIndexError(ctx.indexError);
  setEmbeddingsBuilding(ctx.embeddingsBuilding);
}

/**
 * Get the currently active VaultContext (by __flywheel_active_vault name).
 * Used to mirror module-level state changes back to the context.
 */
export function getActiveVaultContext(): VaultContext | null {
  if (!vaultRegistry) return null;
  const name = (globalThis as any).__flywheel_active_vault;
  if (!name) return null;
  try { return vaultRegistry.getContext(name); } catch { return null; }
}

/** Update index state on both module-level singleton and active VaultContext */
export function updateIndexState(state: IndexState, error?: Error | null): void {
  setIndexState(state);
  if (error !== undefined) setIndexError(error);
  const ctx = getActiveVaultContext();
  if (ctx) {
    ctx.indexState = state;
    if (error !== undefined) ctx.indexError = error;
  }
}

/** Update vaultIndex on both module-level singleton and active VaultContext */
export function updateVaultIndex(index: VaultIndex): void {
  setVaultIndex(index);
  const ctx = getActiveVaultContext();
  if (ctx) ctx.vaultIndex = index;
}

/** Update flywheelConfig on both module-level singleton and active VaultContext */
export function updateFlywheelConfig(config: FlywheelConfig): void {
  setFlywheelConfig(config);
  setWikilinkConfig(config);
  const ctx = getActiveVaultContext();
  if (ctx) {
    ctx.flywheelConfig = config;
    // Rebuild fallback scope so scope-aware getters see the update
    setFallbackScope(buildVaultScope(ctx));
  }
}

// DEFAULT_ENTITY_EXCLUDE_FOLDERS imported from ./core/read/config.js

/**
 * Scan vault for entities and save to StateDb
 */
export async function updateEntitiesInStateDb(vp?: string, sd?: StateDb | null): Promise<void> {
  const db = sd ?? stateDb;
  const vault = vp ?? vaultPath;
  if (!db) return;

  try {
    const config = loadConfig(db);
    const excludeFolders = config.exclude_entity_folders?.length
      ? config.exclude_entity_folders
      : DEFAULT_ENTITY_EXCLUDE_FOLDERS;

    const entityIndex = await scanVaultEntities(vault, {
      excludeFolders,
      customCategories: config.custom_categories,
    });
    db.replaceAllEntities(entityIndex);
    serverLog('index', `Updated ${entityIndex._metadata.total_entities} entities in StateDb`);
  } catch (e) {
    serverLog('index', `Failed to update entities in StateDb: ${e instanceof Error ? e.message : e}`, 'error');
  }
}
