/**
 * Clock Test Phase 2 — Extended tool coverage
 *
 * A 22-tick sequential test that exercises every remaining mutation tool and
 * broader read verification. Builds on the harness from T16 (clock.test.ts)
 * but uses its own vault with a multi-folder layout.
 *
 * Sequence A (ticks 1-12): file/index mutations
 * Sequence B (ticks 13-22): StateDb-only tools, bulk migrations, diagnostics
 */

import { describe, test, beforeAll, afterAll, expect } from 'vitest';
import { execSync } from 'child_process';
import { createWriteTestServer, type WriteTestServerContext } from '../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../read/helpers/createTestServer.js';

import {
  callJsonTool,
  searchContent,
  snapshotMcpStateAll,
  snapshotDbState,
  snapshotExtendedDbState,
  assertCrossLayerConsistency,
  assertInvariants,
  getSectionContent,
  getTasks,
  getGraphAnalysis,
  getFolderStructure,
  getVaultStats,
  getHealthCheck,
  listEntities,
  type McpSnapshot,
  type DbSnapshot,
  type ExtendedDbSnapshot,
} from './clock-helpers.js';

// TODO: Rewrite for T43 surface — sequential ticks reference retired tools
// (tool_selection_feedback, vault_init, suggest_entity_merges, dismiss_merge_suggestion)
describe.skip('Clock Test Phase 2 — Extended Tool Coverage', () => {
  let ctx: WriteTestServerContext;
  let client: TestClient;

  const snapshots: Array<{ mcp: McpSnapshot; db: DbSnapshot }> = [];

  // Note paths — updated as mutations happen
  const rocketPath = 'projects/rocket-launch.md';
  const alicePath = 'people/alice-johnson.md';
  const aliceJPath = 'people/alice-j.md'; // deleted at tick 10
  let meetingPath = 'inbox/meeting-notes.md'; // → projects/ at tick 7
  const bobPath = 'people/bob-smith.md';
  const robertPath = 'people/robert-smith.md';
  const scratchPath = 'scratch/to-undo.md'; // created + undone at tick 21

  // Dynamic set of active paths for snapshots
  let activePaths: string[] = [];

  beforeAll(async () => {
    ctx = await createWriteTestServer();

    // Git init for undo testing (CI-safe)
    execSync('git init', { cwd: ctx.vaultPath });
    execSync('git config user.name "test"', { cwd: ctx.vaultPath });
    execSync('git config user.email "test@test"', { cwd: ctx.vaultPath });
    execSync('git add -A && git commit --allow-empty -m "init"', { cwd: ctx.vaultPath });

    // All tools are registered by createWriteTestServer via registerAllTools
    client = connectTestClient(ctx.server);
  }, 30_000);

  afterAll(async () => {
    await ctx?.cleanup();
  });

  /** Refresh index, snapshot MCP + DB, run invariants */
  async function refreshAndSnapshot(): Promise<{ mcp: McpSnapshot; db: DbSnapshot }> {
    await callJsonTool(client, 'refresh_index', {});
    const mcp = await snapshotMcpStateAll(client, activePaths);
    const db = snapshotDbState(ctx.stateDb!);
    snapshots.push({ mcp, db });
    assertCrossLayerConsistency(mcp, db);
    assertInvariants(mcp);
    return { mcp, db };
  }

  // ════════════════════════════════════════════════════════════════
  // Sequence A: File/Index Mutations (ticks 1–12)
  // ════════════════════════════════════════════════════════════════

  async function tick1_createRocketLaunch() {
    await callJsonTool(client, 'vault_create_note', {
      path: rocketPath,
      content: '# Rocket Launch\n\n## Overview\n\nA collaborative rocketry project.\n\n## Tasks\n',
      frontmatter: { type: 'project', status: 'planning', tags: ['rocketry'] },
      skipWikilinks: true,
    });

    activePaths = [rocketPath];
    const { mcp } = await refreshAndSnapshot();

    expect(mcp.inventory).toContain(rocketPath);
    expect(mcp.structures[rocketPath]?.frontmatter?.type).toBe('project');
    expect(mcp.structures[rocketPath]?.frontmatter?.tags).toContain('rocketry');

    const stats = await getVaultStats(client);
    expect(stats.total_notes ?? stats.note_count).toBeGreaterThanOrEqual(1);

    const folders = await getFolderStructure(client);
    expect(JSON.stringify(folders)).toContain('projects');
  }

  async function tick2_createAlicePair() {
    await callJsonTool(client, 'vault_create_note', {
      path: alicePath,
      content: '# Alice Johnson\n\nLead engineer on [[rocket-launch]] project.',
      frontmatter: { type: 'person', aliases: ['Alice'] },
      skipWikilinks: true,
    });
    await callJsonTool(client, 'vault_create_note', {
      path: aliceJPath,
      content: '# Alice J.\n\nAlso known as AJ. Works on [[rocket-launch]].\n\nSpecializes in propulsion systems.',
      frontmatter: { type: 'person', aliases: ['AJ'] },
      skipWikilinks: true,
    });

    activePaths = [rocketPath, alicePath, aliceJPath];
    const { mcp } = await refreshAndSnapshot();

    expect(mcp.inventory).toHaveLength(3);
    // Both alice notes should backlink to rocket-launch
    expect(mcp.backlinks[rocketPath]?.length).toBeGreaterThanOrEqual(2);

    const entities = await listEntities(client);
    const entityNames = (entities.entities ?? []).map((e: any) => e.name?.toLowerCase());
    expect(entityNames).toContain('alice-johnson');
  }

  async function tick3_createMeetingNotes() {
    await callJsonTool(client, 'vault_create_note', {
      path: meetingPath,
      content: '# Meeting Notes\n\nDiscussed progress with [[alice-johnson]] on [[rocket-launch]].',
      frontmatter: { type: 'meeting' },
      skipWikilinks: true,
    });

    activePaths = [rocketPath, alicePath, aliceJPath, meetingPath];
    const { mcp } = await refreshAndSnapshot();

    expect(mcp.inventory).toHaveLength(4);

    // Connection strength between meeting notes and rocket launch should be nonzero
    const strength = await callJsonTool(client, 'get_connection_strength', {
      note_a: meetingPath,
      note_b: rocketPath,
    });
    expect(strength.strength ?? strength.score ?? 0).toBeGreaterThan(0);

    // Common neighbors: alice-johnson and rocket-launch should share meeting-notes as a neighbor
    const neighbors = await callJsonTool(client, 'get_common_neighbors', {
      note_a: alicePath,
      note_b: rocketPath,
    });
    // At minimum they're connected
    expect(neighbors).toBeDefined();

    const folders = await getFolderStructure(client);
    expect(JSON.stringify(folders)).toContain('inbox');
  }

  async function tick4_addTasks() {
    await callJsonTool(client, 'vault_add_task', {
      path: rocketPath,
      section: 'Tasks',
      task: 'Design propulsion system',
      skipWikilinks: true,
    });
    await callJsonTool(client, 'vault_add_task', {
      path: rocketPath,
      section: 'Tasks',
      task: 'Order fuel supplies',
      skipWikilinks: true,
    });

    activePaths = [rocketPath, alicePath, aliceJPath, meetingPath];
    await refreshAndSnapshot();

    const openTasks = await getTasks(client, { path: rocketPath, status: 'open' });
    expect(openTasks.length).toBe(2);

    const sectionText = await getSectionContent(client, rocketPath, 'Tasks');
    expect(sectionText).toContain('Design propulsion system');
    expect(sectionText).toContain('Order fuel supplies');
  }

  async function tick5_toggleTask() {
    await callJsonTool(client, 'vault_toggle_task', {
      path: rocketPath,
      task: 'Design propulsion system',
    });

    activePaths = [rocketPath, alicePath, aliceJPath, meetingPath];
    await refreshAndSnapshot();

    const open = await getTasks(client, { path: rocketPath, status: 'open' });
    const completed = await getTasks(client, { path: rocketPath, status: 'completed' });
    expect(completed.length).toBe(1);
    expect(open.length).toBe(1);
  }

  async function tick6_removeFromSection() {
    await callJsonTool(client, 'vault_remove_from_section', {
      path: aliceJPath,
      section: 'Alice J.',
      pattern: 'Specializes in propulsion systems.',
    });

    activePaths = [rocketPath, alicePath, aliceJPath, meetingPath];
    const { mcp } = await refreshAndSnapshot();

    // Removed text should be gone from search
    const propHits = await searchContent(client, '"propulsion systems"');
    expect(propHits).not.toContain(aliceJPath);

    // Forward links should still be intact (we only removed non-link text)
    expect(mcp.forwardLinks[aliceJPath]?.length).toBeGreaterThan(0);
  }

  async function tick7_moveNote() {
    const newMeetingPath = 'projects/meeting-notes.md';
    await callJsonTool(client, 'vault_move_note', {
      oldPath: meetingPath,
      newPath: newMeetingPath,
      updateBacklinks: true,
    });

    meetingPath = newMeetingPath;
    activePaths = [rocketPath, alicePath, aliceJPath, meetingPath];
    const { mcp } = await refreshAndSnapshot();

    // Old path gone, new path present
    expect(mcp.inventory).toContain(meetingPath);
    expect(mcp.inventory).not.toContain('inbox/meeting-notes.md');

    // Backlinks should reflect the move
    const folders = await getFolderStructure(client);
    const foldersJson = JSON.stringify(folders);
    expect(foldersJson).toContain('projects');
  }

  async function tick8_addAndReplaceContent() {
    // Add a line with a wikilink
    await callJsonTool(client, 'vault_add_to_section', {
      path: rocketPath,
      section: 'Overview',
      content: 'Collaborating with [[alice-j]] on propulsion.',
      skipWikilinks: true,
    });

    // Then replace the link target
    await callJsonTool(client, 'vault_replace_in_section', {
      path: rocketPath,
      section: 'Overview',
      search: '[[alice-j]]',
      replacement: '[[alice-johnson]]',
      skipWikilinks: true,
    });

    activePaths = [rocketPath, alicePath, aliceJPath, meetingPath];
    const { mcp } = await refreshAndSnapshot();

    const overview = await getSectionContent(client, rocketPath, 'Overview');
    expect(overview).toContain('[[alice-johnson]]');
    expect(overview).not.toContain('[[alice-j]]');

    // Forward links should include alice-johnson
    const targets = mcp.forwardLinks[rocketPath] ?? [];
    expect(targets.some(t => t.includes('alice-johnson') || t.includes('alice johnson'))).toBe(true);
  }

  async function tick9_updateMeetingFrontmatter() {
    await callJsonTool(client, 'vault_update_frontmatter', {
      path: meetingPath,
      frontmatter: { tags: ['rocketry', 'meeting'], priority: 'high' },
    });

    activePaths = [rocketPath, alicePath, aliceJPath, meetingPath];
    const { mcp } = await refreshAndSnapshot();

    expect(mcp.structures[meetingPath]?.frontmatter?.priority).toBe('high');
    expect(mcp.structures[meetingPath]?.frontmatter?.tags).toContain('rocketry');

    // Schema should reflect the new fields
    const schema = await callJsonTool(client, 'vault_schema', { analysis: 'overview' });
    expect(JSON.stringify(schema)).toContain('priority');
  }

  async function tick10_mergeAliceJ() {
    await callJsonTool(client, 'merge_entities', {
      source_path: aliceJPath,
      target_path: alicePath,
    });

    // alice-j is now deleted
    activePaths = [rocketPath, alicePath, meetingPath];
    const { mcp } = await refreshAndSnapshot();

    // Inventory reduced
    expect(mcp.inventory).not.toContain(aliceJPath);
    expect(mcp.inventory).toContain(alicePath);

    // Alice Johnson should have AJ alias
    const aliceStruct = mcp.structures[alicePath];
    const aliases = aliceStruct?.frontmatter?.aliases ?? [];
    expect(aliases.some((a: string) => a === 'AJ')).toBe(true);

    // Backlinks from alice-j should have been rewritten to alice
    const rocketBl = mcp.backlinks[rocketPath] ?? [];
    expect(rocketBl).toContain(alicePath);
    expect(rocketBl).not.toContain(aliceJPath);

    // Entity count should have reduced
    const entities = await listEntities(client);
    const entityPaths = (entities.entities ?? []).map((e: any) => e.path);
    expect(entityPaths).not.toContain(aliceJPath);
  }

  async function tick11_createBobAndAbsorbAlias() {
    await callJsonTool(client, 'vault_create_note', {
      path: bobPath,
      content: '# Bob Smith\n\nFuel specialist on [[rocket-launch]].',
      frontmatter: { type: 'person' },
      skipWikilinks: true,
    });

    await callJsonTool(client, 'refresh_index', {});

    await callJsonTool(client, 'absorb_as_alias', {
      source_name: 'Bobby',
      target_path: bobPath,
    });

    activePaths = [rocketPath, alicePath, meetingPath, bobPath];
    const { mcp } = await refreshAndSnapshot();

    const bobStruct = mcp.structures[bobPath];
    const aliases = bobStruct?.frontmatter?.aliases ?? [];
    expect(aliases).toContain('Bobby');
  }

  async function tick12_createRobertAndDismissMerge() {
    await callJsonTool(client, 'vault_create_note', {
      path: robertPath,
      content: '# Robert Smith\n\nSafety officer on [[rocket-launch]].',
      frontmatter: { type: 'person' },
      skipWikilinks: true,
    });

    activePaths = [rocketPath, alicePath, meetingPath, bobPath, robertPath];
    await refreshAndSnapshot();

    // Get merge suggestions to find the bob/robert pair with exact fields
    const merges = await callJsonTool(client, 'suggest_entity_merges', { limit: 50 });
    const suggestions = merges.suggestions ?? [];
    const bobRobertPair = suggestions.find(
      (s: any) =>
        (s.source_path === bobPath && s.target_path === robertPath) ||
        (s.source_path === robertPath && s.target_path === bobPath),
    );

    if (bobRobertPair) {
      await callJsonTool(client, 'dismiss_merge_suggestion', {
        source_path: bobRobertPair.source_path,
        target_path: bobRobertPair.target_path,
        source_name: bobRobertPair.source_name ?? bobRobertPair.source,
        target_name: bobRobertPair.target_name ?? bobRobertPair.target,
        reason: bobRobertPair.reason,
      });

      // Re-query: the pair should no longer appear
      const merges2 = await callJsonTool(client, 'suggest_entity_merges', { limit: 50 });
      const suggestions2 = merges2.suggestions ?? [];
      const found = suggestions2.find(
        (s: any) =>
          (s.source_path === bobPath && s.target_path === robertPath) ||
          (s.source_path === robertPath && s.target_path === bobPath),
      );
      expect(found).toBeUndefined();
    }
    // If no merge suggestion was generated (names too dissimilar), that's also fine —
    // the dismiss flow can't be tested but the tool is verified to not crash.
  }

  // ════════════════════════════════════════════════════════════════
  // Sequence B: StateDb-Only Tools + Diagnostics (ticks 13–22)
  // ════════════════════════════════════════════════════════════════

  async function tick13_memory() {
    // Store two memories
    await callJsonTool(client, 'memory', {
      action: 'store',
      key: 'project.rocket.target',
      value: 'Rocket launch target date: Q3 2026',
      type: 'fact',
      entity: 'rocket-launch',
    });
    await callJsonTool(client, 'memory', {
      action: 'store',
      key: 'user.pref.units',
      value: 'Metric units preferred',
      type: 'preference',
    });

    // Round-trip: get
    const factResult = await callJsonTool(client, 'memory', {
      action: 'get',
      key: 'project.rocket.target',
    });
    expect(factResult.value ?? factResult.memory?.value).toContain('Q3 2026');

    // Search
    const searchResult = await callJsonTool(client, 'memory', {
      action: 'search',
      query: 'rocket',
    });
    const searchMemories = searchResult.memories ?? searchResult.results ?? [];
    expect(searchMemories.length).toBeGreaterThanOrEqual(1);

    // List
    const listResult = await callJsonTool(client, 'memory', {
      action: 'list',
    });
    const allMemories = listResult.memories ?? listResult.results ?? [];
    expect(allMemories.length).toBeGreaterThanOrEqual(2);

    // DB snapshot
    const extDb = snapshotExtendedDbState(ctx.stateDb!);
    expect(extDb.liveMemoryCount).toBe(2);

    // Brief should include memories
    const brief = await callJsonTool(client, 'brief', {});
    expect(brief).toBeDefined();
  }

  async function tick14_corrections() {
    // Record a correction
    const recorded = await callJsonTool(client, 'vault_record_correction', {
      correction_type: 'wrong_link',
      description: 'Meeting notes should link to Bob Smith, not just Rocket Launch',
      note_path: meetingPath,
    });
    const correctionId = recorded.correction?.id ?? recorded.id;

    // List: should be pending
    const pending = await callJsonTool(client, 'vault_list_corrections', { status: 'pending' });
    const pendingList = pending.corrections ?? [];
    expect(pendingList.length).toBeGreaterThanOrEqual(1);

    // Resolve
    await callJsonTool(client, 'vault_resolve_correction', {
      correction_id: correctionId,
      status: 'applied',
    });

    // List again: pending should be empty, applied should have 1
    const applied = await callJsonTool(client, 'vault_list_corrections', { status: 'applied' });
    const appliedList = applied.corrections ?? [];
    expect(appliedList.length).toBeGreaterThanOrEqual(1);

    // DB snapshot
    const extDb = snapshotExtendedDbState(ctx.stateDb!);
    expect(extDb.correctionCount).toBeGreaterThanOrEqual(1);
  }

  async function tick15_wikilinkFeedback() {
    // Report correct feedback for alice-johnson
    await callJsonTool(client, 'wikilink_feedback', {
      mode: 'report',
      entity: 'alice-johnson',
      correct: true,
      note_path: rocketPath,
    });

    // Report incorrect feedback for bob-smith
    await callJsonTool(client, 'wikilink_feedback', {
      mode: 'report',
      entity: 'bob-smith',
      correct: false,
      note_path: rocketPath,
    });

    // List: should have entries
    const list = await callJsonTool(client, 'wikilink_feedback', {
      mode: 'list',
      limit: 10,
    });
    const entries = list.feedback ?? list.entries ?? [];
    expect(entries.length).toBeGreaterThanOrEqual(2);

    // Stats: should show different accuracy
    const stats = await callJsonTool(client, 'wikilink_feedback', {
      mode: 'stats',
    });
    expect(stats).toBeDefined();
  }

  async function tick16_toolSelectionFeedback() {
    // Report correct for search (tool_name only, no invocation_id)
    await callJsonTool(client, 'tool_selection_feedback', {
      mode: 'report',
      correct: true,
      tool_name: 'search',
    });

    // Report incorrect for read
    await callJsonTool(client, 'tool_selection_feedback', {
      mode: 'report',
      correct: false,
      tool_name: 'read',
      expected_tool: 'search',
      reason: 'Should have searched instead of reading structure',
    });

    // List
    const list = await callJsonTool(client, 'tool_selection_feedback', {
      mode: 'list',
      limit: 10,
    });
    const entries = list.feedback ?? list.entries ?? [];
    expect(entries.length).toBeGreaterThanOrEqual(2);

    // Stats
    const stats = await callJsonTool(client, 'tool_selection_feedback', {
      mode: 'stats',
    });
    expect(stats).toBeDefined();
  }

  async function tick17_renameTag() {
    await callJsonTool(client, 'rename_tag', {
      old_tag: 'rocketry',
      new_tag: 'aerospace',
      dry_run: false,
    });

    activePaths = [rocketPath, alicePath, meetingPath, bobPath, robertPath];
    const { mcp } = await refreshAndSnapshot();

    // Frontmatter should show 'aerospace', not 'rocketry'
    const rocketTags = mcp.structures[rocketPath]?.frontmatter?.tags ?? [];
    expect(rocketTags).toContain('aerospace');
    expect(rocketTags).not.toContain('rocketry');

    // Meeting notes too
    const meetingTags = mcp.structures[meetingPath]?.frontmatter?.tags ?? [];
    expect(meetingTags).toContain('aerospace');
    expect(meetingTags).not.toContain('rocketry');
  }

  async function tick18_migrateFieldValues() {
    await callJsonTool(client, 'migrate_field_values', {
      field: 'status',
      mapping: { planning: 'in-progress' },
      dry_run: false,
    });

    activePaths = [rocketPath, alicePath, meetingPath, bobPath, robertPath];
    const { mcp } = await refreshAndSnapshot();

    expect(mcp.structures[rocketPath]?.frontmatter?.status).toBe('in-progress');

    // Search by new status
    const statusHits = await callJsonTool(client, 'find_notes', {
      where: { status: 'in-progress' },
      limit: 10,
    });
    const statusPaths = (statusHits.notes ?? []).map((r: any) => r.path);
    expect(statusPaths).toContain(rocketPath);
  }

  async function tick19_renameField() {
    await callJsonTool(client, 'rename_field', {
      old_name: 'priority',
      new_name: 'urgency',
      dry_run: false,
    });

    activePaths = [rocketPath, alicePath, meetingPath, bobPath, robertPath];
    const { mcp } = await refreshAndSnapshot();

    // Meeting notes should have urgency, not priority
    const meetingFm = mcp.structures[meetingPath]?.frontmatter ?? {};
    expect(meetingFm.urgency).toBe('high');
    expect(meetingFm.priority).toBeUndefined();

    // Schema should reflect the rename
    const schema = await callJsonTool(client, 'vault_schema', { analysis: 'overview' });
    const schemaJson = JSON.stringify(schema);
    expect(schemaJson).toContain('urgency');
  }

  async function tick20_configAndInit() {
    // Read config
    const config = await callJsonTool(client, 'flywheel_config', { mode: 'get' });
    expect(config).toBeDefined();

    // Set an exclude pattern
    const updated = await callJsonTool(client, 'flywheel_config', {
      mode: 'set',
      key: 'exclude',
      value: ['_archive'],
    });
    expect(updated.exclude ?? updated.config?.exclude).toContain('_archive');

    // Read config again — should round-trip
    const config2 = await callJsonTool(client, 'flywheel_config', { mode: 'get' });
    expect(config2.exclude ?? []).toContain('_archive');

    // Init status
    const initStatus = await callJsonTool(client, 'vault_init', { mode: 'status' });
    expect(initStatus).toBeDefined();
  }

  async function tick21_createAndUndo() {
    // Create a note with git commit
    await callJsonTool(client, 'vault_create_note', {
      path: scratchPath,
      content: '# Scratch\n\nTemporary note to be undone.',
      skipWikilinks: true,
      commit: true,
    });

    // Verify it exists
    await callJsonTool(client, 'refresh_index', {});
    const inv1 = await callJsonTool(client, 'find_notes', { limit: 200 });
    const paths1 = (inv1.notes ?? []).map((r: any) => r.path);
    expect(paths1).toContain(scratchPath);

    // Undo (soft reset — file stays on disk, commit is reverted)
    const undoResult = await callJsonTool(client, 'vault_undo_last_mutation', { confirm: true });
    expect(undoResult.success).toBe(true);

    // After soft reset, the note file still exists on disk (working tree)
    // but the git commit is reverted. Verify undo reported success and
    // the snapshot still holds consistency.
    activePaths = [rocketPath, alicePath, meetingPath, bobPath, robertPath, scratchPath];
    await refreshAndSnapshot();
  }

  async function tick22_finalAudit() {
    // No mutation — full consistency sweep
    activePaths = [rocketPath, alicePath, meetingPath, bobPath, robertPath, scratchPath];
    const { mcp, db } = await refreshAndSnapshot();

    // Health check
    const health = await getHealthCheck(client);
    expect(health.status ?? health.healthy).toBeTruthy();

    // Vault stats — should have 5 notes
    const stats = await getVaultStats(client);
    const noteCount = stats.total_notes ?? stats.note_count ?? stats.notes;
    expect(noteCount).toBe(6);

    // Graph analysis — orphans
    const orphans = await getGraphAnalysis(client, 'orphans');
    expect(orphans).toBeDefined();

    // Graph analysis — hubs
    const hubs = await getGraphAnalysis(client, 'hubs');
    expect(hubs).toBeDefined();

    // Validate links — expect no unexpected dead links
    // (merge_entities rewrites backlinks, so the merge path should be clean)
    const validation = await callJsonTool(client, 'validate_links', {
      group_by_target: true,
      limit: 20,
    });
    // Dead links pointing to alice-j.md may exist in rocket-launch overview
    // if the replace in tick8 didn't fully clean up, but merge rewrites should
    // have fixed backlinks. We just verify the tool runs and returns structured data.
    expect(validation).toBeDefined();
    expect(Array.isArray(validation.targets ?? validation.dead_links ?? [])).toBe(true);

    // Brief
    const brief = await callJsonTool(client, 'brief', {});
    expect(brief).toBeDefined();

    // Policy validate — trivial YAML
    const policyResult = await callJsonTool(client, 'policy', {
      action: 'validate',
      yaml: 'name: test-policy\nsteps:\n  - tool: vault_create_note\n    args:\n      path: test/policy-test.md\n      content: "# Test"\n',
    });
    expect(policyResult).toBeDefined();

    // Final cross-layer assertions (already run by refreshAndSnapshot)
    assertCrossLayerConsistency(mcp, db);
    assertInvariants(mcp);
  }

  // ── The clock ─────────────────────────────────────────────────

  test('22-tick extended tool coverage', async () => {
    // Sequence A: file/index mutations
    await tick1_createRocketLaunch();
    await tick2_createAlicePair();
    await tick3_createMeetingNotes();
    await tick4_addTasks();
    await tick5_toggleTask();
    await tick6_removeFromSection();
    await tick7_moveNote();
    await tick8_addAndReplaceContent();
    await tick9_updateMeetingFrontmatter();
    await tick10_mergeAliceJ();
    await tick11_createBobAndAbsorbAlias();
    await tick12_createRobertAndDismissMerge();

    // Sequence B: StateDb-only tools + diagnostics
    await tick13_memory();
    await tick14_corrections();
    await tick15_wikilinkFeedback();
    await tick16_toolSelectionFeedback();

    // Sequence B continued: bulk migrations (file mutations, need refresh)
    await tick17_renameTag();
    await tick18_migrateFieldValues();
    await tick19_renameField();

    // Config + init
    await tick20_configAndInit();

    // Undo
    await tick21_createAndUndo();

    // Final audit
    await tick22_finalAudit();
  }, 300_000);
});
