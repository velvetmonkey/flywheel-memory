/**
 * Wikilink module state + entity-index lifecycle (arch-review G5, part F2)
 *
 * Owns the DI/module-state for the wikilink family (StateDb handle,
 * FlywheelConfig, co-occurrence + recency indexes) with ALS scope
 * getter/setter pairs, and the entity index lifecycle.
 *
 * ARCHITECTURE NOTE: Flywheel Memorymaintains its own entity index independent of Flywheel.
 * This is by design for resilience - Flywheel Memoryworks even if Flywheel isn't running.
 * Both Flywheel and Flywheel Memoryuse @velvetmonkey/vault-core for consistent scanning
 * logic, but each maintains its own cached copy of the entity index.
 *
 * Storage: SQLite StateDb at .claude/state.db (managed by vault-core)
 *
 * Lifecycle:
 * 1. On startup: Load from StateDb if valid, else full vault scan
 * 2. StateDb includes version number for migration detection
 * 3. Index is held in memory for the duration of the MCP session
 * 4. Flywheel exposes entity data via MCP for LLM queries
 * 5. Flywheel Memoryuses its local copy for wikilink application during mutations
 */

import {
  scanVaultEntities,
  getAllEntities,
  getEntityName,
  getEntityIndexFromDb,
  getStateDbMetadata,
  type EntityIndex,
  type StateDb,
} from '@velvetmonkey/vault-core';
import { setGitStateDb } from './git.js';
import { setHintsStateDb } from './hints.js';
import type { FlywheelConfig } from '../read/config.js';
import type { StrictnessMode } from './types.js';
import {
  mineCooccurrences,
  type CooccurrenceIndex,
} from '../shared/cooccurrence.js';
import {
  buildRecencyIndex,
  loadRecencyFromStateDb,
  saveRecencyToStateDb,
  type RecencyIndex,
} from '../shared/recency.js';
import { getActiveScopeOrNull } from '../../vault-scope.js';

/**
 * Module-level StateDb reference
 */
let moduleStateDb: StateDb | null = null;

/**
 * Set the StateDb instance for all Flywheel Memorycore modules
 * Called during MCP server initialization
 */
export function setWriteStateDb(stateDb: StateDb | null): void {
  moduleStateDb = stateDb;
  // Propagate to other modules
  setGitStateDb(stateDb);
  setHintsStateDb(stateDb);
}

/**
 * Get the StateDb instance (for use by other modules like mutation-helpers).
 * Checks ALS scope first for per-request isolation.
 */
export function getWriteStateDb(): StateDb | null {
  return getActiveScopeOrNull()?.stateDb ?? moduleStateDb;
}

/**
 * Module-level FlywheelConfig reference for wikilink behavior
 */
let moduleConfig: FlywheelConfig | null = null;

/** Set the FlywheelConfig for wikilink behavior (called at startup and on config change) */
export function setWikilinkConfig(config: FlywheelConfig): void {
  moduleConfig = config;
}

/** Get the effective config (VaultScope if available, else module-level) */
export function getConfig(): FlywheelConfig | null {
  const scope = getActiveScopeOrNull();
  return scope ? scope.flywheelConfig : moduleConfig;
}

/** Get the configured strictness mode (reads from VaultScope if available) */
export function getWikilinkStrictness(): StrictnessMode {
  return getConfig()?.wikilink_strictness ?? 'balanced';
}

/** Get the co-occurrence index (reads from VaultScope if available) */
export function getCooccurrenceIndex(): CooccurrenceIndex | null {
  const scope = getActiveScopeOrNull();
  return scope ? scope.cooccurrenceIndex : cooccurrenceIndex;
}

/**
 * Set the co-occurrence index (called by watcher to inject rebuilt index).
 * Follows the same explicit cache-injection pattern as other write-side helpers.
 */
export function setCooccurrenceIndex(index: CooccurrenceIndex | null): void {
  cooccurrenceIndex = index;
}

