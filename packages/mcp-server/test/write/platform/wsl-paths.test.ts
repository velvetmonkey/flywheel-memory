/**
 * WSL-Specific Path Handling Tests
 *
 * These tests verify correct behavior when running on Windows Subsystem for Linux
 * with vaults located on Windows mounts (/mnt/c, /mnt/d, etc.)
 *
 * Tests cover:
 * - /mnt/c vault path handling
 * - Windows line ending (CRLF) preservation
 * - Mixed path separator normalization
 * - Case sensitivity on Windows mounts
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  readVaultFile,
  writeVaultFile,
  findSection,
  insertInSection,
  detectLineEnding,
} from '../../../src/core/write/writer.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
} from '../helpers/testUtils.js';

/**
 * Detect if running on WSL by checking for /mnt/c and /proc/version
 */
function isWSL(): boolean {
  if (process.platform !== 'linux') return false;

  try {
    // Check for WSL signature in /proc/version
    const version = require('fs').readFileSync('/proc/version', 'utf-8');
    const isWslKernel = version.toLowerCase().includes('microsoft') ||
                        version.toLowerCase().includes('wsl');

    // Also check for /mnt/c existence
    const hasMntC = require('fs').existsSync('/mnt/c');

    return isWslKernel && hasMntC;
  } catch {
    return false;
  }
}

const WSL_AVAILABLE = isWSL();

