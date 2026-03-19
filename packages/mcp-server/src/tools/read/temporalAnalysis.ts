/**
 * Temporal Analysis tools - time-based vault intelligence
 *
 * Tools: get_context_around_date, predict_stale_notes, track_concept_evolution, temporal_summary
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import { MAX_LIMIT } from '../../core/read/constants.js';
import { requireIndex } from '../../core/read/indexGuard.js';
import { getNotesInRange } from './temporal.js';
import { getBacklinksForNote } from '../../core/read/graph.js';
import { getCooccurrenceIndex } from '../../core/write/wikilinks.js';

// ============================================================================
// Helpers
// ============================================================================

/** Format a Date as YYYY-MM-DD */
function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

/** Add days to a YYYY-MM-DD string and return YYYY-MM-DD */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

/** Convert YYYY-MM-DD to epoch ms (start of day UTC) */
function dateToEpochMs(dateStr: string): number {
  return new Date(dateStr).getTime();
}

/** Convert YYYY-MM-DD to datetime text for SQL (start of day) */
function dateToDatetimeStart(dateStr: string): string {
  return `${dateStr} 00:00:00`;
}

/** Convert YYYY-MM-DD to datetime text for SQL (end of day) */
function dateToDatetimeEnd(dateStr: string): string {
  return `${dateStr} 23:59:59`;
}

/** Check if a note path looks like a periodic note */
function isPeriodicNote(notePath: string): boolean {
  const filename = notePath.split('/').pop() || '';
  const nameWithoutExt = filename.replace(/\.md$/, '');
  const patterns = [
    /^\d{4}-\d{2}-\d{2}$/,
    /^\d{4}-W\d{2}$/,
    /^\d{4}-\d{2}$/,
    /^\d{4}-Q[1-4]$/,
    /^\d{4}$/,
  ];
  const periodicFolders = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'journal', 'journals'];
  const folder = notePath.split('/')[0]?.toLowerCase() || '';
  return patterns.some(p => p.test(nameWithoutExt)) || periodicFolders.includes(folder);
}

/** Check if a note path is in a templates folder */
function isTemplatePath(notePath: string): boolean {
  const folder = notePath.split('/')[0]?.toLowerCase() || '';
  return folder === 'templates' || folder === 'template';
}

// ============================================================================
// Tool 1: get_context_around_date
// ============================================================================