/**
 * Get the raw module-level co-occurrence index WITHOUT consulting the ALS
 * scope. The scoring engine (suggestRelatedLinks) has always read the bare
 * module variable directly — this accessor preserves that exact behavior
 * across the wikilinks.ts module split.
 */
export function getUnscopedCooccurrenceIndex(): CooccurrenceIndex | null {
  return cooccurrenceIndex;
}

/**
 * Global entity index state
 */
let entityIndex: EntityIndex | null = null;
let indexReady = false;
let indexError: Error | null = null;

/**
 * Timestamp when entity index was last loaded from StateDb
 * Used to detect when Flywheel has updated entities and we need to refresh
 */
let lastLoadedAt: number = 0;

/**
 * Global co-occurrence index state
 */
let cooccurrenceIndex: CooccurrenceIndex | null = null;

/**
 * Global recency index state
 */
let recencyIndex: RecencyIndex | null = null;

export function getScopedEntityIndex(): EntityIndex | null {
  return getActiveScopeOrNull()?.writeEntityIndex ?? entityIndex;
}

function setScopedEntityIndex(value: EntityIndex | null): void {
  const scope = getActiveScopeOrNull();
  if (scope) {
    scope.writeEntityIndex = value;
  } else {
    entityIndex = value;
  }
}

function isScopedEntityIndexReady(): boolean {
  return getActiveScopeOrNull()?.writeEntityIndexReady ?? indexReady;
}

function setScopedEntityIndexReady(value: boolean): void {
  const scope = getActiveScopeOrNull();
  if (scope) {
    scope.writeEntityIndexReady = value;
  } else {
    indexReady = value;
  }
}

function getScopedEntityIndexError(): Error | null {
  return getActiveScopeOrNull()?.writeEntityIndexError ?? indexError;
}

function setScopedEntityIndexError(value: Error | null): void {
  const scope = getActiveScopeOrNull();
  if (scope) {
    scope.writeEntityIndexError = value;
  } else {
    indexError = value;
  }
}

function getScopedEntityIndexLastLoadedAt(): number {
  return getActiveScopeOrNull()?.writeEntityIndexLastLoadedAt ?? lastLoadedAt;
}

function setScopedEntityIndexLastLoadedAt(value: number): void {
  const scope = getActiveScopeOrNull();
  if (scope) {
    scope.writeEntityIndexLastLoadedAt = value;
  } else {
    lastLoadedAt = value;
  }
}

export function getScopedRecencyIndex(): RecencyIndex | null {
  return getActiveScopeOrNull()?.writeRecencyIndex ?? recencyIndex;
}

function setScopedRecencyIndex(value: RecencyIndex | null): void {
  const scope = getActiveScopeOrNull();
  if (scope) {
    scope.writeRecencyIndex = value;
  } else {
    recencyIndex = value;
  }
}

/**
 * Folders to exclude from entity scanning
 * Includes periodic notes, working folders, and clippings/external content
 */
const DEFAULT_EXCLUDE_FOLDERS = [
  // Periodic notes
  'daily-notes',
  'daily',
  'weekly',
  'weekly-notes',
  'monthly',
  'monthly-notes',
  'quarterly',
  'yearly-notes',
  'periodic',
  'journal',
  // Working folders
  'inbox',
  'templates',
  'attachments',
  'tmp',
  // Clippings & external content (article titles are not concepts)
  'clippings',
  'readwise',
  'articles',
  'bookmarks',
  'web-clips',
];

/**
 * Initialize entity index in background
 * Called at MCP server startup - returns immediately, builds in background
 *
 * Tries loading from StateDb first, then full rebuild.
 */
