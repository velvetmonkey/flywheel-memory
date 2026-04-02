/**
 * Session History Tool — vault_session_history
 *
 * Exposes session tracking and activity logs to agents: list recent sessions,
 * get full chronological detail for a specific session, or query note access,
 * tool usage, and proactive linking activity.
 * Supports hierarchical sessions (parent includes children).
 *
 * Absorbs the former vault_activity tool via mode parameter.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import {
  getSessionHistory,
  getSessionDetail,
  getToolUsageSummary,
  getNoteAccessFrequency,
  getRecentInvocations,
} from '../../core/shared/toolTracking.js';

export function registerSessionHistoryTools(
  server: McpServer,
  getStateDb: () => StateDb | null,
  getSessionId: () => string | null,
): void {
  server.tool(
    'vault_session_history',
    'Use when reviewing past agent sessions, checking tool usage, or inspecting note access patterns. Mode "sessions" (default) lists recent sessions or shows detail for one session. Mode "note_access" shows which notes were accessed most. Mode "tool_usage" shows tool invocation frequency. Mode "proactive_linking" shows background wikilink applications. Returns session listings, note access records, tool usage stats, or proactive linking data. Does not modify any records — read-only access.',
    {
      mode: z.enum(['sessions', 'note_access', 'tool_usage', 'proactive_linking']).default('sessions').describe('Activity query mode (default: sessions)'),
      session_id: z.string().optional().describe('Session ID for detail view (mode=sessions). Omit for recent sessions list. Defaults to current session if mode needs it.'),
      include_children: z.boolean().optional().describe('Include child sessions in detail view (default: true). Used in mode=sessions.'),
      days_back: z.number().optional().describe('Number of days to look back (default: 30). Used in note_access, tool_usage, proactive_linking modes.'),
      limit: z.number().min(1).max(500).optional().describe('Maximum results to return (default: 20)'),
    },
    async (args) => {
      const stateDb = getStateDb();
      if (!stateDb) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available' }) }],
          isError: true,
        };
      }

      const resolvedMode = args.mode ?? 'sessions';
      const daysBack = args.days_back ?? 30;
      const limit = args.limit ?? 20;

      switch (resolvedMode) {
        case 'sessions': {
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

        case 'proactive_linking': {
          const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
          const sinceStr = since.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
          const rows = stateDb.db.prepare(
            `SELECT entity, note_path, applied_at, status, matched_term
             FROM wikilink_applications
             WHERE source = 'proactive' AND applied_at >= ?
             ORDER BY applied_at DESC LIMIT ?`,
          ).all(sinceStr, limit) as Array<{
            entity: string;
            note_path: string;
            applied_at: string;
            status: string;
            matched_term: string | null;
          }>;
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              mode: 'proactive_linking',
              days_back: daysBack,
              count: rows.length,
              applications: rows,
            }, null, 2) }],
          };
        }
      }
    }
  );
}
