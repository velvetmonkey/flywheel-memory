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
  hasStaleEmbeddings,
  getEmbeddingsCount,
  buildEmbeddingsIndex,
  buildEntityEmbeddingsIndex,
  loadEntityEmbeddingsToMemory,
  getEntityEmbeddingsCount,
} from '../../core/read/embeddings.js';
import { getAllEntitiesFromDb } from '@velvetmonkey/vault-core';

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

      // Check if already built and up-to-date
      if (hasEmbeddingsIndex() && !force) {
        const vaultPathForCheck = getVaultPath();
        const stale = hasStaleEmbeddings(vaultPathForCheck);
        if (!stale) {
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
        console.error('[Semantic] Stale embeddings detected (EMBEDDING_TEXT_VERSION changed) — rebuilding...');
      }

      // Build index with progress logging
      const vaultPath = getVaultPath();
      const buildStart = Date.now();

      // Estimate build time (~100ms per note for embedding generation)
      const { scanVault } = await import('../../core/read/vault.js');
      const files = await scanVault(vaultPath);
      const estimatedSeconds = Math.ceil(files.length * 0.1);
      const estimatedMinutes = Math.ceil(estimatedSeconds / 60);
      console.error(`[Semantic] Starting embedding build for ${files.length} notes (estimated ${estimatedMinutes > 1 ? `~${estimatedMinutes} minutes` : `~${estimatedSeconds} seconds`})...`);

      const progress = await buildEmbeddingsIndex(vaultPath, (p) => {
        const pct = p.total > 0 ? Math.round((p.current / p.total) * 100) : 0;
        const elapsed = Math.round((Date.now() - buildStart) / 1000);
        if (p.current % 50 === 0 || p.current === p.total) {
          console.error(`[Semantic] Note embeddings: ${p.current}/${p.total} (${pct}%, ${p.skipped} skipped, ${elapsed}s elapsed)...`);
        }
      });

      const embedded = progress.total - progress.skipped;

      // Build entity embeddings
      let entityEmbedded = 0;
      try {
        const allEntities = getAllEntitiesFromDb(stateDb);
        const entityMap = new Map<string, { name: string; path: string; category: string; aliases: string[] }>();
        for (const e of allEntities) {
          entityMap.set(e.name, {
            name: e.name,
            path: e.path,
            category: e.category,
            aliases: e.aliases,
          });
        }

        if (entityMap.size > 0) {
          const entityStart = Date.now();
          console.error(`[Semantic] Starting entity embeddings for ${entityMap.size} entities...`);
          entityEmbedded = await buildEntityEmbeddingsIndex(vaultPath, entityMap, (done, total) => {
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            if (done % 50 === 0 || done === total) {
              const elapsed = Math.round((Date.now() - entityStart) / 1000);
              console.error(`[Semantic] Entity embeddings: ${done}/${total} (${pct}%, ${elapsed}s elapsed)...`);
            }
          });
          loadEntityEmbeddingsToMemory();
        }
      } catch (err) {
        console.error('[Semantic] Entity embeddings failed:', err instanceof Error ? err.message : err);
      }

      const totalElapsed = Math.round((Date.now() - buildStart) / 1000);
      console.error(`[Semantic] Build complete in ${totalElapsed}s: ${embedded} notes + ${entityEmbedded} entities embedded.`);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            embedded,
            skipped: progress.skipped,
            total: progress.total,
            entity_embeddings: entityEmbedded,
            entity_total: getEntityEmbeddingsCount(),
            build_time_seconds: totalElapsed,
            hint: 'Embeddings built. All searches now automatically use hybrid ranking.',
          }, null, 2),
        }],
      };
    }
  );
}
