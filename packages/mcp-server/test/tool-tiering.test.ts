import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ALL_CATEGORIES, generateInstructions } from '../src/config.js';
import { applyToolGating } from '../src/tool-registry.js';

function createTieredServer() {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const controller = applyToolGating(
    server,
    new Set(ALL_CATEGORIES),
    () => null,
    null,
    undefined,
    undefined,
    'tiered',
  );

  // search and brief need schemas so params flow through wrapWithTracking
  server.tool('search', { query: z.string().optional(), focus: z.string().optional() }, async () => ({
    content: [{ type: 'text' as const, text: 'search ok' }],
  }));
  server.tool('brief', { focus: z.string().optional() }, async () => ({
    content: [{ type: 'text' as const, text: 'brief ok' }],
  }));
  server.tool('graph_analysis', async () => ({
    content: [{ type: 'text' as const, text: 'graph ok' }],
  }));
  server.tool('vault_schema', async () => ({
    content: [{ type: 'text' as const, text: 'schema ok' }],
  }));
  server.tool('health_check', async () => ({
    content: [{ type: 'text' as const, text: 'health ok' }],
  }));
  server.tool('merge_entities', async () => ({
    content: [{ type: 'text' as const, text: 'merge ok' }],
  }));
  server.tool('suggest_wikilinks', async () => ({
    content: [{ type: 'text' as const, text: 'wikilinks ok' }],
  }));
  server.tool('vault_record_correction', async () => ({
    content: [{ type: 'text' as const, text: 'correction ok' }],
  }));
  server.tool('get_context_around_date', async () => ({
    content: [{ type: 'text' as const, text: 'temporal ok' }],
  }));

  controller.finalizeRegistration();
  return { server, controller };
}

/** Helper to invoke a tool via the MCP tools/call handler */
async function callTool(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const handler = (server as any).server._requestHandlers.get('tools/call');
  return handler(
    { method: 'tools/call', params: { name, arguments: args } },
    {},
  );
}

describe('tool tiering', () => {
  it('starts with only tier-1 tools enabled in tiered mode', () => {
    const { server } = createTieredServer();
    const tools = (server as any)._registeredTools;

    expect(tools.search.enabled).toBe(true);
    expect(tools.graph_analysis.enabled).toBe(false);
    expect(tools.vault_schema.enabled).toBe(false);
    expect(tools.health_check.enabled).toBe(false);
    expect(tools.merge_entities.enabled).toBe(false);
  });

  it('enableTierCategory reveals all tier-2 tools in that category', () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    controller.enableTierCategory('graph');

    expect(tools.graph_analysis.enabled).toBe(true);
    expect(tools.vault_schema.enabled).toBe(false);
    expect(tools.health_check.enabled).toBe(false);
  });

  it('enableAllTiers reveals every registered tool', () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    controller.enableAllTiers();

    expect(tools.search.enabled).toBe(true);
    expect(tools.graph_analysis.enabled).toBe(true);
    expect(tools.vault_schema.enabled).toBe(true);
    expect(tools.health_check.enabled).toBe(true);
    expect(tools.merge_entities.enabled).toBe(true);
  });

  it('executes a hidden tier tool when called directly and reveals its category', async () => {
    const { server, controller } = createTieredServer();

    const result = await callTool(server, 'graph_analysis');

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain('graph ok');
    expect((server as any)._registeredTools.graph_analysis.enabled).toBe(true);
    expect(controller.activeCategories.has('graph')).toBe(true);
  });

  it('generateInstructions shows escalation hints for inactive tiered categories', () => {
    const instructions = generateInstructions(new Set(ALL_CATEGORIES), null, new Set());

    expect(instructions).toContain('Ask about graph connections, backlinks, hubs, clusters, or paths');
    expect(instructions).toContain('Ask about wikilinks, suggestions, stubs, or unlinked mentions');
    expect(instructions).toContain('Ask to unlock schema tools');
  });

  it('generateInstructions shows full category guidance once activated', () => {
    const instructions = generateInstructions(
      new Set(ALL_CATEGORIES),
      null,
      new Set(['graph', 'wikilinks']),
    );

    expect(instructions).toContain('## Graph');
    expect(instructions).toContain('Use "get_backlinks" for per-backlink surrounding text');
    expect(instructions).toContain('## Wikilinks');
    expect(instructions).not.toContain('Ask about graph connections, backlinks, hubs, clusters, or paths');
  });
});

// ============================================================================
// Activation signals
// ============================================================================

