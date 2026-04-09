/**
 * Learning Report Tool — flywheel_learning_report
 *
 * Retired (T43) — registration removed from MCP surface.
 * Core logic preserved in core/read/learningReport.ts.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import type { StateDb } from '@velvetmonkey/vault-core';

// Registration removed (T43). Core logic: core/read/learningReport.ts
export function registerLearningReportTools(
  _server: McpServer,
  _getIndex: () => VaultIndex,
  _getStateDb: () => StateDb | null,
): void {}
