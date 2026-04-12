/**
 * Tests for Backup, Rotation, Integrity Check, and Feedback Salvage
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import {
  openStateDb,
  FLYWHEEL_DIR,
  STATE_DB_FILENAME,
  BACKUP_ROTATION_COUNT,
  SALVAGE_TABLES,
  rotateBackupFiles,
  safeBackupAsync,
  checkDbIntegrity,
  salvageFeedbackTables,
  attemptSalvage,
} from '../src/sqlite.js';
import type { StateDb } from '../src/sqlite.js';

describe('Backup & Recovery', () => {
  let testVaultPath: string;
  let dbPath: string;

  beforeEach(() => {
    testVaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-backup-test-'));
    const flywheelDir = path.join(testVaultPath, FLYWHEEL_DIR);
    fs.mkdirSync(flywheelDir, { recursive: true });
    dbPath = path.join(flywheelDir, STATE_DB_FILENAME);
  });

  afterEach(() => {
    if (fs.existsSync(testVaultPath)) {
      fs.rmSync(testVaultPath, { recursive: true });
    }
  });

  // ===========================================================================
  // rotateBackupFiles
  // ===========================================================================
  describe('rotateBackupFiles', () => {
    it('shifts .backup → .backup.1', () => {
      fs.writeFileSync(`${dbPath}.backup`, 'gen-A');

      rotateBackupFiles(dbPath);

      expect(fs.existsSync(`${dbPath}.backup`)).toBe(false);
      expect(fs.readFileSync(`${dbPath}.backup.1`, 'utf8')).toBe('gen-A');
    });

    it('shifts .backup.1 → .backup.2 and .backup → .backup.1', () => {
      fs.writeFileSync(`${dbPath}.backup`, 'gen-B');
      fs.writeFileSync(`${dbPath}.backup.1`, 'gen-A');

      rotateBackupFiles(dbPath);

      expect(fs.existsSync(`${dbPath}.backup`)).toBe(false);
      expect(fs.readFileSync(`${dbPath}.backup.1`, 'utf8')).toBe('gen-B');
      expect(fs.readFileSync(`${dbPath}.backup.2`, 'utf8')).toBe('gen-A');
    });

    it('drops oldest when rotation count exceeded', () => {
      fs.writeFileSync(`${dbPath}.backup`, 'gen-D');
      fs.writeFileSync(`${dbPath}.backup.1`, 'gen-C');
      fs.writeFileSync(`${dbPath}.backup.2`, 'gen-B');
      fs.writeFileSync(`${dbPath}.backup.3`, 'gen-A');

      rotateBackupFiles(dbPath);

      // gen-A (was .3) should be gone, gen-B moved to .3
      expect(fs.readFileSync(`${dbPath}.backup.1`, 'utf8')).toBe('gen-D');
      expect(fs.readFileSync(`${dbPath}.backup.2`, 'utf8')).toBe('gen-C');
      expect(fs.readFileSync(`${dbPath}.backup.3`, 'utf8')).toBe('gen-B');
      expect(fs.existsSync(`${dbPath}.backup`)).toBe(false);
    });

    it('no-ops when no backup files exist', () => {
      rotateBackupFiles(dbPath);
      // Nothing should crash, no files created
      expect(fs.existsSync(`${dbPath}.backup.1`)).toBe(false);
    });
  });

  // ===========================================================================
  // safeBackupAsync
  // ===========================================================================
  describe('safeBackupAsync', () => {
    it('creates a valid SQLite backup', { timeout: 15_000 }, async () => {
      const stateDb = openStateDb(testVaultPath);
      try {
        const result = await safeBackupAsync(stateDb.db, stateDb.dbPath);
        expect(result).toBe(true);

        // The backup file should exist and be a valid database
        const backupPath = `${stateDb.dbPath}.backup`;
        expect(fs.existsSync(backupPath)).toBe(true);
        expect(fs.statSync(backupPath).size).toBeGreaterThan(0);

        // Should be openable
        const backupDb = new Database(backupPath, { readonly: true });
        const tables = backupDb.prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='entities'`
        ).get();
        expect(tables).toBeTruthy();
        backupDb.close();
      } finally {
        stateDb.close();
      }
    });

    it('rotates existing backups before creating new one', { timeout: 15_000 }, async () => {
      const stateDb = openStateDb(testVaultPath);
      try {
        // Create first backup
        await safeBackupAsync(stateDb.db, stateDb.dbPath);
        expect(fs.existsSync(`${stateDb.dbPath}.backup`)).toBe(true);

        // Create second backup — first should rotate to .backup.1
        await safeBackupAsync(stateDb.db, stateDb.dbPath);
        expect(fs.existsSync(`${stateDb.dbPath}.backup`)).toBe(true);
        expect(fs.existsSync(`${stateDb.dbPath}.backup.1`)).toBe(true);
      } finally {
        stateDb.close();
      }
    });
  });

  // ===========================================================================
  // checkDbIntegrity
  // ===========================================================================
  describe('checkDbIntegrity', () => {
    it('returns ok for a healthy database', { timeout: 15_000 }, () => {
      const stateDb = openStateDb(testVaultPath);
      try {
        const result = checkDbIntegrity(stateDb.db);
        expect(result.ok).toBe(true);
        expect(result.detail).toBeUndefined();
      } finally {
        stateDb.close();
      }
    });

    it('returns not-ok for a closed database', () => {
      const stateDb = openStateDb(testVaultPath);
      stateDb.close();
      const result = checkDbIntegrity(stateDb.db);
      expect(result.ok).toBe(false);
      expect(result.detail).toBeDefined();
    });
  });

  // ===========================================================================
  // salvageFeedbackTables
  // ===========================================================================
  describe('salvageFeedbackTables', () => {
    it('copies feedback rows from source to target', () => {
      // Create source DB with feedback data
      const sourceDb = openStateDb(testVaultPath);
      sourceDb.db.prepare(
        `INSERT INTO wikilink_feedback (entity, context, note_path, correct, created_at)
         VALUES ('TypeScript', 'test context', 'notes/test.md', 1, datetime('now'))`
      ).run();
      sourceDb.db.prepare(
        `INSERT INTO wikilink_feedback (entity, context, note_path, correct, created_at)
         VALUES ('React', 'test context 2', 'notes/test2.md', 1, datetime('now'))`
      ).run();
      sourceDb.close();

      // Rename source to .backup so we can create a fresh target
      const backupPath = `${dbPath}.salvage-source`;
      fs.copyFileSync(dbPath, backupPath);

      // Create fresh target
      fs.unlinkSync(dbPath);
      if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
      if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
      const targetDb = openStateDb(testVaultPath);

      try {
        const results = salvageFeedbackTables(targetDb.db, backupPath);
        expect(results.wikilink_feedback).toBe(2);

        // Verify rows are actually in target
        const rows = targetDb.db.prepare('SELECT COUNT(*) as cnt FROM wikilink_feedback').get() as { cnt: number };
        expect(rows.cnt).toBe(2);
      } finally {
        targetDb.close();
        fs.unlinkSync(backupPath);
      }
    });

    it('handles missing tables gracefully', () => {
      // Create a minimal source DB without feedback tables
      const sourcePath = `${dbPath}.minimal`;
      const sourceDb = new Database(sourcePath);
      sourceDb.exec('CREATE TABLE dummy (id INTEGER)');
      sourceDb.close();

      const targetDb = openStateDb(testVaultPath);
      try {
        const results = salvageFeedbackTables(targetDb.db, sourcePath);
        expect(Object.keys(results).length).toBe(0);
      } finally {
        targetDb.close();
        fs.unlinkSync(sourcePath);
      }
    });

    it('returns empty for non-existent source', () => {
      const targetDb = openStateDb(testVaultPath);
      try {
        const results = salvageFeedbackTables(targetDb.db, '/nonexistent/db.sqlite');
        expect(Object.keys(results).length).toBe(0);
      } finally {
        targetDb.close();
      }
    });

    it('handles column mismatches (copies common columns only)', () => {
      // Create source with an extra column on wikilink_feedback
      const sourcePath = `${dbPath}.col-mismatch`;
      const sourceDb = new Database(sourcePath);
      sourceDb.exec(`
        CREATE TABLE wikilink_feedback (
          entity TEXT NOT NULL,
          context TEXT NOT NULL,
          note_path TEXT NOT NULL,
          correct INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          extra_col TEXT DEFAULT 'extra'
        )
      `);
      sourceDb.prepare(
        `INSERT INTO wikilink_feedback (entity, context, note_path, correct) VALUES (?, ?, ?, ?)`
      ).run('Test', 'ctx', 'test.md', 1);
      sourceDb.close();

      const targetDb = openStateDb(testVaultPath);
      try {
        const results = salvageFeedbackTables(targetDb.db, sourcePath);
        expect(results.wikilink_feedback).toBe(1);
      } finally {
        targetDb.close();
        fs.unlinkSync(sourcePath);
      }
    });
  });

  // ===========================================================================
  // attemptSalvage
  // ===========================================================================
  describe('attemptSalvage', () => {
    it('recovers from a later backup when earlier ones are missing', () => {
      // Create a source DB with data and put it at .backup.2
      const sourceDb = openStateDb(testVaultPath);
      sourceDb.db.prepare(
        `INSERT INTO wikilink_feedback (entity, context, note_path, correct, created_at)
         VALUES ('TypeScript', 'test context', 'notes/test.md', 1, datetime('now'))`
      ).run();
      sourceDb.close();

      // Copy full DB to .backup.2 (simulating an older backup)
      fs.copyFileSync(dbPath, `${dbPath}.backup.2`);

      // Create a fresh target DB
      fs.unlinkSync(dbPath);
      if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
      if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
      const targetDb = openStateDb(testVaultPath);

      try {
        // .backup and .backup.1 don't exist, so it should find .backup.2
        attemptSalvage(targetDb.db, dbPath);

        const rows = targetDb.db.prepare('SELECT COUNT(*) as cnt FROM wikilink_feedback').get() as { cnt: number };
        expect(rows.cnt).toBe(1);
      } finally {
        targetDb.close();
      }
    });

    it('merges unique rows from multiple sources', () => {
      // Use note_links (has natural PK on note_path+target) for clean dedup testing
      // Source A: .backup with link A→X
      const dbA = openStateDb(testVaultPath);
      dbA.db.prepare(
        `INSERT INTO note_links (note_path, target) VALUES (?, ?)`
      ).run('a.md', 'X');
      dbA.close();
      fs.copyFileSync(dbPath, `${dbPath}.backup`);

      // Source B: .backup.1 with link A→X (overlap) + B→Y (unique)
      // Build from scratch to avoid auto-salvage contamination
      fs.unlinkSync(dbPath);
      if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
      if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
      // Temporarily move .backup so openStateDb doesn't auto-salvage from it
      fs.renameSync(`${dbPath}.backup`, `${dbPath}.backup.tmp`);
      const dbB = openStateDb(testVaultPath);
      dbB.db.prepare(
        `INSERT INTO note_links (note_path, target) VALUES (?, ?)`
      ).run('a.md', 'X');
      dbB.db.prepare(
        `INSERT INTO note_links (note_path, target) VALUES (?, ?)`
      ).run('b.md', 'Y');
      dbB.close();
      fs.copyFileSync(dbPath, `${dbPath}.backup.1`);
      // Restore .backup
      fs.renameSync(`${dbPath}.backup.tmp`, `${dbPath}.backup`);

      // Fresh target — openStateDb auto-salvages from both
      fs.unlinkSync(dbPath);
      if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
      if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
      const targetDb = openStateDb(testVaultPath);

      try {
        // Should have A→X from .backup + B→Y from .backup.1 (A→X dup ignored by PK)
        const rows = targetDb.db.prepare('SELECT COUNT(*) as cnt FROM note_links').get() as { cnt: number };
        expect(rows.cnt).toBe(2);

        const links = targetDb.db.prepare('SELECT note_path, target FROM note_links ORDER BY note_path').all() as Array<{ note_path: string; target: string }>;
        expect(links).toEqual([
          { note_path: 'a.md', target: 'X' },
          { note_path: 'b.md', target: 'Y' },
        ]);
      } finally {
        targetDb.close();
      }
    });
  });

  // ===========================================================================
  // Extended salvage scenarios
  // ===========================================================================
  describe('salvageFeedbackTables (extended)', () => {
    it('salvages every configured salvage table when populated', () => {
      const sourceDb = openStateDb(testVaultPath);
      const now = Date.now();

      // Populate each salvage table with at least 1 row
      sourceDb.db.prepare(
        `INSERT INTO wikilink_feedback (entity, context, note_path, correct) VALUES (?, ?, ?, ?)`
      ).run('E1', 'ctx', 'n.md', 1);
      sourceDb.db.prepare(
        `INSERT INTO wikilink_applications (entity, note_path) VALUES (?, ?)`
      ).run('E1', 'n.md');
      sourceDb.db.prepare(
        `INSERT INTO suggestion_events (timestamp, note_path, entity, total_score, breakdown_json, threshold, passed, strictness) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(now, 'n.md', 'E1', 10.0, '{}', 8.0, 1, 'balanced');
      sourceDb.db.prepare(
        `INSERT INTO wikilink_suppressions (entity, false_positive_rate) VALUES (?, ?)`
      ).run('BadEntity', 0.8);
      sourceDb.db.prepare(
        `INSERT INTO note_links (note_path, target) VALUES (?, ?)`
      ).run('n.md', 'E1');
      sourceDb.db.prepare(
        `INSERT INTO note_link_history (note_path, target) VALUES (?, ?)`
      ).run('n.md', 'E1');
      sourceDb.db.prepare(
        `INSERT INTO memories (key, value, memory_type, confidence, created_at, updated_at, accessed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('k1', 'v1', 'fact', 1.0, now, now, now);
      sourceDb.db.prepare(
        `INSERT INTO session_summaries (session_id, summary, ended_at) VALUES (?, ?, ?)`
      ).run('sess-1', 'test summary', now);
      sourceDb.db.prepare(
        `INSERT INTO corrections (correction_type, description, source) VALUES (?, ?, ?)`
      ).run('wrong_link', 'test correction', 'user');
      sourceDb.db.prepare(
        `INSERT INTO tool_selection_feedback (timestamp, tool_name, correct, source) VALUES (?, ?, ?, ?)`
      ).run(now, 'search', 1, 'explicit');
      sourceDb.db.prepare(
        `INSERT INTO prospect_ledger (term, display_name, note_path, seen_day, source, confidence, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run('test term', 'Test Term', 'n.md', '2026-03-30', 'implicit', 'low', now, now);
      sourceDb.db.prepare(
        `INSERT INTO prospect_summary (term, display_name, note_count, day_count, total_sightings, backlink_max, best_source, best_confidence, best_score, first_seen_at, last_seen_at, promotion_score, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run('test term', 'Test Term', 1, 1, 1, 0, 'implicit', 'low', 0, now, now, 5.0, now);
      sourceDb.db.prepare(
        `INSERT INTO prospect_feedback (term, action, entity_path, note_path, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).run('test term', 'reject', null, 'n.md', 'test', now);
      sourceDb.close();

      const backupPath = `${dbPath}.full-salvage`;
      fs.copyFileSync(dbPath, backupPath);

      // Fresh target
      fs.unlinkSync(dbPath);
      if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
      if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
      const targetDb = openStateDb(testVaultPath);

      try {
        const results = salvageFeedbackTables(targetDb.db, backupPath);
        // Every configured salvage table should have been salvaged
        for (const table of SALVAGE_TABLES) {
          expect(results[table]).toBeGreaterThanOrEqual(1);
        }
      } finally {
        targetDb.close();
        fs.unlinkSync(backupPath);
      }
    });

    it('handles large dataset (1000+ rows)', () => {
      const sourceDb = openStateDb(testVaultPath);
      const insert = sourceDb.db.prepare(
        `INSERT INTO wikilink_feedback (entity, context, note_path, correct) VALUES (?, ?, ?, ?)`
      );
      const insertMany = sourceDb.db.transaction(() => {
        for (let i = 0; i < 1500; i++) {
          insert.run(`Entity${i}`, `context${i}`, `notes/note${i}.md`, i % 2);
        }
      });
      insertMany();
      sourceDb.close();

      const backupPath = `${dbPath}.large`;
      fs.copyFileSync(dbPath, backupPath);

      fs.unlinkSync(dbPath);
      if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
      if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
      const targetDb = openStateDb(testVaultPath);

      try {
        const results = salvageFeedbackTables(targetDb.db, backupPath);
        expect(results.wikilink_feedback).toBe(1500);
      } finally {
        targetDb.close();
        fs.unlinkSync(backupPath);
      }
    });

    it('skips duplicates when target already has data (INSERT OR IGNORE)', () => {
      const sourceDb = openStateDb(testVaultPath);
      sourceDb.db.prepare(
        `INSERT INTO wikilink_feedback (entity, context, note_path, correct) VALUES (?, ?, ?, ?)`
      ).run('E1', 'ctx1', 'n1.md', 1);
      sourceDb.db.prepare(
        `INSERT INTO wikilink_feedback (entity, context, note_path, correct) VALUES (?, ?, ?, ?)`
      ).run('E2', 'ctx2', 'n2.md', 0);
      sourceDb.close();

      const backupPath = `${dbPath}.dup-source`;
      fs.copyFileSync(dbPath, backupPath);

      // Recreate target with one overlapping row
      fs.unlinkSync(dbPath);
      if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
      if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
      const targetDb = openStateDb(testVaultPath);

      try {
        // Pre-populate target with one row that also exists in source
        targetDb.db.prepare(
          `INSERT INTO wikilink_feedback (entity, context, note_path, correct) VALUES (?, ?, ?, ?)`
        ).run('E1', 'ctx1', 'n1.md', 1);

        const results = salvageFeedbackTables(targetDb.db, backupPath);
        // Should report 2 attempted inserts (both run through INSERT OR IGNORE)
        expect(results.wikilink_feedback).toBe(2);

        // But actual row count should be 2 (not 3), because one was a duplicate
        const rows = targetDb.db.prepare('SELECT COUNT(*) as cnt FROM wikilink_feedback').get() as { cnt: number };
        expect(rows.cnt).toBe(2);
      } finally {
        targetDb.close();
        fs.unlinkSync(backupPath);
      }
    });

    it('salvages from a partially-readable corrupt file', () => {
      // Create a DB with data
      const sourceDb = openStateDb(testVaultPath);
      sourceDb.db.prepare(
        `INSERT INTO wikilink_feedback (entity, context, note_path, correct) VALUES (?, ?, ?, ?)`
      ).run('E1', 'ctx', 'n.md', 1);
      sourceDb.close();

      // The .corrupt file is a copy of the good DB (simulating partial readability)
      const corruptPath = `${dbPath}.corrupt`;
      fs.copyFileSync(dbPath, corruptPath);

      // Fresh target
      fs.unlinkSync(dbPath);
      if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
      if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
      const targetDb = openStateDb(testVaultPath);

      try {
        const results = salvageFeedbackTables(targetDb.db, corruptPath);
        expect(results.wikilink_feedback).toBe(1);
      } finally {
        targetDb.close();
      }
    });

    it('handles truly unreadable corrupt file gracefully', () => {
      // Write garbage that can't be opened as SQLite
      const corruptPath = `${dbPath}.corrupt`;
      fs.writeFileSync(corruptPath, Buffer.alloc(4096, 0xff));

      const targetDb = openStateDb(testVaultPath);
      try {
        const results = salvageFeedbackTables(targetDb.db, corruptPath);
        expect(Object.keys(results).length).toBe(0);
      } finally {
        targetDb.close();
      }
    });

    it('salvages across schema versions (source missing newer columns)', () => {
      // Create a source with an older schema: wikilink_feedback without "confidence" column
      const sourcePath = `${dbPath}.old-schema`;
      const sourceDb = new Database(sourcePath);
      sourceDb.exec(`
        CREATE TABLE wikilink_feedback (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entity TEXT NOT NULL,
          context TEXT NOT NULL,
          note_path TEXT NOT NULL,
          correct INTEGER NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
      sourceDb.prepare(
        `INSERT INTO wikilink_feedback (entity, context, note_path, correct) VALUES (?, ?, ?, ?)`
      ).run('OldEntity', 'old context', 'old.md', 1);
      sourceDb.close();

      // Target has the full current schema (including confidence column)
      const targetDb = openStateDb(testVaultPath);
      try {
        const results = salvageFeedbackTables(targetDb.db, sourcePath);
        expect(results.wikilink_feedback).toBe(1);

        // The row should have the default confidence value
        const row = targetDb.db.prepare(
          'SELECT entity, confidence FROM wikilink_feedback WHERE entity = ?'
        ).get('OldEntity') as { entity: string; confidence: number };
        expect(row.entity).toBe('OldEntity');
        // confidence gets DEFAULT 1.0 from schema since it wasn't in source columns
        expect(row.confidence).toBe(1.0);
      } finally {
        targetDb.close();
        fs.unlinkSync(sourcePath);
      }
    });
  });

  // ===========================================================================
  // safeBackupAsync (extended)
  // ===========================================================================
  describe('safeBackupAsync (extended)', () => {
    it('backup includes data written before backup call', { timeout: 15_000 }, async () => {
      const stateDb = openStateDb(testVaultPath);
      try {
        // Write data, then backup
        stateDb.db.prepare(
          `INSERT INTO wikilink_feedback (entity, context, note_path, correct) VALUES (?, ?, ?, ?)`
        ).run('BackupTest', 'ctx', 'b.md', 1);

        await safeBackupAsync(stateDb.db, stateDb.dbPath);

        // Verify backup contains the data
        const backupDb = new Database(`${stateDb.dbPath}.backup`, { readonly: true });
        const row = backupDb.prepare('SELECT COUNT(*) as cnt FROM wikilink_feedback').get() as { cnt: number };
        expect(row.cnt).toBe(1);
        backupDb.close();
      } finally {
        stateDb.close();
      }
    });
  });

  // ===========================================================================
  // attemptSalvage (extended)
  // ===========================================================================
  describe('attemptSalvage (extended)', () => {
    it('merges .backup and .backup.1, getting unique rows from each', { timeout: 15_000 }, () => {
      // .backup.1 has OldBackup (unique to this source)
      const db1 = openStateDb(testVaultPath);
      db1.db.prepare(
        `INSERT INTO wikilink_feedback (entity, context, note_path, correct) VALUES (?, ?, ?, ?)`
      ).run('OldBackup', 'ctx', 'old.md', 1);
      db1.close();
      fs.copyFileSync(dbPath, `${dbPath}.backup.1`);

      // .backup has NewBackup1 + NewBackup2 (unique to this source)
      fs.unlinkSync(dbPath);
      if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
      if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
      const db2 = openStateDb(testVaultPath);
      db2.db.prepare(
        `INSERT INTO wikilink_feedback (entity, context, note_path, correct) VALUES (?, ?, ?, ?)`
      ).run('NewBackup1', 'ctx', 'n1.md', 1);
      db2.db.prepare(
        `INSERT INTO wikilink_feedback (entity, context, note_path, correct) VALUES (?, ?, ?, ?)`
      ).run('NewBackup2', 'ctx', 'n2.md', 1);
      db2.close();
      fs.copyFileSync(dbPath, `${dbPath}.backup`);

      // Fresh target — openStateDb auto-salvages from both sources
      fs.unlinkSync(dbPath);
      if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
      if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
      const targetDb = openStateDb(testVaultPath);

      try {
        // Should have all 3: NewBackup1 + NewBackup2 from .backup, OldBackup from .backup.1
        const rows = targetDb.db.prepare('SELECT COUNT(*) as cnt FROM wikilink_feedback').get() as { cnt: number };
        expect(rows.cnt).toBe(3);
      } finally {
        targetDb.close();
      }
    });

    it('falls back to .corrupt when no backups exist', () => {
      const sourceDb = openStateDb(testVaultPath);
      sourceDb.db.prepare(
        `INSERT INTO wikilink_feedback (entity, context, note_path, correct) VALUES (?, ?, ?, ?)`
      ).run('CorruptSalvage', 'ctx', 'n.md', 1);
      sourceDb.close();

      // Place at .corrupt (no .backup files)
      fs.copyFileSync(dbPath, `${dbPath}.corrupt`);

      // Fresh target
      fs.unlinkSync(dbPath);
      if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
      if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
      const targetDb = openStateDb(testVaultPath);

      try {
        attemptSalvage(targetDb.db, dbPath);
        const rows = targetDb.db.prepare('SELECT COUNT(*) as cnt FROM wikilink_feedback').get() as { cnt: number };
        expect(rows.cnt).toBe(1);
      } finally {
        targetDb.close();
      }
    });
  });

  // ===========================================================================
  // Integration: corruption → fresh → salvage
  // ===========================================================================
  describe('integration: corruption recovery with salvage', () => {
    it('recovers feedback data after corruption', () => {
      // Step 1: Create a DB with feedback data and back it up
      const stateDb = openStateDb(testVaultPath);
      stateDb.db.prepare(
        `INSERT INTO wikilink_feedback (entity, context, note_path, correct, created_at)
         VALUES ('TypeScript', 'test context', 'notes/test.md', 1, datetime('now'))`
      ).run();
      stateDb.db.prepare(
        `INSERT INTO wikilink_applications (entity, note_path, applied_at)
         VALUES ('React', 'notes/app.md', datetime('now'))`
      ).run();
      stateDb.close();

      // Step 2: Create a backup (simulating what safeBackupAsync does)
      fs.copyFileSync(dbPath, `${dbPath}.backup`);

      // Step 3: Corrupt the main DB
      fs.writeFileSync(dbPath, 'this is not a valid sqlite database');

      // Step 4: openStateDb should detect corruption, recreate, and salvage
      const recovered = openStateDb(testVaultPath);
      try {
        const feedbackRows = recovered.db.prepare(
          'SELECT COUNT(*) as cnt FROM wikilink_feedback'
        ).get() as { cnt: number };
        expect(feedbackRows.cnt).toBe(1);

        const appRows = recovered.db.prepare(
          'SELECT COUNT(*) as cnt FROM wikilink_applications'
        ).get() as { cnt: number };
        expect(appRows.cnt).toBe(1);
      } finally {
        recovered.close();
      }
    });

    it('recovers from corruption with rotated backups', () => {
      // Create DB, populate, backup to .backup.1
      const db1 = openStateDb(testVaultPath);
      db1.db.prepare(
        `INSERT INTO wikilink_feedback (entity, context, note_path, correct) VALUES (?, ?, ?, ?)`
      ).run('FromRotated', 'ctx', 'n.md', 1);
      db1.close();
      fs.copyFileSync(dbPath, `${dbPath}.backup.1`);

      // Corrupt the main DB (and no .backup exists)
      fs.writeFileSync(dbPath, 'corrupt data');

      // openStateDb should recover from .backup.1
      const recovered = openStateDb(testVaultPath);
      try {
        const rows = recovered.db.prepare('SELECT COUNT(*) as cnt FROM wikilink_feedback').get() as { cnt: number };
        expect(rows.cnt).toBe(1);
      } finally {
        recovered.close();
      }
    });

    it('salvages from backups when state.db is missing (not just corrupt)', () => {
      // Create a DB with feedback, then back it up
      const stateDb = openStateDb(testVaultPath);
      stateDb.db.prepare(
        `INSERT INTO wikilink_feedback (entity, context, note_path, correct) VALUES (?, ?, ?, ?)`
      ).run('MissingDb', 'ctx', 'n.md', 1);
      stateDb.db.prepare(
        `INSERT INTO wikilink_applications (entity, note_path) VALUES (?, ?)`
      ).run('MissingDb', 'n.md');
      stateDb.close();

      // Simulate a backup existing but state.db deleted (e.g. user deleted it)
      fs.copyFileSync(dbPath, `${dbPath}.backup`);
      fs.unlinkSync(dbPath);
      if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
      if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);

      // openStateDb should create fresh DB AND salvage from .backup
      const recovered = openStateDb(testVaultPath);
      try {
        const feedback = recovered.db.prepare('SELECT COUNT(*) as cnt FROM wikilink_feedback').get() as { cnt: number };
        expect(feedback.cnt).toBe(1);

        const apps = recovered.db.prepare('SELECT COUNT(*) as cnt FROM wikilink_applications').get() as { cnt: number };
        expect(apps.cnt).toBe(1);
      } finally {
        recovered.close();
      }
    });

    it('preserves .corrupt file for forensics', () => {
      const stateDb = openStateDb(testVaultPath);
      stateDb.close();

      // Corrupt the DB
      fs.writeFileSync(dbPath, 'corrupted data for forensics');
      const corruptContent = fs.readFileSync(dbPath);

      // Recovery should preserve the corrupt file
      const recovered = openStateDb(testVaultPath);
      recovered.close();

      const corruptPath = `${dbPath}.corrupt`;
      expect(fs.existsSync(corruptPath)).toBe(true);
      expect(fs.readFileSync(corruptPath)).toEqual(corruptContent);
    });
  });
});
