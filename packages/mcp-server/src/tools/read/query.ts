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
import {
  semanticSearch,
  hasEmbeddingsIndex,
  reciprocalRankFusion,
  type ScoredNote,
} from '../../core/read/embeddings.js';
import {
  enrichResult,
  enrichResultLight,
} from '../../core/read/enrichment.js';

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
 * Check if a note has a specific tag.
 * When includeChildren is true, also matches child tags (e.g., "project" matches "project/active").
 */
function hasTag(note: VaultNote, tag: string, includeChildren: boolean = false): boolean {
  const normalizedTag = tag.replace(/^#/, '').toLowerCase();
  return note.tags.some((t) => {
    const normalizedNoteTag = t.toLowerCase();
    if (normalizedNoteTag === normalizedTag) return true;
    if (includeChildren && normalizedNoteTag.startsWith(normalizedTag + '/')) return true;
    return false;
  });
}

/**
 * Check if a note has any of the specified tags
 */
function hasAnyTag(note: VaultNote, tags: string[], includeChildren: boolean = false): boolean {
  return tags.some((tag) => hasTag(note, tag, includeChildren));
}

/**
 * Check if a note has all of the specified tags
 */
function hasAllTags(note: VaultNote, tags: string[], includeChildren: boolean = false): boolean {
  return tags.every((tag) => hasTag(note, tag, includeChildren));
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
    'Search the vault — always try this before reading files. Top results get full metadata (frontmatter, top backlinks/outlinks ranked by edge weight + recency); remaining results get lightweight summaries (counts only). Use get_note_structure for headings/full structure, get_backlinks for complete backlink lists.\n\nSearches across metadata (frontmatter/tags/folders), content (FTS5 full-text + hybrid semantic), and entities (people/projects/technologies). Uses filters to narrow by frontmatter fields, tags, folders, or dates. Hybrid semantic results are automatically included when embeddings have been built (via init_semantic).\n\nExample: search({ query: "quarterly review", limit: 5 })\nExample: search({ where: { type: "project", status: "active" } })',
    {
      query: z.string().optional().describe('Search query text. Required unless using metadata filters (where, has_tag, folder, etc.)'),
      scope: z.enum(['metadata', 'content', 'entities', 'all']).optional().describe('Narrow to a specific search type. Omit for best results (searches everything). Use "metadata" for frontmatter-only queries, "entities" for entity lookup.'),

      // Metadata filters
      where: z.record(z.unknown()).optional().describe('Frontmatter filters as key-value pairs. Example: { "type": "project", "status": "active" }'),
      has_tag: z.string().optional().describe('Filter to notes with this tag'),
      has_any_tag: z.array(z.string()).optional().describe('Filter to notes with any of these tags'),
      has_all_tags: z.array(z.string()).optional().describe('Filter to notes with all of these tags'),
      include_children: z.boolean().default(false).describe('When true, tag filters also match child tags (e.g., has_tag: "project" also matches "project/active")'),
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
      limit: z.number().default(10).describe('Maximum number of results to return'),
      detail_count: z.number().optional().describe('Number of top results to return with full metadata (backlinks, outlinks, headings, frontmatter). Remaining results get lightweight summaries. Default: 5.'),

      // Context boost (edge weights)
      context_note: z.string().optional().describe('Path of the note providing context. When set, results connected to this note via weighted edges get an RRF boost.'),
    },
    async ({ query, scope: rawScope, where, has_tag, has_any_tag, has_all_tags, include_children, folder, title_contains, modified_after, modified_before, sort_by, order, prefix, limit: requestedLimit, detail_count: requestedDetailCount, context_note }) => {
      const scope = rawScope || 'all'; // Treat missing/undefined as 'all'
      const limit = Math.min(requestedLimit ?? 10, MAX_LIMIT);
      const detailN = requestedDetailCount ?? 5;
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
          matchingNotes = matchingNotes.filter((note) => hasTag(note, has_tag, include_children));
        }
        if (has_any_tag && has_any_tag.length > 0) {
          matchingNotes = matchingNotes.filter((note) => hasAnyTag(note, has_any_tag, include_children));
        }
        if (has_all_tags && has_all_tags.length > 0) {
          matchingNotes = matchingNotes.filter((note) => hasAllTags(note, has_all_tags, include_children));
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

        const stateDb = getStateDb();
        const notes = limitedNotes.map((note, i) =>
          (i < detailN ? enrichResult : enrichResultLight)({ path: note.path, title: note.title }, index, stateDb)
        );

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

      // ---- CONTENT SEARCH (FTS5, with automatic hybrid when semantic enabled) ----
      if (scope === 'content' || scope === 'all') {
        if (!query) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'query is required for content search' }, null, 2) }] };
        }

        // Ensure FTS5 index is ready
        const ftsState = getFTS5State();
        if (ftsState.building) {
          // FTS5 is building (triggered at startup), return immediately
          return { content: [{ type: 'text' as const, text: JSON.stringify({
            scope, method: 'fts5', query, building: true,
            total_results: 0, results: [],
            message: 'Search index is building, try again shortly',
          }, null, 2) }] };
        }
        if (!ftsState.ready || isIndexStale(vaultPath)) {
          console.error('[FTS5] Index stale or missing, rebuilding...');
          await buildFTS5Index(vaultPath);
        }

        const fts5Results = searchFTS5(vaultPath, query, limit);

        // Entity search — match entities by name/aliases/category and include their notes
        let entityResults: EntitySearchResult[] = [];
        if (scope === 'all') {
          const stateDb = getStateDb();
          if (stateDb) {
            try {
              entityResults = searchEntities(stateDb, query, limit);
            } catch { /* entity search is best-effort */ }
          }
        }

        // Build edge-weight ranked list if context_note is provided
        let edgeRanked: Array<{ path: string; title: string }> = [];
        if (context_note) {
          const ctxStateDb = getStateDb();
          if (ctxStateDb) {
            try {
              // Get weighted edges from context_note, resolve targets to paths via entities
              const edgeRows = ctxStateDb.db.prepare(`
                SELECT nl.target, nl.weight FROM note_links nl
                WHERE nl.note_path = ? AND nl.weight > 1.0
                ORDER BY nl.weight DESC LIMIT ?
              `).all(context_note, limit) as Array<{ target: string; weight: number }>;

              if (edgeRows.length > 0) {
                // Build target->path map from entities table
                const entityRows = ctxStateDb.db.prepare(
                  'SELECT path, name_lower FROM entities'
                ).all() as Array<{ path: string; name_lower: string }>;
                const targetToPath = new Map<string, string>();
                for (const e of entityRows) {
                  targetToPath.set(e.name_lower, e.path);
                }

                edgeRanked = edgeRows
                  .map(r => {
                    const entityPath = targetToPath.get(r.target);
                    return entityPath ? { path: entityPath, title: r.target } : null;
                  })
                  .filter((r): r is { path: string; title: string } => r !== null);
              }
            } catch {
              // Edge weight boost is best-effort
            }
          }
        }

        // Hybrid merge with semantic when embeddings exist (applies to both 'content' and 'all' scopes)
        if (hasEmbeddingsIndex()) {
          try {
            const semanticResults = await semanticSearch(query, limit);

            // Normalize paths to deduplicate across sources
            const normalizePath = (p: string) => p.replace(/\\/g, '/').replace(/\/+/g, '/');

            // RRF merge of FTS5, semantic, entity, and edge-weight results
            const fts5Ranked = fts5Results.map(r => ({ path: normalizePath(r.path), title: r.title, snippet: r.snippet }));
            const semanticRanked = semanticResults.map(r => ({ path: normalizePath(r.path), title: r.title }));
            const entityRankedList = entityResults.map(r => ({ path: normalizePath(r.path), title: r.name }));
            const edgeRankedNorm = edgeRanked.map(r => ({ path: normalizePath(r.path), title: r.title }));
            const rrfLists: Array<Array<{ path: string; title?: string }>> = [fts5Ranked, semanticRanked, entityRankedList];
            if (edgeRankedNorm.length > 0) rrfLists.push(edgeRankedNorm);
            const rrfScores = reciprocalRankFusion(...rrfLists);
            const allPaths = new Set([
              ...fts5Results.map(r => normalizePath(r.path)),
              ...semanticResults.map(r => normalizePath(r.path)),
              ...entityResults.map(r => normalizePath(r.path)),
              ...edgeRanked.map(r => normalizePath(r.path)),
            ]);
            const fts5Map = new Map(fts5Results.map(r => [normalizePath(r.path), r]));
            const semanticMap = new Map(semanticResults.map(r => [normalizePath(r.path), r]));
            const entityMap = new Map(entityResults.map(r => [normalizePath(r.path), r]));

            const scored = Array.from(allPaths).map(p => ({
              path: p,
              title: fts5Map.get(p)?.title || semanticMap.get(p)?.title || entityMap.get(p)?.name || p.replace(/\.md$/, '').split('/').pop() || p,
              snippet: fts5Map.get(p)?.snippet,
              rrf_score: rrfScores.get(p) || 0,
              in_fts5: fts5Map.has(p),
              in_semantic: semanticMap.has(p),
              in_entity: entityMap.has(p),
            }));

            scored.sort((a, b) => b.rrf_score - a.rrf_score);

            const stateDb = getStateDb();
            const results = scored.slice(0, limit).map((item, i) => ({
              ...(i < detailN ? enrichResult : enrichResultLight)({ path: item.path, title: item.title, snippet: item.snippet }, index, stateDb),
              rrf_score: item.rrf_score,
              in_fts5: item.in_fts5,
              in_semantic: item.in_semantic,
              in_entity: item.in_entity,
            }));

            return { content: [{ type: 'text' as const, text: JSON.stringify({
              scope,
              method: 'hybrid',
              query,
              total_results: Math.min(scored.length, limit),
              results,
            }, null, 2) }] };
          } catch (err) {
            // Semantic failed, fall back to FTS5 + entity only
            console.error('[Semantic] Hybrid search failed, falling back to FTS5:', err instanceof Error ? err.message : err);
          }
        }

        // Non-hybrid: merge FTS5 + entity results
        if (entityResults.length > 0) {
          const normalizePath = (p: string) => p.replace(/\\/g, '/').replace(/\/+/g, '/');
          const fts5Map = new Map(fts5Results.map(r => [normalizePath(r.path), r]));
          const entityRanked = entityResults.filter(r => !fts5Map.has(normalizePath(r.path)));
          const mergedItems = [
            ...fts5Results.map(r => ({ path: r.path, title: r.title, snippet: r.snippet, in_fts5: true as const })),
            ...entityRanked.map(r => ({ path: r.path, title: r.name, snippet: undefined as string | undefined, in_entity: true as const })),
          ];
          const stateDb = getStateDb();
          const sliced = mergedItems.slice(0, limit);
          const results = sliced.map((item, i) => ({
            ...(i < detailN ? enrichResult : enrichResultLight)({ path: item.path, title: item.title, snippet: item.snippet }, index, stateDb),
            ...('in_fts5' in item ? { in_fts5: true } : { in_entity: true }),
          }));
          return { content: [{ type: 'text' as const, text: JSON.stringify({
            scope: 'content',
            method: 'fts5',
            query,
            total_results: mergedItems.length,
            results,
          }, null, 2) }] };
        }

        const stateDbFts = getStateDb();
        const enrichedFts5 = fts5Results.map((r, i) => ({ ...(i < detailN ? enrichResult : enrichResultLight)({ path: r.path, title: r.title, snippet: r.snippet }, index, stateDbFts), in_fts5: true }));
        return { content: [{ type: 'text' as const, text: JSON.stringify({
          scope: 'content',
          method: 'fts5',
          query,
          total_results: enrichedFts5.length,
          results: enrichedFts5,
        }, null, 2) }] };
      }

      // Shouldn't reach here
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Invalid scope' }, null, 2) }] };
    }
  );
}
