/**
 * Test helper to create a configured MCP server for testing
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../src/core/types.js';
import { buildVaultIndex, setIndexState } from '../../src/core/graph.js';
import { registerGraphTools } from '../../src/tools/graph.js';
import { registerWikilinkTools } from '../../src/tools/wikilinks.js';
import { registerHealthTools } from '../../src/tools/health.js';
import { registerQueryTools } from '../../src/tools/query.js';
import { registerSystemTools } from '../../src/tools/system.js';
import { registerPrimitiveTools } from '../../src/tools/primitives.js';
import { registerPeriodicTools } from '../../src/tools/periodic.js';
import { registerBidirectionalTools } from '../../src/tools/bidirectional.js';
import { registerSchemaTools } from '../../src/tools/schema.js';
import { registerComputedTools } from '../../src/tools/computed.js';
import { registerMigrationTools } from '../../src/tools/migrations.js';
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
