/**
 * Entity History Tool — vault_entity_history
 *
 * Retired (T43) — registration removed from MCP surface.
 * Core logic preserved in core/read/entityHistory.ts.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StateDb } from '@velvetmonkey/vault-core';

// Registration removed (T43). Core logic: core/read/entityHistory.ts
export function registerEntityHistoryTools(
  _server: McpServer,
  _getStateDb: () => StateDb | null,
): void {}
