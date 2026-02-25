/**
 * Edge Weight Scoring
 *
 * Computes weighted edges for the note_links table based on three signals:
 * - Link survival: edits_survived from note_link_history
 * - Co-session access: notes co-accessed in the same session (from tool_invocations)
 * - Source activity: how often the source note is accessed
 *
 * Weights are stored raw; time decay is applied at query time.
 */

import type { StateDb } from '@velvetmonkey/vault-core';

// =============================================================================
// Types
// =============================================================================

export interface EdgeWeightResult {
  edges_updated: number;
  duration_ms: number;
  total_weighted: number;     // edges with weight > 1.0
  avg_weight: number;         // average weight of weighted edges
  strong_count: number;       // edges with weight > 3.0
}

// =============================================================================
// Module-level StateDb injection (follows recency.ts pattern)
// =============================================================================

let moduleStateDb: StateDb | null = null;

export function setEdgeWeightStateDb(stateDb: StateDb | null): void {
  moduleStateDb = stateDb;
}

// =============================================================================
// Path-to-targets mapping (bridges file paths to wikilink targets)
// =============================================================================

/**
 * Build a map from entity file paths to their wikilink target names.
 * Uses entities table (name_lower + aliases) as primary source,
 * falls back to file stem for non-entity paths.
 */
export function buildPathToTargetsMap(stateDb: StateDb): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();

  const rows = stateDb.db.prepare(
    'SELECT path, name_lower, aliases_json FROM entities'
  ).all() as Array<{ path: string; name_lower: string; aliases_json: string | null }>;

  for (const row of rows) {
    const targets = new Set<string>();
    targets.add(row.name_lower);

    if (row.aliases_json) {
      try {
        const aliases = JSON.parse(row.aliases_json) as string[];
        for (const alias of aliases) {
          targets.add(alias.toLowerCase());
        }
      } catch {
        // Malformed JSON, skip aliases
      }
    }

    map.set(row.path, targets);
  }

  return map;
}

/**
 * Get target name for a path that isn't in the entities table.
 * Uses file stem as fallback.
 */
function pathToFallbackTarget(filePath: string): string {
  return filePath.replace(/\.md$/, '').split('/').pop()?.toLowerCase() ?? filePath.toLowerCase();
}

// =============================================================================
// Weight computation
// =============================================================================

/**
 * Recompute edge weights for all note_links rows.
 *
 * Weight formula per edge (note_path, target):
 *   base = 1.0
 *   + (edits_survived * 0.5)                     -- from note_link_history
 *   + (co_session_count * 0.5, capped at 3.0)    -- source+target co-accessed
 *   + (session_access_count * 0.2, capped at 2.0) -- source note frequency
 */
