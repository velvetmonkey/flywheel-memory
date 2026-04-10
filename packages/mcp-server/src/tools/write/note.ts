/**
 * Merged note tool for Flywheel Memory
 * Tool: note
 *
 * Discriminated union on action: create | move | rename | delete
 * Absorbs: vault_create_note, vault_move_note, vault_rename_note, vault_delete_note
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { writeVaultFile, validatePath, sanitizeNotePath, injectMutationMetadata } from '../../core/write/writer.js';
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
import type { MutationResult } from '../../core/write/types.js';
import { commitChange } from '../../core/write/git.js';
import { initializeEntityIndex } from '../../core/write/wikilinks.js';
import {
  findBacklinks,
  updateBacklinksInFile,
  getTitleFromPath,
  extractAliases,
} from './move-notes.js';
import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';

/**
 * Register the merged `note` tool with the MCP server
 */
export function registerNoteTool(
  server: McpServer,
  getVaultPath: () => string,
  getIndex?: () => VaultIndex
): void {
  server.tool(
    'note',
    'Create, move, rename, or delete a vault note. action: create — new note with optional content and frontmatter. action: move — relocate note (rewires backlinks). action: rename — rename file (rewires wikilinks). action: delete — remove note (requires confirm:true). Returns mutation result with path and rewired backlinks. Does not edit note content.',
    {
      action: z.enum(['create', 'move', 'rename', 'delete']).describe(
        'Operation to perform: create | move | rename | delete'
      ),
      path: z.string().describe(
        'Vault-relative path of the note to act on (e.g., "projects/my-note.md")'
      ),

      // create-only params
      content: z.string().optional().describe('[create] Initial content for the note'),
      frontmatter: z.record(z.any()).optional().describe(
        '[create] Frontmatter fields (JSON object). Set type, aliases, description for best results.'
      ),
      overwrite: z.boolean().optional().describe('[create] If true, overwrite existing file'),
      template: z.string().optional().describe(
        '[create] Vault-relative path to a template file. Variables {{date}} and {{title}} are substituted.'
      ),
      skipWikilinks: z.boolean().optional().describe(
        '[create] If true, skip auto-wikilink application'
      ),
      suggestOutgoingLinks: z.boolean().optional().describe(
        '[create] Append suggested outgoing wikilinks based on content'
      ),
      maxSuggestions: z.number().min(1).max(10).optional().describe(
        '[create] Maximum number of suggested wikilinks to append (1-10, default: 5)'
      ),

      // move-only params
      destination: z.string().optional().describe(
        '[move] New vault-relative path to move the note to (e.g., "archive/my-note.md")'
      ),

      // rename-only params
      new_name: z.string().optional().describe(
        '[rename] New filename without extension (e.g., "better-title")'
      ),

      // delete-only params
      confirm: z.boolean().optional().describe(
        '[delete] Must be true to execute deletion (safety guard)'
      ),

      // shared optional params
      updateBacklinks: z.boolean().optional().describe(
        '[move|rename] If true (default), updates all backlinks pointing to this note'
      ),
      commit: z.boolean().optional().describe('If true, commit changes to git'),
      dry_run: z.boolean().optional().describe('Preview changes without writing to disk'),
      agent_id: z.string().optional().describe('[create] Agent identifier for multi-agent scoping'),
      session_id: z.string().optional().describe('[create] Session identifier for conversation scoping'),
    },
    async (params) => {
      const { action, path: rawPath } = params;

      // ── Runtime validation: required-by-action params ──────────────────
      if (action === 'move' && !params.destination) {
        return formatMcpResult(
          errorResult(rawPath,
            'action=move requires destination.\n' +
            'Example: { action: "move", path: "inbox/my-note.md", destination: "projects/my-note.md" }'
          )
        );
      }
      if (action === 'rename' && !params.new_name) {
        return formatMcpResult(
          errorResult(rawPath,
            'action=rename requires new_name.\n' +
            'Example: { action: "rename", path: "projects/old-title.md", new_name: "better-title" }'
          )
        );
      }
      if (action === 'delete' && params.confirm !== true) {
        return formatMcpResult(
          errorResult(rawPath,
            'action=delete requires confirm:true to execute.\n' +
            'Example: { action: "delete", path: "notes/my-note.md", confirm: true }\n' +
            'Use dry_run:true first to preview what will be deleted.'
          )
        );
      }

      switch (action) {
        case 'create': return handleCreate(params, getVaultPath);
        case 'move':   return handleMove(params, getVaultPath);
        case 'rename': return handleRename(params, getVaultPath);
        case 'delete': return handleDelete(params, getVaultPath, getIndex);
      }
    }
  );
}

