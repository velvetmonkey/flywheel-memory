/**
 * Tool Selection Feedback — Core Logic
 *
 * Records and queries tool selection quality feedback.
 * Follows the wikilink_feedback pattern: explicit user feedback drives
 * Beta-Binomial posterior accuracy scoring per tool.
 *
 * Heuristic advisory rows (T15b) use correct=NULL and source='heuristic'
 * and are excluded from accuracy scoring.
 */

import type { StateDb } from '@velvetmonkey/vault-core';

// =============================================================================
// TYPES
// =============================================================================

export interface ToolSelectionFeedbackEntry {
  id: number;
  timestamp: number;
  tool_invocation_id: number | null;
  tool_name: string;
  query_context: string | null;
  expected_tool: string | null;
  expected_category: string | null;
  correct: boolean | null;  // null = heuristic advisory (T15b)
  source: 'explicit' | 'heuristic';
  rule_id: string | null;
  rule_version: number | null;
  session_id: string | null;
}

export interface ToolSelectionStats {
  tool_name: string;
  total_feedback: number;
  correct_count: number;
  wrong_count: number;
  posterior_accuracy: number;
}

export interface ToolSelectionReport {
  total_feedback: number;
  confirmed_correct: number;
  confirmed_wrong: number;
  accuracy_rate: number | null;
  top_reported_wrong_tools: Array<{
    tool_name: string;
    wrong_count: number;
    total_feedback: number;
    wrong_rate: number;
  }>;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Beta prior for tool selection accuracy (matches wikilink feedback) */
const PRIOR_ALPHA = 4;
const PRIOR_BETA = 1;

// =============================================================================
// RECORD
// =============================================================================

interface RawInvocationRow {
  tool_name: string;
  query_context: string | null;
  session_id: string | null;
}

/**
 * Record tool selection feedback.
 * When tool_invocation_id is supplied, hydrates tool_name, query_context, and
 * session_id from the tool_invocations table instead of trusting caller values.
 */
export function recordToolSelectionFeedback(
  stateDb: StateDb,
  feedback: {
    tool_invocation_id?: number;
    tool_name?: string;
    expected_tool?: string;
    expected_category?: string;
    correct: boolean;
    source?: 'explicit' | 'heuristic';
    session_id?: string;
  },
): number {
  let toolName = feedback.tool_name ?? '';
  let queryContext: string | null = null;
  let sessionId: string | null = feedback.session_id ?? null;

  // Hydrate from invocation if ID supplied
  if (feedback.tool_invocation_id) {
    const row = stateDb.db.prepare(
      'SELECT tool_name, query_context, session_id FROM tool_invocations WHERE id = ?'
    ).get(feedback.tool_invocation_id) as RawInvocationRow | undefined;
    if (row) {
      toolName = row.tool_name;
      queryContext = row.query_context;
      sessionId = row.session_id ?? sessionId;
    }
  }

  if (!toolName) {
    throw new Error('tool_name is required when tool_invocation_id is not provided or not found');
  }

  const result = stateDb.db.prepare(
    `INSERT INTO tool_selection_feedback
     (timestamp, tool_invocation_id, tool_name, query_context, expected_tool, expected_category, correct, source, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    Date.now(),
    feedback.tool_invocation_id ?? null,
    toolName,
    queryContext,
    feedback.expected_tool ?? null,
    feedback.expected_category ?? null,
    feedback.correct ? 1 : 0,
    feedback.source ?? 'explicit',
    sessionId,
  );
  return Number(result.lastInsertRowid);
}

// =============================================================================
// QUERY
// =============================================================================

/**
 * Get recent feedback entries.
 */
export function getToolSelectionList(
  stateDb: StateDb,
  limit: number = 50,
): ToolSelectionFeedbackEntry[] {
  const rows = stateDb.db.prepare(
    `SELECT * FROM tool_selection_feedback ORDER BY timestamp DESC LIMIT ?`
  ).all(limit) as Array<{
    id: number;
    timestamp: number;
    tool_invocation_id: number | null;
    tool_name: string;
    query_context: string | null;
    expected_tool: string | null;
    expected_category: string | null;
    correct: number | null;
    source: string;
    rule_id: string | null;
    rule_version: number | null;
    session_id: string | null;
  }>;

  return rows.map(r => ({
    id: r.id,
    timestamp: r.timestamp,
    tool_invocation_id: r.tool_invocation_id,
    tool_name: r.tool_name,
    query_context: r.query_context,
    expected_tool: r.expected_tool,
    expected_category: r.expected_category,
    correct: r.correct === null ? null : r.correct === 1,
    source: r.source as 'explicit' | 'heuristic',
    rule_id: r.rule_id,
    rule_version: r.rule_version,
    session_id: r.session_id,
  }));
}

/**
 * Get per-tool selection accuracy using Beta-Binomial posterior.
 * Only explicit feedback with non-NULL correct values contributes.
 */
export function getToolSelectionStats(
  stateDb: StateDb,
  daysBack: number = 30,
): ToolSelectionStats[] {
  // Guard against table not existing (older databases before schema v36)
  const tableExists = stateDb.db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='tool_selection_feedback'"
  ).get();
  if (!tableExists) return [];

  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  const rows = stateDb.db.prepare(`
    SELECT
      tool_name,
      COUNT(*) as total_feedback,
      SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as correct_count,
      SUM(CASE WHEN correct = 0 THEN 1 ELSE 0 END) as wrong_count
    FROM tool_selection_feedback
    WHERE timestamp >= ?
      AND source = 'explicit'
      AND correct IS NOT NULL
    GROUP BY tool_name
    ORDER BY total_feedback DESC
  `).all(cutoff) as Array<{
    tool_name: string;
    total_feedback: number;
    correct_count: number;
    wrong_count: number;
  }>;

  return rows.map(r => {
    const alpha = PRIOR_ALPHA + r.correct_count;
    const beta = PRIOR_BETA + r.wrong_count;
    return {
      tool_name: r.tool_name,
      total_feedback: r.total_feedback,
      correct_count: r.correct_count,
      wrong_count: r.wrong_count,
      posterior_accuracy: Math.round((alpha / (alpha + beta)) * 1000) / 1000,
    };
  });
}

/**
 * Get tool effectiveness scores for T14 integration.
 * Returns a map of tool_name → posterior mean accuracy.
 * Only tools with sufficient explicit feedback are included.
 */
export function getToolEffectivenessScores(
  stateDb: StateDb,
  minObservations: number = 15,
): Map<string, number> {
  const stats = getToolSelectionStats(stateDb, 365);
  const scores = new Map<string, number>();
  for (const s of stats) {
    if (s.total_feedback >= minObservations) {
      scores.set(s.tool_name, s.posterior_accuracy);
    }
  }
  return scores;
}


/**
 * Get recent heuristic advisory misroute rows.
 * Only returns unresolved heuristic rows (correct IS NULL, source='heuristic').
 */
export function getHeuristicMisroutes(
  stateDb: StateDb,
  limit: number = 50,
): ToolSelectionFeedbackEntry[] {
  const rows = stateDb.db.prepare(
    `SELECT * FROM tool_selection_feedback
     WHERE source = 'heuristic' AND correct IS NULL
     ORDER BY timestamp DESC LIMIT ?`
  ).all(limit) as Array<{
    id: number;
    timestamp: number;
    tool_invocation_id: number | null;
    tool_name: string;
    query_context: string | null;
    expected_tool: string | null;
    expected_category: string | null;
    correct: number | null;
    source: string;
    rule_id: string | null;
    rule_version: number | null;
    session_id: string | null;
  }>;

  return rows.map(r => ({
    id: r.id,
    timestamp: r.timestamp,
    tool_invocation_id: r.tool_invocation_id,
    tool_name: r.tool_name,
    query_context: r.query_context,
    expected_tool: r.expected_tool,
    expected_category: r.expected_category,
    correct: null,
    source: 'heuristic' as const,
    rule_id: r.rule_id,
    rule_version: r.rule_version,
    session_id: r.session_id,
  }));
}

/**
 * Get summary report for learning report integration.
 * Returns null when no feedback data exists (keep report clean).
 */
export function getToolSelectionReport(
  stateDb: StateDb,
  daysBack: number = 7,
): ToolSelectionReport | null {
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  const totals = stateDb.db.prepare(`
    SELECT
      COUNT(*) as total_feedback,
      SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as confirmed_correct,
      SUM(CASE WHEN correct = 0 THEN 1 ELSE 0 END) as confirmed_wrong
    FROM tool_selection_feedback
    WHERE timestamp >= ?
      AND source = 'explicit'
      AND correct IS NOT NULL
  `).get(cutoff) as {
    total_feedback: number;
    confirmed_correct: number;
    confirmed_wrong: number;
  };

  if (totals.total_feedback === 0) return null;

  const wrongTools = stateDb.db.prepare(`
    SELECT
      tool_name,
      SUM(CASE WHEN correct = 0 THEN 1 ELSE 0 END) as wrong_count,
      COUNT(*) as total_feedback
    FROM tool_selection_feedback
    WHERE timestamp >= ?
      AND source = 'explicit'
      AND correct IS NOT NULL
    GROUP BY tool_name
    HAVING wrong_count > 0
    ORDER BY wrong_count DESC
    LIMIT 10
  `).all(cutoff) as Array<{
    tool_name: string;
    wrong_count: number;
    total_feedback: number;
  }>;

  return {
    total_feedback: totals.total_feedback,
    confirmed_correct: totals.confirmed_correct,
    confirmed_wrong: totals.confirmed_wrong,
    accuracy_rate: totals.total_feedback > 0
      ? Math.round((totals.confirmed_correct / totals.total_feedback) * 1000) / 1000
      : null,
    top_reported_wrong_tools: wrongTools.map(r => ({
      tool_name: r.tool_name,
      wrong_count: r.wrong_count,
      total_feedback: r.total_feedback,
      wrong_rate: Math.round((r.wrong_count / r.total_feedback) * 1000) / 1000,
    })),
  };
}
