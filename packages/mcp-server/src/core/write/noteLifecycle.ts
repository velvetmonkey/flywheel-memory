/**
 * Note create/delete lifecycle (arch-review S4).
 *
 * Moved verbatim from tools/write/note.ts so the single live implementation
 * (per-path lock + CAS critical section, preflight similarity, alias
 * collision warnings, prospect resolution, confirm-gated delete) lives in
 * core/write. The retired vault_create_note/vault_delete_note fork
 * (notes.ts) — which lacked the locking, CAS, FILE_EXISTS/WRITE_CONFLICT
 * codes, and prospect resolution — is deleted, not merged: live side is
 * canonical (council binding mod 1: the fork DIVERGED on these safety
 * valves; divergences resolved toward live, none silently adopted).
 *
 * Race/CAS contract pinned by test/write/core/note-race.test.ts BEFORE this
 * move (council binding mod 2).
 */

import { writeVaultFile, validatePath, validatePathSecure, sanitizeNotePath, injectMutationMetadata, WriteConflictError } from './writer.js';
import { withPathLock, pathLockKey } from './path-lock.js';
import {
  maybeApplyWikilinks,
  suggestRelatedLinks,
  detectAliasCollisions,
  suggestAliases,
  checkPreflightSimilarity,
} from './wikilinks.js';
import {
  handleGitCommit,
  formatMcpResult,
  errorResult,
  successResult,
  ensureFileExists,
} from './mutation-helpers.js';
import { getBacklinksForNote } from '../read/graph.js';
import type { VaultIndex } from '../read/types.js';
import type { ValidationWarning } from './types.js';
import { resolveProspectsForCreatedEntity } from '../shared/prospects.js';
import { extractAliases } from './noteMove.js';
import fs from 'fs/promises';
import path from 'path';

/** Thrown when a no-overwrite create loses the race to a concurrent creator. */
class FileExistsRace extends Error {
  constructor(notePath: string) {
    super(`File already exists: ${notePath}`);
    this.name = 'FileExistsRace';
  }
}

export async function handleCreate(
  params: {
    path: string;
    content?: string;
    frontmatter?: Record<string, unknown>;
    overwrite?: boolean;
    expectedHash?: string;
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
    expectedHash,
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

    const notePathValidation = await validatePathSecure(vaultPath, notePath);
    if (!notePathValidation.valid) {
      return formatMcpResult(errorResult(notePath, `Invalid path: ${notePathValidation.reason}`));
    }

    const fullPath = path.join(vaultPath, notePath);

    const existsCheck = await ensureFileExists(vaultPath, notePath);
    if (existsCheck === null && !overwrite) {
      return formatMcpResult(errorResult(notePath, `File already exists: ${notePath}. Use overwrite:true to replace.`, { code: 'FILE_EXISTS' }));
    }
    const fileExisted = existsCheck === null;

    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    let effectiveContent = content;
    let effectiveFrontmatter = rawFrontmatter;

    if (template) {
      // Validate template path before reading — prevents LFI / sensitive file read
      const templateValidation = await validatePathSecure(vaultPath, template);
      if (!templateValidation.valid) {
        return formatMcpResult(errorResult(notePath, `Invalid template path: ${templateValidation.reason}`));
      }
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

    // Per-path lock + CAS: a concurrent writer cannot slip between the
    // exists/hash check and the write (TOCTOU). Wikilinks were applied
    // above, before the lock — content-only work stays outside it.
    try {
      await withPathLock(pathLockKey(vaultPath, notePath), async () => {
        // Re-verify existence inside the lock when racing creators matter.
        if (!overwrite) {
          try {
            await fs.access(fullPath);
            throw new FileExistsRace(notePath);
          } catch (err) {
            if (err instanceof FileExistsRace) throw err;
            // ENOENT — good, proceed with create.
          }
        }
        await writeVaultFile(
          vaultPath,
          notePath,
          processedContent,
          finalFrontmatter,
          'LF',
          overwrite && fileExisted ? expectedHash : undefined,
        );
      });
    } catch (err) {
      if (err instanceof FileExistsRace) {
        return formatMcpResult(errorResult(notePath, `File already exists: ${notePath}. Use overwrite:true to replace.`, { code: 'FILE_EXISTS' }));
      }
      if (err instanceof WriteConflictError) {
        return formatMcpResult(errorResult(notePath, err.message, { code: 'WRITE_CONFLICT' }));
      }
      throw err;
    }

    const resolvedProspects = resolveProspectsForCreatedEntity(
      notePath,
      noteName,
      extractAliases(finalFrontmatter),
    );
    const gitInfo = await handleGitCommit(vaultPath, notePath, commit, '[Flywheel:Create]');

    return formatMcpResult(
      successResult(notePath, `Created note: ${notePath}`, gitInfo, {
        preview: previewLines.join('\n'),
        warnings: warnings.length > 0 ? warnings : undefined,
        prospect_resolution: resolvedProspects.length > 0
          ? {
              resolved_terms: resolvedProspects,
              status: 'entity_created',
              resolved_entity_path: notePath,
            }
          : undefined,
      } as any)
    );
  } catch (error) {
    return formatMcpResult(
      errorResult(rawNotePath, `Failed to create note: ${error instanceof Error ? error.message : String(error)}`)
    );
  }
}

export async function handleDelete(
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