function handleGetContextAroundDate(
  index: VaultIndex,
  stateDb: StateDb | null,
  date: string,
  windowDays: number,
  limit: number,
) {
  const startDate = addDays(date, -windowDays);
  const endDate = addDays(date, windowDays);

  // 1. Notes modified/created in window
  const allNotes = getNotesInRange(index, startDate, endDate);
  const notes = allNotes.slice(0, limit);

  // Count created in window
  const windowStart = new Date(startDate);
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(endDate);
  windowEnd.setHours(23, 59, 59, 999);

  let notesCreated = 0;
  const dailyCounts: Record<string, number> = {};
  for (const note of allNotes) {
    const day = formatDate(note.modified);
    dailyCounts[day] = (dailyCounts[day] || 0) + 1;
    if (note.created && note.created >= windowStart && note.created <= windowEnd) {
      notesCreated++;
    }
  }

  // Find most active day
  let mostActiveDay: string | null = null;
  let maxCount = 0;
  for (const [day, count] of Object.entries(dailyCounts)) {
    if (count > maxCount) {
      maxCount = count;
      mostActiveDay = day;
    }
  }

  // 2-6. StateDb queries
  let activeEntities: Array<{ name: string; last_mentioned: string; mention_count: number }> = [];
  let appliedCount = 0;
  let newLinksCount = 0;
  let suggestionsEvaluated = 0;
  let fileMoves: Array<{ old_path: string; new_path: string; moved_at: string }> = [];

  if (stateDb) {
    const startEpoch = dateToEpochMs(startDate);
    const endEpoch = dateToEpochMs(endDate) + 86400000 - 1; // end of day
    const startText = dateToDatetimeStart(startDate);
    const endText = dateToDatetimeEnd(endDate);

    // Active entities from recency table (epoch ms)
    try {
      const rows = stateDb.db.prepare(
        `SELECT entity_name_lower, last_mentioned_at, mention_count
         FROM recency
         WHERE last_mentioned_at >= ? AND last_mentioned_at <= ?
         ORDER BY mention_count DESC
         LIMIT ?`
      ).all(startEpoch, endEpoch, limit) as Array<{ entity_name_lower: string; last_mentioned_at: number; mention_count: number }>;

      activeEntities = rows.map(r => ({
        name: r.entity_name_lower,
        last_mentioned: formatDate(new Date(r.last_mentioned_at)),
        mention_count: r.mention_count,
      }));
    } catch { /* table may not exist */ }

    // Wikilink applications (datetime text)
    try {
      const row = stateDb.db.prepare(
        `SELECT COUNT(*) as cnt FROM wikilink_applications
         WHERE applied_at >= ? AND applied_at <= ?`
      ).get(startText, endText) as { cnt: number } | undefined;
      appliedCount = row?.cnt ?? 0;
    } catch { /* table may not exist */ }

    // New links from note_link_history (datetime text)
    try {
      const row = stateDb.db.prepare(
        `SELECT COUNT(*) as cnt FROM note_link_history
         WHERE first_seen_at >= ? AND first_seen_at <= ?`
      ).get(startText, endText) as { cnt: number } | undefined;
      newLinksCount = row?.cnt ?? 0;
    } catch { /* table may not exist */ }

    // Suggestion events (epoch ms)
    try {
      const row = stateDb.db.prepare(
        `SELECT COUNT(*) as cnt FROM suggestion_events
         WHERE timestamp >= ? AND timestamp <= ?`
      ).get(startEpoch, endEpoch) as { cnt: number } | undefined;
      suggestionsEvaluated = row?.cnt ?? 0;
    } catch { /* table may not exist */ }

    // File moves (datetime text)
    try {
      const rows = stateDb.db.prepare(
        `SELECT old_path, new_path, moved_at FROM note_moves
         WHERE moved_at >= ? AND moved_at <= ?
         ORDER BY moved_at DESC`
      ).all(startText, endText) as Array<{ old_path: string; new_path: string; moved_at: string }>;
      fileMoves = rows;
    } catch { /* table may not exist */ }
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify({
      date,
      window: { start: startDate, end: endDate },
      summary: {
        notes_modified: allNotes.length,
        notes_created: notesCreated,
        most_active_day: mostActiveDay,
      },
      notes: notes.map(n => ({
        path: n.path,
        title: n.title,
        modified: formatDate(n.modified),
        created: n.created ? formatDate(n.created) : null,
      })),
      active_entities: activeEntities,
      wikilink_activity: {
        applied: appliedCount,
        new_links: newLinksCount,
        suggestions_evaluated: suggestionsEvaluated,
      },
      file_moves: fileMoves,
    }, null, 2) }],
  };
}

// ============================================================================
// Tool 2: predict_stale_notes
// ============================================================================

