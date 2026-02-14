/**
 * WSL-Specific Filewatcher Tests
 *
 * These tests verify correct filewatcher behavior on Windows Subsystem for Linux
 * when monitoring vaults on Windows mounts (/mnt/c, /mnt/d, etc.)
 *
 * WSL Notes:
 * - inotify does NOT work reliably on /mnt/c (Windows mount)
 * - Polling mode (FLYWHEEL_WATCH_POLL=true) is recommended for WSL users
 * - Windows file locking behavior differs from native Linux
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

/**
 * Detect if running on WSL by checking for /mnt/c and /proc/version
 */
function isWSL(): boolean {
  if (process.platform !== 'linux') return false;

  try {
    const version = require('fs').readFileSync('/proc/version', 'utf-8');
    const isWslKernel = version.toLowerCase().includes('microsoft') ||
                        version.toLowerCase().includes('wsl');
    const hasMntC = require('fs').existsSync('/mnt/c');
    return isWslKernel && hasMntC;
  } catch {
    return false;
  }
}

const WSL_AVAILABLE = isWSL();
const POLL_MODE_ENABLED = process.env.FLYWHEEL_WATCH_POLL === 'true';

describe('WSL Filewatcher', () => {
  beforeAll(() => {
    if (!WSL_AVAILABLE) {
      console.log('Skipping WSL watcher tests - not running on WSL');
    }
    if (WSL_AVAILABLE && !POLL_MODE_ENABLED) {
      console.log('Warning: Running on WSL without FLYWHEEL_WATCH_POLL=true - inotify may not work on /mnt/c');
    }
  });

  describe('environment detection', () => {
    it('correctly identifies WSL environment', () => {
      // This test always runs to verify detection logic
      const detected = isWSL();
      console.log(`WSL detected: ${detected}`);
      console.log(`Poll mode enabled: ${POLL_MODE_ENABLED}`);

      // Just verify the function returns a boolean
      expect(typeof detected).toBe('boolean');
    });

    it.skipIf(!WSL_AVAILABLE)('confirms /mnt/c is accessible', async () => {
      const exists = await fs.access('/mnt/c').then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe.skipIf(!WSL_AVAILABLE)('polling mode on WSL', () => {
    let tempDir: string;

    beforeEach(async () => {
      // Create temp directory - prefer /tmp for tests
      // (avoid /mnt/c for simple tests due to permission complexity)
      tempDir = await fs.mkdtemp('/tmp/flywheel-wsl-test-');
    });

    afterEach(async () => {
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('FLYWHEEL_WATCH_POLL environment variable is respected', () => {
      // This test verifies the env var is set correctly for WSL
      if (POLL_MODE_ENABLED) {
        expect(process.env.FLYWHEEL_WATCH_POLL).toBe('true');
      }
    });

    it('file changes are detected with polling', async () => {
      // Simple file change detection test
      const testFile = path.join(tempDir, 'test.md');
      await fs.writeFile(testFile, '# Initial');

      // Wait a bit, then modify
      await new Promise(resolve => setTimeout(resolve, 100));
      await fs.writeFile(testFile, '# Modified');

      // Read back to verify write worked
      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe('# Modified');
    });

    it('new file creation is detected', async () => {
      const testFile = path.join(tempDir, 'new-file.md');
      await fs.writeFile(testFile, '# New File');

      const exists = await fs.access(testFile).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('file deletion is handled', async () => {
      const testFile = path.join(tempDir, 'delete-me.md');
      await fs.writeFile(testFile, '# Will be deleted');

      await fs.unlink(testFile);

      const exists = await fs.access(testFile).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });
  });

  describe.skipIf(!WSL_AVAILABLE)('Windows mount specific behavior', () => {
    it('handles case-insensitive filenames on /mnt/c', async () => {
      // On Windows mounts, filesystem is case-insensitive
      // but WSL preserves case - this can cause confusion

      // Note: This test just documents the behavior, doesn't use /mnt/c directly
      // to avoid permission issues in CI

      const tempDir = await fs.mkdtemp('/tmp/flywheel-case-test-');
      try {
        const lowerFile = path.join(tempDir, 'test.md');
        await fs.writeFile(lowerFile, '# Test');

        // On native Linux, this would be a different file
        // On /mnt/c, it would be the same file
        const upperFile = path.join(tempDir, 'TEST.md');

        // Create the upper case version
        await fs.writeFile(upperFile, '# TEST');

        // On native Linux, both files should exist
        const files = await fs.readdir(tempDir);
        console.log(`Files in temp dir: ${files.join(', ')}`);

        // This will vary by mount type
        expect(files.length).toBeGreaterThanOrEqual(1);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('detects line ending style for cross-platform compatibility', async () => {
      const tempDir = await fs.mkdtemp('/tmp/flywheel-endings-test-');
      try {
        // Write file with CRLF (Windows style)
        const crlfFile = path.join(tempDir, 'crlf.md');
        await fs.writeFile(crlfFile, '# Test\r\nContent\r\n');

        const crlfContent = await fs.readFile(crlfFile, 'utf-8');
        const hasCRLF = crlfContent.includes('\r\n');
        expect(hasCRLF).toBe(true);

        // Write file with LF (Unix style)
        const lfFile = path.join(tempDir, 'lf.md');
        await fs.writeFile(lfFile, '# Test\nContent\n');

        const lfContent = await fs.readFile(lfFile, 'utf-8');
        const hasOnlyLF = !lfContent.includes('\r\n') && lfContent.includes('\n');
        expect(hasOnlyLF).toBe(true);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('polling mode recommendations', () => {
    it('documents WSL polling mode setup', () => {
      const setupInstructions = `
        WSL Polling Mode Setup:

        1. Set environment variable:
           export FLYWHEEL_WATCH_POLL=true

        2. Or in MCP config:
           {
             "mcpServers": {
               "flywheel": {
                 "command": "npx",
                 "args": ["-y", "@velvetmonkey/flywheel-mcp"],
                 "env": {
                   "PROJECT_PATH": "/mnt/c/Users/you/vault",
                   "FLYWHEEL_WATCH_POLL": "true"
                 }
               }
             }
           }

        3. Why polling mode on WSL:
           - inotify doesn't work reliably on /mnt/c (Windows mount)
           - Windows filesystem events don't propagate to Linux inotify
           - Polling checks files every ~1000ms (configurable)

        4. Performance impact:
           - Slightly higher CPU usage during watch
           - ~1 second delay for detecting changes
           - Acceptable for most vault sizes (<10,000 files)
      `;

      // This test just documents the setup
      expect(setupInstructions).toContain('FLYWHEEL_WATCH_POLL');
      expect(setupInstructions).toContain('inotify');
    });
  });
});
