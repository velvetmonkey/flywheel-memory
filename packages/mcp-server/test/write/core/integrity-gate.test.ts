import { describe, expect, test } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { applyToolGating, registerAllTools, type ToolRegistryContext } from '../../../src/tool-registry.js';
import { VaultRegistry, type VaultContext } from '../../../src/vault-registry.js';
import { connectTestClient } from '../../read/helpers/createTestServer.js';
import { createEmptyPipelineActivity } from '../../../src/core/read/watch/pipeline.js';

function createFailedVaultContext(): VaultContext {
  return {
    name: 'default',
    vaultPath: '/tmp/fake-vault',
    caseInsensitive: false,
    stateDb: null,
    vaultIndex: undefined as any,
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
    bootState: 'degraded',
    integrityState: 'failed',
    integrityCheckInProgress: false,
    integrityStartedAt: null,
    integritySource: 'startup',
    lastIntegrityCheckedAt: Date.now(),
    lastIntegrityDurationMs: 1000,
    lastIntegrityDetail: 'database disk image is malformed',
    lastBackupAt: null,
  };
}

function createStubRegistryContext(): ToolRegistryContext {
  return {
    getVaultPath: () => '/tmp/fake-vault',
    getVaultIndex: () => null as any,
    getStateDb: () => null,
    getFlywheelConfig: () => ({} as any),
    getWatcherStatus: () => null,
    getPipelineActivity: () => null,
    getVaultRuntimeState: () => ({
      bootState: 'degraded',
      integrityState: 'failed',
      integrityCheckInProgress: false,
      integrityStartedAt: null,
      integritySource: 'startup',
      lastIntegrityCheckedAt: Date.now(),
      lastIntegrityDurationMs: 1000,
      lastIntegrityDetail: 'database disk image is malformed',
      lastBackupAt: null,
    }),
    updateVaultIndex: () => {},
    updateFlywheelConfig: () => {},
  };
}

describe('integrity write gate', () => {
  test('blocks mutating tools after integrity failure', async () => {
    const server = new McpServer({ name: 'integrity-gate-test', version: '0.0.0' });
    const registry = new VaultRegistry('default');
    registry.addContext(createFailedVaultContext());

    const controller = applyToolGating(
      server,
      new Set(['write', 'tasks', 'memory', 'note-ops', 'schema', 'corrections', 'diagnostics']),
      () => null,
      registry,
      () => '/tmp/fake-vault',
      undefined,
      'off',
    );

    registerAllTools(server, createStubRegistryContext(), controller, { applyClientSuppressions: false });
    controller.finalizeRegistration();

    const client = connectTestClient(server);
    const result = await client.callTool('vault_update_frontmatter', { path: 'Test.md', frontmatter: {} });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('StateDb integrity failed');
  });
});
