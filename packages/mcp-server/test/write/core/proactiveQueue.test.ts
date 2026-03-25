import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { openStateDb, deleteStateDb, type StateDb } from '@velvetmonkey/vault-core';
import { createTempVault, cleanupTempVault } from '../../helpers/testUtils.js';
import {
  enqueueProactiveSuggestions,
  drainProactiveQueue,
  expireStaleEntries,
  type QueueEntry,
} from '../../../src/core/write/proactiveQueue.js';

describe('proactiveQueue', () => {
  let tempVault: string;
  let stateDb: StateDb;

  beforeAll(async () => {
    tempVault = await createTempVault();
    stateDb = openStateDb(tempVault);
  });

  afterAll(async () => {
    stateDb?.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  describe('enqueueProactiveSuggestions', () => {
    it('inserts entries into the queue', () => {
      const entries: QueueEntry[] = [
        { notePath: 'a.md', entity: 'Alice', score: 25, confidence: 'high' },
        { notePath: 'a.md', entity: 'Bob', score: 30, confidence: 'high' },
        { notePath: 'b.md', entity: 'Alice', score: 22, confidence: 'high' },
      ];

      const enqueued = enqueueProactiveSuggestions(stateDb, entries);
      expect(enqueued).toBe(3);

      const rows = stateDb.db.prepare(
        `SELECT note_path, entity, score, status FROM proactive_queue WHERE status = 'pending' ORDER BY note_path, entity`,
      ).all() as Array<{ note_path: string; entity: string; score: number; status: string }>;

      expect(rows).toHaveLength(3);
      expect(rows[0]).toMatchObject({ note_path: 'a.md', entity: 'Alice', score: 25 });
      expect(rows[1]).toMatchObject({ note_path: 'a.md', entity: 'Bob', score: 30 });
    });

    it('deduplicates and keeps higher score on re-enqueue', () => {
      // Alice for a.md already queued with score 25
      const entries: QueueEntry[] = [
        { notePath: 'a.md', entity: 'Alice', score: 35, confidence: 'high' },
      ];

      enqueueProactiveSuggestions(stateDb, entries);

      const row = stateDb.db.prepare(
        `SELECT score FROM proactive_queue WHERE note_path = 'a.md' AND entity = 'Alice'`,
      ).get() as { score: number };

      expect(row.score).toBe(35); // upgraded from 25
    });

    it('does not downgrade score on re-enqueue', () => {
      const entries: QueueEntry[] = [
        { notePath: 'a.md', entity: 'Alice', score: 20, confidence: 'high' },
      ];

      enqueueProactiveSuggestions(stateDb, entries);

      const row = stateDb.db.prepare(
        `SELECT score FROM proactive_queue WHERE note_path = 'a.md' AND entity = 'Alice'`,
      ).get() as { score: number };

      expect(row.score).toBe(35); // stays at 35, not downgraded to 20
    });

    it('returns 0 for empty input', () => {
      expect(enqueueProactiveSuggestions(stateDb, [])).toBe(0);
    });
  });

  describe('expireStaleEntries', () => {
    it('expires entries past TTL', () => {
      // Insert an entry with expires_at in the past
      stateDb.db.prepare(`
        INSERT OR REPLACE INTO proactive_queue (note_path, entity, score, confidence, queued_at, expires_at, status)
        VALUES ('stale.md', 'OldEntity', 25, 'high', 0, 1000, 'pending')
      `).run();

      const expired = expireStaleEntries(stateDb);
      expect(expired).toBeGreaterThanOrEqual(1);

      const row = stateDb.db.prepare(
        `SELECT status FROM proactive_queue WHERE note_path = 'stale.md' AND entity = 'OldEntity'`,
      ).get() as { status: string };
      expect(row.status).toBe('expired');
    });

    it('does not expire entries with future TTL', () => {
      const futureMs = Date.now() + 999_999;
      stateDb.db.prepare(`
        INSERT OR REPLACE INTO proactive_queue (note_path, entity, score, confidence, queued_at, expires_at, status)
        VALUES ('fresh.md', 'FreshEntity', 25, 'high', ?, ?, 'pending')
      `).run(Date.now(), futureMs);

      expireStaleEntries(stateDb);

      const row = stateDb.db.prepare(
        `SELECT status FROM proactive_queue WHERE note_path = 'fresh.md' AND entity = 'FreshEntity'`,
      ).get() as { status: string };
      expect(row.status).toBe('pending');
    });
  });

  describe('drainProactiveQueue', () => {
    it('skips files that do not exist on disk', async () => {
      // Clean slate
      stateDb.db.exec(`DELETE FROM proactive_queue`);

      enqueueProactiveSuggestions(stateDb, [
        { notePath: 'active.md', entity: 'TestEntity', score: 30, confidence: 'high' },
      ]);

      const mockApply = async () => ({ applied: ['TestEntity'], skipped: [] });
      const result = await drainProactiveQueue(
        stateDb,
        tempVault,
        { minScore: 20, maxPerFile: 5, maxPerDay: 10 },
        mockApply,
      );

      expect(result.skippedActiveEdit).toBe(1);
      expect(result.applied).toHaveLength(0);
    });

    it('applies to files with old mtime', async () => {
      stateDb.db.exec(`DELETE FROM proactive_queue`);

      // Create file with old mtime (2 minutes ago)
      const idlePath = path.join(tempVault, 'idle.md');
      fs.writeFileSync(idlePath, '# Idle note');
      const oldTime = new Date(Date.now() - 120_000);
      fs.utimesSync(idlePath, oldTime, oldTime);

      enqueueProactiveSuggestions(stateDb, [
        { notePath: 'idle.md', entity: 'IdleEntity', score: 30, confidence: 'high' },
      ]);

      const mockApply = async () => ({ applied: ['IdleEntity'], skipped: [] });
      const result = await drainProactiveQueue(
        stateDb,
        tempVault,
        { minScore: 20, maxPerFile: 5, maxPerDay: 10 },
        mockApply,
      );

      expect(result.applied).toHaveLength(1);
      expect(result.applied[0]).toMatchObject({ file: 'idle.md', entities: ['IdleEntity'] });

      // Queue entry should be marked applied
      const row = stateDb.db.prepare(
        `SELECT status FROM proactive_queue WHERE note_path = 'idle.md' AND entity = 'IdleEntity'`,
      ).get() as { status: string };
      expect(row.status).toBe('applied');
    });

    it('respects daily cap', async () => {
      stateDb.db.exec(`DELETE FROM proactive_queue`);

      // Create file with old mtime so it passes the mtime guard
      const cappedPath = path.join(tempVault, 'capped.md');
      fs.writeFileSync(cappedPath, '# Capped note');
      const oldTime = new Date(Date.now() - 120_000);
      fs.utimesSync(cappedPath, oldTime, oldTime);

      // Seed wikilink_applications to simulate 10 already applied today
      const today = new Date().toISOString().slice(0, 10);
      for (let i = 0; i < 10; i++) {
        stateDb.db.prepare(
          `INSERT OR IGNORE INTO wikilink_applications (entity, note_path, applied_at) VALUES (?, 'capped.md', ?)`,
        ).run(`Entity${i}`, `${today} 12:00:00`);
      }

      enqueueProactiveSuggestions(stateDb, [
        { notePath: 'capped.md', entity: 'OneMore', score: 30, confidence: 'high' },
      ]);

      const mockApply = async () => ({ applied: ['OneMore'], skipped: [] });
      const result = await drainProactiveQueue(
        stateDb,
        tempVault,
        { minScore: 20, maxPerFile: 5, maxPerDay: 10 },
        mockApply,
      );

      expect(result.skippedDailyCap).toBe(1);
      expect(result.applied).toHaveLength(0);
    });

    it('handles mtime-blocked files gracefully (leaves pending)', async () => {
      stateDb.db.exec(`DELETE FROM proactive_queue`);

      // Create file with fresh mtime (just now) — drain's mtime guard will skip
      const blockedPath = path.join(tempVault, 'blocked.md');
      fs.writeFileSync(blockedPath, '# Blocked note');

      enqueueProactiveSuggestions(stateDb, [
        { notePath: 'blocked.md', entity: 'BlockedEntity', score: 30, confidence: 'high' },
      ]);

      const mockApply = async () => ({ applied: ['BlockedEntity'], skipped: [] });
      const result = await drainProactiveQueue(
        stateDb,
        tempVault,
        { minScore: 20, maxPerFile: 5, maxPerDay: 10 },
        mockApply,
      );

      expect(result.skippedActiveEdit).toBe(1);

      // Entry should still be pending for retry
      const row = stateDb.db.prepare(
        `SELECT status FROM proactive_queue WHERE note_path = 'blocked.md' AND entity = 'BlockedEntity'`,
      ).get() as { status: string };
      expect(row.status).toBe('pending');
    });
  });
});
