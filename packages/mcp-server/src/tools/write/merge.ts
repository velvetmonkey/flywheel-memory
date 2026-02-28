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
  escapeRegex,
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
      dry_run: z.boolean().optional().default(false).describe('Preview merge plan without modifying any files'),
    },
    async ({ source_path, target_path, dry_run }) => {
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

        // 6. Compute backlink update plan
        const allSourceTitles = [sourceTitle, ...sourceAliases];
        const backlinks = await findBacklinks(vaultPath, sourceTitle, sourceAliases);
        let totalBacklinksUpdated = 0;
        const modifiedFiles: string[] = [];

        if (dry_run) {
          // Just count what would change
          for (const backlink of backlinks) {
            if (backlink.path === source_path || backlink.path === target_path) continue;
            totalBacklinksUpdated += backlink.links.length;
            modifiedFiles.push(backlink.path);
          }
        } else {
          for (const backlink of backlinks) {
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
        }

        // Build preview
        const previewLines = [
          `${dry_run ? 'Would merge' : 'Merged'}: "${sourceTitle}" → "${targetTitle}"`,
          `Aliases ${dry_run ? 'to add' : 'added'}: ${allNewAliases.join(', ')}`,
          `Source content ${dry_run ? 'to append' : 'appended'}: ${trimmedSource.length > 10 ? 'yes' : 'no'}`,
          `Backlinks ${dry_run ? 'to update' : 'updated'}: ${totalBacklinksUpdated}`,
        ];
        if (modifiedFiles.length > 0) {
          previewLines.push(`Files ${dry_run ? 'to modify' : 'modified'}: ${modifiedFiles.join(', ')}`);
        }

        // Dry run: return preview without writing anything
        if (dry_run) {
          const result: MutationResult & { backlinks_updated?: number } = {
            success: true,
            message: `[dry run] Would merge "${sourceTitle}" into "${targetTitle}"`,
            path: target_path,
            preview: previewLines.join('\n'),
            backlinks_updated: totalBacklinksUpdated,
            dryRun: true,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
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

  // ========================================
  // Tool: absorb_as_alias
  // ========================================
  server.tool(
    'absorb_as_alias',
    'Absorb an entity name as an alias of a target note: adds alias to target frontmatter and rewrites all [[source]] links to [[target|source]]. Lighter than merge_entities — no source note required, no content append, no deletion.',
    {
      source_name: z.string().describe('The entity name to absorb (e.g. "Foo")'),
      target_path: z.string().describe('Vault-relative path of the target entity note (e.g. "entities/Bar.md")'),
      dry_run: z.boolean().optional().default(false).describe('Preview what would change without modifying any files'),
    },
    async ({ source_name, target_path, dry_run }) => {
      try {
        // 1. Validate target path
        if (!validatePath(vaultPath, target_path)) {
          const result: MutationResult = {
            success: false,
            message: 'Invalid target path: path traversal not allowed',
            path: target_path,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 2. Read target note
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

        const targetTitle = getTitleFromPath(target_path);

        // 3. Add source_name to target's aliases (dedup, skip if matches target title)
        const existingAliases = extractAliases(targetFrontmatter);
        const deduped = new Set(existingAliases);
        if (source_name.toLowerCase() !== targetTitle.toLowerCase()) {
          deduped.add(source_name);
        }
        targetFrontmatter.aliases = Array.from(deduped);

        // 4. Find all backlinks to source_name
        const backlinks = await findBacklinks(vaultPath, source_name, []);
        let totalBacklinksUpdated = 0;
        const modifiedFiles: string[] = [];

        if (dry_run) {
          // Just count what would change
          for (const backlink of backlinks) {
            if (backlink.path === target_path) continue;
            totalBacklinksUpdated += backlink.links.length;
            modifiedFiles.push(backlink.path);
          }
        } else {
          // 4b. Write updated target frontmatter
          await writeVaultFile(vaultPath, target_path, targetContent, targetFrontmatter);

          // 5. For each file, replace [[source_name]] → [[target|source_name]]
          for (const backlink of backlinks) {
            if (backlink.path === target_path) continue;

            let fileData: { content: string; frontmatter: Record<string, unknown> };
            try {
              fileData = await readVaultFile(vaultPath, backlink.path);
            } catch {
              continue; // skip unreadable files
            }

            let content = fileData.content;
            let linksUpdated = 0;

            const pattern = new RegExp(
              `\\[\\[${escapeRegex(source_name)}(\\|[^\\]]+)?\\]\\]`,
              'gi'
            );

            content = content.replace(pattern, (_match, displayPart) => {
              linksUpdated++;
              if (displayPart) {
                return `[[${targetTitle}${displayPart}]]`;
              }
              if (source_name.toLowerCase() === targetTitle.toLowerCase()) {
                return `[[${targetTitle}]]`;
              }
              return `[[${targetTitle}|${source_name}]]`;
            });

            if (linksUpdated > 0) {
              await writeVaultFile(vaultPath, backlink.path, content, fileData.frontmatter);
              totalBacklinksUpdated += linksUpdated;
              modifiedFiles.push(backlink.path);
            }
          }

          // 6. Rebuild entity index in background
          initializeEntityIndex(vaultPath).catch(err => {
            console.error(`[Flywheel] Entity cache rebuild failed: ${err}`);
          });
        }

        // 7. Build result
        const aliasAdded = source_name.toLowerCase() !== targetTitle.toLowerCase();
        const previewLines = [
          `${dry_run ? 'Would absorb' : 'Absorbed'}: "${source_name}" → "${targetTitle}"`,
          `Alias ${dry_run ? 'to add' : 'added'}: ${aliasAdded ? source_name : 'no (matches target title)'}`,
          `Backlinks ${dry_run ? 'to update' : 'updated'}: ${totalBacklinksUpdated}`,
        ];
        if (modifiedFiles.length > 0) {
          previewLines.push(`Files ${dry_run ? 'to modify' : 'modified'}: ${modifiedFiles.join(', ')}`);
        }

        const result: MutationResult & { backlinks_updated?: number } = {
          success: true,
          message: dry_run
            ? `[dry run] Would absorb "${source_name}" as alias of "${targetTitle}"`
            : `Absorbed "${source_name}" as alias of "${targetTitle}"`,
          path: target_path,
          preview: previewLines.join('\n'),
          backlinks_updated: totalBacklinksUpdated,
          ...(dry_run ? { dryRun: true } : {}),
        };

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const result: MutationResult = {
          success: false,
          message: `Failed to absorb as alias: ${error instanceof Error ? error.message : String(error)}`,
          path: target_path,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    }
  );
}
