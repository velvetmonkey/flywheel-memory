/**
 * Calibration Export — flywheel_calibration_export
 *
 * Anonymized aggregate data from the scoring pipeline for cross-vault
 * algorithm calibration. No entity names, note paths, or content.
 */

import type { StateDb } from '@velvetmonkey/vault-core';
import type { FlywheelConfig } from './config.js';
import {
  getWeightedEntityStats,
  computePosteriorMean,
  getSuppressedCount,
} from '../write/wikilinkFeedback.js';
import { hasEmbeddingsIndex } from './embeddings.js';

// =============================================================================
// TYPES
// =============================================================================

export interface CalibrationExport {
  schema_version: 1;
  exported_at: string;
  vault_id?: string;

  vault_profile: {
    size_bucket: string;
    entity_bucket: string;
    avg_links_per_note: number;
    connected_ratio: number;
    semantic_enabled: boolean;
    flywheel_age_days: number;
    strictness_mode: string;
    adaptive_strictness: boolean;
  };

  entity_distribution: Record<string, number>;

  funnel: {
    total_evaluations: number;
    total_applications: number;
    total_survivals: number;
    total_removals: number;
    survival_rate: number | null;
  };

  layer_contributions: {
    averages: Record<string, number>;
    top_contributor_counts: Record<string, number>;
    event_count: number;
  };

  score_distribution: {
    bins: Array<{ min: number; max: number; count: number }>;
    mean_score: number;
    median_score: number;
  };

  survival_by_category: Record<string, {
    applied: number;
    survived: number;
    removed: number;
    survival_rate: number | null;
  }>;

  feedback: {
    total: number;
    explicit_count: number;
    implicit_count: number;
    explicit_accuracy: number | null;
    implicit_accuracy: number | null;
  };

  suppression: {
    entities_suppressed: number;
    entities_with_feedback: number;
    suppression_rate: number | null;
  };

  recency_analysis: {
    avg_recency_when_survived: number;
    avg_recency_when_removed: number;
  };

  cooccurrence_analysis: {
    cooc_only_rate: number;
    cooc_only_survival_rate: number | null;
    avg_cooc_boost: number;
  };

  threshold_analysis: {
    pass_rates_at_thresholds: Array<{ threshold: number; pass_rate: number }>;
  };
}

// =============================================================================
// HELPERS
// =============================================================================

const LAYER_KEYS = [
  'contentMatch', 'cooccurrenceBoost', 'typeBoost', 'contextBoost',
  'recencyBoost', 'crossFolderBoost', 'hubBoost', 'feedbackAdjustment',
  'suppressionPenalty', 'semanticBoost', 'edgeWeightBoost',
];

const THRESHOLD_SWEEP = [5, 8, 10, 12, 15, 18, 20, 25, 30];

function sizeBucket(count: number): string {
  if (count < 50) return 'tiny';
  if (count < 200) return 'small';
  if (count < 1000) return 'medium';
  if (count < 5000) return 'large';
  return 'huge';
}

function round(n: number, decimals: number = 3): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

// =============================================================================
// CORE QUERIES
// =============================================================================

function queryEntityDistribution(stateDb: StateDb): Record<string, number> {
  const rows = stateDb.db.prepare(
    'SELECT category, count(*) as cnt FROM entities GROUP BY category ORDER BY cnt DESC'
  ).all() as Array<{ category: string; cnt: number }>;
  const result: Record<string, number> = {};
  for (const r of rows) result[r.category] = r.cnt;
  return result;
}

