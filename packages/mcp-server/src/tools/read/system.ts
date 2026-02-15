/**
 * System and utility tools - infrastructure primitives for v2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import { buildVaultIndex, setIndexState, setIndexError } from '../../core/read/graph.js';
import { loadConfig, inferConfig, saveConfig, type FlywheelConfig } from '../../core/read/config.js';
import { buildFTS5Index } from '../../core/read/fts5.js';
import { scanVaultEntities, type StateDb } from '@velvetmonkey/vault-core';
import { MAX_LIMIT } from '../../core/read/constants.js';
import { requireIndex } from '../../core/read/indexGuard.js';

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
    duration_ms: z.number().describe('Time taken to rebuild index'),
  };

  type RefreshIndexOutput = {
    success: boolean;
    notes_count: number;
    entities_count: number;
    fts5_notes: number;
    duration_ms: number;
  };

  server.registerTool(
    'refresh_index',
    {
      title: 'Refresh Index',
      description:
        'Rebuild the vault index and FTS5 search index without restarting the server. Use after making changes to notes in Obsidian or if search results seem stale.',
      inputSchema: {},
      outputSchema: RefreshIndexOutputSchema,
    },
    async (): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      structuredContent: RefreshIndexOutput;
    }> => {
      const vaultPath = getVaultPath();
      const startTime = Date.now();

      // Mark index as building during refresh
      setIndexState('building');
      setIndexError(null);

      try {
        const newIndex = await buildVaultIndex(vaultPath);
        setIndex(newIndex);
        setIndexState('ready');

        // Update entities in StateDb (for Flywheel Memory wikilinks)
        const stateDb = getStateDb?.();
        if (stateDb) {
          try {
            const entityIndex = await scanVaultEntities(vaultPath, {
              excludeFolders: [
                'daily-notes', 'daily', 'weekly', 'weekly-notes', 'monthly',
                'monthly-notes', 'quarterly', 'yearly-notes', 'periodic', 'journal',
                'inbox', 'templates', 'attachments', 'tmp',
                'clippings', 'readwise', 'articles', 'bookmarks', 'web-clips',
              ],
            });
            stateDb.replaceAllEntities(entityIndex);
            console.error(`[Flywheel] Updated ${entityIndex._metadata.total_entities} entities in StateDb`);
          } catch (e) {
            console.error('[Flywheel] Failed to update entities:', e);
          }
        }

        // Infer config from vault, merge with existing, save
        if (setConfig) {
          const existing = loadConfig(stateDb);
          const inferred = inferConfig(newIndex, vaultPath);
          if (stateDb) {
            saveConfig(stateDb, inferred, existing);
          }
          setConfig(loadConfig(stateDb));
        }

        // Rebuild FTS5 search index
        let fts5Notes = 0;
        try {
          const ftsState = await buildFTS5Index(vaultPath);
          fts5Notes = ftsState.noteCount;
          console.error(`[Flywheel] FTS5 index rebuilt: ${fts5Notes} notes`);
        } catch (err) {
          console.error('[Flywheel] FTS5 rebuild failed:', err);
        }

        const output: RefreshIndexOutput = {
          success: true,
          notes_count: newIndex.notes.size,
          entities_count: newIndex.entities.size,
          fts5_notes: fts5Notes,
          duration_ms: Date.now() - startTime,
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

        const output: RefreshIndexOutput = {
          success: false,
          notes_count: 0,
          entities_count: 0,
          fts5_notes: 0,
          duration_ms: Date.now() - startTime,
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
        'Get all linkable entities in the vault (note titles and aliases). Useful for understanding what can be linked to.',
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
        'Find places where an entity (note title or alias) is mentioned in text but not linked. Useful for finding linking opportunities.',
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

  // get_note_metadata - Get metadata about a note without reading full content
  const GetNoteMetadataOutputSchema = {
    path: z.string().describe('Path to the note'),
    title: z.string().describe('Note title'),
    exists: z.boolean().describe('Whether the note exists'),
    frontmatter: z.record(z.unknown()).describe('Frontmatter properties'),
    tags: z.array(z.string()).describe('Tags on this note'),
    aliases: z.array(z.string()).describe('Aliases for this note'),
    outlink_count: z.number().describe('Number of outgoing links'),
    backlink_count: z.number().describe('Number of incoming links'),
    word_count: z.number().optional().describe('Approximate word count'),
    created: z.string().optional().describe('Created date (ISO format)'),
    modified: z.string().describe('Last modified date (ISO format)'),
  };

  type GetNoteMetadataOutput = {
    path: string;
    title: string;
    exists: boolean;
    frontmatter: Record<string, unknown>;
    tags: string[];
    aliases: string[];
    outlink_count: number;
    backlink_count: number;
    word_count?: number;
    created?: string;
    modified: string;
  };

  server.registerTool(
    'get_note_metadata',
    {
      title: 'Get Note Metadata',
      description:
        'Get metadata about a note (frontmatter, tags, link counts) without reading full content. Useful for quick analysis.',
      inputSchema: {
        path: z.string().describe('Path to the note'),
        include_word_count: z
          .boolean()
          .default(false)
          .describe('Count words (requires reading file)'),
      },
      outputSchema: GetNoteMetadataOutputSchema,
    },
    async ({
      path: notePath,
      include_word_count,
    }): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      structuredContent: GetNoteMetadataOutput;
    }> => {
      requireIndex();
      const index = getIndex();
      const vaultPath = getVaultPath();

      // Try to resolve path
      let resolvedPath = notePath;
      if (!notePath.endsWith('.md')) {
        const resolved = index.entities.get(notePath.toLowerCase());
        if (resolved) {
          resolvedPath = resolved;
        } else {
          resolvedPath = notePath + '.md';
        }
      }

      const note = index.notes.get(resolvedPath);

      if (!note) {
        const output: GetNoteMetadataOutput = {
          path: resolvedPath,
          title: resolvedPath.replace(/\.md$/, '').split('/').pop() || '',
          exists: false,
          frontmatter: {},
          tags: [],
          aliases: [],
          outlink_count: 0,
          backlink_count: 0,
          modified: new Date().toISOString(),
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

      // Get backlink count
      const normalizedPath = resolvedPath.toLowerCase().replace(/\.md$/, '');
      const backlinks = index.backlinks.get(normalizedPath) || [];

      // Word count if requested
      let wordCount: number | undefined;
      if (include_word_count) {
        try {
          const fullPath = path.join(vaultPath, resolvedPath);
          const content = await fs.promises.readFile(fullPath, 'utf-8');
          wordCount = content.split(/\s+/).filter((w) => w.length > 0).length;
        } catch {
          // Ignore errors
        }
      }

      const output: GetNoteMetadataOutput = {
        path: note.path,
        title: note.title,
        exists: true,
        frontmatter: note.frontmatter,
        tags: note.tags,
        aliases: note.aliases,
        outlink_count: note.outlinks.length,
        backlink_count: backlinks.length,
        word_count: wordCount,
        created: note.created?.toISOString(),
        modified: note.modified.toISOString(),
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
        'Get the folder structure of the vault with note counts. Useful for understanding vault organization.',
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
}
