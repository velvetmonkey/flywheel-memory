/**
 * Merged edit_section tool for Flywheel Memory
 * Tool: edit_section
 *
 * Discriminated union on action: add | remove | replace
 * Absorbs: vault_add_to_section, vault_remove_from_section, vault_replace_in_section
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
  readVaultFile,
  writeVaultFile,
  findSection,
  DiagnosticError,
  buildReplaceNotFoundDiagnostic,
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
  handleGitCommit,
  formatMcpResult,
  errorResult,
  successResult,
  type McpResponse,
} from '../../core/write/mutation-helpers.js';
import type { FlywheelConfig } from '../../core/read/config.js';
import { sanitizeForObsidian, indentContinuation } from '../../core/write/markdown-structure.js';
import { createNoteFromTemplate } from './mutations.js';

const SHARD_INDEX_WIDTH = 3;

interface ShardOptions {
  enabled?: boolean;
  pattern?: string;
  maxBytes?: number;
  maxEntries?: number;
  mode?: 'audit';
  lightIndex?: boolean;
}

interface ShardTarget {
  notePath: string;
  index: number;
  created: boolean;
}

function shardIndexString(index: number): string {
  return String(index).padStart(SHARD_INDEX_WIDTH, '0');
}

function dateFromNotePath(notePath: string): string {
  return notePath.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? new Date().toISOString().split('T')[0];
}

function countAuditEntries(content: string): number {
  return content.match(/^\s*(?:-\s+)?\*\*\d{2}:\d{2}\*\*/gm)?.length ?? 0;
}

function shardPath(pattern: string, date: string, index: number): string {
  return pattern
    .replace(/\{date\}/g, date)
    .replace(/\{index\}/g, shardIndexString(index));
}

async function shardWithinLimits(vaultPath: string, notePath: string, maxBytes: number, maxEntries: number): Promise<boolean> {
  try {
    const fullPath = path.join(vaultPath, notePath);
    const stats = await fs.stat(fullPath);
    if (stats.size >= maxBytes) return false;
    const raw = await fs.readFile(fullPath, 'utf-8');
    return countAuditEntries(raw) < maxEntries;
  } catch (err: any) {
    if (err.code === 'ENOENT') return true;
    throw err;
  }
}

async function resolveShardTarget(
  vaultPath: string,
  canonicalNotePath: string,
  options: ShardOptions
): Promise<ShardTarget> {
  const date = dateFromNotePath(canonicalNotePath);
  const pattern = options.pattern || 'daily-notes/logs/{date}-audit-{index}.md';
  const maxBytes = options.maxBytes || 262_144;
  const maxEntries = options.maxEntries || 250;

  for (let index = 1; index < 10_000; index++) {
    const current = shardPath(pattern, date, index);
    try {
      await fs.access(path.join(vaultPath, current));
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
      if (index === 1) return { notePath: current, index, created: true };

      const previous = shardPath(pattern, date, index - 1);
      if (await shardWithinLimits(vaultPath, previous, maxBytes, maxEntries)) {
        return { notePath: previous, index: index - 1, created: false };
      }
      return { notePath: current, index, created: true };
    }
  }

  throw new Error(`Shard index exhausted for ${canonicalNotePath}`);
}

async function ensureShardNote(vaultPath: string, canonicalNotePath: string, target: ShardTarget, options: ShardOptions): Promise<void> {
  if (!target.created) return;

  const date = dateFromNotePath(canonicalNotePath);
  const indexLabel = shardIndexString(target.index);
  await fs.mkdir(path.dirname(path.join(vaultPath, target.notePath)), { recursive: true });
  await writeVaultFile(
    vaultPath,
    target.notePath,
    '# Log\n',
    {
      type: 'daily-log-shard',
      date,
      parent: `[[${canonicalNotePath.replace(/\.md$/, '')}]]`,
      tags: ['#daily', '#audit-log'],
      shard: options.mode || 'audit',
      shard_index: target.index,
      // No skipWikilinks stamp: shards must stay eligible for on-write linking and the
      // background enrich pass (enrich.ts skips any note whose frontmatter sets it true).
      flywheel_indexing: options.lightIndex === false ? undefined : 'light',
      description: `Operational audit log shard ${indexLabel} for ${date}`,
    }
  );
  console.error(`[Flywheel] Created audit shard ${target.notePath}`);
}

async function linkShardFromCanonical(
  vaultPath: string,
  canonicalNotePath: string,
  section: string,
  target: ShardTarget
): Promise<void> {
  const { content, frontmatter, lineEnding, contentHash } = await readVaultFile(vaultPath, canonicalNotePath);
  const indexLabel = shardIndexString(target.index);
  const shardLink = `[[${target.notePath.replace(/\.md$/, '')}|Audit log shard ${indexLabel}]]`;
  if (content.includes(shardLink)) return;

  const sectionResult = findSection(content, section);
  if (!sectionResult) return;

  const formattedContent = formatContent(shardLink, 'bullet');
  const updatedContent = insertInSection(
    content,
    sectionResult,
    formattedContent,
    'append',
    { preserveListNesting: true, bumpHeadings: true }
  );
  await writeVaultFile(vaultPath, canonicalNotePath, updatedContent, frontmatter, lineEnding, contentHash);
}

