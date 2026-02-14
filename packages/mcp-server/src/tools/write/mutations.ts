/**
 * Mutation tools for Flywheel Crank
 * Tools: vault_add_to_section, vault_remove_from_section, vault_replace_in_section
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  formatContent,
  insertInSection,
  removeFromSection,
  replaceInSection,
  type MatchMode,
} from '../../core/write/writer.js';
import type { FormatType, Position } from '../../core/write/types.js';
import {
  runValidationPipeline,
  type GuardrailMode,
} from '../../core/write/validator.js';
import { maybeApplyWikilinks, suggestRelatedLinks, getEntityIndexStats } from '../../core/write/wikilinks.js';
import {
  withVaultFile,
  formatMcpResult,
  errorResult,
} from '../../core/write/mutation-helpers.js';

/**
 * Register mutation tools with the MCP server
 */
export function registerMutationTools(
  server: McpServer,
  vaultPath: string
): void {
  // ========================================
  // Tool: vault_add_to_section
  // ========================================
  server.tool(
    'vault_add_to_section',
    'Add content to a specific section in a markdown note',
    {
      path: z.string().describe('Vault-relative path to the note (e.g., "daily-notes/2026-01-28.md")'),
      section: z.string().describe('Heading text to add to (e.g., "Log" or "## Log")'),
      content: z.string().describe('Content to add to the section'),
      position: z.enum(['append', 'prepend']).default('append').describe('Where to insert content'),
      format: z
        .enum(['plain', 'bullet', 'task', 'numbered', 'timestamp-bullet'])
        .default('plain')
        .describe('How to format the content'),
      commit: z.boolean().default(false).describe('If true, commit this change to git (creates undo point)'),
      skipWikilinks: z.boolean().default(false).describe('If true, skip auto-wikilink application (wikilinks are applied by default)'),
      preserveListNesting: z.boolean().default(true).describe('Detect and preserve the indentation level of surrounding list items. Set false to disable.'),
      suggestOutgoingLinks: z.boolean().default(true).describe('Append suggested outgoing wikilinks based on content (e.g., "→ [[AI]], [[Philosophy]]"). Set false to disable.'),
      maxSuggestions: z.number().min(1).max(10).default(3).describe('Maximum number of suggested wikilinks to append (1-10, default: 3)'),
      validate: z.boolean().default(true).describe('Check input for common issues (double timestamps, non-markdown bullets, etc.)'),
      normalize: z.boolean().default(true).describe('Auto-fix common issues before formatting (replace • with -, trim excessive whitespace, etc.)'),
      guardrails: z.enum(['warn', 'strict', 'off']).default('warn').describe('Output validation mode: "warn" returns issues but proceeds, "strict" blocks on errors, "off" disables'),
      agent_id: z.string().optional().describe('Agent identifier for multi-agent scoping (e.g., "claude-opus", "planning-agent")'),
      session_id: z.string().optional().describe('Session identifier for conversation scoping (e.g., "sess-abc123")'),
    },
    async ({ path: notePath, section, content, position, format, commit, skipWikilinks, preserveListNesting, suggestOutgoingLinks, maxSuggestions, validate, normalize, guardrails, agent_id, session_id }) => {
      return withVaultFile(
        {
          vaultPath,
          notePath,
          commit,
          commitPrefix: '[Crank:Add]',
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
            const result = suggestRelatedLinks(processedContent, { maxSuggestions, notePath });
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
            { preserveListNesting }
          );

          // 6. Generate preview
          const infoLines = [wikilinkInfo, suggestInfo].filter(Boolean);
          const preview = formattedContent + (infoLines.length > 0 ? `\n(${infoLines.join('; ')})` : '');

          return {
            updatedContent,
            message: `Added content to section "${ctx.sectionBoundary!.name}" in ${notePath}`,
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
          commitPrefix: '[Crank:Remove]',
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
          commitPrefix: '[Crank:Replace]',
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
            const result = suggestRelatedLinks(processedReplacement, { maxSuggestions, notePath });
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
            throw new Error(`No content matching "${search}" found in section "${ctx.sectionBoundary!.name}"`);
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
