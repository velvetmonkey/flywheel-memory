/**
 * Shared SQLite State Management
 *
 * Consolidates scattered JSON files and in-memory state into a single
 * SQLite database with FTS5 for entity search.
 *
 * Target performance:
 * - Startup <100ms for 10k note vault
 * - Entity search <10ms
 * - Single .flywheel/state.db for backup
 */

import Database from 'better-sqlite3';
import type { Statement, Transaction } from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import type { EntityCategory, EntityWithAliases, EntityIndex } from './types.js';

// =============================================================================
// Types
// =============================================================================

/** Search result from FTS5 entity search */
export interface EntitySearchResult {
  id: number;
  name: string;
  nameLower: string;
  path: string;
  category: EntityCategory;
  aliases: string[];
  hubScore: number;
  rank: number;
}

/** Recency tracking for entities */
export interface RecencyRow {
  entityNameLower: string;
  lastMentionedAt: number;
  mentionCount: number;
}

/** Database state metadata */
export interface StateDbMetadata {
  schemaVersion: number;
  entitiesBuiltAt: string | null;
  entityCount: number;
  notesBuiltAt: string | null;
  noteCount: number;
}

/** State database instance with prepared statements */
export interface StateDb {
  db: Database.Database;
  vaultPath: string;
  dbPath: string;

  // Entity operations
  insertEntity: Statement;
  updateEntity: Statement;
  deleteEntity: Statement;
  getEntityByName: Statement;
  getEntityById: Statement;
  getAllEntities: Statement;
  getEntitiesByCategory: Statement;
  searchEntitiesFts: Statement;
  clearEntities: Statement;

  // Entity alias lookup
  getEntitiesByAlias: Statement;

  // Recency operations
  upsertRecency: Statement;
  getRecency: Statement;
  getAllRecency: Statement;
  clearRecency: Statement;

  // Write state operations
  setWriteState: Statement;
  getWriteState: Statement;
  deleteWriteState: Statement;

  // Flywheel config operations
  setFlywheelConfigStmt: Statement;
  getFlywheelConfigStmt: Statement;
  getAllFlywheelConfigStmt: Statement;
  deleteFlywheelConfigStmt: Statement;

  // Metadata
  getMetadataValue: Statement;
  setMetadataValue: Statement;

  // Transactions
  bulkInsertEntities: Transaction<(entities: EntityWithAliases[], category: EntityCategory) => number>;
  replaceAllEntities: Transaction<(index: EntityIndex) => number>;

  // Cleanup
  close: () => void;
}

// =============================================================================
// Constants
// =============================================================================

/** Current schema version - bump when schema changes */
export const SCHEMA_VERSION = 3;

/** State database filename */
export const STATE_DB_FILENAME = 'state.db';

/** Directory for flywheel state */
export const FLYWHEEL_DIR = '.flywheel';

// =============================================================================
// Schema
// =============================================================================

