/**
 * Note creation tools for Flywheel Memory
 * Tools: vault_create_note, vault_delete_note
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { writeVaultFile, validatePath, injectMutationMetadata } from '../../core/write/writer.js';
import {
  maybeApplyWikilinks,
  suggestRelatedLinks,
  detectAliasCollisions,
  suggestAliases,
  checkPreflightSimilarity,
} from '../../core/write/wikilinks.js';
import {
  handleGitCommit,
  formatMcpResult,
  errorResult,
  successResult,
  ensureFileExists,
} from '../../core/write/mutation-helpers.js';
import { getBacklinksForNote } from '../../core/read/graph.js';
import type { VaultIndex } from '../../core/read/types.js';
import type { ValidationWarning } from '../../core/write/types.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Register note CRUD tools with the MCP server
 */
export function registerNoteTools(
  server: McpServer,
  vaultPath: string,
  getIndex?: () => VaultIndex
): void {
  // ========================================
  // Tool: vault_create_note
  // ========================================
  server.tool(
    'vault_create_note',
    'Create a new note in the vault with optional frontmatter and content.\n\nExample: vault_create_note({ path: "people/Jane Smith.md", content: "# Jane Smith\\n\\nProduct manager at Acme.", frontmatter: { type: "person", company: "Acme" } })',
    {
      path: z.string().describe('Vault-relative path for the new note (e.g., "daily-notes/2026-01-28.md")'),
      content: z.string().default('').describe('Initial content for the note'),
      template: z.string().optional().describe('Vault-relative path to a template file (e.g., "templates/person.md"). Template variables {{date}} and {{title}} are substituted. Template frontmatter is merged with the frontmatter parameter (explicit values take precedence).'),
      frontmatter: z.record(z.any()).default({}).describe('Frontmatter fields (JSON object)'),
      overwrite: z.boolean().default(false).describe('If true, overwrite existing file'),
      commit: z.boolean().default(false).describe('If true, commit this change to git (creates undo point)'),
      skipWikilinks: z.boolean().default(false).describe('If true, skip auto-wikilink application (wikilinks are applied by default)'),
      suggestOutgoingLinks: z.boolean().default(true).describe('Append suggested outgoing wikilinks based on content (e.g., "→ [[AI]], [[Philosophy]]").'),
      maxSuggestions: z.number().min(1).max(10).default(3).describe('Maximum number of suggested wikilinks to append (1-10, default: 3)'),
      agent_id: z.string().optional().describe('Agent identifier for multi-agent scoping'),
      session_id: z.string().optional().describe('Session identifier for conversation scoping'),
    },
    async ({ path: notePath, content, template, frontmatter, overwrite, commit, skipWikilinks, suggestOutgoingLinks, maxSuggestions, agent_id, session_id }) => {
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

        // 3a. Load template if specified
        let effectiveContent = content;
        let effectiveFrontmatter = frontmatter;
        if (template) {
          const templatePath = path.join(vaultPath, template);
          try {
            const raw = await fs.readFile(templatePath, 'utf-8');
            const matter = (await import('gray-matter')).default;
            const parsed = matter(raw);

            // Apply substitutions to template content
            const dateStr = new Date().toISOString().split('T')[0];
            const title = path.basename(notePath, '.md');
            let templateContent = parsed.content
              .replace(/\{\{date\}\}/g, dateStr)
              .replace(/\{\{title\}\}/g, title);

            // If user provided content, append it after template content
            if (content) {
              templateContent = templateContent.trimEnd() + '\n\n' + content;
            }
            effectiveContent = templateContent;

            // Template frontmatter as base, user-provided overrides
            effectiveFrontmatter = { ...(parsed.data || {}), ...frontmatter };
          } catch {
            return formatMcpResult(errorResult(notePath, `Template not found: ${template}`));
          }
        }

        // 3b. Ensure frontmatter always contains date and created fields
        const now = new Date();
        if (!effectiveFrontmatter.date) {
          effectiveFrontmatter.date = now.toISOString().split('T')[0];
        }
        if (!effectiveFrontmatter.created) {
          effectiveFrontmatter.created = now.toISOString();
        }

        // 3c. Note creation intelligence: preflight checks
        const warnings: ValidationWarning[] = [];
        const noteName = path.basename(notePath, '.md');
        const existingAliases: string[] = Array.isArray(effectiveFrontmatter?.aliases)
          ? effectiveFrontmatter.aliases.filter((a: unknown) => typeof a === 'string')
          : [];

        // Preflight similarity check
        const preflight = await checkPreflightSimilarity(noteName);
        if (preflight.existingEntity) {
          warnings.push({
            type: 'similar_note_exists',
            message: `An entity "${preflight.existingEntity.name}" already exists at ${preflight.existingEntity.path}`,
            suggestion: `Consider linking to the existing note instead, or choose a different name`,
          });
        }
        for (const similar of preflight.similarEntities.slice(0, 3)) {
          warnings.push({
            type: 'similar_note_exists',
            message: `Similar entity "${similar.name}" exists at ${similar.path}`,
            suggestion: `Check if this is a duplicate`,
          });
        }

        // Alias collision detection
        const collisions = detectAliasCollisions(noteName, existingAliases);
        for (const collision of collisions) {
          warnings.push({
            type: 'alias_collision',
            message: `${collision.source === 'name' ? 'Note name' : 'Alias'} "${collision.term}" collides with ${collision.collidedWith.matchType} of "${collision.collidedWith.name}" (${collision.collidedWith.path})`,
            suggestion: `This may cause ambiguous wikilink resolution`,
          });
        }

        // 4. Apply wikilinks to content (unless skipped)
        let { content: processedContent, wikilinkInfo } = maybeApplyWikilinks(effectiveContent, skipWikilinks, notePath);

        // 5. Suggest outgoing links (enabled by default)
        let suggestInfo: string | undefined;
        if (suggestOutgoingLinks && !skipWikilinks && processedContent.length >= 100) {
          const result = await suggestRelatedLinks(processedContent, { maxSuggestions, notePath });
          if (result.suffix) {
            processedContent = processedContent + ' ' + result.suffix;
            suggestInfo = `Suggested: ${result.suggestions.join(', ')}`;
          }
        }

        // 6. Inject scoping metadata if provided
        let finalFrontmatter = effectiveFrontmatter;
        if (agent_id || session_id) {
          finalFrontmatter = injectMutationMetadata(effectiveFrontmatter, { agent_id, session_id });
        }

        // 7. Write the note
        await writeVaultFile(vaultPath, notePath, processedContent, finalFrontmatter);

        // 8. Handle git commit
        const gitInfo = await handleGitCommit(vaultPath, notePath, commit, '[Flywheel:Create]');

        // Build preview with wikilink info
        const infoLines = [wikilinkInfo, suggestInfo].filter(Boolean);
        const previewLines = [
          `Frontmatter fields: ${Object.keys(effectiveFrontmatter).join(', ') || 'none'}`,
          `Content length: ${processedContent.length} chars`,
        ];
        if (infoLines.length > 0) {
          previewLines.push(`(${infoLines.join('; ')})`);
        }

        // Smart alias suggestions (replace generic hint)
        const hasAliases = effectiveFrontmatter && ('aliases' in effectiveFrontmatter);
        if (!hasAliases) {
          const aliasSuggestions = suggestAliases(noteName, existingAliases);
          if (aliasSuggestions.length > 0) {
            previewLines.push('');
            previewLines.push('Suggested aliases:');
            for (const s of aliasSuggestions) {
              previewLines.push(`  - "${s.alias}" (${s.reason})`);
            }
          } else {
            previewLines.push('');
            previewLines.push('Tip: Add aliases to frontmatter for flexible wikilink matching (e.g., aliases: ["Short Name"])');
          }
        }

        return formatMcpResult(
          successResult(notePath, `Created note: ${notePath}`, gitInfo, {
            preview: previewLines.join('\n'),
            warnings: warnings.length > 0 ? warnings : undefined,
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
        // 1. Validate path
        if (!validatePath(vaultPath, notePath)) {
          return formatMcpResult(errorResult(notePath, 'Invalid path: path traversal not allowed'));
        }

        // 2. Check if file exists
        const existsError = await ensureFileExists(vaultPath, notePath);
        if (existsError) {
          return formatMcpResult(existsError);
        }

        // 3. Check for backlinks
        let backlinkWarning: string | undefined;
        if (getIndex) {
          try {
            const index = getIndex();
            const backlinks = getBacklinksForNote(index, notePath);
            if (backlinks.length > 0) {
              const sources = backlinks
                .slice(0, 10)
                .map(bl => `  - ${bl.source}${bl.context ? ` ("${bl.context.slice(0, 60)}")` : ''}`)
                .join('\n');
              backlinkWarning = `This note is referenced from ${backlinks.length} other note(s):\n${sources}`;
              if (backlinks.length > 10) {
                backlinkWarning += `\n  ... and ${backlinks.length - 10} more`;
              }
            }
          } catch {
            // Index may not be ready - skip backlink check
          }
        }

        // 4. Preview mode: show warning without deleting
        if (!confirm) {
          const previewLines = ['Deletion requires explicit confirmation (confirm=true)'];
          if (backlinkWarning) {
            previewLines.push('');
            previewLines.push('Warning: ' + backlinkWarning);
          }
          return formatMcpResult(errorResult(notePath, previewLines.join('\n')));
        }

        // 5. Delete the file
        const fullPath = path.join(vaultPath, notePath);
        await fs.unlink(fullPath);

        // 6. Handle git commit
        const gitInfo = await handleGitCommit(vaultPath, notePath, commit, '[Flywheel:Delete]');

        const message = backlinkWarning
          ? `Deleted note: ${notePath}\n\nWarning: ${backlinkWarning}`
          : `Deleted note: ${notePath}`;
        return formatMcpResult(successResult(notePath, message, gitInfo));
      } catch (error) {
        return formatMcpResult(
          errorResult(notePath, `Failed to delete note: ${error instanceof Error ? error.message : String(error)}`)
        );
      }
    }
  );
}
