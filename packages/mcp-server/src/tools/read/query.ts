/**
 * Query tools - unified search across metadata, content, and entities
 *
 * Registration + orchestration only — ranking, channel merging, bridging,
 * assembly, and the shared post-processing tail live in
 * core/search/ (arch-review S6).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex, VaultNote } from '../../core/read/types.js';
import { MAX_LIMIT } from '../../core/read/constants.js';
import { requireIndex } from '../../core/read/indexGuard.js';
import { serverLog } from '../../core/shared/serverLog.js';
import { extractObservedHits, observedHits, observedNearMisses } from '../../core/shared/observer.js';

// How many below-cutoff candidates to surface as "considered but discarded".
// The observer caps internally to MAX_OBSERVED_HITS (8) + a byte guard.
const NEAR_MISS_K = 8;
import {
  searchFTS5,
  buildFTS5Index,
  isIndexStale,
  getFTS5State,
} from '../../core/read/fts5.js';
import {
  searchEntities,
  searchEntitiesPrefix,
  type StateDb,
  type EntitySearchResult,
} from '@velvetmonkey/vault-core';
import { semanticSearch, hasEmbeddingsIndex } from '../../core/read/embeddings.js';
import { findSimilarNotes, findHybridSimilarNotes } from '../../core/read/similarity.js';
import { enrichResult, enrichResultLight, enrichResultCompact } from '../../core/read/enrichment.js';
import { searchMemories } from '../../core/write/memory.js';
import { sortNotes } from './filters.js';
import { filterByDateWindow } from '../../core/read/noteFilters.js';
import { scoreAndRankMemories, applySandwichOrdering } from '../../core/search/ranking.js';
import { mergeHybridResults, mergeFtsEntityResults } from '../../core/search/merge.js';
import { buildEntitySection } from '../../core/search/assemble.js';
import { buildEdgeRankedList } from '../../core/search/bridging.js';
import { postProcessSearchResults } from '../../core/search/postProcess.js';

// Re-export for existing importers (canonical home: core/search/ranking.ts)
export { applySandwichOrdering };

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
    'Read-only query of vault notes. action=query (default): keyword/concept/date search. action=similar: content-overlap neighbours of a given note path. Returns ranked results with frontmatter, links, section provenance, and confidence scores; cross-vault search may also include partial_failure and vault_errors. Does not perform mutations.',
    {
      action: z.enum(['query', 'similar']).optional().describe('Operation: query (default) | similar'),

      query: z.string().optional().describe('[query] Search query text. Required for action=query unless using date filters. For folder/tags/frontmatter enumeration, use find_notes.'),

      // Date filters (find notes by modification date — for pattern analysis use temporal tools)
      modified_after: z.string().optional().describe('[query] Only notes modified after this date (YYYY-MM-DD)'),
      modified_before: z.string().optional().describe('[query] Only notes modified before this date (YYYY-MM-DD)'),

      // Sorting
      sort_by: z.enum(['modified', 'created', 'title']).default('modified').describe('[query] Field to sort by'),
      order: z.enum(['asc', 'desc']).default('desc').describe('[query] Sort order'),

      // Entity options (prefix mode for autocomplete)
      prefix: z.boolean().default(false).describe('[query] Enable prefix matching for entity search (autocomplete)'),

      // Pagination
      limit: z.number().default(10).describe('[query|similar] Maximum number of results to return'),
      detail_count: z.number().optional().describe('[query] Number of top results to return with full metadata (backlinks, outlinks, headings, frontmatter). Remaining results get lightweight summaries. Default: 5.'),

      // Context boost (edge weights)
      context_note: z.string().optional().describe('[query] Path of the note providing context. When set, results connected to this note via weighted edges get an RRF boost.'),

      // Consumer format
      consumer: z.enum(['llm', 'human']).default('llm').describe('[query] Output format: "llm" applies sandwich ordering and strips scoring fields for context efficiency. "human" preserves score order and all scoring metadata for UI display.'),

      // [similar] params
      path: z.string().optional().describe('[similar] Path to the source note (relative to vault root, e.g. "projects/alpha.md"). Required for action=similar.'),
      diversity: z.number().min(0).max(1).optional().describe('[similar] Relevance vs diversity tradeoff (0=max diversity, 1=pure relevance, default: 0.7)'),
    },
    async ({ action: rawAction, query, modified_after, modified_before, sort_by, order, prefix, limit: requestedLimit, detail_count: requestedDetailCount, context_note, consumer, path: similarPath, diversity }) => {
      const action = rawAction ?? 'query';

      // ========================================
      // action === 'similar' — content-overlap search around a source note
      // ========================================
      if (action === 'similar') {
        if (!similarPath) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({
            error: 'action=similar requires path.',
            example: { action: 'similar', path: 'projects/alpha.md' },
          }, null, 2) }] };
        }

        const index = getIndex();
        const vaultPath = getVaultPath();
        const stateDb = getStateDb();

        if (!stateDb) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available' }) }] };
        }

        if (!index.notes.has(similarPath)) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({
            error: `Note not found: ${similarPath}`,
            hint: 'Use the full relative path including .md extension',
          }, null, 2) }] };
        }

        const opts = {
          limit: requestedLimit ?? 10,
          excludeLinked: true,
          diversity: diversity ?? 0.7,
        };

        const useHybrid = hasEmbeddingsIndex();
        const method = useHybrid ? 'hybrid' : 'bm25';

        const results = useHybrid
          ? await findHybridSimilarNotes(stateDb.db, vaultPath, index, similarPath, opts)
          : findSimilarNotes(stateDb.db, vaultPath, index, similarPath, opts);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              source: similarPath,
              method,
              count: results.length,
              similar: results,
            }, null, 2),
          }],
        };
      }

      // ========================================
      // action === 'query' — free-text / date / entity search
      // ========================================
      requireIndex();
      const limit = Math.min(requestedLimit ?? 10, MAX_LIMIT);
      const enrichN = Math.min(requestedDetailCount ?? 5, limit);
      const expandN = Math.min(enrichN, 8);
      const index = getIndex();
      const vaultPath = getVaultPath();

      // ---- ENTITY AUTOCOMPLETE ----
      if (prefix && query) {
        const stateDb = getStateDb();
        if (!stateDb) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ results: [], count: 0, query, error: 'StateDb not initialized' }, null, 2) }] };
        }
        try {
          const results = searchEntitiesPrefix(stateDb, query, limit);
          return { content: [{ type: 'text' as const, text: JSON.stringify({ query, count: results.length, entities: results }, null, 2) }] };
        } catch (err) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ query, count: 0, entities: [], error: err instanceof Error ? err.message : String(err) }, null, 2) }] };
        }
      }

      // ---- DATE SEARCH (no query, just date window) ----
      if (!query && (modified_after || modified_before)) {
        let matchingNotes: VaultNote[] = filterByDateWindow(
          Array.from(index.notes.values()), modified_after, modified_before,
        );

        // Sort
        matchingNotes = sortNotes(matchingNotes, sort_by ?? 'modified', order ?? 'desc');

        const totalMatches = matchingNotes.length;
        const limitedNotes = matchingNotes.slice(0, limit);

        const stateDb = getStateDb();
        const notes = limitedNotes.map((note, i) =>
          (i < enrichN ? enrichResult : enrichResultLight)({ path: note.path, title: note.title }, index, stateDb)
        );

        return { content: [{ type: 'text' as const, text: JSON.stringify({
          total_matches: totalMatches,
          returned: notes.length,
          notes,
        }, null, 2) }] };
      }

      // ---- CONTENT SEARCH (FTS5, with automatic hybrid when semantic enabled) ----
      if (query) {

        // Ensure FTS5 index is ready
        const ftsState = getFTS5State();
        if (ftsState.building) {
          // FTS5 is building (triggered at startup), return immediately
          return { content: [{ type: 'text' as const, text: JSON.stringify({
            method: 'fts5', query, building: true,
            total_results: 0, results: [],
            message: 'Search index is building, try again shortly',
          }, null, 2) }] };
        }
        if (!ftsState.ready || isIndexStale(vaultPath)) {
          console.error('[FTS5] Index stale or missing, rebuilding...');
          await buildFTS5Index(vaultPath);
        }

        const fts5Results = searchFTS5(vaultPath, query, limit);

        // Entity search — always included in content search
        let entityResults: EntitySearchResult[] = [];
        const stateDbEntity = getStateDb();
        if (stateDbEntity) {
          try {
            entityResults = searchEntities(stateDbEntity, query, limit);
          } catch { /* entity search is best-effort */ }
        }

        // Memory search — always included in content search
        let memoryResults: Array<Record<string, unknown>> = [];
        if (stateDbEntity) {
          try {
            const rawMemories = searchMemories(stateDbEntity, { query, limit });
            memoryResults = scoreAndRankMemories(rawMemories, limit);
          } catch (err) {
            // Best-effort: search must still return note/entity results, but surface
            // the memory leg failure so regressions don't silently swallow memories.
            serverLog('fts5', `memory search failed: ${err instanceof Error ? err.message : String(err)}`, 'warn');
          }
        }

        // Entity section — enriched profiles + semantic entity search
        const entitySectionPromise = buildEntitySection(entityResults, query, stateDbEntity, index, limit);

        // Build edge-weight ranked list if context_note is provided
        const edgeRanked = context_note
          ? buildEdgeRankedList(getStateDb(), context_note, limit)
          : [];

        // Hybrid merge with semantic when embeddings exist
        if (hasEmbeddingsIndex()) {
          try {
            const semanticResults = await semanticSearch(query, limit);

            const filtered = mergeHybridResults({
              query, fts5Results, semanticResults, entityResults, edgeRanked,
            });

            const stateDb = getStateDb();
            const results: Array<Record<string, unknown>> = filtered.slice(0, limit).map(item => ({
              ...enrichResultCompact({ path: item.path, title: item.title, snippet: item.snippet }, index, stateDb),
              rrf_score: item.rrf_score,
              in_fts5: item.in_fts5,
              in_semantic: item.in_semantic,
              in_entity: item.in_entity,
            }));

            const observed = await postProcessSearchResults(results, {
              query, index, vaultPath, stateDb, consumer, limit, expandN, method: 'hybrid',
            });
            // "Considered but discarded" — the next slice of the ranked set, just
            // below the returned cutoff. `filtered` is the full RRF-sorted list;
            // these rows already carry rrf_score + in_* flags, so extract reads
            // them directly. Observer-only; never enters `results` (the LLM payload).
            const nearMiss = filtered.length > limit
              ? extractObservedHits(filtered.slice(limit, limit + NEAR_MISS_K), 'hybrid-near-miss')
              : undefined;

            const entitySection = await entitySectionPromise;
            const out = { content: [{ type: 'text' as const, text: JSON.stringify({
              method: 'hybrid',
              query,
              total_results: filtered.length,
              results,
              ...(entitySection.length > 0 ? { entities: entitySection } : {}),
              ...(memoryResults.length > 0 ? { memories: memoryResults } : {}),
            }, null, 2) }] };
            if (observed) observedHits.set(out, observed);
            if (nearMiss && nearMiss.length) observedNearMisses.set(out, nearMiss);
            return out;
          } catch (err) {
            // Semantic failed, fall back to FTS5 + entity only
            console.error('[Semantic] Hybrid search failed, falling back to FTS5:', err instanceof Error ? err.message : err);
          }
        }

        // Non-hybrid: merge FTS5 + entity results
        if (entityResults.length > 0) {
          const filtered = mergeFtsEntityResults(query, fts5Results, entityResults);
          const stateDb = getStateDb();
          const sliced = filtered.slice(0, limit);
          const results: Array<Record<string, unknown>> = sliced.map(item => ({
            ...enrichResultCompact({ path: item.path, title: item.title, snippet: item.snippet }, index, stateDb),
            ...('in_fts5' in item && item.in_fts5 ? { in_fts5: true } : { in_entity: true }),
          }));

          const observed = await postProcessSearchResults(results, {
            query, index, vaultPath, stateDb, consumer, limit, expandN, method: 'fts5',
          });

          const entitySection = await entitySectionPromise;
          const out = { content: [{ type: 'text' as const, text: JSON.stringify({
            method: 'fts5',
            query,
            total_results: filtered.length,
            results,
            ...(entitySection.length > 0 ? { entities: entitySection } : {}),
            ...(memoryResults.length > 0 ? { memories: memoryResults } : {}),
          }, null, 2) }] };
          if (observed) observedHits.set(out, observed);
          return out;
        }

        const stateDbFts = getStateDb();
        const results: Array<Record<string, unknown>> = fts5Results.map(r => ({ ...enrichResultCompact({ path: r.path, title: r.title, snippet: r.snippet }, index, stateDbFts), in_fts5: true }));

        const observed = await postProcessSearchResults(results, {
          query, index, vaultPath, stateDb: stateDbFts, consumer, limit, expandN, method: 'fts5',
        });

        const entitySection = await entitySectionPromise;
        const out = { content: [{ type: 'text' as const, text: JSON.stringify({
          method: 'fts5',
          query,
          total_results: results.length,
          results,
          ...(entitySection.length > 0 ? { entities: entitySection } : {}),
          ...(memoryResults.length > 0 ? { memories: memoryResults } : {}),
        }, null, 2) }] };
        if (observed) observedHits.set(out, observed);
        return out;
      }

      // No query and no date filters — return error
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Provide a query or date filters (modified_after, modified_before). For structural enumeration use find_notes.' }, null, 2) }] };
    }
  );
}
