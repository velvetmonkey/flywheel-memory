/**
 * Test helper to create a fully-configured MCP server with ALL tools for testing.
 *
 * Builds a fresh server using registerAllTools (the production registration path)
 * rather than manually mirroring individual tool registrations. This eliminates
 * drift between test and production tool sets.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildVaultIndex, setIndexState } from '../../src/core/read/graph.js';
import { setFTS5Database } from '../../src/core/read/fts5.js';
import { setTaskCacheDatabase } from '../../src/core/read/taskCache.js';
import { setRecencyStateDb } from '../../src/core/shared/recency.js';
import { setWriteStateDb, setWikilinkConfig } from '../../src/core/write/wikilinks.js';
import { loadConfig, type FlywheelConfig } from '../../src/core/read/config.js';
import { createEmptyPipelineActivity } from '../../src/core/read/watch/pipeline.js';
import { registerAllTools } from '../../src/tool-registry.js';
import { createTempVault, cleanupTempVault } from '../write/helpers/testUtils.js';
import { openStateDb, deleteStateDb, type StateDb } from '@velvetmonkey/vault-core';
import type { VaultIndex } from '../../src/core/read/types.js';

export interface WriteTestServerContext {
  server: McpServer;
  vaultIndex: VaultIndex;
  vaultPath: string;
  stateDb: StateDb;
  flywheelConfig: FlywheelConfig;
  getIndex: () => VaultIndex;
  cleanup: () => Promise<void>;
}

/**
 * Creates a fully configured MCP server with ALL read and write tools for testing.
 * Uses registerAllTools from tool-registry.ts — the same registration path as production.
 *
 * Wires all required singletons:
 * - FTS5 (search), TaskCache (tasks), Recency (recency index)
 * - WriteStateDb + WikilinkConfig (wikilink suggestions, enrichment)
 *
 * If no vaultPath is provided, creates a temporary vault that is cleaned up automatically.
 */
export async function createWriteTestServer(
  vaultPath?: string,
  config?: Partial<FlywheelConfig>,
): Promise<WriteTestServerContext> {
  const isTemp = !vaultPath;
  const actualVaultPath = vaultPath ?? await createTempVault();

  // Build vault index
  let currentIndex = await buildVaultIndex(actualVaultPath);
  setIndexState('ready');

  // Open StateDb
  const stateDb = openStateDb(actualVaultPath);

  // Load config, merge overrides
  let flywheelConfig: FlywheelConfig = { ...loadConfig(stateDb), ...config };

  // Wire all singletons BEFORE registerAllTools
  setFTS5Database(stateDb.db);
  setTaskCacheDatabase(stateDb.db);
  setRecencyStateDb(stateDb);
  setWriteStateDb(stateDb);
  setWikilinkConfig(flywheelConfig);

  // Create pipeline activity stub
  const pipelineActivity = createEmptyPipelineActivity();

  // Build fresh server with ALL tools via production registration path
  const server = new McpServer({
    name: 'flywheel-write-test',
    version: '1.0.0-test',
  });

  registerAllTools(server, {
    getVaultPath: () => actualVaultPath,
    getVaultIndex: () => currentIndex,
    getStateDb: () => stateDb,
    getFlywheelConfig: () => flywheelConfig,
    getWatcherStatus: () => null,
    getPipelineActivity: () => pipelineActivity,
    updateVaultIndex: (idx) => { currentIndex = idx; },
    updateFlywheelConfig: (cfg) => {
      flywheelConfig = cfg;
      setWikilinkConfig(cfg);
    },
  });

  return {
    server,
    vaultIndex: currentIndex,
    vaultPath: actualVaultPath,
    stateDb,
    flywheelConfig,
    getIndex: () => currentIndex,
    cleanup: async () => {
      // Clear module-level singletons to avoid cross-test contamination
      setWriteStateDb(null);
      setRecencyStateDb(null);
      setFTS5Database(null as any);
      setTaskCacheDatabase(null as any);
      try { stateDb.close(); } catch { /* already closed */ }
      try { deleteStateDb(actualVaultPath); } catch { /* ignore */ }
      if (isTemp) {
        await cleanupTempVault(actualVaultPath);
      }
    },
  };
}
