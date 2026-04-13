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
  validatePathSecure,
  type MatchMode,
} from '../../core/write/writer.js';
import type { FormatType, Position } from '../../core/write/types.js';
import {
  runValidationPipeline,
  type GuardrailMode,
} from '../../core/write/validator.js';
import { maybeApplyWikilinks, suggestRelatedLinks, getWriteStateDb } from '../../core/write/wikilinks.js';
import { trackWikilinkApplications } from '../../core/write/wikilinkFeedback.js';
import {
  withVaultFile,
  formatMcpResult,
  errorResult,
  successResult,
  handleGitCommit,
} from '../../core/write/mutation-helpers.js';
import type { FlywheelConfig } from '../../core/read/config.js';
import { sanitizeForObsidian, indentContinuation } from '../../core/write/markdown-structure.js';

/**
 * Create a note from template or minimal fallback.
 * Returns the path that was created.
 */
export async function createNoteFromTemplate(
  vaultPath: string,
  notePath: string,
  config: FlywheelConfig
): Promise<{ created: boolean; templateUsed?: string }> {
  // Validate path before any filesystem operations (secure: follows symlinks, blocks sensitive files)
  const validation = await validatePathSecure(vaultPath, notePath);
  if (!validation.valid) {
    throw new Error(`Path blocked: ${validation.reason}`);
  }

  const fullPath = path.join(vaultPath, notePath);

  // Ensure parent directories exist
  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  // Try to find a matching template
  const templates = config.templates || {};
  const filename = path.basename(notePath, '.md').toLowerCase();

  // Determine which type of periodic note this might be
  let templatePath: string | undefined;
  let periodicType: string | undefined;
  const dailyPattern = /^\d{4}-\d{2}-\d{2}/;
  const weeklyPattern = /^\d{4}-W\d{2}/;
  const monthlyPattern = /^\d{4}-\d{2}$/;
  const quarterlyPattern = /^\d{4}-Q[1-4]$/;
  const yearlyPattern = /^\d{4}$/;

  if (dailyPattern.test(filename)) {
    templatePath = templates.daily;
    periodicType = 'daily';
  } else if (weeklyPattern.test(filename)) {
    templatePath = templates.weekly;
    periodicType = 'weekly';
  } else if (monthlyPattern.test(filename)) {
    templatePath = templates.monthly;
    periodicType = 'monthly';
  } else if (quarterlyPattern.test(filename)) {
    templatePath = templates.quarterly;
    periodicType = 'quarterly';
  } else if (yearlyPattern.test(filename)) {
    templatePath = templates.yearly;
    periodicType = 'yearly';
  }

  // If config didn't have the template path, scan common locations as fallback
  if (!templatePath && periodicType) {
    const candidates = [
      `templates/${periodicType}.md`,
      `templates/${periodicType[0].toUpperCase() + periodicType.slice(1)}.md`,
      `templates/${periodicType}-note.md`,
      `templates/${periodicType[0].toUpperCase() + periodicType.slice(1)} Note.md`,
    ];
    for (const candidate of candidates) {
      try {
        await fs.access(path.join(vaultPath, candidate));
        templatePath = candidate;
        console.error(`[Flywheel] Template not in config but found at ${candidate} — using it`);
        break;
      } catch { /* not found, try next */ }
    }
  }

  // Read template content or use minimal fallback
  let templateContent: string;
  if (templatePath) {
    try {
      const absTemplatePath = path.join(vaultPath, templatePath);
      templateContent = await fs.readFile(absTemplatePath, 'utf-8');
    } catch {
      // Template not readable, use fallback
      console.error(`[Flywheel] Template at ${templatePath} not readable, using minimal fallback`);
      const title = path.basename(notePath, '.md');
      templateContent = `---\n---\n\n# ${title}\n`;
      templatePath = undefined;
    }
  } else {
    if (periodicType) {
      console.error(`[Flywheel] No ${periodicType} template found in config or vault — using minimal fallback`);
    }
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
  // Write via secure writeVaultFile (validates path + blocks sensitive files)
  await writeVaultFile(vaultPath, notePath, parsed.content, parsed.data as Record<string, unknown>);

  return { created: true, templateUsed: templatePath };
}

/**
 * Register mutation tools with the MCP server
 */
export function registerMutationTools(
  server: McpServer,
  getVaultPath: () => string,
  getConfig: () => FlywheelConfig = () => ({})
): void {
  // ========================================
  // Tool: vault_add_to_section
  // ========================================
  server.tool(
    'vault_add_to_section',
    'Use when appending content to a section in an existing note. Produces a markdown insertion under the named heading with auto-wikilinks applied. Returns mutation result with note path and section name. Does not create the note unless create_if_missing is true. Does not replace existing content — use vault_replace_in_section for that.',
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
      suggestOutgoingLinks: z.boolean().default(false).describe('Suggest related outgoing wikilinks based on content (e.g., "→ [[AI]], [[Philosophy]]"). Off by default — set true for daily notes, journals, or capture-heavy contexts.'),
      children: z.array(z.object({
        label: z.string().describe('Bold label, e.g. "**Result:**"'),
        content: z.string().describe('Pre-neutralized text; sanitized and indented by this tool'),
      })).optional().describe('Labeled sub-bullets appended under the parent content line'),
      maxSuggestions: z.number().min(1).max(10).default(5).describe('Maximum number of suggested wikilinks (1-10, default: 5)'),
      linkedEntities: z.array(z.string()).optional().describe('Entity names already linked in the content. When skipWikilinks=true, these are tracked for feedback without re-processing the content.'),
      dry_run: z.boolean().optional().default(false).describe('Preview changes without writing to disk'),
      agent_id: z.string().optional().describe('Agent identifier for multi-agent scoping (e.g., "claude-opus", "planning-agent")'),
      session_id: z.string().optional().describe('Session identifier for conversation scoping (e.g., "sess-abc123")'),
    },
    async ({ path: notePath, section, content, create_if_missing, position, format, commit, skipWikilinks, suggestOutgoingLinks, children, maxSuggestions, linkedEntities, dry_run, agent_id, session_id }) => {
      const vaultPath = getVaultPath();
      const preserveListNesting = true;
      const bumpHeadings = true;
      const validate = true;
      const normalize = true;
      const guardrails = 'warn' as const;
      // Handle create_if_missing: create note from template before proceeding
      let noteCreated = false;
      let templateUsed: string | undefined;
      if (create_if_missing && !dry_run) {
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

      // dry_run + create_if_missing: preview without creating
      if (create_if_missing && dry_run) {
        const fullPath = path.join(vaultPath, notePath);
        try {
          await fs.access(fullPath);
        } catch {
          // File doesn't exist — in dry_run mode, just preview what would happen
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(successResult(notePath, `[dry run] Would create note and add to section "${section}"`, {}, {
                preview: content,
              }), null, 2),
            }],
          };
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
          dryRun: dry_run,
          autoCreateSection: noteCreated,
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
          // Pass existing note content so entities already linked in prior sections
          // are treated as already seen, preventing duplicate links across calls.
          let { content: processedContent, wikilinkInfo } = maybeApplyWikilinks(workingContent, skipWikilinks, notePath, ctx.content);

          // Track explicitly-declared linked entities (when skipWikilinks=true)
          if (linkedEntities?.length) {
            const stateDb = getWriteStateDb();
            if (stateDb) {
              trackWikilinkApplications(stateDb, notePath, linkedEntities);
            }
          }

          // 2.5. If children are provided, assemble structured block and override format
          // Build: top-level bullet with summary, nested child bullets with labels
          let finalContent = processedContent;
          let finalFormat: FormatType = format as FormatType;
          let childTextsForLinks: string[] = [];

          if (children && children.length > 0) {
            const childBlocks = children.map(({ label, content: childContent }) => {
              const sanitized = sanitizeForObsidian(childContent);
              const processed = indentContinuation(sanitized);
              const lines = processed.split('\n');
              if (/^\s*(```|~~~)/.test(lines[0])) {
                return [`  - ${label}`, ...lines.map(l => `  ${l}`)].join('\n');
              }
              return [`- ${label} ${lines[0]}`, ...lines.slice(1)].map(l => `  ${l}`).join('\n');
            });
            finalContent = `- ${processedContent}\n${childBlocks.join('\n')}`;
            finalFormat = 'plain';
            childTextsForLinks = children.map(c => c.content);
          }

          // 3. Suggest outgoing links when explicitly enabled
          let suggestInfo: string | undefined;
          if (suggestOutgoingLinks && !skipWikilinks) {
            const suggestionText = childTextsForLinks.length > 0
              ? childTextsForLinks.join(' ')
              : processedContent;
            const result = await suggestRelatedLinks(suggestionText, { maxSuggestions, notePath });
            if (result.suffix) {
              // Only append suggestion suffix to the block that will be inserted
              // If children present, add to end of the assembled finalContent; otherwise to processedContent
              if (childTextsForLinks.length > 0) {
                finalContent = finalContent + ' ' + result.suffix;
              } else {
                processedContent = processedContent + ' ' + result.suffix;
                finalContent = processedContent;
              }
              suggestInfo = `Suggested: ${result.suggestions.join(', ')}`;
            }
          }

          // 4. Format the content
          const formattedContent = formatContent(finalContent, finalFormat);

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
    'Use when deleting specific text from a section in a note. Produces a targeted removal of matching content under the named heading. Returns mutation result with note path and removal confirmation. Does not remove the heading itself or other sections.',
    {
      path: z.string().describe('Vault-relative path to the note'),
      section: z.string().describe('Heading text to remove from (e.g., "Log" or "## Log")'),
      pattern: z.string().describe('Text or pattern to match for removal'),
      mode: z.enum(['first', 'last', 'all']).default('first').describe('Which matches to remove'),
      useRegex: z.boolean().default(false).describe('Treat pattern as regex'),
      commit: z.boolean().default(false).describe('If true, commit this change to git (creates undo point)'),
      dry_run: z.boolean().optional().default(false).describe('Preview changes without writing to disk'),
      agent_id: z.string().optional().describe('Agent identifier for multi-agent scoping'),
      session_id: z.string().optional().describe('Session identifier for conversation scoping'),
    },
    async ({ path: notePath, section, pattern, mode, useRegex, commit, dry_run, agent_id, session_id }) => {
      const vaultPath = getVaultPath();
      return withVaultFile(
        {
          vaultPath,
          notePath,
          commit,
          commitPrefix: '[Flywheel:Remove]',
          section,
          actionDescription: 'remove content',
          scoping: agent_id || session_id ? { agent_id, session_id } : undefined,
          dryRun: dry_run,
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
    'Use when swapping content in a section of a note. Produces a find-and-replace within the named heading with auto-wikilinks on the new text. Returns mutation result with note path and replacement confirmation. Does not affect other sections or headings.',
    {
      path: z.string().describe('Vault-relative path to the note'),
      section: z.string().describe('Heading text to search in (e.g., "Log" or "## Log")'),
      search: z.string().describe('Text or pattern to search for'),
      replacement: z.string().describe('Text to replace with'),
      mode: z.enum(['first', 'last', 'all']).default('first').describe('Which matches to replace'),
      useRegex: z.boolean().default(false).describe('Treat search as regex'),
      commit: z.boolean().default(false).describe('If true, commit this change to git (creates undo point)'),
      skipWikilinks: z.boolean().default(false).describe('If true, skip auto-wikilink application on replacement text'),
      suggestOutgoingLinks: z.boolean().default(false).describe('Suggest related outgoing wikilinks based on content (e.g., "→ [[AI]], [[Philosophy]]"). Off by default — set true for daily notes, journals, or capture-heavy contexts.'),
      maxSuggestions: z.number().min(1).max(10).default(5).describe('Maximum number of suggested wikilinks (1-10, default: 5)'),
      dry_run: z.boolean().optional().default(false).describe('Preview changes without writing to disk'),
      agent_id: z.string().optional().describe('Agent identifier for multi-agent scoping'),
      session_id: z.string().optional().describe('Session identifier for conversation scoping'),
    },
    async ({ path: notePath, section, search, replacement, mode, useRegex, commit, skipWikilinks, suggestOutgoingLinks, maxSuggestions, dry_run, agent_id, session_id }) => {
      const vaultPath = getVaultPath();
      const validate = true;
      const normalize = true;
      const guardrails = 'warn' as const;
      return withVaultFile(
        {
          vaultPath,
          notePath,
          commit,
          commitPrefix: '[Flywheel:Replace]',
          section,
          actionDescription: 'replace content',
          scoping: agent_id || session_id ? { agent_id, session_id } : undefined,
          dryRun: dry_run,
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
          let { content: processedReplacement } = maybeApplyWikilinks(workingReplacement, skipWikilinks, notePath, ctx.content);

          // 3. Suggest outgoing links when explicitly enabled
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
