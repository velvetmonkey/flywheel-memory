/**
 * Entity History — Unified timeline across all entity-related tables.
 *
 * Queries 8 tables, normalizes timestamps, and returns a sorted timeline.
 */

import type { StateDb } from '@velvetmonkey/vault-core';

// =============================================================================
// Types
// =============================================================================

export interface TimelineEvent {
  timestamp: number;  // Unix ms (normalized)
  type: 'application' | 'feedback' | 'suggestion' | 'edge_update' | 'metadata_change' | 'memory' | 'correction';
  summary: string;
  details: Record<string, unknown>;
}

export interface EntityHistoryResult {
  entity: {
    name: string;
    category: string | null;
    description: string | null;
    hub_score: number | null;
    aliases: string[];
  } | null;
  timeline: TimelineEvent[];
  total_events: number;
}

export interface EntityHistoryOptions {
  event_types?: string[];
  start_date?: string;  // ISO YYYY-MM-DD
  end_date?: string;    // ISO YYYY-MM-DD
  limit?: number;
  offset?: number;
}

// =============================================================================
// Timestamp normalization
// =============================================================================

/** Convert TEXT ISO datetime or INTEGER ms to Unix ms */
function normalizeTimestamp(ts: string | number | null): number {
  if (ts === null || ts === undefined) return 0;
  if (typeof ts === 'number') return ts;
  const normalized = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
  const ms = new Date(normalized).getTime();
  return isNaN(ms) ? 0 : ms;
}

// =============================================================================
// Core function
// =============================================================================

