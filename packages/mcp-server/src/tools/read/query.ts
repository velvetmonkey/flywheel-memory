/**
 * Query tools - search notes by frontmatter, tags, folders, and full-text content
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex, VaultNote } from '../../core/read/types.js';
import { MAX_LIMIT } from '../../core/read/constants.js';
import { requireIndex } from '../../core/read/indexGuard.js';
import {
  searchFTS5,
  buildFTS5Index,
  isIndexStale,
  getFTS5State,
  type FTS5Result,
} from '../../core/read/fts5.js';
import {
  searchEntities,
  searchEntitiesPrefix,
  type StateDb,
  type EntitySearchResult,
} from '@velvetmonkey/vault-core';

/**
 * Check if a note matches frontmatter filters
 */
function matchesFrontmatter(
  note: VaultNote,
  where: Record<string, unknown>
): boolean {
  for (const [key, value] of Object.entries(where)) {
    const noteValue = note.frontmatter[key];

    // Handle null/undefined
    if (value === null || value === undefined) {
      if (noteValue !== null && noteValue !== undefined) {
        return false;
      }
      continue;
    }

    // Handle arrays - check if any value matches
    if (Array.isArray(noteValue)) {
      if (!noteValue.some((v) => String(v).toLowerCase() === String(value).toLowerCase())) {
        return false;
      }
      continue;
    }

    // Handle string comparison (case-insensitive)
    if (typeof value === 'string' && typeof noteValue === 'string') {
      if (noteValue.toLowerCase() !== value.toLowerCase()) {
        return false;
      }
      continue;
    }

    // Handle other types (exact match)
    if (noteValue !== value) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a note has a specific tag
 */
function hasTag(note: VaultNote, tag: string): boolean {
  const normalizedTag = tag.replace(/^#/, '').toLowerCase();
  return note.tags.some((t) => t.toLowerCase() === normalizedTag);
}

/**
 * Check if a note has any of the specified tags
 */
function hasAnyTag(note: VaultNote, tags: string[]): boolean {
  return tags.some((tag) => hasTag(note, tag));
}

/**
 * Check if a note has all of the specified tags
 */
function hasAllTags(note: VaultNote, tags: string[]): boolean {
  return tags.every((tag) => hasTag(note, tag));
}

/**
 * Check if a note is in a folder
 */
function inFolder(note: VaultNote, folder: string): boolean {
  const normalizedFolder = folder.endsWith('/') ? folder : folder + '/';
  return note.path.startsWith(normalizedFolder) || note.path.split('/')[0] === folder.replace('/', '');
}

/**
 * Sort notes by a field
 */
function sortNotes(
  notes: VaultNote[],
  sortBy: 'modified' | 'created' | 'title',
  order: 'asc' | 'desc'
): VaultNote[] {
  const sorted = [...notes];

  sorted.sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case 'modified':
        comparison = a.modified.getTime() - b.modified.getTime();
        break;
      case 'created':
        const aCreated = a.created || a.modified;
        const bCreated = b.created || b.modified;
        comparison = aCreated.getTime() - bCreated.getTime();
        break;
      case 'title':
        comparison = a.title.localeCompare(b.title);
        break;
    }

    return order === 'desc' ? -comparison : comparison;
  });

  return sorted;
}

/**
 * Register query tools
 */
