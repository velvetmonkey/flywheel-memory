/**
 * Semantic search initialization tool
 * Tool: init_semantic
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import {
  setEmbeddingsDatabase,
  buildEmbeddingsIndex,
  buildEntityEmbeddingsIndex,
  loadEntityEmbeddingsToMemory,
  setEmbeddingsBuildState,
  getEntityEmbeddingsCount,
  getStoredEmbeddingModel,
  getActiveModelId,
  clearEmbeddingsForRebuild,
  diagnoseEmbeddings,
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
        'Run once per vault — subsequent calls verify health and skip already-embedded notes unless force=true.',
      inputSchema: {
        force: z.boolean().optional().describe(
          'Clear and rebuild all embeddings from scratch (default: false)'
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

      const vaultPath = getVaultPath();

      // Quick health check — if not forced and already healthy, return diagnosis
      if (!force) {
        const diagnosis = diagnoseEmbeddings(vaultPath);
        if (diagnosis.healthy) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                already_built: true,
                embedded: diagnosis.counts.embedded,
                checks: diagnosis.checks,
                hint: 'Embeddings healthy. All searches automatically use hybrid ranking.',
              }, null, 2),
            }],
          };
        }
      }

      // Model change or force → full clear
      const storedModel = getStoredEmbeddingModel();
      if (force || (storedModel && storedModel !== getActiveModelId())) {
        const reason = force ? 'force=true' : `model changed ${storedModel} → ${getActiveModelId()}`;
        console.error(`[Semantic] Clearing embeddings: ${reason}`);
        clearEmbeddingsForRebuild();
      }

      // Build notes (handles version bumps, completeness, orphans via content hash)
      const buildStart = Date.now();

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

      setEmbeddingsBuildState('complete');

      const totalElapsed = Math.round((Date.now() - buildStart) / 1000);
      console.error(`[Semantic] Build complete in ${totalElapsed}s: ${embedded} notes + ${entityEmbedded} entities embedded.`);

      // Post-build verification
      const diagnosis = diagnoseEmbeddings(vaultPath);

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
            checks: diagnosis.checks,
            hint: 'Embeddings built. All searches now automatically use hybrid ranking.',
          }, null, 2),
        }],
      };
    }
  );
}
