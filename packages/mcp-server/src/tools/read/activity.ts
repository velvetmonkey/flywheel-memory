/**
 * Vault Activity tools
 * Tools: vault_activity
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import {
  getToolUsageSummary,
  getNoteAccessFrequency,
  getSessionHistory,
  getRecentInvocations,
} from '../../core/shared/toolTracking.js';

/**
 * Register vault activity tools
 */
export function registerActivityTools(
  server: McpServer,
  getStateDb: () => StateDb | null,
  getSessionId: () => string | null
): void {
  server.registerTool(
    'vault_activity',
    {
      title: 'Vault Activity',
      description:
        'Track tool usage patterns and session activity. Modes:\n' +
        '- "session": Current session summary (tools called, notes accessed)\n' +
        '- "sessions": List of recent sessions\n' +
        '- "note_access": Notes ranked by query frequency\n' +
        '- "tool_usage": Tool usage patterns (most-used tools, avg duration)',
      inputSchema: {
        mode: z.enum(['session', 'sessions', 'note_access', 'tool_usage']).describe('Activity query mode'),
        session_id: z.string().optional().describe('Specific session ID (for session mode, defaults to current)'),
        days_back: z.number().optional().describe('Number of days to look back (default: 30)'),
        limit: z.number().optional().describe('Maximum results to return (default: 20)'),
      },
    },
    async ({ mode, session_id, days_back, limit: resultLimit }) => {
      const stateDb = getStateDb();
      if (!stateDb) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available' }) }],
        };
      }

      const daysBack = days_back ?? 30;
      const limit = resultLimit ?? 20;

      switch (mode) {
        case 'session': {
          const sid = session_id ?? getSessionId();
          if (!sid) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No session ID available' }) }],
            };
          }
          const sessions = getSessionHistory(stateDb, sid);
          const recent = getRecentInvocations(stateDb, limit);
          // Filter recent to current session
          const sessionInvocations = recent.filter(r => r.session_id === sid);

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              mode: 'session',
              session_id: sid,
              summary: sessions[0] ?? null,
              recent_invocations: sessionInvocations,
            }, null, 2) }],
          };
        }

        case 'sessions': {
          const sessions = getSessionHistory(stateDb);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              mode: 'sessions',
              sessions: sessions.slice(0, limit),
            }, null, 2) }],
          };
        }

        case 'note_access': {
          const notes = getNoteAccessFrequency(stateDb, daysBack);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              mode: 'note_access',
              days_back: daysBack,
              notes: notes.slice(0, limit),
            }, null, 2) }],
          };
        }

        case 'tool_usage': {
          const tools = getToolUsageSummary(stateDb, daysBack);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              mode: 'tool_usage',
              days_back: daysBack,
              tools: tools.slice(0, limit),
            }, null, 2) }],
          };
        }
      }
    }
  );
}