function handlePredictStaleNotes(
  index: VaultIndex,
  stateDb: StateDb | null,
  days: number,
  minImportance: number,
  includeRecommendations: boolean,
  folder: string | undefined,
  limit: number,
  offset: number,
) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  // Batch queries — build lookup maps to avoid N+1

  // 1. Backlink counts from index
  const backlinkCounts = new Map<string, number>();
  for (const [target, links] of index.backlinks) {
    for (const link of links) {
      backlinkCounts.set(link.source, (backlinkCounts.get(link.source) || 0));
    }
  }
  // Actually count backlinks BY target note path
  const backlinkCountsByPath = new Map<string, number>();
  for (const note of index.notes.values()) {
    const count = getBacklinksForNote(index, note.path).length;
    if (count > 0) backlinkCountsByPath.set(note.path, count);
  }

  // 2. Hub scores from entities table
  const hubScores = new Map<string, number>();
  if (stateDb) {
    try {
      const rows = stateDb.db.prepare(
        'SELECT name_lower, hub_score FROM entities WHERE hub_score > 0'
      ).all() as Array<{ name_lower: string; hub_score: number }>;
      for (const r of rows) hubScores.set(r.name_lower, r.hub_score);
    } catch { /* table may not exist */ }
  }

  // 3. Open task counts from tasks table
  const openTaskCounts = new Map<string, number>();
  if (stateDb) {
    try {
      const rows = stateDb.db.prepare(
        `SELECT path, COUNT(*) as cnt FROM tasks
         WHERE status = 'open'
         GROUP BY path`
      ).all() as Array<{ path: string; cnt: number }>;
      for (const r of rows) openTaskCounts.set(r.path, r.cnt);
    } catch { /* table may not exist */ }
  }

  // 4. Recently active entities (last 30 days) from recency table
  const recentlyActiveEntities = new Set<string>();
  if (stateDb) {
    try {
      const thirtyDaysAgo = Date.now() - 30 * 86400000;
      const rows = stateDb.db.prepare(
        'SELECT entity_name_lower FROM recency WHERE last_mentioned_at >= ?'
      ).all(thirtyDaysAgo) as Array<{ entity_name_lower: string }>;
      for (const r of rows) recentlyActiveEntities.add(r.entity_name_lower);
    } catch { /* table may not exist */ }
  }

  // Iterate candidate notes
  const candidates: Array<{
    path: string;
    title: string;
    days_stale: number;
    importance: number;
    staleness_risk: number;
    recommendation: string;
    signals: {
      backlink_count: number;
      hub_score: number;
      outlink_count: number;
      has_open_tasks: boolean;
      status_active: boolean;
      active_entity_ratio: number;
    };
  }> = [];

  for (const note of index.notes.values()) {
    if (note.modified >= cutoff) continue; // Not stale enough
    if (isPeriodicNote(note.path)) continue;
    if (isTemplatePath(note.path)) continue;
    if (folder && !note.path.startsWith(folder + '/') && note.path.substring(0, note.path.lastIndexOf('/')) !== folder) continue;

    const daysSince = Math.floor((Date.now() - note.modified.getTime()) / 86400000);
    const backlinkCount = backlinkCountsByPath.get(note.path) || 0;
    const hubScore = hubScores.get(note.title.toLowerCase()) || 0;
    const outlinkCount = note.outlinks.length;
    const openTasks = openTaskCounts.get(note.path) || 0;
    const hasOpenTasks = openTasks > 0;
    const statusActive = note.frontmatter?.status === 'active';

    // Active entity ratio: fraction of outlinked entities with recent activity
    let activeEntityRatio = 0;
    if (outlinkCount > 0) {
      let activeCount = 0;
      for (const link of note.outlinks) {
        const target = (link.target || '').toLowerCase();
        if (recentlyActiveEntities.has(target)) activeCount++;
      }
      activeEntityRatio = activeCount / outlinkCount;
    }

    // Importance (0-100)
    const importance =
      Math.min(backlinkCount / 10, 1) * 30 +
      Math.min(hubScore / 20, 1) * 20 +
      Math.min(outlinkCount / 5, 1) * 15 +
      (hasOpenTasks ? 20 : 0) +
      (statusActive ? 15 : 0);

    if (importance < minImportance) continue;

    // Staleness risk (0-100)
    const stalenessRisk =
      Math.min(daysSince / 180, 1) * 40 +
      (1 - activeEntityRatio) * 30 +
      (hasOpenTasks ? 20 : 0) +
      (statusActive && daysSince > days ? 10 : 0);

    // Recommendation
    let recommendation = 'low_priority';
    if (includeRecommendations) {
      if (importance < 20 && daysSince > 180 && !hasOpenTasks) {
        recommendation = 'archive';
      } else if (importance >= 50 && activeEntityRatio > 0) {
        recommendation = 'update';
      } else if (hasOpenTasks || statusActive) {
        recommendation = 'review';
      }
    }

    candidates.push({
      path: note.path,
      title: note.title,
      days_stale: daysSince,
      importance: Math.round(importance * 10) / 10,
      staleness_risk: Math.round(stalenessRisk * 10) / 10,
      recommendation,
      signals: {
        backlink_count: backlinkCount,
        hub_score: hubScore,
        outlink_count: outlinkCount,
        has_open_tasks: hasOpenTasks,
        status_active: statusActive,
        active_entity_ratio: Math.round(activeEntityRatio * 100) / 100,
      },
    });
  }

  // Sort by staleness_risk descending (most at-risk first)
  candidates.sort((a, b) => b.staleness_risk - a.staleness_risk);

  const total = candidates.length;
  const paginated = candidates.slice(offset, offset + limit);

  return {
    content: [{ type: 'text' as const, text: JSON.stringify({
      criteria: { days, min_importance: minImportance, folder: folder || null },
      total_count: total,
      returned_count: paginated.length,
      notes: paginated,
    }, null, 2) }],
  };
}

