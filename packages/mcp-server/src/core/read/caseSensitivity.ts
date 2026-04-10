/**
 * Filesystem case-sensitivity detection
 *
 * Probes the underlying filesystem at a vault path to determine whether
 * path matches are case-sensitive. Used to canonicalize index keys on
 * case-insensitive filesystems (Windows NTFS, macOS APFS/HFS+ default,
 * network mounts like CIFS/SMB) so that `Foo.md` and `foo.md` collapse
 * to a single index entry.
 *
 * On case-sensitive filesystems (Linux ext4, opt-in case-sensitive APFS
 * volumes) `Foo.md` and `foo.md` are distinct physical files and must
 * remain distinct in the index.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

let moduleLevelCaseInsensitive: boolean | null = null;

/**
 * Probe the vault filesystem to see whether it is case-insensitive.
 *
 * Strategy: create a temp file inside `.flywheel/` with a known case,
 * stat it with the opposite case, compare inode+device. If both resolve
 * to the same physical file the volume is case-insensitive.
 *
 * Falls back to a platform-based guess (`win32`/`darwin` → insensitive)
 * if the probe fails for any reason.
 */
export function detectCaseInsensitive(vaultPath: string): boolean {
  try {
    const flywheelDir = path.join(vaultPath, '.flywheel');
    if (!fs.existsSync(flywheelDir)) {
      fs.mkdirSync(flywheelDir, { recursive: true });
    }

    const probeBase = `case-probe-${process.pid}-${Date.now()}`;
    const lower = path.join(flywheelDir, `${probeBase}.tmp`);
    const upper = path.join(flywheelDir, `${probeBase.toUpperCase()}.TMP`);

    fs.writeFileSync(lower, '');
    try {
      const lowerStat = fs.statSync(lower);
      let upperStat: fs.Stats | null = null;
      try {
        upperStat = fs.statSync(upper);
      } catch {
        upperStat = null;
      }

      if (upperStat && upperStat.ino === lowerStat.ino && upperStat.dev === lowerStat.dev) {
        return true;
      }
      return false;
    } finally {
      try { fs.unlinkSync(lower); } catch { /* ignore */ }
    }
  } catch {
    return platformDefault();
  }
}

/**
 * Conservative fallback: Windows and macOS default to case-insensitive.
 * Linux and other platforms default to case-sensitive.
 */
export function platformDefault(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin';
}

/**
 * Set the module-level case-insensitivity flag.
 * Called once at boot after probing the primary vault so helpers that
 * cannot thread a VaultContext (like the watcher EventQueue) can still
 * read the correct value.
 */
export function setModuleCaseInsensitive(value: boolean): void {
  moduleLevelCaseInsensitive = value;
}

/**
 * Get the cached flag, falling back to platformDefault() when unset.
 */
export function getModuleCaseInsensitive(): boolean {
  if (moduleLevelCaseInsensitive === null) {
    return platformDefault();
  }
  return moduleLevelCaseInsensitive;
}

/**
 * Reset the module-level flag (tests only).
 */
export function _resetModuleCaseInsensitive(): void {
  moduleLevelCaseInsensitive = null;
}

/**
 * Canonicalize a vault-relative path for use as a lookup key.
 *
 * On case-insensitive filesystems, paths are lowercased so `Foo.md`
 * and `foo.md` map to the same key. On case-sensitive filesystems
 * the path is returned unchanged.
 *
 * Forward-slash normalization is the caller's responsibility (handle
 * that at the filesystem boundary, not here).
 */
export function canonicalPath(p: string, caseInsensitive?: boolean): string {
  const ci = caseInsensitive ?? getModuleCaseInsensitive();
  return ci ? p.toLowerCase() : p;
}

// Suppress unused import warnings when this file is only imported for types
void os;
