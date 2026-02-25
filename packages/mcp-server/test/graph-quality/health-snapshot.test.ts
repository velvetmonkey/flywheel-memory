/**
 * Tests for the Graph Health Snapshot Diff Tool
 *
 * Validates that snapshots can be taken, diffed, and compared
 * across vault mutation sessions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
} from '../helpers/testUtils.js';
import {
  takeSnapshot,
  diffSnapshots,
  formatSnapshotDiff,
  saveSnapshot,
  loadSnapshot,
  type HealthSnapshot,
  type SnapshotDiff,
} from './health-snapshot.js';

describe('Graph Health Snapshot Diff', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  describe('takeSnapshot', () => {
    it('captures valid health metrics from a vault', async () => {
      // Create a small vault with interconnected notes
      await createTestNote(tempVault, 'entities/React.md', '# React\n\nA UI framework.\n');
      await createTestNote(tempVault, 'entities/TypeScript.md', '# TypeScript\n\nA typed language using [[React]].\n');
      await createTestNote(tempVault, 'notes/project.md', '# My Project\n\nUses [[React]] and [[TypeScript]].\n');

      const snapshot = await takeSnapshot(tempVault, 'test-baseline');

      expect(snapshot.label).toBe('test-baseline');
      expect(snapshot.timestamp).toBeTruthy();
      expect(snapshot.vaultPath).toBe(tempVault);
      expect(snapshot.health.noteCount).toBe(3);
      expect(snapshot.health.linkCount).toBeGreaterThanOrEqual(0);
    });

    it('handles empty vault', async () => {
      const snapshot = await takeSnapshot(tempVault, 'empty');

      expect(snapshot.health.noteCount).toBe(0);
      expect(snapshot.health.linkDensity).toBe(0);
      expect(snapshot.health.orphanRate).toBe(1);
    });
  });

  describe('diffSnapshots', () => {
    it('detects improvement in link density', () => {
      const before: HealthSnapshot = {
        timestamp: '2026-02-20T10:00:00Z',
        vaultPath: '/test',
        label: 'before',
        health: {
          noteCount: 10, linkCount: 5, linkDensity: 0.5, orphanRate: 0.3,
          orphanCount: 3, entityCoverage: 0.4, connectedness: 0.6,
          clusterCount: 2, giniCoefficient: 0.5, clusteringCoefficient: 0.1,
          avgPathLength: 3.0, betweennessCentrality: { top5PctShare: 0.3 },
          degreeCentralityStdDev: 2.0,
        },
      };

      const after: HealthSnapshot = {
        timestamp: '2026-02-20T11:00:00Z',
        vaultPath: '/test',
        label: 'after',
        health: {
          noteCount: 10, linkCount: 15, linkDensity: 1.5, orphanRate: 0.1,
          orphanCount: 1, entityCoverage: 0.7, connectedness: 0.9,
          clusterCount: 1, giniCoefficient: 0.4, clusteringCoefficient: 0.2,
          avgPathLength: 2.5, betweennessCentrality: { top5PctShare: 0.4 },
          degreeCentralityStdDev: 3.0,
        },
      };

      const diff = diffSnapshots(before, after);

      // Link density improved
      const linkDensityDiff = diff.metrics.find(m => m.metric === 'linkDensity');
      expect(linkDensityDiff!.delta).toBeGreaterThan(0);
      expect(linkDensityDiff!.severity).toBe('ok');

      // Orphan rate improved (lower is better)
      const orphanDiff = diff.metrics.find(m => m.metric === 'orphanRate');
      expect(orphanDiff!.delta).toBeLessThan(0);
      expect(orphanDiff!.severity).toBe('ok');

      // Summary should reflect improvements
      expect(diff.summary.improved).toBeGreaterThan(0);
    });

    it('flags critical degradation when orphan rate spikes', () => {
      const before: HealthSnapshot = {
        timestamp: '2026-02-20T10:00:00Z',
        vaultPath: '/test',
        label: 'before',
        health: {
          noteCount: 100, linkCount: 300, linkDensity: 3.0, orphanRate: 0.05,
          orphanCount: 5, entityCoverage: 0.8, connectedness: 0.95,
          clusterCount: 1, giniCoefficient: 0.4, clusteringCoefficient: 0.2,
          avgPathLength: 2.5, betweennessCentrality: { top5PctShare: 0.3 },
          degreeCentralityStdDev: 3.0,
        },
      };

      const after: HealthSnapshot = {
        ...before,
        timestamp: '2026-02-20T11:00:00Z',
        label: 'after-degradation',
        health: {
          ...before.health,
          orphanRate: 0.25, // 400% increase from 0.05
          orphanCount: 25,
          connectedness: 0.70, // 26% drop — critical
        },
      };

      const diff = diffSnapshots(before, after);

      const orphanDiff = diff.metrics.find(m => m.metric === 'orphanRate');
      expect(orphanDiff!.severity).toBe('critical');

      const connDiff = diff.metrics.find(m => m.metric === 'connectedness');
      expect(connDiff!.severity).toBe('critical');

      expect(diff.summary.critical).toBeGreaterThanOrEqual(2);
    });

    it('reports unchanged metrics correctly', () => {
      const snapshot: HealthSnapshot = {
        timestamp: '2026-02-20T10:00:00Z',
        vaultPath: '/test',
        label: 'same',
        health: {
          noteCount: 50, linkCount: 150, linkDensity: 3.0, orphanRate: 0.05,
          orphanCount: 3, entityCoverage: 0.7, connectedness: 0.9,
          clusterCount: 1, giniCoefficient: 0.4, clusteringCoefficient: 0.15,
          avgPathLength: 2.8, betweennessCentrality: { top5PctShare: 0.3 },
          degreeCentralityStdDev: 2.5,
        },
      };

      const diff = diffSnapshots(snapshot, { ...snapshot, timestamp: '2026-02-20T11:00:00Z' });

      expect(diff.summary.unchanged).toBe(diff.metrics.length);
      expect(diff.summary.degraded).toBe(0);
      expect(diff.summary.critical).toBe(0);

      // All deltas should be zero
      for (const m of diff.metrics) {
        expect(m.delta).toBe(0);
        expect(m.severity).toBe('ok');
      }
    });
  });

  describe('formatSnapshotDiff', () => {
    it('produces readable output', () => {
      const diff: SnapshotDiff = {
        before: { timestamp: '2026-02-20T10:00:00Z', label: 'pre-edit' },
        after: { timestamp: '2026-02-20T10:30:00Z', label: 'post-edit' },
        metrics: [
          { metric: 'noteCount', before: 50, after: 52, delta: 2, percentChange: 0.04, severity: 'ok' },
          { metric: 'orphanRate', before: 0.05, after: 0.15, delta: 0.1, percentChange: 2.0, severity: 'critical' },
        ],
        summary: { improved: 1, degraded: 1, unchanged: 0, critical: 1 },
      };

      const output = formatSnapshotDiff(diff);

      expect(output).toContain('Graph Health Snapshot Diff');
      expect(output).toContain('pre-edit');
      expect(output).toContain('post-edit');
      expect(output).toContain('noteCount');
      expect(output).toContain('orphanRate');
      expect(output).toContain('CRIT');
      expect(output).toContain('1 CRITICAL');
    });
  });

  describe('cross-session persistence', () => {
    it('saves and loads snapshots from disk', async () => {
      await createTestNote(tempVault, 'entities/React.md', '# React\n\nUI framework.\n');
      await createTestNote(tempVault, 'notes/app.md', '# App\n\nUses [[React]].\n');

      const original = await takeSnapshot(tempVault, 'session-1');
      const snapshotPath = path.join(os.tmpdir(), `flywheel-snapshot-test-${Date.now()}.json`);

      await saveSnapshot(original, snapshotPath);
      const loaded = await loadSnapshot(snapshotPath);

      expect(loaded.label).toBe('session-1');
      expect(loaded.health.noteCount).toBe(original.health.noteCount);
      expect(loaded.health.linkCount).toBe(original.health.linkCount);
      expect(loaded.health.linkDensity).toBe(original.health.linkDensity);
      expect(loaded.health.orphanRate).toBe(original.health.orphanRate);
      expect(loaded.health.connectedness).toBe(original.health.connectedness);

      // Compare loaded snapshot with a new snapshot
      await createTestNote(tempVault, 'entities/Vue.md', '# Vue\n\nAnother framework.\n');
      const current = await takeSnapshot(tempVault, 'session-2');
      const diff = diffSnapshots(loaded, current);

      // Should detect the new note
      const noteCountDiff = diff.metrics.find(m => m.metric === 'noteCount');
      expect(noteCountDiff!.after).toBe(noteCountDiff!.before + 1);
    });
  });

  describe('integration with vault mutations', () => {
    it('detects health changes after adding cross-linked notes', async () => {
      // Start with a few disconnected notes
      await createTestNote(tempVault, 'entities/Alpha.md', '# Alpha\n\nEntity A.\n');
      await createTestNote(tempVault, 'entities/Beta.md', '# Beta\n\nEntity B.\n');
      await createTestNote(tempVault, 'entities/Gamma.md', '# Gamma\n\nEntity C.\n');

      const before = await takeSnapshot(tempVault, 'disconnected');

      // Add cross-links
      await writeFile(
        path.join(tempVault, 'entities/Alpha.md'),
        '# Alpha\n\nEntity A. Related to [[Beta]] and [[Gamma]].\n',
        'utf-8',
      );
      await writeFile(
        path.join(tempVault, 'entities/Beta.md'),
        '# Beta\n\nEntity B. Works with [[Alpha]].\n',
        'utf-8',
      );

      const after = await takeSnapshot(tempVault, 'cross-linked');
      const diff = diffSnapshots(before, after);

      // Link count should increase
      const linkDiff = diff.metrics.find(m => m.metric === 'linkCount');
      expect(linkDiff!.delta).toBeGreaterThan(0);

      // Orphan rate should decrease or stay same
      const orphanDiff = diff.metrics.find(m => m.metric === 'orphanRate');
      expect(orphanDiff!.delta).toBeLessThanOrEqual(0);
    });
  });
});
