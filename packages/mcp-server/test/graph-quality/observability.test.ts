/**
 * Pillar 6: Pipeline Observability Testing
 *
 * Proves the pipeline observability infrastructure works — that every entity's
 * journey through the 5 pipeline stages (Discover -> Suggest -> Apply -> Learn -> Adapt)
 * is traceable, auditable, and attributable to specific scoring layers.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  buildGroundTruthVault,
  stripLinks,
  runSuggestionsOnVault,
  loadPrimaryVault,
  type TempVault,
  type GroundTruthSpec,
  type SuggestionRun,
} from './harness.js';
import {
  getEntityJourney,
  formatActionReason,
  type SuggestionBreakdown,
} from '../../src/core/write/wikilinkFeedback.js';
import type { ScoringLayer, ScoreBreakdown } from '../../src/core/write/types.js';

describe('Pillar 6: Pipeline Observability', () => {
  let vault: TempVault;
  let spec: GroundTruthSpec;
  let runs: SuggestionRun[];

  beforeAll(async () => {
    spec = await loadPrimaryVault();
    vault = await buildGroundTruthVault(spec);
    await stripLinks(vault, spec.groundTruth);
    runs = await runSuggestionsOnVault(vault, { strictness: 'balanced' });
  }, 60000);

  afterAll(async () => {
    if (vault) await vault.cleanup();
  });

  // ===========================================================================
  // Test 1: Full Journey Trace
  // ===========================================================================

  describe('Full Journey Trace', () => {
    it('suggestion_events table has rows with valid breakdown_json', () => {
      const rows = vault.stateDb.db.prepare(
        'SELECT id, note_path, entity, total_score, breakdown_json, threshold, passed, strictness FROM suggestion_events LIMIT 50'
      ).all() as Array<{
        id: number;
        note_path: string;
        entity: string;
        total_score: number;
        breakdown_json: string;
        threshold: number;
        passed: number;
        strictness: string;
      }>;

      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        expect(row.breakdown_json).toBeTruthy();
        const breakdown = JSON.parse(row.breakdown_json);
        expect(breakdown).toBeDefined();
        expect(typeof breakdown.contentMatch).toBe('number');
      }
    });

    it('getEntityJourney returns discover and suggest stages for suggested entities', () => {
      // Find an entity that was actually suggested
      const suggestedEntity = findSuggestedEntity(runs);
      expect(suggestedEntity).toBeTruthy();

      const journey = getEntityJourney(vault.stateDb, suggestedEntity!);

      // Discover stage should be populated
      expect(journey.entity).toBe(suggestedEntity);
      expect(journey.stages.discover).toBeDefined();
      expect(journey.stages.discover.category).toBeTruthy();

      // Suggest stage should have events
      expect(journey.stages.suggest).toBeDefined();
      expect(journey.stages.suggest.total_suggestions).toBeGreaterThan(0);
      expect(journey.stages.suggest.recent.length).toBeGreaterThan(0);
    });

    it('journey suggest stage recent events contain valid breakdown and top_contributing_layer', () => {
      const suggestedEntity = findSuggestedEntity(runs);
      expect(suggestedEntity).toBeTruthy();

      const journey = getEntityJourney(vault.stateDb, suggestedEntity!);
      const recentEvents = journey.stages.suggest.recent;

      for (const event of recentEvents) {
        expect(event.note_path).toBeTruthy();
        expect(typeof event.timestamp).toBe('number');
        expect(typeof event.total_score).toBe('number');
        expect(event.breakdown).toBeDefined();
        expect(typeof event.breakdown.contentMatch).toBe('number');
        expect(typeof event.threshold).toBe('number');
        expect(typeof event.passed).toBe('boolean');
        expect(event.top_contributing_layer).toBeTruthy();
        expect(event.top_contributing_layer).not.toBe('');
      }
    });

    it('journey adapt stage has valid boost_tier for entities without feedback', () => {
      const suggestedEntity = findSuggestedEntity(runs);
      expect(suggestedEntity).toBeTruthy();

      const journey = getEntityJourney(vault.stateDb, suggestedEntity!);

      // With no feedback, should be in 'learning' tier
      expect(journey.stages.adapt.boost_tier).toBe('learning');
      expect(journey.stages.adapt.current_boost).toBe(0);
      expect(journey.stages.adapt.suppressed).toBe(false);
    });
  });

  // ===========================================================================
  // Test 2: Algorithm Attribution Accuracy
  // ===========================================================================

  describe('Algorithm Attribution Accuracy', () => {
    it('formatActionReason produces valid reason string for "discovered"', () => {
      const reason = formatActionReason('discovered', {
        entity: 'TypeScript',
        sourcePath: 'technologies/TypeScript.md',
        category: 'technology',
        aliases: ['TS'],
      });
      expect(reason).toBeTruthy();
      expect(reason.length).toBeGreaterThan(0);
      expect(reason).toContain('technologies/TypeScript.md');
      expect(reason).toContain('technology');
    });

    it('formatActionReason produces valid reason string for "suggested"', () => {
      const breakdown: SuggestionBreakdown = {
        contentMatch: 15,
        cooccurrenceBoost: 3,
        typeBoost: 2,
        contextBoost: 1,
        recencyBoost: 0,
        crossFolderBoost: 0,
        hubBoost: 1,
        feedbackAdjustment: 0,
      };
      const reason = formatActionReason('suggested', {
        entity: 'React',
        score: 22,
        threshold: 8,
        strictness: 'balanced',
        breakdown,
      });
      expect(reason).toBeTruthy();
      expect(reason).toContain('22.0');
      expect(reason).toContain('8');
      expect(reason).toContain('balanced');
      expect(reason).toContain('content_match');
    });

    it('formatActionReason produces valid reason string for "filtered"', () => {
      const breakdown: SuggestionBreakdown = {
        contentMatch: 3,
        cooccurrenceBoost: 0,
        typeBoost: 0,
        contextBoost: 0,
        recencyBoost: 0,
        crossFolderBoost: 0,
        hubBoost: 0,
        feedbackAdjustment: 0,
      };
      const reason = formatActionReason('filtered', {
        entity: 'LowScoreEntity',
        score: 3,
        threshold: 8,
        strictness: 'conservative',
        breakdown,
      });
      expect(reason).toBeTruthy();
      expect(reason).toContain('3.0');
      expect(reason).toContain('8');
      expect(reason).toContain('conservative');
      expect(reason).toContain('Top layer');
    });

    it('formatActionReason produces valid reason string for "applied"', () => {
      const reason = formatActionReason('applied', {
        entity: 'Docker',
        notePath: 'projects/deployment.md',
      });
      expect(reason).toBeTruthy();
      expect(reason).toContain('Docker');
      expect(reason).toContain('projects/deployment.md');
    });

    it('formatActionReason produces valid reason string for "feedback_positive"', () => {
      const reason = formatActionReason('feedback_positive', {
        entity: 'Kubernetes',
        notePath: 'projects/infra.md',
      });
      expect(reason).toBeTruthy();
      expect(reason).toContain('projects/infra.md');
      expect(reason).toContain('positive');
    });

    it('formatActionReason produces valid reason string for "feedback_negative"', () => {
      const reason = formatActionReason('feedback_negative', {
        entity: 'Java',
        notePath: 'daily-notes/2025-01-15.md',
      });
      expect(reason).toBeTruthy();
      expect(reason).toContain('Java');
      expect(reason).toContain('negative');
    });

    it('formatActionReason produces valid reason string for "boosted"', () => {
      const reason = formatActionReason('boosted', {
        entity: 'Python',
        accuracy: 0.92,
        sampleCount: 25,
        tier: 'strong',
        breakdown: {
          contentMatch: 10,
          cooccurrenceBoost: 0,
          typeBoost: 0,
          contextBoost: 0,
          recencyBoost: 0,
          crossFolderBoost: 0,
          hubBoost: 0,
          feedbackAdjustment: 2,
        },
      });
      expect(reason).toBeTruthy();
      expect(reason).toContain('92%');
      expect(reason).toContain('25');
      expect(reason).toContain('strong');
    });

    it('formatActionReason produces valid reason string for "suppressed"', () => {
      const reason = formatActionReason('suppressed', {
        entity: 'BadEntity',
        accuracy: 0.25,
        falsePositiveRate: 0.75,
      });
      expect(reason).toBeTruthy();
      expect(reason).toContain('25%');
      expect(reason).toContain('75%');
      expect(reason).toContain('suppressed');
      expect(reason).toContain('posterior');
    });
  });

  // ===========================================================================
  // Test 3: Suggestion Audit Completeness
  // ===========================================================================

  describe('Suggestion Audit Completeness', () => {
    it('every suggestion above threshold has passed=1', () => {
      const rows = vault.stateDb.db.prepare(
        'SELECT entity, total_score, threshold, passed FROM suggestion_events WHERE passed = 1'
      ).all() as Array<{
        entity: string;
        total_score: number;
        threshold: number;
        passed: number;
      }>;

      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        expect(row.total_score).toBeGreaterThanOrEqual(row.threshold);
      }
    });

    it('breakdown_json deserializes to valid ScoreBreakdown', () => {
      const rows = vault.stateDb.db.prepare(
        'SELECT breakdown_json FROM suggestion_events LIMIT 30'
      ).all() as Array<{ breakdown_json: string }>;

      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        const breakdown: ScoreBreakdown = JSON.parse(row.breakdown_json);

        // Verify all required ScoreBreakdown fields are present and numeric
        expect(typeof breakdown.contentMatch).toBe('number');
        expect(typeof breakdown.cooccurrenceBoost).toBe('number');
        expect(typeof breakdown.typeBoost).toBe('number');
        expect(typeof breakdown.contextBoost).toBe('number');
        expect(typeof breakdown.recencyBoost).toBe('number');
        expect(typeof breakdown.crossFolderBoost).toBe('number');
        expect(typeof breakdown.hubBoost).toBe('number');
        expect(typeof breakdown.feedbackAdjustment).toBe('number');
        // semanticBoost is optional
        if (breakdown.semanticBoost !== undefined) {
          expect(typeof breakdown.semanticBoost).toBe('number');
        }
      }
    });

    it('all required fields are populated in suggestion_events', () => {
      const rows = vault.stateDb.db.prepare(
        'SELECT note_path, entity, total_score, threshold, strictness, passed, timestamp FROM suggestion_events LIMIT 30'
      ).all() as Array<{
        note_path: string;
        entity: string;
        total_score: number;
        threshold: number;
        strictness: string;
        passed: number;
        timestamp: number;
      }>;

      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        expect(row.note_path).toBeTruthy();
        expect(row.note_path.length).toBeGreaterThan(0);
        expect(row.entity).toBeTruthy();
        expect(row.entity.length).toBeGreaterThan(0);
        expect(typeof row.total_score).toBe('number');
        expect(typeof row.threshold).toBe('number');
        expect(row.threshold).toBeGreaterThan(0);
        expect(row.strictness).toBeTruthy();
        expect(['conservative', 'balanced', 'aggressive']).toContain(row.strictness);
        expect([0, 1]).toContain(row.passed);
        expect(typeof row.timestamp).toBe('number');
        expect(row.timestamp).toBeGreaterThan(0);
      }
    });

    it('entities that did not pass threshold have passed=0', () => {
      const filteredRows = vault.stateDb.db.prepare(
        'SELECT entity, total_score, threshold, passed FROM suggestion_events WHERE passed = 0'
      ).all() as Array<{
        entity: string;
        total_score: number;
        threshold: number;
        passed: number;
      }>;

      // There should be some filtered entities (below threshold)
      // If none, the test still passes since that is a valid state
      for (const row of filteredRows) {
        expect(row.total_score).toBeLessThan(row.threshold);
      }
    });
  });

  // ===========================================================================
  // Test 4: Score Persistence
  // ===========================================================================

  describe('Score Persistence', () => {
    it('stored scores match the returned suggestion scores', () => {
      // Collect all suggestions from runs
      const suggestedByNote = new Map<string, Map<string, number>>();
      for (const run of runs) {
        if (run.detailed && run.detailed.length > 0) {
          const entityScores = new Map<string, number>();
          for (const d of run.detailed) {
            entityScores.set(d.entity, d.totalScore);
          }
          suggestedByNote.set(run.notePath, entityScores);
        }
      }

      // Verify at least some runs produced detailed results
      expect(suggestedByNote.size).toBeGreaterThan(0);

      // For each note with detailed results, check the stored events
      for (const [notePath, entityScores] of suggestedByNote) {
        const rows = vault.stateDb.db.prepare(
          'SELECT entity, total_score, note_path FROM suggestion_events WHERE note_path = ? AND passed = 1'
        ).all(notePath) as Array<{
          entity: string;
          total_score: number;
          note_path: string;
        }>;

        for (const row of rows) {
          const returnedScore = entityScores.get(row.entity);
          if (returnedScore !== undefined) {
            // Scores should match (allowing for floating point rounding)
            expect(row.total_score).toBeCloseTo(returnedScore, 1);
          }
        }
      }
    });

    it('stored note_path values correspond to actual vault notes', () => {
      const rows = vault.stateDb.db.prepare(
        'SELECT DISTINCT note_path FROM suggestion_events'
      ).all() as Array<{ note_path: string }>;

      expect(rows.length).toBeGreaterThan(0);

      const vaultNotePaths = new Set(spec.notes.map(n => n.path));
      for (const row of rows) {
        expect(vaultNotePaths.has(row.note_path)).toBe(true);
      }
    });

    it('stored timestamps are recent and reasonable', () => {
      const rows = vault.stateDb.db.prepare(
        'SELECT timestamp FROM suggestion_events LIMIT 10'
      ).all() as Array<{ timestamp: number }>;

      expect(rows.length).toBeGreaterThan(0);

      const now = Date.now();
      const fiveMinutesAgo = now - 5 * 60 * 1000;

      for (const row of rows) {
        // Timestamp should be within the last 5 minutes (test just ran)
        expect(row.timestamp).toBeGreaterThan(fiveMinutesAgo);
        expect(row.timestamp).toBeLessThanOrEqual(now);
      }
    });

    it('stored entity names can be looked up via getEntityJourney', () => {
      const rows = vault.stateDb.db.prepare(
        'SELECT DISTINCT entity FROM suggestion_events WHERE passed = 1 LIMIT 5'
      ).all() as Array<{ entity: string }>;

      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        const journey = getEntityJourney(vault.stateDb, row.entity);
        expect(journey.entity).toBe(row.entity);
        expect(journey.stages.suggest.total_suggestions).toBeGreaterThan(0);
      }
    });
  });

  // ===========================================================================
  // Test 5: formatActionReason Coverage
  // ===========================================================================

  describe('formatActionReason coverage', () => {
    const allActions = [
      'discovered',
      'suggested',
      'filtered',
      'applied',
      'feedback_positive',
      'feedback_negative',
      'boosted',
      'suppressed',
    ] as const;

    const detailsByAction: Record<string, Parameters<typeof formatActionReason>[1]> = {
      discovered: {
        entity: 'TestEntity',
        sourcePath: 'people/TestEntity.md',
        category: 'person',
        aliases: ['TE', 'Test'],
      },
      suggested: {
        entity: 'TestEntity',
        score: 18.5,
        threshold: 8,
        strictness: 'balanced',
        breakdown: {
          contentMatch: 10,
          cooccurrenceBoost: 3,
          typeBoost: 2,
          contextBoost: 1.5,
          recencyBoost: 1,
          crossFolderBoost: 0.5,
          hubBoost: 0.5,
          feedbackAdjustment: 0,
        },
      },
      filtered: {
        entity: 'WeakEntity',
        score: 4.2,
        threshold: 8,
        strictness: 'conservative',
        breakdown: {
          contentMatch: 3,
          cooccurrenceBoost: 0,
          typeBoost: 1.2,
          contextBoost: 0,
          recencyBoost: 0,
          crossFolderBoost: 0,
          hubBoost: 0,
          feedbackAdjustment: 0,
        },
      },
      applied: {
        entity: 'AppliedEntity',
        notePath: 'notes/example.md',
      },
      feedback_positive: {
        entity: 'GoodEntity',
        notePath: 'daily-notes/2025-06-01.md',
      },
      feedback_negative: {
        entity: 'BadEntity',
        notePath: 'projects/review.md',
      },
      boosted: {
        entity: 'BoostedEntity',
        accuracy: 0.88,
        sampleCount: 15,
        tier: 'strong',
        breakdown: {
          contentMatch: 10,
          cooccurrenceBoost: 0,
          typeBoost: 0,
          contextBoost: 0,
          recencyBoost: 0,
          crossFolderBoost: 0,
          hubBoost: 0,
          feedbackAdjustment: 2,
        },
      },
      suppressed: {
        entity: 'SuppressedEntity',
        accuracy: 0.20,
        falsePositiveRate: 0.80,
      },
    };

    for (const action of allActions) {
      it(`returns non-empty string for action "${action}"`, () => {
        const reason = formatActionReason(action, detailsByAction[action]);
        expect(reason).toBeTruthy();
        expect(reason.length).toBeGreaterThan(0);
        expect(typeof reason).toBe('string');
      });
    }

    it('discovered reason includes aliases when provided', () => {
      const reason = formatActionReason('discovered', {
        sourcePath: 'tech/React.md',
        category: 'technology',
        aliases: ['ReactJS', 'React.js'],
      });
      expect(reason).toContain('ReactJS');
      expect(reason).toContain('React.js');
    });

    it('discovered reason omits aliases section when none provided', () => {
      const reason = formatActionReason('discovered', {
        sourcePath: 'tech/Go.md',
        category: 'technology',
        aliases: [],
      });
      expect(reason).not.toContain('aliases');
    });

    it('suggested reason lists active scoring layers from breakdown', () => {
      const reason = formatActionReason('suggested', {
        score: 25,
        threshold: 8,
        strictness: 'aggressive',
        breakdown: {
          contentMatch: 15,
          cooccurrenceBoost: 5,
          typeBoost: 3,
          contextBoost: 0,
          recencyBoost: 2,
          crossFolderBoost: 0,
          hubBoost: 0,
          feedbackAdjustment: 0,
        },
      });
      expect(reason).toContain('content_match');
      expect(reason).toContain('cooccurrence');
      expect(reason).toContain('type_boost');
      expect(reason).toContain('recency');
      // Layers with 0 should not appear
      expect(reason).not.toContain('context_boost');
      expect(reason).not.toContain('cross_folder');
    });

    it('suggested reason includes semantic layer when present', () => {
      const reason = formatActionReason('suggested', {
        score: 30,
        threshold: 8,
        strictness: 'balanced',
        breakdown: {
          contentMatch: 15,
          cooccurrenceBoost: 0,
          typeBoost: 0,
          contextBoost: 0,
          recencyBoost: 0,
          crossFolderBoost: 0,
          hubBoost: 0,
          feedbackAdjustment: 0,
          semanticBoost: 15.5,
        },
      });
      expect(reason).toContain('semantic');
    });

    it('filtered reason identifies top contributing layer', () => {
      const reason = formatActionReason('filtered', {
        score: 5,
        threshold: 15,
        strictness: 'conservative',
        breakdown: {
          contentMatch: 5,
          cooccurrenceBoost: 0,
          typeBoost: 0,
          contextBoost: 0,
          recencyBoost: 0,
          crossFolderBoost: 0,
          hubBoost: 0,
          feedbackAdjustment: 0,
        },
      });
      expect(reason).toContain('Top layer');
      expect(reason).toContain('content_match');
    });
  });
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Find an entity name that was actually suggested in the runs.
 * Returns the entity name from the first run with detailed suggestions.
 */
function findSuggestedEntity(runs: SuggestionRun[]): string | null {
  for (const run of runs) {
    if (run.detailed && run.detailed.length > 0) {
      return run.detailed[0].entity;
    }
    if (run.suggestions.length > 0) {
      return run.suggestions[0];
    }
  }
  return null;
}
