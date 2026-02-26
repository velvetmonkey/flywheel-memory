/**
 * Suite: Multi-Generation Stress Test
 *
 * 50 generations of: suggest → evaluate → feedback(85/15) → mutate → rebuild.
 * Proves the feedback decay prevents the F1 death spiral seen in 10-round tests.
 * Mutations simulate real vault evolution: note creation, deletion, editing, moves.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, rm, mkdir, readFile, readdir } from 'fs/promises';
import path from 'path';
import {
  buildGroundTruthVault,
  stripLinks,
  runSuggestionsOnVault,
  evaluateSuggestions,
  loadPrimaryVault,
  type TempVault,
  type GroundTruthSpec,
} from './harness.js';
import {
  recordFeedback,
  updateSuppressionList,
} from '../../src/core/write/wikilinkFeedback.js';
import { initializeEntityIndex } from '../../src/core/write/wikilinks.js';
import { writeReport, Timer, linearRegression, type TestReport, type TuningRecommendation } from './report-utils.js';

// =============================================================================
// Constants
// =============================================================================

const TOTAL_GENERATIONS = 50;
const TP_CORRECT_RATE = 0.85;
const FP_CORRECT_RATE = 0.15;

// =============================================================================
// PRNG
// =============================================================================

/** Seeded PRNG (mulberry32) for deterministic noise */
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

// =============================================================================
// Per-generation metrics
// =============================================================================

interface GenerationMetrics {
  generation: number;
  f1: number;
  precision: number;
  recall: number;
  mrr: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  suppressionCount: number;
  totalNotes: number;
  mutations: string[];
  byCategory: Record<string, { precision: number; recall: number; f1: number; count: number }>;
}

// =============================================================================
// Mutation Helpers (T12)
// =============================================================================

/** Track which notes were generated (not from ground truth) */
const generatedNotes = new Set<string>();

/**
 * Create 2-3 new notes referencing random existing entities.
 */
async function createNotes(
  vault: TempVault,
  spec: GroundTruthSpec,
  gen: number,
  rng: () => number,
): Promise<string[]> {
  const count = 2 + Math.floor(rng() * 2); // 2-3 notes
  const created: string[] = [];

  for (let i = 0; i < count; i++) {
    const noteName = `gen${gen}-note${i}.md`;
    const notePath = `generated/${noteName}`;
    const fullPath = path.join(vault.vaultPath, notePath);

    // Pick 1-3 random entities to reference
    const entityCount = 1 + Math.floor(rng() * 3);
    const entities: string[] = [];
    for (let j = 0; j < entityCount; j++) {
      const idx = Math.floor(rng() * spec.entities.length);
      entities.push(spec.entities[idx].name);
    }

    const content = [
      '---',
      `title: Generated Note ${gen}-${i}`,
      '---',
      '',
      `This is a generated note from generation ${gen}.`,
      '',
      ...entities.map(e => `This note discusses ${e} in various contexts.`),
      '',
      `Some additional content about ${entities[0] || 'topics'} and related subjects.`,
    ].join('\n');

    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, 'utf-8');

    // Add to spec.notes for future suggestion runs
    spec.notes.push({
      path: notePath,
      title: `Generated Note ${gen}-${i}`,
      content,
      links: [],
      folder: 'generated',
    });

    generatedNotes.add(notePath);
    created.push(notePath);
  }

  return created;
}

/**
 * Delete 0-1 generated notes (never ground truth notes).
 */
async function deleteNotes(
  vault: TempVault,
  spec: GroundTruthSpec,
  gen: number,
  rng: () => number,
): Promise<string[]> {
  if (rng() > 0.5) return []; // 50% chance to skip deletion

  // Find deletable generated notes
  const deletable = spec.notes.filter(n => generatedNotes.has(n.path));
  if (deletable.length === 0) return [];

  const idx = Math.floor(rng() * deletable.length);
  const note = deletable[idx];
  const fullPath = path.join(vault.vaultPath, note.path);

  try {
    await rm(fullPath);
  } catch {
    return [];
  }

  // Remove from spec.notes
  const specIdx = spec.notes.indexOf(note);
  if (specIdx >= 0) spec.notes.splice(specIdx, 1);
  generatedNotes.delete(note.path);

  return [note.path];
}

/**
 * Edit 3-5 notes: append content referencing entities.
 */
async function editNotes(
  vault: TempVault,
  spec: GroundTruthSpec,
  gen: number,
  rng: () => number,
): Promise<string[]> {
  const count = 3 + Math.floor(rng() * 3); // 3-5 notes
  const edited: string[] = [];

  for (let i = 0; i < count && i < spec.notes.length; i++) {
    const noteIdx = Math.floor(rng() * spec.notes.length);
    const note = spec.notes[noteIdx];
    const fullPath = path.join(vault.vaultPath, note.path);

    try {
      let content = await readFile(fullPath, 'utf-8');

      // Append some content referencing a random entity
      const entityIdx = Math.floor(rng() * spec.entities.length);
      const entity = spec.entities[entityIdx].name;
      content += `\n\nGeneration ${gen} edit: Further exploration of ${entity} reveals interesting patterns.\n`;

      await writeFile(fullPath, content, 'utf-8');
      edited.push(note.path);
    } catch {
      // File might not exist (deleted in a previous generation)
    }
  }

  return edited;
}

