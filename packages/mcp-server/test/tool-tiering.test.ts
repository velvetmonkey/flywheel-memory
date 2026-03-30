import { describe, expect, it } from 'vitest';
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

  server.tool('search', async () => ({
    content: [{ type: 'text' as const, text: 'search ok' }],
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

  controller.finalizeRegistration();
  return { server, controller };
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
    const handler = (server as any).server._requestHandlers.get('tools/call');

    const result = await handler(
      {
        method: 'tools/call',
        params: {
          name: 'graph_analysis',
          arguments: {},
        },
      },
      {},
    );

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
// T14 Routing Mode Integration Tests
// ============================================================================

describe('tool routing mode integration', () => {
  it('pattern mode matches current T13 behavior (regex only)', () => {
    process.env.FLYWHEEL_TOOL_ROUTING = 'pattern';
    const { server, controller } = createTieredServer();
    const tools = (server as any)._registeredTools;

    // Register a search tool that returns a hybrid result
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
