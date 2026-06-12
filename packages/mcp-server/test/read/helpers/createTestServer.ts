/**
 * Test helper to create a configured MCP server for testing.
 *
 * Registers tools via registerAllTools (the production registration path,
 * same pattern as test/helpers/createWriteTestServer.ts) rather than
 * hand-assembling individual tool modules. This eliminates drift between the
 * test and production tool surfaces — retired legacy tools (suggest_wikilinks,
 * graph_analysis, vault_schema, note_intelligence, rename_field, ...) are no
 * longer registered here because production never registers them.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { VaultIndex } from '../../../src/core/read/types.js';
import { buildVaultIndex, setIndexState } from '../../../src/core/read/graph.js';
import { loadConfig, type FlywheelConfig } from '../../../src/core/read/config.js';
import { registerAllTools } from '../../../src/tool-registry.js';
import { openStateDb, type StateDb } from '@velvetmonkey/vault-core';
import { setFTS5Database } from '../../../src/core/read/fts5.js';
import { setProspectStateDb } from '../../../src/core/shared/prospects.js';
import { createEmptyPipelineActivity } from '../../../src/core/write/pipeline/activity.js';

export interface TestServerContext {
  stateDb: StateDb | null;
  server: McpServer;
  vaultIndex: VaultIndex;
  vaultPath: string;
  getIndex: () => VaultIndex;
  runtimeState: {
    bootState: string;
    integrityState: string;
    integrityCheckInProgress: boolean;
    integrityStartedAt: number | null;
    integritySource: string | null;
    lastIntegrityCheckedAt: number | null;
    lastIntegrityDurationMs: number | null;
    lastIntegrityDetail: string | null;
    lastBackupAt: number | null;
  };
}

/**
 * Creates a fully configured MCP server for testing
 * @param vaultPath - Path to the test vault/fixtures directory
 */
export async function createTestServer(vaultPath: string): Promise<TestServerContext> {
  // Build the vault index first
  const vaultIndex = await buildVaultIndex(vaultPath);

  // Mark index as ready (required by indexGuard)
  setIndexState('ready');

  // Open or create StateDb for the vault
  let stateDb: StateDb | null = null;
  try {
    stateDb = openStateDb(vaultPath);
    // Inject StateDb handle for FTS5 content search
    setFTS5Database(stateDb.db);
    setProspectStateDb(stateDb);
  } catch (err) {
    console.error('Failed to open StateDb:', err);
  }

  // Create a new server instance
  const server = new McpServer({
    name: 'flywheel-test',
    version: '1.0.0-test',
  });

  // Mutable references for tools to read/update
  let currentIndex = vaultIndex;
  let flywheelConfig: FlywheelConfig = stateDb ? loadConfig(stateDb) : ({} as FlywheelConfig);
  const pipelineActivity = createEmptyPipelineActivity();
  const runtimeState = {
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

  // Register the production tool surface (no gating — all tools registered)
  registerAllTools(server, {
    getVaultPath: () => vaultPath,
    getVaultIndex: () => currentIndex,
    getStateDb: () => stateDb,
    getFlywheelConfig: () => flywheelConfig,
    getWatcherStatus: () => null,
    getPipelineActivity: () => pipelineActivity,
    getVaultRuntimeState: () => runtimeState,
    updateVaultIndex: (newIndex) => {
      currentIndex = newIndex;
    },
    updateFlywheelConfig: (newConfig) => {
      flywheelConfig = newConfig;
    },
  });

  return {
    server,
    vaultIndex,
    vaultPath,
    stateDb,
    getIndex: () => currentIndex,
    runtimeState,
  };
}

/**
 * In-process transport for testing that routes messages between client and server.
 */
class TestTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;
  private _sendHandler: (message: JSONRPCMessage) => void;

  constructor(sendHandler: (message: JSONRPCMessage) => void) {
    this._sendHandler = sendHandler;
  }
  async start() {}
  async close() {}
  async send(message: JSONRPCMessage) {
    this._sendHandler(message);
  }
}

export interface TestClient {
  callTool: (name: string, args?: Record<string, unknown>) => Promise<any>;
  listTools: () => Promise<any>;
}

/**
 * Connect a test client to an McpServer. Call once in beforeAll and reuse across tests.
 * Unlike mcp-testing-kit's connect(), this supports multiple requests on a single connection.
 */
export function connectTestClient(mcpServer: McpServer): TestClient {
  const pending = new Map<number | string, { resolve: (v: any) => void; reject: (e: any) => void }>();
  let requestId = 1;

  const transport = new TestTransport((message: JSONRPCMessage) => {
    const msg = message as any;
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)!.resolve(msg);
      pending.delete(msg.id);
    }
  });

  // Connect using the underlying Server, not McpServer (avoids double-connect issues)
  mcpServer.server.connect(transport);

  function sendRequest(method: string, params: any = {}): Promise<any> {
    const id = requestId++;
    const request = {
      jsonrpc: '2.0' as const,
      id,
      method,
      params: { ...params, _meta: { progressToken: id } },
    };
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      transport.onmessage?.(request);
    });
  }

  return {
    callTool: async (name: string, args: Record<string, unknown> = {}) => {
      const resp = await sendRequest('tools/call', { name, arguments: args });
      return (resp as any).result;
    },
    listTools: async () => {
      const resp = await sendRequest('tools/list', {});
      return (resp as any).result;
    },
  };
}
