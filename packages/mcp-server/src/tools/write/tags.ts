/**
 * Tag management tools
 * Tools: rename_tag
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import { renameTag } from '../../core/write/tagRename.js';

/**
 * Register tag management tools
 */
export function registerTagTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string
): void {
  server.registerTool(
    'rename_tag',
    {
      title: 'Rename Tag',
      description:
        'Use when bulk-renaming a tag across all notes including hierarchical children. Produces frontmatter and inline tag replacements with dry-run preview. Returns rename results with affected note count and tag transformations. Does not write changes unless dry_run is false.',
      inputSchema: {
        old_tag: z.string().describe('Tag to rename (without #, e.g., "project")'),
        new_tag: z.string().describe('New tag name (without #, e.g., "work")'),
        rename_children: z.boolean().optional().describe('Also rename child tags (e.g., #project/active → #work/active). Default: true'),
        folder: z.string().optional().describe('Limit to notes in this folder (e.g., "projects")'),
        dry_run: z.boolean().optional().describe('Preview only, no changes (default: true)'),
        commit: z.boolean().optional().describe('Commit changes to git (default: false)'),
      },
    },
    async ({ old_tag, new_tag, rename_children, folder, dry_run, commit }) => {
      const index = getIndex();
      const vaultPath = getVaultPath();

      const result = await renameTag(index, vaultPath, old_tag, new_tag, {
        rename_children: rename_children ?? true,
        folder,
        dry_run: dry_run ?? true,
        commit: commit ?? false,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );
}
