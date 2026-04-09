/**
 * T43 Retirement Assertions
 *
 * Verifies that tools retired in T43 are NOT registered on any preset.
 * Documents the removals are intentional and prevents accidental re-registration.
 */

import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  ALL_CATEGORIES,
  TOOL_CATEGORY,
  resolveToolConfig,
  type ToolCategory,
} from '../../src/config.js';
import {
  applyToolGating,
  registerAllTools,
  type ToolRegistryContext,
} from '../../src/tool-registry.js';

/** Retired tool IDs — these must never appear in any preset. */
const RETIRED_TOOLS = [
  'tool_selection_feedback',
  'vault_init',
  'suggest_entity_merges',
  'dismiss_merge_suggestion',
];

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

function getRegisteredToolNames(envValue?: string): string[] {
  const resolved = resolveToolConfig(envValue);
  const server = new McpServer({ name: 'retirement-test', version: '0.0.0' });
  const controller = applyToolGating(
    server,
    resolved.categories,
    () => null,
    null,
    undefined,
    undefined,
    'off',
  );
  registerAllTools(server, createStubRegistryContext(), controller);
  controller.finalizeRegistration();
  return [...controller.getRegisteredTools().keys()];
}

describe('T43 Retirements', () => {
  it('retired tools are not in TOOL_CATEGORY', () => {
    const catalogued = new Set(Object.keys(TOOL_CATEGORY));
    for (const tool of RETIRED_TOOLS) {
      expect(catalogued.has(tool), `${tool} should not be in TOOL_CATEGORY`).toBe(false);
    }
  });

  it('retired tools are not registered on the full preset', () => {
    const registered = new Set(getRegisteredToolNames('full'));
    for (const tool of RETIRED_TOOLS) {
      expect(registered.has(tool), `${tool} should not be registered`).toBe(false);
    }
  });

  it('retired tools are not registered on any preset', () => {
    for (const preset of ['agent', 'power', 'full']) {
      const registered = new Set(getRegisteredToolNames(preset));
      for (const tool of RETIRED_TOOLS) {
        expect(registered.has(tool), `${tool} should not be on ${preset} preset`).toBe(false);
      }
    }
  });
});
