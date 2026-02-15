/**
 * Vault Growth Metrics
 *
 * Computes, records, and queries vault health metrics over time.
 * Stored in StateDb vault_metrics table.
 */

import type { StateDb } from '@velvetmonkey/vault-core';
import type { VaultIndex } from '../read/types.js';
import {
  getEntityStats,
  getSuppressedCount,
} from '../write/wikilinkFeedback.js';

// =============================================================================
// TYPES
// =============================================================================

export type MetricName =
  | 'note_count'
  | 'link_count'
  | 'orphan_count'
  | 'tag_count'
  | 'entity_count'
  | 'avg_links_per_note'
  | 'link_density'
  | 'connected_ratio'
  | 'wikilink_accuracy'
  | 'wikilink_feedback_volume'
  | 'wikilink_suppressed_count';

export const ALL_METRICS: MetricName[] = [
  'note_count',
  'link_count',
  'orphan_count',
  'tag_count',
  'entity_count',
  'avg_links_per_note',
  'link_density',
  'connected_ratio',
  'wikilink_accuracy',
  'wikilink_feedback_volume',
  'wikilink_suppressed_count',
];

export interface MetricSnapshot {
  metric: MetricName;
  value: number;
  timestamp: number;
}

export interface MetricTrend {
  metric: MetricName;
  current: number;
  previous: number;
  delta: number;
  delta_percent: number;
  direction: 'up' | 'down' | 'stable';
}

export interface GrowthResult {
  mode: 'current' | 'history' | 'trends';
  metrics?: Record<string, number>;
  history?: MetricSnapshot[];
  trends?: MetricTrend[];
  recorded_at?: number;
}

// =============================================================================
// COMPUTE METRICS
// =============================================================================

/**
 * Compute current metrics from VaultIndex
 * @param index - VaultIndex for graph metrics
 * @param stateDb - Optional StateDb for wikilink quality metrics
 */
export function computeMetrics(index: VaultIndex, stateDb?: StateDb): Record<MetricName, number> {
  const noteCount = index.notes.size;

  // Count total outlinks
  let linkCount = 0;
  for (const note of index.notes.values()) {
    linkCount += note.outlinks.length;
  }

  // Count notes with at least one outlink or backlink
  const connectedNotes = new Set<string>();
  for (const [notePath, note] of index.notes) {
    if (note.outlinks.length > 0) {
      connectedNotes.add(notePath);
    }
  }
  for (const [target, backlinks] of index.backlinks) {
    for (const bl of backlinks) {
      connectedNotes.add(bl.source);
    }
    // Also mark the target as connected if it exists
    // Find the note path from the normalized target
    for (const note of index.notes.values()) {
      const normalizedTitle = note.title.toLowerCase();
      if (normalizedTitle === target.toLowerCase() || note.path.toLowerCase() === target.toLowerCase()) {
        connectedNotes.add(note.path);
      }
    }
  }

  // Orphan count = notes with no outlinks AND no backlinks
  let orphanCount = 0;
  for (const [notePath, note] of index.notes) {
    if (!connectedNotes.has(notePath)) {
      orphanCount++;
    }
  }

  const tagCount = index.tags.size;
  const entityCount = index.entities.size;
  const avgLinksPerNote = noteCount > 0 ? linkCount / noteCount : 0;

  // Link density = actual links / possible links (n * (n-1))
  const possibleLinks = noteCount * (noteCount - 1);
  const linkDensity = possibleLinks > 0 ? linkCount / possibleLinks : 0;

  const connectedRatio = noteCount > 0 ? connectedNotes.size / noteCount : 0;

  // Wikilink quality metrics (require StateDb)
  let wikilinkAccuracy = 0;
  let wikilinkFeedbackVolume = 0;
  let wikilinkSuppressedCount = 0;

  if (stateDb) {
    const entityStatsList = getEntityStats(stateDb);
    wikilinkFeedbackVolume = entityStatsList.reduce((sum, s) => sum + s.total, 0);

    if (wikilinkFeedbackVolume > 0) {
      const totalCorrect = entityStatsList.reduce((sum, s) => sum + s.correct, 0);
      wikilinkAccuracy = Math.round((totalCorrect / wikilinkFeedbackVolume) * 1000) / 1000;
    }

    wikilinkSuppressedCount = getSuppressedCount(stateDb);
  }

  return {
    note_count: noteCount,
    link_count: linkCount,
    orphan_count: orphanCount,
    tag_count: tagCount,
    entity_count: entityCount,
    avg_links_per_note: Math.round(avgLinksPerNote * 100) / 100,
    link_density: Math.round(linkDensity * 10000) / 10000,
    connected_ratio: Math.round(connectedRatio * 1000) / 1000,
    wikilink_accuracy: wikilinkAccuracy,
    wikilink_feedback_volume: wikilinkFeedbackVolume,
    wikilink_suppressed_count: wikilinkSuppressedCount,
  };
}

