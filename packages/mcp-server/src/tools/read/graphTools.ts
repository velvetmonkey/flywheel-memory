/**
 * graph merged tool — full preset
 *
 * Absorbs: graph_analysis + get_backlinks + get_forward_links +
 *          get_strong_connections + get_link_path + get_common_neighbors +
 *          get_connection_strength + discover_cooccurrence_gaps
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import { requireIndex } from '../../core/read/indexGuard.js';
import { MAX_LIMIT } from '../../core/read/constants.js';
import {
  getBacklinksForNote,
  getForwardLinksForNote,
  resolveTarget,
} from '../../core/read/graph.js';
import { getInboundTargetsForNote } from '../../core/read/identity.js';
import {
  getLinkPath,
  getCommonNeighbors,
  getConnectionStrength,
} from './graphAdvanced.js';
import { getCooccurrenceIndex } from '../../core/write/wikilinks.js';

export function registerGraphTools2(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string,
  getStateDb?: () => StateDb | null,
): void {
  server.registerTool(
    'graph',
    {
      title: 'Graph',
      description:
        'Analyse vault graph structure and connections. action: analyse — hub/orphan/cluster summary. action: backlinks — notes linking to a note. action: forward_links — notes linked from a note. action: strong_connections — top connections by weight. action: path — shortest chain between two notes. action: neighbors — shared connections between two notes. action: strength — link weight between two notes. action: cooccurrence_gaps — entity pairs that co-occur but aren\'t linked. Returns graph metrics, link lists, paths, or gap candidates. Does not modify notes. Examples: { action:"backlinks", path:"people/alice.md" } { action:"path", from:"projects/x.md", to:"people/bob.md" }',
      inputSchema: {
        action: z.enum([
          'analyse',
          'backlinks',
          'forward_links',
          'strong_connections',
          'path',
          'neighbors',
          'strength',
          'cooccurrence_gaps',
        ]).describe('Graph operation to perform'),

        limit: z.coerce.number().optional().describe('[analyse|cooccurrence_gaps] Maximum results to return'),

        path: z.string().optional().describe('[backlinks|forward_links|strong_connections] Note path'),

        from: z.string().optional().describe('[path] Starting note path'),
        to: z.string().optional().describe('[path] Target note path'),

        path_a: z.string().optional().describe('[neighbors|strength] First note path'),
        path_b: z.string().optional().describe('[neighbors|strength] Second note path'),

        entity: z.string().optional().describe('[cooccurrence_gaps] Entity name to find gaps for'),
      },
    },
    async (params) => {
      requireIndex();
      const index = getIndex();
      const limit = Math.min(params.limit ?? 50, MAX_LIMIT);

      switch (params.action) {
        // -----------------------------------------------------------------
        // analyse — global hub/orphan/cluster analysis (delegates to graph_analysis hubs mode)
        // -----------------------------------------------------------------
        case 'analyse': {
          // Compute hubs + orphan summary from index
          const allNotes = Array.from(index.notes.values());
          const totalNotes = allNotes.length;

          // Count backlinks per note
          const backlinkCounts = new Map<string, number>();
          for (const note of allNotes) {
            const bls = getBacklinksForNote(index, note.path);
            backlinkCounts.set(note.path, bls.length);
          }

          // Orphans: no backlinks AND no outlinks
          const orphans = allNotes
            .filter(n => (backlinkCounts.get(n.path) ?? 0) === 0 && n.outlinks.length === 0)
            .slice(0, limit)
            .map(n => ({ path: n.path, title: n.title }));

          // Hubs: notes with many backlinks
          const hubs = allNotes
            .map(n => ({ path: n.path, title: n.title, backlink_count: backlinkCounts.get(n.path) ?? 0, outlink_count: n.outlinks.length }))
            .filter(n => n.backlink_count > 0)
            .sort((a, b) => b.backlink_count - a.backlink_count)
            .slice(0, limit);

          // Dead ends: has backlinks but no outlinks
          const deadEnds = allNotes
            .filter(n => (backlinkCounts.get(n.path) ?? 0) > 0 && n.outlinks.length === 0)
            .slice(0, limit)
            .map(n => ({ path: n.path, title: n.title, backlink_count: backlinkCounts.get(n.path) ?? 0 }));

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              total_notes: totalNotes,
              orphan_count: allNotes.filter(n => (backlinkCounts.get(n.path) ?? 0) === 0 && n.outlinks.length === 0).length,
              hub_count: hubs.length,
              dead_end_count: deadEnds.length,
              top_hubs: hubs,
              orphans,
              dead_ends: deadEnds,
            }, null, 2) }],
          };
        }

        // -----------------------------------------------------------------
        // backlinks — notes that link TO a note
        // -----------------------------------------------------------------
        case 'backlinks': {
          if (!params.path) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'path is required for action=backlinks',
              }, null, 2) }],
            };
          }
          let resolvedPath = params.path;
          if (!params.path.endsWith('.md')) {
            const resolved = resolveTarget(index, params.path);
            if (resolved) resolvedPath = resolved;
            else resolvedPath = params.path + '.md';
          }
          const allBacklinks = getBacklinksForNote(index, resolvedPath);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              note: resolvedPath,
              backlink_count: allBacklinks.length,
              backlinks: allBacklinks.slice(0, limit).map(bl => ({ source: bl.source, line: bl.line })),
            }, null, 2) }],
          };
        }

        // -----------------------------------------------------------------
        // forward_links — notes that a note links TO
        // -----------------------------------------------------------------
        case 'forward_links': {
          if (!params.path) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'path is required for action=forward_links',
              }, null, 2) }],
            };
          }
          let resolvedPath = params.path;
          if (!params.path.endsWith('.md')) {
            const resolved = resolveTarget(index, params.path);
            if (resolved) resolvedPath = resolved;
            else resolvedPath = params.path + '.md';
          }
          const forwardLinks = getForwardLinksForNote(index, resolvedPath);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              note: resolvedPath,
              forward_link_count: forwardLinks.length,
              forward_links: forwardLinks.slice(0, limit).map(link => ({
                target: link.target,
                alias: link.alias,
                line: link.line,
                resolved_path: link.resolvedPath,
                exists: link.exists,
              })),
            }, null, 2) }],
          };
        }

        // -----------------------------------------------------------------
        // strong_connections — bidirectional connections ranked by weight
        // -----------------------------------------------------------------
        case 'strong_connections': {
          if (!params.path) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'path is required for action=strong_connections',
              }, null, 2) }],
            };
          }
          const stateDb = getStateDb?.();
          if (!stateDb) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'StateDb not initialized',
              }, null, 2) }],
            };
          }
          const targets = getInboundTargetsForNote(stateDb, params.path);
          const inPlaceholders = targets.map(() => '?').join(',');
          const rows = stateDb.db.prepare(`
            SELECT target AS node, weight, 'outgoing' AS direction
            FROM note_links WHERE note_path = ?
            UNION ALL
            SELECT note_path AS node, MAX(weight) AS weight, 'incoming' AS direction
            FROM note_links WHERE target IN (${inPlaceholders})
            GROUP BY note_path
            ORDER BY weight DESC
            LIMIT ?
          `).all(params.path, ...targets, limit) as Array<{ node: string; weight: number; direction: string }>;

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              note: params.path,
              count: rows.length,
              connections: rows.map(r => ({
                node: r.node,
                weight: r.weight,
                direction: r.direction,
                resolved_path: r.direction === 'outgoing'
                  ? (resolveTarget(index, r.node) ?? undefined)
                  : undefined,
              })),
            }, null, 2) }],
          };
        }

        // -----------------------------------------------------------------
        // path — shortest connection chain between two notes
        // -----------------------------------------------------------------
        case 'path': {
          if (!params.from || !params.to) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'from and to are required for action=path',
              }, null, 2) }],
            };
          }
          const result = getLinkPath(index, params.from, params.to, 10);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              from: params.from,
              to: params.to,
              ...result,
            }, null, 2) }],
          };
        }

        // -----------------------------------------------------------------
        // neighbors — shared connections between two notes
        // -----------------------------------------------------------------
        case 'neighbors': {
          if (!params.path_a || !params.path_b) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'path_a and path_b are required for action=neighbors',
              }, null, 2) }],
            };
          }
          const result = getCommonNeighbors(index, params.path_a, params.path_b);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              note_a: params.path_a,
              note_b: params.path_b,
              common_count: result.length,
              common_neighbors: result,
            }, null, 2) }],
          };
        }

        // -----------------------------------------------------------------
        // strength — connection weight between two notes
        // -----------------------------------------------------------------
        case 'strength': {
          if (!params.path_a || !params.path_b) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'path_a and path_b are required for action=strength',
              }, null, 2) }],
            };
          }
          const result = getConnectionStrength(index, params.path_a, params.path_b);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              note_a: params.path_a,
              note_b: params.path_b,
              ...result,
            }, null, 2) }],
          };
        }

        // -----------------------------------------------------------------
        // cooccurrence_gaps — entity pairs that co-occur but lack a link
        // -----------------------------------------------------------------
        case 'cooccurrence_gaps': {
          const coocIndex = getCooccurrenceIndex();
          if (!coocIndex) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'Co-occurrence index not built yet. Wait for entity index initialization.',
              }, null, 2) }],
            };
          }

          // If entity is supplied, return that entity's co-occurrence associations
          if (params.entity) {
            const entityLower = params.entity.toLowerCase();
            const assoc = coocIndex.associations[entityLower];
            if (!assoc) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({
                  entity: params.entity,
                  neighbors: [],
                }, null, 2) }],
              };
            }
            const neighbors = Array.from(assoc.entries())
              .sort((a: [string, number], b: [string, number]) => b[1] - a[1])
              .slice(0, limit)
              .map(([name, count]: [string, number]) => ({
                entity: name,
                cooccurrence_count: count,
                has_note: resolveTarget(index, name) !== null,
              }));
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                entity: params.entity,
                neighbors,
              }, null, 2) }],
            };
          }

          // No entity: return global gaps (pairs missing a note)
          const MIN_COOC = 10;
          const gaps: Array<{
            entity_a: string;
            entity_b: string;
            cooccurrence_count: number;
            a_has_note: boolean;
            b_has_note: boolean;
          }> = [];
          const seenPairs = new Set<string>();

          for (const [entityA, associations] of Object.entries(coocIndex.associations)) {
            for (const [entityB, count] of associations) {
              if (count < MIN_COOC) continue;
              const pairKey = [entityA, entityB].sort().join('||');
              if (seenPairs.has(pairKey)) continue;
              seenPairs.add(pairKey);
              const aHasNote = resolveTarget(index, entityA) !== null;
              const bHasNote = resolveTarget(index, entityB) !== null;
              if (aHasNote && bHasNote) continue;
              gaps.push({ entity_a: entityA, entity_b: entityB, cooccurrence_count: count, a_has_note: aHasNote, b_has_note: bHasNote });
            }
          }

          gaps.sort((a, b) => b.cooccurrence_count - a.cooccurrence_count);
          const top = gaps.slice(0, limit);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              total_gaps: gaps.length,
              returned_count: top.length,
              gaps: top,
            }, null, 2) }],
          };
        }
      }
    },
  );
}
