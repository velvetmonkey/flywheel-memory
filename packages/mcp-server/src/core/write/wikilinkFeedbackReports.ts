/**
 * Wikilink Feedback Reports
 *
 * Dashboard / observability assembly consumed by the link tool:
 * dashboard data, entity journey, score timeline, layer timeseries,
 * extended dashboard, and action attribution formatting.
 *
 * Layering: this module reads ONLY from wikilinkFeedbackStore.ts (SQL
 * repository). The few domain hooks it needs (entity stats, suppression
 * check, boost tiers, thresholds) are injected via createFeedbackReporting()
 * by wikilinkFeedback.ts, which re-exports the bound functions — keeping the
 * import graph acyclic (wikilinkFeedback → reports → store).
 */

import type { StateDb } from '@velvetmonkey/vault-core';
import {
  getFeedback,
  getSuppressedEntities,
  getFeedbackEntityPathRows,
  getFeedbackSourceCounts,
  getApplicationStatusCounts,
  getFeedbackDailyTimeline,
  getEntityRecord,
  getRecentSuggestionEvents,
  countSuggestionEvents,
  getApplicationsForEntity,
  getRecentEntityFeedback,
  getEntityFeedbackTotals,
  getSuppressionFalsePositiveRate,
  getEntityScoreTimelineRows,
  getSuggestionBreakdownsSince,
  getBreakdownJsonSince,
  getTopSuggestedEntities,
  getFeedbackTrendDaily,
  getSuppressionRowsByUpdatedAt,
  type FeedbackEntry,
  type EntityStats,
} from './wikilinkFeedbackStore.js';

// =============================================================================
// TYPES
// =============================================================================

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