function queryFunnel(stateDb: StateDb, startMs: number, startIso: string, endIso: string): CalibrationExport['funnel'] {
  const evalRow = stateDb.db.prepare(
    'SELECT COUNT(*) as total FROM suggestion_events WHERE timestamp >= ?'
  ).get(startMs) as { total: number };

  const appRow = stateDb.db.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN status='applied' THEN 1 ELSE 0 END) as survivals,
      SUM(CASE WHEN status='removed' THEN 1 ELSE 0 END) as removals
    FROM wikilink_applications WHERE applied_at >= ? AND applied_at <= ?
  `).get(startIso, endIso + ' 23:59:59') as { total: number; survivals: number; removals: number };

  return {
    total_evaluations: evalRow.total,
    total_applications: appRow.total,
    total_survivals: appRow.survivals,
    total_removals: appRow.removals,
    survival_rate: appRow.total > 0 ? round(appRow.survivals / appRow.total) : null,
  };
}

function queryLayerContributions(stateDb: StateDb, startMs: number): CalibrationExport['layer_contributions'] {
  const rows = stateDb.db.prepare(
    'SELECT breakdown_json FROM suggestion_events WHERE timestamp >= ?'
  ).all(startMs) as Array<{ breakdown_json: string }>;

  const sums: Record<string, number> = {};
  const topCounts: Record<string, number> = {};
  for (const k of LAYER_KEYS) { sums[k] = 0; topCounts[k] = 0; }

  let count = 0;
  for (const row of rows) {
    let bd: Record<string, number>;
    try { bd = JSON.parse(row.breakdown_json); } catch { continue; }
    count++;

    let topLayer = '';
    let topVal = -Infinity;
    for (const k of LAYER_KEYS) {
      const v = Math.abs(bd[k] ?? 0);
      sums[k] += v;
      if (v > topVal) { topVal = v; topLayer = k; }
    }
    if (topLayer) topCounts[topLayer] = (topCounts[topLayer] || 0) + 1;
  }

  const averages: Record<string, number> = {};
  for (const k of LAYER_KEYS) averages[k] = count > 0 ? round(sums[k] / count) : 0;

  return { averages, top_contributor_counts: topCounts, event_count: count };
}

function queryScoreDistribution(stateDb: StateDb, startMs: number): CalibrationExport['score_distribution'] {
  const rows = stateDb.db.prepare(
    'SELECT total_score FROM suggestion_events WHERE timestamp >= ? ORDER BY total_score'
  ).all(startMs) as Array<{ total_score: number }>;

  // Build 5-point bins: [0-5), [5-10), ..., [45-50), [50+)
  const bins: Array<{ min: number; max: number; count: number }> = [];
  for (let i = 0; i < 50; i += 5) {
    bins.push({ min: i, max: i + 5, count: 0 });
  }
  bins.push({ min: 50, max: Infinity, count: 0 });

  let sum = 0;
  for (const r of rows) {
    sum += r.total_score;
    const binIdx = r.total_score >= 50 ? bins.length - 1 : Math.floor(r.total_score / 5);
    if (binIdx >= 0 && binIdx < bins.length) bins[binIdx].count++;
  }

  const n = rows.length;
  return {
    bins: bins.map(b => ({ min: b.min, max: b.max === Infinity ? 999 : b.max, count: b.count })),
    mean_score: n > 0 ? round(sum / n) : 0,
    median_score: n > 0 ? rows[Math.floor(n / 2)].total_score : 0,
  };
}

function querySurvivalByCategory(stateDb: StateDb, startIso: string, endIso: string): CalibrationExport['survival_by_category'] {
  const rows = stateDb.db.prepare(`
    SELECT e.category,
      COUNT(*) as applied,
      SUM(CASE WHEN wa.status='applied' THEN 1 ELSE 0 END) as survived,
      SUM(CASE WHEN wa.status='removed' THEN 1 ELSE 0 END) as removed
    FROM wikilink_applications wa
    JOIN entities e ON e.name_lower = LOWER(wa.entity)
    WHERE wa.applied_at >= ? AND wa.applied_at <= ?
    GROUP BY e.category
  `).all(startIso, endIso + ' 23:59:59') as Array<{
    category: string; applied: number; survived: number; removed: number;
  }>;

  const result: CalibrationExport['survival_by_category'] = {};
  for (const r of rows) {
    result[r.category] = {
      applied: r.applied,
      survived: r.survived,
      removed: r.removed,
      survival_rate: r.applied > 0 ? round(r.survived / r.applied) : null,
    };
  }
  return result;
}

function queryFeedback(stateDb: StateDb, startIso: string, endIso: string): CalibrationExport['feedback'] {
  // Explicit feedback has confidence >= 0.9, implicit < 0.9
  const row = stateDb.db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN confidence >= 0.9 THEN 1 ELSE 0 END) as explicit_count,
      SUM(CASE WHEN confidence < 0.9 THEN 1 ELSE 0 END) as implicit_count,
      SUM(CASE WHEN confidence >= 0.9 AND correct=1 THEN 1 ELSE 0 END) as explicit_correct,
      SUM(CASE WHEN confidence < 0.9 AND correct=1 THEN 1 ELSE 0 END) as implicit_correct
    FROM wikilink_feedback WHERE created_at >= ? AND created_at <= ?
  `).get(startIso, endIso + ' 23:59:59') as {
    total: number; explicit_count: number; implicit_count: number;
    explicit_correct: number; implicit_correct: number;
  };

  return {
    total: row.total,
    explicit_count: row.explicit_count,
    implicit_count: row.implicit_count,
    explicit_accuracy: row.explicit_count > 0 ? round(row.explicit_correct / row.explicit_count) : null,
    implicit_accuracy: row.implicit_count > 0 ? round(row.implicit_correct / row.implicit_count) : null,
  };
}

