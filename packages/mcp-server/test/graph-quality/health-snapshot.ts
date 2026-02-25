/**
 * Graph Health Snapshot Diff Tool
 *
 * Computes before/after graph health snapshots and produces readable diffs.
 * Supports serialization for cross-session comparison.
 *
 * Usage in tests:
 *   const before = await takeSnapshot(vaultPath);
 *   // ... perform mutations ...
 *   const after = await takeSnapshot(vaultPath);
 *   const diff = diffSnapshots(before, after);
 *   console.log(formatSnapshotDiff(diff));
 *
 * Usage for cross-session persistence:
 *   const snapshot = await takeSnapshot(vaultPath);
 *   await saveSnapshot(snapshot, '/path/to/snapshot.json');
 *   // ... later session ...
 *   const loaded = await loadSnapshot('/path/to/snapshot.json');
 *   const diff = diffSnapshots(loaded, current);
 */

import { readFile, writeFile } from 'fs/promises';
import { computeGraphHealth, type GraphHealthReport } from './harness.js';

// =============================================================================
// Types
// =============================================================================

/** A timestamped graph health snapshot */
export interface HealthSnapshot {
  timestamp: string;
  vaultPath: string;
  label: string;
  health: GraphHealthReport;
}

/** Difference between two metric values */
export interface MetricDiff {
  metric: string;
  before: number;
  after: number;
  delta: number;
  percentChange: number;
  severity: 'ok' | 'warning' | 'critical';
}

/** Full diff report between two snapshots */
export interface SnapshotDiff {
  before: { timestamp: string; label: string };
  after: { timestamp: string; label: string };
  metrics: MetricDiff[];
  summary: {
    improved: number;
    degraded: number;
    unchanged: number;
    critical: number;
  };
}

// =============================================================================
// Thresholds for severity classification
// =============================================================================

const METRIC_THRESHOLDS: Record<string, { warn: number; crit: number; direction: 'higher_is_better' | 'lower_is_better' }> = {
  noteCount: { warn: 0.10, crit: 0.25, direction: 'higher_is_better' },
  linkCount: { warn: 0.10, crit: 0.25, direction: 'higher_is_better' },
  linkDensity: { warn: 0.15, crit: 0.30, direction: 'higher_is_better' },
  orphanRate: { warn: 0.10, crit: 0.20, direction: 'lower_is_better' },
  orphanCount: { warn: 0.15, crit: 0.30, direction: 'lower_is_better' },
  entityCoverage: { warn: 0.10, crit: 0.20, direction: 'higher_is_better' },
  connectedness: { warn: 0.05, crit: 0.15, direction: 'higher_is_better' },
  clusterCount: { warn: 0.20, crit: 0.50, direction: 'lower_is_better' },
  giniCoefficient: { warn: 0.15, crit: 0.30, direction: 'lower_is_better' },
  clusteringCoefficient: { warn: 0.15, crit: 0.30, direction: 'higher_is_better' },
  avgPathLength: { warn: 0.20, crit: 0.40, direction: 'lower_is_better' },
  degreeCentralityStdDev: { warn: 0.20, crit: 0.40, direction: 'higher_is_better' },
};

// =============================================================================
// Snapshot Operations
// =============================================================================

/**
 * Take a graph health snapshot of a vault.
 */
export async function takeSnapshot(
  vaultPath: string,
  label: string = 'snapshot',
): Promise<HealthSnapshot> {
  const health = await computeGraphHealth(vaultPath);
  return {
    timestamp: new Date().toISOString(),
    vaultPath,
    label,
    health,
  };
}

/**
 * Save a snapshot to a JSON file for cross-session comparison.
 */
export async function saveSnapshot(
  snapshot: HealthSnapshot,
  filePath: string,
): Promise<void> {
  await writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
}

/**
 * Load a snapshot from a JSON file.
 */
export async function loadSnapshot(filePath: string): Promise<HealthSnapshot> {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as HealthSnapshot;
}

