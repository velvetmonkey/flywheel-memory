/**
 * Frontmatter tools for Flywheel Crank
 * Tools: vault_update_frontmatter, vault_add_frontmatter_field
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  withVaultFrontmatter,
  ensureFileExists,
  handleGitCommit,
  formatMcpResult,
  errorResult,
  successResult,
} from '../../core/write/mutation-helpers.js';
import { readVaultFile, writeVaultFile } from '../../core/write/writer.js';

/**
 * Register frontmatter tools with the MCP server
 */
export function registerFrontmatterTools(
  server: McpServer,
  vaultPath: string
): void {
  // ========================================
  // Tool: vault_update_frontmatter
  // ========================================
  server.tool(
    'vault_update_frontmatter',
    'Update frontmatter fields in a note (merge with existing frontmatter)',
    {
      path: z.string().describe('Vault-relative path to the note'),
      frontmatter: z.record(z.any()).describe('Frontmatter fields to update (JSON object)'),
      commit: z.boolean().default(false).describe('If true, commit this change to git (creates undo point)'),
    },
    async ({ path: notePath, frontmatter: updates, commit }) => {
      return withVaultFrontmatter(
        {
          vaultPath,
          notePath,
          commit,
          commitPrefix: '[Crank:FM]',
          actionDescription: 'update frontmatter',
        },
        async (ctx) => {
          // Merge frontmatter (updates override existing)
          const updatedFrontmatter = { ...ctx.frontmatter, ...updates };

          // Generate preview
          const updatedKeys = Object.keys(updates);
          const preview = updatedKeys.map(k => `${k}: ${JSON.stringify(updates[k])}`).join('\n');

          return {
            updatedFrontmatter,
            message: `Updated ${updatedKeys.length} frontmatter field(s) in ${notePath}`,
            preview,
          };
        }
      );
    }
  );

  // ========================================
  // Tool: vault_add_frontmatter_field
  // ========================================
  server.tool(
    'vault_add_frontmatter_field',
    'Add a new frontmatter field to a note (only if it doesn\'t exist)',
    {
      path: z.string().describe('Vault-relative path to the note'),
      key: z.string().describe('Field name to add'),
      value: z.any().describe('Field value (string, number, boolean, array, object)'),
      commit: z.boolean().default(false).describe('If true, commit this change to git (creates undo point)'),
    },
    async ({ path: notePath, key, value, commit }) => {
      try {
        // 1. Check if file exists
        const existsError = await ensureFileExists(vaultPath, notePath);
        if (existsError) {
          return formatMcpResult(existsError);
        }

        // 2. Read file with frontmatter
        const { content, frontmatter, lineEnding } = await readVaultFile(vaultPath, notePath);

        // 3. Check if key already exists (custom validation for this tool)
        if (key in frontmatter) {
          return formatMcpResult(
            errorResult(notePath, `Field "${key}" already exists. Use vault_update_frontmatter to modify existing fields.`)
          );
        }

        // 4. Add new field
        const updatedFrontmatter = { ...frontmatter, [key]: value };

        // 5. Write back
        await writeVaultFile(vaultPath, notePath, content, updatedFrontmatter, lineEnding);

        // 6. Handle git commit
        const gitInfo = await handleGitCommit(vaultPath, notePath, commit, '[Crank:FM]');

        // 7. Build result
        return formatMcpResult(
          successResult(notePath, `Added frontmatter field "${key}" to ${notePath}`, gitInfo, {
            preview: `${key}: ${JSON.stringify(value)}`,
          })
        );
      } catch (error) {
        return formatMcpResult(
          errorResult(
            notePath,
            `Failed to add frontmatter field: ${error instanceof Error ? error.message : String(error)}`
          )
        );
      }
    }
  );
}
