/**
 * Tests for vault_growth tool (growth metrics)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createTempVault,
  cleanupTempVault,
  openStateDb,
  deleteStateDb,
  type StateDb,
} from '../../helpers/testUtils.js';
import {
  computeMetrics,
  recordMetrics,
  getMetricHistory,
  computeTrends,
  purgeOldMetrics,
  ALL_METRICS,
} from '../../../src/core/shared/metrics.js';
import type { VaultIndex, VaultNote, Backlink } from '../../../src/core/read/types.js';

// =============================================================================
// HELPERS
// =============================================================================

function makeNote(notePath: string, outlinks: Array<{ target: string }> = [], tags: string[] = []): VaultNote {
  return {
    path: notePath,
    title: notePath.replace(/\.md$/, '').split('/').pop() || notePath,
    aliases: [],
    frontmatter: {},
    outlinks: outlinks.map(ol => ({ target: ol.target, line: 1 })),
    tags,
    modified: new Date(),
  };
}

function buildIndex(notes: VaultNote[], backlinks?: Map<string, Backlink[]>): VaultIndex {
  const noteMap = new Map<string, VaultNote>();
  const tags = new Map<string, Set<string>>();
  const entities = new Map<string, string>();

  for (const note of notes) {
    noteMap.set(note.path, note);
    entities.set(note.title.toLowerCase(), note.path);
    for (const tag of note.tags) {
      if (!tags.has(tag)) tags.set(tag, new Set());
      tags.get(tag)!.add(note.path);
    }
  }

  return {
    notes: noteMap,
    backlinks: backlinks || new Map(),
    entities,
    tags,
    builtAt: new Date(),
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('vault_growth', () => {
  let vaultPath: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    vaultPath = await createTempVault();
    stateDb = openStateDb(vaultPath);
  });

  afterEach(async () => {
    stateDb.db.close();
    deleteStateDb(vaultPath);
    await cleanupTempVault(vaultPath);
  });

  // --------------------------------------------------------
  // Compute metrics from index
  // --------------------------------------------------------
  describe('computeMetrics', () => {
    it('should compute metrics from empty vault', () => {
      const index = buildIndex([]);
      const metrics = computeMetrics(index);

      expect(metrics.note_count).toBe(0);
      expect(metrics.link_count).toBe(0);
      expect(metrics.orphan_count).toBe(0);
      expect(metrics.tag_count).toBe(0);
      expect(metrics.entity_count).toBe(0);
      expect(metrics.avg_links_per_note).toBe(0);
      expect(metrics.link_density).toBe(0);
      expect(metrics.connected_ratio).toBe(0);
    });

    it('should compute metrics from populated vault', () => {
      const notes = [
        makeNote('note-a.md', [{ target: 'note-b' }], ['tag1', 'tag2']),
        makeNote('note-b.md', [{ target: 'note-a' }, { target: 'note-c' }], ['tag1']),
        makeNote('note-c.md', [], ['tag3']),
        makeNote('orphan.md', [], []),
      ];

      const backlinks = new Map<string, Backlink[]>();
      backlinks.set('note-b', [{ source: 'note-a.md', line: 1 }]);
      backlinks.set('note-a', [{ source: 'note-b.md', line: 1 }]);
      backlinks.set('note-c', [{ source: 'note-b.md', line: 1 }]);

      const index = buildIndex(notes, backlinks);
      const metrics = computeMetrics(index);

      expect(metrics.note_count).toBe(4);
      expect(metrics.link_count).toBe(3);
      expect(metrics.tag_count).toBe(3);
      expect(metrics.entity_count).toBe(4);
      expect(metrics.avg_links_per_note).toBe(0.75);
      expect(metrics.connected_ratio).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------
  // Record + retrieve snapshots
  // --------------------------------------------------------
  describe('recordMetrics / getMetricHistory', () => {
    it('should record and retrieve metric snapshots', () => {
      const metrics = { note_count: 100, link_count: 50 };
      recordMetrics(stateDb, metrics);

      const history = getMetricHistory(stateDb, 'note_count', 30);
      expect(history.length).toBe(1);
      expect(history[0].metric).toBe('note_count');
      expect(history[0].value).toBe(100);
    });

    it('should retrieve all metrics when no filter', () => {
      const metrics = { note_count: 100, link_count: 50, orphan_count: 5 };
      recordMetrics(stateDb, metrics);

      const history = getMetricHistory(stateDb, undefined, 30);
      expect(history.length).toBe(3);
    });

    it('should filter by days_back', () => {
      // Insert a metric with old timestamp
      stateDb.db.prepare(
        'INSERT INTO vault_metrics (timestamp, metric, value) VALUES (?, ?, ?)'
      ).run(Date.now() - 60 * 24 * 60 * 60 * 1000, 'note_count', 50);

      // Insert a recent metric
      recordMetrics(stateDb, { note_count: 100 });

      const history = getMetricHistory(stateDb, 'note_count', 30);
      expect(history.length).toBe(1);
      expect(history[0].value).toBe(100);
    });
  });

  // --------------------------------------------------------
  // Trend computation
  // --------------------------------------------------------
  describe('computeTrends', () => {
    it('should compute trends vs previous values', () => {
      // Record old values
      const oldTimestamp = Date.now() - 25 * 24 * 60 * 60 * 1000;
      stateDb.db.prepare(
        'INSERT INTO vault_metrics (timestamp, metric, value) VALUES (?, ?, ?)'
      ).run(oldTimestamp, 'note_count', 80);
      stateDb.db.prepare(
        'INSERT INTO vault_metrics (timestamp, metric, value) VALUES (?, ?, ?)'
      ).run(oldTimestamp, 'link_count', 40);

      const current = { note_count: 100, link_count: 60, orphan_count: 5 };
      const trends = computeTrends(stateDb, current, 30);

      const noteTrend = trends.find(t => t.metric === 'note_count');
      expect(noteTrend).toBeDefined();
      expect(noteTrend!.current).toBe(100);
      expect(noteTrend!.previous).toBe(80);
      expect(noteTrend!.delta).toBe(20);
      expect(noteTrend!.direction).toBe('up');
    });

    it('should show stable when no change', () => {
      const oldTimestamp = Date.now() - 25 * 24 * 60 * 60 * 1000;
      stateDb.db.prepare(
        'INSERT INTO vault_metrics (timestamp, metric, value) VALUES (?, ?, ?)'
      ).run(oldTimestamp, 'note_count', 100);

      const trends = computeTrends(stateDb, { note_count: 100 }, 30);
      const noteTrend = trends.find(t => t.metric === 'note_count');
      expect(noteTrend!.direction).toBe('stable');
      expect(noteTrend!.delta).toBe(0);
    });
  });

  // --------------------------------------------------------
  // Purge old metrics
  // --------------------------------------------------------
  describe('purgeOldMetrics', () => {
    it('should purge metrics older than retention period', () => {
      // Insert old metric (100 days ago)
      stateDb.db.prepare(
        'INSERT INTO vault_metrics (timestamp, metric, value) VALUES (?, ?, ?)'
      ).run(Date.now() - 100 * 24 * 60 * 60 * 1000, 'note_count', 50);

      // Insert recent metric
      recordMetrics(stateDb, { note_count: 100 });

      const purged = purgeOldMetrics(stateDb, 90);
      expect(purged).toBe(1);

      const remaining = getMetricHistory(stateDb, 'note_count', 365);
      expect(remaining.length).toBe(1);
      expect(remaining[0].value).toBe(100);
    });
  });
});
