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

/** Return sorted paths of all notes under the test/ folder. */
export async function searchInventory(client: TestClient): Promise<string[]> {
  const data = await callJsonTool(client, 'find_notes', {
    folder: 'test',
    limit: 100,
    sort_by: 'title',
    order: 'asc',
  });
  const items: Array<{ path: string }> = data.notes ?? [];
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

  // First pass: collect forward links and structures for all paths
  for (const p of paths) {
    try {
      const sr = await callJsonTool(client, 'search', { query: p.replace('.md', '').split('/').pop() ?? p, limit: 5 });
      const items: any[] = sr.results ?? sr.notes ?? [];
      const note = items.find((n: any) => n.path === p);
      forwardLinks[p] = (note?.outlink_names ?? []).map((name: string) =>
        name.toLowerCase()
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

  // Derive backlinks from forward links: if source has forward link to target basename, target gets backlink from source
  for (const p of paths) {
    const basename = p.replace(/\.md$/, '').split('/').pop()!.toLowerCase();
    const sources: string[] = [];
    for (const [source, targets] of Object.entries(forwardLinks)) {
      if (source === p) continue;
      if (targets.includes(basename)) {
        sources.push(source);
      }
    }
    // Also check inventory notes not in paths — search for notes linking to this basename
    for (const invPath of inventory) {
      if (invPath === p || paths.includes(invPath)) continue;
      // For non-tracked paths, we don't have forward links — skip
    }
    backlinks[p] = sources.sort();
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
  for (const [notePath, mcpTargetsRaw] of Object.entries(mcp.forwardLinks)) {
    const mcpTargets = [...new Set(mcpTargetsRaw)].sort();
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

// ── Phase-2 helpers ─────────────────────────────────────────────

/** Vault-wide inventory — no folder filter. For phase-2 tests with multi-folder layouts. */
export async function searchInventoryAll(client: TestClient): Promise<string[]> {
  const data = await callJsonTool(client, "find_notes", {
    limit: 200,
    sort_by: "title",
    order: "asc",
  });
  const items: Array<{ path: string }> = data.notes ?? [];
  return items.map(r => r.path).sort();
}

/** Snapshot using vault-wide inventory (no folder filter). */
export async function snapshotMcpStateAll(
  client: TestClient,
  paths: string[],
): Promise<McpSnapshot> {
  const inventory = await searchInventoryAll(client);

  const backlinks: Record<string, string[]> = {};
  const forwardLinks: Record<string, string[]> = {};
  const structures: Record<string, any> = {};

  // First pass: collect forward links and structures for all paths
  for (const p of paths) {
    try {
      const sr = await callJsonTool(client, "search", { query: p.replace('.md', '').split('/').pop() ?? p, limit: 5 });
      const items: any[] = sr.results ?? sr.notes ?? [];
      const note = items.find((n: any) => n.path === p);
      forwardLinks[p] = (note?.outlink_names ?? []).map((name: string) =>
        name.toLowerCase()
      ).sort();
    } catch {
      forwardLinks[p] = [];
    }

    try {
      structures[p] = await callJsonTool(client, "get_note_structure", { path: p });
    } catch {
      structures[p] = null;
    }
  }

  // Derive backlinks from forward links: if source has forward link to target basename, target gets backlink from source
  for (const p of paths) {
    const basename = p.replace(/\.md$/, '').split('/').pop()!.toLowerCase();
    const sources: string[] = [];
    for (const [source, targets] of Object.entries(forwardLinks)) {
      if (source === p) continue;
      if (targets.includes(basename)) {
        sources.push(source);
      }
    }
    backlinks[p] = sources.sort();
  }

  return { inventory, backlinks, forwardLinks, structures };
}

// ── Extended DB snapshot ───────────────────────────────────────

export interface ExtendedDbSnapshot extends DbSnapshot {
  liveMemoryCount: number;
  correctionCount: number;
}

export function snapshotExtendedDbState(stateDb: StateDb): ExtendedDbSnapshot {
  const base = snapshotDbState(stateDb);

  let liveMemoryCount = 0;
  try {
    const row = stateDb.db
      .prepare("SELECT COUNT(*) as cnt FROM memories WHERE superseded_by IS NULL")
      .get() as { cnt: number } | undefined;
    liveMemoryCount = row?.cnt ?? 0;
  } catch { /* table may not exist yet */ }

  let correctionCount = 0;
  try {
    const row = stateDb.db
      .prepare("SELECT COUNT(*) as cnt FROM corrections")
      .get() as { cnt: number } | undefined;
    correctionCount = row?.cnt ?? 0;
  } catch { /* table may not exist yet */ }

  return { ...base, liveMemoryCount, correctionCount };
}

// ── Convenience read helpers ──────────────────────────────────

/** Get content under a specific heading */
export async function getSectionContent(
  client: TestClient,
  path: string,
  section: string,
): Promise<string> {
  const data = await callJsonTool(client, "get_section_content", { path, heading: section });
  return data.content ?? "";
}

/** Query tasks across the vault */
export async function getTasks(
  client: TestClient,
  opts: { path?: string; status?: string } = {},
): Promise<any[]> {
  const data = await callJsonTool(client, "tasks", { ...opts, limit: 100 });
  return data.tasks ?? [];
}

/** Run graph_analysis with a specific mode */
export async function getGraphAnalysis(
  client: TestClient,
  mode: string,
): Promise<any> {
  return callJsonTool(client, "graph_analysis", { analysis: mode });
}

/** Get folder structure (via flywheel_doctor report=stats) */
export async function getFolderStructure(client: TestClient): Promise<any> {
  return callJsonTool(client, "flywheel_doctor", { report: "stats" });
}

/** Get vault stats */
export async function getVaultStats(client: TestClient): Promise<any> {
  return callJsonTool(client, "flywheel_doctor", { report: "stats" });
}

/** Get health check */
export async function getHealthCheck(client: TestClient): Promise<any> {
  return callJsonTool(client, "flywheel_doctor", { report: "health" });
}

/** List all entities across all categories */
export async function listEntities(client: TestClient): Promise<{ entities: any[]; raw: any }> {
  const data = await callJsonTool(client, "entity", { action: "list" });
  // EntityIndex has category keys (people, projects, other, etc.) + _metadata
  const all: any[] = [];
  for (const [key, val] of Object.entries(data)) {
    if (key !== '_metadata' && Array.isArray(val)) {
      all.push(...val);
    }
  }
  return { entities: all, raw: data };
}