// =============================================================================
// Diff Computation
// =============================================================================

/**
 * Compute the diff between two health snapshots.
 */
export function diffSnapshots(
  before: HealthSnapshot,
  after: HealthSnapshot,
): SnapshotDiff {
  const metrics: MetricDiff[] = [];

  const metricKeys: (keyof GraphHealthReport)[] = [
    'noteCount', 'linkCount', 'linkDensity', 'orphanRate', 'orphanCount',
    'entityCoverage', 'connectedness', 'clusterCount', 'giniCoefficient',
    'clusteringCoefficient', 'avgPathLength', 'degreeCentralityStdDev',
  ];

  for (const key of metricKeys) {
    const beforeVal = before.health[key] as number;
    const afterVal = after.health[key] as number;
    const delta = afterVal - beforeVal;
    const percentChange = beforeVal !== 0 ? Math.abs(delta / beforeVal) : (afterVal !== 0 ? 1 : 0);

    const threshold = METRIC_THRESHOLDS[key];
    let severity: MetricDiff['severity'] = 'ok';

    if (threshold) {
      const isDegradation =
        (threshold.direction === 'higher_is_better' && delta < 0) ||
        (threshold.direction === 'lower_is_better' && delta > 0);

      if (isDegradation) {
        if (percentChange >= threshold.crit) {
          severity = 'critical';
        } else if (percentChange >= threshold.warn) {
          severity = 'warning';
        }
      }
    }

    metrics.push({
      metric: key,
      before: beforeVal,
      after: afterVal,
      delta: Math.round(delta * 1000) / 1000,
      percentChange: Math.round(percentChange * 1000) / 1000,
      severity,
    });
  }

  const improved = metrics.filter(m => {
    const t = METRIC_THRESHOLDS[m.metric];
    if (!t) return false;
    return (t.direction === 'higher_is_better' && m.delta > 0) ||
           (t.direction === 'lower_is_better' && m.delta < 0);
  }).length;

  const degraded = metrics.filter(m => m.severity !== 'ok').length;
  const unchanged = metrics.filter(m => m.delta === 0).length;
  const critical = metrics.filter(m => m.severity === 'critical').length;

  return {
    before: { timestamp: before.timestamp, label: before.label },
    after: { timestamp: after.timestamp, label: after.label },
    metrics,
    summary: { improved, degraded, unchanged, critical },
  };
}

// =============================================================================
// Formatting
// =============================================================================

/**
 * Format a snapshot diff as a readable string report.
 */
export function formatSnapshotDiff(diff: SnapshotDiff): string {
  const lines: string[] = [];

  lines.push('=== Graph Health Snapshot Diff ===');
  lines.push(`Before: ${diff.before.label} (${diff.before.timestamp})`);
  lines.push(`After:  ${diff.after.label} (${diff.after.timestamp})`);
  lines.push('');

  // Summary
  lines.push(`Summary: ${diff.summary.improved} improved, ${diff.summary.degraded} degraded, ${diff.summary.unchanged} unchanged`);
  if (diff.summary.critical > 0) {
    lines.push(`  !! ${diff.summary.critical} CRITICAL degradation(s)`);
  }
  lines.push('');

  // Metric table
  lines.push('Metric                     Before    After     Delta     Change    Status');
  lines.push('-'.repeat(80));

  for (const m of diff.metrics) {
    const name = m.metric.padEnd(25);
    const before = String(m.before).padStart(8);
    const after = String(m.after).padStart(8);
    const delta = (m.delta >= 0 ? `+${m.delta}` : String(m.delta)).padStart(8);
    const pct = `${(m.percentChange * 100).toFixed(1)}%`.padStart(8);
    const status = m.severity === 'critical' ? '!! CRIT' :
                   m.severity === 'warning' ? '! WARN' : 'ok';
    lines.push(`${name} ${before}  ${after}  ${delta}  ${pct}  ${status}`);
  }

  return lines.join('\n');
}
