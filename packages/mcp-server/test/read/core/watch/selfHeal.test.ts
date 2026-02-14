/**
 * Tests for self-healing watcher recovery
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createInitialState,
  determineRecoveryAction,
  updateStateAfterError,
  resetState,
  SelfHealingWatcher,
  type SelfHealState,
} from '../../../src/core/watch/selfHeal.js';

// Helper to create Node-style errors with codes
function createError(message: string, code?: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  if (code) {
    err.code = code;
  }
  return err;
}

describe('selfHeal', () => {
  describe('createInitialState', () => {
    it('should create initial state with default values', () => {
      const state = createInitialState();

      expect(state.retryCount).toBe(0);
      expect(state.currentDelay).toBe(1000); // INITIAL_RETRY_DELAY
      expect(state.isDirty).toBe(false);
      expect(state.lastError).toBeNull();
      expect(state.isPollingFallback).toBe(false);
      expect(state.rescanTimer).toBeNull();
    });
  });

  describe('determineRecoveryAction', () => {
    let state: SelfHealState;

    beforeEach(() => {
      state = createInitialState();
    });

    describe('environment errors', () => {
      it('should fallback to polling for ENOTSUP', () => {
        const error = createError('Not supported', 'ENOTSUP');
        const action = determineRecoveryAction(error, state);

        expect(action).toEqual({ type: 'fallback-polling' });
      });

      it('should fallback to polling for EPERM', () => {
        const error = createError('Permission denied', 'EPERM');
        const action = determineRecoveryAction(error, state);

        expect(action).toEqual({ type: 'fallback-polling' });
      });

      it('should fallback to polling for EACCES', () => {
        const error = createError('Access denied', 'EACCES');
        const action = determineRecoveryAction(error, state);

        expect(action).toEqual({ type: 'fallback-polling' });
      });
    });

    describe('resource exhaustion errors', () => {
      it('should retry with delay for EMFILE (too many open files)', () => {
        const error = createError('Too many open files', 'EMFILE');
        const action = determineRecoveryAction(error, state);

        expect(action).toEqual({ type: 'retry', delay: 1000 });
      });

      it('should retry with delay for ENOSPC (no space on device)', () => {
        const error = createError('No space left', 'ENOSPC');
        const action = determineRecoveryAction(error, state);

        expect(action).toEqual({ type: 'retry', delay: 1000 });
      });

      it('should retry with delay for ENOMEM (out of memory)', () => {
        const error = createError('Out of memory', 'ENOMEM');
        const action = determineRecoveryAction(error, state);

        expect(action).toEqual({ type: 'retry', delay: 1000 });
      });

      it('should fallback to polling after max retries for resource errors', () => {
        const error = createError('Too many open files', 'EMFILE');
        state.retryCount = 5; // MAX_RETRY_ATTEMPTS

        const action = determineRecoveryAction(error, state);

        expect(action).toEqual({ type: 'fallback-polling' });
      });
    });

    describe('unknown errors', () => {
      it('should retry with delay for unknown errors', () => {
        const error = createError('Unknown error');
        const action = determineRecoveryAction(error, state);

        expect(action).toEqual({ type: 'retry', delay: 1000 });
      });

      it('should give up after max retries for unknown errors', () => {
        const error = createError('Unknown error');
        state.retryCount = 5;

        const action = determineRecoveryAction(error, state);

        expect(action).toEqual({ type: 'give-up' });
      });
    });
  });

  describe('updateStateAfterError', () => {
    it('should increment retry count', () => {
      const state = createInitialState();
      const error = createError('Test error');

      const newState = updateStateAfterError(state, error);

      expect(newState.retryCount).toBe(1);
    });

    it('should double the delay (exponential backoff)', () => {
      const state = createInitialState();
      const error = createError('Test error');

      let newState = updateStateAfterError(state, error);
      expect(newState.currentDelay).toBe(2000); // 1000 * 2

      newState = updateStateAfterError(newState, error);
      expect(newState.currentDelay).toBe(4000); // 2000 * 2

      newState = updateStateAfterError(newState, error);
      expect(newState.currentDelay).toBe(8000); // 4000 * 2
    });

    it('should cap delay at MAX_RETRY_DELAY (60s)', () => {
      let state = createInitialState();
      state.currentDelay = 32000;
      const error = createError('Test error');

      const newState = updateStateAfterError(state, error);

      expect(newState.currentDelay).toBe(60000); // MAX_RETRY_DELAY
    });

    it('should mark index as dirty', () => {
      const state = createInitialState();
      const error = createError('Test error');

      const newState = updateStateAfterError(state, error);

      expect(newState.isDirty).toBe(true);
    });

    it('should store the error', () => {
      const state = createInitialState();
      const error = createError('Test error');

      const newState = updateStateAfterError(state, error);

      expect(newState.lastError).toBe(error);
    });
  });

  describe('resetState', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should reset retry count and delay', () => {
      let state = createInitialState();
      state = updateStateAfterError(state, createError('Error 1'));
      state = updateStateAfterError(state, createError('Error 2'));

      const newState = resetState(state);

      expect(newState.retryCount).toBe(0);
      expect(newState.currentDelay).toBe(1000);
    });

    it('should clear dirty flag', () => {
      let state = createInitialState();
      state.isDirty = true;

      const newState = resetState(state);

      expect(newState.isDirty).toBe(false);
    });

    it('should clear last error', () => {
      let state = createInitialState();
      state.lastError = createError('Test error');

      const newState = resetState(state);

      expect(newState.lastError).toBeNull();
    });

    it('should preserve polling fallback flag', () => {
      let state = createInitialState();
      state.isPollingFallback = true;

      const newState = resetState(state);

      expect(newState.isPollingFallback).toBe(true);
    });

    it('should clear rescan timer', () => {
      const state = createInitialState();
      state.rescanTimer = setTimeout(() => {}, 10000);

      const newState = resetState(state);

      expect(newState.rescanTimer).toBeNull();
    });
  });

  describe('exponential backoff progression', () => {
    it('should follow 1s -> 2s -> 4s -> 8s -> 16s -> 32s -> 60s pattern', () => {
      let state = createInitialState();
      const error = createError('Test');

      const expectedDelays = [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000];

      for (const expected of expectedDelays) {
        expect(state.currentDelay).toBe(expected);
        state = updateStateAfterError(state, error);
      }
    });
  });

  describe('SelfHealingWatcher', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should call onStateChange with dirty status on error', async () => {
      const stateChanges: any[] = [];

      const watcher = new SelfHealingWatcher({
        onRestart: vi.fn(),
        onFullRescan: vi.fn(),
        onStateChange: (status) => stateChanges.push(status),
      });

      await watcher.handleError(createError('Test error'));

      expect(stateChanges[0].state).toBe('dirty');
      expect(stateChanges[0].error).toBeTruthy();
    });

    it('should schedule retry with exponential backoff', async () => {
      const restartFn = vi.fn().mockResolvedValue(undefined);
      const rescanFn = vi.fn().mockResolvedValue(undefined);

      const watcher = new SelfHealingWatcher({
        onRestart: restartFn,
        onFullRescan: rescanFn,
        onStateChange: vi.fn(),
      });

      await watcher.handleError(createError('Test error'));

      // Retry not yet called
      expect(restartFn).not.toHaveBeenCalled();

      // First error doubles initial delay (1s -> 2s), so wait 2100ms
      await vi.advanceTimersByTimeAsync(2100);

      expect(restartFn).toHaveBeenCalledTimes(1);
      expect(rescanFn).toHaveBeenCalledTimes(1);
    });

    it('should immediately fallback to polling for environment errors', async () => {
      const restartFn = vi.fn().mockResolvedValue(undefined);
      const rescanFn = vi.fn().mockResolvedValue(undefined);

      const watcher = new SelfHealingWatcher({
        onRestart: restartFn,
        onFullRescan: rescanFn,
        onStateChange: vi.fn(),
      });

      await watcher.handleError(createError('Not supported', 'ENOTSUP'));

      // Should immediately restart with polling
      expect(restartFn).toHaveBeenCalledWith(true);
      expect(watcher.isPollingFallback()).toBe(true);
    });

    it('should track isDirty state correctly', async () => {
      const restartFn = vi.fn().mockResolvedValue(undefined);
      const rescanFn = vi.fn().mockResolvedValue(undefined);

      const watcher = new SelfHealingWatcher({
        onRestart: restartFn,
        onFullRescan: rescanFn,
        onStateChange: vi.fn(),
      });

      expect(watcher.isDirty()).toBe(false);

      await watcher.handleError(createError('Test error'));

      expect(watcher.isDirty()).toBe(true);

      // Complete recovery (first error doubles delay: 1s -> 2s)
      await vi.advanceTimersByTimeAsync(2100);

      expect(watcher.isDirty()).toBe(false);
    });

    it('should dispose cleanly', async () => {
      const watcher = new SelfHealingWatcher({
        onRestart: vi.fn(),
        onFullRescan: vi.fn(),
        onStateChange: vi.fn(),
      });

      await watcher.handleError(createError('Test error'));

      // Timer is now scheduled
      watcher.dispose();

      // Advancing time should not cause errors
      await vi.advanceTimersByTimeAsync(10000);
    });

    it('should handle recursive errors during recovery', async () => {
      let callCount = 0;
      const restartFn = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          throw createError('Restart failed');
        }
      });
      const rescanFn = vi.fn().mockResolvedValue(undefined);
      const stateChanges: any[] = [];

      const watcher = new SelfHealingWatcher({
        onRestart: restartFn,
        onFullRescan: rescanFn,
        onStateChange: (status) => stateChanges.push(status),
      });

      await watcher.handleError(createError('Initial error'));

      // First retry at 2s (initial 1s doubled to 2s)
      await vi.advanceTimersByTimeAsync(2100);
      expect(callCount).toBe(1);

      // Second retry at 4s (2s doubled to 4s after first failure)
      await vi.advanceTimersByTimeAsync(4100);
      expect(callCount).toBe(2);

      // Third retry at 8s (4s doubled to 8s after second failure)
      await vi.advanceTimersByTimeAsync(8100);
      expect(callCount).toBe(3);
      expect(rescanFn).toHaveBeenCalled();
    });
  });
});
