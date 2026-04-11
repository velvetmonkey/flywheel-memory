/**
 * Tests for v40 COLLATE NOCASE migration.
 *
 * Strategy: open a fresh state DB (which is at v40), drop the affected tables,
 * recreate them WITHOUT the new collation to simulate a v39 schema, set
 * schema_version back to 39, seed mixed-case rows, then call migrateV40()
 * directly and verify each table's conflict-resolution rule.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { openStateDb, migrateV40, initSchema } from '@velvetmonkey/vault-core';
import type { StateDb } from '@velvetmonkey/vault-core';

describe('v40 COLLATE NOCASE migration', () => {
  let testVaultPath: string;
  let stateDb: StateDb;

  beforeEach(() => {
    testVaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'v40-mig-test-'));
    stateDb = openStateDb(testVaultPath);

    // Roll the affected tables back to a v39 shape (no COLLATE NOCASE).
    // Foreign keys off so DROP doesn't trip on cross-table refs (none here, but defensive).
    stateDb.db.pragma('foreign_keys = OFF');
    stateDb.db.exec(`
      DROP TABLE IF EXISTS note_embeddings;
      CREATE TABLE note_embeddings (
        path TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        content_hash TEXT NOT NULL,
        model TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      DROP TABLE IF EXISTS content_hashes;
      CREATE TABLE content_hashes (
        path TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      DROP TABLE IF EXISTS note_tags;
      CREATE TABLE note_tags (
        note_path TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (note_path, tag)
      );

      DROP TABLE IF EXISTS note_links;
      CREATE TABLE note_links (
        note_path TEXT NOT NULL,
        target TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        weight_updated_at INTEGER,
        PRIMARY KEY (note_path, target)
      );

      DROP TABLE IF EXISTS proactive_queue;
      CREATE TABLE proactive_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note_path TEXT NOT NULL,
        entity TEXT NOT NULL,
        score REAL NOT NULL,
        confidence TEXT NOT NULL,
        queued_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        applied_at INTEGER,
        UNIQUE(note_path, entity)
      );

      DROP TABLE IF EXISTS retrieval_cooccurrence;
      CREATE TABLE retrieval_cooccurrence (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note_a TEXT NOT NULL,
        note_b TEXT NOT NULL,
        session_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        UNIQUE(note_a, note_b, session_id)
      );

      DROP TABLE IF EXISTS prospect_ledger;
      CREATE TABLE prospect_ledger (
        term TEXT NOT NULL,
        display_name TEXT NOT NULL,
        note_path TEXT NOT NULL,
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

      DELETE FROM schema_version;
      INSERT INTO schema_version (version) VALUES (39);
    `);
  });

  afterEach(() => {
    try { stateDb.db.close(); } catch { /* ignore */ }
    fs.rmSync(testVaultPath, { recursive: true, force: true });
  });

  it('note_embeddings: dedups LOWER(path), keeps row with MAX(updated_at)', () => {
    const blobOld = Buffer.from([1, 2, 3]);
    const blobNew = Buffer.from([9, 8, 7]);
    stateDb.db.prepare(
      `INSERT INTO note_embeddings (path, embedding, content_hash, model, updated_at) VALUES (?, ?, ?, ?, ?)`
    ).run('Notes/Foo.md', blobOld, 'hash-old', 'm1', 1000);
    stateDb.db.prepare(
      `INSERT INTO note_embeddings (path, embedding, content_hash, model, updated_at) VALUES (?, ?, ?, ?, ?)`
    ).run('notes/foo.md', blobNew, 'hash-new', 'm1', 2000);

    migrateV40(stateDb.db);

    const rows = stateDb.db.prepare(`SELECT path, content_hash, updated_at FROM note_embeddings`).all() as Array<{ path: string; content_hash: string; updated_at: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].content_hash).toBe('hash-new');
    expect(rows[0].updated_at).toBe(2000);
  });

  it('content_hashes: collapses LOWER(path) duplicates to latest', () => {
    stateDb.db.prepare(`INSERT INTO content_hashes (path, hash, updated_at) VALUES (?, ?, ?)`).run('A/B.md', 'old', 100);
    stateDb.db.prepare(`INSERT INTO content_hashes (path, hash, updated_at) VALUES (?, ?, ?)`).run('a/b.md', 'new', 200);

    migrateV40(stateDb.db);

    const rows = stateDb.db.prepare(`SELECT hash FROM content_hashes`).all() as Array<{ hash: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].hash).toBe('new');
  });

  it('note_tags: pure dedup via INSERT OR IGNORE', () => {
    stateDb.db.prepare(`INSERT INTO note_tags (note_path, tag) VALUES (?, ?)`).run('Notes/X.md', 'tag1');
    stateDb.db.prepare(`INSERT INTO note_tags (note_path, tag) VALUES (?, ?)`).run('notes/x.md', 'tag1');
    stateDb.db.prepare(`INSERT INTO note_tags (note_path, tag) VALUES (?, ?)`).run('Notes/X.md', 'tag2');

    migrateV40(stateDb.db);

    const rows = stateDb.db.prepare(`SELECT tag FROM note_tags ORDER BY tag`).all() as Array<{ tag: string }>;
    expect(rows.map(r => r.tag).sort()).toEqual(['tag1', 'tag2']);
  });

  it('note_links: keeps row with latest weight_updated_at', () => {
    stateDb.db.prepare(`INSERT INTO note_links (note_path, target, weight, weight_updated_at) VALUES (?, ?, ?, ?)`).run('Notes/A.md', 'TargetX', 0.5, 100);
    stateDb.db.prepare(`INSERT INTO note_links (note_path, target, weight, weight_updated_at) VALUES (?, ?, ?, ?)`).run('notes/a.md', 'TargetX', 0.9, 200);

    migrateV40(stateDb.db);

    const rows = stateDb.db.prepare(`SELECT weight, weight_updated_at FROM note_links`).all() as Array<{ weight: number; weight_updated_at: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].weight).toBe(0.9);
    expect(rows[0].weight_updated_at).toBe(200);
  });

  it('proactive_queue: prefers higher score, then status=pending on tie', () => {
    // Same case-folded path+entity, same score; one applied, one pending. Pending should win.
    stateDb.db.prepare(`INSERT INTO proactive_queue (note_path, entity, score, confidence, queued_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('Notes/Q.md', 'Ent', 0.7, 'med', 1000, 9999, 'applied');
    stateDb.db.prepare(`INSERT INTO proactive_queue (note_path, entity, score, confidence, queued_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('notes/q.md', 'Ent', 0.7, 'med', 1100, 9999, 'pending');
    // Different group: higher score wins regardless of status.
    stateDb.db.prepare(`INSERT INTO proactive_queue (note_path, entity, score, confidence, queued_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('Notes/R.md', 'Ent', 0.3, 'low', 1000, 9999, 'pending');
    stateDb.db.prepare(`INSERT INTO proactive_queue (note_path, entity, score, confidence, queued_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('notes/r.md', 'Ent', 0.9, 'high', 1000, 9999, 'applied');

    migrateV40(stateDb.db);

    const rows = stateDb.db.prepare(`SELECT note_path, score, status, confidence FROM proactive_queue ORDER BY note_path COLLATE NOCASE`).all() as Array<{ note_path: string; score: number; status: string; confidence: string }>;
    expect(rows).toHaveLength(2);
    // First row (Q): score tie → pending wins
    const qRow = rows.find(r => r.note_path.toLowerCase() === 'notes/q.md')!;
    expect(qRow.status).toBe('pending');
    // Second row (R): score 0.9 wins
    const rRow = rows.find(r => r.note_path.toLowerCase() === 'notes/r.md')!;
    expect(rRow.score).toBe(0.9);
    expect(rRow.confidence).toBe('high');
  });

  it('retrieval_cooccurrence: sums weights across case variants', () => {
    stateDb.db.prepare(`INSERT INTO retrieval_cooccurrence (note_a, note_b, session_id, timestamp, weight) VALUES (?, ?, ?, ?, ?)`)
      .run('Notes/X.md', 'Notes/Y.md', 'sess', 100, 0.5);
    stateDb.db.prepare(`INSERT INTO retrieval_cooccurrence (note_a, note_b, session_id, timestamp, weight) VALUES (?, ?, ?, ?, ?)`)
      .run('notes/x.md', 'notes/y.md', 'sess', 200, 0.7);

    migrateV40(stateDb.db);

    const rows = stateDb.db.prepare(`SELECT timestamp, weight FROM retrieval_cooccurrence`).all() as Array<{ timestamp: number; weight: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].weight).toBeCloseTo(1.2);
    expect(rows[0].timestamp).toBe(100); // MIN
  });

  it('prospect_ledger: sums sighting_count, takes display_name from latest last_seen_at', () => {
    stateDb.db.prepare(`INSERT INTO prospect_ledger (term, display_name, note_path, seen_day, source, confidence, backlink_count, score, first_seen_at, last_seen_at, sighting_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('foo', 'Foo (old)', 'Notes/P.md', '2026-01-01', 'src1', 'low', 1, 0.3, 100, 200, 5);
    stateDb.db.prepare(`INSERT INTO prospect_ledger (term, display_name, note_path, seen_day, source, confidence, backlink_count, score, first_seen_at, last_seen_at, sighting_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('foo', 'Foo (new)', 'notes/p.md', '2026-01-01', 'src2', 'high', 3, 0.8, 150, 300, 7);

    migrateV40(stateDb.db);

    const rows = stateDb.db.prepare(`SELECT display_name, sighting_count, score, first_seen_at, last_seen_at FROM prospect_ledger`).all() as Array<{ display_name: string; sighting_count: number; score: number; first_seen_at: number; last_seen_at: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].display_name).toBe('Foo (new)'); // latest last_seen_at wins
    expect(rows[0].sighting_count).toBe(12); // SUM
    expect(rows[0].score).toBeCloseTo(0.8); // MAX
    expect(rows[0].first_seen_at).toBe(100); // MIN
    expect(rows[0].last_seen_at).toBe(300); // MAX
  });

  it('post-migration: COLLATE NOCASE prevents new mixed-case duplicates', () => {
    migrateV40(stateDb.db);

    // After migration, inserting mixed-case path should conflict via UNIQUE.
    stateDb.db.prepare(`INSERT INTO content_hashes (path, hash, updated_at) VALUES (?, ?, ?)`).run('NEW/F.md', 'h1', 100);
    expect(() =>
      stateDb.db.prepare(`INSERT INTO content_hashes (path, hash, updated_at) VALUES (?, ?, ?)`).run('new/f.md', 'h2', 200)
    ).toThrow(/UNIQUE constraint/);
  });

  it('FLYWHEEL_MIGRATION_DRY_RUN=1: skips apply and returns false', () => {
    stateDb.db.prepare(`INSERT INTO content_hashes (path, hash, updated_at) VALUES (?, ?, ?)`).run('Dup/A.md', 'old', 100);
    stateDb.db.prepare(`INSERT INTO content_hashes (path, hash, updated_at) VALUES (?, ?, ?)`).run('dup/a.md', 'new', 200);

    const prev = process.env.FLYWHEEL_MIGRATION_DRY_RUN;
    process.env.FLYWHEEL_MIGRATION_DRY_RUN = '1';
    try {
      const applied = migrateV40(stateDb.db);
      expect(applied).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.FLYWHEEL_MIGRATION_DRY_RUN;
      else process.env.FLYWHEEL_MIGRATION_DRY_RUN = prev;
    }

    // Both rows still present (no rebuild happened)
    const count = stateDb.db.prepare(`SELECT COUNT(*) AS c FROM content_hashes`).get() as { c: number };
    expect(count.c).toBe(2);
  });

  it('FLYWHEEL_MIGRATION_DRY_RUN=1 via initSchema: schema_version stays at 39', () => {
    // Verify the trailing INSERT OR IGNORE in initSchema is gated on
    // v40Applied. Without the gate, dry-run would mark the DB as v40 even
    // though no rebuild happened — next boot would skip the migration entirely.
    const prev = process.env.FLYWHEEL_MIGRATION_DRY_RUN;
    process.env.FLYWHEEL_MIGRATION_DRY_RUN = '1';
    try {
      initSchema(stateDb.db);
      const v = stateDb.db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number };
      expect(v.v).toBe(39);
    } finally {
      if (prev === undefined) delete process.env.FLYWHEEL_MIGRATION_DRY_RUN;
      else process.env.FLYWHEEL_MIGRATION_DRY_RUN = prev;
    }
  });
});
