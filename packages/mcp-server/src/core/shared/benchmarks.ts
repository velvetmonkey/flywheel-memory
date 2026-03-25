/**
 * Performance Benchmark Persistence
 *
 * Records, queries, and trends longitudinal performance benchmarks
 * stored in the performance_benchmarks table (schema v33).
 */

import type { StateDb } from '@velvetmonkey/vault-core';

interface BenchmarkResult {
  benchmark: string;
  version: string;
  mean_ms: number;
  p50_ms?: number;
  p95_ms?: number;
  iterations: number;
}

export function recordBenchmark(stateDb: StateDb, result: BenchmarkResult): void {
  stateDb.db.prepare(`
    INSERT INTO performance_benchmarks (timestamp, version, benchmark, mean_ms, p50_ms, p95_ms, iterations)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(Date.now(), result.version, result.benchmark, result.mean_ms, result.p50_ms ?? null, result.p95_ms ?? null, result.iterations);
}

export function getBenchmarkHistory(stateDb: StateDb, benchmark?: string, limit: number = 20) {
  if (benchmark) {
    return stateDb.db.prepare(
      'SELECT * FROM performance_benchmarks WHERE benchmark = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(benchmark, limit);
  }
  return stateDb.db.prepare(
    'SELECT * FROM performance_benchmarks ORDER BY timestamp DESC LIMIT ?'
  ).all(limit);
}

export function getBenchmarkTrends(stateDb: StateDb, benchmark: string, daysBack: number = 30) {
  const since = Date.now() - daysBack * 86400000;
  const rows = stateDb.db.prepare(
    'SELECT * FROM performance_benchmarks WHERE benchmark = ? AND timestamp > ? ORDER BY timestamp DESC'
  ).all(benchmark, since) as Array<{ mean_ms: number; p50_ms: number | null; timestamp: number; version: string }>;

  if (rows.length === 0) return { benchmark, data_points: 0, trend: null };

  const latest = rows[0];
  const avgMean = rows.reduce((s, r) => s + r.mean_ms, 0) / rows.length;

  return {
    benchmark,
    data_points: rows.length,
    latest: { mean_ms: latest.mean_ms, p50_ms: latest.p50_ms, version: latest.version, timestamp: latest.timestamp },
    average_mean_ms: Math.round(avgMean * 100) / 100,
    delta_pct: rows.length > 1 ? Math.round((latest.mean_ms - avgMean) / avgMean * 100 * 10) / 10 : null,
    trend: rows.length > 1 ? (latest.mean_ms > avgMean * 1.1 ? 'regression' : latest.mean_ms < avgMean * 0.9 ? 'improvement' : 'stable') : null,
  };
}

export function purgeOldBenchmarks(stateDb: StateDb, retentionDays: number = 90): void {
  const cutoff = Date.now() - retentionDays * 86400000;
  stateDb.db.prepare('DELETE FROM performance_benchmarks WHERE timestamp < ?').run(cutoff);
}