describe('activation signals via search/brief', () => {
  it('search query with "backlinks" unlocks graph category', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    expect(tools.graph_analysis.enabled).toBe(false);

    await callTool(server, 'search', { query: 'show me backlinks for this note' });

    expect(controller.activeCategories.has('graph')).toBe(true);
    expect(tools.graph_analysis.enabled).toBe(true);
  });

  it('search query with "schema" unlocks schema category (tier 3)', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    expect(tools.vault_schema.enabled).toBe(false);

    await callTool(server, 'search', { query: 'what does the schema look like' });

    expect(controller.activeCategories.has('schema')).toBe(true);
    expect(tools.vault_schema.enabled).toBe(true);
  });

  it('search query with "stale notes" unlocks temporal category', async () => {
    const { server, controller } = createTieredServer();

    await callTool(server, 'search', { query: 'find stale notes that need updating' });

    expect(controller.activeCategories.has('temporal')).toBe(true);
    expect((server as any)._registeredTools.get_context_around_date.enabled).toBe(true);
  });

  it('search query with "wikilinks" unlocks wikilinks category', async () => {
    const { server, controller } = createTieredServer();

    await callTool(server, 'search', { query: 'check wikilinks on my project notes' });

    expect(controller.activeCategories.has('wikilinks')).toBe(true);
    expect((server as any)._registeredTools.suggest_wikilinks.enabled).toBe(true);
  });

  it('search query with no signal keywords does not unlock anything', async () => {
    const { server, controller } = createTieredServer();

    await callTool(server, 'search', { query: 'find notes about cooking recipes' });

    expect(controller.activeCategories.size).toBe(0);
    expect((server as any)._registeredTools.graph_analysis.enabled).toBe(false);
    expect((server as any)._registeredTools.vault_schema.enabled).toBe(false);
  });

  it('brief focus param triggers activation', async () => {
    const { server, controller } = createTieredServer();

    await callTool(server, 'brief', { focus: 'review backlinks and connections' });

    expect(controller.activeCategories.has('graph')).toBe(true);
  });

  it('multiple signals in one query unlock multiple categories', async () => {
    const { server, controller } = createTieredServer();

    await callTool(server, 'search', { query: 'check backlinks and wikilinks for stale notes' });

    expect(controller.activeCategories.has('graph')).toBe(true);
    expect(controller.activeCategories.has('wikilinks')).toBe(true);
    expect(controller.activeCategories.has('temporal')).toBe(true);
  });

  it('tier-2 signal does not unlock tier-3 categories', async () => {
    const { server, controller } = createTieredServer();

    await callTool(server, 'search', { query: 'show me backlinks and connections' });

    expect(controller.activeCategories.has('graph')).toBe(true);
    // schema (tier 3) and note-ops (tier 3) should stay locked
    expect(controller.activeCategories.has('schema')).toBe(false);
    expect(controller.activeCategories.has('note-ops')).toBe(false);
    expect((server as any)._registeredTools.vault_schema.enabled).toBe(false);
  });

  it('non-search/brief tool calls do not trigger activation signals', async () => {
    const { server, controller } = createTieredServer();

    // Direct-call graph_analysis — it auto-enables its own category,
    // but should NOT parse its params for activation of other categories
    await callTool(server, 'graph_analysis', { query: 'wikilinks and schema' });

    // graph is enabled (direct call auto-enable), but wikilinks/schema should NOT be
    expect(controller.activeCategories.has('graph')).toBe(true);
    expect(controller.activeCategories.has('wikilinks')).toBe(false);
    expect(controller.activeCategories.has('schema')).toBe(false);
  });
});

// ============================================================================
// Token savings measurement
// ============================================================================

describe('token savings', () => {
  it('tier-1 instructions are significantly smaller than full instructions', () => {
    const tier1Only = generateInstructions(new Set(ALL_CATEGORIES), null, new Set());
    const partialActive = generateInstructions(
      new Set(ALL_CATEGORIES),
      null,
      new Set(['graph', 'wikilinks']),
    );
    const allActive = generateInstructions(
      new Set(ALL_CATEGORIES),
      null,
      new Set(ALL_CATEGORIES),
    );

    // tier-1 < partial < all
    expect(tier1Only.length).toBeLessThan(partialActive.length);
    expect(partialActive.length).toBeLessThan(allActive.length);

    // tier-1 should be at least 30% smaller than all-active
    const savings = 1 - tier1Only.length / allActive.length;
    expect(savings).toBeGreaterThanOrEqual(0.3);
  });

  it('escalation hints add minimal overhead compared to full category guidance', () => {
    const tier1Only = generateInstructions(new Set(ALL_CATEGORIES), null, new Set());
    const noTiering = generateInstructions(new Set(ALL_CATEGORIES), null);

    // Without tiering (undefined activeTierCategories), all categories show full guidance
    // With tiering + empty set, only tier-1 + hints shown — should be smaller
    expect(tier1Only.length).toBeLessThan(noTiering.length);
  });
});