// ============================================================================
// Tool 3: track_concept_evolution
// ============================================================================

interface TimelineEvent {
  date: string;
  type: string;
  detail: string;
  edits_survived?: number;
}

function handleTrackConceptEvolution(
  index: VaultIndex,
  stateDb: StateDb | null,
  entity: string,
  daysBack: number,
  includeCooccurrence: boolean,
) {
  // 1. Resolve entity (case-insensitive)
  const entityLower = entity.toLowerCase();
  const entityPath = index.entities.get(entityLower);
  const entityNote = entityPath ? index.notes.get(entityPath) : undefined;

  // Entity info from entities table
  let dbHubScore = 0;
  let dbCategory = '';
  let dbDescription = '';
  if (stateDb) {
    try {
      const row = stateDb.db.prepare(
        'SELECT hub_score, category, description FROM entities WHERE name_lower = ?'
      ).get(entityLower) as { hub_score: number; category: string; description: string | null } | undefined;
      if (row) {
        dbHubScore = row.hub_score;
        dbCategory = row.category;
        dbDescription = row.description || '';
      }
    } catch { /* table may not exist */ }
  }

  if (!entityPath && !dbCategory) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        error: `Entity "${entity}" not found in vault index or entities table`,
      }, null, 2) }],
    };
  }

  // 2. Current state
  const backlinks = entityPath ? getBacklinksForNote(index, entityPath) : [];
  const outlinks = entityNote?.outlinks || [];
  const tags = entityNote?.tags || [];
  const aliases = entityNote?.aliases || [];

  // Recency
  let lastMentioned: string | null = null;
  let mentionCount = 0;
  if (stateDb) {
    try {
      const row = stateDb.db.prepare(
        'SELECT last_mentioned_at, mention_count FROM recency WHERE entity_name_lower = ?'
      ).get(entityLower) as { last_mentioned_at: number; mention_count: number } | undefined;
      if (row) {
        lastMentioned = formatDate(new Date(row.last_mentioned_at));
        mentionCount = row.mention_count;
      }
    } catch { /* table may not exist */ }
  }

  const currentState = {
    path: entityPath || null,
    category: dbCategory || null,
    hub_score: dbHubScore,
    backlink_count: backlinks.length,
    outlink_count: outlinks.length,
    tags,
    aliases,
    last_mentioned: lastMentioned,
    mention_count: mentionCount,
  };

  // 3. Build timeline from StateDb
  const timeline: TimelineEvent[] = [];
  const cutoffDate = addDays(formatDate(new Date()), -daysBack);
  const cutoffText = dateToDatetimeStart(cutoffDate);

  if (stateDb) {
    // entity_changes
    try {
      const rows = stateDb.db.prepare(
        `SELECT field, old_value, new_value, changed_at FROM entity_changes
         WHERE entity = ? COLLATE NOCASE AND changed_at >= ?
         ORDER BY changed_at`
      ).all(entity, cutoffText) as Array<{ field: string; old_value: string | null; new_value: string | null; changed_at: string }>;

      for (const r of rows) {
        timeline.push({
          date: r.changed_at.split(' ')[0],
          type: `${r.field}_changed`,
          detail: `${r.old_value || '(none)'} → ${r.new_value || '(none)'}`,
        });
      }
    } catch { /* table may not exist */ }

    // note_link_history (target = entity)
    try {
      const rows = stateDb.db.prepare(
        `SELECT note_path, first_seen_at, edits_survived FROM note_link_history
         WHERE target = ? COLLATE NOCASE AND first_seen_at >= ?
         ORDER BY first_seen_at`
      ).all(entity, cutoffText) as Array<{ note_path: string; first_seen_at: string; edits_survived: number }>;

      for (const r of rows) {
        timeline.push({
          date: r.first_seen_at.split(' ')[0],
          type: 'link_added',
          detail: `Added from ${r.note_path}`,
          edits_survived: r.edits_survived,
        });
      }
    } catch { /* table may not exist */ }

    // wikilink_feedback
    try {
      const rows = stateDb.db.prepare(
        `SELECT note_path, correct, context, created_at FROM wikilink_feedback
         WHERE entity = ? COLLATE NOCASE AND created_at >= ?
         ORDER BY created_at`
      ).all(entity, cutoffText) as Array<{ note_path: string; correct: number; context: string; created_at: string }>;

      for (const r of rows) {
        timeline.push({
          date: r.created_at.split(' ')[0],
          type: r.correct ? 'feedback_positive' : 'feedback_negative',
          detail: `${r.correct ? 'Confirmed' : 'Rejected'} in ${r.note_path}`,
        });
      }
    } catch { /* table may not exist */ }

    // wikilink_applications
    try {
      const rows = stateDb.db.prepare(
        `SELECT note_path, applied_at FROM wikilink_applications
         WHERE entity = ? COLLATE NOCASE AND applied_at >= ?
         ORDER BY applied_at`
      ).all(entity, cutoffText) as Array<{ note_path: string; applied_at: string }>;

      for (const r of rows) {
        timeline.push({
          date: r.applied_at.split(' ')[0],
          type: 'wikilink_applied',
          detail: `Auto-linked in ${r.note_path}`,
        });
      }
    } catch { /* table may not exist */ }

    // note_moves (matching entity's note path)
    if (entityPath) {
      try {
        const rows = stateDb.db.prepare(
          `SELECT old_path, new_path, moved_at FROM note_moves
           WHERE (old_path = ? OR new_path = ?) AND moved_at >= ?
           ORDER BY moved_at`
        ).all(entityPath, entityPath, cutoffText) as Array<{ old_path: string; new_path: string; moved_at: string }>;

        for (const r of rows) {
          timeline.push({
            date: r.moved_at.split(' ')[0],
            type: 'note_moved',
            detail: `${r.old_path} → ${r.new_path}`,
          });
        }
      } catch { /* table may not exist */ }
    }
  }

  // Sort timeline chronologically
  timeline.sort((a, b) => a.date.localeCompare(b.date));

  // 4. Link durability from note_link_history
  let linkStats: {
    total_links_tracked: number;
    links_added_in_window: number;
    avg_edits_survived: number;
    most_durable_link: { from: string; edits_survived: number } | null;
  } = { total_links_tracked: 0, links_added_in_window: 0, avg_edits_survived: 0, most_durable_link: null };

  if (stateDb) {
    try {
      // All links to this entity
      const allLinks = stateDb.db.prepare(
        `SELECT note_path, first_seen_at, edits_survived FROM note_link_history
         WHERE target = ? COLLATE NOCASE`
      ).all(entity) as Array<{ note_path: string; first_seen_at: string; edits_survived: number }>;

      const inWindow = allLinks.filter(r => r.first_seen_at >= cutoffText);
      const totalSurvived = allLinks.reduce((sum, r) => sum + r.edits_survived, 0);
      const mostDurable = allLinks.reduce<{ note_path: string; edits_survived: number } | null>(
        (best, r) => (!best || r.edits_survived > best.edits_survived) ? r : best,
        null
      );

      linkStats = {
        total_links_tracked: allLinks.length,
        links_added_in_window: inWindow.length,
        avg_edits_survived: allLinks.length > 0 ? Math.round(totalSurvived / allLinks.length * 10) / 10 : 0,
        most_durable_link: mostDurable ? { from: mostDurable.note_path, edits_survived: mostDurable.edits_survived } : null,
      };
    } catch { /* table may not exist */ }
  }

  // 5. Co-occurrence neighbors
  let cooccurrenceNeighbors: Array<{ entity: string; count: number }> | null = null;
  if (includeCooccurrence) {
    const coocIndex = getCooccurrenceIndex();
    if (coocIndex) {
      const assoc = coocIndex.associations[entityLower];
      if (assoc) {
        cooccurrenceNeighbors = Array.from(assoc.entries())
          .sort((a: [string, number], b: [string, number]) => b[1] - a[1])
          .slice(0, 10)
          .map(([name, count]: [string, number]) => ({ entity: name, count }));
      } else {
        cooccurrenceNeighbors = [];
      }
    }
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify({
      entity,
      current_state: currentState,
      timeline,
      link_stats: linkStats,
      cooccurrence_neighbors: cooccurrenceNeighbors,
    }, null, 2) }],
  };
}

