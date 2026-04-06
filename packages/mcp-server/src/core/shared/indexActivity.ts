/**
 * Index Activity History
 *
 * Records and queries index rebuild events.
 * Stored in StateDb index_events table (schema v6).
 */

import type { StateDb, EntitySearchResult } from '@velvetmonkey/vault-core';

// =============================================================================
// TYPES
// =============================================================================

export type IndexEventTrigger = 'startup_cache' | 'startup_build' | 'watcher' | 'manual_refresh' | 'maintenance' | 'deferred';

export interface PipelineStep {
  name: string;
  duration_ms: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  skipped?: boolean;
  skip_reason?: string;
}

/** Tagged result from a step function used by runStep(). */
export type StepRunResult =
  | { kind: 'done'; output: Record<string, unknown> }
  | { kind: 'skipped'; reason: string; output?: Record<string, unknown> };

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
    /** Close an already-started step as skipped without leaving current dangling. */
    skipCurrent(reason: string, output?: Record<string, unknown>) {
      if (!current) return;
      steps.push({
        name: current.name,
        duration_ms: Date.now() - current.startTime,
        input: current.input,
        output: output ?? {},
        skipped: true,
        skip_reason: reason,
      });
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

// =============================================================================
// COMPACT STEP / PIPELINE SHAPES (for MCP response-size hardening)
// =============================================================================

/**
 * Compact step shape for MCP responses.
 * Contains only step name, timing, and a step-specific summary with scalar fields.
 * No raw input/output objects, no per-file arrays, no entity-name lists.
 */
export interface CompactStep {
  name: string;
  duration_ms: number;
  skipped?: boolean;
  skip_reason?: string;
  summary: Record<string, number | boolean | string>;
}

/**
 * Compact pipeline run shape for MCP responses.
 * Replaces raw IndexEvent with bounded metadata + compact steps.
 */
export interface CompactPipelineRun {
  timestamp: number;
  trigger: string;
  duration_ms: number;
  files_changed: number | null;
  changed_paths_total: number;
  changed_paths_sample: string[];
  step_count: number;
  steps: CompactStep[];
}

/**
 * Extract step-specific summary from a PipelineStep.
 * Each step gets only its canonical scalar fields — no arrays, no nested objects.
 */
export function compactStep(step: PipelineStep): CompactStep {
  const out = step.output ?? {};
  let summary: Record<string, number | boolean | string>;

  switch (step.name) {
    case 'entity_scan':
      summary = {
        entity_count: asNum(out.entity_count),
        added_count: asArrayLen(out.added),
        removed_count: asArrayLen(out.removed),
        alias_change_count: asArrayLen(out.alias_changes),
        category_change_count: asArrayLen(out.category_changes),
      };
      break;
    case 'hub_scores':
      summary = {
        updated: asNum(out.updated),
        diff_count: asArrayLen(out.diffs),
      };
      break;
    case 'forward_links':
      summary = {
        total_resolved: asNum(out.total_resolved),
        total_dead: asNum(out.total_dead),
        new_dead_count: asArrayLen(out.new_dead_links),
        diff_count: asArrayLen(out.link_diffs),
      };
      break;
    case 'wikilink_check':
      summary = {
        tracked_count: asArrayLen(out.tracked),
        mention_count: asArrayLen(out.mentions),
      };
      break;
    case 'prospect_scan': {
      const prospects = Array.isArray(out.prospects) ? out.prospects : [];
      summary = {
        implicit_count: prospects.reduce((s: number, p: any) => s + (Array.isArray(p.implicit) ? p.implicit.length : 0), 0),
        dead_match_count: prospects.reduce((s: number, p: any) => s + (Array.isArray(p.deadLinkMatches) ? p.deadLinkMatches.length : 0), 0),
      };
      break;
    }
    case 'suggestion_scoring':
      summary = { scored_files: asNum(out.scored_files) };
      break;
    case 'implicit_feedback':
      summary = {
        removal_count: asArrayLen(out.removals),
        addition_count: asArrayLen(out.additions),
        suppressed_count: asArrayLen(out.newly_suppressed),
      };
      break;
    case 'note_embeddings':
      summary = { updated: asNum(out.updated), removed: asNum(out.removed) };
      break;
    case 'entity_embeddings':
      summary = { updated: asNum(out.updated) };
      break;
    case 'fts5_incremental':
      summary = { updated: asNum(out.updated), removed: asNum(out.removed) };
      break;
    case 'index_rebuild':
      summary = {
        note_count: asNum(out.note_count),
        entity_count: asNum(out.entity_count),
        tag_count: asNum(out.tag_count),
      };
      break;
    case 'index_cache':
      summary = { saved: asBool(out.saved) };
      break;
    case 'task_cache':
      summary = { updated: asNum(out.updated), removed: asNum(out.removed) };
      break;
    case 'tag_scan':
      summary = { added_count: asNum(out.total_added), removed_count: asNum(out.total_removed) };
      break;
    case 'drain_proactive_queue':
      summary = {
        total_applied: asNum(out.total_applied),
        expired: asNum(out.expired),
        skipped_mtime: asNum(out.skipped_mtime),
        skipped_daily_cap: asNum(out.skipped_daily_cap),
      };
      break;
    case 'proactive_enqueue':
      summary = { enqueued: asNum(out.enqueued), total_candidates: asNum(out.total_candidates) };
      break;
    case 'recency':
    case 'cooccurrence':
    case 'edge_weights':
      summary = { rebuilt: asBool(out.rebuilt) };
      break;
    case 'incremental_recency':
      summary = { entities_updated: asNum(out.entities_updated) };
      break;
    case 'corrections':
      summary = { processed: asNum(out.processed) };
      break;
    case 'retrieval_cooccurrence':
      summary = { pairs_inserted: asNum(out.pairs_inserted) };
      break;
    case 'integrity_check':
    case 'maintenance':
      summary = {
        ...(out.skipped != null ? { skipped: asBool(out.skipped) } : {}),
        ...(typeof out.reason === 'string' ? { reason: out.reason } : {}),
      };
      break;
    case 'note_moves':
      summary = { count: asNum(out.count ?? (Array.isArray(out.renames) ? out.renames.length : 0)) };
      break;
    default:
      // Fallback: extract only scalar values
      summary = {};
      for (const [k, v] of Object.entries(out)) {
        if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
          summary[k] = v;
        }
      }
      break;
  }

  return {
    name: step.name,
    duration_ms: step.duration_ms,
    ...(step.skipped ? { skipped: true, skip_reason: step.skip_reason } : {}),
    summary,
  };
}

