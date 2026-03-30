/**
 * Tool Set Composition Tests (T17)
 *
 * Proves that every preset, bundle, and FLYWHEEL_TOOLS configuration resolves
 * to the correct tool set through the full pipeline:
 *   env string → resolveToolConfig → applyToolGating → registerAllTools → tools/list
 *
 * Tiering *mechanics* (activation signals, override state transitions, session
 * persistence) live in tool-tiering.test.ts. This file is strictly about
 * configuration parsing and set composition.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  ALL_CATEGORIES,
  PRESETS,
  TOOL_CATEGORY,
  TOOL_TIER,
  resolveToolConfig,
  type ToolCategory,
  type ToolTier,
} from '../src/config.js';
import {
  applyToolGating,
  registerAllTools,
  type ToolRegistryContext,
  type ToolTierController,
} from '../src/tool-registry.js';

// ============================================================================
// Helpers
// ============================================================================

/** Inert context safe for registration — handlers are never invoked. */
function createStubRegistryContext(): ToolRegistryContext {
  return {
    getVaultPath: () => '/fake/vault',
    getVaultIndex: () => null as any,
    getStateDb: () => null,
    getFlywheelConfig: () => ({} as any),
    getWatcherStatus: () => null,
    getPipelineActivity: () => null,
    updateVaultIndex: () => {},
    updateFlywheelConfig: () => {},
  };
}

type TierMode = 'off' | 'tiered';

/** Build a gated server using the real registerAllTools pipeline. */
function createServerForConfig(
  envValue?: string,
  tierMode: TierMode = 'off',
) {
  const resolved = resolveToolConfig(envValue);
  const server = new McpServer({ name: 'tool-set-test', version: '0.0.0' });
  const controller = applyToolGating(
    server,
    resolved.categories,
    () => null,
    null,
    undefined,
    undefined,
    tierMode,
  );
  registerAllTools(server, createStubRegistryContext());
  controller.finalizeRegistration();
  return { server, controller, resolved };
}

/** Build a gated server from an explicit category set. */
function createServerForCategories(
  categories: Set<ToolCategory>,
  tierMode: TierMode = 'off',
) {
  const server = new McpServer({ name: 'tool-set-test', version: '0.0.0' });
  const controller = applyToolGating(
    server,
    categories,
    () => null,
    null,
    undefined,
    undefined,
    tierMode,
  );
  registerAllTools(server, createStubRegistryContext());
  controller.finalizeRegistration();
  return { server, controller };
}

/** Derive expected tool names for a set of categories from TOOL_CATEGORY. */
function expectedToolsForCategories(categories: Set<ToolCategory>): Set<string> {
  return new Set(
    Object.entries(TOOL_CATEGORY)
      .filter(([, cat]) => categories.has(cat as ToolCategory))
      .map(([name]) => name),
  );
}

/** Derive expected visible tools for a tiered server (tier-1 only from enabled categories). */
function expectedTierVisibleTools(
  categories: Set<ToolCategory>,
  override: 'auto' | 'full' | 'minimal',
  activatedCategories: Set<ToolCategory> = new Set(),
): Set<string> {
  if (override === 'full') return expectedToolsForCategories(categories);
  if (override === 'minimal') {
    // Only tier-1 tools from enabled categories
    return new Set(
      Object.entries(TOOL_CATEGORY)
        .filter(([name, cat]) =>
          categories.has(cat as ToolCategory) && TOOL_TIER[name] === 1,
        )
        .map(([name]) => name),
    );
  }
  // auto: tier-1 always + activated category tools
  return new Set(
    Object.entries(TOOL_CATEGORY)
      .filter(([name, cat]) => {
        if (!categories.has(cat as ToolCategory)) return false;
        const tier = TOOL_TIER[name] as ToolTier;
        if (tier === 1) return true;
        const catTier = activatedCategories.has(cat as ToolCategory);
        return catTier;
      })
      .map(([name]) => name),
  );
}

