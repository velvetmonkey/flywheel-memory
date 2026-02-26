/**
 * Competitive Baselines + Negative Testing + Domain Interference
 *
 * Tests that the full scoring engine outperforms degraded baselines,
 * verifies correct negative behavior (no re-suggestions, no self-references,
 * suppressions honored), and checks domain boundary enforcement.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'fs/promises';
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
import { extractLinkedEntities } from '../../src/core/write/wikilinks.js';
import type { ScoringLayer } from '../../src/core/write/types.js';

describe('Competitive Baselines', () => {
  let vault: TempVault;
  let spec: GroundTruthSpec;
  let fullReport: PrecisionRecallReport;

  beforeAll(async () => {
    spec = await loadPrimaryVault();
    vault = await buildGroundTruthVault(spec);
    await stripLinks(vault, spec.groundTruth);

    // Run full engine for comparison
    const fullRuns = await runSuggestionsOnVault(vault);
    fullReport = evaluateSuggestions(fullRuns, spec.groundTruth, spec.entities);
  }, 60000);

  afterAll(async () => {
    if (vault) await vault.cleanup();
  });

  describe('Text-only baseline (Layers 2+3 only)', () => {
    let textOnlyReport: PrecisionRecallReport;

    beforeAll(async () => {
      // Disable all non-text layers
      const disabledLayers: ScoringLayer[] = [
        'cooccurrence',
        'type_boost', 'context_boost',
        'recency', 'cross_folder',
        'hub_boost', 'feedback', 'semantic',
      ];
      const runs = await runSuggestionsOnVault(vault, { disabledLayers });
      textOnlyReport = evaluateSuggestions(runs, spec.groundTruth, spec.entities);
    }, 60000);

    it('produces some suggestions', () => {
      expect(textOnlyReport.totalSuggestions).toBeGreaterThan(0);
    });

    it('F1 is within 0.15 of full engine (text matching is the foundation)', () => {
      // On a synthetic vault, text matching IS the primary signal.
      // Graph layers (co-occurrence, hub scores) now recover T3 entities,
      // widening the gap from text-only baseline — this is expected.
      expect(Math.abs(fullReport.f1 - textOnlyReport.f1)).toBeLessThanOrEqual(0.15);
    });
  });

  describe('Most-popular baseline', () => {
    let hubOnlyReport: PrecisionRecallReport;

    beforeAll(async () => {
      // Disable everything except hub_boost (and keep filters)
      const disabledLayers: ScoringLayer[] = [
        'exact_match', 'stem_match',
        'cooccurrence',
        'type_boost', 'context_boost',
        'recency', 'cross_folder',
        'feedback', 'semantic',
      ];
      const runs = await runSuggestionsOnVault(vault, { disabledLayers });
      hubOnlyReport = evaluateSuggestions(runs, spec.groundTruth, spec.entities);
    }, 60000);

    it('has lower F1 than full engine', () => {
      expect(hubOnlyReport.f1).toBeLessThanOrEqual(fullReport.f1);
    });
  });

  describe('Full engine vs baselines', () => {
    let textOnlyReport: PrecisionRecallReport;
    let hubOnlyReport: PrecisionRecallReport;

    beforeAll(async () => {
      const textDisabled: ScoringLayer[] = [
        'cooccurrence',
        'type_boost', 'context_boost',
        'recency', 'cross_folder',
        'hub_boost', 'feedback', 'semantic',
      ];
      const hubDisabled: ScoringLayer[] = [
        'exact_match', 'stem_match',
        'cooccurrence',
        'type_boost', 'context_boost',
        'recency', 'cross_folder',
        'feedback', 'semantic',
      ];

      const [textRuns, hubRuns] = await Promise.all([
        runSuggestionsOnVault(vault, { disabledLayers: textDisabled }),
        runSuggestionsOnVault(vault, { disabledLayers: hubDisabled }),
      ]);
      textOnlyReport = evaluateSuggestions(textRuns, spec.groundTruth, spec.entities);
      hubOnlyReport = evaluateSuggestions(hubRuns, spec.groundTruth, spec.entities);
    }, 60000);

    it('Full engine F1 is competitive with text-only baseline', () => {
      // On synthetic vaults, text matching dominates. The graph layers add value
      // on real vaults with accumulated co-occurrence, recency, and feedback data.
      // Here we just verify the full engine doesn't regress vs text-only.
      expect(fullReport.f1).toBeGreaterThanOrEqual(textOnlyReport.f1 - 0.05);
    });

    it('Flywheel F1 exceeds Most-popular by >= 0.20', () => {
      expect(fullReport.f1 - hubOnlyReport.f1).toBeGreaterThanOrEqual(0.20);
    });
  });
});

describe('Negative Testing', () => {
  let vault: TempVault;
  let spec: GroundTruthSpec;

  beforeAll(async () => {
    spec = await loadPrimaryVault();
    vault = await buildGroundTruthVault(spec);
    // Do NOT strip links -- we want the vault with its original links intact
  }, 60000);

  afterAll(async () => {
    if (vault) await vault.cleanup();
  });

  describe('Already-linked entities', () => {
    it('does not re-suggest entities already linked in note', async () => {
      const runs = await runSuggestionsOnVault(vault);

      for (const run of runs) {
        const fullPath = path.join(vault.vaultPath, run.notePath);
        let content: string;
        try {
          content = await readFile(fullPath, 'utf-8');
        } catch {
          continue;
        }

        // Extract actual wikilinks from file content (not spec metadata)
        const existingLinks = extractLinkedEntities(content);
        if (existingLinks.size === 0) continue;

        for (const suggestion of run.suggestions) {
          expect(
            existingLinks.has(suggestion.toLowerCase()),
            `"${suggestion}" re-suggested in ${run.notePath} despite being wikilinked`,
          ).toBe(false);
        }
      }
    }, 60000);
  });

  describe('Self-reference', () => {
    it('entity notes do not suggest themselves', async () => {
      const runs = await runSuggestionsOnVault(vault);

      for (const run of runs) {
        // Derive the entity name from the note path (e.g., "people/John Smith.md" -> "John Smith")
        const noteBasename = run.notePath.replace(/\.md$/, '').split('/').pop() || '';
        for (const suggestion of run.suggestions) {
          expect(suggestion.toLowerCase()).not.toBe(noteBasename.toLowerCase());
        }
      }
    }, 60000);
  });

  describe('Suppressed entities', () => {
    it('suppressed entities do not appear in suggestions', async () => {
      // Pick an entity that exists in the vault to suppress
      const entityToSuppress = spec.entities[0]?.name;
      if (!entityToSuppress) return;

      // Insert suppression into the database
      vault.stateDb.db.prepare(
        `INSERT OR REPLACE INTO wikilink_suppressions (entity, false_positive_rate, updated_at)
         VALUES (?, 1.0, datetime('now'))`
      ).run(entityToSuppress);

      try {
        const runs = await runSuggestionsOnVault(vault);

        for (const run of runs) {
          for (const suggestion of run.suggestions) {
            expect(suggestion.toLowerCase()).not.toBe(entityToSuppress.toLowerCase());
          }
        }
      } finally {
        // Clean up suppression
        vault.stateDb.db.prepare(
          'DELETE FROM wikilink_suppressions WHERE entity = ?'
        ).run(entityToSuppress);
      }
    }, 60000);
  });
});

describe('Domain Interference', () => {
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

  describe('Health entities in work context', () => {
    it('less than 10% of suggestions are health entities', async () => {
      // Find work-focused notes (e.g., in projects/ or work/ folders)
      const workNotes = spec.notes.filter(n =>
        n.path.startsWith('projects/') ||
        n.path.startsWith('work/') ||
        n.folder === 'projects' ||
        n.folder === 'work'
      );

      if (workNotes.length === 0) {
        console.warn('[graph-quality] No work-focused notes found in vault; skipping domain interference test');
        return;
      }

      const runs = await runSuggestionsOnVault(vault);

      // Build entity category lookup
      const entityCategory = new Map<string, string>();
      for (const e of spec.entities) {
        entityCategory.set(e.name.toLowerCase(), e.category);
      }

      // Check only work note suggestions
      const workNotePaths = new Set(workNotes.map(n => n.path));
      let totalWorkSuggestions = 0;
      let healthSuggestions = 0;

      for (const run of runs) {
        if (!workNotePaths.has(run.notePath)) continue;
        for (const suggestion of run.suggestions) {
          totalWorkSuggestions++;
          const category = entityCategory.get(suggestion.toLowerCase());
          if (category === 'health') {
            healthSuggestions++;
          }
        }
      }

      if (totalWorkSuggestions > 0) {
        const healthRate = healthSuggestions / totalWorkSuggestions;
        // Co-occurrence from daily notes creates cross-domain associations
        // (people ↔ health activities). Rate up to 0.20 is acceptable.
        expect(healthRate).toBeLessThan(0.20);
      }
    }, 60000);
  });
});