const SCHEMA_SQL = `
-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT DEFAULT (datetime('now'))
);

-- Metadata key-value store
CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Entity index (replaces wikilink-entities.json)
CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  name_lower TEXT NOT NULL,
  path TEXT NOT NULL,
  category TEXT NOT NULL,
  aliases_json TEXT,
  hub_score INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_entities_name_lower ON entities(name_lower);
CREATE INDEX IF NOT EXISTS idx_entities_category ON entities(category);

-- FTS5 for entity search with porter stemmer
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
  name, aliases, category,
  content='entities', content_rowid='id',
  tokenize='porter unicode61'
);

-- Auto-sync triggers for entities_fts
CREATE TRIGGER IF NOT EXISTS entities_ai AFTER INSERT ON entities BEGIN
  INSERT INTO entities_fts(rowid, name, aliases, category)
  VALUES (
    new.id,
    new.name,
    COALESCE((SELECT group_concat(value, ' ') FROM json_each(new.aliases_json)), ''),
    new.category
  );
END;

CREATE TRIGGER IF NOT EXISTS entities_ad AFTER DELETE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name, aliases, category)
  VALUES (
    'delete',
    old.id,
    old.name,
    COALESCE((SELECT group_concat(value, ' ') FROM json_each(old.aliases_json)), ''),
    old.category
  );
END;

CREATE TRIGGER IF NOT EXISTS entities_au AFTER UPDATE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name, aliases, category)
  VALUES (
    'delete',
    old.id,
    old.name,
    COALESCE((SELECT group_concat(value, ' ') FROM json_each(old.aliases_json)), ''),
    old.category
  );
  INSERT INTO entities_fts(rowid, name, aliases, category)
  VALUES (
    new.id,
    new.name,
    COALESCE((SELECT group_concat(value, ' ') FROM json_each(new.aliases_json)), ''),
    new.category
  );
END;

-- Recency tracking (replaces entity-recency.json)
CREATE TABLE IF NOT EXISTS recency (
  entity_name_lower TEXT PRIMARY KEY,
  last_mentioned_at INTEGER NOT NULL,
  mention_count INTEGER DEFAULT 1
);

-- Write state (replaces last-commit.json and other write state)
CREATE TABLE IF NOT EXISTS write_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Content search FTS5 (migrated from vault-search.db)
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  path, title, content,
  tokenize='porter'
);

-- FTS5 build metadata (consolidated from vault-search.db)
CREATE TABLE IF NOT EXISTS fts_metadata (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Vault index cache (for fast startup)
-- Stores serialized VaultIndex to avoid full rebuild on startup
CREATE TABLE IF NOT EXISTS vault_index_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data BLOB NOT NULL,
  built_at INTEGER NOT NULL,
  note_count INTEGER NOT NULL,
  version INTEGER DEFAULT 1
);

-- Flywheel configuration (replaces .flywheel.json)
CREATE TABLE IF NOT EXISTS flywheel_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
`;

// =============================================================================
// Database Initialization
// =============================================================================

/**
 * Get the database path for a vault
 */
export function getStateDbPath(vaultPath: string): string {
  const flywheelDir = path.join(vaultPath, FLYWHEEL_DIR);
  if (!fs.existsSync(flywheelDir)) {
    fs.mkdirSync(flywheelDir, { recursive: true });
  }
  return path.join(flywheelDir, STATE_DB_FILENAME);
}

/**
 * Initialize schema and run migrations
 */
function initSchema(db: Database.Database): void {
  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Run schema creation
  db.exec(SCHEMA_SQL);

  // Guard: Verify critical tables were created
  // This catches cases where schema execution silently failed (e.g., corrupted db)
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name IN ('entities', 'schema_version', 'metadata')
  `).all() as Array<{ name: string }>;

  if (tables.length < 3) {
    const foundTables = tables.map(t => t.name).join(', ') || 'none';
    throw new Error(
      `[vault-core] Schema validation failed: expected 3 critical tables, found ${tables.length} (${foundTables}). ` +
      `Database may be corrupted. Delete ${db.name} and restart.`
    );
  }

  // Check and record schema version
  const versionRow = db.prepare(
    'SELECT MAX(version) as version FROM schema_version'
  ).get() as { version: number | null } | undefined;

  const currentVersion = versionRow?.version ?? 0;

  if (currentVersion < SCHEMA_VERSION) {
    // v2: Drop dead notes/links tables if they exist from v1
    if (currentVersion < 2) {
      db.exec('DROP TABLE IF EXISTS notes');
      db.exec('DROP TABLE IF EXISTS links');
    }

    // v3: Rename crank_state → write_state
    if (currentVersion < 3) {
      const hasCrankState = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='crank_state'`
      ).get();
      if (hasCrankState) {
        db.exec('ALTER TABLE crank_state RENAME TO write_state');
      }
    }

    db.prepare(
      'INSERT OR IGNORE INTO schema_version (version) VALUES (?)'
    ).run(SCHEMA_VERSION);
  }
}

/**
 * Open or create the state database for a vault
 *
 * @param vaultPath - Absolute path to the vault root
 * @returns StateDb instance with prepared statements
 */
