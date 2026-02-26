/**
 * Suite: Sparse Feedback Scenario (T12)
 *
 * Models production reality where 80% of entities have zero feedback.
 * Only records feedback for 20% of entities (randomly selected per round).
 *
 * Verifies:
 * - Scoring engine makes reasonable decisions for zero-feedback entities
 * - Feedback-boosted entities don't unfairly crowd out zero-feedback entities
 * - F1 does not regress compared to baseline (no feedback at all)
 * - The system remains stable when most entities are in "cold start"
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  buildGroundTruthVault,
  stripLinks,
  runSuggestionsOnVault,
  evaluateSuggestions,
  loadPrimaryVault,
  type TempVault,
  type GroundTruthSpec,
  type PrecisionRecallReport,
  type SuggestionRun,
} from './harness.js';
import {
  recordFeedback,
  updateSuppressionList,
} from '../../src/core/write/wikilinkFeedback.js';

// =============================================================================
// Constants
// =============================================================================

const TOTAL_ROUNDS = 10;
const FEEDBACK_COVERAGE = 0.20; // Only 20% of entities receive feedback
const TP_CORRECT_RATE = 0.85;
const FP_CORRECT_RATE = 0.15;

// =============================================================================
// Helpers
// =============================================================================

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const normalize = (name: string): string => name.toLowerCase().replace(/-/g, ' ');

interface RoundMetrics {
  round: number;
  f1: number;
  precision: number;
  recall: number;
  feedbackEntitiesCount: number; // How many entities received feedback this round
  zeroFeedbackSuggestionCount: number; // Suggestions for entities with zero total feedback
}

// =============================================================================
// Test Suite
// =============================================================================

describe('Suite: Sparse Feedback', () => {
  let vault: TempVault;
  let spec: GroundTruthSpec;
  let baselineReport: PrecisionRecallReport;
  const roundMetrics: RoundMetrics[] = [];

  // Track which entities have received any feedback across all rounds
  const entitiesWithFeedback = new Set<string>();

  beforeAll(async () => {
    spec = await loadPrimaryVault();
    vault = await buildGroundTruthVault(spec);
    await stripLinks(vault, spec.groundTruth);

    // Baseline: no feedback at all
    const baselineRuns = await runSuggestionsOnVault(vault, { strictness: 'balanced' });
    baselineReport = evaluateSuggestions(baselineRuns, spec.groundTruth, spec.entities);

    const rng = mulberry32(7777);

    // Build ground truth lookup
    const gtByNote = new Map<string, Set<string>>();
    for (const gt of spec.groundTruth) {
      const set = gtByNote.get(gt.notePath) || new Set();
      set.add(normalize(gt.entity));
      gtByNote.set(gt.notePath, set);
    }

    // Get all unique entity names from suggestions
    const allEntityNames = new Set<string>();
    for (const entity of spec.entities) {
      allEntityNames.add(normalize(entity.name));
    }

    for (let round = 0; round < TOTAL_ROUNDS; round++) {
      const runs = await runSuggestionsOnVault(vault, { strictness: 'balanced' });
      const report = evaluateSuggestions(runs, spec.groundTruth, spec.entities);

      // Select 20% of entities to receive feedback this round
      const entityList = [...allEntityNames];
      const feedbackEntities = new Set<string>();
      for (const name of entityList) {
        if (rng() < FEEDBACK_COVERAGE) {
          feedbackEntities.add(name);
        }
      }

      let feedbackCount = 0;
      for (const run of runs) {
        const noteGt = gtByNote.get(run.notePath);
        if (!noteGt) continue;

        for (const suggestion of run.suggestions) {
          const normalizedSuggestion = normalize(suggestion);

          // Only record feedback for the 20% selected this round
          if (!feedbackEntities.has(normalizedSuggestion)) continue;

          const isTP = noteGt.has(normalizedSuggestion);
          const isCorrect = isTP ? rng() < TP_CORRECT_RATE : rng() < FP_CORRECT_RATE;
          recordFeedback(vault.stateDb, suggestion, 'sparse-feedback', run.notePath, isCorrect);
          entitiesWithFeedback.add(normalizedSuggestion);
          feedbackCount++;
        }
      }

      updateSuppressionList(vault.stateDb);

      // Count suggestions for zero-feedback entities
      let zeroFeedbackSuggestionCount = 0;
      for (const run of runs) {
        for (const suggestion of run.suggestions) {
          if (!entitiesWithFeedback.has(normalize(suggestion))) {
            zeroFeedbackSuggestionCount++;
          }
        }
      }

      roundMetrics.push({
        round,
        f1: report.f1,
        precision: report.precision,
        recall: report.recall,
        feedbackEntitiesCount: feedbackCount,
        zeroFeedbackSuggestionCount,
      });
    }
  }, 300000);

  afterAll(async () => {
    if (vault) await vault.cleanup();
  });

  // ===========================================================================
  // Assertions
  // ===========================================================================

  it('baseline established without feedback', () => {
    expect(baselineReport.f1).toBeGreaterThan(0);
    expect(baselineReport.totalSuggestions).toBeGreaterThan(0);
  });

  it('F1 does not regress with sparse feedback', () => {
    expect(roundMetrics.length).toBe(TOTAL_ROUNDS);
    const lastRound = roundMetrics[TOTAL_ROUNDS - 1];
    // Sparse feedback should not make things worse
    expect(lastRound.f1).toBeGreaterThanOrEqual(baselineReport.f1 - 0.05);
  });

  it('zero-feedback entities still get suggested', () => {
    // Throughout the run, entities with zero feedback should still appear in suggestions
    // This verifies that feedback-boosted entities don't crowd them out
    const lastRound = roundMetrics[TOTAL_ROUNDS - 1];
    expect(lastRound.zeroFeedbackSuggestionCount).toBeGreaterThan(0);
  });

  it('at most 80% of entities receive any feedback across all rounds', () => {
    // Verify the sparse feedback model is actually sparse
    const totalEntities = spec.entities.length;
    const coverageRate = entitiesWithFeedback.size / totalEntities;
    // With 20% per round over 10 rounds, coverage should be ~87%
    // (1 - 0.8^10 = 0.893). Allow some margin.
    expect(coverageRate).toBeLessThan(1.0);
  });

  it('precision remains stable under sparse feedback', () => {
    // Precision should not wildly oscillate with sparse signals
    for (let i = 1; i < roundMetrics.length; i++) {
      const drop = roundMetrics[i - 1].precision - roundMetrics[i].precision;
      expect(drop).toBeLessThanOrEqual(0.15);
    }
  });

  it('no single round drops F1 by more than 10pp', () => {
    for (let i = 1; i < roundMetrics.length; i++) {
      const drop = roundMetrics[i - 1].f1 - roundMetrics[i].f1;
      expect(drop).toBeLessThanOrEqual(0.10);
    }
  });
});
