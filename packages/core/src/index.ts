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
  DefaultEntityCategory,
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

// Type helpers and constants
export {
  DEFAULT_ENTITY_CATEGORIES,
  getIndexCategory,
  ensureIndexCategory,
} from './types.js';

// Common English words (frequency list for alias filtering)
export { COMMON_ENGLISH_WORDS } from './common-words.js';

// Stopwords (canonical set for search tokenization)
export { STOPWORDS_EN, isStopword } from './stopwords.js';

// Porter Stemmer (for morphological entity matching)
export { stem } from './stemmer.js';

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
  detectImplicitEntities,
  findEntityMatches,
  isCommonWordEntity,
  ALWAYS_CAPITALIZED,
  IMPLICIT_EXCLUDE_WORDS,
} from './wikilinks.js';

// Protected zones
export {
  getProtectedZones,
  getProtectedZonesRegex,
  isInProtectedZone,
  mergeOverlappingZones,
  rangeOverlapsProtectedZone,
} from './protectedZones.js';

// AST parsing
export { parseMarkdown } from './parseMarkdown.js';
export { getProtectedZonesFromAst } from './astProtectedZones.js';

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
  rebuildEntitiesFts,
  // Content Hashes
  loadContentHashes,
  saveContentHashBatch,
  renameContentHash,
  // Database file management
  deleteStateDbFiles,
  backupStateDb,
  preserveCorruptedDb,
  // Migrations (exported for tests)
  initSchema,
  migrateV40,
  // Backup & Recovery
  BACKUP_ROTATION_COUNT,
  SALVAGE_TABLES,
  rotateBackupFiles,
  safeBackupAsync,
  checkDbIntegrity,
  salvageFeedbackTables,
  attemptSalvage,
  // Constants
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