// ============================================================================
// Tool 4: temporal_summary
// ============================================================================

function handleTemporalSummary(
  index: VaultIndex,
  stateDb: StateDb | null,
  startDate: string,
  endDate: string,
  focusEntities: string[] | undefined,
  limit: number,
) {
  // 1. Get context for the period (use midpoint as center, half-range as window)
  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  const midpointMs = startMs + (endMs - startMs) / 2;
  const midpoint = formatDate(new Date(midpointMs));
  const windowDays = Math.ceil((endMs - startMs) / (2 * 86400000));

  const contextResult = handleGetContextAroundDate(index, stateDb, midpoint, windowDays, limit);
  const context = JSON.parse(contextResult.content[0].text);

  // 2. Get stale notes that overlap the period
  const staleResult = handlePredictStaleNotes(
    index, stateDb, 30, 20, true, undefined, 10, 0,
  );
  const stale = JSON.parse(staleResult.content[0].text);

  // 3. Track evolution for top entities (from context or user-specified)
  const entitiesToTrack = focusEntities && focusEntities.length > 0
    ? focusEntities
    : (context.active_entities || []).slice(0, 5).map((e: { name: string }) => e.name);

  const daysBack = Math.ceil((endMs - startMs) / 86400000) + 30; // period + 30d context
  const evolutions = entitiesToTrack.map((entityName: string) => {
    const evoResult = handleTrackConceptEvolution(
      index, stateDb, entityName, daysBack, true,
    );
    const evo = JSON.parse(evoResult.content[0].text);
    if (evo.error) return null;

    // Filter timeline to just the summary period
    const periodEvents = (evo.timeline || []).filter(
      (e: { date: string }) => e.date >= startDate && e.date <= endDate
    );

    return {
      entity: entityName,
      current_state: {
        category: evo.current_state?.category,
        hub_score: evo.current_state?.hub_score,
        backlink_count: evo.current_state?.backlink_count,
        mention_count: evo.current_state?.mention_count,
      },
      period_events: periodEvents.length,
      event_types: periodEvents.reduce((acc: Record<string, number>, e: { type: string }) => {
        acc[e.type] = (acc[e.type] || 0) + 1;
        return acc;
      }, {}),
      link_durability: evo.link_stats?.avg_edits_survived ?? 0,
      top_neighbors: (evo.cooccurrence_neighbors || []).slice(0, 5),
    };
  }).filter(Boolean);

  const output = {
    period: { start: startDate, end: endDate },
    activity_snapshot: {
      notes_modified: context.summary?.notes_modified ?? 0,
      notes_created: context.summary?.notes_created ?? 0,
      most_active_day: context.summary?.most_active_day,
      wikilinks_applied: context.wikilink_activity?.applied ?? 0,
      new_links: context.wikilink_activity?.new_links ?? 0,
      suggestions_evaluated: context.wikilink_activity?.suggestions_evaluated ?? 0,
      file_moves: (context.file_moves || []).length,
    },
    active_entities: (context.active_entities || []).slice(0, 10),
    entity_evolution: evolutions,
    maintenance_alerts: (stale.notes || [])
      .filter((n: { recommendation: string }) => n.recommendation !== 'low_priority')
      .slice(0, 10)
      .map((n: { path: string; title: string; days_stale: number; importance: number; recommendation: string }) => ({
        path: n.path,
        title: n.title,
        days_stale: n.days_stale,
        importance: n.importance,
        recommendation: n.recommendation,
      })),
    stale_notes_total: stale.total_count ?? 0,
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }],
  };
}