export async function initializeEntityIndex(vaultPath: string): Promise<void> {
  try {
    // Try loading from StateDb (fastest path)
    const stateDb = getWriteStateDb();
    if (stateDb) {
      try {
        const dbIndex = getEntityIndexFromDb(stateDb);
        if (dbIndex._metadata.total_entities > 0) {
          setScopedEntityIndex(dbIndex);
          setScopedEntityIndexReady(true);
          setScopedEntityIndexError(null);
          setScopedEntityIndexLastLoadedAt(Date.now());
          console.error(`[Flywheel] Loaded ${dbIndex._metadata.total_entities} entities from StateDb`);
          return;
        }
      } catch (e) {
        console.error('[Flywheel] Failed to load from StateDb:', e);
      }
    }

    // No StateDb or empty - build index
    await rebuildIndex(vaultPath);
  } catch (error) {
    const resolvedError = error instanceof Error ? error : new Error(String(error));
    setScopedEntityIndexError(resolvedError);
    console.error(`[Flywheel] Failed to initialize entity index: ${resolvedError.message}`);
    // Don't throw - wikilinks will just be disabled
  }
}

/**
 * Rebuild index synchronously
 */
async function rebuildIndex(vaultPath: string): Promise<void> {
  console.error(`[Flywheel] Scanning vault for entities...`);
  const startTime = Date.now();

  const scannedEntityIndex = await scanVaultEntities(vaultPath, {
    excludeFolders: DEFAULT_EXCLUDE_FOLDERS,
    customCategories: getConfig()?.custom_categories,
  });
  setScopedEntityIndex(scannedEntityIndex);
  setScopedEntityIndexReady(true);
  setScopedEntityIndexError(null);
  setScopedEntityIndexLastLoadedAt(Date.now());

  const entityDuration = Date.now() - startTime;
  console.error(`[Flywheel] Entity index built: ${scannedEntityIndex._metadata.total_entities} entities in ${entityDuration}ms`);

  // Save to StateDb for fast subsequent loads
  const stateDb = getWriteStateDb();
  if (stateDb) {
    try {
      stateDb.replaceAllEntities(scannedEntityIndex);
      console.error(`[Flywheel] Saved entities to StateDb`);
    } catch (e) {
      console.error(`[Flywheel] Failed to save entities to StateDb: ${e}`);
    }
  }

  // Get entities for secondary indexes
  const entities = getAllEntities(scannedEntityIndex);
  const entityNames = entities.map(e => typeof e === 'string' ? e : getEntityName(e));

  // Mine co-occurrences for conceptual suggestions
  try {
    const cooccurrenceStart = Date.now();
    cooccurrenceIndex = await mineCooccurrences(vaultPath, entityNames);
    const cooccurrenceDuration = Date.now() - cooccurrenceStart;
    console.error(`[Flywheel] Co-occurrence index built: ${cooccurrenceIndex._metadata.total_associations} associations in ${cooccurrenceDuration}ms`);
  } catch (e) {
    console.error(`[Flywheel] Failed to build co-occurrence index: ${e}`);
  }

  // Build recency index for temporal suggestions
  try {
    // Try loading from StateDb first
    const cachedRecency = loadRecencyFromStateDb();
    const cacheAgeMs = cachedRecency ? Date.now() - cachedRecency.lastUpdated : Infinity;

    if (cachedRecency && cacheAgeMs < 60 * 60 * 1000) {
      // Cache is valid and less than 1 hour old
      setScopedRecencyIndex(cachedRecency);
      console.error(`[Flywheel] Recency index loaded from StateDb (${cachedRecency.lastMentioned.size} entities)`);
    } else {
      // Build fresh recency index
      const recencyStart = Date.now();
      const rebuiltRecencyIndex = await buildRecencyIndex(vaultPath, entities);
      setScopedRecencyIndex(rebuiltRecencyIndex);
      const recencyDuration = Date.now() - recencyStart;
      console.error(`[Flywheel] Recency index built: ${rebuiltRecencyIndex.lastMentioned.size} entities in ${recencyDuration}ms`);

      // Save to StateDb
      saveRecencyToStateDb(rebuiltRecencyIndex);
    }
  } catch (e) {
    console.error(`[Flywheel] Failed to build recency index: ${e}`);
  }
}

/**
 * Check if entity index is ready
 */
