/**
 * Note move/rename tools for Flywheel Memory
 * Tools: vault_move_note, vault_rename_note
 *
 * These tools handle file relocation with automatic backlink updates across the vault.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { validatePath, readVaultFile, writeVaultFile } from '../../core/write/writer.js';
import type { MutationResult } from '../../core/write/types.js';
import { commitChange } from '../../core/write/git.js';
import { initializeEntityIndex } from '../../core/write/wikilinks.js';
import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract wikilinks from content
 * Returns array of { target, displayText?, fullMatch }
 */
function extractWikilinks(content: string): Array<{ target: string; displayText?: string; fullMatch: string }> {
  const wikilinks: Array<{ target: string; displayText?: string; fullMatch: string }> = [];
  const regex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    wikilinks.push({
      target: match[1],
      displayText: match[2],
      fullMatch: match[0],
    });
  }

  return wikilinks;
}

/**
 * Get the title from a file path (filename without .md extension)
 */
function getTitleFromPath(filePath: string): string {
  return path.basename(filePath, '.md');
}

/**
 * Find all backlinks to a given note (by title and aliases)
 * Returns files that contain wikilinks pointing to the target
 */
async function findBacklinks(
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
async function updateBacklinksInFile(
  vaultPath: string,
  filePath: string,
  oldTitles: string[],
  newTitle: string
): Promise<{ updated: boolean; linksUpdated: number }> {
  const fullPath = path.join(vaultPath, filePath);
  const raw = await fs.readFile(fullPath, 'utf-8');
  const parsed = matter(raw);

  let content = parsed.content;
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
    await writeVaultFile(vaultPath, filePath, content, parsed.data);
    return { updated: true, linksUpdated: totalUpdated };
  }

  return { updated: false, linksUpdated: 0 };
}

/**
 * Extract aliases from frontmatter (supports multiple formats)
 */
