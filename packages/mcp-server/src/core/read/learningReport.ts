/**
 * Learning Report — flywheel_learning_report
 *
 * Single-call narrative of the flywheel auto-linking system's learning progress:
 * applications by day, feedback split, survival rate, rejection patterns,
 * suggestion funnel, and graph growth.
 */

import type { StateDb } from '@velvetmonkey/vault-core';
import { getToolSelectionReport, type ToolSelectionReport } from '../shared/toolSelectionFeedback.js';

// =============================================================================
// TYPES
// =============================================================================

export interface LearningReport {
  period: { start: string; end: string; days: number };
  applications_by_day: Array<{ day: string; applied: number; removed: number; net: number }>;
  feedback_by_day: Array<{ day: string; positive: number; negative: number; total: number }>;
  survival: { total_applied: number; still_active: number; removed: number; survival_rate: number | null };
  top_rejected: Array<{ entity: string; removed_count: number; applied_count: number; rejection_rate: number }>;
  funnel: {
    evaluations: number;
    applications: number;
    survivals: number;
    application_rate: number | null;
    survival_rate: number | null;
  };
  graph: { link_count: number; entity_count: number };
  tool_selection?: ToolSelectionReport;
  comparison?: {
    previous_period: { start: string; end: string };
    applications_delta: number;
    feedback_delta: number;
    survival_rate_delta: number | null;
  };
}

// =============================================================================
// HELPERS
// =============================================================================

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function periodBounds(daysBack: number, now: Date): { start: string; end: string; startMs: number; endMs: number } {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  start.setDate(start.getDate() - daysBack + 1);
  start.setHours(0, 0, 0, 0);
  return {
    start: isoDate(start),
    end: isoDate(end),
    startMs: start.getTime(),
    endMs: end.getTime() + 1, // exclusive upper bound
  };
}

// =============================================================================
// CORE QUERIES
// =============================================================================

function queryApplicationsByDay(
  stateDb: StateDb,
  startIso: string,
  endIso: string,
): LearningReport['applications_by_day'] {
  const rows = stateDb.db.prepare(`
    SELECT date(applied_at) as day,
      SUM(CASE WHEN status='applied' THEN 1 ELSE 0 END) as applied,
      SUM(CASE WHEN status='removed' THEN 1 ELSE 0 END) as removed
    FROM wikilink_applications
    WHERE applied_at >= ? AND applied_at <= ?
    GROUP BY day ORDER BY day
  `).all(startIso, endIso + ' 23:59:59') as Array<{ day: string; applied: number; removed: number }>;

  return rows.map(r => ({ ...r, net: r.applied - r.removed }));
}

function queryFeedbackByDay(
  stateDb: StateDb,
  startIso: string,
  endIso: string,
): LearningReport['feedback_by_day'] {
  return stateDb.db.prepare(`
    SELECT date(created_at) as day,
      SUM(CASE WHEN correct=1 THEN 1 ELSE 0 END) as positive,
      SUM(CASE WHEN correct=0 THEN 1 ELSE 0 END) as negative,
      COUNT(*) as total
    FROM wikilink_feedback
    WHERE created_at >= ? AND created_at <= ?
    GROUP BY day ORDER BY day
  `).all(startIso, endIso + ' 23:59:59') as Array<{ day: string; positive: number; negative: number; total: number }>;
}

function querySurvival(
  stateDb: StateDb,
  startIso: string,
  endIso: string,
): LearningReport['survival'] {
  const row = stateDb.db.prepare(`
    SELECT
      COUNT(*) as total_applied,
      SUM(CASE WHEN status='applied' THEN 1 ELSE 0 END) as still_active,
      SUM(CASE WHEN status='removed' THEN 1 ELSE 0 END) as removed
    FROM wikilink_applications
    WHERE applied_at >= ? AND applied_at <= ?
  `).get(startIso, endIso + ' 23:59:59') as { total_applied: number; still_active: number; removed: number };

  return {
    ...row,
    survival_rate: row.total_applied > 0
      ? Math.round((row.still_active / row.total_applied) * 1000) / 1000
      : null,
  };
}

