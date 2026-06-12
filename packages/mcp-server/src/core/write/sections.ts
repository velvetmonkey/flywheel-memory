/**
 * edit_section action handlers (arch-review S3).
 *
 * Moved verbatim from tools/write/editSection.ts so the section-mutation
 * pipeline (validation → wikilinks → children assembly → format → insert,
 * plus audit-shard routing) lives in core/write, leaving the tool file as
 * pure registration + dispatch. This is the single implementation — the
 * retired vault_add/remove/replace_in_section fork (mutations.ts) is gone.
 */

import fs from 'fs/promises';
import path from 'path';
import {
  formatContent,
  insertInSection,
  removeFromSection,
  replaceInSection,
  readVaultFile,
  writeVaultFile,
  findSection,
  DiagnosticError,
  buildReplaceNotFoundDiagnostic,
  type MatchMode,
} from './writer.js';
import type { FormatType, Position } from './types.js';
import {
  runValidationPipeline,
  type GuardrailMode,
} from './validator.js';
import { maybeApplyWikilinks, suggestRelatedLinks, getWriteStateDb } from './wikilinks.js';
import { trackWikilinkApplications } from './wikilinkFeedback.js';
import {
  withVaultFile,
  handleGitCommit,
  formatMcpResult,
  successResult,
  type McpResponse,
} from './mutation-helpers.js';
import type { FlywheelConfig } from '../read/types.js';
import { sanitizeForObsidian, indentContinuation } from './markdown-structure.js';
import { createNoteFromTemplate } from './noteTemplate.js';
import { resolveShardTarget, ensureShardNote, linkShardFromCanonical, type ShardOptions } from './auditShards.js';


export interface SectionAddParams {
  path: string;
  section: string;
  content?: string;
  create_if_missing?: boolean;
  position?: 'append' | 'prepend';
  format?: FormatType;
  skipWikilinks?: boolean;
  suggestOutgoingLinks?: boolean;
  maxSuggestions?: number;
  children?: Array<{ label: string; content: string }>;
  linkedEntities?: string[];
  shard?: ShardOptions;
  commit?: boolean;
  dry_run?: boolean;
  agent_id?: string;
  session_id?: string;
}

// ============================================================================
// Action handlers
// ============================================================================

