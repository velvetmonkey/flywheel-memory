/**
 * Shared logging types for Flywheel ecosystem
 *
 * Used by both Flywheel (read) and Flywheel Memory (write) for
 * unified operation logging and metrics.
 */

/**
 * Product identifier for log entries
 */
export type ProductId = 'flywheel' | 'write';

/**
 * Single operation log entry
 */
export interface OperationLogEntry {
  /** ISO timestamp */
  ts: string;
  /** Product that performed the operation */
  product: ProductId;
  /** Tool/function name */
  tool: string;
  /** Vault path (may be anonymized) */
  vault: string;
  /** Duration in milliseconds */
  duration_ms: number;
  /** Whether operation succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Session ID for workflow correlation */
  session?: string;
  /** Number of results returned (for queries) */
  results?: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Session metrics for workflow tracking
 */
export interface SessionMetrics {
  /** Session ID */
  session: string;
  /** Total duration in ms */
  duration_ms: number;
  /** Operations by product */
  operations: {
    flywheel: Record<string, number>;
    write: Record<string, number>;
  };
  /** Total operation count */
  total_operations: number;
  /** Success rate (0-100) */
  success_rate: number;
  /** First operation timestamp */
  started: string;
  /** Last operation timestamp */
  ended: string;
}

/**
 * Aggregated metrics over time period
 */
export interface AggregatedMetrics {
  /** Period start (ISO) */
  periodStart: string;
  /** Period end (ISO) */
  periodEnd: string;
  /** Total operations */
  totalOperations: number;
  /** Successful operations */
  successfulOperations: number;
  /** Failed operations */
  failedOperations: number;
  /** Timing stats */
  timing: {
    mean_ms: number;
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
    min_ms: number;
    max_ms: number;
  };
  /** Metrics by tool */
  byTool: Record<string, {
    count: number;
    success_rate: number;
    mean_ms: number;
    p95_ms: number;
  }>;
  /** Metrics by product */
  byProduct: Record<ProductId, {
    count: number;
    success_rate: number;
    mean_ms: number;
  }>;
}

/**
 * Logging configuration
 */
export interface LoggingConfig {
  /** Master switch (default: false) */
  enabled: boolean;
  /** Path to log file (relative to vault root) */
  logPath: string;
  /** Include tool names in logs */
  includeToolNames: boolean;
  /** Include timing data */
  includeDurations: boolean;
  /** Include session IDs for workflow correlation */
  includeSessionIds: boolean;
  /** Include result counts (may reveal vault size) */
  includeResults: boolean;
  /** Log rotation settings */
  rotation?: {
    maxSize: string; // e.g., "10MB"
    maxFiles: number;
  };
  /** Retention in days */
  retentionDays?: number;
}

/**
 * Default logging configuration (disabled by default)
 */
export const DEFAULT_LOGGING_CONFIG: LoggingConfig = {
  enabled: false,
  logPath: '.flywheel/operation-log.jsonl',
  includeToolNames: true,
  includeDurations: true,
  includeSessionIds: true,
  includeResults: false,
  rotation: {
    maxSize: '10MB',
    maxFiles: 5,
  },
  retentionDays: 30,
};
