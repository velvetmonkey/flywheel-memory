/**
 * System and utility tools - infrastructure primitives for v2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import { buildVaultIndex, setIndexState, setIndexError, saveVaultIndexToCache } from '../../core/read/graph.js';
import { loadConfig, inferConfig, saveConfig, DEFAULT_ENTITY_EXCLUDE_FOLDERS, getExcludeTags, type FlywheelConfig } from '../../core/read/config.js';
import { buildFTS5Index } from '../../core/read/fts5.js';
import { scanVaultEntities, getEntityIndexFromDb, getAllEntitiesFromDb, type StateDb } from '@velvetmonkey/vault-core';
import { suggestEntityAliases } from '../../core/read/aliasSuggestions.js';
import { createStepTracker, recordIndexEvent } from '../../core/shared/indexActivity.js';
import { MAX_LIMIT } from '../../core/read/constants.js';
import { requireIndex } from '../../core/read/indexGuard.js';
import { countFTS5Mentions } from '../../core/read/fts5.js';
import { recomputeEdgeWeights } from '../../core/write/edgeWeights.js';
import {
  hasEmbeddingsIndex,
  buildEmbeddingsIndex,
  buildEntityEmbeddingsIndex,
  hasEntityEmbeddingsIndex,
  loadEntityEmbeddingsToMemory,
  classifyUncategorizedEntities,
  saveInferredCategories,
  getInferredCategory,
} from '../../core/read/embeddings.js';
import { initializeEntityIndex, setCooccurrenceIndex } from '../../core/write/wikilinks.js';
import { exportHubScores } from '../../core/shared/hubExport.js';
import { computeGraphMetrics, recordGraphSnapshot } from '../../core/shared/graphSnapshots.js';
import { updateSuppressionList, updateStoredNoteLinks } from '../../core/write/wikilinkFeedback.js';
import { buildTaskCache } from '../../core/read/taskCache.js';
import { buildRecencyIndex, saveRecencyToStateDb } from '../../core/shared/recency.js';
import { mineCooccurrences, saveCooccurrenceToStateDb } from '../../core/shared/cooccurrence.js';

/**
 * Register system/utility tools with the MCP server
 */
