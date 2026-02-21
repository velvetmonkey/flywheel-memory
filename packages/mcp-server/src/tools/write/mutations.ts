/**
 * Mutation tools for Flywheel Memory
 * Tools: vault_add_to_section, vault_remove_from_section, vault_replace_in_section
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import {
  formatContent,
  insertInSection,
  removeFromSection,
  replaceInSection,
  writeVaultFile,
  DiagnosticError,
  buildReplaceNotFoundDiagnostic,
  type MatchMode,
} from '../../core/write/writer.js';
import type { FormatType, Position } from '../../core/write/types.js';
import {
  runValidationPipeline,
  type GuardrailMode,
} from '../../core/write/validator.js';
import { maybeApplyWikilinks, suggestRelatedLinks, getEntityIndexStats, getWriteStateDb } from '../../core/write/wikilinks.js';
import { trackWikilinkApplications } from '../../core/write/wikilinkFeedback.js';
import {
  withVaultFile,
  formatMcpResult,
  errorResult,
  successResult,
  handleGitCommit,
} from '../../core/write/mutation-helpers.js';
import type { FlywheelConfig } from '../../core/read/config.js';

/**
 * Create a note from template or minimal fallback.
 * Returns the path that was created.
 */
async function createNoteFromTemplate(
  vaultPath: string,
  notePath: string,
  config: FlywheelConfig
): Promise<{ created: boolean; templateUsed?: string }> {
  const fullPath = path.join(vaultPath, notePath);

  // Ensure parent directories exist
  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  // Try to find a matching template
  const templates = config.templates || {};
  const filename = path.basename(notePath, '.md').toLowerCase();

  // Determine which type of periodic note this might be
  let templatePath: string | undefined;
  const dailyPattern = /^\d{4}-\d{2}-\d{2}/;
  const weeklyPattern = /^\d{4}-W\d{2}/;
  const monthlyPattern = /^\d{4}-\d{2}$/;
  const quarterlyPattern = /^\d{4}-Q[1-4]$/;
  const yearlyPattern = /^\d{4}$/;

  if (dailyPattern.test(filename) && templates.daily) {
    templatePath = templates.daily;
  } else if (weeklyPattern.test(filename) && templates.weekly) {
    templatePath = templates.weekly;
  } else if (monthlyPattern.test(filename) && templates.monthly) {
    templatePath = templates.monthly;
  } else if (quarterlyPattern.test(filename) && templates.quarterly) {
    templatePath = templates.quarterly;
  } else if (yearlyPattern.test(filename) && templates.yearly) {
    templatePath = templates.yearly;
  }

  // Read template content or use minimal fallback
  let templateContent: string;
  if (templatePath) {
    try {
      const absTemplatePath = path.join(vaultPath, templatePath);
      templateContent = await fs.readFile(absTemplatePath, 'utf-8');
    } catch {
      // Template not readable, use fallback
      const title = path.basename(notePath, '.md');
      templateContent = `---\n---\n\n# ${title}\n`;
      templatePath = undefined;
    }
  } else {
    const title = path.basename(notePath, '.md');
    templateContent = `---\n---\n\n# ${title}\n`;
  }

  // Perform simple date substitution in templates
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  templateContent = templateContent
    .replace(/\{\{date\}\}/g, dateStr)
    .replace(/\{\{title\}\}/g, path.basename(notePath, '.md'));

  // Ensure frontmatter always contains a date field
  const matter = (await import('gray-matter')).default;
  const parsed = matter(templateContent);
  if (!parsed.data.date) {
    parsed.data.date = dateStr;
  }
  templateContent = matter.stringify(parsed.content, parsed.data);

  await fs.writeFile(fullPath, templateContent, 'utf-8');

  return { created: true, templateUsed: templatePath };
}

/**
 * Register mutation tools with the MCP server
 */
