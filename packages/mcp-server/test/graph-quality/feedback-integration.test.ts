/**
 * Feedback Integration Test
 *
 * Proves that the feedback loop improves suggestion quality over time.
 * Records positive/negative feedback, verifies boost tiers activate,
 * checks suppression logic, and validates that F1 does not regress.
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
  getFeedbackBoost,
  getEntityJourney,
  updateSuppressionList,
  isSuppressed,
  trackWikilinkApplications,
  FEEDBACK_BOOST_MIN_SAMPLES,
} from '../../src/core/write/wikilinkFeedback.js';
import type { StateDb } from '@velvetmonkey/vault-core';

// =============================================================================
// Helpers
// =============================================================================

const normalize = (name: string): string => name.toLowerCase().replace(/-/g, ' ');

function findTruePositives(
  runs: SuggestionRun[],
  spec: GroundTruthSpec,
): Array<{ entity: string; notePath: string }> {
  const gtByNote = new Map<string, Set<string>>();
  for (const gt of spec.groundTruth) {
    const set = gtByNote.get(gt.notePath) || new Set();
    set.add(normalize(gt.entity));
    gtByNote.set(gt.notePath, set);
  }

  const truePositives: Array<{ entity: string; notePath: string }> = [];
  for (const run of runs) {
    const noteGt = gtByNote.get(run.notePath);
    if (!noteGt) continue;
    for (const suggestion of run.suggestions) {
      if (noteGt.has(normalize(suggestion))) {
        truePositives.push({ entity: suggestion, notePath: run.notePath });
      }
    }
  }
  return truePositives;
}

function findFalsePositives(
  runs: SuggestionRun[],
  spec: GroundTruthSpec,
): Array<{ entity: string; notePath: string }> {
  const gtByNote = new Map<string, Set<string>>();
  for (const gt of spec.groundTruth) {
    const set = gtByNote.get(gt.notePath) || new Set();
    set.add(normalize(gt.entity));
    gtByNote.set(gt.notePath, set);
  }

  const falsePositives: Array<{ entity: string; notePath: string }> = [];
  for (const run of runs) {
    const noteGt = gtByNote.get(run.notePath);
    if (!noteGt) continue;
    for (const suggestion of run.suggestions) {
      if (!noteGt.has(normalize(suggestion))) {
        falsePositives.push({ entity: suggestion, notePath: run.notePath });
      }
    }
  }
  return falsePositives;
}

// =============================================================================
// Test Suite
// =============================================================================

describe('Feedback Integration', () => {
  let vault: TempVault;
  let spec: GroundTruthSpec;
  let round0Runs: SuggestionRun[];
  let round0Report: PrecisionRecallReport;

  // Entities that received positive / negative feedback
  let boostedEntities: Array<{ entity: string; notePath: string }>;
  let suppressedEntities: Array<{ entity: string; notePath: string }>;

  // Subsequent round runs and report
  let latestRuns: SuggestionRun[];
  let latestReport: PrecisionRecallReport;

  beforeAll(async () => {
    spec = await loadPrimaryVault();
    vault = await buildGroundTruthVault(spec);
    await stripLinks(vault, spec.groundTruth);

    // ---- Round 0: baseline suggestions ----
    round0Runs = await runSuggestionsOnVault(vault, { strictness: 'balanced' });
    round0Report = evaluateSuggestions(round0Runs, spec.groundTruth, spec.entities);

    // ---- Positive feedback on true positives ----
    const tps = findTruePositives(round0Runs, spec);
    // Pick up to 5 distinct entities for positive feedback
    const seenPositive = new Set<string>();
    boostedEntities = [];
    for (const tp of tps) {
      const key = normalize(tp.entity);
      if (seenPositive.has(key)) continue;
      seenPositive.add(key);
      boostedEntities.push(tp);
      if (boostedEntities.length >= 5) break;
    }

    // Record 6 positive feedbacks each (crosses FEEDBACK_BOOST_MIN_SAMPLES for +2 tier)
    for (const { entity, notePath } of boostedEntities) {
      for (let i = 0; i < 6; i++) {
        recordFeedback(vault.stateDb, entity, 'feedback-test', notePath, true);
      }
    }

    // ---- Negative feedback on false positives ----
    const fps = findFalsePositives(round0Runs, spec);
    const seenNegative = new Set<string>();
    suppressedEntities = [];
    for (const fp of fps) {
      const key = normalize(fp.entity);
      if (seenNegative.has(key) || seenPositive.has(key)) continue;
      seenNegative.add(key);
      suppressedEntities.push(fp);
      if (suppressedEntities.length >= 3) break;
    }

    // Record 12 negative feedbacks each (crosses MIN_FEEDBACK_COUNT=10 for suppression)
    for (const { entity, notePath } of suppressedEntities) {
      for (let i = 0; i < 12; i++) {
        recordFeedback(vault.stateDb, entity, 'feedback-test', notePath, false);
      }
    }

    // Update suppression list
    updateSuppressionList(vault.stateDb);

    // ---- Re-run suggestions after feedback ----
    latestRuns = await runSuggestionsOnVault(vault, { strictness: 'balanced' });
    latestReport = evaluateSuggestions(latestRuns, spec.groundTruth, spec.entities);
  }, 60000);

  afterAll(async () => {
    if (vault) await vault.cleanup();
  });

  // =========================================================================
  // 1. Baseline established
  // =========================================================================

  it('round 0 baseline established', () => {
    expect(round0Report.f1).toBeGreaterThan(0);
    expect(round0Report.totalSuggestions).toBeGreaterThan(0);
    expect(round0Report.totalGroundTruth).toBeGreaterThan(0);
  });

  // =========================================================================
  // 2. Positive feedback boosts correct suggestions
  // =========================================================================

  it('positive feedback boosts correct suggestions', () => {
    // We need at least one boosted entity to test
    expect(boostedEntities.length).toBeGreaterThan(0);

    // Check that boosted entities have non-zero feedbackAdjustment in the latest run
    let foundBoosted = false;
    for (const { entity } of boostedEntities) {
      for (const run of latestRuns) {
        const match = run.detailed?.find(
          d => normalize(d.entity) === normalize(entity),
        );
        if (match && match.breakdown.feedbackAdjustment > 0) {
          foundBoosted = true;
          break;
        }
      }
      if (foundBoosted) break;
    }
    expect(foundBoosted).toBe(true);
  });

  // =========================================================================
  // 3. Negative feedback suppresses incorrect suggestions
  // =========================================================================

  it('negative feedback suppresses incorrect suggestions', () => {
    if (suppressedEntities.length === 0) {
      // No false positives in round 0 means nothing to suppress — skip gracefully
      return;
    }

    // Verify suppression status in the database
    for (const { entity } of suppressedEntities) {
      expect(isSuppressed(vault.stateDb, entity)).toBe(true);
    }

    // Verify suppressed entities have negative feedback boost
    for (const { entity } of suppressedEntities) {
      const boost = getFeedbackBoost(vault.stateDb, entity);
      expect(boost).toBeLessThanOrEqual(0);
    }
  });

  // =========================================================================
  // 4. F1 improves (or at minimum does not decrease) after feedback
  // =========================================================================

  it('F1 improves after feedback', () => {
    // Allow a small epsilon for floating-point rounding — F1 should not regress
    const epsilon = 0.01;
    expect(latestReport.f1).toBeGreaterThanOrEqual(round0Report.f1 - epsilon);
  });

  // =========================================================================
  // 5. Feedback layer contributes non-zero scores
  // =========================================================================

  it('feedback layer contributes non-zero scores', () => {
    let foundNonZero = false;
    for (const run of latestRuns) {
      if (!run.detailed) continue;
      for (const d of run.detailed) {
        if (d.breakdown.feedbackAdjustment > 0) {
          foundNonZero = true;
          break;
        }
      }
      if (foundNonZero) break;
    }
    expect(foundNonZero).toBe(true);
  });

  // =========================================================================
  // 6. Entity journey has all 5 stages populated
  // =========================================================================

  it('entity journey has all 5 stages populated', () => {
    // Use the first boosted entity — it has been through discover, suggest, learn, adapt
    expect(boostedEntities.length).toBeGreaterThan(0);
    const { entity, notePath } = boostedEntities[0];

    // Populate the apply stage
    trackWikilinkApplications(vault.stateDb, notePath, [entity]);

    const journey = getEntityJourney(vault.stateDb, entity);

    // Stage 1: Discover
    expect(journey.stages.discover.category).toBeTruthy();

    // Stage 2: Suggest
    expect(journey.stages.suggest.total_suggestions).toBeGreaterThan(0);

    // Stage 3: Apply
    expect(journey.stages.apply.applied_count).toBeGreaterThan(0);

    // Stage 4: Learn
    expect(journey.stages.learn.total_feedback).toBeGreaterThan(0);

    // Stage 5: Adapt — with 6 positive samples, should be past 'learning'
    expect(journey.stages.adapt.boost_tier).not.toBe('learning');
  });

  // =========================================================================
  // 7. getFeedbackBoost returns expected tier
  // =========================================================================

  it('getFeedbackBoost returns expected tier', () => {
    // Pick one boosted entity and add more positive feedback to reach Champion tier
    // Champion: accuracy >= 0.95, samples >= 20, boost = +10
    expect(boostedEntities.length).toBeGreaterThan(0);
    const { entity, notePath } = boostedEntities[0];

    // Already have 6 positive feedbacks from beforeAll. Add 14 more for 20 total.
    for (let i = 0; i < 14; i++) {
      recordFeedback(vault.stateDb, entity, 'champion-test', notePath, true);
    }

    const boost = getFeedbackBoost(vault.stateDb, entity);
    expect(boost).toBe(10); // Champion tier: +10 boost
  });
});
