/**
 * Wikilink Feedback & Suppression
 *
 * Tracks accuracy of auto-wikilink suggestions and suppresses
 * entities with high false positive rates.
 */

import type { StateDb } from '@velvetmonkey/vault-core';

// =============================================================================
// TYPES
// =============================================================================

export interface FeedbackEntry {
  id: number;
  entity: string;
  context: string;
  note_path: string;
  correct: boolean;
  created_at: string;
}

export interface EntityStats {
  entity: string;
  total: number;
  correct: number;
  incorrect: number;
  accuracy: number;
  suppressed: boolean;
}

export interface FeedbackResult {
  mode: 'report' | 'list' | 'stats';
  reported?: { entity: string; correct: boolean; suppression_updated: boolean };
  entries?: FeedbackEntry[];
  stats?: EntityStats[];
  total_feedback?: number;
  total_suppressed?: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Minimum feedback entries before considering suppression */
const MIN_FEEDBACK_COUNT = 10;

/** False positive rate threshold for suppression (30%) */
const SUPPRESSION_THRESHOLD = 0.30;

// =============================================================================
// FEEDBACK OPERATIONS
// =============================================================================

/**
 * Record feedback for a wikilink entity
 */
export function recordFeedback(
  stateDb: StateDb,
  entity: string,
  context: string,
  notePath: string,
  correct: boolean,
): void {
  stateDb.db.prepare(
    'INSERT INTO wikilink_feedback (entity, context, note_path, correct) VALUES (?, ?, ?, ?)'
  ).run(entity, context, notePath, correct ? 1 : 0);
}

/**
 * Get feedback entries, optionally filtered by entity
 */
export function getFeedback(
  stateDb: StateDb,
  entity?: string,
  limit: number = 20,
): FeedbackEntry[] {
  let rows: Array<{
    id: number;
    entity: string;
    context: string;
    note_path: string;
    correct: number;
    created_at: string;
  }>;

  if (entity) {
    rows = stateDb.db.prepare(
      'SELECT id, entity, context, note_path, correct, created_at FROM wikilink_feedback WHERE entity = ? ORDER BY created_at DESC LIMIT ?'
    ).all(entity, limit) as typeof rows;
  } else {
    rows = stateDb.db.prepare(
      'SELECT id, entity, context, note_path, correct, created_at FROM wikilink_feedback ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as typeof rows;
  }

  return rows.map(r => ({
    id: r.id,
    entity: r.entity,
    context: r.context,
    note_path: r.note_path,
    correct: r.correct === 1,
    created_at: r.created_at,
  }));
}

/**
 * Compute accuracy stats per entity
 */
export function getEntityStats(stateDb: StateDb): EntityStats[] {
  const rows = stateDb.db.prepare(`
    SELECT
      entity,
      COUNT(*) as total,
      SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as correct_count,
      SUM(CASE WHEN correct = 0 THEN 1 ELSE 0 END) as incorrect_count
    FROM wikilink_feedback
    GROUP BY entity
    ORDER BY total DESC
  `).all() as Array<{
    entity: string;
    total: number;
    correct_count: number;
    incorrect_count: number;
  }>;

  // Check suppression status for each entity
  return rows.map(r => {
    const suppressed = isSuppressed(stateDb, r.entity);
    return {
      entity: r.entity,
      total: r.total,
      correct: r.correct_count,
      incorrect: r.incorrect_count,
      accuracy: r.total > 0 ? Math.round((r.correct_count / r.total) * 1000) / 1000 : 0,
      suppressed,
    };
  });
}

// =============================================================================
// SUPPRESSION
// =============================================================================

/**
 * Update suppression list based on feedback data
 * Call after recording new feedback or on startup.
 */
export function updateSuppressionList(stateDb: StateDb): number {
  const stats = stateDb.db.prepare(`
    SELECT
      entity,
      COUNT(*) as total,
      SUM(CASE WHEN correct = 0 THEN 1 ELSE 0 END) as false_positives
    FROM wikilink_feedback
    GROUP BY entity
    HAVING total >= ?
  `).all(MIN_FEEDBACK_COUNT) as Array<{
    entity: string;
    total: number;
    false_positives: number;
  }>;

  let updated = 0;

  const upsert = stateDb.db.prepare(`
    INSERT INTO wikilink_suppressions (entity, false_positive_rate, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(entity) DO UPDATE SET
      false_positive_rate = excluded.false_positive_rate,
      updated_at = datetime('now')
  `);

  const remove = stateDb.db.prepare(
    'DELETE FROM wikilink_suppressions WHERE entity = ?'
  );

  const transaction = stateDb.db.transaction(() => {
    for (const stat of stats) {
      const fpRate = stat.false_positives / stat.total;

      if (fpRate >= SUPPRESSION_THRESHOLD) {
        upsert.run(stat.entity, fpRate);
        updated++;
      } else {
        // Remove from suppression if rate dropped below threshold
        remove.run(stat.entity);
      }
    }
  });

  transaction();
  return updated;
}

/**
 * Check if an entity is currently suppressed
 */
export function isSuppressed(stateDb: StateDb, entity: string): boolean {
  const row = stateDb.db.prepare(
    'SELECT entity FROM wikilink_suppressions WHERE entity = ?'
  ).get(entity);
  return !!row;
}

/**
 * Get count of suppressed entities
 */
export function getSuppressedCount(stateDb: StateDb): number {
  const row = stateDb.db.prepare(
    'SELECT COUNT(*) as count FROM wikilink_suppressions'
  ).get() as { count: number };
  return row.count;
}

/**
 * Get all suppressed entities
 */
export function getSuppressedEntities(stateDb: StateDb): Array<{ entity: string; false_positive_rate: number }> {
  return stateDb.db.prepare(
    'SELECT entity, false_positive_rate FROM wikilink_suppressions ORDER BY false_positive_rate DESC'
  ).all() as Array<{ entity: string; false_positive_rate: number }>;
}
