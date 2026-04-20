import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SelfHealingWatcher,
  createInitialState,
  determineRecoveryAction,
  updateStateAfterError,
  resetState,
} from '../../../src/core/read/watch/selfHeal.js';
import type { WatcherStatus } from '../../../src/core/read/watch/types.js';

function withCode(message: string, code: string): Error {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

describe('selfHeal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies exponential backoff for retryable resource errors', () => {
    const error = withCode('too many files', 'EMFILE');
    const initial = createInitialState();

    expect(determineRecoveryAction(error, initial)).toEqual({ type: 'retry', delay: 1000 });

    const afterFirstError = updateStateAfterError(initial, error);
    expect(afterFirstError.retryCount).toBe(1);
    expect(afterFirstError.currentDelay).toBe(2000);
    expect(afterFirstError.isDirty).toBe(true);

    expect(determineRecoveryAction(error, afterFirstError)).toEqual({ type: 'retry', delay: 2000 });

    const reset = resetState(afterFirstError);
    expect(reset.retryCount).toBe(0);
    expect(reset.currentDelay).toBe(1000);
    expect(reset.isDirty).toBe(false);
  });

  it('schedules a retry, marks dirty, and returns to ready after restart succeeds', async () => {
    const onRestart = vi.fn(async () => {});
    const onFullRescan = vi.fn(async () => {});
    const statuses: WatcherStatus[] = [];
    const watcher = new SelfHealingWatcher({
      onRestart,
      onFullRescan,
      onStateChange: (status) => statuses.push(status),
    });

    const errorPromise = watcher.handleError(withCode('too many files', 'EMFILE'));
    await errorPromise;

    expect(statuses[0]).toMatchObject({ state: 'dirty' });
    expect(watcher.isDirty()).toBe(true);

    vi.advanceTimersByTime(2000);
    await vi.runAllTimersAsync();

    expect(onRestart).toHaveBeenCalledWith(false);
    expect(onFullRescan).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toMatchObject({ state: 'ready' });
    expect(watcher.isDirty()).toBe(false);
  });

  it('falls back to polling for environment errors', async () => {
    const onRestart = vi.fn(async () => {});
    const onFullRescan = vi.fn(async () => {});
    const statuses: WatcherStatus[] = [];
    const watcher = new SelfHealingWatcher({
      onRestart,
      onFullRescan,
      onStateChange: (status) => statuses.push(status),
    });

    await watcher.handleError(withCode('operation not supported', 'ENOTSUP'));

    expect(watcher.isPollingFallback()).toBe(true);
    expect(onRestart).toHaveBeenCalledWith(true);
    expect(onFullRescan).toHaveBeenCalledTimes(1);
    expect(statuses[0]).toMatchObject({ state: 'dirty' });
    expect(statuses.at(-1)).toMatchObject({ state: 'ready' });
  });

  it('clears a scheduled retry when disposed', async () => {
    const onRestart = vi.fn(async () => {});
    const onFullRescan = vi.fn(async () => {});
    const watcher = new SelfHealingWatcher({
      onRestart,
      onFullRescan,
      onStateChange: vi.fn(),
    });

    await watcher.handleError(withCode('too many files', 'EMFILE'));
    watcher.dispose();

    vi.advanceTimersByTime(5000);
    await vi.runAllTimersAsync();

    expect(onRestart).not.toHaveBeenCalled();
    expect(onFullRescan).not.toHaveBeenCalled();
  });
});
