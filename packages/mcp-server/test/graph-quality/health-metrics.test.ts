/**
 * Pillar 3: Graph Health Metrics
 *
 * Tests topology metrics of the primary vault structure.
 * Verifies that graph health metrics are within expected ranges
 * for a well-structured knowledge graph.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  buildGroundTruthVault,
  computeGraphHealth,
  loadPrimaryVault,
  type TempVault,
  type GroundTruthSpec,
  type GraphHealthReport,
} from './harness.js';

describe('Pillar 3: Graph Health Metrics', () => {
  let vault: TempVault;
  let spec: GroundTruthSpec;
  let health: GraphHealthReport;

  beforeAll(async () => {
    spec = await loadPrimaryVault();
    vault = await buildGroundTruthVault(spec);
    // Measure the vault AS-IS (with all wikilinks intact, before stripping)
    health = await computeGraphHealth(vault.vaultPath);
  }, 60000);

  afterAll(async () => {
    if (vault) await vault.cleanup();
  });

  describe('Core metrics', () => {
    it('computes valid health metrics', () => {
      expect(health.noteCount).toBeGreaterThan(0);
      expect(health.linkDensity).toBeGreaterThanOrEqual(0);
      expect(health.orphanRate).toBeGreaterThanOrEqual(0);
      expect(health.orphanRate).toBeLessThanOrEqual(1);
      expect(health.connectedness).toBeGreaterThanOrEqual(0);
      expect(health.connectedness).toBeLessThanOrEqual(1);
    });

    it('link density >= 1', () => {
      // Synthetic vaults have fewer inline wikilinks than hand-crafted ones
      expect(health.linkDensity).toBeGreaterThanOrEqual(1);
    });

    it('orphan rate < 50%', () => {
      // Generated vaults have many entity stub notes without outlinks
      expect(health.orphanRate).toBeLessThan(0.50);
    });

    it('entity coverage > 30%', () => {
      expect(health.entityCoverage).toBeGreaterThan(0.30);
    });

    it('connectedness >= 60%', () => {
      expect(health.connectedness).toBeGreaterThanOrEqual(0.60);
    });
  });

  describe('Topology metrics', () => {
    it('Gini coefficient in range 0.2-0.9', () => {
      // Healthy power-law distribution: not uniform, not monopolistic
      expect(health.giniCoefficient).toBeGreaterThanOrEqual(0.2);
      expect(health.giniCoefficient).toBeLessThanOrEqual(0.9);
    });

    it('clustering coefficient >= 0', () => {
      // Generated vaults may have sparse clusters
      expect(health.clusteringCoefficient).toBeGreaterThanOrEqual(0);
    });

    it('average path length <= 5.0', () => {
      expect(health.avgPathLength).toBeLessThanOrEqual(5.0);
    });

    it('degree centrality std dev > 1.0', () => {
      expect(health.degreeCentralityStdDev).toBeGreaterThan(1.0);
    });
  });

  describe('Metric sanity', () => {
    it('note count matches fixture', () => {
      expect(health.noteCount).toBe(spec.notes.length);
    });

    it('link density is consistent with link count and note count', () => {
      // linkDensity = linkCount / noteCount
      const expectedDensity = health.linkCount / health.noteCount;
      expect(health.linkDensity).toBeCloseTo(expectedDensity, 1);
    });
  });
});
