/**
 * Search ranking helpers (arch-review S6).
 *
 * Moved verbatim from tools/read/query.ts so ranking logic lives in core —
 * the registration file had grown into a domain module (G1 F7). Behaviour
 * pinned by test/read/tools/search-contract.test.ts and
 * search-hybrid-seam.test.ts before the move.
 */

import type { VaultIndex } from '../read/types.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import { getAllFeedbackBoosts } from '../write/wikilinkFeedback.js';
import { getCooccurrenceBoost } from '../shared/cooccurrence.js';
import { getCooccurrenceIndex } from '../write/wikilinks.js';
import { getRecencyBoost, loadRecencyFromStateDb } from '../shared/recency.js';
import { getEntityEdgeWeightMap } from '../write/edgeWeights.js';
import type { Memory } from '../write/memory.js';

/**
 * Determine whether multi-hop backfill should run for a query + result set.
 *
 * Triggers on:
 * - Sparse results (< 3, existing behavior)
 * - Bridge structure: top results reference entities absent from the query
 * - Low diversity: top results cluster in the same folder/conversation
 */
export function shouldRunMultiHop(
  query: string,
  results: Array<Record<string, unknown>>,
  index: VaultIndex,
): boolean {
  // Always run when results are sparse
  if (results.length < 3) return true;

  // Skip if already have many results — backfill won't help
  if (results.length >= 8) return false;

  // Check for bridge structure: do top results reference entities
  // that the query doesn't mention?
  const queryLower = query.toLowerCase();
  const topResults = results.slice(0, 5);
  let bridgeSignals = 0;
  for (const r of topResults) {
    const outlinks = r.outlink_names as string[] | undefined;
    if (!outlinks) continue;
    for (const name of outlinks) {
      if (name.length >= 3 && !queryLower.includes(name.toLowerCase())) {
        bridgeSignals++;
      }
    }
  }
  if (bridgeSignals >= 3) return true;

  // Check for low diversity: all top results in the same folder
  const folders = new Set<string>();
  for (const r of topResults) {
    const p = r.path as string;
    if (p) {
      const folder = p.split('/').slice(0, -1).join('/');
      folders.add(folder);
    }
  }
  if (folders.size === 1 && topResults.length >= 3) return true;

  return false;
}

/**
 * Apply graph signal re-ranking to search results.
 * Adds cooccurrence, recency, feedback, and edge weight boosts,
 * then re-sorts by combined score.
 */
export function applyGraphReranking(
  results: Array<Record<string, unknown>>,
  stateDb: StateDb | null,
): void {
  if (!stateDb) return;

  const cooccurrenceIndex = getCooccurrenceIndex();
  const recencyIndex = loadRecencyFromStateDb();
  const feedbackBoosts = getAllFeedbackBoosts(stateDb);
  const edgeWeightMap = getEntityEdgeWeightMap(stateDb);

  if (!cooccurrenceIndex && !recencyIndex) return;

  // Build seed set from result titles/paths
  const seedEntities = new Set<string>();
  for (const r of results) {
    const name = (r.title as string) || (r.path as string)?.replace(/\.md$/, '').split('/').pop() || '';
    if (name) seedEntities.add(name);
  }

  for (const r of results) {
    const name = (r.title as string) || (r.path as string)?.replace(/\.md$/, '').split('/').pop() || '';
    let graphBoost = 0;
    if (cooccurrenceIndex) graphBoost += getCooccurrenceBoost(name, seedEntities, cooccurrenceIndex, recencyIndex);
    if (recencyIndex) graphBoost += getRecencyBoost(name, recencyIndex);
    graphBoost += feedbackBoosts.get(name) ?? 0;
    const avgWeight = edgeWeightMap.get(name.toLowerCase());
    if (avgWeight && avgWeight > 1.0) graphBoost += Math.min((avgWeight - 1.0) * 3, 6);

    if (graphBoost > 0) {
      r.graph_boost = graphBoost;
      const baseScore = (r.rrf_score as number) ?? 0;
      r._combined_score = baseScore + (graphBoost / 50);
    }
  }

  results.sort((a, b) =>
    ((b._combined_score as number) ?? (b.rrf_score as number) ?? 0) -
    ((a._combined_score as number) ?? (a.rrf_score as number) ?? 0)
  );
}

/**
 * U-shaped reorder: distribute results so the highest-ranked items land at
 * positions 1 and N (the attention peaks), while the lowest-ranked items
 * sit in the middle (the attention trough).
 *
 * Given score-sorted input [1,2,3,4,5,6,7,8], produces [1,3,5,7,8,6,4,2].
 * Odd-ranked items fill from the front, even-ranked from the back.
 *
 * Research: LLMs have a U-shaped attention curve — 30%+ accuracy drop for
 * information placed in middle positions. (Liu et al. 2024, "Lost in the Middle")
 */
export function applySandwichOrdering(results: Array<Record<string, unknown>>): void {
  if (results.length < 3) return;
  const n = results.length;
  const out = new Array<Record<string, unknown>>(n);
  let front = 0;
  let back = n - 1;
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) {
      out[front++] = results[i];
    } else {
      out[back--] = results[i];
    }
  }
  for (let i = 0; i < n; i++) {
    results[i] = out[i];
  }
}

/**
 * Strip internal scoring/provenance fields that waste context tokens.
 * Results are already sorted by these scores; exposing them adds no agent value.
 */
export function stripInternalFields(results: Array<Record<string, unknown>>): void {
  const INTERNAL = ['rrf_score', 'in_fts5', 'in_semantic', 'in_entity', 'graph_boost', '_combined_score'];
  for (const r of results) {
    for (const key of INTERNAL) delete r[key];
  }
}

/**
 * Score and rank memory search results.
 * Ported from recall.ts Channel 3 scoring logic.
 * BM25 handles text relevance; this re-ranks by confidence + type boost.
 */
export function scoreAndRankMemories(memories: Memory[], limit: number): Array<Record<string, unknown>> {
  const now = Date.now();
  const scored: Array<{ memory: Memory; score: number }> = [];

  for (const m of memories) {
    const confidenceBoost = m.confidence * 5;
    let typeBoost = 0;
    switch (m.memory_type) {
      case 'fact': typeBoost = 3; break;
      case 'preference': typeBoost = 2; break;
      case 'observation': {
        const ageDays = (now - m.updated_at) / 86400000;
        const recencyFactor = Math.max(0.2, 1 - ageDays / 7);
        typeBoost = 1 + (4 * recencyFactor);
        break;
      }
      case 'summary': typeBoost = 1; break;
    }
    scored.push({ memory: m, score: confidenceBoost + typeBoost });
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(({ memory: m }) => {
    const result: Record<string, unknown> = {
      key: m.key,
      value: m.value,
      type: m.memory_type,
    };
    if (m.entity) result.entity = m.entity;
    if (m.entities_json) {
      try {
        const entities = JSON.parse(m.entities_json);
        if (Array.isArray(entities) && entities.length > 0) result.entities = entities;
      } catch { /* skip malformed */ }
    }
    return result;
  });
}
