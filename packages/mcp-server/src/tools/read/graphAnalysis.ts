/**
 * Graph Analysis - Unified graph intelligence tool
 *
 * Replaces: find_orphan_notes, find_dead_ends, find_sources, find_hub_notes, get_stale_notes
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import { getExcludeTags, getExcludeEntities, type FlywheelConfig } from '../../core/read/config.js';
import { MAX_LIMIT } from '../../core/read/constants.js';
import { requireIndex } from '../../core/read/indexGuard.js';
import { findOrphanNotes, findHubNotes, normalizeTarget } from '../../core/read/graph.js';
import { computeCentralityMetrics, detectCycles } from './graphAdvanced.js';

/** Check if a note path looks like a periodic note (daily, weekly, monthly, quarterly, yearly). */
function isPeriodicNote(notePath: string): boolean {
  const filename = notePath.split('/').pop() || '';
  const nameWithoutExt = filename.replace(/\.md$/, '');
  const patterns = [
    /^\d{4}-\d{2}-\d{2}$/,     // YYYY-MM-DD (daily)
    /^\d{4}-W\d{2}$/,           // YYYY-Wnn (weekly)
    /^\d{4}-\d{2}$/,            // YYYY-MM (monthly)
    /^\d{4}-Q[1-4]$/,           // YYYY-Qn (quarterly)
    /^\d{4}$/,                   // YYYY (yearly)
  ];
  const periodicFolders = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'journal', 'journals'];
  const folder = notePath.split('/')[0]?.toLowerCase() || '';
  return patterns.some(p => p.test(nameWithoutExt)) || periodicFolders.includes(folder);
}
function isTemplatePath(notePath: string): boolean {
  const folder = notePath.split('/')[0]?.toLowerCase() || '';
  return folder === 'templates' || folder === 'template';
}

/** Build a set of note paths that should be excluded from analysis based on config. */
function getExcludedPaths(index: VaultIndex, config: FlywheelConfig): Set<string> {
  const excluded = new Set<string>();
  const excludeTags = new Set(getExcludeTags(config).map(t => t.toLowerCase()));
  const excludeEntities = new Set(getExcludeEntities(config).map(e => e.toLowerCase()));

  if (excludeTags.size === 0 && excludeEntities.size === 0) return excluded;

  for (const note of index.notes.values()) {
    // Exclude by tag
    if (excludeTags.size > 0) {
      const tags = note.frontmatter?.tags;
      const tagList = Array.isArray(tags) ? tags : typeof tags === 'string' ? [tags] : [];
      if (tagList.some(t => excludeTags.has(String(t).toLowerCase()))) {
        excluded.add(note.path);
        continue;
      }
    }
    // Exclude by entity name (matches note title or aliases)
    if (excludeEntities.size > 0) {
      if (excludeEntities.has(note.title.toLowerCase())) {
        excluded.add(note.path);
        continue;
      }
      for (const alias of note.aliases) {
        if (excludeEntities.has(alias.toLowerCase())) {
          excluded.add(note.path);
          break;
        }
      }
    }
  }
  return excluded;
}

import { findDeadEnds, findSources } from './graphAdvanced.js';
import { getStaleNotes } from './temporal.js';
import { inferFolderConventions } from './schema.js';
import { getEmergingHubs } from '../../core/shared/graphSnapshots.js';

export interface GraphAnalysisParams {
  analysis: 'orphans' | 'dead_ends' | 'sources' | 'hubs' | 'stale' | 'immature' | 'emerging_hubs' | 'centrality' | 'cycles';
  folder?: string;
  min_links?: number;
  min_backlinks?: number;
  min_outlinks?: number;
  days?: number;
  limit?: number;
  offset?: number;
}

