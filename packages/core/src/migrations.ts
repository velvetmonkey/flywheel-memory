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

/**
 * Number of rotated backup generations kept alongside the current `.backup`
 * file. Steady state retention is `.backup` plus `.backup.1`..`.backup.N`.
 */
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
  'tool_selection_feedback',
  'prospect_ledger',
  'prospect_summary',
  'prospect_feedback',
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

  // Incremental auto-vacuum — reclaims freed pages without full VACUUM blocking.
  // Only takes effect on new DBs (before first table). Existing DBs need a one-time
  // VACUUM in openStateDb() to activate.
  db.pragma('auto_vacuum = INCREMENTAL');

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

    // v35: matched_term column on wikilink_feedback and wikilink_applications
    // Enables per-alias feedback tracking — suppression can target individual aliases
    // instead of penalizing the whole entity (fixes Hera/Hero problem).
    if (currentVersion < 35) {
      const hasFeedbackTerm = db.prepare(
        `SELECT COUNT(*) as cnt FROM pragma_table_info('wikilink_feedback') WHERE name = 'matched_term'`
      ).get() as { cnt: number };
      if (hasFeedbackTerm.cnt === 0) {
        db.exec('ALTER TABLE wikilink_feedback ADD COLUMN matched_term TEXT');
      }

      const hasAppTerm = db.prepare(
        `SELECT COUNT(*) as cnt FROM pragma_table_info('wikilink_applications') WHERE name = 'matched_term'`
      ).get() as { cnt: number };
      if (hasAppTerm.cnt === 0) {
        db.exec('ALTER TABLE wikilink_applications ADD COLUMN matched_term TEXT');
      }

      db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(35);
    }


    // v36: tool_selection_feedback table + query_context on tool_invocations
    if (currentVersion < 36) {
      const hasQueryContext = db.prepare(
        `SELECT COUNT(*) as cnt FROM pragma_table_info('tool_invocations') WHERE name = 'query_context'`
      ).get() as { cnt: number };
      if (hasQueryContext.cnt === 0) {
        db.exec('ALTER TABLE tool_invocations ADD COLUMN query_context TEXT');
      }

      db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(36);
    }

    // v37: prospect_ledger + prospect_summary tables (pre-entity pattern accumulation)
    // (created by SCHEMA_SQL above via CREATE TABLE IF NOT EXISTS)

    // v38: source column on wikilink_applications (proactive linking observability)
    // Tracks who most recently applied each link: tool, proactive, enrichment, manual_detected
    if (currentVersion < 38) {
      const hasSource = db.prepare(
        `SELECT COUNT(*) as cnt FROM pragma_table_info('wikilink_applications') WHERE name = 'source'`
      ).get() as { cnt: number };
      if (hasSource.cnt === 0) {
        db.exec(`ALTER TABLE wikilink_applications ADD COLUMN source TEXT NOT NULL DEFAULT 'tool'`);
      }
      db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(38);
    }

    // v39: case-insensitive note_path on wikilink_applications unique index.
    // On Windows NTFS / macOS APFS, `Flywheel.md` and `flywheel.md` are the
    // same physical file. Without COLLATE NOCASE on note_path, mixed-case
    // rows were legal and the same application could be recorded twice,
    // doubling counts and breaking dedup in the doctor report (P42 issue 1).
    if (currentVersion < 39) {
      db.exec('DROP INDEX IF EXISTS idx_wl_apps_unique');
      // Collapse any pre-existing duplicates before re-adding the unique index.
      // Keep the lowest-id row per (entity NOCASE, note_path NOCASE) group.
      db.exec(`
        DELETE FROM wikilink_applications
        WHERE id NOT IN (
          SELECT MIN(id)
          FROM wikilink_applications
          GROUP BY LOWER(entity), LOWER(note_path)
        )
      `);
      db.exec(`
        CREATE UNIQUE INDEX idx_wl_apps_unique
        ON wikilink_applications(entity COLLATE NOCASE, note_path COLLATE NOCASE)
      `);
      db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(39);
    }

    // v40: COLLATE NOCASE rollout across 14 more path columns.
    // Case-insensitive filesystems (Windows NTFS, macOS APFS default) treat
    // "Flywheel.md" and "flywheel.md" as the same file, but without collation
    // both mixed-case variants could land in the state DB. v40 rebuilds the
    // affected tables with COLLATE NOCASE on their path columns and collapses
    // pre-existing dupes per table-specific rules (see migrateV40 below).
    let v40Applied = true;
    if (currentVersion < 40) {
      v40Applied = migrateV40(db);
      if (v40Applied) {
        db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(40);
      }
      // Dry-run path: schema_version stays at 39. Server boots in degraded state.
    }

    if (currentVersion < 41 && v40Applied) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS prospect_feedback (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          term TEXT NOT NULL,
          action TEXT NOT NULL,
          entity_path TEXT,
          note_path TEXT COLLATE NOCASE,
          reason TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_prospect_feedback_term ON prospect_feedback(term, created_at DESC);
      `);

      const summaryColumns = new Set(
        (db.prepare('PRAGMA table_info(prospect_summary)').all() as Array<{ name: string }>).map((row) => row.name)
      );

      if (!summaryColumns.has('status')) {
        db.exec(`ALTER TABLE prospect_summary ADD COLUMN status TEXT NOT NULL DEFAULT 'prospect';`);
      }
      if (!summaryColumns.has('resolved_entity_path')) {
        db.exec(`ALTER TABLE prospect_summary ADD COLUMN resolved_entity_path TEXT;`);
      }
      if (!summaryColumns.has('last_feedback_at')) {
        db.exec(`ALTER TABLE prospect_summary ADD COLUMN last_feedback_at INTEGER;`);
      }

      db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(41);
    }

    if (currentVersion < 42 && v40Applied) {
      const memoryColumns = new Set(
        (db.prepare(`PRAGMA table_info(memories)`).all() as Array<{ name: string }>).map((row) => row.name)
      );

      if (!memoryColumns.has('owner_scope')) {
        db.exec(`ALTER TABLE memories ADD COLUMN owner_scope TEXT NOT NULL DEFAULT 'global'`);
      }

      db.exec(`
        UPDATE memories
        SET owner_scope = CASE
          WHEN visibility = 'private' AND source_agent_id IS NOT NULL AND TRIM(source_agent_id) <> '' THEN source_agent_id
          ELSE 'global'
        END
        WHERE owner_scope IS NULL OR TRIM(owner_scope) = ''
      `);

      db.exec(`
        DELETE FROM memories
        WHERE id NOT IN (
          SELECT id FROM (
            SELECT id,
                   ROW_NUMBER() OVER (
                     PARTITION BY key, owner_scope
                     ORDER BY updated_at DESC, id DESC
                   ) AS row_num
            FROM memories
          )
          WHERE row_num = 1
        )
      `);

      db.exec(`DROP INDEX IF EXISTS idx_memories_key_owner_scope`);
      db.exec(`CREATE UNIQUE INDEX idx_memories_key_owner_scope ON memories(key, owner_scope)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_owner_scope ON memories(owner_scope)`);

      db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(42);
    }

    // Only stamp SCHEMA_VERSION at the end if every migration ran. Dry-run
    // skips v40 → leave schema_version at 39 so the next non-dry-run boot
    // re-enters the v40 branch.
    if (v40Applied) {
      db.prepare(
        'INSERT OR IGNORE INTO schema_version (version) VALUES (?)'
      ).run(SCHEMA_VERSION);
    }
  }
}

// =============================================================================
// v40 Migration: COLLATE NOCASE rollout
// =============================================================================

/**
 * Run the v40 migration: add COLLATE NOCASE to path columns across 14 tables,
 * collapsing mixed-case duplicates with table-specific conflict resolution.
 *
 * Safety:
 * - Wrapped in a single db.transaction(). better-sqlite3 supports transactional
 *   DDL (CREATE/DROP/ALTER RENAME participate in transactions), so any rebuild
 *   failure rolls back the whole batch. Partial-upgrade state is impossible.
 * - Caller (openStateDb) runs a synchronous VACUUM INTO backup before calling
 *   initSchema when upgrading from < v40.
 * - No VACUUM or PRAGMA statements inside the transaction (they auto-commit).
 * - Foreign keys disabled for the duration to permit DROP TABLE on referenced
 *   tables. Re-enabled at the end.
 *
 * Conflict resolution per table (see p42 v40 plan S3 for full rationale):
 *
 * | Table                  | Rule                                               |
 * |------------------------|----------------------------------------------------|
 * | entities               | column alter (via rebuild) — no rows to merge      |
 * | note_embeddings        | MAX(updated_at)                                    |
 * | content_hashes         | MAX(updated_at)                                    |
 * | tasks                  | best-effort MAX(id); file scan reconciles          |
 * | note_links             | MAX(weight_updated_at), keep matching weight       |
 * | note_tags              | INSERT OR IGNORE — pure dedup, no values to merge  |
 * | note_link_history      | MIN(first_seen_at), MAX(edits_survived/last_pos)   |
 * | note_moves             | column alter — preserve all rows                   |
 * | suggestion_events      | MAX(total_score) per (timestamp, note, entity)     |
 * | corrections            | column alter — preserve all rows                   |
 * | prospect_ledger        | MIN first_seen, MAX last_seen, SUM sightings       |
 * | proactive_queue        | MAX(score), prefer 'pending' status                |
 * | retrieval_cooccurrence | SUM(weight), MIN(timestamp)                        |
 * | wikilink_feedback      | column alter — preserve all rows                   |
 */
export function migrateV40(db: Database.Database): boolean {
  // Log pre-migration collision counts so users see what's about to collapse.
  // Counts are best-effort: tables that don't exist yet (fresh DB) are skipped.
  const collisionProbes: Array<{ table: string; pathCol: string; extraCols?: string }> = [
    { table: 'entities',              pathCol: 'path' },
    { table: 'note_embeddings',       pathCol: 'path' },
    { table: 'content_hashes',        pathCol: 'path' },
    { table: 'tasks',                 pathCol: 'path',     extraCols: 'line' },
    { table: 'note_links',            pathCol: 'note_path', extraCols: 'target' },
    { table: 'note_tags',             pathCol: 'note_path', extraCols: 'tag' },
    { table: 'note_link_history',     pathCol: 'note_path', extraCols: 'target' },
    { table: 'suggestion_events',     pathCol: 'note_path', extraCols: 'timestamp, entity' },
    { table: 'prospect_ledger',       pathCol: 'note_path', extraCols: 'term, seen_day' },
    { table: 'proactive_queue',       pathCol: 'note_path', extraCols: 'entity' },
    { table: 'retrieval_cooccurrence', pathCol: 'note_a',    extraCols: 'note_b, session_id' },
  ];

  const collisions: Array<{ table: string; count: number }> = [];
  for (const probe of collisionProbes) {
    try {
      const groupCols = probe.extraCols
        ? `LOWER(${probe.pathCol}), ${probe.extraCols}`
        : `LOWER(${probe.pathCol})`;
      const row = db.prepare(
        `SELECT COUNT(*) AS cnt FROM (
           SELECT 1 FROM ${probe.table}
           GROUP BY ${groupCols}
           HAVING COUNT(*) > 1
         )`
      ).get() as { cnt: number } | undefined;
      if (row && row.cnt > 0) {
        collisions.push({ table: probe.table, count: row.cnt });
      }
    } catch {
      // Table doesn't exist yet — skip silently.
    }
  }

  if (collisions.length > 0) {
    const summary = collisions.map(c => `${c.table}=${c.count}`).join(', ');
    console.error(`[vault-core] v40 migration: collapsing mixed-case duplicates — ${summary}`);
  } else {
    console.error('[vault-core] v40 migration: no mixed-case duplicates detected');
  }

  if (process.env.FLYWHEEL_MIGRATION_DRY_RUN === '1') {
    console.error('[vault-core] FLYWHEEL_MIGRATION_DRY_RUN=1 — skipping v40 apply, DB stays at v39');
    return false;
  }

  // Disable foreign keys for the rebuild. SQLite requires this off when
  // renaming tables that may be referenced by others. Re-enabled after.
  db.pragma('foreign_keys = OFF');

  const runV40 = db.transaction(() => {
    // --- entities: simple rebuild (all existing rows preserved) ---
    db.exec(`
      CREATE TABLE entities_v40_new (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        name_lower TEXT NOT NULL,
        path TEXT NOT NULL COLLATE NOCASE,
        category TEXT NOT NULL,
        aliases_json TEXT,
        hub_score INTEGER DEFAULT 0,
        description TEXT
      );
      INSERT INTO entities_v40_new SELECT id, name, name_lower, path, category, aliases_json, hub_score, description FROM entities;
      DROP TABLE entities;
      ALTER TABLE entities_v40_new RENAME TO entities;
    `);

    // --- note_embeddings: dedup by LOWER(path), keep MAX(updated_at).
    //     Window function ranks rows per case-folded path by updated_at desc,
    //     rowid asc as tie-break. Pick rank 1. ---
    db.exec(`
      CREATE TABLE note_embeddings_v40_new (
        path TEXT PRIMARY KEY COLLATE NOCASE,
        embedding BLOB NOT NULL,
        content_hash TEXT NOT NULL,
        model TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO note_embeddings_v40_new
      SELECT path, embedding, content_hash, model, updated_at
      FROM (
        SELECT path, embedding, content_hash, model, updated_at,
          ROW_NUMBER() OVER (PARTITION BY LOWER(path) ORDER BY updated_at DESC, rowid ASC) AS rn
        FROM note_embeddings
      ) WHERE rn = 1;
      DROP TABLE note_embeddings;
      ALTER TABLE note_embeddings_v40_new RENAME TO note_embeddings;
    `);

    // --- content_hashes: dedup by LOWER(path), keep MAX(updated_at).
    //     ROW_NUMBER() picks one row deterministically per case-folded path. ---
    db.exec(`
      CREATE TABLE content_hashes_v40_new (
        path TEXT PRIMARY KEY COLLATE NOCASE,
        hash TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO content_hashes_v40_new
      SELECT path, hash, updated_at
      FROM (
        SELECT path, hash, updated_at,
          ROW_NUMBER() OVER (PARTITION BY LOWER(path) ORDER BY updated_at DESC, rowid ASC) AS rn
        FROM content_hashes
      ) WHERE rn = 1;
      DROP TABLE content_hashes;
      ALTER TABLE content_hashes_v40_new RENAME TO content_hashes;
    `);

    // --- tasks: best-effort dedup by (LOWER(path), line), keep MAX(id).
    //     Post-boot file scan repopulates with the canonical filesystem case. ---
    db.exec(`
      CREATE TABLE tasks_v40_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL COLLATE NOCASE,
        line INTEGER NOT NULL,
        text TEXT NOT NULL,
        status TEXT NOT NULL,
        raw TEXT NOT NULL,
        context TEXT,
        tags_json TEXT,
        due_date TEXT,
        UNIQUE(path, line)
      );
      INSERT INTO tasks_v40_new
      SELECT id, path, line, text, status, raw, context, tags_json, due_date
      FROM (
        SELECT id, path, line, text, status, raw, context, tags_json, due_date,
          ROW_NUMBER() OVER (PARTITION BY LOWER(path), line ORDER BY id DESC) AS rn
        FROM tasks
      ) WHERE rn = 1;
      DROP TABLE tasks;
      ALTER TABLE tasks_v40_new RENAME TO tasks;
    `);

    // --- note_links: dedup by (LOWER(note_path), target), keep row with the
    //     latest weight_updated_at. Treat NULL as 0 for ordering so non-NULL
    //     wins. rowid tiebreak keeps the pick deterministic. ---
    db.exec(`
      CREATE TABLE note_links_v40_new (
        note_path TEXT NOT NULL COLLATE NOCASE,
        target TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        weight_updated_at INTEGER,
        PRIMARY KEY (note_path, target)
      );
      INSERT INTO note_links_v40_new
      SELECT note_path, target, weight, weight_updated_at
      FROM (
        SELECT note_path, target, weight, weight_updated_at,
          ROW_NUMBER() OVER (
            PARTITION BY LOWER(note_path), target
            ORDER BY COALESCE(weight_updated_at, 0) DESC, rowid ASC
          ) AS rn
        FROM note_links
      ) WHERE rn = 1;
      DROP TABLE note_links;
      ALTER TABLE note_links_v40_new RENAME TO note_links;
    `);

    // --- note_tags: pure dedup via INSERT OR IGNORE. No value columns to merge. ---
    db.exec(`
      CREATE TABLE note_tags_v40_new (
        note_path TEXT NOT NULL COLLATE NOCASE,
        tag TEXT NOT NULL,
        PRIMARY KEY (note_path, tag)
      );
      INSERT OR IGNORE INTO note_tags_v40_new SELECT note_path, tag FROM note_tags;
      DROP TABLE note_tags;
      ALTER TABLE note_tags_v40_new RENAME TO note_tags;
    `);

    // --- note_link_history: MIN(first_seen_at), MAX(edits_survived, last_positive_at) ---
    db.exec(`
      CREATE TABLE note_link_history_v40_new (
        note_path TEXT NOT NULL COLLATE NOCASE,
        target TEXT NOT NULL,
        first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        edits_survived INTEGER NOT NULL DEFAULT 0,
        last_positive_at TEXT,
        PRIMARY KEY (note_path, target)
      );
      INSERT INTO note_link_history_v40_new
      SELECT MIN(note_path), target, MIN(first_seen_at), MAX(edits_survived), MAX(last_positive_at)
      FROM note_link_history
      GROUP BY LOWER(note_path), target;
      DROP TABLE note_link_history;
      ALTER TABLE note_link_history_v40_new RENAME TO note_link_history;
    `);

    // --- note_moves: column alter via rebuild. All rows preserved (no dedup;
    //     history is append-only, old/new paths are legitimately case-variant). ---
    db.exec(`
      CREATE TABLE note_moves_v40_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        old_path TEXT NOT NULL COLLATE NOCASE,
        new_path TEXT NOT NULL COLLATE NOCASE,
        moved_at TEXT NOT NULL DEFAULT (datetime('now')),
        old_folder TEXT,
        new_folder TEXT
      );
      INSERT INTO note_moves_v40_new SELECT id, old_path, new_path, moved_at, old_folder, new_folder FROM note_moves;
      DROP TABLE note_moves;
      ALTER TABLE note_moves_v40_new RENAME TO note_moves;
    `);

    // --- suggestion_events: dedup by (timestamp, LOWER(note_path), entity),
    //     keep row with MAX(total_score), id DESC tiebreak. ---
    db.exec(`
      CREATE TABLE suggestion_events_v40_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        note_path TEXT NOT NULL COLLATE NOCASE,
        entity TEXT NOT NULL,
        total_score REAL NOT NULL,
        breakdown_json TEXT NOT NULL,
        threshold REAL NOT NULL,
        passed INTEGER NOT NULL,
        strictness TEXT NOT NULL,
        applied INTEGER DEFAULT 0,
        pipeline_event_id INTEGER,
        UNIQUE(timestamp, note_path, entity)
      );
      INSERT INTO suggestion_events_v40_new
      SELECT id, timestamp, note_path, entity, total_score, breakdown_json,
             threshold, passed, strictness, applied, pipeline_event_id
      FROM (
        SELECT id, timestamp, note_path, entity, total_score, breakdown_json,
               threshold, passed, strictness, applied, pipeline_event_id,
          ROW_NUMBER() OVER (
            PARTITION BY timestamp, LOWER(note_path), entity
            ORDER BY total_score DESC, id DESC
          ) AS rn
        FROM suggestion_events
      ) WHERE rn = 1;
      DROP TABLE suggestion_events;
      ALTER TABLE suggestion_events_v40_new RENAME TO suggestion_events;
    `);

    // --- corrections: column alter via rebuild. All rows preserved. ---
    db.exec(`
      CREATE TABLE corrections_v40_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity TEXT,
        note_path TEXT COLLATE NOCASE,
        correction_type TEXT NOT NULL,
        description TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'user',
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now')),
        resolved_at TEXT
      );
      INSERT INTO corrections_v40_new
      SELECT id, entity, note_path, correction_type, description, source, status, created_at, resolved_at
      FROM corrections;
      DROP TABLE corrections;
      ALTER TABLE corrections_v40_new RENAME TO corrections;
    `);

    // --- prospect_ledger: aggregate sums (sighting_count, score, backlink_count,
    //     first/last_seen_at) plus non-aggregate cols (display_name, source,
    //     pattern, confidence) taken from the row with the latest last_seen_at.
    //     CTE: agg computes the sums; ranked picks the winning row per group;
    //     INSERT joins the two. ---
    db.exec(`
      CREATE TABLE prospect_ledger_v40_new (
        term TEXT NOT NULL,
        display_name TEXT NOT NULL,
        note_path TEXT NOT NULL COLLATE NOCASE,
        seen_day TEXT NOT NULL,
        source TEXT NOT NULL,
        pattern TEXT,
        confidence TEXT NOT NULL DEFAULT 'low',
        backlink_count INTEGER DEFAULT 0,
        score REAL DEFAULT 0,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        sighting_count INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (term, note_path, seen_day)
      );
      INSERT INTO prospect_ledger_v40_new
      WITH agg AS (
        SELECT
          term AS tm,
          LOWER(note_path) AS lnp,
          seen_day AS sd,
          MIN(first_seen_at) AS first_seen,
          MAX(last_seen_at) AS last_seen,
          SUM(sighting_count) AS total_sightings,
          MAX(score) AS best_score,
          MAX(backlink_count) AS total_backlinks
        FROM prospect_ledger
        GROUP BY term, LOWER(note_path), seen_day
      ),
      ranked AS (
        SELECT term, display_name, note_path, seen_day, source, pattern, confidence,
          ROW_NUMBER() OVER (
            PARTITION BY term, LOWER(note_path), seen_day
            ORDER BY last_seen_at DESC, rowid ASC
          ) AS rn
        FROM prospect_ledger
      )
      SELECT
        r.term,
        r.display_name,
        r.note_path,
        r.seen_day,
        r.source,
        r.pattern,
        r.confidence,
        COALESCE(a.total_backlinks, 0) AS backlink_count,
        COALESCE(a.best_score, 0) AS score,
        a.first_seen AS first_seen_at,
        a.last_seen AS last_seen_at,
        a.total_sightings AS sighting_count
      FROM ranked r
      INNER JOIN agg a
        ON r.term = a.tm AND LOWER(r.note_path) = a.lnp AND r.seen_day = a.sd
      WHERE r.rn = 1;
      DROP TABLE prospect_ledger;
      ALTER TABLE prospect_ledger_v40_new RENAME TO prospect_ledger;
    `);

    // --- proactive_queue: dedup by (LOWER(note_path), entity). Keep row with
    //     MAX(score); on score tie, prefer status='pending' over 'applied' (so
    //     unfinished work survives); then latest queued_at; then highest id. ---
    db.exec(`
      CREATE TABLE proactive_queue_v40_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note_path TEXT NOT NULL COLLATE NOCASE,
        entity TEXT NOT NULL,
        score REAL NOT NULL,
        confidence TEXT NOT NULL,
        queued_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        applied_at INTEGER,
        UNIQUE(note_path, entity)
      );
      INSERT INTO proactive_queue_v40_new
      SELECT id, note_path, entity, score, confidence,
             queued_at, expires_at, status, applied_at
      FROM (
        SELECT id, note_path, entity, score, confidence,
               queued_at, expires_at, status, applied_at,
          ROW_NUMBER() OVER (
            PARTITION BY LOWER(note_path), entity
            ORDER BY score DESC,
                     CASE WHEN status = 'pending' THEN 0 ELSE 1 END ASC,
                     queued_at DESC,
                     id DESC
          ) AS rn
        FROM proactive_queue
      ) WHERE rn = 1;
      DROP TABLE proactive_queue;
      ALTER TABLE proactive_queue_v40_new RENAME TO proactive_queue;
    `);

    // --- retrieval_cooccurrence: SUM(weight), MIN(timestamp) per
    //     (LOWER(note_a), LOWER(note_b), session_id) ---
    db.exec(`
      CREATE TABLE retrieval_cooccurrence_v40_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note_a TEXT NOT NULL COLLATE NOCASE,
        note_b TEXT NOT NULL COLLATE NOCASE,
        session_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        UNIQUE(note_a, note_b, session_id)
      );
      INSERT INTO retrieval_cooccurrence_v40_new (note_a, note_b, session_id, timestamp, weight)
      SELECT MIN(note_a), MIN(note_b), session_id, MIN(timestamp), SUM(weight)
      FROM retrieval_cooccurrence
      GROUP BY LOWER(note_a), LOWER(note_b), session_id;
      DROP TABLE retrieval_cooccurrence;
      ALTER TABLE retrieval_cooccurrence_v40_new RENAME TO retrieval_cooccurrence;
    `);

    // --- wikilink_feedback: column alter via rebuild. All rows preserved. ---
    db.exec(`
      CREATE TABLE wikilink_feedback_v40_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity TEXT NOT NULL,
        context TEXT NOT NULL,
        note_path TEXT NOT NULL COLLATE NOCASE,
        correct INTEGER NOT NULL,
        confidence REAL NOT NULL DEFAULT 1.0,
        matched_term TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO wikilink_feedback_v40_new
      SELECT id, entity, context, note_path, correct, confidence, matched_term, created_at
      FROM wikilink_feedback;
      DROP TABLE wikilink_feedback;
      ALTER TABLE wikilink_feedback_v40_new RENAME TO wikilink_feedback;
    `);

    // Recreate all indexes stripped by DROP TABLE. Re-executing SCHEMA_SQL
    // is safe inside the transaction: CREATE TABLE IF NOT EXISTS is a no-op
    // for the renamed tables, and CREATE INDEX IF NOT EXISTS repopulates
    // the missing indexes. Triggers on entities_fts also get re-created.
    db.exec(SCHEMA_SQL);
  });

  try {
    runV40();
  } finally {
    // Always re-enable foreign keys, even if the transaction threw and rolled back.
    db.pragma('foreign_keys = ON');
  }
  return true;
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
 * Rotate existing backup files: .backup → .backup.1 → .backup.2 → .backup.3.
 * Retains the numbered generations only; `safeBackupAsync()` then writes a new
 * current `.backup` file. Drops the oldest generation if rotation count is exceeded.
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
 * Rotates existing backups first, then writes a new `.backup` file so steady
 * state retention is the current backup plus `BACKUP_ROTATION_COUNT` generations.
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