function querySuppression(stateDb: StateDb): CalibrationExport['suppression'] {
  const stats = getWeightedEntityStats(stateDb);
  const suppressed = getSuppressedCount(stateDb);

  return {
    entities_suppressed: suppressed,
    entities_with_feedback: stats.length,
    suppression_rate: stats.length > 0 ? round(suppressed / stats.length) : null,
  };
}

function queryRecencyAnalysis(stateDb: StateDb, startMs: number, startIso: string, endIso: string): CalibrationExport['recency_analysis'] {
  // Get applied entities and their breakdown_json, then check survival status
  const rows = stateDb.db.prepare(`
    SELECT se.breakdown_json, wa.status
    FROM suggestion_events se
    JOIN wikilink_applications wa ON LOWER(se.entity) = LOWER(wa.entity)
      AND se.note_path = wa.note_path
    WHERE se.timestamp >= ? AND wa.applied_at >= ? AND wa.applied_at <= ?
  `).all(startMs, startIso, endIso + ' 23:59:59') as Array<{
    breakdown_json: string; status: string;
  }>;

  let survivedSum = 0, survivedCount = 0;
  let removedSum = 0, removedCount = 0;

  for (const r of rows) {
    let bd: Record<string, number>;
    try { bd = JSON.parse(r.breakdown_json); } catch { continue; }
    const recency = bd.recencyBoost ?? 0;
    if (r.status === 'applied') { survivedSum += recency; survivedCount++; }
    else { removedSum += recency; removedCount++; }
  }

  return {
    avg_recency_when_survived: survivedCount > 0 ? round(survivedSum / survivedCount) : 0,
    avg_recency_when_removed: removedCount > 0 ? round(removedSum / removedCount) : 0,
  };
}

function queryCooccurrenceAnalysis(stateDb: StateDb, startMs: number, startIso: string, endIso: string): CalibrationExport['cooccurrence_analysis'] {
  const rows = stateDb.db.prepare(`
    SELECT se.breakdown_json, wa.status
    FROM suggestion_events se
    LEFT JOIN wikilink_applications wa ON LOWER(se.entity) = LOWER(wa.entity)
      AND se.note_path = wa.note_path
      AND wa.applied_at >= ? AND wa.applied_at <= ?
    WHERE se.timestamp >= ?
  `).all(startIso, endIso + ' 23:59:59', startMs) as Array<{
    breakdown_json: string; status: string | null;
  }>;

  let totalCount = 0, coocOnlyCount = 0;
  let coocOnlyApplied = 0, coocOnlySurvived = 0;
  let coocSum = 0;

  for (const r of rows) {
    let bd: Record<string, number>;
    try { bd = JSON.parse(r.breakdown_json); } catch { continue; }
    totalCount++;
    coocSum += bd.cooccurrenceBoost ?? 0;

    if ((bd.contentMatch ?? 0) === 0 && (bd.cooccurrenceBoost ?? 0) > 0) {
      coocOnlyCount++;
      if (r.status != null) {
        coocOnlyApplied++;
        if (r.status === 'applied') coocOnlySurvived++;
      }
    }
  }

  return {
    cooc_only_rate: totalCount > 0 ? round(coocOnlyCount / totalCount) : 0,
    cooc_only_survival_rate: coocOnlyApplied > 0 ? round(coocOnlySurvived / coocOnlyApplied) : null,
    avg_cooc_boost: totalCount > 0 ? round(coocSum / totalCount) : 0,
  };
}

