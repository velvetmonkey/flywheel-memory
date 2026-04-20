/**
 * Watcher pipeline end-to-end tests for the prospect_scan step.
 *
 * Reuses the PipelineRunner temp-vault pattern to verify that
 * implicit, dead_link, and high_score sightings are persisted
 * from changed files, and that stale rows are cleaned up.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import {
  openStateDb,
  deleteStateDb,
  scanVaultEntities,
  type StateDb,
} from '@velvetmonkey/vault-core';
import { createTempVault, cleanupTempVault } from '../../helpers/testUtils.js';
import { buildVaultIndex } from '../../../src/core/read/graph.js';
import type { VaultIndex } from '../../../src/core/shared/types.js';
import type { VaultContext } from '../../../src/vault-registry.js';
import { setWriteStateDb } from '../../../src/core/write/wikilinks.js';
import { setFTS5Database } from '../../../src/core/read/fts5.js';
import { setRecencyStateDb } from '../../../src/core/shared/recency.js';
import { setTaskCacheDatabase } from '../../../src/core/read/taskCache.js';
import { setEmbeddingsDatabase } from '../../../src/core/read/embeddings.js';
import { setProspectStateDb, resetCleanupCooldown } from '../../../src/core/shared/prospects.js';
import { PipelineRunner, createEmptyPipelineActivity, type PipelineContext } from '../../../src/core/read/watch/pipeline.js';

let tempVault: string;
let stateDb: StateDb;
let vaultIndex: VaultIndex;

function makeVaultContext(): VaultContext {
  return {
    name: 'test',
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
    entityEmbeddingsMap: new Map(),
    inferredCategoriesMap: new Map(),
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

describe('PipelineRunner prospect_scan', () => {
  beforeAll(async () => {
    tempVault = await createTempVault();

    // Create vault with entities and dead-link targets
    await mkdir(path.join(tempVault, 'people'), { recursive: true });
    await mkdir(path.join(tempVault, 'projects'), { recursive: true });

    // Entity notes (these will be known entities)
    await writeFile(
      path.join(tempVault, 'people', 'Alice.md'),
      '---\ntype: person\n---\n# Alice\n\nAlice works on [[Project Alpha]] with [[Bob]].\n',
    );
    await writeFile(
      path.join(tempVault, 'people', 'Bob.md'),
      '---\ntype: person\n---\n# Bob\n\nBob collaborates with [[Alice]].\n',
    );
    await writeFile(
      path.join(tempVault, 'projects', 'Project Alpha.md'),
      '---\ntype: project\n---\n# Project Alpha\n\nA project involving [[Alice]] and [[Bob]].\n',
    );

    // Notes with dead-link references to "Beta Platform" (no note exists for it)
    await writeFile(
      path.join(tempVault, 'notes-a.md'),
      '# Meeting Notes\n\nDiscussed [[Beta Platform]] integration with the team. Marcus Johnson presented the roadmap.\n',
    );
    await writeFile(
      path.join(tempVault, 'notes-b.md'),
      '# Sprint Review\n\nThe [[Beta Platform]] rollout is on track. See [[Beta Platform]] docs.\n',
    );
    await writeFile(
      path.join(tempVault, 'notes-c.md'),
      '# Planning\n\n[[Beta Platform]] needs more testing. The Beta Platform API is unstable.\n',
    );

    // Open StateDb and inject all singletons
    stateDb = openStateDb(tempVault);
    setWriteStateDb(stateDb);
    setFTS5Database(stateDb.db);
    setRecencyStateDb(stateDb);
    setTaskCacheDatabase(stateDb.db);
    setEmbeddingsDatabase(stateDb.db);
    setProspectStateDb(stateDb);
    resetCleanupCooldown();

    // Build vault index
    vaultIndex = await buildVaultIndex(tempVault);

    // Seed entities in StateDb
    const entityIndex = await scanVaultEntities(tempVault, { excludeFolders: [] });
    stateDb.replaceAllEntities(entityIndex);
  }, 30000);

  afterAll(async () => {
    setWriteStateDb(null);
    setRecencyStateDb(null);
    setProspectStateDb(null);
    stateDb?.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  async function runPipeline(changedPaths: string[]) {
    const ctx = makeVaultContext();

    const events = changedPaths.map(p => ({
      type: 'upsert' as const,
      path: p,
      originalEvents: [],
    }));

    const pctx: PipelineContext = {
      vp: tempVault,
      sd: stateDb,
      ctx,
      events,
      renames: [],
      batch: { events, renames: [], timestamp: Date.now() },
      changedPaths,
      flywheelConfig: {},
      updateIndexState: (state, error) => {
        ctx.indexState = state;
        if (error !== undefined) ctx.indexError = error ?? null;
      },
      updateVaultIndex: (idx) => {
        vaultIndex = idx;
        ctx.vaultIndex = idx;
      },
      updateEntitiesInStateDb: async (vp, sd) => {
        if (!sd) return;
        const entityIdx = await scanVaultEntities(vp ?? tempVault, { excludeFolders: [] });
        sd.replaceAllEntities(entityIdx);
      },
      getVaultIndex: () => vaultIndex,
      buildVaultIndex,
    };

    await new PipelineRunner(pctx).run();
  }

  it('prospect_scan creates ledger rows from changed files', async () => {
    // Clear any existing prospect data
    stateDb.db.exec('DELETE FROM prospect_ledger');
    stateDb.db.exec('DELETE FROM prospect_summary');
    resetCleanupCooldown();

    await runPipeline(['notes-a.md', 'notes-b.md', 'notes-c.md']);

    // Should have some prospect ledger entries
    const count = stateDb.db.prepare(
      'SELECT COUNT(*) as cnt FROM prospect_ledger'
    ).get() as { cnt: number };
    expect(count.cnt).toBeGreaterThan(0);
  });

  it('already-linked terms and known entities are not in prospect ledger as implicit', async () => {
    // Alice, Bob, Project Alpha are known entities — should not appear as implicit prospects
    const knownEntityProspects = stateDb.db.prepare(`
      SELECT term FROM prospect_ledger
      WHERE source = 'implicit'
      AND term IN ('alice', 'bob', 'project alpha')
    `).all() as Array<{ term: string }>;
    expect(knownEntityProspects.length).toBe(0);
  });

  it('refreshes summaries for affected terms', async () => {
    const summaryCount = stateDb.db.prepare(
      'SELECT COUNT(*) as cnt FROM prospect_summary'
    ).get() as { cnt: number };
    expect(summaryCount.cnt).toBeGreaterThan(0);
  });

  it('stale prospect rows older than 210 days are cleaned during the run', async () => {
    const now = Date.now();
    const veryOld = now - 220 * 86400000;
    resetCleanupCooldown();

    // Insert a stale row
    stateDb.db.exec(`
      INSERT INTO prospect_ledger VALUES ('stale-term', 'Stale Term', 'old.md', '2025-07-01', 'implicit', NULL, 'low', 0, 0, ${veryOld}, ${veryOld}, 1);
    `);

    // Run pipeline again — should trigger cleanup
    await runPipeline(['notes-a.md']);

    const staleRow = stateDb.db.prepare(
      'SELECT COUNT(*) as cnt FROM prospect_ledger WHERE term = ?'
    ).get('stale-term') as { cnt: number };
    expect(staleRow.cnt).toBe(0);
  });
});
