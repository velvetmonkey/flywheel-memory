/**
 * Test helper to create a configured MCP server with write tools for testing.
 * Wraps createTestServer and adds write tool registration.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createTestServer, type TestServerContext } from '../read/helpers/createTestServer.js';
import { createTempVault, cleanupTempVault } from '../write/helpers/testUtils.js';
import { setWriteStateDb } from '../../src/core/write/wikilinks.js';
import { openStateDb, deleteStateDb, type StateDb } from '@velvetmonkey/vault-core';
import { loadConfig, type FlywheelConfig } from '../../src/core/read/config.js';

import { registerMutationTools } from '../../src/tools/write/mutations.js';
import { registerNoteTools } from '../../src/tools/write/notes.js';
import { registerFrontmatterTools } from '../../src/tools/write/frontmatter.js';
import { registerTaskTools } from '../../src/tools/write/tasks.js';
import { registerSystemTools as registerWriteSystemTools } from '../../src/tools/write/system.js';
import { registerConfigTools } from '../../src/tools/write/config.js';

export interface WriteTestServerContext extends TestServerContext {
  cleanup: () => Promise<void>;
  flywheelConfig: FlywheelConfig;
}

/**
 * Creates a fully configured MCP server with both read and write tools for testing.
 * If no vaultPath is provided, creates a temporary vault.
 */
export async function createWriteTestServer(
  vaultPath?: string,
  config?: Partial<FlywheelConfig>,
): Promise<WriteTestServerContext> {
  const isTemp = !vaultPath;
  const actualVaultPath = vaultPath ?? await createTempVault();

  // Set up read-side via existing helper
  const readCtx = await createTestServer(actualVaultPath);

  // Open a dedicated StateDb for write tools
  let writeStateDb: StateDb;
  try {
    writeStateDb = readCtx.stateDb ?? openStateDb(actualVaultPath);
  } catch {
    writeStateDb = openStateDb(actualVaultPath);
  }

  // Inject StateDb into write module
  setWriteStateDb(writeStateDb);

  // Load config from StateDb, merge overrides
  let flywheelConfig: FlywheelConfig = { ...loadConfig(writeStateDb), ...config };

  // Register write tools
  registerMutationTools(readCtx.server, () => actualVaultPath, () => flywheelConfig);
  registerNoteTools(readCtx.server, () => actualVaultPath, () => readCtx.vaultIndex);
  registerFrontmatterTools(readCtx.server, () => actualVaultPath);
  registerTaskTools(readCtx.server, () => actualVaultPath);
  registerWriteSystemTools(readCtx.server, () => actualVaultPath);
  registerConfigTools(
    readCtx.server,
    () => flywheelConfig,
    (newConfig) => { flywheelConfig = newConfig; },
    () => writeStateDb,
  );

  return {
    ...readCtx,
    stateDb: writeStateDb,
    flywheelConfig,
    cleanup: async () => {
      setWriteStateDb(null);
      try { writeStateDb.close(); } catch { /* already closed */ }
      try { deleteStateDb(actualVaultPath); } catch { /* ignore */ }
      if (isTemp) {
        await cleanupTempVault(actualVaultPath);
      }
    },
  };
}
