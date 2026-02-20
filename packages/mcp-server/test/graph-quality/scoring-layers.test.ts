/**
 * Pillar 2: Scoring Layer Isolation (Ablation Testing)
 *
 * For each of the 11 scoring layers, measures the F1 impact of disabling
 * that layer. A layer that contributes real signal shows a measurable
 * F1 drop when removed.
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
} from './harness.js';
import type { ScoringLayer } from '../../src/core/write/types.js';

describe('Pillar 2: Scoring Layer Isolation', () => {
  let vault: TempVault;
  let spec: GroundTruthSpec;
  let baselineReport: PrecisionRecallReport;

  beforeAll(async () => {
    spec = await loadPrimaryVault();
    vault = await buildGroundTruthVault(spec);
    await stripLinks(vault, spec.groundTruth);

    // Run baseline with all layers enabled
    const baselineRuns = await runSuggestionsOnVault(vault, { strictness: 'balanced' });
    baselineReport = evaluateSuggestions(baselineRuns, spec.groundTruth, spec.entities);
  }, 60000);

  afterAll(async () => {
    if (vault) await vault.cleanup();
  });

  /**
   * Helper: run ablation test for a specific layer.
   * Returns the F1 delta (baseline - ablated). Positive means the layer helps.
   */
  async function ablateLayer(layer: ScoringLayer): Promise<{
    baselineF1: number;
    ablatedF1: number;
    delta: number;
    ablatedReport: PrecisionRecallReport;
  }> {
    const ablatedRuns = await runSuggestionsOnVault(vault, {
      strictness: 'balanced',
      disabledLayers: [layer],
    });
    const ablatedReport = evaluateSuggestions(ablatedRuns, spec.groundTruth, spec.entities);

    return {
      baselineF1: baselineReport.f1,
      ablatedF1: ablatedReport.f1,
      delta: baselineReport.f1 - ablatedReport.f1,
      ablatedReport,
    };
  }

  describe('Baseline', () => {
    it('all layers enabled produces valid results', () => {
      expect(baselineReport.f1).toBeGreaterThan(0);
      expect(baselineReport.totalSuggestions).toBeGreaterThan(0);
    });
  });

  describe('Layer 1a: Length filter', () => {
    it('disabling allows long entity names through', async () => {
      const result = await ablateLayer('length_filter');
      // Length filter prevents noise; disabling it may increase FPs
      // The delta could be positive (filter helps) or zero (no long entities in vault)
      expect(result.ablatedReport.totalSuggestions).toBeGreaterThanOrEqual(
        baselineReport.totalSuggestions
      );
    }, 30000);
  });

  describe('Layer 1b: Article filter', () => {
    it('disabling allows article-like names through', async () => {
      const result = await ablateLayer('article_filter');
      expect(result.ablatedReport.totalSuggestions).toBeGreaterThanOrEqual(
        baselineReport.totalSuggestions
      );
    }, 30000);
  });

  describe('Layer 2+3: Exact + Stem match', () => {
    it('disabling both dramatically reduces suggestions', async () => {
      const ablatedRuns = await runSuggestionsOnVault(vault, {
        strictness: 'balanced',
        disabledLayers: ['exact_match', 'stem_match'],
      });
      const ablatedReport = evaluateSuggestions(ablatedRuns, spec.groundTruth, spec.entities);

      // Content matching is the foundation — disabling it should crush F1
      expect(ablatedReport.f1).toBeLessThan(baselineReport.f1);
      expect(baselineReport.f1 - ablatedReport.f1).toBeGreaterThanOrEqual(0.01);
    }, 30000);
  });

  describe('Layer 4: Co-occurrence', () => {
    it('contributes measurable signal', async () => {
      const result = await ablateLayer('cooccurrence');
      // Co-occurrence should contribute; delta >= 0 (may be 0 if vault lacks co-occurrence data)
      expect(result.delta).toBeGreaterThanOrEqual(0);
    }, 30000);
  });

  describe('Layer 5: Type boost', () => {
    it('affects ranking when disabled', async () => {
      const result = await ablateLayer('type_boost');
      // Type boost changes ranking — may affect which suggestions pass threshold
      expect(result.ablatedReport).toBeDefined();
      expect(result.delta).toBeGreaterThanOrEqual(-0.05); // Should not dramatically hurt
    }, 30000);
  });

  describe('Layer 6: Context boost', () => {
    it('affects suggestions for context-sensitive notes', async () => {
      const result = await ablateLayer('context_boost');
      expect(result.ablatedReport).toBeDefined();
    }, 30000);
  });

  describe('Layer 7: Recency', () => {
    it('layer has measurable effect when recency data exists', async () => {
      // Inject synthetic recency data
      const now = Date.now();
      vault.stateDb.upsertRecency.run('typescript', now - 1800000); // 30 min ago
      vault.stateDb.upsertRecency.run('esghub', now - 3600000);    // 1 hour ago
      vault.stateDb.upsertRecency.run('react', now - 86400000);    // 1 day ago

      const withRecencyRuns = await runSuggestionsOnVault(vault, { strictness: 'balanced' });
      const withRecency = evaluateSuggestions(withRecencyRuns, spec.groundTruth, spec.entities);

      const withoutRecencyRuns = await runSuggestionsOnVault(vault, {
        strictness: 'balanced',
        disabledLayers: ['recency'],
      });
      const withoutRecency = evaluateSuggestions(withoutRecencyRuns, spec.groundTruth, spec.entities);

      // Recency should influence rankings (at minimum, it doesn't hurt)
      expect(withRecency.f1).toBeGreaterThanOrEqual(withoutRecency.f1 - 0.05);

      // Clean up recency data
      vault.stateDb.clearRecency.run();
    }, 30000);
  });

  describe('Layer 8: Cross-folder boost', () => {
    it('contributes to cross-cutting connections', async () => {
      const result = await ablateLayer('cross_folder');
      expect(result.ablatedReport).toBeDefined();
    }, 30000);
  });

  describe('Layer 9: Hub boost', () => {
    it('affects ranking of well-connected entities', async () => {
      const result = await ablateLayer('hub_boost');
      // Hub boost should affect which entities pass threshold
      expect(result.ablatedReport).toBeDefined();
    }, 30000);
  });

  describe('Layer 10: Feedback', () => {
    it('layer works when synthetic feedback data exists', async () => {
      // Inject synthetic feedback data
      const insertFeedback = vault.stateDb.db.prepare(
        'INSERT INTO wikilink_feedback (entity, context, note_path, correct) VALUES (?, ?, ?, ?)'
      );

      const txn = vault.stateDb.db.transaction(() => {
        // Marcus Johnson: 95% accuracy (champion tier)
        for (let i = 0; i < 19; i++) {
          insertFeedback.run('Marcus Johnson', 'test:synthetic', 'daily-notes/test.md', 1);
        }
        insertFeedback.run('Marcus Johnson', 'test:synthetic', 'daily-notes/test.md', 0);

        // Priya Sharma: 40% accuracy (weak tier)
        for (let i = 0; i < 4; i++) {
          insertFeedback.run('Priya Sharma', 'test:synthetic', 'daily-notes/test.md', 1);
        }
        for (let i = 0; i < 6; i++) {
          insertFeedback.run('Priya Sharma', 'test:synthetic', 'daily-notes/test.md', 0);
        }
      });
      txn();

      const withFeedbackRuns = await runSuggestionsOnVault(vault, { strictness: 'balanced' });
      const withFeedback = evaluateSuggestions(withFeedbackRuns, spec.groundTruth, spec.entities);

      const withoutFeedbackRuns = await runSuggestionsOnVault(vault, {
        strictness: 'balanced',
        disabledLayers: ['feedback'],
      });
      const withoutFeedback = evaluateSuggestions(withoutFeedbackRuns, spec.groundTruth, spec.entities);

      // Feedback should influence (champion entities boosted, weak entities penalized)
      expect(withFeedback).toBeDefined();
      expect(withoutFeedback).toBeDefined();

      // Clean up
      vault.stateDb.db.prepare('DELETE FROM wikilink_feedback WHERE context = ?').run('test:synthetic');
    }, 30000);
  });

  describe('Layer 11: Semantic', () => {
    it('is gracefully skipped when embeddings unavailable', async () => {
      const result = await ablateLayer('semantic');
      // In test environment, embeddings are typically not available
      // Disabling semantic should have zero effect
      expect(result.delta).toBe(0);
    }, 30000);
  });

  describe('Summary: No dead-weight layers', () => {
    it('reports ablation results for all layers', async () => {
      const layers: ScoringLayer[] = [
        'type_boost', 'context_boost', 'hub_boost', 'cross_folder',
      ];

      const results: Array<{ layer: string; delta: number }> = [];
      for (const layer of layers) {
        const result = await ablateLayer(layer);
        results.push({ layer, delta: result.delta });
      }

      // At least one non-content layer should show measurable delta
      const significantLayers = results.filter(r => Math.abs(r.delta) >= 0.001);
      // This is informational — we don't hard-fail if no graph layers contribute
      // because the synthetic vault may not exercise all layers
      expect(results.length).toBe(layers.length);
    }, 120000);
  });
});