export function registerQueryTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string,
  getStateDb: () => StateDb | null
): void {
  // search_notes - Search notes by frontmatter, tags, and folders
  const NoteResultSchema = z.object({
    path: z.string().describe('Path to the note'),
    title: z.string().describe('Note title'),
    modified: z.string().describe('Last modified date (ISO format)'),
    created: z.string().optional().describe('Creation date if available (ISO format)'),
    tags: z.array(z.string()).describe('Tags on this note'),
    frontmatter: z.record(z.unknown()).describe('Frontmatter fields'),
  });

  const SearchNotesOutputSchema = {
    query: z.object({
      where: z.record(z.unknown()).optional(),
      has_tag: z.string().optional(),
      has_any_tag: z.array(z.string()).optional(),
      has_all_tags: z.array(z.string()).optional(),
      folder: z.string().optional(),
      title_contains: z.string().optional(),
      sort_by: z.string().optional(),
      order: z.string().optional(),
      limit: z.coerce.number().optional(),
    }).describe('The search query that was executed'),
    total_matches: z.coerce.number().describe('Total number of matching notes'),
    returned: z.coerce.number().describe('Number of notes returned (may be limited)'),
    notes: z.array(NoteResultSchema).describe('Matching notes'),
  };

  type NoteResult = {
    path: string;
    title: string;
    modified: string;
    created?: string;
    tags: string[];
    frontmatter: Record<string, unknown>;
  };

  type SearchNotesOutput = {
    query: {
      where?: Record<string, unknown>;
      has_tag?: string;
      has_any_tag?: string[];
      has_all_tags?: string[];
      folder?: string;
      title_contains?: string;
      sort_by?: string;
      order?: string;
      limit?: number;
    };
    total_matches: number;
    returned: number;
    notes: NoteResult[];
  };

  server.registerTool(
    'search_notes',
    {
      title: 'Search Notes',
      description:
        'Search notes by frontmatter fields, tags, folders, or title. Covers ~80% of Dataview use cases.',
      inputSchema: {
        where: z
          .record(z.unknown())
          .optional()
          .describe('Frontmatter filters as key-value pairs. Example: { "type": "project", "status": "active" }'),
        has_tag: z
          .string()
          .optional()
          .describe('Filter to notes with this tag. Example: "work"'),
        has_any_tag: z
          .array(z.string())
          .optional()
          .describe('Filter to notes with any of these tags. Example: ["work", "personal"]'),
        has_all_tags: z
          .array(z.string())
          .optional()
          .describe('Filter to notes with all of these tags. Example: ["project", "active"]'),
        folder: z
          .string()
          .optional()
          .describe('Limit to notes in this folder. Example: "daily-notes"'),
        title_contains: z
          .string()
          .optional()
          .describe('Filter to notes whose title contains this text (case-insensitive)'),
        sort_by: z
          .enum(['modified', 'created', 'title'])
          .default('modified')
          .describe('Field to sort by'),
        order: z
          .enum(['asc', 'desc'])
          .default('desc')
          .describe('Sort order'),
        limit: z
          .number()
          .default(50)
          .describe('Maximum number of results to return'),
      },
      outputSchema: SearchNotesOutputSchema,
    },
    async ({
      where,
      has_tag,
      has_any_tag,
      has_all_tags,
      folder,
      title_contains,
      sort_by = 'modified',
      order = 'desc',
      limit: requestedLimit = 50,
    }): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      structuredContent: SearchNotesOutput;
    }> => {
      const index = getIndex();

      // Cap limit to prevent massive payloads
      const limit = Math.min(requestedLimit, MAX_LIMIT);

      // Start with all notes
      let matchingNotes: VaultNote[] = Array.from(index.notes.values());

      // Apply filters
      if (where && Object.keys(where).length > 0) {
        matchingNotes = matchingNotes.filter((note) => matchesFrontmatter(note, where));
      }

      if (has_tag) {
        matchingNotes = matchingNotes.filter((note) => hasTag(note, has_tag));
      }

      if (has_any_tag && has_any_tag.length > 0) {
        matchingNotes = matchingNotes.filter((note) => hasAnyTag(note, has_any_tag));
      }

      if (has_all_tags && has_all_tags.length > 0) {
        matchingNotes = matchingNotes.filter((note) => hasAllTags(note, has_all_tags));
      }

      if (folder) {
        matchingNotes = matchingNotes.filter((note) => inFolder(note, folder));
      }

      if (title_contains) {
        const searchTerm = title_contains.toLowerCase();
        matchingNotes = matchingNotes.filter((note) =>
          note.title.toLowerCase().includes(searchTerm)
        );
      }

      // Sort
      matchingNotes = sortNotes(matchingNotes, sort_by, order);

      // Apply limit
      const totalMatches = matchingNotes.length;
      const limitedNotes = matchingNotes.slice(0, limit);

      // Format output
      const notes: NoteResult[] = limitedNotes.map((note) => ({
        path: note.path,
        title: note.title,
        modified: note.modified.toISOString(),
        created: note.created?.toISOString(),
        tags: note.tags,
        frontmatter: note.frontmatter,
      }));

      const output: SearchNotesOutput = {
        query: {
          where,
          has_tag,
          has_any_tag,
          has_all_tags,
          folder,
          title_contains,
          sort_by,
          order,
          limit,
        },
        total_matches: totalMatches,
        returned: notes.length,
        notes,
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

  // full_text_search - Search note content using FTS5 full-text search
  const FTS5ResultSchema = z.object({
    path: z.string().describe('Path to the note'),
    title: z.string().describe('Note title'),
    snippet: z.string().describe('Matching snippet with highlighted terms'),
  });

  const FullTextSearchOutputSchema = {
    query: z.string().describe('The search query that was executed'),
    total_results: z.coerce.number().describe('Number of matching results'),
    results: z.array(FTS5ResultSchema).describe('Matching notes with snippets'),
  };

  type FullTextSearchOutput = {
    query: string;
    total_results: number;
    results: FTS5Result[];
  };

  server.registerTool(
    'full_text_search',
    {
      title: 'Full-Text Search',
      description:
        'Search note content using SQLite FTS5 full-text search. Supports stemming (running matches run/runs/ran), phrases ("exact phrase"), boolean operators (AND, OR, NOT), and prefix matching (auth*).',
      inputSchema: {
        query: z
          .string()
          .describe(
            'Search query. Examples: "authentication", "exact phrase", "term1 AND term2", "prefix*"'
          ),
        limit: z
          .number()
          .default(10)
          .describe('Maximum number of results to return'),
      },
      outputSchema: FullTextSearchOutputSchema,
    },
    async ({
      query,
      limit: requestedLimit = 10,
    }): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      structuredContent: FullTextSearchOutput;
    }> => {
      const vaultPath = getVaultPath();
      const limit = Math.min(requestedLimit, MAX_LIMIT);

      // Check if index exists and is not too stale, build if needed
      const ftsState = getFTS5State();
      if (!ftsState.ready || isIndexStale(vaultPath)) {
        console.error('[FTS5] Index stale or missing, rebuilding...');
        await buildFTS5Index(vaultPath);
      }

      const results = searchFTS5(vaultPath, query, limit);

      const output: FullTextSearchOutput = {
        query,
        total_results: results.length,
        results,
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

  // rebuild_search_index - Manually rebuild the FTS5 search index
  const RebuildIndexOutputSchema = {
    status: z.enum(['success', 'error']).describe('Whether the rebuild succeeded'),
    notes_indexed: z.coerce.number().describe('Number of notes indexed'),
    message: z.string().describe('Status message'),
  };

  type RebuildIndexOutput = {
    status: 'success' | 'error';
    notes_indexed: number;
    message: string;
  };

  server.registerTool(
    'rebuild_search_index',
    {
      title: 'Rebuild Search Index',
      description:
        'Manually rebuild the FTS5 full-text search index. Use this after bulk changes to the vault or if search results seem stale.',
      inputSchema: {},
      outputSchema: RebuildIndexOutputSchema,
    },
    async (): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      structuredContent: RebuildIndexOutput;
    }> => {
      const vaultPath = getVaultPath();

      try {
        const state = await buildFTS5Index(vaultPath);

        const output: RebuildIndexOutput = {
          status: 'success',
          notes_indexed: state.noteCount,
          message: `Successfully indexed ${state.noteCount} notes`,
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
        const output: RebuildIndexOutput = {
          status: 'error',
          notes_indexed: 0,
          message: err instanceof Error ? err.message : String(err),
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
    }
  );

  // search_entities - Search vault entities using FTS5 full-text search
  const EntityResultSchema = z.object({
    id: z.coerce.number().describe('Entity ID'),
    name: z.string().describe('Entity name'),
    path: z.string().describe('Path to entity note'),
    category: z.string().describe('Entity category (technologies, people, projects, etc.)'),
    aliases: z.array(z.string()).describe('Entity aliases'),
    hubScore: z.coerce.number().describe('Hub score (backlink count)'),
    rank: z.coerce.number().describe('Search relevance rank'),
  });

  const SearchEntitiesOutputSchema = {
    entities: z.array(EntityResultSchema).describe('Matching entities'),
    count: z.coerce.number().describe('Number of results returned'),
    query: z.string().describe('The search query that was executed'),
  };

  type SearchEntitiesOutput = {
    entities: EntitySearchResult[];
    count: number;
    query: string;
  };

  server.registerTool(
    'search_entities',
    {
      title: 'Search Entities',
      description:
        'Search vault entities (people, projects, technologies, etc.) using FTS5 full-text search with Porter stemming. Supports word variations (running matches run/runs/ran), prefix matching (auth*), and phrase search.',
      inputSchema: {
        query: z
          .string()
          .describe('Search query. Supports stemming, prefix matching (term*), phrases.'),
        limit: z
          .number()
          .default(20)
          .describe('Maximum number of results to return'),
        prefix: z
          .boolean()
          .default(false)
          .describe('Enable prefix matching (for autocomplete)'),
      },
      outputSchema: SearchEntitiesOutputSchema,
    },
    async ({
      query,
      limit: requestedLimit = 20,
      prefix = false,
    }): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      structuredContent: SearchEntitiesOutput;
    }> => {
      const stateDb = getStateDb();

      if (!stateDb) {
        const output: SearchEntitiesOutput = {
          entities: [],
          count: 0,
          query,
        };
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'StateDb not initialized', ...output }, null, 2),
            },
          ],
          structuredContent: output,
        };
      }

      const limit = Math.min(requestedLimit, MAX_LIMIT);

      try {
        const results = prefix
          ? searchEntitiesPrefix(stateDb, query, limit)
          : searchEntities(stateDb, query, limit);

        const output: SearchEntitiesOutput = {
          entities: results,
          count: results.length,
          query,
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
        const output: SearchEntitiesOutput = {
          entities: [],
          count: 0,
          query,
        };
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: err instanceof Error ? err.message : String(err), ...output }, null, 2),
            },
          ],
          structuredContent: output,
        };
      }
    }
  );
}
