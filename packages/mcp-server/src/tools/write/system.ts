/**
 * System tools for Flywheel Memory
 * Tools: vault_undo_last_mutation
 *
 * Note: vault_list_sections was absorbed into get_note_structure (read/primitives.ts)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  undoLastCommit,
  getLastCommit,
  isGitRepo,
  getLastMutationCommit,
  clearLastMutationCommit,
} from '../../core/write/git.js';
import type { MutationResult } from '../../core/write/types.js';

export function registerSystemTools(
  server: McpServer,
  vaultPath: string
): void {
  // ========================================
  // Tool: vault_undo_last_mutation
  // ========================================
  server.tool(
    'vault_undo_last_mutation',
    'Undo the last git commit (typically the last Flywheel mutation). Performs a soft reset.',
    {
      confirm: z.boolean().default(false).describe('Must be true to confirm undo operation'),
      hash: z.string().optional().describe('Expected commit hash. If provided, undo only proceeds if HEAD matches this hash. Prevents accidentally undoing the wrong commit.'),
    },
    async ({ confirm, hash }) => {
      try {
        // 1. Require confirmation
        if (!confirm) {
          // Show what would be undone
          const lastCommit = await getLastCommit(vaultPath);

          if (!lastCommit) {
            const result: MutationResult = {
              success: false,
              message: 'No commits found to undo',
              path: '',
            };
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          const result: MutationResult = {
            success: false,
            message: `Undo requires confirmation (confirm=true). Would undo: "${lastCommit.message}"`,
            path: '',
            preview: `Commit: ${lastCommit.hash.substring(0, 7)}\nMessage: ${lastCommit.message}\nDate: ${lastCommit.date}`,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 2. Check if git repo
        const isRepo = await isGitRepo(vaultPath);
        if (!isRepo) {
          const result: MutationResult = {
            success: false,
            message: 'Vault is not a git repository. Undo is only available for git-tracked vaults.',
            path: '',
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 2b. If hash provided, verify HEAD matches before proceeding
        if (hash) {
          const currentHead = await getLastCommit(vaultPath);
          if (!currentHead) {
            const result: MutationResult = {
              success: false,
              message: 'No commits found to verify against',
              path: '',
            };
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          // Support both full hash and short hash comparison
          const normalizedHash = hash.toLowerCase();
          const headHash = currentHead.hash.toLowerCase();
          if (!headHash.startsWith(normalizedHash) && normalizedHash !== headHash) {
            const result: MutationResult = {
              success: false,
              message: `HEAD mismatch - refusing to undo wrong commit. Expected ${hash.substring(0, 7)}, found ${currentHead.hash.substring(0, 7)}`,
              path: '',
              preview: `Expected: ${hash}\nActual HEAD: ${currentHead.hash} "${currentHead.message}"`,
            };
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
        }

        // 3. Verify HEAD matches expected Flywheel commit (safety check)
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
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
        }

        // 4. Perform undo
        const undoResult = await undoLastCommit(vaultPath);

        if (!undoResult.success) {
          const result: MutationResult = {
            success: false,
            message: undoResult.message,
            path: '',
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 5. Clear tracking after successful undo
        clearLastMutationCommit();

        const result: MutationResult = {
          success: true,
          message: undoResult.message,
          path: '',
          preview: undoResult.undoneCommit
            ? `Commit: ${undoResult.undoneCommit.hash.substring(0, 7)}\nMessage: ${undoResult.undoneCommit.message}`
            : undefined,
        };

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const result: MutationResult = {
          success: false,
          message: `Failed to undo: ${error instanceof Error ? error.message : String(error)}`,
          path: '',
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    }
  );
}
