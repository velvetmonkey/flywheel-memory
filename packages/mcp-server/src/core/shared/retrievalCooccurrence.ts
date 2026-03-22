/**
 * Retrieval Co-occurrence
 *
 * "Notes that travel together get linked together."
 *
 * Mines tool_invocations for notes co-retrieved in the same session,
 * building implicit note-pair associations. These associations are used
 * to boost wikilink suggestions for entities mentioned in co-retrieved notes.
 *
 * Integrates with the existing Layer 4 co-occurrence scoring as a secondary
 * signal via Math.max(contentBoost, retrievalBoost).
 */

import type { StateDb } from '@velvetmonkey/vault-core';

// =============================================================================
// Constants
// =============================================================================

/** Maximum boost from retrieval co-occurrence (half of content co-occurrence max of 12) */
export const MAX_RETRIEVAL_BOOST = 6;

/** Time decay half-life in days — retrieval associations fade faster than content ones */
const HALF_LIFE_DAYS = 7;

/** Metadata key for tracking last-processed invocation ID */
const LAST_PROCESSED_KEY = 'retrieval_cooc_last_id';

/** Daily note pattern — excluded from co-retrieval tracking (too noisy) */
const DAILY_NOTE_RE = /\d{4}-\d{2}-\d{2}\.md$/;

/** Retrieval tools that return note results */
const RETRIEVAL_TOOLS = new Set(['recall', 'search', 'search_notes']);

// =============================================================================
// Mining: Extract co-retrieval pairs from tool_invocations
// =============================================================================

/**
 * Mine tool_invocations for co-retrieved note pairs.
 * Only processes invocations newer than the last-processed ID.
 * Returns count of new pairs inserted.
 */
