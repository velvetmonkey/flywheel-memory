/**
 * Calibration Export Tool — flywheel_calibration_export
 *
 * Anonymized aggregate scoring data for cross-vault algorithm calibration.
 * No entity names, note paths, or content — safe to share.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import type { FlywheelConfig } from '../../core/read/config.js';
import { getCalibrationExport } from '../../core/read/calibrationExport.js';
import { computeMetrics } from '../../core/shared/metrics.js';

export function registerCalibrationExportTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getStateDb: () => StateDb | null,
  getConfig: () => FlywheelConfig,
): void {
  server.tool(
    'flywheel_calibration_export',
    'Export anonymized aggregate scoring data for cross-vault algorithm calibration. No entity names, note paths, or content — safe to share. Includes: suggestion funnel, per-layer contribution averages, survival rates by entity category, score distribution, suppression stats, recency/co-occurrence effectiveness, and threshold sweep.',
    {
      days_back: z.number().min(1).max(365).optional()
        .describe('Analysis window in days (default: 30)'),
      include_vault_id: z.boolean().optional()
        .describe('Include anonymous vault ID for longitudinal tracking (default: true)'),
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
      const config = getConfig();

      const report = getCalibrationExport(
        stateDb,
        metrics,
        config,
        args.days_back ?? 30,
        args.include_vault_id ?? true,
      );

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }],
      };
    },
  );
}
