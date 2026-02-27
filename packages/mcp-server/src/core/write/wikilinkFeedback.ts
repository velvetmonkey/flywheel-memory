/**
 * Wikilink Feedback & Suppression
 *
 * Tracks accuracy of auto-wikilink suggestions and suppresses
 * entities with high false positive rates.
 */

import type { StateDb } from '@velvetmonkey/vault-core';
import { extractLinkedEntities } from './wikilinks.js';

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
  mode: 'report' | 'list' | 'stats' | 'dashboard' | 'entity_timeline' | 'layer_timeseries' | 'snapshot_diff';
  reported?: { entity: string; correct: boolean; suppression_updated: boolean };
  entries?: FeedbackEntry[];
  stats?: EntityStats[];
  total_feedback?: number;
  total_suppressed?: number;
  dashboard?: DashboardData;
}

export interface DashboardData {
  total_feedback: number;
  total_correct: number;
  total_incorrect: number;
  overall_accuracy: number;
  total_suppressed: number;
  feedback_sources: {
    explicit: { count: number; correct: number };
    implicit: { count: number; correct: number };
  };
  applications: { applied: number; removed: number };
  boost_tiers: Array<{
    label: string;
    boost: number;
    min_accuracy: number;
    min_samples: number;
    entities: Array<{ entity: string; accuracy: number; total: number }>;
  }>;
  learning: Array<{ entity: string; accuracy: number; total: number }>;
  suppressed: Array<{ entity: string; false_positive_rate: number; total: number }>;
  recent: FeedbackEntry[];
  timeline: Array<{ day: string; count: number; correct: number; incorrect: number }>;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Beta-Binomial prior parameters (benefit of doubt: Beta(8,1) → 89% prior mean) */
export const PRIOR_ALPHA = 8;   // Prior "correct" observations (strong noise resistance)
export const PRIOR_BETA = 1;    // Prior "incorrect" observations

/** Posterior mean threshold for suppression (suppress when posteriorMean < this) */
export const SUPPRESSION_POSTERIOR_THRESHOLD = 0.35;

/** Minimum total posterior observations (alpha + beta) before considering suppression */
export const SUPPRESSION_MIN_OBSERVATIONS = 20;

/** Maximum suppression penalty (strongly demotes but allows excellent content matches to survive) */
const MAX_SUPPRESSION_PENALTY = -15;

/** Minimum feedback entries before applying feedback boost */
export const FEEDBACK_BOOST_MIN_SAMPLES = 3;

/** Minimum feedback entries in a folder before folder-specific suppression */
export const FOLDER_SUPPRESSION_MIN_COUNT = 5;

/** Days before a suppression expires and entity gets re-evaluated */
const SUPPRESSION_TTL_DAYS = 30;

/** Half-life for feedback decay in days */
export const FEEDBACK_DECAY_HALF_LIFE_DAYS = 30;
const FEEDBACK_DECAY_LAMBDA = Math.LN2 / FEEDBACK_DECAY_HALF_LIFE_DAYS; // ≈ 0.0231

/** Minimum weighted total for folder-specific checks */
const WEIGHTED_MIN_TOTAL = 3.0;

/**
 * Compute Beta-Binomial posterior mean.
 * posteriorMean = alpha / (alpha + beta) where:
 *   alpha = PRIOR_ALPHA + weightedCorrect
 *   beta = PRIOR_BETA + weightedFp
 * Returns the probability that the entity is correct (higher = better).
 */
export function computePosteriorMean(weightedCorrect: number, weightedFp: number): number {
  const alpha = PRIOR_ALPHA + weightedCorrect;
  const beta_ = PRIOR_BETA + weightedFp;
  return alpha / (alpha + beta_);
}

/** Feedback boost tiers: accuracy threshold → score adjustment */
export const FEEDBACK_BOOST_TIERS: ReadonlyArray<{ minAccuracy: number; minSamples: number; boost: number }> = [
  { minAccuracy: 0.85, minSamples: 5, boost: 10 },  // Strong reward for high accuracy
  { minAccuracy: 0.70, minSamples: 3, boost: 6 },   // Most TPs land here
  { minAccuracy: 0.50, minSamples: 3, boost: 0 },   // Neutral — Layer 0 suppression handles demotion
  { minAccuracy: 0.30, minSamples: 3, boost: 0 },   // Neutral — no double-penalty with Layer 0
  { minAccuracy: 0,    minSamples: 3, boost: 0 },    // Neutral — no double-penalty with Layer 0
];

// =============================================================================
// FEEDBACK OPERATIONS
// =============================================================================

/**
 * Record feedback for a wikilink entity
 * @param confidence - Signal quality weight (0-1). Defaults to 1.0.
 *   - Implicit removal within 1h: 1.0 (strong negative)
 *   - Implicit removal after 24h: 0.7 (may be context change)
 *   - Survival after note edit: 0.8
 *   - Unedited note: 0.3 (weak signal)
 *   - Explicit user feedback: 1.0
 */
export function recordFeedback(
  stateDb: StateDb,
  entity: string,
  context: string,
  notePath: string,
  correct: boolean,
  confidence: number = 1.0,
): void {
  try {
    console.error(`[Flywheel] recordFeedback: entity="${entity}" context="${context}" notePath="${notePath}" correct=${correct}`);
    const result = stateDb.db.prepare(
      'INSERT INTO wikilink_feedback (entity, context, note_path, correct, confidence) VALUES (?, ?, ?, ?, ?)'
    ).run(entity, context, notePath, correct ? 1 : 0, confidence);
    console.error(`[Flywheel] recordFeedback: inserted id=${result.lastInsertRowid}`);
  } catch (e) {
    console.error(`[Flywheel] recordFeedback failed for entity="${entity}": ${e}`);
    throw e;
  }
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
    GROUP BY entity COLLATE NOCASE
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
// RECENCY-WEIGHTED FEEDBACK DECAY
// =============================================================================

export interface WeightedEntityStats {
  entity: string;
  weightedTotal: number;
  weightedCorrect: number;
  weightedFp: number;
  rawTotal: number;
  weightedAccuracy: number;
  weightedFpRate: number;
}

/**
 * Compute decay weight for a feedback entry.
 * weight = exp(-lambda * age_days)
 * Age 0: 1.0, Age 30d: 0.5, Age 60d: 0.25, Age 90d: 0.125
 * @param createdAt - ISO date string of when the feedback was created
 * @param now - Optional reference date for testability
 */
export function computeFeedbackWeight(createdAt: string, now?: Date): number {
  const ref = now ?? new Date();
  // SQLite datetime('now') returns 'YYYY-MM-DD HH:MM:SS' in UTC — normalize for reliable JS parsing
  const normalized = createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T') + 'Z';
  const ageDays = (ref.getTime() - new Date(normalized).getTime()) / (24 * 60 * 60 * 1000);
  // Entries less than 1 minute old get weight 1.0 exactly (avoids float boundary issues)
  if (ageDays < 1 / 1440) return 1.0;
  return Math.exp(-FEEDBACK_DECAY_LAMBDA * ageDays);
}

/**
 * Get weighted entity stats applying recency decay to all feedback rows.
 * Groups by entity (COLLATE NOCASE), applies computeFeedbackWeight() per row.
 * JS-side computation because SQLite has no exp() function.
 */
export function getWeightedEntityStats(stateDb: StateDb, now?: Date): WeightedEntityStats[] {
  const rows = stateDb.db.prepare(`
    SELECT entity, correct, confidence, created_at
    FROM wikilink_feedback
    ORDER BY entity COLLATE NOCASE
  `).all() as Array<{ entity: string; correct: number; confidence: number; created_at: string }>;

  const acc = new Map<string, { weightedTotal: number; weightedCorrect: number; weightedFp: number; rawTotal: number }>();

  for (const row of rows) {
    const key = row.entity.toLowerCase();
    if (!acc.has(key)) {
      acc.set(key, { weightedTotal: 0, weightedCorrect: 0, weightedFp: 0, rawTotal: 0 });
    }
    const stats = acc.get(key)!;
    const recencyWeight = computeFeedbackWeight(row.created_at, now);
    const weight = recencyWeight * (row.confidence ?? 1.0);
    stats.weightedTotal += weight;
    stats.rawTotal++;
    if (row.correct === 1) {
      stats.weightedCorrect += weight;
    } else {
      stats.weightedFp += weight;
    }
    // Keep original entity casing from first occurrence
    if (stats.rawTotal === 1 || !acc.has(row.entity)) {
      // Store original name on first encounter — we'll map back below
    }
  }

  // We need entity names with original casing. Fetch from first row per group.
  const entityNames = new Map<string, string>();
  for (const row of rows) {
    const key = row.entity.toLowerCase();
    if (!entityNames.has(key)) entityNames.set(key, row.entity);
  }

  const result: WeightedEntityStats[] = [];
  for (const [key, stats] of acc) {
    const entity = entityNames.get(key) ?? key;
    result.push({
      entity,
      weightedTotal: stats.weightedTotal,
      weightedCorrect: stats.weightedCorrect,
      weightedFp: stats.weightedFp,
      rawTotal: stats.rawTotal,
      weightedAccuracy: stats.weightedTotal > 0 ? stats.weightedCorrect / stats.weightedTotal : 0,
      weightedFpRate: stats.weightedTotal > 0 ? stats.weightedFp / stats.weightedTotal : 0,
    });
  }

  return result;
}

/**
 * Get weighted stats for a specific entity within a folder.
 * Used for folder-specific suppression and boost checks.
 */
function getWeightedFolderStats(
  stateDb: StateDb,
  entity: string,
  folder: string,
  now?: Date,
): { weightedTotal: number; weightedFp: number; weightedAccuracy: number; weightedFpRate: number; rawTotal: number } {
  const rows = stateDb.db.prepare(`
    SELECT correct, confidence, created_at
    FROM wikilink_feedback
    WHERE entity = ? COLLATE NOCASE AND (
      CASE WHEN ? = '' THEN note_path NOT LIKE '%/%'
      ELSE note_path LIKE ? || '/%'
      END
    )
  `).all(entity, folder, folder) as Array<{ correct: number; confidence: number; created_at: string }>;

  let weightedTotal = 0;
  let weightedCorrect = 0;
  let weightedFp = 0;

  for (const row of rows) {
    const recencyWeight = computeFeedbackWeight(row.created_at, now);
    const weight = recencyWeight * (row.confidence ?? 1.0);
    weightedTotal += weight;
    if (row.correct === 1) {
      weightedCorrect += weight;
    } else {
      weightedFp += weight;
    }
  }

  return {
    weightedTotal,
    weightedFp,
    weightedAccuracy: weightedTotal > 0 ? weightedCorrect / weightedTotal : 0,
    weightedFpRate: weightedTotal > 0 ? weightedFp / weightedTotal : 0,
    rawTotal: rows.length,
  };
}

// =============================================================================
// SUPPRESSION
// =============================================================================

/**
 * Update suppression list based on feedback data with recency-weighted decay.
 * Call after recording new feedback or on startup.
 */
export function updateSuppressionList(stateDb: StateDb, now?: Date): number {
  const weightedStats = getWeightedEntityStats(stateDb, now);

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
    // Remove expired suppressions so entities get re-evaluated
    stateDb.db.prepare(
      `DELETE FROM wikilink_suppressions
       WHERE datetime(updated_at, '+' || ? || ' days') <= datetime('now')`
    ).run(SUPPRESSION_TTL_DAYS);

    for (const stat of weightedStats) {
      const posteriorMean = computePosteriorMean(stat.weightedCorrect, stat.weightedFp);
      const totalObs = PRIOR_ALPHA + stat.weightedCorrect + PRIOR_BETA + stat.weightedFp;

      // Don't touch entities without enough observations
      if (totalObs < SUPPRESSION_MIN_OBSERVATIONS) {
        continue;
      }

      if (posteriorMean < SUPPRESSION_POSTERIOR_THRESHOLD) {
        // Store 1 - posteriorMean for backward compat (higher = worse)
        upsert.run(stat.entity, 1 - posteriorMean);
        updated++;
      } else {
        // Remove from suppression if posterior recovered above threshold
        remove.run(stat.entity);
      }
    }
  });

