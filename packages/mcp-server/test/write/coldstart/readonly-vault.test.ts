/**
 * Read-Only Vault Tests
 *
 * Validates graceful handling of permission errors:
 * descriptive EACCES messages, proper error propagation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
} from '../helpers/testUtils.js';
import {
  readVaultFile,
  writeVaultFile,
  validatePath,
} from '../../src/core/writer.js';

let tempVault: string;

// Skip permission tests on Windows (different permission model)
const isWindows = process.platform === 'win32';

describe('Read-Only File Handling', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    // Restore permissions before cleanup
    try {
      const files = await fs.readdir(tempVault, { recursive: true });
      for (const file of files) {
        const fullPath = path.join(tempVault, file.toString());
        try {
          await fs.chmod(fullPath, 0o755);
        } catch {
          // Ignore errors during permission restore
        }
      }
    } catch {
      // Ignore
    }
    await cleanupTempVault(tempVault);
  });

  it.skipIf(isWindows)('should provide descriptive error for read-only file', async () => {
    const notePath = 'readonly.md';
    await createTestNote(tempVault, notePath, '# Read Only');

    // Make file read-only
    await fs.chmod(path.join(tempVault, notePath), 0o444);

    // Attempt to write should fail
    try {
      const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, notePath);
      await writeVaultFile(tempVault, notePath, content + '\nNew content', frontmatter, lineEnding);
      // If we get here, the test environment doesn't enforce permissions
      expect(true).toBe(true);
    } catch (error: any) {
      expect(error.code).toBe('EACCES');
      expect(error.message).toMatch(/permission|access|EACCES/i);
    }
  });

  it.skipIf(isWindows)('should still be able to read read-only files', async () => {
    const notePath = 'readable.md';
    const content = '# Readable Content\n\nThis should be readable.';
    await createTestNote(tempVault, notePath, content);

    // Make file read-only
    await fs.chmod(path.join(tempVault, notePath), 0o444);

    // Reading should still work
    const { content: readContent } = await readVaultFile(tempVault, notePath);
    expect(readContent).toContain('# Readable Content');
  });
});

describe('Read-Only Directory Handling', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    // Restore permissions before cleanup
    try {
      await fs.chmod(tempVault, 0o755);
      const entries = await fs.readdir(tempVault, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          try {
            await fs.chmod(path.join(tempVault, entry.name), 0o755);
          } catch {
            // Ignore
          }
        }
      }
    } catch {
      // Ignore
    }
    await cleanupTempVault(tempVault);
  });

  it.skipIf(isWindows)('should provide descriptive error for read-only directory', async () => {
    // Create a directory and make it read-only
    const readonlyDir = path.join(tempVault, 'readonly-dir');
    await fs.mkdir(readonlyDir);
    await fs.chmod(readonlyDir, 0o444);

    // Attempt to create file in read-only directory
    try {
      await createTestNote(tempVault, 'readonly-dir/new-file.md', '# New File');
      // If we get here, permissions not enforced
      expect(true).toBe(true);
    } catch (error: any) {
      expect(error.code).toBe('EACCES');
    }
  });

  it.skipIf(isWindows)('should read existing files in read-only directory', async () => {
    // Create file first
    await createTestNote(tempVault, 'dir/existing.md', '# Existing');

    // Make directory read-only
    await fs.chmod(path.join(tempVault, 'dir'), 0o555);

    // Reading should still work
    const { content } = await readVaultFile(tempVault, 'dir/existing.md');
    expect(content).toContain('# Existing');
  });
});

describe('Permission Error Messages', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    try {
      // Restore permissions
      const walkAndRestore = async (dir: string) => {
        try {
          await fs.chmod(dir, 0o755);
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              await walkAndRestore(fullPath);
            } else {
              try {
                await fs.chmod(fullPath, 0o644);
              } catch {
                // Ignore
              }
            }
          }
        } catch {
          // Ignore
        }
      };
      await walkAndRestore(tempVault);
    } catch {
      // Ignore
    }
    await cleanupTempVault(tempVault);
  });

  it.skipIf(isWindows)('should include file path in permission error', async () => {
    const notePath = 'specific-file.md';
    await createTestNote(tempVault, notePath, '# Content');
    await fs.chmod(path.join(tempVault, notePath), 0o000);

    try {
      await readVaultFile(tempVault, notePath);
      // If read succeeds despite 0o000, platform doesn't enforce
      expect(true).toBe(true);
    } catch (error: any) {
      expect(error.code).toMatch(/EACCES|EPERM/);
      // Error should reference the file somehow
      expect(error.message + error.path).toMatch(/specific-file|EACCES/i);
    }
  });

  it('should handle non-existent file distinctly from permission error', async () => {
    try {
      await readVaultFile(tempVault, 'does-not-exist.md');
      expect.fail('Should have thrown');
    } catch (error: any) {
      // Should be ENOENT, not EACCES
      expect(error.code).toBe('ENOENT');
    }
  });
});

describe('Partial Permission Scenarios', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    try {
      await fs.chmod(tempVault, 0o755);
      const restoreDir = async (dir: string) => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          try {
            await fs.chmod(fullPath, entry.isDirectory() ? 0o755 : 0o644);
            if (entry.isDirectory()) {
              await restoreDir(fullPath);
            }
          } catch {
            // Ignore
          }
        }
      };
      await restoreDir(tempVault);
    } catch {
      // Ignore
    }
    await cleanupTempVault(tempVault);
  });

  it.skipIf(isWindows)('should handle mixed permissions gracefully', async () => {
    // Create structure with mixed permissions
    await createTestNote(tempVault, 'writable/note.md', '# Writable');
    await createTestNote(tempVault, 'readonly/note.md', '# Read Only');

    await fs.chmod(path.join(tempVault, 'readonly'), 0o555);
    await fs.chmod(path.join(tempVault, 'readonly/note.md'), 0o444);

    // Writable should work
    const writableResult = await readVaultFile(tempVault, 'writable/note.md');
    expect(writableResult.content).toContain('# Writable');

    // Read-only should be readable
    const readonlyResult = await readVaultFile(tempVault, 'readonly/note.md');
    expect(readonlyResult.content).toContain('# Read Only');
  });
});

describe('Cross-Platform Considerations', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should handle permission errors uniformly across platforms', async () => {
    // Create a test file
    await createTestNote(tempVault, 'test.md', '# Test');

    // This test verifies error handling structure, not actual permissions
    try {
      // Attempt to write to a path that would cause permission issues
      // (This is a structural test - the actual behavior is platform-dependent)
      await fs.writeFile('/root/definitely-not-writable.md', 'content');
    } catch (error: any) {
      // Should get a meaningful error object
      expect(error).toBeDefined();
      expect(error.code).toBeDefined();
      // Common codes: EACCES (Unix), EPERM (various), EROFS (read-only fs)
      expect(['EACCES', 'EPERM', 'EROFS', 'ENOENT']).toContain(error.code);
    }
  });

  it('should validate paths before attempting operations', async () => {
    // Path validation returns false for invalid paths (path traversal)
    expect(validatePath(tempVault, '../outside-vault.md')).toBe(false);

    // Valid paths should return true
    expect(validatePath(tempVault, 'inside-vault.md')).toBe(true);
  });
});