function extractAliases(frontmatter: Record<string, unknown>): string[] {
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

/**
 * Register move/rename tools with the MCP server
 */
export function registerMoveNoteTools(
  server: McpServer,
  vaultPath: string
): void {
  // ========================================
  // Tool: vault_move_note
  // ========================================
  server.tool(
    'vault_move_note',
    'Move a note to a new vault location and update all backlinks across the vault',
    {
      oldPath: z.string().describe('Vault-relative path to move from (e.g., "inbox/note.md")'),
      newPath: z.string().describe('Vault-relative path to move to (e.g., "projects/note.md")'),
      updateBacklinks: z.boolean().default(true).describe('If true (default), updates all backlinks pointing to this note'),
      commit: z.boolean().default(false).describe('If true, commit all changes to git'),
    },
    async ({ oldPath, newPath, updateBacklinks, commit }) => {
      try {
        // 1. Validate paths
        if (!validatePath(vaultPath, oldPath)) {
          const result: MutationResult = {
            success: false,
            message: 'Invalid source path: path traversal not allowed',
            path: oldPath,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        if (!validatePath(vaultPath, newPath)) {
          const result: MutationResult = {
            success: false,
            message: 'Invalid destination path: path traversal not allowed',
            path: newPath,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        const oldFullPath = path.join(vaultPath, oldPath);
        const newFullPath = path.join(vaultPath, newPath);

        // 2. Check source exists
        try {
          await fs.access(oldFullPath);
        } catch {
          const result: MutationResult = {
            success: false,
            message: `Source file not found: ${oldPath}`,
            path: oldPath,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 3. Check destination doesn't exist
        try {
          await fs.access(newFullPath);
          const result: MutationResult = {
            success: false,
            message: `Destination already exists: ${newPath}`,
            path: newPath,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        } catch {
          // Good - destination doesn't exist
        }

        // 4. Read source file to extract aliases
        const sourceContent = await fs.readFile(oldFullPath, 'utf-8');
        const parsed = matter(sourceContent);
        const aliases = extractAliases(parsed.data);

        const oldTitle = getTitleFromPath(oldPath);
        const newTitle = getTitleFromPath(newPath);

        // 5. Update backlinks if requested and title is changing
        let backlinkCount = 0;
        let updatedBacklinks = 0;
        const backlinkUpdates: Array<{ path: string; linksUpdated: number }> = [];

        if (updateBacklinks && oldTitle.toLowerCase() !== newTitle.toLowerCase()) {
          const allOldTitles = [oldTitle, ...aliases];
          const backlinks = await findBacklinks(vaultPath, oldTitle, aliases);
          backlinkCount = backlinks.reduce((sum, b) => sum + b.links.length, 0);

          for (const backlink of backlinks) {
            // Skip the file being moved
            if (backlink.path === oldPath) continue;

            const updateResult = await updateBacklinksInFile(
              vaultPath,
              backlink.path,
              allOldTitles,
              newTitle
            );

            if (updateResult.updated) {
              updatedBacklinks += updateResult.linksUpdated;
              backlinkUpdates.push({
                path: backlink.path,
                linksUpdated: updateResult.linksUpdated,
              });
            }
          }
        }

        // 6. Create destination directory
        const destDir = path.dirname(newFullPath);
        await fs.mkdir(destDir, { recursive: true });

        // 7. Move the file
        await fs.rename(oldFullPath, newFullPath);

        // 8. Commit if requested
        let gitCommit: string | undefined;
        let undoAvailable: boolean | undefined;
        let staleLockDetected: boolean | undefined;
        let lockAgeMs: number | undefined;

        if (commit) {
          // Commit all changed files
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

        // 9. Rebuild entity cache in background
        initializeEntityIndex(vaultPath).catch(err => {
          console.error(`[Flywheel] Entity cache rebuild failed: ${err}`);
        });

        // Build result
        const previewLines = [
          `Moved: ${oldPath} → ${newPath}`,
        ];

        if (backlinkCount > 0) {
          previewLines.push(`Backlinks found: ${backlinkCount}`);
          previewLines.push(`Backlinks updated: ${updatedBacklinks}`);
          if (backlinkUpdates.length > 0) {
            previewLines.push(`Files modified: ${backlinkUpdates.map(b => b.path).join(', ')}`);
          }
        } else {
          previewLines.push('No backlinks found');
        }

        const result: MutationResult = {
          success: true,
          message: `Moved note: ${oldPath} → ${newPath}`,
          path: newPath,
          preview: previewLines.join('\n'),
          gitCommit,
          undoAvailable,
          staleLockDetected,
          lockAgeMs,
        };

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const result: MutationResult = {
          success: false,
          message: `Failed to move note: ${error instanceof Error ? error.message : String(error)}`,
          path: oldPath,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    }
  );

  // ========================================
  // Tool: vault_rename_note
  // ========================================
  server.tool(
    'vault_rename_note',
    'Rename a note in place and update all backlinks across the vault',
    {
      path: z.string().describe('Vault-relative path to the note to rename'),
      newTitle: z.string().describe('New title for the note (without .md extension)'),
      updateBacklinks: z.boolean().default(true).describe('If true (default), updates all backlinks pointing to this note'),
      commit: z.boolean().default(false).describe('If true, commit all changes to git'),
    },
    async ({ path: notePath, newTitle, updateBacklinks, commit }) => {
      try {
        // 1. Validate path
        if (!validatePath(vaultPath, notePath)) {
          const result: MutationResult = {
            success: false,
            message: 'Invalid path: path traversal not allowed',
            path: notePath,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 2. Validate new title
        if (!newTitle || newTitle.trim() === '') {
          const result: MutationResult = {
            success: false,
            message: 'New title cannot be empty',
            path: notePath,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // Sanitize title (remove invalid filename characters)
        const sanitizedTitle = newTitle.replace(/[<>:"/\\|?*]/g, '');
        if (sanitizedTitle !== newTitle) {
          console.error(`[Flywheel] Title sanitized: "${newTitle}" → "${sanitizedTitle}"`);
        }

        const fullPath = path.join(vaultPath, notePath);
        const dir = path.dirname(notePath);
        const newPath = dir === '.' ? `${sanitizedTitle}.md` : path.join(dir, `${sanitizedTitle}.md`);
        const newFullPath = path.join(vaultPath, newPath);

        // 3. Check source exists
        try {
          await fs.access(fullPath);
        } catch {
          const result: MutationResult = {
            success: false,
            message: `File not found: ${notePath}`,
            path: notePath,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 4. Check destination doesn't exist (unless same file)
        if (fullPath !== newFullPath) {
          try {
            await fs.access(newFullPath);
            const result: MutationResult = {
              success: false,
              message: `A note with this title already exists: ${newPath}`,
              path: notePath,
            };
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          } catch {
            // Good - destination doesn't exist
          }
        }

        // 5. Read source file to extract aliases
        const sourceContent = await fs.readFile(fullPath, 'utf-8');
        const parsed = matter(sourceContent);
        const aliases = extractAliases(parsed.data);

        const oldTitle = getTitleFromPath(notePath);

        // 6. Update backlinks if requested
        let backlinkCount = 0;
        let updatedBacklinks = 0;
        const backlinkUpdates: Array<{ path: string; linksUpdated: number }> = [];

        if (updateBacklinks && oldTitle.toLowerCase() !== sanitizedTitle.toLowerCase()) {
          const allOldTitles = [oldTitle, ...aliases];
          const backlinks = await findBacklinks(vaultPath, oldTitle, aliases);
          backlinkCount = backlinks.reduce((sum, b) => sum + b.links.length, 0);

          for (const backlink of backlinks) {
            // Skip the file being renamed
            if (backlink.path === notePath) continue;

            const updateResult = await updateBacklinksInFile(
              vaultPath,
              backlink.path,
              allOldTitles,
              sanitizedTitle
            );

            if (updateResult.updated) {
              updatedBacklinks += updateResult.linksUpdated;
              backlinkUpdates.push({
                path: backlink.path,
                linksUpdated: updateResult.linksUpdated,
              });
            }
          }
        }

        // 7. Rename the file
        if (fullPath !== newFullPath) {
          await fs.rename(fullPath, newFullPath);
        }

        // 8. Commit if requested
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

        // 9. Rebuild entity cache in background
        initializeEntityIndex(vaultPath).catch(err => {
          console.error(`[Flywheel] Entity cache rebuild failed: ${err}`);
        });

        // Build result
        const previewLines = [
          `Renamed: "${oldTitle}" → "${sanitizedTitle}"`,
        ];

        if (backlinkCount > 0) {
          previewLines.push(`Backlinks found: ${backlinkCount}`);
          previewLines.push(`Backlinks updated: ${updatedBacklinks}`);
          if (backlinkUpdates.length > 0) {
            previewLines.push(`Files modified: ${backlinkUpdates.map(b => b.path).join(', ')}`);
          }
        } else {
          previewLines.push('No backlinks found');
        }

        const result: MutationResult = {
          success: true,
          message: `Renamed note: ${oldTitle} → ${sanitizedTitle}`,
          path: newPath,
          preview: previewLines.join('\n'),
          gitCommit,
          undoAvailable,
          staleLockDetected,
          lockAgeMs,
        };

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const result: MutationResult = {
          success: false,
          message: `Failed to rename note: ${error instanceof Error ? error.message : String(error)}`,
          path: notePath,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    }
  );
}
