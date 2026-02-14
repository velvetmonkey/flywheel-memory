/**
 * Operation logger - main logging interface
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { OperationLogEntry, AggregatedMetrics, LoggingConfig, FlywheelConfig, ToolMetrics } from './types.js';
import { DEFAULT_FLYWHEEL_CONFIG } from './types.js';
import { OperationLogWriter, readOperationLog } from './operationLog.js';

/**
 * Main operation logger
 */
export class OperationLogger {
  private writer: OperationLogWriter;
  private config: LoggingConfig;

  constructor(config: LoggingConfig) {
    this.config = config;
    this.writer = new OperationLogWriter(config);
  }

  /**
   * Check if logging is enabled
   */
  get enabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Log an operation
   */
  async logOperation(
    tool: string,
    vault: string,
    duration_ms: number,
    success: boolean,
    details?: Partial<Omit<OperationLogEntry, 'timestamp' | 'tool' | 'vault' | 'duration_ms' | 'success'>>
  ): Promise<void> {
    const entry: OperationLogEntry = {
      timestamp: new Date().toISOString(),
      tool,
      vault,
      duration_ms,
      success,
      ...details
    };

    await this.writer.write(entry);
  }

  /**
   * Wrap an async operation with logging
   */
  async wrap<T>(
    tool: string,
    vault: string,
    operation: () => Promise<T>,
    getDetails?: (result: T) => Partial<OperationLogEntry>
  ): Promise<T> {
    const start = performance.now();
    let success = true;
    let error: string | undefined;
    let result: T;

    try {
      result = await operation();
    } catch (e) {
      success = false;
      error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      const duration_ms = performance.now() - start;
      const details = success && getDetails && result! ? getDetails(result!) : {};

      await this.logOperation(tool, vault, duration_ms, success, {
        ...details,
        error
      });
    }

    return result!;
  }

  /**
   * Get metrics for a time period
   */
  async getMetrics(since?: Date, until?: Date): Promise<AggregatedMetrics> {
    const entries = await readOperationLog(this.config.logPath, { since, until });
    return aggregateMetrics(entries, since, until);
  }

  /**
   * Get metrics for a specific tool
   */
  async getToolMetrics(tool: string, since?: Date): Promise<ToolMetrics | null> {
    const entries = await readOperationLog(this.config.logPath, { since, tool });

    if (entries.length === 0) return null;

    const successful = entries.filter(e => e.success);
    const durations = entries.map(e => e.duration_ms).sort((a, b) => a - b);

    return {
      count: entries.length,
      success_rate: successful.length / entries.length,
      mean_ms: durations.reduce((a, b) => a + b, 0) / durations.length,
      p95_ms: durations[Math.floor(durations.length * 0.95)] || 0
    };
  }
}

/**
 * Aggregate metrics from log entries
 */
function aggregateMetrics(
  entries: OperationLogEntry[],
  since?: Date,
  until?: Date
): AggregatedMetrics {
  const timestamps = entries.map(e => e.timestamp);

  const period = {
    start: since?.toISOString() || timestamps[0] || new Date().toISOString(),
    end: until?.toISOString() || timestamps[timestamps.length - 1] || new Date().toISOString()
  };

  const successful = entries.filter(e => e.success);
  const durations = entries.map(e => e.duration_ms).sort((a, b) => a - b);

  // Calculate timing stats
  const timing = {
    mean_ms: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
    p50_ms: durations[Math.floor(durations.length * 0.5)] || 0,
    p95_ms: durations[Math.floor(durations.length * 0.95)] || 0,
    p99_ms: durations[Math.floor(durations.length * 0.99)] || 0
  };

  // Group by tool
  const byTool: Record<string, ToolMetrics> = {};
  const toolGroups = new Map<string, OperationLogEntry[]>();

  for (const entry of entries) {
    const group = toolGroups.get(entry.tool) || [];
    group.push(entry);
    toolGroups.set(entry.tool, group);
  }

  for (const [tool, group] of toolGroups) {
    const toolSuccessful = group.filter(e => e.success);
    const toolDurations = group.map(e => e.duration_ms).sort((a, b) => a - b);

    byTool[tool] = {
      count: group.length,
      success_rate: toolSuccessful.length / group.length,
      mean_ms: toolDurations.reduce((a, b) => a + b, 0) / toolDurations.length,
      p95_ms: toolDurations[Math.floor(toolDurations.length * 0.95)] || 0
    };
  }

  return {
    period,
    operations: {
      total: entries.length,
      successful: successful.length,
      failed: entries.length - successful.length
    },
    timing,
    byTool
  };
}

/**
 * Load flywheel config from vault
 */
export async function loadFlywheelConfig(vaultPath: string): Promise<FlywheelConfig> {
  const configPath = path.join(vaultPath, '.flywheel.json');

  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const userConfig = JSON.parse(content);
    return { ...DEFAULT_FLYWHEEL_CONFIG, ...userConfig };
  } catch {
    return DEFAULT_FLYWHEEL_CONFIG;
  }
}

/**
 * Create a logger from vault config
 */
export async function createLoggerFromVault(vaultPath: string): Promise<OperationLogger> {
  const config = await loadFlywheelConfig(vaultPath);

  const loggingConfig: LoggingConfig = {
    enabled: config.enableUsageLogging || false,
    logPath: path.join(vaultPath, config.logPath || '.flywheel/operation-log.jsonl'),
    rotation: config.maxLogSize ? {
      maxSize_mb: config.maxLogSize,
      maxFiles: config.maxLogFiles || 5
    } : undefined,
    privacy: {
      logNoteTitles: config.logNoteTitles || false,
      logContent: false
    }
  };

  return new OperationLogger(loggingConfig);
}

/**
 * Format metrics as a report
 */
export function formatMetricsReport(metrics: AggregatedMetrics): string {
  const lines: string[] = [
    '# Operation Metrics',
    '',
    `**Period:** ${metrics.period.start} to ${metrics.period.end}`,
    '',
    '## Summary',
    '',
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Total Operations | ${metrics.operations.total} |`,
    `| Successful | ${metrics.operations.successful} |`,
    `| Failed | ${metrics.operations.failed} |`,
    `| Success Rate | ${((metrics.operations.successful / metrics.operations.total) * 100).toFixed(1)}% |`,
    '',
    '## Timing',
    '',
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Mean | ${metrics.timing.mean_ms.toFixed(2)}ms |`,
    `| P50 | ${metrics.timing.p50_ms.toFixed(2)}ms |`,
    `| P95 | ${metrics.timing.p95_ms.toFixed(2)}ms |`,
    `| P99 | ${metrics.timing.p99_ms.toFixed(2)}ms |`,
    '',
    '## By Tool',
    '',
    `| Tool | Count | Success Rate | Mean | P95 |`,
    `| --- | --- | --- | --- | --- |`
  ];

  for (const [tool, tm] of Object.entries(metrics.byTool)) {
    lines.push(`| ${tool} | ${tm.count} | ${(tm.success_rate * 100).toFixed(1)}% | ${tm.mean_ms.toFixed(2)}ms | ${tm.p95_ms.toFixed(2)}ms |`);
  }

  return lines.join('\n');
}