export function openStateDb(vaultPath: string): StateDb {
  const dbPath = getStateDbPath(vaultPath);

  // Guard: Delete corrupted 0-byte database files
  // This can happen when better-sqlite3 fails to compile (e.g., Node 24)
  // and creates an empty file instead of a valid SQLite database
  if (fs.existsSync(dbPath)) {
    const stat = fs.statSync(dbPath);
    if (stat.size === 0) {
      console.error(`[vault-core] Deleting corrupted 0-byte state.db at ${dbPath}`);
      fs.unlinkSync(dbPath);
      // Also remove WAL and SHM files if they exist
      const walPath = dbPath + '-wal';
      const shmPath = dbPath + '-shm';
      if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
      if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
    }
  }

  const db = new Database(dbPath);

  // Initialize schema
  initSchema(db);

  // Prepare all statements
  const stateDb: StateDb = {
    db,
    vaultPath,
    dbPath,

    // Entity operations
    insertEntity: db.prepare(`
      INSERT INTO entities (name, name_lower, path, category, aliases_json, hub_score)
      VALUES (?, ?, ?, ?, ?, ?)
    `),

    updateEntity: db.prepare(`
      UPDATE entities
      SET name = ?, name_lower = ?, path = ?, category = ?, aliases_json = ?, hub_score = ?
      WHERE id = ?
    `),

    deleteEntity: db.prepare('DELETE FROM entities WHERE id = ?'),

    getEntityByName: db.prepare(`
      SELECT id, name, name_lower, path, category, aliases_json, hub_score
      FROM entities WHERE name_lower = ?
    `),

    getEntityById: db.prepare(`
      SELECT id, name, name_lower, path, category, aliases_json, hub_score
      FROM entities WHERE id = ?
    `),

    getAllEntities: db.prepare(`
      SELECT id, name, name_lower, path, category, aliases_json, hub_score
      FROM entities ORDER BY name
    `),

    getEntitiesByCategory: db.prepare(`
      SELECT id, name, name_lower, path, category, aliases_json, hub_score
      FROM entities WHERE category = ? ORDER BY name
    `),

    searchEntitiesFts: db.prepare(`
      SELECT e.id, e.name, e.name_lower, e.path, e.category, e.aliases_json, e.hub_score,
             bm25(entities_fts) as rank
      FROM entities_fts
      JOIN entities e ON e.id = entities_fts.rowid
      WHERE entities_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `),

    clearEntities: db.prepare('DELETE FROM entities'),

    // Entity alias lookup
    getEntitiesByAlias: db.prepare(`
      SELECT e.id, e.name, e.name_lower, e.path, e.category, e.aliases_json, e.hub_score
      FROM entities e
      WHERE EXISTS (SELECT 1 FROM json_each(e.aliases_json) WHERE LOWER(value) = ?)
    `),

    // Recency operations
    upsertRecency: db.prepare(`
      INSERT INTO recency (entity_name_lower, last_mentioned_at, mention_count)
      VALUES (?, ?, 1)
      ON CONFLICT(entity_name_lower) DO UPDATE SET
        last_mentioned_at = excluded.last_mentioned_at,
        mention_count = mention_count + 1
    `),

    getRecency: db.prepare(`
      SELECT entity_name_lower, last_mentioned_at, mention_count
      FROM recency WHERE entity_name_lower = ?
    `),

    getAllRecency: db.prepare(`
      SELECT entity_name_lower, last_mentioned_at, mention_count
      FROM recency ORDER BY last_mentioned_at DESC
    `),

    clearRecency: db.prepare('DELETE FROM recency'),

    // Write state operations
    setWriteState: db.prepare(`
      INSERT INTO write_state (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now')
    `),

    getWriteState: db.prepare('SELECT value FROM write_state WHERE key = ?'),

    deleteWriteState: db.prepare('DELETE FROM write_state WHERE key = ?'),

    // Flywheel config operations
    setFlywheelConfigStmt: db.prepare(`
      INSERT INTO flywheel_config (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now')
    `),

    getFlywheelConfigStmt: db.prepare('SELECT value FROM flywheel_config WHERE key = ?'),

    getAllFlywheelConfigStmt: db.prepare('SELECT key, value FROM flywheel_config'),

    deleteFlywheelConfigStmt: db.prepare('DELETE FROM flywheel_config WHERE key = ?'),

    // Metadata operations
    getMetadataValue: db.prepare('SELECT value FROM metadata WHERE key = ?'),

    setMetadataValue: db.prepare(`
      INSERT INTO metadata (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now')
    `),

    // Transactions
    bulkInsertEntities: db.transaction((entities: EntityWithAliases[], category: EntityCategory) => {
      let count = 0;
      for (const entity of entities) {
        stateDb.insertEntity.run(
          entity.name,
          entity.name.toLowerCase(),
          entity.path,
          category,
          JSON.stringify(entity.aliases),
          entity.hubScore ?? 0
        );
        count++;
      }
      return count;
    }),

    replaceAllEntities: db.transaction((index: EntityIndex) => {
      // Clear existing entities
      stateDb.clearEntities.run();

      // Insert all entities by category
      const categories: EntityCategory[] = [
        'technologies', 'acronyms', 'people', 'projects',
        'organizations', 'locations', 'concepts', 'other'
      ];

      let total = 0;
      for (const category of categories) {
        const entities = index[category];
        if (!entities?.length) continue;

        for (const entity of entities) {
          // Handle both string and EntityWithAliases formats
          const entityObj = typeof entity === 'string'
            ? { name: entity, path: '', aliases: [], hubScore: 0 }
            : entity;

          stateDb.insertEntity.run(
            entityObj.name,
            entityObj.name.toLowerCase(),
            entityObj.path,
            category,
            JSON.stringify(entityObj.aliases),
            entityObj.hubScore ?? 0
          );
          total++;
        }
      }

      // Update metadata
      stateDb.setMetadataValue.run('entities_built_at', new Date().toISOString());
      stateDb.setMetadataValue.run('entity_count', String(total));

      return total;
    }),

    close: () => {
      db.close();
    },
  };

  return stateDb;
}