// ============================================================================
// Action handlers
// ============================================================================

async function handleCreate(
  params: {
    path: string;
    content?: string;
    frontmatter?: Record<string, unknown>;
    overwrite?: boolean;
    template?: string;
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
    path: rawNotePath,
    content = '',
    frontmatter: rawFrontmatter = {},
    overwrite = false,
    template,
    skipWikilinks = false,
    suggestOutgoingLinks = false,
    maxSuggestions = 5,
    commit = false,
    dry_run = false,
    agent_id,
    session_id,
  } = params;

  try {
    const vaultPath = getVaultPath();
    const notePath = sanitizeNotePath(rawNotePath);

    if (!validatePath(vaultPath, notePath)) {
      return formatMcpResult(errorResult(notePath, 'Invalid path: path traversal not allowed'));
    }

    const fullPath = path.join(vaultPath, notePath);

    const existsCheck = await ensureFileExists(vaultPath, notePath);
    if (existsCheck === null && !overwrite) {
      return formatMcpResult(errorResult(notePath, `File already exists: ${notePath}. Use overwrite:true to replace.`));
    }

    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    let effectiveContent = content;
    let effectiveFrontmatter = rawFrontmatter;

    if (template) {
      const templatePath = path.join(vaultPath, template);
      try {
        const raw = await fs.readFile(templatePath, 'utf-8');
        const gm = (await import('gray-matter')).default;
        const parsed = gm(raw);
        const dateStr = new Date().toISOString().split('T')[0];
        const title = path.basename(notePath, '.md');
        let templateContent = parsed.content
          .replace(/\{\{date\}\}/g, dateStr)
          .replace(/\{\{title\}\}/g, title);
        if (content) {
          templateContent = templateContent.trimEnd() + '\n\n' + content;
        }
        effectiveContent = templateContent;
        effectiveFrontmatter = { ...(parsed.data || {}), ...rawFrontmatter };
      } catch {
        return formatMcpResult(errorResult(notePath, `Template not found: ${template}`));
      }
    }

    const now = new Date();
    if (!effectiveFrontmatter.date) effectiveFrontmatter.date = now.toISOString().split('T')[0];
    if (!effectiveFrontmatter.created) effectiveFrontmatter.created = now.toISOString();

    const warnings: ValidationWarning[] = [];
    const noteName = path.basename(notePath, '.md');
    const existingAliases: string[] = Array.isArray(effectiveFrontmatter?.aliases)
      ? effectiveFrontmatter.aliases.filter((a: unknown) => typeof a === 'string')
      : [];

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

    const collisions = detectAliasCollisions(noteName, existingAliases);
    for (const collision of collisions) {
      warnings.push({
        type: 'alias_collision',
        message: `${collision.source === 'name' ? 'Note name' : 'Alias'} "${collision.term}" collides with ${collision.collidedWith.matchType} of "${collision.collidedWith.name}" (${collision.collidedWith.path})`,
        suggestion: `This may cause ambiguous wikilink resolution`,
      });
    }

    let { content: processedContent, wikilinkInfo } = maybeApplyWikilinks(effectiveContent, skipWikilinks, notePath);

    let suggestInfo: string | undefined;
    if (suggestOutgoingLinks && !skipWikilinks) {
      const result = await suggestRelatedLinks(processedContent, { maxSuggestions, notePath });
      if (result.suffix) {
        processedContent = processedContent + ' ' + result.suffix;
        suggestInfo = `Suggested: ${result.suggestions.join(', ')}`;
      }
    }

    let finalFrontmatter = effectiveFrontmatter;
    if (agent_id || session_id) {
      finalFrontmatter = injectMutationMetadata(effectiveFrontmatter, { agent_id, session_id });
    }

    const infoLines = [wikilinkInfo, suggestInfo].filter(Boolean);
    const previewLines = [
      `Frontmatter fields: ${Object.keys(effectiveFrontmatter).join(', ') || 'none'}`,
      `Content length: ${processedContent.length} chars`,
    ];
    if (infoLines.length > 0) previewLines.push(`(${infoLines.join('; ')})`);

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

    if (dry_run) {
      return formatMcpResult(
        successResult(notePath, `[dry run] Would create note: ${notePath}`, {}, {
          preview: previewLines.join('\n'),
          warnings: warnings.length > 0 ? warnings : undefined,
          dryRun: true,
        })
      );
    }

    await writeVaultFile(vaultPath, notePath, processedContent, finalFrontmatter);
    const gitInfo = await handleGitCommit(vaultPath, notePath, commit, '[Flywheel:Create]');

    return formatMcpResult(
      successResult(notePath, `Created note: ${notePath}`, gitInfo, {
        preview: previewLines.join('\n'),
        warnings: warnings.length > 0 ? warnings : undefined,
      })
    );
  } catch (error) {
    return formatMcpResult(
      errorResult(rawNotePath, `Failed to create note: ${error instanceof Error ? error.message : String(error)}`)
    );
  }
}