export function mineRetrievalCooccurrence(stateDb: StateDb): number {
  const db = stateDb.db;

  // Get last-processed invocation ID
  const lastRow = db.prepare(
    `SELECT value FROM fts_metadata WHERE key = ?`
  ).get(LAST_PROCESSED_KEY) as { value: string } | undefined;
  const lastId = lastRow ? parseInt(lastRow.value, 10) : 0;

  // Query new retrieval invocations grouped by session
  const toolPlaceholders = Array.from(RETRIEVAL_TOOLS).map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id, session_id, note_paths, timestamp
    FROM tool_invocations
    WHERE id > ? AND tool_name IN (${toolPlaceholders}) AND note_paths IS NOT NULL AND session_id IS NOT NULL
    ORDER BY id
  `).all(lastId, ...RETRIEVAL_TOOLS) as Array<{
    id: number;
    session_id: string;
    note_paths: string;
    timestamp: number;
  }>;

  if (rows.length === 0) return 0;

  // Group note paths by session
  const sessionNotes = new Map<string, { paths: Set<string>; timestamp: number }>();

  for (const row of rows) {
    let paths: string[];
    try {
      paths = JSON.parse(row.note_paths);
    } catch {
      continue;
    }

    const existing = sessionNotes.get(row.session_id);
    if (existing) {
      for (const p of paths) existing.paths.add(p);
      existing.timestamp = Math.max(existing.timestamp, row.timestamp);
    } else {
      sessionNotes.set(row.session_id, {
        paths: new Set(paths),
        timestamp: row.timestamp,
      });
    }
  }

  // Generate pairs and insert
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO retrieval_cooccurrence (note_a, note_b, session_id, timestamp, weight)
    VALUES (?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  const maxId = rows[rows.length - 1].id;

  const insertAll = db.transaction(() => {
    for (const [sessionId, { paths, timestamp }] of sessionNotes) {
      // Filter out daily notes
      const filtered = Array.from(paths).filter(p => !DAILY_NOTE_RE.test(p));
      if (filtered.length < 2) continue;

      // Adamic-Adar weighting: smaller batches = stronger signal
      const weight = 1 / Math.log(filtered.length);

      // Generate all pairs (alphabetically ordered)
      for (let i = 0; i < filtered.length; i++) {
        for (let j = i + 1; j < filtered.length; j++) {
          const [a, b] = filtered[i] < filtered[j]
            ? [filtered[i], filtered[j]]
            : [filtered[j], filtered[i]];

          const result = insertStmt.run(a, b, sessionId, timestamp, weight);
          if (result.changes > 0) inserted++;
        }
      }
    }

    // Update last-processed ID
    db.prepare(
      `INSERT OR REPLACE INTO fts_metadata (key, value) VALUES (?, ?)`
    ).run(LAST_PROCESSED_KEY, String(maxId));
  });

  insertAll();
  return inserted;
}

// =============================================================================
// Boost: Compute retrieval co-occurrence boosts for all entities at once
// =============================================================================

/**
 * Build a map of entity note path → retrieval boost for all entities
 * whose notes have been co-retrieved with any seed note path.
 *
 * This is a bulk operation: one DB query instead of per-entity queries.
 *
 * @param seedNotePaths - Note paths where seed entities (content-matched) appear
 * @param stateDb - Database handle
 * @returns Map from note path → time-decayed retrieval weight
 */
export function buildRetrievalBoostMap(
  seedNotePaths: Set<string>,
  stateDb: StateDb,
): Map<string, number> {
  if (seedNotePaths.size === 0) return new Map();

  const now = Date.now();
  const halfLifeMs = HALF_LIFE_DAYS * 24 * 60 * 60 * 1000;
  const lambda = Math.LN2 / halfLifeMs;

  // Query all retrieval co-occurrence rows involving any seed note path
  const boostMap = new Map<string, number>();

  for (const seedPath of seedNotePaths) {
    const rows = stateDb.db.prepare(`
      SELECT note_a, note_b, timestamp, weight
      FROM retrieval_cooccurrence
      WHERE note_a = ? OR note_b = ?
    `).all(seedPath, seedPath) as Array<{
      note_a: string;
      note_b: string;
      timestamp: number;
      weight: number;
    }>;

    for (const row of rows) {
      const otherNote = row.note_a === seedPath ? row.note_b : row.note_a;
      if (seedNotePaths.has(otherNote)) continue; // skip seed-to-seed pairs

      const age = now - row.timestamp;
      const decayFactor = Math.exp(-lambda * age);
      const w = row.weight * decayFactor;

      boostMap.set(otherNote, (boostMap.get(otherNote) || 0) + w);
    }
  }

  return boostMap;
}

/**
 * Get retrieval co-occurrence boost for an entity given its note path.
 *
 * @param entityPath - Primary note path for the entity
 * @param retrievalBoostMap - Pre-built map from buildRetrievalBoostMap()
 * @returns Boost value 0-MAX_RETRIEVAL_BOOST
 */
export function getRetrievalBoost(
  entityPath: string | undefined,
  retrievalBoostMap: Map<string, number>,
): number {
  if (!entityPath || retrievalBoostMap.size === 0) return 0;

  const weight = retrievalBoostMap.get(entityPath) || 0;
  if (weight <= 0) return 0;

  // Scale: 1.0 weight → 3 points, cap at MAX_RETRIEVAL_BOOST
  return Math.min(Math.round(weight * 3), MAX_RETRIEVAL_BOOST);
}

// =============================================================================
// Maintenance
// =============================================================================

/**
 * Delete retrieval co-occurrence records older than maxAgeDays.
 */
export function pruneStaleRetrievalCooccurrence(stateDb: StateDb, maxAgeDays: number = 30): number {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const result = stateDb.db.prepare(
    'DELETE FROM retrieval_cooccurrence WHERE timestamp < ?'
  ).run(cutoff);
  return result.changes;
}

/**
 * Get count of retrieval co-occurrence records (for diagnostics).
 */
export function getRetrievalCooccurrenceCount(stateDb: StateDb): number {
  const row = stateDb.db.prepare(
    'SELECT COUNT(*) as cnt FROM retrieval_cooccurrence'
  ).get() as { cnt: number };
  return row.cnt;
}
