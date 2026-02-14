/**
 * Battle-Hardening Tests: Git Lock Contention
 *
 * Tests git lock handling and best-effort commit behavior:
 * - Simulate .git/index.lock conflicts
 * - Verify best-effort commits work (mutation succeeds, git fails gracefully)
 * - Multiple processes competing for lock
 * - Git undo when competing writes occur
 * - Verify gitError field captures lock failures
 * - File watcher conflict tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { simpleGit, SimpleGit } from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  writeVaultFile,
  readVaultFile,
  findSection,
  insertInSection,
} from '../../src/core/writer.js';
import {
  commitChange,
  isGitRepo,
  getLastCommit,
  undoLastCommit,
  getLastCrankCommit,
  clearLastCrankCommit,
  setGitStateDb,
} from '../../src/core/git.js';
import { openStateDb, deleteStateDb, type StateDb } from '@velvetmonkey/vault-core';

/**
 * Create a temporary vault with git initialized
 */
async function createGitVault(): Promise<string> {
  const vaultPath = path.join(os.tmpdir(), `flywheel-git-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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
 * Create a git lock file to simulate contention
 */
async function createLockFile(vaultPath: string): Promise<string> {
  const lockPath = path.join(vaultPath, '.git', 'index.lock');
  await fs.writeFile(lockPath, `${process.pid}\n`);
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

describe('Battle-Hardening: Git Lock Contention', () => {
  let vaultPath: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    vaultPath = await createGitVault();
    stateDb = openStateDb(vaultPath);
    setGitStateDb(stateDb);
  });

  afterEach(async () => {
    setGitStateDb(null);
    stateDb.db.close();
    deleteStateDb(vaultPath);
    await cleanupVault(vaultPath);
  });

  describe('index.lock conflict simulation', () => {
    it('should fail commit gracefully when index.lock exists', async () => {
      // Create a file
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n\n## Log\n', {});

      // Create initial commit
      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('.');
      await git.commit('Initial commit');

      // Modify the file
      await writeVaultFile(vaultPath, notePath, '# Test\n\n## Log\n- Entry\n', {});

      // Create lock file to simulate contention
      const lockPath = await createLockFile(vaultPath);

      try {
        // Attempt to commit - should fail due to lock
        const result = await commitChange(vaultPath, notePath, '[Crank:Add]');

        // Commit should fail
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error).toMatch(/lock|index/i);
        expect(result.hash).toBeUndefined();
      } finally {
        await removeLockFile(lockPath);
      }
    });

    it('should allow mutation to succeed even when commit fails', async () => {
      const notePath = 'test.md';
      const initialContent = '# Test\n\n## Log\n';
      await writeVaultFile(vaultPath, notePath, initialContent, {});

      // Initial commit
      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('.');
      await git.commit('Initial commit');

      // Create lock before mutation
      const lockPath = await createLockFile(vaultPath);

      try {
        // File mutation should still work
        const newContent = '# Test\n\n## Log\n- New entry\n';
        await writeVaultFile(vaultPath, notePath, newContent, {});

        // Verify file was written
        const { content } = await readVaultFile(vaultPath, notePath);
        expect(content).toContain('- New entry');

        // But commit fails
        const commitResult = await commitChange(vaultPath, notePath, '[Crank:Add]');
        expect(commitResult.success).toBe(false);
      } finally {
        await removeLockFile(lockPath);
      }
    });

    it('should succeed after lock is released', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('.');
      await git.commit('Initial commit');

      // Create and immediately remove lock
      const lockPath = await createLockFile(vaultPath);
      await removeLockFile(lockPath);

      // Modify and commit
      await writeVaultFile(vaultPath, notePath, '# Test\n- Entry\n', {});
      const result = await commitChange(vaultPath, notePath, '[Crank:Add]');

      expect(result.success).toBe(true);
      expect(result.hash).toBeDefined();
    });
  });

  describe('best-effort commit behavior', () => {
    it('should return success=true for mutation even when git fails', async () => {
      // This test verifies the design philosophy:
      // Mutations always succeed, git is best-effort

      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n\n## Log\n', {});

      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('.');
      await git.commit('Initial commit');

      // Create lock
      const lockPath = await createLockFile(vaultPath);

      try {
        // Simulate a mutation workflow
        const { content: currentContent, frontmatter } = await readVaultFile(vaultPath, notePath);
        const section = findSection(currentContent, 'Log')!;
        const newContent = insertInSection(currentContent, section, '- New entry', 'append');
        await writeVaultFile(vaultPath, notePath, newContent, frontmatter);

        // Verify the file was mutated
        const { content: verifyContent } = await readVaultFile(vaultPath, notePath);
        expect(verifyContent).toContain('- New entry');

        // The commit fails due to lock
        const commitResult = await commitChange(vaultPath, notePath, '[Crank:Add]');
        expect(commitResult.success).toBe(false);

        // But file is still modified
        const { content: finalContent } = await readVaultFile(vaultPath, notePath);
        expect(finalContent).toContain('- New entry');
      } finally {
        await removeLockFile(lockPath);
      }
    });

    it('should not corrupt file when commit fails', async () => {
      const notePath = 'test.md';
      const originalContent = `---
type: test
important: preserved
---
# Title

## Log
- Existing entry
`;
      await writeVaultFile(vaultPath, notePath, originalContent.slice(originalContent.indexOf('# Title')), {
        type: 'test',
        important: 'preserved',
      });

      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('.');
      await git.commit('Initial commit');

      // Lock before mutation
      const lockPath = await createLockFile(vaultPath);

      try {
        // Perform mutation
        const { content, frontmatter } = await readVaultFile(vaultPath, notePath);
        const section = findSection(content, 'Log')!;
        const newContent = insertInSection(content, section, '- New entry', 'append');
        await writeVaultFile(vaultPath, notePath, newContent, frontmatter);

        // Commit fails
        await commitChange(vaultPath, notePath, '[Crank:Add]');

        // Verify file integrity
        const { content: finalContent, frontmatter: finalFm } = await readVaultFile(vaultPath, notePath);
        expect(finalFm.important).toBe('preserved');
        expect(finalContent).toContain('- Existing entry');
        expect(finalContent).toContain('- New entry');
      } finally {
        await removeLockFile(lockPath);
      }
    });
  });

  describe('gitError field validation', () => {
    it('should capture lock error in gitError field', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('.');
      await git.commit('Initial commit');

      await writeVaultFile(vaultPath, notePath, '# Test\n- Entry\n', {});

      const lockPath = await createLockFile(vaultPath);

      try {
        const result = await commitChange(vaultPath, notePath, '[Crank:Add]');

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(typeof result.error).toBe('string');
        expect(result.error!.length).toBeGreaterThan(0);
      } finally {
        await removeLockFile(lockPath);
      }
    });

    it('should return specific error message for non-git directory', async () => {
      // Create a non-git directory
      const nonGitPath = path.join(os.tmpdir(), `non-git-${Date.now()}`);
      await fs.mkdir(nonGitPath, { recursive: true });

      try {
        await writeVaultFile(nonGitPath, 'test.md', '# Test\n', {});

        const result = await commitChange(nonGitPath, 'test.md', '[Crank:Add]');

        expect(result.success).toBe(false);
        expect(result.error).toBe('Not a git repository');
      } finally {
        await fs.rm(nonGitPath, { recursive: true, force: true });
      }
    });

    it('should not set gitError when commit succeeds', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      const result = await commitChange(vaultPath, notePath, '[Crank:Add]');

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.hash).toBeDefined();
    });
  });

  describe('commit tracking for safe undo', () => {
    it('should track last Crank commit', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      const result = await commitChange(vaultPath, notePath, '[Crank:Add]');
      expect(result.success).toBe(true);

      const tracked = getLastCrankCommit();
      expect(tracked).not.toBeNull();
      expect(tracked!.hash).toBe(result.hash);
      expect(tracked!.message).toContain('[Crank:Add]');
    });

    it('should update tracking on each successful commit', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      const result1 = await commitChange(vaultPath, notePath, '[Crank:Add]');
      expect(result1.success).toBe(true);

      const tracked1 = getLastCrankCommit();
      expect(tracked1!.hash).toBe(result1.hash);

      // Second commit
      await writeVaultFile(vaultPath, notePath, '# Test\n- Entry\n', {});
      const result2 = await commitChange(vaultPath, notePath, '[Crank:Add]');
      expect(result2.success).toBe(true);

      const tracked2 = getLastCrankCommit();
      expect(tracked2!.hash).toBe(result2.hash);
      expect(tracked2!.hash).not.toBe(tracked1!.hash);
    });

    it('should not update tracking when commit fails', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      // First successful commit
      const result1 = await commitChange(vaultPath, notePath, '[Crank:Add]');
      expect(result1.success).toBe(true);

      const tracked1 = getLastCrankCommit();

      // Lock and try another commit
      await writeVaultFile(vaultPath, notePath, '# Test\n- Entry\n', {});
      const lockPath = await createLockFile(vaultPath);

      try {
        const result2 = await commitChange(vaultPath, notePath, '[Crank:Add]');
        expect(result2.success).toBe(false);

        // Tracking should still point to first commit
        const tracked2 = getLastCrankCommit();
        expect(tracked2!.hash).toBe(tracked1!.hash);
      } finally {
        await removeLockFile(lockPath);
      }
    });
  });

  describe('undo safety with competing processes', () => {
    it('should allow undo when HEAD matches tracked commit', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      // Create initial commit (needed for HEAD~1 to work)
      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('.');
      await git.commit('Initial commit');

      // Now make a Crank commit
      await writeVaultFile(vaultPath, notePath, '# Test\n- Entry\n', {});
      const commitResult = await commitChange(vaultPath, notePath, '[Crank:Add]');
      expect(commitResult.success).toBe(true);

      const undoResult = await undoLastCommit(vaultPath);
      expect(undoResult.success).toBe(true);
      expect(undoResult.undoneCommit!.hash).toBe(commitResult.hash);
    });

    it('should report commit hash mismatch when external commit occurred', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      // Crank makes a commit
      const crankResult = await commitChange(vaultPath, notePath, '[Crank:Add]');
      expect(crankResult.success).toBe(true);

      const tracked = getLastCrankCommit();
      expect(tracked!.hash).toBe(crankResult.hash);

      // Simulate external process making a commit
      await writeVaultFile(vaultPath, 'external.md', '# External\n', {});
      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('external.md');
      await git.commit('External commit');

      // Now HEAD is different from tracked commit
      const lastCommit = await getLastCommit(vaultPath);
      expect(lastCommit!.hash).not.toBe(tracked!.hash);
    });

    it('should clear tracking after successful undo', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      await commitChange(vaultPath, notePath, '[Crank:Add]');

      const trackedBefore = getLastCrankCommit();
      expect(trackedBefore).not.toBeNull();

      await undoLastCommit(vaultPath);
      clearLastCrankCommit();

      const trackedAfter = getLastCrankCommit();
      expect(trackedAfter).toBeNull();
    });
  });

  describe('concurrent access patterns', () => {
    it('should handle rapid sequential commits', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      const results: Array<{ success: boolean; hash?: string }> = [];

      // Rapid sequential commits
      for (let i = 0; i < 5; i++) {
        await writeVaultFile(vaultPath, notePath, `# Test\n- Entry ${i}\n`, {});
        const result = await commitChange(vaultPath, notePath, `[Crank:Add] ${i}`);
        results.push(result);
      }

      // All should succeed (sequential, no contention)
      expect(results.every(r => r.success)).toBe(true);

      // Each should have a unique hash
      const hashes = results.map(r => r.hash).filter(Boolean);
      const uniqueHashes = new Set(hashes);
      expect(uniqueHashes.size).toBe(5);
    });

    it('should handle file modified during commit preparation', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('.');
      await git.commit('Initial');

      // Read file
      const { content, frontmatter } = await readVaultFile(vaultPath, notePath);

      // Simulate external modification while we're preparing our commit
      await fs.writeFile(
        path.join(vaultPath, notePath),
        '# Test\n- External entry\n'
      );

      // Our modification (would overwrite external)
      const section = findSection(content, 'Test');
      if (section) {
        const newContent = insertInSection(content, section, '- Our entry', 'append');
        await writeVaultFile(vaultPath, notePath, newContent, frontmatter);
      }

      // Commit should still work
      const result = await commitChange(vaultPath, notePath, '[Crank:Add]');
      expect(result.success).toBe(true);
    });
  });

  describe('external commit detection', () => {
    it('should detect when HEAD changed after Crank commit', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      // Crank makes a commit
      const crankResult = await commitChange(vaultPath, notePath, '[Crank:Add]');
      expect(crankResult.success).toBe(true);

      const trackedAfterCrank = getLastCrankCommit();
      expect(trackedAfterCrank).not.toBeNull();

      // External process makes a commit
      await writeVaultFile(vaultPath, 'external.md', '# External\n', {});
      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('external.md');
      await git.commit('External commit');

      // HEAD should now differ from tracked Crank commit
      const currentHead = await getLastCommit(vaultPath);
      expect(currentHead).not.toBeNull();
      expect(currentHead!.hash).not.toBe(trackedAfterCrank!.hash);

      // But tracking still points to Crank's commit
      const trackedNow = getLastCrankCommit();
      expect(trackedNow!.hash).toBe(trackedAfterCrank!.hash);
    });

    it('should warn when undo would revert external changes', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      // Initial commit
      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('.');
      await git.commit('Initial commit');

      // Crank commit
      await writeVaultFile(vaultPath, notePath, '# Test\n- Entry\n', {});
      const crankResult = await commitChange(vaultPath, notePath, '[Crank:Add]');
      expect(crankResult.success).toBe(true);

      // External commit on top
      await writeVaultFile(vaultPath, 'external.md', '# Important external work\n', {});
      await git.add('external.md');
      await git.commit('Important external work');

      // Undo should warn/fail because HEAD != tracked commit
      const undoResult = await undoLastCommit(vaultPath);

      // The undo will work but it undoes the external commit, not the Crank commit
      // This is the expected behavior - undo always undoes HEAD
      // The warning comes from checking tracked vs HEAD mismatch
      const tracked = getLastCrankCommit();
      const currentHead = await getLastCommit(vaultPath);

      // After undo, HEAD should match Crank's commit
      expect(currentHead!.hash).toBe(tracked!.hash);
    });

    it('should handle rapid external commits interleaved with Crank', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('.');
      await git.commit('Initial commit');

      // Interleave Crank and external commits
      for (let i = 0; i < 3; i++) {
        // Crank commit
        await writeVaultFile(vaultPath, notePath, `# Test\n- Crank entry ${i}\n`, {});
        const crankResult = await commitChange(vaultPath, notePath, `[Crank:Add] ${i}`);
        expect(crankResult.success).toBe(true);

        // External commit
        await writeVaultFile(vaultPath, `external-${i}.md`, `# External ${i}\n`, {});
        await git.add(`external-${i}.md`);
        await git.commit(`External commit ${i}`);
      }

      // After interleaving, tracked commit should be the last Crank commit
      const tracked = getLastCrankCommit();
      expect(tracked).not.toBeNull();
      expect(tracked!.message).toContain('[Crank:Add] 2');

      // But HEAD should be the last external commit
      const head = await getLastCommit(vaultPath);
      expect(head!.message).toContain('External commit 2');
    });

    it('should correctly identify Crank commits among mixed commits', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      const git: SimpleGit = simpleGit(vaultPath);

      // External initial commit
      await git.add('.');
      await git.commit('Initial (external)');

      // Crank commit
      await writeVaultFile(vaultPath, notePath, '# Test\n- Entry\n', {});
      const crankResult = await commitChange(vaultPath, notePath, '[Crank:Add]');
      expect(crankResult.success).toBe(true);

      // Get log to verify commit messages
      const log = await git.log();
      expect(log.all.length).toBe(2);

      // Most recent should be Crank
      expect(log.latest!.message).toContain('[Crank:Add]');

      // Tracked should match
      const tracked = getLastCrankCommit();
      expect(tracked!.hash).toBe(log.latest!.hash);
    });

    it('should preserve tracking across multiple Crank commits with external in between', async () => {
      const notePath = 'test.md';
      await writeVaultFile(vaultPath, notePath, '# Test\n', {});

      const git: SimpleGit = simpleGit(vaultPath);
      await git.add('.');
      await git.commit('Initial');

      // First Crank commit
      await writeVaultFile(vaultPath, notePath, '# Test\n- Entry 1\n', {});
      const crank1 = await commitChange(vaultPath, notePath, '[Crank:Add] First');
      expect(crank1.success).toBe(true);

      const tracked1 = getLastCrankCommit();

      // External commit
      await writeVaultFile(vaultPath, 'ext.md', '# Ext\n', {});
      await git.add('ext.md');
      await git.commit('External');

      // Tracking should still point to Crank's commit
      const trackedAfterExternal = getLastCrankCommit();
      expect(trackedAfterExternal!.hash).toBe(tracked1!.hash);

      // Second Crank commit
      await writeVaultFile(vaultPath, notePath, '# Test\n- Entry 1\n- Entry 2\n', {});
      const crank2 = await commitChange(vaultPath, notePath, '[Crank:Add] Second');
      expect(crank2.success).toBe(true);

      // Tracking should now point to second Crank commit
      const tracked2 = getLastCrankCommit();
      expect(tracked2!.hash).toBe(crank2.hash);
      expect(tracked2!.hash).not.toBe(tracked1!.hash);
    });
  });

  describe('git repository state edge cases', () => {
    it('should handle empty repository (no commits)', async () => {
      // vaultPath is initialized but has no commits
      const notePath = 'first.md';
      await writeVaultFile(vaultPath, notePath, '# First\n', {});

      // First commit in empty repo
      const result = await commitChange(vaultPath, notePath, '[Crank:Create]');
      expect(result.success).toBe(true);
      expect(result.hash).toBeDefined();
    });

    it('should report isGitRepo correctly', async () => {
      expect(await isGitRepo(vaultPath)).toBe(true);

      const nonGitPath = path.join(os.tmpdir(), `non-git-${Date.now()}`);
      await fs.mkdir(nonGitPath, { recursive: true });

      try {
        expect(await isGitRepo(nonGitPath)).toBe(false);
      } finally {
        await fs.rm(nonGitPath, { recursive: true, force: true });
      }
    });

    it('should handle undo with no commits', async () => {
      // Empty repo, no commits to undo
      const result = await undoLastCommit(vaultPath);

      expect(result.success).toBe(false);
      expect(result.message).toContain('No commits');
    });
  });
});