// =============================================================================
// RECORD / QUERY
// =============================================================================

/**
 * Record a metric snapshot to StateDb
 */
export function recordMetrics(stateDb: StateDb, metrics: Record<string, number>): void {
  const timestamp = Date.now();
  const insert = stateDb.db.prepare(
    'INSERT INTO vault_metrics (timestamp, metric, value) VALUES (?, ?, ?)'
  );

  const transaction = stateDb.db.transaction(() => {
    for (const [metric, value] of Object.entries(metrics)) {
      insert.run(timestamp, metric, value);
    }
  });

  transaction();
}

/**
 * Get metric history from StateDb
 */
export function getMetricHistory(
  stateDb: StateDb,
  metric?: string,
  daysBack: number = 30,
): MetricSnapshot[] {
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  let rows: Array<{ timestamp: number; metric: string; value: number }>;

  if (metric) {
    rows = stateDb.db.prepare(
      'SELECT timestamp, metric, value FROM vault_metrics WHERE metric = ? AND timestamp >= ? ORDER BY timestamp'
    ).all(metric, cutoff) as typeof rows;
  } else {
    rows = stateDb.db.prepare(
      'SELECT timestamp, metric, value FROM vault_metrics WHERE timestamp >= ? ORDER BY timestamp'
    ).all(cutoff) as typeof rows;
  }

  return rows.map(r => ({
    metric: r.metric as MetricName,
    value: r.value,
    timestamp: r.timestamp,
  }));
}

/**
 * Compute trends by comparing current values vs N days ago
 */
export function computeTrends(
  stateDb: StateDb,
  currentMetrics: Record<string, number>,
  daysBack: number = 30,
): MetricTrend[] {
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  // Get the earliest snapshot after cutoff for each metric
  const rows = stateDb.db.prepare(`
    SELECT metric, value FROM vault_metrics
    WHERE timestamp >= ? AND timestamp <= ?
    GROUP BY metric
    HAVING timestamp = MIN(timestamp)
  `).all(cutoff, cutoff + 24 * 60 * 60 * 1000) as Array<{ metric: string; value: number }>;

  // If no rows found, try getting the most recent before cutoff
  const previousValues = new Map<string, number>();
  for (const row of rows) {
    previousValues.set(row.metric, row.value);
  }

  // Fallback: if no rows in the range, try getting the very first recorded value
  if (previousValues.size === 0) {
    const fallbackRows = stateDb.db.prepare(`
      SELECT metric, MIN(value) as value FROM vault_metrics
      WHERE timestamp >= ?
      GROUP BY metric
      HAVING timestamp = MIN(timestamp)
    `).all(cutoff) as Array<{ metric: string; value: number }>;

    for (const row of fallbackRows) {
      previousValues.set(row.metric, row.value);
    }
  }

  const trends: MetricTrend[] = [];

  for (const metricName of ALL_METRICS) {
    const current = currentMetrics[metricName] ?? 0;
    const previous = previousValues.get(metricName) ?? current;
    const delta = current - previous;
    const deltaPct = previous !== 0
      ? Math.round((delta / previous) * 10000) / 100
      : (delta !== 0 ? 100 : 0);

    let direction: 'up' | 'down' | 'stable' = 'stable';
    if (delta > 0) direction = 'up';
    if (delta < 0) direction = 'down';

    trends.push({
      metric: metricName,
      current,
      previous,
      delta,
      delta_percent: deltaPct,
      direction,
    });
  }

  return trends;
}

/**
 * Purge metrics older than retention period
 */
export function purgeOldMetrics(stateDb: StateDb, retentionDays: number = 90): number {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result = stateDb.db.prepare(
    'DELETE FROM vault_metrics WHERE timestamp < ?'
  ).run(cutoff);
  return result.changes;
}