export function isEntityIndexReady(): boolean {
  return isScopedEntityIndexReady() && getScopedEntityIndex() !== null;
}

/**
 * Get the entity index (may be null if not ready)
 */
export function getEntityIndex(): EntityIndex | null {
  return getScopedEntityIndex();
}

/**
 * Check if Flywheel has updated StateDb since we loaded, and refresh if so.
 *
 * This enables Flywheel Memoryto detect when Flywheel's file watcher has reindexed
 * the vault (adding new entities) without requiring Flywheel Memoryrestart.
 *
 * Called before applying wikilinks to ensure fresh entity data.
 */
export function checkAndRefreshIfStale(): void {
  const stateDb = getWriteStateDb();
  if (!stateDb || !isScopedEntityIndexReady()) return;

  try {
    const metadata = getStateDbMetadata(stateDb);
    if (!metadata.entitiesBuiltAt) return;

    const dbBuiltAt = new Date(metadata.entitiesBuiltAt).getTime();

    // If StateDb was updated after we loaded, refresh
    if (dbBuiltAt > getScopedEntityIndexLastLoadedAt()) {
      console.error('[Flywheel] Entity index stale, reloading from StateDb...');
      const dbIndex = getEntityIndexFromDb(stateDb);
      if (dbIndex._metadata.total_entities > 0) {
        setScopedEntityIndex(dbIndex);
        setScopedEntityIndexReady(true);
        setScopedEntityIndexError(null);
        setScopedEntityIndexLastLoadedAt(Date.now());
        console.error(`[Flywheel] Reloaded ${dbIndex._metadata.total_entities} entities`);
      }
    }

    // Always refresh recency from StateDb (watcher updates it independently of entities)
    const freshRecency = loadRecencyFromStateDb();
    if (freshRecency && freshRecency.lastUpdated > (getScopedRecencyIndex()?.lastUpdated ?? 0)) {
      setScopedRecencyIndex(freshRecency);
      console.error(`[Flywheel] Refreshed recency index (${freshRecency.lastMentioned.size} entities)`);
    }
  } catch (e) {
    // StateDb might be locked or corrupted - skip refresh silently
    // Flywheel Memorywill continue using its cached version
    console.error('[Flywheel] Failed to check for stale entities:', e);
  }
}

/**
 * Get entity index statistics (for debugging/status)
 */
export function getEntityIndexStats(): {
  ready: boolean;
  totalEntities: number;
  categories: Record<string, number>;
  error?: string;
} {
  const scopedEntityIndex = getScopedEntityIndex();
  if (!isScopedEntityIndexReady() || !scopedEntityIndex) {
    return {
      ready: false,
      totalEntities: 0,
      categories: {},
      error: getScopedEntityIndexError()?.message,
    };
  }

  return {
    ready: true,
    totalEntities: scopedEntityIndex._metadata.total_entities,
    categories: {
      technologies: scopedEntityIndex.technologies.length,
      acronyms: scopedEntityIndex.acronyms.length,
      people: scopedEntityIndex.people.length,
      projects: scopedEntityIndex.projects.length,
      organizations: scopedEntityIndex.organizations?.length ?? 0,
      locations: scopedEntityIndex.locations?.length ?? 0,
      concepts: scopedEntityIndex.concepts?.length ?? 0,
      animals: scopedEntityIndex.animals?.length ?? 0,
      media: scopedEntityIndex.media?.length ?? 0,
      events: scopedEntityIndex.events?.length ?? 0,
      documents: scopedEntityIndex.documents?.length ?? 0,
      vehicles: scopedEntityIndex.vehicles?.length ?? 0,
      health: scopedEntityIndex.health?.length ?? 0,
      finance: scopedEntityIndex.finance?.length ?? 0,
      food: scopedEntityIndex.food?.length ?? 0,
      hobbies: scopedEntityIndex.hobbies?.length ?? 0,
      other: scopedEntityIndex.other.length,
    },
  };
}
