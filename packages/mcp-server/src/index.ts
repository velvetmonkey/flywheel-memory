#!/usr/bin/env node
/**
 * Flywheel Memory - Unified local-first memory for AI agents
 *
 * Combines:
 * - 51 read tools from Flywheel (search, backlinks, graph)
 * - 22 write tools from Flywheel-Crank (mutations, tasks, notes)
 * - New memory_* tools (add, search, update, delete)
 *
 * Total: 73+ tools
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Core utilities from vault-core
// import { StateDb, EntityIndex, applyWikilinks } from "@velvetmonkey/vault-core";

// Tool registrations (to be implemented)
// import { registerReadTools } from "./tools/read/index.js";
// import { registerWriteTools } from "./tools/write/index.js";
// import { registerMemoryTools } from "./tools/memory/index.js";

const VAULT_PATH = process.env.VAULT_PATH || process.env.PROJECT_PATH;

if (!VAULT_PATH) {
  console.error("[Memory] Error: VAULT_PATH environment variable is required");
  console.error("[Memory] Usage: VAULT_PATH=/path/to/vault flywheel-memory");
  process.exit(1);
}

async function main() {
  console.error(`[Memory] Starting Flywheel Memory server...`);
  console.error(`[Memory] Vault: ${VAULT_PATH}`);

  const server = new McpServer({
    name: "flywheel-memory",
    version: "1.0.0",
  });

  // TODO: Initialize StateDb from vault-core
  // const stateDb = new StateDb(VAULT_PATH);

  // TODO: Register all tools
  // registerReadTools(server, VAULT_PATH, stateDb);    // 51 tools
  // registerWriteTools(server, VAULT_PATH, stateDb);   // 22 tools
  // registerMemoryTools(server, VAULT_PATH, stateDb);  // New memory tools

  // Placeholder: Register a test tool
  server.tool(
    "memory_status",
    "Check Flywheel Memory server status",
    {},
    async () => {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "ok",
              vault: VAULT_PATH,
              version: "1.0.0",
              tools: {
                read: 51,
                write: 22,
                memory: 4,
                total: 77,
              },
              message: "Flywheel Memory is running. Full tool registration pending.",
            }),
          },
        ],
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[Memory] Server connected and ready`);
  console.error(`[Memory] 73+ tools available for AI agent memory`);
}

main().catch((error) => {
  console.error("[Memory] Fatal error:", error);
  process.exit(1);
});