// ============================================================================
// Override modes
// ============================================================================

describe('override modes', () => {
  it('minimal mode blocks activation signals from enabling tools', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    controller.setOverride('minimal');

    await callTool(server, 'search', { query: 'show me backlinks' });

    // Signal fired but minimal mode prevents enablement
    expect(tools.graph_analysis.enabled).toBe(false);
  });

  it('full override enables all tools regardless of activation state', () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    controller.setOverride('full');

    expect(tools.search.enabled).toBe(true);
    expect(tools.graph_analysis.enabled).toBe(true);
    expect(tools.vault_schema.enabled).toBe(true);
    expect(tools.health_check.enabled).toBe(true);
    expect(tools.merge_entities.enabled).toBe(true);
  });

  it('direct call to tier-3 tool in minimal mode returns error', async () => {
    const { server, controller } = createTieredServer();

    controller.setOverride('minimal');

    // Minimal mode blocks even direct calls
    const result = await callTool(server, 'vault_schema');

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('disabled');
  });

  it('switching from full back to auto re-applies tier restrictions', () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    controller.setOverride('full');
    expect(tools.graph_analysis.enabled).toBe(true);

    controller.setOverride('auto');
    expect(tools.graph_analysis.enabled).toBe(false);
    expect(tools.search.enabled).toBe(true);
  });
});

// ============================================================================
// Multi-vault tier isolation
// ============================================================================

describe('multi-vault tier isolation', () => {
  it('tier state is per-controller — unlocking on one does not affect another', () => {
    const serverA = new McpServer({ name: 'vault-a', version: '0.0.0' });
    const controllerA = applyToolGating(
      serverA,
      new Set(ALL_CATEGORIES),
      () => null,
      null,
      undefined,
      undefined,
      'tiered',
    );
    serverA.tool('search', { query: z.string().optional() }, async () => ({
      content: [{ type: 'text' as const, text: 'a' }],
    }));
    serverA.tool('graph_analysis', async () => ({
      content: [{ type: 'text' as const, text: 'a' }],
    }));
    controllerA.finalizeRegistration();

    const serverB = new McpServer({ name: 'vault-b', version: '0.0.0' });
    const controllerB = applyToolGating(
      serverB,
      new Set(ALL_CATEGORIES),
      () => null,
      null,
      undefined,
      undefined,
      'tiered',
    );
    serverB.tool('search', { query: z.string().optional() }, async () => ({
      content: [{ type: 'text' as const, text: 'b' }],
    }));
    serverB.tool('graph_analysis', async () => ({
      content: [{ type: 'text' as const, text: 'b' }],
    }));
    controllerB.finalizeRegistration();

    // Unlock graph on vault A
    controllerA.enableTierCategory('graph');

    // Vault A: graph enabled
    expect((serverA as any)._registeredTools.graph_analysis.enabled).toBe(true);
    expect(controllerA.activeCategories.has('graph')).toBe(true);

    // Vault B: graph still disabled
    expect((serverB as any)._registeredTools.graph_analysis.enabled).toBe(false);
    expect(controllerB.activeCategories.has('graph')).toBe(false);
  });
});

// ============================================================================
// T14 Routing Mode Integration Tests
// ============================================================================

describe('tool routing mode integration', () => {
  it('pattern mode matches current T13 behavior (regex only)', () => {
    process.env.FLYWHEEL_TOOL_ROUTING = 'pattern';
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    // In pattern mode, regex activation should still work
    expect(tools.search.enabled).toBe(true);
    expect(tools.graph_analysis.enabled).toBe(false);

    // Regex-based activation should still enable categories
    controller.activateCategory('graph', 2);
    expect(tools.graph_analysis.enabled).toBe(true);

    delete process.env.FLYWHEEL_TOOL_ROUTING;
  });

  it('FLYWHEEL_TOOL_ROUTING defaults to hybrid when tiered', async () => {
    delete process.env.FLYWHEEL_TOOL_ROUTING;
    const { getToolRoutingMode } = await import('../src/core/read/toolRouting.js');
    expect(getToolRoutingMode('tiered')).toBe('hybrid');
  });

  it('FLYWHEEL_TOOL_ROUTING defaults to pattern when not tiered', async () => {
    delete process.env.FLYWHEEL_TOOL_ROUTING;
    const { getToolRoutingMode } = await import('../src/core/read/toolRouting.js');
    expect(getToolRoutingMode('off')).toBe('pattern');
  });
});

