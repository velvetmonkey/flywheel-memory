/**
 * Entity merge + alias absorption (arch-review S5).
 *
 * Single implementation, moved verbatim from the live entity tool's
 * merge/absorb branches (tools/write/entity.ts). The retired
 * merge_entities/absorb_as_alias fork (tools/write/merge.ts) is deleted,
 * not merged: live side is canonical (council G2 §7, codex #8–#11) —
 * response carries path: primary, 'Secondary/Primary file not found'
 * wording, legacy 'Invalid source/target path' validation labels, no
 * WriteConflictError catch, and mergeEntities takes no dry-run (the
 * registered schema never exposed one for merge; re-exposure is open
 * decision D2).
 *
 * Contract pinned by test/write/tools/entityMerge.test.ts BEFORE this move.
 */

import {
  validatePathSecure,
  readVaultFile,
  writeVaultFile,
  type LineEnding,
} from './writer.js';
import type { MutationResult } from './types.js';
import { initializeEntityIndex } from './wikilinks.js';
import {
  findBacklinks,
  updateBacklinksInFile,
  extractAliases,
} from './noteMove.js';
import { escapeRegex, getTitleFromPath } from './wikilinkText.js';
import fs from 'fs/promises';
import path from 'path';

export type EntityMergeResult = MutationResult & { backlinks_updated?: number; dryRun?: boolean };

/**
 * Merge the secondary entity note into the primary: union aliases, append
 * non-trivial secondary content under a "## Merged from" section, rewire
 * backlinks, write primary, delete secondary, kick a background entity
 * index rebuild.
 */
export async function mergeEntities(
  vaultPath: string,
  primary: string,
  secondary: string,
): Promise<EntityMergeResult> {
  const primaryValidation = await validatePathSecure(vaultPath, primary);
  if (!primaryValidation.valid) {
    return { success: false, message: `Invalid source path: ${primaryValidation.reason}`, path: primary };
  }
  const secondaryValidation = await validatePathSecure(vaultPath, secondary);
  if (!secondaryValidation.valid) {
    return { success: false, message: `Invalid target path: ${secondaryValidation.reason}`, path: secondary };
  }

  // Read secondary (source to absorb)
  let sourceContent: string;
  let sourceFrontmatter: Record<string, unknown>;
  try {
    const source = await readVaultFile(vaultPath, secondary);
    sourceContent = source.content;
    sourceFrontmatter = source.frontmatter;
  } catch {
    return { success: false, message: `Secondary file not found: ${secondary}`, path: secondary };
  }

  // Read primary (target to keep)
  let targetContent: string;
  let targetFrontmatter: Record<string, unknown>;
  let targetContentHash: string;
  try {
    const target = await readVaultFile(vaultPath, primary);
    targetContent = target.content;
    targetFrontmatter = target.frontmatter;
    targetContentHash = target.contentHash;
  } catch {
    return { success: false, message: `Primary file not found: ${primary}`, path: primary };
  }

  const sourceTitle = getTitleFromPath(secondary);
  const targetTitle = getTitleFromPath(primary);

  // Add source title and aliases to primary's aliases
  const existingAliases = extractAliases(targetFrontmatter);
  const sourceAliases = extractAliases(sourceFrontmatter);
  const allNewAliases = [sourceTitle, ...sourceAliases];
  const deduped = new Set([...existingAliases]);
  for (const a of allNewAliases) {
    if (a.toLowerCase() !== targetTitle.toLowerCase()) {
      deduped.add(a);
    }
  }
  targetFrontmatter.aliases = Array.from(deduped);

  // Append secondary content if non-trivial
  const trimmedSource = sourceContent.trim();
  if (trimmedSource.length > 10) {
    const mergedSection = `\n\n## Merged from ${sourceTitle}\n\n${trimmedSource}`;
    targetContent = targetContent.trimEnd() + mergedSection;
  }

  // Rewire backlinks from secondary → primary
  const allSourceTitles = [sourceTitle, ...sourceAliases];
  const backlinks = await findBacklinks(vaultPath, sourceTitle, sourceAliases);
  let totalBacklinksUpdated = 0;
  const modifiedFiles: string[] = [];

  for (const backlink of backlinks) {
    if (backlink.path === secondary || backlink.path === primary) continue;
    const updateResult = await updateBacklinksInFile(vaultPath, backlink.path, allSourceTitles, targetTitle);
    if (updateResult.updated) {
      totalBacklinksUpdated += updateResult.linksUpdated;
      modifiedFiles.push(backlink.path);
    }
  }

  // Write updated primary
  await writeVaultFile(vaultPath, primary, targetContent, targetFrontmatter, 'LF', targetContentHash);

  // Delete secondary
  await fs.unlink(`${vaultPath}/${secondary}`);

  // Rebuild entity index in background
  initializeEntityIndex(vaultPath).catch(err => {
    console.error(`[Flywheel] Entity cache rebuild failed: ${err}`);
  });

  const previewLines = [
    `Merged: "${sourceTitle}" → "${targetTitle}"`,
    `Aliases added: ${allNewAliases.join(', ')}`,
    `Source content appended: ${trimmedSource.length > 10 ? 'yes' : 'no'}`,
    `Backlinks updated: ${totalBacklinksUpdated}`,
  ];
  if (modifiedFiles.length > 0) {
    previewLines.push(`Files modified: ${modifiedFiles.join(', ')}`);
  }

  return {
    success: true,
    message: `Merged "${sourceTitle}" into "${targetTitle}"`,
    path: primary,
    preview: previewLines.join('\n'),
    backlinks_updated: totalBacklinksUpdated,
  };
}

