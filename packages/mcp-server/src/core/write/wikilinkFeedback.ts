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
  mode: 'report' | 'list' | 'stats' | 'dashboard';
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
  suppressed: Array<{ entity: string; false_positive_rate: number }>;
  recent: FeedbackEntry[];
  timeline: Array<{ day: string; count: number; correct: number; incorrect: number }>;
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
      upsert.run(entity.toLowerCase(), notePath);
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
  const tracked = getTrackedApplications(stateDb, notePath);
  if (tracked.length === 0) return [];

  const currentLinks = extractLinkedEntities(currentContent);
  const removed: string[] = [];

  const markRemoved = stateDb.db.prepare(
    `UPDATE wikilink_applications SET status = 'removed' WHERE entity = ? AND note_path = ?`
  );

  const transaction = stateDb.db.transaction(() => {
    for (const entity of tracked) {
      if (!currentLinks.has(entity)) {
        recordFeedback(stateDb, entity, 'implicit:removed', notePath, false);
        markRemoved.run(entity, notePath);
        removed.push(entity);
      }
    }
  });

  transaction();

  return removed;
}

// =============================================================================
// DASHBOARD DATA
// =============================================================================

const TIER_LABELS: ReadonlyArray<{ label: string; boost: number; minAccuracy: number; minSamples: number }> = [
  { label: 'Champion (+5)', boost: 5, minAccuracy: 0.95, minSamples: 20 },
  { label: 'Strong (+2)', boost: 2, minAccuracy: 0.80, minSamples: 5 },
  { label: 'Neutral (0)', boost: 0, minAccuracy: 0.60, minSamples: 5 },
  { label: 'Weak (-2)', boost: -2, minAccuracy: 0.40, minSamples: 5 },
  { label: 'Poor (-4)', boost: -4, minAccuracy: 0, minSamples: 5 },
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
      'SELECT false_positive_rate FROM wikilink_suppressions WHERE entity = ?'
    ).get(entityName) as { false_positive_rate: number } | undefined;
    if (suppRow) {
      suppressionReason = `false_positive_rate ${(suppRow.false_positive_rate * 100).toFixed(0)}% exceeds ${(SUPPRESSION_THRESHOLD * 100).toFixed(0)}% threshold`;
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
      return `Entity accuracy ${((details.accuracy ?? 0) * 100).toFixed(0)}% → suppressed (false_positive_rate ${((details.falsePositiveRate ?? 0) * 100).toFixed(0)}% > ${(SUPPRESSION_THRESHOLD * 100).toFixed(0)}%)`;
    default:
      return `Unknown action: ${action}`;
  }
}
