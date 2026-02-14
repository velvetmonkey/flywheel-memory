/**
 * Shared OperationLogger for Flywheel ecosystem
 *
 * Provides unified logging for both Flywheel (read) and Flywheel-Crank (write)
 * with session correlation, metrics aggregation, and privacy controls.
 */

import fs from 'fs/promises';
import path from 'path';
import type {
  OperationLogEntry,
  SessionMetrics,
  AggregatedMetrics,
  LoggingConfig,
  ProductId,
} from './types.js';
import { DEFAULT_LOGGING_CONFIG } from './types.js';
import { getSessionId } from './sessionManager.js';

/**
 * Shared operation logger
 */
export class OperationLogger {
  private config: LoggingConfig;
  private vaultPath: string;
  private product: ProductId;
  private writeQueue: OperationLogEntry[] = [];
  private flushTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(vaultPath: string, product: ProductId, config?: Partial<LoggingConfig>) {
    this.vaultPath = vaultPath;
    this.product = product;
    this.config = { ...DEFAULT_LOGGING_CONFIG, ...config };
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
  async log(entry: Omit<OperationLogEntry, 'ts' | 'product' | 'session'>): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const fullEntry: OperationLogEntry = {
      ...entry,
      ts: new Date().toISOString(),
      product: this.product,
      session: this.config.includeSessionIds ? getSessionId() : undefined,
    };

    // Apply privacy filters
    if (!this.config.includeToolNames) {
      fullEntry.tool = 'operation';
    }
    if (!this.config.includeDurations) {
      fullEntry.duration_ms = 0;
    }
    if (!this.config.includeResults) {
      delete fullEntry.results;
    }

    this.writeQueue.push(fullEntry);
    this.scheduleFlush();
  }

  /**
   * Wrap an async operation with automatic logging
   */
  async wrap<T>(
    tool: string,
    operation: () => Promise<T>,
    getDetails?: (result: T) => Partial<OperationLogEntry>
  ): Promise<T> {
    const startTime = Date.now();
    let success = true;
    let error: string | undefined;
    let result: T | undefined;

    try {
      result = await operation();
      return result;
    } catch (e) {
      success = false;
      error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      const duration_ms = Date.now() - startTime;
      const details = success && result !== undefined && getDetails
        ? getDetails(result)
        : {};

      await this.log({
        tool,
        vault: this.anonymizePath(this.vaultPath),
        duration_ms,
        success,
        error,
        ...details,
      });
    }
  }

  /**
   * Get metrics for current session
   */
  async getSessionMetrics(): Promise<SessionMetrics | null> {
    const sessionId = getSessionId();
    const entries = await this.readEntries();

    const sessionEntries = entries.filter(e => e.session === sessionId);
    if (sessionEntries.length === 0) {
      return null;
    }

    const operations = {
      flywheel: {} as Record<string, number>,
      crank: {} as Record<string, number>,
    };

    let successCount = 0;
    let minTs = sessionEntries[0].ts;
    let maxTs = sessionEntries[0].ts;

    for (const entry of sessionEntries) {
      const prod = entry.product;
      operations[prod][entry.tool] = (operations[prod][entry.tool] || 0) + 1;

      if (entry.success) successCount++;
      if (entry.ts < minTs) minTs = entry.ts;
      if (entry.ts > maxTs) maxTs = entry.ts;
    }

    return {
      session: sessionId,
      duration_ms: new Date(maxTs).getTime() - new Date(minTs).getTime(),
      operations,
      total_operations: sessionEntries.length,
      success_rate: (successCount / sessionEntries.length) * 100,
      started: minTs,
      ended: maxTs,
    };
  }

