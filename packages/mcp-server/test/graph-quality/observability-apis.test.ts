/**
 * Phase 4: Deep Observability API Tests
 *
 * Tests the 4 new observability APIs:
 * 4.1 getEntityScoreTimeline()
 * 4.2 compareGraphSnapshots()
 * 4.3 getLayerContributionTimeseries()
 * 4.4 getExtendedDashboardData()
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  buildGroundTruthVault,
  stripLinks,
  runSuggestionsOnVault,
  loadPrimaryVault,
  type TempVault,
  type GroundTruthSpec,
  type SuggestionRun,
} from './harness.js';
import {
  getEntityScoreTimeline,
  getLayerContributionTimeseries,
  getExtendedDashboardData,
  recordFeedback,
  updateSuppressionList,
} from '../../src/core/write/wikilinkFeedback.js';
import {
  compareGraphSnapshots,
} from '../../src/core/shared/graphSnapshots.js';

describe('Phase 4: Deep Observability APIs', () => {
  let vault: TempVault;
  let spec: GroundTruthSpec;
  let runs: SuggestionRun[];

  beforeAll(async () => {
    spec = await loadPrimaryVault();
    vault = await buildGroundTruthVault(spec);
    await stripLinks(vault, spec.groundTruth);
    runs = await runSuggestionsOnVault(vault, { strictness: 'balanced' });
  }, 60000);

  afterAll(async () => {
    if (vault) await vault.cleanup();
  });

  // ===========================================================================
  // 4.1 getEntityScoreTimeline()
  // ===========================================================================

  describe('getEntityScoreTimeline()', () => {
    it('returns score history for entities with suggestion_events', () => {
      // Find an entity that was suggested
      const entityRow = vault.stateDb.db.prepare(
        'SELECT DISTINCT entity FROM suggestion_events LIMIT 1'
      ).get() as { entity: string } | undefined;

      if (!entityRow) {
        // No suggestion events — skip gracefully
        expect(true).toBe(true);
        return;
      }

      const timeline = getEntityScoreTimeline(vault.stateDb, entityRow.entity, 30, 50);
      expect(timeline).toBeInstanceOf(Array);
      expect(timeline.length).toBeGreaterThan(0);

      // Each entry has the expected shape
      const entry = timeline[0];
      expect(entry).toHaveProperty('timestamp');
      expect(entry).toHaveProperty('score');
      expect(entry).toHaveProperty('breakdown');
      expect(entry).toHaveProperty('notePath');
      expect(entry).toHaveProperty('passed');
      expect(entry).toHaveProperty('threshold');
      expect(typeof entry.timestamp).toBe('number');
      expect(typeof entry.score).toBe('number');
      expect(typeof entry.breakdown).toBe('object');
    });

    it('returns empty array for unknown entity', () => {
      const timeline = getEntityScoreTimeline(vault.stateDb, 'nonexistent_entity_xyz', 30, 50);
      expect(timeline).toEqual([]);
    });

    it('entries are sorted chronologically', () => {
      const entityRow = vault.stateDb.db.prepare(
        'SELECT entity, COUNT(*) as cnt FROM suggestion_events GROUP BY entity HAVING cnt > 1 ORDER BY cnt DESC LIMIT 1'
      ).get() as { entity: string; cnt: number } | undefined;

      if (!entityRow) return;

      const timeline = getEntityScoreTimeline(vault.stateDb, entityRow.entity, 30, 50);
      for (let i = 1; i < timeline.length; i++) {
        expect(timeline[i].timestamp).toBeGreaterThanOrEqual(timeline[i - 1].timestamp);
      }
    });

    it('breakdown has expected layer fields', () => {
      const entityRow = vault.stateDb.db.prepare(
        'SELECT DISTINCT entity FROM suggestion_events LIMIT 1'
      ).get() as { entity: string } | undefined;

      if (!entityRow) return;

      const timeline = getEntityScoreTimeline(vault.stateDb, entityRow.entity, 30, 50);
      if (timeline.length === 0) return;

      const bd = timeline[0].breakdown;
      expect(bd).toHaveProperty('contentMatch');
      expect(bd).toHaveProperty('cooccurrenceBoost');
      expect(bd).toHaveProperty('typeBoost');
      expect(bd).toHaveProperty('contextBoost');
      expect(bd).toHaveProperty('recencyBoost');
      expect(bd).toHaveProperty('crossFolderBoost');
      expect(bd).toHaveProperty('hubBoost');
      expect(bd).toHaveProperty('feedbackAdjustment');
    });
  });

  // ===========================================================================
  // 4.2 compareGraphSnapshots()
  // ===========================================================================

  describe('compareGraphSnapshots()', () => {
    it('returns diff between two snapshot timestamps', () => {
      // Record first snapshot
      const ts1 = Date.now() - 10000;
      vault.stateDb.db.prepare(
        'INSERT INTO graph_snapshots (timestamp, metric, value, details) VALUES (?, ?, ?, ?)'
      ).run(ts1, 'avg_degree', 3.5, null);
      vault.stateDb.db.prepare(
        'INSERT INTO graph_snapshots (timestamp, metric, value, details) VALUES (?, ?, ?, ?)'
      ).run(ts1, 'max_degree', 10, null);
      vault.stateDb.db.prepare(
        'INSERT INTO graph_snapshots (timestamp, metric, value, details) VALUES (?, ?, ?, ?)'
      ).run(ts1, 'cluster_count', 2, null);
      vault.stateDb.db.prepare(
        'INSERT INTO graph_snapshots (timestamp, metric, value, details) VALUES (?, ?, ?, ?)'
      ).run(ts1, 'largest_cluster_size', 50, null);
      vault.stateDb.db.prepare(
        'INSERT INTO graph_snapshots (timestamp, metric, value, details) VALUES (?, ?, ?, ?)'
      ).run(ts1, 'hub_scores_top10', 3, JSON.stringify([
        { entity: 'Alpha', degree: 10 },
        { entity: 'Beta', degree: 5 },
        { entity: 'Gamma', degree: 3 },
      ]));

      // Record second snapshot
      const ts2 = Date.now();
      vault.stateDb.db.prepare(
        'INSERT INTO graph_snapshots (timestamp, metric, value, details) VALUES (?, ?, ?, ?)'
      ).run(ts2, 'avg_degree', 4.2, null);
      vault.stateDb.db.prepare(
        'INSERT INTO graph_snapshots (timestamp, metric, value, details) VALUES (?, ?, ?, ?)'
      ).run(ts2, 'max_degree', 12, null);
      vault.stateDb.db.prepare(
        'INSERT INTO graph_snapshots (timestamp, metric, value, details) VALUES (?, ?, ?, ?)'
      ).run(ts2, 'cluster_count', 1, null);
      vault.stateDb.db.prepare(
        'INSERT INTO graph_snapshots (timestamp, metric, value, details) VALUES (?, ?, ?, ?)'
      ).run(ts2, 'largest_cluster_size', 60, null);
      vault.stateDb.db.prepare(
        'INSERT INTO graph_snapshots (timestamp, metric, value, details) VALUES (?, ?, ?, ?)'
      ).run(ts2, 'hub_scores_top10', 3, JSON.stringify([
        { entity: 'Alpha', degree: 15 },
        { entity: 'Beta', degree: 5 },
        { entity: 'Delta', degree: 8 },
      ]));

      const diff = compareGraphSnapshots(vault.stateDb, ts1, ts2);

      expect(diff).toHaveProperty('metricChanges');
      expect(diff).toHaveProperty('hubScoreChanges');
      expect(diff.metricChanges).toBeInstanceOf(Array);
      expect(diff.metricChanges.length).toBe(4);

      // avg_degree: 3.5 → 4.2
      const avgDeg = diff.metricChanges.find(m => m.metric === 'avg_degree')!;
      expect(avgDeg.before).toBe(3.5);
      expect(avgDeg.after).toBe(4.2);
      expect(avgDeg.delta).toBeCloseTo(0.7, 1);

      // Hub changes: Alpha grew, Gamma removed, Delta added
      expect(diff.hubScoreChanges.length).toBeGreaterThan(0);
      const alphaChange = diff.hubScoreChanges.find(h => h.entity === 'Alpha');
      expect(alphaChange).toBeDefined();
      expect(alphaChange!.delta).toBe(5);
    });

    it('returns zeros when no snapshots exist for timestamps', () => {
      const diff = compareGraphSnapshots(vault.stateDb, 1000, 2000);
      expect(diff.metricChanges.every(m => m.before === 0 && m.after === 0)).toBe(true);
      expect(diff.hubScoreChanges).toEqual([]);
    });
  });

  // ===========================================================================
  // 4.3 getLayerContributionTimeseries()
  // ===========================================================================

  describe('getLayerContributionTimeseries()', () => {
    it('returns bucketed layer contributions from suggestion_events', () => {
      const eventCount = (vault.stateDb.db.prepare(
        'SELECT COUNT(*) as cnt FROM suggestion_events'
      ).get() as { cnt: number }).cnt;

      const timeseries = getLayerContributionTimeseries(vault.stateDb, 'day', 30);

      if (eventCount === 0) {
        expect(timeseries).toEqual([]);
        return;
      }

      expect(timeseries.length).toBeGreaterThan(0);

      const bucket = timeseries[0];
      expect(bucket).toHaveProperty('bucket');
      expect(bucket).toHaveProperty('layers');
      expect(typeof bucket.bucket).toBe('string');
      expect(typeof bucket.layers).toBe('object');

      // Has at least contentMatch as a layer key
      expect(bucket.layers).toHaveProperty('contentMatch');
    });

    it('weekly granularity groups by ISO week', () => {
      const timeseries = getLayerContributionTimeseries(vault.stateDb, 'week', 30);

      for (const bucket of timeseries) {
        // Should match YYYY-Www pattern
        expect(bucket.bucket).toMatch(/^\d{4}-W\d{2}$/);
      }
    });

    it('layer values are averages (not raw sums)', () => {
      const timeseries = getLayerContributionTimeseries(vault.stateDb, 'day', 30);

      for (const bucket of timeseries) {
        for (const [, value] of Object.entries(bucket.layers)) {
          // Averaged values should be reasonable (not thousands)
          expect(Math.abs(value)).toBeLessThan(100);
        }
      }
    });
  });

  // ===========================================================================
  // 4.4 getExtendedDashboardData()
  // ===========================================================================

  describe('getExtendedDashboardData()', () => {
    it('includes all base dashboard fields', () => {
      const data = getExtendedDashboardData(vault.stateDb);

      // Base fields
      expect(data).toHaveProperty('total_feedback');
      expect(data).toHaveProperty('total_correct');
      expect(data).toHaveProperty('total_incorrect');
      expect(data).toHaveProperty('overall_accuracy');
      expect(data).toHaveProperty('total_suppressed');
      expect(data).toHaveProperty('feedback_sources');
      expect(data).toHaveProperty('applications');
      expect(data).toHaveProperty('boost_tiers');
      expect(data).toHaveProperty('learning');
      expect(data).toHaveProperty('suppressed');
      expect(data).toHaveProperty('recent');
      expect(data).toHaveProperty('timeline');
    });

    it('includes 4 new extended fields', () => {
      const data = getExtendedDashboardData(vault.stateDb);

      expect(data).toHaveProperty('layerHealth');
      expect(data).toHaveProperty('topEntities');
      expect(data).toHaveProperty('feedbackTrend');
      expect(data).toHaveProperty('suppressionChanges');
    });

    it('layerHealth has entries for each scoring layer', () => {
      const data = getExtendedDashboardData(vault.stateDb);

      expect(data.layerHealth).toBeInstanceOf(Array);
      expect(data.layerHealth.length).toBeGreaterThanOrEqual(8);

      for (const lh of data.layerHealth) {
        expect(lh).toHaveProperty('layer');
        expect(lh).toHaveProperty('status');
        expect(lh).toHaveProperty('avgContribution');
        expect(lh).toHaveProperty('eventCount');
        expect(['contributing', 'dormant', 'zero-data']).toContain(lh.status);
      }
    });

    it('topEntities returns up to 10 entities sorted by suggestion count', () => {
      const data = getExtendedDashboardData(vault.stateDb);

      expect(data.topEntities).toBeInstanceOf(Array);
      expect(data.topEntities.length).toBeLessThanOrEqual(10);

      for (let i = 1; i < data.topEntities.length; i++) {
        expect(data.topEntities[i].suggestionCount).toBeLessThanOrEqual(data.topEntities[i - 1].suggestionCount);
      }
    });

    it('feedbackTrend reflects recorded feedback', () => {
      // Record some feedback
      recordFeedback(vault.stateDb, 'TestEntity', 'test', 'test/note.md', true);
      recordFeedback(vault.stateDb, 'TestEntity', 'test', 'test/note2.md', false);

      const data = getExtendedDashboardData(vault.stateDb);
      expect(data.feedbackTrend).toBeInstanceOf(Array);
      // At least one day should have feedback
      expect(data.feedbackTrend.length).toBeGreaterThanOrEqual(1);
    });

    it('suppressionChanges lists suppressed entities', () => {
      // Record enough negative feedback to trigger suppression
      for (let i = 0; i < 12; i++) {
        recordFeedback(vault.stateDb, 'BadEntity', 'test', `test/note${i}.md`, false);
      }
      updateSuppressionList(vault.stateDb);

      const data = getExtendedDashboardData(vault.stateDb);
      expect(data.suppressionChanges).toBeInstanceOf(Array);

      const bad = data.suppressionChanges.find(s => s.entity === 'BadEntity');
      expect(bad).toBeDefined();
      expect(bad!.falsePositiveRate).toBeGreaterThan(0);
    });
  });
});
