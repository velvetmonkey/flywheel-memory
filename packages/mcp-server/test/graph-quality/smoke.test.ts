/**
 * Production Smoke Test
 *
 * Validates graph health invariants against the test vault fixtures.
 * When run with a real vault path (via VAULT_PATH env var), tests production data.
 *
 * Usage:
 *   # Test fixtures (default, CI-safe)
 *   npm run test:quality
 *
 *   # Test real vault (manual, production smoke)
 *   VAULT_PATH=~/obsidian/Ben npm run test:quality -- smoke.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import {
  buildGroundTruthVault,
  computeGraphHealth,
  loadPrimaryVault,
  type TempVault,
  type GroundTruthSpec,
  type GraphHealthReport,
} from './harness.js';
import { takeSnapshot, diffSnapshots, formatSnapshotDiff } from './health-snapshot.js';

describe('Production Smoke Test', () => {
  let vault: TempVault | null = null;
  let health: GraphHealthReport;
  let vaultPath: string;

  beforeAll(async () => {
    const envVaultPath = process.env.VAULT_PATH;

    if (envVaultPath) {
      // Real vault mode: test against production data
      vaultPath = path.resolve(envVaultPath);
      health = await computeGraphHealth(vaultPath);
    } else {
      // Fixture mode: use primary vault fixture
      const spec = await loadPrimaryVault();
      vault = await buildGroundTruthVault(spec);
      vaultPath = vault.vaultPath;
      health = await computeGraphHealth(vaultPath);
    }
  }, 120000);

  afterAll(async () => {
    if (vault) await vault.cleanup();
  });

  describe('Core health invariants', () => {
    it('has notes', () => {
      expect(health.noteCount).toBeGreaterThan(0);
    });

    it('has links', () => {
      expect(health.linkCount).toBeGreaterThan(0);
    });

    it('link density >= 1.0', () => {
      // Minimum 1 link per note on average
      expect(health.linkDensity).toBeGreaterThanOrEqual(1.0);
    });

    it('orphan rate < 50%', () => {
      // Less than half of notes should be completely disconnected
      expect(health.orphanRate).toBeLessThan(0.50);
    });

    it('entity coverage > 20%', () => {
      expect(health.entityCoverage).toBeGreaterThan(0.20);
    });

    it('connectedness >= 50%', () => {
      // At least half the graph should be reachable
      expect(health.connectedness).toBeGreaterThanOrEqual(0.50);
    });
  });

  describe('Topology sanity', () => {
    it('Gini coefficient in valid range (0-1)', () => {
      expect(health.giniCoefficient).toBeGreaterThanOrEqual(0);
      expect(health.giniCoefficient).toBeLessThanOrEqual(1);
    });

    it('clustering coefficient >= 0', () => {
      expect(health.clusteringCoefficient).toBeGreaterThanOrEqual(0);
    });

    it('average path length is finite', () => {
      expect(Number.isFinite(health.avgPathLength)).toBe(true);
      expect(health.avgPathLength).toBeGreaterThanOrEqual(0);
    });

    it('degree centrality std dev is non-negative', () => {
      expect(health.degreeCentralityStdDev).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Metric consistency', () => {
    it('link density equals linkCount / noteCount', () => {
      if (health.noteCount === 0) return;
      const expected = health.linkCount / health.noteCount;
      expect(health.linkDensity).toBeCloseTo(expected, 1);
    });

    it('orphan count is consistent with orphan rate', () => {
      if (health.noteCount === 0) return;
      const expectedRate = health.orphanCount / health.noteCount;
      expect(health.orphanRate).toBeCloseTo(expectedRate, 1);
    });

    it('cluster count >= 1 when notes exist', () => {
      if (health.noteCount === 0) return;
      expect(health.clusterCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Snapshot stability', () => {
    it('two consecutive snapshots produce zero-diff', async () => {
      const snap1 = await takeSnapshot(vaultPath, 'snap-1');
      const snap2 = await takeSnapshot(vaultPath, 'snap-2');
      const diff = diffSnapshots(snap1, snap2);

      // All metrics should be identical (no mutations between snapshots)
      expect(diff.summary.unchanged).toBe(diff.metrics.length);
      expect(diff.summary.degraded).toBe(0);
      expect(diff.summary.critical).toBe(0);
    });
  });
});
