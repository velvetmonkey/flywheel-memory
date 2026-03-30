import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ALL_CATEGORIES, TOOL_CATEGORY, TOOL_TIER, generateInstructions } from '../src/config.js';
import { applyToolGating } from '../src/tool-registry.js';
import type { ToolTierController } from '../src/tool-registry.js';

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


/** Server with ALL declared tools registered as stubs — mirrors the full preset */
function createFullPresetServer() {
  const server = new McpServer({ name: 'full-preset-test', version: '0.0.0' });
  const controller = applyToolGating(
    server,
    new Set(ALL_CATEGORIES),
    () => null,
    null,
    undefined,
    undefined,
    'tiered',
  );

  for (const toolName of Object.keys(TOOL_CATEGORY)) {
    if (toolName === 'search') {
      server.tool(toolName, { query: z.string().optional(), focus: z.string().optional() }, async () => ({
        content: [{ type: 'text' as const, text: `${toolName} ok` }],
      }));
    } else if (toolName === 'brief') {
      server.tool(toolName, { focus: z.string().optional() }, async () => ({
        content: [{ type: 'text' as const, text: `${toolName} ok` }],
      }));
    } else {
      server.tool(toolName, async () => ({
        content: [{ type: 'text' as const, text: `${toolName} ok` }],
      }));
    }
  }

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

/** Helper to list tool names via the MCP tools/list handler */
async function listToolNames(server: McpServer): Promise<Set<string>> {
  const handler = (server as any).server._requestHandlers.get('tools/list');
  const result = await handler({ method: 'tools/list' }, {});
  return new Set(result.tools.map((t: { name: string }) => t.name));
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

// ============================================================================
// Activation edge cases
// ============================================================================

describe('activation edge cases', () => {
  it.each([
    { label: 'empty string', args: { query: '' } },
    { label: 'whitespace only', args: { query: '   ' } },
    { label: 'missing query', args: {} },
  ])('$label does not activate any category', async ({ args }) => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    await callTool(server, 'search', args);

    expect(controller.activeCategories.size).toBe(0);
    expect(tools.graph_analysis.enabled).toBe(false);
    expect(tools.suggest_wikilinks.enabled).toBe(false);
    expect(tools.vault_schema.enabled).toBe(false);
  });

  it.each([
    { query: 'BACKLINKS', category: 'graph', tool: 'graph_analysis' },
    { query: 'Schema', category: 'schema', tool: 'vault_schema' },
  ])('case-insensitive: "$query" activates $category', async ({ query, category, tool }) => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    await callTool(server, 'search', { query });

    expect(controller.activeCategories.has(category)).toBe(true);
    expect(tools[tool].enabled).toBe(true);
  });
});

// ============================================================================
// generateInstructions integration with controller state
// ============================================================================

describe('generateInstructions integration with controller state', () => {
  it('instructions evolve as categories activate via tool calls', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    const getInstructions = () =>
      generateInstructions(new Set(ALL_CATEGORIES), null, controller.activeCategories);

    // Initial: escalation hints present, full sections absent
    let instructions = getInstructions();
    expect(instructions).toContain('Ask about graph connections, backlinks, hubs, clusters, or paths');
    expect(instructions).toContain('Ask about wikilinks, suggestions, stubs, or unlinked mentions');
    expect(instructions).not.toContain('## Graph');
    expect(instructions).not.toContain('## Wikilinks');

    // Activate graph via search signal
    await callTool(server, 'search', { query: 'show backlinks' });
    expect(controller.activeCategories.has('graph')).toBe(true);
    expect(tools.graph_analysis.enabled).toBe(true);

    instructions = getInstructions();
    expect(instructions).toContain('## Graph');
    expect(instructions).not.toContain('Ask about graph connections, backlinks, hubs, clusters, or paths');

    // Activate wikilinks via search signal
    await callTool(server, 'search', { query: 'check wikilinks' });
    expect(controller.activeCategories.has('wikilinks')).toBe(true);
    expect(tools.suggest_wikilinks.enabled).toBe(true);

    instructions = getInstructions();
    expect(instructions).toContain('## Graph');
    expect(instructions).toContain('## Wikilinks');
    // Unactivated categories still show hints
    expect(instructions).toContain('Ask to unlock schema tools');
    expect(instructions).toContain('Ask about time, history, evolution, or stale notes');
  });
});

// ============================================================================
// Full preset reachability
// ============================================================================