  transaction();
  return updated;
}

/**
 * Explicitly suppress an entity (immediate, bypasses threshold logic).
 * Used for explicit negative feedback where user says "this is wrong."
 */
export function suppressEntity(stateDb: StateDb, entity: string): void {
  stateDb.db.prepare(`
    INSERT INTO wikilink_suppressions (entity, false_positive_rate, updated_at)
    VALUES (?, 1.0, datetime('now'))
    ON CONFLICT(entity) DO UPDATE SET false_positive_rate = 1.0, updated_at = datetime('now')
  `).run(entity);
}

/**
 * Remove an entity from the suppression list.
 * Returns true if the entity was actually suppressed (and is now removed).
 */
export function unsuppressEntity(stateDb: StateDb, entity: string): boolean {
  const result = stateDb.db.prepare(
    'DELETE FROM wikilink_suppressions WHERE entity = ? COLLATE NOCASE'
  ).run(entity);
  return result.changes > 0;
}

/**
 * Check if an entity is currently suppressed
 * @param folder - Optional folder for context-stratified suppression
 * @param now - Optional reference date for testability (decay computation)
 */
export function isSuppressed(stateDb: StateDb, entity: string, folder?: string, now?: Date): boolean {
  // Global suppression check first (with TTL)
  const row = stateDb.db.prepare(
    `SELECT entity, updated_at FROM wikilink_suppressions
     WHERE entity = ? COLLATE NOCASE
     AND datetime(updated_at, '+' || ? || ' days') > datetime('now')`
  ).get(entity, SUPPRESSION_TTL_DAYS) as { entity: string; updated_at: string } | undefined;
  if (row) return true;

  // Folder-specific suppression: use Beta-Binomial posterior
  if (folder !== undefined) {
    const stats = getWeightedFolderStats(stateDb, entity, folder, now);
    if (stats.rawTotal >= FOLDER_SUPPRESSION_MIN_COUNT) {
      const folderCorrect = stats.weightedTotal - stats.weightedFp;
      const posteriorMean = computePosteriorMean(folderCorrect, stats.weightedFp);
      const totalObs = PRIOR_ALPHA + folderCorrect + PRIOR_BETA + stats.weightedFp;
      if (totalObs >= SUPPRESSION_MIN_OBSERVATIONS && posteriorMean < SUPPRESSION_POSTERIOR_THRESHOLD) {
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
export function getSuppressedEntities(stateDb: StateDb): Array<{ entity: string; false_positive_rate: number; total: number }> {
  return stateDb.db.prepare(`
    SELECT s.entity, s.false_positive_rate,
      COALESCE((SELECT COUNT(*) FROM wikilink_feedback WHERE entity = s.entity COLLATE NOCASE), 0) as total
    FROM wikilink_suppressions s
    ORDER BY s.false_positive_rate DESC
  `).all() as Array<{ entity: string; false_positive_rate: number; total: number }>;
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
 * Get feedback boost for a single entity using recency-weighted accuracy.
 * @param now - Optional reference date for testability
 */
export function getFeedbackBoost(stateDb: StateDb, entity: string, now?: Date): number {
  const rows = stateDb.db.prepare(`
    SELECT correct, created_at
    FROM wikilink_feedback
    WHERE entity = ?
  `).all(entity) as Array<{ correct: number; created_at: string }>;

  if (rows.length < FEEDBACK_BOOST_MIN_SAMPLES) return 0;

  let weightedTotal = 0;
  let weightedCorrect = 0;
  for (const row of rows) {
    const weight = computeFeedbackWeight(row.created_at, now);
    weightedTotal += weight;
    if (row.correct === 1) weightedCorrect += weight;
  }

  const accuracy = weightedTotal > 0 ? weightedCorrect / weightedTotal : 0;
  return computeBoostFromAccuracy(accuracy, rows.length);
}

/**
 * Get feedback boosts for all entities with sufficient feedback (batch query).
 * Uses recency-weighted accuracy for boost computation.
 * @param folder - Optional folder for context-stratified boosts. When provided,
 *   prefers folder-specific weighted accuracy (if ≥5 entries in that folder) over global.
 * @param now - Optional reference date for testability
 */
export function getAllFeedbackBoosts(stateDb: StateDb, folder?: string, now?: Date): Map<string, number> {
  // Get global weighted stats
  const globalStats = getWeightedEntityStats(stateDb, now);

  // Build folder-specific weighted stats if folder provided
  let folderStatsMap: Map<string, { weightedAccuracy: number; rawCount: number }> | null = null;
  if (folder !== undefined) {
    folderStatsMap = new Map();
    // Only compute folder stats for entities that have global data
    for (const gs of globalStats) {
      const fs = getWeightedFolderStats(stateDb, gs.entity, folder, now);
      if (fs.rawTotal >= FEEDBACK_BOOST_MIN_SAMPLES) {
        folderStatsMap.set(gs.entity, {
          weightedAccuracy: fs.weightedAccuracy,
          rawCount: fs.rawTotal,
        });
      }
    }
  }

  const boosts = new Map<string, number>();
  for (const stat of globalStats) {
    if (stat.rawTotal < FEEDBACK_BOOST_MIN_SAMPLES) continue;

    // Prefer folder-specific weighted accuracy when available
    let accuracy: number;
    let sampleCount: number;
    const fs = folderStatsMap?.get(stat.entity);
    if (fs && fs.rawCount >= FEEDBACK_BOOST_MIN_SAMPLES) {
      accuracy = fs.weightedAccuracy;
      sampleCount = fs.rawCount;
    } else {
      accuracy = stat.weightedAccuracy;
      sampleCount = stat.rawTotal;
    }

    const boost = computeBoostFromAccuracy(accuracy, sampleCount);
    if (boost !== 0) {
      boosts.set(stat.entity, boost);
    }
  }
  return boosts;
}

// =============================================================================
// SUPPRESSION PENALTIES (Soft, Proportional)
// =============================================================================

/**
 * Get proportional suppression penalties for all entities with sufficient feedback.
 * Penalties are proportional to posterior confidence — barely suppressed entities
 * get minimal penalty, clearly bad entities get near-maximum.
 *
 * Used by suggestRelatedLinks() for soft suppression (replaces hard block).
 * @param now - Optional reference date for testability
 */
export function getAllSuppressionPenalties(stateDb: StateDb, now?: Date): Map<string, number> {
  const penalties = new Map<string, number>();
  const weightedStats = getWeightedEntityStats(stateDb, now);

  for (const stat of weightedStats) {
    const posteriorMean = computePosteriorMean(stat.weightedCorrect, stat.weightedFp);
    const totalObs = PRIOR_ALPHA + stat.weightedCorrect + PRIOR_BETA + stat.weightedFp;

    if (totalObs >= SUPPRESSION_MIN_OBSERVATIONS && posteriorMean < SUPPRESSION_POSTERIOR_THRESHOLD) {
      // Proportional: barely suppressed (0.35) → ~0, fully bad (0.0) → MAX_SUPPRESSION_PENALTY
      const penalty = Math.round(MAX_SUPPRESSION_PENALTY * (1 - posteriorMean / SUPPRESSION_POSTERIOR_THRESHOLD));
      if (penalty < 0) {
        penalties.set(stat.entity, penalty);
      }
    }
  }

  // Also include explicitly suppressed entities from the table
  // (may not have feedback data, e.g., user manually suppressed via suppressEntity())
  const rows = stateDb.db.prepare(
    `SELECT entity, updated_at FROM wikilink_suppressions
     WHERE datetime(updated_at, '+' || ? || ' days') > datetime('now')`
  ).all(SUPPRESSION_TTL_DAYS) as Array<{ entity: string; updated_at: string }>;

  for (const row of rows) {
    if (!penalties.has(row.entity)) {
      penalties.set(row.entity, MAX_SUPPRESSION_PENALTY);
    }
  }

  return penalties;
}

// =============================================================================
// IMPLICIT FEEDBACK (Application Tracking & Removal Detection)
// =============================================================================

/**
 * Track wikilink applications for a note
 * UPSERT each entity with status='applied' for later removal detection
 */
export function trackWikilinkApplications(
  stateDb: StateDb,
  notePath: string,
  entities: string[],
): void {
  const upsert = stateDb.db.prepare(`
    INSERT INTO wikilink_applications (entity, note_path, applied_at, status)
    VALUES (?, ?, datetime('now'), 'applied')
    ON CONFLICT(entity, note_path) DO UPDATE SET
      applied_at = datetime('now'),
      status = 'applied'
  `);

  const transaction = stateDb.db.transaction(() => {
    for (const entity of entities) {
      upsert.run(entity, notePath);
    }
  });

  transaction();
}

/**
 * Get tracked applications for a note (status='applied')
 */
export function getTrackedApplications(
  stateDb: StateDb,
  notePath: string,
): string[] {
  const rows = stateDb.db.prepare(
    `SELECT entity FROM wikilink_applications WHERE note_path = ? AND status = 'applied'`
  ).all(notePath) as Array<{ entity: string }>;

  return rows.map(r => r.entity);
}

/**
 * Get tracked applications with applied_at timestamp for confidence computation.
 */
function getTrackedApplicationsWithTime(
  stateDb: StateDb,
  notePath: string,
): Array<{ entity: string; applied_at: string }> {
  return stateDb.db.prepare(
    `SELECT entity, applied_at FROM wikilink_applications WHERE note_path = ? AND status = 'applied'`
  ).all(notePath) as Array<{ entity: string; applied_at: string }>;
}

/**
 * Compute implicit feedback confidence based on how long the link survived.
 * - Removed within 1h: 1.0 (strong negative — user immediately rejected it)
 * - Removed within 24h: 0.85 (likely intentional removal)
 * - Removed after 24h: 0.7 (may be context change, not necessarily wrong)
 */
function computeImplicitRemovalConfidence(appliedAt: string): number {
  const normalized = appliedAt.includes('T') ? appliedAt : appliedAt.replace(' ', 'T') + 'Z';
  const ageHours = (Date.now() - new Date(normalized).getTime()) / (60 * 60 * 1000);
  if (ageHours <= 1) return 1.0;
  if (ageHours <= 24) return 0.85;
  return 0.7;
}

/** Get previously stored forward links for a note */
export function getStoredNoteLinks(stateDb: StateDb, notePath: string): Set<string> {
  const rows = stateDb.db.prepare(
    'SELECT target FROM note_links WHERE note_path = ?'
  ).all(notePath) as Array<{ target: string }>;
  return new Set(rows.map(r => r.target));
}

/** Update stored links for a note, preserving weights on existing rows */
export function updateStoredNoteLinks(
  stateDb: StateDb,
  notePath: string,
  currentLinks: Set<string>,
): void {
  const ins = stateDb.db.prepare(
    'INSERT OR IGNORE INTO note_links (note_path, target) VALUES (?, ?)'
  );
  const del = stateDb.db.prepare(
    'DELETE FROM note_links WHERE note_path = ? AND target = ?'
  );
  const existing = stateDb.db.prepare(
    'SELECT target FROM note_links WHERE note_path = ?'
  );
  const tx = stateDb.db.transaction(() => {
    // Insert new links (existing rows untouched due to OR IGNORE)
    for (const target of currentLinks) {
      ins.run(notePath, target);
    }
    // Remove orphaned links no longer in current set
    const rows = existing.all(notePath) as Array<{ target: string }>;
    for (const row of rows) {
      if (!currentLinks.has(row.target)) {
        del.run(notePath, row.target);
      }
    }
  });
  tx();
}

/** Compute link additions and removals between previous and current */
export function diffNoteLinks(
  previous: Set<string>,
  current: Set<string>,
): { added: string[]; removed: string[] } {
  return {
    added: [...current].filter(l => !previous.has(l)),
    removed: [...previous].filter(l => !current.has(l)),
  };
}

/** Get previously stored tags for a note */
export function getStoredNoteTags(stateDb: StateDb, notePath: string): Set<string> {
  const rows = stateDb.db.prepare(
    'SELECT tag FROM note_tags WHERE note_path = ?'
  ).all(notePath) as Array<{ tag: string }>;
  return new Set(rows.map(r => r.tag));
}

/** Replace stored tags for a note with current set */
export function updateStoredNoteTags(
  stateDb: StateDb,
  notePath: string,
  currentTags: Set<string>,
): void {
  const del = stateDb.db.prepare('DELETE FROM note_tags WHERE note_path = ?');
  const ins = stateDb.db.prepare('INSERT INTO note_tags (note_path, tag) VALUES (?, ?)');
  const tx = stateDb.db.transaction(() => {
    del.run(notePath);
    for (const tag of currentTags) {
      ins.run(notePath, tag);
    }
  });
  tx();
}

/**
 * Detect removed auto-applied wikilinks and record implicit negative feedback
 *
 * Compares tracked applications against current content wikilinks.
 * For each tracked entity whose [[wikilink]] is no longer in the note,
 * records implicit:removed feedback and marks application as removed.
 *
 * @returns List of removed entity names
 */
export function processImplicitFeedback(
  stateDb: StateDb,
  notePath: string,
  currentContent: string,
): string[] {
  const trackedWithTime = getTrackedApplicationsWithTime(stateDb, notePath);
  if (trackedWithTime.length === 0) return [];

  const currentLinks = extractLinkedEntities(currentContent);
  const removed: string[] = [];

  const markRemoved = stateDb.db.prepare(
    `UPDATE wikilink_applications SET status = 'removed' WHERE entity = ? AND note_path = ?`
  );

  const transaction = stateDb.db.transaction(() => {
    for (const { entity, applied_at } of trackedWithTime) {
      if (!currentLinks.has(entity.toLowerCase())) {
        const confidence = computeImplicitRemovalConfidence(applied_at);
        recordFeedback(stateDb, entity, 'implicit:removed', notePath, false, confidence);
        markRemoved.run(entity, notePath);
        removed.push(entity);
      }
    }
  });

  transaction();

  if (removed.length > 0) {
    updateSuppressionList(stateDb);
  }

  // Survival tracking: entities still present get positive signal (24h cooldown)
  const SURVIVAL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
  const getLastSurvival = stateDb.db.prepare(
    `SELECT MAX(created_at) as last FROM wikilink_feedback
     WHERE entity = ? COLLATE NOCASE AND context = 'implicit:survived' AND note_path = ?`
  );

  for (const { entity } of trackedWithTime) {
    if (currentLinks.has(entity.toLowerCase())) {
      const lastSurvival = getLastSurvival.get(entity, notePath) as { last: string | null } | undefined;
      const lastAt = lastSurvival?.last ? new Date(lastSurvival.last).getTime() : 0;
      if (Date.now() - lastAt > SURVIVAL_COOLDOWN_MS) {
        recordFeedback(stateDb, entity, 'implicit:survived', notePath, true, 0.8);
      }
    }
  }

  return removed;
}

// =============================================================================
// DASHBOARD DATA
// =============================================================================

const TIER_LABELS: ReadonlyArray<{ label: string; boost: number; minAccuracy: number; minSamples: number }> = [
  { label: 'Champion (+10)', boost: 10, minAccuracy: 0.85, minSamples: 5 },
  { label: 'Strong (+6)', boost: 6, minAccuracy: 0.70, minSamples: 3 },
  { label: 'Neutral (0)', boost: 0, minAccuracy: 0.50, minSamples: 3 },
  { label: 'Neutral (0)', boost: 0, minAccuracy: 0.30, minSamples: 3 },
  { label: 'Neutral (0)', boost: 0, minAccuracy: 0, minSamples: 3 },
];

/**
 * Aggregate all feedback data for the dashboard view
 */
export function getDashboardData(stateDb: StateDb): DashboardData {
  // 1. Entity stats + boost tiers
  const entityStats = getEntityStats(stateDb);
  const boostTiers: DashboardData['boost_tiers'] = TIER_LABELS.map(t => ({
    label: t.label,
    boost: t.boost,
    min_accuracy: t.minAccuracy,
    min_samples: t.minSamples,
    entities: [],
  }));
  const learning: DashboardData['learning'] = [];

  for (const es of entityStats) {
    if (es.total < FEEDBACK_BOOST_MIN_SAMPLES) {
      learning.push({ entity: es.entity, accuracy: es.accuracy, total: es.total });
      continue;
    }
    const boost = computeBoostFromAccuracy(es.accuracy, es.total);
    const tierIdx = boostTiers.findIndex(t => t.boost === boost);
    if (tierIdx >= 0) {
      boostTiers[tierIdx].entities.push({ entity: es.entity, accuracy: es.accuracy, total: es.total });
    }
  }

  // 2. Implicit vs explicit sources
  const sourceRows = stateDb.db.prepare(`
    SELECT
      CASE WHEN context LIKE 'implicit:%' THEN 'implicit' ELSE 'explicit' END as source,
      COUNT(*) as count,
      SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as correct_count
    FROM wikilink_feedback
    GROUP BY source
  `).all() as Array<{ source: string; count: number; correct_count: number }>;

  const feedbackSources = {
    explicit: { count: 0, correct: 0 },
    implicit: { count: 0, correct: 0 },
  };
  for (const row of sourceRows) {
    if (row.source === 'implicit') {
      feedbackSources.implicit = { count: row.count, correct: row.correct_count };
    } else {
      feedbackSources.explicit = { count: row.count, correct: row.correct_count };
    }
  }

  // 3. Application tracking
  const appRows = stateDb.db.prepare(
    `SELECT status, COUNT(*) as count FROM wikilink_applications GROUP BY status`
  ).all() as Array<{ status: string; count: number }>;

  const applications = { applied: 0, removed: 0 };
  for (const row of appRows) {
    if (row.status === 'applied') applications.applied = row.count;
    else if (row.status === 'removed') applications.removed = row.count;
  }

  // 4. Recent feedback
  const recent = getFeedback(stateDb, undefined, 50);

  // 5. Suppressed entities
  const suppressed = getSuppressedEntities(stateDb);

  // 6. 30-day timeline
  const timeline = stateDb.db.prepare(`
    SELECT
      date(created_at) as day,
      COUNT(*) as count,
      SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as correct_count,
      SUM(CASE WHEN correct = 0 THEN 1 ELSE 0 END) as incorrect_count
    FROM wikilink_feedback
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY day
    ORDER BY day
  `).all() as Array<{ day: string; count: number; correct_count: number; incorrect_count: number }>;

  // Totals
  const totalFeedback = feedbackSources.explicit.count + feedbackSources.implicit.count;
  const totalCorrect = feedbackSources.explicit.correct + feedbackSources.implicit.correct;
  const totalIncorrect = totalFeedback - totalCorrect;

  return {
    total_feedback: totalFeedback,
    total_correct: totalCorrect,
    total_incorrect: totalIncorrect,
    overall_accuracy: totalFeedback > 0 ? Math.round((totalCorrect / totalFeedback) * 1000) / 1000 : 0,
    total_suppressed: suppressed.length,
    feedback_sources: feedbackSources,
    applications,
    boost_tiers: boostTiers,
    learning,
    suppressed,
    recent,
    timeline: timeline.map(t => ({
      day: t.day,
      count: t.count,
      correct: t.correct_count,
      incorrect: t.incorrect_count,
    })),
  };
}

// =============================================================================
// PIPELINE OBSERVABILITY — Entity Journey & Algorithm Attribution
// =============================================================================

/** Score breakdown per layer (mirrors ScoreBreakdown from types.ts) */
export interface SuggestionBreakdown {
  contentMatch: number;
  cooccurrenceBoost: number;
  typeBoost: number;
  contextBoost: number;
  recencyBoost: number;
  crossFolderBoost: number;
  hubBoost: number;
  feedbackAdjustment: number;
  semanticBoost?: number;
}

/** Recent suggestion event from suggestion_events table */
export interface SuggestionEvent {
  note_path: string;
  timestamp: number;
  total_score: number;
  breakdown: SuggestionBreakdown;
  threshold: number;
  passed: boolean;
  top_contributing_layer: string;
}

/** Complete entity journey through the 5-stage pipeline */
export interface EntityJourney {
  entity: string;
  stages: {
    discover: {
      first_detected: number | null;
      source_notes: string[];
      category: string;
      aliases: string[];
      hub_score: number;
    };
    suggest: {
      total_suggestions: number;
      recent: SuggestionEvent[];
    };
    apply: {
      applied_count: number;
      removed_count: number;
      active: Array<{ note_path: string; applied_at: string }>;
    };
    learn: {
      total_feedback: number;
      correct: number;
      incorrect: number;
      accuracy: number;
      recent: Array<{
        note_path: string;
        correct: boolean;
        context: string;
        timestamp: string;
      }>;
    };
    adapt: {
      boost_tier: string;
      current_boost: number;
      suppressed: boolean;
      suppression_reason?: string;
    };
  };
}

/**
 * Identify the top contributing layer from a score breakdown
 */
function getTopContributingLayer(breakdown: SuggestionBreakdown): string {
  const layers: Array<[string, number]> = [
    ['content_match', breakdown.contentMatch],
    ['cooccurrence', breakdown.cooccurrenceBoost],
    ['type_boost', breakdown.typeBoost],
    ['context_boost', breakdown.contextBoost],
    ['recency', breakdown.recencyBoost],
    ['cross_folder', breakdown.crossFolderBoost],
    ['hub_boost', breakdown.hubBoost],
    ['feedback', breakdown.feedbackAdjustment],
  ];
  if (breakdown.semanticBoost !== undefined) {
    layers.push(['semantic', breakdown.semanticBoost]);
  }

  layers.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const top = layers[0];
  if (!top || top[1] === 0) return 'none';
  const sign = top[1] > 0 ? '+' : '';
  return `${top[0]} (${sign}${top[1].toFixed(1)})`;
}

/**
 * Get the boost tier label for a given accuracy and sample count
 */
function getBoostTierLabel(accuracy: number, sampleCount: number): string {
  if (sampleCount < FEEDBACK_BOOST_MIN_SAMPLES) return 'learning';
  if (accuracy >= 0.95 && sampleCount >= 20) return 'champion';
  if (accuracy >= 0.80) return 'strong';
  if (accuracy >= 0.60) return 'neutral';
  if (accuracy >= 0.40) return 'weak';
  return 'poor';
}

/**
 * Trace an entity's complete journey through the 5-stage pipeline.
 *
 * Queries across: entities, suggestion_events, wikilink_applications,
 * wikilink_feedback, and wikilink_suppressions tables.
 *
 * @param stateDb - State database instance
 * @param entityName - Entity name to trace
 * @param daysBack - Number of days to look back (default: 30)
 */
export function getEntityJourney(
  stateDb: StateDb,
  entityName: string,
  daysBack: number = 30,
): EntityJourney {
  const cutoff = Date.now() - (daysBack * 24 * 60 * 60 * 1000);

  // Stage 1: Discover — entity metadata from entities table
  const entityRow = stateDb.db.prepare(`
    SELECT name, path, category, aliases_json, hub_score
    FROM entities WHERE name_lower = ?
  `).get(entityName.toLowerCase()) as {
    name: string; path: string; category: string;
    aliases_json: string | null; hub_score: number;
  } | undefined;

  const discover = {
    first_detected: null as number | null,
    source_notes: entityRow ? [entityRow.path] : [],
    category: entityRow?.category ?? 'unknown',
    aliases: entityRow?.aliases_json ? JSON.parse(entityRow.aliases_json) : [],
    hub_score: entityRow?.hub_score ?? 0,
  };

  // Stage 2: Suggest — from suggestion_events table
  const suggestionRows = stateDb.db.prepare(`
    SELECT note_path, timestamp, total_score, breakdown_json, threshold, passed
    FROM suggestion_events
    WHERE entity = ? AND timestamp >= ?
    ORDER BY timestamp DESC
    LIMIT 20
  `).all(entityName, cutoff) as Array<{
    note_path: string; timestamp: number; total_score: number;
    breakdown_json: string; threshold: number; passed: number;
  }>;

  const totalSuggestions = stateDb.db.prepare(`
    SELECT COUNT(*) as cnt FROM suggestion_events WHERE entity = ?
  `).get(entityName) as { cnt: number };

  const suggest = {
    total_suggestions: totalSuggestions.cnt,
    recent: suggestionRows.map(r => {
      const breakdown = JSON.parse(r.breakdown_json) as SuggestionBreakdown;
      return {
        note_path: r.note_path,
        timestamp: r.timestamp,
        total_score: r.total_score,
        breakdown,
        threshold: r.threshold,
        passed: r.passed === 1,
        top_contributing_layer: getTopContributingLayer(breakdown),
      };
    }),
  };

  // Stage 3: Apply — from wikilink_applications table
  const appRows = stateDb.db.prepare(`
    SELECT note_path, applied_at, status
    FROM wikilink_applications
    WHERE entity = ?
  `).all(entityName.toLowerCase()) as Array<{
    note_path: string; applied_at: string; status: string;
  }>;

  const apply = {
    applied_count: appRows.filter(r => r.status === 'applied').length,
    removed_count: appRows.filter(r => r.status === 'removed').length,
    active: appRows
      .filter(r => r.status === 'applied')
      .map(r => ({ note_path: r.note_path, applied_at: r.applied_at })),
  };

  // Stage 4: Learn — from wikilink_feedback table
  const feedbackRows = stateDb.db.prepare(`
    SELECT note_path, correct, context, created_at
    FROM wikilink_feedback
    WHERE entity = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).all(entityName) as Array<{
    note_path: string; correct: number; context: string; created_at: string;
  }>;

  const totalFeedback = stateDb.db.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as correct_count
    FROM wikilink_feedback WHERE entity = ?
  `).get(entityName) as { total: number; correct_count: number };

  const learn = {
    total_feedback: totalFeedback.total,
    correct: totalFeedback.correct_count,
    incorrect: totalFeedback.total - totalFeedback.correct_count,
    accuracy: totalFeedback.total > 0
      ? Math.round((totalFeedback.correct_count / totalFeedback.total) * 1000) / 1000
      : 0,
    recent: feedbackRows.map(r => ({
      note_path: r.note_path,
      correct: r.correct === 1,
      context: r.context,
      timestamp: r.created_at,
    })),
  };

  // Stage 5: Adapt — boost tier + suppression from computed values
  const boost = computeBoostFromAccuracy(learn.accuracy, learn.total_feedback);
  const suppressed = isSuppressed(stateDb, entityName);

  let suppressionReason: string | undefined;
  if (suppressed) {
    const suppRow = stateDb.db.prepare(
      'SELECT false_positive_rate FROM wikilink_suppressions WHERE entity = ? COLLATE NOCASE'
    ).get(entityName) as { false_positive_rate: number } | undefined;
    if (suppRow) {
      suppressionReason = `false_positive_rate ${(suppRow.false_positive_rate * 100).toFixed(0)}% exceeds ${(SUPPRESSION_POSTERIOR_THRESHOLD * 100).toFixed(0)}% threshold`;
    }
  }

  const adapt = {
    boost_tier: getBoostTierLabel(learn.accuracy, learn.total_feedback),
    current_boost: boost,
    suppressed,
    suppression_reason: suppressionReason,
  };

  return {
    entity: entityName,
    stages: { discover, suggest, apply, learn, adapt },
  };
}

// =============================================================================
// DEEP OBSERVABILITY APIs (Phase 4)
// =============================================================================

/** Score timeline entry for a single entity */
export interface EntityScoreTimelineEntry {
  timestamp: number;
  score: number;
  breakdown: SuggestionBreakdown;
  notePath: string;
  passed: boolean;
  threshold: number;
}

/** Layer contribution for a time bucket */
export interface LayerContributionBucket {
  bucket: string;
  layers: Record<string, number>;
}

/**
 * 4.1 Get an entity's score timeline from suggestion_events.
 * Returns chronological score history for visualization.
 */
export function getEntityScoreTimeline(
  stateDb: StateDb,
  entityName: string,
  daysBack: number = 30,
  limit: number = 100,
): EntityScoreTimelineEntry[] {
  const cutoff = Date.now() - (daysBack * 24 * 60 * 60 * 1000);

  const rows = stateDb.db.prepare(`
    SELECT timestamp, total_score, breakdown_json, note_path, passed, threshold
    FROM suggestion_events
    WHERE entity = ? AND timestamp >= ?
    ORDER BY timestamp ASC
    LIMIT ?
  `).all(entityName, cutoff, limit) as Array<{
    timestamp: number;
    total_score: number;
    breakdown_json: string;
    note_path: string;
    passed: number;
    threshold: number;
  }>;

  return rows.map(r => ({
    timestamp: r.timestamp,
    score: r.total_score,
    breakdown: JSON.parse(r.breakdown_json) as SuggestionBreakdown,
    notePath: r.note_path,
    passed: r.passed === 1,
    threshold: r.threshold,
  }));
}

/**
 * 4.3 Get per-layer contribution averages bucketed by day or week.
 * Aggregates breakdown_json from suggestion_events.
 */
export function getLayerContributionTimeseries(
  stateDb: StateDb,
  granularity: 'day' | 'week' = 'day',
  daysBack: number = 30,
): LayerContributionBucket[] {
  const cutoff = Date.now() - (daysBack * 24 * 60 * 60 * 1000);

  const rows = stateDb.db.prepare(`
    SELECT timestamp, breakdown_json
    FROM suggestion_events
    WHERE timestamp >= ?
    ORDER BY timestamp ASC
  `).all(cutoff) as Array<{ timestamp: number; breakdown_json: string }>;

  // Group by bucket
  const buckets = new Map<string, { count: number; layers: Record<string, number> }>();

  for (const row of rows) {
    const date = new Date(row.timestamp);
    let bucket: string;
    if (granularity === 'week') {
      // ISO week: YYYY-Www
      const jan4 = new Date(date.getFullYear(), 0, 4);
      const weekNum = Math.ceil(((date.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7);
      bucket = `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
    } else {
      bucket = date.toISOString().slice(0, 10);
    }

    if (!buckets.has(bucket)) {
      buckets.set(bucket, { count: 0, layers: {} });
    }
    const acc = buckets.get(bucket)!;
    acc.count++;

    const breakdown = JSON.parse(row.breakdown_json) as SuggestionBreakdown;
    const layerMap: Record<string, number> = {
      contentMatch: breakdown.contentMatch,
      cooccurrenceBoost: breakdown.cooccurrenceBoost,
      typeBoost: breakdown.typeBoost,
      contextBoost: breakdown.contextBoost,
      recencyBoost: breakdown.recencyBoost,
      crossFolderBoost: breakdown.crossFolderBoost,
      hubBoost: breakdown.hubBoost,
      feedbackAdjustment: breakdown.feedbackAdjustment,
    };
    if (breakdown.semanticBoost !== undefined) {
      layerMap.semanticBoost = breakdown.semanticBoost;
    }

    for (const [layer, value] of Object.entries(layerMap)) {
      acc.layers[layer] = (acc.layers[layer] ?? 0) + value;
    }
  }

  // Convert sums to averages
  const result: LayerContributionBucket[] = [];
  for (const [bucket, acc] of buckets) {
    const avgLayers: Record<string, number> = {};
    for (const [layer, sum] of Object.entries(acc.layers)) {
      avgLayers[layer] = Math.round((sum / acc.count) * 1000) / 1000;
    }
    result.push({ bucket, layers: avgLayers });
  }

  return result;
}

/**
 * 4.4 Extended dashboard data — additional fields for crank visualization.
 */
export interface ExtendedDashboardData extends DashboardData {
  layerHealth: Array<{
    layer: string;
    status: 'contributing' | 'dormant' | 'zero-data';
    avgContribution: number;
    eventCount: number;
  }>;
  topEntities: Array<{
    entity: string;
    suggestionCount: number;
    avgScore: number;
    passRate: number;
  }>;
  feedbackTrend: Array<{
    day: string;
    count: number;
  }>;
  suppressionChanges: Array<{
    entity: string;
    falsePositiveRate: number;
    updatedAt: string;
  }>;
}

/**
 * Get extended dashboard data with observability fields.
 */
export function getExtendedDashboardData(stateDb: StateDb): ExtendedDashboardData {
  const base = getDashboardData(stateDb);

  // Layer health: analyze recent suggestion_events for per-layer contribution
  const recentCutoff = Date.now() - (7 * 24 * 60 * 60 * 1000); // last 7 days
  const eventRows = stateDb.db.prepare(`
    SELECT breakdown_json FROM suggestion_events WHERE timestamp >= ?
  `).all(recentCutoff) as Array<{ breakdown_json: string }>;

  const layerSums: Record<string, { sum: number; count: number }> = {};
  const LAYER_NAMES = [
    'contentMatch', 'cooccurrenceBoost', 'typeBoost', 'contextBoost',
    'recencyBoost', 'crossFolderBoost', 'hubBoost', 'feedbackAdjustment', 'semanticBoost',
  ];
  for (const name of LAYER_NAMES) {
    layerSums[name] = { sum: 0, count: 0 };
  }

  for (const row of eventRows) {
    const breakdown = JSON.parse(row.breakdown_json) as SuggestionBreakdown;
    for (const name of LAYER_NAMES) {
      const val = (breakdown as unknown as Record<string, number | undefined>)[name];
      if (val !== undefined) {
        layerSums[name].sum += Math.abs(val);
        layerSums[name].count++;
      }
    }
  }

  const layerHealth = LAYER_NAMES.map(layer => {
    const s = layerSums[layer];
    const avg = s.count > 0 ? Math.round((s.sum / s.count) * 1000) / 1000 : 0;
    let status: 'contributing' | 'dormant' | 'zero-data';
    if (s.count === 0) status = 'zero-data';
    else if (avg > 0) status = 'contributing';
    else status = 'dormant';
    return { layer, status, avgContribution: avg, eventCount: s.count };
  });

  // Top entities by suggestion frequency
  const topEntityRows = stateDb.db.prepare(`
    SELECT entity, COUNT(*) as cnt, AVG(total_score) as avg_score,
           SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as pass_rate
    FROM suggestion_events
    GROUP BY entity
    ORDER BY cnt DESC
    LIMIT 10
  `).all() as Array<{ entity: string; cnt: number; avg_score: number; pass_rate: number }>;

  const topEntities = topEntityRows.map(r => ({
    entity: r.entity,
    suggestionCount: r.cnt,
    avgScore: Math.round(r.avg_score * 100) / 100,
    passRate: Math.round(r.pass_rate * 1000) / 1000,
  }));

  // Feedback trend: count per day (last 30 days)
  const feedbackTrendRows = stateDb.db.prepare(`
    SELECT date(created_at) as day, COUNT(*) as count
    FROM wikilink_feedback
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY day
    ORDER BY day
  `).all() as Array<{ day: string; count: number }>;

  const feedbackTrend = feedbackTrendRows.map(r => ({
    day: r.day,
    count: r.count,
  }));

  // Suppression changes: all current suppressions with timestamps
  const suppressionRows = stateDb.db.prepare(`
    SELECT entity, false_positive_rate, updated_at
    FROM wikilink_suppressions
    ORDER BY updated_at DESC
  `).all() as Array<{ entity: string; false_positive_rate: number; updated_at: string }>;

  const suppressionChanges = suppressionRows.map(r => ({
    entity: r.entity,
    falsePositiveRate: r.false_positive_rate,
    updatedAt: r.updated_at,
  }));

  return {
    ...base,
    layerHealth,
    topEntities,
    feedbackTrend,
    suppressionChanges,
  };
}

// =============================================================================
// PIPELINE OBSERVABILITY — Action Attribution
// =============================================================================

/**
 * Generate a human-readable reason string explaining an action in the pipeline.
 *
 * Used for algorithm attribution in the observability UI and PROVE-IT.md.
 */
export function formatActionReason(
  action: 'discovered' | 'suggested' | 'filtered' | 'applied' | 'feedback_positive' | 'feedback_negative' | 'boosted' | 'suppressed',
  details: {
    entity?: string;
    sourcePath?: string;
    category?: string;
    aliases?: string[];
    score?: number;
    threshold?: number;
    breakdown?: SuggestionBreakdown;
    strictness?: string;
    notePath?: string;
    accuracy?: number;
    sampleCount?: number;
    tier?: string;
    falsePositiveRate?: number;
  },
): string {
  switch (action) {
    case 'discovered': {
      const aliasStr = details.aliases?.length
        ? `, aliases: [${details.aliases.map(a => `"${a}"`).join(', ')}]`
        : '';
      return `Scanned from \`${details.sourcePath}\` (type: ${details.category}${aliasStr})`;
    }
    case 'suggested': {
      const parts: string[] = [];
      if (details.breakdown) {
        const b = details.breakdown;
        if (b.contentMatch > 0) parts.push(`content_match +${b.contentMatch}`);
        if (b.cooccurrenceBoost > 0) parts.push(`cooccurrence +${b.cooccurrenceBoost}`);
        if (b.typeBoost > 0) parts.push(`type_boost +${b.typeBoost}`);
        if (b.contextBoost > 0) parts.push(`context_boost +${b.contextBoost}`);
        if (b.recencyBoost > 0) parts.push(`recency +${b.recencyBoost}`);
        if (b.crossFolderBoost > 0) parts.push(`cross_folder +${b.crossFolderBoost}`);
        if (b.hubBoost > 0) parts.push(`hub_boost +${b.hubBoost}`);
        if (b.feedbackAdjustment !== 0) parts.push(`feedback ${b.feedbackAdjustment > 0 ? '+' : ''}${b.feedbackAdjustment}`);
        if (b.semanticBoost && b.semanticBoost > 0) parts.push(`semantic +${b.semanticBoost.toFixed(1)}`);
      }
      return `Score ${details.score?.toFixed(1)} (threshold ${details.threshold}, ${details.strictness}): ${parts.join(', ')}`;
    }
    case 'filtered': {
      const topLayer = details.breakdown ? getTopContributingLayer(details.breakdown) : 'unknown';
      return `Score ${details.score?.toFixed(1)} below threshold ${details.threshold} (${details.strictness}). Top layer: ${topLayer}`;
    }
    case 'applied':
      return `Applied wikilink [[${details.entity}]] to \`${details.notePath}\``;
    case 'feedback_positive':
      return `Link retained in \`${details.notePath}\` → implicit positive feedback`;
    case 'feedback_negative':
      return `Link [[${details.entity}]] removed from \`${details.notePath}\` → implicit negative feedback`;
    case 'boosted':
      return `Entity accuracy ${((details.accuracy ?? 0) * 100).toFixed(0)}% over ${details.sampleCount} samples → ${details.tier} tier → ${details.breakdown?.feedbackAdjustment ?? 0 > 0 ? '+' : ''}${details.breakdown?.feedbackAdjustment ?? 0} boost`;
    case 'suppressed':
      return `Entity accuracy ${((details.accuracy ?? 0) * 100).toFixed(0)}% (FP ${((details.falsePositiveRate ?? 0) * 100).toFixed(0)}%) → suppressed (posterior < ${(SUPPRESSION_POSTERIOR_THRESHOLD * 100).toFixed(0)}%)`;
    default:
      return `Unknown action: ${action}`;
  }
}
