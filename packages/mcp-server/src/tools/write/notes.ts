/**
 * Note creation tools for Flywheel Crank
 * Tools: vault_create_note, vault_delete_note
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { writeVaultFile, validatePath, injectMutationMetadata } from '../../core/write/writer.js';
import { maybeApplyWikilinks, suggestRelatedLinks } from '../../core/write/wikilinks.js';
import {
  handleGitCommit,
  formatMcpResult,
  errorResult,
  successResult,
  ensureFileExists,
} from '../../core/write/mutation-helpers.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Register note CRUD tools with the MCP server
 */
export function registerNoteTools(
  server: McpServer,
  vaultPath: string
): void {
  // ========================================
  // Tool: vault_create_note
  // ========================================
  server.tool(
    'vault_create_note',
    'Create a new note in the vault with optional frontmatter and content',
    {
      path: z.string().describe('Vault-relative path for the new note (e.g., "daily-notes/2026-01-28.md")'),
      content: z.string().default('').describe('Initial content for the note'),
      frontmatter: z.record(z.any()).default({}).describe('Frontmatter fields (JSON object)'),
      overwrite: z.boolean().default(false).describe('If true, overwrite existing file'),
      commit: z.boolean().default(false).describe('If true, commit this change to git (creates undo point)'),
      skipWikilinks: z.boolean().default(false).describe('If true, skip auto-wikilink application (wikilinks are applied by default)'),
      suggestOutgoingLinks: z.boolean().default(false).describe('Append suggested outgoing wikilinks based on content (e.g., "→ [[AI]], [[Philosophy]]"). Disabled by default for templates; enable for content-rich notes.'),
      maxSuggestions: z.number().min(1).max(10).default(3).describe('Maximum number of suggested wikilinks to append (1-10, default: 3)'),
      agent_id: z.string().optional().describe('Agent identifier for multi-agent scoping'),
      session_id: z.string().optional().describe('Session identifier for conversation scoping'),
    },
    async ({ path: notePath, content, frontmatter, overwrite, commit, skipWikilinks, suggestOutgoingLinks, maxSuggestions, agent_id, session_id }) => {
      try {
        // 1. Validate path
        if (!validatePath(vaultPath, notePath)) {
          return formatMcpResult(errorResult(notePath, 'Invalid path: path traversal not allowed'));
        }

        const fullPath = path.join(vaultPath, notePath);

        // 2. Check if file already exists
        const existsCheck = await ensureFileExists(vaultPath, notePath);
        if (existsCheck === null && !overwrite) {
          // File exists and overwrite is false
          return formatMcpResult(errorResult(notePath, `File already exists: ${notePath}. Use overwrite=true to replace.`));
        }

        // 3. Ensure parent directories exist
        const dir = path.dirname(fullPath);
        await fs.mkdir(dir, { recursive: true });

        // 4. Apply wikilinks to content (unless skipped)
        let { content: processedContent, wikilinkInfo } = maybeApplyWikilinks(content, skipWikilinks, notePath);

        // 5. Suggest outgoing links (enabled by default)
        let suggestInfo: string | undefined;
        if (suggestOutgoingLinks && !skipWikilinks) {
          const result = suggestRelatedLinks(processedContent, { maxSuggestions, notePath });
          if (result.suffix) {
            processedContent = processedContent + ' ' + result.suffix;
            suggestInfo = `Suggested: ${result.suggestions.join(', ')}`;
          }
        }

        // 6. Inject scoping metadata if provided
        let finalFrontmatter = frontmatter;
        if (agent_id || session_id) {
          finalFrontmatter = injectMutationMetadata(frontmatter, { agent_id, session_id });
        }

        // 7. Write the note
        await writeVaultFile(vaultPath, notePath, processedContent, finalFrontmatter);

        // 8. Handle git commit
        const gitInfo = await handleGitCommit(vaultPath, notePath, commit, '[Crank:Create]');

        // Build preview with wikilink info
        const infoLines = [wikilinkInfo, suggestInfo].filter(Boolean);
        const previewLines = [
          `Frontmatter fields: ${Object.keys(frontmatter).join(', ') || 'none'}`,
          `Content length: ${processedContent.length} chars`,
        ];
        if (infoLines.length > 0) {
          previewLines.push(`(${infoLines.join('; ')})`);
        }

        // Add alias hint if frontmatter doesn't include aliases
        const hasAliases = frontmatter && ('aliases' in frontmatter);
        if (!hasAliases) {
          previewLines.push('');
          previewLines.push('Tip: Add aliases to frontmatter for flexible wikilink matching (e.g., aliases: ["Short Name"])');
        }

        return formatMcpResult(
          successResult(notePath, `Created note: ${notePath}`, gitInfo, {
            preview: previewLines.join('\n'),
          })
        );
      } catch (error) {
        return formatMcpResult(
          errorResult(notePath, `Failed to create note: ${error instanceof Error ? error.message : String(error)}`)
        );
      }
    }
  );

  // ========================================
  // Tool: vault_delete_note
  // ========================================
  server.tool(
    'vault_delete_note',
    'Delete a note from the vault',
    {
      path: z.string().describe('Vault-relative path to the note to delete'),
      confirm: z.boolean().default(false).describe('Must be true to confirm deletion'),
      commit: z.boolean().default(false).describe('If true, commit this change to git (creates undo point)'),
    },
    async ({ path: notePath, confirm, commit }) => {
      try {
        // 1. Require confirmation
        if (!confirm) {
          return formatMcpResult(errorResult(notePath, 'Deletion requires explicit confirmation (confirm=true)'));
        }

        // 2. Validate path
        if (!validatePath(vaultPath, notePath)) {
          return formatMcpResult(errorResult(notePath, 'Invalid path: path traversal not allowed'));
        }

        // 3. Check if file exists
        const existsError = await ensureFileExists(vaultPath, notePath);
        if (existsError) {
          return formatMcpResult(existsError);
        }

        // 4. Delete the file
        const fullPath = path.join(vaultPath, notePath);
        await fs.unlink(fullPath);

        // 5. Handle git commit
        const gitInfo = await handleGitCommit(vaultPath, notePath, commit, '[Crank:Delete]');

        return formatMcpResult(successResult(notePath, `Deleted note: ${notePath}`, gitInfo));
      } catch (error) {
        return formatMcpResult(
          errorResult(notePath, `Failed to delete note: ${error instanceof Error ? error.message : String(error)}`)
        );
      }
    }
  );
}
