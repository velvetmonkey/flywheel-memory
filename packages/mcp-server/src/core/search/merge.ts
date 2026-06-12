/**
 * Search channel merging (arch-review S6).
 *
 * The hybrid (FTS5 × semantic × entity × edge-weight) RRF merge and the
 * non-hybrid FTS5+entity merge, extracted verbatim from the inline blocks
 * in tools/read/query.ts. Single home for result merging; the RRF
 * implementation moved here from core/read/embeddings.ts in S8 (G2 S6/S8
 * boundary).
 *
 * Seam pinned by test/read/tools/search-hybrid-seam.test.ts before the move.
 */

import type { FTS5Result } from '../read/fts5.js';
import type { ScoredNote } from '../read/embeddings/search.js';
import type { EntitySearchResult } from '@velvetmonkey/vault-core';

// =============================================================================
// Reciprocal Rank Fusion
// =============================================================================

/**
 * Merge two ranked lists using Reciprocal Rank Fusion (RRF).
 * score(doc) = Σ 1/(k + rank_in_list)
 * k=60 is the standard constant from the original paper.
 */
export function reciprocalRankFusion<T extends { path: string }>(
  ...lists: T[][]
): Map<string, number> {
  const k = 60;
  const scores = new Map<string, number>();

  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank];
      const rrfScore = 1 / (k + rank + 1); // rank is 0-indexed, so +1
      scores.set(item.path, (scores.get(item.path) || 0) + rrfScore);
    }
  }

  return scores;
}

export interface HybridMergedHit {
  [key: string]: unknown;
  path: string;
  title: string;
  snippet: string | undefined;
  rrf_score: number;
  in_fts5: boolean;
  in_semantic: boolean;
  in_entity: boolean;
}

const normalizePath = (p: string) => p.replace(/\\/g, '/').replace(/\/+/g, '/');

/**
 * RRF merge of FTS5, semantic, entity, and edge-weight ranked lists, with
 * exact/prefix title boosting. Returns the full scored list sorted by
 * rrf_score descending (caller slices to limit).
 */
export function mergeHybridResults(input: {
  query: string;
  fts5Results: FTS5Result[];
  semanticResults: ScoredNote[];
  entityResults: EntitySearchResult[];
  edgeRanked: Array<{ path: string; title: string }>;
}): HybridMergedHit[] {
  const { query, fts5Results, semanticResults, entityResults, edgeRanked } = input;

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

  const queryLower = query.toLowerCase().trim();
  const scored = Array.from(allPaths).map(p => {
    const title = fts5Map.get(p)?.title || semanticMap.get(p)?.title || entityMap.get(p)?.name || p.replace(/\.md$/, '').split('/').pop() || p;
    let rrf_score = rrfScores.get(p) || 0;
    // Boost exact title matches so "emma" always ranks Emma first
    if (title.toLowerCase() === queryLower) rrf_score += 0.5;
    else if (title.toLowerCase().startsWith(queryLower)) rrf_score += 0.2;
    return {
      path: p,
      title,
      snippet: fts5Map.get(p)?.snippet,
      rrf_score,
      in_fts5: fts5Map.has(p),
      in_semantic: semanticMap.has(p),
      in_entity: entityMap.has(p),
    };
  });

  scored.sort((a, b) => b.rrf_score - a.rrf_score);
  return scored;
}

export type FtsEntityMergedItem =
  | { path: string; title: string; snippet: string | undefined; in_fts5: true }
  | { path: string; title: string; snippet: string | undefined; in_entity: true };

/**
 * Non-hybrid merge: FTS5 results followed by entity-only hits, with exact/
 * prefix title matches bubbled to the top. Returns the full merged list
 * (caller slices to limit).
 */
export function mergeFtsEntityResults(
  query: string,
  fts5Results: FTS5Result[],
  entityResults: EntitySearchResult[],
): FtsEntityMergedItem[] {
  const fts5Map = new Map(fts5Results.map(r => [normalizePath(r.path), r]));
  const entityRanked = entityResults.filter(r => !fts5Map.has(normalizePath(r.path)));
  const queryLower = query.toLowerCase().trim();
  const mergedItems: FtsEntityMergedItem[] = [
    ...fts5Results.map(r => ({ path: r.path, title: r.title, snippet: r.snippet, in_fts5: true as const })),
    ...entityRanked.map(r => ({ path: r.path, title: r.name, snippet: undefined as string | undefined, in_entity: true as const })),
  ];
  // Boost exact title matches to the top
  mergedItems.sort((a, b) => {
    const aExact = a.title.toLowerCase() === queryLower ? 2 : a.title.toLowerCase().startsWith(queryLower) ? 1 : 0;
    const bExact = b.title.toLowerCase() === queryLower ? 2 : b.title.toLowerCase().startsWith(queryLower) ? 1 : 0;
    return bExact - aExact;
  });
  return mergedItems;
}