export async function runGraphAnalysis(
  params: GraphAnalysisParams,
  getIndex: () => VaultIndex,
  getVaultPath: () => string,
  getStateDb?: () => StateDb | null,
  getConfig?: () => FlywheelConfig,
): Promise<Record<string, unknown>> {
  requireIndex();
  const {
    analysis,
    folder,
    min_links = 5,
    min_backlinks = 1,
    min_outlinks = 1,
    days,
    limit: requestedLimit = 50,
    offset = 0,
  } = params;
  const limit = Math.min(requestedLimit ?? 50, MAX_LIMIT);
  const index = getIndex();
  const config = getConfig?.() ?? {};
  const excludedPaths = getExcludedPaths(index, config);

  switch (analysis) {
    case 'orphans': {
      const allOrphans = findOrphanNotes(index, folder).filter(o => !isPeriodicNote(o.path) && !excludedPaths.has(o.path));
      const orphans = allOrphans.slice(offset, offset + limit);

      return {
        analysis: 'orphans',
        orphan_count: allOrphans.length,
        returned_count: orphans.length,
        folder,
        orphans: orphans.map(o => ({
          path: o.path,
          title: o.title,
          modified: o.modified.toISOString(),
        })),
      };
    }

    case 'dead_ends': {
      const allResults = findDeadEnds(index, folder, min_backlinks).filter(n => !excludedPaths.has(n.path));
      const result = allResults.slice(offset, offset + limit);

      return {
        analysis: 'dead_ends',
        criteria: { folder, min_backlinks },
        total_count: allResults.length,
        returned_count: result.length,
        dead_ends: result,
      };
    }

    case 'sources': {
      const allResults = findSources(index, folder, min_outlinks).filter(n => !excludedPaths.has(n.path));
      const result = allResults.slice(offset, offset + limit);

      return {
        analysis: 'sources',
        criteria: { folder, min_outlinks },
        total_count: allResults.length,
        returned_count: result.length,
        sources: result,
      };
    }

    case 'hubs': {
      const allHubs = findHubNotes(index, min_links).filter(h => !excludedPaths.has(h.path));
      const hubs = allHubs.slice(offset, offset + limit);

      return {
        analysis: 'hubs',
        hub_count: allHubs.length,
        returned_count: hubs.length,
        min_links,
        hubs: hubs.map(h => ({
          path: h.path,
          title: h.title,
          backlink_count: h.backlink_count,
          forward_link_count: h.forward_link_count,
          total_connections: h.total_connections,
        })),
      };
    }

    case 'stale': {
      if (days === undefined) {
        return {
          error: 'days parameter is required for stale analysis',
        };
      }

      const allResults = getStaleNotes(index, days, min_backlinks).filter(n =>
        !excludedPaths.has(n.path) && !isPeriodicNote(n.path) && !isTemplatePath(n.path)
      );
      const result = allResults.slice(offset, offset + limit);

      return {
        analysis: 'stale',
        criteria: { days, min_backlinks },
        total_count: allResults.length,
        returned_count: result.length,
        notes: result.map(n => ({
          ...n,
          modified: n.modified.toISOString(),
        })),
      };
    }

    case 'immature': {
      const vaultPath = getVaultPath();

      const allNotes = Array.from(index.notes.values()).filter(note =>
        (!folder || note.path.startsWith(folder + '/') || note.path.substring(0, note.path.lastIndexOf('/')) === folder) &&
        !isPeriodicNote(note.path) &&
        !excludedPaths.has(note.path)
      );

      const conventions = inferFolderConventions(index, folder, 0.5);
      const expectedFields = conventions.inferred_fields.map(f => f.name);

      const scored = allNotes.map(note => {
        let wordCount = 0;
        try {
          const content = fs.readFileSync(path.join(vaultPath, note.path), 'utf-8');
          const body = content.replace(/^---[\s\S]*?---\n?/, '');
          wordCount = body.split(/\s+/).filter(w => w.length > 0).length;
        } catch {
          // File unreadable, score as 0
        }
        const wordScore = wordCount < 100 ? 0 : wordCount < 500 ? 0.5 : 1.0;

        const outlinkCount = note.outlinks.length;
        const outlinkScore = outlinkCount === 0 ? 0 : outlinkCount <= 3 ? 0.5 : 1.0;

        let frontmatterScore = 0;
        if (expectedFields.length > 0) {
          const existingFields = Object.keys(note.frontmatter);
          const presentCount = expectedFields.filter(f => existingFields.includes(f)).length;
          frontmatterScore = presentCount / expectedFields.length;
        } else {
          frontmatterScore = 1.0;
        }

        const normalizedPath = normalizeTarget(note.path);
        const backlinks = index.backlinks.get(normalizedPath) || [];
        const backlinkCount = backlinks.length;
        const backlinkScore = backlinkCount === 0 ? 0 : backlinkCount <= 2 ? 0.5 : 1.0;

        const maturity = (wordScore + outlinkScore + frontmatterScore + backlinkScore) / 4;

        return {
          path: note.path,
          title: note.title,
          maturity_score: Math.round(maturity * 100) / 100,
          components: {
            word_count: { value: wordCount, score: wordScore },
            outlinks: { value: outlinkCount, score: outlinkScore },
            frontmatter: { value: `${expectedFields.length > 0 ? Math.round(frontmatterScore * 100) : 100}%`, score: Math.round(frontmatterScore * 100) / 100 },
            backlinks: { value: backlinkCount, score: backlinkScore },
          },
          modified: note.modified.toISOString(),
        };
      });

      scored.sort((a, b) => a.maturity_score - b.maturity_score);

      const total = scored.length;
      const paginated = scored.slice(offset, offset + limit);

      return {
        analysis: 'immature',
        criteria: { folder: folder || null },
        total_count: total,
        returned_count: paginated.length,
        expected_fields: expectedFields,
        notes: paginated,
      };
    }

    case 'emerging_hubs': {
      const db = getStateDb?.();
      if (!db) {
        return {
          error: 'StateDb not available — emerging hubs requires persistent state',
        };
      }

      const daysBack = days ?? 30;
      let hubs = getEmergingHubs(db, daysBack);

      if (excludedPaths.size > 0) {
        const notesByTitle = new Map<string, { path: string }>();
        for (const note of index.notes.values()) {
          notesByTitle.set(note.title.toLowerCase(), note);
        }
        hubs = hubs.filter(hub => {
          const note = notesByTitle.get(hub.entity.toLowerCase());
          return !note || !excludedPaths.has(note.path);
        });
      }
      const excludeEntities = new Set(getExcludeEntities(config).map(e => e.toLowerCase()));
      if (excludeEntities.size > 0) {
        hubs = hubs.filter(hub => !excludeEntities.has(hub.entity.toLowerCase()));
      }

      const totalHubs = hubs.length;
      const paginatedHubs = hubs.slice(offset, offset + limit);

      return {
        analysis: 'emerging_hubs',
        days_back: daysBack,
        total_count: totalHubs,
        returned_count: paginatedHubs.length,
        hubs: paginatedHubs,
      };
    }

    case 'centrality': {
      const results = computeCentralityMetrics(index, limit);
      const paginated = results.slice(offset, offset + limit);
      return {
        analysis: 'centrality',
        total_count: results.length,
        returned_count: paginated.length,
        notes: paginated,
      };
    }

    case 'cycles': {
      const cycles = detectCycles(index, 10, limit);
      return {
        analysis: 'cycles',
        total_count: cycles.length,
        cycles,
      };
    }
  }
}

