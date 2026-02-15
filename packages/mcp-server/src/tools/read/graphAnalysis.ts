/**
 * Graph Analysis - Unified graph intelligence tool
 *
 * Replaces: find_orphan_notes, find_dead_ends, find_sources, find_hub_notes, get_stale_notes
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import { MAX_LIMIT } from '../../core/read/constants.js';
import { requireIndex } from '../../core/read/indexGuard.js';
import { findOrphanNotes, findHubNotes } from '../../core/read/graph.js';
import { findDeadEnds, findSources } from './graphAdvanced.js';
import { getStaleNotes } from './temporal.js';

/**
 * Register the unified graph_analysis tool
 */
export function registerGraphAnalysisTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string
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
        '- "stale": Important notes (by backlink count) not recently modified',
      inputSchema: {
        analysis: z.enum(['orphans', 'dead_ends', 'sources', 'hubs', 'stale']).describe('Type of graph analysis to perform'),
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
      }
    }
  );
}
