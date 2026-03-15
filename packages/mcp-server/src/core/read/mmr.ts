/**
 * Maximal Marginal Relevance (MMR) Selection
 *
 * Greedy MMR algorithm for diversifying search results.
 * Balances relevance against redundancy using cosine similarity.
 */

import { cosineSimilarity } from './embeddings.js';

// =============================================================================
// Types
// =============================================================================

export interface MmrCandidate {
  id: string;
  score: number;
  embedding: Float32Array | null; // null → no diversity penalty (treated as unique)
}

// =============================================================================
// MMR Selection
// =============================================================================

/**
 * Select candidates using Maximal Marginal Relevance.
 *
 * MMR score = λ * norm_relevance - (1-λ) * max(cosineSim(candidate, selected))
 *
 * @param candidates - Scored candidates with optional embeddings
 * @param limit - Max results to return
 * @param lambda - Relevance vs diversity tradeoff (0=max diversity, 1=max relevance, default 0.7)
 */
export function selectByMmr(
  candidates: MmrCandidate[],
  limit: number,
  lambda: number = 0.7,
): MmrCandidate[] {
  if (candidates.length <= limit) return candidates;
  if (candidates.length === 0) return [];

  // Normalize scores to [0,1]
  const maxScore = Math.max(...candidates.map(c => c.score));
  if (maxScore === 0) return candidates.slice(0, limit);

  const normScores = new Map<string, number>();
  for (const c of candidates) {
    normScores.set(c.id, c.score / maxScore);
  }

  const selected: MmrCandidate[] = [];
  const remaining = new Set(candidates.map((_, i) => i));

  // First pick = highest relevance
  let bestIdx = 0;
  let bestScore = -Infinity;
  for (const idx of remaining) {
    if (candidates[idx].score > bestScore) {
      bestScore = candidates[idx].score;
      bestIdx = idx;
    }
  }
  selected.push(candidates[bestIdx]);
  remaining.delete(bestIdx);

  // Greedy selection
  while (selected.length < limit && remaining.size > 0) {
    let bestMmr = -Infinity;
    let bestCandidate = -1;

    for (const idx of remaining) {
      const candidate = candidates[idx];
      const relevance = normScores.get(candidate.id) || 0;

      // Max similarity to any already-selected item
      let maxSim = 0;
      if (candidate.embedding !== null) {
        for (const sel of selected) {
          if (sel.embedding !== null) {
            const sim = cosineSimilarity(candidate.embedding, sel.embedding);
            if (sim > maxSim) maxSim = sim;
          }
        }
      }
      // null embedding → maxSim stays 0 (no diversity penalty)

      const mmr = lambda * relevance - (1 - lambda) * maxSim;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestCandidate = idx;
      }
    }

    if (bestCandidate === -1) break;
    selected.push(candidates[bestCandidate]);
    remaining.delete(bestCandidate);
  }

  return selected;
}