export async function handleAdd(
  params: SectionAddParams,
  getVaultPath: () => string,
  getConfig: () => FlywheelConfig
): Promise<McpResponse> {
  const {
    path: notePath,
    section,
    content = '',
    create_if_missing = false,
    position = 'append',
    format = 'plain',
    skipWikilinks = false,
    suggestOutgoingLinks = false,
    maxSuggestions = 5,
    children,
    linkedEntities,
    shard,
    commit = false,
    dry_run = false,
    agent_id,
    session_id,
  } = params;

  const vaultPath = getVaultPath();
  const preserveListNesting = true;
  const bumpHeadings = true;
  const validate = true;
  const normalize = true;
  const guardrails = 'warn' as const;

  if (shard?.enabled && !dry_run) {
    return handleShardedAdd(
      {
        ...params,
        content,
        create_if_missing,
        position,
        format,
        skipWikilinks,
        suggestOutgoingLinks,
        maxSuggestions,
        children,
        linkedEntities,
        shard,
        commit,
        dry_run,
        agent_id,
        session_id,
      },
      getVaultPath,
      getConfig
    );
  }

  // Handle create_if_missing: create note from template before proceeding
  let noteCreated = false;
  let templateUsed: string | undefined;
  if (create_if_missing && !dry_run) {
    const fullPath = path.join(vaultPath, notePath);
    try {
      await fs.access(fullPath);
    } catch {
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
      return {
        content: [{
          type: 'text' as const,
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
      const validationResult = runValidationPipeline(content, format, {
        validate,
        normalize,
        guardrails: guardrails as GuardrailMode,
      });

      if (validationResult.blocked) {
        throw new Error(validationResult.blockReason || 'Output validation failed');
      }

      let workingContent = validationResult.content;

      // 2. Apply wikilinks to content (unless skipped)
      let { content: processedContent, wikilinkInfo } = maybeApplyWikilinks(workingContent, skipWikilinks, notePath, ctx.content);

      // Track explicitly-declared linked entities (when skipWikilinks=true)
      if (linkedEntities?.length) {
        const stateDb = getWriteStateDb();
        if (stateDb) {
          trackWikilinkApplications(stateDb, notePath, linkedEntities);
        }
      }

      // 2.5. If children are provided, assemble structured block and override format
      let finalContent = processedContent;
      let finalFormat: FormatType = format;
      let childTextsForLinks: string[] = [];

      if (children && children.length > 0) {
        const processedChildren = children.map(({ label, content: childContent }) => {
          const { content: processedChildContent } = maybeApplyWikilinks(childContent, skipWikilinks, notePath, ctx.content);
          return { label, content: processedChildContent };
        });
        const childBlocks = processedChildren.map(({ label, content: childContent }) => {
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
        childTextsForLinks = processedChildren.map(c => c.content);
      }

      // 3. Suggest outgoing links
      let suggestInfo: string | undefined;
      if (suggestOutgoingLinks && !skipWikilinks) {
        const suggestionText = childTextsForLinks.length > 0
          ? childTextsForLinks.join(' ')
          : processedContent;
        const result = await suggestRelatedLinks(suggestionText, { maxSuggestions, notePath });
        if (result.suffix) {
          if (childTextsForLinks.length > 0) {
            finalContent = `${finalContent}\n  ${result.suffix}`;
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

async function handleShardedAdd(
  params: SectionAddParams & { shard: ShardOptions },
  getVaultPath: () => string,
  getConfig: () => FlywheelConfig
): Promise<McpResponse> {
  const vaultPath = getVaultPath();
  const canonicalNotePath = params.path;

  if (params.create_if_missing) {
    try {
      await fs.access(path.join(vaultPath, canonicalNotePath));
    } catch {
      await createNoteFromTemplate(vaultPath, canonicalNotePath, getConfig());
    }
  }

  const target = await resolveShardTarget(vaultPath, canonicalNotePath, params.shard);
  await ensureShardNote(vaultPath, canonicalNotePath, target, params.shard);
  if (target.created) {
    await linkShardFromCanonical(vaultPath, canonicalNotePath, params.section, target);
  }

  const response: McpResponse = await handleAdd(
    {
      ...params,
      path: target.notePath,
      create_if_missing: false,
      // Honor the caller's linking intent for shard content instead of forcing it off.
      // mega-monkey passes skipWikilinks:false + suggestOutgoingLinks:true to keep the
      // audit-log graph-building even while sharding stays enabled.
      skipWikilinks: params.skipWikilinks ?? false,
      suggestOutgoingLinks: params.suggestOutgoingLinks ?? false,
      shard: undefined,
    },
    getVaultPath,
    getConfig
  );

  if (params.commit && target.created) {
    await handleGitCommit(vaultPath, canonicalNotePath, true, '[Flywheel:Add]');
  }

  const text = response.content[0].text;
  try {
    const result = JSON.parse(text);
    result.path = canonicalNotePath;
    result.shardPath = target.notePath;
    result.shardIndex = target.index;
    result.shardCreated = target.created;
    result.message = `${result.message} via shard ${target.notePath}`;
    return formatMcpResult(result);
  } catch {
    return response;
  }
}

export async function handleRemove(
  params: {
    path: string;
    section: string;
    pattern?: string;
    mode?: 'first' | 'last' | 'all';
    useRegex?: boolean;
    commit?: boolean;
    dry_run?: boolean;
    agent_id?: string;
    session_id?: string;
  },
  getVaultPath: () => string
) {
  const {
    path: notePath,
    section,
    pattern = '',
    mode = 'first',
    useRegex = false,
    commit = false,
    dry_run = false,
    agent_id,
    session_id,
  } = params;

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
      const removeResult = removeFromSection(
        ctx.content,
        ctx.sectionBoundary!,
        pattern,
        mode as MatchMode,
        useRegex
      );

      if (removeResult.removedCount === 0) {
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

export async function handleReplace(
  params: {
    path: string;
    section: string;
    search?: string;
    replacement?: string;
    mode?: 'first' | 'last' | 'all';
    useRegex?: boolean;
    skipWikilinks?: boolean;
    suggestOutgoingLinks?: boolean;
    maxSuggestions?: number;
    commit?: boolean;
    dry_run?: boolean;
    agent_id?: string;
    session_id?: string;
  },
  getVaultPath: () => string
) {
  const {
    path: notePath,
    section,
    search = '',
    replacement = '',
    mode = 'first',
    useRegex = false,
    skipWikilinks = false,
    suggestOutgoingLinks = false,
    maxSuggestions = 5,
    commit = false,
    dry_run = false,
    agent_id,
    session_id,
  } = params;

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

      if (validationResult.blocked) {
        throw new Error(validationResult.blockReason || 'Output validation failed');
      }

      let workingReplacement = validationResult.content;

      // 2. Apply wikilinks to replacement text (unless skipped)
      let { content: processedReplacement } = maybeApplyWikilinks(workingReplacement, skipWikilinks, notePath, ctx.content);

      // 3. Suggest outgoing links
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