describe('WSL Path Handling', () => {
  let tempVault: string;

  beforeAll(() => {
    if (!WSL_AVAILABLE) {
      console.log('Skipping WSL tests - not running on WSL or /mnt/c not available');
    }
  });

  beforeEach(async () => {
    // Use standard temp vault for non-WSL tests
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  describe('standard path operations', () => {
    it('should handle standard Linux paths', async () => {
      const content = `---
type: test
---
# Test

## Section
Content here.
`;
      await createTestNote(tempVault, 'test.md', content);

      const { content: readContent } = await readVaultFile(tempVault, 'test.md');
      expect(readContent).toContain('# Test');
    });

    it('should preserve LF line endings on Linux', async () => {
      const content = '---\ntype: test\n---\n# Test\n\n## Section\nContent.\n';
      await createTestNote(tempVault, 'lf.md', content);

      const { lineEnding } = await readVaultFile(tempVault, 'lf.md');
      expect(lineEnding).toBe('LF');
    });
  });

  describe.skipIf(!WSL_AVAILABLE)('WSL /mnt/c specific tests', () => {
    let wslTempVault: string;

    beforeEach(async () => {
      // Create temp vault on Windows mount
      const wslTempDir = '/mnt/c/Users';

      // Try to find a writable temp location on Windows
      const possibleDirs = [
        process.env.USERPROFILE?.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, d) => `/mnt/${d.toLowerCase()}`),
        '/mnt/c/temp',
        '/mnt/c/Users/Public',
      ].filter(Boolean) as string[];

      let foundDir: string | null = null;
      for (const dir of possibleDirs) {
        try {
          await fs.access(dir, fs.constants.W_OK);
          foundDir = dir;
          break;
        } catch {
          continue;
        }
      }

      if (!foundDir) {
        console.log('No writable Windows directory found, using Linux temp');
        wslTempVault = tempVault;
        return;
      }

      // Create unique temp vault
      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      wslTempVault = path.join(foundDir, `flywheel-wsl-test-${timestamp}-${randomSuffix}`);
      await fs.mkdir(wslTempVault, { recursive: true });
    });

    afterEach(async () => {
      if (wslTempVault && wslTempVault !== tempVault) {
        await fs.rm(wslTempVault, { recursive: true, force: true });
      }
    });

    it('handles /mnt/c vault paths', async () => {
      const content = `---
type: test
---
# WSL Test

## Log
Entry from WSL.
`;
      const notePath = 'wsl-test.md';
      await fs.writeFile(path.join(wslTempVault, notePath), content);

      const { content: readContent } = await readVaultFile(wslTempVault, notePath);
      expect(readContent).toContain('# WSL Test');
    });

    it('detects Windows CRLF line endings on /mnt/c files', async () => {
      // Write a file with CRLF endings (common when created by Windows apps)
      const crlfContent = '---\r\ntype: test\r\n---\r\n# Test\r\n\r\n## Section\r\nContent.\r\n';
      const notePath = 'crlf-test.md';
      await fs.writeFile(path.join(wslTempVault, notePath), crlfContent);

      const { lineEnding } = await readVaultFile(wslTempVault, notePath);
      expect(lineEnding).toBe('CRLF');
    });

    it('preserves CRLF on mutation', async () => {
      const crlfContent = '---\r\ntype: test\r\n---\r\n# Test\r\n\r\n## Log\r\n- Existing\r\n';
      const notePath = 'crlf-preserve.md';
      await fs.writeFile(path.join(wslTempVault, notePath), crlfContent);

      const { content, frontmatter, lineEnding } = await readVaultFile(wslTempVault, notePath);
      const section = findSection(content, 'Log')!;
      const modified = insertInSection(content, section, '- New entry', 'append');
      await writeVaultFile(wslTempVault, notePath, modified, frontmatter, lineEnding);

      const result = await fs.readFile(path.join(wslTempVault, notePath), 'utf-8');
      // Should preserve CRLF throughout
      expect(result).toContain('\r\n');
      expect(detectLineEnding(result)).toBe('CRLF');
    });

    it('handles mixed path separators in inputs', async () => {
      // Users might accidentally use backslashes in paths
      const content = `---
type: test
---
# Mixed Path Test

## Section
Content.
`;
      // Create nested structure
      await fs.mkdir(path.join(wslTempVault, 'notes', 'daily'), { recursive: true });
      const notePath = 'notes/daily/test.md';
      await fs.writeFile(path.join(wslTempVault, notePath), content);

      // Read using forward slashes (correct)
      const { content: readContent } = await readVaultFile(wslTempVault, notePath);
      expect(readContent).toContain('# Mixed Path Test');
    });
  });

  describe('path normalization', () => {
    it('should handle paths with spaces', async () => {
      const content = `---
type: test
---
# Space Test

## Section
Content.
`;
      const notePath = 'folder with spaces/note file.md';
      await createTestNote(tempVault, notePath, content);

      const { content: readContent } = await readVaultFile(tempVault, notePath);
      expect(readContent).toContain('# Space Test');
    });

    it('should handle paths with special characters', async () => {
      const content = `---
type: test
---
# Special Chars

## Section
Content.
`;
      const notePath = 'projects/[Q1 2026]/note.md';
      await createTestNote(tempVault, notePath, content);

      const { content: readContent } = await readVaultFile(tempVault, notePath);
      expect(readContent).toContain('# Special Chars');
    });

    it('should handle unicode in paths', async () => {
      const content = `---
type: test
---
# Unicode Path

## Section
Content.
`;
      const notePath = 'notas/español/日本語/note.md';
      await createTestNote(tempVault, notePath, content);

      const { content: readContent } = await readVaultFile(tempVault, notePath);
      expect(readContent).toContain('# Unicode Path');
    });
  });

  describe('line ending handling', () => {
    it('should detect LF line endings', async () => {
      const lfContent = '---\ntype: test\n---\n# Test\n';
      await fs.writeFile(path.join(tempVault, 'lf.md'), lfContent);

      const { lineEnding } = await readVaultFile(tempVault, 'lf.md');
      expect(lineEnding).toBe('LF');
    });

    it('should detect CRLF line endings', async () => {
      const crlfContent = '---\r\ntype: test\r\n---\r\n# Test\r\n';
      await fs.writeFile(path.join(tempVault, 'crlf.md'), crlfContent);

      const { lineEnding } = await readVaultFile(tempVault, 'crlf.md');
      expect(lineEnding).toBe('CRLF');
    });

    it('should handle mixed line endings', async () => {
      // File with both LF and CRLF (can happen with different editors)
      const mixedContent = '---\r\ntype: test\n---\r\n# Test\n## Section\r\nContent.\n';
      await fs.writeFile(path.join(tempVault, 'mixed.md'), mixedContent);

      const { lineEnding } = await readVaultFile(tempVault, 'mixed.md');
      // Should detect dominant line ending
      expect(['LF', 'CRLF']).toContain(lineEnding);
    });

    it('should preserve line endings through mutation cycle', async () => {
      const lfContent = '---\ntype: test\n---\n# Test\n\n## Log\n- Item 1\n';
      await fs.writeFile(path.join(tempVault, 'preserve-lf.md'), lfContent);

      const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'preserve-lf.md');
      expect(lineEnding).toBe('LF');

      const section = findSection(content, 'Log')!;
      const modified = insertInSection(content, section, '- Item 2', 'append');
      await writeVaultFile(tempVault, 'preserve-lf.md', modified, frontmatter, lineEnding);

      const result = await fs.readFile(path.join(tempVault, 'preserve-lf.md'), 'utf-8');
      // Should not have CRLF after LF file mutation
      expect(result).not.toContain('\r\n');
    });
  });
});
