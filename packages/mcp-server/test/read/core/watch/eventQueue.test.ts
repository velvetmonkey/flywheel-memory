/**
 * Tests for event queue with coalescing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventQueue } from '../../../src/core/watch/eventQueue.js';
import type { EventBatch, WatcherConfig } from '../../../src/core/watch/types.js';

const createConfig = (overrides: Partial<WatcherConfig> = {}): WatcherConfig => ({
  debounceMs: 100,
  flushMs: 500,
  batchSize: 50,
  usePolling: false,
  pollInterval: 500,
  ...overrides,
});

describe('EventQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('basic operations', () => {
    it('should accept events', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(createConfig(), (batch) => {
        batches.push(batch);
      });

      queue.push('add', '/path/to/note.md');
      expect(queue.size).toBe(1);
      expect(queue.eventCount).toBe(1);

      queue.dispose();
    });

    it('should debounce per-path events', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(createConfig({ debounceMs: 100 }), (batch) => {
        batches.push(batch);
      });

      // Multiple changes to same file
      queue.push('change', '/note.md');
      queue.push('change', '/note.md');
      queue.push('change', '/note.md');

      expect(queue.eventCount).toBe(3);
      expect(batches).toHaveLength(0);

      // After debounce, should flush to single event
      vi.advanceTimersByTime(150);

      expect(batches).toHaveLength(1);
      expect(batches[0].events).toHaveLength(1);
      expect(batches[0].events[0].type).toBe('upsert');

      queue.dispose();
    });

    it('should handle multiple paths independently', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(createConfig({ debounceMs: 100, flushMs: 1000 }), (batch) => {
        batches.push(batch);
      });

      queue.push('change', '/note1.md');
      vi.advanceTimersByTime(50);
      queue.push('change', '/note2.md');

      // First path debounce expires
      vi.advanceTimersByTime(60);
      expect(batches).toHaveLength(1);

      // Second path debounce expires
      vi.advanceTimersByTime(50);
      expect(batches).toHaveLength(2);

      queue.dispose();
    });
  });

  describe('event coalescing', () => {
    it('should coalesce add + change to upsert', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(createConfig({ debounceMs: 100 }), (batch) => {
        batches.push(batch);
      });

      queue.push('add', '/note.md');
      queue.push('change', '/note.md');

      vi.advanceTimersByTime(150);

      expect(batches).toHaveLength(1);
      expect(batches[0].events[0].type).toBe('upsert');

      queue.dispose();
    });

    it('should coalesce multiple changes to upsert', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(createConfig({ debounceMs: 100 }), (batch) => {
        batches.push(batch);
      });

      queue.push('change', '/note.md');
      queue.push('change', '/note.md');
      queue.push('change', '/note.md');

      vi.advanceTimersByTime(150);

      expect(batches).toHaveLength(1);
      expect(batches[0].events[0].type).toBe('upsert');
      expect(batches[0].events[0].originalEvents).toHaveLength(3);

      queue.dispose();
    });

    it('should coalesce to delete when ending with unlink', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(createConfig({ debounceMs: 100 }), (batch) => {
        batches.push(batch);
      });

      queue.push('change', '/note.md');
      queue.push('unlink', '/note.md');

      vi.advanceTimersByTime(150);

      expect(batches).toHaveLength(1);
      expect(batches[0].events[0].type).toBe('delete');

      queue.dispose();
    });

    it('should coalesce unlink + add to upsert (rename/recreate)', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(createConfig({ debounceMs: 100 }), (batch) => {
        batches.push(batch);
      });

      queue.push('unlink', '/note.md');
      queue.push('add', '/note.md');

      vi.advanceTimersByTime(150);

      expect(batches).toHaveLength(1);
      expect(batches[0].events[0].type).toBe('upsert');

      queue.dispose();
    });
  });

  describe('flush triggers', () => {
    it('should flush on batch size limit', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(createConfig({ debounceMs: 1000, batchSize: 3 }), (batch) => {
        batches.push(batch);
      });

      queue.push('change', '/note1.md');
      queue.push('change', '/note2.md');
      expect(batches).toHaveLength(0);

      // Third unique path triggers batch size limit
      queue.push('change', '/note3.md');
      expect(batches).toHaveLength(1);
      expect(batches[0].events).toHaveLength(3);

      queue.dispose();
    });

    it('should flush on interval', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(createConfig({ debounceMs: 1000, flushMs: 200 }), (batch) => {
        batches.push(batch);
      });

      queue.push('change', '/note.md');
      expect(batches).toHaveLength(0);

      // Flush interval expires (before per-path debounce)
      vi.advanceTimersByTime(250);
      expect(batches).toHaveLength(1);

      queue.dispose();
    });

    it('should flush manually', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(createConfig({ debounceMs: 1000, flushMs: 1000 }), (batch) => {
        batches.push(batch);
      });

      queue.push('change', '/note.md');
      queue.flush();

      expect(batches).toHaveLength(1);

      queue.dispose();
    });
  });

  describe('path normalization', () => {
    it('should normalize Windows paths', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(createConfig({ debounceMs: 100 }), (batch) => {
        batches.push(batch);
      });

      queue.push('change', 'C:\\Users\\vault\\note.md');
      vi.advanceTimersByTime(150);

      expect(batches).toHaveLength(1);
      // On Windows, paths are lowercased for case-insensitive comparison
      const expected = process.platform === 'win32'
        ? 'c:/users/vault/note.md'
        : 'C:/Users/vault/note.md';
      expect(batches[0].events[0].path).toBe(expected);

      queue.dispose();
    });

    it('should treat same path with different slashes as same', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(createConfig({ debounceMs: 100 }), (batch) => {
        batches.push(batch);
      });

      queue.push('change', 'folder/note.md');
      queue.push('change', 'folder\\note.md');

      expect(queue.size).toBe(1); // Same path, coalesced

      queue.dispose();
    });
  });

  describe('cleanup', () => {
    it('should clear all pending events on dispose', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(createConfig(), (batch) => {
        batches.push(batch);
      });

      queue.push('change', '/note1.md');
      queue.push('change', '/note2.md');
      queue.dispose();

      expect(queue.size).toBe(0);
      expect(queue.eventCount).toBe(0);

      // Should not trigger any batches after dispose
      vi.advanceTimersByTime(1000);
      expect(batches).toHaveLength(0);
    });

    it('should clear pending events on clear', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(createConfig(), (batch) => {
        batches.push(batch);
      });

      queue.push('change', '/note.md');
      queue.clear();

      expect(queue.size).toBe(0);

      // Should not trigger batch for cleared events
      vi.advanceTimersByTime(1000);
      expect(batches).toHaveLength(0);

      queue.dispose();
    });
  });
});
