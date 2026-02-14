/**
 * Performance benchmarks for file watcher components
 *
 * These tests establish performance baselines and ensure the watcher
 * can handle expected load within acceptable time bounds.
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

describe('Watcher Performance Benchmarks', () => {
  describe('event throughput', () => {
    it('should handle >10,000 events/sec push rate', () => {
      const batches: EventBatch[] = [];
      // Use large debounce/flush to prevent automatic flushes during test
      const queue = new EventQueue(
        createConfig({ debounceMs: 60000, flushMs: 60000, batchSize: 100000 }),
        (batch) => batches.push(batch)
      );

      const eventCount = 10000;
      const start = performance.now();

      for (let i = 0; i < eventCount; i++) {
        queue.push('change', `/note${i % 1000}.md`);
      }

      const elapsed = performance.now() - start;
      const eventsPerSecond = (eventCount / elapsed) * 1000;

      // Should handle at least 10,000 events per second
      expect(eventsPerSecond).toBeGreaterThan(10000);

      // Log for visibility
      console.log(`Event push throughput: ${Math.round(eventsPerSecond).toLocaleString()} events/sec`);

      queue.dispose();
    });

    it('should maintain throughput under sustained load', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 60000, flushMs: 60000, batchSize: 100000 }),
        (batch) => batches.push(batch)
      );

      const iterations = 10;
      const eventsPerIteration = 5000;
      const throughputs: number[] = [];

      for (let iter = 0; iter < iterations; iter++) {
        const start = performance.now();

        for (let i = 0; i < eventsPerIteration; i++) {
          queue.push('change', `/iteration${iter}/note${i}.md`);
        }

        const elapsed = performance.now() - start;
        throughputs.push((eventsPerIteration / elapsed) * 1000);
      }

      // Check that throughput doesn't degrade severely
      const avgThroughput = throughputs.reduce((a, b) => a + b) / throughputs.length;
      const minThroughput = Math.min(...throughputs);

      // Minimum should be at least 20% of average (tolerate GC pauses, CI variability)
      expect(minThroughput).toBeGreaterThan(avgThroughput * 0.2);

      // Minimum should still be reasonable (at least 10k/sec)
      expect(minThroughput).toBeGreaterThan(10000);

      console.log(`Sustained throughput: avg=${Math.round(avgThroughput).toLocaleString()}, min=${Math.round(minThroughput).toLocaleString()} events/sec`);

      queue.dispose();
    });
  });

  describe('coalesce performance', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should coalesce 1000 events in <10ms', () => {
      let coalesceTime = 0;
      const queue = new EventQueue(
        createConfig({ debounceMs: 100 }),
        () => {
          coalesceTime = performance.now();
        }
      );

      // Add 1000 events to same path
      for (let i = 0; i < 1000; i++) {
        queue.push('change', '/note.md');
      }

      const beforeFlush = performance.now();

      // Trigger flush
      vi.advanceTimersByTime(150);

      const actualCoalesceTime = coalesceTime - beforeFlush;

      // Coalesce should complete in under 10ms
      expect(actualCoalesceTime).toBeLessThan(10);

      console.log(`1000-event coalesce time: ${actualCoalesceTime.toFixed(2)}ms`);

      queue.dispose();
    });

    it('should coalesce 10,000 events across 1000 paths in <50ms', () => {
      let coalesceTime = 0;
      const queue = new EventQueue(
        createConfig({ debounceMs: 100, flushMs: 100 }),
        () => {
          coalesceTime = performance.now();
        }
      );

      // Add 10 events to each of 1000 paths
      for (let path = 0; path < 1000; path++) {
        for (let i = 0; i < 10; i++) {
          queue.push('change', `/note${path}.md`);
        }
      }

      const beforeFlush = performance.now();

      // Trigger flush via interval
      vi.advanceTimersByTime(150);

      // May have multiple batches, measure first one
      const actualCoalesceTime = coalesceTime - beforeFlush;

      // Should complete in under 50ms
      expect(actualCoalesceTime).toBeLessThan(50);

      console.log(`10000-event multi-path coalesce time: ${actualCoalesceTime.toFixed(2)}ms`);

      queue.dispose();
    });
  });

  describe('memory efficiency', () => {
    it('should not grow memory linearly with event count for same path', () => {
      const queue = new EventQueue(
        createConfig({ debounceMs: 60000, flushMs: 60000 }),
        () => {}
      );

      // Push 100 events to same path
      for (let i = 0; i < 100; i++) {
        queue.push('change', '/note.md');
      }

      // Should still have only 1 path being tracked
      expect(queue.size).toBe(1);
      // But 100 events accumulated
      expect(queue.eventCount).toBe(100);

      // Push another 900 events
      for (let i = 0; i < 900; i++) {
        queue.push('change', '/note.md');
      }

      // Still 1 path
      expect(queue.size).toBe(1);
      expect(queue.eventCount).toBe(1000);

      queue.dispose();
    });

    it('should bound pending paths with batch size limit', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 60000, batchSize: 100 }),
        (batch) => batches.push(batch)
      );

      // Push events to 500 unique paths
      for (let i = 0; i < 500; i++) {
        queue.push('change', `/note${i}.md`);
      }

      // Batch size limit should have triggered multiple flushes
      expect(batches.length).toBeGreaterThanOrEqual(5);

      // Pending paths should be bounded
      expect(queue.size).toBeLessThanOrEqual(100);

      queue.dispose();
    });
  });

  describe('timer management', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should not create excessive timers for many paths', () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 1000, flushMs: 5000, batchSize: 1000 }),
        (batch) => batches.push(batch)
      );

      // Push to 100 unique paths
      for (let i = 0; i < 100; i++) {
        queue.push('change', `/note${i}.md`);
      }

      // Each path has its own timer, plus one flush timer
      // With 100 paths, we should have 101 timers max
      // Test by advancing time and checking all timers fire correctly

      // Advance past debounce
      vi.advanceTimersByTime(1100);

      // All paths should have flushed individually
      expect(batches.length).toBe(100);

      queue.dispose();
    });

    it('should clean up timers on dispose', () => {
      const queue = new EventQueue(
        // Use large batch size to prevent auto-flush during setup
        createConfig({ debounceMs: 10000, batchSize: 200 }),
        () => {}
      );

      // Create many pending timers
      for (let i = 0; i < 100; i++) {
        queue.push('change', `/note${i}.md`);
      }

      expect(queue.size).toBe(100);

      // Dispose should clean everything up
      queue.dispose();

      expect(queue.size).toBe(0);

      // Advancing time should not cause any issues
      vi.advanceTimersByTime(20000);
    });
  });

  describe('event-to-batch latency', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should deliver batch within debounceMs + tolerance', () => {
      const deliveryTimes: number[] = [];
      let pushTime = 0;

      const config = createConfig({ debounceMs: 200 });
      const queue = new EventQueue(config, () => {
        deliveryTimes.push(Date.now() - pushTime);
      });

      pushTime = Date.now();
      queue.push('change', '/note.md');

      vi.advanceTimersByTime(300);

      expect(deliveryTimes).toHaveLength(1);
      // Should be close to debounceMs (200) with some tolerance
      expect(deliveryTimes[0]).toBeGreaterThanOrEqual(200);
      expect(deliveryTimes[0]).toBeLessThanOrEqual(300);

      queue.dispose();
    });

    it('should honor flush interval for long-debounce scenarios', () => {
      const deliveryTimes: number[] = [];
      let pushTime = 0;

      const config = createConfig({ debounceMs: 10000, flushMs: 500 });
      const queue = new EventQueue(config, () => {
        deliveryTimes.push(Date.now() - pushTime);
      });

      pushTime = Date.now();
      queue.push('change', '/note.md');

      vi.advanceTimersByTime(600);

      expect(deliveryTimes).toHaveLength(1);
      // Should flush at flushMs (500), not wait for debounce
      expect(deliveryTimes[0]).toBeGreaterThanOrEqual(500);
      expect(deliveryTimes[0]).toBeLessThanOrEqual(600);

      queue.dispose();
    });
  });

  describe('path normalization overhead', () => {
    it('should normalize paths with minimal overhead', () => {
      const queue = new EventQueue(
        createConfig({ debounceMs: 60000, flushMs: 60000, batchSize: 100000 }),
        () => {}
      );

      const paths = [
        '/simple.md',
        '/folder/nested.md',
        'C:\\Windows\\style\\path.md',
        '/mixed\\slashes/here.md',
        '/very/deeply/nested/folder/structure/file.md',
      ];

      const iterations = 10000;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        queue.push('change', paths[i % paths.length]);
      }

      const elapsed = performance.now() - start;
      const opsPerSecond = (iterations / elapsed) * 1000;

      // Should handle at least 10,000 operations per second even with path normalization
      expect(opsPerSecond).toBeGreaterThan(10000);

      console.log(`Path normalization throughput: ${Math.round(opsPerSecond).toLocaleString()} ops/sec`);

      queue.dispose();
    });
  });

  describe('batch processing simulation', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should deliver batches at predictable intervals under load', () => {
      const batchTimestamps: number[] = [];
      const startTime = Date.now();

      const queue = new EventQueue(
        createConfig({ debounceMs: 100, flushMs: 500, batchSize: 50 }),
        () => {
          batchTimestamps.push(Date.now() - startTime);
        }
      );

      // Continuous event stream for 2 seconds
      for (let t = 0; t < 2000; t += 50) {
        vi.advanceTimersByTime(50);
        queue.push('change', `/note${t % 10}.md`);
      }

      // Final flush
      vi.advanceTimersByTime(1000);

      // Should have multiple batches at roughly flush interval spacing
      expect(batchTimestamps.length).toBeGreaterThan(3);

      // Verify batches are reasonably spaced (within 2x flush interval)
      for (let i = 1; i < batchTimestamps.length; i++) {
        const gap = batchTimestamps[i] - batchTimestamps[i - 1];
        // Allow for some variation but should be roughly aligned with debounce or flush
        expect(gap).toBeLessThanOrEqual(1000);
      }

      queue.dispose();
    });
  });
});
