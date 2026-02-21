/**
 * Graph Topology Snapshots
 *
 * Computes, records, and queries graph structural metrics over time.
 * Stored in StateDb graph_snapshots table (schema v8).
 */

import type { StateDb } from '@velvetmonkey/vault-core';
import type { VaultIndex } from '../read/types.js';

// =============================================================================
// TYPES
// =============================================================================

export type GraphMetricName =
  | 'avg_degree'
  | 'max_degree'
  | 'cluster_count'
  | 'largest_cluster_size'
  | 'hub_scores_top10';

export interface GraphMetrics {
  avg_degree: number;
  max_degree: number;
  cluster_count: number;
  largest_cluster_size: number;
  hub_scores_top10: Array<{ entity: string; degree: number }>;
}

export interface GraphSnapshot {
  metric: string;
  value: number;
  details: string | null;
  timestamp: number;
}

export interface GraphEvolution {
  metric: string;
  current: number;
  previous: number;
  delta: number;
  delta_percent: number;
  direction: 'up' | 'down' | 'stable';
}

export interface EmergingHub {
  entity: string;
  current_degree: number;
  previous_degree: number;
  growth: number;
}

// =============================================================================
// COMPUTE
// =============================================================================

/**
 * Compute graph topology metrics from VaultIndex
 */
