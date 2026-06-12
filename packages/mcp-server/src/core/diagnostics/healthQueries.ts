/**
 * StateDb queries for the diagnostics surface (arch-review S7).
 *
 * The only raw SQL of the doctor stack lives here (bar B4); report and
 * diagnosis modules consume these typed helpers.
 */

import type { StateDb } from '@velvetmonkey/vault-core';

export interface PendingProactiveRow {
  note_path: string;
  entity: string;
  score: number;
  confidence: string;
  queued_at: number;
  expires_at: number;
}

/** Count proactive-queue rows still pending. */
export function countPendingProactiveSuggestions(stateDb: StateDb): number {
  const row = stateDb.db.prepare(
    `SELECT COUNT(*) as cnt FROM proactive_queue WHERE status = 'pending'`,
  ).get() as { cnt: number };
  return row.cnt;
}

/** Most recent pending proactive-queue rows (newest first). */
export function listPendingProactiveSuggestions(stateDb: StateDb, limit: number): PendingProactiveRow[] {
  return stateDb.db.prepare(
    `SELECT note_path, entity, score, confidence, queued_at, expires_at
     FROM proactive_queue
     WHERE status = 'pending'
     ORDER BY queued_at DESC
     LIMIT ?`,
  ).all(limit) as PendingProactiveRow[];
}

/** Canonical entity row count (denominator for embedding coverage). */
export function countEntityRows(stateDb: StateDb): number {
  try {
    return (stateDb.db.prepare('SELECT COUNT(*) as cnt FROM entities').get() as { cnt: number })?.cnt ?? 0;
  } catch {
    return 0;
  }
}
