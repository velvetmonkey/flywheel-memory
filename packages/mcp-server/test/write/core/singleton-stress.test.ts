/**
 * Singleton Stress Tests — Concurrent multi-vault StateDb isolation
 *
 * Verifies that concurrent multi-vault operations see their own StateDb
 * via scope-aware getters, proving no cross-vault data bleed.
 *
 * Strategy: Set the module-level fallback to vault A, then run a request
 * in scope B and verify the scope-aware getter returns B's StateDb, not A's.
 * Interleave with await barriers to guarantee concurrent execution.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { openStateDb, deleteStateDb, type StateDb } from '@velvetmonkey/vault-core';
import {
  runInVaultScope,
  setFallbackScope,
  type VaultScope,
} from '../../../src/vault-scope.js';
import { getWriteStateDb, setWriteStateDb } from '../../../src/core/write/wikilinks.js';
import { setFTS5Database, getFTS5State } from '../../../src/core/read/fts5.js';
import { setTaskCacheDatabase, isTaskCacheReady } from '../../../src/core/read/taskCache.js';
import { setRecencyStateDb } from '../../../src/core/shared/recency.js';
import { createEmptyPipelineActivity } from '../../../src/core/read/watch/pipeline.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp vault directory and open a StateDb in it. */
async function createTempVault(label: string): Promise<{ vaultPath: string; stateDb: StateDb }> {
  const vaultPath = await mkdtemp(path.join(tmpdir(), `flywheel-stress-${label}-`));
  const stateDb = openStateDb(vaultPath);
  return { vaultPath, stateDb };
}

