/**
 * Content Similarity tools
 * Tools: find_similar
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import { findSimilarNotes } from '../../core/read/similarity.js';

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
        'Find notes similar to a given note using FTS5 BM25 content similarity. ' +
        'Extracts key terms from the source note, queries the full-text index, and ranks by relevance. ' +
        'Use exclude_linked to filter out notes already connected via wikilinks.',
      inputSchema: {
        path: z.string().describe('Path to the source note (relative to vault root, e.g. "projects/alpha.md")'),
        limit: z.number().optional().describe('Maximum number of similar notes to return (default: 10)'),
        exclude_linked: z.boolean().optional().describe('Exclude notes already linked to/from the source note (default: true)'),
      },
    },
    async ({ path, limit, exclude_linked }) => {
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

      const results = findSimilarNotes(stateDb.db, vaultPath, index, path, {
        limit: limit ?? 10,
        excludeLinked: exclude_linked ?? true,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            source: path,
            exclude_linked: exclude_linked ?? true,
            count: results.length,
            similar: results,
          }, null, 2),
        }],
      };
    }
  );
}
