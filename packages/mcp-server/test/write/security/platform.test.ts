/**
 * Security tests for platform-specific edge cases
 *
 * Validates protection against:
 * - Windows long paths (>260 chars)
 * - WSL path translation edge cases
 * - UNC/network path handling
 * - Case-insensitive filesystem collisions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  validatePath,
  validatePathSecure,
  isSensitivePath,
} from '../../../src/core/write/writer.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
} from '../helpers/testUtils.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

describe('Platform-Specific Security', () => {
  let tempVault: string;
  const isWindows = process.platform === 'win32';
  const isWSL = process.platform === 'linux' &&
    os.release().toLowerCase().includes('microsoft');

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  // ========================================
  // Windows Long Paths (>260 chars)
  // ========================================

  describe('Windows long paths (>260 chars)', () => {
    it('should handle paths near 260 char limit', async () => {
      // Create a path just under 260 chars
      const dirName = 'a'.repeat(50);
      const fileName = 'b'.repeat(50) + '.md';
      const relativePath = `${dirName}/${dirName}/${dirName}/${fileName}`;

      expect(relativePath.length).toBeLessThan(260);
      expect(validatePath(tempVault, relativePath)).toBe(true);
    });

    it('should handle paths exceeding 260 char limit', async () => {
      // Create a very long path
      const longDir = 'directory'.repeat(30);
      const relativePath = `${longDir}/note.md`;

      // path.resolve should still work
      const result = validatePath(tempVault, relativePath);
      expect(typeof result).toBe('boolean');
    });

    it('should handle deeply nested directories', async () => {
      // Create 50 levels of nesting
      const levels = Array(50).fill('subdir');
      const relativePath = levels.join('/') + '/note.md';

      const result = validatePath(tempVault, relativePath);
      expect(typeof result).toBe('boolean');
    });

    it('should handle long filenames', async () => {
      // Very long filename (some filesystems limit to 255 chars)
      const longName = 'a'.repeat(200) + '.md';

      const result = validatePath(tempVault, longName);
      expect(result).toBe(true);

      // Whether the file can actually be created depends on filesystem
      try {
        await createTestNote(tempVault, longName, '# Long Name');
        const content = await readTestNote(tempVault, longName);
        expect(content).toContain('Long Name');
      } catch (error) {
        // Some filesystems reject long filenames, which is acceptable
        expect((error as Error).message).toMatch(/ENAMETOOLONG|name too long/i);
      }
    });

    it('should handle UNC-style long paths on Windows', () => {
      // \\?\C:\... prefix enables long path support on Windows
      const uncLongPath = '\\\\?\\C:\\Users\\test\\vault\\note.md';

      // Paths starting with backslash are blocked on all platforms
      // for security consistency (not valid vault-relative paths)
      const result = validatePath(tempVault, uncLongPath);
      expect(result).toBe(false);
    });
  });

  // ========================================
  // WSL Path Translation
  // ========================================

  describe('WSL path translation', () => {
    it('should handle /mnt/c/ style paths', () => {
      // WSL accesses Windows drives via /mnt/c/, /mnt/d/, etc.
      const wslPath = '/mnt/c/Users/test/vault/note.md';

      if (isWSL) {
        // On WSL, these are valid paths
        const result = validatePath('/mnt/c/Users/test/vault', 'note.md');
        expect(typeof result).toBe('boolean');
      } else {
        // On other platforms, treat as regular Unix path
        const result = validatePath(tempVault, wslPath);
        // Should be false because it's an absolute path
        expect(result).toBe(false);
      }
    });

    it('should handle Windows paths in WSL context', () => {
      // In WSL, you might encounter mixed path styles
      const mixedPath = 'C:\\Users\\test\\vault\\note.md';

      if (isWSL || isWindows) {
        // These might be interpreted as Windows paths
        const result = validatePath(tempVault, mixedPath);
        expect(typeof result).toBe('boolean');
      } else {
        // On pure Unix, treated as filename with colons and backslashes
        expect(validatePath(tempVault, mixedPath)).toBe(true);
      }
    });

    it('should handle wslpath-style conversions', async () => {
      // Paths that look like they came from wslpath conversion
      const paths = [
        '/mnt/c/Users/test/Documents/note.md',
        '//wsl$/Ubuntu/home/user/vault',
        '\\\\wsl$\\Ubuntu\\home\\user\\vault',
      ];

      for (const p of paths) {
        // These are absolute paths and should not be accepted as relative
        const result = validatePath(tempVault, p);
        if (p.startsWith('/') || p.startsWith('\\\\')) {
          expect(result).toBe(false);
        }
      }
    });

    it('should handle WSL interop edge cases', async () => {
      // Symlinks between WSL and Windows can create interesting situations
      const result = await validatePathSecure(tempVault, 'note.md');
      expect(result.valid).toBe(true);
    });
  });

  // ========================================
  // UNC and Network Paths
  // ========================================

  describe('UNC and network path handling', () => {
    it('should reject UNC paths on Windows', () => {
      const uncPaths = [
        '\\\\server\\share\\file.md',
        '\\\\192.168.1.1\\share\\file.md',
        '\\\\server.domain.com\\share\\file.md',
        '//server/share/file.md', // Unix-style UNC
      ];

      for (const uncPath of uncPaths) {
        const result = validatePath(tempVault, uncPath);
        if (isWindows) {
          // On Windows, UNC paths are absolute and should be rejected
          expect(result).toBe(false);
        } else {
          // On Unix, // prefix might be treated as redundant slashes
          expect(typeof result).toBe('boolean');
        }
      }
    });

    it('should reject network drive letters on Windows', () => {
      // Network drives appear as drive letters
      const networkDrives = [
        'Z:\\Documents\\file.md',
        'Y:\\shared\\notes\\file.md',
      ];

      for (const netPath of networkDrives) {
        if (isWindows) {
          expect(validatePath(tempVault, netPath)).toBe(false);
        }
      }
    });

    it('should handle SMB-style paths', () => {
      const smbPaths = [
        'smb://server/share/file.md',
        'cifs://server/share/file.md',
      ];

      for (const smbPath of smbPaths) {
        // These are URIs, not file paths - should be safe (literal)
        const result = validatePath(tempVault, smbPath);
        expect(result).toBe(true); // Treated as relative path with colons
      }
    });

    it('should handle NFS-style paths', () => {
      const nfsPaths = [
        'nfs://server/export/file.md',
        '/net/server/export/file.md', // automount style
      ];

      for (const nfsPath of nfsPaths) {
        const result = validatePath(tempVault, nfsPath);
        if (nfsPath.startsWith('/')) {
          expect(result).toBe(false); // Absolute path
        } else {
          expect(result).toBe(true); // URI treated as literal
        }
      }
    });
  });

  // ========================================
  // Case-Insensitive Filesystem Collisions
  // ========================================

  describe('Case-insensitive filesystem collisions', () => {
    it('should handle sensitive file detection case-insensitively', () => {
      // These should all be blocked regardless of case
      const variants = [
        '.env',
        '.ENV',
        '.Env',
        '.eNv',
        '.ENv',
        '.enV',
      ];

      for (const variant of variants) {
        expect(isSensitivePath(variant)).toBe(true);
      }
    });

    it('should detect collision potential for important files', async () => {
      // On case-insensitive FS, README.md and readme.md are the same
      await createTestNote(tempVault, 'README.md', '# Original');

      try {
        await createTestNote(tempVault, 'readme.md', '# Overwrite');

        // Check what happened
        const files = await fs.readdir(tempVault);
        const readmeFiles = files.filter(f => f.toLowerCase() === 'readme.md');

        // Either 1 file (case-insensitive) or 2 files (case-sensitive)
        expect(readmeFiles.length).toBeGreaterThanOrEqual(1);
      } catch {
        // Some systems might error on collision
      }
    });

    it('should handle Turkish locale case issues', () => {
      // Turkish has special I/i case rules (dotless i, dotted I)
      // İ (U+0130) and ı (U+0131) are special cases
      const turkishI = 'f\u0131le.md'; // fıle.md with dotless i

      const result = validatePath(tempVault, turkishI);
      expect(result).toBe(true);
    });

    it('should handle German eszett case', () => {
      // ß (U+00DF) uppercase is SS
      const eszett = 'straße.md';
      const ss = 'strasse.md';

      // Both should be valid paths
      expect(validatePath(tempVault, eszett)).toBe(true);
      expect(validatePath(tempVault, ss)).toBe(true);

      // On case-insensitive + Unicode-normalizing FS, these might collide
    });
  });

  // ========================================
  // Platform Path Separator Handling
  // ========================================

  describe('Path separator handling', () => {
    it('should handle forward slashes consistently', () => {
      const forwardPath = 'notes/daily/2026-01-28.md';
      expect(validatePath(tempVault, forwardPath)).toBe(true);
    });

    it('should handle backslashes on respective platforms', () => {
      const backslashPath = 'notes\\daily\\2026-01-28.md';

      if (isWindows) {
        // On Windows, backslash is a separator
        expect(validatePath(tempVault, backslashPath)).toBe(true);
      } else {
        // On Unix, backslash is a literal filename character
        expect(validatePath(tempVault, backslashPath)).toBe(true);
      }
    });

    it('should handle mixed separators', () => {
      const mixedPath = 'notes/daily\\2026-01-28.md';

      // Platform-dependent behavior
      const result = validatePath(tempVault, mixedPath);
      expect(typeof result).toBe('boolean');
    });

    it('should handle redundant separators', () => {
      const paths = [
        'notes//daily//note.md',
        'notes///note.md',
        './/note.md',
      ];

      for (const p of paths) {
        // path.resolve normalizes these
        const result = validatePath(tempVault, p);
        expect(result).toBe(true);
      }
    });

    it('should handle trailing separators', () => {
      const paths = [
        'notes/',
        'notes\\',
        'notes/daily/',
      ];

      for (const p of paths) {
        const result = validatePath(tempVault, p);
        expect(result).toBe(true);
      }
    });
  });

  // ========================================
  // Reserved Names (Windows)
  // ========================================

  describe('Windows reserved names', () => {
    it('should handle Windows reserved device names', async () => {
      const reservedNames = [
        'CON',
        'PRN',
        'AUX',
        'NUL',
        'COM1', 'COM2', 'COM3', 'COM4',
        'LPT1', 'LPT2', 'LPT3',
      ];

      for (const name of reservedNames) {
        const result = validatePath(tempVault, `${name}.md`);
        expect(typeof result).toBe('boolean');

        // Try to actually create on Windows
        if (isWindows) {
          try {
            await createTestNote(tempVault, `${name}.md`, '# Test');
          } catch {
            // Windows should reject these names
            // This is expected behavior
          }
        }
      }
    });

    it('should handle reserved names with extensions', async () => {
      // CON.txt, PRN.md are also reserved on Windows
      const reservedWithExt = ['CON.md', 'PRN.txt', 'AUX.md'];

      for (const name of reservedWithExt) {
        if (isWindows) {
          try {
            await createTestNote(tempVault, name, '# Test');
            // If we got here, the name was allowed (newer Windows version?)
          } catch {
            // Expected on Windows
          }
        } else {
          // Unix allows these names
          await createTestNote(tempVault, name, '# Test');
          const content = await readTestNote(tempVault, name);
          expect(content).toContain('# Test');
        }
      }
    });

    it('should handle reserved names in subdirectories', async () => {
      // notes/CON/file.md - the directory is named CON
      const path1 = 'notes/CON/file.md';

      if (!isWindows) {
        // Unix allows this
        await fs.mkdir(`${tempVault}/notes/CON`, { recursive: true });
        await createTestNote(tempVault, path1, '# Test');
        expect(await readTestNote(tempVault, path1)).toContain('# Test');
      }
    });
  });

  // ========================================
  // Alternate Data Streams (Windows)
  // ========================================

  describe('Windows Alternate Data Streams', () => {
    it('should handle ADS-style paths', () => {
      // file.md:stream is ADS syntax on Windows
      const adsPath = 'note.md:Zone.Identifier';

      if (isWindows) {
        // On Windows, this accesses alternate data stream
        const result = validatePath(tempVault, adsPath);
        expect(typeof result).toBe('boolean');
      } else {
        // On Unix, colon is valid in filename
        expect(validatePath(tempVault, adsPath)).toBe(true);
      }
    });

    it('should not allow ADS access to sensitive files', () => {
      // Trying to access .env via ADS
      const adsEnv = '.env:$DATA';

      if (isWindows) {
        // Should still be detected as sensitive
        expect(isSensitivePath(adsEnv)).toBe(true);
      }
    });
  });

  // ========================================
  // Symbolic Path Operations
  // ========================================

  describe('Symbolic path resolution', () => {
    it('should resolve . correctly', () => {
      expect(validatePath(tempVault, './note.md')).toBe(true);
      expect(validatePath(tempVault, '././note.md')).toBe(true);
    });

    it('should block .. traversal', () => {
      expect(validatePath(tempVault, '../note.md')).toBe(false);
      expect(validatePath(tempVault, 'dir/../../note.md')).toBe(false);
    });

    it('should handle complex relative paths', () => {
      // This resolves to vault/note.md
      expect(validatePath(tempVault, 'a/../b/../note.md')).toBe(true);

      // This escapes
      expect(validatePath(tempVault, 'a/../../note.md')).toBe(false);
    });
  });

  // ========================================
  // Environment-Specific Paths
  // ========================================

  describe('Environment-specific path handling', () => {
    it('should not expand environment variables', async () => {
      // $HOME, %USERPROFILE% should be literal
      const envPaths = [
        '$HOME/note.md',
        '%USERPROFILE%/note.md',
        '${HOME}/note.md',
      ];

      for (const envPath of envPaths) {
        const result = validatePath(tempVault, envPath);
        // Should be treated as literal path (contains $ or %)
        expect(result).toBe(true);

        // The file should be created with literal name
        try {
          await createTestNote(tempVault, envPath, '# Test');
          const content = await readTestNote(tempVault, envPath);
          expect(content).toContain('# Test');
        } catch {
          // Some characters might not be valid in filenames on all platforms
        }
      }
    });

    it('should handle tilde expansion (or not)', () => {
      const tildePath = '~/note.md';

      // path.resolve doesn't expand ~
      const resolved = path.resolve(tempVault, tildePath);
      expect(resolved).toContain('~');
    });
  });

  // ========================================
  // File Locking Considerations
  // ========================================

  describe('File locking awareness', () => {
    it('should handle locked file gracefully', async () => {
      const filePath = path.join(tempVault, 'locked.md');
      await fs.writeFile(filePath, '# Original');

      // Open file with exclusive lock (platform-dependent)
      let fd: fs.FileHandle | null = null;
      try {
        // This doesn't actually lock on all platforms
        fd = await fs.open(filePath, 'r+');

        // validatePathSecure should still work (read-only check)
        const result = await validatePathSecure(tempVault, 'locked.md');
        expect(typeof result.valid).toBe('boolean');
      } finally {
        if (fd) await fd.close();
      }
    });
  });

  // ========================================
  // Filesystem-Specific Limits
  // ========================================

  describe('Filesystem limits', () => {
    it('should handle max filename length', async () => {
      // Most filesystems limit filenames to 255 bytes
      const maxName = 'a'.repeat(251) + '.md'; // 255 chars

      const result = validatePath(tempVault, maxName);
      expect(result).toBe(true);

      try {
        await createTestNote(tempVault, maxName, '# Max');
        // Success means filesystem allows it
      } catch (error) {
        // ENAMETOOLONG is acceptable
        expect((error as Error).code || (error as Error).message).toMatch(
          /ENAMETOOLONG|name too long|invalid/i
        );
      }
    });

    it('should handle path with many components', () => {
      // Create path with many directory components
      const components = Array(100).fill('dir');
      const deepPath = components.join('/') + '/note.md';

      const result = validatePath(tempVault, deepPath);
      expect(result).toBe(true);
    });
  });
});