export function computeGraphMetrics(index: VaultIndex): GraphMetrics {
  const noteCount = index.notes.size;

  if (noteCount === 0) {
    return {
      avg_degree: 0,
      max_degree: 0,
      cluster_count: 0,
      largest_cluster_size: 0,
      hub_scores_top10: [],
    };
  }

  // Build degree map: outlinks + backlinks per note path
  const degreeMap = new Map<string, number>();

  // Build adjacency list for cluster detection (bidirectional)
  const adjacency = new Map<string, Set<string>>();

  for (const [notePath, note] of index.notes) {
    if (!adjacency.has(notePath)) adjacency.set(notePath, new Set());

    let degree = note.outlinks.length;

    // Resolve outlinks to actual note paths for adjacency
    for (const link of note.outlinks) {
      const targetLower = link.target.toLowerCase();
      // Try to resolve to a note path via entities map
      const resolvedPath = index.entities.get(targetLower);
      if (resolvedPath && index.notes.has(resolvedPath)) {
        adjacency.get(notePath)!.add(resolvedPath);
        if (!adjacency.has(resolvedPath)) adjacency.set(resolvedPath, new Set());
        adjacency.get(resolvedPath)!.add(notePath);
      }
    }

    degreeMap.set(notePath, degree);
  }

  // Add backlink counts to degree
  for (const [target, backlinks] of index.backlinks) {
    // Resolve target to a note path
    const targetLower = target.toLowerCase();
    const resolvedPath = index.entities.get(targetLower);
    if (resolvedPath && degreeMap.has(resolvedPath)) {
      degreeMap.set(resolvedPath, degreeMap.get(resolvedPath)! + backlinks.length);
    }
  }

  // Compute avg_degree and max_degree
  let totalDegree = 0;
  let maxDegree = 0;
  let maxDegreeNote = '';

  for (const [notePath, degree] of degreeMap) {
    totalDegree += degree;
    if (degree > maxDegree) {
      maxDegree = degree;
      maxDegreeNote = notePath;
    }
  }

  const avgDegree = noteCount > 0 ? Math.round((totalDegree / noteCount) * 100) / 100 : 0;

  // BFS cluster detection
  const visited = new Set<string>();
  const clusters: number[] = [];

  for (const notePath of index.notes.keys()) {
    if (visited.has(notePath)) continue;

    // BFS from this note
    const queue = [notePath];
    visited.add(notePath);
    let clusterSize = 0;

    while (queue.length > 0) {
      const current = queue.shift()!;
      clusterSize++;

      const neighbors = adjacency.get(current);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
    }

    clusters.push(clusterSize);
  }

  const clusterCount = clusters.length;
  const largestClusterSize = clusters.length > 0 ? Math.max(...clusters) : 0;

  // Top 10 hubs by degree
  const sorted = Array.from(degreeMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const hubScoresTop10 = sorted.map(([notePath, degree]) => {
    const note = index.notes.get(notePath);
    return {
      entity: note?.title ?? notePath,
      degree,
    };
  });

  return {
    avg_degree: avgDegree,
    max_degree: maxDegree,
    cluster_count: clusterCount,
    largest_cluster_size: largestClusterSize,
    hub_scores_top10: hubScoresTop10,
  };
}

// =============================================================================
// RECORD
// =============================================================================

/**
 * Record graph topology snapshot to StateDb
 */
export function recordGraphSnapshot(stateDb: StateDb, metrics: GraphMetrics): void {
  const timestamp = Date.now();
  const insert = stateDb.db.prepare(
    'INSERT INTO graph_snapshots (timestamp, metric, value, details) VALUES (?, ?, ?, ?)'
  );

  const transaction = stateDb.db.transaction(() => {
    insert.run(timestamp, 'avg_degree', metrics.avg_degree, null);
    insert.run(timestamp, 'max_degree', metrics.max_degree, null);
    insert.run(timestamp, 'cluster_count', metrics.cluster_count, null);
    insert.run(timestamp, 'largest_cluster_size', metrics.largest_cluster_size, null);
    insert.run(
      timestamp,
      'hub_scores_top10',
      metrics.hub_scores_top10.length,
      JSON.stringify(metrics.hub_scores_top10)
    );
  });

  transaction();
}

// =============================================================================
// QUERY
// =============================================================================

/**
 * Get graph metric history
 */
export function getGraphHistory(
  stateDb: StateDb,
  metric?: string,
  daysBack: number = 30,
): GraphSnapshot[] {
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  let rows: Array<{ timestamp: number; metric: string; value: number; details: string | null }>;

  if (metric) {
    rows = stateDb.db.prepare(
      'SELECT timestamp, metric, value, details FROM graph_snapshots WHERE metric = ? AND timestamp >= ? ORDER BY timestamp'
    ).all(metric, cutoff) as typeof rows;
  } else {
    rows = stateDb.db.prepare(
      'SELECT timestamp, metric, value, details FROM graph_snapshots WHERE timestamp >= ? ORDER BY timestamp'
    ).all(cutoff) as typeof rows;
  }

  return rows.map(r => ({
    metric: r.metric,
    value: r.value,
    details: r.details,
    timestamp: r.timestamp,
  }));
}

/**
 * Compare current graph metrics vs N days ago
 */
export function getGraphEvolution(
  stateDb: StateDb,
  daysBack: number = 30,
): GraphEvolution[] {
  const now = Date.now();
  const cutoff = now - daysBack * 24 * 60 * 60 * 1000;

  const SCALAR_METRICS = ['avg_degree', 'max_degree', 'cluster_count', 'largest_cluster_size'];

  // Get latest values for each metric
  const latestRows = stateDb.db.prepare(`
    SELECT metric, value FROM graph_snapshots
    WHERE metric IN ('avg_degree', 'max_degree', 'cluster_count', 'largest_cluster_size')
    GROUP BY metric
    HAVING timestamp = MAX(timestamp)
  `).all() as Array<{ metric: string; value: number }>;

  const currentValues = new Map<string, number>();
  for (const row of latestRows) {
    currentValues.set(row.metric, row.value);
  }

  // Get earliest values after cutoff for each metric
  const previousRows = stateDb.db.prepare(`
    SELECT metric, value FROM graph_snapshots
    WHERE metric IN ('avg_degree', 'max_degree', 'cluster_count', 'largest_cluster_size')
      AND timestamp >= ? AND timestamp <= ?
    GROUP BY metric
    HAVING timestamp = MIN(timestamp)
  `).all(cutoff, cutoff + 24 * 60 * 60 * 1000) as Array<{ metric: string; value: number }>;

  const previousValues = new Map<string, number>();
  for (const row of previousRows) {
    previousValues.set(row.metric, row.value);
  }

  // If no rows in the range, try getting earliest recorded value
  if (previousValues.size === 0) {
    const fallbackRows = stateDb.db.prepare(`
      SELECT metric, value FROM graph_snapshots
      WHERE metric IN ('avg_degree', 'max_degree', 'cluster_count', 'largest_cluster_size')
        AND timestamp >= ?
      GROUP BY metric
      HAVING timestamp = MIN(timestamp)
    `).all(cutoff) as Array<{ metric: string; value: number }>;

    for (const row of fallbackRows) {
      previousValues.set(row.metric, row.value);
    }
  }

  const evolutions: GraphEvolution[] = [];

  for (const metric of SCALAR_METRICS) {
    const current = currentValues.get(metric) ?? 0;
    const previous = previousValues.get(metric) ?? current;
    const delta = current - previous;
    const deltaPct = previous !== 0
      ? Math.round((delta / previous) * 10000) / 100
      : (delta !== 0 ? 100 : 0);

    let direction: 'up' | 'down' | 'stable' = 'stable';
    if (delta > 0) direction = 'up';
    if (delta < 0) direction = 'down';

    evolutions.push({
      metric,
      current,
      previous,
      delta,
      delta_percent: deltaPct,
      direction,
    });
  }

  return evolutions;
}

/**
 * Find entities growing fastest in connections
 */
export function getEmergingHubs(
  stateDb: StateDb,
  daysBack: number = 30,
): EmergingHub[] {
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  // Get the latest hub_scores_top10 snapshot
  const latestRow = stateDb.db.prepare(
    `SELECT details FROM graph_snapshots
     WHERE metric = 'hub_scores_top10'
     ORDER BY timestamp DESC LIMIT 1`
  ).get() as { details: string | null } | undefined;

  // Get the earliest hub_scores_top10 snapshot after cutoff
  const previousRow = stateDb.db.prepare(
    `SELECT details FROM graph_snapshots
     WHERE metric = 'hub_scores_top10' AND timestamp >= ?
     ORDER BY timestamp ASC LIMIT 1`
  ).get(cutoff) as { details: string | null } | undefined;

  if (!latestRow?.details) return [];

  const currentHubs: Array<{ entity: string; degree: number }> = JSON.parse(latestRow.details);
  const previousHubs: Array<{ entity: string; degree: number }> = previousRow?.details
    ? JSON.parse(previousRow.details)
    : [];

  const previousMap = new Map<string, number>();
  for (const hub of previousHubs) {
    previousMap.set(hub.entity, hub.degree);
  }

  const emerging: EmergingHub[] = currentHubs.map(hub => {
    const prevDegree = previousMap.get(hub.entity) ?? 0;
    return {
      entity: hub.entity,
      current_degree: hub.degree,
      previous_degree: prevDegree,
      growth: hub.degree - prevDegree,
    };
  });

  // Sort by growth descending
  emerging.sort((a, b) => b.growth - a.growth);

  return emerging;
}

// =============================================================================
// SNAPSHOT COMPARISON (Phase 4.2)
// =============================================================================

export interface SnapshotDiff {
  metricChanges: Array<{
    metric: string;
    before: number;
    after: number;
    delta: number;
    deltaPercent: number;
  }>;
  hubScoreChanges: Array<{
    entity: string;
    before: number;
    after: number;
    delta: number;
  }>;
}

/**
 * Compare two graph snapshots by timestamp.
 * Returns metric-level and hub-level diffs.
 */
export function compareGraphSnapshots(
  stateDb: StateDb,
  timestampBefore: number,
  timestampAfter: number,
): SnapshotDiff {
  const SCALAR_METRICS = ['avg_degree', 'max_degree', 'cluster_count', 'largest_cluster_size'];

  // Get snapshot rows closest to each timestamp
  function getSnapshotAt(ts: number) {
    // Find the actual snapshot timestamp closest to (and <=) the requested timestamp
    const row = stateDb.db.prepare(
      `SELECT DISTINCT timestamp FROM graph_snapshots WHERE timestamp <= ? ORDER BY timestamp DESC LIMIT 1`
    ).get(ts) as { timestamp: number } | undefined;
    if (!row) return null;

    const rows = stateDb.db.prepare(
      `SELECT metric, value, details FROM graph_snapshots WHERE timestamp = ?`
    ).all(row.timestamp) as Array<{ metric: string; value: number; details: string | null }>;
    return rows;
  }

  const beforeRows = getSnapshotAt(timestampBefore) ?? [];
  const afterRows = getSnapshotAt(timestampAfter) ?? [];

  // Build maps
  const beforeMap = new Map<string, { value: number; details: string | null }>();
  const afterMap = new Map<string, { value: number; details: string | null }>();
  for (const r of beforeRows) beforeMap.set(r.metric, { value: r.value, details: r.details });
  for (const r of afterRows) afterMap.set(r.metric, { value: r.value, details: r.details });

  // Scalar metric changes
  const metricChanges = SCALAR_METRICS.map(metric => {
    const before = beforeMap.get(metric)?.value ?? 0;
    const after = afterMap.get(metric)?.value ?? 0;
    const delta = after - before;
    const deltaPercent = before !== 0
      ? Math.round((delta / before) * 10000) / 100
      : (delta !== 0 ? 100 : 0);
    return { metric, before, after, delta, deltaPercent };
  });

  // Hub score changes
  const beforeHubs: Array<{ entity: string; degree: number }> =
    beforeMap.get('hub_scores_top10')?.details
      ? JSON.parse(beforeMap.get('hub_scores_top10')!.details!)
      : [];
  const afterHubs: Array<{ entity: string; degree: number }> =
    afterMap.get('hub_scores_top10')?.details
      ? JSON.parse(afterMap.get('hub_scores_top10')!.details!)
      : [];

  const beforeHubMap = new Map<string, number>();
  for (const h of beforeHubs) beforeHubMap.set(h.entity, h.degree);

  const afterHubMap = new Map<string, number>();
  for (const h of afterHubs) afterHubMap.set(h.entity, h.degree);

  // Union of all entities in either snapshot
  const allHubEntities = new Set([...beforeHubMap.keys(), ...afterHubMap.keys()]);
  const hubScoreChanges: SnapshotDiff['hubScoreChanges'] = [];
  for (const entity of allHubEntities) {
    const before = beforeHubMap.get(entity) ?? 0;
    const after = afterHubMap.get(entity) ?? 0;
    if (before !== after) {
      hubScoreChanges.push({ entity, before, after, delta: after - before });
    }
  }
  hubScoreChanges.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return { metricChanges, hubScoreChanges };
}

// =============================================================================
// MAINTENANCE
// =============================================================================

/**
 * Purge graph snapshots older than retention period
 */
export function purgeOldSnapshots(stateDb: StateDb, retentionDays: number = 90): number {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result = stateDb.db.prepare(
    'DELETE FROM graph_snapshots WHERE timestamp < ?'
  ).run(cutoff);
  return result.changes;
}
