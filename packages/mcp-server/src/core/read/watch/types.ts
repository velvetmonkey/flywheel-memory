import type { IndexEventTrigger } from '../../shared/indexActivity.js';

/**
 * Types for the file watcher module
 */

/**
 * Configuration for the vault watcher
 */
export interface WatcherConfig {
  /** Debounce time in ms for per-path events (default: 200) */
  debounceMs: number;

  /** Flush interval for batched events (default: 1000) */
  flushMs: number;

  /** Maximum events per batch before forcing flush (default: 50) */
  batchSize: number;

  /** Force polling mode instead of native watchers (default: false) */
  usePolling: boolean;

  /** Polling interval when in polling mode (default: 10000 = 10 seconds) */
  pollInterval: number;
}

/**
 * Default watcher configuration
 */
export const DEFAULT_WATCHER_CONFIG: WatcherConfig = {
  debounceMs: 200,
  flushMs: 1000,
  batchSize: 50,
  usePolling: false,
  pollInterval: 10000,
};

/**
 * Parse watcher config from environment variables
 */
export function parseWatcherConfig(): WatcherConfig {
  const debounceMs = parseInt(process.env.FLYWHEEL_DEBOUNCE_MS || '');
  const flushMs = parseInt(process.env.FLYWHEEL_FLUSH_MS || '');
  const batchSize = parseInt(process.env.FLYWHEEL_BATCH_SIZE || '');
  const usePolling = process.env.FLYWHEEL_WATCH_POLL === 'true';
  const pollInterval = parseInt(process.env.FLYWHEEL_POLL_INTERVAL || '');

  return {
    debounceMs: Number.isFinite(debounceMs) && debounceMs > 0
      ? debounceMs
      : DEFAULT_WATCHER_CONFIG.debounceMs,
    flushMs: Number.isFinite(flushMs) && flushMs > 0
      ? flushMs
      : DEFAULT_WATCHER_CONFIG.flushMs,
    batchSize: Number.isFinite(batchSize) && batchSize > 0
      ? batchSize
      : DEFAULT_WATCHER_CONFIG.batchSize,
    usePolling,
    pollInterval: Number.isFinite(pollInterval) && pollInterval > 0
      ? pollInterval
      : DEFAULT_WATCHER_CONFIG.pollInterval,
  };
}

/**
 * Type of file event
 */
export type WatchEventType = 'add' | 'change' | 'unlink';

/**
 * Coalesced event type for processing
 */
export type CoalescedEventType = 'upsert' | 'delete' | 'rename';

/**
 * Raw file watch event
 */
export interface WatchEvent {
  type: WatchEventType;
  path: string;
  timestamp: number;
}

/**
 * Coalesced event ready for processing
 */
export interface CoalescedEvent {
  type: CoalescedEventType;
  path: string;
  originalEvents: WatchEvent[];
}

/**
 * Rename event: a file was moved from oldPath to newPath.
 * Detected when a 'delete' and an 'upsert' share the same file stem
 * within a 5-second timestamp window.
 */
export interface RenameEvent {
  type: 'rename';
  oldPath: string;
  newPath: string;
  timestamp: number;
}

/**
 * Batch of events to process
 */
export interface EventBatch {
  events: CoalescedEvent[];
  renames: RenameEvent[];
  timestamp: number;
}

/**
 * Watcher state
 */
export type WatcherState = 'starting' | 'ready' | 'rebuilding' | 'dirty' | 'error';

/**
 * Watcher status info
 */
export interface WatcherStatus {
  state: WatcherState;
  pendingEvents: number;
  lastRebuild: number | null;
  error: Error | null;
}

// =============================================================================
// Watcher + pipeline surface types (moved from index.ts / pipeline.ts so that
// vault-scope.ts and vault-types.ts can type against leaf modules — part of
// the arch-review S1 import-cycle collapse)
// =============================================================================

/**
 * Vault watcher instance
 */
export interface VaultWatcher {
  /** Current watcher status */
  readonly status: WatcherStatus;

  /** Start watching */
  start(): void;

  /** Stop watching */
  stop(): void;

  /** Force flush all pending events */
  flush(): void;

  /** Get pending event count */
  readonly pendingCount: number;
}

/** Live status of the watcher pipeline for a vault (process-local) */
export interface PipelineActivity {
  busy: boolean;
  trigger: IndexEventTrigger | null;
  started_at: number | null;
  current_step: string | null;
  completed_steps: number;
  total_steps: number;
  pending_events: number;
  last_completed_at: number | null;
  last_completed_trigger: IndexEventTrigger | null;
  last_completed_duration_ms: number | null;
  last_completed_files: number | null;
  last_completed_steps: string[];
}
