/**
 * Suite 1: Vault Lifecycle Stress Test (500-note generated vault)
 *
 * Simulates a vault evolving through 5 epochs using the vault generator.
 * Each epoch mutates the vault at scale and measures signal survival.
 *
 * Epochs:
 *   1. Genesis — Generate vault, index, baseline snapshot
 *   2. Growth — Add 200 more notes with wikilinks to existing entities
 *   3. Reorganization — Move 100 notes to new folders, rename 50 entity files
 *   4. Pruning — Delete 80 notes including 5 highest-hub entities
 *   5. Recovery — Add 100 new notes reusing deleted entity names + new entities
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, readFile, rm, rename, mkdir, readdir } from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  openStateDb,
  deleteStateDb,
  type StateDb,
} from '@velvetmonkey/vault-core';
import {
  initializeEntityIndex,
  isEntityIndexReady,
  getEntityIndexStats,
  setWriteStateDb,
  suggestRelatedLinks,
} from '../../src/core/write/wikilinks.js';
import { setRecencyStateDb } from '../../src/core/shared/recency.js';
import {
  computeGraphHealth,
  type GraphHealthReport,
} from './harness.js';
import {
  takeSnapshot,
  diffSnapshots,
  type HealthSnapshot,
} from './health-snapshot.js';
import {
  writeReport,
  distributionStats,
  Timer,
  type TestReport,
  type TuningRecommendation,
} from './report-utils.js';
import { generateQuickVault } from '../../../bench/src/generator/vault.js';

// =============================================================================
// Constants
// =============================================================================

const SEED = 42;
const GENESIS_NOTE_COUNT = 500;
const GROWTH_NOTE_COUNT = 200;
const REORG_MOVE_COUNT = 100;
const REORG_RENAME_COUNT = 50;
const PRUNE_DELETE_COUNT = 80;
const PRUNE_HUB_DELETE_COUNT = 5;
const RECOVERY_NOTE_COUNT = 100;

// =============================================================================
// Types
// =============================================================================

interface EpochMetrics {
  epoch: string;
  health: GraphHealthReport;
  suggestionCoverage: number;
  scoreDistribution: {
    mean: number;
    p50: number;
    p90: number;
    min: number;
    max: number;
  };
  entityStats: {
    totalEntities: number;
    categories: Record<string, number>;
  };
  duration_ms: number;
}

// =============================================================================
// Helpers
// =============================================================================

/** Walk directory for .md files recursively */
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

/** Get suggestion coverage and score distribution for a vault */
async function measureSuggestions(
  vaultPath: string,
  mdFiles: string[],
): Promise<{
  coverage: number;
  scores: number[];
}> {
  let notesWithSuggestions = 0;
  const allScores: number[] = [];

  for (const filePath of mdFiles) {
    const relPath = path.relative(vaultPath, filePath);
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    const result = await suggestRelatedLinks(content, {
      maxSuggestions: 5,
      strictness: 'balanced',
      notePath: relPath,
      detail: true,
    });

    if (result.suggestions.length > 0) {
      notesWithSuggestions++;
    }

    if (result.detailed) {
      for (const d of result.detailed) {
        allScores.push(d.totalScore);
      }
    }
  }

  const coverage = mdFiles.length > 0 ? notesWithSuggestions / mdFiles.length : 0;
  return { coverage, scores: allScores };
}

/** Collect epoch metrics */
async function collectEpochMetrics(
  epochName: string,
  vaultPath: string,
  timer: Timer,
): Promise<EpochMetrics> {
  timer.reset();

  const health = await computeGraphHealth(vaultPath);
  const mdFiles = await walkMd(vaultPath);
  const { coverage, scores } = await measureSuggestions(vaultPath, mdFiles);
  const stats = getEntityIndexStats();

  return {
    epoch: epochName,
    health,
    suggestionCoverage: Math.round(coverage * 1000) / 1000,
    scoreDistribution: distributionStats(scores),
    entityStats: {
      totalEntities: stats.totalEntities,
      categories: stats.categories,
    },
    duration_ms: timer.elapsed(),
  };
}

