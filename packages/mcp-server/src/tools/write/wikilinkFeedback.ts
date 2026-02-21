/**
 * Wikilink Feedback tools
 * Tools: wikilink_feedback
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import {
  recordFeedback,
  getFeedback,
  getEntityStats,
  updateSuppressionList,
  getSuppressedCount,
  getDashboardData,
  type FeedbackResult,
} from '../../core/write/wikilinkFeedback.js';

/**
 * Register wikilink feedback tools
 */
export function registerWikilinkFeedbackTools(
  server: McpServer,
  getStateDb: () => StateDb | null
): void {
  server.registerTool(
    'wikilink_feedback',
    {
      title: 'Wikilink Feedback',
      description:
        'Report and query wikilink accuracy feedback. Modes: "report" (record feedback), "list" (view recent feedback), "stats" (entity accuracy statistics), "dashboard" (full feedback loop data for visualization). Entities with >=30% false positive rate (and >=10 samples) are auto-suppressed from future wikilink application.',
      inputSchema: {
        mode: z.enum(['report', 'list', 'stats', 'dashboard']).describe('Operation mode'),
        entity: z.string().optional().describe('Entity name (required for report mode, optional filter for list/stats)'),
        note_path: z.string().optional().describe('Note path where the wikilink appeared (for report mode)'),
        context: z.string().optional().describe('Surrounding text context (for report mode)'),
        correct: z.boolean().optional().describe('Whether the wikilink was correct (for report mode)'),
        limit: z.number().optional().describe('Max entries to return for list mode (default: 20)'),
      },
    },
    async ({ mode, entity, note_path, context, correct, limit }) => {
      const stateDb = getStateDb();
      if (!stateDb) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available' }) }],
        };
      }

      let result: FeedbackResult;

      switch (mode) {
        case 'report': {
          if (!entity || correct === undefined) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'entity and correct are required for report mode' }) }],
            };
          }

          try {
            recordFeedback(stateDb, entity, context || '', note_path || '', correct);
          } catch (e) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: `Failed to record feedback: ${e instanceof Error ? e.message : String(e)}`
              }) }],
            };
          }
          const suppressionUpdated = updateSuppressionList(stateDb) > 0;

          result = {
            mode: 'report',
            reported: {
              entity,
              correct,
              suppression_updated: suppressionUpdated,
            },
            total_suppressed: getSuppressedCount(stateDb),
          };
          break;
        }

        case 'list': {
          const entries = getFeedback(stateDb, entity, limit ?? 20);
          result = {
            mode: 'list',
            entries,
            total_feedback: entries.length,
          };
          break;
        }

        case 'stats': {
          const stats = getEntityStats(stateDb);
          result = {
            mode: 'stats',
            stats,
            total_feedback: stats.reduce((sum, s) => sum + s.total, 0),
            total_suppressed: getSuppressedCount(stateDb),
          };
          break;
        }

        case 'dashboard': {
          const dashboard = getDashboardData(stateDb);
          result = {
            mode: 'dashboard',
            dashboard,
            total_feedback: dashboard.total_feedback,
            total_suppressed: dashboard.total_suppressed,
          };
          break;
        }
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );
}
