/**
 * Stress tests for file watcher event queue and batching
 *
 * These tests validate that the watcher handles high-volume scenarios correctly:
 * - Rapid event bursts coalesce properly
 * - Memory stays bounded under load
 * - Debouncing prevents thrashing
 * - Large vaults don't cause excessive rebuilds
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventQueue } from '../../src/core/watch/eventQueue.js';
import type { EventBatch, WatcherConfig } from '../../src/core/watch/types.js';

const createConfig = (overrides: Partial<WatcherConfig> = {}): WatcherConfig => ({
  debounceMs: 200,
  flushMs: 1000,
  batchSize: 50,
  usePolling: false,
  pollInterval: 500,
  ...overrides,
});

describe('Watcher Stress Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('thrashing prevention', () => {
    it('should coalesce 100 rapid saves to single rebuild', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 5000, flushMs: 10000 }),
        (batch) => batches.push(batch)
      );

      // Simulate user rapidly saving same file 100 times
      for (let i = 0; i < 100; i++) {
        queue.push('change', '/daily-notes/today.md');
      }

      // Should have accumulated all events, no flush yet
      expect(queue.eventCount).toBe(100);
      expect(batches).toHaveLength(0);

      // After debounce expires
      vi.advanceTimersByTime(5100);

      // Should coalesce to single upsert
      expect(batches).toHaveLength(1);
      expect(batches[0].events).toHaveLength(1);
      expect(batches[0].events[0].type).toBe('upsert');
      expect(batches[0].events[0].originalEvents).toHaveLength(100);

      queue.dispose();
    });

    it('should coalesce 1000 rapid changes to same file', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 200, flushMs: 1000 }),
        (batch) => batches.push(batch)
      );

      // Simulate extreme burst of 1000 changes
      for (let i = 0; i < 1000; i++) {
        queue.push('change', '/note.md');
      }

      expect(queue.eventCount).toBe(1000);

      vi.advanceTimersByTime(300);

      // All 1000 should coalesce to single event
      expect(batches).toHaveLength(1);
      expect(batches[0].events[0].originalEvents).toHaveLength(1000);

      queue.dispose();
    });

    it('should batch multiple files during editing session', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 5000, flushMs: 10000 }),
        (batch) => batches.push(batch)
      );

      // Simulate editing 10 files rapidly (like a bulk rename or search-replace)
      for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 5; j++) {
          queue.push('change', `/notes/note${i}.md`);
        }
      }

      expect(queue.eventCount).toBe(50);
      expect(queue.size).toBe(10); // 10 unique paths

      // Wait for debounce - each path flushes independently
      vi.advanceTimersByTime(5100);

      // Each path has its own debounce timer, so we get 10 independent batches
      expect(batches).toHaveLength(10);

      // Each batch has 1 event (one path's coalesced events)
      for (const batch of batches) {
        expect(batch.events).toHaveLength(1);
        expect(batch.events[0].originalEvents).toHaveLength(5);
      }

      queue.dispose();
    });
  });

  describe('10k note vault simulation', () => {
    it('should handle initial scan notification without thrashing', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 5000, flushMs: 10000, batchSize: 100 }),
        (batch) => batches.push(batch)
      );

      // Simulate chokidar emitting 10,000 'add' events during initial scan
      // In reality these come over several seconds, but let's stress-test the queue
      for (let i = 0; i < 10000; i++) {
        queue.push('add', `/vault/notes/note${i.toString().padStart(5, '0')}.md`);
      }

      // Batch size triggers force flush after 100 paths
      // We have 10,000 unique paths, so we'll have multiple force flushes
      const expectedFlushes = Math.floor(10000 / 100);
      expect(batches.length).toBeGreaterThanOrEqual(expectedFlushes);

      // Total events across all batches should equal 10,000
      const totalEvents = batches.reduce((sum, b) => sum + b.events.length, 0);
      expect(totalEvents).toBe(10000);

      queue.dispose();
    });

    it('should not rebuild during active editing in large vault', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        // Use very long flush interval to prevent interval-based flushes
        createConfig({ debounceMs: 5000, flushMs: 60000 }),
        (batch) => batches.push(batch)
      );

      // Simulate editing session: changes come every 2 seconds
      // With 5s debounce, no flush should happen during active editing
      for (let i = 0; i < 10; i++) {
        queue.push('change', '/current-note.md');
        vi.advanceTimersByTime(2000); // 2 second gaps
      }

      // No batches yet - debounce keeps resetting (5s > 2s gap)
      expect(batches).toHaveLength(0);

      // Stop editing, wait for debounce to expire
      vi.advanceTimersByTime(6000);

      // Now we should have exactly one batch with all 10 events coalesced
      expect(batches).toHaveLength(1);
      expect(batches[0].events[0].originalEvents).toHaveLength(10);

      queue.dispose();
    });
  });

  describe('memory safety under load', () => {
    it('should handle 10,000 queued events without memory explosion', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        // Use large batch size to accumulate many events
        createConfig({ debounceMs: 100, flushMs: 500, batchSize: 500 }),
        (batch) => batches.push(batch)
      );

      // Queue 10,000 events across 1000 files
      for (let file = 0; file < 1000; file++) {
        for (let change = 0; change < 10; change++) {
          queue.push('change', `/notes/file${file}.md`);
        }
      }

      // Batch size limit (500) triggers flush at 500 unique paths
      // So we expect at least 2 flushes during event accumulation
      expect(batches.length).toBeGreaterThanOrEqual(2);

      // Clean up remaining
      vi.advanceTimersByTime(1000);

      // Track unique paths processed
      const allPaths = new Set<string>();
      for (const batch of batches) {
        for (const event of batch.events) {
          allPaths.add(event.path);
          expect(event.type).toBe('upsert');
        }
      }

      // All 1000 unique files should have been processed
      expect(allPaths.size).toBe(1000);

      queue.dispose();
    });

    it('should bound memory even with rapid fire events', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 100, batchSize: 50 }),
        (batch) => batches.push(batch)
      );

      // Fire 500 events to unique files in rapid succession
      for (let i = 0; i < 500; i++) {
        queue.push('change', `/notes/unique${i}.md`);
      }

      // With batchSize=50, should have flushed 10 times
      expect(batches.length).toBeGreaterThanOrEqual(10);

      // Queue size should be bounded
      expect(queue.size).toBeLessThanOrEqual(50);

      queue.dispose();
    });
  });

  describe('batch accumulation during debounce', () => {
    it('should accumulate events correctly across debounce window', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 500, flushMs: 2000 }),
        (batch) => batches.push(batch)
      );

      // Event at t=0
      queue.push('change', '/note1.md');

      // Event at t=200 (resets debounce for note1)
      vi.advanceTimersByTime(200);
      queue.push('change', '/note1.md');

      // Event at t=400 (resets debounce for note1)
      vi.advanceTimersByTime(200);
      queue.push('change', '/note1.md');

      // Different file at t=500
      vi.advanceTimersByTime(100);
      queue.push('change', '/note2.md');

      // No batches yet (debounce hasn't expired for either)
      expect(batches).toHaveLength(0);

      // At t=900, note1's debounce expires (last touch at t=400 + 500ms)
      vi.advanceTimersByTime(400);
      expect(batches).toHaveLength(1);
      expect(batches[0].events[0].path).toContain('note1');

      // At t=1000, note2's debounce expires (last touch at t=500 + 500ms)
      vi.advanceTimersByTime(100);
      expect(batches).toHaveLength(2);

      queue.dispose();
    });
  });

  describe('interleaved add/change/unlink sequences', () => {
    it('should handle complex event sequences correctly', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 100 }),
        (batch) => batches.push(batch)
      );

      // File created, modified multiple times, then deleted
      queue.push('add', '/temp.md');
      queue.push('change', '/temp.md');
      queue.push('change', '/temp.md');
      queue.push('unlink', '/temp.md');

      vi.advanceTimersByTime(200);

      expect(batches).toHaveLength(1);
      expect(batches[0].events[0].type).toBe('delete');

      queue.dispose();
    });

    it('should handle rename sequence (delete + create)', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 100 }),
        (batch) => batches.push(batch)
      );

      // Old file deleted
      queue.push('unlink', '/old-name.md');
      // New file created
      queue.push('add', '/new-name.md');

      vi.advanceTimersByTime(200);

      // Should have two separate events (different paths)
      expect(batches).toHaveLength(2);

      const types = batches.map(b => b.events[0].type);
      expect(types).toContain('delete');
      expect(types).toContain('upsert');

      queue.dispose();
    });

    it('should handle recreation sequence (delete + create same file)', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 100 }),
        (batch) => batches.push(batch)
      );

      // File deleted then recreated (e.g., save in some editors)
      queue.push('unlink', '/note.md');
      queue.push('add', '/note.md');
      queue.push('change', '/note.md');

      vi.advanceTimersByTime(200);

      expect(batches).toHaveLength(1);
      // Should resolve to upsert (file exists at end)
      expect(batches[0].events[0].type).toBe('upsert');

      queue.dispose();
    });

    it('should handle 100 interleaved sequences correctly', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 100, flushMs: 500 }),
        (batch) => batches.push(batch)
      );

      // 100 files each going through add -> change -> change
      for (let i = 0; i < 100; i++) {
        queue.push('add', `/note${i}.md`);
        queue.push('change', `/note${i}.md`);
        queue.push('change', `/note${i}.md`);
      }

      vi.advanceTimersByTime(200);

      // Should have at most 100 batches (one per unique path debounce)
      // but likely fewer due to flush intervals
      expect(batches.length).toBeGreaterThan(0);

      // All should be upserts
      for (const batch of batches) {
        for (const event of batch.events) {
          expect(event.type).toBe('upsert');
        }
      }

      // Total unique files should be 100
      const allPaths = new Set<string>();
      for (const batch of batches) {
        for (const event of batch.events) {
          allPaths.add(event.path);
        }
      }
      expect(allPaths.size).toBe(100);

      queue.dispose();
    });
  });

  describe('debounce timing precision', () => {
    it('should respect debounce timing within tolerance', () => {
      const batchTimes: number[] = [];
      let startTime = 0;

      const queue = new EventQueue(
        createConfig({ debounceMs: 500 }),
        () => {
          batchTimes.push(Date.now() - startTime);
        }
      );

      startTime = Date.now();
      queue.push('change', '/note.md');

      // Advance time by exactly debounceMs
      vi.advanceTimersByTime(500);

      // Should have received batch at approximately 500ms
      expect(batchTimes).toHaveLength(1);
      // Allow 20% tolerance for fake timer precision
      expect(batchTimes[0]).toBeGreaterThanOrEqual(500);
      expect(batchTimes[0]).toBeLessThanOrEqual(600);

      queue.dispose();
    });

    it('should reset debounce timer on new events', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 200 }),
        (batch) => batches.push(batch)
      );

      queue.push('change', '/note.md');

      // Advance 150ms (before debounce)
      vi.advanceTimersByTime(150);
      expect(batches).toHaveLength(0);

      // New event resets timer
      queue.push('change', '/note.md');

      // Advance another 150ms (300ms total, but only 150ms since last event)
      vi.advanceTimersByTime(150);
      expect(batches).toHaveLength(0);

      // Advance remaining 50ms (200ms since last event)
      vi.advanceTimersByTime(50);
      expect(batches).toHaveLength(1);

      queue.dispose();
    });
  });

  describe('flush interval behavior', () => {
    it('should flush on interval even if debounce not expired', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 10000, flushMs: 500 }),
        (batch) => batches.push(batch)
      );

      queue.push('change', '/note.md');

      // Debounce is 10s, but flush is 500ms
      vi.advanceTimersByTime(600);

      // Should have flushed due to flush interval
      expect(batches).toHaveLength(1);

      queue.dispose();
    });

    it('should not double-flush when debounce and flush coincide', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 500, flushMs: 500 }),
        (batch) => batches.push(batch)
      );

      queue.push('change', '/note.md');

      vi.advanceTimersByTime(600);

      // Should only flush once
      expect(batches).toHaveLength(1);
      expect(batches[0].events).toHaveLength(1);

      queue.dispose();
    });
  });

  describe('concurrent path handling', () => {
    it('should handle 500 concurrent file changes', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 100, flushMs: 1000, batchSize: 100 }),
        (batch) => batches.push(batch)
      );

      // Simulate 500 files being changed concurrently
      const paths: string[] = [];
      for (let i = 0; i < 500; i++) {
        const path = `/vault/folder${Math.floor(i / 50)}/note${i}.md`;
        paths.push(path);
        queue.push('change', path);
      }

      // Batch size triggers multiple flushes
      expect(batches.length).toBeGreaterThanOrEqual(5);

      // Wait for remaining
      vi.advanceTimersByTime(1100);

      // All 500 unique paths should be processed
      const processedPaths = new Set<string>();
      for (const batch of batches) {
        for (const event of batch.events) {
          processedPaths.add(event.path);
        }
      }
      expect(processedPaths.size).toBe(500);

      queue.dispose();
    });
  });
});
