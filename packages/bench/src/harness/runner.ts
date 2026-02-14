/**
 * Benchmark runner - executes benchmarks and collects metrics
 */

import * as os from 'node:os';
import { execSync } from 'node:child_process';
import type {
  BenchmarkConfig,
  BenchmarkSuite,
  BenchmarkResult,
  BenchmarkMetrics,
  ScaleResult
} from '../types.js';
import { detectRegressions } from './regression.js';

/**
 * Default benchmark configuration
 */
export const DEFAULT_CONFIG: BenchmarkConfig = {
  vaultSizes: [1000, 10000],
  outputDir: './benchmark-results',
  warmupIterations: 2,
  iterations: 5
};

/**
 * Main benchmark runner
 */
export class BenchmarkRunner {
  private config: BenchmarkConfig;
  private suites: BenchmarkSuite[] = [];

  constructor(config: Partial<BenchmarkConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register a benchmark suite
   */
  register(suite: BenchmarkSuite): this {
    this.suites.push(suite);
    return this;
  }

  /**
   * Register multiple benchmark suites
   */
  registerAll(suites: BenchmarkSuite[]): this {
    this.suites.push(...suites);
    return this;
  }

  /**
   * Run all registered benchmarks
   */
  async run(vaultPaths: Map<number, string>): Promise<BenchmarkResult> {
    const results: BenchmarkResult = {
      timestamp: new Date().toISOString(),
      commit: getGitCommit(),
      nodeVersion: process.version,
      platform: `${os.platform()}-${os.arch()}`,
      scales: {},
      regressions: []
    };

    for (const size of this.config.vaultSizes) {
      const vaultPath = vaultPaths.get(size);
      if (!vaultPath) {
        console.warn(`No vault path provided for size ${size}, skipping`);
        continue;
      }

      console.log(`\nRunning benchmarks for ${size} notes...`);
      results.scales[String(size)] = await this.runScale(vaultPath, size);
    }

    // Check for regressions if baseline provided
    if (this.config.baseline) {
      results.regressions = await detectRegressions(results, this.config.baseline);
    }

    return results;
  }

  /**
   * Run benchmarks for a single scale
   */
  private async runScale(vaultPath: string, size: number): Promise<ScaleResult> {
    const scaleResult: ScaleResult = {};

    for (const suite of this.suites) {
      console.log(`  Running: ${suite.name}...`);

      // Setup if provided
      if (suite.setup) {
        await suite.setup(vaultPath);
      }

      const metrics = await this.runSuite(suite, vaultPath, size);
      scaleResult[suite.name] = metrics;

      console.log(`    Mean: ${metrics.mean_ms.toFixed(2)}ms, P95: ${metrics.p95_ms.toFixed(2)}ms`);

      // Teardown if provided
      if (suite.teardown) {
        await suite.teardown(vaultPath);
      }
    }

    return scaleResult;
  }

  /**
   * Run a single benchmark suite
   */
  private async runSuite(
    suite: BenchmarkSuite,
    vaultPath: string,
    size: number
  ): Promise<BenchmarkMetrics> {
    const timings: number[] = [];
    const memoryReadings: number[] = [];

    // Warmup iterations
    for (let i = 0; i < (this.config.warmupIterations || 2); i++) {
      await suite.fn(vaultPath, size);
      // Allow GC between warmup runs
      if (global.gc) global.gc();
    }

    // Measurement iterations
    for (let i = 0; i < (this.config.iterations || 5); i++) {
      // Record memory before
      const memBefore = process.memoryUsage().heapUsed;

      // Time the execution
      const start = performance.now();
      await suite.fn(vaultPath, size);
      const end = performance.now();

      // Record memory after
      const memAfter = process.memoryUsage().heapUsed;

      timings.push(end - start);
      memoryReadings.push(Math.max(0, memAfter - memBefore));

      // Allow GC between measurement runs
      if (global.gc) global.gc();
    }

    return calculateMetrics(timings, memoryReadings);
  }
}

/**
 * Calculate statistics from timing data
 */
function calculateMetrics(timings: number[], memoryReadings: number[]): BenchmarkMetrics {
  const sorted = [...timings].sort((a, b) => a - b);
  const n = sorted.length;

  const mean = timings.reduce((a, b) => a + b, 0) / n;
  const variance = timings.reduce((sum, t) => sum + Math.pow(t - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);

  const avgMemory = memoryReadings.reduce((a, b) => a + b, 0) / memoryReadings.length;

  return {
    mean_ms: mean,
    min_ms: sorted[0],
    max_ms: sorted[n - 1],
    p50_ms: percentile(sorted, 0.5),
    p95_ms: percentile(sorted, 0.95),
    p99_ms: percentile(sorted, 0.99),
    std_dev: stdDev,
    memory_mb: avgMemory / (1024 * 1024),
    iterations: n
  };
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sorted: number[], p: number): number {
  const index = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Get current git commit hash
 */
function getGitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Create a simple benchmark suite from a function
 */
export function benchmark(
  name: string,
  fn: (vaultPath: string, size: number) => Promise<void>
): BenchmarkSuite {
  return { name, fn };
}

/**
 * Run benchmarks with a simpler API
 */
export async function runBenchmarks(
  suites: BenchmarkSuite[],
  vaultPaths: Map<number, string>,
  config: Partial<BenchmarkConfig> = {}
): Promise<BenchmarkResult> {
  const runner = new BenchmarkRunner(config);
  runner.registerAll(suites);
  return runner.run(vaultPaths);
}
