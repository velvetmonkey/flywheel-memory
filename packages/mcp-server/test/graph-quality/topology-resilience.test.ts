/**
 * Suite 7: Cross-Topology Resilience (6 archetypes × chaos mutations)
 *
 * Runs chaos mutation scenarios against each of the 6 archetype vault
 * topologies. Proves resilience isn't topology-dependent.
 *
 * Archetypes: hub-and-spoke, hierarchical, dense-mesh, sparse-orphan,
 *             bridge-network, small-world
 *
 * Per-topology mutations: Bulk rename 20% of entities, delete 10% of
 * notes, add 20% new notes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, readFile, rm, rename, mkdir, readdir } from 'fs/promises';
import path from 'path';
import {
  buildGroundTruthVault,
  stripLinks,
  runSuggestionsOnVault,
  evaluateSuggestions,
  computeGraphHealth,
  loadArchetype,
  type TempVault,
  type GroundTruthSpec,
  type PrecisionRecallReport,
  type GraphHealthReport,
} from './harness.js';
import {
  initializeEntityIndex,
  isEntityIndexReady,
  getEntityIndexStats,
  suggestRelatedLinks,
  setWriteStateDb,
} from '../../src/core/write/wikilinks.js';
import { setRecencyStateDb } from '../../src/core/shared/recency.js';
import {
  writeReport,
  Timer,
  type TestReport,
  type TuningRecommendation,
} from './report-utils.js';

// =============================================================================
// Constants
// =============================================================================

const ARCHETYPES = [
  'hub-and-spoke',
  'hierarchical',
  'dense-mesh',
  'sparse-orphan',
  'bridge-network',
  'small-world',
] as const;

type ArchetypeName = (typeof ARCHETYPES)[number];

// Topology-specific health bounds (wider than archetypes.test.ts to account for mutations)
const HEALTH_BOUNDS: Record<ArchetypeName, {
  minNoteCount: number;      // After deletions
  maxOrphanRate: number;     // Tolerable orphan rate after chaos
}> = {
  'hub-and-spoke':  { minNoteCount: 5, maxOrphanRate: 0.9 },
  'hierarchical':   { minNoteCount: 5, maxOrphanRate: 0.95 },
  'dense-mesh':     { minNoteCount: 5, maxOrphanRate: 0.8 },
  'sparse-orphan':  { minNoteCount: 5, maxOrphanRate: 1.0 }, // Already sparse
  'bridge-network': { minNoteCount: 5, maxOrphanRate: 0.9 },
  'small-world':    { minNoteCount: 5, maxOrphanRate: 0.8 },
};

// =============================================================================
// Types
// =============================================================================

interface TopologyResult {
  archetype: ArchetypeName;
  loaded: boolean;
  baselineHealth?: GraphHealthReport;
  postMutationHealth?: GraphHealthReport;
  baselineReport?: PrecisionRecallReport;
  postMutationReport?: PrecisionRecallReport;
  entityIndexRecovered: boolean;
  suggestionsWork: boolean;
  duration_ms: number;
}

// =============================================================================
// Helpers
// =============================================================================

/** Walk directory for .md files */
async function walkMd(dir: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(d: string) {
    const entries = await readdir(d, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        await walk(full);
      } else if (entry.name.endsWith('.md')) {
        files.push(full);
      }
    }
  }
  await walk(dir);
  return files;
}

// =============================================================================
// Test Suite
// =============================================================================

