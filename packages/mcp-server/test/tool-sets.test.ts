import { describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  ALL_CATEGORIES,
  PRESETS,
  TOOL_CATEGORY,
  DISCLOSURE_ONLY_TOOLS,
  resolveToolConfig,
  type ToolCategory,
} from '../src/config.js';
import { applyToolGating, registerAllTools, type ToolRegistryContext } from '../src/tool-registry.js';
import { connectMcpTestClient } from './helpers/mcpClient.js';

function createStubRegistryContext(): ToolRegistryContext {
  return {
    getVaultPath: () => '/fake/vault',
    getVaultIndex: () => null as any,
    getStateDb: () => null,
    getFlywheelConfig: () => ({} as any),
    getWatcherStatus: () => null,
    getPipelineActivity: () => null,
    getVaultRuntimeState: () => ({
      bootState: 'ready',
      integrityState: 'healthy',
      integrityCheckInProgress: false,
      integrityStartedAt: null,
      integritySource: null,
      lastIntegrityCheckedAt: null,
      lastIntegrityDurationMs: null,
      lastIntegrityDetail: null,
      lastBackupAt: null,
    }),
    updateVaultIndex: () => {},
    updateFlywheelConfig: () => {},
  };
}

function expectedToolsForCategories(categories: Set<ToolCategory>, includeDiscovery = false): Set<string> {
  return new Set(
    Object.entries(TOOL_CATEGORY)
      .filter(([name, category]) => {
        if (!categories.has(category as ToolCategory)) return false;
        if (!includeDiscovery && DISCLOSURE_ONLY_TOOLS.has(name)) return false;
        return true;
      })
      .map(([name]) => name),
  );
}

async function listToolNamesForConfig(envValue?: string): Promise<Set<string>> {
  const resolved = resolveToolConfig(envValue);
  const server = new McpServer({ name: 'tool-set-test', version: '0.0.0' });
  const controller = applyToolGating(
    server,
    resolved.categories,
    () => null,
    null,
    undefined,
    undefined,
    resolved.includeDiscoveryTool ? 'tiered' : 'off',
  );
  registerAllTools(server, createStubRegistryContext(), controller, { applyClientSuppressions: false });
  controller.finalizeRegistration();
  const client = await connectMcpTestClient(server);
  const tools = await client.listTools();
  await client.close();
  return new Set(tools.tools.map((tool) => tool.name));
}

describe('resolveToolConfig', () => {
  it('defaults to agent preset', () => {
    const result = resolveToolConfig();
    expect(result.preset).toBe('agent');
    expect(result.categories).toEqual(new Set(PRESETS.agent));
    expect(result.includeDiscoveryTool).toBe(false);
  });

  it('auto resolves to the full category surface and keeps discovery compatibility', () => {
    const result = resolveToolConfig('auto');
    expect(result.categories).toEqual(new Set(ALL_CATEGORIES));
    expect(result.isFullToolset).toBe(true);
    expect(result.includeDiscoveryTool).toBe(true);
  });

  it('comma-separated categories stay composable', () => {
    const result = resolveToolConfig('agent,graph');
    expect(result.preset).toBeNull();
    expect(result.categories).toEqual(new Set([...PRESETS.agent, 'graph']));
    expect(result.includeDiscoveryTool).toBe(false);
  });
});

describe('registered tool surfaces', () => {
  it('agent preset registers only agent categories', async () => {
    const names = await listToolNamesForConfig('agent');
    expect(names).toEqual(expectedToolsForCategories(new Set(PRESETS.agent)));
  });

  it('power preset registers the power categories', async () => {
    const names = await listToolNamesForConfig('power');
    expect(names).toEqual(expectedToolsForCategories(new Set(PRESETS.power)));
  });

  it('full preset registers every non-discovery tool', async () => {
    const names = await listToolNamesForConfig('full');
    expect(names).toEqual(expectedToolsForCategories(new Set(ALL_CATEGORIES)));
  });

  it('auto registers the full surface plus discover_tools', async () => {
    const names = await listToolNamesForConfig('auto');
    expect(names).toEqual(expectedToolsForCategories(new Set(ALL_CATEGORIES), true));
  });
});