describe('full preset reachability', () => {
  it('tier metadata matches expected split', () => {
    const tiers = Object.values(TOOL_TIER);
    expect(tiers.filter(t => t === 1).length).toBe(18);
    expect(tiers.filter(t => t === 2).length).toBe(33);
    expect(tiers.filter(t => t === 3).length).toBe(26);
    expect(Object.keys(TOOL_CATEGORY).length).toBe(77);
  });

  it('full helper registers every declared tool', () => {
    const { controller } = createFullPresetServer();
    expect(controller.getRegisteredTools().size).toBe(Object.keys(TOOL_CATEGORY).length);
    expect(controller.registered).toBe(Object.keys(TOOL_CATEGORY).length);
  });

  it('tiered mode initially lists only tier-1 tools', async () => {
    const { server } = createFullPresetServer();
    const names = await listToolNames(server);

    const tier1Tools = new Set(
      Object.entries(TOOL_TIER).filter(([, t]) => t === 1).map(([name]) => name),
    );
    const tier2Tools = new Set(
      Object.entries(TOOL_TIER).filter(([, t]) => t === 2).map(([name]) => name),
    );
    const tier3Tools = new Set(
      Object.entries(TOOL_TIER).filter(([, t]) => t === 3).map(([name]) => name),
    );

    expect(names).toEqual(tier1Tools);

    for (const t of tier2Tools) {
      expect(names, `tier-2 tool "${t}" should NOT be listed`).not.toContain(t);
    }
    for (const t of tier3Tools) {
      expect(names, `tier-3 tool "${t}" should NOT be listed`).not.toContain(t);
    }
  });

  it('enableAllTiers exposes the full catalog in tools/list', async () => {
    const { server, controller } = createFullPresetServer();

    controller.enableAllTiers();

    const names = await listToolNames(server);
    const allDeclared = new Set(Object.keys(TOOL_CATEGORY));

    expect(names).toEqual(allDeclared);
  });

  it('enableAllTiers makes every declared tool callable', async () => {
    const { server, controller } = createFullPresetServer();

    controller.enableAllTiers();

    for (const toolName of Object.keys(TOOL_CATEGORY)) {
      const result = await callTool(server, toolName);
      expect(result.isError, `${toolName} should not error`).not.toBe(true);
      expect(result.content[0].text, `${toolName} response mismatch`).toBe(`${toolName} ok`);
    }
  });

  it('setOverride(\'full\') also exposes and executes the full catalog', async () => {
    const { server, controller } = createFullPresetServer();

    controller.setOverride('full');

    // Listing
    const names = await listToolNames(server);
    const allDeclared = new Set(Object.keys(TOOL_CATEGORY));
    expect(names).toEqual(allDeclared);

    // Calling
    for (const toolName of Object.keys(TOOL_CATEGORY)) {
      const result = await callTool(server, toolName);
      expect(result.isError, `${toolName} should not error`).not.toBe(true);
      expect(result.content[0].text, `${toolName} response mismatch`).toBe(`${toolName} ok`);
    }
  });
});

// ============================================================================
// T18 — Session behaviour tests
// ============================================================================

function createTieredServerWithCallback(onTierStateChange: (controller: ToolTierController) => void) {
  const server = new McpServer({ name: 'test-cb', version: '0.0.0' });
  const controller = applyToolGating(
    server,
    new Set(ALL_CATEGORIES),
    () => null,
    null,
    undefined,
    undefined,
    'tiered',
    onTierStateChange,
  );

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

// ============================================================================
// onTierStateChange callback
// ============================================================================

describe('onTierStateChange callback', () => {
  it('fires when a category activates via search signal', async () => {
    const cb = vi.fn();
    const { server } = createTieredServerWithCallback(cb);
    cb.mockClear();

    await callTool(server, 'search', { query: 'show me backlinks' });

    expect(cb).toHaveBeenCalled();
    const ctrl: ToolTierController = cb.mock.calls[cb.mock.calls.length - 1][0];
    expect(ctrl.activeCategories.has('graph')).toBe(true);
  });

  it('fires when enableTierCategory is called directly', () => {
    const cb = vi.fn();
    const { controller } = createTieredServerWithCallback(cb);
    cb.mockClear();

    controller.enableTierCategory('graph');

    expect(cb).toHaveBeenCalled();
    const ctrl: ToolTierController = cb.mock.calls[cb.mock.calls.length - 1][0];
    expect(ctrl.activeCategories.has('graph')).toBe(true);
  });

  it('fires on setOverride with matching override state', () => {
    const cb = vi.fn();
    const { controller } = createTieredServerWithCallback(cb);
    cb.mockClear();

    controller.setOverride('full');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].getOverride()).toBe('full');

    controller.setOverride('auto');
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1][0].getOverride()).toBe('auto');
  });

  it('no error when callback is undefined (existing helper)', async () => {
    const { server, controller } = createTieredServer();

    await callTool(server, 'search', { query: 'show backlinks' });

    expect(controller.activeCategories.has('graph')).toBe(true);
  });
});

// ============================================================================
// Activation suppression in full override
// ============================================================================

describe('activation suppression in full override', () => {
  it('full override suppresses activation map updates', async () => {
    const { server, controller } = createTieredServer();

    controller.setOverride('full');

    await callTool(server, 'search', { query: 'backlinks and schema' });

    expect(controller.getActivatedCategoryTiers().size).toBe(0);
  });

  it('categories activated before full survive full→auto; unactivated re-lock', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    await callTool(server, 'search', { query: 'show backlinks' });
    expect(controller.activeCategories.has('graph')).toBe(true);

    controller.setOverride('full');
    expect(tools.vault_schema.enabled).toBe(true);

    controller.setOverride('auto');
    expect(tools.graph_analysis.enabled).toBe(true);
    expect(tools.vault_schema.enabled).toBe(false);
  });

  it('signals during full do not leak into auto mode', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    controller.setOverride('full');

    await callTool(server, 'search', { query: 'schema backlinks' });

    controller.setOverride('auto');

    expect(tools.graph_analysis.enabled).toBe(false);
    expect(tools.vault_schema.enabled).toBe(false);
  });
});

