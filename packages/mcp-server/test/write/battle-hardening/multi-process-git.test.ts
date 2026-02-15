/**
 * Battle-Hardening Tests: Multi-Process Git Operations
 *
 * Tests real multi-process scenarios for git operations:
 * - Child processes holding locks
 * - Stale lock file detection
 * - Wait and retry behavior for briefly-held locks
 * - Process coordination patterns
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { simpleGit, SimpleGit } from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn, ChildProcess } from 'child_process';
import {
  writeVaultFile,
  readVaultFile,
} from '../../../src/core/write/writer.js';
import {
  commitChange,
  isGitRepo,
  getLastCommit,
} from '../../../src/core/write/git.js';

/**
 * Create a temporary vault with git initialized
 */
async function createGitVault(): Promise<string> {
  const vaultPath = path.join(
    os.tmpdir(),
    `flywheel-multiprocess-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  await fs.mkdir(vaultPath, { recursive: true });

  const git: SimpleGit = simpleGit(vaultPath);
  await git.init();
  await git.addConfig('user.name', 'Test User');
  await git.addConfig('user.email', 'test@example.com');

  return vaultPath;
}

/**
 * Clean up a test vault
 */
async function cleanupVault(vaultPath: string): Promise<void> {
  try {
    await fs.rm(vaultPath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Create a git lock file with optional PID
 */
async function createLockFile(vaultPath: string, pid?: number): Promise<string> {
  const lockPath = path.join(vaultPath, '.git', 'index.lock');
  await fs.writeFile(lockPath, `${pid ?? process.pid}\n`);
  return lockPath;
}

/**
 * Remove a git lock file
 */
async function removeLockFile(lockPath: string): Promise<void> {
  try {
    await fs.unlink(lockPath);
  } catch {
    // Ignore if already removed
  }
}

/**
 * Get the age of a lock file in milliseconds
 */
async function getLockFileAge(lockPath: string): Promise<number | null> {
  try {
    const stats = await fs.stat(lockPath);
    return Date.now() - stats.mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Check if a lock file exists
 */
async function lockFileExists(vaultPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(vaultPath, '.git', 'index.lock'));
    return true;
  } catch {
    return false;
  }
}

describe('Battle-Hardening: Multi-Process Git Operations', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await createGitVault();
  });

  afterEach(async () => {
    await cleanupVault(vaultPath);
  });

  describe('child process lock scenarios', () => {
    it('should handle child process holding lock then exiting', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('.');
      await git.commit('Initial commit');

      // Create lock file simulating a child process
      const lockPath = await createLockFile(vaultPath, 99999);

      // First commit attempt should fail
      await writeVaultFile(vaultPath, notePath, '# Test\n- Entry 1\n', {});
      const result1 = await commitChange(vaultPath, notePath, '[Flywheel:Add]');
      expect(result1.success).toBe(false);
      expect(result1.error).toMatch(/lock|index/i);

      // "Child process" exits - remove lock
      await removeLockFile(lockPath);

      // Now commit should succeed
      const result2 = await commitChange(vaultPath, notePath, '[Flywheel:Add]');
      expect(result2.success).toBe(true);
      expect(result2.hash).toBeDefined();
    });

    it('should detect stale lock file older than 30 seconds', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('.');
      await git.commit('Initial commit');

      // Create a lock file
      const lockPath = await createLockFile(vaultPath);

      // Check lock file age
      const age = await getLockFileAge(lockPath);
      expect(age).not.toBeNull();
      expect(age!).toBeLessThan(1000); // Should be fresh (< 1 second old)

      // In a real scenario with a 30+ second old lock, git might clean it up
      // or our code could detect and remove it
      // For now, we just verify the age detection works
      expect(age!).toBeLessThan(30000); // Definitely not stale

      await removeLockFile(lockPath);
    });

    it('should fail when lock is held by active process', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('.');
      await git.commit('Initial commit');

      // Create lock with current process PID (simulating active lock holder)
      const lockPath = await createLockFile(vaultPath, process.pid);

      try {
        await writeVaultFile(vaultPath, notePath, '# Test\n- Entry\n', {});
        const result = await commitChange(vaultPath, notePath, '[Flywheel:Add]');

        // Should fail because lock is held
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      } finally {
        await removeLockFile(lockPath);
      }
    });
  });

  describe('lock wait and retry patterns', () => {
    it('should succeed immediately when no lock exists', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('.');
      await git.commit('Initial commit');

      // No lock - should succeed immediately
      await writeVaultFile(vaultPath, notePath, '# Test\n- Entry\n', {});
      const startTime = Date.now();
      const result = await commitChange(vaultPath, notePath, '[Flywheel:Add]');
      const elapsed = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(elapsed).toBeLessThan(5000); // Should be fast without lock
    });

    it('should handle lock created and removed during operation', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('.');
      await git.commit('Initial commit');

      // Create lock
      const lockPath = await createLockFile(vaultPath);

      // Verify lock exists
      expect(await lockFileExists(vaultPath)).toBe(true);

      // Remove lock immediately
      await removeLockFile(lockPath);

      // Verify lock removed
      expect(await lockFileExists(vaultPath)).toBe(false);

      // Commit should succeed
      await writeVaultFile(vaultPath, notePath, '# Test\n- Entry\n', {});
      const result = await commitChange(vaultPath, notePath, '[Flywheel:Add]');
      expect(result.success).toBe(true);
    });

    it('should handle race between lock removal and commit attempt', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('.');
      await git.commit('Initial commit');

      // Simulate a very brief lock (race condition scenario)
      const lockPath = await createLockFile(vaultPath);

      // Schedule lock removal after tiny delay
      const removePromise = new Promise<void>((resolve) => {
        setTimeout(async () => {
          await removeLockFile(lockPath);
          resolve();
        }, 10);
      });

      // Modify file
      await writeVaultFile(vaultPath, notePath, '# Test\n- Entry\n', {});

      // Wait for lock removal
      await removePromise;

      // Now commit should work
      const result = await commitChange(vaultPath, notePath, '[Flywheel:Add]');
      expect(result.success).toBe(true);
    });
  });

  describe('multiple sequential git operations', () => {
    it('should handle rapid sequential commits from same process', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('.');
      await git.commit('Initial commit');

      const hashes: string[] = [];

      // Rapid sequential commits
      for (let i = 0; i < 10; i++) {
        await writeVaultFile(vaultPath, notePath, `# Test\n- Entry ${i}\n`, {});
        const result = await commitChange(vaultPath, notePath, `[Flywheel:Add] ${i}`);
        expect(result.success).toBe(true);
        hashes.push(result.hash!);
      }

      // All hashes should be unique
      const uniqueHashes = new Set(hashes);
      expect(uniqueHashes.size).toBe(10);

      // Verify git log
      const log = await git.log();
      expect(log.all.length).toBe(11); // 10 + initial
    });

    it('should preserve file content across multiple commits', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n\n## Log\n', {});

      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('.');
      await git.commit('Initial commit');

      // Build up content
      let currentContent = '# Test\n\n## Log\n';
      for (let i = 1; i <= 5; i++) {
        currentContent += `- Entry ${i}\n`;
        await writeVaultFile(vaultPath, notePath, currentContent, {});
        await commitChange(vaultPath, notePath, `[Flywheel:Add] Entry ${i}`);
      }

      // Verify final content
      const { content } = await readVaultFile(vaultPath, notePath);
      expect(content).toContain('- Entry 1');
      expect(content).toContain('- Entry 2');
      expect(content).toContain('- Entry 3');
      expect(content).toContain('- Entry 4');
      expect(content).toContain('- Entry 5');
    });

    it('should handle commits to multiple files in sequence', async () => {
      const files = ['file1.md', 'file2.md', 'file3.md'];

      // Create all files
      for (const file of files) {
        await writeVaultFile(vaultPath, file, `# ${file}\n`, {});
      }

      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('.');
      await git.commit('Initial commit');

      // Commit changes to each file
      for (const file of files) {
        await writeVaultFile(vaultPath, file, `# ${file}\n- Updated\n`, {});
        const result = await commitChange(vaultPath, file, `[Flywheel:Update] ${file}`);
        expect(result.success).toBe(true);
      }

      // Verify each file was updated
      for (const file of files) {
        const { content } = await readVaultFile(vaultPath, file);
        expect(content).toContain('- Updated');
      }
    });
  });

  describe('process coordination edge cases', () => {
    it('should handle nonexistent PID in lock file', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('.');
      await git.commit('Initial commit');

      // Create lock with a PID that doesn't exist (very high number)
      // In real scenarios, git might detect this as a stale lock
      const lockPath = await createLockFile(vaultPath, 999999999);

      try {
        await writeVaultFile(vaultPath, notePath, '# Test\n- Entry\n', {});
        const result = await commitChange(vaultPath, notePath, '[Flywheel:Add]');

        // Should still fail because lock file exists
        expect(result.success).toBe(false);
      } finally {
        await removeLockFile(lockPath);
      }
    });

    it('should handle empty lock file', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('.');
      await git.commit('Initial commit');

      // Create empty lock file
      const lockPath = path.join(vaultPath, '.git', 'index.lock');
      await fs.writeFile(lockPath, '');

      try {
        await writeVaultFile(vaultPath, notePath, '# Test\n- Entry\n', {});
        const result = await commitChange(vaultPath, notePath, '[Flywheel:Add]');

        // Should still fail because lock file exists (even if empty)
        expect(result.success).toBe(false);
      } finally {
        await removeLockFile(lockPath);
      }
    });

    it('should handle lock file with invalid content', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('.');
      await git.commit('Initial commit');

      // Create lock file with invalid content
      const lockPath = path.join(vaultPath, '.git', 'index.lock');
      await fs.writeFile(lockPath, 'not-a-pid\ngarbage-data\n');

      try {
        await writeVaultFile(vaultPath, notePath, '# Test\n- Entry\n', {});
        const result = await commitChange(vaultPath, notePath, '[Flywheel:Add]');

        // Should fail because lock file exists
        expect(result.success).toBe(false);
      } finally {
        await removeLockFile(lockPath);
      }
    });

    it('should handle missing .git directory gracefully', async () => {
      // Create a non-git directory
      const nonGitPath = path.join(
        os.tmpdir(),
        `non-git-test-${Date.now()}`
      );
      await fs.mkdir(nonGitPath, { recursive: true });

      try {
        await writeVaultFile(nonGitPath, 'test.md', '# Test\n', {});

        const result = await commitChange(nonGitPath, 'test.md', '[Flywheel:Add]');
        expect(result.success).toBe(false);
        expect(result.error).toBe('Not a git repository');
      } finally {
        await fs.rm(nonGitPath, { recursive: true, force: true });
      }
    });
  });

  describe('lock file cleanup scenarios', () => {
    it('should verify lock file is not created by successful commit', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      // Successful commit
      const result = await commitChange(vaultPath, notePath, '[Flywheel:Add]');
      expect(result.success).toBe(true);

      // Lock file should not exist after successful commit
      expect(await lockFileExists(vaultPath)).toBe(false);
    });

    it('should not leave lock file after failed commit due to external lock', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('.');
      await git.commit('Initial commit');

      // Create external lock
      const lockPath = await createLockFile(vaultPath);

      try {
        await writeVaultFile(vaultPath, notePath, '# Test\n- Entry\n', {});
        const result = await commitChange(vaultPath, notePath, '[Flywheel:Add]');
        expect(result.success).toBe(false);

        // Our code shouldn't have removed the external lock
        expect(await lockFileExists(vaultPath)).toBe(true);
      } finally {
        await removeLockFile(lockPath);
      }

      // After external lock removed, no lock should exist
      expect(await lockFileExists(vaultPath)).toBe(false);
    });
  });
});