// =============================================================================
// Entity Operations
// =============================================================================

/**
 * Search entities using FTS5 with porter stemming
 *
 * @param stateDb - State database instance
 * @param query - Search query (supports FTS5 syntax)
 * @param limit - Maximum results to return
 * @returns Array of matching entities with relevance scores
 */
export function searchEntities(
  stateDb: StateDb,
  query: string,
  limit: number = 20
): EntitySearchResult[] {
  const escapedQuery = escapeFts5Query(query);

  // Handle empty query - return empty results
  if (!escapedQuery) {
    return [];
  }

  const rows = stateDb.searchEntitiesFts.all(escapedQuery, limit) as Array<{
    id: number;
    name: string;
    name_lower: string;
    path: string;
    category: string;
    aliases_json: string | null;
    hub_score: number;
    rank: number;
  }>;

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    nameLower: row.name_lower,
    path: row.path,
    category: row.category as EntityCategory,
    aliases: row.aliases_json ? JSON.parse(row.aliases_json) : [],
    hubScore: row.hub_score,
    rank: row.rank,
  }));
}

/**
 * Search entities by prefix for autocomplete
 *
 * @param stateDb - State database instance
 * @param prefix - Prefix to search for
 * @param limit - Maximum results to return
 */
export function searchEntitiesPrefix(
  stateDb: StateDb,
  prefix: string,
  limit: number = 20
): EntitySearchResult[] {
  return searchEntities(stateDb, `${escapeFts5Query(prefix)}*`, limit);
}

/**
 * Get entity by exact name (case-insensitive)
 */
export function getEntityByName(
  stateDb: StateDb,
  name: string
): EntitySearchResult | null {
  const row = stateDb.getEntityByName.get(name.toLowerCase()) as {
    id: number;
    name: string;
    name_lower: string;
    path: string;
    category: string;
    aliases_json: string | null;
    hub_score: number;
  } | undefined;

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    nameLower: row.name_lower,
    path: row.path,
    category: row.category as EntityCategory,
    aliases: row.aliases_json ? JSON.parse(row.aliases_json) : [],
    hubScore: row.hub_score,
    rank: 0,
  };
}

