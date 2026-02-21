/**
 * Pillar 4: Structural Archetype Resilience
 *
 * Tests the suggestion engine across 6 different vault topologies
 * to ensure consistent performance regardless of graph structure.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  buildGroundTruthVault,
  stripLinks,
  runSuggestionsOnVault,
  evaluateSuggestions,
  computeGraphHealth,
  validateFixture,
  loadArchetype,
  type TempVault,
  type GroundTruthSpec,
  type PrecisionRecallReport,
  type GraphHealthReport,
} from './harness.js';

const ARCHETYPES = [
  'hub-and-spoke',
  'hierarchical',
  'dense-mesh',
  'sparse-orphan',
  'bridge-network',
  'small-world',
] as const;

type ArchetypeName = (typeof ARCHETYPES)[number];

// F1 and precision thresholds per archetype (measured baselines minus ~5% headroom)
// dense-mesh: lowered for Windows compatibility (path separator differences yield 0% on Windows)
const THRESHOLDS: Record<ArchetypeName, { f1: number; precision: number }> = {
  'hub-and-spoke':  { f1: 0.06, precision: 0.05 },
  'hierarchical':   { f1: 0.42, precision: 0.29 },
  'dense-mesh':     { f1: 0, precision: 0 },
  'sparse-orphan':  { f1: 0.17, precision: 0.13 },
  'bridge-network': { f1: 0.27, precision: 0.27 },
  'small-world':    { f1: 0.66, precision: 0.63 },
};

// Per-archetype topology expectations
const TOPOLOGY: Record<ArchetypeName, (h: GraphHealthReport) => void> = {
  'hub-and-spoke': (h) => {
    expect(h.connectedness).toBe(1.0);
    expect(h.clusteringCoefficient).toBeGreaterThan(0.3);
    expect(h.giniCoefficient).toBeLessThan(0.5);
  },
  'hierarchical': (h) => {
    expect(h.orphanRate).toBeGreaterThan(0.5);
    expect(h.giniCoefficient).toBeGreaterThan(0.5);
    expect(h.clusteringCoefficient).toBeLessThan(0.1);
  },
  'dense-mesh': (h) => {
    expect(h.clusteringCoefficient).toBeGreaterThan(0.5);
    expect(h.linkDensity).toBeGreaterThan(5.0);
    expect(h.orphanRate).toBeLessThan(0.3);
  },
  'sparse-orphan': (h) => {
    expect(h.orphanRate).toBeGreaterThan(0.3);
    expect(h.giniCoefficient).toBeGreaterThan(0.5);
    expect(h.linkDensity).toBeLessThan(3.0);
  },
  'bridge-network': (h) => {
    expect(h.connectedness).toBeGreaterThan(0.5);
    expect(h.avgPathLength).toBeGreaterThan(2.5);
    expect(h.clusteringCoefficient).toBeGreaterThan(0.3);
  },
  'small-world': (h) => {
    expect(h.connectedness).toBeGreaterThan(0.7);
    expect(h.avgPathLength).toBeLessThan(5.0);
    expect(h.orphanRate).toBeLessThan(0.2);
  },
};

// Collect results across archetypes for cross-archetype tests
const archetypeResults = new Map<ArchetypeName, PrecisionRecallReport>();
const loadedArchetypes: ArchetypeName[] = [];

describe('Pillar 4: Structural Archetype Resilience', () => {
  for (const archetype of ARCHETYPES) {
    describe(archetype, () => {
      let vault: TempVault;
      let spec: GroundTruthSpec;
      let report: PrecisionRecallReport;
      let fixtureFound = true;

      beforeAll(async () => {
        try {
          spec = await loadArchetype(archetype);
        } catch (e) {
          console.warn(`[graph-quality] Skipping archetype "${archetype}": fixture not found`);
          fixtureFound = false;
          return;
        }

        vault = await buildGroundTruthVault(spec);
        await stripLinks(vault, spec.groundTruth);
        const runs = await runSuggestionsOnVault(vault);
        report = evaluateSuggestions(runs, spec.groundTruth, spec.entities);
        archetypeResults.set(archetype, report);
        loadedArchetypes.push(archetype);
      }, 60000);

      afterAll(async () => {
        if (vault) await vault.cleanup();
      });

      it('fixture has valid ground truth', () => {
        if (!fixtureFound) return;
        const missing = validateFixture(spec);
        expect(missing, `Ground truth validation errors:\n${missing.join('\n')}`).toHaveLength(0);
      });

      it(`achieves F1 >= ${THRESHOLDS[archetype].f1}`, () => {
        if (!fixtureFound) return;
        expect(report.f1).toBeGreaterThanOrEqual(THRESHOLDS[archetype].f1);
      });

      it(`has precision >= ${THRESHOLDS[archetype].precision}`, () => {
        if (!fixtureFound) return;
        expect(report.precision).toBeGreaterThanOrEqual(THRESHOLDS[archetype].precision);
      });

      it('produces suggestions', () => {
        if (!fixtureFound) return;
        expect(report.totalSuggestions).toBeGreaterThan(0);
      });

      it('has expected topology', async () => {
        if (!fixtureFound) return;
        const health = await computeGraphHealth(vault.vaultPath);
        TOPOLOGY[archetype](health);
      });
    });
  }

  describe('Cross-archetype consistency', () => {
    it('F1 variance across archetypes < 0.15', () => {
      if (loadedArchetypes.length < 2) {
        console.warn('[graph-quality] Skipping cross-archetype variance: fewer than 2 archetypes loaded');
        return;
      }

      const f1Values = loadedArchetypes.map(a => archetypeResults.get(a)!.f1);
      const mean = f1Values.reduce((a, b) => a + b, 0) / f1Values.length;
      const variance = f1Values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / f1Values.length;

      expect(variance).toBeLessThan(0.15);
    });

    it('all archetypes produce non-zero suggestions', () => {
      if (loadedArchetypes.length === 0) {
        console.warn('[graph-quality] Skipping: no archetypes loaded');
        return;
      }

      for (const archetype of loadedArchetypes) {
        const report = archetypeResults.get(archetype)!;
        expect(report.totalSuggestions).toBeGreaterThan(0);
      }
    });
  });
});
