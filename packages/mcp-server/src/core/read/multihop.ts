/**
 * Multi-hop retrieval backfill and query expansion.
 *
 * Goal: one search call returns everything needed to answer a complex
 * multi-hop question. Traverses outlinks from primary results (2 hops deep)
 * and expands the query with entity names found in initial results.
 *
 * All hop traversal is in-memory via VaultIndex — no FTS5/embedding calls.
 * The only IO is getContentPreview() for backfill result snippets.
 */

import type { VaultIndex } from '../shared/types.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import { enrichResultCompact, recencyDecay } from './enrichment.js';
import { getEntityByName, searchEntities } from '@velvetmonkey/vault-core';

export interface MultiHopConfig {
  /** Max primary results to expand outlinks from (default: 10) */
  maxParents: number;
  /** Max hop depth (default: 2) */
  maxHops: number;
  /** Max outlinks to follow per result per hop (default: 10) */
  maxOutlinksPerHop: number;
  /** Max total backfill results to return (default: 10) */
  maxBackfill: number;
}

const DEFAULT_CONFIG: MultiHopConfig = {
  maxParents: 10,
  maxHops: 2,
  maxOutlinksPerHop: 10,
  maxBackfill: 10,
};

/**
 * Multi-hop backfill: traverse outlinks from primary results, enrich with
 * compact metadata + content snippets, and return with provenance.
 *
 * Always runs (not gated on result count). Results ordered: hop-1 first, then hop-2.
 */
export function multiHopBackfill(
  primaryResults: Array<Record<string, unknown>>,
  index: VaultIndex,
  stateDb: StateDb | null,
  config: Partial<MultiHopConfig> = {},
): Array<Record<string, unknown>> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const seen = new Set<string>(primaryResults.map(r => r.path as string).filter(Boolean));
  const candidates: Array<{ result: Record<string, unknown>; score: number }> = [];

  // Hop 1: outlinks of primary results
  const hop1Results: Array<{ path: string; title: string; via: string }> = [];
  for (const primary of primaryResults.slice(0, cfg.maxParents)) {
    const primaryPath = primary.path as string;
    if (!primaryPath) continue;

    const note = index.notes.get(primaryPath);
    if (!note) continue;

    for (const outlink of note.outlinks.slice(0, cfg.maxOutlinksPerHop)) {
      const targetPath = index.entities.get(outlink.target.toLowerCase());
      if (!targetPath || seen.has(targetPath)) continue;
      seen.add(targetPath);

      const targetNote = index.notes.get(targetPath);
      const title = targetNote?.title ?? outlink.target;

      hop1Results.push({ path: targetPath, title, via: primaryPath });
    }
  }

  // Enrich and score hop-1 results
  for (const h1 of hop1Results) {
    const enriched = enrichResultCompact(
      { path: h1.path, title: h1.title },
      index, stateDb,
      { via: h1.via, hop: 1 },
    );
    const score = scoreCandidate(h1.path, index, stateDb);
    candidates.push({ result: enriched, score });
  }

  // Hop 2: outlinks of hop-1 results (if configured)
  if (cfg.maxHops >= 2) {
    for (const h1 of hop1Results) {
      const note = index.notes.get(h1.path);
      if (!note) continue;

      for (const outlink of note.outlinks.slice(0, cfg.maxOutlinksPerHop)) {
        const targetPath = index.entities.get(outlink.target.toLowerCase());
        if (!targetPath || seen.has(targetPath)) continue;
        seen.add(targetPath);

        const targetNote = index.notes.get(targetPath);
        const title = targetNote?.title ?? outlink.target;

        const enriched = enrichResultCompact(
          { path: targetPath, title },
          index, stateDb,
          { via: h1.path, hop: 2 },
        );
        const score = scoreCandidate(targetPath, index, stateDb);
        candidates.push({ result: enriched, score });
      }
    }
  }

  // Sort by score descending, truncate
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, cfg.maxBackfill).map(c => c.result);
}

/**
 * Score a backfill candidate cheaply: hub_score * recency decay.
 * No FTS5/embedding calls — pure in-memory + single entity lookup.
 */
function scoreCandidate(
  path: string,
  index: VaultIndex,
  stateDb: StateDb | null,
): number {
  const note = index.notes.get(path);
  const decay = recencyDecay(note?.modified);
  let hubScore = 1;

  if (stateDb) {
    try {
      const title = note?.title ?? path.replace(/\.md$/, '').split('/').pop() ?? '';
      const entity = getEntityByName(stateDb, title);
      if (entity) hubScore = entity.hubScore ?? 1;
    } catch { /* best-effort */ }
  }

  return hubScore * decay;
}

/**
 * Extract entity names from primary results for query expansion.
 * Returns names found in outlinks and wikilinks-in-snippets that aren't
 * already in the original query.
 */
export function extractExpansionTerms(
  results: Array<Record<string, unknown>>,
  originalQuery: string,
  index: VaultIndex,
): string[] {
  const queryLower = originalQuery.toLowerCase();
  const terms = new Set<string>();

  for (const r of results.slice(0, 5)) {
    // Outlink names not overlapping with query
    const outlinks = r.outlink_names as string[] | undefined;
    if (outlinks) {
      for (const name of outlinks) {
        if (!queryLower.includes(name.toLowerCase()) && index.entities.has(name.toLowerCase())) {
          terms.add(name);
        }
      }
    }

    // Wikilinks in snippets
    const snippet = r.snippet as string | undefined;
    if (snippet) {
      const matches = snippet.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g);
      if (matches) {
        for (const wl of matches) {
          const name = wl.replace(/\[\[|\]\]/g, '').split('|')[0];
          if (!queryLower.includes(name.toLowerCase()) && index.entities.has(name.toLowerCase())) {
            terms.add(name);
          }
        }
      }
    }
  }

  return Array.from(terms).slice(0, 10);
}

/**
 * Perform query expansion: look up expansion terms in the entity table
 * and return as backfill results with provenance.
 */
export function expandQuery(
  expansionTerms: string[],
  primaryResults: Array<Record<string, unknown>>,
  index: VaultIndex,
  stateDb: StateDb | null,
): Array<Record<string, unknown>> {
  if (!stateDb || expansionTerms.length === 0) return [];

  const seen = new Set<string>(primaryResults.map(r => r.path as string).filter(Boolean));
  const results: Array<Record<string, unknown>> = [];

  for (const term of expansionTerms) {
    try {
      const entities = searchEntities(stateDb, term, 3);
      for (const entity of entities) {
        if (!entity.path || seen.has(entity.path)) continue;
        seen.add(entity.path);

        results.push(enrichResultCompact(
          { path: entity.path, title: entity.name },
          index, stateDb,
          { via: 'query_expansion' },
        ));
      }
    } catch { /* best-effort */ }
  }

  return results;
}
