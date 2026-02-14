/**
 * Chaos tests for watcher error handling and recovery
 *
 * These tests inject various failure scenarios to validate:
 * - Error recovery mechanisms
 * - Self-healing behavior
 * - Graceful degradation under failure
 * - No crashes or data loss
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createInitialState,
  determineRecoveryAction,
  updateStateAfterError,
  SelfHealingWatcher,
  type SelfHealState,
} from '../../src/core/watch/selfHeal.js';
import { EventQueue } from '../../src/core/watch/eventQueue.js';
import type { EventBatch, WatcherConfig } from '../../src/core/watch/types.js';

// Helper to create Node-style errors with codes
function createError(message: string, code?: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  if (code) {
    err.code = code;
  }
  return err;
}

const createConfig = (overrides: Partial<WatcherConfig> = {}): WatcherConfig => ({
  debounceMs: 100,
  flushMs: 500,
  batchSize: 50,
  usePolling: false,
  pollInterval: 500,
  ...overrides,
});

describe('Watcher Chaos Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('EMFILE (too many open files) injection', () => {
    it('should retry with exponential backoff on EMFILE', async () => {
      let restartAttempt = 0;

      const restartFn = vi.fn().mockImplementation(async () => {
        restartAttempt++;
        if (restartAttempt < 3) {
          throw createError('Too many open files', 'EMFILE');
        }
      });

      const watcher = new SelfHealingWatcher({
        onRestart: restartFn,
        onFullRescan: vi.fn().mockResolvedValue(undefined),
        onStateChange: vi.fn(),
      });

      // Initial EMFILE error (schedules retry with 2s delay after doubling)
      await watcher.handleError(createError('Too many open files', 'EMFILE'));

      // First retry at 2s (initial 1s doubled to 2s)
      await vi.advanceTimersByTimeAsync(2100);
      expect(restartAttempt).toBe(1);

      // Second retry at 4s (2s doubled to 4s after first failure)
      await vi.advanceTimersByTimeAsync(4100);
      expect(restartAttempt).toBe(2);

      // Third retry at 8s succeeds
      await vi.advanceTimersByTimeAsync(8100);
      expect(restartAttempt).toBe(3);
    });

    it('should fallback to polling after max retries', () => {
      // Test the state logic directly without async timer complexity
      let state = createInitialState();

      // Simulate 5 EMFILE errors (max retries)
      for (let i = 0; i < 5; i++) {
        const error = createError('Too many open files', 'EMFILE');
        state = updateStateAfterError(state, error);
      }

      // After max retries, next error should trigger polling fallback
      const action = determineRecoveryAction(
        createError('Too many open files', 'EMFILE'),
        state
      );

      expect(action.type).toBe('fallback-polling');
    });
  });

  describe('ENOSPC (inotify limit) injection', () => {
    it('should handle inotify limit errors gracefully', async () => {
      const stateChanges: any[] = [];

      const watcher = new SelfHealingWatcher({
        onRestart: vi.fn().mockResolvedValue(undefined),
        onFullRescan: vi.fn().mockResolvedValue(undefined),
        onStateChange: (status) => stateChanges.push(status),
      });

      await watcher.handleError(createError('No space left on device', 'ENOSPC'));

      // Should mark as dirty
      expect(stateChanges[0].state).toBe('dirty');

      // After retry delay (first error doubles to 2s)
      await vi.advanceTimersByTimeAsync(2100);

      // Should recover to ready
      expect(stateChanges[stateChanges.length - 1].state).toBe('ready');
    });
  });

  describe('rapid error succession', () => {
    it('should not crash under rapid consecutive errors', async () => {
      const errors: string[] = [];

      const watcher = new SelfHealingWatcher({
        onRestart: vi.fn().mockRejectedValue(createError('Restart failed')),
        onFullRescan: vi.fn().mockResolvedValue(undefined),
        onStateChange: vi.fn(),
      });

      // Fire 10 errors in rapid succession
      for (let i = 0; i < 10; i++) {
        try {
          await watcher.handleError(createError(`Error ${i}`));
        } catch (e) {
          errors.push((e as Error).message);
        }
      }

      // Should not have thrown any uncaught exceptions
      expect(errors).toHaveLength(0);

      // Should be in dirty state
      expect(watcher.isDirty()).toBe(true);
    });

    it('should handle rapid errors without crashing', async () => {
      let restartCount = 0;
      const states: string[] = [];

      const watcher = new SelfHealingWatcher({
        onRestart: vi.fn().mockImplementation(async () => {
          restartCount++;
        }),
        onFullRescan: vi.fn().mockResolvedValue(undefined),
        onStateChange: (status) => states.push(status.state),
      });

      // Fire 5 errors in rapid succession
      // Note: Each error increments retry count, eventually giving up
      for (let i = 0; i < 5; i++) {
        await watcher.handleError(createError(`Error ${i}`));
      }

      // After 5 errors, should have given up (max retries = 5)
      expect(states[states.length - 1]).toBe('error');

      // No restarts should have been attempted yet (timers haven't fired)
      expect(restartCount).toBe(0);
    });
  });

  describe('environment error immediate fallback', () => {
    it('should immediately fallback for ENOTSUP', async () => {
      let usedPolling = false;

      const watcher = new SelfHealingWatcher({
        onRestart: vi.fn().mockImplementation(async (usePolling: boolean) => {
          usedPolling = usePolling;
        }),
        onFullRescan: vi.fn().mockResolvedValue(undefined),
        onStateChange: vi.fn(),
      });

      await watcher.handleError(createError('Not supported', 'ENOTSUP'));

      // Should immediately restart with polling, no waiting
      expect(usedPolling).toBe(true);
      expect(watcher.isPollingFallback()).toBe(true);
    });

    it('should immediately fallback for EPERM', async () => {
      let usedPolling = false;

      const watcher = new SelfHealingWatcher({
        onRestart: vi.fn().mockImplementation(async (usePolling: boolean) => {
          usedPolling = usePolling;
        }),
        onFullRescan: vi.fn().mockResolvedValue(undefined),
        onStateChange: vi.fn(),
      });

      await watcher.handleError(createError('Operation not permitted', 'EPERM'));

      expect(usedPolling).toBe(true);
    });
  });

  describe('queue resilience under error conditions', () => {
    it('should handle errors in batch handler gracefully', () => {
      let throwError = true;
      let errorThrown = false;

      const queue = new EventQueue(
        createConfig({ debounceMs: 100 }),
        (batch) => {
          if (throwError) {
            errorThrown = true;
            throw new Error('Handler error');
          }
        }
      );

      // Add events
      queue.push('change', '/note.md');

      // First flush attempt throws
      try {
        vi.advanceTimersByTime(150);
      } catch (e) {
        // Error propagates from timer callback
      }

      // Handler was called and threw
      expect(errorThrown).toBe(true);

      queue.dispose();
    });

    it('should continue accepting events after error', () => {
      let errorCount = 0;
      const receivedBatches: EventBatch[] = [];

      const queue = new EventQueue(
        createConfig({ debounceMs: 100 }),
        (batch) => {
          errorCount++;
          if (errorCount === 1) {
            throw new Error('First batch error');
          }
          receivedBatches.push(batch);
        }
      );

      queue.push('change', '/note1.md');

      // First flush throws
      try {
        vi.advanceTimersByTime(150);
      } catch (e) {
        // Expected
      }

      // Add more events after error
      queue.push('change', '/note2.md');

      // Should process normally
      vi.advanceTimersByTime(150);
      expect(receivedBatches).toHaveLength(1);
      expect(receivedBatches[0].events[0].path).toContain('note2');

      queue.dispose();
    });
  });

  describe('recovery state transitions', () => {
    it('should transition through correct states during recovery', async () => {
      const states: string[] = [];

      const watcher = new SelfHealingWatcher({
        onRestart: vi.fn().mockResolvedValue(undefined),
        onFullRescan: vi.fn().mockResolvedValue(undefined),
        onStateChange: (status) => states.push(status.state),
      });

      // Initial error -> dirty
      await watcher.handleError(createError('Test error'));
      expect(states).toContain('dirty');

      // After recovery -> ready (first error doubles delay to 2s)
      await vi.advanceTimersByTimeAsync(2100);
      expect(states[states.length - 1]).toBe('ready');
    });

    it('should transition to error state after give-up', async () => {
      const states: string[] = [];
      let retryCount = 0;

      const watcher = new SelfHealingWatcher({
        onRestart: vi.fn().mockImplementation(async () => {
          retryCount++;
          throw createError('Persistent failure');
        }),
        onFullRescan: vi.fn().mockResolvedValue(undefined),
        onStateChange: (status) => states.push(status.state),
      });

      await watcher.handleError(createError('Initial error'));

      // Advance through retries incrementally (avoids test hanging)
      for (let i = 0; i < 6; i++) {
        await vi.advanceTimersByTimeAsync(Math.min(Math.pow(2, i + 1) * 1000 + 100, 60100));
        await vi.runAllTimersAsync();
      }

      // Should end in error state after give-up
      expect(states[states.length - 1]).toBe('error');
    });
  });

  describe('backpressure handling', () => {
    it('should handle rapid event generation', () => {
      const receivedBatches: EventBatch[] = [];

      const queue = new EventQueue(
        createConfig({ debounceMs: 50, flushMs: 100, batchSize: 10 }),
        (batch) => {
          receivedBatches.push(batch);
        }
      );

      // Rapid event generation
      for (let i = 0; i < 100; i++) {
        queue.push('change', `/note${i}.md`);
      }

      // Batch size triggers flush at 10 paths
      expect(receivedBatches.length).toBeGreaterThanOrEqual(10);

      // All events should eventually be processed
      vi.advanceTimersByTime(1000);

      const totalEvents = receivedBatches.reduce((sum, b) => sum + b.events.length, 0);
      expect(totalEvents).toBe(100);

      queue.dispose();
    });
  });

  describe('mixed error types', () => {
    it('should immediately fallback to polling on environment error', async () => {
      let usedPolling = false;

      const watcher = new SelfHealingWatcher({
        onRestart: vi.fn().mockImplementation(async (usePolling: boolean) => {
          usedPolling = usePolling;
        }),
        onFullRescan: vi.fn().mockResolvedValue(undefined),
        onStateChange: vi.fn(),
      });

      // ENOTSUP triggers immediate polling fallback (no retry)
      await watcher.handleError(createError('Not supported', 'ENOTSUP'));

      // Should have immediately tried to restart with polling
      expect(usedPolling).toBe(true);
      expect(watcher.isPollingFallback()).toBe(true);
    });
  });

  describe('dispose during recovery', () => {
    it('should dispose cleanly during active retry cycle', async () => {
      const watcher = new SelfHealingWatcher({
        onRestart: vi.fn().mockRejectedValue(createError('Restart failed')),
        onFullRescan: vi.fn().mockResolvedValue(undefined),
        onStateChange: vi.fn(),
      });

      await watcher.handleError(createError('Initial error'));

      // Dispose while retry is pending
      watcher.dispose();

      // Advancing time should not cause errors
      await vi.advanceTimersByTimeAsync(10000);
    });

    it('should dispose queue cleanly during batch processing', () => {
      const queue = new EventQueue(
        createConfig({ debounceMs: 1000 }),
        () => {}
      );

      // Add many events
      for (let i = 0; i < 100; i++) {
        queue.push('change', `/note${i}.md`);
      }

      // Dispose immediately
      queue.dispose();

      // Should be clean
      expect(queue.size).toBe(0);

      // Advancing time should not cause errors
      vi.advanceTimersByTime(5000);
    });
  });

  describe('memory safety under error conditions', () => {
    it('should not leak state through error cycles', async () => {
      const watcher = new SelfHealingWatcher({
        onRestart: vi.fn().mockResolvedValue(undefined),
        onFullRescan: vi.fn().mockResolvedValue(undefined),
        onStateChange: vi.fn(),
      });

      // Go through multiple error/recovery cycles
      for (let cycle = 0; cycle < 5; cycle++) {
        await watcher.handleError(createError(`Error ${cycle}`));
        // First error doubles delay to 2s, so we need 2100ms
        await vi.advanceTimersByTimeAsync(2100);
        await vi.runAllTimersAsync();
      }

      // State should be clean after all recoveries
      const state = watcher.getState();
      expect(state.retryCount).toBe(0);
      expect(state.isDirty).toBe(false);
      expect(state.lastError).toBeNull();
    });

    it('should clear pending events on queue dispose', () => {
      const queue = new EventQueue(
        // Use large batch size to prevent auto-flush
        createConfig({ debounceMs: 60000, batchSize: 200 }),
        () => {}
      );

      // Accumulate events (100 paths x 100 events each)
      for (let i = 0; i < 10000; i++) {
        queue.push('change', `/note${i % 100}.md`);
      }

      // Should have 100 unique paths with 100 events each
      expect(queue.size).toBe(100);
      expect(queue.eventCount).toBe(10000);

      // Dispose
      queue.dispose();

      // Should be completely cleared
      expect(queue.size).toBe(0);
      expect(queue.eventCount).toBe(0);
    });
  });
});
