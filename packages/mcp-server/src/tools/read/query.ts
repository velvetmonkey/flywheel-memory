/**
 * Query tools - unified search across metadata, content, and entities
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
  // ========================================
  // Unified search tool
  // ========================================
  server.tool(
    'search',
    'Search the vault across metadata, content, and entities. Scope controls what to search: "metadata" for frontmatter/tags/folders, "content" for full-text search (FTS5), "entities" for people/projects/technologies, "all" (default) tries metadata then falls back to content search.\n\nExample: search({ query: "quarterly review", scope: "content", limit: 5 })\nExample: search({ where: { type: "project", status: "active" }, scope: "metadata" })',
    {
      query: z.string().optional().describe('Search query text. Required for scope "content", "entities", "all". For "metadata" scope, use filters instead.'),
      scope: z.enum(['metadata', 'content', 'entities', 'all']).default('all').describe('What to search: metadata (frontmatter/tags/folders), content (FTS5 full-text), entities (people/projects), all (metadata then content)'),

      // Metadata filters (used with scope "metadata" or "all")
      where: z.record(z.unknown()).optional().describe('Frontmatter filters as key-value pairs. Example: { "type": "project", "status": "active" }'),
      has_tag: z.string().optional().describe('Filter to notes with this tag'),
      has_any_tag: z.array(z.string()).optional().describe('Filter to notes with any of these tags'),
      has_all_tags: z.array(z.string()).optional().describe('Filter to notes with all of these tags'),
      folder: z.string().optional().describe('Limit to notes in this folder'),
      title_contains: z.string().optional().describe('Filter to notes whose title contains this text (case-insensitive)'),

      // Date filters (absorbs temporal tools)
      modified_after: z.string().optional().describe('Only notes modified after this date (YYYY-MM-DD)'),
      modified_before: z.string().optional().describe('Only notes modified before this date (YYYY-MM-DD)'),

      // Sorting
      sort_by: z.enum(['modified', 'created', 'title']).default('modified').describe('Field to sort by'),
      order: z.enum(['asc', 'desc']).default('desc').describe('Sort order'),

      // Entity options (used with scope "entities")
      prefix: z.boolean().default(false).describe('Enable prefix matching for entity search (autocomplete)'),

      // Pagination
      limit: z.number().default(20).describe('Maximum number of results to return'),
    },
    async ({ query, scope, where, has_tag, has_any_tag, has_all_tags, folder, title_contains, modified_after, modified_before, sort_by, order, prefix, limit: requestedLimit }) => {
      const limit = Math.min(requestedLimit ?? 20, MAX_LIMIT);
      const index = getIndex();
      const vaultPath = getVaultPath();

      // ---- ENTITY SEARCH ----
      if (scope === 'entities') {
        if (!query) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'query is required for entity search' }, null, 2) }] };
        }
        const stateDb = getStateDb();
        if (!stateDb) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ scope: 'entities', results: [], count: 0, query, error: 'StateDb not initialized' }, null, 2) }] };
        }
        try {
          const results = prefix
            ? searchEntitiesPrefix(stateDb, query, limit)
            : searchEntities(stateDb, query, limit);
          return { content: [{ type: 'text' as const, text: JSON.stringify({ scope: 'entities', query, count: results.length, entities: results }, null, 2) }] };
        } catch (err) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ scope: 'entities', query, count: 0, entities: [], error: err instanceof Error ? err.message : String(err) }, null, 2) }] };
        }
      }

      // ---- METADATA SEARCH ----
      const hasMetadataFilters = where || has_tag || has_any_tag || has_all_tags || folder || title_contains || modified_after || modified_before;

      if (scope === 'metadata' || (scope === 'all' && hasMetadataFilters)) {
        let matchingNotes: VaultNote[] = Array.from(index.notes.values());

        // Apply frontmatter filters
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
        // Also filter by query text in title if provided and scope is metadata
        if (query && !title_contains) {
          const searchTerm = query.toLowerCase();
          matchingNotes = matchingNotes.filter((note) =>
            note.title.toLowerCase().includes(searchTerm)
          );
        }

        // Date filters
        if (modified_after) {
          const afterDate = new Date(modified_after);
          afterDate.setHours(0, 0, 0, 0);
          matchingNotes = matchingNotes.filter((note) => note.modified >= afterDate);
        }
        if (modified_before) {
          const beforeDate = new Date(modified_before);
          beforeDate.setHours(23, 59, 59, 999);
          matchingNotes = matchingNotes.filter((note) => note.modified <= beforeDate);
        }

        // Sort
        matchingNotes = sortNotes(matchingNotes, sort_by ?? 'modified', order ?? 'desc');

        const totalMatches = matchingNotes.length;
        const limitedNotes = matchingNotes.slice(0, limit);

        const notes = limitedNotes.map((note) => ({
          path: note.path,
          title: note.title,
          modified: note.modified.toISOString(),
          created: note.created?.toISOString(),
          tags: note.tags,
          frontmatter: note.frontmatter,
        }));

        // If explicit metadata filters were used, always return the metadata result
        // (even if empty). Only fall through to content if scope=all with just a query.
        if (scope === 'metadata' || hasMetadataFilters || totalMatches > 0) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({
            scope: 'metadata',
            query: query || undefined,
            total_matches: totalMatches,
            returned: notes.length,
            notes,
          }, null, 2) }] };
        }
      }

      // ---- CONTENT SEARCH (FTS5) ----
      if (scope === 'content' || scope === 'all') {
        if (!query) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'query is required for content search' }, null, 2) }] };
        }

        // Ensure FTS5 index is ready
        const ftsState = getFTS5State();
        if (!ftsState.ready || isIndexStale(vaultPath)) {
          console.error('[FTS5] Index stale or missing, rebuilding...');
          await buildFTS5Index(vaultPath);
        }

        const results = searchFTS5(vaultPath, query, limit);

        return { content: [{ type: 'text' as const, text: JSON.stringify({
          scope: 'content',
          query,
          total_results: results.length,
          results,
        }, null, 2) }] };
      }

      // Shouldn't reach here
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Invalid scope' }, null, 2) }] };
    }
  );
}
