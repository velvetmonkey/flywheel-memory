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
        'Track vault growth over time. Modes: "current" (live snapshot), "history" (time series), "trends" (deltas vs N days ago). Tracks 8 metrics: note_count, link_count, orphan_count, tag_count, entity_count, avg_links_per_note, link_density, connected_ratio.',
      inputSchema: {
        mode: z.enum(['current', 'history', 'trends']).describe('Query mode: current snapshot, historical time series, or trend analysis'),
        metric: z.string().optional().describe('Filter to specific metric (e.g., "note_count"). Omit for all metrics.'),
        days_back: z.number().optional().describe('Number of days to look back for history/trends (default: 30)'),
      },
    },
    async ({ mode, metric, days_back }) => {
      const index = getIndex();
      const stateDb = getStateDb();
      const daysBack = days_back ?? 30;

      let result: GrowthResult;

      switch (mode) {
        case 'current': {
          const metrics = computeMetrics(index);
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
          const currentMetrics = computeMetrics(index);
          const trends = computeTrends(stateDb, currentMetrics, daysBack);
          result = {
            mode: 'trends',
            trends,
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
