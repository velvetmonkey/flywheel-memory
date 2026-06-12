/**
 * Entity bridging + edge-weight context ranking (arch-review S6).
 *
 * Moved verbatim from tools/read/query.ts. This module owns the search
 * stack's direct note_links/entities SQL (B4: listed in the arch SQL
 * baseline; the corresponding query.ts entry is removed — a move, not an
 * addition).
 */

import type { StateDb } from '@velvetmonkey/vault-core';

/**
 * Compute entity-mediated bridges between results.
 * For each result pair, find entities (outlink targets) that appear in both notes.
 * This is the key signal for multi-hop reasoning — tells the agent HOW results connect.
 */
export function applyEntityBridging(
  results: Array<Record<string, unknown>>,
  stateDb: StateDb | null,
  maxBridgesPerResult: number = 5,
): void {
  if (!stateDb || results.length < 2) return;

  // Build map: note_path → set of outlink targets
  const linkMap = new Map<string, Set<string>>();
  try {
    const paths = results.map(r => r.path as string).filter(Boolean);
    for (const path of paths) {
      const rows = stateDb.db.prepare(
        'SELECT target FROM note_links WHERE note_path = ?'
      ).all(path) as Array<{ target: string }>;
      linkMap.set(path, new Set(rows.map(r => r.target)));
    }
  } catch { return; /* best-effort */ }

  // For each result, find entities shared with other results
  for (const r of results) {
    const myPath = r.path as string;
    const myLinks = linkMap.get(myPath);
    if (!myLinks || myLinks.size === 0) continue;

    const bridges: Array<{ entity: string; in_result: string }> = [];
    for (const other of results) {
      const otherPath = other.path as string;
      if (otherPath === myPath) continue;
      const otherLinks = linkMap.get(otherPath);
      if (!otherLinks) continue;

      // Find intersection
      for (const entity of myLinks) {
        if (otherLinks.has(entity) && bridges.length < maxBridgesPerResult) {
          bridges.push({ entity, in_result: otherPath });
        }
      }
      if (bridges.length >= maxBridgesPerResult) break;
    }

    if (bridges.length > 0) {
      r.bridges = bridges;
    }
  }
}

/**
 * Build the edge-weight ranked candidate list for a context note: weighted
 * outgoing note_links resolved to entity note paths. Best-effort — returns
 * [] on any failure.
 */
export function buildEdgeRankedList(
  stateDb: StateDb | null,
  contextNote: string,
  limit: number,
): Array<{ path: string; title: string }> {
  if (!stateDb) return [];
  try {
    // Get weighted edges from context_note, resolve targets to paths via entities
    const edgeRows = stateDb.db.prepare(`
      SELECT nl.target, nl.weight FROM note_links nl
      WHERE nl.note_path = ? AND nl.weight > 1.0
      ORDER BY nl.weight DESC LIMIT ?
    `).all(contextNote, limit) as Array<{ target: string; weight: number }>;

    if (edgeRows.length === 0) return [];

    // Build target->path map from entities table (only matching targets)
    const targets = edgeRows.map(r => r.target);
    const placeholders = targets.map(() => '?').join(',');
    const entityRows = stateDb.db.prepare(
      `SELECT path, name_lower FROM entities WHERE name_lower IN (${placeholders})`
    ).all(...targets) as Array<{ path: string; name_lower: string }>;
    const targetToPath = new Map<string, string>();
    for (const e of entityRows) {
      targetToPath.set(e.name_lower, e.path);
    }

    return edgeRows
      .map(r => {
        const entityPath = targetToPath.get(r.target);
        return entityPath ? { path: entityPath, title: r.target } : null;
      })
      .filter((r): r is { path: string; title: string } => r !== null);
  } catch {
    // Edge weight boost is best-effort
    return [];
  }
}
