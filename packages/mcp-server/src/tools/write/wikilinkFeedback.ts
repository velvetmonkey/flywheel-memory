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
  getEntityScoreTimeline,
  getLayerContributionTimeseries,
  getExtendedDashboardData,
  type FeedbackResult,
} from '../../core/write/wikilinkFeedback.js';
import { compareGraphSnapshots } from '../../core/shared/graphSnapshots.js';

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
        'Report and query wikilink accuracy feedback. Modes: "report" (record feedback), "list" (view recent feedback), "stats" (entity accuracy statistics), "dashboard" (full feedback loop data), "entity_timeline" (score history for an entity), "layer_timeseries" (per-layer contribution over time), "snapshot_diff" (compare two graph snapshots).',
      inputSchema: {
        mode: z.enum(['report', 'list', 'stats', 'dashboard', 'entity_timeline', 'layer_timeseries', 'snapshot_diff']).describe('Operation mode'),
        entity: z.string().optional().describe('Entity name (required for report and entity_timeline modes, optional filter for list/stats)'),
        note_path: z.string().optional().describe('Note path where the wikilink appeared (for report mode)'),
        context: z.string().optional().describe('Surrounding text context (for report mode)'),
        correct: z.boolean().optional().describe('Whether the wikilink was correct (for report mode)'),
        limit: z.number().optional().describe('Max entries to return (default: 20 for list, 100 for entity_timeline)'),
        days_back: z.number().optional().describe('Days to look back (default: 30)'),
        granularity: z.enum(['day', 'week']).optional().describe('Time bucket granularity for layer_timeseries (default: day)'),
        timestamp_before: z.number().optional().describe('Earlier timestamp for snapshot_diff'),
        timestamp_after: z.number().optional().describe('Later timestamp for snapshot_diff'),
      },
    },
    async ({ mode, entity, note_path, context, correct, limit, days_back, granularity, timestamp_before, timestamp_after }) => {
      const stateDb = getStateDb();
      if (!stateDb) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available — database not initialized yet' }) }],
          isError: true,
        };
      }

      let result: FeedbackResult | Record<string, unknown>;

      switch (mode) {
        case 'report': {
          console.error(`[Flywheel] wikilink_feedback report: entity="${entity}" correct=${JSON.stringify(correct)} (type: ${typeof correct})`);
          if (!entity || correct === undefined) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'entity and correct are required for report mode' }) }],
              isError: true,
            };
          }

          try {
            recordFeedback(stateDb, entity, context || '', note_path || '', correct);
          } catch (e) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: `Failed to record feedback: ${e instanceof Error ? e.message : String(e)}`
              }) }],
              isError: true,
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
          const dashboard = getExtendedDashboardData(stateDb);
          result = {
            mode: 'dashboard',
            dashboard,
            total_feedback: dashboard.total_feedback,
            total_suppressed: dashboard.total_suppressed,
          };
          break;
        }

        case 'entity_timeline': {
          if (!entity) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'entity is required for entity_timeline mode' }) }],
            };
          }
          const timeline = getEntityScoreTimeline(stateDb, entity, days_back ?? 30, limit ?? 100);
          result = {
            mode: 'entity_timeline',
            entity,
            timeline,
            count: timeline.length,
          };
          break;
        }

        case 'layer_timeseries': {
          const timeseries = getLayerContributionTimeseries(stateDb, granularity ?? 'day', days_back ?? 30);
          result = {
            mode: 'layer_timeseries',
            granularity: granularity ?? 'day',
            timeseries,
            buckets: timeseries.length,
          };
          break;
        }

        case 'snapshot_diff': {
          if (!timestamp_before || !timestamp_after) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'timestamp_before and timestamp_after are required for snapshot_diff mode' }) }],
            };
          }
          const diff = compareGraphSnapshots(stateDb, timestamp_before, timestamp_after);
          result = {
            mode: 'snapshot_diff',
            diff,
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
