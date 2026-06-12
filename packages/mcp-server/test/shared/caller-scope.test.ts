/**
 * CallerScope coverage for src/caller-scope.ts (arch-review S12).
 *
 * Pins the AsyncLocalStorage caller-attribution contract: set via
 * runWithCaller, read via getCurrentCaller, no-op outside a tagged context.
 */

import { describe, it, expect } from 'vitest';
import { runWithCaller, getCurrentCaller } from '../../src/caller-scope.js';

describe('caller-scope (AsyncLocalStorage caller attribution)', () => {
  it('getCurrentCaller returns undefined outside any caller context', () => {
    expect(getCurrentCaller()).toBeUndefined();
  });

  it('runWithCaller binds the caller id for the duration of fn', () => {
    const seen = runWithCaller('tg:12345', () => getCurrentCaller());
    expect(seen).toBe('tg:12345');
    // Context does not leak after the run completes
    expect(getCurrentCaller()).toBeUndefined();
  });

  it('returns the function result', () => {
    expect(runWithCaller('tg:1', () => 42)).toBe(42);
  });

  it('runs unwrapped when callerId is undefined or empty', () => {
    expect(runWithCaller(undefined, () => getCurrentCaller())).toBeUndefined();
    expect(runWithCaller('', () => getCurrentCaller())).toBeUndefined();
  });

  it('survives async continuations (await inside the scope)', async () => {
    const seen = await runWithCaller('tg:async', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return getCurrentCaller();
    });
    expect(seen).toBe('tg:async');
    expect(getCurrentCaller()).toBeUndefined();
  });

  it('nested scopes shadow and restore the outer caller', () => {
    runWithCaller('outer', () => {
      expect(getCurrentCaller()).toBe('outer');
      runWithCaller('inner', () => {
        expect(getCurrentCaller()).toBe('inner');
      });
      expect(getCurrentCaller()).toBe('outer');
    });
  });

  it('keeps concurrent async callers isolated', async () => {
    const results = await Promise.all([
      runWithCaller('caller-a', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return getCurrentCaller();
      }),
      runWithCaller('caller-b', async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return getCurrentCaller();
      }),
    ]);
    expect(results).toEqual(['caller-a', 'caller-b']);
  });
});
