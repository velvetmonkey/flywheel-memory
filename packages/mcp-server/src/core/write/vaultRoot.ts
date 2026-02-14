import * as fs from 'fs';
import * as path from 'path';

const VAULT_MARKERS = ['.obsidian', '.claude'];

/**
 * Find vault root by walking up the directory tree.
 * Looks for .obsidian or .claude folder as markers.
 */
export function findVaultRoot(startPath?: string): string {
  let current = path.resolve(startPath || process.cwd());

  while (true) {
    // Check for vault markers
    for (const marker of VAULT_MARKERS) {
      const markerPath = path.join(current, marker);
      if (fs.existsSync(markerPath) && fs.statSync(markerPath).isDirectory()) {
        return current;
      }
    }

    // Move up one directory
    const parent = path.dirname(current);
    if (parent === current) {
      // Reached filesystem root, fall back to start path or cwd
      return startPath || process.cwd();
    }
    current = parent;
  }
}
