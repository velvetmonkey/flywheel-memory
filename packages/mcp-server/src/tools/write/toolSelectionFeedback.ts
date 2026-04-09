/**
 * Tool Selection Feedback — tool_selection_feedback
 *
 * Retired (T43) — registration removed from MCP surface.
 * Core logic preserved in core/shared/toolSelectionFeedback.ts.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StateDb } from '@velvetmonkey/vault-core';

// Registration removed (T43). Core logic: core/shared/toolSelectionFeedback.ts
export function registerToolSelectionFeedbackTools(
  _server: McpServer,
  _getStateDb: () => StateDb | null,
): void {}
