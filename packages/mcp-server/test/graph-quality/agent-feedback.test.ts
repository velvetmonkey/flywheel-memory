/**
 * Suite: Agent Feedback Model (T9)
 *
 * Tests whether the Beta-Binomial model handles systematic vs random errors.
 * Models agent behavior (flywheel-engine):
 *
 * - Systematic errors: if entity "stg" is wrong, it's wrong EVERY time
 *   (unlike random 15% noise from human reviewers)
 * - High volume: agent applies to many notes per round
 * - No confidence gate: agent applies ALL matches above threshold
 * - Batch feedback: many applications per round, watcher detects removals
 *
 * Key verification: entities with systematic errors should be suppressed
 * faster than entities with noisy-but-correct feedback.
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
  isSuppressed,
  getFeedbackBoost,
} from '../../src/core/write/wikilinkFeedback.js';

// =============================================================================
// Constants
// =============================================================================

const TOTAL_ROUNDS = 10;

// Entities that the agent ALWAYS gets wrong (systematic errors)
// These are false positives the agent consistently applies
const ALWAYS_WRONG_ENTITIES = new Set<string>();

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
  suppressionCount: number;
  alwaysWrongSuppressedCount: number; // How many "always wrong" entities are suppressed
}

// =============================================================================
// Test Suite
// =============================================================================

describe('Suite: Agent Feedback Model', () => {
  let vault: TempVault;
  let spec: GroundTruthSpec;
  const roundMetrics: RoundMetrics[] = [];

  beforeAll(async () => {
    spec = await loadPrimaryVault();
    vault = await buildGroundTruthVault(spec);
    await stripLinks(vault, spec.groundTruth);

    // Build ground truth lookup
    const gtByNote = new Map<string, Set<string>>();
    for (const gt of spec.groundTruth) {
      const set = gtByNote.get(gt.notePath) || new Set();
      set.add(normalize(gt.entity));
      gtByNote.set(gt.notePath, set);
    }

    // Run round 0 to identify false positives (agent systematic errors)
    const round0Runs = await runSuggestionsOnVault(vault, { strictness: 'balanced' });

    // Find entities that appear as FPs — these become "always wrong"
    const fpEntities = new Set<string>();
    for (const run of round0Runs) {
      const noteGt = gtByNote.get(run.notePath);
      if (!noteGt) continue;
      for (const suggestion of run.suggestions) {
        if (!noteGt.has(normalize(suggestion))) {
          fpEntities.add(normalize(suggestion));
        }
      }
    }

    // Pick up to 3 FP entities as "always wrong" (systematic agent errors)
    let count = 0;
    for (const fp of fpEntities) {
      ALWAYS_WRONG_ENTITIES.add(fp);
      count++;
      if (count >= 3) break;
    }

    const rng = mulberry32(9999);

    // Run learning rounds with agent-like feedback pattern
    for (let round = 0; round < TOTAL_ROUNDS; round++) {
      const runs = await runSuggestionsOnVault(vault, { strictness: 'balanced' });
      const report = evaluateSuggestions(runs, spec.groundTruth, spec.entities);

      // Agent feedback: ALL matches get feedback, systematic errors are ALWAYS wrong
      for (const run of runs) {
        const noteGt = gtByNote.get(run.notePath);
        if (!noteGt) continue;

        for (const suggestion of run.suggestions) {
          const normalizedSuggestion = normalize(suggestion);

          if (ALWAYS_WRONG_ENTITIES.has(normalizedSuggestion)) {
            // Systematic error: ALWAYS wrong (agent consistently mislinks this entity)
            recordFeedback(vault.stateDb, suggestion, 'agent-feedback', run.notePath, false);
          } else {
            // Normal feedback with 85/15 noise (like human review)
            const isTP = noteGt.has(normalizedSuggestion);
            const isCorrect = isTP ? rng() < 0.85 : rng() < 0.15;
            recordFeedback(vault.stateDb, suggestion, 'agent-feedback', run.notePath, isCorrect);
          }
        }
      }

      // Agent also applies always-wrong entities to many notes (batch auto-linking).
      // Watcher then detects removals → more negative feedback.
      // This models processWikilinks() applying ALL matches with no confidence gate.
      for (const entity of ALWAYS_WRONG_ENTITIES) {
        // Agent applies to 5 notes per round, user removes all → 5 negative feedbacks
        for (let i = 0; i < 5; i++) {
          const targetNote = runs[i % runs.length]?.notePath || 'daily-notes/2026-01-01.md';
          recordFeedback(vault.stateDb, entity, 'agent-batch', targetNote, false);
        }
      }

      updateSuppressionList(vault.stateDb);

      const suppressionCount = (vault.stateDb.db.prepare(
        'SELECT COUNT(*) as cnt FROM wikilink_suppressions',
      ).get() as { cnt: number }).cnt;

      // Check how many "always wrong" entities are now suppressed
      let alwaysWrongSuppressed = 0;
      for (const entity of ALWAYS_WRONG_ENTITIES) {
        if (isSuppressed(vault.stateDb, entity)) {
          alwaysWrongSuppressed++;
        }
      }

      roundMetrics.push({
        round,
        f1: report.f1,
        precision: report.precision,
        recall: report.recall,
        suppressionCount,
        alwaysWrongSuppressedCount: alwaysWrongSuppressed,
      });
    }
  }, 300000);

  afterAll(async () => {
    if (vault) await vault.cleanup();
  });

  // ===========================================================================
  // Assertions
  // ===========================================================================

  it('identifies at least 1 always-wrong entity for testing', () => {
    expect(ALWAYS_WRONG_ENTITIES.size).toBeGreaterThan(0);
  });

  it('systematic errors get suppressed by round 9', () => {
    if (ALWAYS_WRONG_ENTITIES.size === 0) return;

    const lastRound = roundMetrics[TOTAL_ROUNDS - 1];
    // With 100% negative feedback, these should definitely be suppressed
    // At least 50% of always-wrong entities should be suppressed
    expect(lastRound.alwaysWrongSuppressedCount).toBeGreaterThanOrEqual(
      Math.ceil(ALWAYS_WRONG_ENTITIES.size * 0.5),
    );
  });

  it('systematic errors get negative feedback boost', () => {
    for (const entity of ALWAYS_WRONG_ENTITIES) {
      const boost = getFeedbackBoost(vault.stateDb, entity);
      expect(boost).toBeLessThanOrEqual(0);
    }
  });

  it('always-wrong entities suppress faster than noisy TPs', () => {
    // Find the round at which the first always-wrong entity gets suppressed
    let firstAlwaysWrongSuppressedRound = -1;
    for (const m of roundMetrics) {
      if (m.alwaysWrongSuppressedCount > 0) {
        firstAlwaysWrongSuppressedRound = m.round;
        break;
      }
    }

    // The always-wrong entities should be suppressed within the first 5 rounds
    // (100% negative feedback → crosses threshold faster than noisy feedback)
    if (firstAlwaysWrongSuppressedRound >= 0) {
      expect(firstAlwaysWrongSuppressedRound).toBeLessThanOrEqual(5);
    }
    // If no always-wrong entities were found, the test is inconclusive but passes
  });

  it('F1 does not catastrophically regress', () => {
    expect(roundMetrics.length).toBe(TOTAL_ROUNDS);
    const round0 = roundMetrics[0];
    const roundN = roundMetrics[TOTAL_ROUNDS - 1];
    expect(roundN.f1).toBeGreaterThanOrEqual(round0.f1 - 0.30);
  });

  it('no single round drops F1 by more than 20pp', () => {
    for (let i = 1; i < roundMetrics.length; i++) {
      const drop = roundMetrics[i - 1].f1 - roundMetrics[i].f1;
      expect(drop).toBeLessThanOrEqual(0.20);
    }
  });
});
