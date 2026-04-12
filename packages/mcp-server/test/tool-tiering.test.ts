import { describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ALL_CATEGORIES, generateInstructions, resolveToolConfig, TOOL_CATEGORY } from '../src/config.js';
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

async function createServerForPreset(preset?: string) {
  const resolved = resolveToolConfig(preset);
  const server = new McpServer({ name: 'tool-tiering-test', version: '0.0.0' });
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
  return { client, controller, resolved };
}

describe('tool registry compatibility', () => {
  it('auto stays accepted but does not enable progressive disclosure runtime', () => {
    const config = resolveToolConfig('auto');
    expect(config.preset).toBe('auto');
    expect(config.enableProgressiveDisclosure).toBe(false);
    expect(config.includeDiscoveryTool).toBe(true);
    expect(config.categories).toEqual(new Set(ALL_CATEGORIES));
  });

  it('auto exposes full tools plus discover_tools', async () => {
    const { client } = await createServerForPreset('auto');
    const tools = await client.listTools();
    const names = new Set(tools.tools.map((tool) => tool.name));

    expect(names).toContain('discover_tools');
    expect(names).toContain('graph');
    expect(names).toContain('insights');

    await client.close();
  });

  it('full exposes the full tool surface without discover_tools', async () => {
    const { client } = await createServerForPreset('full');
    const tools = await client.listTools();
    const names = new Set(tools.tools.map((tool) => tool.name));

    expect(names).not.toContain('discover_tools');
    expect(names).toContain('graph');
    expect(names).toContain('insights');

    await client.close();
  });

  it('discover_tools is informational only and does not change tool visibility', async () => {
    const { client } = await createServerForPreset('auto');
    const before = await client.listTools();
    const result = await client.callTool('discover_tools', { query: 'graph connections and backlinks' });
    const after = await client.listTools();

    const payload = JSON.parse(result.content[0].text);
    expect(payload.matched_categories).toContain('graph');
    expect(payload.tools.some((tool: { name: string }) => tool.name === 'graph')).toBe(true);
    expect(after.tools.map((tool) => tool.name)).toEqual(before.tools.map((tool) => tool.name));

    await client.close();
  });

  it('controller owns the registered tool map', async () => {
    const { controller, client } = await createServerForPreset('auto');
    expect(controller.getRegisteredTools().size).toBe(Object.keys(TOOL_CATEGORY).length);
    await client.close();
  });

  it('instructions mention discover_tools only as discovery guidance', () => {
    const autoInstructions = generateInstructions(new Set(ALL_CATEGORIES), null, new Set(ALL_CATEGORIES));
    expect(autoInstructions).toContain('discover_tools');
    expect(autoInstructions).toContain('does not activate or reveal anything');

    const fullInstructions = generateInstructions(new Set(ALL_CATEGORIES));
    expect(fullInstructions).not.toContain('discover_tools');
  });
});