// ============================================================================
// Session Persistence Tests (T15b — progressive disclosure contract)
// ============================================================================

describe('progressive disclosure session persistence', () => {
  it('activated categories persist across subsequent tool calls', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    // Initial: graph hidden
    expect(tools.graph_analysis.enabled).toBe(false);

    // Query 1: activate graph
    await callTool(server, 'search', { query: 'show me backlinks and connections' });
    expect(controller.activeCategories.has('graph')).toBe(true);
    expect(tools.graph_analysis.enabled).toBe(true);

    // Query 2: unrelated search
    await callTool(server, 'search', { query: 'cooking recipes for dinner' });

    // Graph should still be active — categories never deactivate
    expect(controller.activeCategories.has('graph')).toBe(true);
    expect(tools.graph_analysis.enabled).toBe(true);

    // Query 3: another unrelated search
    await callTool(server, 'search', { query: 'project status update' });

    // Still active
    expect(controller.activeCategories.has('graph')).toBe(true);
    expect(tools.graph_analysis.enabled).toBe(true);
  });

  it('sequential queries accumulate categories without conflict', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    // Step 1: activate graph
    await callTool(server, 'search', { query: 'show me backlinks' });
    expect(controller.activeCategories.has('graph')).toBe(true);
    expect(tools.graph_analysis.enabled).toBe(true);

    // Step 2: activate temporal
    await callTool(server, 'search', { query: 'show me the timeline and history' });
    expect(controller.activeCategories.has('temporal')).toBe(true);
    expect(tools.get_context_around_date.enabled).toBe(true);

    // Step 3: activate schema (tier 3)
    await callTool(server, 'search', { query: 'what does the schema look like' });
    expect(controller.activeCategories.has('schema')).toBe(true);
    expect(tools.vault_schema.enabled).toBe(true);

    // All three should coexist
    expect(controller.activeCategories.has('graph')).toBe(true);
    expect(controller.activeCategories.has('temporal')).toBe(true);
    expect(controller.activeCategories.has('schema')).toBe(true);
    expect(tools.graph_analysis.enabled).toBe(true);
    expect(tools.get_context_around_date.enabled).toBe(true);
    expect(tools.vault_schema.enabled).toBe(true);
  });

  it('direct tool call persists — subsequent calls succeed without re-activation', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    // Direct call to hidden tool — should auto-enable
    const result1 = await callTool(server, 'graph_analysis');
    expect(result1.isError).not.toBe(true);
    expect(tools.graph_analysis.enabled).toBe(true);

    // Second call should work without any new activation
    const result2 = await callTool(server, 'graph_analysis');
    expect(result2.isError).not.toBe(true);
    expect(tools.graph_analysis.enabled).toBe(true);
  });

  it('override mode persists across calls', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    controller.setOverride('full');
    expect(tools.graph_analysis.enabled).toBe(true);
    expect(tools.vault_schema.enabled).toBe(true);

    // Multiple calls don't reset the override
    await callTool(server, 'search', { query: 'simple search' });
    await callTool(server, 'search', { query: 'another search' });

    expect(controller.getOverride()).toBe('full');
    expect(tools.graph_analysis.enabled).toBe(true);
    expect(tools.vault_schema.enabled).toBe(true);
  });

  it('listTools reflects tier state — hidden tools not listed, activated tools listed', async () => {
    const { server, controller } = createTieredServer();

    // Get tool list via MCP handler
    const listHandler = (server as any).server._requestHandlers.get('tools/list');
    const initialList = await listHandler({ method: 'tools/list' }, {});
    const initialNames = initialList.tools.map((t: { name: string }) => t.name);

    // tier-1 visible
    expect(initialNames).toContain('search');
    // tier-2 hidden
    expect(initialNames).not.toContain('graph_analysis');

    // Activate graph
    controller.activateCategory('graph', 2);

    const updatedList = await listHandler({ method: 'tools/list' }, {});
    const updatedNames = updatedList.tools.map((t: { name: string }) => t.name);

    // Now graph_analysis should appear
    expect(updatedNames).toContain('graph_analysis');
    // search still there
    expect(updatedNames).toContain('search');
  });
});
