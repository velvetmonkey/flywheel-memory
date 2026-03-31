/**
 * Session History Tool — vault_session_history
 *
 * Exposes session tracking to agents: list recent sessions or get
 * full chronological detail for a specific session.
 * Supports hierarchical sessions (parent includes children).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import { getSessionHistory, getSessionDetail } from '../../core/shared/toolTracking.js';

export function registerSessionHistoryTools(
  server: McpServer,
  getStateDb: () => StateDb | null,
): void {
  server.tool(
    'vault_session_history',
    'Use when reviewing past agent sessions. Produces session summaries or detailed tool invocation timelines. Returns session list or chronological tool calls with parameters and results. Does not modify session records — read-only access.',
    {
      session_id: z.string().optional().describe('Session ID for detail view. Omit for recent sessions list.'),
      include_children: z.boolean().optional().describe('Include child sessions (default: true)'),
      limit: z.number().min(1).max(500).optional().describe('Max invocations to return in detail view (default: 200)'),
    },
    async (args) => {
      const stateDb = getStateDb();
      if (!stateDb) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available' }) }],
          isError: true,
        };
      }

      if (args.session_id) {
        const detail = getSessionDetail(stateDb, args.session_id, {
          include_children: args.include_children,
          limit: args.limit,
        });

        if (!detail) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              session_id: args.session_id,
              error: 'No invocations found for this session',
            }) }],
          };
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            ...detail.summary,
            invocations: detail.invocations.map(inv => ({
              invocation_id: inv.id,
              tool: inv.tool_name,
              timestamp: inv.timestamp,
              session_id: inv.session_id,
              note_paths: inv.note_paths,
              duration_ms: inv.duration_ms,
              success: inv.success,
              query_context: inv.query_context,
            })),
          }, null, 2) }],
        };
      }

      const sessions = getSessionHistory(stateDb);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          sessions: sessions.slice(0, args.limit ?? 20),
        }, null, 2) }],
      };
    }
  );
}
