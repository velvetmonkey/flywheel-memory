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
import type { FlywheelConfig } from '../../core/read/config.js';
import { MAX_LIMIT } from '../../core/read/constants.js';
import { requireIndex } from '../../core/read/indexGuard.js';
import { findOrphanNotes, findHubNotes, getBacklinksForNote, resolveTarget } from '../../core/read/graph.js';

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
/** Build a set of note paths that should be excluded from analysis based on config. */
function getExcludedPaths(index: VaultIndex, config: FlywheelConfig): Set<string> {
  const excluded = new Set<string>();
  const excludeTags = new Set((config.exclude_analysis_tags ?? []).map(t => t.toLowerCase()));
  const excludeEntities = new Set((config.exclude_entities ?? []).map(e => e.toLowerCase()));

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
import { getGraphEvolution, getEmergingHubs } from '../../core/shared/graphSnapshots.js';
import { hasEmbeddingsIndex, loadAllNoteEmbeddings, cosineSimilarity } from '../../core/read/embeddings.js';

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
        'Analyze vault link graph structure. Use analysis to pick the mode:\n' +
        '- "orphans": Notes with no backlinks (disconnected content)\n' +
        '- "dead_ends": Notes with backlinks but no outgoing links\n' +
        '- "sources": Notes with outgoing links but no backlinks\n' +
        '- "hubs": Highly connected notes (many links to/from)\n' +
        '- "stale": Important notes (by backlink count) not recently modified\n' +
        '- "immature": Notes scored by maturity (word count, links, frontmatter completeness, backlinks)\n' +
        '- "evolution": Graph topology metrics over time (avg_degree, cluster_count, etc.)\n' +
        '- "emerging_hubs": Entities growing fastest in connection count\n' +
        '- "semantic_clusters": Group notes by embedding similarity (requires init_semantic)\n' +
        '- "semantic_bridges": Find semantically similar but unlinked notes (highest-value link suggestions)\n\n' +
        'Example: graph_analysis({ analysis: "hubs", limit: 10 })\n' +
        'Example: graph_analysis({ analysis: "stale", days: 30, min_backlinks: 3 })\n' +
        'Example: graph_analysis({ analysis: "immature", folder: "projects", limit: 20 })\n' +
        'Example: graph_analysis({ analysis: "evolution", days: 30 })\n' +
        'Example: graph_analysis({ analysis: "emerging_hubs", days: 30 })\n' +
        'Example: graph_analysis({ analysis: "semantic_clusters", limit: 20 })\n' +
        'Example: graph_analysis({ analysis: "semantic_bridges", limit: 20 })',
      inputSchema: {
        analysis: z.enum(['orphans', 'dead_ends', 'sources', 'hubs', 'stale', 'immature', 'evolution', 'emerging_hubs', 'semantic_clusters', 'semantic_bridges']).describe('Type of graph analysis to perform'),
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
      const config = getConfig?.() ?? {};
      const excludedPaths = getExcludedPaths(index, config);

      switch (analysis) {
        case 'orphans': {
          const allOrphans = findOrphanNotes(index, folder).filter(o => !isPeriodicNote(o.path) && !excludedPaths.has(o.path));
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
          const allResults = findDeadEnds(index, folder, min_backlinks).filter(n => !excludedPaths.has(n.path));
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
          const allResults = findSources(index, folder, min_outlinks).filter(n => !excludedPaths.has(n.path));
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
          const allHubs = findHubNotes(index, min_links).filter(h => !excludedPaths.has(h.path));
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

          const result = getStaleNotes(index, days, min_backlinks).filter(n => !excludedPaths.has(n.path)).slice(0, limit);

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

          // Get notes, optionally filtered by folder, excluding periodic notes
          const allNotes = Array.from(index.notes.values()).filter(note =>
            (!folder || note.path.startsWith(folder + '/') || note.path.substring(0, note.path.lastIndexOf('/')) === folder) &&
            !isPeriodicNote(note.path) &&
            !excludedPaths.has(note.path)
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
          let hubs = getEmergingHubs(db, daysBack);

          // Filter out entities whose backing note is excluded by tags/entity name
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
          // Also filter by entity name directly (entity may not have a backing note)
          const excludeEntities = new Set((config.exclude_entities ?? []).map(e => e.toLowerCase()));
          if (excludeEntities.size > 0) {
            hubs = hubs.filter(hub => !excludeEntities.has(hub.entity.toLowerCase()));
          }

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              analysis: 'emerging_hubs',
              days_back: daysBack,
              count: hubs.length,
              hubs,
            }, null, 2) }],
          };
        }

        case 'semantic_clusters': {
          if (!hasEmbeddingsIndex()) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'Note embeddings not available. Run init_semantic first.',
              }, null, 2) }],
            };
          }

          const embeddings = loadAllNoteEmbeddings();
          const CLUSTER_THRESHOLD = 0.6;

          // Greedy clustering: pick unassigned note, gather all similar notes
          const unassigned = new Set(embeddings.keys());
          const clusters: Array<{ label: string; notes: Array<{ path: string; title: string }> }> = [];

          while (unassigned.size > 0) {
            const seedPath = unassigned.values().next().value as string;
            unassigned.delete(seedPath);
            const seedEmb = embeddings.get(seedPath)!;

            const clusterNotes: Array<{ path: string; title: string }> = [
              { path: seedPath, title: seedPath.replace(/\.md$/, '').split('/').pop() || seedPath },
            ];

            for (const candidatePath of [...unassigned]) {
              const candidateEmb = embeddings.get(candidatePath)!;
              const sim = cosineSimilarity(seedEmb, candidateEmb);
              if (sim >= CLUSTER_THRESHOLD) {
                unassigned.delete(candidatePath);
                clusterNotes.push({
                  path: candidatePath,
                  title: candidatePath.replace(/\.md$/, '').split('/').pop() || candidatePath,
                });
              }
            }

            // Only keep non-trivial clusters (2+ notes)
            if (clusterNotes.length >= 2) {
              // Label from common path prefix or first note title
              const commonPrefix = clusterNotes[0].path.split('/').slice(0, -1).join('/');
              const label = commonPrefix || clusterNotes[0].title;
              clusters.push({ label, notes: clusterNotes });
            }
          }

          // Sort by cluster size descending
          clusters.sort((a, b) => b.notes.length - a.notes.length);
          const paginated = clusters.slice(offset, offset + limit);

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              analysis: 'semantic_clusters',
              total_clusters: clusters.length,
              returned_count: paginated.length,
              clusters: paginated.map(c => ({
                label: c.label,
                note_count: c.notes.length,
                notes: c.notes,
              })),
            }, null, 2) }],
          };
        }

        case 'semantic_bridges': {
          if (!hasEmbeddingsIndex()) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'Note embeddings not available. Run init_semantic first.',
              }, null, 2) }],
            };
          }

          const embeddings = loadAllNoteEmbeddings();
          const BRIDGE_SIM_THRESHOLD = 0.5;

          // Build a set of direct link pairs for fast lookup
          const linkedPairs = new Set<string>();
          for (const note of index.notes.values()) {
            for (const link of note.outlinks) {
              const targetPath = resolveTarget(index, link.target);
              if (targetPath) {
                // Store both directions for undirected check
                linkedPairs.add(`${note.path}|${targetPath}`);
                linkedPairs.add(`${targetPath}|${note.path}`);
              }
            }
          }

          // Also check 2-hop connections
          const twoHopConnected = (pathA: string, pathB: string): boolean => {
            if (linkedPairs.has(`${pathA}|${pathB}`)) return true;
            // Check if they share a common neighbor
            const noteA = index.notes.get(pathA);
            const noteB = index.notes.get(pathB);
            if (!noteA || !noteB) return false;

            const neighborsA = new Set<string>();
            for (const link of noteA.outlinks) {
              const resolved = resolveTarget(index, link.target);
              if (resolved) neighborsA.add(resolved);
            }
            // Also add notes linking TO A
            const backlinksA = getBacklinksForNote(index, pathA);
            for (const bl of backlinksA) {
              neighborsA.add(bl.source);
            }

            for (const link of noteB.outlinks) {
              const resolved = resolveTarget(index, link.target);
              if (resolved && neighborsA.has(resolved)) return true;
            }
            const backlinksB = getBacklinksForNote(index, pathB);
            for (const bl of backlinksB) {
              if (neighborsA.has(bl.source)) return true;
            }
            return false;
          };

          // Find pairs with high semantic similarity but no link connection
          const paths = [...embeddings.keys()];
          const bridges: Array<{
            noteA: { path: string; title: string };
            noteB: { path: string; title: string };
            similarity: number;
          }> = [];

          for (let i = 0; i < paths.length; i++) {
            const embA = embeddings.get(paths[i])!;
            for (let j = i + 1; j < paths.length; j++) {
              const sim = cosineSimilarity(embA, embeddings.get(paths[j])!);
              if (sim >= BRIDGE_SIM_THRESHOLD && !twoHopConnected(paths[i], paths[j])) {
                bridges.push({
                  noteA: { path: paths[i], title: paths[i].replace(/\.md$/, '').split('/').pop() || paths[i] },
                  noteB: { path: paths[j], title: paths[j].replace(/\.md$/, '').split('/').pop() || paths[j] },
                  similarity: Math.round(sim * 1000) / 1000,
                });
              }
            }
          }

          // Sort by similarity descending (highest-value suggestions first)
          bridges.sort((a, b) => b.similarity - a.similarity);
          const paginatedBridges = bridges.slice(offset, offset + limit);

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              analysis: 'semantic_bridges',
              total_bridges: bridges.length,
              returned_count: paginatedBridges.length,
              description: 'Notes with high semantic similarity but no direct or 2-hop link path. These represent the highest-value missing link suggestions.',
              bridges: paginatedBridges,
            }, null, 2) }],
          };
        }
      }
    }
  );
}