/**
 * Get all entities from the database
 */
export function getAllEntitiesFromDb(stateDb: StateDb): EntitySearchResult[] {
  const rows = stateDb.getAllEntities.all() as Array<{
    id: number;
    name: string;
    name_lower: string;
    path: string;
    category: string;
    aliases_json: string | null;
    hub_score: number;
  }>;

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    nameLower: row.name_lower,
    path: row.path,
    category: row.category as EntityCategory,
    aliases: row.aliases_json ? JSON.parse(row.aliases_json) : [],
    hubScore: row.hub_score,
    rank: 0,
  }));
}

/**
 * Convert database entities back to EntityIndex format
 */
export function getEntityIndexFromDb(stateDb: StateDb): EntityIndex {
  const entities = getAllEntitiesFromDb(stateDb);

  const index: EntityIndex = {
    technologies: [],
    acronyms: [],
    people: [],
    projects: [],
    organizations: [],
    locations: [],
    concepts: [],
    other: [],
    _metadata: {
      total_entities: entities.length,
      generated_at: new Date().toISOString(),
      vault_path: stateDb.vaultPath,
      source: 'vault-core sqlite',
    },
  };

  for (const entity of entities) {
    const entityObj: EntityWithAliases = {
      name: entity.name,
      path: entity.path,
      aliases: entity.aliases,
      hubScore: entity.hubScore,
    };
    index[entity.category].push(entityObj);
  }

  return index;
}

/**
 * Get entities that have a given alias (case-insensitive)
 *
 * @param stateDb - State database instance
 * @param alias - Alias to search for (case-insensitive)
 * @returns Array of matching entities
 */
export function getEntitiesByAlias(
  stateDb: StateDb,
  alias: string
): EntitySearchResult[] {
  const rows = stateDb.getEntitiesByAlias.all(alias.toLowerCase()) as Array<{
    id: number;
    name: string;
    name_lower: string;
    path: string;
    category: string;
    aliases_json: string | null;
    hub_score: number;
  }>;

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    nameLower: row.name_lower,
    path: row.path,
    category: row.category as EntityCategory,
    aliases: row.aliases_json ? JSON.parse(row.aliases_json) : [],
    hubScore: row.hub_score,
    rank: 0,
  }));
}

// =============================================================================
// Recency Operations
// =============================================================================

/**
 * Record a mention of an entity
 */
export function recordEntityMention(
  stateDb: StateDb,
  entityName: string,
  mentionedAt: Date = new Date()
): void {
  stateDb.upsertRecency.run(
    entityName.toLowerCase(),
    mentionedAt.getTime()
  );
}

/**
 * Get recency info for an entity
 */
export function getEntityRecency(
  stateDb: StateDb,
  entityName: string
): RecencyRow | null {
  const row = stateDb.getRecency.get(entityName.toLowerCase()) as {
    entity_name_lower: string;
    last_mentioned_at: number;
    mention_count: number;
  } | undefined;

  if (!row) return null;

  return {
    entityNameLower: row.entity_name_lower,
    lastMentionedAt: row.last_mentioned_at,
    mentionCount: row.mention_count,
  };
}

/**
 * Get all recency data ordered by most recent
 */
export function getAllRecency(stateDb: StateDb): RecencyRow[] {
  const rows = stateDb.getAllRecency.all() as Array<{
    entity_name_lower: string;
    last_mentioned_at: number;
    mention_count: number;
  }>;

  return rows.map(row => ({
    entityNameLower: row.entity_name_lower,
    lastMentionedAt: row.last_mentioned_at,
    mentionCount: row.mention_count,
  }));
}

// =============================================================================
// Write State Operations
// =============================================================================

/**
 * Set a write state value
 */
export function setWriteState(
  stateDb: StateDb,
  key: string,
  value: unknown
): void {
  stateDb.setWriteState.run(key, JSON.stringify(value));
}

/**
 * Get a write state value
 */
export function getWriteState<T>(stateDb: StateDb, key: string): T | null {
  const row = stateDb.getWriteState.get(key) as { value: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.value) as T;
}

/**
 * Delete a write state key
 */
