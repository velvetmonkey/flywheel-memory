/**
 * Tests for fire-and-forget init_semantic — the handler must return promptly
 * (a full build over a large vault takes ~20-30 min, far past MCP client
 * timeouts; the 2026-06-06 incident dropped the whole connection), set the
 * building flag synchronously, refuse concurrent builds, and always release
 * the flag on failure.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createTempVault,
  cleanupTempVault,
  openStateDb,
  deleteStateDb,
  createTestNote,
  type StateDb,
} from '../../helpers/testUtils.js';
import { connectTestClient, type TestClient } from '../helpers/createTestServer.js';
import { getWriteState } from '@velvetmonkey/vault-core';

// Mock ONLY the long-running build internals; keep state setters/getters real
// so the flag semantics under test are the production ones.
const buildDeferred: { resolve?: () => void; reject?: (e: Error) => void } = {};
const buildSpy = vi.fn(
  () => new Promise<{ total: number; current: number; skipped: number }>((resolve, reject) => {
    buildDeferred.resolve = () => resolve({ total: 3, current: 3, skipped: 0 });
    buildDeferred.reject = (e: Error) => reject(e);
  }),
);

vi.mock('../../../src/core/read/embeddings.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/core/read/embeddings.js')>();
  return {
    ...original,
    buildEmbeddingsIndex: (...args: unknown[]) => buildSpy(...args as []),
    buildEntityEmbeddingsIndex: vi.fn(async () => 0),
    loadEntityEmbeddingsToMemory: vi.fn(),
    classifyUncategorizedEntities: vi.fn(() => []),
    saveInferredCategories: vi.fn(),
  };
});

// Import AFTER the mock so semantic.ts picks up the mocked module.
import { registerSemanticTools } from '../../../src/tools/read/semantic.js';
import {
  isEmbeddingsBuilding,
  setEmbeddingsBuilding,
  setEmbeddingsBuildState,
  setEmbeddingsDatabase,
} from '../../../src/core/read/embeddings.js';

function parsePayload(result: { content: Array<{ type: string; text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0].text);
}

describe('init_semantic fire-and-forget', () => {
  let vaultPath: string;
  let stateDb: StateDb;
  let client: TestClient;

  beforeEach(async () => {
    vaultPath = await createTempVault();
    await createTestNote(vaultPath, 'a.md', '# A\n\ncontent');
    stateDb = openStateDb(vaultPath);
    setEmbeddingsDatabase(stateDb.db);
    setEmbeddingsBuilding(false);
    setEmbeddingsBuildState('none');
    buildSpy.mockClear();

    const server = new McpServer({ name: 'flywheel-test', version: '1.0.0-test' });
    registerSemanticTools(server, () => vaultPath, () => stateDb);
    client = connectTestClient(server);
  });

  afterEach(async () => {
    setEmbeddingsBuilding(false);
    stateDb.db.close();
    deleteStateDb(vaultPath);
    await cleanupTempVault(vaultPath);
  });

  it('returns promptly with started:true and sets the building flag synchronously', async () => {
    const start = Date.now();
    const result = await client.callTool('init_semantic', { force: true });
    const elapsed = Date.now() - start;

    const payload = parsePayload(result);
    expect(payload.started).toBe(true);
    expect(payload.success).toBe(true);
    expect(typeof payload.current_embeddings_count).toBe('number');
    // Stubbed build never resolves until we say so — a prompt return proves
    // the handler did not await it. Generous ceiling for WSL2 (2x rule).
    expect(elapsed).toBeLessThan(4000);
    expect(isEmbeddingsBuilding()).toBe(true);

    // Telemetry persisted as building
    const telemetry = getWriteState<{ status: string }>(stateDb, 'last_embedding_build');
    expect(telemetry?.status).toBe('building');

    // Finish the build; flag releases and telemetry completes.
    buildDeferred.resolve!();
    await vi.waitFor(() => expect(isEmbeddingsBuilding()).toBe(false));
    const done = getWriteState<{ status: string }>(stateDb, 'last_embedding_build');
    expect(done?.status).toBe('complete');
  });

  it('refuses a concurrent build with already_building', async () => {
    const first = parsePayload(await client.callTool('init_semantic', { force: true }));
    expect(first.started).toBe(true);

    const second = parsePayload(await client.callTool('init_semantic', { force: true }));
    expect(second.started).toBe(false);
    expect(second.already_building).toBe(true);
    expect(buildSpy).toHaveBeenCalledTimes(1);

    buildDeferred.resolve!();
    await vi.waitFor(() => expect(isEmbeddingsBuilding()).toBe(false));
  });

  it('releases the building flag and records failure when the build throws', async () => {
    const result = parsePayload(await client.callTool('init_semantic', { force: true }));
    expect(result.started).toBe(true);
    expect(isEmbeddingsBuilding()).toBe(true);

    buildDeferred.reject!(new Error('worker exploded'));
    await vi.waitFor(() => expect(isEmbeddingsBuilding()).toBe(false));

    const telemetry = getWriteState<{ status: string; error: string }>(stateDb, 'last_embedding_build');
    expect(telemetry?.status).toBe('failed');
    expect(telemetry?.error).toMatch(/worker exploded/);
  });
});
