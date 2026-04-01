/**
 * Growth Metrics tools
 * Tools: vault_growth
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import {
  computeMetrics,
  getMetricHistory,
  computeTrends,
  type GrowthResult,
} from '../../core/shared/metrics.js';
import {
  getRecentIndexEvents,
  getIndexActivitySummary,
  compactPipelineRun,
} from '../../core/shared/indexActivity.js';

/**
 * Register growth metrics tools
 */
export function registerMetricsTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getStateDb: () => StateDb | null
): void {
  server.registerTool(
    'vault_growth',
    {
      title: 'Vault Growth',
      description:
        'Use when tracking how the vault is growing over time. Produces vault metrics in current, history, trends, or index activity modes. Returns numeric growth data with time-series comparisons. Does not modify vault content — measures and records metric snapshots only.',
      inputSchema: {
        mode: z.enum(['current', 'history', 'trends', 'index_activity']).describe('Query mode: current snapshot, historical time series, trend analysis, or index rebuild activity'),
        metric: z.string().optional().describe('Filter to specific metric (e.g., "note_count"). Omit for all metrics.'),
        days_back: z.number().optional().describe('Number of days to look back for history/trends (default: 30)'),
        limit: z.number().optional().describe('Number of recent events to return for index_activity mode (default: 20)'),
      },
    },
    async ({ mode, metric, days_back, limit: eventLimit }) => {
      const index = getIndex();
      const stateDb = getStateDb();
      const daysBack = days_back ?? 30;

      let result: GrowthResult;

      switch (mode) {
        case 'current': {
          const metrics = computeMetrics(index, stateDb ?? undefined);
          result = {
            mode: 'current',
            metrics,
            recorded_at: Date.now(),
          };
          break;
        }

        case 'history': {
          if (!stateDb) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available for historical queries' }) }],
            };
          }
          const history = getMetricHistory(stateDb, metric, daysBack);
          result = {
            mode: 'history',
            history,
          };
          break;
        }

        case 'trends': {
          if (!stateDb) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available for trend analysis' }) }],
            };
          }
          const currentMetrics = computeMetrics(index, stateDb);
          const trends = computeTrends(stateDb, currentMetrics, daysBack);
          result = {
            mode: 'trends',
            trends,
          };
          break;
        }

        case 'index_activity': {
          if (!stateDb) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available for index activity queries' }) }],
            };
          }
          const summary = getIndexActivitySummary(stateDb);
          const recentEvents = getRecentIndexEvents(stateDb, eventLimit ?? 20);
          result = {
            mode: 'index_activity',
            index_activity: {
              summary,
              recent_events: recentEvents.map(e => ({
                id: e.id,
                timestamp: e.timestamp,
                trigger: e.trigger,
                duration_ms: e.duration_ms,
                success: e.success,
                note_count: e.note_count,
                files_changed: e.files_changed,
                error: e.error,
                ...(e.steps ? compactPipelineRun(e) : {}),
              })),
            },
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
