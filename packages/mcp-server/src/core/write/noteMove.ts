/**
 * Note move/rename + backlink rewiring (arch-review S4).
 *
 * Moved verbatim from tools/write/move-notes.ts, which doubled as a retired
 * registration file (vault_move_note / vault_rename_note) and a helper
 * library for the live note/entity tools. The dead registrations are gone;
 * this is the single home for move/rename/backlink logic.
 */

import { validatePathSecure, readVaultFile, writeVaultFile } from './writer.js';
import type { MutationResult } from './types.js';
import { commitChange } from './git.js';
import { initializeEntityIndex } from './wikilinks.js';
import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import { escapeRegex, extractWikilinks, getTitleFromPath } from './wikilinkText.js';
export { escapeRegex, getTitleFromPath } from './wikilinkText.js';

/**
 * Find all backlinks to a given note (by title and aliases)
 * Returns files that contain wikilinks pointing to the target
 */
export async function findBacklinks(
  vaultPath: string,
  targetTitle: string,
  targetAliases: string[]
): Promise<Array<{ path: string; links: Array<{ original: string; target: string }> }>> {
  const results: Array<{ path: string; links: Array<{ original: string; target: string }> }> = [];
  const allTargets = [targetTitle, ...targetAliases].map(t => t.toLowerCase());

  // Recursively find all markdown files
  async function scanDir(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        files.push(...await scanDir(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }

    return files;
  }

  const allFiles = await scanDir(vaultPath);

  for (const filePath of allFiles) {
    const relativePath = path.relative(vaultPath, filePath);
    const content = await fs.readFile(filePath, 'utf-8');
    const wikilinks = extractWikilinks(content);

    const matchingLinks: Array<{ original: string; target: string }> = [];

    for (const link of wikilinks) {
      const linkTarget = link.target.toLowerCase();
      if (allTargets.includes(linkTarget)) {
        matchingLinks.push({
          original: link.fullMatch,
          target: link.target,
        });
      }
    }

    if (matchingLinks.length > 0) {
      results.push({ path: relativePath, links: matchingLinks });
    }
  }

  return results;
}

/**
 * Update wikilinks in a file, replacing old title references with new title
 */
export async function updateBacklinksInFile(
  vaultPath: string,
  filePath: string,
  oldTitles: string[],
  newTitle: string
): Promise<{ updated: boolean; linksUpdated: number }> {
  const { content: fileContent, frontmatter, lineEnding, contentHash } = await readVaultFile(vaultPath, filePath);

  let content = fileContent;
  let totalUpdated = 0;

  for (const oldTitle of oldTitles) {
    // Pattern: [[OldTitle]] or [[OldTitle|Display]]
    const pattern = new RegExp(
      `\\[\\[${escapeRegex(oldTitle)}(\\|[^\\]]+)?\\]\\]`,
      'gi'
    );

    content = content.replace(pattern, (match, displayPart) => {
      totalUpdated++;
      return `[[${newTitle}${displayPart || ''}]]`;
    });
  }

  if (totalUpdated > 0) {
    await writeVaultFile(vaultPath, filePath, content, frontmatter, lineEnding, contentHash);
    return { updated: true, linksUpdated: totalUpdated };
  }

  return { updated: false, linksUpdated: 0 };
}

/**
 * Extract aliases from frontmatter (supports multiple formats)
 */
export function extractAliases(frontmatter: Record<string, unknown>): string[] {
  const aliases: string[] = [];

  if (frontmatter.aliases) {
    if (Array.isArray(frontmatter.aliases)) {
      aliases.push(...frontmatter.aliases.filter((a): a is string => typeof a === 'string'));
    } else if (typeof frontmatter.aliases === 'string') {
      aliases.push(frontmatter.aliases);
    }
  }

  if (frontmatter.alias) {
    if (Array.isArray(frontmatter.alias)) {
      aliases.push(...frontmatter.alias.filter((a): a is string => typeof a === 'string'));
    } else if (typeof frontmatter.alias === 'string') {
      aliases.push(frontmatter.alias);
    }
  }

  return aliases;
}

export interface MoveNoteParams {
  oldPath: string;
  newPath: string;
  updateBacklinks?: boolean;
  commit?: boolean;
  dry_run?: boolean;
}

export interface RenameNoteParams {
  notePath: string;
  newTitle: string;
  updateBacklinks?: boolean;
  commit?: boolean;
  dry_run?: boolean;
}

export async function moveNote(
  vaultPath: string,
  { oldPath, newPath, updateBacklinks = true, commit = false, dry_run = false }: MoveNoteParams
): Promise<MutationResult> {
  try {
    const oldPathValidation = await validatePathSecure(vaultPath, oldPath);
    if (!oldPathValidation.valid) {
      return {
        success: false,
        message: `Invalid source path: ${oldPathValidation.reason}`,
        path: oldPath,
      };
    }

    const newPathValidation = await validatePathSecure(vaultPath, newPath);
    if (!newPathValidation.valid) {
      return {
        success: false,
        message: `Invalid destination path: ${newPathValidation.reason}`,
        path: newPath,
      };
    }

    const oldFullPath = path.join(vaultPath, oldPath);
    const newFullPath = path.join(vaultPath, newPath);

    try {
      await fs.access(oldFullPath);
    } catch {
      return {
        success: false,
        message: `Source file not found: ${oldPath}`,
        path: oldPath,
      };
    }

    try {
      await fs.access(newFullPath);
      return {
        success: false,
        message: `Destination already exists: ${newPath}`,
        path: newPath,
      };
    } catch {
      // Good - destination doesn't exist.
    }

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
        for (const backlink of backlinks) {
          if (backlink.path === oldPath) continue;
          backlinkUpdates.push({
            path: backlink.path,
            linksUpdated: backlink.links.length,
          });
        }
      } else {
        const allOldTitles = [oldTitle, ...aliases];
        for (const backlink of backlinks) {
          if (backlink.path === oldPath) continue;

          const updateResult = await updateBacklinksInFile(
            vaultPath,
            backlink.path,
            allOldTitles,
            newTitle
          );

          if (updateResult.updated) {
            backlinkUpdates.push({
              path: backlink.path,
              linksUpdated: updateResult.linksUpdated,
            });
          }
        }
      }
    }

    const updatedBacklinks = backlinkUpdates.reduce((sum, b) => sum + b.linksUpdated, 0);
    const previewLines = [
      `${dry_run ? 'Would move' : 'Moved'}: ${oldPath} → ${newPath}`,
    ];

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
      return {
        success: true,
        message: `[dry run] Would move note: ${oldPath} → ${newPath}`,
        path: newPath,
        preview: previewLines.join('\n'),
        dryRun: true,
      };
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

      if (gitResult.success && gitResult.hash) {
        gitCommit = gitResult.hash;
        undoAvailable = gitResult.undoAvailable;
      }
      if (gitResult.staleLockDetected) {
        staleLockDetected = gitResult.staleLockDetected;
        lockAgeMs = gitResult.lockAgeMs;
      }
    }

    initializeEntityIndex(vaultPath).catch(err => {
      console.error(`[Flywheel] Entity cache rebuild failed: ${err}`);
    });

    return {
      success: true,
      message: `Moved note: ${oldPath} → ${newPath}`,
      path: newPath,
      preview: previewLines.join('\n'),
      gitCommit,
      undoAvailable,
      staleLockDetected,
      lockAgeMs,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to move note: ${error instanceof Error ? error.message : String(error)}`,
      path: oldPath,
    };
  }
}

export async function renameNote(
  vaultPath: string,
  { notePath, newTitle, updateBacklinks = true, commit = false, dry_run = false }: RenameNoteParams
): Promise<MutationResult> {
  try {
    const renamePathValidation = await validatePathSecure(vaultPath, notePath);
    if (!renamePathValidation.valid) {
      return {
        success: false,
        message: `Invalid path: ${renamePathValidation.reason}`,
        path: notePath,
      };
    }

    if (!newTitle || newTitle.trim() === '') {
      return {
        success: false,
        message: 'New title cannot be empty',
        path: notePath,
      };
    }

    const sanitizedTitle = newTitle.replace(/[<>:"/\\|?*]/g, '');
    if (sanitizedTitle !== newTitle) {
      console.error(`[Flywheel] Title sanitized: "${newTitle}" → "${sanitizedTitle}"`);
    }

    const fullPath = path.join(vaultPath, notePath);
    const dir = path.dirname(notePath);
    const newPath = dir === '.' ? `${sanitizedTitle}.md` : path.join(dir, `${sanitizedTitle}.md`);
    const newFullPath = path.join(vaultPath, newPath);

    try {
      await fs.access(fullPath);
    } catch {
      return {
        success: false,
        message: `File not found: ${notePath}`,
        path: notePath,
      };
    }

    if (fullPath !== newFullPath) {
      try {
        await fs.access(newFullPath);
        return {
          success: false,
          message: `A note with this title already exists: ${newPath}`,
          path: notePath,
        };
      } catch {
        // Good - destination doesn't exist.
      }
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
        for (const backlink of backlinks) {
          if (backlink.path === notePath) continue;
          backlinkUpdates.push({
            path: backlink.path,
            linksUpdated: backlink.links.length,
          });
        }
      } else {
        const allOldTitles = [oldTitle, ...aliases];
        for (const backlink of backlinks) {
          if (backlink.path === notePath) continue;

          const updateResult = await updateBacklinksInFile(
            vaultPath,
            backlink.path,
            allOldTitles,
            sanitizedTitle
          );

          if (updateResult.updated) {
            backlinkUpdates.push({
              path: backlink.path,
              linksUpdated: updateResult.linksUpdated,
            });
          }
        }
      }
    }

    const updatedBacklinks = backlinkUpdates.reduce((sum, b) => sum + b.linksUpdated, 0);
    const previewLines = [
      `${dry_run ? 'Would rename' : 'Renamed'}: "${oldTitle}" → "${sanitizedTitle}"`,
    ];

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
      return {
        success: true,
        message: `[dry run] Would rename note: ${oldTitle} → ${sanitizedTitle}`,
        path: newPath,
        preview: previewLines.join('\n'),
        dryRun: true,
      };
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

      if (gitResult.success && gitResult.hash) {
        gitCommit = gitResult.hash;
        undoAvailable = gitResult.undoAvailable;
      }
      if (gitResult.staleLockDetected) {
        staleLockDetected = gitResult.staleLockDetected;
        lockAgeMs = gitResult.lockAgeMs;
      }
    }

    initializeEntityIndex(vaultPath).catch(err => {
      console.error(`[Flywheel] Entity cache rebuild failed: ${err}`);
    });

    return {
      success: true,
      message: `Renamed note: ${oldTitle} → ${sanitizedTitle}`,
      path: newPath,
      preview: previewLines.join('\n'),
      gitCommit,
      undoAvailable,
      staleLockDetected,
      lockAgeMs,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to rename note: ${error instanceof Error ? error.message : String(error)}`,
      path: notePath,
    };
  }
}

