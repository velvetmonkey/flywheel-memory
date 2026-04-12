/**
 * T16 — Clock Test: Graph black-box testing via MCP tools
 *
 * A 10-tick sequential test that builds and mutates a graph one step at a time
 * through the MCP tool surface, then asserts MCP output and StateDb state agree
 * after every mutation.
 */

import { describe, test, beforeAll, afterAll, expect } from 'vitest';
import { createWriteTestServer, type WriteTestServerContext } from '../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../read/helpers/createTestServer.js';
import {
  callJsonTool,
  searchInventory,
  searchContent,
  snapshotMcpState,
  snapshotDbState,
  assertCrossLayerConsistency,
  assertInvariants,
  type McpSnapshot,
  type DbSnapshot,
} from './clock-helpers.js';

describe('Clock Test — T16', () => {
  let ctx: WriteTestServerContext;
  let client: TestClient;

  // Snapshots after each tick for regression checks
  const snapshots: Array<{ mcp: McpSnapshot; db: DbSnapshot }> = [];

  // Note paths (updated as mutations happen)
  let alphaPath = 'test/alpha.md';
  const bravoPath = 'test/bravo.md';
  const charliePath = 'test/charlie.md';

  beforeAll(async () => {
    ctx = await createWriteTestServer();
    client = connectTestClient(ctx.server);
  }, 30_000);

  afterAll(async () => {
    await ctx?.cleanup();
  });

  /** Helper: refresh index, snapshot MCP + DB, run invariants */
  async function refreshAndSnapshot(paths: string[]): Promise<{ mcp: McpSnapshot; db: DbSnapshot }> {
    await callJsonTool(client, 'refresh_index', {});
    const mcp = await snapshotMcpState(client, paths);
    const db = snapshotDbState(ctx.stateDb!);
    snapshots.push({ mcp, db });
    assertCrossLayerConsistency(mcp, db);
    assertInvariants(mcp);
    return { mcp, db };
  }

  // ── Tick functions ────────────────────────────────────────────

  async function tick1_createAlpha() {
    // vault_create_note retired (T43 B3+) — use note(action: create)
    await callJsonTool(client, 'note', {
      action: 'create',
      path: 'test/alpha.md',
      content: '# Alpha\n\nA rocketry project.',
      frontmatter: { type: 'project' },
      skipWikilinks: true,
    });

    const { mcp, db } = await refreshAndSnapshot([alphaPath]);

    expect(mcp.inventory).toEqual([alphaPath]);
    expect(mcp.backlinks[alphaPath]).toEqual([]);
    expect(mcp.forwardLinks[alphaPath]).toEqual([]);
    expect(mcp.structures[alphaPath]?.frontmatter?.type).toBe('project');
    expect(db.ftsPaths).toContain(alphaPath);
    expect(db.noteLinks).toEqual([]);
  }

  async function tick2_createBravoLinkingAlpha() {
    // vault_create_note retired (T43 B3+) — use note(action: create)
    await callJsonTool(client, 'note', {
      action: 'create',
      path: bravoPath,
      content: '# Bravo\n\nSupports [[Alpha]] with propulsion.',
      skipWikilinks: true,
    });

    const { mcp, db } = await refreshAndSnapshot([alphaPath, bravoPath]);

    expect(mcp.inventory).toEqual([alphaPath, bravoPath]);
    expect(mcp.backlinks[alphaPath]).toContain(bravoPath);
    expect(mcp.forwardLinks[bravoPath].length).toBeGreaterThan(0);
    // Propulsion content search
    const propHits = await searchContent(client, 'propulsion');
    expect(propHits).toContain(bravoPath);
    // DB should have bravo -> alpha link
    expect(db.noteLinks.some(l => l.source === bravoPath && l.target === 'alpha')).toBe(true);
  }

  async function tick3_addLinkToAlpha() {
    // vault_add_to_section retired (T43 B3+) — use edit_section(action: add)
    await callJsonTool(client, 'edit_section', {
      action: 'add',
      path: alphaPath,
      section: 'Alpha',
      content: 'Phase 1 launched. See [[Bravo]].',
      skipWikilinks: true,
    });

    const { mcp, db } = await refreshAndSnapshot([alphaPath, bravoPath]);

    // Bidirectional links
    expect(mcp.backlinks[alphaPath]).toContain(bravoPath);
    expect(mcp.forwardLinks[alphaPath].length).toBeGreaterThan(0);
    // "phase 1" should be searchable in alpha
    const phaseHits = await searchContent(client, '"phase 1"');
    expect(phaseHits).toContain(alphaPath);
    // DB should have both directions
    expect(db.noteLinks.some(l => l.source === alphaPath && l.target === 'bravo')).toBe(true);
    expect(db.noteLinks.some(l => l.source === bravoPath && l.target === 'alpha')).toBe(true);
  }

  async function tick4_updateAlphaFrontmatter() {
    await callJsonTool(client, 'vault_update_frontmatter', {
      path: alphaPath,
      frontmatter: { status: 'active', priority: 'high' },
    });

    const { mcp } = await refreshAndSnapshot([alphaPath, bravoPath]);

    // Metadata search
    const statusHits = await callJsonTool(client, 'find_notes', {
      where: { status: 'active' },
      limit: 10,
    });
    const statusPaths = (statusHits.notes ?? []).map((r: any) => r.path);
    expect(statusPaths).toContain(alphaPath);
    // Structure should show the new fields
    expect(mcp.structures[alphaPath]?.frontmatter?.status).toBe('active');
    expect(mcp.structures[alphaPath]?.frontmatter?.priority).toBe('high');
    // Link graph unchanged from tick 3
    expect(mcp.forwardLinks[alphaPath].length).toBeGreaterThan(0);
    expect(mcp.backlinks[alphaPath]).toContain(bravoPath);
  }

  async function tick5_createOrphanCharlie() {
    // vault_create_note retired (T43 B3+) — use note(action: create)
    await callJsonTool(client, 'note', {
      action: 'create',
      path: charliePath,
      content: '# Charlie\n\nUnrelated aerodynamics.',
      skipWikilinks: true,
    });

    const { mcp } = await refreshAndSnapshot([alphaPath, bravoPath, charliePath]);

    expect(mcp.inventory).toHaveLength(3);
    expect(mcp.backlinks[charliePath]).toEqual([]);
    expect(mcp.forwardLinks[charliePath]).toEqual([]);
    // Alpha/Bravo graph unchanged
    expect(mcp.backlinks[alphaPath]).toContain(bravoPath);
  }

  async function tick6_linkCharlieIntoGraph() {
    // vault_add_to_section retired (T43 B3+) — use edit_section(action: add)
    await callJsonTool(client, 'edit_section', {
      action: 'add',
      path: charliePath,
      section: 'Charlie',
      content: 'Collaborating with [[Alpha]] and [[Bravo]].',
      skipWikilinks: true,
    });

    const { mcp, db } = await refreshAndSnapshot([alphaPath, bravoPath, charliePath]);

    // Alpha backlinks = bravo + charlie
    expect(mcp.backlinks[alphaPath].sort()).toEqual([bravoPath, charliePath].sort());
    // Charlie forward links include alpha and bravo
    expect(mcp.forwardLinks[charliePath].length).toBe(2);
    // DB has Charlie rows
    expect(db.noteLinks.some(l => l.source === charliePath)).toBe(true);
  }

  async function tick7_renameAlpha() {
    // vault_rename_note retired (T43 B3+) — use note(action: rename)
    await callJsonTool(client, 'note', {
      action: 'rename',
      path: 'test/alpha.md',
      new_name: 'alpha-prime',
      updateBacklinks: true,
    });

    const newAlpha = 'test/alpha-prime.md';
    alphaPath = newAlpha;

    const { mcp, db } = await refreshAndSnapshot([alphaPath, bravoPath, charliePath]);

    // Inventory has the new path, not the old one
    expect(mcp.inventory).toContain(newAlpha);
    expect(mcp.inventory).not.toContain('test/alpha.md');
    // Old source path absent from DB
    expect(db.noteLinks.some(l => l.source === 'test/alpha.md')).toBe(false);
    expect(db.ftsPaths).not.toContain('test/alpha.md');
    // Backlinks from bravo/charlie should now resolve to alpha-prime
    expect(mcp.backlinks[newAlpha].sort()).toEqual([bravoPath, charliePath].sort());
    // Content search for Alpha should still find the renamed note
    const alphaHits = await searchContent(client, 'Alpha');
    expect(alphaHits).toContain(newAlpha);
  }

  async function tick8_replaceBravoContent() {
    // vault_replace_in_section retired (T43 B3+) — use edit_section(action: replace)
    await callJsonTool(client, 'edit_section', {
      action: 'replace',
      path: bravoPath,
      section: 'Bravo',
      search: 'propulsion',
      replacement: 'engine design',
      skipWikilinks: true,
    });

    const { mcp } = await refreshAndSnapshot([alphaPath, bravoPath, charliePath]);

    // Propulsion gone from search
    const propHits = await searchContent(client, 'propulsion');
    expect(propHits).not.toContain(bravoPath);
    // Engine design now searchable
    const engineHits = await searchContent(client, '"engine design"');
    expect(engineHits).toContain(bravoPath);
    // Bravo still links to alpha-prime
    expect(mcp.forwardLinks[bravoPath].length).toBeGreaterThan(0);
  }

  async function tick9_deleteBravo() {
    // vault_delete_note retired (T43 B3+) — use note(action: delete)
    await callJsonTool(client, 'note', {
      action: 'delete',
      path: bravoPath,
      confirm: true,
    });

    const { mcp, db } = await refreshAndSnapshot([alphaPath, charliePath]);

    // 2-note inventory
    expect(mcp.inventory).toHaveLength(2);
    expect(mcp.inventory).not.toContain(bravoPath);
    // No DB source rows for bravo
    expect(db.noteLinks.some(l => l.source === bravoPath)).toBe(false);
    expect(db.ftsPaths).not.toContain(bravoPath);
    // Alpha-prime backlinks = charlie only
    expect(mcp.backlinks[alphaPath]).toEqual([charliePath]);
    // Charlie forward links: alpha-prime is live, bravo is dead
    // Both still in source markdown (charlie's content still references bravo)
    expect(mcp.forwardLinks[charliePath].length).toBe(2);
  }

  async function tick10_fullConsistencyCheck() {
    // No mutation — just verify final state
    const { mcp, db } = await refreshAndSnapshot([alphaPath, charliePath]);

    // Final inventory = alpha-prime + charlie
    expect(mcp.inventory.sort()).toEqual([alphaPath, charliePath].sort());
    // Alpha-prime frontmatter intact
    expect(mcp.structures[alphaPath]?.frontmatter?.type).toBe('project');
    expect(mcp.structures[alphaPath]?.frontmatter?.status).toBe('active');
    expect(mcp.structures[alphaPath]?.frontmatter?.priority).toBe('high');

    // Validate links: should report dead links (bravo references in surviving notes)
    // validate_links retired (T43 B3+) — use link(action: validate)
    const validation = await callJsonTool(client, 'link', {
      action: 'validate',
      group_by_target: true,
      limit: 20,
    });
    // Bravo should appear as a dead target
    const deadTargets = (validation.targets ?? []).map((t: any) =>
      (t.target ?? '').toLowerCase()
    );
    expect(deadTargets.length).toBeGreaterThan(0);

    // Cross-layer consistency holds (already checked in refreshAndSnapshot)
    assertCrossLayerConsistency(mcp, db);
    assertInvariants(mcp);
  }

  // ── The clock ─────────────────────────────────────────────────

  test('10-tick graph mutation sequence', async () => {
    await tick1_createAlpha();
    await tick2_createBravoLinkingAlpha();
    await tick3_addLinkToAlpha();
    await tick4_updateAlphaFrontmatter();
    await tick5_createOrphanCharlie();
    await tick6_linkCharlieIntoGraph();
    await tick7_renameAlpha();
    await tick8_replaceBravoContent();
    await tick9_deleteBravo();
    await tick10_fullConsistencyCheck();
  }, 120_000);
});
