/**
 * PipelineRunner smoke test — verifies the extracted watcher pipeline
 * runs end-to-end with a real StateDb and small VaultIndex.
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
import { PipelineRunner, createEmptyPipelineActivity, type PipelineContext } from '../../../src/core/read/watch/pipeline.js';

let tempVault: string;
let stateDb: StateDb;
let vaultIndex: VaultIndex;

describe('PipelineRunner', () => {
  beforeAll(async () => {
    tempVault = await createTempVault();

    // Create a small vault with linked notes
    await mkdir(path.join(tempVault, 'people'), { recursive: true });
    await writeFile(path.join(tempVault, 'people', 'Alice.md'),
      '---\ntype: person\n---\n# Alice\n\nAlice works on [[Project Alpha]] with [[Bob]].\n');
    await writeFile(path.join(tempVault, 'people', 'Bob.md'),
      '---\ntype: person\n---\n# Bob\n\nBob collaborates with [[Alice]] on [[Project Alpha]].\n');
    await writeFile(path.join(tempVault, 'Project Alpha.md'),
      '---\ntype: project\nstatus: active\n---\n# Project Alpha\n\nA project involving [[Alice]] and [[Bob]].\n');

    // Open StateDb and inject singletons
    stateDb = openStateDb(tempVault);
    setWriteStateDb(stateDb);
    setFTS5Database(stateDb.db);
    setRecencyStateDb(stateDb);
    setTaskCacheDatabase(stateDb.db);
    setEmbeddingsDatabase(stateDb.db);

    // Build vault index
    vaultIndex = await buildVaultIndex(tempVault);

    // Seed entities in StateDb
    const entityIndex = await scanVaultEntities(tempVault, { excludeFolders: [] });
    stateDb.replaceAllEntities(entityIndex);
  }, 30000);

  afterAll(async () => {
    setWriteStateDb(null);
    setRecencyStateDb(null);
    stateDb?.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  it('runs the full pipeline on a file change without crashing', async () => {
    // Simulate modifying Alice.md
    const ctx: VaultContext = {
      name: 'test',
      vaultPath: tempVault,
      stateDb,
      vaultIndex,
      flywheelConfig: {},
      watcher: null,
      cooccurrenceIndex: null,
      embeddingsBuilding: false,
      indexState: 'ready',
      indexError: null,
      lastCooccurrenceRebuildAt: 0,
      lastEdgeWeightRebuildAt: 0,
      lastEntityScanAt: 0,
      lastHubScoreRebuildAt: 0,
      lastIndexCacheSaveAt: 0,
      pipelineActivity: createEmptyPipelineActivity(),
    };

    const pctx: PipelineContext = {
      vp: tempVault,
      sd: stateDb,
      ctx,
      events: [{ type: 'upsert', path: 'people/Alice.md', originalEvents: [] }],
      renames: [],
      batch: { events: [{ type: 'upsert', path: 'people/Alice.md', originalEvents: [] }], renames: [], timestamp: Date.now() },
      changedPaths: ['people/Alice.md'],
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

    // Should complete without throwing
    await expect(new PipelineRunner(pctx).run()).resolves.not.toThrow();

    // Index event should have been recorded
    const events = stateDb.db.prepare(
      "SELECT * FROM index_events WHERE trigger = 'watcher' ORDER BY id DESC LIMIT 1"
    ).get() as { trigger: string; success: number; steps: string } | undefined;

    expect(events).toBeDefined();
    expect(events!.trigger).toBe('watcher');
    expect(events!.success).toBe(1);

    // Steps should be recorded
    const steps = JSON.parse(events!.steps ?? '[]');
    expect(steps.length).toBeGreaterThanOrEqual(5);

    // Verify key steps ran
    const stepNames = steps.map((s: { name: string }) => s.name);
    expect(stepNames).toContain('index_rebuild');
    expect(stepNames).toContain('entity_scan');
    expect(stepNames).toContain('task_cache');
  }, 30000);

  it('handles delete events gracefully', async () => {
    const ctx: VaultContext = {
      name: 'test',
      vaultPath: tempVault,
      stateDb,
      vaultIndex,
      flywheelConfig: {},
      watcher: null,
      cooccurrenceIndex: null,
      embeddingsBuilding: false,
      indexState: 'ready',
      indexError: null,
      lastCooccurrenceRebuildAt: 0,
      lastEdgeWeightRebuildAt: 0,
      lastEntityScanAt: 0,
      lastHubScoreRebuildAt: 0,
      lastIndexCacheSaveAt: 0,
      pipelineActivity: createEmptyPipelineActivity(),
    };

    const pctx: PipelineContext = {
      vp: tempVault,
      sd: stateDb,
      ctx,
      events: [{ type: 'delete', path: 'nonexistent.md', originalEvents: [] }],
      renames: [],
      batch: { events: [{ type: 'delete', path: 'nonexistent.md', originalEvents: [] }], renames: [], timestamp: Date.now() },
      changedPaths: ['nonexistent.md'],
      flywheelConfig: {},
      updateIndexState: (state) => { ctx.indexState = state; },
      updateVaultIndex: (idx) => { vaultIndex = idx; ctx.vaultIndex = idx; },
      updateEntitiesInStateDb: async () => {},
      getVaultIndex: () => vaultIndex,
      buildVaultIndex,
    };

    await expect(new PipelineRunner(pctx).run()).resolves.not.toThrow();
  }, 30000);

  it('records rename events in step output', async () => {
    const ctx: VaultContext = {
      name: 'test',
      vaultPath: tempVault,
      stateDb,
      vaultIndex,
      flywheelConfig: {},
      watcher: null,
      cooccurrenceIndex: null,
      embeddingsBuilding: false,
      indexState: 'ready',
      indexError: null,
      lastCooccurrenceRebuildAt: 0,
      lastEdgeWeightRebuildAt: 0,
      lastEntityScanAt: 0,
      lastHubScoreRebuildAt: 0,
      lastIndexCacheSaveAt: 0,
      pipelineActivity: createEmptyPipelineActivity(),
    };

    const pctx: PipelineContext = {
      vp: tempVault,
      sd: stateDb,
      ctx,
      events: [{ type: 'upsert', path: 'people/Bob.md', originalEvents: [] }],
      renames: [{ oldPath: 'people/Robert.md', newPath: 'people/Bob.md', timestamp: Date.now() }],
      batch: { events: [{ type: 'upsert', path: 'people/Bob.md', originalEvents: [] }], renames: [], timestamp: Date.now() },
      changedPaths: ['people/Bob.md'],
      flywheelConfig: {},
      updateIndexState: (state) => { ctx.indexState = state; },
      updateVaultIndex: (idx) => { vaultIndex = idx; ctx.vaultIndex = idx; },
      updateEntitiesInStateDb: async (vp, sd) => {
        if (!sd) return;
        const entityIdx = await scanVaultEntities(vp ?? tempVault, { excludeFolders: [] });
        sd.replaceAllEntities(entityIdx);
      },
      getVaultIndex: () => vaultIndex,
      buildVaultIndex,
    };

    await expect(new PipelineRunner(pctx).run()).resolves.not.toThrow();

    // Check that note_moves step was recorded
    const events = stateDb.db.prepare(
      "SELECT steps FROM index_events WHERE trigger = 'watcher' ORDER BY id DESC LIMIT 1"
    ).get() as { steps: string } | undefined;
    const steps = JSON.parse(events?.steps ?? '[]');
    const moveStep = steps.find((s: { name: string }) => s.name === 'note_moves');
    expect(moveStep).toBeDefined();
    expect(moveStep.output.renames).toHaveLength(1);
  }, 30000);

  it('records note_embeddings and entity_embeddings via runStep', async () => {
    const ctx: VaultContext = {
      name: 'test',
      vaultPath: tempVault,
      stateDb,
      vaultIndex,
      flywheelConfig: {},
      watcher: null,
      cooccurrenceIndex: null,
      embeddingsBuilding: false,
      indexState: 'ready',
      indexError: null,
      lastCooccurrenceRebuildAt: 0,
      lastEdgeWeightRebuildAt: 0,
      lastEntityScanAt: 0,
      lastHubScoreRebuildAt: 0,
      lastIndexCacheSaveAt: 0,
      pipelineActivity: createEmptyPipelineActivity(),
    };

    const pctx: PipelineContext = {
      vp: tempVault,
      sd: stateDb,
      ctx,
      events: [{ type: 'upsert', path: 'people/Alice.md', originalEvents: [] }],
      renames: [],
      batch: { events: [{ type: 'upsert', path: 'people/Alice.md', originalEvents: [] }], renames: [], timestamp: Date.now() },
      changedPaths: ['people/Alice.md'],
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

    await new PipelineRunner(pctx).run();

    const event = stateDb.db.prepare(
      "SELECT steps FROM index_events WHERE trigger = 'watcher' ORDER BY id DESC LIMIT 1"
    ).get() as { steps: string } | undefined;

    expect(event).toBeDefined();
    const steps = JSON.parse(event!.steps ?? '[]');
    const stepNames = steps.map((s: { name: string }) => s.name);

    // Both embedding steps should be recorded (as done or skipped)
    expect(stepNames).toContain('note_embeddings');
    expect(stepNames).toContain('entity_embeddings');

    // Verify the embedding steps have proper output structure
    const noteEmbStep = steps.find((s: { name: string }) => s.name === 'note_embeddings');
    expect(noteEmbStep).toBeDefined();
    // Should be skipped (no embeddings index in test) or done with output
    if (noteEmbStep.skipped) {
      expect(noteEmbStep.skip_reason).toBeTruthy();
    } else {
      expect(noteEmbStep.output).toHaveProperty('updated');
      expect(noteEmbStep.output).toHaveProperty('removed');
    }

    const entEmbStep = steps.find((s: { name: string }) => s.name === 'entity_embeddings');
    expect(entEmbStep).toBeDefined();
    if (entEmbStep.skipped) {
      expect(entEmbStep.skip_reason).toBeTruthy();
    } else {
      expect(entEmbStep.output).toHaveProperty('updated');
    }

    // Pipeline should have completed successfully — steps after embeddings should exist
    const embIdx = stepNames.indexOf('note_embeddings');
    expect(stepNames.length).toBeGreaterThan(embIdx + 2); // more steps after embeddings
  }, 30000);

  it('tracks pipeline activity per vault context', async () => {
    const ctxA: VaultContext = {
      name: 'vault-a',
      vaultPath: tempVault,
      stateDb,
      vaultIndex,
      flywheelConfig: {},
      watcher: null,
      cooccurrenceIndex: null,
      embeddingsBuilding: false,
      indexState: 'ready',
      indexError: null,
      lastCooccurrenceRebuildAt: 0,
      lastEdgeWeightRebuildAt: 0,
      lastEntityScanAt: 0,
      lastHubScoreRebuildAt: 0,
      lastIndexCacheSaveAt: 0,
      pipelineActivity: createEmptyPipelineActivity(),
    };
    const ctxB: VaultContext = {
      ...ctxA,
      name: 'vault-b',
      pipelineActivity: createEmptyPipelineActivity(),
    };

    const pctx: PipelineContext = {
      vp: tempVault,
      sd: stateDb,
      ctx: ctxA,
      events: [{ type: 'upsert', path: 'people/Alice.md', originalEvents: [] }],
      renames: [],
      batch: { events: [{ type: 'upsert', path: 'people/Alice.md', originalEvents: [] }], renames: [], timestamp: Date.now() },
      changedPaths: ['people/Alice.md'],
      flywheelConfig: {},
      updateIndexState: (state, error) => { ctxA.indexState = state; if (error !== undefined) ctxA.indexError = error ?? null; },
      updateVaultIndex: (idx) => { vaultIndex = idx; ctxA.vaultIndex = idx; },
      updateEntitiesInStateDb: async (vp, sd) => {
        if (!sd) return;
        const entityIdx = await scanVaultEntities(vp ?? tempVault, { excludeFolders: [] });
        sd.replaceAllEntities(entityIdx);
      },
      getVaultIndex: () => vaultIndex,
      buildVaultIndex,
    };

    await new PipelineRunner(pctx).run();

    expect(ctxA.pipelineActivity.last_completed_at).not.toBeNull();
    expect(ctxA.pipelineActivity.last_completed_trigger).toBe('watcher');
    expect(ctxA.pipelineActivity.last_completed_steps.length).toBeGreaterThan(0);
    expect(ctxB.pipelineActivity.last_completed_at).toBeNull();
    expect(ctxB.pipelineActivity.last_completed_steps).toEqual([]);
  }, 30000);
});
