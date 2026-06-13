/**
 * Wikilink Feedback & Suppression
 *
 * Tracks accuracy of auto-wikilink suggestions and suppresses
 * entities with high false positive rates.
 *
 * Module layout (arch-review G5/F4):
 *   - wikilinkFeedbackStore.ts   — SQL repository (all db.prepare sites)
 *   - wikilinkFeedbackReports.ts — dashboard/journey/timeline assembly
 *   - this file                  — Bayesian posterior math, suppression
 *     thresholds, boost tiers, implicit feedback; facades the store and
 *     reports modules so the public surface is unchanged.
 */

import type { StateDb } from '@velvetmonkey/vault-core';
import { extractLinkedEntities } from './wikilinkText.js';
import {
  insertFeedback,
  getEntityFeedbackCounts,
  getAllFeedbackRows,
  getFolderFeedbackRows,
  getEntityFeedbackOutcomes,
  getAliasFeedbackRowsOrdered,
  getAliasFeedbackRows,
  getLastImplicitRemovedAt,
  getLastImplicitSurvivedAt,
  upsertSuppression,
  deleteSuppression,
  deleteExpiredSuppressions,
  forceSuppression,
  deleteSuppressionNocase,
  getActiveSuppression,
  getActiveSuppressions,
  deleteSuppressionOverride,
  insertSuppressionOverride,
  getSuppressionOverrides,
  hasSuppressionOverride,
  upsertApplication,
  lookupCanonicalEntity,
  getTrackedApplicationsWithTime,
  markApplicationRemoved,
  type AliasFeedbackRow,
  type FeedbackEntry,
  type EntityStats,
  type WikilinkApplicationSource,
} from './wikilinkFeedbackStore.js';
import { createFeedbackReporting, type DashboardData } from './wikilinkFeedbackReports.js';

// =============================================================================
// FACADE RE-EXPORTS (public surface preserved — see module layout above)
// =============================================================================

export type { WikilinkApplicationSource, FeedbackEntry, EntityStats } from './wikilinkFeedbackStore.js';
export {
  getFeedback,
  getSuppressionOverrides,
  getSuppressedCount,
  getSuppressedEntities,
  getTrackedApplications,
  getStoredNoteLinks,
  getStoredNoteTags,
  replaceNoteLinks as updateStoredNoteLinks,
  replaceNoteTags as updateStoredNoteTags,
} from './wikilinkFeedbackStore.js';
export type {
  DashboardData,
  SuggestionBreakdown,
  SuggestionEvent,
  EntityJourney,
  EntityScoreTimelineEntry,
  LayerContributionBucket,
  ExtendedDashboardData,
} from './wikilinkFeedbackReports.js';
export {
  extractFolder,
  getEntityFolderAccuracy,
  getEntityScoreTimeline,
  getLayerContributionTimeseries,
} from './wikilinkFeedbackReports.js';

// =============================================================================
// TYPES
// =============================================================================

