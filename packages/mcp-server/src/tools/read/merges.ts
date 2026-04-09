/**
 * Entity merge suggestion tools — RETIRED (T43)
 *
 * suggest_entity_merges and dismiss_merge_suggestion have been absorbed into
 * the entity tool as action: suggest_merges and action: dismiss_merge.
 *
 * This file is kept as an empty stub to avoid import errors.
 * The registerMergeTools export below is a no-op.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StateDb } from '@velvetmonkey/vault-core';

// No-op — tools absorbed into entity tool (T43)
export function registerMergeTools(
  _server: McpServer,
  _getStateDb: () => StateDb | null
): void {
  // suggest_entity_merges → entity(action: suggest_merges)
  // dismiss_merge_suggestion → entity(action: dismiss_merge)
}
