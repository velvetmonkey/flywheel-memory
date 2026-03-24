/**
 * SQLite Schema Migrations
 *
 * Database path resolution, schema initialization, migration logic,
 * and database file management utilities.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { SCHEMA_VERSION, SCHEMA_SQL, STATE_DB_FILENAME, FLYWHEEL_DIR } from './schema.js';

// =============================================================================
// Database Path Resolution
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

// =============================================================================
// Schema Initialization & Migrations
// =============================================================================

/**
 * Initialize schema and run migrations
 */
export function initSchema(db: Database.Database): void {
  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Performance tuning
  db.pragma('synchronous = NORMAL');    // Safe with WAL — fsync only on checkpoint, not every commit
  db.pragma('cache_size = -64000');     // 64 MB page cache (default is ~2 MB)
  db.pragma('temp_store = MEMORY');     // Temp tables/indices in RAM instead of disk

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
      const hasWriteState = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='write_state'`
      ).get();
      if (hasCrankState && !hasWriteState) {
        db.exec('ALTER TABLE crank_state RENAME TO write_state');
      } else if (hasCrankState && hasWriteState) {
        // Both exist (stale db) — drop the old one
        db.exec('DROP TABLE crank_state');
      }
    }

    // v4: vault_metrics, wikilink_feedback, wikilink_suppressions tables
    // (created by SCHEMA_SQL above via CREATE TABLE IF NOT EXISTS)

    // v5: wikilink_applications table (implicit feedback tracking)
    // (created by SCHEMA_SQL above via CREATE TABLE IF NOT EXISTS)

    // v6: index_events table (index activity history)
    // (created by SCHEMA_SQL above via CREATE TABLE IF NOT EXISTS)

    // v7: tool_invocations table (usage analytics)
    // (created by SCHEMA_SQL above via CREATE TABLE IF NOT EXISTS)

    // v8: graph_snapshots table (structural evolution)
    // (created by SCHEMA_SQL above via CREATE TABLE IF NOT EXISTS)

    // v9: note_embeddings table (semantic search)
    // (created by SCHEMA_SQL above via CREATE TABLE IF NOT EXISTS)

    // v10: entity_embeddings table (semantic entity search)
    // (created by SCHEMA_SQL above via CREATE TABLE IF NOT EXISTS)

    // v11: notes_fts gains frontmatter column (4-col: path, title, frontmatter, content)
    // Virtual tables can't ALTER, so drop and recreate
    if (currentVersion < 11) {
      db.exec('DROP TABLE IF EXISTS notes_fts');
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        path, title, frontmatter, content,
        tokenize='porter'
      )`);
      // Clear FTS metadata to force rebuild with new schema
      db.exec(`DELETE FROM fts_metadata WHERE key = 'last_built'`);
    }

    // v12: tasks cache table (created by SCHEMA_SQL above via CREATE TABLE IF NOT EXISTS)

    // v13: merge_dismissals table (created by SCHEMA_SQL above via CREATE TABLE IF NOT EXISTS)

    // v14: Add steps column to index_events (pipeline observability)
    if (currentVersion < 14) {
      const hasSteps = db.prepare(
        `SELECT COUNT(*) as cnt FROM pragma_table_info('index_events') WHERE name = 'steps'`
      ).get() as { cnt: number };
      if (hasSteps.cnt === 0) {
        db.exec('ALTER TABLE index_events ADD COLUMN steps TEXT');
      }
    }

    // v15: suggestion_events table (pipeline observability audit log)
    // (created by SCHEMA_SQL above via CREATE TABLE IF NOT EXISTS)

    // v16: note_links table (forward-link persistence for diff-based feedback)
    // (created by SCHEMA_SQL above via CREATE TABLE IF NOT EXISTS)

    // v17: entity_changes table (entity field change audit log)
    // (created by SCHEMA_SQL above via CREATE TABLE IF NOT EXISTS)

    // v18: note_tags table (tag persistence for diff-based feedback)
    // (created by SCHEMA_SQL above via CREATE TABLE IF NOT EXISTS)

    // v19: note_link_history table (wikilink survival tracking for positive feedback)
    // (created by SCHEMA_SQL above via CREATE TABLE IF NOT EXISTS)

    // v20: note_moves table (records file renames/moves detected by the watcher)
    // (created by SCHEMA_SQL above via CREATE TABLE IF NOT EXISTS)

    // v21: description TEXT column on entities table
    if (currentVersion < 21) {
      const hasDesc = db.prepare(
        `SELECT COUNT(*) as cnt FROM pragma_table_info('entities') WHERE name = 'description'`
      ).get() as { cnt: number };
      if (hasDesc.cnt === 0) {
        db.exec('ALTER TABLE entities ADD COLUMN description TEXT');
      }
    }

    // v22: Edge weight columns on note_links table
    if (currentVersion < 22) {
      const hasWeight = db.prepare(
        `SELECT COUNT(*) as cnt FROM pragma_table_info('note_links') WHERE name = 'weight'`
      ).get() as { cnt: number };
      if (hasWeight.cnt === 0) {
        db.exec('ALTER TABLE note_links ADD COLUMN weight REAL NOT NULL DEFAULT 1.0');
        db.exec('ALTER TABLE note_links ADD COLUMN weight_updated_at INTEGER');
      }
    }

    // v23: Case-insensitive unique index on wikilink_applications
    if (currentVersion < 23) {
      db.exec('DROP INDEX IF EXISTS idx_wl_apps_unique');
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_wl_apps_unique ON wikilink_applications(entity COLLATE NOCASE, note_path)');
    }

    // v24: corrections table (persistent correction records)
    // (created by SCHEMA_SQL above via CREATE TABLE IF NOT EXISTS)

    // v25: confidence column on wikilink_feedback (signal quality weighting)
    if (currentVersion < 25) {
      const hasConfidence = db.prepare(
        `SELECT COUNT(*) as cnt FROM pragma_table_info('wikilink_feedback') WHERE name = 'confidence'`
      ).get() as { cnt: number };
      if (hasConfidence.cnt === 0) {
        db.exec('ALTER TABLE wikilink_feedback ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0');
      }
    }

    // v26: memories table, memories_fts, session_summaries table
    // (created by SCHEMA_SQL above via CREATE TABLE IF NOT EXISTS)

    // v27: cooccurrence_cache table (persist co-occurrence index)
    // (created by SCHEMA_SQL above via CREATE TABLE IF NOT EXISTS)

    // v28: content_hashes table (persist watcher content hashes across restarts)
    // (created by SCHEMA_SQL above via CREATE TABLE IF NOT EXISTS)

    // v29: index on wikilink_feedback(note_path) for temporal analysis queries
    // (created by SCHEMA_SQL above via CREATE INDEX IF NOT EXISTS)

    // v31: proactive_queue table (deferred proactive linking)
    // (created by SCHEMA_SQL above via CREATE TABLE IF NOT EXISTS)

    // v30: token economics columns on tool_invocations
    if (currentVersion < 30) {
      const hasResponseTokens = db.prepare(
        `SELECT COUNT(*) as cnt FROM pragma_table_info('tool_invocations') WHERE name = 'response_tokens'`
      ).get() as { cnt: number };
      if (hasResponseTokens.cnt === 0) {
        db.exec('ALTER TABLE tool_invocations ADD COLUMN response_tokens INTEGER');
        db.exec('ALTER TABLE tool_invocations ADD COLUMN baseline_tokens INTEGER');
      }
    }

    db.prepare(
      'INSERT OR IGNORE INTO schema_version (version) VALUES (?)'
    ).run(SCHEMA_VERSION);
  }
}

// =============================================================================
// Database File Management
// =============================================================================

export function deleteStateDbFiles(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbPath + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

/** Back up state.db before opening (skip if missing or 0 bytes). */
export function backupStateDb(dbPath: string): void {
  try {
    if (!fs.existsSync(dbPath)) return;
    const stat = fs.statSync(dbPath);
    if (stat.size === 0) return;
    fs.copyFileSync(dbPath, dbPath + '.backup');
  } catch (err) {
    console.error(`[vault-core] Failed to back up state.db: ${err instanceof Error ? err.message : err}`);
  }
}

/** Preserve a corrupted database for inspection before deleting. */
export function preserveCorruptedDb(dbPath: string): void {
  try {
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, dbPath + '.corrupt');
      console.error(`[vault-core] Corrupted database preserved at ${dbPath}.corrupt`);
    }
  } catch {
    // Best effort — don't block recovery
  }
}