  /**
   * Get aggregated metrics for time period
   */
  async getMetrics(since?: Date, until?: Date): Promise<AggregatedMetrics> {
    const entries = await this.readEntries();

    const filtered = entries.filter(e => {
      const ts = new Date(e.ts);
      if (since && ts < since) return false;
      if (until && ts > until) return false;
      return true;
    });

    const durations = filtered.map(e => e.duration_ms);
    const sorted = [...durations].sort((a, b) => a - b);

    const byTool: AggregatedMetrics['byTool'] = {};
    const byProduct: AggregatedMetrics['byProduct'] = {
      flywheel: { count: 0, success_rate: 0, mean_ms: 0 },
      crank: { count: 0, success_rate: 0, mean_ms: 0 },
    };

    const productDurations: Record<ProductId, number[]> = {
      flywheel: [],
      crank: [],
    };
    const productSuccess: Record<ProductId, number> = {
      flywheel: 0,
      crank: 0,
    };

    for (const entry of filtered) {
      // By tool
      if (!byTool[entry.tool]) {
        byTool[entry.tool] = {
          count: 0,
          success_rate: 0,
          mean_ms: 0,
          p95_ms: 0,
        };
      }
      byTool[entry.tool].count++;

      // By product
      byProduct[entry.product].count++;
      productDurations[entry.product].push(entry.duration_ms);
      if (entry.success) {
        productSuccess[entry.product]++;
      }
    }

    // Calculate product metrics
    for (const prod of ['flywheel', 'crank'] as ProductId[]) {
      const ds = productDurations[prod];
      if (ds.length > 0) {
        byProduct[prod].mean_ms = ds.reduce((a, b) => a + b, 0) / ds.length;
        byProduct[prod].success_rate = (productSuccess[prod] / ds.length) * 100;
      }
    }

    // Calculate tool metrics
    for (const tool of Object.keys(byTool)) {
      const toolEntries = filtered.filter(e => e.tool === tool);
      const toolDurations = toolEntries.map(e => e.duration_ms).sort((a, b) => a - b);
      const successCount = toolEntries.filter(e => e.success).length;

      byTool[tool].mean_ms = toolDurations.reduce((a, b) => a + b, 0) / toolDurations.length;
      byTool[tool].success_rate = (successCount / toolEntries.length) * 100;
      byTool[tool].p95_ms = toolDurations[Math.floor(toolDurations.length * 0.95)] || 0;
    }

    const successCount = filtered.filter(e => e.success).length;

    return {
      periodStart: since?.toISOString() || filtered[0]?.ts || new Date().toISOString(),
      periodEnd: until?.toISOString() || filtered[filtered.length - 1]?.ts || new Date().toISOString(),
      totalOperations: filtered.length,
      successfulOperations: successCount,
      failedOperations: filtered.length - successCount,
      timing: {
        mean_ms: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
        p50_ms: sorted[Math.floor(sorted.length * 0.5)] || 0,
        p95_ms: sorted[Math.floor(sorted.length * 0.95)] || 0,
        p99_ms: sorted[Math.floor(sorted.length * 0.99)] || 0,
        min_ms: sorted[0] || 0,
        max_ms: sorted[sorted.length - 1] || 0,
      },
      byTool,
      byProduct,
    };
  }

  /**
   * Flush write queue to disk
   */
  async flush(): Promise<void> {
    if (this.writeQueue.length === 0) {
      return;
    }

    const entries = this.writeQueue.splice(0, this.writeQueue.length);
    const logPath = path.join(this.vaultPath, this.config.logPath);

    // Ensure directory exists
    await fs.mkdir(path.dirname(logPath), { recursive: true });

    // Append entries as JSONL
    const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
    await fs.appendFile(logPath, lines);
  }

  /**
   * Read all log entries
   */
  private async readEntries(): Promise<OperationLogEntry[]> {
    const logPath = path.join(this.vaultPath, this.config.logPath);

    try {
      const content = await fs.readFile(logPath, 'utf-8');
      const entries: OperationLogEntry[] = [];

      for (const line of content.split('\n')) {
        if (line.trim()) {
          try {
            entries.push(JSON.parse(line));
          } catch {
            // Skip malformed lines
          }
        }
      }

      return entries;
    } catch {
      return [];
    }
  }

  /**
   * Anonymize vault path for privacy
   */
  private anonymizePath(vaultPath: string): string {
    // Use last directory name only
    return path.basename(vaultPath);
  }

  /**
   * Schedule a flush with debounce
   */
  private scheduleFlush(): void {
    if (this.flushTimeout) {
      return;
    }

    this.flushTimeout = setTimeout(async () => {
      this.flushTimeout = null;
      await this.flush();
    }, 1000); // 1 second debounce
  }
}

/**
 * Create logger from vault's .flywheel.json config
 */
export async function createLoggerFromConfig(
  vaultPath: string,
  product: ProductId
): Promise<OperationLogger> {
  const configPath = path.join(vaultPath, '.flywheel.json');

  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content);
    return new OperationLogger(vaultPath, product, config.logging);
  } catch {
    // No config or invalid - use defaults
    return new OperationLogger(vaultPath, product);
  }
}
