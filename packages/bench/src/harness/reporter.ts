/**
 * Benchmark result reporting - JSON and Markdown output
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { BenchmarkResult, BenchmarkMetrics, Regression } from '../types.js';

/**
 * Write benchmark results to JSON file
 */
export async function writeJsonReport(
  result: BenchmarkResult,
  outputDir: string
): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });

  const timestamp = result.timestamp.replace(/[:.]/g, '-');
  const filename = `benchmark-${timestamp}.json`;
  const filepath = path.join(outputDir, filename);

  await fs.writeFile(filepath, JSON.stringify(result, null, 2), 'utf-8');

  return filepath;
}

/**
 * Write benchmark results to Markdown file
 */
export async function writeMarkdownReport(
  result: BenchmarkResult,
  outputDir: string
): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });

  const timestamp = result.timestamp.replace(/[:.]/g, '-');
  const filename = `benchmark-${timestamp}.md`;
  const filepath = path.join(outputDir, filename);

  const markdown = generateMarkdown(result);
  await fs.writeFile(filepath, markdown, 'utf-8');

  return filepath;
}

/**
 * Generate Markdown report content
 */
function generateMarkdown(result: BenchmarkResult): string {
  const lines: string[] = [];

  // Header
  lines.push('# Benchmark Results');
  lines.push('');
  lines.push(`**Timestamp:** ${result.timestamp}`);
  lines.push(`**Commit:** ${result.commit}`);
  lines.push(`**Node:** ${result.nodeVersion}`);
  lines.push(`**Platform:** ${result.platform}`);
  lines.push('');

  // Summary table
  lines.push('## Summary');
  lines.push('');

  const scales = Object.keys(result.scales).sort((a, b) => Number(a) - Number(b));
  const benchmarks = new Set<string>();
  for (const scale of scales) {
    for (const name of Object.keys(result.scales[scale])) {
      benchmarks.add(name);
    }
  }

  // Create summary table header
  const headers = ['Benchmark', ...scales.map(s => `${formatNumber(Number(s))} notes`)];
  lines.push(`| ${headers.join(' | ')} |`);
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`);

  // Create summary table rows
  for (const name of benchmarks) {
    const row = [name];
    for (const scale of scales) {
      const metrics = result.scales[scale]?.[name];
      if (metrics) {
        row.push(`${metrics.mean_ms.toFixed(1)}ms`);
      } else {
        row.push('-');
      }
    }
    lines.push(`| ${row.join(' | ')} |`);
  }

  lines.push('');

  // Detailed results per scale
  for (const scale of scales) {
    lines.push(`## ${formatNumber(Number(scale))} Notes`);
    lines.push('');

    const scaleResult = result.scales[scale];
    for (const [name, metrics] of Object.entries(scaleResult)) {
      lines.push(`### ${name}`);
      lines.push('');
      lines.push(formatMetricsTable(metrics));
      lines.push('');
    }
  }

  // Regressions
  if (result.regressions.length > 0) {
    lines.push('## ⚠️ Regressions Detected');
    lines.push('');
    lines.push('| Benchmark | Scale | Metric | Baseline | Current | Change |');
    lines.push('| --- | --- | --- | --- | --- | --- |');

    for (const reg of result.regressions) {
      const change = reg.change_percent > 0 ? `+${reg.change_percent.toFixed(1)}%` : `${reg.change_percent.toFixed(1)}%`;
      lines.push(`| ${reg.benchmark} | ${formatNumber(reg.scale)} | ${reg.metric} | ${reg.baseline.toFixed(2)}ms | ${reg.current.toFixed(2)}ms | ${change} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format metrics as a table
 */
function formatMetricsTable(metrics: BenchmarkMetrics): string {
  const lines = [
    '| Metric | Value |',
    '| --- | --- |',
    `| Mean | ${metrics.mean_ms.toFixed(2)}ms |`,
    `| Min | ${metrics.min_ms.toFixed(2)}ms |`,
    `| Max | ${metrics.max_ms.toFixed(2)}ms |`,
    `| P50 | ${metrics.p50_ms.toFixed(2)}ms |`,
    `| P95 | ${metrics.p95_ms.toFixed(2)}ms |`,
    `| P99 | ${metrics.p99_ms.toFixed(2)}ms |`,
    `| Std Dev | ${metrics.std_dev.toFixed(2)}ms |`,
    `| Memory | ${metrics.memory_mb.toFixed(2)}MB |`,
    `| Iterations | ${metrics.iterations} |`
  ];
  return lines.join('\n');
}

/**
 * Format large numbers with commas
 */
function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Print results to console
 */
export function printResults(result: BenchmarkResult): void {
  console.log('\n' + '='.repeat(60));
  console.log('BENCHMARK RESULTS');
  console.log('='.repeat(60));
  console.log(`Timestamp: ${result.timestamp}`);
  console.log(`Commit: ${result.commit}`);
  console.log(`Node: ${result.nodeVersion}`);
  console.log(`Platform: ${result.platform}`);
  console.log('');

  for (const [scale, scaleResult] of Object.entries(result.scales)) {
    console.log(`\n${formatNumber(Number(scale))} notes:`);
    console.log('-'.repeat(40));

    for (const [name, metrics] of Object.entries(scaleResult)) {
      console.log(`  ${name}:`);
      console.log(`    Mean: ${metrics.mean_ms.toFixed(2)}ms`);
      console.log(`    P95:  ${metrics.p95_ms.toFixed(2)}ms`);
      console.log(`    Memory: ${metrics.memory_mb.toFixed(2)}MB`);
    }
  }

  if (result.regressions.length > 0) {
    console.log('\n' + '!'.repeat(60));
    console.log('REGRESSIONS DETECTED');
    console.log('!'.repeat(60));

    for (const reg of result.regressions) {
      const change = reg.change_percent > 0 ? `+${reg.change_percent.toFixed(1)}%` : `${reg.change_percent.toFixed(1)}%`;
      console.log(`  ${reg.benchmark} @ ${formatNumber(reg.scale)}: ${reg.metric} ${change} (${reg.baseline.toFixed(2)}ms → ${reg.current.toFixed(2)}ms)`);
    }
  }

  console.log('\n' + '='.repeat(60));
}

/**
 * Create a comparison report between two benchmark results
 */
export function createComparisonReport(
  baseline: BenchmarkResult,
  current: BenchmarkResult
): string {
  const lines: string[] = [];

  lines.push('# Benchmark Comparison');
  lines.push('');
  lines.push(`**Baseline:** ${baseline.commit} (${baseline.timestamp})`);
  lines.push(`**Current:** ${current.commit} (${current.timestamp})`);
  lines.push('');

  const scales = [...new Set([
    ...Object.keys(baseline.scales),
    ...Object.keys(current.scales)
  ])].sort((a, b) => Number(a) - Number(b));

  for (const scale of scales) {
    lines.push(`## ${formatNumber(Number(scale))} Notes`);
    lines.push('');

    const baselineScale = baseline.scales[scale] || {};
    const currentScale = current.scales[scale] || {};
    const benchmarks = [...new Set([
      ...Object.keys(baselineScale),
      ...Object.keys(currentScale)
    ])];

    lines.push('| Benchmark | Baseline | Current | Change |');
    lines.push('| --- | --- | --- | --- |');

    for (const name of benchmarks) {
      const baseMetrics = baselineScale[name];
      const currMetrics = currentScale[name];

      if (baseMetrics && currMetrics) {
        const change = ((currMetrics.mean_ms - baseMetrics.mean_ms) / baseMetrics.mean_ms) * 100;
        const changeStr = change > 0 ? `🔴 +${change.toFixed(1)}%` : `🟢 ${change.toFixed(1)}%`;
        lines.push(`| ${name} | ${baseMetrics.mean_ms.toFixed(2)}ms | ${currMetrics.mean_ms.toFixed(2)}ms | ${changeStr} |`);
      } else if (baseMetrics) {
        lines.push(`| ${name} | ${baseMetrics.mean_ms.toFixed(2)}ms | - | removed |`);
      } else if (currMetrics) {
        lines.push(`| ${name} | - | ${currMetrics.mean_ms.toFixed(2)}ms | new |`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}