/**
 * Absorb a free-standing name as an alias of the target entity: add the
 * alias, rewrite [[source]] backlinks to point at the target (preserving
 * display text), delete the source's own note if one exists. Supports
 * dryRun preview.
 */
export async function absorbAlias(
  vaultPath: string,
  source_name: string,
  target_path: string,
  dry_run: boolean,
): Promise<EntityMergeResult> {
  const absorbTargetValidation = await validatePathSecure(vaultPath, target_path);
  if (!absorbTargetValidation.valid) {
    return { success: false, message: `Invalid target path: ${absorbTargetValidation.reason}`, path: target_path };
  }

  let targetContent: string;
  let targetFrontmatter: Record<string, unknown>;
  let absorbTargetHash: string;
  try {
    const target = await readVaultFile(vaultPath, target_path);
    targetContent = target.content;
    targetFrontmatter = target.frontmatter;
    absorbTargetHash = target.contentHash;
  } catch {
    return { success: false, message: `Target file not found: ${target_path}`, path: target_path };
  }

  const targetTitle = getTitleFromPath(target_path);
  const existingAliases = extractAliases(targetFrontmatter);
  const deduped = new Set(existingAliases);
  if (source_name.toLowerCase() !== targetTitle.toLowerCase()) {
    deduped.add(source_name);
  }
  targetFrontmatter.aliases = Array.from(deduped);

  const backlinks = await findBacklinks(vaultPath, source_name, []);
  let totalBacklinksUpdated = 0;
  const modifiedFiles: string[] = [];
  const sourceNoteFile = await findSourceNote(vaultPath, source_name, target_path);

  if (dry_run) {
    for (const backlink of backlinks) {
      if (backlink.path === target_path) continue;
      totalBacklinksUpdated += backlink.links.length;
      modifiedFiles.push(backlink.path);
    }
  } else {
    await writeVaultFile(vaultPath, target_path, targetContent, targetFrontmatter, 'LF', absorbTargetHash);

    for (const backlink of backlinks) {
      if (backlink.path === target_path) continue;

      let fileData: { content: string; frontmatter: Record<string, unknown>; lineEnding: string; contentHash: string };
      try {
        fileData = await readVaultFile(vaultPath, backlink.path);
      } catch {
        continue;
      }

      let content = fileData.content;
      let linksUpdated = 0;
      const pattern = new RegExp(`\\[\\[${escapeRegex(source_name)}(\\|[^\\]]+)?\\]\\]`, 'gi');

      content = content.replace(pattern, (_match, displayPart) => {
        linksUpdated++;
        if (displayPart) return `[[${targetTitle}${displayPart}]]`;
        if (source_name.toLowerCase() === targetTitle.toLowerCase()) return `[[${targetTitle}]]`;
        return `[[${targetTitle}|${source_name}]]`;
      });

      if (linksUpdated > 0) {
        await writeVaultFile(vaultPath, backlink.path, content, fileData.frontmatter, fileData.lineEnding as LineEnding, fileData.contentHash);
        totalBacklinksUpdated += linksUpdated;
        modifiedFiles.push(backlink.path);
      }
    }

    if (sourceNoteFile) {
      await fs.unlink(`${vaultPath}/${sourceNoteFile}`);
    }

    initializeEntityIndex(vaultPath).catch(err => {
      console.error(`[Flywheel] Entity cache rebuild failed: ${err}`);
    });
  }

  const aliasAdded = source_name.toLowerCase() !== targetTitle.toLowerCase();
  const previewLines = [
    `${dry_run ? 'Would absorb' : 'Absorbed'}: "${source_name}" → "${targetTitle}"`,
    `Alias ${dry_run ? 'to add' : 'added'}: ${aliasAdded ? source_name : 'no (matches target title)'}`,
    `Backlinks ${dry_run ? 'to update' : 'updated'}: ${totalBacklinksUpdated}`,
    sourceNoteFile ? `Source note ${dry_run ? 'to delete' : 'deleted'}: ${sourceNoteFile}` : 'Source note: none found',
  ];
  if (modifiedFiles.length > 0) {
    previewLines.push(`Files ${dry_run ? 'to modify' : 'modified'}: ${modifiedFiles.join(', ')}`);
  }

  return {
    success: true,
    message: dry_run
      ? `[dry run] Would absorb "${source_name}" as alias of "${targetTitle}"`
      : `Absorbed "${source_name}" as alias of "${targetTitle}"`,
    path: target_path,
    preview: previewLines.join('\n'),
    backlinks_updated: totalBacklinksUpdated,
    ...(dry_run ? { dryRun: true } : {}),
  };
}

/** Locate a note whose basename matches sourceName anywhere in the vault. */
async function findSourceNote(vaultPath: string, sourceName: string, excludePath: string): Promise<string | null> {
  const targetLower = sourceName.toLowerCase();

  async function scanDir(dir: string): Promise<string | null> {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return null; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = await scanDir(fullPath);
        if (found) return found;
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const basename = path.basename(entry.name, '.md');
        if (basename.toLowerCase() === targetLower) {
          const relative = path.relative(vaultPath, fullPath).replace(/\\/g, '/');
          if (relative !== excludePath) return relative;
        }
      }
    }
    return null;
  }

  return scanDir(vaultPath);
}
