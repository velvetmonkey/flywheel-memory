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

/** Minimum feedback entries before applying feedback boost */
export const FEEDBACK_BOOST_MIN_SAMPLES = 5;

/** Minimum feedback entries in a folder before folder-specific suppression */
export const FOLDER_SUPPRESSION_MIN_COUNT = 5;

/** Feedback boost tiers: accuracy threshold → score adjustment */
export const FEEDBACK_BOOST_TIERS: ReadonlyArray<{ minAccuracy: number; minSamples: number; boost: number }> = [
  { minAccuracy: 0.95, minSamples: 20, boost: 5 },
  { minAccuracy: 0.80, minSamples: 5, boost: 2 },
  { minAccuracy: 0.60, minSamples: 5, boost: 0 },
  { minAccuracy: 0.40, minSamples: 5, boost: -2 },
  { minAccuracy: 0,    minSamples: 5, boost: -4 },
];

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
 * @param folder - Optional folder for context-stratified suppression
 */
export function isSuppressed(stateDb: StateDb, entity: string, folder?: string): boolean {
  // Global suppression check first
  const row = stateDb.db.prepare(
    'SELECT entity FROM wikilink_suppressions WHERE entity = ?'
  ).get(entity);
  if (row) return true;

  // Folder-specific suppression: check if entity has high FP rate in this folder
  if (folder !== undefined) {
    const folderStats = stateDb.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN correct = 0 THEN 1 ELSE 0 END) as false_positives
      FROM wikilink_feedback
      WHERE entity = ? AND (
        CASE WHEN ? = '' THEN note_path NOT LIKE '%/%'
        ELSE note_path LIKE ? || '/%'
        END
      )
    `).get(entity, folder, folder) as { total: number; false_positives: number } | undefined;

    if (folderStats && folderStats.total >= FOLDER_SUPPRESSION_MIN_COUNT) {
      const fpRate = folderStats.false_positives / folderStats.total;
      if (fpRate >= SUPPRESSION_THRESHOLD) {
        return true;
      }
    }
  }

  return false;
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

// =============================================================================
// CONTEXT STRATIFICATION
// =============================================================================

/**
 * Extract top-level folder from a note path
 * Root-level notes return ''
 */
export function extractFolder(notePath: string): string {
  const parts = notePath.split('/');
  return parts.length > 1 ? parts[0] : '';
}

/**
 * Get per-entity per-folder accuracy stats
 */
export function getEntityFolderAccuracy(stateDb: StateDb): Map<string, Map<string, { accuracy: number; count: number }>> {
  const rows = stateDb.db.prepare(`
    SELECT
      entity,
      note_path,
      correct
    FROM wikilink_feedback
  `).all() as Array<{ entity: string; note_path: string; correct: number }>;

  // Accumulate per entity per folder
  const acc = new Map<string, Map<string, { correct: number; total: number }>>();

  for (const row of rows) {
    const folder = extractFolder(row.note_path);
    if (!acc.has(row.entity)) acc.set(row.entity, new Map());
    const entityMap = acc.get(row.entity)!;
    if (!entityMap.has(folder)) entityMap.set(folder, { correct: 0, total: 0 });
    const stats = entityMap.get(folder)!;
    stats.total++;
    if (row.correct === 1) stats.correct++;
  }

  // Convert to accuracy
  const result = new Map<string, Map<string, { accuracy: number; count: number }>>();
  for (const [entity, folderMap] of acc) {
    const entityResult = new Map<string, { accuracy: number; count: number }>();
    for (const [folder, stats] of folderMap) {
      entityResult.set(folder, {
        accuracy: stats.total > 0 ? stats.correct / stats.total : 0,
        count: stats.total,
      });
    }
    result.set(entity, entityResult);
  }

  return result;
}

// =============================================================================
// FEEDBACK BOOST (Layer 10)
// =============================================================================

/**
 * Compute boost from accuracy and sample count
 */
export function computeBoostFromAccuracy(accuracy: number, sampleCount: number): number {
  if (sampleCount < FEEDBACK_BOOST_MIN_SAMPLES) return 0;

  for (const tier of FEEDBACK_BOOST_TIERS) {
    if (accuracy >= tier.minAccuracy && sampleCount >= tier.minSamples) {
      return tier.boost;
    }
  }

  return 0;
}

/**
 * Get feedback boost for a single entity
 */
export function getFeedbackBoost(stateDb: StateDb, entity: string): number {
  const row = stateDb.db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as correct_count
    FROM wikilink_feedback
    WHERE entity = ?
  `).get(entity) as { total: number; correct_count: number } | undefined;

  if (!row || row.total < FEEDBACK_BOOST_MIN_SAMPLES) return 0;

  const accuracy = row.correct_count / row.total;
  return computeBoostFromAccuracy(accuracy, row.total);
}

/**
 * Get feedback boosts for all entities with sufficient feedback (batch query)
 * @param folder - Optional folder for context-stratified boosts. When provided,
 *   prefers folder-specific accuracy (if ≥5 entries in that folder) over global.
 */
export function getAllFeedbackBoosts(stateDb: StateDb, folder?: string): Map<string, number> {
  // Get global stats
  const globalRows = stateDb.db.prepare(`
    SELECT
      entity,
      COUNT(*) as total,
      SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as correct_count
    FROM wikilink_feedback
    GROUP BY entity
    HAVING total >= ?
  `).all(FEEDBACK_BOOST_MIN_SAMPLES) as Array<{
    entity: string;
    total: number;
    correct_count: number;
  }>;

  // Get folder-specific stats if folder provided
  let folderStats: Map<string, { accuracy: number; count: number }> | null = null;
  if (folder !== undefined) {
    const folderRows = stateDb.db.prepare(`
      SELECT
        entity,
        COUNT(*) as total,
        SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as correct_count
      FROM wikilink_feedback
      WHERE (
        CASE WHEN ? = '' THEN note_path NOT LIKE '%/%'
        ELSE note_path LIKE ? || '/%'
        END
      )
      GROUP BY entity
      HAVING total >= ?
    `).all(folder, folder, FEEDBACK_BOOST_MIN_SAMPLES) as Array<{
      entity: string;
      total: number;
      correct_count: number;
    }>;

    folderStats = new Map();
    for (const row of folderRows) {
      folderStats.set(row.entity, {
        accuracy: row.correct_count / row.total,
        count: row.total,
      });
    }
  }

  const boosts = new Map<string, number>();
  for (const row of globalRows) {
    // Prefer folder-specific accuracy when available
    let accuracy: number;
    let sampleCount: number;
    const fs = folderStats?.get(row.entity);
    if (fs && fs.count >= FEEDBACK_BOOST_MIN_SAMPLES) {
      accuracy = fs.accuracy;
      sampleCount = fs.count;
    } else {
      accuracy = row.correct_count / row.total;
      sampleCount = row.total;
    }

    const boost = computeBoostFromAccuracy(accuracy, sampleCount);
    if (boost !== 0) {
      boosts.set(row.entity, boost);
    }
  }
  return boosts;
}
