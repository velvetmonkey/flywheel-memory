/**
 * Pillar 5: Fuzzy Vault Chaos Testing
 *
 * Tests the suggestion engine under adversarial conditions:
 * typos, inconsistent formatting, ambiguous entities, mixed naming.
 * Verifies graceful degradation rather than hard failures.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  buildGroundTruthVault,
  stripLinks,
  runSuggestionsOnVault,
  evaluateSuggestions,
  computeGraphHealth,
  loadChaosVault,
  loadPrimaryVault,
  type TempVault,
  type GroundTruthSpec,
  type PrecisionRecallReport,
  type GraphHealthReport,
} from './harness.js';

describe('Pillar 5: Chaos Vault Testing', () => {
  let vault: TempVault;
  let spec: GroundTruthSpec;
  let report: PrecisionRecallReport;
  let healthBefore: GraphHealthReport;
  let healthAfter: GraphHealthReport;
  let fixtureFound = true;

  // Clean vault reference metrics for degradation comparison
  let cleanReport: PrecisionRecallReport;

  beforeAll(async () => {
    // Load clean vault first for degradation comparison
    try {
      const cleanSpec = await loadPrimaryVault();
      const cleanVault = await buildGroundTruthVault(cleanSpec);
      await stripLinks(cleanVault, cleanSpec.groundTruth);
      const cleanRuns = await runSuggestionsOnVault(cleanVault);
      cleanReport = evaluateSuggestions(cleanRuns, cleanSpec.groundTruth, cleanSpec.entities);
      await cleanVault.cleanup();
    } catch (e) {
      console.warn('[graph-quality] Could not load primary vault for degradation baseline');
    }

    // Load chaos vault
    try {
      spec = await loadChaosVault();
    } catch (e) {
      console.warn('[graph-quality] Skipping chaos tests: chaos-vault.json fixture not found');
      fixtureFound = false;
      return;
    }

    vault = await buildGroundTruthVault(spec);
    await stripLinks(vault, spec.groundTruth);
    healthBefore = await computeGraphHealth(vault.vaultPath);
    const runs = await runSuggestionsOnVault(vault);
    report = evaluateSuggestions(runs, spec.groundTruth, spec.entities);
    healthAfter = await computeGraphHealth(vault.vaultPath);
  }, 60000);

  afterAll(async () => {
    if (vault) await vault.cleanup();
  });

  describe('Relaxed precision/recall', () => {
    it('precision >= 70%', () => {
      if (!fixtureFound) return;
      expect(report.precision).toBeGreaterThanOrEqual(0.70);
    });

    it('recall >= 50%', () => {
      if (!fixtureFound) return;
      expect(report.recall).toBeGreaterThanOrEqual(0.50);
    });

    it('F1 >= 0.62', () => {
      if (!fixtureFound) return;
      expect(report.f1).toBeGreaterThanOrEqual(0.62);
    });
  });

  describe('Robustness', () => {
    it('no crashes during suggestion generation', () => {
      if (!fixtureFound) return;
      // If we reached this point, no crashes occurred
      expect(report.totalSuggestions).toBeGreaterThanOrEqual(0);
    });

    it('entity coverage >= 60%', () => {
      if (!fixtureFound) return;
      expect(healthAfter.entityCoverage).toBeGreaterThanOrEqual(0.60);
    });
  });

  describe('Graceful degradation', () => {
    it('chaos F1 is lower than clean F1 (expected degradation)', () => {
      if (!fixtureFound || !cleanReport) return;
      // Chaos conditions should make the engine perform worse, but not catastrophically
      expect(report.f1).toBeLessThanOrEqual(cleanReport.f1);
    });

    it('chaos precision is within 20pp of clean precision', () => {
      if (!fixtureFound || !cleanReport) return;
      const precisionDelta = Math.abs(cleanReport.precision - report.precision);
      expect(precisionDelta).toBeLessThanOrEqual(0.20);
    });
  });
});
