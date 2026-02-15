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
import { MAX_LIMIT } from '../../core/read/constants.js';
import { requireIndex } from '../../core/read/indexGuard.js';
import { findOrphanNotes, findHubNotes } from '../../core/read/graph.js';
import { findDeadEnds, findSources } from './graphAdvanced.js';
import { getStaleNotes } from './temporal.js';
import { inferFolderConventions } from './schema.js';
import { getGraphEvolution, getEmergingHubs } from '../../core/shared/graphSnapshots.js';

/**
 * Register the unified graph_analysis tool
 */
export function registerGraphAnalysisTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string,
  getStateDb?: () => StateDb | null,
): void {
  server.registerTool(
    'graph_analysis',
    {
      title: 'Graph Analysis',
      description:
        'Analyze vault link graph structure. Use analysis to pick the mode:\n' +
        '- "orphans": Notes with no backlinks (disconnected content)\n' +
        '- "dead_ends": Notes with backlinks but no outgoing links\n' +
        '- "sources": Notes with outgoing links but no backlinks\n' +
        '- "hubs": Highly connected notes (many links to/from)\n' +
        '- "stale": Important notes (by backlink count) not recently modified\n' +
        '- "immature": Notes scored by maturity (word count, links, frontmatter completeness, backlinks)\n' +
        '- "evolution": Graph topology metrics over time (avg_degree, cluster_count, etc.)\n' +
        '- "emerging_hubs": Entities growing fastest in connection count\n\n' +
        'Example: graph_analysis({ analysis: "hubs", limit: 10 })\n' +
        'Example: graph_analysis({ analysis: "stale", days: 30, min_backlinks: 3 })\n' +
        'Example: graph_analysis({ analysis: "immature", folder: "projects", limit: 20 })\n' +
        'Example: graph_analysis({ analysis: "evolution", days: 30 })\n' +
        'Example: graph_analysis({ analysis: "emerging_hubs", days: 30 })',
      inputSchema: {
        analysis: z.enum(['orphans', 'dead_ends', 'sources', 'hubs', 'stale', 'immature', 'evolution', 'emerging_hubs']).describe('Type of graph analysis to perform'),
        folder: z.string().optional().describe('Limit to notes in this folder (orphans, dead_ends, sources)'),
        min_links: z.coerce.number().default(5).describe('Minimum total connections for hubs'),
        min_backlinks: z.coerce.number().default(1).describe('Minimum backlinks (dead_ends, stale)'),
        min_outlinks: z.coerce.number().default(1).describe('Minimum outlinks (sources)'),
        days: z.coerce.number().optional().describe('Notes not modified in this many days (stale, required)'),
        limit: z.coerce.number().default(50).describe('Maximum number of results to return'),
        offset: z.coerce.number().default(0).describe('Number of results to skip (for pagination)'),
      },
    },
    async ({ analysis, folder, min_links, min_backlinks, min_outlinks, days, limit: requestedLimit, offset }) => {
      requireIndex();
      const limit = Math.min(requestedLimit ?? 50, MAX_LIMIT);
      const index = getIndex();

      switch (analysis) {
        case 'orphans': {
          const allOrphans = findOrphanNotes(index, folder);
          const orphans = allOrphans.slice(offset, offset + limit);

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              analysis: 'orphans',
              orphan_count: allOrphans.length,
              returned_count: orphans.length,
              folder,
              orphans: orphans.map(o => ({
                path: o.path,
                title: o.title,
                modified: o.modified.toISOString(),
              })),
            }, null, 2) }],
          };
        }

        case 'dead_ends': {
          const allResults = findDeadEnds(index, folder, min_backlinks);
          const result = allResults.slice(offset, offset + limit);

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              analysis: 'dead_ends',
              criteria: { folder, min_backlinks },
              total_count: allResults.length,
              returned_count: result.length,
              dead_ends: result,
            }, null, 2) }],
          };
        }

        case 'sources': {
          const allResults = findSources(index, folder, min_outlinks);
          const result = allResults.slice(offset, offset + limit);

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              analysis: 'sources',
              criteria: { folder, min_outlinks },
              total_count: allResults.length,
              returned_count: result.length,
              sources: result,
            }, null, 2) }],
          };
        }

        case 'hubs': {
          const allHubs = findHubNotes(index, min_links);
          const hubs = allHubs.slice(offset, offset + limit);

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
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
            }, null, 2) }],
          };
        }

        case 'stale': {
          if (days === undefined) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'days parameter is required for stale analysis',
              }, null, 2) }],
            };
          }

          const result = getStaleNotes(index, days, min_backlinks).slice(0, limit);

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              analysis: 'stale',
              criteria: { days, min_backlinks },
              count: result.length,
              notes: result.map(n => ({
                ...n,
                modified: n.modified.toISOString(),
              })),
            }, null, 2) }],
          };
        }

        case 'immature': {
          const vaultPath = getVaultPath();

          // Get notes, optionally filtered by folder
          const allNotes = Array.from(index.notes.values()).filter(note =>
            !folder || note.path.startsWith(folder + '/') || note.path.substring(0, note.path.lastIndexOf('/')) === folder
          );

          // Infer folder conventions for frontmatter completeness scoring
          const conventions = inferFolderConventions(index, folder, 0.5);
          const expectedFields = conventions.inferred_fields.map(f => f.name);

          // Score each note
          const scored = allNotes.map(note => {
            // 1. Word count score
            let wordCount = 0;
            try {
              const content = fs.readFileSync(path.join(vaultPath, note.path), 'utf-8');
              // Strip frontmatter
              const body = content.replace(/^---[\s\S]*?---\n?/, '');
              wordCount = body.split(/\s+/).filter(w => w.length > 0).length;
            } catch {
              // File unreadable, score as 0
            }
            const wordScore = wordCount < 100 ? 0 : wordCount < 500 ? 0.5 : 1.0;

            // 2. Outlink count score
            const outlinkCount = note.outlinks.length;
            const outlinkScore = outlinkCount === 0 ? 0 : outlinkCount <= 3 ? 0.5 : 1.0;

            // 3. Frontmatter completeness relative to folder peers
            let frontmatterScore = 0;
            if (expectedFields.length > 0) {
              const existingFields = Object.keys(note.frontmatter);
              const presentCount = expectedFields.filter(f => existingFields.includes(f)).length;
              frontmatterScore = presentCount / expectedFields.length;
            } else {
              // No conventions to compare against; treat as complete
              frontmatterScore = 1.0;
            }

            // 4. Backlink count score
            const normalizedTitle = note.title.toLowerCase();
            const backlinks = index.backlinks.get(normalizedTitle) || [];
            const backlinkCount = backlinks.length;
            const backlinkScore = backlinkCount === 0 ? 0 : backlinkCount <= 2 ? 0.5 : 1.0;

            // Maturity = average of 4 components
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

          // Sort ascending (least mature first)
          scored.sort((a, b) => a.maturity_score - b.maturity_score);

          const total = scored.length;
          const paginated = scored.slice(offset, offset + limit);

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              analysis: 'immature',
              criteria: { folder: folder || null },
              total_count: total,
              returned_count: paginated.length,
              expected_fields: expectedFields,
              notes: paginated,
            }, null, 2) }],
          };
        }

        case 'evolution': {
          const db = getStateDb?.();
          if (!db) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'StateDb not available — graph evolution requires persistent state',
              }, null, 2) }],
            };
          }

          const daysBack = days ?? 30;
          const evolutions = getGraphEvolution(db, daysBack);

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              analysis: 'evolution',
              days_back: daysBack,
              metrics: evolutions,
            }, null, 2) }],
          };
        }

        case 'emerging_hubs': {
          const db = getStateDb?.();
          if (!db) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'StateDb not available — emerging hubs requires persistent state',
              }, null, 2) }],
            };
          }

          const daysBack = days ?? 30;
          const hubs = getEmergingHubs(db, daysBack);

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              analysis: 'emerging_hubs',
              days_back: daysBack,
              count: hubs.length,
              hubs,
            }, null, 2) }],
          };
        }
      }
    }
  );
}