/** List tool names via the MCP tools/list handler. */
async function listToolNames(server: McpServer): Promise<Set<string>> {
  const handler = (server as any).server._requestHandlers.get('tools/list');
  const result = await handler({ method: 'tools/list' }, {});
  return new Set(result.tools.map((t: { name: string }) => t.name));
}

/** Total declared tools. */
const TOTAL_TOOLS = Object.keys(TOOL_CATEGORY).length;

// ============================================================================
// resolveToolConfig() unit tests
// ============================================================================

describe('resolveToolConfig()', () => {
  beforeEach(() => {
    delete process.env.FLYWHEEL_TOOLS;
    delete process.env.FLYWHEEL_PRESET;
  });

  it.each([
    {
      label: 'undefined → full preset',
      input: undefined,
      preset: 'full',
      isFullToolset: true,
      categoryCount: ALL_CATEGORIES.length,
    },
    {
      label: '"full" → full preset',
      input: 'full',
      preset: 'full',
      isFullToolset: true,
      categoryCount: ALL_CATEGORIES.length,
    },
    {
      label: '"agent" → agent preset',
      input: 'agent',
      preset: 'agent',
      isFullToolset: false,
      categoryCount: PRESETS.agent.length,
    },
    {
      label: '"default" deprecated alias → full',
      input: 'default',
      preset: 'full',
      isFullToolset: true,
      categoryCount: ALL_CATEGORIES.length,
    },
    {
      label: '"minimal" deprecated alias → agent',
      input: 'minimal',
      preset: 'agent',
      isFullToolset: false,
      categoryCount: PRESETS.agent.length,
    },
    {
      label: '"AGENT" case-insensitive',
      input: 'AGENT',
      preset: 'agent',
      isFullToolset: false,
      categoryCount: PRESETS.agent.length,
    },
    {
      label: '" agent " whitespace trimmed',
      input: ' agent ',
      preset: 'agent',
      isFullToolset: false,
      categoryCount: PRESETS.agent.length,
    },
  ])('$label', ({ input, preset, isFullToolset, categoryCount }) => {
    const result = resolveToolConfig(input);
    expect(result.preset).toBe(preset);
    expect(result.isFullToolset).toBe(isFullToolset);
    expect(result.categories.size).toBe(categoryCount);
  });

  it('"agent,graph" → composite (preset=null, 6 categories)', () => {
    const result = resolveToolConfig('agent,graph');
    expect(result.preset).toBeNull();
    expect(result.isFullToolset).toBe(false);
    const expected = new Set([...PRESETS.agent, 'graph']);
    expect(result.categories).toEqual(expected);
  });

  it('"backlinks,health" deprecated aliases → {graph, diagnostics}', () => {
    const result = resolveToolConfig('backlinks,health');
    expect(result.categories).toEqual(new Set(['graph', 'diagnostics']));
    expect(result.preset).toBeNull();
  });

  it('"search,read,graph" fine-grained categories', () => {
    const result = resolveToolConfig('search,read,graph');
    expect(result.categories).toEqual(new Set(['search', 'read', 'graph']));
    expect(result.preset).toBeNull();
    expect(result.isFullToolset).toBe(false);
  });

  it('"garbage" unknown → fallback to full', () => {
    const result = resolveToolConfig('garbage');
    expect(result.categories.size).toBe(ALL_CATEGORIES.length);
  });

  it('"agent,backlinks" mixed deprecated + preset → agent cats + graph', () => {
    const result = resolveToolConfig('agent,backlinks');
    const expected = new Set([...PRESETS.agent, 'graph']);
    expect(result.categories).toEqual(expected);
  });
});

// ============================================================================
// Per-preset / per-bundle real registration
// ============================================================================

