/**
 * Embeddings auto-build retry seam test (arch-review S10, council residual b).
 *
 * NOTE: the real embedding model cannot run in this sandbox — per the council
 * agreement this SEAM TEST is the substitute: runEmbeddingsAutoBuild's
 * collaborators are injected via EmbeddingsAutoBuildDeps and faked, and the
 * test pins the retry orchestration that previously lived inline in
 * index.ts runPostIndexWork:
 *
 *   - builder fails on attempt 1 → 10s backoff → attempt 2 succeeds;
 *   - the THREE mid-build activateVault re-activation calls (attempt start,
 *     before buildEntityEmbeddingsIndex, before loadEntityEmbeddingsToMemory)
 *     plus the finally-block cleanup re-activation per attempt frame;
 *   - embeddingsBuilding flag raised per attempt and lowered in finally;
 *   - the FLYWHEEL_SKIP_EMBEDDINGS guard short-circuits everything.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  runEmbeddingsAutoBuild,
  type EmbeddingsAutoBuildDeps,
} from '../../src/boot/postIndex.js';
import type { VaultContext } from '../../src/vault-registry.js';
import type { StateDb } from '@velvetmonkey/vault-core';

type DepsOverrides = Partial<Record<keyof EmbeddingsAutoBuildDeps, unknown>>;

function makeCtx(): VaultContext {
  return { name: 'alpha', embeddingsBuilding: false } as unknown as VaultContext;
}

const FAKE_ENTITIES = [
  { name: 'Ada', path: 'People/Ada.md', category: 'person', aliases: ['Lovelace'] },
];

/** Build a fully-faked deps object that records call order into `events`. */
function makeDeps(events: string[], overrides: DepsOverrides = {}): EmbeddingsAutoBuildDeps {
  const deps = {
    hasEmbeddingsIndex: vi.fn(() => false),
    getStoredEmbeddingModel: vi.fn(() => null),
    getStoredTextVersion: vi.fn(() => null),
    getActiveModelId: vi.fn(() => 'fake-model'),
    embeddingTextVersion: 2,
    clearEmbeddingsForRebuild: vi.fn(() => { events.push('clear'); }),
    loadEntityEmbeddingsToMemory: vi.fn(() => { events.push('loadEntityEmbeddings'); }),
    buildEmbeddingsIndex: vi.fn(async () => {
      events.push('build');
      return { total: 1, current: 1, skipped: 0 };
    }),
    buildEntityEmbeddingsIndex: vi.fn(async () => {
      events.push('buildEntities');
      return 1;
    }),
    setEmbeddingsBuilding: vi.fn((value: boolean) => { events.push(`building:${value}`); }),
    setEmbeddingsBuildState: vi.fn((state: string) => { events.push(`state:${state}`); }),
    getAllEntitiesFromDb: vi.fn(() => FAKE_ENTITIES),
    classifyUncategorizedEntities: vi.fn(() => new Map()),
    saveInferredCategories: vi.fn(() => { events.push('saveInferred'); }),
    activateVault: vi.fn(() => { events.push('activate'); }),
    serverLog: vi.fn(),
    ...overrides,
  };
  return deps as unknown as EmbeddingsAutoBuildDeps;
}