export function registerMutationTools(
  server: McpServer,
  vaultPath: string,
  getConfig: () => FlywheelConfig = () => ({})
): void {
  // ========================================
  // Tool: vault_add_to_section
  // ========================================
  server.tool(
    'vault_add_to_section',
    'Add content to a specific section in a markdown note. Set create_if_missing=true to auto-create the note from template if it doesn\'t exist (enables 1-call daily capture).\n\nExample: vault_add_to_section({ path: "daily/2026-02-15.md", section: "Log", content: "Met with team about Q1", format: "timestamp-bullet", create_if_missing: true })',
    {
      path: z.string().describe('Vault-relative path to the note (e.g., "daily-notes/2026-01-28.md")'),
      section: z.string().describe('Heading text to add to (e.g., "Log" or "## Log")'),
      content: z.string().describe('Content to add to the section'),
      create_if_missing: z.boolean().default(false).describe('If true and the note doesn\'t exist, create it from template first (enables 1-call daily capture)'),
      position: z.enum(['append', 'prepend']).default('append').describe('Where to insert content'),
      format: z
        .enum(['plain', 'bullet', 'task', 'numbered', 'timestamp-bullet'])
        .default('plain')
        .describe('How to format the content'),
      commit: z.boolean().default(false).describe('If true, commit this change to git (creates undo point)'),
      skipWikilinks: z.boolean().default(false).describe('If true, skip auto-wikilink application (wikilinks are applied by default)'),
      preserveListNesting: z.boolean().default(true).describe('Detect and preserve the indentation level of surrounding list items. Set false to disable.'),
      bumpHeadings: z.boolean().default(true).describe('Auto-bump heading levels in inserted content so they nest under the target section (e.g., ## in a ## section becomes ###). Set false to disable.'),
      suggestOutgoingLinks: z.boolean().default(true).describe('Append suggested outgoing wikilinks based on content (e.g., "→ [[AI]], [[Philosophy]]"). Set false to disable.'),
      maxSuggestions: z.number().min(1).max(10).default(3).describe('Maximum number of suggested wikilinks to append (1-10, default: 3)'),
      validate: z.boolean().default(true).describe('Check input for common issues (double timestamps, non-markdown bullets, etc.)'),
      normalize: z.boolean().default(true).describe('Auto-fix common issues before formatting (replace • with -, trim excessive whitespace, etc.)'),
      guardrails: z.enum(['warn', 'strict', 'off']).default('warn').describe('Output validation mode: "warn" returns issues but proceeds, "strict" blocks on errors, "off" disables'),
      linkedEntities: z.array(z.string()).optional().describe('Entity names already linked in the content. When skipWikilinks=true, these are tracked for feedback without re-processing the content.'),
      agent_id: z.string().optional().describe('Agent identifier for multi-agent scoping (e.g., "claude-opus", "planning-agent")'),
      session_id: z.string().optional().describe('Session identifier for conversation scoping (e.g., "sess-abc123")'),
    },
    async ({ path: notePath, section, content, create_if_missing, position, format, commit, skipWikilinks, preserveListNesting, bumpHeadings, suggestOutgoingLinks, maxSuggestions, validate, normalize, guardrails, linkedEntities, agent_id, session_id }) => {
      // Handle create_if_missing: create note from template before proceeding
      let noteCreated = false;
      let templateUsed: string | undefined;
      if (create_if_missing) {
        const fullPath = path.join(vaultPath, notePath);
        try {
          await fs.access(fullPath);
        } catch {
          // File doesn't exist - create it from template
          const config = getConfig();
          const result = await createNoteFromTemplate(vaultPath, notePath, config);
          noteCreated = result.created;
          templateUsed = result.templateUsed;
        }
      }

      return withVaultFile(
        {
          vaultPath,
          notePath,
          commit,
          commitPrefix: '[Flywheel:Add]',
          section,
          actionDescription: 'add content',
          scoping: agent_id || session_id ? { agent_id, session_id } : undefined,
        },
        async (ctx) => {
          // 1. Run validation pipeline on input
          const validationResult = runValidationPipeline(content, format as FormatType, {
            validate,
            normalize,
            guardrails: guardrails as GuardrailMode,
          });

          // If guardrails=strict and validation failed, abort
          if (validationResult.blocked) {
            throw new Error(validationResult.blockReason || 'Output validation failed');
          }

          // Use normalized content
          let workingContent = validationResult.content;

          // 2. Apply wikilinks to content (unless skipped)
          let { content: processedContent, wikilinkInfo } = maybeApplyWikilinks(workingContent, skipWikilinks, notePath);

          // Track explicitly-declared linked entities (when skipWikilinks=true)
          if (linkedEntities?.length) {
            const stateDb = getWriteStateDb();
            if (stateDb) {
              trackWikilinkApplications(stateDb, notePath, linkedEntities);
            }
          }

          // DEBUG: Capture entity index state for troubleshooting
          const _debug = {
            entityCount: getEntityIndexStats().totalEntities,
            indexReady: getEntityIndexStats().ready,
            skipWikilinks,
            wikilinkInfo: wikilinkInfo || 'none',
          };

          // 3. Suggest outgoing links (enabled by default)
          let suggestInfo: string | undefined;
          if (suggestOutgoingLinks && !skipWikilinks) {
            const result = await suggestRelatedLinks(processedContent, { maxSuggestions, notePath });
            if (result.suffix) {
              processedContent = processedContent + ' ' + result.suffix;
              suggestInfo = `Suggested: ${result.suggestions.join(', ')}`;
            }
          }

          // 4. Format the content
          const formattedContent = formatContent(processedContent, format as FormatType);

          // 5. Insert at position
          const updatedContent = insertInSection(
            ctx.content,
            ctx.sectionBoundary!,
            formattedContent,
            position as Position,
            { preserveListNesting, bumpHeadings }
          );

          // 6. Generate preview
          const infoLines = [wikilinkInfo, suggestInfo].filter(Boolean);
          const preview = formattedContent + (infoLines.length > 0 ? `\n(${infoLines.join('; ')})` : '');

          const createdInfo = noteCreated
            ? ` (note created${templateUsed ? ` from ${templateUsed}` : ' with minimal template'})`
            : '';

          return {
            updatedContent,
            message: `Added content to section "${ctx.sectionBoundary!.name}" in ${notePath}${createdInfo}`,
            preview,
            _debug,  // Temporary debug field for production troubleshooting
            warnings: validationResult.inputWarnings.length > 0 ? validationResult.inputWarnings : undefined,
            outputIssues: validationResult.outputIssues.length > 0 ? validationResult.outputIssues : undefined,
            normalizationChanges: validationResult.normalizationChanges.length > 0 ? validationResult.normalizationChanges : undefined,
          };
        }
      );
    }
  );

  // ========================================
  // Tool: vault_remove_from_section
  // ========================================
  server.tool(
    'vault_remove_from_section',
    'Remove content from a specific section in a markdown note',
    {
      path: z.string().describe('Vault-relative path to the note'),
      section: z.string().describe('Heading text to remove from (e.g., "Log" or "## Log")'),
      pattern: z.string().describe('Text or pattern to match for removal'),
      mode: z.enum(['first', 'last', 'all']).default('first').describe('Which matches to remove'),
      useRegex: z.boolean().default(false).describe('Treat pattern as regex'),
      commit: z.boolean().default(false).describe('If true, commit this change to git (creates undo point)'),
      agent_id: z.string().optional().describe('Agent identifier for multi-agent scoping'),
      session_id: z.string().optional().describe('Session identifier for conversation scoping'),
    },
    async ({ path: notePath, section, pattern, mode, useRegex, commit, agent_id, session_id }) => {
      return withVaultFile(
        {
          vaultPath,
          notePath,
          commit,
          commitPrefix: '[Flywheel:Remove]',
          section,
          actionDescription: 'remove content',
          scoping: agent_id || session_id ? { agent_id, session_id } : undefined,
        },
        async (ctx) => {
          // Remove matching content
          const removeResult = removeFromSection(
            ctx.content,
            ctx.sectionBoundary!,
            pattern,
            mode as MatchMode,
            useRegex
          );

          if (removeResult.removedCount === 0) {
            // Return early with error via formatMcpResult (throw won't give us the right message)
            throw new Error(`No content matching "${pattern}" found in section "${ctx.sectionBoundary!.name}"`);
          }

          return {
            updatedContent: removeResult.content,
            message: `Removed ${removeResult.removedCount} line(s) from section "${ctx.sectionBoundary!.name}" in ${notePath}`,
            preview: removeResult.removedLines.join('\n'),
          };
        }
      );
    }
  );

  // ========================================
  // Tool: vault_replace_in_section
  // ========================================
  server.tool(
    'vault_replace_in_section',
    'Replace content in a specific section in a markdown note',
    {
      path: z.string().describe('Vault-relative path to the note'),
      section: z.string().describe('Heading text to search in (e.g., "Log" or "## Log")'),
      search: z.string().describe('Text or pattern to search for'),
      replacement: z.string().describe('Text to replace with'),
      mode: z.enum(['first', 'last', 'all']).default('first').describe('Which matches to replace'),
      useRegex: z.boolean().default(false).describe('Treat search as regex'),
      commit: z.boolean().default(false).describe('If true, commit this change to git (creates undo point)'),
      skipWikilinks: z.boolean().default(false).describe('If true, skip auto-wikilink application on replacement text'),
      suggestOutgoingLinks: z.boolean().default(true).describe('Append suggested outgoing wikilinks based on content (e.g., "→ [[AI]], [[Philosophy]]"). Set false to disable.'),
      maxSuggestions: z.number().min(1).max(10).default(3).describe('Maximum number of suggested wikilinks to append (1-10, default: 3)'),
      validate: z.boolean().default(true).describe('Check input for common issues (double timestamps, non-markdown bullets, etc.)'),
      normalize: z.boolean().default(true).describe('Auto-fix common issues before formatting (replace • with -, trim excessive whitespace, etc.)'),
      guardrails: z.enum(['warn', 'strict', 'off']).default('warn').describe('Output validation mode: "warn" returns issues but proceeds, "strict" blocks on errors, "off" disables'),
      agent_id: z.string().optional().describe('Agent identifier for multi-agent scoping'),
      session_id: z.string().optional().describe('Session identifier for conversation scoping'),
    },
    async ({ path: notePath, section, search, replacement, mode, useRegex, commit, skipWikilinks, suggestOutgoingLinks, maxSuggestions, validate, normalize, guardrails, agent_id, session_id }) => {
      return withVaultFile(
        {
          vaultPath,
          notePath,
          commit,
          commitPrefix: '[Flywheel:Replace]',
          section,
          actionDescription: 'replace content',
          scoping: agent_id || session_id ? { agent_id, session_id } : undefined,
        },
        async (ctx) => {
          // 1. Run validation pipeline on replacement text
          const validationResult = runValidationPipeline(replacement, 'plain', {
            validate,
            normalize,
            guardrails: guardrails as GuardrailMode,
          });

          // If guardrails=strict and validation failed, abort
          if (validationResult.blocked) {
            throw new Error(validationResult.blockReason || 'Output validation failed');
          }

          // Use normalized replacement
          let workingReplacement = validationResult.content;

          // 2. Apply wikilinks to replacement text (unless skipped)
          let { content: processedReplacement } = maybeApplyWikilinks(workingReplacement, skipWikilinks, notePath);

          // 3. Suggest outgoing links (enabled by default)
          if (suggestOutgoingLinks && !skipWikilinks) {
            const result = await suggestRelatedLinks(processedReplacement, { maxSuggestions, notePath });
            if (result.suffix) {
              processedReplacement = processedReplacement + ' ' + result.suffix;
            }
          }

          // 4. Replace matching content
          const replaceResult = replaceInSection(
            ctx.content,
            ctx.sectionBoundary!,
            search,
            processedReplacement,
            mode as MatchMode,
            useRegex
          );

          if (replaceResult.replacedCount === 0) {
            // Build diagnostic with section content for actionable error
            const lines = ctx.content.split('\n');
            const boundary = ctx.sectionBoundary!;
            const sectionLines = lines.slice(boundary.contentStartLine, boundary.endLine + 1);
            const sectionContent = sectionLines.join('\n');

            const diagnostic = buildReplaceNotFoundDiagnostic(
              sectionContent,
              search,
              boundary.name,
              boundary.contentStartLine
            );

            throw new DiagnosticError(
              `No content matching "${search}" found in section "${boundary.name}"`,
              diagnostic
            );
          }

          // Generate preview showing before/after
          const previewLines = replaceResult.originalLines.map((orig, i) =>
            `- ${orig}\n+ ${replaceResult.newLines[i]}`
          );

          return {
            updatedContent: replaceResult.content,
            message: `Replaced ${replaceResult.replacedCount} occurrence(s) in section "${ctx.sectionBoundary!.name}" in ${notePath}`,
            preview: previewLines.join('\n'),
            warnings: validationResult.inputWarnings.length > 0 ? validationResult.inputWarnings : undefined,
            outputIssues: validationResult.outputIssues.length > 0 ? validationResult.outputIssues : undefined,
            normalizationChanges: validationResult.normalizationChanges.length > 0 ? validationResult.normalizationChanges : undefined,
          };
        }
      );
    }
  );
}
