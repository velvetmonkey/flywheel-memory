/**
 * Content Similarity tools
 * Tools: find_similar
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import { findSimilarNotes, findHybridSimilarNotes } from '../../core/read/similarity.js';
import { hasEmbeddingsIndex } from '../../core/read/embeddings.js';

/**
 * Register content similarity tools
 */
export function registerSimilarityTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string,
  getStateDb: () => StateDb | null
): void {
  server.registerTool(
    'find_similar',
    {
      title: 'Find Similar Notes',
      description:
        'Use when finding notes related to a specific note by content overlap. Produces a ranked list of similar notes using FTS5 keyword matching and optional semantic similarity. Returns note paths with similarity scores and shared terms. Does not search by arbitrary query text — use search for free-text queries.',
      inputSchema: {
        path: z.string().describe('Path to the source note (relative to vault root, e.g. "projects/alpha.md")'),
        limit: z.number().optional().describe('Maximum number of similar notes to return (default: 10)'),
        diversity: z.number().min(0).max(1).optional().describe('Relevance vs diversity tradeoff (0=max diversity, 1=pure relevance, default: 0.7)'),
      },
    },
    async ({ path, limit, diversity }) => {
      const index = getIndex();
      const vaultPath = getVaultPath();
      const stateDb = getStateDb();

      if (!stateDb) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available' }) }],
        };
      }

      // Verify the source note exists in the index
      if (!index.notes.has(path)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            error: `Note not found: ${path}`,
            hint: 'Use the full relative path including .md extension',
          }, null, 2) }],
        };
      }

      const opts = {
        limit: limit ?? 10,
        excludeLinked: true,
        diversity: diversity ?? 0.7,
      };

      const useHybrid = hasEmbeddingsIndex();
      const method = useHybrid ? 'hybrid' : 'bm25';

      const results = useHybrid
        ? await findHybridSimilarNotes(stateDb.db, vaultPath, index, path, opts)
        : findSimilarNotes(stateDb.db, vaultPath, index, path, opts);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            source: path,
            method,
            count: results.length,
            similar: results,
          }, null, 2),
        }],
      };
    }
  );
}
