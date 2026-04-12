import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ALL_CATEGORIES, INITIAL_TIER_OVERRIDE, PRESETS, TOOL_CATEGORY, TOOL_TIER, TOTAL_TOOL_COUNT, TIER_1_TOOL_COUNT, TIER_2_TOOL_COUNT, TIER_3_TOOL_COUNT, DISCLOSURE_ONLY_TOOLS, generateInstructions, resolveToolConfig } from '../src/config.js';
import type { ToolCategory, ToolTier, ToolTierOverride } from '../src/config.js';
import { applyToolGating } from '../src/tool-registry.js';
import type { ToolTierController, ToolTierMode } from '../src/tool-registry.js';
import { registerDiscoveryTools } from '../src/tools/read/discovery.js';

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

  // search and memory(brief) need schemas so params flow through wrapWithTracking
  server.tool('search', { query: z.string().optional(), focus: z.string().optional() }, async () => ({
    content: [{ type: 'text' as const, text: 'search ok' }],
  }));
  server.tool('memory', { action: z.string().optional(), focus: z.string().optional() }, async () => ({
    content: [{ type: 'text' as const, text: 'memory ok' }],
  }));
  // Merged tools (T43 B3+ names)
  server.tool('graph', async () => ({
    content: [{ type: 'text' as const, text: 'graph ok' }],
  }));
  server.tool('schema', async () => ({
    content: [{ type: 'text' as const, text: 'schema ok' }],
  }));
  server.tool('doctor', async () => ({
    content: [{ type: 'text' as const, text: 'doctor ok' }],
  }));
  server.tool('entity', async () => ({
    content: [{ type: 'text' as const, text: 'entity ok' }],
  }));
  server.tool('link', async () => ({
    content: [{ type: 'text' as const, text: 'link ok' }],
  }));
  server.tool('correct', async () => ({
    content: [{ type: 'text' as const, text: 'correct ok' }],
  }));
  server.tool('insights', async () => ({
    content: [{ type: 'text' as const, text: 'temporal ok' }],
  }));

  controller.finalizeRegistration();
  return { server, controller };
}


/** Server with ALL declared tools registered as stubs — mirrors the full preset catalog */
function createFullPresetServer(options: { startupOverride?: 'auto' | 'full' | 'minimal' } = {}) {
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
    } else if (toolName === 'memory') {
      server.tool(toolName, { action: z.string().optional(), focus: z.string().optional() }, async () => ({
        content: [{ type: 'text' as const, text: `${toolName} ok` }],
      }));
    } else {
      server.tool(toolName, async () => ({
        content: [{ type: 'text' as const, text: `${toolName} ok` }],
      }));
    }
  }

  if (options.startupOverride) {
    controller.setOverride(options.startupOverride);
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
  const result = await listTools(server);
  return new Set(result.tools.map((t: { name: string }) => t.name));
}

/** Helper to list raw tool payloads via the MCP tools/list handler */
async function listTools(server: McpServer): Promise<{ tools: Array<{ name: string; inputSchema: { type?: string } }> }> {
  const handler = (server as any).server._requestHandlers.get('tools/list');
  return handler({ method: 'tools/list' }, {});
}