describe('per-preset tool registration via registerAllTools()', () => {
  const CATEGORY_COUNTS: Record<ToolCategory, number> = {} as any;
  for (const cat of ALL_CATEGORIES) {
    CATEGORY_COUNTS[cat] = Object.values(TOOL_CATEGORY).filter(c => c === cat).length;
  }

  it.each([
    { label: 'full', env: 'full', expected: TOTAL_TOOLS },
    { label: 'agent', env: 'agent', expected: 18 },
    { label: 'agent,graph', env: 'agent,graph', expected: 29 },
    { label: 'graph', env: 'graph', expected: 11 },
    { label: 'schema', env: 'schema', expected: 7 },
    { label: 'wikilinks', env: 'wikilinks', expected: 7 },
    { label: 'corrections', env: 'corrections', expected: 4 },
    { label: 'tasks', env: 'tasks', expected: 3 },
    { label: 'memory', env: 'memory', expected: 2 },
    { label: 'note-ops', env: 'note-ops', expected: 4 },
    { label: 'temporal', env: 'temporal', expected: 4 },
    { label: 'diagnostics', env: 'diagnostics', expected: 22 },
    { label: 'search', env: 'search', expected: 3 },
    { label: 'read', env: 'read', expected: 3 },
    { label: 'write', env: 'write', expected: 7 },
  ])('$label registers $expected tools', ({ env, expected }) => {
    const { controller } = createServerForConfig(env);

    expect(controller.registered).toBe(expected);
    expect(controller.skipped).toBe(TOTAL_TOOLS - expected);
    expect(controller.registered + controller.skipped).toBe(TOTAL_TOOLS);
  });

  it('registered count matches expectedToolsForCategories() for every config', () => {
    for (const presetName of ['full', 'agent'] as const) {
      const cats = new Set(PRESETS[presetName]);
      const { controller } = createServerForCategories(cats);
      expect(controller.registered).toBe(expectedToolsForCategories(cats).size);
    }
  });
});

// ============================================================================
// Per-bundle listTools() contract (tierMode: 'off')
// ============================================================================

describe('per-bundle listTools() contract', () => {
  it.each([
    'full', 'agent', 'graph', 'schema', 'wikilinks', 'corrections',
    'tasks', 'memory', 'note-ops', 'temporal', 'diagnostics',
    'search', 'read', 'write',
  ] as const)('%s: listTools returns exactly the expected tool names', async (env) => {
    const { server, resolved } = createServerForConfig(env);
    const names = await listToolNames(server);
    const expected = expectedToolsForCategories(resolved.categories);

    expect(names).toEqual(expected);
  });

  it.each([
    { label: 'agent,graph', env: 'agent,graph' },
    { label: 'search,read,graph', env: 'search,read,graph' },
    { label: 'agent,diagnostics', env: 'agent,diagnostics' },
  ])('$label: listTools returns the union of component categories', async ({ env }) => {
    const { server, resolved } = createServerForConfig(env);
    const names = await listToolNames(server);
    const expected = expectedToolsForCategories(resolved.categories);

    expect(names).toEqual(expected);
  });

  it('no tools from excluded categories leak through', async () => {
    const { server } = createServerForConfig('agent');
    const names = await listToolNames(server);
    const agentCategories = new Set(PRESETS.agent);

    for (const name of names) {
      const cat = TOOL_CATEGORY[name] as ToolCategory;
      expect(agentCategories.has(cat), `"${name}" (category: ${cat}) should not be in agent preset`).toBe(true);
    }
  });
});

// ============================================================================
// Category gating correctness (skipped = never registered)
// ============================================================================

