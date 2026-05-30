/**
 * Suppression: implicit:removed cooldown + durable manual-unsuppress override.
 *
 * Regression coverage for two bugs:
 *  1. Single-note link churn cast dozens of implicit:removed votes (no cooldown
 *     on the negative side, unlike implicit:survived), wrongly auto-suppressing
 *     legitimate entities (e.g. "puff": 74 removals from ONE note in one day).
 *  2. Manual unsuppress was a bare DELETE — the next updateSuppressionList()
 *     recompute re-suppressed from unchanged feedback. Now a durable override
 *     is recorded and honored everywhere suppression is decided.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { openStateDb, deleteStateDb, type StateDb } from '@velvetmonkey/vault-core';
import {
  recordFeedback,
  recordImplicitRemoved,
  trackWikilinkApplications,
  processImplicitFeedback,
  updateSuppressionList,
  isSuppressed,
  suppressEntity,
  unsuppressEntity,
  getAllSuppressionPenalties,
  getSuppressionOverrides,
} from '../../../src/core/write/wikilinkFeedback.js';

function removedCount(stateDb: StateDb, entity: string, notePath?: string): number {
  const sql = notePath
    ? `SELECT COUNT(*) n FROM wikilink_feedback WHERE entity = ? COLLATE NOCASE AND context = 'implicit:removed' AND note_path = ?`
    : `SELECT COUNT(*) n FROM wikilink_feedback WHERE entity = ? COLLATE NOCASE AND context = 'implicit:removed'`;
  const args = notePath ? [entity, notePath] : [entity];
  return (stateDb.db.prepare(sql).get(...args) as { n: number }).n;
}

describe('wikilink suppression: cooldown + durable override', () => {
  let tempDir: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'supp-test-'));
    stateDb = openStateDb(tempDir);
  });

  afterEach(async () => {
    try { stateDb.db.close(); } catch { /* ignore */ }
    try { deleteStateDb(tempDir); } catch { /* ignore */ }
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Fix 1 — implicit:removed cooldown', () => {
    it('recordImplicitRemoved collapses same-(entity,note) repeats to one per 24h', () => {
      const note = 'daily-notes/2026-05-08.md';
      const first = recordImplicitRemoved(stateDb, 'puff', note, 1.0);
      const second = recordImplicitRemoved(stateDb, 'puff', note, 1.0);
      const third = recordImplicitRemoved(stateDb, 'PUFF', note, 0.8); // case-insensitive
      expect(first).toBe(true);
      expect(second).toBe(false);
      expect(third).toBe(false);
      expect(removedCount(stateDb, 'puff', note)).toBe(1);
    });

    it('distinct notes are NOT collapsed (each genuine removal counts)', () => {
      expect(recordImplicitRemoved(stateDb, 'puff', 'a.md', 1.0)).toBe(true);
      expect(recordImplicitRemoved(stateDb, 'puff', 'b.md', 1.0)).toBe(true);
      expect(removedCount(stateDb, 'puff')).toBe(2);
    });

    it('processImplicitFeedback add→remove→re-add churn yields ONE removed row', () => {
      const note = 'daily-notes/churn.md';
      for (let i = 0; i < 5; i++) {
        trackWikilinkApplications(stateDb, note, ['puff']);
        processImplicitFeedback(stateDb, note, 'content with no links at all');
      }
      expect(removedCount(stateDb, 'puff', note)).toBe(1);
    });
  });

  describe('Fix 2 — durable manual-unsuppress override', () => {
    // Seed enough false-positive feedback (distinct notes, bypassing the
    // cooldown) to push the entity below the suppression posterior threshold.
    function seedSuppressible(entity: string): void {
      for (let i = 0; i < 20; i++) {
        recordFeedback(stateDb, entity, 'implicit:removed', `note-${i}.md`, false, 1.0);
      }
    }

    it('unsuppress sticks across updateSuppressionList recomputes', () => {
      seedSuppressible('puff');
      updateSuppressionList(stateDb);
      expect(isSuppressed(stateDb, 'puff')).toBe(true);

      const wasSuppressed = unsuppressEntity(stateDb, 'puff');
      expect(wasSuppressed).toBe(true);
      expect(getSuppressionOverrides(stateDb).has('puff')).toBe(true);
      expect(isSuppressed(stateDb, 'puff')).toBe(false);

      // The recompute must NOT re-suppress (the override wins).
      updateSuppressionList(stateDb);
      expect(isSuppressed(stateDb, 'puff')).toBe(false);

      // And suggestion ranking must not demote it either.
      expect(getAllSuppressionPenalties(stateDb).has('puff')).toBe(false);
    });

    it('explicit suppressEntity clears the override (re-suppressible)', () => {
      seedSuppressible('puff');
      unsuppressEntity(stateDb, 'puff');
      expect(isSuppressed(stateDb, 'puff')).toBe(false);

      suppressEntity(stateDb, 'puff');
      expect(getSuppressionOverrides(stateDb).has('puff')).toBe(false);
      expect(isSuppressed(stateDb, 'puff')).toBe(true);
    });

    it('override is case-insensitive', () => {
      seedSuppressible('Puff');
      updateSuppressionList(stateDb);
      unsuppressEntity(stateDb, 'puff'); // different case than seeded
      expect(isSuppressed(stateDb, 'Puff')).toBe(false);
      updateSuppressionList(stateDb);
      expect(isSuppressed(stateDb, 'PUFF')).toBe(false);
    });
  });
});
