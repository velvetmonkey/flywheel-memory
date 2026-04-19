import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventQueue } from '../../../src/core/read/watch/eventQueue.js';
import type { EventBatch } from '../../../src/core/read/watch/types.js';

describe('EventQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-19T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createQueue(onBatch: (batch: EventBatch) => void): EventQueue {
    return new EventQueue(
      {
        debounceMs: 200,
        flushMs: 1000,
        batchSize: 2,
        usePolling: false,
        pollInterval: 10000,
      },
      onBatch,
    );
  }

  it('flushes a debounced single-path update as one upsert event', () => {
    const onBatch = vi.fn();
    const queue = createQueue(onBatch);

    queue.push('add', 'notes/a.md');
    queue.push('change', 'notes/a.md');

    expect(queue.size).toBe(1);
    expect(queue.eventCount).toBe(2);

    vi.advanceTimersByTime(200);

    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(onBatch).toHaveBeenCalledWith(expect.objectContaining({
      events: [
        expect.objectContaining({
          type: 'upsert',
          path: 'notes/a.md',
        }),
      ],
      renames: [],
    }));
    expect(queue.size).toBe(0);
  });

  it('forces a batch flush when the queue reaches batch size', () => {
    const onBatch = vi.fn();
    const queue = createQueue(onBatch);

    queue.push('add', 'notes/a.md');
    queue.push('add', 'notes/b.md');

    expect(onBatch).toHaveBeenCalledTimes(1);
    const batch = onBatch.mock.calls[0][0] as EventBatch;
    expect(batch.events).toHaveLength(2);
    expect(batch.events.map(event => event.path).sort()).toEqual(['notes/a.md', 'notes/b.md']);
    expect(queue.size).toBe(0);
  });

  it('pairs matching delete/add events into a rename during flush', () => {
    const onBatch = vi.fn();
    const queue = createQueue(onBatch);

    queue.push('unlink', 'people/Alice.md');
    vi.advanceTimersByTime(50);
    queue.push('add', 'team/Alice.md');

    queue.flush();

    expect(onBatch).toHaveBeenCalledTimes(1);
    const batch = onBatch.mock.calls[0][0] as EventBatch;
    expect(batch.events).toEqual([]);
    expect(batch.renames).toEqual([
      expect.objectContaining({
        type: 'rename',
        oldPath: 'people/Alice.md',
        newPath: 'team/Alice.md',
      }),
    ]);
  });

  it('cleans up timers on dispose without emitting delayed batches', () => {
    const onBatch = vi.fn();
    const queue = createQueue(onBatch);

    queue.push('add', 'notes/a.md');
    expect(queue.size).toBe(1);

    queue.dispose();
    vi.runAllTimers();

    expect(onBatch).not.toHaveBeenCalled();
    expect(queue.size).toBe(0);
  });
});
