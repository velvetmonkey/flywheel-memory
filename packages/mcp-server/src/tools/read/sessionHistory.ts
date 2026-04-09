/**
 * Session History Tool — vault_session_history
 *
 * Retired (T43) — registration removed from MCP surface.
 * Core logic preserved in core/shared/toolTracking.ts.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StateDb } from '@velvetmonkey/vault-core';

// Registration removed (T43). Core logic: core/shared/toolTracking.ts
export function registerSessionHistoryTools(
  _server: McpServer,
  _getStateDb: () => StateDb | null,
  _getSessionId: () => string | null,
): void {}
