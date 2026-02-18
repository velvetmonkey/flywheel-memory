/**
 * Index Activity History
 *
 * Records and queries index rebuild events.
 * Stored in StateDb index_events table (schema v6).
 */

import type { StateDb } from '@velvetmonkey/vault-core';

// =============================================================================
// TYPES
// =============================================================================

export type IndexEventTrigger = 'startup_cache' | 'startup_build' | 'watcher' | 'manual_refresh';

export interface PipelineStep {
  name: string;
  duration_ms: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  skipped?: boolean;
  skip_reason?: string;
}

export function createStepTracker() {
  const steps: PipelineStep[] = [];
  let current: { name: string; input: Record<string, unknown>; startTime: number } | null = null;
  return {
    steps,
    start(name: string, input: Record<string, unknown>) {
      current = { name, input, startTime: Date.now() };
    },
    end(output: Record<string, unknown>) {
      if (!current) return;
      steps.push({ name: current.name, duration_ms: Date.now() - current.startTime, input: current.input, output });
      current = null;
    },
    skip(name: string, reason: string) {
      steps.push({ name, duration_ms: 0, input: {}, output: {}, skipped: true, skip_reason: reason });
    },
  };
}

export interface IndexEvent {
  id: number;
  timestamp: number;
  trigger: IndexEventTrigger;
  duration_ms: number;
  success: boolean;
  note_count: number | null;
  files_changed: number | null;
  changed_paths: string[] | null;
  error: string | null;
  steps: PipelineStep[] | null;
}

export interface IndexActivitySummary {
  total_rebuilds: number;
  last_rebuild: IndexEvent | null;
  rebuilds_today: number;
  rebuilds_last_24h: number;
  avg_duration_ms: number;
  failure_count: number;
}

// =============================================================================
// RECORD
// =============================================================================

/**
 * Record an index event to StateDb
 */
export function recordIndexEvent(
  stateDb: StateDb,
  event: {
    trigger: IndexEventTrigger;
    duration_ms: number;
    success?: boolean;
    note_count?: number;
    files_changed?: number;
    changed_paths?: string[];
    error?: string;
    steps?: PipelineStep[];
  }
): void {
  stateDb.db.prepare(
    `INSERT INTO index_events (timestamp, trigger, duration_ms, success, note_count, files_changed, changed_paths, error, steps)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    Date.now(),
    event.trigger,
    event.duration_ms,
    event.success !== false ? 1 : 0,
    event.note_count ?? null,
    event.files_changed ?? null,
    event.changed_paths ? JSON.stringify(event.changed_paths) : null,
    event.error ?? null,
    event.steps ? JSON.stringify(event.steps) : null,
  );
}

// =============================================================================
// QUERY
// =============================================================================

interface RawEventRow {
  id: number;
  timestamp: number;
  trigger: string;
  duration_ms: number;
  success: number;
  note_count: number | null;
  files_changed: number | null;
  changed_paths: string | null;
  error: string | null;
  steps: string | null;
}

function rowToEvent(row: RawEventRow): IndexEvent {
  return {
    id: row.id,
    timestamp: row.timestamp,
    trigger: row.trigger as IndexEventTrigger,
    duration_ms: row.duration_ms,
    success: row.success === 1,
    note_count: row.note_count,
    files_changed: row.files_changed,
    changed_paths: row.changed_paths ? JSON.parse(row.changed_paths) : null,
    error: row.error,
    steps: row.steps ? JSON.parse(row.steps) : null,
  };
}

/**
 * Get recent index events
 */
export function getRecentIndexEvents(stateDb: StateDb, limit: number = 20): IndexEvent[] {
  const rows = stateDb.db.prepare(
    'SELECT * FROM index_events ORDER BY timestamp DESC LIMIT ?'
  ).all(limit) as RawEventRow[];

  return rows.map(rowToEvent);
}

/**
 * Get index activity summary
 */
export function getIndexActivitySummary(stateDb: StateDb): IndexActivitySummary {
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const last24h = now - 24 * 60 * 60 * 1000;

  const totalRow = stateDb.db.prepare(
    'SELECT COUNT(*) as count FROM index_events'
  ).get() as { count: number };

  const todayRow = stateDb.db.prepare(
    'SELECT COUNT(*) as count FROM index_events WHERE timestamp >= ?'
  ).get(todayStart.getTime()) as { count: number };

  const last24hRow = stateDb.db.prepare(
    'SELECT COUNT(*) as count FROM index_events WHERE timestamp >= ?'
  ).get(last24h) as { count: number };

  const avgRow = stateDb.db.prepare(
    'SELECT AVG(duration_ms) as avg_ms FROM index_events WHERE success = 1'
  ).get() as { avg_ms: number | null };

  const failureRow = stateDb.db.prepare(
    'SELECT COUNT(*) as count FROM index_events WHERE success = 0'
  ).get() as { count: number };

  const lastRow = stateDb.db.prepare(
    'SELECT * FROM index_events ORDER BY timestamp DESC LIMIT 1'
  ).get() as RawEventRow | undefined;

  return {
    total_rebuilds: totalRow.count,
    last_rebuild: lastRow ? rowToEvent(lastRow) : null,
    rebuilds_today: todayRow.count,
    rebuilds_last_24h: last24hRow.count,
    avg_duration_ms: Math.round(avgRow.avg_ms ?? 0),
    failure_count: failureRow.count,
  };
}

// =============================================================================
// MAINTENANCE
// =============================================================================

/**
 * Purge index events older than retention period
 */
export function purgeOldIndexEvents(stateDb: StateDb, retentionDays: number = 90): number {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result = stateDb.db.prepare(
    'DELETE FROM index_events WHERE timestamp < ?'
  ).run(cutoff);
  return result.changes;
}