export interface FeedbackResult {
  mode: 'report' | 'list' | 'stats' | 'dashboard' | 'entity_timeline' | 'layer_timeseries' | 'snapshot_diff';
  reported?: { entity: string; correct: boolean; suppression_updated: boolean };
  entries?: FeedbackEntry[];
  stats?: EntityStats[];
  total_feedback?: number;
  total_suppressed?: number;
  dashboard?: DashboardData;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Beta-Binomial prior parameters (benefit of doubt: Beta(4,1) → 80% prior mean) */
export const PRIOR_ALPHA = 4;   // Prior "correct" observations (moderate noise resistance)
export const PRIOR_BETA = 1;    // Prior "incorrect" observations

/** Posterior mean threshold for suppression (suppress when posteriorMean < this) */
export const SUPPRESSION_POSTERIOR_THRESHOLD = 0.45;

/** Minimum total posterior observations (alpha + beta) before considering suppression */
export const SUPPRESSION_MIN_OBSERVATIONS = 15;

/** Maximum suppression penalty (strongly demotes but allows excellent content matches to survive) */
const MAX_SUPPRESSION_PENALTY = -15;

/** Soft penalty for borderline entities (posterior between suppression and soft threshold) */
const SOFT_PENALTY_THRESHOLD = 0.55;
const SOFT_PENALTY = -5;

/**
 * Known AI platform config filenames. These are tool configuration files,
 * not knowledge entities — structurally unlikely to be good wikilink targets.
 * Matched case-insensitively against entity names.
 */
export const AI_CONFIG_PATTERNS: ReadonlyArray<string> = [
  'claude.md',
  'cursor.md',
  '.cursorrules',
  'copilot-instructions.md',
  'agents.md',
  '.windsurfrules',
  '.aiderignore',
  '.aider.conf.yml',
  'cline_docs',
  'codex.md',
];

/** Weaker prior for AI config file entities (suppresses faster) */
export const AI_CONFIG_PRIOR_ALPHA = 2;

/** Check if an entity name matches a known AI platform config file */
export function isAiConfigEntity(entityName: string): boolean {
  const lower = entityName.toLowerCase();
  return AI_CONFIG_PATTERNS.some(p => lower === p || lower.endsWith('/' + p));
}

/** Get the effective prior alpha for an entity (lower for AI config files) */
function getEffectiveAlpha(entity: string): number {
  return isAiConfigEntity(entity) ? AI_CONFIG_PRIOR_ALPHA : PRIOR_ALPHA;
}

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
 *   alpha = priorAlpha + weightedCorrect
 *   beta = priorBeta + weightedFp
 * Returns the probability that the entity is correct (higher = better).
 */
export function computePosteriorMean(
  weightedCorrect: number,
  weightedFp: number,
  priorAlpha: number = PRIOR_ALPHA,
  priorBeta: number = PRIOR_BETA,
): number {
  const alpha = priorAlpha + weightedCorrect;
  const beta_ = priorBeta + weightedFp;
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
  matchedTerm?: string,
): void {
  try {
    console.error(`[Flywheel] recordFeedback: entity="${entity}" term="${matchedTerm ?? entity}" context="${context}" notePath="${notePath}" correct=${correct}`);
    const lastInsertRowid = insertFeedback(stateDb, entity, context, notePath, correct, confidence, matchedTerm ?? null);
    console.error(`[Flywheel] recordFeedback: inserted id=${lastInsertRowid}`);
  } catch (e) {
    console.error(`[Flywheel] recordFeedback failed for entity="${entity}": ${e}`);
    throw e;
  }
}

/**
 * Compute accuracy stats per entity
 */
export function getEntityStats(stateDb: StateDb): EntityStats[] {
  const rows = getEntityFeedbackCounts(stateDb);

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
  const rows = getAllFeedbackRows(stateDb);

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
  const rows = getFolderFeedbackRows(stateDb, entity, folder);

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
  // Manually-unsuppressed entities are never re-suppressed by the recompute.
  const overrides = getSuppressionOverrides(stateDb);

  let updated = 0;

  const transaction = stateDb.db.transaction(() => {
    // Remove expired suppressions so entities get re-evaluated
    deleteExpiredSuppressions(stateDb, SUPPRESSION_TTL_DAYS);

    for (const stat of weightedStats) {
      // Manual override wins: ensure no suppression row, never re-suppress.
      if (overrides.has(stat.entity.toLowerCase())) {
        deleteSuppression(stateDb, stat.entity);
        continue;
      }
      const effectiveAlpha = getEffectiveAlpha(stat.entity);
      const posteriorMean = computePosteriorMean(stat.weightedCorrect, stat.weightedFp, effectiveAlpha);
      const totalObs = effectiveAlpha + stat.weightedCorrect + PRIOR_BETA + stat.weightedFp;

      // Don't touch entities without enough observations
      if (totalObs < SUPPRESSION_MIN_OBSERVATIONS) {
        continue;
      }

      if (posteriorMean < SUPPRESSION_POSTERIOR_THRESHOLD) {
        // Store 1 - posteriorMean for backward compat (higher = worse)
        upsertSuppression(stateDb, stat.entity, 1 - posteriorMean);
        updated++;
      } else {
        // Remove from suppression if posterior recovered above threshold
        deleteSuppression(stateDb, stat.entity);
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
  // Explicit suppress clears any manual override (the user is deliberately
  // putting the entity back under auto-suppression control) and force-suppresses.
  const txn = stateDb.db.transaction(() => {
    deleteSuppressionOverride(stateDb, entity);
    forceSuppression(stateDb, entity);
  });
  txn();
}

/**
 * Remove an entity from the suppression list.
 * Returns true if the entity was actually suppressed (and is now removed).
 */
export function unsuppressEntity(stateDb: StateDb, entity: string): boolean {
  // One transaction: clear the suppression row AND record a durable manual
  // override. The override is what makes the unsuppress STICK — without it the
  // next updateSuppressionList() recompute re-derives suppression from the
  // unchanged feedback history. Honored in updateSuppressionList / isSuppressed
  // / getAllSuppressionPenalties so the entity is never auto-suppressed again
  // until an explicit re-suppress (which clears the override).
  const txn = stateDb.db.transaction(() => {
    const changes = deleteSuppressionNocase(stateDb, entity);
    insertSuppressionOverride(stateDb, entity);
    return changes > 0;
  });
  return txn();
}

/**
 * Check if an entity is currently suppressed
 * @param folder - Optional folder for context-stratified suppression
 * @param now - Optional reference date for testability (decay computation)
 */
export function isSuppressed(stateDb: StateDb, entity: string, folder?: string, now?: Date): boolean {
  // Manual override always wins — never report a user-unsuppressed entity as
  // suppressed (covers the folder-posterior path below too).
  if (hasSuppressionOverride(stateDb, entity)) return false;

  // Global suppression check first (with TTL)
  const row = getActiveSuppression(stateDb, entity, SUPPRESSION_TTL_DAYS);
  if (row) return true;

  // Folder-specific suppression: use Beta-Binomial posterior
  if (folder !== undefined) {
    const stats = getWeightedFolderStats(stateDb, entity, folder, now);
    if (stats.rawTotal >= FOLDER_SUPPRESSION_MIN_COUNT) {
      const folderCorrect = stats.weightedTotal - stats.weightedFp;
      const effectiveAlpha = getEffectiveAlpha(entity);
      const posteriorMean = computePosteriorMean(folderCorrect, stats.weightedFp, effectiveAlpha);
      const totalObs = effectiveAlpha + folderCorrect + PRIOR_BETA + stats.weightedFp;
      if (totalObs >= SUPPRESSION_MIN_OBSERVATIONS && posteriorMean < SUPPRESSION_POSTERIOR_THRESHOLD) {
        return true;
      }
    }
  }

  return false;
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
  const rows = getEntityFeedbackOutcomes(stateDb, entity);

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
 * Map a Beta-Binomial posterior mean to a soft/proportional penalty.
 * Below the suppression threshold the penalty is proportional to confidence:
 * barely suppressed → ~0, fully bad (0.0) → MAX_SUPPRESSION_PENALTY.
 * Borderline posteriors get the flat SOFT_PENALTY (mild demotion); anything
 * healthier maps to 0 (no penalty).
 */
function posteriorPenalty(posteriorMean: number): number {
  if (posteriorMean < SUPPRESSION_POSTERIOR_THRESHOLD) {
    return Math.round(MAX_SUPPRESSION_PENALTY * (1 - posteriorMean / SUPPRESSION_POSTERIOR_THRESHOLD));
  }
  if (posteriorMean < SOFT_PENALTY_THRESHOLD) {
    return SOFT_PENALTY;
  }
  return 0;
}

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
  // Manually-unsuppressed entities get NO soft/hard penalty — else suggestion
  // ranking would still demote them while the cockpit badge says unsuppressed.
  const overrides = getSuppressionOverrides(stateDb);

  for (const stat of weightedStats) {
    if (overrides.has(stat.entity.toLowerCase())) continue;
    const effectiveAlpha = getEffectiveAlpha(stat.entity);
    const posteriorMean = computePosteriorMean(stat.weightedCorrect, stat.weightedFp, effectiveAlpha);
    const totalObs = effectiveAlpha + stat.weightedCorrect + PRIOR_BETA + stat.weightedFp;

    if (totalObs >= SUPPRESSION_MIN_OBSERVATIONS) {
      const penalty = posteriorPenalty(posteriorMean);
      if (penalty < 0) {
        penalties.set(stat.entity, penalty);
      }
    }
  }

  // Also include explicitly suppressed entities from the table
  // (may not have feedback data, e.g., user manually suppressed via suppressEntity())
  const rows = getActiveSuppressions(stateDb, SUPPRESSION_TTL_DAYS);

  for (const row of rows) {
    if (overrides.has(row.entity.toLowerCase())) continue;
    if (!penalties.has(row.entity)) {
      penalties.set(row.entity, MAX_SUPPRESSION_PENALTY);
    }
  }

  return penalties;
}

/** Accumulate decay-weighted stats per (entityLower||termLower) alias pair. */
function accumulateAliasStats(
  rows: AliasFeedbackRow[],
  now?: Date,
): Map<string, { weightedCorrect: number; weightedFp: number; entity: string; term: string }> {
  const acc = new Map<string, { weightedCorrect: number; weightedFp: number; entity: string; term: string }>();
  for (const row of rows) {
    const key = `${row.entity.toLowerCase()}||${row.matched_term.toLowerCase()}`;
    if (!acc.has(key)) {
      acc.set(key, { weightedCorrect: 0, weightedFp: 0, entity: row.entity, term: row.matched_term });
    }
    const stats = acc.get(key)!;
    const weight = computeFeedbackWeight(row.created_at, now) * (row.confidence ?? 1.0);
    if (row.correct === 1) stats.weightedCorrect += weight;
    else stats.weightedFp += weight;
  }
  return acc;
}

/**
 * Get per-alias suppression penalties.
 *
 * Returns penalties keyed by "entity||matchedTerm" for aliases that have
 * individually poor accuracy even when the entity overall is fine.
 * Example: Hera via name "Hera" = 95% (no penalty), Hera via alias "Hero" = 20% (suppressed).
 *
 * Only returns entries where matched_term is non-null and differs from entity name.
 * Entity-level penalties are still returned by getAllSuppressionPenalties().
 */
export function getPerAliasPenalties(stateDb: StateDb, now?: Date): Map<string, number> {
  const penalties = new Map<string, number>();

  // Accumulate stats per (entity, matched_term) pair
  const acc = accumulateAliasStats(getAliasFeedbackRowsOrdered(stateDb), now);

  for (const [key, stats] of acc) {
    // Skip if matched_term IS the entity name (handled by entity-level penalties)
    if (stats.entity.toLowerCase() === stats.term.toLowerCase()) continue;

    const effectiveAlpha = getEffectiveAlpha(stats.entity);
    const posteriorMean = computePosteriorMean(stats.weightedCorrect, stats.weightedFp, effectiveAlpha);
    const totalObs = effectiveAlpha + stats.weightedCorrect + PRIOR_BETA + stats.weightedFp;

    if (totalObs >= SUPPRESSION_MIN_OBSERVATIONS) {
      const penalty = posteriorPenalty(posteriorMean);
      if (penalty < 0) {
        penalties.set(key, penalty);
      }
    }
  }

  return penalties;
}

/**
 * Per-alias SUPPRESSION set: (entity, term) pairs whose posterior accuracy
 * fell below the suppression threshold with enough observations — exact
 * mirror of entity-level isSuppressed() semantics, but scoped to one alias
 * so a single bad handle can't poison the whole entity. Keys are
 * `entityLower||termLower` (same key shape as getPerAliasPenalties).
 */
export function getSuppressedAliasTerms(stateDb: StateDb, now?: Date): Set<string> {
  const suppressed = new Set<string>();

  const acc = accumulateAliasStats(getAliasFeedbackRows(stateDb), now);

  for (const [key, stats] of acc) {
    if (stats.entity.toLowerCase() === stats.term.toLowerCase()) continue; // entity-level handles this
    const effectiveAlpha = getEffectiveAlpha(stats.entity);
    const posteriorMean = computePosteriorMean(stats.weightedCorrect, stats.weightedFp, effectiveAlpha);
    const totalObs = effectiveAlpha + stats.weightedCorrect + PRIOR_BETA + stats.weightedFp;
    if (totalObs >= SUPPRESSION_MIN_OBSERVATIONS && posteriorMean < SUPPRESSION_POSTERIOR_THRESHOLD) {
      suppressed.add(key);
    }
  }

  return suppressed;
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
  entities: string[] | Array<{ entity: string; matchedTerm?: string }>,
  source: WikilinkApplicationSource = 'tool',
): void {
  const transaction = stateDb.db.transaction(() => {
    // Support both string[] (backward compat) and {entity, matchedTerm}[]
    for (const item of entities) {
      const entityName = typeof item === 'string' ? item : item.entity;
      const matchedTerm = typeof item === 'string' ? null : (item.matchedTerm ?? null);
      const canonicalName = lookupCanonicalEntity(stateDb, entityName) ?? entityName;
      upsertApplication(stateDb, canonicalName, notePath, matchedTerm, source);
    }
  });

  transaction();
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

/** 24h per-(entity,note) cooldown for implicit:removed — symmetric with the
 *  implicit:survived cooldown in processImplicitFeedback. */
const IMPLICIT_REMOVED_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Record `implicit:removed` feedback with a 24h per-(entity,note) cooldown.
 *
 * Both implicit-removal writers (this module's processImplicitFeedback and the
 * watcher diff path in core/write/pipeline/steps-linking.ts) route through here. Without
 * the cooldown, a single note's add→remove→re-add link churn casts dozens of
 * negative votes for the same (entity,note) — e.g. 74 rows for one note in one
 * day — which wrongly tips legitimate entities below the suppression threshold.
 * Mirrors the positive-side survival cooldown. Caller supplies `confidence`
 * (each writer keeps its own model). Returns true if a row was recorded.
 */
export function recordImplicitRemoved(
  stateDb: StateDb,
  entity: string,
  notePath: string,
  confidence: number,
  matchedTerm?: string,
): boolean {
  const last = getLastImplicitRemovedAt(stateDb, entity, notePath);
  if (last) {
    // SQLite datetime is 'YYYY-MM-DD HH:MM:SS' (UTC) — normalize for JS parsing.
    const normalized = last.includes('T') ? last : last.replace(' ', 'T') + 'Z';
    if (Date.now() - new Date(normalized).getTime() < IMPLICIT_REMOVED_COOLDOWN_MS) {
      return false;
    }
  }
  recordFeedback(stateDb, entity, 'implicit:removed', notePath, false, confidence, matchedTerm);
  return true;
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

  const transaction = stateDb.db.transaction(() => {
    for (const { entity, applied_at, matched_term } of trackedWithTime) {
      if (!currentLinks.has(entity.toLowerCase())) {
        const confidence = computeImplicitRemovalConfidence(applied_at);
        // Cooldown-guarded — collapses same-(entity,note) churn to one vote/24h.
        recordImplicitRemoved(stateDb, entity, notePath, confidence, matched_term ?? undefined);
        markApplicationRemoved(stateDb, entity, notePath);
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

  for (const { entity, matched_term } of trackedWithTime) {
    if (currentLinks.has(entity.toLowerCase())) {
      const lastSurvival = getLastImplicitSurvivedAt(stateDb, entity, notePath);
      const lastAt = lastSurvival ? new Date(lastSurvival).getTime() : 0;
      if (Date.now() - lastAt > SURVIVAL_COOLDOWN_MS) {
        recordFeedback(stateDb, entity, 'implicit:survived', notePath, true, 0.8, matched_term ?? undefined);
      }
    }
  }

  return removed;
}

// =============================================================================
// DASHBOARD & PIPELINE OBSERVABILITY (assembly in wikilinkFeedbackReports.ts)
// =============================================================================

// The report assembly needs this module's domain hooks (entity stats,
// suppression check, boost tiers, thresholds), so the functions are bound
// here via dependency injection — keeping the import graph acyclic
// (wikilinkFeedback → wikilinkFeedbackReports → wikilinkFeedbackStore).
const reporting = createFeedbackReporting({
  getEntityStats,
  isSuppressed,
  computeBoostFromAccuracy,
  feedbackBoostMinSamples: FEEDBACK_BOOST_MIN_SAMPLES,
  suppressionPosteriorThreshold: SUPPRESSION_POSTERIOR_THRESHOLD,
});

/** Aggregate all feedback data for the dashboard view */
export const getDashboardData = reporting.getDashboardData;

/** Trace an entity's complete journey through the 5-stage pipeline */
export const getEntityJourney = reporting.getEntityJourney;

/** Get extended dashboard data with observability fields */
export const getExtendedDashboardData = reporting.getExtendedDashboardData;

/** Generate a human-readable reason string for pipeline action attribution */
export const formatActionReason = reporting.formatActionReason;
