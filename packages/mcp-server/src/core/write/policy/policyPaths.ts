/**
 * Policy path helpers and legacy migration
 *
 * Leaf module with zero internal imports — safe for both parser.ts and storage.ts
 * to depend on without creating import cycles.
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Get the policies directory path for a vault (.flywheel/policies/)
 */
export function getPoliciesDir(vaultPath: string): string {
  return path.join(vaultPath, '.flywheel', 'policies');
}

/**
 * Get the legacy policies directory path (.claude/policies/)
 */
export function getLegacyPoliciesDir(vaultPath: string): string {
  return path.join(vaultPath, '.claude', 'policies');
}

/**
 * Ensure the policies directory exists
 */
export async function ensurePoliciesDir(vaultPath: string): Promise<void> {
  const dir = getPoliciesDir(vaultPath);
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Migrate policies from .claude/policies/ to .flywheel/policies/ if needed.
 *
 * - Copies each YAML file to .flywheel/policies/ (skips if destination exists)
 * - Removes the source file after successful copy (even on conflict, so migration converges)
 * - Cleans up empty .claude/policies/ and .claude/ directories
 * - Idempotent: safe to call multiple times
 */
export async function migratePoliciesIfNeeded(vaultPath: string): Promise<void> {
  const legacyDir = getLegacyPoliciesDir(vaultPath);

  let files: string[];
  try {
    files = await fs.readdir(legacyDir);
  } catch {
    return; // Legacy dir doesn't exist — nothing to migrate
  }

  const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  if (yamlFiles.length === 0) {
    // No YAML files — clean up empty dirs
    await tryRmdir(legacyDir);
    await tryRmdir(path.join(vaultPath, '.claude'));
    return;
  }

  // Ensure destination exists
  await ensurePoliciesDir(vaultPath);

  const destDir = getPoliciesDir(vaultPath);

  for (const file of yamlFiles) {
    const src = path.join(legacyDir, file);
    const dest = path.join(destDir, file);

    // Copy only if destination doesn't exist (destination wins on conflict)
    try {
      await fs.access(dest);
      // Destination exists — skip copy but still remove source to converge
    } catch {
      // Destination doesn't exist — copy
      await fs.copyFile(src, dest);
    }

    // Always remove source so migration fully converges
    await fs.unlink(src);
  }

  // Clean up empty legacy directories
  await tryRmdir(legacyDir);
  await tryRmdir(path.join(vaultPath, '.claude'));
}

/** Remove a directory only if it's empty. Silently ignores errors. */
async function tryRmdir(dir: string): Promise<void> {
  try {
    const remaining = await fs.readdir(dir);
    if (remaining.length === 0) {
      await fs.rmdir(dir);
    }
  } catch {
    // Directory doesn't exist or not empty — fine
  }
}

// --- Per-vault dedup cache: "once per process" semantics ---

const migrationCache = new Map<string, Promise<void>>();

/**
 * Ensure migration has run for this vault (at most once per process).
 * Call at the top of every public policy function.
 */
export async function ensureMigrated(vaultPath: string): Promise<void> {
  const key = path.resolve(vaultPath);
  if (!migrationCache.has(key)) {
    migrationCache.set(key, migratePoliciesIfNeeded(vaultPath));
  }
  return migrationCache.get(key)!;
}

/**
 * Reset the migration cache (for testing only).
 */
export function resetMigrationCache(): void {
  migrationCache.clear();
}
