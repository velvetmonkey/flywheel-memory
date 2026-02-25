/**
 * Shared diagnostic report infrastructure for graph quality test suites.
 *
 * Each suite writes a JSON report to test/graph-quality/reports/<suite>.json
 * with standardized structure: summary metrics, detailed results, and
 * actionable tuning recommendations.
 */

import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// =============================================================================
// Types
// =============================================================================

export interface TuningRecommendation {
  parameter: string;
  current_value: number;
  suggested_value: number;
  evidence: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface TestReport {
  suite: string;
  timestamp: string;
  duration_ms: number;
  summary: Record<string, number>;
  details: unknown[];
  tuning_recommendations: TuningRecommendation[];
}

// =============================================================================
// Report Directory
// =============================================================================

function getReportsDir(): string {
  if (typeof __dirname !== 'undefined') {
    return path.join(__dirname, 'reports');
  }
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'reports');
}

// =============================================================================
// Report Writer
// =============================================================================

/**
 * Write a diagnostic JSON report for a test suite.
 *
 * Reports accumulate in test/graph-quality/reports/ and can be diffed
 * across runs to track tuning progress.
 */
export async function writeReport(report: TestReport): Promise<string> {
  const dir = getReportsDir();
  await mkdir(dir, { recursive: true });

  const filePath = path.join(dir, `${report.suite}.json`);
  await writeFile(filePath, JSON.stringify(report, null, 2), 'utf-8');
  return filePath;
}

// =============================================================================
// Statistics Helpers
// =============================================================================

/** Compute percentile from a sorted array of numbers */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Compute distribution stats from an array of numbers */
export function distributionStats(values: number[]): {
  mean: number;
  p50: number;
  p90: number;
  min: number;
  max: number;
} {
  if (values.length === 0) {
    return { mean: 0, p50: 0, p90: 0, min: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    mean: round(sum / sorted.length),
    p50: round(percentile(sorted, 50)),
    p90: round(percentile(sorted, 90)),
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
  };
}

/** Round to 4 decimal places */
function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// =============================================================================
// Layer Classification
// =============================================================================

export type LayerClassification = 'CORE' | 'USEFUL' | 'MARGINAL' | 'HARMFUL';

/** Classify a layer based on F1 delta when disabled */
export function classifyLayer(f1Delta: number): LayerClassification {
  if (f1Delta < 0) return 'HARMFUL';   // F1 *increases* when layer disabled
  if (f1Delta >= 0.05) return 'CORE';
  if (f1Delta >= 0.01) return 'USEFUL';
  return 'MARGINAL';
}

// =============================================================================
// Timer
// =============================================================================

/** Simple wall-clock timer for epoch/round measurements */
export class Timer {
  private start: number;

  constructor() {
    this.start = Date.now();
  }

  elapsed(): number {
    return Date.now() - this.start;
  }

  reset(): void {
    this.start = Date.now();
  }
}
