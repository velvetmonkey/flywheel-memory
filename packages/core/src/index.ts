/**
 * @velvetmonkey/vault-core
 *
 * Shared vault utilities for the Flywheel ecosystem.
 * Used by both Flywheel (read) and Flywheel Memory (write).
 */

// Types
export type {
  EntityIndex,
  EntityCategory,
  EntityWithAliases,
  Entity,
  EntityWithType,
  ScanOptions,
  WikilinkOptions,
  WikilinkResult,
  ImplicitEntityConfig,
  ExtendedWikilinkOptions,
  ImplicitEntityMatch,
  ResolveAliasOptions,
  ProtectedZone,
  ProtectedZoneType,
} from './types.js';

// Entity scanning
export {
  scanVaultEntities,
  getAllEntities,
  getAllEntitiesWithTypes,
  getEntityName,
  getEntityAliases,
  loadEntityCache,
  saveEntityCache,
  ENTITY_CACHE_VERSION,
} from './entities.js';

// Wikilinks
export {
  applyWikilinks,
  processWikilinks,
  resolveAliasWikilinks,
  suggestWikilinks,
} from './wikilinks.js';

// Protected zones
export {
  getProtectedZones,
  isInProtectedZone,
  rangeOverlapsProtectedZone,
} from './protectedZones.js';

// Logging (unified cross-product logging)
export {
  OperationLogger,
  createLoggerFromConfig,
  generateSessionId,
  getSessionId,
  setSessionId,
} from './logging/index.js';

export type {
  OperationLogEntry,
  SessionMetrics,
  AggregatedMetrics,
  LoggingConfig,
  ProductId,
} from './logging/index.js';

// SQLite State Database
export {
  openStateDb,
  deleteStateDb,
  stateDbExists,
  searchEntities,
  searchEntitiesPrefix,
  getEntityByName,
  getEntitiesByAlias,
  getAllEntitiesFromDb,
  getEntityIndexFromDb,
  recordEntityMention,
  getEntityRecency,
  getAllRecency,
  setWriteState,
  getWriteState,
  deleteWriteState,
  // Flywheel Config
  setFlywheelConfig,
  getFlywheelConfig,
  getAllFlywheelConfig,
  saveFlywheelConfigToDb,
  loadFlywheelConfigFromDb,
  getStateDbMetadata,
  // Merge Dismissals
  recordMergeDismissal,
  getDismissedMergePairs,
  // Vault Index Cache
  saveVaultIndexCache,
  loadVaultIndexCache,
  getVaultIndexCacheInfo,
  SCHEMA_VERSION,
  STATE_DB_FILENAME,
  FLYWHEEL_DIR,
} from './sqlite.js';

export type {
  StateDb,
  EntitySearchResult,
  RecencyRow,
  StateDbMetadata,
  VaultIndexCacheData,
  VaultIndexCacheInfo,
  FlywheelConfigRow,
} from './sqlite.js';
