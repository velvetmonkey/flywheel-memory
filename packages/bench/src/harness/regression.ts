/**
 * Regression detection - compare results against baseline
 */

import * as fs from 'node:fs/promises';
import type { BenchmarkResult, Regression } from '../types.js';

/**
 * Default regression thresholds (percentage change that triggers regression)
 */
export const DEFAULT_THRESHOLDS = {
  mean_ms: 20,      // 20% slower mean
  p95_ms: 25,       // 25% slower P95
  memory_mb: 50     // 50% more memory
};

export interface RegressionOptions {
  /** Threshold percentages per metric */
  thresholds?: Partial<typeof DEFAULT_THRESHOLDS>;
  /** Metrics to check */
  metrics?: Array<keyof typeof DEFAULT_THRESHOLDS>;
}

/**
 * Detect regressions by comparing against a baseline file
 */
export async function detectRegressions(
  current: BenchmarkResult,
  baselinePath: string,
  options: RegressionOptions = {}
): Promise<Regression[]> {
  let baseline: BenchmarkResult;

  try {
    const content = await fs.readFile(baselinePath, 'utf-8');
    baseline = JSON.parse(content);
  } catch (error) {
    console.warn(`Could not load baseline from ${baselinePath}: ${error}`);
    return [];
  }

  return compareResults(current, baseline, options);
}

/**
 * Compare two benchmark results and find regressions
 */
export function compareResults(
  current: BenchmarkResult,
  baseline: BenchmarkResult,
  options: RegressionOptions = {}
): Regression[] {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const metrics = options.metrics || ['mean_ms', 'p95_ms'];
  const regressions: Regression[] = [];

  for (const [scale, currentScale] of Object.entries(current.scales)) {
    const baselineScale = baseline.scales[scale];
    if (!baselineScale) continue;

    for (const [benchmarkName, currentMetrics] of Object.entries(currentScale)) {
      const baselineMetrics = baselineScale[benchmarkName];
      if (!baselineMetrics) continue;

      for (const metric of metrics) {
        const baselineValue = baselineMetrics[metric as keyof typeof baselineMetrics] as number;
        const currentValue = currentMetrics[metric as keyof typeof currentMetrics] as number;

        if (typeof baselineValue !== 'number' || typeof currentValue !== 'number') {
          continue;
        }

        const changePercent = ((currentValue - baselineValue) / baselineValue) * 100;
        const threshold = thresholds[metric as keyof typeof thresholds] || 20;

        // Only flag if regression (positive change = slower/more)
        if (changePercent > threshold) {
          regressions.push({
            benchmark: benchmarkName,
            scale: Number(scale),
            metric,
            baseline: baselineValue,
            current: currentValue,
            change_percent: changePercent,
            threshold_percent: threshold
          });
        }
      }
    }
  }

  return regressions;
}

/**
 * Check if any regressions exceed critical thresholds
 */
export function hasCriticalRegressions(
  regressions: Regression[],
  criticalThreshold: number = 50
): boolean {
  return regressions.some(r => r.change_percent > criticalThreshold);
}

/**
 * Save current results as new baseline
 */
export async function saveBaseline(
  result: BenchmarkResult,
  baselinePath: string
): Promise<void> {
  await fs.writeFile(baselinePath, JSON.stringify(result, null, 2), 'utf-8');
}

/**
 * Load baseline from file
 */
export async function loadBaseline(baselinePath: string): Promise<BenchmarkResult | null> {
  try {
    const content = await fs.readFile(baselinePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Format regressions as CI-friendly output
 */
export function formatRegressionsForCI(regressions: Regression[]): string {
  if (regressions.length === 0) {
    return '✅ No regressions detected';
  }

  const lines = [
    '❌ Performance regressions detected:',
    ''
  ];

  for (const r of regressions) {
    lines.push(`  - ${r.benchmark} @ ${r.scale.toLocaleString()} notes: ${r.metric} +${r.change_percent.toFixed(1)}% (threshold: ${r.threshold_percent}%)`);
    lines.push(`    Baseline: ${r.baseline.toFixed(2)}ms → Current: ${r.current.toFixed(2)}ms`);
  }

  return lines.join('\n');
}

/**
 * Exit with error if regressions found (for CI)
 */
export function exitIfRegressions(regressions: Regression[], exitCode: number = 1): void {
  if (regressions.length > 0) {
    console.error(formatRegressionsForCI(regressions));
    process.exit(exitCode);
  }
}
