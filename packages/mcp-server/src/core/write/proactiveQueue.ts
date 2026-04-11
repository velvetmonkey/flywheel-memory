/**
 * Deferred proactive linking queue
 *
 * The watcher's suggestion scoring step (12) identifies high-confidence entities
 * for linking, but the file was just modified (that's what triggered the watcher),
 * so the 30-second mtime guard blocks immediate application.
 *
 * This module persists suggestions to a StateDb queue table and drains them
 * on the next watcher batch, when files are no longer being actively edited.
 */

import * as path from 'path';
import { statSync } from 'fs';
import type { StateDb } from '@velvetmonkey/vault-core';
import { serverLog } from '../shared/serverLog.js';

const QUEUE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MTIME_GUARD_MS = 60_000; // 1 minute — skip files modified within this window

export interface QueueEntry {
  notePath: string;
  entity: string;
  score: number;
  confidence: string;
}

export type RejectionReason =
  | 'active_edit'
  | 'stat_failed'
  | 'daily_cap'
  | 'apply_empty'
  | 'apply_error';

export interface Rejection {
  note_path: string;
  entity: string;
  score: number;
  confidence: string;
  reason: RejectionReason;
  detail?: string;
}

export interface DrainResult {
  applied: Array<{ file: string; entities: string[] }>;
  expired: number;
  skippedActiveEdit: number;
  skippedMtimeGuard: number;
  skippedDailyCap: number;
  rejections: Rejection[];
}

type ApplyFn = (
  filePath: string,
  vaultPath: string,
  suggestions: Array<{ entity: string; score: number; confidence: string }>,
  config: { minScore: number; maxPerFile: number },
) => Promise<{ applied: string[]; skipped: string[] }>;

/**
 * Enqueue suggestions for deferred application.
 * UNIQUE(note_path, entity) deduplicates; on conflict, keeps higher score.
 */
export function enqueueProactiveSuggestions(
  stateDb: StateDb,
  entries: QueueEntry[],
): number {
  if (entries.length === 0) return 0;

  const now = Date.now();
  const expiresAt = now + QUEUE_TTL_MS;

  const upsert = stateDb.db.prepare(`
    INSERT INTO proactive_queue (note_path, entity, score, confidence, queued_at, expires_at, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
    ON CONFLICT(note_path, entity) DO UPDATE SET
      score = CASE WHEN excluded.score > proactive_queue.score THEN excluded.score ELSE proactive_queue.score END,
      confidence = excluded.confidence,
      queued_at = excluded.queued_at,
      expires_at = excluded.expires_at,
      status = 'pending'
    WHERE proactive_queue.status = 'pending'
  `);

  let enqueued = 0;
  for (const entry of entries) {
    try {
      const result = upsert.run(entry.notePath, entry.entity, entry.score, entry.confidence, now, expiresAt);
      if (result.changes > 0) enqueued++;
    } catch { /* ignore constraint errors */ }
  }
  return enqueued;
}

/**
 * Drain pending queue entries, applying to files that pass safety checks.
 */