function queryThresholdAnalysis(stateDb: StateDb, startMs: number): CalibrationExport['threshold_analysis'] {
  const rows = stateDb.db.prepare(
    'SELECT total_score FROM suggestion_events WHERE timestamp >= ?'
  ).all(startMs) as Array<{ total_score: number }>;

  const total = rows.length;
  return {
    pass_rates_at_thresholds: THRESHOLD_SWEEP.map(t => ({
      threshold: t,
      pass_rate: total > 0 ? round(rows.filter(r => r.total_score >= t).length / total, 4) : 0,
    })),
  };
}

function queryFlywheelAgeDays(stateDb: StateDb): number {
  const row = stateDb.db.prepare(
    'SELECT MIN(timestamp) as first_ts FROM suggestion_events'
  ).get() as { first_ts: number | null };
  if (!row?.first_ts) return 0;
  return Math.floor((Date.now() - row.first_ts) / (24 * 60 * 60 * 1000));
}

// =============================================================================
// MAIN
// =============================================================================

export function getCalibrationExport(
  stateDb: StateDb,
  metrics: { note_count: number; entity_count: number; link_count: number; connected_ratio: number; avg_links_per_note: number },
  config: FlywheelConfig,
  daysBack: number = 30,
  includeVaultId: boolean = true,
): CalibrationExport {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - daysBack + 1);
  start.setHours(0, 0, 0, 0);

  const startIso = start.toISOString().slice(0, 10);
  const endIso = now.toISOString().slice(0, 10);
  const startMs = start.getTime();

  let vaultId: string | undefined;
  if (includeVaultId) {
    // Generate a stable anonymous ID from vault path hash
    const crypto = require('crypto');
    vaultId = crypto.createHash('sha256').update(stateDb.vaultPath).digest('hex').slice(0, 16);
  }

  return {
    schema_version: 1,
    exported_at: now.toISOString(),
    vault_id: vaultId,

    vault_profile: {
      size_bucket: sizeBucket(metrics.note_count),
      entity_bucket: sizeBucket(metrics.entity_count),
      avg_links_per_note: round(metrics.avg_links_per_note, 1),
      connected_ratio: round(metrics.connected_ratio),
      semantic_enabled: hasEmbeddingsIndex(),
      flywheel_age_days: queryFlywheelAgeDays(stateDb),
      strictness_mode: config.wikilink_strictness ?? 'balanced',
      adaptive_strictness: config.adaptive_strictness ?? true,
    },

    entity_distribution: queryEntityDistribution(stateDb),
    funnel: queryFunnel(stateDb, startMs, startIso, endIso),
    layer_contributions: queryLayerContributions(stateDb, startMs),
    score_distribution: queryScoreDistribution(stateDb, startMs),
    survival_by_category: querySurvivalByCategory(stateDb, startIso, endIso),
    feedback: queryFeedback(stateDb, startIso, endIso),
    suppression: querySuppression(stateDb),
    recency_analysis: queryRecencyAnalysis(stateDb, startMs, startIso, endIso),
    cooccurrence_analysis: queryCooccurrenceAnalysis(stateDb, startMs, startIso, endIso),
    threshold_analysis: queryThresholdAnalysis(stateDb, startMs),
  };
}
