import { describe, expect, test } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { applyToolGating } from '../../../src/tool-registry.js';
import { VaultRegistry, type VaultContext } from '../../../src/vault-registry.js';
import { connectTestClient } from '../../read/helpers/createTestServer.js';
import { createEmptyPipelineActivity } from '../../../src/core/read/watch/pipeline.js';

function createFailedVaultContext(): VaultContext {
  return {
    name: 'default',
    vaultPath: '/tmp/fake-vault',
    stateDb: null,
    vaultIndex: undefined as any,
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

    server.tool('vault_create_note', async () => ({
      content: [{ type: 'text' as const, text: 'should not run' }],
    }));
    controller.finalizeRegistration();

    const client = connectTestClient(server);
    const result = await client.callTool('vault_create_note', { path: 'Test.md' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('StateDb integrity failed');
  });
});
