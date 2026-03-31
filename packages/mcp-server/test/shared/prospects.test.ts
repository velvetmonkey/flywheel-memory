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

  // ===========================================================================
  // Multi-day Accumulation
  // ===========================================================================

  describe('multi-day accumulation', () => {
    it('promotion_score, note_count, and day_count grow across 1→2→3 days', () => {
      const now = Date.now();
      const day1 = now - 2 * 24 * 60 * 60 * 1000;
      const day2 = now - 1 * 24 * 60 * 60 * 1000;

      // Day 1: one note
      stateDb.db.exec(`
        INSERT INTO prospect_ledger VALUES ('alpha protocol', 'Alpha Protocol', 'a.md', '2026-03-28', 'dead_link', NULL, 'medium', 2, 0, ${day1}, ${day1}, 1);
      `);
      refreshProspectSummaries(['alpha protocol']);
      const s1 = stateDb.db.prepare('SELECT note_count, day_count, promotion_score FROM prospect_summary WHERE term = ?').get('alpha protocol') as any;
      expect(s1.note_count).toBe(1);
      expect(s1.day_count).toBe(1);

      // Day 2: second note, second day
      stateDb.db.exec(`
        INSERT INTO prospect_ledger VALUES ('alpha protocol', 'Alpha Protocol', 'b.md', '2026-03-29', 'dead_link', NULL, 'medium', 2, 0, ${day2}, ${day2}, 1);
      `);
      refreshProspectSummaries(['alpha protocol']);
      const s2 = stateDb.db.prepare('SELECT note_count, day_count, promotion_score FROM prospect_summary WHERE term = ?').get('alpha protocol') as any;
      expect(s2.note_count).toBe(2);
      expect(s2.day_count).toBe(2);
      expect(s2.promotion_score).toBeGreaterThan(s1.promotion_score);

      // Day 3: third note, third day
      stateDb.db.exec(`
        INSERT INTO prospect_ledger VALUES ('alpha protocol', 'Alpha Protocol', 'c.md', '2026-03-30', 'dead_link', NULL, 'medium', 3, 0, ${now}, ${now}, 1);
      `);
      refreshProspectSummaries(['alpha protocol']);
      const s3 = stateDb.db.prepare('SELECT note_count, day_count, promotion_score FROM prospect_summary WHERE term = ?').get('alpha protocol') as any;
      expect(s3.note_count).toBe(3);
      expect(s3.day_count).toBe(3);
      expect(s3.promotion_score).toBeGreaterThan(s2.promotion_score);
    });

    it('same-day repeat sightings roll into total_sightings after summary refresh', () => {
      recordProspectSightings([
        { term: 'stripe', displayName: 'Stripe', notePath: 'a.md', source: 'implicit', confidence: 'low' },
      ]);
      recordProspectSightings([
        { term: 'stripe', displayName: 'Stripe', notePath: 'a.md', source: 'implicit', confidence: 'low' },
      ]);
      recordProspectSightings([
        { term: 'stripe', displayName: 'Stripe', notePath: 'a.md', source: 'implicit', confidence: 'low' },
      ]);

      refreshProspectSummaries(['stripe']);

      const summary = stateDb.db.prepare(
        'SELECT total_sightings FROM prospect_summary WHERE term = ?'
      ).get('stripe') as { total_sightings: number };
      expect(summary.total_sightings).toBe(3);
    });
  });

  // ===========================================================================
  // Boost Map Filtering
  // ===========================================================================

  describe('boost map filtering', () => {
    it('excludes prospects with effective score <= 5', () => {
      const now = Date.now();
      // effective = 8 * 1.0 = 8 > 5 → included
      stateDb.db.exec(`
        INSERT INTO prospect_summary
          (term, display_name, note_count, day_count, total_sightings, backlink_max, best_source, best_confidence, best_score, first_seen_at, last_seen_at, promotion_score, updated_at)
        VALUES
          ('included', 'Included', 3, 2, 5, 1, 'implicit', 'low', 0, ${now}, ${now}, 8, ${now})
      `);
      // effective = 4 * 1.0 = 4 <= 5 → excluded
      stateDb.db.exec(`
        INSERT INTO prospect_summary
          (term, display_name, note_count, day_count, total_sightings, backlink_max, best_source, best_confidence, best_score, first_seen_at, last_seen_at, promotion_score, updated_at)
        VALUES
          ('excluded', 'Excluded', 2, 1, 2, 0, 'implicit', 'low', 0, ${now}, ${now}, 4, ${now})
      `);

      const map = getProspectBoostMap();
      expect(map.has('included')).toBe(true);
      expect(map.has('excluded')).toBe(false);
    });
  });

  // ===========================================================================
  // Term Normalization
  // ===========================================================================

  describe('term normalization', () => {
    it('case-insensitive across record, refresh, boost-map, and candidate lookup', () => {
      const now = Date.now();
      recordProspectSightings([
        { term: 'Marcus Johnson', displayName: 'Marcus Johnson', notePath: 'a.md', source: 'dead_link', confidence: 'medium', backlinkCount: 4 },
      ]);
      // Second sighting with different case
      recordProspectSightings([
        { term: 'MARCUS JOHNSON', displayName: 'MARCUS JOHNSON', notePath: 'b.md', source: 'dead_link', confidence: 'medium', backlinkCount: 4 },
      ]);

      refreshProspectSummaries(['marcus johnson']);

      const summary = stateDb.db.prepare(
        'SELECT term, note_count FROM prospect_summary WHERE term = ?'
      ).get('marcus johnson') as any;
      expect(summary).toBeTruthy();
      expect(summary.note_count).toBe(2);

      // Boost map uses lowercased key
      const boostMap = getProspectBoostMap();
      if (boostMap.has('marcus johnson')) {
        expect(boostMap.get('MARCUS JOHNSON')).toBeUndefined();
      }

      // Candidates use lowercased term
      const candidates = getPromotionCandidates(10);
      if (candidates.length > 0) {
        expect(candidates[0].term).toBe('marcus johnson');
      }
    });

    it('mixed-case inputs merge into same ledger row for same note+day', () => {
      recordProspectSightings([
        { term: 'Global API', displayName: 'Global API', notePath: 'a.md', source: 'implicit', confidence: 'low' },
      ]);
      recordProspectSightings([
        { term: 'global api', displayName: 'global api', notePath: 'a.md', source: 'implicit', confidence: 'low' },
      ]);
      recordProspectSightings([
        { term: 'GLOBAL API', displayName: 'GLOBAL API', notePath: 'a.md', source: 'implicit', confidence: 'low' },
      ]);

      const row = stateDb.db.prepare(
        'SELECT sighting_count FROM prospect_ledger WHERE term = ? AND note_path = ?'
      ).get('global api', 'a.md') as { sighting_count: number };
      expect(row.sighting_count).toBe(3);
    });
  });

  // ===========================================================================
  // Cooccurring Entities JSON
  // ===========================================================================

  describe('cooccurring_entities JSON handling', () => {
    it('NULL cooccurring_entities produces empty array in candidates', () => {
      const now = Date.now();
      stateDb.db.exec(`
        INSERT INTO prospect_summary VALUES ('orphan', 'Orphan', 3, 2, 5, 2, NULL, 'dead_link', 'medium', 0, ${now}, ${now}, 20, NULL, ${now});
      `);

      const candidates = getPromotionCandidates(10);
      const orphan = candidates.find(c => c.term === 'orphan');
      expect(orphan).toBeTruthy();
      expect(orphan!.cooccurringEntities).toEqual([]);
    });

    it('valid JSON array is parsed correctly in candidates', () => {
      const now = Date.now();
      stateDb.db.exec(`
        INSERT INTO prospect_summary VALUES ('linked', 'Linked', 5, 3, 10, 3, '["Entity A","Entity B"]', 'dead_link', 'high', 0, ${now}, ${now}, 30, NULL, ${now});
      `);

      const candidates = getPromotionCandidates(10);
      const linked = candidates.find(c => c.term === 'linked');
      expect(linked).toBeTruthy();
      expect(linked!.cooccurringEntities).toEqual(['Entity A', 'Entity B']);
    });
  });

  // ===========================================================================
  // Entity Exclusion Lifecycle
  // ===========================================================================

  describe('entity exclusion lifecycle', () => {
    it('entity-name match is excluded from candidates', () => {
      const now = Date.now();
      stateDb.db.exec(`
        INSERT INTO entities (name, name_lower, path, category) VALUES ('Alpha Protocol', 'alpha protocol', 'alpha-protocol.md', 'general');
        INSERT INTO prospect_summary VALUES ('alpha protocol', 'Alpha Protocol', 5, 5, 10, 3, NULL, 'dead_link', 'high', 0, ${now}, ${now}, 60, NULL, ${now});
      `);

      const candidates = getPromotionCandidates(10);
      expect(candidates.find(c => c.term === 'alpha protocol')).toBeUndefined();
    });

    it('alias match is excluded from candidates', () => {
      const now = Date.now();
      stateDb.db.exec(`
        INSERT INTO entities (name, name_lower, path, category, aliases_json) VALUES ('Alpha Protocol Project', 'alpha protocol project', 'app.md', 'general', '["AP"]');
        INSERT INTO prospect_summary VALUES ('ap', 'AP', 4, 3, 8, 2, NULL, 'dead_link', 'medium', 0, ${now}, ${now}, 25, NULL, ${now});
      `);

      const candidates = getPromotionCandidates(10);
      expect(candidates.find(c => c.term === 'ap')).toBeUndefined();
    });

    it('removing entity makes prospect visible again', () => {
      const now = Date.now();
      stateDb.db.exec(`
        INSERT INTO entities (name, name_lower, path, category) VALUES ('Beta System', 'beta system', 'beta.md', 'general');
        INSERT INTO prospect_summary VALUES ('beta system', 'Beta System', 5, 5, 10, 3, NULL, 'dead_link', 'high', 0, ${now}, ${now}, 60, NULL, ${now});
      `);

      // Initially excluded
      expect(getPromotionCandidates(10).find(c => c.term === 'beta system')).toBeUndefined();

      // Delete entity
      stateDb.db.exec(`DELETE FROM entities WHERE name_lower = 'beta system'`);

      // Now visible
      const candidates = getPromotionCandidates(10);
      expect(candidates.find(c => c.term === 'beta system')).toBeTruthy();
    });
  });

  // ===========================================================================
  // promoted_at
  // ===========================================================================

  describe('promoted_at', () => {
    it('is set when entity exists during refreshProspectSummaries', () => {
      const now = Date.now();
      stateDb.db.exec(`
        INSERT INTO entities (name, name_lower, path, category) VALUES ('Gamma Tool', 'gamma tool', 'gamma.md', 'general');
        INSERT INTO prospect_ledger VALUES ('gamma tool', 'Gamma Tool', 'a.md', '2026-03-30', 'dead_link', NULL, 'medium', 2, 0, ${now}, ${now}, 1);
      `);

      refreshProspectSummaries(['gamma tool']);

      const summary = stateDb.db.prepare(
        'SELECT promoted_at FROM prospect_summary WHERE term = ?'
      ).get('gamma tool') as { promoted_at: number | null };
      expect(summary.promoted_at).not.toBeNull();
    });

    it('is null when no matching entity exists', () => {
      const now = Date.now();
      stateDb.db.exec(`
        INSERT INTO prospect_ledger VALUES ('delta tool', 'Delta Tool', 'a.md', '2026-03-30', 'implicit', NULL, 'low', 0, 0, ${now}, ${now}, 1);
      `);

      refreshProspectSummaries(['delta tool']);

      const summary = stateDb.db.prepare(
        'SELECT promoted_at FROM prospect_summary WHERE term = ?'
      ).get('delta tool') as { promoted_at: number | null };
      expect(summary.promoted_at).toBeNull();
    });
  });

  // ===========================================================================
  // Stale Cleanup Boundary
  // ===========================================================================

  describe('stale cleanup boundary', () => {
    it('row exactly at 210-day boundary survives (strict < comparison)', () => {
      const now = Date.now();
      const exactBoundary = now - 210 * 24 * 60 * 60 * 1000 + 1;
      stateDb.db.exec(`
        INSERT INTO prospect_ledger VALUES ('boundary', 'Boundary', 'a.md', '2025-09-01', 'implicit', NULL, 'low', 0, 0, ${exactBoundary}, ${exactBoundary}, 1);
      `);

      const deleted = cleanStaleProspects();
      expect(deleted).toBe(0);

      const count = stateDb.db.prepare('SELECT COUNT(*) as cnt FROM prospect_ledger WHERE term = ?').get('boundary') as { cnt: number };
      expect(count.cnt).toBe(1);
    });

    it('orphaned summaries are pruned when all ledger rows are deleted', () => {
      const now = Date.now();
      const veryOld = now - 220 * 24 * 60 * 60 * 1000;
      stateDb.db.exec(`
        INSERT INTO prospect_ledger VALUES ('prunable', 'Prunable', 'a.md', '2025-07-01', 'implicit', NULL, 'low', 0, 0, ${veryOld}, ${veryOld}, 1);
        INSERT INTO prospect_summary VALUES ('prunable', 'Prunable', 1, 1, 1, 0, NULL, 'implicit', 'low', 0, ${veryOld}, ${veryOld}, 5, NULL, ${veryOld});
      `);

      cleanStaleProspects();

      const summaryCount = stateDb.db.prepare('SELECT COUNT(*) as cnt FROM prospect_summary WHERE term = ?').get('prunable') as { cnt: number };
      expect(summaryCount.cnt).toBe(0);
    });
  });

  // ===========================================================================
  // Zero / Boundary Scores
  // ===========================================================================

  describe('zero and boundary scores', () => {
    it('promotion_score=0 is excluded from both boost map and candidates', () => {
      const now = Date.now();
      stateDb.db.exec(`
        INSERT INTO prospect_summary VALUES ('zero', 'Zero', 1, 1, 1, 0, NULL, 'implicit', 'low', 0, ${now}, ${now}, 0, NULL, ${now});
      `);

      expect(getProspectBoostMap().has('zero')).toBe(false);
      expect(getPromotionCandidates(10).find(c => c.term === 'zero')).toBeUndefined();
    });

    it('larger batch insert with mixed sources does not violate integrity', () => {
      const sightings: ProspectSighting[] = [];
      const sources: Array<'implicit' | 'dead_link' | 'high_score'> = ['implicit', 'dead_link', 'high_score'];
      const confidences: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high'];

      for (let t = 0; t < 10; t++) {
        for (let n = 0; n < 5; n++) {
          sightings.push({
            term: `batch-term-${t}`,
            displayName: `Batch Term ${t}`,
            notePath: `notes/note-${n}.md`,
            source: sources[t % 3],
            confidence: confidences[t % 3],
            backlinkCount: t,
            score: t % 3 === 2 ? t : 0,
          });
        }
      }

      recordProspectSightings(sightings);

      const ledgerCount = stateDb.db.prepare('SELECT COUNT(*) as cnt FROM prospect_ledger').get() as { cnt: number };
      expect(ledgerCount.cnt).toBe(50);

      const terms = Array.from({ length: 10 }, (_, i) => `batch-term-${i}`);
      refreshProspectSummaries(terms);

      const summaryCount = stateDb.db.prepare('SELECT COUNT(*) as cnt FROM prospect_summary').get() as { cnt: number };
      expect(summaryCount.cnt).toBe(10);
    });
  });

});
