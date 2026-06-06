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
  classifyUncategorizedEntities,
  saveInferredCategories,
  setEmbeddingsBuildState,
  setEmbeddingsBuilding,
  isEmbeddingsBuilding,
  getEmbeddingsCount,
  getEntityEmbeddingsCount,
  getStoredEmbeddingModel,
  getActiveModelId,
  clearEmbeddingsForRebuild,
  diagnoseEmbeddings,
} from '../../core/read/embeddings.js';
import { getAllEntitiesFromDb, setWriteState } from '@velvetmonkey/vault-core';
import { getActiveScopeOrNull, runInVaultScope } from '../../vault-scope.js';

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
        'Run once to build vector embeddings for hybrid search. Produces an embedding index over all notes and entities. Returns embedding count and build duration. Does not run automatically — must be invoked explicitly. After building, search (action=query and action=similar) automatically uses semantic matching alongside BM25.',
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
          // Repair stale embeddings_state (diagnoseEmbeddings checks content
          // health only, not the state flag — it can be healthy while state
          // is stuck at building_* from a crash)
          setEmbeddingsBuildState('complete');
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

      // Guard: a build is already running (boot fire-and-forget or a prior
      // init_semantic call) — never launch a second concurrent build.
      if (isEmbeddingsBuilding()) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              started: false,
              already_building: true,
              current_embeddings_count: getEmbeddingsCount(),
              hint: 'A build is already running. Poll doctor(action: "health") — watch embeddings_building / embeddings_count.',
            }, null, 2),
          }],
        };
      }

      const { scanVault } = await import('../../core/read/vault.js');
      const files = await scanVault(vaultPath);
      const estimatedSeconds = Math.ceil(files.length * 0.1);
      const estimatedMinutes = Math.ceil(estimatedSeconds / 60);
      console.error(`[Semantic] Starting background embedding build for ${files.length} notes (estimated ${estimatedMinutes > 1 ? `~${estimatedMinutes} minutes` : `~${estimatedSeconds} seconds`})...`);

      // Mark building SYNCHRONOUSLY before returning so a doctor call issued
      // right after this returns already reports embeddings_building: true.
      setEmbeddingsBuilding(true);
      setEmbeddingsBuildState('building_notes');

      const startedAt = Date.now();
      try {
        setWriteState(stateDb, 'last_embedding_build', {
          started_at: startedAt, status: 'building', total_notes: files.length, trigger: 'init_semantic',
        });
      } catch { /* non-critical telemetry */ }

      // The full build over a large vault takes tens of minutes — far past any
      // MCP client timeout. Run it fire-and-forget (the boot path's pattern)
      // and return immediately; progress is observable via doctor health
      // (embeddings_building / embeddings_count climb live via per-note upserts).
      const runBuild = async (): Promise<void> => {
        const buildStart = Date.now();
        try {
          const progress = await buildEmbeddingsIndex(vaultPath, (p) => {
            const pct = p.total > 0 ? Math.round((p.current / p.total) * 100) : 0;
            const elapsed = Math.round((Date.now() - buildStart) / 1000);
            if (p.current % 250 === 0 || p.current === p.total) {
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
                if (done % 250 === 0 || done === total) {
                  const elapsed = Math.round((Date.now() - entityStart) / 1000);
                  console.error(`[Semantic] Entity embeddings: ${done}/${total} (${pct}%, ${elapsed}s elapsed)...`);
                }
              });
              loadEntityEmbeddingsToMemory();
              saveInferredCategories(classifyUncategorizedEntities(
                allEntities.map(entity => ({
                  entity: {
                    name: entity.name,
                    path: entity.path,
                    aliases: entity.aliases,
                  },
                  category: entity.category,
                }))
              ));
            }
          } catch (err) {
            console.error('[Semantic] Entity embeddings failed:', err instanceof Error ? err.message : err);
          }

          setEmbeddingsBuildState('complete');
          const totalElapsed = Math.round((Date.now() - buildStart) / 1000);
          console.error(`[Semantic] Build complete in ${totalElapsed}s: ${embedded} notes + ${entityEmbedded} entities embedded.`);
          try {
            setWriteState(stateDb, 'last_embedding_build', {
              started_at: startedAt, finished_at: Date.now(), status: 'complete',
              embedded, entity_embedded: entityEmbedded, total_notes: progress.total,
              build_time_seconds: totalElapsed, trigger: 'init_semantic',
            });
          } catch { /* non-critical telemetry */ }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[Semantic] Background build failed: ${msg}`);
          try {
            setWriteState(stateDb, 'last_embedding_build', {
              started_at: startedAt, finished_at: Date.now(), status: 'failed', error: msg, trigger: 'init_semantic',
            });
          } catch { /* non-critical telemetry */ }
        } finally {
          // Always release the building flag — a stuck flag blocks every
          // future build (the already_building guard above).
          setEmbeddingsBuilding(false);
        }
      };

      // Pin the build to this vault's scope so getDb()/state setters resolve
      // to the right vault even if another vault activates meanwhile
      // (multi-vault: the boot path re-activates between phases for the same
      // reason). runBuild's try/catch/finally is total, the outer catch is
      // belt-and-braces against unhandled rejection.
      const scope = getActiveScopeOrNull();
      void (scope ? runInVaultScope(scope, runBuild) : runBuild()).catch((err) => {
        console.error(`[Semantic] Background build crashed: ${err instanceof Error ? err.message : err}`);
        setEmbeddingsBuilding(false);
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            started: true,
            total_notes: files.length,
            current_embeddings_count: getEmbeddingsCount(),
            entity_total: getEntityEmbeddingsCount(),
            estimated_minutes: estimatedMinutes,
            hint: 'Embedding build started in background. Poll doctor(action: "health") — embeddings_building flips false and embeddings_count climbs as notes embed. Searches use hybrid ranking once complete.',
          }, null, 2),
        }],
      };
    }
  );
}
