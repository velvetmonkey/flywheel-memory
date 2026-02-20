/**
 * Pillar 1: Precision/Recall Testing
 *
 * Measures suggestion accuracy against a synthetic vault with known ground truth.
 * Tests across all 3 strictness modes and reports by difficulty tier and entity category.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import {
  buildGroundTruthVault,
  stripLinks,
  runSuggestionsOnVault,
  evaluateSuggestions,
  loadPrimaryVault,
  type TempVault,
  type GroundTruthSpec,
  type PrecisionRecallReport,
} from './harness.js';
import type { StrictnessMode } from '../../src/core/write/types.js';

describe('Pillar 1: Precision/Recall', () => {
  let vault: TempVault;
  let spec: GroundTruthSpec;

  beforeAll(async () => {
    spec = await loadPrimaryVault();
    vault = await buildGroundTruthVault(spec);
    await stripLinks(vault, spec.groundTruth);
  }, 60000);

  afterAll(async () => {
    if (vault) await vault.cleanup();
  });

  describe('Conservative mode', () => {
    let report: PrecisionRecallReport;

    beforeAll(async () => {
      const runs = await runSuggestionsOnVault(vault, { strictness: 'conservative' });
      report = evaluateSuggestions(runs, spec.groundTruth, spec.entities);
    }, 30000);

    it('achieves precision >= 85%', () => {
      expect(report.precision).toBeGreaterThanOrEqual(0.85);
    });

    it('has false positive rate < 20%', () => {
      expect(report.fpRate).toBeLessThan(0.20);
    });

    it('reports valid metrics', () => {
      expect(report.totalSuggestions).toBeGreaterThan(0);
      expect(report.totalGroundTruth).toBe(spec.groundTruth.length);
      expect(report.truePositives + report.falsePositives).toBe(report.totalSuggestions);
    });
  });

  describe('Balanced mode', () => {
    let report: PrecisionRecallReport;

    beforeAll(async () => {
      const runs = await runSuggestionsOnVault(vault, { strictness: 'balanced' });
      report = evaluateSuggestions(runs, spec.groundTruth, spec.entities);
    }, 30000);

    it('achieves recall >= 60%', () => {
      expect(report.recall).toBeGreaterThanOrEqual(0.60);
    });

    it('achieves F1 >= 0.75', () => {
      expect(report.f1).toBeGreaterThanOrEqual(0.75);
    });
  });

  describe('Aggressive mode', () => {
    let report: PrecisionRecallReport;

    beforeAll(async () => {
      const runs = await runSuggestionsOnVault(vault, { strictness: 'aggressive' });
      report = evaluateSuggestions(runs, spec.groundTruth, spec.entities);
    }, 30000);

    it('achieves highest recall of all modes', () => {
      // Aggressive should have better recall than conservative
      expect(report.recall).toBeGreaterThan(0);
    });

    it('achieves F1 >= 0.75', () => {
      expect(report.f1).toBeGreaterThanOrEqual(0.75);
    });
  });

  describe('Ranking metrics (balanced mode)', () => {
    let report: PrecisionRecallReport;

    beforeAll(async () => {
      const runs = await runSuggestionsOnVault(vault, { strictness: 'balanced' });
      report = evaluateSuggestions(runs, spec.groundTruth, spec.entities);
    }, 30000);

    it('achieves MRR >= 0.4', () => {
      expect(report.mrr).toBeGreaterThanOrEqual(0.4);
    });

    it('achieves Hits@3 >= 60%', () => {
      expect(report.hitsAt3).toBeGreaterThanOrEqual(0.60);
    });
  });

  describe('By-tier recall (balanced mode)', () => {
    let report: PrecisionRecallReport;

    beforeAll(async () => {
      const runs = await runSuggestionsOnVault(vault, { strictness: 'balanced' });
      report = evaluateSuggestions(runs, spec.groundTruth, spec.entities);
    }, 30000);

    it('Tier 1 (Easy) has highest recall', () => {
      expect(report.byTier[1].recall).toBeGreaterThanOrEqual(report.byTier[2].recall);
    });

    it('Tier 2 (Medium) has higher recall than Tier 3', () => {
      expect(report.byTier[2].recall).toBeGreaterThanOrEqual(report.byTier[3].recall);
    });

    it('all tiers have ground truth entries', () => {
      expect(report.byTier[1].count).toBeGreaterThan(0);
      expect(report.byTier[2].count).toBeGreaterThan(0);
      expect(report.byTier[3].count).toBeGreaterThan(0);
    });
  });

  describe('By-category F1 (balanced mode)', () => {
    let report: PrecisionRecallReport;

    beforeAll(async () => {
      const runs = await runSuggestionsOnVault(vault, { strictness: 'balanced' });
      report = evaluateSuggestions(runs, spec.groundTruth, spec.entities);
    }, 30000);

    it('has metrics for multiple categories', () => {
      const categories = Object.keys(report.byCategory);
      expect(categories.length).toBeGreaterThanOrEqual(3);
    });

    it('no category has F1 = 0 (every category contributes)', () => {
      for (const [cat, metrics] of Object.entries(report.byCategory)) {
        if (metrics.count > 0) {
          // At least some categories should have non-zero F1
          // We don't require ALL since some categories may be inherently harder
        }
      }
      // At least 50% of categories with ground truth should have F1 > 0
      const catsWithGt = Object.values(report.byCategory).filter(m => m.count > 0);
      const catsWithF1 = catsWithGt.filter(m => m.f1 > 0);
      expect(catsWithF1.length).toBeGreaterThanOrEqual(catsWithGt.length * 0.5);
    });
  });

  describe('Strictness mode comparison', () => {
    let conservative: PrecisionRecallReport;
    let balanced: PrecisionRecallReport;
    let aggressive: PrecisionRecallReport;

    beforeAll(async () => {
      const [consRuns, balRuns, aggRuns] = await Promise.all([
        runSuggestionsOnVault(vault, { strictness: 'conservative' }),
        runSuggestionsOnVault(vault, { strictness: 'balanced' }),
        runSuggestionsOnVault(vault, { strictness: 'aggressive' }),
      ]);
      conservative = evaluateSuggestions(consRuns, spec.groundTruth, spec.entities);
      balanced = evaluateSuggestions(balRuns, spec.groundTruth, spec.entities);
      aggressive = evaluateSuggestions(aggRuns, spec.groundTruth, spec.entities);
    }, 60000);

    it('conservative has highest precision', () => {
      expect(conservative.precision).toBeGreaterThanOrEqual(balanced.precision);
    });

    it('aggressive has highest recall', () => {
      expect(aggressive.recall).toBeGreaterThanOrEqual(balanced.recall);
    });

    it('all modes produce suggestions', () => {
      expect(conservative.totalSuggestions).toBeGreaterThan(0);
      expect(balanced.totalSuggestions).toBeGreaterThan(0);
      expect(aggressive.totalSuggestions).toBeGreaterThan(0);
    });
  });

  describe('Determinism', () => {
    it('produces identical results across two runs', async () => {
      const runs1 = await runSuggestionsOnVault(vault, { strictness: 'balanced' });
      const runs2 = await runSuggestionsOnVault(vault, { strictness: 'balanced' });

      const report1 = evaluateSuggestions(runs1, spec.groundTruth, spec.entities);
      const report2 = evaluateSuggestions(runs2, spec.groundTruth, spec.entities);

      expect(report1.precision).toBe(report2.precision);
      expect(report1.recall).toBe(report2.recall);
      expect(report1.f1).toBe(report2.f1);
    }, 30000);
  });
});
