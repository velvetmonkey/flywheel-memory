/**
 * Logging types - Operation logging for metrics and debugging
 */

export interface LoggingConfig {
  /** Enable operation logging */
  enabled: boolean;
  /** Path to log file */
  logPath: string;
  /** Log rotation settings */
  rotation?: {
    maxSize_mb: number;
    maxFiles: number;
  };
  /** Privacy settings */
  privacy?: {
    logNoteTitles: boolean;
    logContent: boolean;
  };
}

export interface OperationLogEntry {
  /** ISO timestamp */
  timestamp: string;
  /** Tool name (e.g., vault_add_to_section) */
  tool: string;
  /** Vault path (anonymized if privacy enabled) */
  vault: string;
  /** Operation duration in milliseconds */
  duration_ms: number;
  /** Number of entities scanned (if applicable) */
  entities_scanned?: number;
  /** Number of notes affected */
  notes_affected?: number;
  /** Whether the operation succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface AggregatedMetrics {
  /** Time period for aggregation */
  period: {
    start: string;
    end: string;
  };
  /** Operation counts */
  operations: {
    total: number;
    successful: number;
    failed: number;
  };
  /** Timing statistics */
  timing: {
    mean_ms: number;
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
  };
  /** Per-tool metrics */
  byTool: Record<string, ToolMetrics>;
}

export interface ToolMetrics {
  count: number;
  success_rate: number;
  mean_ms: number;
  p95_ms: number;
}

export interface FlywheelConfig {
  /** Enable usage logging (default: false) */
  enableUsageLogging?: boolean;
  /** Log file path (default: .flywheel/operation-log.jsonl) */
  logPath?: string;
  /** Log note titles (default: false) */
  logNoteTitles?: boolean;
  /** Maximum log file size before rotation (MB) */
  maxLogSize?: number;
  /** Number of rotated log files to keep */
  maxLogFiles?: number;
}

export const DEFAULT_FLYWHEEL_CONFIG: FlywheelConfig = {
  enableUsageLogging: false,
  logPath: '.flywheel/operation-log.jsonl',
  logNoteTitles: false,
  maxLogSize: 10,
  maxLogFiles: 5
};
