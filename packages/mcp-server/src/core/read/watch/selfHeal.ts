/**
 * Self-healing watcher recovery
 *
 * Features:
 * - Detect watcher errors (EMFILE, ENFILE, etc.)
 * - Mark index as "dirty" during recovery
 * - Schedule rescan with exponential backoff
 * - Fallback to polling mode on persistent errors
 * - Keep serving stale data with warnings
 */

import type { WatcherState, WatcherStatus } from './types.js';

/** Initial retry delay in ms */
const INITIAL_RETRY_DELAY = 1000;

/** Maximum retry delay in ms */
const MAX_RETRY_DELAY = 60000;

/** Maximum retry attempts before giving up */
const MAX_RETRY_ATTEMPTS = 5;

/** Errors that indicate watcher resource exhaustion */
const RESOURCE_ERRORS = new Set(['EMFILE', 'ENFILE', 'ENOSPC', 'ENOMEM']);

/** Errors that indicate a bad watcher environment */
const ENVIRONMENT_ERRORS = new Set(['ENOTSUP', 'EPERM', 'EACCES']);

/**
 * Recovery action to take
 */
export type RecoveryAction =
  | { type: 'retry'; delay: number }
  | { type: 'fallback-polling' }
  | { type: 'give-up' };

/**
 * Self-heal state
 */
export interface SelfHealState {
  /** Current retry count */
  retryCount: number;

  /** Current retry delay */
  currentDelay: number;

  /** Whether index is marked dirty */
  isDirty: boolean;

  /** Last error encountered */
  lastError: Error | null;

  /** Whether we've fallen back to polling */
  isPollingFallback: boolean;

  /** Scheduled rescan timer */
  rescanTimer: NodeJS.Timeout | null;
}

/**
 * Create initial self-heal state
 */
export function createInitialState(): SelfHealState {
  return {
    retryCount: 0,
    currentDelay: INITIAL_RETRY_DELAY,
    isDirty: false,
    lastError: null,
    isPollingFallback: false,
    rescanTimer: null,
  };
}

/**
 * Determine recovery action based on error
 */
export function determineRecoveryAction(
  error: Error,
  state: SelfHealState
): RecoveryAction {
  // Extract error code
  const errorCode = (error as NodeJS.ErrnoException).code;

  // Check for environment errors (should fallback to polling)
  if (errorCode && ENVIRONMENT_ERRORS.has(errorCode)) {
    return { type: 'fallback-polling' };
  }

  // Check for resource exhaustion
  if (errorCode && RESOURCE_ERRORS.has(errorCode)) {
    // If we've exceeded max retries, fallback to polling
    if (state.retryCount >= MAX_RETRY_ATTEMPTS) {
      return { type: 'fallback-polling' };
    }

    // Otherwise, retry with exponential backoff
    return { type: 'retry', delay: state.currentDelay };
  }

  // For unknown errors, retry up to max attempts
  if (state.retryCount >= MAX_RETRY_ATTEMPTS) {
    return { type: 'give-up' };
  }

  return { type: 'retry', delay: state.currentDelay };
}

/**
 * Update state after error
 */
export function updateStateAfterError(
  state: SelfHealState,
  error: Error
): SelfHealState {
  return {
    ...state,
    retryCount: state.retryCount + 1,
    currentDelay: Math.min(state.currentDelay * 2, MAX_RETRY_DELAY),
    isDirty: true,
    lastError: error,
  };
}

/**
 * Reset state after successful recovery
 */
export function resetState(state: SelfHealState): SelfHealState {
  // Clear any pending timer
  if (state.rescanTimer) {
    clearTimeout(state.rescanTimer);
  }

  return {
    ...state,
    retryCount: 0,
    currentDelay: INITIAL_RETRY_DELAY,
    isDirty: false,
    lastError: null,
    rescanTimer: null,
    // Keep isPollingFallback - once we fallback, we stay in polling
  };
}

/**
 * Self-healing watcher wrapper
 */
export class SelfHealingWatcher {
  private state: SelfHealState;
  private onRestart: (usePolling: boolean) => Promise<void>;
  private onFullRescan: () => Promise<void>;
  private onStateChange: (status: WatcherStatus) => void;

  constructor(options: {
    onRestart: (usePolling: boolean) => Promise<void>;
    onFullRescan: () => Promise<void>;
    onStateChange: (status: WatcherStatus) => void;
  }) {
    this.state = createInitialState();
    this.onRestart = options.onRestart;
    this.onFullRescan = options.onFullRescan;
    this.onStateChange = options.onStateChange;
  }

  /**
   * Handle a watcher error
   */
  async handleError(error: Error): Promise<void> {
    console.error('[flywheel] Watcher error:', error.message);

    // Update state
    this.state = updateStateAfterError(this.state, error);

    // Notify state change (dirty)
    this.notifyDirty();

    // Determine action
    const action = determineRecoveryAction(error, this.state);

    switch (action.type) {
      case 'retry':
        console.error(`[flywheel] Scheduling retry in ${action.delay}ms (attempt ${this.state.retryCount})`);
        this.scheduleRetry(action.delay);
        break;

      case 'fallback-polling':
        console.error('[flywheel] Falling back to polling mode');
        this.state.isPollingFallback = true;
        await this.restart(true);
        break;

      case 'give-up':
        console.error('[flywheel] Too many retries, giving up on file watching');
        this.notifyError(error);
        break;
    }
  }

  /**
   * Schedule a retry
   */
  private scheduleRetry(delay: number): void {
    // Clear existing timer
    if (this.state.rescanTimer) {
      clearTimeout(this.state.rescanTimer);
    }

    this.state.rescanTimer = setTimeout(async () => {
      try {
        await this.restart(this.state.isPollingFallback);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        await this.handleError(e);
      }
    }, delay);
  }

  /**
   * Restart the watcher
   */
  private async restart(usePolling: boolean): Promise<void> {
    try {
      await this.onRestart(usePolling);

      // Full rescan to ensure consistency
      await this.onFullRescan();

      // Reset state on success
      this.state = resetState(this.state);
      this.notifyReady();
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      throw e;
    }
  }

  /**
   * Notify state change to dirty
   */
  private notifyDirty(): void {
    this.onStateChange({
      state: 'dirty',
      pendingEvents: 0,
      lastRebuild: null,
      error: this.state.lastError,
    });
  }

  /**
   * Notify state change to ready
   */
  private notifyReady(): void {
    this.onStateChange({
      state: 'ready',
      pendingEvents: 0,
      lastRebuild: Date.now(),
      error: null,
    });
  }

  /**
   * Notify state change to error
   */
  private notifyError(error: Error): void {
    this.onStateChange({
      state: 'error',
      pendingEvents: 0,
      lastRebuild: null,
      error,
    });
  }

  /**
   * Get current state
   */
  getState(): Readonly<SelfHealState> {
    return { ...this.state };
  }

  /**
   * Check if index is dirty (stale data warning needed)
   */
  isDirty(): boolean {
    return this.state.isDirty;
  }

  /**
   * Check if using polling fallback
   */
  isPollingFallback(): boolean {
    return this.state.isPollingFallback;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    if (this.state.rescanTimer) {
      clearTimeout(this.state.rescanTimer);
      this.state.rescanTimer = null;
    }
  }
}
