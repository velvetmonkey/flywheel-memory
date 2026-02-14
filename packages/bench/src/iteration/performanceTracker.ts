/**
 * Performance tracking over time - detect degradation
 */

import * as fs from 'node:fs/promises';
import type { PerformanceSnapshot } from '../types.js';

/**
 * Performance tracker for monitoring degradation over iterations
 */
export class PerformanceTracker {
  private snapshots: PerformanceSnapshot[] = [];
  private windowSize: number;

  constructor(windowSize: number = 100) {
    this.windowSize = windowSize;
  }

  /**
   * Record a performance snapshot
   */
  record(iteration: number, latency_ms: number): void {
    const memory = process.memoryUsage();

    this.snapshots.push({
      iteration,
      timestamp: new Date().toISOString(),
      mutation_latency_ms: latency_ms,
      memory_mb: memory.rss / (1024 * 1024),
      heap_used_mb: memory.heapUsed / (1024 * 1024)
    });
  }

  /**
   * Get all snapshots
   */
  getSnapshots(): PerformanceSnapshot[] {
    return [...this.snapshots];
  }

  /**
   * Calculate moving average of latency
   */
  getMovingAverage(windowSize?: number): number[] {
    const size = windowSize || this.windowSize;
    const averages: number[] = [];

    for (let i = size - 1; i < this.snapshots.length; i++) {
      const window = this.snapshots.slice(i - size + 1, i + 1);
      const avg = window.reduce((sum, s) => sum + s.mutation_latency_ms, 0) / size;
      averages.push(avg);
    }

    return averages;
  }

  /**
   * Detect performance degradation
   * Returns degradation factor (1.0 = no change, 2.0 = 2x slower)
   */
  getDegradationFactor(): number {
    if (this.snapshots.length < this.windowSize * 2) {
      return 1.0;
    }

    const early = this.snapshots.slice(0, this.windowSize);
    const late = this.snapshots.slice(-this.windowSize);

    const earlyAvg = early.reduce((sum, s) => sum + s.mutation_latency_ms, 0) / early.length;
    const lateAvg = late.reduce((sum, s) => sum + s.mutation_latency_ms, 0) / late.length;

    return lateAvg / earlyAvg;
  }

  /**
   * Get memory growth statistics
   */
  getMemoryGrowth(): {
    initial_mb: number;
    final_mb: number;
    peak_mb: number;
    growth_percent: number;
  } {
    if (this.snapshots.length === 0) {
      return { initial_mb: 0, final_mb: 0, peak_mb: 0, growth_percent: 0 };
    }

    const initial = this.snapshots[0].memory_mb;
    const final = this.snapshots[this.snapshots.length - 1].memory_mb;
    const peak = Math.max(...this.snapshots.map(s => s.memory_mb));
    const growth = ((final - initial) / initial) * 100;

    return {
      initial_mb: initial,
      final_mb: final,
      peak_mb: peak,
      growth_percent: growth
    };
  }

  /**
   * Get latency statistics
   */
  getLatencyStats(): {
    mean_ms: number;
    min_ms: number;
    max_ms: number;
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
  } {
    if (this.snapshots.length === 0) {
      return { mean_ms: 0, min_ms: 0, max_ms: 0, p50_ms: 0, p95_ms: 0, p99_ms: 0 };
    }

    const latencies = this.snapshots.map(s => s.mutation_latency_ms);
    const sorted = [...latencies].sort((a, b) => a - b);
    const n = sorted.length;

    return {
      mean_ms: latencies.reduce((a, b) => a + b, 0) / n,
      min_ms: sorted[0],
      max_ms: sorted[n - 1],
      p50_ms: sorted[Math.floor(n * 0.5)],
      p95_ms: sorted[Math.floor(n * 0.95)],
      p99_ms: sorted[Math.floor(n * 0.99)]
    };
  }

  /**
   * Check if performance is within acceptable bounds
   */
  isHealthy(maxDegradation: number = 2.0, maxMemoryGrowth: number = 200): boolean {
    const degradation = this.getDegradationFactor();
    const memoryGrowth = this.getMemoryGrowth().growth_percent;

    return degradation <= maxDegradation && memoryGrowth <= maxMemoryGrowth;
  }

  /**
   * Generate performance report
   */
  generateReport(): string {
    const latency = this.getLatencyStats();
    const memory = this.getMemoryGrowth();
    const degradation = this.getDegradationFactor();

    const lines: string[] = [
      '# Performance Report',
      '',
      `**Total Snapshots:** ${this.snapshots.length}`,
      '',
      '## Latency',
      '',
      `| Metric | Value |`,
      `| --- | --- |`,
      `| Mean | ${latency.mean_ms.toFixed(2)}ms |`,
      `| Min | ${latency.min_ms.toFixed(2)}ms |`,
      `| Max | ${latency.max_ms.toFixed(2)}ms |`,
      `| P50 | ${latency.p50_ms.toFixed(2)}ms |`,
      `| P95 | ${latency.p95_ms.toFixed(2)}ms |`,
      `| P99 | ${latency.p99_ms.toFixed(2)}ms |`,
      '',
      '## Memory',
      '',
      `| Metric | Value |`,
      `| --- | --- |`,
      `| Initial | ${memory.initial_mb.toFixed(2)}MB |`,
      `| Final | ${memory.final_mb.toFixed(2)}MB |`,
      `| Peak | ${memory.peak_mb.toFixed(2)}MB |`,
      `| Growth | ${memory.growth_percent.toFixed(1)}% |`,
      '',
      '## Degradation',
      '',
      `Performance degradation factor: **${degradation.toFixed(2)}x**`,
      '',
      degradation > 2.0
        ? '⚠️ Performance degraded significantly over the test period.'
        : '✅ Performance remained stable throughout the test.',
      ''
    ];

    return lines.join('\n');
  }

  /**
   * Save snapshots to file
   */
  async saveToFile(filepath: string): Promise<void> {
    await fs.writeFile(filepath, JSON.stringify(this.snapshots, null, 2), 'utf-8');
  }

  /**
   * Load snapshots from file
   */
  async loadFromFile(filepath: string): Promise<void> {
    const content = await fs.readFile(filepath, 'utf-8');
    this.snapshots = JSON.parse(content);
  }

  /**
   * Clear all snapshots
   */
  clear(): void {
    this.snapshots = [];
  }
}

/**
 * Simple timing helper
 */
export function timeOperation<T>(fn: () => T): { result: T; duration_ms: number } {
  const start = performance.now();
  const result = fn();
  const duration_ms = performance.now() - start;
  return { result, duration_ms };
}

/**
 * Async timing helper
 */
export async function timeAsyncOperation<T>(
  fn: () => Promise<T>
): Promise<{ result: T; duration_ms: number }> {
  const start = performance.now();
  const result = await fn();
  const duration_ms = performance.now() - start;
  return { result, duration_ms };
}
