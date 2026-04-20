/**
 * Path validation and security utilities.
 *
 * Prevents path traversal attacks, symlink escapes,
 * and accidental writes to sensitive files.
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Sensitive file patterns that should never be written via vault mutations.
 * These patterns protect credentials, secrets, and system configuration.
 */
export const SENSITIVE_PATH_PATTERNS: RegExp[] = [
  // Environment files (including backups, variations, and Windows ADS)
  /\.env($|\..*|~|\.swp|\.swo|:)/i, // .env, .env.local, .env~, .env.swp, .env:$DATA (ADS), etc.

  // Git credentials and config
  /\.git\/config$/i,             // Git config (may contain tokens)
  /\.git\/credentials$/i,        // Git credentials

  // SSL/TLS certificates and private keys (including backups)
  /\.pem($|\.bak|\.backup|\.old|\.orig|~)$/i,   // SSL/TLS certificates + backups
  /\.key($|\.bak|\.backup|\.old|\.orig|~)$/i,   // Private keys + backups
  /\.p12($|\.bak|\.backup|\.old|\.orig|~)$/i,   // PKCS#12 certificates + backups
  /\.pfx($|\.bak|\.backup|\.old|\.orig|~)$/i,   // Windows certificate format + backups
  /\.jks($|\.bak|\.backup|\.old|\.orig|~)$/i,   // Java keystore + backups
  /\.crt($|\.bak|\.backup|\.old|\.orig|~)$/i,   // Certificate files + backups

  // SSH keys
  /id_rsa/i,                     // SSH private key
  /id_ed25519/i,                 // SSH private key (ed25519)
  /id_ecdsa/i,                   // SSH private key (ecdsa)
  /id_dsa/i,                     // SSH private key (dsa)
  /\.ssh\/config$/i,             // SSH config
  /authorized_keys$/i,           // SSH authorized keys
  /known_hosts$/i,               // SSH known hosts

  // Generic credentials/secrets files (including backups)
  /credentials\.json($|\.bak|\.backup|\.old|\.orig|~)$/i,  // Cloud credentials + backups
  /secrets\.json($|\.bak|\.backup|\.old|\.orig|~)$/i,      // Secrets files + backups
  /secrets\.ya?ml($|\.bak|\.backup|\.old|\.orig|~)$/i,     // Secrets YAML + backups

  // Package manager auth
  /\.npmrc$/i,                   // npm config (may contain tokens)
  /\.netrc$/i,                   // Netrc (HTTP auth credentials)
  /\.yarnrc$/i,                  // Yarn config

  // Cloud provider credentials
  /\.aws\/credentials$/i,        // AWS credentials
  /\.aws\/config$/i,             // AWS config
  /gcloud\/credentials\.json/i,  // Google Cloud credentials
  /\.azure\/credentials$/i,      // Azure credentials
  /\.docker\/config\.json$/i,    // Docker registry auth
  /\.kube\/config$/i,            // Kubernetes config

  // System password files
  /\.htpasswd$/i,                // Apache password file
  /shadow$/,                     // Unix shadow password file
  /passwd$/,                     // Unix password file

  // Hidden credential files (starting with dot)
  /^\.(credentials|secrets|tokens)$/i, // .credentials, .secrets, .tokens
];

/**
 * Result of secure path validation
 */
export interface PathValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Check if a path matches any sensitive file pattern
 */
export function isSensitivePath(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return SENSITIVE_PATH_PATTERNS.some(pattern => pattern.test(normalizedPath));
}

/**
 * Check if a resolved child path is within a parent directory.
 * Uses path.relative() instead of startsWith() to prevent sibling-directory
 * prefix attacks (e.g., /vault vs /vault-sibling).
 *
 * @param allowEqual - If true, child === parent is considered "within".
 *   Use true for parent-directory checks (parent dir can be vault root).
 *   Use false for file paths (a file can't be the vault dir itself).
 */
export function isWithinDirectory(child: string, parent: string, allowEqual = false): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  if (rel === '') return allowEqual;
  // Check if the relative path escapes upward: starts with '..' followed by
  // a separator or is exactly '..'. Using segment check avoids false positives
  // on filenames like '...note.md' where the relative path starts with '...'
  const firstSeg = rel.split(path.sep)[0];
  return firstSeg !== '..' && !path.isAbsolute(rel);
}

/**
 * @deprecated Use validatePathSecure() instead. This sync version does not follow
 * symlinks and does not check sensitive file patterns (.env, .key, SSH keys, etc.).
 * It is retained only for existing tests. All tool code must use validatePathSecure().
 *
 * @see validatePathSecure
 */
export function validatePath(vaultPath: string, notePath: string): boolean {
  // Reject absolute paths
  // Unix absolute paths start with /
  if (notePath.startsWith('/')) {
    return false;
  }
  // Windows drive letters (C:, D:, etc.) - only reject on Windows
  // On Unix, "C:\path" is a valid literal filename
  if (process.platform === 'win32' && /^[a-zA-Z]:/.test(notePath)) {
    return false;
  }
  // UNC paths and Windows-style absolute paths (\\server\share, \path)
  // Reject on all platforms - these are not valid relative paths
  if (notePath.startsWith('\\')) {
    return false;
  }

  // Ensure the resolved note path is within the vault
  return isWithinDirectory(path.resolve(vaultPath, notePath), vaultPath);
}

