/**
 * Correct merged tool
 * Tool: correct
 *
 * Absorbs: vault_record_correction + vault_list_corrections + vault_resolve_correction + vault_undo_last_mutation
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import {
  recordCorrection,
  listCorrections,
  resolveCorrection,
} from '../../core/write/corrections.js';
import {
  undoLastCommit,
  getLastCommit,
  isGitRepo,
  getLastMutationCommit,
  clearLastMutationCommit,
} from '../../core/write/git.js';
import type { MutationResult } from '../../core/write/types.js';

/**
 * Register the correct merged tool with the MCP server
 */
export function registerCorrectTool(
  server: McpServer,
  getStateDb: () => StateDb | null,
  getVaultPath: () => string,
): void {
  server.tool(
    'correct',
    'Track corrections and undo mutations. action: record — log correction. action: list — pending corrections. action: resolve — mark resolved. action: undo — reverse last mutation. Returns correction record, list, or undo result. Does not modify note content directly. e.g. { action:"record", path:"people/alice.md", entity:"Alice", note:"Wrong title" } { action:"undo" }',
    {
      action: z.enum(['record', 'list', 'resolve', 'undo']).describe('Operation to perform'),

      path: z.string().optional().describe('[record|list] Note path the correction applies to'),
      entity: z.string().optional().describe('[record] Entity the correction applies to'),
      note: z.string().optional().describe('[record] Description of the correction'),

      limit: z.number().optional().describe('[list] Maximum corrections to return'),

      correction_id: z.string().optional().describe('[resolve] ID of the correction to mark resolved'),
    },
    async ({ action, path, entity, note, limit, correction_id }) => {
      // ---- action: record ----
      if (action === 'record') {
        if (!path) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'path is required for action: record' }) }],
            isError: true,
          };
        }
        if (!entity) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'entity is required for action: record' }) }],
            isError: true,
          };
        }
        if (!note) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'note is required for action: record' }) }],
            isError: true,
          };
        }

        const stateDb = getStateDb();
        if (!stateDb) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available' }) }],
            isError: true,
          };
        }

        const correction = recordCorrection(stateDb, 'general', note, 'user', entity, path);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ recorded: true, correction }, null, 2),
          }],
        };
      }

      // ---- action: list ----
      if (action === 'list') {
        const stateDb = getStateDb();
        if (!stateDb) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available' }) }],
            isError: true,
          };
        }

        // Filter by note path via entity lookup — pass path as note_path filter via SQL workaround
        // The core listCorrections accepts entity filter; for path filter we query directly
        let corrections;
        if (path) {
          corrections = stateDb.db.prepare(
            `SELECT * FROM corrections WHERE note_path = ? ORDER BY created_at DESC LIMIT ?`
          ).all(path, limit ?? 50);
        } else {
          corrections = listCorrections(stateDb, undefined, undefined, limit ?? 50);
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ corrections, count: (corrections as any[]).length }, null, 2),
          }],
        };
      }

      // ---- action: resolve ----
      if (action === 'resolve') {
        if (!correction_id) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'correction_id is required for action: resolve' }) }],
            isError: true,
          };
        }

        const stateDb = getStateDb();
        if (!stateDb) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available' }) }],
            isError: true,
          };
        }

        const id = parseInt(correction_id, 10);
        if (isNaN(id)) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: `Invalid correction_id: ${correction_id}` }) }],
            isError: true,
          };
        }

        const resolved = resolveCorrection(stateDb, id, 'applied');
        if (!resolved) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: `Correction ${correction_id} not found` }) }],
            isError: true,
          };
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ resolved: true, correction_id, status: 'applied' }, null, 2),
          }],
        };
      }

      // ---- action: undo ----
      if (action === 'undo') {
        const vaultPath = getVaultPath();

        try {
          const isRepo = await isGitRepo(vaultPath);
          if (!isRepo) {
            const result: MutationResult = {
              success: false,
              message: 'Vault is not a git repository. Undo is only available for git-tracked vaults.',
              path: '',
            };
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
          }

          // Safety check: verify HEAD matches last Flywheel commit
          const lastMutationCommit = getLastMutationCommit();
          const lastCommit = await getLastCommit(vaultPath);

          if (lastMutationCommit && lastCommit) {
            if (lastCommit.hash !== lastMutationCommit.hash) {
              const result: MutationResult = {
                success: false,
                message: `Cannot undo: HEAD (${lastCommit.hash.substring(0, 7)}) doesn't match last Flywheel commit (${lastMutationCommit.hash.substring(0, 7)}). Another process may have committed since your mutation.`,
                path: '',
                preview: `Expected: ${lastMutationCommit.hash.substring(0, 7)} "${lastMutationCommit.message}"\nActual HEAD: ${lastCommit.hash.substring(0, 7)} "${lastCommit.message}"`,
              };
              return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
            }
          }

          if (!lastCommit) {
            const result: MutationResult = {
              success: false,
              message: 'No commits found to undo',
              path: '',
            };
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
          }

          const undoResult = await undoLastCommit(vaultPath);

          if (!undoResult.success) {
            const result: MutationResult = { success: false, message: undoResult.message, path: '' };
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
          }

          clearLastMutationCommit();

          const result: MutationResult = {
            success: true,
            message: undoResult.message,
            path: '',
            preview: undoResult.undoneCommit
              ? `Commit: ${undoResult.undoneCommit.hash.substring(0, 7)}\nMessage: ${undoResult.undoneCommit.message}`
              : undefined,
          };

          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          const result: MutationResult = {
            success: false,
            message: `Failed to undo: ${error instanceof Error ? error.message : String(error)}`,
            path: '',
          };
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        }
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: `Unknown action: ${action}` }) }],
        isError: true,
      };
    }
  );
}