export function registerSystemTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  setIndex: (index: VaultIndex) => void,
  getVaultPath: () => string,
  setConfig?: (config: FlywheelConfig) => void,
  getStateDb?: () => StateDb | null
) {
  // refresh_index - Rebuild vault index + FTS5 search index without server restart
  const RefreshIndexOutputSchema = {
    success: z.boolean().describe('Whether the refresh succeeded'),
    notes_count: z.number().describe('Number of notes indexed'),
    entities_count: z.number().describe('Number of entities (titles + aliases)'),
    fts5_notes: z.number().describe('Number of notes in FTS5 search index'),
    edges_recomputed: z.number().optional().describe('Number of edges with recomputed weights'),
    note_links_synced: z.number().optional().describe('Number of notes whose note_links were synced'),
    hub_scores: z.number().optional().describe('Number of hub scores exported'),
    graph_snapshot: z.boolean().optional().describe('Whether graph topology snapshot was recorded'),
    suppression_list: z.boolean().optional().describe('Whether wikilink suppression list was updated'),
    task_cache: z.boolean().optional().describe('Whether task cache was refreshed'),
    embeddings_refreshed: z.number().optional().describe('Number of note embeddings updated'),
    entity_embeddings_refreshed: z.number().optional().describe('Number of entity embeddings updated'),
    recency_rebuilt: z.boolean().optional().describe('Whether recency index was rebuilt'),
    cooccurrence_associations: z.number().optional().describe('Number of co-occurrence associations rebuilt'),
    index_cached: z.boolean().optional().describe('Whether vault index cache was saved'),
    duration_ms: z.number().describe('Time taken to rebuild index'),
  };

  type RefreshIndexOutput = {
    success: boolean;
    notes_count: number;
    entities_count: number;
    fts5_notes: number;
    edges_recomputed?: number;
    note_links_synced?: number;
    hub_scores?: number;
    graph_snapshot?: boolean;
    suppression_list?: boolean;
    task_cache?: boolean;
    embeddings_refreshed?: number;
    entity_embeddings_refreshed?: number;
    recency_rebuilt?: boolean;
    cooccurrence_associations?: number;
    index_cached?: boolean;
    duration_ms: number;
  };

  server.registerTool(
    'refresh_index',
    {
      title: 'Refresh Index',
      description:
        'Use when the vault index seems stale or after bulk external edits. Produces a full rebuild of the vault index and FTS5 search database. Returns rebuild duration and note count. Does not restart the server — only rebuilds the in-memory index.',
      inputSchema: {},
      outputSchema: RefreshIndexOutputSchema,
    },
    async (): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      structuredContent: RefreshIndexOutput;
    }> => {
      const vaultPath = getVaultPath();
      const startTime = Date.now();
      const tracker = createStepTracker();

      // Mark index as building during refresh
      setIndexState('building');
      setIndexError(null);

      try {
        // Step 1: Rebuild vault index
        tracker.start('vault_index', {});
        const newIndex = await buildVaultIndex(vaultPath);
        setIndex(newIndex);
        setIndexState('ready');
        tracker.end({ notes: newIndex.notes.size, entities: newIndex.entities.size });

        // Step 2: Update entities in StateDb
        const stateDb = getStateDb?.();
        if (stateDb) {
          tracker.start('entity_sync', {});
          try {
            const config = loadConfig(stateDb);
            const excludeFolders = config.exclude_entity_folders?.length
              ? config.exclude_entity_folders
              : DEFAULT_ENTITY_EXCLUDE_FOLDERS;
            const entityIndex = await scanVaultEntities(vaultPath, {
              excludeFolders,
              customCategories: config.custom_categories,
            });
            stateDb.replaceAllEntities(entityIndex);
            tracker.end({ entities: entityIndex._metadata.total_entities });
            console.error(`[Flywheel] Updated ${entityIndex._metadata.total_entities} entities in StateDb`);
          } catch (e) {
            tracker.end({ error: String(e) });
            console.error('[Flywheel] Failed to update entities:', e);
          }
        }

        // Step 3: Infer config from vault, merge with existing, save
        let flywheelConfig: FlywheelConfig | undefined;
        if (setConfig) {
          tracker.start('config_merge', {});
          const existing = loadConfig(stateDb);
          const inferred = inferConfig(newIndex, vaultPath);
          if (stateDb) {
            saveConfig(stateDb, inferred, existing);
          }
          flywheelConfig = loadConfig(stateDb);
          setConfig(flywheelConfig);
          tracker.end({});
        }

        // Step 4: Rebuild FTS5 search index
        let fts5Notes = 0;
        tracker.start('fts5_rebuild', {});
        try {
          const ftsState = await buildFTS5Index(vaultPath);
          fts5Notes = ftsState.noteCount;
          tracker.end({ notes: fts5Notes });
          console.error(`[Flywheel] FTS5 index rebuilt: ${fts5Notes} notes`);
        } catch (err) {
          tracker.end({ error: String(err) });
          console.error('[Flywheel] FTS5 rebuild failed:', err);
        }


        // Step 4b: Sync note_links from rebuilt VaultIndex
        let noteLinksSynced = 0;
        if (stateDb) {
          tracker.start('note_links_sync', {});
          try {
            const indexPaths = new Set<string>();
            for (const [notePath, note] of newIndex.notes) {
              indexPaths.add(notePath);
              const targets = new Set(note.outlinks.map(link => link.target.toLowerCase()));
              updateStoredNoteLinks(stateDb, notePath, targets);
              noteLinksSynced++;
            }
            // Remove stale source rows for notes no longer in the index
            const dbSourcePaths = stateDb.db.prepare(
              'SELECT DISTINCT note_path FROM note_links'
            ).all() as Array<{ note_path: string }>;
            for (const row of dbSourcePaths) {
              if (!indexPaths.has(row.note_path)) {
                stateDb.db.prepare('DELETE FROM note_links WHERE note_path = ?').run(row.note_path);
              }
            }
            tracker.end({ notes: noteLinksSynced });
            console.error(`[Flywheel] note_links synced for ${noteLinksSynced} notes`);
          } catch (err) {
            tracker.end({ error: String(err) });
            console.error('[Flywheel] note_links sync failed:', err);
          }
        }
        // Step 5: Recompute edge weights
        let edgesRecomputed = 0;
        if (stateDb) {
          tracker.start('edge_weights', {});
          try {
            const edgeResult = recomputeEdgeWeights(stateDb);
            edgesRecomputed = edgeResult.edges_updated;
            tracker.end({ edges: edgeResult.edges_updated, duration_ms: edgeResult.duration_ms });
            console.error(`[Flywheel] Edge weights: ${edgeResult.edges_updated} edges in ${edgeResult.duration_ms}ms`);
          } catch (err) {
            tracker.end({ error: String(err) });
            console.error('[Flywheel] Edge weight recompute failed:', err);
          }
        }

        // Step 6: Initialize wikilink entity index from StateDb
        tracker.start('entity_index_init', {});
        try {
          await initializeEntityIndex(vaultPath);
          tracker.end({});
          console.error('[Flywheel] Entity index initialized');
        } catch (err) {
          tracker.end({ error: String(err) });
          console.error('[Flywheel] Entity index init failed:', err);
        }

        // Step 7: Export hub scores
        let hubScoresExported = 0;
        tracker.start('hub_scores', {});
        try {
          hubScoresExported = await exportHubScores(newIndex, stateDb);
          tracker.end({ exported: hubScoresExported });
          if (hubScoresExported > 0) {
            console.error(`[Flywheel] Hub scores: ${hubScoresExported} entities`);
          }
        } catch (err) {
          tracker.end({ error: String(err) });
          console.error('[Flywheel] Hub score export failed:', err);
        }

        // Step 8: Record graph topology snapshot
        let graphSnapshotRecorded = false;
        if (stateDb) {
          tracker.start('graph_snapshot', {});
          try {
            const graphMetrics = computeGraphMetrics(newIndex);
            recordGraphSnapshot(stateDb, graphMetrics);
            graphSnapshotRecorded = true;
            tracker.end({ recorded: true });
          } catch (err) {
            tracker.end({ error: String(err) });
            console.error('[Flywheel] Graph snapshot failed:', err);
          }
        }

        // Step 9: Update wikilink suppression list
        let suppressionUpdated = false;
        if (stateDb) {
          tracker.start('suppression_list', {});
          try {
            updateSuppressionList(stateDb);
            suppressionUpdated = true;
            tracker.end({ updated: true });
          } catch (err) {
            tracker.end({ error: String(err) });
            console.error('[Flywheel] Suppression list update failed:', err);
          }
        }

        // Step 10: Rebuild recency index
        let recencyRebuilt = false;
        if (stateDb) {
          tracker.start('recency', {});
          try {
            const entities = getAllEntitiesFromDb(stateDb).map((e: { name: string; path: string; aliases: string[] }) => ({
              name: e.name, path: e.path, aliases: e.aliases,
            }));
            const recencyIndex = await buildRecencyIndex(vaultPath, entities);
            saveRecencyToStateDb(recencyIndex, stateDb);
            recencyRebuilt = true;
            tracker.end({ entities: recencyIndex.lastMentioned.size });
            console.error(`[Flywheel] Recency: rebuilt ${recencyIndex.lastMentioned.size} entities`);
          } catch (err) {
            tracker.end({ error: String(err) });
            console.error('[Flywheel] Recency rebuild failed:', err);
          }
        }

        // Step 11: Rebuild co-occurrence index
        let cooccurrenceAssociations: number | undefined;
        if (stateDb) {
          tracker.start('cooccurrence', {});
          try {
            const entityNames = getAllEntitiesFromDb(stateDb).map((e: { name: string }) => e.name);
            const cooccurrenceIdx = await mineCooccurrences(vaultPath, entityNames);
            setCooccurrenceIndex(cooccurrenceIdx);
            saveCooccurrenceToStateDb(stateDb, cooccurrenceIdx);
            cooccurrenceAssociations = cooccurrenceIdx._metadata.total_associations;
            tracker.end({ associations: cooccurrenceAssociations });
            console.error(`[Flywheel] Co-occurrence: rebuilt ${cooccurrenceAssociations} associations`);
          } catch (err) {
            tracker.end({ error: String(err) });
            console.error('[Flywheel] Co-occurrence rebuild failed:', err);
          }
        }

        // Step 12: Force-rebuild task cache
        let taskCacheRefreshed = false;
        tracker.start('task_cache', {});
        try {
          if (!flywheelConfig) {
            flywheelConfig = loadConfig(stateDb);
          }
          await buildTaskCache(vaultPath, newIndex, getExcludeTags(flywheelConfig));
          taskCacheRefreshed = true;
          tracker.end({ rebuilt: true });
          console.error('[Flywheel] Task cache rebuilt');
        } catch (err) {
          tracker.end({ error: String(err) });
          console.error('[Flywheel] Task cache rebuild failed:', err);
        }

        // Step 13: Sync note embeddings with current vault state (incremental — skips unchanged notes)
        let embeddingsRefreshed = 0;
        if (hasEmbeddingsIndex()) {
          tracker.start('embeddings_sync', {});
          try {
            const progress = await buildEmbeddingsIndex(vaultPath);
            embeddingsRefreshed = progress.total - progress.skipped;
            tracker.end({ refreshed: embeddingsRefreshed });
            if (embeddingsRefreshed > 0) {
              console.error(`[Flywheel] Embeddings: ${embeddingsRefreshed} notes updated`);
            }
          } catch (err) {
            tracker.end({ error: String(err) });
            console.error('[Flywheel] Embedding sync failed:', err);
          }
        }

        // Step 14: Sync entity embeddings
        let entityEmbeddingsRefreshed = 0;
        if (stateDb && hasEntityEmbeddingsIndex()) {
          tracker.start('entity_embeddings', {});
          try {
            const entities = getAllEntitiesFromDb(stateDb);
            if (entities.length > 0) {
              const entityMap = new Map(entities.map(e => [e.name, {
                name: e.name,
                path: e.path,
                category: e.category,
                aliases: e.aliases,
              }]));
              entityEmbeddingsRefreshed = await buildEntityEmbeddingsIndex(vaultPath, entityMap);
              loadEntityEmbeddingsToMemory();
              saveInferredCategories(classifyUncategorizedEntities(
                entities.map(entity => ({
                  entity: {
                    name: entity.name,
                    path: entity.path,
                    aliases: entity.aliases,
                  },
                  category: entity.category,
                }))
              ));
              tracker.end({ refreshed: entityEmbeddingsRefreshed });
              if (entityEmbeddingsRefreshed > 0) {
                console.error(`[Flywheel] Entity embeddings: ${entityEmbeddingsRefreshed} updated`);
              }
            } else {
              tracker.end({ refreshed: 0 });
            }
          } catch (err) {
            tracker.end({ error: String(err) });
            console.error('[Flywheel] Entity embedding sync failed:', err);
          }
        }

        // Step 15: Save vault index cache
        let indexCached = false;
        if (stateDb) {
          tracker.start('index_cache', {});
          try {
            saveVaultIndexToCache(stateDb, newIndex);
            indexCached = true;
            tracker.end({ cached: true });
          } catch (err) {
            tracker.end({ error: String(err) });
            console.error('[Flywheel] Index cache save failed:', err);
          }
        }

        const duration = Date.now() - startTime;

        // Record index event with per-step telemetry
        if (stateDb) {
          recordIndexEvent(stateDb, {
            trigger: 'manual_refresh',
            duration_ms: duration,
            note_count: newIndex.notes.size,
            steps: tracker.steps,
          });
        }

        const output: RefreshIndexOutput = {
          success: true,
          notes_count: newIndex.notes.size,
          entities_count: newIndex.entities.size,
          fts5_notes: fts5Notes,
          edges_recomputed: edgesRecomputed,
          note_links_synced: noteLinksSynced || undefined,
          hub_scores: hubScoresExported || undefined,
          graph_snapshot: graphSnapshotRecorded || undefined,
          suppression_list: suppressionUpdated || undefined,
          task_cache: taskCacheRefreshed || undefined,
          embeddings_refreshed: embeddingsRefreshed || undefined,
          entity_embeddings_refreshed: entityEmbeddingsRefreshed || undefined,
          recency_rebuilt: recencyRebuilt || undefined,
          cooccurrence_associations: cooccurrenceAssociations,
          index_cached: indexCached || undefined,
          duration_ms: duration,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(output, null, 2),
            },
          ],
          structuredContent: output,
        };
      } catch (err) {
        setIndexState('error');
        setIndexError(err instanceof Error ? err : new Error(String(err)));
        const duration = Date.now() - startTime;

        // Record failed index event
        const stateDb = getStateDb?.();
        if (stateDb) {
          recordIndexEvent(stateDb, {
            trigger: 'manual_refresh',
            duration_ms: duration,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }

        const output: RefreshIndexOutput = {
          success: false,
          notes_count: 0,
          entities_count: 0,
          fts5_notes: 0,
          duration_ms: duration,
        };

        return {
          content: [
            {
              type: 'text',
              text: `Error refreshing index: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          structuredContent: output,
        };
      }
    }
  );

  // get_all_entities - Get all linkable entities (titles + aliases)
  const GetAllEntitiesOutputSchema = {
    entity_count: z.number().describe('Total number of entities'),
    entities: z
      .array(
        z.object({
          name: z.string().describe('Entity name (title or alias)'),
          path: z.string().describe('Path to the note'),
          is_alias: z.boolean().describe('Whether this is an alias vs title'),
        })
      )
      .describe('List of all entities'),
  };

  type GetAllEntitiesOutput = {
    entity_count: number;
    entities: Array<{
      name: string;
      path: string;
      is_alias: boolean;
    }>;
  };

  server.registerTool(
    'get_all_entities',
    {
      title: 'Get All Entities',
      description:
        'Use when listing every linkable entity in the vault. Produces a complete entity list with titles, aliases, categories, and hub scores. Returns the full entity array from the index. Does not search note content — only returns entity metadata.',
      inputSchema: {
        include_aliases: z
          .boolean()
          .default(true)
          .describe('Include aliases in addition to titles'),
        limit: z
          .number()
          .optional()
          .describe('Maximum number of entities to return'),
      },
      outputSchema: GetAllEntitiesOutputSchema,
    },
    async ({
      include_aliases,
      limit: requestedLimit,
    }): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      structuredContent: GetAllEntitiesOutput;
    }> => {
      requireIndex();
      const index = getIndex();

      // Cap limit to prevent massive payloads
      const limit = requestedLimit ? Math.min(requestedLimit, MAX_LIMIT) : MAX_LIMIT;

      const entities: Array<{ name: string; path: string; is_alias: boolean }> =
        [];

      // Collect all titles
      for (const note of index.notes.values()) {
        entities.push({
          name: note.title,
          path: note.path,
          is_alias: false,
        });

        // Add aliases if requested
        if (include_aliases) {
          for (const alias of note.aliases) {
            entities.push({
              name: alias,
              path: note.path,
              is_alias: true,
            });
          }
        }
      }

      // Sort alphabetically
      entities.sort((a, b) => a.name.localeCompare(b.name));

      // Apply limit
      const limitedEntities = entities.slice(0, limit);

      const output: GetAllEntitiesOutput = {
        entity_count: limitedEntities.length,
        entities: limitedEntities,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(output, null, 2),
          },
        ],
        structuredContent: output,
      };
    }
  );

  // get_unlinked_mentions - Find mentions of an entity that aren't linked
  const GetUnlinkedMentionsOutputSchema = {
    entity: z.string().describe('The entity searched for'),
    resolved_path: z
      .string()
      .optional()
      .describe('Path of the note this entity refers to'),
    mention_count: z.number().describe('Total unlinked mentions found'),
    mentions: z
      .array(
        z.object({
          path: z.string().describe('Path of note with unlinked mention'),
          line: z.number().describe('Line number of mention'),
          context: z.string().describe('Surrounding text'),
        })
      )
      .describe('List of unlinked mentions'),
  };

  type GetUnlinkedMentionsOutput = {
    entity: string;
    resolved_path?: string;
    mention_count: number;
    mentions: Array<{
      path: string;
      line: number;
      context: string;
    }>;
  };

  server.registerTool(
    'get_unlinked_mentions',
    {
      title: 'Get Unlinked Mentions',
      description:
        'Use when finding places where an entity name appears in text but is not wikilinked. Produces mention locations with note paths and line numbers. Returns unlinked mention entries for a specific entity. Does not apply links — use suggest_wikilinks for batch suggestions.',
      inputSchema: {
        entity: z
          .string()
          .describe('Entity to search for (e.g., "John Smith")'),
        limit: z
          .number()
          .default(50)
          .describe('Maximum number of mentions to return'),
      },
      outputSchema: GetUnlinkedMentionsOutputSchema,
    },
    async ({
      entity,
      limit: requestedLimit,
    }): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      structuredContent: GetUnlinkedMentionsOutput;
    }> => {
      requireIndex();
      const index = getIndex();
      const vaultPath = getVaultPath();

      // Cap limit to prevent massive payloads
      const limit = Math.min(requestedLimit ?? 50, MAX_LIMIT);

      // Check if entity exists
      const normalizedEntity = entity.toLowerCase();
      const resolvedPath = index.entities.get(normalizedEntity);

      const mentions: Array<{
        path: string;
        line: number;
        context: string;
      }> = [];

      // Search through all notes
      for (const note of index.notes.values()) {
        // Skip the note that defines this entity
        if (resolvedPath && note.path === resolvedPath) {
          continue;
        }

        try {
          const fullPath = path.join(vaultPath, note.path);
          const content = await fs.promises.readFile(fullPath, 'utf-8');
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Check if line contains entity (case insensitive)
            const lowerLine = line.toLowerCase();
            if (!lowerLine.includes(normalizedEntity)) {
              continue;
            }

            // Check if it's already linked
            // Look for [[entity]] or [[something|entity]]
            const linkPattern = new RegExp(
              `\\[\\[[^\\]]*${entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\]]*\\]\\]`,
              'i'
            );
            if (linkPattern.test(line)) {
              continue;
            }

            // It's an unlinked mention
            mentions.push({
              path: note.path,
              line: i + 1,
              context: line.trim().slice(0, 200),
            });

            if (mentions.length >= limit) {
              break;
            }
          }
        } catch {
          // Skip files we can't read
        }

        if (mentions.length >= limit) {
          break;
        }
      }

      const output: GetUnlinkedMentionsOutput = {
        entity,
        resolved_path: resolvedPath,
        mention_count: mentions.length,
        mentions,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(output, null, 2),
          },
        ],
        structuredContent: output,
      };
    }
  );

  // get_folder_structure - Get vault folder structure
  const GetFolderStructureOutputSchema = {
    folder_count: z.number().describe('Total number of folders'),
    folders: z
      .array(
        z.object({
          path: z.string().describe('Folder path'),
          note_count: z.number().describe('Number of notes in this folder'),
          subfolder_count: z.number().describe('Number of direct subfolders'),
        })
      )
      .describe('List of folders with note counts'),
  };

  type GetFolderStructureOutput = {
    folder_count: number;
    folders: Array<{
      path: string;
      note_count: number;
      subfolder_count: number;
    }>;
  };

  server.registerTool(
    'get_folder_structure',
    {
      title: 'Get Folder Structure',
      description:
        'Use when exploring vault organization. Produces a folder tree with note counts and subfolder counts per directory. Returns hierarchical folder data sorted by depth. Does not list individual note files — use search with folder filter for that.',
      inputSchema: {},
      outputSchema: GetFolderStructureOutputSchema,
    },
    async (): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      structuredContent: GetFolderStructureOutput;
    }> => {
      requireIndex();
      const index = getIndex();

      // Build folder map
      const folderCounts = new Map<string, number>();
      const subfolders = new Map<string, Set<string>>();

      for (const note of index.notes.values()) {
        const parts = note.path.split('/');

        // Root notes
        if (parts.length === 1) {
          folderCounts.set('/', (folderCounts.get('/') || 0) + 1);
          continue;
        }

        // Get folder path (everything except filename)
        const folderPath = parts.slice(0, -1).join('/');
        folderCounts.set(folderPath, (folderCounts.get(folderPath) || 0) + 1);

        // Track parent-child relationships
        for (let i = 1; i < parts.length - 1; i++) {
          const parent = parts.slice(0, i).join('/') || '/';
          const child = parts.slice(0, i + 1).join('/');

          if (!subfolders.has(parent)) {
            subfolders.set(parent, new Set());
          }
          subfolders.get(parent)!.add(child);

          // Ensure parent folder exists in counts
          if (!folderCounts.has(parent)) {
            folderCounts.set(parent, 0);
          }
        }
      }

      // Convert to output format
      const folders: Array<{
        path: string;
        note_count: number;
        subfolder_count: number;
      }> = [];

      for (const [folderPath, noteCount] of folderCounts) {
        folders.push({
          path: folderPath,
          note_count: noteCount,
          subfolder_count: subfolders.get(folderPath)?.size || 0,
        });
      }

      // Sort by path
      folders.sort((a, b) => a.path.localeCompare(b.path));

      const output: GetFolderStructureOutput = {
        folder_count: folders.length,
        folders,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(output, null, 2),
          },
        ],
        structuredContent: output,
      };
    }
  );

  // list_entities - Get all entities grouped by category with hub scores (for UI panels)
  server.registerTool(
    'list_entities',
    {
      title: 'List Entities',
      description:
        'Use when listing all linkable entities grouped by category. Produces the full entity index from the state database with names, aliases, hub scores, and categories. Returns an array of entity profiles. Does not search note content — only returns entity metadata from the index.',
      inputSchema: {
        category: z
          .string()
          .optional()
          .describe('Filter to a specific category (e.g. "people", "technologies")'),
        limit: z.coerce
          .number()
          .default(2000)
          .describe('Maximum entities per category'),
      },
    },
    async ({
      category,
      limit: perCategoryLimit,
    }): Promise<{
      content: Array<{ type: 'text'; text: string }>;
    }> => {
      const stateDb = getStateDb?.();
      if (!stateDb) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'StateDb not available' }) }],
        };
      }

      const entityIndex = getEntityIndexFromDb(stateDb);

      // Build suppression set
      const suppressedSet = new Set<string>(
        (stateDb.db.prepare('SELECT entity FROM wikilink_suppressions').all() as Array<{ entity: string }>)
          .map(r => r.entity.toLowerCase())
      );

      // Annotate entities with suppression status
      const allCategories = Object.keys(entityIndex).filter(k => k !== '_metadata') as string[];
      for (const cat of allCategories) {
        const arr = (entityIndex as any)[cat];
        if (Array.isArray(arr)) {
          for (const entity of arr) {
            entity.isSuppressed = suppressedSet.has(entity.name.toLowerCase());
          }
        }
      }

      // Annotate "other" entities with inferred categories (best-effort)
      const otherArr = (entityIndex as any).other;
      if (Array.isArray(otherArr)) {
        for (const entity of otherArr) {
          const inferred = getInferredCategory(entity.name);
          if (inferred) {
            entity.inferredCategory = inferred.category;
            entity.inferredConfidence = inferred.confidence;
          }
        }
      }

      // If category filter is specified, zero out other categories
      if (category) {
        const allCategories = Object.keys(entityIndex).filter(k => k !== '_metadata') as string[];
        for (const cat of allCategories) {
          if (cat !== category) {
            (entityIndex as any)[cat] = [];
          }
        }
      }

      // Apply per-category limit
      if (perCategoryLimit) {
        const allCategories = Object.keys(entityIndex).filter(k => k !== '_metadata') as string[];
        for (const cat of allCategories) {
          const arr = (entityIndex as any)[cat];
          if (Array.isArray(arr) && arr.length > perCategoryLimit) {
            (entityIndex as any)[cat] = arr.slice(0, perCategoryLimit);
          }
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(entityIndex) }],
      };
    }
  );

  // suggest_entity_aliases - Generate alias suggestions for entities
  server.registerTool(
    'suggest_entity_aliases',
    {
      title: 'Suggest Entity Aliases',
      description:
        'Use when generating alias suggestions for entities based on acronyms and short forms. Produces alias candidates validated against vault content. Returns suggested aliases per entity with evidence. Does not apply aliases — use vault_update_frontmatter to add them.',
      inputSchema: {
        folder: z.string().optional().describe('Folder path to scope suggestions to'),
        limit: z.number().default(20).describe('Max suggestions to return'),
      },
    },
    async ({
      folder,
      limit: requestedLimit,
    }): Promise<{
      content: Array<{ type: 'text'; text: string }>;
    }> => {
      const stateDb = getStateDb?.();
      if (!stateDb) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'StateDb not available' }) }],
        };
      }

      const suggestions = suggestEntityAliases(stateDb, folder || undefined);
      const limit = Math.min(requestedLimit ?? 20, 50);
      const limited = suggestions.slice(0, limit);

      const output = { suggestion_count: limited.length, suggestions: limited };
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      };
    }
  );

  // unlinked_mentions_report - Find entities with the most unlinked mentions vault-wide
  server.registerTool(
    'unlinked_mentions_report',
    {
      title: 'Unlinked Mentions Report',
      description:
        'Use when finding the highest-ROI linking opportunities across the vault. Produces a ranked report of entities with the most unlinked text mentions. Returns entity names with unlinked mention counts and sample locations. Does not apply links — use suggest_wikilinks on individual notes.',
      inputSchema: {
        limit: z.coerce.number().default(20).describe('Maximum entities to return (default 20)'),
      },
    },
    async ({ limit: requestedLimit }): Promise<{
      content: Array<{ type: 'text'; text: string }>;
    }> => {
      requireIndex();
      const index = getIndex();
      const limit = Math.min(requestedLimit ?? 20, 100);

      // Build a map of entity path → linked mention count from index outlinks
      const linkedCounts = new Map<string, number>();
      for (const note of index.notes.values()) {
        for (const link of note.outlinks) {
          const key = link.target.toLowerCase();
          linkedCounts.set(key, (linkedCounts.get(key) || 0) + 1);
        }
      }

      // For each entity, count FTS5 mentions and subtract linked count
      const results: Array<{
        entity: string;
        path: string;
        total_mentions: number;
        linked_mentions: number;
        unlinked_mentions: number;
      }> = [];

      // Collect unique entities (deduplicate aliases pointing to same path)
      const seen = new Set<string>();
      for (const [name, entityPath] of index.entities) {
        if (seen.has(entityPath)) continue;
        seen.add(entityPath);

        const totalMentions = countFTS5Mentions(name);
        if (totalMentions === 0) continue;

        // Count linked mentions: look up both the entity name and its path
        const pathKey = entityPath.toLowerCase().replace(/\.md$/, '');
        const linkedByName = linkedCounts.get(name) || 0;
        const linkedByPath = linkedCounts.get(pathKey) || 0;
        const linked = Math.max(linkedByName, linkedByPath);

        const unlinked = Math.max(0, totalMentions - linked - 1); // -1 for self-mention
        if (unlinked <= 0) continue;

        // Use display name from the note title
        const note = index.notes.get(entityPath);
        const displayName = note?.title || name;

        results.push({
          entity: displayName,
          path: entityPath,
          total_mentions: totalMentions,
          linked_mentions: linked,
          unlinked_mentions: unlinked,
        });
      }

      results.sort((a, b) => b.unlinked_mentions - a.unlinked_mentions);
      const top = results.slice(0, limit);

      const output = {
        total_entities_checked: seen.size,
        entities_with_unlinked: results.length,
        top_entities: top,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      };
    }
  );
}
