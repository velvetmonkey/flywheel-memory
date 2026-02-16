/**
 * Semantic search initialization tool
 * Tool: init_semantic
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import {
  setEmbeddingsDatabase,
  hasEmbeddingsIndex,
  getEmbeddingsCount,
  buildEmbeddingsIndex,
} from '../../core/read/embeddings.js';

/**
 * Register semantic search tools
 */
export function registerSemanticTools(
  server: McpServer,
  getVaultPath: () => string,
  getStateDb: () => StateDb | null
): void {
  server.registerTool(
    'init_semantic',
    {
      title: 'Initialize Semantic Search',
      description:
        'Download the embedding model and build semantic search index for this vault. ' +
        'After running, search and find_similar automatically use hybrid ranking (BM25 + semantic). ' +
        'Run once per vault — subsequent calls skip already-embedded notes unless force=true.',
      inputSchema: {
        force: z.boolean().optional().describe(
          'Rebuild all embeddings even if they already exist (default: false)'
        ),
      },
    },
    async ({ force }) => {
      const stateDb = getStateDb();
      if (!stateDb) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: 'StateDb not available — vault may not be initialized yet' }),
          }],
        };
      }

      // Inject db handle (idempotent)
      setEmbeddingsDatabase(stateDb.db);

      // Check if already built
      if (hasEmbeddingsIndex() && !force) {
        const count = getEmbeddingsCount();
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              already_built: true,
              embedded: count,
              hint: 'Embeddings already built. All searches automatically use hybrid ranking.',
            }, null, 2),
          }],
        };
      }

      // Build index with progress logging
      const vaultPath = getVaultPath();
      const progress = await buildEmbeddingsIndex(vaultPath, (p) => {
        if (p.current % 50 === 0 || p.current === p.total) {
          console.error(`[Semantic] Embedding ${p.current}/${p.total} notes (${p.skipped} skipped)...`);
        }
      });

      const embedded = progress.total - progress.skipped;
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            embedded,
            skipped: progress.skipped,
            total: progress.total,
            hint: 'Embeddings built. All searches now automatically use hybrid ranking.',
          }, null, 2),
        }],
      };
    }
  );
}
