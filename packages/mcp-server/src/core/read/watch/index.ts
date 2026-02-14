/**
 * Vault file watcher
 *
 * Battle-hardened file watcher for Obsidian vaults with:
 * - Per-path debouncing
 * - Event coalescing
 * - Aggressive path filtering
 * - Backpressure handling
 * - Error recovery
 */

import chokidar, { FSWatcher } from 'chokidar';
import { EventQueue } from './eventQueue.js';
import { shouldWatch, createIgnoreFunction } from './pathFilter.js';
import {
  WatcherConfig,
  WatcherState,
  WatcherStatus,
  EventBatch,
  parseWatcherConfig,
  DEFAULT_WATCHER_CONFIG,
} from './types.js';

export { WatcherConfig, WatcherStatus, EventBatch, parseWatcherConfig, DEFAULT_WATCHER_CONFIG };
export { shouldWatch, normalizePath, getRelativePath } from './pathFilter.js';
export { processBatch, createBatchProcessor, type BatchProcessorOptions, type BatchProcessResult } from './batchProcessor.js';
export { upsertNote, deleteNote, type IncrementalUpdateResult } from './incrementalIndex.js';
export { SelfHealingWatcher, determineRecoveryAction, type RecoveryAction, type SelfHealState } from './selfHeal.js';

/**
 * Callback for processing event batches
 */
export type BatchHandler = (batch: EventBatch) => Promise<void>;

/**
 * Options for creating a vault watcher
 */
export interface CreateWatcherOptions {
  /** Path to the vault root */
  vaultPath: string;

  /** Watcher configuration (uses defaults if not provided) */
  config?: Partial<WatcherConfig>;

  /** Callback for processing event batches */
  onBatch: BatchHandler;

  /** Callback for state changes */
  onStateChange?: (status: WatcherStatus) => void;

  /** Callback for errors */
  onError?: (error: Error) => void;
}

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

/**
 * Create a vault watcher
 */
export function createVaultWatcher(options: CreateWatcherOptions): VaultWatcher {
  const { vaultPath, onBatch, onStateChange, onError } = options;

  // Merge config with defaults
  const config: WatcherConfig = {
    ...DEFAULT_WATCHER_CONFIG,
    ...parseWatcherConfig(),
    ...options.config,
  };

  let state: WatcherState = 'starting';
  let lastRebuild: number | null = null;
  let error: Error | null = null;
  let watcher: FSWatcher | null = null;
  let processingBatch = false;
  let pendingBatches: EventBatch[] = [];

  // Create status object
  const getStatus = (): WatcherStatus => ({
    state,
    pendingEvents: eventQueue?.eventCount || 0,
    lastRebuild,
    error,
  });

  // State change helper
  const setState = (newState: WatcherState, newError: Error | null = null) => {
    state = newState;
    error = newError;
    onStateChange?.(getStatus());
  };

  // Process a batch with backpressure
  const processBatch = async (batch: EventBatch) => {
    if (processingBatch) {
      // Queue the batch for later
      pendingBatches.push(batch);
      return;
    }

    processingBatch = true;
    setState('rebuilding');

    try {
      await onBatch(batch);
      lastRebuild = Date.now();
      setState('ready');
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setState('error', e);
      onError?.(e);
    } finally {
      processingBatch = false;

      // Process queued batches
      if (pendingBatches.length > 0) {
        const nextBatch = pendingBatches.shift()!;
        // Use setImmediate to prevent stack overflow
        setImmediate(() => processBatch(nextBatch));
      }
    }
  };

  // Create event queue
  const eventQueue = new EventQueue(config, processBatch);

  // Watcher instance
  const instance: VaultWatcher = {
    get status() {
      return getStatus();
    },

    get pendingCount() {
      return eventQueue.eventCount + pendingBatches.reduce((sum, b) => sum + b.events.length, 0);
    },

    start() {
      if (watcher) {
        console.error('[flywheel] Watcher already started');
        return;
      }

      console.error(`[flywheel] Starting file watcher (debounce: ${config.debounceMs}ms, flush: ${config.flushMs}ms)`);
      console.error(`[flywheel] Chokidar options: usePolling=${config.usePolling}, interval=${config.pollInterval}, vaultPath=${vaultPath}`);

      // Create chokidar watcher
      watcher = chokidar.watch(vaultPath, {
        ignored: createIgnoreFunction(vaultPath),
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100,
        },
        usePolling: config.usePolling,
        interval: config.usePolling ? config.pollInterval : undefined,
      });

      // Handle events
      watcher.on('add', (path) => {
        console.error(`[flywheel] RAW EVENT: add ${path}`);
        if (shouldWatch(path, vaultPath)) {
          console.error(`[flywheel] ACCEPTED: add ${path}`);
          eventQueue.push('add', path);
        } else {
          console.error(`[flywheel] FILTERED: add ${path}`);
        }
      });

      watcher.on('change', (path) => {
        console.error(`[flywheel] RAW EVENT: change ${path}`);
        if (shouldWatch(path, vaultPath)) {
          console.error(`[flywheel] ACCEPTED: change ${path}`);
          eventQueue.push('change', path);
        } else {
          console.error(`[flywheel] FILTERED: change ${path}`);
        }
      });

      watcher.on('unlink', (path) => {
        console.error(`[flywheel] RAW EVENT: unlink ${path}`);
        if (shouldWatch(path, vaultPath)) {
          console.error(`[flywheel] ACCEPTED: unlink ${path}`);
          eventQueue.push('unlink', path);
        } else {
          console.error(`[flywheel] FILTERED: unlink ${path}`);
        }
      });

      // Handle watcher ready
      watcher.on('ready', () => {
        console.error('[flywheel] File watcher ready');
        setState('ready');
      });

      // Handle watcher errors
      watcher.on('error', (err) => {
        console.error('[flywheel] Watcher error:', err);
        const e = err instanceof Error ? err : new Error(String(err));
        setState('error', e);
        onError?.(e);
      });
    },

    stop() {
      if (!watcher) {
        return;
      }

      console.error('[flywheel] Stopping file watcher');

      // Flush pending events
      eventQueue.flush();

      // Close watcher
      watcher.close();
      watcher = null;

      // Clear queue
      eventQueue.dispose();
    },

    flush() {
      eventQueue.flush();
    },
  };

  return instance;
}