// ============================================================================
// Registration
// ============================================================================

export function registerTemporalAnalysisTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string,
  getStateDb: () => StateDb | null,
): void {
  // Tool 1: get_context_around_date
  server.registerTool(
    'get_context_around_date',
    {
      title: 'Context Around Date',
      description:
        'Reconstruct what was happening in the vault around a specific date. ' +
        'Shows modified/created notes, active entities, wikilink activity, and file moves within a time window.',
      inputSchema: {
        date: z.string().describe('Center date in YYYY-MM-DD format'),
        window_days: z.coerce.number().default(3).describe('Days before and after the center date (default 3 = 7-day window)'),
        limit: z.coerce.number().default(50).describe('Maximum number of notes to return'),
      },
    },
    async ({ date, window_days, limit: requestedLimit }) => {
      requireIndex();
      const limit = Math.min(requestedLimit ?? 50, MAX_LIMIT);
      return handleGetContextAroundDate(getIndex(), getStateDb(), date, window_days ?? 3, limit);
    },
  );

  // Tool 2: predict_stale_notes
  server.registerTool(
    'predict_stale_notes',
    {
      title: 'Predict Stale Notes',
      description:
        'Multi-signal staleness prediction. Scores notes by importance (backlinks, hub score, tasks, status) ' +
        'and staleness risk (age, entity disconnect, task urgency). Returns concrete recommendations: ' +
        'archive, update, review, or low_priority.',
      inputSchema: {
        days: z.coerce.number().default(30).describe('Notes not modified in this many days (default 30)'),
        min_importance: z.coerce.number().default(0).describe('Filter by minimum importance score 0-100 (default 0)'),
        include_recommendations: z.boolean().default(true).describe('Include action recommendations (default true)'),
        folder: z.string().optional().describe('Limit to notes in this folder'),
        limit: z.coerce.number().default(30).describe('Maximum results to return (default 30)'),
        offset: z.coerce.number().default(0).describe('Results to skip for pagination (default 0)'),
      },
    },
    async ({ days, min_importance, include_recommendations, folder, limit: requestedLimit, offset }) => {
      requireIndex();
      const limit = Math.min(requestedLimit ?? 30, MAX_LIMIT);
      return handlePredictStaleNotes(
        getIndex(), getStateDb(), days ?? 30, min_importance ?? 0,
        include_recommendations ?? true, folder, limit, offset ?? 0,
      );
    },
  );

  // Tool 3: track_concept_evolution
  server.registerTool(
    'track_concept_evolution',
    {
      title: 'Track Concept Evolution',
      description:
        'Timeline of how an entity has evolved: link additions/removals, feedback events, category changes, ' +
        'co-occurrence shifts. Shows current state, chronological event history, link durability stats, ' +
        'and top co-occurrence neighbors.',
      inputSchema: {
        entity: z.string().describe('Entity name (case-insensitive)'),
        days_back: z.coerce.number().default(90).describe('How far back to look (default 90 days)'),
        include_cooccurrence: z.boolean().default(true).describe('Include co-occurrence neighbors (default true)'),
      },
    },
    async ({ entity, days_back, include_cooccurrence }) => {
      requireIndex();
      return handleTrackConceptEvolution(
        getIndex(), getStateDb(), entity, days_back ?? 90, include_cooccurrence ?? true,
      );
    },
  );

  // Tool 4: temporal_summary
  server.registerTool(
    'temporal_summary',
    {
      title: 'Temporal Summary',
      description:
        'Generate a vault pulse report for a time period. Composes context, staleness prediction, ' +
        'and concept evolution into a single summary. Shows activity snapshot, entity momentum, ' +
        'and maintenance alerts. Use for weekly/monthly/quarterly reviews.',
      inputSchema: {
        start_date: z.string().describe('Start of period in YYYY-MM-DD format'),
        end_date: z.string().describe('End of period in YYYY-MM-DD format'),
        focus_entities: z.array(z.string()).optional().describe('Specific entities to track evolution for (default: top 5 active entities in period)'),
        limit: z.coerce.number().default(50).describe('Maximum notes to include in context snapshot'),
      },
    },
    async ({ start_date, end_date, focus_entities, limit: requestedLimit }) => {
      requireIndex();
      const limit = Math.min(requestedLimit ?? 50, MAX_LIMIT);
      return handleTemporalSummary(
        getIndex(), getStateDb(), start_date, end_date, focus_entities, limit,
      );
    },
  );
}