/**
 * Compact a full IndexEvent into a bounded pipeline run for MCP responses.
 */
export function compactPipelineRun(event: IndexEvent): CompactPipelineRun {
  const paths = event.changed_paths ?? [];
  return {
    timestamp: event.timestamp,
    trigger: event.trigger,
    duration_ms: event.duration_ms,
    files_changed: event.files_changed,
    changed_paths_total: event.files_changed ?? paths.length,
    changed_paths_sample: paths.slice(0, 3),
    step_count: event.steps?.length ?? 0,
    steps: (event.steps ?? []).map(compactStep),
  };
}

// Helpers for safe field extraction
function asNum(v: unknown): number { return typeof v === 'number' ? v : 0; }
function asBool(v: unknown): boolean { return typeof v === 'boolean' ? v : false; }
function asArrayLen(v: unknown): number { return Array.isArray(v) ? v.length : 0; }

// =============================================================================

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
 * Get most recent pipeline event (one with steps data).
 * Used by health check to survive restarts where startup events lack steps.
 */
export function getRecentPipelineEvent(stateDb: StateDb): IndexEvent | null {
  const row = stateDb.db.prepare(
    'SELECT * FROM index_events WHERE steps IS NOT NULL ORDER BY timestamp DESC LIMIT 1'
  ).get() as RawEventRow | undefined;
  return row ? rowToEvent(row) : null;
}

/**
 * Compute diff between two entity snapshots (before/after a scan).
 */
export function computeEntityDiff(
  before: EntitySearchResult[],
  after: EntitySearchResult[],
): {
  added: Array<{ name: string; category: string; path: string }>;
  removed: Array<{ name: string; category: string; path: string }>;
  alias_changes: Array<{ entity: string; before: string[]; after: string[] }>;
} {
  const beforeMap = new Map(before.map(e => [e.nameLower, e]));
  const afterMap = new Map(after.map(e => [e.nameLower, e]));

  const added: Array<{ name: string; category: string; path: string }> = [];
  const removed: Array<{ name: string; category: string; path: string }> = [];
  const alias_changes: Array<{ entity: string; before: string[]; after: string[] }> = [];

  for (const [key, entity] of afterMap) {
    if (!beforeMap.has(key)) {
      added.push({ name: entity.name, category: entity.category, path: entity.path });
    } else {
      const prev = beforeMap.get(key)!;
      const prevAliases = JSON.stringify(prev.aliases.sort());
      const currAliases = JSON.stringify(entity.aliases.sort());
      if (prevAliases !== currAliases) {
        alias_changes.push({ entity: entity.name, before: prev.aliases, after: entity.aliases });
      }
    }
  }

  for (const [key, entity] of beforeMap) {
    if (!afterMap.has(key)) {
      removed.push({ name: entity.name, category: entity.category, path: entity.path });
    }
  }

  return { added, removed, alias_changes };
}

/**
 * Get most recent successful index event of any trigger type
 */
export function getLastSuccessfulEvent(stateDb: StateDb): IndexEvent | null {
  const row = stateDb.db.prepare(
    'SELECT * FROM index_events WHERE success = 1 ORDER BY timestamp DESC LIMIT 1'
  ).get() as RawEventRow | undefined;
  return row ? rowToEvent(row) : null;
}

/**
 * Get most recent event of a specific trigger type
 */
export function getLastEventByTrigger(stateDb: StateDb, trigger: IndexEventTrigger): IndexEvent | null {
  const row = stateDb.db.prepare(
    'SELECT * FROM index_events WHERE trigger = ? AND success = 1 ORDER BY timestamp DESC LIMIT 1'
  ).get(trigger) as RawEventRow | undefined;
  return row ? rowToEvent(row) : null;
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

/**
 * Purge suggestion events older than retention period
 */
export function purgeOldSuggestionEvents(stateDb: StateDb, retentionDays: number = 30): number {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result = stateDb.db.prepare(
    'DELETE FROM suggestion_events WHERE timestamp < ?'
  ).run(cutoff);
  return result.changes;
}

/**
 * Purge note_link_history entries with no recent positive feedback
 */
export function purgeOldNoteLinkHistory(stateDb: StateDb, retentionDays: number = 90): number {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const result = stateDb.db.prepare(
    'DELETE FROM note_link_history WHERE last_positive_at < ?'
  ).run(cutoff);
  return result.changes;
}