/**
 * Register the merged `edit_section` tool with the MCP server.
 */
export function registerEditSectionTool(
  server: McpServer,
  getVaultPath: () => string,
  getConfig: () => FlywheelConfig = () => ({})
): void {
  server.tool(
    'edit_section',
    'Edit content inside a named section of a vault note. action: add — append/prepend under the heading (auto-wikilinks). action: remove — delete matching text. action: replace — find-and-replace within the section. Returns mutation result with path, section, preview. Does not touch other sections.',
    {
      action: z.enum(['add', 'remove', 'replace']).describe(
        'Operation to perform: add | remove | replace'
      ),
      path: z.string().describe(
        'Vault-relative path to the note (e.g., "daily-notes/2026-01-28.md")'
      ),
      section: z.string().describe(
        'Heading text to edit (e.g., "Log" or "## Log")'
      ),

      // add-only params
      content: z.string().optional().describe('[add] Content to insert under the section'),
      create_if_missing: z.boolean().optional().describe(
        '[add] If true and the note does not exist, create it from template first'
      ),
      position: z.enum(['append', 'prepend']).optional().describe(
        '[add] Where to insert content (default: append)'
      ),
      format: z
        .enum(['plain', 'bullet', 'task', 'numbered', 'timestamp-bullet'])
        .optional()
        .describe('[add] How to format the content (default: plain)'),
      skipWikilinks: z.boolean().optional().describe(
        '[add|replace] If true, skip auto-wikilink application'
      ),
      suggestOutgoingLinks: z.boolean().optional().describe(
        '[add|replace] Append suggested outgoing wikilinks based on content'
      ),
      maxSuggestions: z.number().min(1).max(10).optional().describe(
        '[add|replace] Maximum number of suggested wikilinks (1-10, default: 5)'
      ),
      children: z.array(z.object({
        label: z.string().describe('Bold label, e.g. "**Result:**"'),
        content: z.string().describe('Pre-neutralized text; sanitized and indented by this tool'),
      })).optional().describe('[add] Labeled sub-bullets appended under the parent content line'),
      linkedEntities: z.array(z.string()).optional().describe(
        '[add] Entity names already linked in the content. When skipWikilinks=true, these are tracked for feedback without re-processing.'
      ),
      shard: z.object({
        enabled: z.boolean().optional(),
        pattern: z.string().optional(),
        maxBytes: z.number().min(1024).optional(),
        maxEntries: z.number().min(1).optional(),
        mode: z.literal('audit').optional(),
        lightIndex: z.boolean().optional(),
      }).optional().describe(
        '[add] Route append-only operational content into bounded shard notes and link them from the requested note'
      ),

      // remove-only params
      pattern: z.string().optional().describe(
        '[remove] Text or pattern to match for removal'
      ),

      // replace-only params
      search: z.string().optional().describe(
        '[replace] Text or pattern to search for'
      ),
      replacement: z.string().optional().describe(
        '[replace] Text to replace with'
      ),

      // shared remove|replace params
      mode: z.enum(['first', 'last', 'all']).optional().describe(
        '[remove|replace] Which matches to act on (default: first)'
      ),
      useRegex: z.boolean().optional().describe(
        '[remove|replace] Treat pattern/search as regex'
      ),

      // shared universal params
      commit: z.boolean().optional().describe('If true, commit this change to git (creates undo point)'),
      dry_run: z.boolean().optional().describe('Preview changes without writing to disk'),
      agent_id: z.string().optional().describe('Agent identifier for multi-agent scoping'),
      session_id: z.string().optional().describe('Session identifier for conversation scoping'),
    },
    async (params) => {
      const { action, path: notePath } = params;

      // ── Runtime validation: required-by-action params ──────────────────
      if (action === 'add' && params.content === undefined) {
        return formatMcpResult(
          errorResult(notePath,
            'action=add requires content.\n' +
            'Example: { action: "add", path: "daily-notes/2026-01-28.md", section: "Log", content: "note text" }'
          )
        );
      }
      if (action === 'remove' && !params.pattern) {
        return formatMcpResult(
          errorResult(notePath,
            'action=remove requires pattern.\n' +
            'Example: { action: "remove", path: "daily-notes/2026-01-28.md", section: "Log", pattern: "old text" }'
          )
        );
      }
      if (action === 'replace' && (!params.search || params.replacement === undefined)) {
        return formatMcpResult(
          errorResult(notePath,
            'action=replace requires search and replacement.\n' +
            'Example: { action: "replace", path: "notes/foo.md", section: "Status", search: "draft", replacement: "final" }'
          )
        );
      }

      switch (action) {
        case 'add':     return handleAdd(params, getVaultPath, getConfig);
        case 'remove':  return handleRemove(params, getVaultPath);
        case 'replace': return handleReplace(params, getVaultPath);
      }
    }
  );
}

// ============================================================================
// Action handlers
// ============================================================================

async function handleAdd(
  params: {
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
  },
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
  params: {
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
    shard: ShardOptions;
    commit?: boolean;
    dry_run?: boolean;
    agent_id?: string;
    session_id?: string;
  },
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

async function handleRemove(
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

async function handleReplace(
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