describe('embeddings auto-build retry orchestration (S10 seam)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('FLYWHEEL_SKIP_EMBEDDINGS', 'false');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries after a failed build: attempt 1 → 10s backoff → attempt 2, with re-activation sequencing', async () => {
    const events: string[] = [];
    let buildCalls = 0;
    const buildEmbeddingsIndex = vi.fn(async () => {
      buildCalls++;
      events.push(`build#${buildCalls}`);
      if (buildCalls === 1) throw new Error('model load boom');
      return { total: 1, current: 1, skipped: 0 };
    });
    const deps = makeDeps(events, { buildEmbeddingsIndex });
    const ctx = makeCtx();
    const sd = {} as unknown as StateDb;

    runEmbeddingsAutoBuild(ctx, '/tmp/vault', sd, deps);

    // Attempt 1 starts synchronously: re-activate + raise building flag.
    expect(events.slice(0, 2)).toEqual(['activate', 'building:true']);
    expect(ctx.embeddingsBuilding).toBe(true);

    // Flush microtasks: attempt 1's build rejects, retry backoff scheduled.
    await vi.advanceTimersByTimeAsync(0);
    expect(buildCalls).toBe(1);
    expect(deps.serverLog).toHaveBeenCalledWith(
      'semantic',
      expect.stringContaining('Build failed (attempt 1/2)'),
      'error',
    );
    expect(deps.serverLog).toHaveBeenCalledWith(
      'semantic',
      expect.stringContaining('Retrying in 10s'),
      'error',
    );

    // The retry must NOT fire before the full 10s backoff has elapsed.
    await vi.advanceTimersByTimeAsync(9_999);
    expect(buildCalls).toBe(1);

    // Cross the 10s boundary → attempt 2 runs to completion.
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(buildCalls).toBe(2);

    // Full pinned sequence. Attempt 2's success path carries the THREE
    // mid-build activateVault re-activations (attempt start, before entity
    // embeddings, before loadEntityEmbeddingsToMemory). Production quirk
    // pinned deliberately: attempt 1's finally-block cleanup runs as soon as
    // the recursive `return attemptBuild(2)` suspends at its first await —
    // i.e. it INTERLEAVES right after build#2 starts (briefly lowering the
    // building flag mid-attempt-2), not after the retry resolves. This is
    // the verbatim behaviour the block had inline in index.ts.
    expect(events).toEqual([
      // attempt 1
      'activate', 'building:true', 'build#1',
      // (10s backoff) attempt 2
      'activate', 'building:true', 'build#2',
      // finally of attempt 1's frame (interleaved — see comment above)
      'activate', 'building:false',
      'activate', 'buildEntities',
      'activate', 'loadEntityEmbeddings',
      'saveInferred',
      'state:complete',
      // finally of attempt 2's frame
      'activate', 'building:false',
    ]);

    expect(ctx.embeddingsBuilding).toBe(false);
    expect(deps.setEmbeddingsBuildState).toHaveBeenCalledWith('complete');
    expect(deps.buildEmbeddingsIndex).toHaveBeenCalledTimes(2);
    // Every build call targets the vault path it was launched for.
    expect(buildEmbeddingsIndex.mock.calls.every(c => (c as unknown[])[0] === '/tmp/vault')).toBe(true);
  });

  it('gives up after MAX_BUILD_RETRIES (2) and never reports completion', async () => {
    const events: string[] = [];
    const buildEmbeddingsIndex = vi.fn(async () => {
      events.push('build');
      throw new Error('persistent failure');
    });
    const deps = makeDeps(events, { buildEmbeddingsIndex });
    const ctx = makeCtx();

    runEmbeddingsAutoBuild(ctx, '/tmp/vault', null, deps);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(0);
    // No third attempt no matter how long we wait.
    await vi.advanceTimersByTimeAsync(60_000);

    expect(deps.buildEmbeddingsIndex).toHaveBeenCalledTimes(2);
    expect(deps.setEmbeddingsBuildState).not.toHaveBeenCalledWith('complete');
    expect(deps.serverLog).toHaveBeenCalledWith(
      'semantic',
      expect.stringContaining('Embeddings build failed after 2 attempts'),
      'error',
    );
    expect(deps.serverLog).toHaveBeenCalledWith(
      'semantic',
      'Keyword search (BM25) remains fully available',
      'error',
    );
    expect(ctx.embeddingsBuilding).toBe(false);
    // Cleanup re-activation ran in each attempt's finally.
    expect(events.filter(e => e === 'building:false')).toHaveLength(2);
  });

  it('FLYWHEEL_SKIP_EMBEDDINGS=true short-circuits: no collaborator is touched', () => {
    vi.stubEnv('FLYWHEEL_SKIP_EMBEDDINGS', 'true');
    const events: string[] = [];
    const deps = makeDeps(events);
    const ctx = makeCtx();

    runEmbeddingsAutoBuild(ctx, '/tmp/vault', null, deps);

    expect(events).toEqual([]);
    expect(deps.hasEmbeddingsIndex).not.toHaveBeenCalled();
    expect(deps.buildEmbeddingsIndex).not.toHaveBeenCalled();
    expect(deps.activateVault).not.toHaveBeenCalled();
    expect(deps.serverLog).toHaveBeenCalledWith('semantic', 'Skipping — FLYWHEEL_SKIP_EMBEDDINGS');
  });

  it('up-to-date fast path loads entity embeddings without any build attempt', async () => {
    const events: string[] = [];
    const deps = makeDeps(events, {
      hasEmbeddingsIndex: vi.fn(() => true),
      getStoredEmbeddingModel: vi.fn(() => 'fake-model'),
      getStoredTextVersion: vi.fn(() => 2),
    });
    const ctx = makeCtx();
    const sd = {} as unknown as StateDb;

    runEmbeddingsAutoBuild(ctx, '/tmp/vault', sd, deps);
    await vi.advanceTimersByTimeAsync(0);

    expect(deps.buildEmbeddingsIndex).not.toHaveBeenCalled();
    expect(deps.activateVault).not.toHaveBeenCalled();
    expect(events).toEqual(['loadEntityEmbeddings', 'saveInferred']);
    expect(deps.serverLog).toHaveBeenCalledWith('semantic', 'Embeddings up-to-date, skipping build');
  });
});