export function recomputeEdgeWeights(stateDb: StateDb): EdgeWeightResult {
  const start = Date.now();

  // 1. Get all edges
  const edges = stateDb.db.prepare(
    'SELECT note_path, target FROM note_links'
  ).all() as Array<{ note_path: string; target: string }>;

  if (edges.length === 0) {
    return { edges_updated: 0, duration_ms: Date.now() - start, total_weighted: 0, avg_weight: 0, strong_count: 0 };
  }

  // 2. Build survival map: (note_path, target) -> edits_survived
  const survivalMap = new Map<string, number>();
  const historyRows = stateDb.db.prepare(
    'SELECT note_path, target, edits_survived FROM note_link_history'
  ).all() as Array<{ note_path: string; target: string; edits_survived: number }>;
  for (const row of historyRows) {
    survivalMap.set(`${row.note_path}\0${row.target}`, row.edits_survived);
  }

  // 3. Build path-to-targets map from entities
  const pathToTargets = buildPathToTargetsMap(stateDb);

  // 4. Build reverse map: target -> Set<path> for co-session bridging
  const targetToPaths = new Map<string, Set<string>>();
  for (const [entityPath, targets] of pathToTargets) {
    for (const target of targets) {
      let paths = targetToPaths.get(target);
      if (!paths) {
        paths = new Set();
        targetToPaths.set(target, paths);
      }
      paths.add(entityPath);
    }
  }

  // 5. Build session data from tool_invocations
  //    Group note_paths by session_id
  const sessionRows = stateDb.db.prepare(
    `SELECT session_id, note_paths FROM tool_invocations
     WHERE note_paths IS NOT NULL AND note_paths != '[]'`
  ).all() as Array<{ session_id: string; note_paths: string }>;

  const sessionPaths = new Map<string, Set<string>>();
  for (const row of sessionRows) {
    try {
      const paths = JSON.parse(row.note_paths) as string[];
      if (!Array.isArray(paths) || paths.length === 0) continue;
      let existing = sessionPaths.get(row.session_id);
      if (!existing) {
        existing = new Set();
        sessionPaths.set(row.session_id, existing);
      }
      for (const p of paths) {
        existing.add(p);
      }
    } catch {
      // Malformed JSON, skip
    }
  }

  // 6. For each edge, count co-sessions and source activity
  //    co-session: sessions where both source note_path and a path matching target appear
  //    source activity: sessions where source note_path appears
  const coSessionCount = new Map<string, number>();
  const sourceActivityCount = new Map<string, number>();

  for (const [, paths] of sessionPaths) {
    // Convert paths to targets for matching
    const sessionTargets = new Set<string>();
    for (const p of paths) {
      const targets = pathToTargets.get(p);
      if (targets) {
        for (const t of targets) sessionTargets.add(t);
      } else {
        sessionTargets.add(pathToFallbackTarget(p));
      }
    }

    // Check each edge
    for (const edge of edges) {
      if (paths.has(edge.note_path)) {
        // Source was accessed in this session
        const srcKey = edge.note_path;
        sourceActivityCount.set(srcKey, (sourceActivityCount.get(srcKey) ?? 0) + 1);

        // Check if target was also accessed (co-session)
        if (sessionTargets.has(edge.target)) {
          const edgeKey = `${edge.note_path}\0${edge.target}`;
          coSessionCount.set(edgeKey, (coSessionCount.get(edgeKey) ?? 0) + 1);
        }
      }
    }
  }

  // 7. Compute weights and update
  const now = Date.now();
  const update = stateDb.db.prepare(
    'UPDATE note_links SET weight = ?, weight_updated_at = ? WHERE note_path = ? AND target = ?'
  );

  const tx = stateDb.db.transaction(() => {
    for (const edge of edges) {
      const edgeKey = `${edge.note_path}\0${edge.target}`;

      const editsSurvived = survivalMap.get(edgeKey) ?? 0;
      const coSessions = coSessionCount.get(edgeKey) ?? 0;
      const sourceAccess = sourceActivityCount.get(edge.note_path) ?? 0;

      const weight =
        1.0
        + (editsSurvived * 0.5)
        + Math.min(coSessions * 0.5, 3.0)
        + Math.min(sourceAccess * 0.2, 2.0);

      update.run(Math.round(weight * 1000) / 1000, now, edge.note_path, edge.target);
    }
  });
  tx();

  const stats = stateDb.db.prepare(`
    SELECT
      COUNT(*) as total_weighted,
      AVG(weight) as avg_weight,
      SUM(CASE WHEN weight > 3.0 THEN 1 ELSE 0 END) as strong_count
    FROM note_links
    WHERE weight > 1.0
  `).get() as { total_weighted: number; avg_weight: number; strong_count: number } | undefined;

  return {
    edges_updated: edges.length,
    duration_ms: Date.now() - start,
    total_weighted: stats?.total_weighted ?? 0,
    avg_weight: Math.round((stats?.avg_weight ?? 0) * 100) / 100,
    strong_count: stats?.strong_count ?? 0,
  };
}

// =============================================================================
// Query helpers for scoring integration
// =============================================================================

/**
 * Build a map of entity name (lowercased) -> average incoming edge weight
 * for entities that have at least one weighted edge (weight > 1.0).
 * Used by Layer 12 in suggestRelatedLinks().
 */
export function getEntityEdgeWeightMap(stateDb: StateDb): Map<string, number> {
  const rows = stateDb.db.prepare(`
    SELECT LOWER(target) as target_lower, AVG(weight) as avg_weight
    FROM note_links
    WHERE weight > 1.0
    GROUP BY LOWER(target)
  `).all() as Array<{ target_lower: string; avg_weight: number }>;

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.target_lower, row.avg_weight);
  }
  return map;
}
