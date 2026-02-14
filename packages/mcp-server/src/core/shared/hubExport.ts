/**
 * Hub score export - enriches entity data with backlink counts
 *
 * After graph build, this module computes hub scores from backlinks
 * and writes them to SQLite so Flywheel-Crank can use them
 * for wikilink prioritization.
 *
 * Architecture:
 * - Flywheel builds VaultIndex with backlinks (in-memory)
 * - This module exports hub scores to SQLite StateDb
 * - Flywheel-Crank reads hub scores from SQLite for wikilink suggestions
 */

import type { VaultIndex } from './types.js';
import { getBacklinksForNote, normalizeTarget } from '../read/graph.js';
import type { StateDb } from '@velvetmonkey/vault-core';


/**
 * Compute hub scores from the vault index
 *
 * Returns a map of normalized note path -> backlink count
 */
export function computeHubScores(index: VaultIndex): Map<string, number> {
  const hubScores = new Map<string, number>();

  for (const note of index.notes.values()) {
    const backlinks = getBacklinksForNote(index, note.path);
    const backlinkCount = backlinks.length;

    // Store by normalized path (lowercase, no .md)
    const normalizedPath = normalizeTarget(note.path);
    hubScores.set(normalizedPath, backlinkCount);

    // Also store by title for matching by name
    const title = note.title.toLowerCase();
    if (!hubScores.has(title) || backlinkCount > hubScores.get(title)!) {
      hubScores.set(title, backlinkCount);
    }
  }

  return hubScores;
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
 * Flywheel-Crank reads these scores for wikilink prioritization.
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
  const hubScores = computeHubScores(vaultIndex);
  console.error(`[Flywheel] Computed hub scores for ${hubScores.size} notes`);

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
