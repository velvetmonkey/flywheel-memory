/**
 * Tool Invocation Tracking
 *
 * Records and queries tool usage events.
 * Stored in StateDb tool_invocations table (schema v7, query_context added v36).
 */

import type { StateDb } from '@velvetmonkey/vault-core';

// =============================================================================
// TYPES
// =============================================================================

export interface ToolInvocation {
  id: number;
  timestamp: number;
  tool_name: string;
  session_id: string | null;
  note_paths: string[] | null;
  duration_ms: number | null;
  success: boolean;
  response_tokens: number | null;
  baseline_tokens: number | null;
  query_context: string | null;
}

export interface ToolUsageSummary {
  tool_name: string;
  invocation_count: number;
  avg_duration_ms: number;
  success_rate: number;
  last_used: number;
}

export interface NoteAccessEntry {
  path: string;
  access_count: number;
  last_accessed: number;
  tools_used: string[];
}

export interface SessionSummary {
  session_id: string;
  started_at: number;
  last_activity: number;
  tool_count: number;
  unique_tools: string[];
  notes_accessed: string[];
}

// =============================================================================
// RECORD
// =============================================================================

/**
 * Record a tool invocation to StateDb.
 * Returns the inserted row ID so callers can reference it (e.g. for feedback).
 */
export function recordToolInvocation(
  stateDb: StateDb,
  event: {
    tool_name: string;
    session_id?: string;
    note_paths?: string[];
    duration_ms?: number;
    success?: boolean;
    response_tokens?: number;
    baseline_tokens?: number;
    query_context?: string;
  }
): number {
  const result = stateDb.db.prepare(
    `INSERT INTO tool_invocations (timestamp, tool_name, session_id, note_paths, duration_ms, success, response_tokens, baseline_tokens, query_context)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    Date.now(),
    event.tool_name,
    event.session_id ?? null,
    event.note_paths ? JSON.stringify(event.note_paths) : null,
    event.duration_ms ?? null,
    event.success !== false ? 1 : 0,
    event.response_tokens ?? null,
    event.baseline_tokens ?? null,
    event.query_context ?? null,
  );
  return Number(result.lastInsertRowid);
}

// =============================================================================
// QUERY
// =============================================================================

interface RawInvocationRow {
  id: number;
  timestamp: number;
  tool_name: string;
  session_id: string | null;
  note_paths: string | null;
  duration_ms: number | null;
  success: number;
  response_tokens: number | null;
  baseline_tokens: number | null;
  query_context: string | null;
}

function rowToInvocation(row: RawInvocationRow): ToolInvocation {
  return {
    id: row.id,
    timestamp: row.timestamp,
    tool_name: row.tool_name,
    session_id: row.session_id,
    note_paths: row.note_paths ? JSON.parse(row.note_paths) : null,
    duration_ms: row.duration_ms,
    success: row.success === 1,
    response_tokens: row.response_tokens,
    baseline_tokens: row.baseline_tokens,
    query_context: row.query_context,
  };
}

/**
 * Get tool usage summary: most-used tools with stats
 */
export function getToolUsageSummary(stateDb: StateDb, daysBack: number = 30): ToolUsageSummary[] {
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  const rows = stateDb.db.prepare(`
    SELECT
      tool_name,
      COUNT(*) as invocation_count,
      AVG(duration_ms) as avg_duration_ms,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as success_rate,
      MAX(timestamp) as last_used
    FROM tool_invocations
    WHERE timestamp >= ?
    GROUP BY tool_name
    ORDER BY invocation_count DESC
  `).all(cutoff) as Array<{
    tool_name: string;
    invocation_count: number;
    avg_duration_ms: number | null;
    success_rate: number;
    last_used: number;
  }>;

  return rows.map(r => ({
    tool_name: r.tool_name,
    invocation_count: r.invocation_count,
    avg_duration_ms: Math.round(r.avg_duration_ms ?? 0),
    success_rate: Math.round(r.success_rate * 1000) / 1000,
    last_used: r.last_used,
  }));
}

/**
 * Get notes ranked by how often they're accessed
 */
export function getNoteAccessFrequency(stateDb: StateDb, daysBack: number = 30): NoteAccessEntry[] {
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  const rows = stateDb.db.prepare(`
    SELECT note_paths, tool_name, timestamp
    FROM tool_invocations
    WHERE timestamp >= ? AND note_paths IS NOT NULL
    ORDER BY timestamp DESC
  `).all(cutoff) as Array<{
    note_paths: string;
    tool_name: string;
    timestamp: number;
  }>;

  // Aggregate by note path
  const noteMap = new Map<string, {
    access_count: number;
    last_accessed: number;
    tools: Set<string>;
  }>();

  for (const row of rows) {
    let paths: string[];
    try {
      paths = JSON.parse(row.note_paths);
    } catch {
      continue;
    }

    for (const p of paths) {
      const existing = noteMap.get(p);
      if (existing) {
        existing.access_count++;
        existing.last_accessed = Math.max(existing.last_accessed, row.timestamp);
        existing.tools.add(row.tool_name);
      } else {
        noteMap.set(p, {
          access_count: 1,
          last_accessed: row.timestamp,
          tools: new Set([row.tool_name]),
        });
      }
    }
  }

  return Array.from(noteMap.entries())
    .map(([path, stats]) => ({
      path,
      access_count: stats.access_count,
      last_accessed: stats.last_accessed,
      tools_used: Array.from(stats.tools),
    }))
    .sort((a, b) => b.access_count - a.access_count);
}

/**
 * Get session history (what happened in a session)
 */
export function getSessionHistory(stateDb: StateDb, sessionId?: string): SessionSummary[] {
  if (sessionId) {
    // Single session detail
    const rows = stateDb.db.prepare(`
      SELECT * FROM tool_invocations
      WHERE session_id = ?
      ORDER BY timestamp
    `).all(sessionId) as RawInvocationRow[];

    if (rows.length === 0) return [];

    const tools = new Set<string>();
    const notes = new Set<string>();

    for (const row of rows) {
      tools.add(row.tool_name);
      if (row.note_paths) {
        try {
          for (const p of JSON.parse(row.note_paths)) {
            notes.add(p);
          }
        } catch { /* ignore */ }
      }
    }

    return [{
      session_id: sessionId,
      started_at: rows[0].timestamp,
      last_activity: rows[rows.length - 1].timestamp,
      tool_count: rows.length,
      unique_tools: Array.from(tools),
      notes_accessed: Array.from(notes),
    }];
  }

  // List recent sessions
  const rows = stateDb.db.prepare(`
    SELECT
      session_id,
      MIN(timestamp) as started_at,
      MAX(timestamp) as last_activity,
      COUNT(*) as tool_count
    FROM tool_invocations
    WHERE session_id IS NOT NULL
    GROUP BY session_id
    ORDER BY last_activity DESC
    LIMIT 20
  `).all() as Array<{
    session_id: string;
    started_at: number;
    last_activity: number;
    tool_count: number;
  }>;

  return rows.map(r => ({
    session_id: r.session_id,
    started_at: r.started_at,
    last_activity: r.last_activity,
    tool_count: r.tool_count,
    unique_tools: [],
    notes_accessed: [],
  }));
}

/**
 * Get full session detail: summary + chronological invocations.
 * Supports hierarchical sessions: passing a parent ID includes child sessions.
 */
export function getSessionDetail(
  stateDb: StateDb,
  sessionId: string,
  options: { include_children?: boolean; limit?: number } = {},
): { summary: SessionSummary; invocations: ToolInvocation[] } | null {
  const { include_children = true, limit = 200 } = options;

  const rows = include_children
    ? stateDb.db.prepare(`
        SELECT * FROM tool_invocations
        WHERE session_id = ? OR session_id LIKE ?
        ORDER BY timestamp
        LIMIT ?
      `).all(sessionId, `${sessionId}.%`, limit) as RawInvocationRow[]
    : stateDb.db.prepare(`
        SELECT * FROM tool_invocations
        WHERE session_id = ?
        ORDER BY timestamp
        LIMIT ?
      `).all(sessionId, limit) as RawInvocationRow[];

  if (rows.length === 0) return null;

  const tools = new Set<string>();
  const notes = new Set<string>();
  for (const row of rows) {
    tools.add(row.tool_name);
    if (row.note_paths) {
      try {
        for (const p of JSON.parse(row.note_paths)) notes.add(p);
      } catch { /* ignore */ }
    }
  }

  return {
    summary: {
      session_id: sessionId,
      started_at: rows[0].timestamp,
      last_activity: rows[rows.length - 1].timestamp,
      tool_count: rows.length,
      unique_tools: Array.from(tools),
      notes_accessed: Array.from(notes),
    },
    invocations: rows.map(rowToInvocation),
  };
}

/**
 * Get recent invocations for a session
 */
export function getRecentInvocations(stateDb: StateDb, limit: number = 20): ToolInvocation[] {
  const rows = stateDb.db.prepare(
    'SELECT * FROM tool_invocations ORDER BY timestamp DESC LIMIT ?'
  ).all(limit) as RawInvocationRow[];

  return rows.map(rowToInvocation);
}

// =============================================================================
// TOKEN ECONOMICS
// =============================================================================

export interface TokenEconomics {
  period_days: number;
  total_invocations: number;
  total_response_tokens: number;
  total_baseline_tokens: number;
  total_tokens_saved: number;
  overall_savings_ratio: number;
  per_tool: Array<{
    tool_name: string;
    invocations: number;
    response_tokens: number;
    baseline_tokens: number;
    tokens_saved: number;
    savings_ratio: number;
  }>;
}

/**
 * Get token economics summary: how many tokens Flywheel saved vs raw file reads.
 */
export function getTokenEconomics(stateDb: StateDb, daysBack: number = 30): TokenEconomics {
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  const rows = stateDb.db.prepare(`
    SELECT
      tool_name,
      COUNT(*) as invocations,
      COALESCE(SUM(response_tokens), 0) as response_tokens,
      COALESCE(SUM(baseline_tokens), 0) as baseline_tokens
    FROM tool_invocations
    WHERE timestamp >= ? AND response_tokens IS NOT NULL
    GROUP BY tool_name
    ORDER BY (COALESCE(SUM(baseline_tokens), 0) - COALESCE(SUM(response_tokens), 0)) DESC
  `).all(cutoff) as Array<{
    tool_name: string;
    invocations: number;
    response_tokens: number;
    baseline_tokens: number;
  }>;

  let totalResponse = 0;
  let totalBaseline = 0;
  let totalInvocations = 0;

  const perTool = rows.map(r => {
    totalResponse += r.response_tokens;
    totalBaseline += r.baseline_tokens;
    totalInvocations += r.invocations;
    return {
      tool_name: r.tool_name,
      invocations: r.invocations,
      response_tokens: r.response_tokens,
      baseline_tokens: r.baseline_tokens,
      tokens_saved: r.baseline_tokens - r.response_tokens,
      savings_ratio: r.response_tokens > 0
        ? Math.round((r.baseline_tokens / r.response_tokens) * 10) / 10
        : 0,
    };
  });

  return {
    period_days: daysBack,
    total_invocations: totalInvocations,
    total_response_tokens: totalResponse,
    total_baseline_tokens: totalBaseline,
    total_tokens_saved: totalBaseline - totalResponse,
    overall_savings_ratio: totalResponse > 0
      ? Math.round((totalBaseline / totalResponse) * 10) / 10
      : 0,
    per_tool: perTool,
  };
}

// =============================================================================
// MAINTENANCE
// =============================================================================

/**
 * Purge invocations older than retention period
 */
export function purgeOldInvocations(stateDb: StateDb, retentionDays: number = 90): number {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result = stateDb.db.prepare(
    'DELETE FROM tool_invocations WHERE timestamp < ?'
  ).run(cutoff);
  return result.changes;
}
