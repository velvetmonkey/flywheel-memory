/**
 * Vault health tools — the merged `doctor` diagnostic/config tool.
 *
 * Registration + dispatch only — report, diagnosis, stats, and config
 * persistence live in core/diagnostics/ (arch-review S7).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex, FlywheelConfig } from '../../core/read/types.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import { getRecentIndexEvents, compactPipelineRun } from '../../core/shared/indexActivity.js';
import type { PipelineActivity, WatcherStatus } from '../../core/read/watch/types.js';
import { getServerLog } from '../../core/shared/serverLog.js';
import { buildHealthReport, type VaultRuntimeStateView } from '../../core/diagnostics/report.js';
import { runDiagnosis } from '../../core/diagnostics/diagnosis.js';
import { computeVaultStats } from '../../core/diagnostics/stats.js';
import { setConfigKey } from '../../core/diagnostics/configStore.js';

/**
 * Register vault health tools
 */
export function registerHealthTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string,
  getConfig: () => FlywheelConfig = () => ({}),
  getStateDb: () => StateDb | null = () => null,
  getWatcherStatus: () => WatcherStatus | null = () => null,
  getVersion: () => string = () => 'unknown',
  getPipelineActivityState: () => Readonly<PipelineActivity> | null = () => null,
  getVaultRuntimeState: () => VaultRuntimeStateView = () => ({
    bootState: 'booting',
    integrityState: 'unknown',
    integrityCheckInProgress: false,
    integrityStartedAt: null,
    integritySource: null,
    lastIntegrityCheckedAt: null,
    lastIntegrityDurationMs: null,
    lastIntegrityDetail: null,
    lastBackupAt: null,
  }),
  doctorSetConfig?: (config: FlywheelConfig) => void,
): void {
  const reportDeps = {
    getIndex, getVaultPath, getConfig, getStateDb,
    getWatcherStatus, getPipelineActivityState, getVaultRuntimeState,
  };

  // doctor — Merged diagnostic/config tool (T43 B3+)
  // Absorbs: flywheel_doctor (health) + pipeline_status + server_log + flywheel_config
  server.registerTool(
    'doctor',
    {
      title: 'Doctor',
      description: `Use for diagnostics and runtime management. Returns vault health, named checks, stats, pipeline status, server log, or config. Does not read note content — use read or search for that. action: health | diagnosis | stats | pipeline | config | log`,
      inputSchema: {
        action: z.enum(['health', 'diagnosis', 'stats', 'pipeline', 'config', 'log'])
          .describe('Operation: health=vault status, pipeline=indexing status, config=runtime config, log=activity log'),
        // [health]
        detail: z.union([z.enum(['summary', 'full']), z.boolean()]).optional()
          .describe('[health] Detail level: summary or full. [pipeline] true = include per-step timings'),
        // [config]
        mode: z.enum(['get', 'set']).optional().describe('[config] Operation: get or set'),
        key: z.string().optional().describe('[config] Config key to update (required for set)'),
        value: z.unknown().optional().describe('[config] New value for the key (required for set)'),
        // [log]
        since: z.coerce.number().optional().describe('[log] Only return entries after this Unix timestamp (ms)'),
        component: z.string().optional().describe('[log] Filter by component (server, index, fts5, semantic, tasks, watcher, statedb, config)'),
        limit: z.coerce.number().optional().describe('[log] Max entries to return (default 100)'),
      },
    },
    async ({ action, detail, mode, key, value, since, component, limit }) => {
      switch (action) {
        case 'health': {
          const detailLevel = (typeof detail === 'string' ? detail : 'summary') as 'summary' | 'full';
          const output = await buildHealthReport(reportDeps, detailLevel);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
          };
        }

        case 'diagnosis': {
          const diagOutput = runDiagnosis({ getIndex, getVaultPath, getStateDb, getWatcherStatus });
          return { content: [{ type: 'text' as const, text: JSON.stringify(diagOutput, null, 2) }] };
        }

        case 'pipeline': {
          const includeDetail = typeof detail === 'boolean' ? detail : false;
          const activity = getPipelineActivityState();
          const now = Date.now();
          const runtimeState = getVaultRuntimeState();

          const output: Record<string, unknown> = {
            busy: activity?.busy ?? false,
            trigger: activity?.trigger ?? null,
            started_at: activity?.started_at ?? null,
            age_ms: activity?.busy && activity.started_at ? now - activity.started_at : null,
            current_step: activity?.current_step ?? null,
            progress: activity && activity.busy && activity.total_steps > 0
              ? `${activity.completed_steps}/${activity.total_steps} steps`
              : null,
            pending_events: activity?.pending_events ?? 0,
            boot_state: runtimeState.bootState,
            integrity_state: runtimeState.integrityState,
            integrity_check_in_progress: runtimeState.integrityCheckInProgress,
            last_completed: activity?.last_completed_at ? {
              at: activity.last_completed_at,
              ago_seconds: Math.floor((now - activity.last_completed_at) / 1000),
              trigger: activity.last_completed_trigger,
              duration_ms: activity.last_completed_duration_ms,
              files: activity.last_completed_files,
              steps: activity.last_completed_steps,
            } : null,
          };

          if (includeDetail) {
            const stateDb = getStateDb();
            if (stateDb) {
              try {
                const events = getRecentIndexEvents(stateDb, 10)
                  .filter(e => e.steps && e.steps.length > 0)
                  .slice(0, 5);
                output.recent_runs = events.map(e => compactPipelineRun(e));
              } catch { /* ignore */ }
            }
          }

          return { content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }] };
        }

        case 'config': {
          if (!mode || mode === 'get') {
            return { content: [{ type: 'text' as const, text: JSON.stringify(getConfig(), null, 2) }] };
          }
          // mode === 'set'
          if (!key) {
            return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'key is required for set mode' }) }] };
          }
          const result = setConfigKey(getStateDb(), getConfig(), key, value);
          if ('error' in result) {
            return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }] };
          }
          if (doctorSetConfig) doctorSetConfig(result.config);
          if (result.deprecatedWarning) {
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  config: result.config,
                  warning: result.deprecatedWarning,
                }, null, 2),
              }],
            };
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(result.config, null, 2) }] };
        }

        case 'stats': {
          const output = computeVaultStats(getIndex());
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
          };
        }

        case 'log': {
          const result = getServerLog({ since, component, limit });
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        }
      }
    }
  );

}