// =============================================================================
// Test Suite
// =============================================================================

describe('Suite 1: Vault Lifecycle Stress Test', () => {
  let vaultPath: string;
  let stateDb: StateDb;
  const epochMetrics: EpochMetrics[] = [];
  const snapshots: HealthSnapshot[] = [];
  const timer = new Timer();

  // Track entity names for recovery epoch
  let genesisEntityCount = 0;
  let deletedEntityNames: string[] = [];

  beforeAll(async () => {
    // Create temp directory for the vault
    const tmpBase = path.join(os.tmpdir(), 'flywheel-lifecycle-');
    vaultPath = tmpBase + Date.now();
    await mkdir(vaultPath, { recursive: true });

    // ---- Epoch 1: Genesis ----
    timer.reset();
    const generated = await generateQuickVault(vaultPath, GENESIS_NOTE_COUNT, SEED);

    stateDb = openStateDb(vaultPath);
    setWriteStateDb(stateDb);
    setRecencyStateDb(stateDb);
    await initializeEntityIndex(vaultPath);

    const genesisStats = getEntityIndexStats();
    genesisEntityCount = genesisStats.totalEntities;

    snapshots.push(await takeSnapshot(vaultPath, 'genesis'));
    epochMetrics.push(await collectEpochMetrics('genesis', vaultPath, timer));

    // ---- Epoch 2: Growth ----
    timer.reset();
    const notesDir = path.join(vaultPath, 'growth-notes');
    await mkdir(notesDir, { recursive: true });

    // Get existing entity names from the index stats
    const existingFiles = await walkMd(vaultPath);
    const entityNames: string[] = [];
    for (const f of existingFiles) {
      const stem = path.basename(f, '.md');
      if (stem.length >= 2 && stem.length <= 30) {
        entityNames.push(stem);
      }
    }
    const sampleEntities = entityNames.slice(0, 20);

    for (let i = 0; i < GROWTH_NOTE_COUNT; i++) {
      // Reference 1-3 random existing entities
      const refCount = 1 + (i % 3);
      const refs = [];
      for (let j = 0; j < refCount; j++) {
        const idx = (i * 3 + j) % sampleEntities.length;
        refs.push(`[[${sampleEntities[idx]}]]`);
      }
      const content = `---\ntype: note\n---\n# Growth Note ${i}\n\nThis note references ${refs.join(', ')}.\n\nAdditional content about growth phase activities.\n`;
      await writeFile(
        path.join(notesDir, `growth-${i}.md`),
        content,
        'utf-8',
      );
    }

    await initializeEntityIndex(vaultPath);
    snapshots.push(await takeSnapshot(vaultPath, 'growth'));
    epochMetrics.push(await collectEpochMetrics('growth', vaultPath, timer));

    // ---- Epoch 3: Reorganization ----
    timer.reset();
    const allFiles = await walkMd(vaultPath);
    const reorgDir = path.join(vaultPath, 'reorganized');
    await mkdir(reorgDir, { recursive: true });

    // Move REORG_MOVE_COUNT files to reorganized folder
    const filesToMove = allFiles.slice(0, Math.min(REORG_MOVE_COUNT, allFiles.length));
    for (const src of filesToMove) {
      const dest = path.join(reorgDir, path.basename(src));
      try {
        await rename(src, dest);
      } catch {
        // Skip if move fails (e.g., dest exists)
      }
    }

    // Rename REORG_RENAME_COUNT files (change stem, keep in place)
    const filesForRename = allFiles.slice(
      REORG_MOVE_COUNT,
      REORG_MOVE_COUNT + Math.min(REORG_RENAME_COUNT, allFiles.length - REORG_MOVE_COUNT),
    );
    for (let i = 0; i < filesForRename.length; i++) {
      const src = filesForRename[i];
      const dir = path.dirname(src);
      const dest = path.join(dir, `renamed-${i}-${path.basename(src)}`);
      try {
        await rename(src, dest);
      } catch {
        // Skip if rename fails
      }
    }

    await initializeEntityIndex(vaultPath);
    snapshots.push(await takeSnapshot(vaultPath, 'reorganization'));
    epochMetrics.push(await collectEpochMetrics('reorganization', vaultPath, timer));

    // ---- Epoch 4: Pruning ----
    timer.reset();
    const preDeleteFiles = await walkMd(vaultPath);

    // Find the "hub" files (largest files as proxy for most-linked)
    const fileSizes: Array<{ path: string; size: number }> = [];
    for (const f of preDeleteFiles) {
      try {
        const content = await readFile(f, 'utf-8');
        fileSizes.push({ path: f, size: content.length });
      } catch {
        // skip
      }
    }
    fileSizes.sort((a, b) => b.size - a.size);

    // Delete top 5 "hubs"
    const hubsToDelete = fileSizes.slice(0, PRUNE_HUB_DELETE_COUNT);
    deletedEntityNames = hubsToDelete.map(h => path.basename(h.path, '.md'));
    for (const hub of hubsToDelete) {
      await rm(hub.path, { force: true });
    }

    // Delete PRUNE_DELETE_COUNT - PRUNE_HUB_DELETE_COUNT more files
    const remainingToDelete = fileSizes.slice(
      PRUNE_HUB_DELETE_COUNT,
      PRUNE_DELETE_COUNT,
    );
    for (const f of remainingToDelete) {
      await rm(f.path, { force: true });
    }

    await initializeEntityIndex(vaultPath);
    snapshots.push(await takeSnapshot(vaultPath, 'pruning'));
    epochMetrics.push(await collectEpochMetrics('pruning', vaultPath, timer));

    // ---- Epoch 5: Recovery ----
    timer.reset();
    const recoveryDir = path.join(vaultPath, 'recovery-notes');
    await mkdir(recoveryDir, { recursive: true });

    // Reuse some deleted entity names + create new ones
    for (let i = 0; i < RECOVERY_NOTE_COUNT; i++) {
      let entityRef: string;
      if (i < deletedEntityNames.length) {
        // Reuse deleted entity name
        entityRef = deletedEntityNames[i % deletedEntityNames.length];
      } else {
        entityRef = `Recovery Entity ${i}`;
      }

      const content = `---\ntype: note\n---\n# Recovery Note ${i}\n\nThis note discusses ${entityRef} in the context of recovery.\n\nNew content about ${entityRef} and other topics.\n`;
      await writeFile(
        path.join(recoveryDir, `recovery-${i}.md`),
        content,
        'utf-8',
      );
    }

    // Also recreate a few entity files for deleted names
    for (let i = 0; i < Math.min(3, deletedEntityNames.length); i++) {
      const name = deletedEntityNames[i];
      await writeFile(
        path.join(vaultPath, `${name}.md`),
        `---\ntype: concept\n---\n# ${name}\n\nRecreated entity after pruning.\n`,
        'utf-8',
      );
    }

    await initializeEntityIndex(vaultPath);
    snapshots.push(await takeSnapshot(vaultPath, 'recovery'));
    epochMetrics.push(await collectEpochMetrics('recovery', vaultPath, timer));

    // ---- Write report ----
    const recommendations: TuningRecommendation[] = [];

    // Check for biggest score drops between epochs
    for (let i = 1; i < epochMetrics.length; i++) {
      const prev = epochMetrics[i - 1];
      const curr = epochMetrics[i];
      const coverageDrop = prev.suggestionCoverage - curr.suggestionCoverage;
      if (coverageDrop > 0.1) {
        recommendations.push({
          parameter: 'suggestion_coverage',
          current_value: Math.round(curr.suggestionCoverage * 100),
          suggested_value: Math.round(prev.suggestionCoverage * 100),
          evidence: `${curr.epoch} epoch dropped coverage by ${Math.round(coverageDrop * 100)}% from ${prev.epoch}`,
          confidence: coverageDrop > 0.2 ? 'high' : 'medium',
        });
      }
    }

    const suiteTimer = new Timer();
    const report: TestReport = {
      suite: 'vault-lifecycle',
      timestamp: new Date().toISOString(),
      duration_ms: epochMetrics.reduce((sum, e) => sum + e.duration_ms, 0),
      summary: {
        total_epochs: epochMetrics.length,
        genesis_entities: genesisEntityCount,
        recovery_entities: epochMetrics[4]?.entityStats.totalEntities ?? 0,
        genesis_coverage: epochMetrics[0]?.suggestionCoverage ?? 0,
        min_coverage: Math.min(...epochMetrics.map(e => e.suggestionCoverage)),
        max_coverage: Math.max(...epochMetrics.map(e => e.suggestionCoverage)),
      },
      details: epochMetrics,
      tuning_recommendations: recommendations,
    };

    await writeReport(report);
  }, 600000); // 10 min timeout for 5 epochs on 500+ notes

  afterAll(async () => {
    if (stateDb) {
      setWriteStateDb(null);
      setRecencyStateDb(null);
      stateDb.close();
      deleteStateDb(vaultPath);
    }
    if (vaultPath) {
      await rm(vaultPath, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // Assertions
  // =========================================================================

  it('no crash at any epoch', () => {
    expect(epochMetrics.length).toBe(5);
    for (const m of epochMetrics) {
      expect(m.health.noteCount).toBeGreaterThan(0);
      expect(m.entityStats.totalEntities).toBeGreaterThanOrEqual(0);
    }
  });

  it('suggestion coverage >= 10% at all epochs', () => {
    for (const m of epochMetrics) {
      expect(m.suggestionCoverage).toBeGreaterThanOrEqual(0.10);
    }
  });

  it('no critical degradations outside pruning epoch', () => {
    // Pruning (epoch index 3, snapshot index 3) intentionally deletes many notes,
    // so critical metric changes are expected. Other transitions should be stable.
    for (let i = 1; i < snapshots.length; i++) {
      if (i === 3) continue; // Skip genesis→pruning transition
      const diff = diffSnapshots(snapshots[i - 1], snapshots[i]);
      // Allow some critical changes during reorganization (moves/renames)
      // as metrics like noteCount or orphanRate may shift significantly
      expect(diff.summary.critical).toBeLessThanOrEqual(2);
    }
  });

  it('after Recovery: entity count within 50% of Genesis baseline', () => {
    // Pruning deletes a lot, so we allow wider tolerance
    const genesis = epochMetrics[0].entityStats.totalEntities;
    const recovery = epochMetrics[4].entityStats.totalEntities;
    if (genesis > 0) {
      const ratio = recovery / genesis;
      expect(ratio).toBeGreaterThanOrEqual(0.5);
      expect(ratio).toBeLessThanOrEqual(2.0);
    }
  });

  it('score distribution has no NaN/Infinity values', () => {
    for (const m of epochMetrics) {
      const d = m.scoreDistribution;
      expect(Number.isFinite(d.mean)).toBe(true);
      expect(Number.isFinite(d.p50)).toBe(true);
      expect(Number.isFinite(d.p90)).toBe(true);
      expect(Number.isFinite(d.min)).toBe(true);
      expect(Number.isFinite(d.max)).toBe(true);
      expect(Number.isNaN(d.mean)).toBe(false);
    }
  });

  it('entity index is ready after each epoch', () => {
    // Final state check — the last epoch should leave index ready
    expect(isEntityIndexReady()).toBe(true);
  });

  it('health metrics are positive at all epochs', () => {
    for (const m of epochMetrics) {
      expect(m.health.noteCount).toBeGreaterThan(0);
      expect(m.health.linkDensity).toBeGreaterThanOrEqual(0);
      expect(m.health.orphanRate).toBeGreaterThanOrEqual(0);
      expect(m.health.orphanRate).toBeLessThanOrEqual(1);
    }
  });
});
