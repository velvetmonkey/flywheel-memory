/**
 * Learning Report Tool — flywheel_learning_report
 *
 * Single-call narrative of the flywheel's learning progress:
 * applications, feedback, survival, rejections, funnel, graph growth.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import { getLearningReport } from '../../core/read/learningReport.js';
import { computeMetrics } from '../../core/shared/metrics.js';

export function registerLearningReportTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getStateDb: () => StateDb | null,
): void {
  server.tool(
    'flywheel_learning_report',
    'Get a narrative report of the flywheel auto-linking system\'s learning progress. Shows: applications by day, feedback (positive/negative), survival rate, top rejected entities, suggestion funnel (evaluations → applications → survivals), and graph growth. Use compare=true for period-over-period deltas.',
    {
      days_back: z.number().min(1).max(365).optional()
        .describe('Analysis window in days (default: 7). Use 1 for today, 2 for last 48h, etc.'),
      compare: z.boolean().optional()
        .describe('Include comparison with the preceding equal-length period (default: false)'),
    },
    async (args) => {
      const stateDb = getStateDb();
      if (!stateDb) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available' }) }],
          isError: true,
        };
      }

      const index = getIndex();
      const metrics = computeMetrics(index, stateDb);

      const report = getLearningReport(
        stateDb,
        metrics.entity_count,
        metrics.link_count,
        args.days_back ?? 7,
        args.compare ?? false,
      );

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }],
      };
    },
  );
}
