/**
 * Proactive Linking Observability
 *
 * Queries wikilink_applications filtered to source='proactive' for
 * surfacing in brief, flywheel_doctor, learning_report, and vault_session_history.
 */

import type { StateDb } from '@velvetmonkey/vault-core';

// =============================================================================
// TYPES
// =============================================================================

export interface ProactiveLinkingSummary {
  window: { kind: 'rolling_24h'; since: string; until: string };
  total_applied: number;
  survived: number;
  removed: number;
  files_touched: number;
  survival_rate: number | null;
  recent: Array<{
    entity: string;
    note_path: string;
    applied_at: string;
    status: 'applied' | 'removed';
  }>;
}

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Format a JS Date to the same text shape used by applied_at (YYYY-MM-DD HH:MM:SS UTC)
 */
function toSqliteTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/**
 * Get proactive linking summary for a rolling window.
 *
 * @param stateDb - State database
 * @param daysBack - Number of days to look back (1 = last 24 hours)
 */
export function getProactiveLinkingSummary(
  stateDb: StateDb,
  daysBack: number = 1,
): ProactiveLinkingSummary {
  const now = new Date();
  const since = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const sinceStr = toSqliteTimestamp(since);
  const untilStr = toSqliteTimestamp(now);

  const survived = stateDb.db.prepare(
    `SELECT COUNT(*) as cnt FROM wikilink_applications
     WHERE source = 'proactive' AND applied_at >= ? AND status = 'applied'`,
  ).get(sinceStr) as { cnt: number };

  const removed = stateDb.db.prepare(
    `SELECT COUNT(*) as cnt FROM wikilink_applications
     WHERE source = 'proactive' AND applied_at >= ? AND status = 'removed'`,
  ).get(sinceStr) as { cnt: number };

  const files = stateDb.db.prepare(
    `SELECT COUNT(DISTINCT note_path) as cnt FROM wikilink_applications
     WHERE source = 'proactive' AND applied_at >= ?`,
  ).get(sinceStr) as { cnt: number };

  const recent = stateDb.db.prepare(
    `SELECT entity, note_path, applied_at, status FROM wikilink_applications
     WHERE source = 'proactive' AND applied_at >= ?
     ORDER BY applied_at DESC LIMIT 10`,
  ).all(sinceStr) as Array<{
    entity: string;
    note_path: string;
    applied_at: string;
    status: 'applied' | 'removed';
  }>;

  const totalApplied = survived.cnt + removed.cnt;
  const survivalRate = totalApplied > 0 ? survived.cnt / totalApplied : null;

  return {
    window: { kind: 'rolling_24h', since: sinceStr, until: untilStr },
    total_applied: totalApplied,
    survived: survived.cnt,
    removed: removed.cnt,
    files_touched: files.cnt,
    survival_rate: survivalRate,
    recent,
  };
}

/**
 * One-liner summary for embedding in brief/health_check.
 * Returns null when no proactive activity exists in the window.
 *
 * Format: "12 links applied across 8 notes (11 survived, 92% rate)"
 */
export function getProactiveLinkingOneLiner(
  stateDb: StateDb,
  daysBack: number = 1,
): string | null {
  const summary = getProactiveLinkingSummary(stateDb, daysBack);

  if (summary.total_applied === 0) return null;

  const linkWord = summary.total_applied === 1 ? 'link' : 'links';
  const noteWord = summary.files_touched === 1 ? 'note' : 'notes';
  const rate = summary.survival_rate !== null
    ? `${Math.round(summary.survival_rate * 100)}%`
    : 'n/a';

  return `${summary.total_applied} ${linkWord} applied across ${summary.files_touched} ${noteWord} (${summary.survived} survived, ${rate} rate)`;
}