function queryTopRejected(
  stateDb: StateDb,
  startIso: string,
  endIso: string,
): LearningReport['top_rejected'] {
  return stateDb.db.prepare(`
    SELECT entity,
      SUM(CASE WHEN status='removed' THEN 1 ELSE 0 END) as removed_count,
      COUNT(*) as applied_count
    FROM wikilink_applications
    WHERE applied_at >= ? AND applied_at <= ?
    GROUP BY entity COLLATE NOCASE
    HAVING removed_count > 0
    ORDER BY removed_count DESC
    LIMIT 10
  `).all(startIso, endIso + ' 23:59:59').map((r: any) => ({
    entity: r.entity as string,
    removed_count: r.removed_count as number,
    applied_count: r.applied_count as number,
    rejection_rate: Math.round((r.removed_count / r.applied_count) * 1000) / 1000,
  }));
}

function queryFunnel(
  stateDb: StateDb,
  startIso: string,
  endIso: string,
  startMs: number,
  endMs: number,
): LearningReport['funnel'] {
  // Suggestion events use integer ms timestamps
  const evalRow = stateDb.db.prepare(`
    SELECT
      COUNT(*) as evaluations,
      SUM(CASE WHEN passed=1 THEN 1 ELSE 0 END) as threshold_passes
    FROM suggestion_events
    WHERE timestamp >= ? AND timestamp < ?
  `).get(startMs, endMs) as { evaluations: number; threshold_passes: number };

  // Applications and survivals from wikilink_applications (ISO text)
  const appRow = stateDb.db.prepare(`
    SELECT
      COUNT(*) as applications,
      SUM(CASE WHEN status='applied' THEN 1 ELSE 0 END) as survivals
    FROM wikilink_applications
    WHERE applied_at >= ? AND applied_at <= ?
  `).get(startIso, endIso + ' 23:59:59') as { applications: number; survivals: number };

  return {
    evaluations: evalRow.evaluations,
    applications: appRow.applications,
    survivals: appRow.survivals,
    application_rate: evalRow.evaluations > 0
      ? Math.round((appRow.applications / evalRow.evaluations) * 100000) / 100000
      : null,
    survival_rate: appRow.applications > 0
      ? Math.round((appRow.survivals / appRow.applications) * 1000) / 1000
      : null,
  };
}

// =============================================================================
// MAIN
// =============================================================================

export function getLearningReport(
  stateDb: StateDb,
  entityCount: number,
  linkCount: number,
  daysBack: number = 7,
  compare: boolean = false,
): LearningReport {
  const now = new Date();
  const bounds = periodBounds(daysBack, now);

  const report: LearningReport = {
    period: { start: bounds.start, end: bounds.end, days: daysBack },
    applications_by_day: queryApplicationsByDay(stateDb, bounds.start, bounds.end),
    feedback_by_day: queryFeedbackByDay(stateDb, bounds.start, bounds.end),
    survival: querySurvival(stateDb, bounds.start, bounds.end),
    top_rejected: queryTopRejected(stateDb, bounds.start, bounds.end),
    funnel: queryFunnel(stateDb, bounds.start, bounds.end, bounds.startMs, bounds.endMs),
    graph: { link_count: linkCount, entity_count: entityCount },
  };

  // Tool selection feedback — only include when data exists
  const toolSelection = getToolSelectionReport(stateDb, daysBack);
  if (toolSelection) {
    report.tool_selection = toolSelection;
  }

  if (compare) {
    const prevEnd = new Date(now);
    prevEnd.setDate(prevEnd.getDate() - daysBack);
    const prevBounds = periodBounds(daysBack, prevEnd);

    const prevSurvival = querySurvival(stateDb, prevBounds.start, prevBounds.end);
    const prevFeedback = queryFeedbackByDay(stateDb, prevBounds.start, prevBounds.end);
    const prevApps = queryApplicationsByDay(stateDb, prevBounds.start, prevBounds.end);

    const currAppsTotal = report.applications_by_day.reduce((s, d) => s + d.applied, 0);
    const prevAppsTotal = prevApps.reduce((s, d) => s + d.applied, 0);
    const currFeedbackTotal = report.feedback_by_day.reduce((s, d) => s + d.total, 0);
    const prevFeedbackTotal = prevFeedback.reduce((s, d) => s + d.total, 0);

    report.comparison = {
      previous_period: { start: prevBounds.start, end: prevBounds.end },
      applications_delta: currAppsTotal - prevAppsTotal,
      feedback_delta: currFeedbackTotal - prevFeedbackTotal,
      survival_rate_delta:
        report.survival.survival_rate != null && prevSurvival.survival_rate != null
          ? Math.round((report.survival.survival_rate - prevSurvival.survival_rate) * 1000) / 1000
          : null,
    };
  }

  return report;
}