export function deleteWriteState(stateDb: StateDb, key: string): void {
  stateDb.deleteWriteState.run(key);
}

// =============================================================================
// Flywheel Config Operations
// =============================================================================

/** Flywheel config row from database */
export interface FlywheelConfigRow {
  key: string;
  value: string;
}

/**
 * Set a flywheel config value
 */
export function setFlywheelConfig(
  stateDb: StateDb,
  key: string,
  value: unknown
): void {
  stateDb.setFlywheelConfigStmt.run(key, JSON.stringify(value));
}

/**
 * Get a flywheel config value
 */
export function getFlywheelConfig<T>(stateDb: StateDb, key: string): T | null {
  const row = stateDb.getFlywheelConfigStmt.get(key) as { value: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.value) as T;
}

/**
 * Get all flywheel config values as an object
 */
export function getAllFlywheelConfig(stateDb: StateDb): Record<string, unknown> {
  const rows = stateDb.getAllFlywheelConfigStmt.all() as FlywheelConfigRow[];
  const config: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      config[row.key] = JSON.parse(row.value);
    } catch {
      config[row.key] = row.value;
    }
  }
  return config;
}

/**
 * Delete a flywheel config key
 */
export function deleteFlywheelConfig(stateDb: StateDb, key: string): void {
  stateDb.deleteFlywheelConfigStmt.run(key);
}

/**
 * Save entire Flywheel config object to database
 * Stores each top-level key as a separate row
 */
export function saveFlywheelConfigToDb(
  stateDb: StateDb,
  config: Record<string, unknown>
): void {
  const transaction = stateDb.db.transaction(() => {
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined) {
        setFlywheelConfig(stateDb, key, value);
      }
    }
  });
  transaction();
}

/**
 * Load Flywheel config from database and reconstruct as typed object
 */
export function loadFlywheelConfigFromDb(stateDb: StateDb): Record<string, unknown> | null {
  const config = getAllFlywheelConfig(stateDb);
  if (Object.keys(config).length === 0) {
    return null;
  }
  return config;
}

// =============================================================================
// Metadata Operations
// =============================================================================

/**
 * Get database metadata
 */
export function getStateDbMetadata(stateDb: StateDb): StateDbMetadata {
  const schemaRow = stateDb.db.prepare(
    'SELECT MAX(version) as version FROM schema_version'
  ).get() as { version: number } | undefined;

  const entitiesBuiltRow = stateDb.getMetadataValue.get('entities_built_at') as { value: string } | undefined;
  const entityCountRow = stateDb.getMetadataValue.get('entity_count') as { value: string } | undefined;
  const notesBuiltRow = stateDb.getMetadataValue.get('notes_built_at') as { value: string } | undefined;
  const noteCountRow = stateDb.getMetadataValue.get('note_count') as { value: string } | undefined;

  return {
    schemaVersion: schemaRow?.version ?? 0,
    entitiesBuiltAt: entitiesBuiltRow?.value ?? null,
    entityCount: entityCountRow ? parseInt(entityCountRow.value, 10) : 0,
    notesBuiltAt: notesBuiltRow?.value ?? null,
    noteCount: noteCountRow ? parseInt(noteCountRow.value, 10) : 0,
  };
}

/**
 * Check if entity data is stale (older than threshold)
 */