export function getEntityTimeline(
  stateDb: StateDb,
  entityName: string,
  options: EntityHistoryOptions = {},
): EntityHistoryResult {
  const {
    event_types,
    start_date,
    end_date,
    limit = 50,
    offset = 0,
  } = options;

  const startMs = start_date ? new Date(start_date + 'T00:00:00Z').getTime() : 0;
  const endMs = end_date ? new Date(end_date + 'T23:59:59.999Z').getTime() : Infinity;

  const wantType = (type: string) => !event_types || event_types.includes(type);

  // ─── Entity metadata ───
  const entityRow = stateDb.db.prepare(
    'SELECT name, category, description, hub_score, aliases_json FROM entities WHERE name = ? COLLATE NOCASE'
  ).get(entityName) as { name: string; category: string | null; description: string | null; hub_score: number | null; aliases_json: string | null } | undefined;

  const entity = entityRow ? {
    name: entityRow.name,
    category: entityRow.category,
    description: entityRow.description,
    hub_score: entityRow.hub_score,
    aliases: entityRow.aliases_json ? JSON.parse(entityRow.aliases_json) : [],
  } : null;

  const events: TimelineEvent[] = [];

  // ─── Wikilink applications ───
  if (wantType('application')) {
    const rows = stateDb.db.prepare(
      'SELECT note_path, applied_at, status FROM wikilink_applications WHERE entity = ? COLLATE NOCASE'
    ).all(entityName) as Array<{ note_path: string; applied_at: string | null; status: string | null }>;

    for (const r of rows) {
      const ts = normalizeTimestamp(r.applied_at);
      if (ts >= startMs && ts <= endMs) {
        events.push({
          timestamp: ts,
          type: 'application',
          summary: `Linked in ${r.note_path}${r.status && r.status !== 'applied' ? ` (${r.status})` : ''}`,
          details: { note_path: r.note_path, status: r.status },
        });
      }
    }
  }

  // ─── Wikilink feedback ───
  if (wantType('feedback')) {
    const rows = stateDb.db.prepare(
      'SELECT context, note_path, correct, confidence, created_at FROM wikilink_feedback WHERE entity = ? COLLATE NOCASE'
    ).all(entityName) as Array<{ context: string | null; note_path: string | null; correct: number; confidence: number | null; created_at: string | null }>;

    for (const r of rows) {
      const ts = normalizeTimestamp(r.created_at);
      if (ts >= startMs && ts <= endMs) {
        events.push({
          timestamp: ts,
          type: 'feedback',
          summary: `${r.correct ? 'Correct' : 'Incorrect'} in ${r.note_path || 'unknown'}${r.confidence != null ? ` (confidence ${r.confidence.toFixed(2)})` : ''}`,
          details: { note_path: r.note_path, correct: !!r.correct, confidence: r.confidence, context: r.context },
        });
      }
    }
  }

  // ─── Suggestion events ───
  if (wantType('suggestion')) {
    const rows = stateDb.db.prepare(
      'SELECT timestamp, note_path, total_score, threshold, passed, applied, strictness FROM suggestion_events WHERE entity = ? COLLATE NOCASE'
    ).all(entityName) as Array<{ timestamp: number; note_path: string | null; total_score: number | null; threshold: number | null; passed: number; applied: number | null; strictness: string | null }>;

    for (const r of rows) {
      const ts = r.timestamp;
      if (ts >= startMs && ts <= endMs) {
        const scoreStr = r.total_score != null ? ` score=${r.total_score.toFixed(1)}` : '';
        const threshStr = r.threshold != null ? `/${r.threshold.toFixed(1)}` : '';
        events.push({
          timestamp: ts,
          type: 'suggestion',
          summary: `${r.passed ? 'Passed' : 'Failed'}${scoreStr}${threshStr}${r.applied ? ' (applied)' : ''} in ${r.note_path || 'unknown'}`,
          details: { note_path: r.note_path, total_score: r.total_score, threshold: r.threshold, passed: !!r.passed, applied: !!r.applied, strictness: r.strictness },
        });
      }
    }
  }

  // ─── Note links (edge weights) ───
  if (wantType('edge_update')) {
    const rows = stateDb.db.prepare(
      'SELECT note_path, weight, weight_updated_at FROM note_links WHERE target = ? COLLATE NOCASE AND weight_updated_at IS NOT NULL'
    ).all(entityName) as Array<{ note_path: string; weight: number | null; weight_updated_at: number | null }>;

    for (const r of rows) {
      const ts = r.weight_updated_at ?? 0;
      if (ts >= startMs && ts <= endMs) {
        events.push({
          timestamp: ts,
          type: 'edge_update',
          summary: `Edge weight ${r.weight?.toFixed(2) ?? '?'} from ${r.note_path}`,
          details: { note_path: r.note_path, weight: r.weight },
        });
      }
    }
  }

  // ─── Entity changes ───
  if (wantType('metadata_change')) {
    const rows = stateDb.db.prepare(
      'SELECT field, old_value, new_value, changed_at FROM entity_changes WHERE entity = ? COLLATE NOCASE'
    ).all(entityName) as Array<{ field: string; old_value: string | null; new_value: string | null; changed_at: string | null }>;

    for (const r of rows) {
      const ts = normalizeTimestamp(r.changed_at);
      if (ts >= startMs && ts <= endMs) {
        events.push({
          timestamp: ts,
          type: 'metadata_change',
          summary: `${r.field}: "${r.old_value ?? ''}" → "${r.new_value ?? ''}"`,
          details: { field: r.field, old_value: r.old_value, new_value: r.new_value },
        });
      }
    }
  }

  // ─── Memories ───
  if (wantType('memory')) {
    const rows = stateDb.db.prepare(
      'SELECT key, value, memory_type, confidence, created_at FROM memories WHERE (entity = ? COLLATE NOCASE OR entities_json LIKE ?) AND superseded_by IS NULL'
    ).all(entityName, `%"${entityName}"%`) as Array<{ key: string; value: string; memory_type: string; confidence: number; created_at: number }>;

    for (const r of rows) {
      const ts = r.created_at;
      if (ts >= startMs && ts <= endMs) {
        events.push({
          timestamp: ts,
          type: 'memory',
          summary: `[${r.memory_type}] ${r.value.length > 80 ? r.value.slice(0, 80) + '...' : r.value}`,
          details: { key: r.key, memory_type: r.memory_type, confidence: r.confidence },
        });
      }
    }
  }

  // ─── Corrections ───
  if (wantType('correction')) {
    const rows = stateDb.db.prepare(
      'SELECT id, correction_type, description, note_path, source, status, created_at, resolved_at FROM corrections WHERE entity = ? COLLATE NOCASE'
    ).all(entityName) as Array<{ id: number; correction_type: string; description: string; note_path: string | null; source: string; status: string; created_at: string | null; resolved_at: string | null }>;

    for (const r of rows) {
      const ts = normalizeTimestamp(r.created_at);
      if (ts >= startMs && ts <= endMs) {
        events.push({
          timestamp: ts,
          type: 'correction',
          summary: `${r.correction_type}: ${r.description.length > 60 ? r.description.slice(0, 60) + '...' : r.description} (${r.status})`,
          details: { id: r.id, correction_type: r.correction_type, description: r.description, note_path: r.note_path, source: r.source, status: r.status, resolved_at: r.resolved_at },
        });
      }
    }
  }

  // Sort chronologically, paginate
  events.sort((a, b) => a.timestamp - b.timestamp);
  const total = events.length;
  const paginated = events.slice(offset, offset + limit);

  return { entity, timeline: paginated, total_events: total };
}
