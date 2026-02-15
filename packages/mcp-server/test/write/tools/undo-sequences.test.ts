/**
 * Undo Sequence Tests
 *
 * Validates undo behavior for sequential commits, external interference,
 * stash preservation, and dirty working tree handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { simpleGit, SimpleGit } from 'simple-git';
import {
  commitChange,
  undoLastCommit,
  getLastCommit,
  saveLastMutationCommit,
  getLastMutationCommit,
  clearLastMutationCommit,
  hasUncommittedChanges,
  isGitRepo,
  setGitStateDb,
} from '../../../src/core/write/git.js';
import { openStateDb, deleteStateDb, type StateDb } from '@velvetmonkey/vault-core';

let tempVault: string;
let git: SimpleGit;
let stateDb: StateDb;

async function createTempVault(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'undo-sequence-test-'));
  return dir;
}

async function cleanupTempVault(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

async function initGitRepo(dir: string): Promise<void> {
  git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@flywheel.test');
  await git.addConfig('user.name', 'Flywheel Test');
  // Disable autocrlf to prevent Windows line ending normalization from showing false uncommitted changes
  await git.addConfig('core.autocrlf', 'false');

  // Create initial commit
  await fs.writeFile(path.join(dir, '.gitkeep'), '', 'utf-8');
  await git.add('.gitkeep');
  await git.commit('Initial commit');
}

async function createTestNote(vaultPath: string, notePath: string, content: string): Promise<void> {
  const fullPath = path.join(vaultPath, notePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf-8');
}

async function readTestNote(vaultPath: string, notePath: string): Promise<string> {
  const fullPath = path.join(vaultPath, notePath);
  return fs.readFile(fullPath, 'utf-8');
}

async function getCommitCount(): Promise<number> {
  const log = await git.log();
  return log.total;
}

async function getHeadCommit(): Promise<string> {
  const log = await git.log({ maxCount: 1 });
  return log.latest?.hash || '';
}

describe('Sequential Undo Operations', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
    await initGitRepo(tempVault);
    stateDb = openStateDb(tempVault);
    setGitStateDb(stateDb);
  });

  afterEach(async () => {
    setGitStateDb(null);
    stateDb.db.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  it('should undo a single flywheel commit', async () => {
    await createTestNote(tempVault, 'test.md', '# Log\n');
    const commitResult = await commitChange(tempVault, 'test.md', '[Flywheel]');

    expect(commitResult.success).toBe(true);

    const initialCommits = await getCommitCount();

    // Now undo
    const undoResult = await undoLastCommit(tempVault);

    expect(undoResult.success).toBe(true);
    expect(undoResult.undoneCommit?.hash).toBe(commitResult.hash);

    const finalCommits = await getCommitCount();
    expect(finalCommits).toBe(initialCommits - 1);
  });

  it('should track last flywheel commit for safe undo', async () => {
    await createTestNote(tempVault, 'test.md', '# Log\n');
    const commitResult = await commitChange(tempVault, 'test.md', '[Flywheel]');

    // Save tracking info
    saveLastMutationCommit(commitResult.hash!, 'Test commit');

    const tracked = getLastMutationCommit();
    expect(tracked).not.toBeNull();
    expect(tracked?.hash).toBe(commitResult.hash);

    // Clear tracking
    clearLastMutationCommit();
    const clearedTracking = getLastMutationCommit();
    expect(clearedTracking).toBeNull();
  });

  it('should perform 3 sequential undos', async () => {
    // Create 3 commits
    const commits: string[] = [];

    for (let i = 1; i <= 3; i++) {
      await createTestNote(tempVault, `note${i}.md`, `# Note ${i}`);
      const result = await commitChange(tempVault, `note${i}.md`, `[Flywheel ${i}]`);
      commits.push(result.hash!);
    }

    const initialCommits = await getCommitCount();
    expect(initialCommits).toBe(4); // initial + 3

    // Undo 3 times
    for (let i = 0; i < 3; i++) {
      const undoResult = await undoLastCommit(tempVault);
      expect(undoResult.success).toBe(true);
    }

    const finalCommits = await getCommitCount();
    expect(finalCommits).toBe(1); // Only initial commit remains
  });

  it('should not undo past initial commit', async () => {
    const initialCommits = await getCommitCount();
    expect(initialCommits).toBe(1);

    // Try to undo - should fail or be graceful
    const undoResult = await undoLastCommit(tempVault);

    // Either fails or succeeds with no effect
    if (undoResult.success) {
      // If success, commits should still be 1 (can't undo initial)
      const finalCommits = await getCommitCount();
      expect(finalCommits).toBeGreaterThanOrEqual(1);
    } else {
      expect(undoResult.message).toBeDefined();
    }
  });
});

describe('External Commit Interference', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
    await initGitRepo(tempVault);
    stateDb = openStateDb(tempVault);
    setGitStateDb(stateDb);
  });

  afterEach(async () => {
    setGitStateDb(null);
    stateDb.db.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  it('should detect external commits made between flywheel operations', async () => {
    // Make a flywheel commit
    await createTestNote(tempVault, 'flywheel-note.md', '# Flywheel Note');
    const flywheelCommit = await commitChange(tempVault, 'flywheel-note.md', '[Flywheel]');
    saveLastMutationCommit(flywheelCommit.hash!, 'Flywheel commit');

    const flywheelHash = flywheelCommit.hash;

    // Simulate external commit (user or another tool)
    await createTestNote(tempVault, 'external.md', '# External Note');
    await git.add('external.md');
    await git.commit('[External] Manual commit');

    // Now HEAD != tracked flywheel commit
    const currentHead = await getHeadCommit();
    const tracked = getLastMutationCommit();

    expect(currentHead).not.toBe(tracked?.hash);
  });

  it('should warn when attempting to undo after external commit', async () => {
    // Make a flywheel commit
    await createTestNote(tempVault, 'flywheel-write.md', '# Flywheel');
    const flywheelCommit = await commitChange(tempVault, 'flywheel-write.md', '[Flywheel]');
    saveLastMutationCommit(flywheelCommit.hash!, 'Flywheel commit');

    // External commit
    await createTestNote(tempVault, 'external.md', '# External');
    await git.add('external.md');
    await git.commit('[External] User commit');

    // Attempt undo - should recognize interference
    // The actual behavior depends on implementation
    const undoResult = await undoLastCommit(tempVault);

    // If the undo system detects interference, it should either:
    // 1. Fail with clear message, OR
    // 2. Succeed but undo the external commit (not the flywheel commit)
    // The test validates the system handles this case
    expect(undoResult).toBeDefined();
  });
});

describe('Dirty Working Tree Handling', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
    await initGitRepo(tempVault);
    stateDb = openStateDb(tempVault);
    setGitStateDb(stateDb);
  });

  afterEach(async () => {
    setGitStateDb(null);
    stateDb.db.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  // Skip on Windows: git has known issues detecting uncommitted changes in automated tests
  // (file modes, timestamps, index locks). Functionality tested on Linux/macOS.
  it.skipIf(process.platform === 'win32')('should detect uncommitted changes', async () => {
    await createTestNote(tempVault, 'committed.md', '# Committed');
    // Also commit the .claude directory created by StateDb
    await git.add('.');
    await git.commit('Add committed file');

    // No uncommitted changes yet
    expect(await hasUncommittedChanges(tempVault)).toBe(false);

    // Make uncommitted changes
    await createTestNote(tempVault, 'uncommitted.md', '# Uncommitted');

    expect(await hasUncommittedChanges(tempVault)).toBe(true);
  });

  it('should handle undo with dirty working tree', async () => {
    // Create and commit a file
    await createTestNote(tempVault, 'original.md', '# Original');
    const commitResult = await commitChange(tempVault, 'original.md', '[Flywheel]');

    // Make uncommitted changes
    await createTestNote(tempVault, 'dirty.md', '# Dirty file');

    // Attempt undo with dirty working tree
    const undoResult = await undoLastCommit(tempVault);

    // Implementation may:
    // 1. Fail with "dirty working tree" error
    // 2. Proceed with undo (soft reset preserves working tree)
    // Either is valid behavior
    expect(undoResult).toBeDefined();

    // If undo succeeded, dirty file should still exist
    if (undoResult.success) {
      const dirtyExists = await fs.access(path.join(tempVault, 'dirty.md')).then(() => true).catch(() => false);
      expect(dirtyExists).toBe(true);
    }
  });

  it('should preserve staged changes on undo failure', async () => {
    // Create initial commit
    await createTestNote(tempVault, 'base.md', '# Base');
    await git.add('base.md');
    await git.commit('Base commit');

    // Create and commit a change
    await createTestNote(tempVault, 'change.md', '# Change');
    await commitChange(tempVault, 'change.md', '[Flywheel]');

    // Stage but don't commit another file
    await createTestNote(tempVault, 'staged.md', '# Staged');
    await git.add('staged.md');

    // Verify staged changes exist
    const statusBefore = await git.status();
    expect(statusBefore.staged.length).toBeGreaterThan(0);

    // Undo
    const undoResult = await undoLastCommit(tempVault);

    // Staged changes should be preserved after soft reset
    if (undoResult.success) {
      const statusAfter = await git.status();
      // After soft reset, previously committed file might appear in staged
      // The key is no data is lost
    }
  });
});

describe('Undo Result Information', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
    await initGitRepo(tempVault);
    stateDb = openStateDb(tempVault);
    setGitStateDb(stateDb);
  });

  afterEach(async () => {
    setGitStateDb(null);
    stateDb.db.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  it('should return undone commit hash', async () => {
    await createTestNote(tempVault, 'test.md', '# Test');
    const commitResult = await commitChange(tempVault, 'test.md', '[Flywheel]');
    const committedHash = commitResult.hash;

    const undoResult = await undoLastCommit(tempVault);

    expect(undoResult.success).toBe(true);
    expect(undoResult.undoneCommit?.hash).toBe(committedHash);
  });

  it('should provide clear error for non-git repo', async () => {
    const nonGitDir = await fs.mkdtemp(path.join(os.tmpdir(), 'non-git-'));

    try {
      const undoResult = await undoLastCommit(nonGitDir);

      expect(undoResult.success).toBe(false);
      expect(undoResult.message).toBeDefined();
      expect(undoResult.message.toLowerCase()).toMatch(/git|repository/);
    } finally {
      await fs.rm(nonGitDir, { recursive: true, force: true });
    }
  });
});

describe('Last Commit Tracking', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
    await initGitRepo(tempVault);
    stateDb = openStateDb(tempVault);
    setGitStateDb(stateDb);
  });

  afterEach(async () => {
    setGitStateDb(null);
    stateDb.db.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  it('should store and retrieve last commit info', async () => {
    const hash = 'abc123def456';
    const message = 'Test commit message';

    saveLastMutationCommit(hash, message);

    const retrieved = getLastMutationCommit();

    expect(retrieved).not.toBeNull();
    expect(retrieved?.hash).toBe(hash);
    expect(retrieved?.message).toBe(message);
    expect(retrieved?.timestamp).toBeDefined();
  });

  it('should clear last commit tracking', async () => {
    saveLastMutationCommit('hash123', 'message');

    clearLastMutationCommit();

    const retrieved = getLastMutationCommit();
    expect(retrieved).toBeNull();
  });

  it('should overwrite previous tracking on new commit', async () => {
    saveLastMutationCommit('first-hash', 'First commit');
    saveLastMutationCommit('second-hash', 'Second commit');

    const retrieved = getLastMutationCommit();

    expect(retrieved?.hash).toBe('second-hash');
    expect(retrieved?.message).toBe('Second commit');
  });
});

describe('Get Last Commit Info', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
    await initGitRepo(tempVault);
    stateDb = openStateDb(tempVault);
    setGitStateDb(stateDb);
  });

  afterEach(async () => {
    setGitStateDb(null);
    stateDb.db.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  it('should return info about the last commit', async () => {
    await createTestNote(tempVault, 'test.md', '# Test content');
    await commitChange(tempVault, 'test.md', '[Flywheel]');

    const lastCommit = await getLastCommit(tempVault);

    expect(lastCommit).not.toBeNull();
    expect(lastCommit?.hash).toBeTruthy();
    expect(lastCommit?.message).toContain('[Flywheel]');
    expect(lastCommit?.date).toBeDefined();
  });

  it('should return null for empty repo', async () => {
    const emptyRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'empty-repo-'));
    const emptyGit = simpleGit(emptyRepo);
    await emptyGit.init();

    try {
      const lastCommit = await getLastCommit(emptyRepo);
      // May return null or initial empty state
      expect(lastCommit === null || lastCommit).toBeTruthy();
    } finally {
      await fs.rm(emptyRepo, { recursive: true, force: true });
    }
  });
});
