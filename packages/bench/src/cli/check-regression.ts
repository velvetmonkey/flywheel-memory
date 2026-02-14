#!/usr/bin/env tsx
/**
 * CLI for checking performance regressions in benchmark results
 *
 * Usage:
 *   npm run check-regression -- /path/to/results.json
 *   npm run check-regression -- /path/to/results-1k.json /path/to/results-10k.json
 */

import fs from 'fs/promises';

interface BenchmarkResult {
  timestamp: string;
  commit?: string;
  scale: number;
  metrics: {
    indexBuild_ms?: number;
    mutation_p95_ms?: number;
    mutation_mean_ms?: number;
    memory_mb?: number;
    [key: string]: number | undefined;
  };
}

interface RegressionThresholds {
  indexBuild_ms: number;
  mutation_p95_ms: number;
  mutation_mean_ms: number;
  memory_mb: number;
}

// Thresholds by scale (in ms or MB)
const THRESHOLDS: Record<number, RegressionThresholds> = {
  1000: { indexBuild_ms: 1000, mutation_p95_ms: 50, mutation_mean_ms: 30, memory_mb: 100 },
  10000: { indexBuild_ms: 5000, mutation_p95_ms: 100, mutation_mean_ms: 60, memory_mb: 300 },
  50000: { indexBuild_ms: 15000, mutation_p95_ms: 100, mutation_mean_ms: 80, memory_mb: 800 },
  100000: { indexBuild_ms: 30000, mutation_p95_ms: 150, mutation_mean_ms: 100, memory_mb: 1500 },
};

async function loadResult(filePath: string): Promise<BenchmarkResult> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

function checkThreshold(
  value: number | undefined,
  threshold: number,
  metricName: string,
  scale: number
): { passed: boolean; message: string } {
  if (value === undefined) {
    return { passed: true, message: `  ${metricName}: not measured` };
  }

  const passed = value <= threshold;
  const status = passed ? '\u2705' : '\u274c';
  const message = `  ${status} ${metricName}: ${value.toFixed(2)} (threshold: ${threshold})`;

  return { passed, message };
}

async function main(): Promise<void> {
  const files = process.argv.slice(2).filter(f => !f.startsWith('--'));

  if (files.length === 0) {
    console.error('Usage: check-regression <result.json> [result2.json ...]');
    process.exit(1);
  }

  console.log('Checking for performance regressions...\n');

  let allPassed = true;

  for (const file of files) {
    try {
      const result = await loadResult(file);
      const scale = result.scale;
      const thresholds = THRESHOLDS[scale] || THRESHOLDS[10000]; // Default to 10k thresholds

      console.log(`=== ${file} (${scale} notes) ===`);
      console.log(`Timestamp: ${result.timestamp}`);
      if (result.commit) {
        console.log(`Commit: ${result.commit}`);
      }
      console.log();

      const checks = [
        checkThreshold(result.metrics.indexBuild_ms, thresholds.indexBuild_ms, 'Index build', scale),
        checkThreshold(result.metrics.mutation_p95_ms, thresholds.mutation_p95_ms, 'Mutation P95', scale),
        checkThreshold(result.metrics.mutation_mean_ms, thresholds.mutation_mean_ms, 'Mutation mean', scale),
        checkThreshold(result.metrics.memory_mb, thresholds.memory_mb, 'Memory', scale),
      ];

      for (const check of checks) {
        console.log(check.message);
        if (!check.passed) {
          allPassed = false;
        }
      }

      console.log();
    } catch (error) {
      console.error(`Error processing ${file}:`, error);
      allPassed = false;
    }
  }

  if (!allPassed) {
    console.log('\u274c Some performance thresholds exceeded!');
    process.exit(1);
  }

  console.log('\u2705 All performance thresholds passed!');
  process.exit(0);
}

main();