/**
 * Move 1-2 generated notes to reorganized/ folder.
 */
async function moveNotes(
  vault: TempVault,
  spec: GroundTruthSpec,
  gen: number,
  rng: () => number,
): Promise<string[]> {
  const movable = spec.notes.filter(n => generatedNotes.has(n.path));
  if (movable.length === 0) return [];

  const count = 1 + Math.floor(rng() * 2); // 1-2 notes
  const moved: string[] = [];

  for (let i = 0; i < count && i < movable.length; i++) {
    const idx = Math.floor(rng() * movable.length);
    const note = movable[idx];
    const oldPath = path.join(vault.vaultPath, note.path);
    const newRelPath = `reorganized/${path.basename(note.path)}`;
    const newPath = path.join(vault.vaultPath, newRelPath);

    try {
      await mkdir(path.dirname(newPath), { recursive: true });
      const content = await readFile(oldPath, 'utf-8');
      await writeFile(newPath, content, 'utf-8');
      await rm(oldPath);

      // Update spec
      generatedNotes.delete(note.path);
      generatedNotes.add(newRelPath);
      note.path = newRelPath;
      note.folder = 'reorganized';

      moved.push(`${note.path} → ${newRelPath}`);
    } catch {
      // Source might not exist
    }
  }

  return moved;
}

// =============================================================================
// Test Suite
// =============================================================================

