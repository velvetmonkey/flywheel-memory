/**
 * SQLite Schema Migrations
 *
 * Database path resolution, schema initialization, migration logic,
 * database file management, backup rotation, integrity checks, and
 * feedback salvage utilities.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { SCHEMA_VERSION, SCHEMA_SQL, STATE_DB_FILENAME, FLYWHEEL_DIR } from './schema.js';

// =============================================================================
// Backup & Recovery Constants
// =============================================================================

export const BACKUP_ROTATION_COUNT = 3;

/** High-value tables whose data should survive a corruption recovery. */
export const SALVAGE_TABLES = [
  'wikilink_feedback',
  'wikilink_applications',
  'suggestion_events',
  'wikilink_suppressions',
  'note_links',
  'note_link_history',
  'memories',
  'session_summaries',
  'corrections',
] as const;

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

    // v32: Drop composite PRIMARY KEY on entity_changes (was causing UNIQUE constraint
    // crashes when two changes hit the same entity+field within one second).
    // Recreate as rowid table — audit log doesn't need dedup.
    if (currentVersion < 32) {
      const hasTable = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='entity_changes'`
      ).get();
      if (hasTable) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS entity_changes_new (
            entity TEXT NOT NULL,
            field TEXT NOT NULL,
            old_value TEXT,
            new_value TEXT,
            changed_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO entity_changes_new SELECT entity, field, old_value, new_value, changed_at FROM entity_changes;
          DROP TABLE entity_changes;
          ALTER TABLE entity_changes_new RENAME TO entity_changes;
        `);
      }
    }

    // v33: performance_benchmarks table (longitudinal tracking)
    if (currentVersion < 33) {
      const hasTable = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='performance_benchmarks'"
      ).get();
      if (!hasTable) {
        db.exec(`
          CREATE TABLE performance_benchmarks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            version TEXT NOT NULL,
            benchmark TEXT NOT NULL,
            mean_ms REAL NOT NULL,
            p50_ms REAL,
            p95_ms REAL,
            iterations INTEGER NOT NULL DEFAULT 1
          );
          CREATE INDEX idx_perf_bench_ts ON performance_benchmarks(timestamp);
          CREATE INDEX idx_perf_bench_name ON performance_benchmarks(benchmark, timestamp);
        `);
      }
      db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(33);
    }

    // v34: Fix entities_fts — switch from content='entities' to contentless
    // The old FTS5 declared content='entities' with column 'aliases', but the entities
    // table has 'aliases_json'. This caused "no such column: T.aliases" on every query.
    // Contentless FTS5 eliminates the column name dependency; triggers handle sync.
    if (currentVersion < 34) {
      // Drop old FTS5 and shadow tables
      db.exec(`DROP TABLE IF EXISTS entities_fts`);
      db.exec(`DROP TABLE IF EXISTS entities_fts_data`);
      db.exec(`DROP TABLE IF EXISTS entities_fts_idx`);
      db.exec(`DROP TABLE IF EXISTS entities_fts_docsize`);
      db.exec(`DROP TABLE IF EXISTS entities_fts_config`);

      // Recreate as contentless
      db.exec(`
        CREATE VIRTUAL TABLE entities_fts USING fts5(
          name, aliases, category,
          content='',
          tokenize='porter unicode61'
        )
      `);

      // Drop and recreate triggers (unchanged logic, now targeting contentless table)
      db.exec(`DROP TRIGGER IF EXISTS entities_ai`);
      db.exec(`DROP TRIGGER IF EXISTS entities_ad`);
      db.exec(`DROP TRIGGER IF EXISTS entities_au`);

      db.exec(`
        CREATE TRIGGER entities_ai AFTER INSERT ON entities BEGIN
          INSERT INTO entities_fts(rowid, name, aliases, category)
          VALUES (
            new.id,
            new.name,
            COALESCE((SELECT group_concat(value, ' ') FROM json_each(new.aliases_json)), ''),
            new.category
          );
        END
      `);
      db.exec(`
        CREATE TRIGGER entities_ad AFTER DELETE ON entities BEGIN
          INSERT INTO entities_fts(entities_fts, rowid, name, aliases, category)
          VALUES (
            'delete',
            old.id,
            old.name,
            COALESCE((SELECT group_concat(value, ' ') FROM json_each(old.aliases_json)), ''),
            old.category
          );
        END
      `);
      db.exec(`
        CREATE TRIGGER entities_au AFTER UPDATE ON entities BEGIN
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
        END
      `);

      // Populate FTS from existing entities
      db.exec(`
        INSERT INTO entities_fts(rowid, name, aliases, category)
        SELECT id, name,
          COALESCE((SELECT group_concat(value, ' ') FROM json_each(aliases_json)), ''),
          category
        FROM entities
      `);

      db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(34);
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

// =============================================================================
// Backup Rotation & Safe Backup
// =============================================================================

/**
 * Rotate existing backup files: .backup → .backup.1 → .backup.2 → .backup.3
 * Drops the oldest if rotation count exceeded. Does NOT create a new backup.
 */
export function rotateBackupFiles(dbPath: string): void {
  try {
    // Shift numbered backups down (3→drop, 2→3, 1→2)
    for (let i = BACKUP_ROTATION_COUNT; i >= 1; i--) {
      const src = i === 1
        ? `${dbPath}.backup`
        : `${dbPath}.backup.${i - 1}`;
      const dst = `${dbPath}.backup.${i}`;
      if (fs.existsSync(src)) {
        if (i === BACKUP_ROTATION_COUNT && fs.existsSync(dst)) {
          fs.unlinkSync(dst);
        }
        fs.renameSync(src, dst);
      }
    }
  } catch (err) {
    console.error(`[vault-core] Failed to rotate backups: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Create a WAL-safe backup using SQLite's backup API.
 * Rotates existing backups first, then writes a new .backup file.
 */
export async function safeBackupAsync(db: Database.Database, dbPath: string): Promise<boolean> {
  try {
    rotateBackupFiles(dbPath);
    const backupPath = `${dbPath}.backup`;
    await db.backup(backupPath);
    console.error(`[vault-core] Safe backup created: ${path.basename(backupPath)}`);
    return true;
  } catch (err) {
    console.error(`[vault-core] Safe backup failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

// =============================================================================
// Integrity Checks
// =============================================================================

/**
 * Run PRAGMA quick_check on the database.
 * Returns { ok: true } or { ok: false, detail: string }.
 */
export function checkDbIntegrity(db: Database.Database): { ok: boolean; detail?: string } {
  try {
    const result = db.pragma('quick_check') as Array<Record<string, string>>;
    const firstValue = result.length > 0 ? Object.values(result[0])[0] : 'no result';
    if (result.length === 1 && firstValue === 'ok') {
      return { ok: true };
    }
    return { ok: false, detail: firstValue ?? 'unknown' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

// =============================================================================
// Feedback Salvage
// =============================================================================

/**
 * Attempt to copy high-value feedback tables from a source DB into the target.
 * Opens source read-only; copies rows with INSERT OR IGNORE.
 * Handles missing tables and column mismatches gracefully.
 */
export function salvageFeedbackTables(
  targetDb: Database.Database,
  sourceDbPath: string,
): Record<string, number> {
  const results: Record<string, number> = {};

  if (!fs.existsSync(sourceDbPath)) return results;

  let sourceDb: InstanceType<typeof Database> | null = null;
  try {
    sourceDb = new Database(sourceDbPath, { readonly: true, fileMustExist: true });

    for (const table of SALVAGE_TABLES) {
      try {
        // Check table exists in both source and target
        const srcExists = sourceDb.prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
        ).get(table);
        if (!srcExists) continue;

        const tgtExists = targetDb.prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
        ).get(table);
        if (!tgtExists) continue;

        // Find columns common to both (handles schema version mismatches)
        const targetCols = (targetDb.pragma(`table_info('${table}')`) as Array<{ name: string }>)
          .map(c => c.name);
        const sourceCols = (sourceDb.pragma(`table_info('${table}')`) as Array<{ name: string }>)
          .map(c => c.name);
        const commonCols = targetCols.filter(c => sourceCols.includes(c));
        if (commonCols.length === 0) continue;

        const colList = commonCols.join(', ');
        const placeholders = commonCols.map(() => '?').join(', ');

        const rows = sourceDb.prepare(`SELECT ${colList} FROM ${table}`).all() as Array<Record<string, unknown>>;
        if (rows.length === 0) continue;

        const insert = targetDb.prepare(
          `INSERT OR IGNORE INTO ${table} (${colList}) VALUES (${placeholders})`
        );
        const insertMany = targetDb.transaction((data: Array<Record<string, unknown>>) => {
          let count = 0;
          for (const row of data) {
            insert.run(...commonCols.map(c => row[c]));
            count++;
          }
          return count;
        });

        const count = insertMany(rows);
        if (count > 0) results[table] = count;
      } catch (tableErr) {
        console.error(`[vault-core] Salvage ${table}: ${tableErr instanceof Error ? tableErr.message : tableErr}`);
      }
    }
  } catch (err) {
    console.error(`[vault-core] Cannot open ${path.basename(sourceDbPath)} for salvage: ${err instanceof Error ? err.message : err}`);
  } finally {
    try { sourceDb?.close(); } catch { /* ignore */ }
  }

  return results;
}

/**
 * After corruption forces a fresh DB, attempt to recover feedback data
 * from all available backup files (newest first) and the corrupt file.
 * Merges across all sources — INSERT OR IGNORE deduplicates, so each
 * successive source only adds rows the previous ones didn't cover.
 */
export function attemptSalvage(targetDb: Database.Database, dbPath: string): void {
  const sources = [
    `${dbPath}.backup`,
    ...Array.from({ length: BACKUP_ROTATION_COUNT }, (_, i) => `${dbPath}.backup.${i + 1}`),
    `${dbPath}.corrupt`,
  ];

  let totalSalvaged = 0;

  for (const source of sources) {
    if (!fs.existsSync(source)) continue;

    console.error(`[vault-core] Attempting feedback salvage from ${path.basename(source)}...`);
    const results = salvageFeedbackTables(targetDb, source);

    const sourceRows = Object.values(results).reduce((a, b) => a + b, 0);
    if (sourceRows > 0) {
      const detail = Object.entries(results).map(([t, n]) => `${t}: ${n}`).join(', ');
      console.error(`[vault-core] Salvaged ${sourceRows} rows from ${path.basename(source)}: ${detail}`);
      totalSalvaged += sourceRows;
    }
  }

  if (totalSalvaged > 0) {
    console.error(`[vault-core] Total salvaged: ${totalSalvaged} rows across all sources`);
  } else {
    console.error('[vault-core] No salvageable backup found — starting fresh');
  }
}
