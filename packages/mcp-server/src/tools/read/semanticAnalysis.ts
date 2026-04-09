/**
 * Semantic Analysis — semantic_analysis
 *
 * Retired (T43) — registration removed from MCP surface.
 * Core embedding logic preserved in core/read/embeddings.ts and core/semantic/.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';

// Registration removed (T43). Core logic: core/read/embeddings.ts
export function registerSemanticAnalysisTools(
  _server: McpServer,
  _getIndex: () => VaultIndex,
  _getVaultPath: () => string,
): void {}
