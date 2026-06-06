/**
 * Proactive Queue Drain — Rejection Diagnostics (P42 Issue 2)
 *
 * Verifies drainProactiveQueue populates rejection reasons for every
 * candidate that was dropped, so flywheel_doctor can surface why items
 * stay pending forever.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { openStateDb, type StateDb } from '@velvetmonkey/vault-core';
import {
  enqueueProactiveSuggestions,
  drainProactiveQueue,
  purgeProactiveForDeleted,
} from '../../src/core/write/proactiveQueue.js';

describe('Proactive Queue Drain — rejection diagnostics', () => {
  let vaultPath: string;
  let stateDb: StateDb;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), 'pq-drain-'));
    stateDb = openStateDb(vaultPath);
  });

  afterEach(() => {
    stateDb?.close();
    rmSync(vaultPath, { recursive: true, force: true });
  });

  const writeNote = (rel: string, ageMs = 5 * 60_000): void => {
    const full = join(vaultPath, rel);
    writeFileSync(full, '# Note\n\nSome content about TypeScript.\n');
    const mtime = new Date(Date.now() - ageMs);
    utimesSync(full, mtime, mtime);
  };

  it('records apply_empty rejection when applyFn returns nothing', async () => {
    writeNote('note-a.md');
    enqueueProactiveSuggestions(stateDb, [
      { notePath: 'note-a.md', entity: 'TypeScript', score: 30, confidence: 'high' },
      { notePath: 'note-a.md', entity: 'React', score: 25, confidence: 'high' },
    ]);

    const result = await drainProactiveQueue(
      stateDb,
      vaultPath,
      { minScore: 20, maxPerFile: 5, maxPerDay: 10 },
      async () => ({ applied: [], skipped: ['TypeScript', 'React'] }),
    );

    expect(result.applied).toHaveLength(0);
    expect(result.rejections).toHaveLength(2);
    expect(result.rejections.every(r => r.reason === 'apply_empty')).toBe(true);
    expect(result.rejections.map(r => r.entity).sort()).toEqual(['React', 'TypeScript']);
    expect(result.rejections[0].score).toBeGreaterThanOrEqual(20);
  });

  it('records active_edit rejection for files modified within mtime guard', async () => {
    writeNote('hot-note.md', 1000); // 1 second old — inside 60s guard
    enqueueProactiveSuggestions(stateDb, [
      { notePath: 'hot-note.md', entity: 'TypeScript', score: 30, confidence: 'high' },
    ]);

    const result = await drainProactiveQueue(
      stateDb,
      vaultPath,
      { minScore: 20, maxPerFile: 5, maxPerDay: 10 },
      async () => ({ applied: ['TypeScript'], skipped: [] }),
    );

    expect(result.skippedActiveEdit).toBe(1);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].reason).toBe('active_edit');
    expect(result.rejections[0].detail).toMatch(/mtime age/);
  });

  it('marks entries for missing notes terminal (note_missing) instead of leaving them pending', async () => {
    enqueueProactiveSuggestions(stateDb, [
      { notePath: 'ghost.md', entity: 'Ghost', score: 30, confidence: 'high' },
    ]);

    const result = await drainProactiveQueue(
      stateDb,
      vaultPath,
      { minScore: 20, maxPerFile: 5, maxPerDay: 10 },
      async () => ({ applied: [], skipped: [] }),
    );

    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].reason).toBe('note_missing');
    expect(result.purgedMissing).toBe(1);
    expect(result.skippedActiveEdit).toBe(0); // no longer mislabeled
    expect(result.skippedStatFailed).toBe(0);

    // Entry is terminal — it will not be re-checked on the next drain.
    const row = stateDb.db.prepare(
      `SELECT status FROM proactive_queue WHERE note_path = 'ghost.md' AND entity = 'Ghost'`,
    ).get() as { status: string };
    expect(row.status).toBe('expired');
  });

  it('clears an entire ghost backlog in one drain', async () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      notePath: `deleted/run-${i}.md`,
      entity: `Ent${i}`,
      score: 30,
      confidence: 'high',
    }));
    enqueueProactiveSuggestions(stateDb, entries);

    const result = await drainProactiveQueue(
      stateDb,
      vaultPath,
      { minScore: 20, maxPerFile: 5, maxPerDay: 10 },
      async () => ({ applied: [], skipped: [] }),
    );

    expect(result.purgedMissing).toBe(20);
    const pending = stateDb.db.prepare(
      `SELECT COUNT(*) as cnt FROM proactive_queue WHERE status = 'pending'`,
    ).get() as { cnt: number };
    expect(pending.cnt).toBe(0);
  });

  it('records daily_cap rejection and marks rows expired', async () => {
    writeNote('capped.md');

    // Seed today's applications up to the cap
    const now = new Date().toISOString();
    const insert = stateDb.db.prepare(
      `INSERT INTO wikilink_applications (entity, note_path, applied_at, source) VALUES (?, ?, ?, 'proactive')`,
    );
    for (let i = 0; i < 10; i++) insert.run(`seed${i}`, 'capped.md', now);

    enqueueProactiveSuggestions(stateDb, [
      { notePath: 'capped.md', entity: 'Overflow', score: 30, confidence: 'high' },
    ]);

    const result = await drainProactiveQueue(
      stateDb,
      vaultPath,
      { minScore: 20, maxPerFile: 5, maxPerDay: 10 },
      async () => ({ applied: ['Overflow'], skipped: [] }),
    );

    expect(result.skippedDailyCap).toBe(1);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].reason).toBe('daily_cap');
    expect(result.rejections[0].detail).toMatch(/today=10/);

    const row = stateDb.db.prepare(
      `SELECT status FROM proactive_queue WHERE note_path = 'capped.md' AND entity = 'Overflow'`,
    ).get() as { status: string };
    expect(row.status).toBe('expired');
  });

  it('partial apply — marks only unapplied entities as rejected', async () => {
    writeNote('partial.md');
    enqueueProactiveSuggestions(stateDb, [
      { notePath: 'partial.md', entity: 'A', score: 30, confidence: 'high' },
      { notePath: 'partial.md', entity: 'B', score: 30, confidence: 'high' },
      { notePath: 'partial.md', entity: 'C', score: 30, confidence: 'high' },
    ]);

    const result = await drainProactiveQueue(
      stateDb,
      vaultPath,
      { minScore: 20, maxPerFile: 5, maxPerDay: 10 },
      async () => ({ applied: ['A'], skipped: ['B', 'C'] }),
    );

    expect(result.applied).toHaveLength(1);
    expect(result.rejections).toHaveLength(2);
    expect(result.rejections.map(r => r.entity).sort()).toEqual(['B', 'C']);
    expect(result.rejections.every(r => r.reason === 'apply_empty')).toBe(true);
  });

  it('mixed-reason drain aggregates into a rejection_breakdown histogram', async () => {
    // Reproduces the pipeline.ts aggregation path: the persistence layer
    // computes `byReason` from the full rejection list and stores it in
    // last_proactive_drain so flywheel_doctor can surface top reasons.
    writeNote('fine.md');                 // will apply_empty (applyFn returns [])
    writeNote('hot.md', 1000);            // < 60s → active_edit
    // ghost.md — missing → note_missing (terminal)

    enqueueProactiveSuggestions(stateDb, [
      { notePath: 'fine.md', entity: 'EntFine1', score: 30, confidence: 'high' },
      { notePath: 'fine.md', entity: 'EntFine2', score: 30, confidence: 'high' },
      { notePath: 'hot.md', entity: 'EntHot', score: 30, confidence: 'high' },
      { notePath: 'ghost.md', entity: 'EntGhost', score: 30, confidence: 'high' },
    ]);

    const result = await drainProactiveQueue(
      stateDb,
      vaultPath,
      { minScore: 20, maxPerFile: 5, maxPerDay: 10 },
      async () => ({ applied: [], skipped: [] }),
    );

    // Same aggregation shape pipeline.ts persists.
    const byReason: Record<string, number> = {};
    for (const r of result.rejections) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;

    expect(byReason.apply_empty).toBe(2);
    expect(byReason.active_edit).toBe(1);
    expect(byReason.note_missing).toBe(1);
    expect(Object.values(byReason).reduce((a, b) => a + b, 0)).toBe(result.rejections.length);
  });

  it('re-enqueue does not reset expires_at (TTL anchors to first enqueue)', async () => {
    enqueueProactiveSuggestions(stateDb, [
      { notePath: 'anchored.md', entity: 'Anchor', score: 20, confidence: 'high' },
    ]);
    const first = stateDb.db.prepare(
      `SELECT expires_at, score FROM proactive_queue WHERE note_path = 'anchored.md' AND entity = 'Anchor'`,
    ).get() as { expires_at: number; score: number };

    await new Promise(r => setTimeout(r, 10));
    enqueueProactiveSuggestions(stateDb, [
      { notePath: 'anchored.md', entity: 'Anchor', score: 35, confidence: 'high' },
    ]);

    const second = stateDb.db.prepare(
      `SELECT expires_at, score FROM proactive_queue WHERE note_path = 'anchored.md' AND entity = 'Anchor'`,
    ).get() as { expires_at: number; score: number };

    expect(second.score).toBe(35); // score still upgrades
    expect(second.expires_at).toBe(first.expires_at); // TTL not refreshed
  });

  it('purgeProactiveForDeleted expires only entries for the deleted paths', async () => {
    enqueueProactiveSuggestions(stateDb, [
      { notePath: 'gone.md', entity: 'A', score: 30, confidence: 'high' },
      { notePath: 'gone.md', entity: 'B', score: 25, confidence: 'high' },
      { notePath: 'stays.md', entity: 'C', score: 30, confidence: 'high' },
    ]);

    const purged = purgeProactiveForDeleted(stateDb, ['gone.md']);

    expect(purged).toBe(2);
    const rows = stateDb.db.prepare(
      `SELECT note_path, status FROM proactive_queue ORDER BY note_path, entity`,
    ).all() as Array<{ note_path: string; status: string }>;
    expect(rows.map(r => `${r.note_path}:${r.status}`)).toEqual([
      'gone.md:expired',
      'gone.md:expired',
      'stays.md:pending',
    ]);
  });

  it('records apply_error when applyFn throws', async () => {
    writeNote('boom.md');
    enqueueProactiveSuggestions(stateDb, [
      { notePath: 'boom.md', entity: 'Kaboom', score: 30, confidence: 'high' },
    ]);

    const result = await drainProactiveQueue(
      stateDb,
      vaultPath,
      { minScore: 20, maxPerFile: 5, maxPerDay: 10 },
      async () => { throw new Error('disk on fire'); },
    );

    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].reason).toBe('apply_error');
    expect(result.rejections[0].detail).toMatch(/disk on fire/);
  });
});
