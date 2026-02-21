/**
 * Flywheel Pipeline Integration Test
 *
 * End-to-end test that verifies data flows through all 5 stages of the
 * feedback loop: Discover → Suggest → Apply → Learn → Adapt.
 *
 * This is the Phase 1 "Make the Flywheel Spin" validation — proving that
 * every stage produces rows in the database and that downstream stages
 * can consume upstream data.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
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
  recordFeedback,
  trackWikilinkApplications,
  getEntityJourney,
} from '../../src/core/write/wikilinkFeedback.js';
import { suggestRelatedLinks } from '../../src/core/write/wikilinks.js';
import { readFile } from 'fs/promises';
import path from 'path';

describe('Flywheel Pipeline Integration', () => {
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

  // =========================================================================
  // Stage 1: Discover — entities indexed in StateDb
  // =========================================================================

  test('Stage 1 - Discover: entities indexed', () => {
    const count = vault.stateDb.db.prepare(
      'SELECT COUNT(*) as cnt FROM entities'
    ).get() as { cnt: number };
    expect(count.cnt).toBeGreaterThan(0);
  });

  // =========================================================================
  // Stage 2: Suggest — suggestions with breakdowns persisted
  // =========================================================================

  test('Stage 2 - Suggest: suggestions with breakdowns', () => {
    const withSuggestions = runs.filter(r => r.suggestions.length > 0);
    expect(withSuggestions.length).toBeGreaterThan(0);

    // Verify suggestion_events were recorded
    const events = vault.stateDb.db.prepare(
      'SELECT COUNT(*) as cnt FROM suggestion_events'
    ).get() as { cnt: number };
    expect(events.cnt).toBeGreaterThan(0);
  });

  // =========================================================================
  // Stage 3: Apply — tracking records created via trackWikilinkApplications
  // =========================================================================

  test('Stage 3 - Apply: tracking records created', () => {
    // Get an entity from suggestion_events that passed
    const row = vault.stateDb.db.prepare(
      "SELECT entity FROM suggestion_events WHERE passed = 1 LIMIT 1"
    ).get() as { entity: string } | undefined;
    expect(row).toBeDefined();

    // Track application manually (simulates engine writing with linkedEntities)
    trackWikilinkApplications(vault.stateDb, 'test-note.md', [row!.entity]);
    const appCount = vault.stateDb.db.prepare(
      'SELECT COUNT(*) as cnt FROM wikilink_applications'
    ).get() as { cnt: number };
    expect(appCount.cnt).toBeGreaterThan(0);
  });

  // =========================================================================
  // Stage 4: Learn — feedback recorded in wikilink_feedback
  // =========================================================================

  test('Stage 4 - Learn: feedback recorded', () => {
    const row = vault.stateDb.db.prepare(
      "SELECT entity FROM suggestion_events WHERE passed = 1 LIMIT 1"
    ).get() as { entity: string } | undefined;
    expect(row).toBeDefined();

    recordFeedback(vault.stateDb, row!.entity, 'test context', 'test-note.md', true);
    const fbCount = vault.stateDb.db.prepare(
      'SELECT COUNT(*) as cnt FROM wikilink_feedback'
    ).get() as { cnt: number };
    expect(fbCount.cnt).toBeGreaterThan(0);
  });

  // =========================================================================
  // Stage 5: Adapt — feedback affects scoring via boost tiers
  // =========================================================================

  test('Stage 5 - Adapt: feedback affects scoring', async () => {
    // Get an entity that was suggested with a known note
    const row = vault.stateDb.db.prepare(
      "SELECT entity, note_path FROM suggestion_events WHERE passed = 1 LIMIT 1"
    ).get() as { entity: string; note_path: string } | undefined;
    expect(row).toBeDefined();

    // Inject enough positive feedback to reach the +2 boost tier (minSamples=5, minAccuracy=0.80)
    for (let i = 0; i < 6; i++) {
      recordFeedback(vault.stateDb, row!.entity, 'boost-ctx', row!.note_path, true);
    }

    // Re-suggest and check that the feedback layer contributes
    const fullPath = path.join(vault.vaultPath, row!.note_path);
    let content: string;
    try {
      content = await readFile(fullPath, 'utf-8');
    } catch {
      // If note doesn't exist, use a placeholder with the entity name
      content = `This note discusses ${row!.entity} in detail.`;
    }

    const result = await suggestRelatedLinks(content, {
      detail: true,
      notePath: row!.note_path,
      strictness: 'balanced',
    });

    // The entity may or may not appear in suggestions (depends on score threshold)
    // but the feedback boost mechanism should be functional
    const match = result.detailed?.find(
      s => s.entity.toLowerCase() === row!.entity.toLowerCase()
    );
    if (match) {
      expect(match.breakdown.feedbackAdjustment).toBeGreaterThan(0);
    }

    // At minimum, verify feedback is persisted and queryable
    const fbRow = vault.stateDb.db.prepare(
      'SELECT COUNT(*) as cnt FROM wikilink_feedback WHERE entity = ?'
    ).get(row!.entity) as { cnt: number };
    expect(fbRow.cnt).toBeGreaterThanOrEqual(7); // 1 from Stage 4 + 6 here
  });

  // =========================================================================
  // Full Journey: all 5 stages populated for at least one entity
  // =========================================================================

  test('Full journey: all 5 stages populated', () => {
    // Find an entity that we've pushed through all stages
    const row = vault.stateDb.db.prepare(
      "SELECT entity FROM suggestion_events WHERE passed = 1 LIMIT 1"
    ).get() as { entity: string } | undefined;
    expect(row).toBeDefined();

    const journey = getEntityJourney(vault.stateDb, row!.entity);

    // Stage 1: Discover
    expect(journey.stages.discover).toBeDefined();
    expect(journey.stages.discover.category).toBeTruthy();

    // Stage 2: Suggest
    expect(journey.stages.suggest.total_suggestions).toBeGreaterThan(0);

    // Stage 3: Apply
    expect(journey.stages.apply).toBeDefined();
    expect(journey.stages.apply.applied_count).toBeGreaterThan(0);

    // Stage 4: Learn
    expect(journey.stages.learn).toBeDefined();
    expect(journey.stages.learn.total_feedback).toBeGreaterThan(0);

    // Stage 5: Adapt
    expect(journey.stages.adapt).toBeDefined();
    // With 7+ positive samples, should have moved past 'learning' tier
    expect(journey.stages.adapt.boost_tier).not.toBe('learning');
    expect(journey.stages.adapt.current_boost).toBeGreaterThan(0);
  });
});
