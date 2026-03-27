/**
 * Hub score export — eigenvector centrality
 *
 * Computes eigenvector centrality via power iteration on the vault's
 * wikilink graph and writes scores to SQLite. Eigenvector centrality
 * weights nodes by the importance of their connections — a note linked
 * from important notes scores higher than one with many low-importance links.
 *
 * Replaces the previous raw backlink count with a topology-aware signal.
 * All downstream consumers (Layer 9 hub_boost, recall, enrichment,
 * emerging_hubs) automatically get the improved scores.
 */

import type { VaultIndex } from './types.js';
import { normalizeTarget } from '../read/graph.js';
import type { StateDb } from '@velvetmonkey/vault-core';

/** Number of power iterations for eigenvector convergence */
const EIGEN_ITERATIONS = 50;

/**
 * Compute hub scores using eigenvector centrality.
 *
 * Builds a bidirectional adjacency list from the vault's wikilink graph,
 * then runs power iteration to convergence. Scores are scaled to 0-100.
 *
 * @returns Map of normalized entity name → score (0-100)
 */
export function computeHubScores(index: VaultIndex): { scores: Map<string, number>; edgeCount: number } {
  // Build node list and adjacency
  const nodes: string[] = [];
  const nodeIdx = new Map<string, number>();
  const adj: number[][] = [];

  for (const note of index.notes.values()) {
    const key = normalizeTarget(note.path);
    if (!nodeIdx.has(key)) {
      nodeIdx.set(key, nodes.length);
      nodes.push(key);
      adj.push([]);
    }
    // Also register by title
    const titleKey = note.title.toLowerCase();
    if (!nodeIdx.has(titleKey)) {
      nodeIdx.set(titleKey, nodeIdx.get(key)!);
    }
  }

  const N = nodes.length;
  if (N === 0) return { scores: new Map(), edgeCount: 0 };

  // Build edges from outlinks (bidirectional for eigenvector)
  for (const note of index.notes.values()) {
    const fromIdx = nodeIdx.get(normalizeTarget(note.path));
    if (fromIdx === undefined) continue;
    for (const link of note.outlinks) {
      const target = normalizeTarget(link.target);
      // Try direct match, then title-based lookup
      let toIdx = nodeIdx.get(target);
      if (toIdx === undefined) {
        toIdx = nodeIdx.get(link.target.toLowerCase());
      }
      if (toIdx !== undefined && toIdx !== fromIdx) {
        adj[fromIdx].push(toIdx);
        adj[toIdx].push(fromIdx);
      }
    }
  }

  // Count edges for diagnostics
  const edgeCount = adj.reduce((sum, a) => sum + a.length, 0);
  if (edgeCount === 0) {
    console.error(`[Flywheel] Hub scores: 0 edges in graph of ${N} nodes, skipping eigenvector`);
    return { scores: new Map(), edgeCount: 0 };
  }

  // Power iteration for eigenvector centrality
  let scores = new Float64Array(N).fill(1 / N);
  for (let iter = 0; iter < EIGEN_ITERATIONS; iter++) {
    const next = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      for (const j of adj[i]) {
        next[i] += scores[j];
      }
    }
    // L2 normalize
    let norm = 0;
    for (let i = 0; i < N; i++) norm += next[i] * next[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < N; i++) next[i] /= norm;
    }
    scores = next;
  }

  // Scale to 0-100 and build result map
  let maxScore = 0;
  for (let i = 0; i < N; i++) {
    if (scores[i] > maxScore) maxScore = scores[i];
  }

  const result = new Map<string, number>();
  for (let i = 0; i < N; i++) {
    const scaled = maxScore > 0 ? Math.round((scores[i] / maxScore) * 100) : 0;
    if (scaled > 0) {
      result.set(nodes[i], scaled);
    }
  }

  // Fallback to degree centrality when eigenvector is too sparse
  // (disconnected components cause most nodes to get zero)
  if (result.size < N * 0.1 && edgeCount > 0) {
    console.error(`[Flywheel] Hub scores: eigenvector too sparse (${result.size}/${N}), falling back to degree centrality`);
    result.clear();
    let maxDegree = 0;
    for (let i = 0; i < N; i++) {
      if (adj[i].length > maxDegree) maxDegree = adj[i].length;
    }
    if (maxDegree > 0) {
      for (let i = 0; i < N; i++) {
        const scaled = Math.round((adj[i].length / maxDegree) * 100);
        if (scaled > 0) result.set(nodes[i], scaled);
      }
    }
  }

  return { scores: result, edgeCount };
}


/**
 * Update hub scores directly in SQLite database
 *
 * @param stateDb - State database instance
 * @param hubScores - Map of entity name -> backlink count
 * @returns Number of entities updated
 */
function updateHubScoresInDb(stateDb: StateDb, hubScores: Map<string, number>): number {
  // Prepare an update statement for hub scores
  const updateStmt = stateDb.db.prepare(`
    UPDATE entities SET hub_score = ? WHERE name_lower = ?
  `);

  let updated = 0;
  const transaction = stateDb.db.transaction(() => {
    for (const [nameLower, score] of hubScores) {
      const result = updateStmt.run(score, nameLower);
      if (result.changes > 0) {
        updated++;
      }
    }
  });

  transaction();
  return updated;
}

/**
 * Export hub scores to SQLite StateDb
 *
 * Computes hub scores from the vault index and writes them to SQLite.
 * Flywheel Memory reads these scores for wikilink prioritization.
 *
 * @param vaultIndex - Built vault index with backlinks
 * @param stateDb - StateDb for SQLite storage (required)
 * @returns Number of entities updated with hub scores
 */
export async function exportHubScores(
  vaultIndex: VaultIndex,
  stateDb: StateDb | null | undefined
): Promise<number> {
  if (!stateDb) {
    console.error('[Flywheel] No StateDb available, skipping hub score export');
    return 0;
  }

  // Compute hub scores from vault index
  const { scores: hubScores, edgeCount } = computeHubScores(vaultIndex);
  console.error(`[Flywheel] Computed hub scores for ${hubScores.size} notes (${edgeCount} edges in graph)`);

  // Update hub scores in SQLite
  try {
    const updated = updateHubScoresInDb(stateDb, hubScores);
    console.error(`[Flywheel] Updated ${updated} hub scores in StateDb`);
    return updated;
  } catch (e) {
    console.error('[Flywheel] Failed to update hub scores in StateDb:', e);
    return 0;
  }
}
