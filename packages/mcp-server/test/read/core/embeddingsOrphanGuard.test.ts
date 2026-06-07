/**
 * Tests for the orphan-cleanup guards in removeOrphanedNoteEmbeddings and the
 * FTS5 abort-on-empty safety — the 2026-06-06 embeddings-wipe failure mode
 * (failed/empty FTS rebuild → every embedding considered orphaned → 3,023 → 0).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  createTempVault,
  cleanupTempVault,
  openStateDb,
  deleteStateDb,
  createTestNote,
  type StateDb,
} from '../../helpers/testUtils.js';
import {
  removeOrphanedNoteEmbeddings,
  setEmbeddingsDatabase,
} from '../../../src/core/read/embeddings.js';
import { buildFTS5Index, setFTS5Database } from '../../../src/core/read/fts5.js';
import { scanVault } from '../../../src/core/read/vault.js';

function insertEmbedding(stateDb: StateDb, path: string): void {
  stateDb.db.prepare(`
    INSERT INTO note_embeddings (path, embedding, content_hash, model, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(path, Buffer.alloc(16), `hash-${path}`, 'test-model', Date.now());
}

function insertFtsRow(stateDb: StateDb, path: string): void {
  stateDb.db.prepare(`
    INSERT INTO notes_fts (path, title, frontmatter, content) VALUES (?, ?, ?, ?)
  `).run(path, path, '', 'content');
}

function embeddingCount(stateDb: StateDb): number {
  return (stateDb.db.prepare('SELECT COUNT(*) as cnt FROM note_embeddings').get() as { cnt: number }).cnt;
}

describe('removeOrphanedNoteEmbeddings guards', () => {
  let vaultPath: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    vaultPath = await createTempVault();
    stateDb = openStateDb(vaultPath);
    setEmbeddingsDatabase(stateDb.db);
  });

  afterEach(async () => {
    stateDb.db.close();
    deleteStateDb(vaultPath);
    await cleanupTempVault(vaultPath);
  });

  it('refuses to delete anything when notes_fts is empty (the witnessed wipe)', () => {
    insertEmbedding(stateDb, 'a.md');
    insertEmbedding(stateDb, 'b.md');
    insertEmbedding(stateDb, 'c.md');

    const removed = removeOrphanedNoteEmbeddings();

    expect(removed).toBe(0);
    expect(embeddingCount(stateDb)).toBe(3);
  });

  it('aborts via ratio guard when a partial FTS index would delete >50%', () => {
    for (const p of ['a.md', 'b.md', 'c.md', 'd.md']) insertEmbedding(stateDb, p);
    insertFtsRow(stateDb, 'a.md'); // FTS only knows 1 of 4 → would delete 75%

    const removed = removeOrphanedNoteEmbeddings();

    expect(removed).toBe(0);
    expect(embeddingCount(stateDb)).toBe(4);
  });

  it('removes a genuine orphan below the ratio threshold', () => {
    for (const p of ['a.md', 'b.md', 'c.md', 'd.md']) insertEmbedding(stateDb, p);
    for (const p of ['a.md', 'b.md', 'c.md']) insertFtsRow(stateDb, p); // d.md orphaned (25%)

    const removed = removeOrphanedNoteEmbeddings();

    expect(removed).toBe(1);
    expect(embeddingCount(stateDb)).toBe(3);
    const remaining = stateDb.db.prepare('SELECT path FROM note_embeddings ORDER BY path').all() as Array<{ path: string }>;
    expect(remaining.map(r => r.path)).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('trusted validPaths bypasses the ratio guard (legitimate mass deletion)', () => {
    for (const p of ['a.md', 'b.md', 'c.md', 'd.md']) insertEmbedding(stateDb, p);

    const removed = removeOrphanedNoteEmbeddings(new Set(['a.md'])); // 75% delete, but trusted

    expect(removed).toBe(3);
    expect(embeddingCount(stateDb)).toBe(1);
  });

  it('refuses to delete when validPaths is empty (vault index not built)', () => {
    insertEmbedding(stateDb, 'a.md');

    const removed = removeOrphanedNoteEmbeddings(new Set());

    expect(removed).toBe(0);
    expect(embeddingCount(stateDb)).toBe(1);
  });

  it('case-only path differences do not count as orphans (NOCASE semantics)', () => {
    insertEmbedding(stateDb, 'Notes/Foo.md');
    insertEmbedding(stateDb, 'gone.md');

    const removed = removeOrphanedNoteEmbeddings(new Set(['notes/foo.md']));

    expect(removed).toBe(1);
    const remaining = stateDb.db.prepare('SELECT path FROM note_embeddings').all() as Array<{ path: string }>;
    expect(remaining.map(r => r.path)).toEqual(['Notes/Foo.md']);
  });
});

describe('FTS5 abort-on-empty safety', () => {
  let vaultPath: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    vaultPath = await createTempVault();
    stateDb = openStateDb(vaultPath);
    setFTS5Database(stateDb.db);
  });

  afterEach(async () => {
    stateDb.db.close();
    deleteStateDb(vaultPath);
    await cleanupTempVault(vaultPath);
  });

  // chmod(0o000) is a no-op on Windows ACLs — the file stays readable, the
  // guard never trips, and the rejects assertion fails. POSIX-only by nature.
  it.skipIf(process.platform === 'win32')('refuses to swap an empty set when files exist but none were readable', async () => {
    insertFtsRow(stateDb, 'existing.md');
    await createTestNote(vaultPath, 'locked.md', '# Locked\n\nsecret');
    const lockedPath = path.join(vaultPath, 'locked.md');
    fs.chmodSync(lockedPath, 0o000); // statSync ok, readFileSync fails → 0 rows

    try {
      await expect(buildFTS5Index(vaultPath)).rejects.toThrow(/refusing to swap in an empty index/);
      const count = (stateDb.db.prepare('SELECT COUNT(*) as cnt FROM notes_fts').get() as { cnt: number }).cnt;
      expect(count).toBe(1); // old index preserved
    } finally {
      fs.chmodSync(lockedPath, 0o644);
    }
  });

  it('allows an empty swap when the vault is genuinely empty (legitimate mass deletion)', async () => {
    insertFtsRow(stateDb, 'all-deleted.md'); // stale index from before the wipe

    const state = await buildFTS5Index(vaultPath); // temp vault has no md files

    expect(state.ready).toBe(true);
    expect(state.noteCount).toBe(0);
    const count = (stateDb.db.prepare('SELECT COUNT(*) as cnt FROM notes_fts').get() as { cnt: number }).cnt;
    expect(count).toBe(0);
  });

  it('builds normally when the vault has readable notes', async () => {
    insertFtsRow(stateDb, 'stale.md');
    await createTestNote(vaultPath, 'real.md', '# Real\n\ncontent');

    const state = await buildFTS5Index(vaultPath);

    expect(state.ready).toBe(true);
    expect(state.noteCount).toBe(1);
    const rows = stateDb.db.prepare('SELECT path FROM notes_fts').all() as Array<{ path: string }>;
    expect(rows.map(r => r.path)).toEqual(['real.md']);
  });
});

describe('scanVault root failure', () => {
  it('throws on an unreadable vault root instead of returning []', async () => {
    await expect(scanVault('/nonexistent-vault-root-for-test')).rejects.toThrow(/cannot read vault root/);
  });
});