describe('tool tiering', () => {
  it('starts with only tier-1 tools enabled in tiered mode', () => {
    const { server } = createTieredServer();
    const tools = (server as any)._registeredTools;

    expect(tools.search.enabled).toBe(true);
    expect(tools.doctor.enabled).toBe(true);  // tier-1: always visible
    expect(tools.graph.enabled).toBe(false);  // tier-2: hidden initially
    expect(tools.schema.enabled).toBe(false); // tier-2: hidden initially
    expect(tools.entity.enabled).toBe(false); // tier-2: hidden initially
  });

  it('enableTierCategory reveals all tier-2 tools in that category', () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    controller.enableTierCategory('graph');

    expect(tools.graph.enabled).toBe(true);
    expect(tools.schema.enabled).toBe(false);
    expect(tools.doctor.enabled).toBe(true); // tier-1: always enabled
  });

  it('enableAllTiers reveals every registered tool', () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    controller.enableAllTiers();

    expect(tools.search.enabled).toBe(true);
    expect(tools.graph.enabled).toBe(true);
    expect(tools.schema.enabled).toBe(true);
    expect(tools.doctor.enabled).toBe(true);
    expect(tools.entity.enabled).toBe(true);
  });

  it('executes a hidden tier tool when called directly and reveals its category', async () => {
    const { server, controller } = createTieredServer();

    const result = await callTool(server, 'graph');

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain('graph ok');
    expect((server as any)._registeredTools.graph.enabled).toBe(true);
    expect(controller.activeCategories.has('graph')).toBe(true);
  });

  it('generateInstructions shows escalation hints for inactive tiered categories', () => {
    const instructions = generateInstructions(new Set(ALL_CATEGORIES), null, new Set());

    expect(instructions).toContain('discover_tools');
    expect(instructions).toContain('specialized tools');
    expect(instructions).toContain('graph analysis');
  });

  it('generateInstructions shows full category guidance once activated', () => {
    const instructions = generateInstructions(
      new Set(ALL_CATEGORIES),
      null,
      new Set(['graph', 'wikilinks']),
    );

    expect(instructions).toContain('## Graph');
    expect(instructions).toContain('Use "graph" (action: analyse) for structural queries');
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

    expect(tools.graph.enabled).toBe(false);

    await callTool(server, 'search', { query: 'show me backlinks for this note' });

    expect(controller.activeCategories.has('graph')).toBe(true);
    expect(tools.graph.enabled).toBe(true);
  });

  it('search query with "schema" unlocks schema category (tier 2)', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    expect(tools.schema.enabled).toBe(false);

    await callTool(server, 'search', { query: 'what does the schema look like' });

    expect(controller.activeCategories.has('schema')).toBe(true);
    expect(tools.schema.enabled).toBe(true);
  });

  it('search query with "stale notes" unlocks temporal category', async () => {
    const { server, controller } = createTieredServer();

    await callTool(server, 'search', { query: 'find stale notes that need updating' });

    expect(controller.activeCategories.has('temporal')).toBe(true);
    expect((server as any)._registeredTools.insights.enabled).toBe(true);
  });

  it('search query with "wikilinks" unlocks wikilinks category', async () => {
    const { server, controller } = createTieredServer();

    await callTool(server, 'search', { query: 'check wikilinks on my project notes' });

    expect(controller.activeCategories.has('wikilinks')).toBe(true);
    expect((server as any)._registeredTools.link.enabled).toBe(true);
  });

  it('search query with no signal keywords does not unlock anything', async () => {
    const { server, controller } = createTieredServer();

    await callTool(server, 'search', { query: 'find notes about cooking recipes' });

    expect(controller.activeCategories.size).toBe(0);
    expect((server as any)._registeredTools.graph.enabled).toBe(false);
    expect((server as any)._registeredTools.schema.enabled).toBe(false);
  });

  it('memory(action: brief) focus param triggers activation', async () => {
    const { server, controller } = createTieredServer();

    await callTool(server, 'memory', { action: 'brief', focus: 'review backlinks and connections' });

    expect(controller.activeCategories.has('graph')).toBe(true);
  });

  it('multiple signals in one query unlock multiple categories', async () => {
    const { server, controller } = createTieredServer();

    await callTool(server, 'search', { query: 'check backlinks and wikilinks for stale notes' });

    expect(controller.activeCategories.has('graph')).toBe(true);
    expect(controller.activeCategories.has('wikilinks')).toBe(true);
    expect(controller.activeCategories.has('temporal')).toBe(true);
  });

  it('backlinks signal does not unlock schema/note-ops categories', async () => {
    const { server, controller } = createTieredServer();

    await callTool(server, 'search', { query: 'show me backlinks and connections' });

    expect(controller.activeCategories.has('graph')).toBe(true);
    // schema (tier 2+, needs schema-specific signal) and note-ops should stay locked
    expect(controller.activeCategories.has('schema')).toBe(false);
    expect(controller.activeCategories.has('note-ops')).toBe(false);
    expect((server as any)._registeredTools.schema.enabled).toBe(false);
  });

  it('non-search/brief tool calls do not trigger activation signals', async () => {
    const { server, controller } = createTieredServer();

    // Direct-call graph — it auto-enables its own category,
    // but should NOT parse its params for activation of other categories
    await callTool(server, 'graph', { query: 'wikilinks and schema' });

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
    expect(tools.graph.enabled).toBe(false);
  });

  it('full override enables all tools regardless of activation state', () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    controller.setOverride('full');

    expect(tools.search.enabled).toBe(true);
    expect(tools.graph.enabled).toBe(true);
    expect(tools.schema.enabled).toBe(true);
    expect(tools.doctor.enabled).toBe(true);
    expect(tools.entity.enabled).toBe(true);
  });

  it('direct call to higher-tier tool in minimal mode returns error', async () => {
    const { server, controller } = createTieredServer();

    controller.setOverride('minimal');

    // Minimal mode blocks even direct calls
    const result = await callTool(server, 'schema');

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('disabled');
  });

  it('switching from full back to auto re-applies tier restrictions', () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    controller.setOverride('full');
    expect(tools.graph.enabled).toBe(true);

    controller.setOverride('auto');
    expect(tools.graph.enabled).toBe(false);
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
    serverA.tool('graph', async () => ({
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
    serverB.tool('graph', async () => ({
      content: [{ type: 'text' as const, text: 'b' }],
    }));
    controllerB.finalizeRegistration();

    // Unlock graph on vault A
    controllerA.enableTierCategory('graph');

    // Vault A: graph enabled
    expect((serverA as any)._registeredTools.graph.enabled).toBe(true);
    expect(controllerA.activeCategories.has('graph')).toBe(true);

    // Vault B: graph still disabled
    expect((serverB as any)._registeredTools.graph.enabled).toBe(false);
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
    expect(tools.graph.enabled).toBe(false);

    // Regex-based activation should still enable categories
    controller.activateCategory('graph', 2);
    expect(tools.graph.enabled).toBe(true);

    delete process.env.FLYWHEEL_TOOL_ROUTING;
  });

  it('FLYWHEEL_TOOL_ROUTING defaults to hybrid when tiered', async () => {
    delete process.env.FLYWHEEL_TOOL_ROUTING;
    const { getToolRoutingMode } = await import('../src/core/read/toolRouting.js');
    expect(getToolRoutingMode(true)).toBe('hybrid');
  });

  it('FLYWHEEL_TOOL_ROUTING defaults to pattern when not full toolset', async () => {
    delete process.env.FLYWHEEL_TOOL_ROUTING;
    const { getToolRoutingMode } = await import('../src/core/read/toolRouting.js');
    expect(getToolRoutingMode(false)).toBe('pattern');
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
    expect(tools.graph.enabled).toBe(false);

    // Query 1: activate graph
    await callTool(server, 'search', { query: 'show me backlinks and connections' });
    expect(controller.activeCategories.has('graph')).toBe(true);
    expect(tools.graph.enabled).toBe(true);

    // Query 2: unrelated search
    await callTool(server, 'search', { query: 'cooking recipes for dinner' });

    // Graph should still be active — categories never deactivate
    expect(controller.activeCategories.has('graph')).toBe(true);
    expect(tools.graph.enabled).toBe(true);

    // Query 3: another unrelated search
    await callTool(server, 'search', { query: 'project status update' });

    // Still active
    expect(controller.activeCategories.has('graph')).toBe(true);
    expect(tools.graph.enabled).toBe(true);
  });

  it('sequential queries accumulate categories without conflict', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    // Step 1: activate graph
    await callTool(server, 'search', { query: 'show me backlinks' });
    expect(controller.activeCategories.has('graph')).toBe(true);
    expect(tools.graph.enabled).toBe(true);

    // Step 2: activate temporal
    await callTool(server, 'search', { query: 'show me the timeline and history' });
    expect(controller.activeCategories.has('temporal')).toBe(true);
    expect(tools.insights.enabled).toBe(true);

    // Step 3: activate schema
    await callTool(server, 'search', { query: 'what does the schema look like' });
    expect(controller.activeCategories.has('schema')).toBe(true);
    expect(tools.schema.enabled).toBe(true);

    // All three should coexist
    expect(controller.activeCategories.has('graph')).toBe(true);
    expect(controller.activeCategories.has('temporal')).toBe(true);
    expect(controller.activeCategories.has('schema')).toBe(true);
    expect(tools.graph.enabled).toBe(true);
    expect(tools.insights.enabled).toBe(true);
    expect(tools.schema.enabled).toBe(true);
  });

  it('direct tool call persists — subsequent calls succeed without re-activation', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    // Direct call to hidden tool — should auto-enable
    const result1 = await callTool(server, 'graph');
    expect(result1.isError).not.toBe(true);
    expect(tools.graph.enabled).toBe(true);

    // Second call should work without any new activation
    const result2 = await callTool(server, 'graph');
    expect(result2.isError).not.toBe(true);
    expect(tools.graph.enabled).toBe(true);
  });

  it('override mode persists across calls', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    controller.setOverride('full');
    expect(tools.graph.enabled).toBe(true);
    expect(tools.schema.enabled).toBe(true);

    // Multiple calls don't reset the override
    await callTool(server, 'search', { query: 'simple search' });
    await callTool(server, 'search', { query: 'another search' });

    expect(controller.getOverride()).toBe('full');
    expect(tools.graph.enabled).toBe(true);
    expect(tools.schema.enabled).toBe(true);
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
    expect(initialNames).not.toContain('graph');

    // Activate graph
    controller.activateCategory('graph', 2);

    const updatedList = await listHandler({ method: 'tools/list' }, {});
    const updatedNames = updatedList.tools.map((t: { name: string }) => t.name);

    // Now graph should appear
    expect(updatedNames).toContain('graph');
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
    expect(tools.graph.enabled).toBe(false);
    expect(tools.link.enabled).toBe(false);
    expect(tools.schema.enabled).toBe(false);
  });

  it.each([
    { query: 'BACKLINKS', category: 'graph', tool: 'graph' },
    { query: 'Schema', category: 'schema', tool: 'schema' },
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
    expect(instructions).toContain('discover_tools');
    expect(instructions).toContain('specialized tools');
    expect(instructions).not.toContain('## Graph');
    expect(instructions).not.toContain('## Wikilinks');

    // Activate graph via search signal
    await callTool(server, 'search', { query: 'show backlinks' });
    expect(controller.activeCategories.has('graph')).toBe(true);
    expect(tools.graph.enabled).toBe(true);

    instructions = getInstructions();
    expect(instructions).toContain('## Graph');
    expect(instructions).not.toContain('Ask about graph connections, backlinks, hubs, clusters, or paths');

    // Activate wikilinks via search signal
    await callTool(server, 'search', { query: 'check wikilinks' });
    expect(controller.activeCategories.has('wikilinks')).toBe(true);
    expect(tools.link.enabled).toBe(true);

    instructions = getInstructions();
    expect(instructions).toContain('## Graph');
    expect(instructions).toContain('## Wikilinks');
    // Unified discover_tools hint still present for unactivated categories
    expect(instructions).toContain('discover_tools');
  });
});

