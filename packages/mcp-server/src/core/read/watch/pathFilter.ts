/**
 * Path filtering for the file watcher
 *
 * Provides aggressive filtering to ignore non-markdown files and
 * system directories, plus cross-platform path normalization.
 */

import path from 'path';

/**
 * Directories to always ignore (no config needed)
 * These are hardcoded for performance and security
 */
const IGNORED_DIRECTORIES: Set<string> = new Set([
  '.git',
  '.obsidian',
  '.trash',
  '.Trash',
  'node_modules',
  '.vscode',
  '.idea',
  '__pycache__',
  '.cache',
  '.claude',
]);

/**
 * File extensions to ignore (non-markdown assets)
 */
const IGNORED_EXTENSIONS: Set<string> = new Set([
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.tiff',
  // Documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  // Audio/Video
  '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.mov', '.avi', '.mkv',
  // Archives
  '.zip', '.tar', '.gz', '.rar', '.7z',
  // Temp/System
  '.tmp', '.temp', '.swp', '.swo', '.bak',
  // Data
  '.json', '.yaml', '.yml', '.xml', '.csv',
  // Code (not markdown)
  '.js', '.ts', '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h',
  // Other
  '.exe', '.dll', '.so', '.dylib',
]);

/**
 * File patterns to ignore (prefix/suffix matches)
 */
const IGNORED_PATTERNS = [
  /^\.#/,          // Emacs lock files (.#filename)
  /~$/,            // Backup files (filename~)
  /^#.*#$/,        // Emacs auto-save (#filename#)
  /\.orig$/,       // Merge conflict originals
  /\.swp$/,        // Vim swap files
  /\.DS_Store$/,   // macOS metadata
  /^Thumbs\.db$/i, // Windows thumbnail cache
  /^desktop\.ini$/i, // Windows folder settings
];

/**
 * Check if a path segment is an ignored directory
 */
function isIgnoredDirectory(segment: string): boolean {
  return IGNORED_DIRECTORIES.has(segment);
}

/**
 * Check if a file has an ignored extension
 */
function hasIgnoredExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return IGNORED_EXTENSIONS.has(ext);
}

/**
 * Check if a filename matches ignored patterns
 */
function matchesIgnoredPattern(filename: string): boolean {
  return IGNORED_PATTERNS.some(pattern => pattern.test(filename));
}

/**
 * Normalize a path for consistent handling across platforms
 *
 * - Converts backslashes to forward slashes
 * - Lowercases on Windows for case-insensitive comparison
 * - Handles WSL /mnt/c/ paths
 */
export function normalizePath(filePath: string): string {
  // Convert Windows backslashes to forward slashes
  let normalized = filePath.replace(/\\/g, '/');

  // On Windows, lowercase for case-insensitive comparison
  if (process.platform === 'win32') {
    normalized = normalized.toLowerCase();
  }

  return normalized;
}

/**
 * Get relative path from vault root
 */
export function getRelativePath(vaultPath: string, filePath: string): string {
  const relative = path.relative(vaultPath, filePath);
  return normalizePath(relative);
}

/**
 * Check if a file should be watched (not filtered out)
 *
 * @param filePath - Absolute or relative path to check
 * @param vaultPath - Optional vault root for relative path calculation
 * @returns true if the file should be watched, false if it should be ignored
 */
export function shouldWatch(filePath: string, vaultPath?: string): boolean {
  // Normalize the path
  const normalized = normalizePath(filePath);

  // Get relative path if vault path provided
  const relativePath = vaultPath
    ? getRelativePath(vaultPath, filePath)
    : normalized;

  // Split into segments
  const segments = relativePath.split('/').filter(s => s.length > 0);

  if (segments.length === 0) {
    return false;
  }

  // Check each directory in the path
  for (const segment of segments.slice(0, -1)) {
    if (isIgnoredDirectory(segment)) {
      return false;
    }
  }

  // Get the filename
  const filename = segments[segments.length - 1];

  // Must be a markdown file
  if (!filename.toLowerCase().endsWith('.md')) {
    return false;
  }

  // Check for ignored extensions (shouldn't match .md, but just in case)
  if (hasIgnoredExtension(filename)) {
    return false;
  }

  // Check for ignored patterns
  if (matchesIgnoredPattern(filename)) {
    return false;
  }

  // Check if it's a hidden file (starts with .)
  if (filename.startsWith('.')) {
    return false;
  }

  return true;
}

/**
 * Create a chokidar-compatible ignore function
 *
 * IMPORTANT: Chokidar calls this for BOTH files and directories.
 * If we ignore a directory, chokidar won't descend into it.
 * So we must NOT ignore directories unless they're in IGNORED_DIRECTORIES.
 */
export function createIgnoreFunction(vaultPath: string): (filePath: string) => boolean {
  return (filePath: string): boolean => {
    const relativePath = getRelativePath(vaultPath, filePath);
    const segments = relativePath.split('/').filter(s => s.length > 0);

    if (segments.length === 0) {
      return false; // Don't ignore vault root
    }

    // Check if any segment is an ignored directory
    for (const segment of segments) {
      if (isIgnoredDirectory(segment)) {
        return true; // Ignore this path
      }
    }

    const lastSegment = segments[segments.length - 1];

    // If it looks like a directory (no .md extension), allow it through
    // so chokidar descends into it to find .md files
    if (!lastSegment.toLowerCase().endsWith('.md')) {
      // But still ignore hidden dirs
      if (lastSegment.startsWith('.')) {
        return true;
      }
      return false; // Allow directory - don't ignore
    }

    // For .md files, apply full shouldWatch logic
    return !shouldWatch(filePath, vaultPath);
  };
}

/**
 * Create chokidar-compatible ignored patterns
 * This provides a list of glob patterns that can be used with chokidar's ignored option
 */
export function getIgnoredGlobs(): string[] {
  const globs: string[] = [];

  // Add directory ignores
  for (const dir of IGNORED_DIRECTORIES) {
    globs.push(`**/${dir}/**`);
  }

  // Add extension ignores (non-md files)
  globs.push('**/*.!(md)');

  // Add dotfiles
  globs.push('**/.*');

  return globs;
}