async function handleMove(
  params: {
    path: string;
    destination?: string;
    updateBacklinks?: boolean;
    commit?: boolean;
    dry_run?: boolean;
  },
  getVaultPath: () => string
) {
  const {
    path: oldPath,
    destination: newPath = '',
    updateBacklinks = true,
    commit = false,
    dry_run = false,
  } = params;

  try {
    const vaultPath = getVaultPath();

    if (!validatePath(vaultPath, oldPath)) {
      const result: MutationResult = { success: false, message: 'Invalid source path: path traversal not allowed', path: oldPath };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
    if (!validatePath(vaultPath, newPath)) {
      const result: MutationResult = { success: false, message: 'Invalid destination path: path traversal not allowed', path: newPath };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }

    const oldFullPath = path.join(vaultPath, oldPath);
    const newFullPath = path.join(vaultPath, newPath);

    try { await fs.access(oldFullPath); } catch {
      const result: MutationResult = { success: false, message: `Source file not found: ${oldPath}`, path: oldPath };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }

    try {
      await fs.access(newFullPath);
      const result: MutationResult = { success: false, message: `Destination already exists: ${newPath}`, path: newPath };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch { /* destination doesn't exist — good */ }

    const sourceContent = await fs.readFile(oldFullPath, 'utf-8');
    const parsed = matter(sourceContent);
    const aliases = extractAliases(parsed.data);
    const oldTitle = getTitleFromPath(oldPath);
    const newTitle = getTitleFromPath(newPath);

    let backlinkCount = 0;
    const backlinkUpdates: Array<{ path: string; linksUpdated: number }> = [];

    if (updateBacklinks && oldTitle.toLowerCase() !== newTitle.toLowerCase()) {
      const backlinks = await findBacklinks(vaultPath, oldTitle, aliases);
      backlinkCount = backlinks.reduce((sum, b) => sum + b.links.length, 0);

      if (dry_run) {
        for (const bl of backlinks) {
          if (bl.path === oldPath) continue;
          backlinkUpdates.push({ path: bl.path, linksUpdated: bl.links.length });
        }
      } else {
        const allOldTitles = [oldTitle, ...aliases];
        for (const bl of backlinks) {
          if (bl.path === oldPath) continue;
          const upd = await updateBacklinksInFile(vaultPath, bl.path, allOldTitles, newTitle);
          if (upd.updated) backlinkUpdates.push({ path: bl.path, linksUpdated: upd.linksUpdated });
        }
      }
    }

    const updatedBacklinks = backlinkUpdates.reduce((sum, b) => sum + b.linksUpdated, 0);
    const previewLines = [`${dry_run ? 'Would move' : 'Moved'}: ${oldPath} → ${newPath}`];
    if (backlinkCount > 0) {
      previewLines.push(`Backlinks found: ${backlinkCount}`);
      previewLines.push(`Backlinks ${dry_run ? 'to update' : 'updated'}: ${updatedBacklinks}`);
      if (backlinkUpdates.length > 0) {
        previewLines.push(`Files ${dry_run ? 'to modify' : 'modified'}: ${backlinkUpdates.map(b => b.path).join(', ')}`);
      }
    } else {
      previewLines.push('No backlinks found');
    }

    if (dry_run) {
      const result: MutationResult = { success: true, message: `[dry run] Would move note: ${oldPath} → ${newPath}`, path: newPath, preview: previewLines.join('\n'), dryRun: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }

    await fs.mkdir(path.dirname(newFullPath), { recursive: true });
    await fs.rename(oldFullPath, newFullPath);

    let gitCommit: string | undefined;
    let undoAvailable: boolean | undefined;
    let staleLockDetected: boolean | undefined;
    let lockAgeMs: number | undefined;

    if (commit) {
      const filesToCommit = [newPath, ...backlinkUpdates.map(b => b.path)];
      const gitResult = await commitChange(vaultPath, filesToCommit.join(', '), `[Flywheel:Move] ${oldPath} → ${newPath}`);
      if (gitResult.success && gitResult.hash) { gitCommit = gitResult.hash; undoAvailable = gitResult.undoAvailable; }
      if (gitResult.staleLockDetected) { staleLockDetected = gitResult.staleLockDetected; lockAgeMs = gitResult.lockAgeMs; }
    }

    initializeEntityIndex(vaultPath).catch(err => console.error(`[Flywheel] Entity cache rebuild failed: ${err}`));

    const result: MutationResult = { success: true, message: `Moved note: ${oldPath} → ${newPath}`, path: newPath, preview: previewLines.join('\n'), gitCommit, undoAvailable, staleLockDetected, lockAgeMs };
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    const result: MutationResult = { success: false, message: `Failed to move note: ${error instanceof Error ? error.message : String(error)}`, path: oldPath };
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }
}

async function handleRename(
  params: {
    path: string;
    new_name?: string;
    updateBacklinks?: boolean;
    commit?: boolean;
    dry_run?: boolean;
  },
  getVaultPath: () => string
) {
  const {
    path: notePath,
    new_name: newTitle = '',
    updateBacklinks = true,
    commit = false,
    dry_run = false,
  } = params;

  try {
    const vaultPath = getVaultPath();

    if (!validatePath(vaultPath, notePath)) {
      const result: MutationResult = { success: false, message: 'Invalid path: path traversal not allowed', path: notePath };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }

    if (!newTitle || newTitle.trim() === '') {
      const result: MutationResult = { success: false, message: 'new_name cannot be empty', path: notePath };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }

    const sanitizedTitle = newTitle.replace(/[<>:"/\\|?*]/g, '');
    const fullPath = path.join(vaultPath, notePath);
    const dir = path.dirname(notePath);
    const newPath = dir === '.' ? `${sanitizedTitle}.md` : path.join(dir, `${sanitizedTitle}.md`);
    const newFullPath = path.join(vaultPath, newPath);

    try { await fs.access(fullPath); } catch {
      const result: MutationResult = { success: false, message: `File not found: ${notePath}`, path: notePath };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }

    if (fullPath !== newFullPath) {
      try {
        await fs.access(newFullPath);
        const result: MutationResult = { success: false, message: `A note with this title already exists: ${newPath}`, path: notePath };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch { /* good */ }
    }

    const sourceContent = await fs.readFile(fullPath, 'utf-8');
    const parsed = matter(sourceContent);
    const aliases = extractAliases(parsed.data);
    const oldTitle = getTitleFromPath(notePath);

    let backlinkCount = 0;
    const backlinkUpdates: Array<{ path: string; linksUpdated: number }> = [];

    if (updateBacklinks && oldTitle.toLowerCase() !== sanitizedTitle.toLowerCase()) {
      const backlinks = await findBacklinks(vaultPath, oldTitle, aliases);
      backlinkCount = backlinks.reduce((sum, b) => sum + b.links.length, 0);

      if (dry_run) {
        for (const bl of backlinks) {
          if (bl.path === notePath) continue;
          backlinkUpdates.push({ path: bl.path, linksUpdated: bl.links.length });
        }
      } else {
        const allOldTitles = [oldTitle, ...aliases];
        for (const bl of backlinks) {
          if (bl.path === notePath) continue;
          const upd = await updateBacklinksInFile(vaultPath, bl.path, allOldTitles, sanitizedTitle);
          if (upd.updated) backlinkUpdates.push({ path: bl.path, linksUpdated: upd.linksUpdated });
        }
      }
    }

    const updatedBacklinks = backlinkUpdates.reduce((sum, b) => sum + b.linksUpdated, 0);
    const previewLines = [`${dry_run ? 'Would rename' : 'Renamed'}: "${oldTitle}" → "${sanitizedTitle}"`];
    if (backlinkCount > 0) {
      previewLines.push(`Backlinks found: ${backlinkCount}`);
      previewLines.push(`Backlinks ${dry_run ? 'to update' : 'updated'}: ${updatedBacklinks}`);
      if (backlinkUpdates.length > 0) {
        previewLines.push(`Files ${dry_run ? 'to modify' : 'modified'}: ${backlinkUpdates.map(b => b.path).join(', ')}`);
      }
    } else {
      previewLines.push('No backlinks found');
    }

    if (dry_run) {
      const result: MutationResult = { success: true, message: `[dry run] Would rename note: ${oldTitle} → ${sanitizedTitle}`, path: newPath, preview: previewLines.join('\n'), dryRun: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }

    if (fullPath !== newFullPath) {
      await fs.rename(fullPath, newFullPath);
    }

    let gitCommit: string | undefined;
    let undoAvailable: boolean | undefined;
    let staleLockDetected: boolean | undefined;
    let lockAgeMs: number | undefined;

    if (commit) {
      const filesToCommit = [newPath, ...backlinkUpdates.map(b => b.path)];
      const gitResult = await commitChange(vaultPath, filesToCommit.join(', '), `[Flywheel:Rename] ${oldTitle} → ${sanitizedTitle}`);
      if (gitResult.success && gitResult.hash) { gitCommit = gitResult.hash; undoAvailable = gitResult.undoAvailable; }
      if (gitResult.staleLockDetected) { staleLockDetected = gitResult.staleLockDetected; lockAgeMs = gitResult.lockAgeMs; }
    }

    initializeEntityIndex(vaultPath).catch(err => console.error(`[Flywheel] Entity cache rebuild failed: ${err}`));

    const result: MutationResult = { success: true, message: `Renamed note: ${oldTitle} → ${sanitizedTitle}`, path: newPath, preview: previewLines.join('\n'), gitCommit, undoAvailable, staleLockDetected, lockAgeMs };
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    const result: MutationResult = { success: false, message: `Failed to rename note: ${error instanceof Error ? error.message : String(error)}`, path: notePath };
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }
}

async function handleDelete(
  params: {
    path: string;
    confirm?: boolean;
    commit?: boolean;
    dry_run?: boolean;
  },
  getVaultPath: () => string,
  getIndex?: () => VaultIndex
) {
  const { path: notePath, confirm = false, commit = false, dry_run = false } = params;

  try {
    const vaultPath = getVaultPath();

    if (!validatePath(vaultPath, notePath)) {
      return formatMcpResult(errorResult(notePath, 'Invalid path: path traversal not allowed'));
    }

    const existsError = await ensureFileExists(vaultPath, notePath);
    if (existsError) {
      return formatMcpResult(existsError);
    }

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
          if (backlinks.length > 10) backlinkWarning += `\n  ... and ${backlinks.length - 10} more`;
        }
      } catch { /* index may not be ready */ }
    }

    if (dry_run) {
      const previewLines = [`Would delete: ${notePath}`];
      if (backlinkWarning) { previewLines.push(''); previewLines.push('Warning: ' + backlinkWarning); }
      return formatMcpResult(
        successResult(notePath, `[dry run] Would delete note: ${notePath}`, {}, { preview: previewLines.join('\n'), dryRun: true })
      );
    }

    // confirm check already validated at top of tool handler, but guard here too
    if (!confirm) {
      const previewLines = ['Deletion requires explicit confirmation (confirm:true)'];
      if (backlinkWarning) { previewLines.push(''); previewLines.push('Warning: ' + backlinkWarning); }
      return formatMcpResult(errorResult(notePath, previewLines.join('\n')));
    }

    const fullPath = path.join(vaultPath, notePath);
    await fs.unlink(fullPath);

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