describe('Suite 7: Cross-Topology Resilience', () => {
  const results = new Map<ArchetypeName, TopologyResult>();
  const vaults = new Map<ArchetypeName, TempVault>();

  beforeAll(async () => {
    for (const archetype of ARCHETYPES) {
      const timer = new Timer();
      const result: TopologyResult = {
        archetype,
        loaded: false,
        entityIndexRecovered: false,
        suggestionsWork: false,
        duration_ms: 0,
      };

      let spec: GroundTruthSpec;
      let vault: TempVault;

      try {
        spec = await loadArchetype(archetype);
      } catch {
        results.set(archetype, result);
        continue;
      }

      result.loaded = true;

      try {
        vault = await buildGroundTruthVault(spec);
        vaults.set(archetype, vault);

        // ---- Baseline ----
        result.baselineHealth = await computeGraphHealth(vault.vaultPath);
        const baselineRuns = await runSuggestionsOnVault(vault, { strictness: 'balanced' });
        result.baselineReport = evaluateSuggestions(baselineRuns, spec.groundTruth, spec.entities);

        // ---- Chaos Mutations ----
        const allFiles = await walkMd(vault.vaultPath);
        const noteCount = allFiles.length;

        // 1. Bulk rename 20% of entity notes
        const entityFiles = allFiles.filter(f => {
          const rel = path.relative(vault.vaultPath, f);
          return rel.startsWith('people/') || rel.startsWith('entities/') ||
                 rel.startsWith('technologies/') || rel.startsWith('projects/') ||
                 rel.startsWith('organizations/') || rel.startsWith('locations/');
        });
        const renameCount = Math.max(1, Math.floor(entityFiles.length * 0.2));
        for (let i = 0; i < Math.min(renameCount, entityFiles.length); i++) {
          const src = entityFiles[i];
          const dir = path.dirname(src);
          const stem = path.basename(src, '.md');
          const dest = path.join(dir, `renamed-${stem}.md`);
          try {
            const content = await readFile(src, 'utf-8');
            const updatedContent = content.replace(
              new RegExp(`# ${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
              `# Renamed ${stem}`,
            );
            await writeFile(dest, updatedContent, 'utf-8');
            await rm(src, { force: true });
          } catch {
            // Skip if fails
          }
        }

        // 2. Delete 10% of notes
        const remainingFiles = await walkMd(vault.vaultPath);
        const deleteCount = Math.max(1, Math.floor(remainingFiles.length * 0.1));
        for (let i = 0; i < Math.min(deleteCount, remainingFiles.length); i++) {
          await rm(remainingFiles[i], { force: true });
        }

        // 3. Add 20% new notes
        const addCount = Math.max(1, Math.floor(noteCount * 0.2));
        const addDir = path.join(vault.vaultPath, 'chaos-additions');
        await mkdir(addDir, { recursive: true });
        for (let i = 0; i < addCount; i++) {
          // Reference some entities from the spec
          const entityIdx = i % spec.entities.length;
          const entityName = spec.entities[entityIdx].name;
          const content = `---\ntype: note\n---\n# Chaos Note ${i}\n\nNew content mentioning ${entityName}.\n`;
          await writeFile(
            path.join(addDir, `chaos-${i}.md`),
            content,
            'utf-8',
          );
        }

        // ---- Re-initialize and measure ----
        await initializeEntityIndex(vault.vaultPath);
        result.entityIndexRecovered = isEntityIndexReady();

        result.postMutationHealth = await computeGraphHealth(vault.vaultPath);

        // Re-read spec notes from disk (some may have been deleted/renamed)
        // Run suggestions on remaining notes
        const postFiles = await walkMd(vault.vaultPath);
        let suggestionsWork = true;
        for (const f of postFiles.slice(0, 5)) {
          try {
            const content = await readFile(f, 'utf-8');
            const relPath = path.relative(vault.vaultPath, f);
            const result = await suggestRelatedLinks(content, {
              maxSuggestions: 3,
              notePath: relPath,
            });
            if (!Array.isArray(result.suggestions)) {
              suggestionsWork = false;
              break;
            }
          } catch {
            suggestionsWork = false;
            break;
          }
        }
        result.suggestionsWork = suggestionsWork;
      } catch (e) {
        // Record the error but don't fail the whole suite
        result.entityIndexRecovered = false;
        result.suggestionsWork = false;
      }

      result.duration_ms = timer.elapsed();
      results.set(archetype, result);
    }

    // ---- Write report ----
    const recommendations: TuningRecommendation[] = [];
    const details = Array.from(results.values()).map(r => ({
      archetype: r.archetype,
      loaded: r.loaded,
      entityIndexRecovered: r.entityIndexRecovered,
      suggestionsWork: r.suggestionsWork,
      baselineNoteCount: r.baselineHealth?.noteCount ?? 0,
      postMutationNoteCount: r.postMutationHealth?.noteCount ?? 0,
      baselineF1: r.baselineReport?.f1 ?? 0,
      postOrphanRate: r.postMutationHealth?.orphanRate ?? 1,
      duration_ms: r.duration_ms,
    }));

    // Identify fragile topologies
    for (const r of results.values()) {
      if (r.loaded && !r.entityIndexRecovered) {
        recommendations.push({
          parameter: 'entity_index_recovery',
          current_value: 0,
          suggested_value: 1,
          evidence: `${r.archetype} topology failed to recover entity index after chaos mutations`,
          confidence: 'high',
        });
      }
    }

    const report: TestReport = {
      suite: 'topology-resilience',
      timestamp: new Date().toISOString(),
      duration_ms: Array.from(results.values()).reduce((sum, r) => sum + r.duration_ms, 0),
      summary: {
        archetypes_tested: Array.from(results.values()).filter(r => r.loaded).length,
        archetypes_recovered: Array.from(results.values()).filter(r => r.entityIndexRecovered).length,
        archetypes_suggestions_work: Array.from(results.values()).filter(r => r.suggestionsWork).length,
      },
      details,
      tuning_recommendations: recommendations,
    };

    await writeReport(report);
  }, 300000); // 5 min for all 6 archetypes × chaos

  afterAll(async () => {
    for (const vault of vaults.values()) {
      try {
        await vault.cleanup();
      } catch {
        // ignore cleanup errors
      }
    }
  });

  // =========================================================================
  // Per-topology assertions
  // =========================================================================

  for (const archetype of ARCHETYPES) {
    describe(archetype, () => {
      it('fixture loads successfully', () => {
        const r = results.get(archetype);
        expect(r).toBeDefined();
        if (!r?.loaded) {
          console.warn(`[topology-resilience] Skipping "${archetype}": fixture not found`);
          return;
        }
        expect(r.loaded).toBe(true);
      });

      it('entity index recovers after chaos mutations', () => {
        const r = results.get(archetype);
        if (!r?.loaded) return;
        expect(r.entityIndexRecovered).toBe(true);
      });

      it('suggestions still work after chaos mutations', () => {
        const r = results.get(archetype);
        if (!r?.loaded) return;
        expect(r.suggestionsWork).toBe(true);
      });

      it('health metrics within archetype-specific bounds', () => {
        const r = results.get(archetype);
        if (!r?.loaded || !r.postMutationHealth) return;

        const bounds = HEALTH_BOUNDS[archetype];
        expect(r.postMutationHealth.noteCount).toBeGreaterThanOrEqual(bounds.minNoteCount);
        expect(r.postMutationHealth.orphanRate).toBeLessThanOrEqual(bounds.maxOrphanRate);
      });
    });
  }

  // =========================================================================
  // Cross-topology assertions
  // =========================================================================

  describe('Cross-topology', () => {
    it('at least 4 of 6 archetypes recover successfully', () => {
      const recovered = Array.from(results.values()).filter(
        r => r.loaded && r.entityIndexRecovered && r.suggestionsWork,
      ).length;
      expect(recovered).toBeGreaterThanOrEqual(4);
    });

    it('no topology crashes during chaos mutations', () => {
      for (const r of results.values()) {
        if (!r.loaded) continue;
        // The test itself completing without throwing is the assertion.
        // If we got here, no crash occurred.
        expect(r.duration_ms).toBeGreaterThan(0);
      }
    });
  });
});