/**
 * Sanitize the filename portion of a vault-relative note path.
 *
 * - Replaces spaces with hyphens
 * - Lowercases the filename
 * - Strips cross-platform problematic characters (? * < > | " :)
 * - Collapses consecutive hyphens
 * - Trims leading/trailing hyphens from the stem
 * - Preserves directory segments as-is
 * - Ensures .md extension
 */
export function sanitizeNotePath(notePath: string): string {
  const dir = path.dirname(notePath);
  let filename = path.basename(notePath);

  // Separate extension
  const ext = filename.endsWith('.md') ? '.md' : '';
  let stem = ext ? filename.slice(0, -ext.length) : filename;

  // Replace spaces with hyphens
  stem = stem.replace(/\s+/g, '-');

  // Strip problematic cross-platform characters
  stem = stem.replace(/[?*<>|":]/g, '');

  // Lowercase
  stem = stem.toLowerCase();

  // Collapse multiple hyphens
  stem = stem.replace(/-{2,}/g, '-');

  // Trim leading/trailing hyphens
  stem = stem.replace(/^-+|-+$/g, '');

  filename = stem + (ext || '.md');

  return dir === '.' ? filename : path.join(dir, filename).replace(/\\/g, '/');
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function findDeepestExistingAncestor(fullPath: string, vaultPath: string): Promise<string> {
  const resolvedVaultPath = path.resolve(vaultPath);
  let currentPath = fullPath;

  while (isWithinDirectory(currentPath, resolvedVaultPath, true)) {
    if (await pathExists(currentPath)) {
      return currentPath;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) break;
    currentPath = parentPath;
  }

  return resolvedVaultPath;
}

/**
 * Securely validate path for write operations.
 *
 * This async version:
 * 1. Follows symlinks using fs.realpath() to detect symlink escapes
 * 2. Verifies the resolved path is still within the vault
 * 3. Checks against sensitive file patterns
 *
 * Use this for ALL write operations to prevent:
 * - Symlink attacks (symlink pointing outside vault)
 * - Path traversal attacks (../)
 * - Accidental credential exposure (.env, .pem, etc.)
 */
export async function validatePathSecure(
  vaultPath: string,
  notePath: string
): Promise<PathValidationResult> {
  // Reject absolute paths
  // Unix absolute paths start with /
  if (notePath.startsWith('/')) {
    return {
      valid: false,
      reason: 'Absolute paths not allowed',
    };
  }
  // Windows drive letters (C:, D:, etc.) - only reject on Windows
  // On Unix, "C:\path" is a valid literal filename
  if (process.platform === 'win32' && /^[a-zA-Z]:/.test(notePath)) {
    return {
      valid: false,
      reason: 'Absolute paths not allowed',
    };
  }
  // UNC paths and Windows-style absolute paths (\\server\share, \path)
  // Reject on all platforms - these are not valid relative paths
  if (notePath.startsWith('\\')) {
    return {
      valid: false,
      reason: 'Absolute paths not allowed',
    };
  }

  // Reject paths whose first segment is '..' (traversal attempt).
  // Uses path segment check instead of string prefix to avoid blocking
  // legitimate filenames like '...note.md'.
  const firstSeg = path.normalize(notePath).split(path.sep).filter(Boolean)[0];
  if (firstSeg === '..') {
    return {
      valid: false,
      reason: 'Path traversal not allowed',
    };
  }

  // Ensure the resolved note path is within the vault
  if (!isWithinDirectory(path.resolve(vaultPath, notePath), vaultPath)) {
    return {
      valid: false,
      reason: 'Path traversal not allowed',
    };
  }

  // Check for sensitive file patterns
  if (isSensitivePath(notePath)) {
    return {
      valid: false,
      reason: 'Cannot write to sensitive file (credentials, keys, secrets)',
    };
  }

  // For files that exist, resolve symlinks and verify still in vault
  try {
    const fullPath = path.join(vaultPath, notePath);
    const realVaultPath = await fs.realpath(vaultPath);

    if (await pathExists(fullPath)) {
      const realPath = await fs.realpath(fullPath);

      if (!isWithinDirectory(realPath, realVaultPath)) {
        return {
          valid: false,
          reason: 'Symlink target is outside vault',
        };
      }

      const relativePath = path.relative(realVaultPath, realPath);
      if (isSensitivePath(relativePath)) {
        return {
          valid: false,
          reason: 'Symlink target is a sensitive file',
        };
      }
    } else {
      const ancestorPath = await findDeepestExistingAncestor(fullPath, vaultPath);
      const realAncestorPath = await fs.realpath(ancestorPath);

      if (!isWithinDirectory(realAncestorPath, realVaultPath, true)) {
        return {
          valid: false,
          reason: 'Deepest existing ancestor resolves outside vault',
        };
      }
    }
  } catch (error) {
    // This shouldn't happen given our earlier checks, but handle gracefully
    return {
      valid: false,
      reason: `Path validation error: ${(error as Error).message}`,
    };
  }

  return { valid: true };
}
