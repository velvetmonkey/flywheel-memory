/**
 * Tests for Prospect Ledger — Persistent Pre-Entity Memory
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { openStateDb, FLYWHEEL_DIR, SCHEMA_VERSION } from '@velvetmonkey/vault-core';
import type { StateDb } from '@velvetmonkey/vault-core';
import {
  setProspectStateDb,
  recordProspectSightings,
  refreshProspectSummaries,
  computePromotionScore,
  computeProspectDecay,
  getProspectBoostMap,
  getPromotionCandidates,
  getProspectSampleNotes,
  cleanStaleProspects,
  resetCleanupCooldown,
  PROSPECT_DECAY_HALF_LIFE_DAYS,
  PROMOTION_THRESHOLD,
  type ProspectSighting,
} from '../../src/core/shared/prospects.js';

describe('Prospect Ledger', () => {
  let testVaultPath: string;
  let stateDb: StateDb;

  beforeEach(() => {
    testVaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-test-'));
    stateDb = openStateDb(testVaultPath);
    setProspectStateDb(stateDb);
    resetCleanupCooldown();
  });

  afterEach(() => {
    try { stateDb.db.close(); } catch { /* ignore */ }
    fs.rmSync(testVaultPath, { recursive: true, force: true });
    setProspectStateDb(null);
  });

  // ===========================================================================
  // Schema / Migration
  // ===========================================================================

  describe('schema', () => {
    it('creates prospect_ledger and prospect_summary tables at v37', () => {
      const version = stateDb.db.prepare(
        'SELECT MAX(version) as v FROM schema_version'
      ).get() as { v: number };
      expect(version.v).toBe(SCHEMA_VERSION);

      const tables = stateDb.db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table'
        AND name IN ('prospect_ledger', 'prospect_summary')
        ORDER BY name
      `).all() as Array<{ name: string }>;
      expect(tables.map(t => t.name)).toEqual(['prospect_ledger', 'prospect_summary']);
    });

    it('prospect_ledger has correct PK (term, note_path, seen_day)', () => {
      // Insert two rows with same term+note but different day
      stateDb.db.exec(`
        INSERT INTO prospect_ledger (term, display_name, note_path, seen_day, source, confidence, first_seen_at, last_seen_at)
        VALUES ('test', 'Test', 'a.md', '2026-03-01', 'implicit', 'low', 1, 1);
      `);
      stateDb.db.exec(`
        INSERT INTO prospect_ledger (term, display_name, note_path, seen_day, source, confidence, first_seen_at, last_seen_at)
        VALUES ('test', 'Test', 'a.md', '2026-03-02', 'implicit', 'low', 1, 1);
      `);
      const count = stateDb.db.prepare(
        'SELECT COUNT(*) as cnt FROM prospect_ledger WHERE term = ?'
      ).get('test') as { cnt: number };
      expect(count.cnt).toBe(2);
    });
  });

  // ===========================================================================
  // Decay
  // ===========================================================================

  describe('decay', () => {
    it('returns 1.0 for just-seen prospects', () => {
      expect(computeProspectDecay(Date.now())).toBeCloseTo(1.0, 2);
    });

    it('returns ~0.5 at 60 days (half-life)', () => {
      const sixtyDaysAgo = Date.now() - 60 * 24 * 60 * 60 * 1000;
      expect(computeProspectDecay(sixtyDaysAgo)).toBeCloseTo(0.5, 2);
    });

    it('returns ~0.25 at 120 days (two half-lives)', () => {
      const hundredTwentyDaysAgo = Date.now() - 120 * 24 * 60 * 60 * 1000;
      expect(computeProspectDecay(hundredTwentyDaysAgo)).toBeCloseTo(0.25, 2);
    });

    it('returns near-zero at 210+ days', () => {
      const twoTenDaysAgo = Date.now() - 210 * 24 * 60 * 60 * 1000;
      expect(computeProspectDecay(twoTenDaysAgo)).toBeLessThan(0.1);
    });
  });

  // ===========================================================================
  // Promotion Score
  // ===========================================================================

  describe('promotion score', () => {
    it('computes correctly with known inputs', () => {
      const score = computePromotionScore({
        noteCount: 5,
        dayCount: 4,
        backlinkMax: 3,
        cooccurringCount: 2,
        bestScore: 0,
        bestSource: 'implicit',
      });
      // (5*3 + 4*2 + 3*2 + 2*1 + 0*0.5) * 1.0 = (15+8+6+2+0) * 1.0 = 31
      expect(score).toBe(31);
    });

    it('applies source multiplier for dead_link', () => {
      const score = computePromotionScore({
        noteCount: 5,
        dayCount: 4,
        backlinkMax: 3,
        cooccurringCount: 2,
        bestScore: 0,
        bestSource: 'dead_link',
      });
      // 31 * 1.2 = 37.2
      expect(score).toBe(37.2);
    });

    it('applies source multiplier for high_score', () => {
      const score = computePromotionScore({
        noteCount: 5,
        dayCount: 4,
        backlinkMax: 3,
        cooccurringCount: 2,
        bestScore: 5,
        bestSource: 'high_score',
      });
      // (15+8+6+2+2.5) * 1.3 = 33.5 * 1.3 = 43.55
      expect(score).toBe(43.6); // rounded to 1 decimal
    });

    it('caps each component at 10', () => {
      const score = computePromotionScore({
        noteCount: 100,  // capped at 10
        dayCount: 100,   // capped at 10
        backlinkMax: 100, // capped at 10
        cooccurringCount: 100, // capped at 10
        bestScore: 100,  // capped at 10
        bestSource: 'implicit',
      });
      // (10*3 + 10*2 + 10*2 + 10*1 + 10*0.5) * 1.0 = 85
      expect(score).toBe(85);
    });
  });

  // ===========================================================================
  // Recording Sightings
  // ===========================================================================

  describe('recordProspectSightings', () => {
    it('inserts new sightings', () => {
      recordProspectSightings([
        { term: 'global equities api', displayName: 'Global Equities API', notePath: 'notes/a.md', source: 'implicit', confidence: 'low' },
        { term: 'marcus johnson', displayName: 'Marcus Johnson', notePath: 'notes/b.md', source: 'dead_link', confidence: 'medium', backlinkCount: 3 },
      ]);

      const count = stateDb.db.prepare('SELECT COUNT(*) as cnt FROM prospect_ledger').get() as { cnt: number };
      expect(count.cnt).toBe(2);
    });

    it('upserts same term+note+day: increments sighting_count', () => {
      recordProspectSightings([
        { term: 'test term', displayName: 'Test Term', notePath: 'a.md', source: 'implicit', confidence: 'low' },
      ]);
      recordProspectSightings([
        { term: 'test term', displayName: 'Test Term', notePath: 'a.md', source: 'implicit', confidence: 'low' },
      ]);

      const row = stateDb.db.prepare(
        'SELECT sighting_count FROM prospect_ledger WHERE term = ?'
      ).get('test term') as { sighting_count: number };
      expect(row.sighting_count).toBe(2);
    });

    it('keeps earliest display_name on upsert', () => {
      recordProspectSightings([
        { term: 'test', displayName: 'First Name', notePath: 'a.md', source: 'implicit', confidence: 'low' },
      ]);
      recordProspectSightings([
        { term: 'test', displayName: 'Second Name', notePath: 'a.md', source: 'implicit', confidence: 'low' },
      ]);

      const row = stateDb.db.prepare(
        'SELECT display_name FROM prospect_ledger WHERE term = ?'
      ).get('test') as { display_name: string };
      expect(row.display_name).toBe('First Name');
    });

    it('upgrades source by precedence (high_score > dead_link > implicit)', () => {
      recordProspectSightings([
        { term: 'test', displayName: 'Test', notePath: 'a.md', source: 'implicit', confidence: 'low' },
      ]);
      recordProspectSightings([
        { term: 'test', displayName: 'Test', notePath: 'a.md', source: 'dead_link', confidence: 'medium' },
      ]);

      const row = stateDb.db.prepare(
        'SELECT source, confidence FROM prospect_ledger WHERE term = ?'
      ).get('test') as { source: string; confidence: string };
      expect(row.source).toBe('dead_link');
      expect(row.confidence).toBe('medium');
    });

    it('takes MAX of backlink_count and score', () => {
      recordProspectSightings([
        { term: 'test', displayName: 'Test', notePath: 'a.md', source: 'dead_link', confidence: 'medium', backlinkCount: 2, score: 1 },
      ]);
      recordProspectSightings([
        { term: 'test', displayName: 'Test', notePath: 'a.md', source: 'dead_link', confidence: 'medium', backlinkCount: 5, score: 3 },
      ]);

      const row = stateDb.db.prepare(
        'SELECT backlink_count, score FROM prospect_ledger WHERE term = ?'
      ).get('test') as { backlink_count: number; score: number };
      expect(row.backlink_count).toBe(5);
      expect(row.score).toBe(3);
    });

    it('creates separate rows for different note_paths', () => {
      recordProspectSightings([
        { term: 'test', displayName: 'Test', notePath: 'a.md', source: 'implicit', confidence: 'low' },
        { term: 'test', displayName: 'Test', notePath: 'b.md', source: 'implicit', confidence: 'low' },
      ]);

      const count = stateDb.db.prepare(
        'SELECT COUNT(*) as cnt FROM prospect_ledger WHERE term = ?'
      ).get('test') as { cnt: number };
      expect(count.cnt).toBe(2);
    });
  });

  // ===========================================================================
  // Summary Refresh
  // ===========================================================================

  describe('refreshProspectSummaries', () => {
    it('aggregates note_count and day_count correctly', () => {
      // Insert raw day-grain rows directly for controlled test
      const now = Date.now();
      stateDb.db.exec(`
        INSERT INTO prospect_ledger VALUES ('test', 'Test', 'a.md', '2026-03-01', 'implicit', NULL, 'low', 0, 0, ${now}, ${now}, 1);
        INSERT INTO prospect_ledger VALUES ('test', 'Test', 'a.md', '2026-03-02', 'implicit', NULL, 'low', 0, 0, ${now}, ${now}, 1);
        INSERT INTO prospect_ledger VALUES ('test', 'Test', 'b.md', '2026-03-01', 'implicit', NULL, 'low', 0, 0, ${now}, ${now}, 1);
      `);

      refreshProspectSummaries(['test']);

      const summary = stateDb.db.prepare(
        'SELECT note_count, day_count, total_sightings FROM prospect_summary WHERE term = ?'
      ).get('test') as { note_count: number; day_count: number; total_sightings: number };

      expect(summary.note_count).toBe(2);  // a.md, b.md
      expect(summary.day_count).toBe(3);   // 3 day-grain rows
      expect(summary.total_sightings).toBe(3);
    });

    it('computes backlink_max as MAX across rows', () => {
      const now = Date.now();
      stateDb.db.exec(`
        INSERT INTO prospect_ledger VALUES ('test', 'Test', 'a.md', '2026-03-01', 'dead_link', NULL, 'medium', 2, 0, ${now}, ${now}, 1);
        INSERT INTO prospect_ledger VALUES ('test', 'Test', 'b.md', '2026-03-01', 'dead_link', NULL, 'high', 5, 0, ${now}, ${now}, 1);
      `);

      refreshProspectSummaries(['test']);

      const summary = stateDb.db.prepare(
        'SELECT backlink_max, best_source, best_confidence FROM prospect_summary WHERE term = ?'
      ).get('test') as { backlink_max: number; best_source: string; best_confidence: string };

      expect(summary.backlink_max).toBe(5);
      expect(summary.best_source).toBe('dead_link');
      expect(summary.best_confidence).toBe('high');
    });

    it('computes promotion_score from formula', () => {
      const now = Date.now();
      // 3 notes, 3 days, backlink_max=3
      stateDb.db.exec(`
        INSERT INTO prospect_ledger VALUES ('test', 'Test', 'a.md', '2026-03-01', 'dead_link', NULL, 'medium', 3, 0, ${now}, ${now}, 1);
        INSERT INTO prospect_ledger VALUES ('test', 'Test', 'b.md', '2026-03-02', 'dead_link', NULL, 'medium', 2, 0, ${now}, ${now}, 1);
        INSERT INTO prospect_ledger VALUES ('test', 'Test', 'c.md', '2026-03-03', 'dead_link', NULL, 'medium', 1, 0, ${now}, ${now}, 1);
      `);

      refreshProspectSummaries(['test']);

      const summary = stateDb.db.prepare(
        'SELECT promotion_score FROM prospect_summary WHERE term = ?'
      ).get('test') as { promotion_score: number };

      // (3*3 + 3*2 + 3*2 + 0*1 + 0*0.5) * 1.2 = (9+6+6) * 1.2 = 25.2
      expect(summary.promotion_score).toBe(25.2);
    });
  });

  // ===========================================================================
  // Boost Map
  // ===========================================================================

  describe('getProspectBoostMap', () => {
    it('returns empty map when no summaries exist', () => {
      const map = getProspectBoostMap();
      expect(map.size).toBe(0);
    });

    it('scales effective score to [0, 6] range', () => {
      const now = Date.now();
      // Create a high-scoring prospect
      stateDb.db.exec(`
        INSERT INTO prospect_summary
          (term, display_name, note_count, day_count, total_sightings, backlink_max, best_source, best_confidence, best_score, first_seen_at, last_seen_at, promotion_score, updated_at)
        VALUES
          ('test', 'Test', 10, 10, 50, 5, 'dead_link', 'high', 0, ${now}, ${now}, 60, ${now})
      `);

      const map = getProspectBoostMap();
      // effective = 60 * ~1.0 (just seen) = 60, boost = min(6, 60/10) = 6
      expect(map.get('test')).toBe(6);
    });

    it('filters out low effective scores', () => {
      const longAgo = Date.now() - 180 * 24 * 60 * 60 * 1000;
      stateDb.db.exec(`
        INSERT INTO prospect_summary
          (term, display_name, note_count, day_count, total_sightings, backlink_max, best_source, best_confidence, best_score, first_seen_at, last_seen_at, promotion_score, updated_at)
        VALUES
          ('stale', 'Stale', 2, 1, 2, 1, 'implicit', 'low', 0, ${longAgo}, ${longAgo}, 10, ${longAgo})
      `);

      const map = getProspectBoostMap();
      expect(map.has('stale')).toBe(false);
    });
  });

  // ===========================================================================
  // Promotion Candidates
  // ===========================================================================

  describe('getPromotionCandidates', () => {
    it('returns candidates sorted by effective score', () => {
      const now = Date.now();
      stateDb.db.exec(`
        INSERT INTO prospect_summary VALUES ('low', 'Low', 2, 2, 2, 1, NULL, 'implicit', 'low', 0, ${now}, ${now}, 10, NULL, ${now});
        INSERT INTO prospect_summary VALUES ('high', 'High', 8, 6, 20, 5, NULL, 'dead_link', 'high', 0, ${now}, ${now}, 60, NULL, ${now});
      `);

      const candidates = getPromotionCandidates(10);
      expect(candidates.length).toBe(2);
      expect(candidates[0].term).toBe('high');
      expect(candidates[0].promotionReady).toBe(true);
      expect(candidates[1].term).toBe('low');
      expect(candidates[1].promotionReady).toBe(false);
    });

    it('excludes terms that exist as entities', () => {
      const now = Date.now();
      // Insert an entity
      stateDb.db.exec(`
        INSERT INTO entities (name, name_lower, path, category) VALUES ('Test Entity', 'test entity', 'test-entity.md', 'general');
      `);
      // Insert a prospect matching that entity
      stateDb.db.exec(`
        INSERT INTO prospect_summary VALUES ('test entity', 'Test Entity', 5, 5, 10, 3, NULL, 'dead_link', 'high', 0, ${now}, ${now}, 50, NULL, ${now});
      `);

      const candidates = getPromotionCandidates(10);
      expect(candidates.length).toBe(0);
    });
  });

  // ===========================================================================
  // Sample Notes
  // ===========================================================================

  describe('getProspectSampleNotes', () => {
    it('returns up to 3 distinct note paths', () => {
      const now = Date.now();
      stateDb.db.exec(`
        INSERT INTO prospect_ledger VALUES ('test', 'Test', 'a.md', '2026-03-01', 'implicit', NULL, 'low', 0, 0, ${now}, ${now}, 1);
        INSERT INTO prospect_ledger VALUES ('test', 'Test', 'b.md', '2026-03-01', 'implicit', NULL, 'low', 0, 0, ${now}, ${now}, 1);
        INSERT INTO prospect_ledger VALUES ('test', 'Test', 'c.md', '2026-03-01', 'implicit', NULL, 'low', 0, 0, ${now}, ${now}, 1);
        INSERT INTO prospect_ledger VALUES ('test', 'Test', 'd.md', '2026-03-01', 'implicit', NULL, 'low', 0, 0, ${now}, ${now}, 1);
      `);

      const notes = getProspectSampleNotes('test', 3);
      expect(notes.length).toBe(3);
    });
  });

  // ===========================================================================
  // Stale Cleanup
  // ===========================================================================

  describe('cleanStaleProspects', () => {
    it('deletes rows older than 210 days', () => {
      const now = Date.now();
      const old = now - 220 * 24 * 60 * 60 * 1000;
      stateDb.db.exec(`
        INSERT INTO prospect_ledger VALUES ('fresh', 'Fresh', 'a.md', '2026-03-01', 'implicit', NULL, 'low', 0, 0, ${now}, ${now}, 1);
        INSERT INTO prospect_ledger VALUES ('stale', 'Stale', 'b.md', '2025-08-01', 'implicit', NULL, 'low', 0, 0, ${old}, ${old}, 1);
      `);
      // Also add summary for stale
      stateDb.db.exec(`
        INSERT INTO prospect_summary VALUES ('stale', 'Stale', 1, 1, 1, 0, NULL, 'implicit', 'low', 0, ${old}, ${old}, 5, NULL, ${old});
      `);

      const deleted = cleanStaleProspects();
      expect(deleted).toBe(1);

      // Fresh row should remain
      const count = stateDb.db.prepare('SELECT COUNT(*) as cnt FROM prospect_ledger').get() as { cnt: number };
      expect(count.cnt).toBe(1);

      // Orphaned summary should be pruned
      const summaryCount = stateDb.db.prepare('SELECT COUNT(*) as cnt FROM prospect_summary').get() as { cnt: number };
      expect(summaryCount.cnt).toBe(0);
    });

    it('respects cooldown (1 hour)', () => {
      const now = Date.now();
      const old = now - 220 * 24 * 60 * 60 * 1000;
      stateDb.db.exec(`
        INSERT INTO prospect_ledger VALUES ('stale', 'Stale', 'a.md', '2025-08-01', 'implicit', NULL, 'low', 0, 0, ${old}, ${old}, 1);
      `);

      // First call should work
      const first = cleanStaleProspects();
      expect(first).toBe(1);

      // Add another stale row
      stateDb.db.exec(`
        INSERT INTO prospect_ledger VALUES ('stale2', 'Stale2', 'b.md', '2025-08-01', 'implicit', NULL, 'low', 0, 0, ${old}, ${old}, 1);
      `);

      // Second call within cooldown should skip
      const second = cleanStaleProspects();
      expect(second).toBe(0);
    });
  });
});