// ============================================================================
// Full preset reachability
// ============================================================================

describe('full preset reachability', () => {
  it('tier metadata matches expected split', () => {
    const tiers = Object.values(TOOL_TIER);
    expect(tiers.filter(t => t === 1).length).toBe(TIER_1_TOOL_COUNT);
    expect(tiers.filter(t => t === 2).length).toBe(TIER_2_TOOL_COUNT);
    expect(tiers.filter(t => t === 3).length).toBe(TIER_3_TOOL_COUNT);
    expect(Object.keys(TOOL_CATEGORY).length).toBe(TOTAL_TOOL_COUNT);
  });

  it('full helper registers every declared tool', () => {
    const { controller } = createFullPresetServer();
    expect(controller.getRegisteredTools().size).toBe(Object.keys(TOOL_CATEGORY).length);
    expect(controller.registered).toBe(Object.keys(TOOL_CATEGORY).length);
  });

  it('pure tiered/auto mode initially lists only tier-1 tools', async () => {
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

  it('startup full override exposes the full catalog immediately', async () => {
    const { server } = createFullPresetServer({ startupOverride: 'full' });
    const names = await listToolNames(server);

    expect(names).toEqual(new Set(Object.keys(TOOL_CATEGORY)));
  });
});

// ============================================================================
// Non-Claude client simulation (listTools-only discovery)
// ============================================================================

describe('non-Claude client simulation (listTools-only discovery)', () => {
  it('graph (tier-2) is absent from listTools() in tiered/auto mode', async () => {
    const { server } = createFullPresetServer();
    const names = await listToolNames(server);

    // doctor is tier-1 (visible); graph is tier-2 (hidden until activated)
    expect(names).toContain('doctor');
    expect(names).not.toContain('graph');
  });

  it('graph appears in listTools() after setOverride(\'full\')', async () => {
    const { server, controller } = createFullPresetServer();

    controller.setOverride('full');

    const names = await listToolNames(server);
    expect(names).toContain('doctor');
    expect(names).toContain('graph');
  });

  it('lists exactly tier-1 tools in tiered/auto mode', async () => {
    const { server } = createFullPresetServer();
    const names = await listToolNames(server);

    expect(names.size).toBe(TIER_1_TOOL_COUNT);
  });

  it('lists all tools after setOverride(\'full\')', async () => {
    const { server, controller } = createFullPresetServer();

    controller.setOverride('full');

    const names = await listToolNames(server);
    expect(names.size).toBe(Object.keys(TOOL_CATEGORY).length);
  });

  it('full preset startup exposes all tools to listTools()-only clients', async () => {
    const { server } = createFullPresetServer({ startupOverride: 'full' });
    const names = await listToolNames(server);

    expect(names).toContain('doctor');
    expect(names).toContain('graph');
    expect(names.size).toBe(Object.keys(TOOL_CATEGORY).length);
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
  server.tool('memory', { action: z.string().optional(), focus: z.string().optional() }, async () => ({
    content: [{ type: 'text' as const, text: 'memory ok' }],
  }));
  server.tool('graph', async () => ({
    content: [{ type: 'text' as const, text: 'graph ok' }],
  }));
  server.tool('schema', async () => ({
    content: [{ type: 'text' as const, text: 'schema ok' }],
  }));
  server.tool('doctor', async () => ({
    content: [{ type: 'text' as const, text: 'pipeline ok' }],
  }));
  server.tool('entity', async () => ({
    content: [{ type: 'text' as const, text: 'merge ok' }],
  }));
  server.tool('link', async () => ({
    content: [{ type: 'text' as const, text: 'wikilinks ok' }],
  }));
  server.tool('correct', async () => ({
    content: [{ type: 'text' as const, text: 'correction ok' }],
  }));
  server.tool('insights', async () => ({
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
// T18 — session behaviour (progressive disclosure)
// ============================================================================

describe('T18 — session behaviour (progressive disclosure)', () => {
  it('keeps activated graph tools visible across unrelated follow-up searches', async () => {
    const { server } = createTieredServer();

    await callTool(server, 'search', { query: 'show me backlinks' });
    let names = await listToolNames(server);
    expect(names).toContain('graph');
    expect(names).toContain('search');

    await callTool(server, 'search', { query: 'cooking recipes' });
    names = await listToolNames(server);
    expect(names).toContain('graph');
  });

  it('accumulates graph, schema, and wikilinks tools across sequential activations', async () => {
    const { server } = createTieredServer();

    await callTool(server, 'search', { query: 'backlinks' });
    await callTool(server, 'search', { query: 'schema' });
    await callTool(server, 'search', { query: 'wikilinks' });

    const names = await listToolNames(server);
    expect(names).toContain('graph');
    expect(names).toContain('schema');
    expect(names).toContain('link');
  });

  it('listTools() count grows monotonically as categories activate', async () => {
    const { server } = createTieredServer();

    const counts: number[] = [];

    counts.push((await listToolNames(server)).size);
    await callTool(server, 'search', { query: 'backlinks' });
    counts.push((await listToolNames(server)).size);
    await callTool(server, 'search', { query: 'schema' });
    counts.push((await listToolNames(server)).size);
    await callTool(server, 'search', { query: 'wikilinks' });
    counts.push((await listToolNames(server)).size);

    expect(counts).toEqual([
      counts[0],
      counts[0] + 1,
      counts[0] + 2,
      counts[0] + 3,
    ]);
  });

  it('generateInstructions() and listTools() stay aligned after activation', async () => {
    const { server, controller } = createTieredServer();

    await callTool(server, 'search', { query: 'backlinks and wikilinks' });

    const instructions = generateInstructions(new Set(ALL_CATEGORIES), null, controller.activeCategories);
    const names = await listToolNames(server);

    expect(instructions).toContain('## Graph');
    expect(instructions).toContain('## Wikilinks');
    expect(instructions).not.toContain('## Schema');
    expect(names).toContain('graph');
    expect(names).toContain('link');
    expect(names).not.toContain('schema');
  });
});

// ============================================================================
// MCP protocol-level listTools tests
// ============================================================================

describe('MCP protocol-level tools/list behaviour', () => {
  it('all visible tools expose object JSON Schema in full mode', async () => {
    const { server } = createFullPresetServer({ startupOverride: 'full' });
    const result = await listTools(server);

    expect(result.tools).toHaveLength(Object.keys(TOOL_CATEGORY).length);
    for (const tool of result.tools) {
      expect(tool.inputSchema?.type, `${tool.name} should expose object schema`).toBe('object');
    }
  });

  it('tools/list contains no duplicate tool names', async () => {
    const { server } = createFullPresetServer({ startupOverride: 'full' });
    const result = await listTools(server);
    const names = result.tools.map(tool => tool.name);

    expect(new Set(names).size).toBe(names.length);
  });

  it('tools/list payload stays within a reasonable size budget', async () => {
    const { server } = createFullPresetServer({ startupOverride: 'full' });
    const result = await listTools(server);
    const payloadSize = JSON.stringify(result).length;

    expect(payloadSize).toBeGreaterThan(0);
    expect(payloadSize).toBeLessThan(100_000);
  });

  it('tools/list ordering is deterministic across repeated calls', async () => {
    const { server } = createFullPresetServer({ startupOverride: 'full' });

    const first = await listTools(server);
    const second = await listTools(server);

    expect(second.tools.map(tool => tool.name)).toEqual(first.tools.map(tool => tool.name));
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
    expect(tools.schema.enabled).toBe(true);

    controller.setOverride('auto');
    expect(tools.graph.enabled).toBe(true);
    expect(tools.schema.enabled).toBe(false);
  });

  it('signals during full do not leak into auto mode', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    controller.setOverride('full');

    await callTool(server, 'search', { query: 'schema backlinks' });

    controller.setOverride('auto');

    expect(tools.graph.enabled).toBe(false);
    expect(tools.schema.enabled).toBe(false);
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

    const result = await callTool(server, 'graph');

    expect(result.isError).toBe(true);
    expect(controller.getActivatedCategoryTiers().has('graph')).toBe(true);
    expect(tools.graph.enabled).toBe(false);
  });

  it('switching from minimal to auto reveals categories activated during minimal', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    controller.setOverride('minimal');
    await callTool(server, 'graph');
    expect(tools.graph.enabled).toBe(false);

    controller.setOverride('auto');
    expect(tools.graph.enabled).toBe(true);
  });

  it('search signal in minimal records activation for later auto restore', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    controller.setOverride('minimal');

    await callTool(server, 'search', { query: 'show backlinks' });

    expect(controller.getActivatedCategoryTiers().has('graph')).toBe(true);
    expect(tools.graph.enabled).toBe(false);

    controller.setOverride('auto');
    expect(tools.graph.enabled).toBe(true);
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
    expect(tools.graph.enabled).toBe(true);
    expect(tools.schema.enabled).toBe(true);
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
    expect(tools.graph.enabled).toBe(true);
  });

  it('calling finalizeRegistration twice does not throw or break tools', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    expect(() => controller.finalizeRegistration()).not.toThrow();

    await callTool(server, 'search', { query: 'show backlinks' });
    expect(controller.activeCategories.has('graph')).toBe(true);

    const result = await callTool(server, 'graph');
    expect(result.isError).not.toBe(true);
    expect(tools.graph.enabled).toBe(true);
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
    expect(tools.schema.enabled).toBe(true);

    controller.setOverride('auto');
    expect(tools.graph.enabled).toBe(true);
    expect(tools.schema.enabled).toBe(false);
  });

  it('signals during full do not leak into auto mode', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    controller.setOverride('full');

    await callTool(server, 'search', { query: 'schema backlinks' });

    controller.setOverride('auto');

    expect(tools.graph.enabled).toBe(false);
    expect(tools.schema.enabled).toBe(false);
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

    const result = await callTool(server, 'graph');

    expect(result.isError).toBe(true);
    expect(controller.getActivatedCategoryTiers().has('graph')).toBe(true);
    expect(tools.graph.enabled).toBe(false);
  });

  it('switching from minimal to auto reveals categories activated during minimal', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    controller.setOverride('minimal');
    await callTool(server, 'graph');
    expect(tools.graph.enabled).toBe(false);

    controller.setOverride('auto');
    expect(tools.graph.enabled).toBe(true);
  });

  it('search signal in minimal records activation for later auto restore', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    controller.setOverride('minimal');

    await callTool(server, 'search', { query: 'show backlinks' });

    expect(controller.getActivatedCategoryTiers().has('graph')).toBe(true);
    expect(tools.graph.enabled).toBe(false);

    controller.setOverride('auto');
    expect(tools.graph.enabled).toBe(true);
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
    expect(tools.graph.enabled).toBe(true);
    expect(tools.schema.enabled).toBe(true);
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
    expect(tools.graph.enabled).toBe(true);
  });

  it('calling finalizeRegistration twice does not throw or break tools', async () => {
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    expect(() => controller.finalizeRegistration()).not.toThrow();

    await callTool(server, 'search', { query: 'show backlinks' });
    expect(controller.activeCategories.has('graph')).toBe(true);

    const result = await callTool(server, 'graph');
    expect(result.isError).not.toBe(true);
    expect(tools.graph.enabled).toBe(true);
  });
});

// ============================================================================
// T30 — Startup tier override policy
// ============================================================================

describe('startup tier override policy', () => {
  it('INITIAL_TIER_OVERRIDE is auto, not full', () => {
    // Regression guard: the bug was `preset === 'full' ? 'full' : 'auto'`
    // which bypassed all tier filtering for the default preset.
    expect(INITIAL_TIER_OVERRIDE).toBe('auto');
  });
});

// ============================================================================
// index.ts initialization simulation (d42835a regression guard)
// ============================================================================

/**
 * Simulate index.ts primary server initialization using real config constants.
 * Mirrors the composition at index.ts lines 198–345 without importing the module.
 *
 * If you change the startup wiring in index.ts, update this helper to match.
 * The point is to catch composition bugs — if this drifts from index.ts,
 * it stops being a useful regression guard.
 */
function createServerLikeIndexTs(envOverride?: string) {
  const toolConfig = resolveToolConfig(envOverride);
  const enabledCategories = toolConfig.categories;
  const toolTierMode: ToolTierMode = toolConfig.enableProgressiveDisclosure ? 'tiered' : 'off';
  const runtimeToolTierOverride: ToolTierOverride = INITIAL_TIER_OVERRIDE;

  const server = new McpServer({ name: 'init-sim', version: '0.0.0' });
  const controller = applyToolGating(
    server,
    enabledCategories,
    () => null,
    null,
    undefined,
    undefined,
    toolTierMode,
  );

  for (const toolName of Object.keys(TOOL_CATEGORY)) {
    // disclosure-only tools only registered in tiered mode
    if (DISCLOSURE_ONLY_TOOLS.has(toolName) && toolTierMode !== 'tiered') continue;
    if (toolName === 'search') {
      server.tool(toolName, { query: z.string().optional(), focus: z.string().optional() }, async () => ({
        content: [{ type: 'text' as const, text: `${toolName} ok` }],
      }));
    } else if (toolName === 'memory') {
      server.tool(toolName, { action: z.string().optional(), focus: z.string().optional() }, async () => ({
        content: [{ type: 'text' as const, text: `${toolName} ok` }],
      }));
    } else {
      server.tool(toolName, async () => ({
        content: [{ type: 'text' as const, text: `${toolName} ok` }],
      }));
    }
  }

  controller.setOverride(runtimeToolTierOverride);
  controller.finalizeRegistration();

  return { server, controller, toolConfig, toolTierMode, runtimeToolTierOverride };
}

/**
 * Simulate createConfiguredServer() HTTP pool path (index.ts lines 254–277).
 * Takes runtime state that would be inherited from the primary server.
 *
 * Keep in sync with createConfiguredServer() in index.ts — same wiring,
 * same order. Drift here weakens the regression guard.
 */
function createHttpPoolServerSim(
  runtimeOverride: ToolTierOverride = INITIAL_TIER_OVERRIDE,
  runtimeActiveTiers: Map<ToolCategory, ToolTier> = new Map(),
  envOverride?: string,
) {
  const toolConfig = resolveToolConfig(envOverride);
  const enabledCategories = toolConfig.categories;
  const toolTierMode: ToolTierMode = toolConfig.enableProgressiveDisclosure ? 'tiered' : 'off';

  const server = new McpServer({ name: 'http-pool-sim', version: '0.0.0' });
  const controller = applyToolGating(
    server,
    enabledCategories,
    () => null,
    null,
    undefined,
    undefined,
    toolTierMode,
  );

  for (const toolName of Object.keys(TOOL_CATEGORY)) {
    if (DISCLOSURE_ONLY_TOOLS.has(toolName) && toolTierMode !== 'tiered') continue;
    if (toolName === 'search') {
      server.tool(toolName, { query: z.string().optional(), focus: z.string().optional() }, async () => ({
        content: [{ type: 'text' as const, text: `${toolName} ok` }],
      }));
    } else if (toolName === 'memory') {
      server.tool(toolName, { action: z.string().optional(), focus: z.string().optional() }, async () => ({
        content: [{ type: 'text' as const, text: `${toolName} ok` }],
      }));
    } else {
      server.tool(toolName, async () => ({
        content: [{ type: 'text' as const, text: `${toolName} ok` }],
      }));
    }
  }

  controller.setOverride(runtimeOverride);
  for (const [category, tier] of runtimeActiveTiers) {
    controller.activateCategory(category, tier);
  }
  controller.finalizeRegistration();

  return { server, controller };
}

describe('index.ts initialization simulation (d42835a regression guard)', () => {
  it('default resolveToolConfig() yields agent preset, no progressive disclosure', () => {
    vi.stubEnv('FLYWHEEL_TOOLS', '');
    vi.stubEnv('FLYWHEEL_PRESET', '');

    try {
      const config = resolveToolConfig();
      expect(config.isFullToolset).toBe(false);
      expect(config.preset).toBe('agent');
      expect(config.enableProgressiveDisclosure).toBe(false);
      expect(config.categories.size).toBe(PRESETS.agent.length);

      const tierMode: ToolTierMode = config.enableProgressiveDisclosure ? 'tiered' : 'off';
      expect(tierMode).toBe('off');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('auto preset yields isFullToolset=true with progressive disclosure', () => {
    const config = resolveToolConfig('auto');
    expect(config.isFullToolset).toBe(true);
    expect(config.enableProgressiveDisclosure).toBe(true);
    expect(config.categories.size).toBe(ALL_CATEGORIES.length);
  });

  it('primary server simulation lists agent-category tools (default)', async () => {
    vi.stubEnv('FLYWHEEL_TOOLS', '');
    vi.stubEnv('FLYWHEEL_PRESET', '');

    try {
      const { server, toolTierMode } = createServerLikeIndexTs();

      // agent preset: no disclosure, only agent categories visible
      expect(toolTierMode).toBe('off');

      const names = await listToolNames(server);
      const agentCategories = new Set(PRESETS.agent);
      const expectedAgent = new Set(
        Object.keys(TOOL_CATEGORY).filter(n => agentCategories.has(TOOL_CATEGORY[n] as ToolCategory) && !DISCLOSURE_ONLY_TOOLS.has(n)),
      );
      expect(names).toEqual(expectedAgent);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('auto preset simulation lists tier-1 tools plus discover_tools', async () => {
    const { server, toolTierMode } = createServerLikeIndexTs('auto');

    expect(toolTierMode).toBe('tiered');

    const names = await listToolNames(server);
    expect(names).toContain('discover_tools');
    expect(names).toContain('search');
    expect(names).toContain('doctor'); // doctor is tier-1 (visible in tiered mode)
    expect(names.size).toBe(TIER_1_TOOL_COUNT);
  });

  it('HTTP pool server simulation with default (agent) preset lists agent tools', async () => {
    vi.stubEnv('FLYWHEEL_TOOLS', '');
    vi.stubEnv('FLYWHEEL_PRESET', '');

    try {
      const { server } = createHttpPoolServerSim(INITIAL_TIER_OVERRIDE);
      const names = await listToolNames(server);
      const agentCategories = new Set(PRESETS.agent);
      const expectedAgent = new Set(
        Object.keys(TOOL_CATEGORY).filter(n => agentCategories.has(TOOL_CATEGORY[n] as ToolCategory) && !DISCLOSURE_ONLY_TOOLS.has(n)),
      );
      expect(names).toEqual(expectedAgent);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('HTTP pool server simulation preserves activated categories (auto preset)', async () => {
    const activatedTiers = new Map<ToolCategory, ToolTier>([['graph', 2]]);
    const { server } = createHttpPoolServerSim(INITIAL_TIER_OVERRIDE, activatedTiers, 'auto');

    const names = await listToolNames(server);

    const graphTier2Count = Object.entries(TOOL_TIER)
      .filter(([name, tier]) => tier === 2 && TOOL_CATEGORY[name] === 'graph')
      .length;
    expect(names.size).toBe(TIER_1_TOOL_COUNT + graphTier2Count);
    expect(names).toContain('graph');
    expect(names).toContain('search');
    expect(names).toContain('discover_tools');
  });

  it('agent preset yields off mode with no progressive disclosure', async () => {
    const { server, toolTierMode } = createServerLikeIndexTs('agent');

    expect(toolTierMode).toBe('off');

    const names = await listToolNames(server);
    // Agent preset: all tools from agent categories, minus disclosure-only tools
    const agentToolCount = Object.entries(TOOL_CATEGORY)
      .filter(([name, cat]) => PRESETS.agent.includes(cat as ToolCategory) && !DISCLOSURE_ONLY_TOOLS.has(name))
      .length;
    expect(names.size).toBe(agentToolCount);
    expect(names).not.toContain('discover_tools');
  });
});

// ============================================================================
// discover_tools meta-tool
// ============================================================================

/** Create a tiered server with the real discover_tools handler + stubs for everything else. */
function createServerWithDiscovery() {
  const server = new McpServer({ name: 'discovery-test', version: '0.0.0' });
  const controller = applyToolGating(
    server,
    new Set(ALL_CATEGORIES),
    () => null,
    null,
    undefined,
    undefined,
    'tiered',
  );

  // Register stub tools for everything except discover_tools
  for (const toolName of Object.keys(TOOL_CATEGORY)) {
    if (toolName === 'discover_tools') continue;
    if (toolName === 'search') {
      server.tool(toolName, { query: z.string().optional(), focus: z.string().optional() }, async () => ({
        content: [{ type: 'text' as const, text: `${toolName} ok` }],
      }));
    } else if (toolName === 'memory') {
      server.tool(toolName, { action: z.string().optional(), focus: z.string().optional() }, async () => ({
        content: [{ type: 'text' as const, text: `${toolName} ok` }],
      }));
    } else {
      server.tool(toolName, async () => ({
        content: [{ type: 'text' as const, text: `${toolName} ok` }],
      }));
    }
  }

  // Register real discover_tools handler
  registerDiscoveryTools(server, controller);

  controller.finalizeRegistration();
  return { server, controller };
}

describe('discover_tools meta-tool', () => {
  it('activates diagnostics and returns tools with schemas for "vault health"', async () => {
    const { server, controller } = createServerWithDiscovery();

    expect(controller.activeCategories.has('diagnostics')).toBe(false);

    const result = await callTool(server, 'discover_tools', { query: 'vault health' });
    const data = JSON.parse(result.content[0].text);

    expect(data.matched_categories).toContain('diagnostics');
    expect(data.newly_activated_categories).toContain('diagnostics');
    expect(data.tools.some((t: any) => t.name === 'doctor')).toBe(true);
    // Input schemas are included
    expect(data.tools.find((t: any) => t.name === 'doctor').inputSchema).toBeDefined();
    expect(controller.activeCategories.has('diagnostics')).toBe(true);
  });

  it('activates graph for "backlinks" query', async () => {
    const { server, controller } = createServerWithDiscovery();

    const result = await callTool(server, 'discover_tools', { query: 'backlinks and connections' });
    const data = JSON.parse(result.content[0].text);

    expect(data.matched_categories).toContain('graph');
    expect(data.tools.some((t: any) => t.name === 'graph')).toBe(true);
    expect(controller.activeCategories.has('graph')).toBe(true);
  });

  it('returns no tools and hints for unrecognized query', async () => {
    const { server, controller } = createServerWithDiscovery();

    const result = await callTool(server, 'discover_tools', { query: 'xyzzy nonsense query' });
    const data = JSON.parse(result.content[0].text);

    expect(data.matched_categories).toHaveLength(0);
    expect(data.newly_activated_categories).toHaveLength(0);
    expect(data.tools).toHaveLength(0);
    expect(data.hint).toContain('No tools matched');
    expect(data.hint).toContain('Available categories');
    expect(controller.activeCategories.size).toBe(0);
  });

  it('returns tools without re-activating already-active category', async () => {
    const { server, controller } = createServerWithDiscovery();

    // Pre-activate graph
    controller.activateCategory('graph', 2);
    expect(controller.activeCategories.has('graph')).toBe(true);

    const result = await callTool(server, 'discover_tools', { query: 'backlinks' });
    const data = JSON.parse(result.content[0].text);

    expect(data.matched_categories).toContain('graph');
    expect(data.newly_activated_categories).not.toContain('graph');
    // Tools are still returned even though category was already active
    expect(data.tools.some((t: any) => t.name === 'graph')).toBe(true);
  });
});

// ============================================================================
// T30 — Notification batching
// ============================================================================

describe('notification batching in refreshToolVisibility', () => {
  it('emits exactly one sendToolListChanged when activating a multi-tool category', () => {
    const { server, controller } = createFullPresetServer();

    // Attach spy AFTER createFullPresetServer() returns (registration-time notifications already fired)
    const spy = vi.spyOn(server, 'sendToolListChanged');

    // Use 'read' category which has multiple tier-2 tools (note_read, find_notes)
    controller.enableTierCategory('read');

    // Multiple read tools should now be enabled
    const readTier2Tools = Object.entries(TOOL_TIER)
      .filter(([name, tier]) => tier === 2 && TOOL_CATEGORY[name] === 'read')
      .map(([name]) => name);
    expect(readTier2Tools.length).toBeGreaterThan(1);
    for (const name of readTier2Tools) {
      expect((server as any)._registeredTools[name]?.enabled).toBe(true);
    }

    // But only one notification should have been sent
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not emit sendToolListChanged when no tools change state', () => {
    const { server, controller } = createFullPresetServer();

    // Activate graph first
    controller.enableTierCategory('graph');

    const spy = vi.spyOn(server, 'sendToolListChanged');

    // Activating graph again should not change any tool state
    controller.enableTierCategory('graph');
    expect(spy).not.toHaveBeenCalled();
  });
});
