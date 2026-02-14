/**
 * Test helper to create a configured MCP server for testing
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../src/core/read/types.js';
import { buildVaultIndex, setIndexState } from '../../src/core/read/graph.js';
import { registerGraphTools } from '../../src/tools/read/graph.js';
import { registerWikilinkTools } from '../../src/tools/read/wikilinks.js';
import { registerHealthTools } from '../../src/tools/read/health.js';
import { registerQueryTools } from '../../src/tools/read/query.js';
import { registerSystemTools } from '../../src/tools/read/system.js';
import { registerPrimitiveTools } from '../../src/tools/read/primitives.js';
import { registerPeriodicTools } from '../../src/tools/read/periodic.js';
import { registerBidirectionalTools } from '../../src/tools/read/bidirectional.js';
import { registerSchemaTools } from '../../src/tools/read/schema.js';
import { registerComputedTools } from '../../src/tools/read/computed.js';
import { registerMigrationTools } from '../../src/tools/read/migrations.js';
import { openStateDb, type StateDb } from '@velvetmonkey/vault-core';

export interface TestServerContext {
  stateDb: StateDb | null;
  server: McpServer;
  vaultIndex: VaultIndex;
  vaultPath: string;
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
  } catch (err) {
    console.error('Failed to open StateDb:', err);
  }

  // Create a new server instance
  const server = new McpServer({
    name: 'flywheel-test',
    version: '1.0.0-test',
  });

  // Mutable reference for system tools to update
  let currentIndex = vaultIndex;

  // Register all tools
  registerGraphTools(
    server,
    () => currentIndex,
    () => vaultPath
  );

  registerWikilinkTools(
    server,
    () => currentIndex,
    () => vaultPath
  );

  registerHealthTools(
    server,
    () => currentIndex,
    () => vaultPath
  );

  registerQueryTools(
    server,
    () => currentIndex,
    () => vaultPath,
    () => stateDb
  );

  registerSystemTools(
    server,
    () => currentIndex,
    (newIndex) => {
      currentIndex = newIndex;
    },
    () => vaultPath
  );

  registerPrimitiveTools(
    server,
    () => currentIndex,
    () => vaultPath
  );

  registerPeriodicTools(server, () => currentIndex);

  registerBidirectionalTools(
    server,
    () => currentIndex,
    () => vaultPath
  );

  registerSchemaTools(
    server,
    () => currentIndex,
    () => vaultPath
  );

  registerComputedTools(
    server,
    () => currentIndex,
    () => vaultPath
  );

  registerMigrationTools(
    server,
    () => currentIndex,
    () => vaultPath
  );

  return {
    server,
    vaultIndex,
    vaultPath,
    stateDb,
  };
}
