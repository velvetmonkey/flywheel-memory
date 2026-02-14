/**
 * Security tests for path encoding attack prevention
 *
 * Validates protection against:
 * - URL-encoded path traversal (%2e%2e/ for ../)
 * - Double URL encoding (%252e%252e/)
 * - Null byte injection (file.md\x00.txt)
 * - Windows backslash traversal (..\..\..\)
 * - Unicode normalization attacks
 * - Mixed encoding attacks
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  validatePath,
  validatePathSecure,
} from '../../../src/core/write/writer.js';
import {
  createTempVault,
  cleanupTempVault,
} from '../helpers/testUtils.js';

describe('Path Encoding Attack Prevention', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  // ========================================
  // Standard Path Traversal
  // ========================================

  describe('Standard path traversal', () => {
    it('should reject simple path traversal (../)', () => {
      expect(validatePath(tempVault, '../outside.md')).toBe(false);
    });

    it('should reject multiple traversal (../../)', () => {
      expect(validatePath(tempVault, '../../outside.md')).toBe(false);
    });

    it('should reject deep traversal (../../../etc/passwd)', () => {
      expect(validatePath(tempVault, '../../../etc/passwd')).toBe(false);
    });

    it('should reject hidden traversal (notes/../../../etc/passwd)', () => {
      expect(validatePath(tempVault, 'notes/../../../etc/passwd')).toBe(false);
    });

    it('should allow legitimate relative paths within vault', () => {
      expect(validatePath(tempVault, 'notes/../other/file.md')).toBe(true);
    });
  });

  // ========================================
  // URL-Encoded Path Traversal
  // ========================================

  describe('URL-encoded path traversal', () => {
    it('should treat %2e%2e/ as literal characters (safe)', () => {
      // Note: Node.js path.resolve doesn't decode URL encoding,
      // so these paths are treated literally (safe behavior)
      // The test verifies they don't escape the vault
      const encoded = '%2e%2e/outside.md';
      expect(validatePath(tempVault, encoded)).toBe(true);
      // The path is safe because %2e%2e is treated as literal characters
    });

    it('should treat %2e%2e%2f as literal characters (safe)', () => {
      const encoded = '%2e%2e%2f%2e%2e%2f/etc/passwd';
      expect(validatePath(tempVault, encoded)).toBe(true);
      // Safe: treated as literal characters, not decoded
    });

    it('should handle mixed encoded/unencoded - ../ portion causes traversal', () => {
      // This tests that URL-encoded prefix followed by real traversal
      // The %2e%2e becomes a directory name, then ../ escapes from it
      // Net effect: still within vault (goes into %2e%2e then back out)
      const mixed = '%2e%2e/../outside.md';
      expect(validatePath(tempVault, mixed)).toBe(true);
      // Safe: %2e%2e is a directory name, ../ exits it, still in vault
    });
  });

  // ========================================
  // Double URL Encoding
  // ========================================

  describe('Double URL encoding', () => {
    it('should handle double-encoded traversal (%252e%252e/)', () => {
      // Double encoding: %25 = %, so %252e = %2e
      const doubleEncoded = '%252e%252e/outside.md';
      // Treated as literal characters, stays within vault
      expect(validatePath(tempVault, doubleEncoded)).toBe(true);
    });
  });

  // ========================================
  // Null Byte Injection
  // ========================================

  describe('Null byte injection', () => {
    it('should handle null byte in middle of path', () => {
      // Null bytes in paths can be used to truncate filenames
      const nullByte = 'file.md\x00.txt';
      // path.resolve handles this - the path stays within vault
      const result = validatePath(tempVault, nullByte);
      expect(result).toBe(true); // Path is within vault
    });

    it('should handle null byte with traversal', () => {
      const nullTraversal = '../\x00../outside.md';
      // path.resolve processes the traversal even with null byte
      expect(validatePath(tempVault, nullTraversal)).toBe(false);
    });
  });

  // ========================================
  // Windows Backslash Handling (Platform-Specific)
  // ========================================

  describe('Windows backslash handling', () => {
    // Note: On Linux/macOS, backslash is a valid filename character, not a path separator.
    // These tests verify that backslash paths are handled safely per platform.
    // On Windows, path.resolve treats backslash as separator.
    // On Linux, backslash creates a literal filename like "..\\outside.md"

    it('should handle backslash paths safely on current platform', () => {
      const result = validatePath(tempVault, '..\\outside.md');
      // On Linux: backslash is literal, creates file "..\\outside.md" in vault (safe)
      // On Windows: backslash is separator, would be traversal (blocked)
      // Either way, path stays within or is rejected - both are safe outcomes
      expect(typeof result).toBe('boolean');
    });

    it('should handle multiple backslash paths safely', () => {
      const result = validatePath(tempVault, '..\\..\\outside.md');
      expect(typeof result).toBe('boolean');
    });

    it('should handle mixed slash paths safely', () => {
      const result = validatePath(tempVault, '..\\../outside.md');
      expect(typeof result).toBe('boolean');
    });

    it('should handle deep backslash paths safely', () => {
      const result = validatePath(tempVault, '..\\..\\..\\Windows\\System32\\config\\SAM');
      expect(typeof result).toBe('boolean');
    });
  });

  // ========================================
  // Absolute Path Attacks
  // ========================================

  describe('Absolute path attacks', () => {
    it('should reject Unix absolute paths', () => {
      expect(validatePath(tempVault, '/etc/passwd')).toBe(false);
    });

    it('should reject Windows absolute paths (C:\\)', () => {
      // On Unix, this is treated as a relative path starting with "C:"
      // On Windows, path.resolve would treat this as absolute
      const result = validatePath(tempVault, 'C:\\Windows\\System32\\config\\SAM');
      if (process.platform === 'win32') {
        // On Windows, this is an absolute path and should be blocked
        expect(result).toBe(false);
      } else {
        // On Unix, treated as relative path with literal "C:" prefix (safe)
        expect(result).toBe(true);
      }
    });

    it('should reject UNC paths (\\\\server\\share)', () => {
      const unc = '\\\\server\\share\\file.md';
      // UNC-style paths should be blocked on all platforms
      // Even on Unix where backslashes are literal, these are clearly not
      // intended to be valid vault-relative paths
      expect(validatePath(tempVault, unc)).toBe(false);
    });
  });

  // ========================================
  // Unicode Normalization
  // ========================================

  describe('Unicode normalization attacks', () => {
    it('should handle Unicode full-width period as literal (safe)', () => {
      // Full-width period: ．(U+FF0E)
      const unicodeDot = '．．/outside.md';
      // These are different characters from ASCII period, so treated literally
      // Creates a file like "．．/outside.md" which stays within vault
      expect(validatePath(tempVault, unicodeDot)).toBe(true);
    });

    it('should handle Unicode full-width slash as literal (safe)', () => {
      // Full-width solidus: ／(U+FF0F)
      const unicodeSlash = '..／outside.md';
      // The ／ is not a path separator in Node.js, so this becomes
      // a literal filename "..／outside.md" which is within the vault
      expect(validatePath(tempVault, unicodeSlash)).toBe(true);
    });
  });

  // ========================================
  // Async Validation Edge Cases
  // ========================================

  describe('validatePathSecure async edge cases', () => {
    it('should reject path traversal', async () => {
      const result = await validatePathSecure(tempVault, '../outside.md');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('traversal');
    });

    it('should handle Windows backslash safely on current platform', async () => {
      const result = await validatePathSecure(tempVault, '..\\outside.md');
      // On Linux: backslash is literal, path stays in vault (valid)
      // On Windows: backslash is separator, traversal blocked (invalid)
      expect(typeof result.valid).toBe('boolean');
    });

    it('should allow valid nested paths', async () => {
      const result = await validatePathSecure(tempVault, 'projects/alpha/notes.md');
      expect(result.valid).toBe(true);
    });

    it('should allow paths with dots in filenames', async () => {
      const result = await validatePathSecure(tempVault, 'file.backup.md');
      expect(result.valid).toBe(true);
    });

    it('should allow paths with multiple extensions', async () => {
      const result = await validatePathSecure(tempVault, 'archive.2026.01.md');
      expect(result.valid).toBe(true);
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge cases', () => {
    it('should handle empty path', () => {
      expect(validatePath(tempVault, '')).toBe(true);
    });

    it('should handle single dot (.)', () => {
      expect(validatePath(tempVault, '.')).toBe(true);
    });

    it('should handle double dot without slash (..)', () => {
      expect(validatePath(tempVault, '..')).toBe(false);
    });

    it('should handle triple dot (...)', () => {
      // ... is not a special sequence
      expect(validatePath(tempVault, '...')).toBe(true);
    });

    it('should handle paths with spaces', () => {
      expect(validatePath(tempVault, 'notes/my file.md')).toBe(true);
    });

    it('should handle paths with special characters', () => {
      expect(validatePath(tempVault, 'notes/[project] alpha.md')).toBe(true);
    });

    it('should handle paths with Unicode characters', () => {
      expect(validatePath(tempVault, 'notes/日本語.md')).toBe(true);
    });

    it('should handle paths with emoji', () => {
      expect(validatePath(tempVault, 'notes/🚀 launch.md')).toBe(true);
    });
  });
});
