/**
 * Entity merge tool
 * Tool: merge_entities
 *
 * Merges a source entity note into a target entity note:
 * - Adds source title as alias on target
 * - Appends source content to target
 * - Replaces all wikilinks pointing to source → target
 * - Deletes source note
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { validatePath, readVaultFile, writeVaultFile } from '../../core/write/writer.js';
import type { MutationResult } from '../../core/write/types.js';
import { initializeEntityIndex } from '../../core/write/wikilinks.js';
import {
  findBacklinks,
  updateBacklinksInFile,
  extractAliases,
  getTitleFromPath,
} from './move-notes.js';
import fs from 'fs/promises';

/**
 * Register the merge_entities tool with the MCP server
 */
export function registerMergeTools(
  server: McpServer,
  vaultPath: string
): void {
  server.tool(
    'merge_entities',
    'Merge a source entity note into a target entity note: adds alias, appends content, updates wikilinks, deletes source',
    {
      source_path: z.string().describe('Vault-relative path of the note to merge FROM (will be deleted)'),
      target_path: z.string().describe('Vault-relative path of the note to merge INTO (receives alias + content)'),
    },
    async ({ source_path, target_path }) => {
      try {
        // 1. Validate paths
        if (!validatePath(vaultPath, source_path)) {
          const result: MutationResult = {
            success: false,
            message: 'Invalid source path: path traversal not allowed',
            path: source_path,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        if (!validatePath(vaultPath, target_path)) {
          const result: MutationResult = {
            success: false,
            message: 'Invalid target path: path traversal not allowed',
            path: target_path,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 2. Read source note
        let sourceContent: string;
        let sourceFrontmatter: Record<string, unknown>;
        try {
          const source = await readVaultFile(vaultPath, source_path);
          sourceContent = source.content;
          sourceFrontmatter = source.frontmatter;
        } catch {
          const result: MutationResult = {
            success: false,
            message: `Source file not found: ${source_path}`,
            path: source_path,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 3. Read target note
        let targetContent: string;
        let targetFrontmatter: Record<string, unknown>;
        try {
          const target = await readVaultFile(vaultPath, target_path);
          targetContent = target.content;
          targetFrontmatter = target.frontmatter;
        } catch {
          const result: MutationResult = {
            success: false,
            message: `Target file not found: ${target_path}`,
            path: target_path,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        const sourceTitle = getTitleFromPath(source_path);
        const targetTitle = getTitleFromPath(target_path);

        // 4. Add source title (and source aliases) to target's aliases
        const existingAliases = extractAliases(targetFrontmatter);
        const sourceAliases = extractAliases(sourceFrontmatter);
        const allNewAliases = [sourceTitle, ...sourceAliases];
        const deduped = new Set([...existingAliases]);
        for (const alias of allNewAliases) {
          // Don't add if it matches the target title
          if (alias.toLowerCase() !== targetTitle.toLowerCase()) {
            deduped.add(alias);
          }
        }
        targetFrontmatter.aliases = Array.from(deduped);

        // 5. Append source content if non-trivial
        const trimmedSource = sourceContent.trim();
        if (trimmedSource.length > 10) {
          const mergedSection = `\n\n## Merged from ${sourceTitle}\n\n${trimmedSource}`;
          targetContent = targetContent.trimEnd() + mergedSection;
        }

        // 6. Replace wikilinks across the vault: [[SourceTitle]] → [[TargetTitle]]
        const allSourceTitles = [sourceTitle, ...sourceAliases];
        const backlinks = await findBacklinks(vaultPath, sourceTitle, sourceAliases);
        let totalBacklinksUpdated = 0;
        const modifiedFiles: string[] = [];

        for (const backlink of backlinks) {
          // Skip the source (will be deleted) and target (we're writing it separately)
          if (backlink.path === source_path || backlink.path === target_path) continue;

          const updateResult = await updateBacklinksInFile(
            vaultPath,
            backlink.path,
            allSourceTitles,
            targetTitle
          );

          if (updateResult.updated) {
            totalBacklinksUpdated += updateResult.linksUpdated;
            modifiedFiles.push(backlink.path);
          }
        }

        // 7. Write updated target
        await writeVaultFile(vaultPath, target_path, targetContent, targetFrontmatter);

        // 8. Delete source note
        const fullSourcePath = `${vaultPath}/${source_path}`;
        await fs.unlink(fullSourcePath);

        // 9. Rebuild entity index in background
        initializeEntityIndex(vaultPath).catch(err => {
          console.error(`[Flywheel] Entity cache rebuild failed: ${err}`);
        });

        // Build result
        const previewLines = [
          `Merged: "${sourceTitle}" → "${targetTitle}"`,
          `Aliases added: ${allNewAliases.join(', ')}`,
          `Source content appended: ${trimmedSource.length > 10 ? 'yes' : 'no'}`,
          `Backlinks updated: ${totalBacklinksUpdated}`,
        ];
        if (modifiedFiles.length > 0) {
          previewLines.push(`Files modified: ${modifiedFiles.join(', ')}`);
        }

        const result: MutationResult & { backlinks_updated?: number } = {
          success: true,
          message: `Merged "${sourceTitle}" into "${targetTitle}"`,
          path: target_path,
          preview: previewLines.join('\n'),
          backlinks_updated: totalBacklinksUpdated,
        };

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const result: MutationResult = {
          success: false,
          message: `Failed to merge entities: ${error instanceof Error ? error.message : String(error)}`,
          path: source_path,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    }
  );
}
