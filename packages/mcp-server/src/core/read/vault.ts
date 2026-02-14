/**
 * Vault scanner - finds all markdown files in an Obsidian vault
 */

import * as fs from 'fs';
import * as path from 'path';

/** Directories to exclude from scanning */
const EXCLUDED_DIRS = new Set([
  '.obsidian',
  '.trash',
  '.git',
  'node_modules',
]);

/** Windows path length limit (including drive letter and null terminator) */
const WINDOWS_MAX_PATH = 260;

/** Regex to detect emoji and other problematic Unicode characters */
const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E0}-\u{1F1FF}]/u;

/**
 * Validate a file path for Windows compatibility
 * @returns true if valid, false if problematic
 */
function isValidPath(fullPath: string, fileName: string): { valid: boolean; reason?: string } {
  // Check for emoji in filename
  if (EMOJI_REGEX.test(fileName)) {
    return { valid: false, reason: 'contains emoji characters' };
  }

  // Check Windows path length limit (applies even on WSL when accessing Windows filesystem)
  if (fullPath.length >= WINDOWS_MAX_PATH) {
    return { valid: false, reason: `path length ${fullPath.length} exceeds Windows limit of ${WINDOWS_MAX_PATH}` };
  }

  return { valid: true };
}

/** File info returned by the scanner */
export interface VaultFile {
  path: string;        // Relative path from vault root
  absolutePath: string; // Full filesystem path
  modified: Date;
  created?: Date;
}

/**
 * Recursively scan a vault directory for markdown files
 */
export async function scanVault(vaultPath: string): Promise<VaultFile[]> {
  const files: VaultFile[] = [];

  async function scan(dir: string, relativePath: string = '') {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err) {
      // Skip directories we can't read (permissions, invalid paths, etc.)
      console.error(`Warning: Could not read directory ${dir}:`, err);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

      if (entry.isDirectory()) {
        // Skip excluded directories
        if (EXCLUDED_DIRS.has(entry.name)) {
          continue;
        }
        try {
          await scan(fullPath, relPath);
        } catch (err) {
          // Skip directories we can't scan (permissions, invalid paths, etc.)
          console.error(`Warning: Could not scan directory ${fullPath}:`, err);
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Validate path before attempting to stat
        const validation = isValidPath(fullPath, entry.name);
        if (!validation.valid) {
          console.warn(`Skipping ${relPath}: ${validation.reason}`);
          continue;
        }

        try {
          const stats = await fs.promises.stat(fullPath);
          files.push({
            path: relPath.replace(/\\/g, '/'), // Normalize to forward slashes
            absolutePath: fullPath,
            modified: stats.mtime,
            created: stats.birthtime,
          });
        } catch (err) {
          // Skip files we can't stat (permissions, etc.)
          console.error(`Warning: Could not stat ${fullPath}:`, err);
        }
      }
    }
  }

  await scan(vaultPath);
  return files;
}