/** Score breakdown per layer (mirrors ScoreBreakdown from types.ts) */
export interface SuggestionBreakdown {
  contentMatch: number;
  fuzzyMatch: number;
  cooccurrenceBoost: number;
  rarityAdjustment: number;
  typeBoost: number;
  contextBoost: number;
  recencyBoost: number;
  crossFolderBoost: number;
  hubBoost: number;
  feedbackAdjustment: number;
  semanticBoost?: number;
  edgeWeightBoost?: number;
  prospectBoost?: number;
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
 * Domain hooks injected by wikilinkFeedback.ts. Keeps the Bayesian
 * posterior / threshold logic in wikilinkFeedback.ts while this module
 * stays import-cycle-free (it never imports wikilinkFeedback).
 */
export interface FeedbackReportingDeps {
  /** Per-entity accuracy stats including the suppression flag. */
  getEntityStats: (stateDb: StateDb) => EntityStats[];
  /** Entity-level suppression check (Beta-Binomial posterior thresholds). */
  isSuppressed: (stateDb: StateDb, entity: string, folder?: string, now?: Date) => boolean;
  /** Boost tier lookup from accuracy + sample count. */
  computeBoostFromAccuracy: (accuracy: number, sampleCount: number) => number;
  /** Minimum feedback entries before applying feedback boost. */
  feedbackBoostMinSamples: number;
  /** Posterior mean threshold for suppression. */
  suppressionPosteriorThreshold: number;
}

// =============================================================================
// HELPERS
// =============================================================================

const TIER_LABELS: ReadonlyArray<{ label: string; boost: number; minAccuracy: number; minSamples: number }> = [
  { label: 'Champion (+10)', boost: 10, minAccuracy: 0.85, minSamples: 5 },
  { label: 'Strong (+6)', boost: 6, minAccuracy: 0.70, minSamples: 3 },
  { label: 'Neutral (0)', boost: 0, minAccuracy: 0.50, minSamples: 3 },
  { label: 'Neutral (0)', boost: 0, minAccuracy: 0.30, minSamples: 3 },
  { label: 'Neutral (0)', boost: 0, minAccuracy: 0, minSamples: 3 },
];

/**
 * Identify the top contributing layer from a score breakdown
 */
function getTopContributingLayer(breakdown: SuggestionBreakdown): string {
  const layers: Array<[string, number]> = [
    ['content_match', breakdown.contentMatch],
    ['fuzzy_match', breakdown.fuzzyMatch ?? 0],
    ['cooccurrence', breakdown.cooccurrenceBoost],
    ['rarity', breakdown.rarityAdjustment ?? 0],
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
function getBoostTierLabel(accuracy: number, sampleCount: number, minSamples: number): string {
  if (sampleCount < minSamples) return 'learning';
  if (accuracy >= 0.95 && sampleCount >= 20) return 'champion';
  if (accuracy >= 0.80) return 'strong';
  if (accuracy >= 0.60) return 'neutral';
  if (accuracy >= 0.40) return 'weak';
  return 'poor';
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
  const rows = getFeedbackEntityPathRows(stateDb);

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
// STANDALONE OBSERVABILITY APIs (store-only dependencies)
// =============================================================================

/**
 * 4.1 Get an entity's score timeline from suggestion_events.
 * Aggregates by day — returns the max-scoring event per day for chart visualization.
 */
export function getEntityScoreTimeline(
  stateDb: StateDb,
  entityName: string,
  daysBack: number = 90,
  limit: number = 90,
): EntityScoreTimelineEntry[] {
  const cutoff = Date.now() - (daysBack * 24 * 60 * 60 * 1000);

  // Get the max-scoring event per day — preserves full entry shape including breakdown
  const rows = getEntityScoreTimelineRows(stateDb, entityName, cutoff, limit);

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

  const rows = getSuggestionBreakdownsSince(stateDb, cutoff);

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
      fuzzyMatch: breakdown.fuzzyMatch ?? 0,
      cooccurrenceBoost: breakdown.cooccurrenceBoost,
      rarityAdjustment: breakdown.rarityAdjustment ?? 0,
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

// =============================================================================
// DOMAIN-DEPENDENT REPORTS (bound by wikilinkFeedback.ts)
// =============================================================================

/**
 * Build the report functions that need domain hooks (stats, suppression,
 * boost tiers). wikilinkFeedback.ts calls this once at module load and
 * re-exports the result, preserving its public surface.
 */
export function createFeedbackReporting(deps: FeedbackReportingDeps): {
  getDashboardData: (stateDb: StateDb) => DashboardData;
  getEntityJourney: (stateDb: StateDb, entityName: string, daysBack?: number) => EntityJourney;
  getExtendedDashboardData: (stateDb: StateDb) => ExtendedDashboardData;
  formatActionReason: (
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
  ) => string;
} {
  /**
   * Aggregate all feedback data for the dashboard view
   */
  function getDashboardData(stateDb: StateDb): DashboardData {
    // 1. Entity stats + boost tiers
    const entityStats = deps.getEntityStats(stateDb);
    const boostTiers: DashboardData['boost_tiers'] = TIER_LABELS.map(t => ({
      label: t.label,
      boost: t.boost,
      min_accuracy: t.minAccuracy,
      min_samples: t.minSamples,
      entities: [],
    }));
    const learning: DashboardData['learning'] = [];

    for (const es of entityStats) {
      if (es.total < deps.feedbackBoostMinSamples) {
        learning.push({ entity: es.entity, accuracy: es.accuracy, total: es.total });
        continue;
      }
      const boost = deps.computeBoostFromAccuracy(es.accuracy, es.total);
      const tierIdx = boostTiers.findIndex(t => t.boost === boost);
      if (tierIdx >= 0) {
        boostTiers[tierIdx].entities.push({ entity: es.entity, accuracy: es.accuracy, total: es.total });
      }
    }

    // 2. Implicit vs explicit sources
    const sourceRows = getFeedbackSourceCounts(stateDb);

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
    const appRows = getApplicationStatusCounts(stateDb);

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
    const timeline = getFeedbackDailyTimeline(stateDb);

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
  function getEntityJourney(
    stateDb: StateDb,
    entityName: string,
    daysBack: number = 30,
  ): EntityJourney {
    const cutoff = Date.now() - (daysBack * 24 * 60 * 60 * 1000);

    // Stage 1: Discover — entity metadata from entities table
    const entityRow = getEntityRecord(stateDb, entityName.toLowerCase());

    const discover = {
      first_detected: null as number | null,
      source_notes: entityRow ? [entityRow.path] : [],
      category: entityRow?.category ?? 'unknown',
      aliases: entityRow?.aliases_json ? JSON.parse(entityRow.aliases_json) : [],
      hub_score: entityRow?.hub_score ?? 0,
    };

    // Stage 2: Suggest — from suggestion_events table
    const suggestionRows = getRecentSuggestionEvents(stateDb, entityName, cutoff);

    const totalSuggestions = countSuggestionEvents(stateDb, entityName);

    const suggest = {
      total_suggestions: totalSuggestions,
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
    const appRows = getApplicationsForEntity(stateDb, entityName.toLowerCase());

    const apply = {
      applied_count: appRows.filter(r => r.status === 'applied').length,
      removed_count: appRows.filter(r => r.status === 'removed').length,
      active: appRows
        .filter(r => r.status === 'applied')
        .map(r => ({ note_path: r.note_path, applied_at: r.applied_at })),
    };

    // Stage 4: Learn — from wikilink_feedback table
    const feedbackRows = getRecentEntityFeedback(stateDb, entityName);

    const totalFeedback = getEntityFeedbackTotals(stateDb, entityName);

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
    const boost = deps.computeBoostFromAccuracy(learn.accuracy, learn.total_feedback);
    const suppressed = deps.isSuppressed(stateDb, entityName);

    let suppressionReason: string | undefined;
    if (suppressed) {
      const fpRate = getSuppressionFalsePositiveRate(stateDb, entityName);
      if (fpRate !== undefined) {
        suppressionReason = `false_positive_rate ${(fpRate * 100).toFixed(0)}% exceeds ${(deps.suppressionPosteriorThreshold * 100).toFixed(0)}% threshold`;
      }
    }

    const adapt = {
      boost_tier: getBoostTierLabel(learn.accuracy, learn.total_feedback, deps.feedbackBoostMinSamples),
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
   * Get extended dashboard data with observability fields.
   */
  function getExtendedDashboardData(stateDb: StateDb): ExtendedDashboardData {
    const base = getDashboardData(stateDb);

    // Layer health: analyze recent suggestion_events for per-layer contribution
    const recentCutoff = Date.now() - (7 * 24 * 60 * 60 * 1000); // last 7 days
    const eventRows = getBreakdownJsonSince(stateDb, recentCutoff);

    const layerSums: Record<string, { sum: number; count: number }> = {};
    const LAYER_NAMES = [
      'contentMatch', 'fuzzyMatch', 'cooccurrenceBoost', 'rarityAdjustment',
      'typeBoost', 'contextBoost', 'recencyBoost', 'crossFolderBoost',
      'hubBoost', 'feedbackAdjustment', 'semanticBoost',
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
    const topEntityRows = getTopSuggestedEntities(stateDb);

    const topEntities = topEntityRows.map(r => ({
      entity: r.entity,
      suggestionCount: r.cnt,
      avgScore: Math.round(r.avg_score * 100) / 100,
      passRate: Math.round(r.pass_rate * 1000) / 1000,
    }));

    // Feedback trend: count per day (last 30 days)
    const feedbackTrendRows = getFeedbackTrendDaily(stateDb);

    const feedbackTrend = feedbackTrendRows.map(r => ({
      day: r.day,
      count: r.count,
    }));

    // Suppression changes: all current suppressions with timestamps
    const suppressionRows = getSuppressionRowsByUpdatedAt(stateDb);

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

  /**
   * Generate a human-readable reason string explaining an action in the pipeline.
   *
   * Used for algorithm attribution in the observability UI.
   */
  function formatActionReason(
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
        return `Entity accuracy ${((details.accuracy ?? 0) * 100).toFixed(0)}% (FP ${((details.falsePositiveRate ?? 0) * 100).toFixed(0)}%) → suppressed (posterior < ${(deps.suppressionPosteriorThreshold * 100).toFixed(0)}%)`;
      default:
        return `Unknown action: ${action}`;
    }
  }

  return { getDashboardData, getEntityJourney, getExtendedDashboardData, formatActionReason };
}