/** Build a VaultScope backed by a real StateDb. */
function makeScope(name: string, stateDb: StateDb): VaultScope {
  return {
    name,
    vaultPath: stateDb.vaultPath,
    stateDb,
    flywheelConfig: {},
    vaultIndex: { notes: new Map(), entities: new Map() } as any,
    cooccurrenceIndex: null,
    indexState: 'ready' as const,
    indexError: null,
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

// ---------------------------------------------------------------------------
// Shared state for all tests in this suite
// ---------------------------------------------------------------------------

let vaultA: { vaultPath: string; stateDb: StateDb };
let vaultB: { vaultPath: string; stateDb: StateDb };
let scopeA: VaultScope;
let scopeB: VaultScope;

// Use a top-level beforeAll via describe-level setup
// (vitest runs describe callbacks synchronously, but we need async setup)

describe('singleton stress — concurrent multi-vault StateDb isolation', async () => {
  // Async describe body: vitest supports top-level await in describe

  vaultA = await createTempVault('a');
  vaultB = await createTempVault('b');
  scopeA = makeScope('vault-a', vaultA.stateDb);
  scopeB = makeScope('vault-b', vaultB.stateDb);

  afterAll(async () => {
    try { vaultA.stateDb.db.close(); } catch { /* ignore */ }
    try { vaultB.stateDb.db.close(); } catch { /* ignore */ }
    await rm(vaultA.vaultPath, { recursive: true, force: true });
    await rm(vaultB.vaultPath, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Test 1: getWriteStateDb() returns the correct DB per vault
  // -------------------------------------------------------------------------

  it('concurrent getWriteStateDb() returns correct DB per vault', async () => {
    // Set fallback (module-level) to vault A
    setWriteStateDb(vaultA.stateDb);

    // Confirm fallback works outside ALS
    expect(getWriteStateDb()).toBe(vaultA.stateDb);

    let resolveBarrierA!: () => void;
    const barrierA = new Promise<void>(r => { resolveBarrierA = r; });
    let resolveBarrierB!: () => void;
    const barrierB = new Promise<void>(r => { resolveBarrierB = r; });

    // Handler A: runs in scope A, waits at barrier, then checks
    const handlerA = runInVaultScope(scopeA, async () => {
      const before = getWriteStateDb();
      // Signal B that A has started
      resolveBarrierB();
      // Wait for B to be running concurrently
      await barrierA;
      const after = getWriteStateDb();
      return { before, after };
    });

    // Handler B: runs in scope B while A is suspended
    const handlerB = runInVaultScope(scopeB, async () => {
      // Wait for A to be running
      await barrierB;
      const observed = getWriteStateDb();
      // Unblock A
      resolveBarrierA();
      return observed;
    });

    const [resultA, resultB] = await Promise.all([handlerA, handlerB]);

    // A should always see vault A's StateDb — both before and after the await
    expect(resultA.before).toBe(vaultA.stateDb);
    expect(resultA.after).toBe(vaultA.stateDb);

    // B should see vault B's StateDb, NOT the fallback (vault A)
    expect(resultB).toBe(vaultB.stateDb);
  });

  // -------------------------------------------------------------------------
  // Test 2: FTS5 state is isolated between concurrent vaults
  // -------------------------------------------------------------------------

  it('concurrent FTS5 state is isolated', async () => {
    // Set fallback FTS5 to vault A
    setFTS5Database(vaultA.stateDb.db);

    // Seed vault A with some notes in notes_fts
    vaultA.stateDb.db.prepare(
      'INSERT OR REPLACE INTO notes_fts (path, title, frontmatter, content) VALUES (?, ?, ?, ?)'
    ).run('note1.md', 'Note One', '', 'Content of note one');
    vaultA.stateDb.db.prepare(
      'INSERT OR REPLACE INTO notes_fts (path, title, frontmatter, content) VALUES (?, ?, ?, ?)'
    ).run('note2.md', 'Note Two', '', 'Content of note two');
    vaultA.stateDb.db.prepare(
      'INSERT OR REPLACE INTO notes_fts (path, title, frontmatter, content) VALUES (?, ?, ?, ?)'
    ).run('note3.md', 'Note Three', '', 'Content of note three');

    // Vault B has no notes in FTS (empty by default from openStateDb)

    let resolveBarrierA!: () => void;
    const barrierA = new Promise<void>(r => { resolveBarrierA = r; });
    let resolveBarrierB!: () => void;
    const barrierB = new Promise<void>(r => { resolveBarrierB = r; });

    // Handler A: scope A should see 3 notes
    const handlerA = runInVaultScope(scopeA, async () => {
      const stateA = getFTS5State();
      resolveBarrierB();
      await barrierA;
      return stateA;
    });

    // Handler B: scope B should see 0 notes
    const handlerB = runInVaultScope(scopeB, async () => {
      await barrierB;
      const stateB = getFTS5State();
      resolveBarrierA();
      return stateB;
    });

    const [fts5A, fts5B] = await Promise.all([handlerA, handlerB]);

    // Vault A has 3 notes
    expect(fts5A.noteCount).toBe(3);
    expect(fts5A.ready).toBe(true);

    // Vault B has 0 notes — no cross-bleed from vault A
    expect(fts5B.noteCount).toBe(0);
    expect(fts5B.ready).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 3: Task cache readiness is isolated between concurrent vaults
  // -------------------------------------------------------------------------

  it('concurrent task cache readiness is isolated', async () => {
    // Set fallback task cache to vault A
    setTaskCacheDatabase(vaultA.stateDb.db);

    // Mark task cache as built in vault A
    vaultA.stateDb.db.prepare(
      'INSERT OR REPLACE INTO fts_metadata (key, value) VALUES (?, ?)'
    ).run('task_cache_built', new Date().toISOString());

    // Vault B: ensure task_cache_built is NOT set (delete if present from schema init)
    try {
      vaultB.stateDb.db.prepare(
        'DELETE FROM fts_metadata WHERE key = ?'
      ).run('task_cache_built');
    } catch { /* table might not have the row */ }

    let resolveBarrierA!: () => void;
    const barrierA = new Promise<void>(r => { resolveBarrierA = r; });
    let resolveBarrierB!: () => void;
    const barrierB = new Promise<void>(r => { resolveBarrierB = r; });

    // Handler A: scope A should report task cache ready
    const handlerA = runInVaultScope(scopeA, async () => {
      const ready = isTaskCacheReady();
      resolveBarrierB();
      await barrierA;
      return ready;
    });

    // Handler B: scope B should report task cache NOT ready
    const handlerB = runInVaultScope(scopeB, async () => {
      await barrierB;
      const ready = isTaskCacheReady();
      resolveBarrierA();
      return ready;
    });

    const [readyA, readyB] = await Promise.all([handlerA, handlerB]);

    // Vault A has task cache built
    expect(readyA).toBe(true);

    // Vault B does NOT — no cross-bleed from vault A's fallback
    expect(readyB).toBe(false);
  });
});
