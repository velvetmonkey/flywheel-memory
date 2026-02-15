/**
 * Frontmatter tools for Flywheel Memory
 * Tools: vault_update_frontmatter (also handles add-if-missing via only_if_missing param)
 *
 * Note: vault_add_frontmatter_field was absorbed into vault_update_frontmatter
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  withVaultFrontmatter,
} from '../../core/write/mutation-helpers.js';

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
    'Update frontmatter fields in a note (merge with existing). Set only_if_missing=true to only add fields that don\'t already exist (absorbed vault_add_frontmatter_field).',
    {
      path: z.string().describe('Vault-relative path to the note'),
      frontmatter: z.record(z.any()).describe('Frontmatter fields to update (JSON object)'),
      only_if_missing: z.boolean().default(false).describe('If true, only add fields that don\'t already exist in the frontmatter (skip existing keys)'),
      commit: z.boolean().default(false).describe('If true, commit this change to git (creates undo point)'),
    },
    async ({ path: notePath, frontmatter: updates, only_if_missing, commit }) => {
      return withVaultFrontmatter(
        {
          vaultPath,
          notePath,
          commit,
          commitPrefix: '[Flywheel:FM]',
          actionDescription: 'update frontmatter',
        },
        async (ctx) => {
          let effectiveUpdates: Record<string, unknown>;

          if (only_if_missing) {
            // Only add keys that don't exist yet
            effectiveUpdates = {};
            const skippedKeys: string[] = [];
            for (const [key, value] of Object.entries(updates)) {
              if (key in ctx.frontmatter) {
                skippedKeys.push(key);
              } else {
                effectiveUpdates[key] = value;
              }
            }

            if (Object.keys(effectiveUpdates).length === 0) {
              const skippedMsg = skippedKeys.length > 0
                ? ` (skipped existing: ${skippedKeys.join(', ')})`
                : '';
              return {
                updatedFrontmatter: ctx.frontmatter,
                message: `No new fields to add${skippedMsg}`,
                preview: skippedKeys.map(k => `${k}: already exists`).join('\n'),
              };
            }
          } else {
            effectiveUpdates = updates;
          }

          // Merge frontmatter (updates override existing, unless only_if_missing filtered them)
          const updatedFrontmatter = { ...ctx.frontmatter, ...effectiveUpdates };

          // Generate preview
          const updatedKeys = Object.keys(effectiveUpdates);
          const preview = updatedKeys.map(k => `${k}: ${JSON.stringify(effectiveUpdates[k])}`).join('\n');

          return {
            updatedFrontmatter,
            message: `Updated ${updatedKeys.length} frontmatter field(s) in ${notePath}`,
            preview,
          };
        }
      );
    }
  );
}
