/**
 * Clock Test helpers — snapshot builders and cross-layer assertions for T16.
 */

import { expect } from 'vitest';
import type { TestClient } from '../read/helpers/createTestServer.js';
import type { StateDb } from '@velvetmonkey/vault-core';

// ── JSON extraction ─────────────────────────────────────────────

/** Call an MCP tool and parse the first text content block as JSON */
export async function callJsonTool(
  client: TestClient,
  name: string,
  args: Record<string, unknown> = {},
): Promise<any> {
  const result = await client.callTool(name, args);
  const text = result?.content?.[0]?.text;
  if (!text) throw new Error(`${name} returned no text content`);
  return JSON.parse(text);
}

// ── Inventory helpers ───────────────────────────────────────────

/** Return sorted paths of all notes under the test/ folder.
 *  Metadata search (no query) returns { notes }, FTS search returns { results }. */
export async function searchInventory(client: TestClient): Promise<string[]> {
  const data = await callJsonTool(client, 'search', {
    folder: 'test',
    limit: 100,
    sort_by: 'title',
    order: 'asc',
  });
  // Metadata search returns `notes`, not `results`
  const items: Array<{ path: string }> = data.notes ?? data.results ?? [];
  return items.map(r => r.path).sort();
}

/** Content search (FTS5) — returns paths of matching notes */
export async function searchContent(
  client: TestClient,
  query: string,
): Promise<string[]> {
  const data = await callJsonTool(client, 'search', {
    query,
    limit: 20,
    consumer: 'human',
  });
  // FTS/hybrid search returns `results`
  const items: Array<{ path: string }> = data.results ?? data.notes ?? [];
  return items.map(r => r.path);
}

// ── MCP surface snapshot ────────────────────────────────────────

export interface McpSnapshot {
  inventory: string[];                         // sorted note paths
  backlinks: Record<string, string[]>;         // path → sorted source paths
  forwardLinks: Record<string, string[]>;      // path → sorted target names (lowercase)
  structures: Record<string, any>;             // path → get_note_structure result
}

export async function snapshotMcpState(
  client: TestClient,
  paths: string[],
): Promise<McpSnapshot> {
  const inventory = await searchInventory(client);

  const backlinks: Record<string, string[]> = {};
  const forwardLinks: Record<string, string[]> = {};
  const structures: Record<string, any> = {};

  for (const p of paths) {
    try {
      const bl = await callJsonTool(client, 'get_backlinks', { path: p });
      backlinks[p] = (bl.backlinks ?? []).map((b: any) => b.source).sort();
    } catch {
      backlinks[p] = [];
    }

    try {
      const fl = await callJsonTool(client, 'get_forward_links', { path: p });
      forwardLinks[p] = (fl.forward_links ?? []).map((l: any) =>
        (l.target ?? '').toLowerCase()
      ).sort();
    } catch {
      forwardLinks[p] = [];
    }

    try {
      structures[p] = await callJsonTool(client, 'get_note_structure', { path: p });
    } catch {
      structures[p] = null;
    }
  }

  return { inventory, backlinks, forwardLinks, structures };
}

// ── DB snapshot ─────────────────────────────────────────────────

export interface DbSnapshot {
  ftsPaths: string[];                            // sorted paths in notes_fts
  noteLinks: Array<{ source: string; target: string }>;  // sorted
}

export function snapshotDbState(stateDb: StateDb): DbSnapshot {
  const ftsRows = stateDb.db
    .prepare('SELECT DISTINCT path FROM notes_fts ORDER BY path')
    .all() as Array<{ path: string }>;
  const ftsPaths = ftsRows.map(r => r.path);

  const linkRows = stateDb.db
    .prepare('SELECT note_path, target FROM note_links ORDER BY note_path, target')
    .all() as Array<{ note_path: string; target: string }>;
  const noteLinks = linkRows.map(r => ({ source: r.note_path, target: r.target }));

  return { ftsPaths, noteLinks };
}

// ── Cross-layer assertions ──────────────────────────────────────

export function assertCrossLayerConsistency(mcp: McpSnapshot, db: DbSnapshot): void {
  // Every inventory note should be in FTS
  for (const p of mcp.inventory) {
    expect(db.ftsPaths, `FTS missing inventory note ${p}`).toContain(p);
  }

  // Forward link targets in MCP should match DB note_links for each note
  for (const [notePath, mcpTargets] of Object.entries(mcp.forwardLinks)) {
    const dbTargets = db.noteLinks
      .filter(r => r.source === notePath)
      .map(r => r.target)
      .sort();
    expect(mcpTargets, `forward links mismatch for ${notePath}`).toEqual(dbTargets);
  }
}

// ── Invariant assertions ────────────────────────────────────────

export function assertInvariants(mcp: McpSnapshot): void {
  // Live-link/backlink symmetry: if A has forward link to B (and B is in inventory),
  // then B should have A in backlinks
  for (const [source, targets] of Object.entries(mcp.forwardLinks)) {
    for (const target of targets) {
      // Find the inventory path that matches the target
      const targetPath = mcp.inventory.find(
        p => p.toLowerCase().replace(/\.md$/, '') === target ||
             p.toLowerCase() === target ||
             p.toLowerCase() === target + '.md'
      );
      if (targetPath && mcp.backlinks[targetPath]) {
        expect(
          mcp.backlinks[targetPath],
          `backlink symmetry: ${targetPath} should have backlink from ${source}`
        ).toContain(source);
      }
      // Dead links (target not in inventory) are expected to lack backlinks — skip
    }
  }
}
