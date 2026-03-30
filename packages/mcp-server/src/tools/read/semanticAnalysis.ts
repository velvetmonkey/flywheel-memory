/**
 * Semantic Analysis - Embedding-based vault analysis
 *
 * Extracted from graph_analysis: semantic_clusters + semantic_bridges
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import { MAX_LIMIT } from '../../core/read/constants.js';
import { requireIndex } from '../../core/read/indexGuard.js';
import { hasEmbeddingsIndex, loadAllNoteEmbeddings, cosineSimilarity } from '../../core/read/embeddings.js';
import { resolveTarget, getBacklinksForNote } from '../../core/read/graph.js';

/**
 * Register the semantic_analysis tool
 */
export function registerSemanticAnalysisTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string,
): void {
  server.registerTool(
    'semantic_analysis',
    {
      title: 'Semantic Analysis',
      description:
        'Analyze vault using note embeddings. Requires init_semantic first. Modes: clusters (group notes by embedding similarity via greedy clustering), bridges (find semantically similar but unlinked notes for highest-value link suggestions). Returns scored note groups with similarity metrics.',
      inputSchema: {
        type: z.enum(['clusters', 'bridges']).describe('Type of semantic analysis'),
        limit: z.coerce.number().default(50).describe('Maximum number of results to return'),
        offset: z.coerce.number().default(0).describe('Number of results to skip (for pagination)'),
      },
    },
    async ({ type, limit: requestedLimit, offset }) => {
      requireIndex();
      const limit = Math.min(requestedLimit ?? 50, MAX_LIMIT);
      const index = getIndex();

      if (!hasEmbeddingsIndex()) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            error: 'Note embeddings not available. Run init_semantic first.',
          }, null, 2) }],
        };
      }

      switch (type) {
        case 'clusters': {
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

        case 'bridges': {
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
