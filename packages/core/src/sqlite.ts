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
import type { EntityCategory, EntityWithAliases, EntityIndex } from './types.js';

// Re-export constants from schema
export { SCHEMA_VERSION, STATE_DB_FILENAME, FLYWHEEL_DIR, SCHEMA_SQL } from './schema.js';

// Re-export migrations
export { getStateDbPath, initSchema, deleteStateDbFiles, backupStateDb, preserveCorruptedDb } from './migrations.js';

// Re-export all query functions
export {
  searchEntities,
  searchEntitiesPrefix,
  getEntityByName,
  getAllEntitiesFromDb,
  getEntityIndexFromDb,
  getEntitiesByAlias,
  recordEntityMention,
  getEntityRecency,
  getAllRecency,
  setWriteState,
  getWriteState,
  deleteWriteState,
  setFlywheelConfig,
  getFlywheelConfig,
  getAllFlywheelConfig,
  deleteFlywheelConfig,
  saveFlywheelConfigToDb,
  loadFlywheelConfigFromDb,
  recordMergeDismissal,
  getDismissedMergePairs,
  getStateDbMetadata,
  isEntityDataStale,
  escapeFts5Query,
  rebuildEntitiesFts,
  stateDbExists,
  deleteStateDb,
  saveVaultIndexCache,
  loadVaultIndexCache,
  getVaultIndexCacheInfo,
  clearVaultIndexCache,
  isVaultIndexCacheValid,
  loadContentHashes,
  saveContentHashBatch,
  renameContentHash,
} from './queries.js';

// Re-export types from queries
export type { FlywheelConfigRow, VaultIndexCacheData, VaultIndexCacheInfo } from './queries.js';

// Import for use in openStateDb
import { getStateDbPath, initSchema, deleteStateDbFiles, backupStateDb, preserveCorruptedDb } from './migrations.js';

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
  description?: string;
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

  // Task cache operations
  insertTask: Statement;
  deleteTasksForPath: Statement;
  clearAllTasks: Statement;
  countTasksByStatus: Statement;

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
// Factory
// =============================================================================

/**
 * Open or create the state database for a vault
 *
 * @param vaultPath - Absolute path to the vault root
 * @returns StateDb instance with prepared statements
 */
export function openStateDb(vaultPath: string): StateDb {
  const dbPath = getStateDbPath(vaultPath);

  // Back up existing database before any mutations
  backupStateDb(dbPath);

  // Guard: Delete corrupted 0-byte database files
  // This can happen when better-sqlite3 fails to compile (e.g., Node 24)
  // and creates an empty file instead of a valid SQLite database
  if (fs.existsSync(dbPath)) {
    const stat = fs.statSync(dbPath);
    if (stat.size === 0) {
      console.error(`[vault-core] Deleting corrupted 0-byte state.db at ${dbPath}`);
      deleteStateDbFiles(dbPath);
    }
  }

  let db: InstanceType<typeof Database>;
  try {
    db = new Database(dbPath);
    initSchema(db);
  } catch (err) {
    // Corrupted database (e.g., "file is not a database") — preserve, delete, and retry once
    if (fs.existsSync(dbPath)) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[vault-core] Corrupted state.db (${msg}) — deleting and recreating`);
      preserveCorruptedDb(dbPath);
      try { db!?.close(); } catch { /* ignore */ }
      deleteStateDbFiles(dbPath);
      db = new Database(dbPath);
      initSchema(db);
    } else {
      throw err;
    }
  }

  // Prepare all statements
  const stateDb: StateDb = {
    db,
    vaultPath,
    dbPath,

    // Entity operations
    insertEntity: db.prepare(`
      INSERT INTO entities (name, name_lower, path, category, aliases_json, hub_score, description)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),

    updateEntity: db.prepare(`
      UPDATE entities
      SET name = ?, name_lower = ?, path = ?, category = ?, aliases_json = ?, hub_score = ?, description = ?
      WHERE id = ?
    `),

    deleteEntity: db.prepare('DELETE FROM entities WHERE id = ?'),

    getEntityByName: db.prepare(`
      SELECT id, name, name_lower, path, category, aliases_json, hub_score, description
      FROM entities WHERE name_lower = ?
    `),

    getEntityById: db.prepare(`
      SELECT id, name, name_lower, path, category, aliases_json, hub_score, description
      FROM entities WHERE id = ?
    `),

    getAllEntities: db.prepare(`
      SELECT id, name, name_lower, path, category, aliases_json, hub_score, description
      FROM entities ORDER BY name
    `),

    getEntitiesByCategory: db.prepare(`
      SELECT id, name, name_lower, path, category, aliases_json, hub_score, description
      FROM entities WHERE category = ? ORDER BY name
    `),

    searchEntitiesFts: db.prepare(`
      SELECT e.id, e.name, e.name_lower, e.path, e.category, e.aliases_json, e.hub_score, e.description,
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
      SELECT e.id, e.name, e.name_lower, e.path, e.category, e.aliases_json, e.hub_score, e.description
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

    // Task cache operations
    insertTask: db.prepare(`
      INSERT OR REPLACE INTO tasks (path, line, text, status, raw, context, tags_json, due_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),

    deleteTasksForPath: db.prepare('DELETE FROM tasks WHERE path = ?'),

    clearAllTasks: db.prepare('DELETE FROM tasks'),

    countTasksByStatus: db.prepare('SELECT status, COUNT(*) as cnt FROM tasks GROUP BY status'),

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
          entity.hubScore ?? 0,
          entity.description ?? null
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
        'organizations', 'locations', 'concepts', 'animals',
        'media', 'events', 'documents', 'vehicles', 'health',
        'finance', 'food', 'hobbies', 'other',
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
            entityObj.hubScore ?? 0,
            entityObj.description ?? null
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