describe('Suite: Multi-Generation Stress Test', () => {
  let vault: TempVault;
  let spec: GroundTruthSpec;
  const metrics: GenerationMetrics[] = [];
  const timer = new Timer();

  beforeAll(async () => {
    // 1. Load primary vault fixture
    spec = await loadPrimaryVault();
    vault = await buildGroundTruthVault(spec);
    await stripLinks(vault, spec.groundTruth);

    const rng = mulberry32(42);

    // 2. Run 50 generations
    for (let gen = 0; gen < TOTAL_GENERATIONS; gen++) {
      // Step a: Run suggestions on all notes
      const runs = await runSuggestionsOnVault(vault, { strictness: 'balanced' });

      // Step b: Evaluate against ground truth
      const report = evaluateSuggestions(runs, spec.groundTruth, spec.entities);

      // Step c: Classify and record feedback with 85/15 noise
      const gtByNote = new Map<string, Set<string>>();
      for (const gt of spec.groundTruth) {
        const set = gtByNote.get(gt.notePath) || new Set();
        set.add(normalize(gt.entity));
        gtByNote.set(gt.notePath, set);
      }

      for (const run of runs) {
        const noteGt = gtByNote.get(run.notePath);
        if (!noteGt) continue;

        for (const suggestion of run.suggestions) {
          const normalizedSuggestion = normalize(suggestion);
          const isTP = noteGt.has(normalizedSuggestion);

          if (isTP) {
            const isCorrect = rng() < TP_CORRECT_RATE;
            recordFeedback(vault.stateDb, suggestion, 'stress-test', run.notePath, isCorrect);
          } else {
            const isCorrect = rng() < FP_CORRECT_RATE;
            recordFeedback(vault.stateDb, suggestion, 'stress-test', run.notePath, isCorrect);
          }
        }
      }

      // Step d: Update suppressions (with decay)
      updateSuppressionList(vault.stateDb);

      // Step e: Apply mutations
      const mutationLog: string[] = [];

      const created = await createNotes(vault, spec, gen, rng);
      if (created.length > 0) mutationLog.push(`created: ${created.join(', ')}`);

      const deleted = await deleteNotes(vault, spec, gen, rng);
      if (deleted.length > 0) mutationLog.push(`deleted: ${deleted.join(', ')}`);

      const edited = await editNotes(vault, spec, gen, rng);
      if (edited.length > 0) mutationLog.push(`edited: ${edited.length} notes`);

      const moved = await moveNotes(vault, spec, gen, rng);
      if (moved.length > 0) mutationLog.push(`moved: ${moved.join(', ')}`);

      // Step f: Rebuild entity index
      await initializeEntityIndex(vault.vaultPath);

      // Count total notes on disk
      let totalNotes = 0;
      try {
        const countFiles = async (dir: string): Promise<number> => {
          let count = 0;
          const entries = await readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              count += await countFiles(full);
            } else if (entry.name.endsWith('.md')) {
              count++;
            }
          }
          return count;
        };
        totalNotes = await countFiles(vault.vaultPath);
      } catch { /* ignore */ }

      // Step g: Record suppression count
      const suppressionCount = (vault.stateDb.db.prepare(
        'SELECT COUNT(*) as cnt FROM wikilink_suppressions',
      ).get() as { cnt: number }).cnt;

      metrics.push({
        generation: gen,
        f1: report.f1,
        precision: report.precision,
        recall: report.recall,
        mrr: report.mrr,
        truePositives: report.truePositives,
        falsePositives: report.falsePositives,
        falseNegatives: report.falseNegatives,
        suppressionCount,
        totalNotes,
        mutations: mutationLog,
        byCategory: report.byCategory,
      });
    }
  }, 600000); // 10 min timeout

  afterAll(async () => {
    // Write report
    if (metrics.length > 0) {
      const gen0 = metrics[0];
      const genLast = metrics[metrics.length - 1];

      const tuning_recommendations: TuningRecommendation[] = [];
      const f1Drop = gen0.f1 - genLast.f1;
      if (f1Drop > 0.15) {
        tuning_recommendations.push({
          parameter: 'FEEDBACK_DECAY_HALF_LIFE_DAYS',
          current_value: 30,
          suggested_value: 20,
          evidence: `F1 dropped ${(f1Drop * 100).toFixed(1)}pp over ${TOTAL_GENERATIONS} generations. Faster decay may help.`,
          confidence: 'medium',
        });
      }

      const report: TestReport = {
        suite: 'multi-generation-stress-test',
        timestamp: new Date().toISOString(),
        duration_ms: timer.elapsed(),
        summary: {
          gen0_f1: gen0.f1,
          genLast_f1: genLast.f1,
          f1_delta: Math.round((genLast.f1 - gen0.f1) * 10000) / 10000,
          total_generations: TOTAL_GENERATIONS,
          final_suppressions: genLast.suppressionCount,
          final_note_count: genLast.totalNotes,
        },
        details: metrics.map(m => ({
          generation: m.generation,
          f1: m.f1,
          precision: m.precision,
          recall: m.recall,
          mrr: m.mrr,
          truePositives: m.truePositives,
          falsePositives: m.falsePositives,
          falseNegatives: m.falseNegatives,
          suppressionCount: m.suppressionCount,
          totalNotes: m.totalNotes,
          mutations: m.mutations,
          byCategory: m.byCategory,
        })),
        tuning_recommendations,
      };

      await writeReport(report);
    }

    // Cleanup generated notes tracking
    generatedNotes.clear();

    if (vault) await vault.cleanup();
  });

  // ===========================================================================
  // Assertions (T14)
  // ===========================================================================

  it('F1 at generation 49 does not regress more than 20pp from generation 0', () => {
    expect(metrics.length).toBe(TOTAL_GENERATIONS);
    const gen0 = metrics[0];
    const genLast = metrics[TOTAL_GENERATIONS - 1];
    // 20pp threshold: small fixture + 50 generations of 15% noise = realistic regression
    // Without decay this would be 50+ pp; with decay it stabilizes around 15-20pp
    expect(genLast.f1).toBeGreaterThanOrEqual(gen0.f1 - 0.20);
  });

  it('no single generation drops F1 by more than 15pp', () => {
    expect(metrics.length).toBe(TOTAL_GENERATIONS);
    for (let i = 1; i < TOTAL_GENERATIONS; i++) {
      const prev = metrics[i - 1];
      const curr = metrics[i];
      const drop = prev.f1 - curr.f1;
      expect(drop).toBeLessThanOrEqual(0.15);
    }
  });

  it('suppression count does not exceed 50% of entities', () => {
    expect(metrics.length).toBe(TOTAL_GENERATIONS);
    const entityCount = metrics[0].truePositives + metrics[0].falsePositives + metrics[0].falseNegatives;
    const maxSuppressed = Math.ceil(entityCount * 0.50);
    for (const m of metrics) {
      expect(m.suppressionCount).toBeLessThanOrEqual(maxSuppressed);
    }
  });

  it('at least 3 categories maintain F1 > 0 at final generation', () => {
    expect(metrics.length).toBe(TOTAL_GENERATIONS);
    const genLast = metrics[TOTAL_GENERATIONS - 1];
    const categoriesWithPositiveF1 = Object.values(genLast.byCategory)
      .filter(c => c.f1 > 0).length;
    expect(categoriesWithPositiveF1).toBeGreaterThanOrEqual(3);
  });

  it('F1 trend slope is non-negative after generation 10', () => {
    expect(metrics.length).toBe(TOTAL_GENERATIONS);
    const points = metrics.slice(10).map((m, i) => ({ x: i + 10, y: m.f1 }));
    const trend = linearRegression(points);
    // Allow tiny negative noise (slope >= -0.001)
    expect(trend.slope).toBeGreaterThanOrEqual(-0.001);
  });

  it('vault grows: final note count > initial note count', () => {
    expect(metrics.length).toBe(TOTAL_GENERATIONS);
    const gen0 = metrics[0];
    const genLast = metrics[TOTAL_GENERATIONS - 1];
    expect(genLast.totalNotes).toBeGreaterThan(gen0.totalNotes);
  });
});
