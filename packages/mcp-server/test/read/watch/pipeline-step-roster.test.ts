/**
 * Pipeline step-roster pin (D1 fix, sanctioned 2026-06-13).
 *
 * The progress denominator shown by doctor(action: pipeline) was a
 * hand-maintained magic number that had drifted three ways (doc comment
 * said 19, PIPELINE_TOTAL_STEPS said 22, a real maximal batch emits 25).
 * These tests make desync impossible:
 *
 *  1. DYNAMIC: a real full pipeline batch on a fresh vault (no skip
 *     branches → every step appends exactly one tracker entry) must emit
 *     exactly PIPELINE_TOTAL_STEPS distinct steps.
 *  2. STATIC: every step-name literal in the pipeline sources
 *     (runStep/tracker.start/tracker.skip call sites) must equal the
 *     canonical PIPELINE_STEPS roster as a set — so adding/removing a step
 *     without updating the roster fails CI.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  openStateDb,
  deleteStateDb,
  scanVaultEntities,
  type StateDb,
} from '@velvetmonkey/vault-core';
import { createTempVault, cleanupTempVault } from '../../helpers/testUtils.js';
import { buildVaultIndex } from '../../../src/core/read/graph.js';
import { buildFTS5Index, setFTS5Database } from '../../../src/core/read/fts5.js';
import type { VaultIndex } from '../../../src/core/shared/types.js';
import type { VaultContext } from '../../../src/vault-registry.js';
import { setWriteStateDb } from '../../../src/core/write/wikilinks.js';
import { setRecencyStateDb } from '../../../src/core/shared/recency.js';
import { setTaskCacheDatabase } from '../../../src/core/read/taskCache.js';
import { setEmbeddingsDatabase } from '../../../src/core/read/embeddings.js';
import { PipelineRunner, type PipelineContext } from '../../../src/core/write/pipeline/runner.js';
import {
  createEmptyPipelineActivity,
  PIPELINE_STEPS,
  PIPELINE_TOTAL_STEPS,
} from '../../../src/core/write/pipeline/activity.js';

/**
 * Steps that legitimately may not append a tracker entry in a given batch
 * (guarded early-returns). Everything else MUST fire every batch.
 */
const CONDITIONAL_STEPS = new Set(['proactive_enqueue']);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PIPELINE_DIR = path.join(__dirname, '../../../src/core/write/pipeline');

let tempVault: string;
let stateDb: StateDb;
let vaultIndex: VaultIndex;

function makeVaultContext(name = 'roster-test'): VaultContext {
  return {
    name,
    vaultPath: tempVault,
    caseInsensitive: false,
    stateDb,
    vaultIndex,
    flywheelConfig: {},
    watcher: null,
    cooccurrenceIndex: null,
    embeddingsBuilding: false,
    writeEntityIndex: null,
    writeEntityIndexReady: false,
    writeEntityIndexError: null,
    writeEntityIndexLastLoadedAt: 0,
    writeRecencyIndex: null,
    taskCacheBuilding: false,
    entityEmbeddingsMap: new Map(),
    inferredCategoriesMap: new Map(),
    mutedWatcherPaths: new Set(),
    dirtyMutedWatcherPaths: new Set(),
    reconcileMutedWatcherPaths: null,
    deferredScheduler: null,
    lastPurgeAt: 0,
    indexState: 'ready',
    indexError: null,
    lastCooccurrenceRebuildAt: 0,
    lastEdgeWeightRebuildAt: 0,
    lastEntityScanAt: 0,
    lastHubScoreRebuildAt: 0,
    lastIndexCacheSaveAt: 0,
    pipelineActivity: createEmptyPipelineActivity(),
    bootState: 'ready',
    integrityState: 'healthy',
    integrityCheckInProgress: false,
    integrityStartedAt: null,
    integritySource: null,
    lastIntegrityCheckedAt: null,
    lastIntegrityDurationMs: null,
    lastIntegrityDetail: null,
    lastBackupAt: null,
  };
}