// ============================================================================
// Controller tier-state (getActivatedCategoryTiers)
// ============================================================================

describe('getActivatedCategoryTiers() public API', () => {
  it('returns empty map when no categories activated', () => {
    const { controller } = createTieredServer();
    expect(controller.getActivatedCategoryTiers().size).toBe(0);
  });

  it('returns a defensive copy — mutation does not affect internal state', () => {
    const { controller } = createTieredServer();
    controller.activateCategory('graph', 2);

    const map = controller.getActivatedCategoryTiers() as Map<string, number>;
    map.set('schema', 3);

    expect(controller.getActivatedCategoryTiers().has('schema')).toBe(false);
  });

  it('accumulates entries as categories activate', () => {
    const { controller } = createTieredServer();

    controller.activateCategory('graph', 2);
    controller.activateCategory('schema', 3);

    const map = controller.getActivatedCategoryTiers();
    expect(map.get('graph')).toBe(2);
    expect(map.get('schema')).toBe(3);
    expect(map.size).toBe(2);
  });

  it('tier upgrade: activateCategory at higher tier replaces lower', () => {
    const { controller } = createTieredServer();

    controller.activateCategory('schema', 2);
    expect(controller.getActivatedCategoryTiers().get('schema')).toBe(2);

    controller.activateCategory('schema', 3);
    expect(controller.getActivatedCategoryTiers().get('schema')).toBe(3);
  });

  it('tier downgrade rejected: lower tier does not demote', () => {
    const { controller } = createTieredServer();

    controller.activateCategory('graph', 3);
    controller.activateCategory('graph', 2);

    expect(controller.getActivatedCategoryTiers().get('graph')).toBe(3);
  });
});

// ============================================================================
// Minimal-to-auto state transitions
// ============================================================================

describe('minimal-to-auto state transitions', () => {
  it('direct call in minimal records activation but tool stays disabled', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    controller.setOverride('minimal');

    const result = await callTool(server, 'graph_analysis');

    expect(result.isError).toBe(true);
    expect(controller.getActivatedCategoryTiers().has('graph')).toBe(true);
    expect(tools.graph_analysis.enabled).toBe(false);
  });

  it('switching from minimal to auto reveals categories activated during minimal', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    controller.setOverride('minimal');
    await callTool(server, 'graph_analysis');
    expect(tools.graph_analysis.enabled).toBe(false);

    controller.setOverride('auto');
    expect(tools.graph_analysis.enabled).toBe(true);
  });

  it('search signal in minimal records activation for later auto restore', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    controller.setOverride('minimal');

    await callTool(server, 'search', { query: 'show backlinks' });

    expect(controller.getActivatedCategoryTiers().has('graph')).toBe(true);
    expect(tools.graph_analysis.enabled).toBe(false);

    controller.setOverride('auto');
    expect(tools.graph_analysis.enabled).toBe(true);
  });
});

// ============================================================================
// Concurrent activation & finalizeRegistration idempotency
// ============================================================================

describe('concurrent activation and finalization', () => {
  it('concurrent searches activating different categories both succeed', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    await Promise.all([
      callTool(server, 'search', { query: 'backlinks' }),
      callTool(server, 'search', { query: 'schema' }),
    ]);

    expect(controller.activeCategories.has('graph')).toBe(true);
    expect(controller.activeCategories.has('schema')).toBe(true);
    expect(controller.getActivatedCategoryTiers().get('graph')).toBe(2);
    expect(controller.getActivatedCategoryTiers().get('schema')).toBe(3);
    expect(tools.graph_analysis.enabled).toBe(true);
    expect(tools.vault_schema.enabled).toBe(true);
  });

  it('concurrent searches activating the same category produce a single entry', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    await Promise.all([
      callTool(server, 'search', { query: 'backlinks' }),
      callTool(server, 'search', { query: 'connections and hubs' }),
    ]);

    expect(controller.activeCategories.has('graph')).toBe(true);
    expect(controller.getActivatedCategoryTiers().get('graph')).toBe(2);
    expect(tools.graph_analysis.enabled).toBe(true);
  });

  it('calling finalizeRegistration twice does not throw or break tools', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    expect(() => controller.finalizeRegistration()).not.toThrow();

    await callTool(server, 'search', { query: 'show backlinks' });
    expect(controller.activeCategories.has('graph')).toBe(true);

    const result = await callTool(server, 'graph_analysis');
    expect(result.isError).not.toBe(true);
    expect(tools.graph_analysis.enabled).toBe(true);
  });
});
