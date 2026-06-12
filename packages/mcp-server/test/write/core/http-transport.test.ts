/**
 * T13: HTTP Transport Tests (arch-review S2 rewrite)
 *
 * The original file imported six RETIRED registration modules (mutations,
 * notes, move-notes, merge, write/system, tags) — the only thing keeping
 * those forks alive. Rewritten against the PRODUCTION registration path
 * (registerAllTools), which is exactly what the HTTP transport's per-request
 * servers use (index.ts createConfiguredServer).
 *
 * Still verifies the property this file always guarded: write tools take a
 * getVaultPath GETTER (called at invocation time), never a captured string —
 * the invariant that makes per-request vault switching possible at all.
 */

import { describe, it, expect, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools, type ToolRegistryContext } from '../../../src/tool-registry.js';
import { TOOL_CATEGORY } from '../../../src/config.js';

/** Capture server that records registrations without executing handlers. */
function createCaptureServer(): { server: McpServer; toolNames: string[] } {
  const toolNames: string[] = [];
  const server = {
    tool(name: string, ..._args: unknown[]) {
      toolNames.push(name);
      return { enabled: true };
    },
    registerTool(name: string, ..._args: unknown[]) {
      toolNames.push(name);
      return { enabled: true };
    },
    registerResource(..._args: unknown[]) { return undefined; },
    registerResourceTemplate(..._args: unknown[]) { return undefined; },
  } as unknown as McpServer;
  return { server, toolNames };
}

function buildContext(getVaultPath: () => string): ToolRegistryContext {
  return {
    getVaultPath,
    getVaultIndex: () => ({ notes: new Map(), entities: new Map(), aliases: new Map() }) as any,
    getStateDb: () => null,
    getFlywheelConfig: () => ({}) as any,
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

describe('T13: HTTP Transport', () => {
  describe('production registration path (registerAllTools)', () => {
    it('registers the complete live write surface', () => {
      const { server, toolNames } = createCaptureServer();
      registerAllTools(server, buildContext(() => '/test/vault'), null, {
        applyClientSuppressions: false,
      });

      const liveWriteTools = [
        'note',
        'edit_section',
        'vault_update_frontmatter',
        'vault_add_task',
        'policy',
        'entity',
        'correct',
        'link',
        'memory',
      ];
      for (const tool of liveWriteTools) {
        expect(toolNames, `missing live tool ${tool}`).toContain(tool);
      }
    });

    it('registers no retired write tools', () => {
      const { server, toolNames } = createCaptureServer();
      registerAllTools(server, buildContext(() => '/test/vault'), null, {
        applyClientSuppressions: false,
      });

      const retired = [
        'vault_add_to_section', 'vault_remove_from_section', 'vault_replace_in_section',
        'vault_create_note', 'vault_delete_note',
        'vault_move_note', 'vault_rename_note',
        'merge_entities', 'absorb_as_alias',
        'vault_undo_last_mutation', 'vault_toggle_task',
        'rename_tag', 'wikilink_feedback', 'tool_selection_feedback',
        'vault_record_correction', 'vault_list_corrections', 'vault_resolve_correction',
        'flywheel_config', 'vault_init', 'recall',
      ];
      for (const tool of retired) {
        expect(toolNames, `retired tool ${tool} re-registered`).not.toContain(tool);
      }
    });

    it('every registered tool has a TOOL_CATEGORY entry (gating contract)', () => {
      const { server, toolNames } = createCaptureServer();
      registerAllTools(server, buildContext(() => '/test/vault'), null, {
        applyClientSuppressions: false,
      });

      for (const name of toolNames) {
        expect(TOOL_CATEGORY[name], `tool ${name} missing from TOOL_CATEGORY`).toBeDefined();
      }
    });

    it('getVaultPath getter is NOT called during registration (invocation-time pattern)', () => {
      const { server } = createCaptureServer();
      const getter = vi.fn(() => '/test/vault');

      registerAllTools(server, buildContext(getter), null, {
        applyClientSuppressions: false,
      });

      // The per-request vault switch only works if no registration captured
      // the path eagerly. Any eager call here is a multi-vault routing bug.
      expect(getter).not.toHaveBeenCalled();
    });
  });
});
