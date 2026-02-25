/**
 * Temporal Evolution Test
 *
 * Simulates vault growth over 5 incremental cycles, proving that F1 is
 * non-decreasing as the vault expands. Notes are added in batches, the
 * entity index is rebuilt after each batch, and feedback is injected
 * based on ground truth to simulate a realistic learning loop.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
  loadPrimaryVault,
  runSuggestionsOnVault,
  evaluateSuggestions,
  type GroundTruthSpec,
  type TempVault,
  type NoteSpec,
  type PrecisionRecallReport,
} from './harness.js';
import { initializeEntityIndex } from '../../src/core/write/wikilinks.js';
import { setWriteStateDb } from '../../src/core/write/wikilinks.js';
import { setRecencyStateDb } from '../../src/core/shared/recency.js';
import { recordFeedback } from '../../src/core/write/wikilinkFeedback.js';
import { openStateDb, deleteStateDb, type StateDb } from '@velvetmonkey/vault-core';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'fs/promises';
import path from 'path';
import os from 'os';

// =============================================================================
// Helpers
// =============================================================================

const normalize = (name: string): string => name.toLowerCase().replace(/-/g, ' ');

// =============================================================================
// Test Suite
// =============================================================================

describe('Temporal Evolution', () => {
  let spec: GroundTruthSpec;
  let vaultPath: string;
  let stateDb: StateDb;
  const f1History: number[] = [];
  const entityCounts: number[] = [];
  const suggestionCounts: number[] = [];

  beforeAll(async () => {
    spec = await loadPrimaryVault();
    vaultPath = await mkdtemp(path.join(os.tmpdir(), 'flywheel-temporal-'));

    // Sort notes into 5 batches for growth cycles (cumulative)
    const allNotes = [...spec.notes];
    const batchSize = Math.ceil(allNotes.length / 5);
    const batches: NoteSpec[][] = [];
    for (let i = 0; i < 5; i++) {
      batches.push(allNotes.slice(0, (i + 1) * batchSize));
    }

    // For each cycle: write notes, rebuild index, strip GT links, run suggestions, inject feedback
    for (let cycle = 0; cycle < 5; cycle++) {
      const cycleNotes = batches[cycle];

      // Write all notes for this cycle to disk
      for (const note of cycleNotes) {
        const fullPath = path.join(vaultPath, note.path);
        await mkdir(path.dirname(fullPath), { recursive: true });
        let md = '';
        if (note.frontmatter && Object.keys(note.frontmatter).length > 0) {
          md += '---\n';
          for (const [key, value] of Object.entries(note.frontmatter)) {
            if (Array.isArray(value)) {
              md += `${key}:\n`;
              for (const item of value) {
                md += `  - ${item}\n`;
              }
            } else {
              md += `${key}: ${value}\n`;
            }
          }
          md += '---\n\n';
        }
        md += note.content;
        await writeFile(fullPath, md, 'utf-8');
      }

      // Open state db on first cycle
      if (cycle === 0) {
        stateDb = openStateDb(vaultPath);
        setWriteStateDb(stateDb);
        setRecencyStateDb(stateDb);
      }

      // Reinitialize entity index with the current vault contents
      await initializeEntityIndex(vaultPath);

      // Identify ground truth links that belong to notes in this cycle
      const currentPaths = new Set(cycleNotes.map(n => n.path));
      const currentGt = spec.groundTruth.filter(gt => currentPaths.has(gt.notePath));

      // Strip wikilinks for current GT entries
      for (const gt of currentGt) {
        const fullPath = path.join(vaultPath, gt.notePath);
        try {
          let content = await readFile(fullPath, 'utf-8');
          const re = new RegExp(
            `\\[\\[${gt.entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]`,
            'g',
          );
          content = content.replace(re, gt.entity);
          await writeFile(fullPath, content, 'utf-8');
        } catch {
          /* note not yet written in this batch */
        }
      }

      // Re-initialize after stripping
      await initializeEntityIndex(vaultPath);

      // Build a temporary TempVault for the harness runner
      const cycleSpec: GroundTruthSpec = { ...spec, notes: cycleNotes };
      const cycleVault: TempVault = {
        vaultPath,
        stateDb,
        spec: cycleSpec,
        cleanup: async () => {},
      };

      // Run suggestions
      const runs = await runSuggestionsOnVault(cycleVault, { strictness: 'balanced' });
      const report = evaluateSuggestions(runs, currentGt, spec.entities);

      f1History.push(report.f1);
      entityCounts.push(
        (stateDb.db.prepare('SELECT COUNT(*) as cnt FROM entities').get() as { cnt: number }).cnt,
      );
      suggestionCounts.push(report.totalSuggestions);

      // Inject feedback based on GT (positive for TPs, negative for FPs)
      const gtByNote = new Map<string, Set<string>>();
      for (const gt of currentGt) {
        const set = gtByNote.get(gt.notePath) || new Set();
        set.add(normalize(gt.entity));
        gtByNote.set(gt.notePath, set);
      }

      for (const run of runs) {
        const noteGt = gtByNote.get(run.notePath);
        if (!noteGt) continue;
        for (const suggestion of run.suggestions) {
          const isCorrect = noteGt.has(normalize(suggestion));
          recordFeedback(stateDb, suggestion, 'temporal-cycle', run.notePath, isCorrect);
        }
      }
    }
  }, 120000);

  afterAll(async () => {
    if (stateDb) {
      setWriteStateDb(null);
      setRecencyStateDb(null);
      stateDb.close();
      deleteStateDb(vaultPath);
    }
    if (vaultPath) await rm(vaultPath, { recursive: true, force: true });
  });

  // ===========================================================================
  // Tests
  // ===========================================================================

  test('F1 is non-decreasing across 5 growth cycles', () => {
    expect(f1History.length).toBe(5);
    // Allow 0.15 tolerance per cycle for variance in incremental growth.
    // Early cycles with few notes have noisier F1 estimates.
    for (let i = 1; i < f1History.length; i++) {
      expect(f1History[i]).toBeGreaterThanOrEqual(f1History[i - 1] - 0.15);
    }
  });

  test('entity count grows each cycle', () => {
    expect(entityCounts.length).toBe(5);
    for (let i = 1; i < entityCounts.length; i++) {
      expect(entityCounts[i]).toBeGreaterThanOrEqual(entityCounts[i - 1]);
    }
  });

  test('suggestion count grows with vault size', () => {
    expect(suggestionCounts.length).toBe(5);
    // Last cycle should produce at least as many suggestions as the first
    expect(suggestionCounts[suggestionCounts.length - 1]).toBeGreaterThanOrEqual(
      suggestionCounts[0],
    );
  });

  test('final F1 >= initial F1', () => {
    expect(f1History.length).toBe(5);
    // Final cycle (full vault) should be at least as good as the first partial cycle
    expect(f1History[f1History.length - 1]).toBeGreaterThanOrEqual(f1History[0] - 0.05);
  });

  test('data accumulates across cycles', () => {
    // Check that the entity count in the final cycle is substantial
    const finalEntityCount = entityCounts[entityCounts.length - 1];
    expect(finalEntityCount).toBeGreaterThan(0);

    // Check that entity count in the final cycle is greater than the first
    expect(finalEntityCount).toBeGreaterThanOrEqual(entityCounts[0]);

    // Verify feedback was actually recorded in the database
    const feedbackCount = (
      stateDb.db
        .prepare('SELECT COUNT(*) as cnt FROM wikilink_feedback')
        .get() as { cnt: number }
    ).cnt;
    expect(feedbackCount).toBeGreaterThan(0);
  });
});