export async function drainProactiveQueue(
  stateDb: StateDb,
  vaultPath: string,
  config: { minScore: number; maxPerFile: number; maxPerDay: number },
  applyFn: ApplyFn,
): Promise<DrainResult> {
  const result: DrainResult = {
    applied: [],
    expired: 0,
    skippedActiveEdit: 0,
    skippedMtimeGuard: 0,
    skippedDailyCap: 0,
    rejections: [],
  };

  const pushRejections = (
    filePath: string,
    items: Array<{ entity: string; score: number; confidence: string }>,
    reason: RejectionReason,
    detail?: string,
  ): void => {
    for (const s of items) {
      result.rejections.push({
        note_path: filePath,
        entity: s.entity,
        score: s.score,
        confidence: s.confidence,
        reason,
        ...(detail ? { detail } : {}),
      });
    }
  };

  // 1. Expire stale entries
  result.expired = expireStaleEntries(stateDb);

  // 2. Load pending entries, ordered by score descending
  const now = Date.now();
  const pending = stateDb.db.prepare(`
    SELECT note_path, entity, score, confidence
    FROM proactive_queue
    WHERE status = 'pending' AND expires_at > ?
    ORDER BY note_path, score DESC
  `).all(now) as Array<{ note_path: string; entity: string; score: number; confidence: string }>;

  if (pending.length === 0) return result;

  // 3. Group by file
  const byFile = new Map<string, Array<{ entity: string; score: number; confidence: string }>>();
  for (const row of pending) {
    if (!byFile.has(row.note_path)) byFile.set(row.note_path, []);
    byFile.get(row.note_path)!.push({ entity: row.entity, score: row.score, confidence: row.confidence });
  }

  // Prepare statements for marking results
  const markApplied = stateDb.db.prepare(
    `UPDATE proactive_queue SET status = 'applied', applied_at = ? WHERE note_path = ? AND entity = ? AND status = 'pending'`,
  );

  // Daily cap check: count today's proactive applications per file
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const todayStr = todayMidnight.toISOString().slice(0, 10); // YYYY-MM-DD

  const countTodayApplied = stateDb.db.prepare(
    `SELECT COUNT(*) as cnt FROM wikilink_applications WHERE note_path = ? AND applied_at >= ? AND source = 'proactive'`,
  );

  // 4. Process each file
  for (const [filePath, suggestions] of byFile) {
    // Skip files modified within the last minute (actively being edited)
    const fullPath = path.join(vaultPath, filePath);
    try {
      const mtime = statSync(fullPath).mtimeMs;
      if (Date.now() - mtime < MTIME_GUARD_MS) {
        result.skippedActiveEdit += suggestions.length;
        pushRejections(filePath, suggestions, 'active_edit', `mtime age ${Date.now() - mtime}ms < ${MTIME_GUARD_MS}ms`);
        continue;
      }
    } catch (e) {
      result.skippedActiveEdit += suggestions.length;
      pushRejections(filePath, suggestions, 'stat_failed', String(e));
      continue;
    }

    // Daily cap check
    const todayCount = (countTodayApplied.get(filePath, todayStr) as { cnt: number }).cnt;
    if (todayCount >= config.maxPerDay) {
      result.skippedDailyCap += suggestions.length;
      pushRejections(filePath, suggestions, 'daily_cap', `today=${todayCount} cap=${config.maxPerDay}`);
      // Mark these as expired since we won't apply them today
      for (const s of suggestions) {
        try {
          stateDb.db.prepare(
            `UPDATE proactive_queue SET status = 'expired' WHERE note_path = ? AND entity = ? AND status = 'pending'`,
          ).run(filePath, s.entity);
        } catch { /* non-critical */ }
      }
      continue;
    }

    // Limit to remaining daily budget
    const remaining = config.maxPerDay - todayCount;
    const capped = suggestions.slice(0, remaining);

    try {
      const applyResult = await applyFn(filePath, vaultPath, capped, config);

      if (applyResult.applied.length > 0) {
        result.applied.push({ file: filePath, entities: applyResult.applied });
        const appliedAt = Date.now();
        for (const entity of applyResult.applied) {
          try { markApplied.run(appliedAt, filePath, entity); } catch { /* non-critical */ }
        }
      }

      // Anything not in applied but in capped was rejected by applyFn
      // (suppressed, common-word FP, apply produced 0 links, stat/read/write fail).
      // Leave as pending — next drain retries. Record rejection reason.
      const appliedSet = new Set(applyResult.applied);
      const notApplied = capped.filter(s => !appliedSet.has(s.entity));
      if (notApplied.length > 0) {
        result.skippedMtimeGuard += notApplied.length;
        pushRejections(filePath, notApplied, 'apply_empty', 'applyFn returned empty (suppressed, common-word, write failed, or 0 links added)');
      }
    } catch (e) {
      serverLog('watcher', `Proactive drain: error applying to ${filePath}: ${e}`, 'error');
      pushRejections(filePath, capped, 'apply_error', String(e));
    }
  }

  return result;
}

/**
 * Expire stale queue entries past TTL.
 */
export function expireStaleEntries(stateDb: StateDb): number {
  const result = stateDb.db.prepare(
    `UPDATE proactive_queue SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?`,
  ).run(Date.now());
  return result.changes;
}
