/**
 * Deep Parameter Sweep Test (Suite 4)
 *
 * Extends the existing parameter sweep to cover more scoring parameters.
 * Performs a cross-sweep of maxSuggestions x strictness, analyzes score
 * distributions and per-layer contributions, and simulates threshold
 * sensitivity by filtering at artificial score cutoffs.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
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
import {
  writeReport,
  distributionStats,
  Timer,
  type TestReport,
  type TuningRecommendation,
} from './report-utils.js';

// =============================================================================
// Types
// =============================================================================

interface CrossSweepEntry {
  maxSuggestions: number;
  strictness: StrictnessMode;
  f1: number;
  precision: number;
  recall: number;
  report: PrecisionRecallReport;
}

interface ScoreDistribution {
  mean: number;
  p50: number;
  p90: number;
  min: number;
  max: number;
}

interface LayerContribution {
  layer: string;
  mean: number;
  p50: number;
  p90: number;
  min: number;
  max: number;
}

interface ThresholdEntry {
  threshold: number;
  f1: number;
  precision: number;
  recall: number;
  candidateCount: number;
}

// =============================================================================
// Test Suite
// =============================================================================

describe('Deep Parameter Sweep', () => {
  let vault: TempVault;
  let spec: GroundTruthSpec;
  const timer = new Timer();

  // Sweep 1: maxSuggestions x strictness cross-sweep
  const crossSweepResults: CrossSweepEntry[] = [];

  // Sweep 2: Score distribution analysis
  let scoreDistribution: ScoreDistribution;
  let layerContributions: LayerContribution[];
  let allScores: number[];

  // Sweep 3: Threshold sensitivity
  const thresholdResults: ThresholdEntry[] = [];

  beforeAll(async () => {
    spec = await loadPrimaryVault();
    vault = await buildGroundTruthVault(spec);
    await stripLinks(vault, spec.groundTruth);

    // =========================================================================
    // Sweep 1: maxSuggestions x strictness cross-sweep
    // =========================================================================
    const maxSuggestionsValues = [1, 3, 5, 7, 10];
    const strictnessModes: StrictnessMode[] = ['conservative', 'balanced', 'aggressive'];

    for (const strictness of strictnessModes) {
      for (const maxSuggestions of maxSuggestionsValues) {
        const runs = await runSuggestionsOnVault(vault, {
          maxSuggestions,
          strictness,
        });
        const report = evaluateSuggestions(runs, spec.groundTruth, spec.entities);
        crossSweepResults.push({
          maxSuggestions,
          strictness,
          f1: report.f1,
          precision: report.precision,
          recall: report.recall,
          report,
        });
      }
    }

    // =========================================================================
    // Sweep 2: Score distribution analysis
    // =========================================================================
    // Run with high maxSuggestions to capture all scored candidates
    const detailRuns = await runSuggestionsOnVault(vault, {
      maxSuggestions: 10,
      strictness: 'balanced',
    });

    // Collect all scores from detailed results
    allScores = [];
    const layerValues: Record<string, number[]> = {
      contentMatch: [],
      cooccurrenceBoost: [],
      typeBoost: [],
      contextBoost: [],
      recencyBoost: [],
      crossFolderBoost: [],
      hubBoost: [],
      feedbackAdjustment: [],
      semanticBoost: [],
      edgeWeightBoost: [],
    };

    for (const run of detailRuns) {
      if (!run.detailed) continue;
      for (const d of run.detailed) {
        allScores.push(d.totalScore);

        // Collect per-layer values
        const b = d.breakdown;
        layerValues.contentMatch.push(b.contentMatch);
        layerValues.cooccurrenceBoost.push(b.cooccurrenceBoost);
        layerValues.typeBoost.push(b.typeBoost);
        layerValues.contextBoost.push(b.contextBoost);
        layerValues.recencyBoost.push(b.recencyBoost);
        layerValues.crossFolderBoost.push(b.crossFolderBoost);
        layerValues.hubBoost.push(b.hubBoost);
        layerValues.feedbackAdjustment.push(b.feedbackAdjustment);
        if (b.semanticBoost !== undefined) {
          layerValues.semanticBoost.push(b.semanticBoost);
        }
        if (b.edgeWeightBoost !== undefined) {
          layerValues.edgeWeightBoost.push(b.edgeWeightBoost);
        }
      }
    }

    scoreDistribution = distributionStats(allScores);

    layerContributions = Object.entries(layerValues)
      .filter(([, values]) => values.length > 0)
      .map(([layer, values]) => {
        const stats = distributionStats(values);
        return {
          layer,
          mean: stats.mean,
          p50: stats.p50,
          p90: stats.p90,
          min: stats.min,
          max: stats.max,
        };
      });

    // =========================================================================
    // Sweep 3: Threshold sensitivity
    // =========================================================================
    // Run balanced mode with high maxSuggestions to get all candidates
    const allCandidateRuns = await runSuggestionsOnVault(vault, {
      maxSuggestions: 20,
      strictness: 'balanced',
    });

    const thresholds = [5, 8, 10, 12, 15, 20];

    for (const threshold of thresholds) {
      // Filter detailed results to only include suggestions above the threshold,
      // then evaluate against ground truth
      const filteredRuns = allCandidateRuns.map(run => {
        if (!run.detailed) {
          return { ...run, suggestions: [] };
        }
        const passing = run.detailed
          .filter(d => d.totalScore >= threshold)
          .map(d => d.entity);
        return {
          ...run,
          suggestions: passing,
        };
      });

      const report = evaluateSuggestions(filteredRuns, spec.groundTruth, spec.entities);
      const candidateCount = filteredRuns.reduce((sum, r) => sum + r.suggestions.length, 0);

      thresholdResults.push({
        threshold,
        f1: report.f1,
        precision: report.precision,
        recall: report.recall,
        candidateCount,
      });
    }
  }, 180000);

  afterAll(async () => {
    // Write report
    const bestCross = crossSweepResults.reduce((a, b) => (a.f1 > b.f1 ? a : b));
    const defaultEntry = crossSweepResults.find(
      r => r.maxSuggestions === 5 && r.strictness === 'balanced',
    );
    const defaultF1 = defaultEntry?.f1 ?? 0;
    const delta = bestCross.f1 - defaultF1;

    const recommendations: TuningRecommendation[] = [];

    // Recommend if an alternative beats default by >10%
    if (delta > 0.10) {
      recommendations.push({
        parameter: 'maxSuggestions+strictness',
        current_value: 5,
        suggested_value: bestCross.maxSuggestions,
        evidence: `Config (maxSuggestions=${bestCross.maxSuggestions}, strictness=${bestCross.strictness}) achieves F1=${bestCross.f1} vs default F1=${defaultF1} (delta=${Math.round(delta * 1000) / 1000})`,
        confidence: delta > 0.15 ? 'high' : 'medium',
      });
    }

    // Check threshold sensitivity for recommendations
    const bestThreshold = thresholdResults.reduce((a, b) => (a.f1 > b.f1 ? a : b));
    const currentThresholdEntry = thresholdResults.find(t => t.threshold === 8); // balanced default is 8
    if (currentThresholdEntry && bestThreshold.f1 - currentThresholdEntry.f1 > 0.10) {
      recommendations.push({
        parameter: 'minSuggestionScore',
        current_value: 8,
        suggested_value: bestThreshold.threshold,
        evidence: `Threshold ${bestThreshold.threshold} achieves F1=${bestThreshold.f1} vs current threshold 8 F1=${currentThresholdEntry.f1}`,
        confidence: bestThreshold.f1 - currentThresholdEntry.f1 > 0.15 ? 'high' : 'medium',
      });
    }

    const report: TestReport = {
      suite: 'parameter-sweep-report',
      timestamp: new Date().toISOString(),
      duration_ms: timer.elapsed(),
      summary: {
        best_f1: bestCross.f1,
        best_maxSuggestions: bestCross.maxSuggestions,
        current_default_f1: defaultF1,
        delta,
        score_distribution_mean: scoreDistribution?.mean ?? 0,
        score_distribution_p50: scoreDistribution?.p50 ?? 0,
        score_distribution_p90: scoreDistribution?.p90 ?? 0,
        threshold_best_f1: bestThreshold.f1,
        threshold_best_value: bestThreshold.threshold,
      },
      details: [
        { sweep: 'cross_sweep', results: crossSweepResults.map(r => ({
          maxSuggestions: r.maxSuggestions,
          strictness: r.strictness,
          f1: r.f1,
          precision: r.precision,
          recall: r.recall,
        })) },
        { sweep: 'score_distribution', stats: scoreDistribution, layer_contributions: layerContributions },
        { sweep: 'threshold_sensitivity', results: thresholdResults },
      ],
      tuning_recommendations: recommendations,
    };

    await writeReport(report);

    if (vault) await vault.cleanup();
  });

  // ===========================================================================
  // Cross-Sweep Assertions
  // ===========================================================================

  test('balanced mode F1 is within 15% of best cross-sweep combo', () => {
    const bestF1 = Math.max(...crossSweepResults.map(r => r.f1));
    const balancedResults = crossSweepResults.filter(r => r.strictness === 'balanced');
    const bestBalancedF1 = Math.max(...balancedResults.map(r => r.f1));
    expect(bestBalancedF1).toBeGreaterThanOrEqual(bestF1 * 0.85);
  });

  test('no dramatic outliers in cross-sweep (no combo with F1 < 40% of best)', () => {
    const bestF1 = Math.max(...crossSweepResults.map(r => r.f1));
    // Conservative mode with low maxSuggestions can have legitimately lower F1.
    // Use 40% threshold and skip maxSuggestions <= 1.
    for (const entry of crossSweepResults) {
      if (bestF1 > 0 && entry.maxSuggestions > 1) {
        expect(entry.f1).toBeGreaterThanOrEqual(bestF1 * 0.4);
      }
    }
  });

  test('at least one strictness mode achieves F1 > 0', () => {
    const maxF1 = Math.max(...crossSweepResults.map(r => r.f1));
    expect(maxF1).toBeGreaterThan(0);
  });

  test('cross-sweep covers all 15 combinations', () => {
    expect(crossSweepResults).toHaveLength(15);
  });

  test('increasing maxSuggestions increases or maintains recall within each mode', () => {
    const modes: StrictnessMode[] = ['conservative', 'balanced', 'aggressive'];
    for (const mode of modes) {
      const modeEntries = crossSweepResults
        .filter(r => r.strictness === mode)
        .sort((a, b) => a.maxSuggestions - b.maxSuggestions);
      for (let i = 1; i < modeEntries.length; i++) {
        // Recall should be monotonically non-decreasing with more suggestions
        // Allow a small tolerance for floating point
        expect(modeEntries[i].recall).toBeGreaterThanOrEqual(
          modeEntries[i - 1].recall - 0.01,
        );
      }
    }
  });

  // ===========================================================================
  // Score Distribution Assertions
  // ===========================================================================

  test('score distribution has no NaN or Infinity values', () => {
    for (const score of allScores) {
      expect(Number.isFinite(score)).toBe(true);
    }
  });

  test('score distribution stats are valid', () => {
    expect(Number.isFinite(scoreDistribution.mean)).toBe(true);
    expect(Number.isFinite(scoreDistribution.p50)).toBe(true);
    expect(Number.isFinite(scoreDistribution.p90)).toBe(true);
    expect(Number.isFinite(scoreDistribution.min)).toBe(true);
    expect(Number.isFinite(scoreDistribution.max)).toBe(true);
    expect(scoreDistribution.min).toBeLessThanOrEqual(scoreDistribution.max);
    expect(scoreDistribution.p50).toBeLessThanOrEqual(scoreDistribution.p90);
  });

  test('layer contributions are all finite', () => {
    for (const layer of layerContributions) {
      expect(Number.isFinite(layer.mean)).toBe(true);
      expect(Number.isFinite(layer.p50)).toBe(true);
      expect(Number.isFinite(layer.p90)).toBe(true);
      expect(Number.isFinite(layer.min)).toBe(true);
      expect(Number.isFinite(layer.max)).toBe(true);
    }
  });

  test('contentMatch layer has non-zero contribution', () => {
    const contentMatch = layerContributions.find(l => l.layer === 'contentMatch');
    expect(contentMatch).toBeDefined();
    expect(contentMatch!.mean).toBeGreaterThan(0);
  });

  // ===========================================================================
  // Threshold Sensitivity Assertions
  // ===========================================================================

  test('threshold sweep covers all tested thresholds', () => {
    expect(thresholdResults).toHaveLength(6);
  });

  test('lower thresholds produce more candidates', () => {
    const sorted = [...thresholdResults].sort((a, b) => a.threshold - b.threshold);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].candidateCount).toBeLessThanOrEqual(sorted[i - 1].candidateCount);
    }
  });

  test('threshold sensitivity results have no NaN F1 values', () => {
    for (const entry of thresholdResults) {
      expect(Number.isFinite(entry.f1)).toBe(true);
      expect(Number.isFinite(entry.precision)).toBe(true);
      expect(Number.isFinite(entry.recall)).toBe(true);
    }
  });

  test('higher thresholds increase or maintain precision', () => {
    const sorted = [...thresholdResults].sort((a, b) => a.threshold - b.threshold);
    for (let i = 1; i < sorted.length; i++) {
      // Higher threshold should produce equal or better precision
      // (fewer but more confident suggestions). Allow small tolerance.
      if (sorted[i].candidateCount > 0 && sorted[i - 1].candidateCount > 0) {
        expect(sorted[i].precision).toBeGreaterThanOrEqual(
          sorted[i - 1].precision - 0.05,
        );
      }
    }
  });

  test('default threshold (8) is within reasonable range of optimal', () => {
    const bestThreshold = thresholdResults.reduce((a, b) => (a.f1 > b.f1 ? a : b));
    const defaultThreshold = thresholdResults.find(t => t.threshold === 8);
    expect(defaultThreshold).toBeDefined();
    if (bestThreshold.f1 > 0) {
      // Default should be within 25% of optimal threshold F1
      expect(defaultThreshold!.f1).toBeGreaterThanOrEqual(bestThreshold.f1 * 0.75);
    }
  });
});