describe('pipeline step roster (D1)', () => {
  beforeAll(async () => {
    tempVault = await createTempVault();
    await mkdir(path.join(tempVault, 'people'), { recursive: true });
    await writeFile(path.join(tempVault, 'people', 'Carol.md'),
      '---\ntype: person\n---\n# Carol\n\nCarol runs [[Project Roster]].\n');
    await writeFile(path.join(tempVault, 'Project Roster.md'),
      '---\ntype: project\n---\n# Project Roster\n\nLed by [[Carol]].\n');

    stateDb = openStateDb(tempVault);
    setWriteStateDb(stateDb);
    setFTS5Database(stateDb.db);
    setRecencyStateDb(stateDb);
    setTaskCacheDatabase(stateDb.db);
    setEmbeddingsDatabase(stateDb.db);

    vaultIndex = await buildVaultIndex(tempVault);
    const entityIndex = await scanVaultEntities(tempVault, { excludeFolders: [] });
    stateDb.replaceAllEntities(entityIndex);
    await buildFTS5Index(tempVault);
  }, 30000);

  afterAll(async () => {
    setWriteStateDb(null);
    setRecencyStateDb(null);
    stateDb?.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  it('a real maximal batch emits exactly PIPELINE_TOTAL_STEPS distinct steps', async () => {
    const ctx = makeVaultContext();
    // Fresh context (all last-*At = 0, changes present) → no skip branch
    // fires, so every roster step appends exactly one tracker entry.
    const pctx: PipelineContext = {
      vp: tempVault,
      sd: stateDb,
      ctx,
      events: [{ type: 'upsert', path: 'people/Carol.md', originalEvents: [] }],
      renames: [],
      batch: { events: [{ type: 'upsert', path: 'people/Carol.md', originalEvents: [] }], renames: [], timestamp: Date.now() },
      changedPaths: ['people/Carol.md'],
      flywheelConfig: {},
      updateIndexState: (state, error) => { ctx.indexState = state; if (error !== undefined) ctx.indexError = error ?? null; },
      updateVaultIndex: (idx) => { vaultIndex = idx; ctx.vaultIndex = idx; },
      updateEntitiesInStateDb: async (vp, sd) => {
        if (!sd) return;
        const entityIdx = await scanVaultEntities(vp ?? tempVault, { excludeFolders: [] });
        sd.replaceAllEntities(entityIdx);
      },
      getVaultIndex: () => vaultIndex,
      buildVaultIndex,
    };

    const runner = new PipelineRunner(pctx);
    await runner.run();

    const names = runner.tracker.steps.map(s => s.name);
    const distinct = new Set(names);
    const roster = new Set<string>(PIPELINE_STEPS);

    // Every step fired exactly once (no double-push on this path)
    expect(names.length, `steps emitted: ${names.join(', ')}`).toBe(distinct.size);
    // Every emitted step is on the canonical roster
    for (const name of distinct) {
      expect(roster.has(name), `step "${name}" not in PIPELINE_STEPS roster`).toBe(true);
    }
    // Every roster step fired, except (at most) the documented conditionals
    const missing = PIPELINE_STEPS.filter(name => !distinct.has(name));
    expect(
      missing.every(name => CONDITIONAL_STEPS.has(name)),
      `non-conditional roster steps missing from batch: ${missing.join(', ')}`,
    ).toBe(true);
    expect(distinct.size).toBeGreaterThanOrEqual(PIPELINE_TOTAL_STEPS - CONDITIONAL_STEPS.size);
    expect(distinct.size).toBeLessThanOrEqual(PIPELINE_TOTAL_STEPS);
    // And the activity counter agrees with what was emitted
    expect(ctx.pipelineActivity.completed_steps).toBe(names.length);
  }, 30000);

  it('the roster IS the set of step-name literals in the pipeline sources', async () => {
    const sources = ['runner.ts', 'steps-index.ts', 'steps-linking.ts', 'steps-learning.ts', 'steps-maintenance.ts'];
    const found = new Set<string>();
    const nameRe = /(?:runStep\(|tracker\.start\(|tracker\.skip\()\s*'([a-z0-9_]+)'/g;
    for (const file of sources) {
      const src = await readFile(path.join(PIPELINE_DIR, file), 'utf-8');
      for (const m of src.matchAll(nameRe)) found.add(m[1]);
    }
    // Set equality both ways: a step added to code without the roster, or
    // left on the roster after removal from code, both fail here.
    expect([...found].sort()).toEqual([...PIPELINE_STEPS].sort());
    expect(PIPELINE_TOTAL_STEPS).toBe(PIPELINE_STEPS.length);
  });
});