/**
 * Register the unified graph_analysis tool
 */
export function registerGraphAnalysisTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string,
  getStateDb?: () => StateDb | null,
  getConfig?: () => FlywheelConfig,
): void {
  server.registerTool(
    'graph_analysis',
    {
      title: 'Graph Analysis',
      description:
        'Use when analyzing vault link structure for orphans, hubs, dead ends, clusters, or bridges. Produces structural graph metrics for the selected analysis mode. Returns mode-specific arrays with note paths, scores, and counts. Does not read note content — only analyzes link topology.',
      inputSchema: {
        analysis: z.enum(['orphans', 'dead_ends', 'sources', 'hubs', 'stale', 'immature', 'emerging_hubs', 'centrality', 'cycles']).describe('Type of graph analysis to perform'),
        folder: z.string().optional().describe('Limit to notes in this folder (orphans, dead_ends, sources, immature)'),
        min_links: z.coerce.number().default(5).describe('Minimum total connections for hubs'),
        min_backlinks: z.coerce.number().default(1).describe('Minimum backlinks (dead_ends, stale)'),
        min_outlinks: z.coerce.number().default(1).describe('Minimum outlinks (sources)'),
        days: z.coerce.number().optional().describe('Days threshold (stale: required; emerging_hubs: default 30)'),
        limit: z.coerce.number().default(50).describe('Maximum number of results to return'),
        offset: z.coerce.number().default(0).describe('Number of results to skip (for pagination)'),
      },
    },
    async (params) => {
      const result = await runGraphAnalysis(params, getIndex, getVaultPath, getStateDb, getConfig);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
