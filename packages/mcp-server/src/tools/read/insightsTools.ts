/**
 * insights merged tool — full preset
 *
 * Absorbs: track_concept_evolution + predict_stale_notes +
 *          get_context_around_date + note_intelligence + vault_growth
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import type { FlywheelConfig } from '../../core/read/config.js';
import { requireIndex } from '../../core/read/indexGuard.js';
import { MAX_LIMIT } from '../../core/read/constants.js';
import {
  computeMetrics,
  getMetricHistory,
  computeTrends,
} from '../../core/shared/metrics.js';
import {
  detectProsePatterns,
  suggestFrontmatterFromProse,
  suggestWikilinksInFrontmatter,
} from './bidirectional.js';
import { computeFrontmatter } from './computed.js';
import {
  hasEntityEmbeddingsIndex,
} from '../../core/read/embeddings.js';
import fs from 'node:fs';
import nodePath from 'node:path';

// Re-use the inner handler functions from temporalAnalysis.ts by importing
// the lower-level helpers directly.
import { getNotesInRange } from './temporal.js';
import { getBacklinksForNote } from '../../core/read/graph.js';
import { getCooccurrenceIndex } from '../../core/write/wikilinks.js';

// ============================================================================
// Helpers (duplicated from temporalAnalysis.ts to avoid coupling)
// ============================================================================

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

function dateToEpochMs(dateStr: string): number {
  return new Date(dateStr).getTime();
}

function dateToDatetimeStart(dateStr: string): string {
  return `${dateStr} 00:00:00`;
}

function dateToDatetimeEnd(dateStr: string): string {
  return `${dateStr} 23:59:59`;
}

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

function isTemplatePath(notePath: string): boolean {
  const folder = notePath.split('/')[0]?.toLowerCase() || '';
  return folder === 'templates' || folder === 'template';
}

// ============================================================================
// Registration
// ============================================================================

export function registerInsightsTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string,
  getStateDb: () => StateDb | null,
  getConfig?: () => FlywheelConfig,
): void {
  server.registerTool(
    'insights',
    {
      title: 'Insights',
      description:
        'Deep vault intelligence and temporal analysis. action: evolution — how a concept changed over time. action: staleness — notes becoming outdated (importance x age). action: context — vault activity around a date. action: note_intelligence — rich single-note analysis (quality, completeness, suggestions). action: growth — vault growth metrics over time. Returns timelines, stale note lists, snapshots, note scores, or growth counts. Does not modify notes. Examples: { action:"staleness", threshold_days:60 } { action:"context", date:"2026-03-15" } { action:"note_intelligence", path:"projects/flywheel.md" }',
      inputSchema: {
        action: z.enum(['evolution', 'staleness', 'context', 'note_intelligence', 'growth'])
          .describe('Insight operation to perform'),

        entity: z.string().optional().describe('[evolution] Entity/concept name to trace over time'),

        threshold_days: z.coerce.number().optional().describe('[staleness] Notes not modified in this many days (default 30)'),

        date: z.string().optional().describe('[context] Center date YYYY-MM-DD'),
        window_days: z.coerce.number().optional().describe('[context] Days before/after center date (default 3)'),

        path: z.string().optional().describe('[note_intelligence] Note path to analyse'),

        period: z.enum(['week', 'month', 'year']).optional().describe('[growth] Period for metrics (default month)'),

        limit: z.coerce.number().optional().describe('Maximum results to return'),
      },
    },
    async (params) => {
      requireIndex();
      const index = getIndex();
      const vaultPath = getVaultPath();
      const stateDb = getStateDb();
      const limit = Math.min(params.limit ?? 50, MAX_LIMIT);

      switch (params.action) {
        // -----------------------------------------------------------------
        // evolution — how an entity/concept has changed over time
        // -----------------------------------------------------------------
        case 'evolution': {
          if (!params.entity) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'entity is required for action=evolution',
              }, null, 2) }],
            };
          }

          const entity = params.entity;
          const entityLower = entity.toLowerCase();
          const entityPath = index.entities.get(entityLower);
          const entityNote = entityPath ? index.notes.get(entityPath) : undefined;
          const daysBack = 90;
          const cutoffDate = addDays(formatDate(new Date()), -daysBack);
          const cutoffText = dateToDatetimeStart(cutoffDate);

          // Entity info from entities table
          let dbHubScore = 0;
          let dbCategory = '';
          if (stateDb) {
            try {
              const row = stateDb.db.prepare(
                'SELECT hub_score, category FROM entities WHERE name_lower = ?'
              ).get(entityLower) as { hub_score: number; category: string } | undefined;
              if (row) {
                dbHubScore = row.hub_score;
                dbCategory = row.category;
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

          const backlinks = entityPath ? getBacklinksForNote(index, entityPath) : [];
          const outlinks = entityNote?.outlinks || [];
          const tags = entityNote?.tags || [];
          const aliases = entityNote?.aliases || [];

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

          interface TimelineEvent { date: string; type: string; detail: string; edits_survived?: number }
          const timeline: TimelineEvent[] = [];

          if (stateDb) {
            try {
              const rows = stateDb.db.prepare(
                `SELECT field, old_value, new_value, changed_at FROM entity_changes
                 WHERE entity = ? COLLATE NOCASE AND changed_at >= ? ORDER BY changed_at`
              ).all(entity, cutoffText) as Array<{ field: string; old_value: string | null; new_value: string | null; changed_at: string }>;
              for (const r of rows) {
                timeline.push({ date: r.changed_at.split(' ')[0], type: `${r.field}_changed`, detail: `${r.old_value || '(none)'} → ${r.new_value || '(none)'}` });
              }
            } catch { /* table may not exist */ }

            try {
              const rows = stateDb.db.prepare(
                `SELECT note_path, first_seen_at, edits_survived FROM note_link_history
                 WHERE target = ? COLLATE NOCASE AND first_seen_at >= ? ORDER BY first_seen_at`
              ).all(entity, cutoffText) as Array<{ note_path: string; first_seen_at: string; edits_survived: number }>;
              for (const r of rows) {
                timeline.push({ date: r.first_seen_at.split(' ')[0], type: 'link_added', detail: `Added from ${r.note_path}`, edits_survived: r.edits_survived });
              }
            } catch { /* table may not exist */ }

            try {
              const rows = stateDb.db.prepare(
                `SELECT note_path, correct, created_at FROM wikilink_feedback
                 WHERE entity = ? COLLATE NOCASE AND created_at >= ? ORDER BY created_at`
              ).all(entity, cutoffText) as Array<{ note_path: string; correct: number; created_at: string }>;
              for (const r of rows) {
                timeline.push({ date: r.created_at.split(' ')[0], type: r.correct ? 'feedback_positive' : 'feedback_negative', detail: `${r.correct ? 'Confirmed' : 'Rejected'} in ${r.note_path}` });
              }
            } catch { /* table may not exist */ }
          }

          timeline.sort((a, b) => a.date.localeCompare(b.date));

          // Co-occurrence neighbors
          const coocIndex = getCooccurrenceIndex();
          let cooccurrenceNeighbors: Array<{ entity: string; count: number }> = [];
          if (coocIndex) {
            const assoc = coocIndex.associations[entityLower];
            if (assoc) {
              cooccurrenceNeighbors = Array.from(assoc.entries())
                .sort((a: [string, number], b: [string, number]) => b[1] - a[1])
                .slice(0, 10)
                .map(([name, count]: [string, number]) => ({ entity: name, count }));
            }
          }

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              entity,
              current_state: currentState,
              timeline: timeline.slice(0, limit),
              cooccurrence_neighbors: cooccurrenceNeighbors,
            }, null, 2) }],
          };
        }

        // -----------------------------------------------------------------
        // staleness — predict which notes are becoming outdated
        // -----------------------------------------------------------------
        case 'staleness': {
          const days = params.threshold_days ?? 30;
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - days);

          const backlinkCountsByPath = new Map<string, number>();
          for (const note of index.notes.values()) {
            const count = getBacklinksForNote(index, note.path).length;
            if (count > 0) backlinkCountsByPath.set(note.path, count);
          }

          const hubScores = new Map<string, number>();
          if (stateDb) {
            try {
              const rows = stateDb.db.prepare('SELECT name_lower, hub_score FROM entities WHERE hub_score > 0').all() as Array<{ name_lower: string; hub_score: number }>;
              for (const r of rows) hubScores.set(r.name_lower, r.hub_score);
            } catch { /* table may not exist */ }
          }

          const candidates: Array<{
            path: string;
            title: string;
            days_stale: number;
            importance: number;
            staleness_risk: number;
            recommendation: string;
          }> = [];

          for (const note of index.notes.values()) {
            if (note.modified >= cutoff) continue;
            if (isPeriodicNote(note.path)) continue;
            if (isTemplatePath(note.path)) continue;

            const daysSince = Math.floor((Date.now() - note.modified.getTime()) / 86400000);
            const backlinkCount = backlinkCountsByPath.get(note.path) || 0;
            const hubScore = hubScores.get(note.title.toLowerCase()) || 0;
            const outlinkCount = note.outlinks.length;
            const statusActive = note.frontmatter?.status === 'active';

            const importance =
              Math.min(backlinkCount / 10, 1) * 30 +
              Math.min(hubScore / 20, 1) * 20 +
              Math.min(outlinkCount / 5, 1) * 15 +
              (statusActive ? 15 : 0);

            const stalenessRisk =
              Math.min(daysSince / 180, 1) * 50 +
              (statusActive && daysSince > days ? 20 : 0) +
              Math.min(backlinkCount / 5, 1) * 30;

            let recommendation = 'low_priority';
            if (importance < 20 && daysSince > 180) recommendation = 'archive';
            else if (importance >= 50) recommendation = 'update';
            else if (statusActive) recommendation = 'review';

            candidates.push({
              path: note.path,
              title: note.title,
              days_stale: daysSince,
              importance: Math.round(importance * 10) / 10,
              staleness_risk: Math.round(stalenessRisk * 10) / 10,
              recommendation,
            });
          }

          candidates.sort((a, b) => b.staleness_risk - a.staleness_risk);
          const paginated = candidates.slice(0, limit);

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              criteria: { days, threshold_days: days },
              total_count: candidates.length,
              returned_count: paginated.length,
              notes: paginated,
            }, null, 2) }],
          };
        }

        // -----------------------------------------------------------------
        // context — snapshot of vault activity around a date
        // -----------------------------------------------------------------
        case 'context': {
          if (!params.date) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'date is required for action=context (format YYYY-MM-DD)',
              }, null, 2) }],
            };
          }

          const windowDays = params.window_days ?? 3;
          const startDate = addDays(params.date, -windowDays);
          const endDate = addDays(params.date, windowDays);
          const allNotes = getNotesInRange(index, startDate, endDate);
          const notes = allNotes.slice(0, limit);

          let notesCreated = 0;
          const dailyCounts: Record<string, number> = {};
          for (const note of allNotes) {
            const day = formatDate(note.modified);
            dailyCounts[day] = (dailyCounts[day] || 0) + 1;
            if (note.created && note.created >= new Date(startDate) && note.created <= new Date(endDate)) {
              notesCreated++;
            }
          }

          let mostActiveDay: string | null = null;
          let maxCount = 0;
          for (const [day, count] of Object.entries(dailyCounts)) {
            if (count > maxCount) { maxCount = count; mostActiveDay = day; }
          }

          let activeEntities: Array<{ name: string; last_mentioned: string; mention_count: number }> = [];
          let appliedCount = 0;
          let newLinksCount = 0;

          if (stateDb) {
            const startEpoch = dateToEpochMs(startDate);
            const endEpoch = dateToEpochMs(endDate) + 86400000 - 1;
            const startText = dateToDatetimeStart(startDate);
            const endText = dateToDatetimeEnd(endDate);

            try {
              const rows = stateDb.db.prepare(
                `SELECT entity_name_lower, last_mentioned_at, mention_count FROM recency
                 WHERE last_mentioned_at >= ? AND last_mentioned_at <= ? ORDER BY mention_count DESC LIMIT ?`
              ).all(startEpoch, endEpoch, limit) as Array<{ entity_name_lower: string; last_mentioned_at: number; mention_count: number }>;
              activeEntities = rows.map(r => ({ name: r.entity_name_lower, last_mentioned: formatDate(new Date(r.last_mentioned_at)), mention_count: r.mention_count }));
            } catch { /* table may not exist */ }

            try {
              const row = stateDb.db.prepare(
                `SELECT COUNT(*) as cnt FROM wikilink_applications WHERE applied_at >= ? AND applied_at <= ?`
              ).get(startText, endText) as { cnt: number } | undefined;
              appliedCount = row?.cnt ?? 0;
            } catch { /* table may not exist */ }

            try {
              const row = stateDb.db.prepare(
                `SELECT COUNT(*) as cnt FROM note_link_history WHERE first_seen_at >= ? AND first_seen_at <= ?`
              ).get(startText, endText) as { cnt: number } | undefined;
              newLinksCount = row?.cnt ?? 0;
            } catch { /* table may not exist */ }
          }

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              date: params.date,
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
              wikilink_activity: { applied: appliedCount, new_links: newLinksCount },
            }, null, 2) }],
          };
        }

        // -----------------------------------------------------------------
        // note_intelligence — rich analysis of a single note
        // -----------------------------------------------------------------
        case 'note_intelligence': {
          if (!params.path) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'path is required for action=note_intelligence',
              }, null, 2) }],
            };
          }

          const notePath = params.path;

          // Run all analyses and combine
          const results: Record<string, unknown> = { path: notePath };

          try {
            results.prose_patterns = await detectProsePatterns(index, notePath, vaultPath);
          } catch (e) {
            results.prose_patterns_error = String(e);
          }

          try {
            results.suggested_frontmatter = await suggestFrontmatterFromProse(index, notePath, vaultPath);
          } catch (e) {
            results.suggested_frontmatter_error = String(e);
          }

          try {
            results.suggested_wikilinks = await suggestWikilinksInFrontmatter(index, notePath, vaultPath);
          } catch (e) {
            results.suggested_wikilinks_error = String(e);
          }

          try {
            results.computed_frontmatter = await computeFrontmatter(index, notePath, vaultPath, undefined);
          } catch (e) {
            results.computed_frontmatter_error = String(e);
          }

          // Backlinks from index
          const backlinks = getBacklinksForNote(index, notePath);
          const noteEntry = index.notes.get(notePath);
          results.graph = {
            backlink_count: backlinks.length,
            outlink_count: noteEntry?.outlinks.length ?? 0,
          };

          return {
            content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
          };
        }

        // -----------------------------------------------------------------
        // growth — vault growth metrics over time
        // -----------------------------------------------------------------
        case 'growth': {
          const period = params.period ?? 'month';
          const daysBack = period === 'week' ? 7 : period === 'year' ? 365 : 30;

          const currentMetrics = computeMetrics(index, stateDb ?? undefined);

          let history: unknown = null;
          let trends: unknown = null;
          if (stateDb) {
            try {
              history = getMetricHistory(stateDb, undefined, daysBack);
            } catch { /* table may not exist */ }
            try {
              trends = computeTrends(stateDb, currentMetrics, daysBack);
            } catch { /* table may not exist */ }
          }

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              period,
              days_back: daysBack,
              current: currentMetrics,
              history,
              trends,
            }, null, 2) }],
          };
        }
      }
    },
  );
}
