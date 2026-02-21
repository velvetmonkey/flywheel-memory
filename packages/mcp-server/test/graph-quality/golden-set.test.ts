/**
 * Golden Set Test
 *
 * 20 hand-curated "obvious" links that the suggestion engine must recover
 * with 100% recall. These are all Tier 1 ground truth links where the
 * entity has hubScore >= 20 and name length >= 4 — the easiest possible
 * suggestions the system should never miss.
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
  type GroundTruthLink,
  type PrecisionRecallReport,
  type SuggestionRun,
} from './harness.js';

// =============================================================================
// Golden Set — 20 high-confidence, high-hub-score entity-note pairs
// =============================================================================

const GOLDEN_SET: Array<{ notePath: string; entity: string }> = [
  { notePath: 'daily-notes/2026-01-01.md', entity: 'ESGHub' },
  { notePath: 'daily-notes/2026-01-01.md', entity: 'David Chen' },
  { notePath: 'daily-notes/2026-01-03.md', entity: 'James Franklin' },
  { notePath: 'daily-notes/2026-01-03.md', entity: 'DataPipeline' },
  { notePath: 'daily-notes/2026-01-04.md', entity: 'TypeScript' },
  { notePath: 'daily-notes/2026-01-04.md', entity: 'Vault Core' },
  { notePath: 'daily-notes/2026-01-06.md', entity: 'Continuous Integration' },
  { notePath: 'daily-notes/2026-01-07.md', entity: 'PostgreSQL' },
  { notePath: 'daily-notes/2026-01-08.md', entity: 'Marcus Johnson' },
  { notePath: 'daily-notes/2026-01-09.md', entity: 'Machine Learning' },
  { notePath: 'daily-notes/2026-01-10.md', entity: 'Technical Debt' },
  { notePath: 'daily-notes/2026-01-13.md', entity: 'Elena Torres' },
  { notePath: 'daily-notes/2026-01-09.md', entity: 'Research Lab' },
  { notePath: 'daily-notes/2026-01-15.md', entity: 'Microservices' },
  { notePath: 'inbox/project-docs/esghub-architecture.md', entity: 'Observability' },
  { notePath: 'inbox/project-docs/esghub-architecture.md', entity: 'Redis' },
  { notePath: 'inbox/project-docs/esghub-api-guide.md', entity: 'GraphQL' },
  { notePath: 'inbox/project-docs/datapipeline-runbook.md', entity: 'Docker' },
  { notePath: 'inbox/tech-guides/rest-api-conventions.md', entity: 'Microservices' },
  { notePath: 'inbox/team-retro-jan.md', entity: 'Code Review' },
];

// =============================================================================
// Helpers
// =============================================================================

const normalize = (name: string): string => name.toLowerCase().replace(/-/g, ' ');

// =============================================================================
// Test Suite
// =============================================================================

describe('Golden Set', () => {
  let vault: TempVault;
  let spec: GroundTruthSpec;
  let runs: SuggestionRun[];
  let report: PrecisionRecallReport;

  const goldenGt: GroundTruthLink[] = GOLDEN_SET.map(g => ({
    notePath: g.notePath,
    entity: g.entity,
    tier: 1 as const,
    reason: 'Golden set - high hub score, verbatim name match',
  }));

  beforeAll(async () => {
    spec = await loadPrimaryVault();
    vault = await buildGroundTruthVault(spec);

    // Strip only golden set links (not the full ground truth)
    await stripLinks(vault, goldenGt);

    // Run suggestions with generous maxSuggestions
    runs = await runSuggestionsOnVault(vault, {
      maxSuggestions: 10,
      strictness: 'balanced',
    });

    report = evaluateSuggestions(runs, goldenGt, spec.entities);
  }, 60000);

  afterAll(async () => {
    if (vault) await vault.cleanup();
  });

  // =========================================================================
  // 1. Golden set has 20 entries
  // =========================================================================

  it('golden set has 20 entries', () => {
    expect(GOLDEN_SET).toHaveLength(20);
    expect(goldenGt).toHaveLength(20);
  });

  // =========================================================================
  // 2. All golden set entities exist in the fixture
  // =========================================================================

  it('all golden set entities exist in fixture', () => {
    const entityNames = new Set(spec.entities.map(e => normalize(e.name)));

    const missing: string[] = [];
    for (const g of GOLDEN_SET) {
      if (!entityNames.has(normalize(g.entity))) {
        missing.push(g.entity);
      }
    }

    expect(missing).toEqual([]);
  });

  // =========================================================================
  // 3. Achieves 100% recall on golden set
  // =========================================================================

  it('achieves 100% recall on golden set', () => {
    // Build a lookup of suggestions per note
    const suggestionsByNote = new Map<string, Set<string>>();
    for (const run of runs) {
      const set = new Set(run.suggestions.map(s => normalize(s)));
      suggestionsByNote.set(run.notePath, set);
    }

    // Check each golden pair
    const misses: Array<{ notePath: string; entity: string; available: string[] }> = [];
    for (const g of GOLDEN_SET) {
      const noteSuggestions = suggestionsByNote.get(g.notePath);
      if (!noteSuggestions || !noteSuggestions.has(normalize(g.entity))) {
        misses.push({
          notePath: g.notePath,
          entity: g.entity,
          available: noteSuggestions ? Array.from(noteSuggestions) : [],
        });
      }
    }

    // Log misses for debugging if any
    if (misses.length > 0) {
      console.log('Golden set misses:');
      for (const miss of misses) {
        console.log(`  ${miss.notePath} -> ${miss.entity} (available: [${miss.available.join(', ')}])`);
      }
    }

    expect(misses).toHaveLength(0);
    expect(report.recall).toBe(1);
  });

  // =========================================================================
  // 4. Golden set precision >= 80%
  // =========================================================================

  it('golden set precision >= 80%', () => {
    expect(report.precision).toBeGreaterThanOrEqual(0.8);
  });
});