describe('category gating correctness', () => {
  it('agent preset: _registeredTools contains no graph/schema/etc. keys', () => {
    const { server } = createServerForConfig('agent');
    const registered = (server as any)._registeredTools;
    const registeredNames = new Set(Object.keys(registered));

    // All registered tools must be in agent categories
    const agentCategories = new Set(PRESETS.agent);
    for (const name of registeredNames) {
      const cat = TOOL_CATEGORY[name] as ToolCategory;
      expect(agentCategories.has(cat), `"${name}" (${cat}) should not be registered in agent preset`).toBe(true);
    }

    // Spot-check: graph and schema tools absent
    expect(registeredNames.has('graph_analysis')).toBe(false);
    expect(registeredNames.has('vault_schema')).toBe(false);
    expect(registeredNames.has('suggest_wikilinks')).toBe(false);
    expect(registeredNames.has('health_check')).toBe(false);
  });

  it('full preset: all 77 tools present in _registeredTools', () => {
    const { server } = createServerForConfig('full');
    const registered = (server as any)._registeredTools;
    const registeredNames = new Set(Object.keys(registered));

    expect(registeredNames.size).toBe(TOTAL_TOOLS);
    for (const toolName of Object.keys(TOOL_CATEGORY)) {
      expect(registeredNames.has(toolName), `missing: ${toolName}`).toBe(true);
    }
  });

  it('single category (graph): only graph tools in _registeredTools', () => {
    const { server, controller } = createServerForConfig('graph');
    const registered = (server as any)._registeredTools;
    const registeredNames = new Set(Object.keys(registered));

    const expectedGraphTools = expectedToolsForCategories(new Set(['graph' as ToolCategory]));
    expect(registeredNames).toEqual(expectedGraphTools);
    expect(controller.registered).toBe(expectedGraphTools.size);
  });
});

// ============================================================================
// Tiered full preset — client visibility
// ============================================================================

describe('tiered full preset — client visibility', () => {
  it('initially exposes exactly the 18 tier-1 tools', async () => {
    const { server } = createServerForConfig('full', 'tiered');
    const names = await listToolNames(server);

    const tier1Tools = new Set(
      Object.entries(TOOL_TIER)
        .filter(([, tier]) => tier === 1)
        .map(([name]) => name),
    );
    expect(names).toEqual(tier1Tools);
    expect(names.size).toBe(18);
  });

  it('setOverride("full") exposes all 77 tools', async () => {
    const { server, controller } = createServerForConfig('full', 'tiered');

    controller.setOverride('full');

    const names = await listToolNames(server);
    expect(names.size).toBe(TOTAL_TOOLS);
    expect(names).toEqual(new Set(Object.keys(TOOL_CATEGORY)));
  });

  it('visible names match derived tier/category expectation exactly', async () => {
    const allCats = new Set(ALL_CATEGORIES);

    // auto mode, no activations → tier-1 only
    const { server: s1 } = createServerForConfig('full', 'tiered');
    const autoNames = await listToolNames(s1);
    expect(autoNames).toEqual(expectedTierVisibleTools(allCats, 'auto'));

    // full override → all tools
    const { server: s2, controller: c2 } = createServerForConfig('full', 'tiered');
    c2.setOverride('full');
    const fullNames = await listToolNames(s2);
    expect(fullNames).toEqual(expectedTierVisibleTools(allCats, 'full'));
  });
});

// ============================================================================
// Composition invariant — pairwise set union
// ============================================================================

describe('composition invariant', () => {
  it('for every pair of categories, A∪B server exposes exactly tools(A) ∪ tools(B)', async () => {
    // Use singleton category bundles for pairwise testing
    const singletonCategories = ALL_CATEGORIES.filter(c => c in PRESETS && PRESETS[c].length === 1);

    for (let i = 0; i < singletonCategories.length; i++) {
      for (let j = i + 1; j < singletonCategories.length; j++) {
        const catA = singletonCategories[i];
        const catB = singletonCategories[j];

        const { server: sAB } = createServerForCategories(
          new Set([catA, catB]),
        );
        const { server: sA } = createServerForCategories(new Set([catA]));
        const { server: sB } = createServerForCategories(new Set([catB]));

        const namesAB = await listToolNames(sAB);
        const namesA = await listToolNames(sA);
        const namesB = await listToolNames(sB);

        const union = new Set([...namesA, ...namesB]);
        expect(
          namesAB,
          `${catA}+${catB}: combined server should equal union of individual servers`,
        ).toEqual(union);
      }
    }
  });
});