export function isEntityDataStale(
  stateDb: StateDb,
  thresholdMs: number = 60 * 60 * 1000 // 1 hour default
): boolean {
  const metadata = getStateDbMetadata(stateDb);

  if (!metadata.entitiesBuiltAt) {
    return true;
  }

  const builtAt = new Date(metadata.entitiesBuiltAt).getTime();
  const age = Date.now() - builtAt;
  return age > thresholdMs;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Escape special FTS5 characters in a query
 */
export function escapeFts5Query(query: string): string {
  // Handle empty query
  if (!query || !query.trim()) {
    return '';
  }

  // Remove or escape FTS5 special characters
  // Keep * for prefix matching, escape others
  return query
    .replace(/"/g, '""')  // Escape quotes
    .replace(/[(){}[\]^~:-]/g, ' ')  // Remove special operators including hyphen
    .replace(/\s+/g, ' ')  // Normalize whitespace
    .trim();
}

/**
 * Check if the state database exists for a vault
 */
export function stateDbExists(vaultPath: string): boolean {
  const dbPath = getStateDbPath(vaultPath);
  return fs.existsSync(dbPath);
}

/**
 * Delete the state database (for testing or reset)
 */
export function deleteStateDb(vaultPath: string): void {
  const dbPath = getStateDbPath(vaultPath);
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
  // Also remove WAL and SHM files if they exist
  const walPath = dbPath + '-wal';
  const shmPath = dbPath + '-shm';
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
}

// =============================================================================
// Vault Index Cache Operations
// =============================================================================

/** Serializable VaultIndex for caching */
export interface VaultIndexCacheData {
  notes: Array<{
    path: string;
    title: string;
    aliases: string[];
    frontmatter: Record<string, unknown>;
    outlinks: Array<{ target: string; alias?: string; line: number }>;
    tags: string[];
    modified: number;
    created?: number;
  }>;
  backlinks: Array<[string, Array<{ source: string; line: number; context?: string }>]>;
  entities: Array<[string, string]>;
  tags: Array<[string, string[]]>;
  builtAt: number;
}

/** Cache metadata */
export interface VaultIndexCacheInfo {
  builtAt: Date;
  noteCount: number;
  version: number;
}

/**
 * Save VaultIndex to cache
 *
 * @param stateDb - State database instance
 * @param indexData - Serialized VaultIndex data
 */
export function saveVaultIndexCache(
  stateDb: StateDb,
  indexData: VaultIndexCacheData
): void {
  const data = JSON.stringify(indexData);
  const stmt = stateDb.db.prepare(`
    INSERT OR REPLACE INTO vault_index_cache (id, data, built_at, note_count, version)
    VALUES (1, ?, ?, ?, 1)
  `);
  stmt.run(data, indexData.builtAt, indexData.notes.length);
}

/**
 * Load VaultIndex from cache
 *
 * @param stateDb - State database instance
 * @returns Cached VaultIndex data or null if not found
 */
export function loadVaultIndexCache(
  stateDb: StateDb
): VaultIndexCacheData | null {
  const stmt = stateDb.db.prepare(`
    SELECT data, built_at, note_count FROM vault_index_cache WHERE id = 1
  `);
  const row = stmt.get() as { data: string; built_at: number; note_count: number } | undefined;

  if (!row) return null;

  try {
    return JSON.parse(row.data) as VaultIndexCacheData;
  } catch {
    return null;
  }
}

/**
 * Get cache metadata without loading full data
 */
export function getVaultIndexCacheInfo(stateDb: StateDb): VaultIndexCacheInfo | null {
  const stmt = stateDb.db.prepare(`
    SELECT built_at, note_count, version FROM vault_index_cache WHERE id = 1
  `);
  const row = stmt.get() as { built_at: number; note_count: number; version: number } | undefined;

  if (!row) return null;

  return {
    builtAt: new Date(row.built_at),
    noteCount: row.note_count,
    version: row.version,
  };
}

/**
 * Clear the vault index cache
 */
export function clearVaultIndexCache(stateDb: StateDb): void {
  stateDb.db.prepare('DELETE FROM vault_index_cache').run();
}

/**
 * Check if cache is valid (not too old and note count matches)
 *
 * @param stateDb - State database instance
 * @param actualNoteCount - Current number of notes in vault
 * @param maxAgeMs - Maximum cache age in milliseconds (default 24 hours)
 */
export function isVaultIndexCacheValid(
  stateDb: StateDb,
  actualNoteCount: number,
  maxAgeMs: number = 24 * 60 * 60 * 1000
): boolean {
  const info = getVaultIndexCacheInfo(stateDb);
  if (!info) return false;

  // Check note count matches (quick validation)
  if (info.noteCount !== actualNoteCount) return false;

  // Check age
  const age = Date.now() - info.builtAt.getTime();
  if (age > maxAgeMs) return false;

  return true;
}

