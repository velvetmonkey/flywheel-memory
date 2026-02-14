/**
 * Git concurrency and lock handling tests
 *
 * Tests retry logic, stale lock detection, and response contract compliance
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { commitChange, isGitRepo, getLastCommit } from '../../src/core/git.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
} from '../helpers/testUtils.js';
import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

/**
 * Initialize a git repo with user config
 */
async function initGitRepo(vaultPath: string): Promise<void> {
  execSync('git init', { cwd: vaultPath, stdio: 'ignore' });
  execSync('git config user.email "test@example.com"', { cwd: vaultPath, stdio: 'ignore' });
  execSync('git config user.name "Test User"', { cwd: vaultPath, stdio: 'ignore' });
}

/**
 * Create a lock file with a specific age
 */
async function createLockFile(vaultPath: string, ageMs: number = 0): Promise<void> {
  const lockPath = path.join(vaultPath, '.git/index.lock');
  await fs.writeFile(lockPath, 'lock');

  if (ageMs > 0) {
    // Set mtime to make the lock appear old
    const pastTime = new Date(Date.now() - ageMs);
    await fs.utimes(lockPath, pastTime, pastTime);
  }
}

/**
 * Remove the lock file
 */
async function removeLockFile(vaultPath: string): Promise<void> {
  const lockPath = path.join(vaultPath, '.git/index.lock');
  try {
    await fs.unlink(lockPath);
  } catch {
    // File doesn't exist, ignore
  }
}

/**
 * Check if lock file exists
 */
async function lockFileExists(vaultPath: string): Promise<boolean> {
  const lockPath = path.join(vaultPath, '.git/index.lock');
  try {
    await fs.access(lockPath);
    return true;
  } catch {
    return false;
  }
}

describe('GitCommitResult response contract', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
    await initGitRepo(tempVault);
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should return undoAvailable: true on successful commit', async () => {
    await createTestNote(tempVault, 'test.md', '# Test');
    const result = await commitChange(tempVault, 'test.md', '[Test]');

    expect(result.success).toBe(true);
    expect(result.undoAvailable).toBe(true);
    expect(result.hash).toBeTruthy();
  });

  it('should return undoAvailable: false on failed commit', async () => {
    // Try to commit to non-git directory
    const nonGitVault = await createTempVault();
    await createTestNote(nonGitVault, 'test.md', '# Test');

    const result = await commitChange(nonGitVault, 'test.md', '[Test]');

    expect(result.success).toBe(false);
    expect(result.undoAvailable).toBe(false);

    await cleanupTempVault(nonGitVault);
  });

  it('should not include staleLockDetected when no lock exists', async () => {
    await createTestNote(tempVault, 'test.md', '# Test');
    const result = await commitChange(tempVault, 'test.md', '[Test]');

    expect(result.success).toBe(true);
    expect(result.staleLockDetected).toBeUndefined();
    expect(result.lockAgeMs).toBeUndefined();
  });
});

describe('Retry logic', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
    await initGitRepo(tempVault);
  });

  afterEach(async () => {
    await removeLockFile(tempVault);
    await cleanupTempVault(tempVault);
  });

  it('should succeed when lock file is removed between retries', async () => {
    await createTestNote(tempVault, 'test.md', '# Test');

    // Create lock file
    await createLockFile(tempVault);

    // Schedule lock removal after short delay
    setTimeout(async () => {
      await removeLockFile(tempVault);
    }, 150);

    // This should succeed after retry
    const result = await commitChange(tempVault, 'test.md', '[Test]');

    expect(result.success).toBe(true);
    expect(result.hash).toBeTruthy();
  });

  it('should fail after max retries when lock persists', async () => {
    await createTestNote(tempVault, 'test.md', '# Test');

    // Create persistent lock file
    await createLockFile(tempVault);

    // Custom config with fewer retries for faster test
    const result = await commitChange(tempVault, 'test.md', '[Test]', {
      maxAttempts: 2,
      baseDelayMs: 10,
      maxDelayMs: 50,
      jitter: false,
    });

    expect(result.success).toBe(false);
    expect(result.undoAvailable).toBe(false);
    expect(result.error).toBeTruthy();
    // Lock should still exist (we don't auto-clean)
    expect(await lockFileExists(tempVault)).toBe(true);
  });

  it('should respect maxAttempts configuration', async () => {
    await createTestNote(tempVault, 'test.md', '# Test');

    // Create persistent lock
    await createLockFile(tempVault);

    const startTime = Date.now();
    const result = await commitChange(tempVault, 'test.md', '[Test]', {
      maxAttempts: 1, // No retries
      baseDelayMs: 1000, // Would be slow if retried
      maxDelayMs: 1000,
      jitter: false,
    });
    const elapsed = Date.now() - startTime;

    expect(result.success).toBe(false);
    // Should complete quickly with only 1 attempt
    expect(elapsed).toBeLessThan(500);
  });
});

describe('Stale lock detection', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
    await initGitRepo(tempVault);
  });

  afterEach(async () => {
    await removeLockFile(tempVault);
    await cleanupTempVault(tempVault);
  });

  it('should report staleLockDetected when lock is older than 30s', async () => {
    await createTestNote(tempVault, 'test.md', '# Test');

    // Create a stale lock (35 seconds old)
    await createLockFile(tempVault, 35_000);

    const result = await commitChange(tempVault, 'test.md', '[Test]', {
      maxAttempts: 1,
      baseDelayMs: 10,
      maxDelayMs: 10,
      jitter: false,
    });

    expect(result.success).toBe(false);
    expect(result.staleLockDetected).toBe(true);
    expect(result.lockAgeMs).toBeGreaterThanOrEqual(35_000);
  });

  it('should NOT report staleLockDetected for fresh lock', async () => {
    await createTestNote(tempVault, 'test.md', '# Test');

    // Create fresh lock (just created)
    await createLockFile(tempVault, 0);

    const result = await commitChange(tempVault, 'test.md', '[Test]', {
      maxAttempts: 1,
      baseDelayMs: 10,
      maxDelayMs: 10,
      jitter: false,
    });

    expect(result.success).toBe(false);
    expect(result.staleLockDetected).toBeUndefined();
  });

  it('should NOT auto-remove stale locks (report only)', async () => {
    await createTestNote(tempVault, 'test.md', '# Test');

    // Create a stale lock
    await createLockFile(tempVault, 35_000);

    await commitChange(tempVault, 'test.md', '[Test]', {
      maxAttempts: 2,
      baseDelayMs: 10,
      maxDelayMs: 10,
      jitter: false,
    });

    // Lock should still exist - we only report, not cleanup
    expect(await lockFileExists(tempVault)).toBe(true);
  });

  it('should report stale lock even when commit eventually succeeds', async () => {
    await createTestNote(tempVault, 'test.md', '# Test');

    // Create a stale lock
    await createLockFile(tempVault, 35_000);

    // Remove lock after short delay (simulating another process completing)
    setTimeout(async () => {
      await removeLockFile(tempVault);
    }, 50);

    const result = await commitChange(tempVault, 'test.md', '[Test]', {
      maxAttempts: 3,
      baseDelayMs: 50,
      maxDelayMs: 100,
      jitter: false,
    });

    // Should succeed after lock is removed
    expect(result.success).toBe(true);
    expect(result.undoAvailable).toBe(true);
    // On Windows, filesystem timestamp precision may differ, causing stale lock detection
    // to behave differently. Only assert staleLockDetected on non-Windows platforms.
    if (process.platform !== 'win32') {
      expect(result.staleLockDetected).toBe(true);
    }
  });
});

describe('Lock contention error detection', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
    await initGitRepo(tempVault);
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should NOT retry non-lock errors', async () => {
    // Try to commit non-existent file - should fail immediately without retry
    const startTime = Date.now();
    const result = await commitChange(tempVault, 'nonexistent.md', '[Test]', {
      maxAttempts: 3,
      baseDelayMs: 500, // Would be slow if retried
      maxDelayMs: 1000,
      jitter: false,
    });
    const elapsed = Date.now() - startTime;

    expect(result.success).toBe(false);
    // Should fail quickly without retries
    expect(elapsed).toBeLessThan(200);
    expect(result.undoAvailable).toBe(false);
  });
});

describe('Exponential backoff timing', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
    await initGitRepo(tempVault);
  });

  afterEach(async () => {
    await removeLockFile(tempVault);
    await cleanupTempVault(tempVault);
  });

  it('should complete within expected time bounds', async () => {
    await createTestNote(tempVault, 'test.md', '# Test');
    await createLockFile(tempVault);

    const startTime = Date.now();
    await commitChange(tempVault, 'test.md', '[Test]', {
      maxAttempts: 3,
      baseDelayMs: 50,
      maxDelayMs: 200,
      jitter: false,
    });
    const elapsed = Date.now() - startTime;

    // With 3 attempts, baseDelay 50ms, delays should be:
    // Attempt 0: fail, delay 50ms (50 * 2^0)
    // Attempt 1: fail, delay 100ms (50 * 2^1)
    // Attempt 2: fail (no delay after last attempt)
    // Total delays: ~150ms + operation time
    // Allow some margin for operation time
    expect(elapsed).toBeGreaterThan(100); // At least some delays happened
    expect(elapsed).toBeLessThan(1000); // But not too long
  });
});

describe('Hash-based undo verification', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
    await initGitRepo(tempVault);
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should track last commit hash for undo verification', async () => {
    await createTestNote(tempVault, 'test.md', '# Test');
    const commitResult = await commitChange(tempVault, 'test.md', '[Test]');

    expect(commitResult.success).toBe(true);
    expect(commitResult.hash).toBeTruthy();

    // Verify the commit exists in git
    const lastCommit = await getLastCommit(tempVault);
    expect(lastCommit).not.toBeNull();
    expect(lastCommit?.hash).toBe(commitResult.hash);
  });

  it('should preserve undoAvailable state correctly', async () => {
    await createTestNote(tempVault, 'test.md', '# Test v1');
    const result1 = await commitChange(tempVault, 'test.md', '[Test]');

    expect(result1.undoAvailable).toBe(true);

    await createTestNote(tempVault, 'test.md', '# Test v2');
    const result2 = await commitChange(tempVault, 'test.md', '[Test]');

    expect(result2.undoAvailable).toBe(true);
    expect(result2.hash).not.toBe(result1.hash);
  });
});

describe('Concurrent commit simulation', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
    await initGitRepo(tempVault);
  });

  afterEach(async () => {
    await removeLockFile(tempVault);
    await cleanupTempVault(tempVault);
  });

  it('should handle rapid successive commits', async () => {
    // Create initial file
    await createTestNote(tempVault, 'test.md', '# Test');

    // First commit should succeed
    const result1 = await commitChange(tempVault, 'test.md', '[Test1]');
    expect(result1.success).toBe(true);

    // Modify file
    await createTestNote(tempVault, 'test.md', '# Test v2');

    // Second commit should also succeed
    const result2 = await commitChange(tempVault, 'test.md', '[Test2]');
    expect(result2.success).toBe(true);

    // Verify we have 2 commits
    const log = execSync('git log --oneline', {
      cwd: tempVault,
      encoding: 'utf-8',
    });
    const commits = log.trim().split('\n');
    expect(commits.length).toBe(2);
  });

  it('should succeed with at least one commit when running in parallel', async () => {
    // Create test files
    await createTestNote(tempVault, 'file1.md', '# File 1');
    await createTestNote(tempVault, 'file2.md', '# File 2');
    await createTestNote(tempVault, 'file3.md', '# File 3');

    // Run commits in parallel
    const results = await Promise.all([
      commitChange(tempVault, 'file1.md', '[Parallel1]'),
      commitChange(tempVault, 'file2.md', '[Parallel2]'),
      commitChange(tempVault, 'file3.md', '[Parallel3]'),
    ]);

    // At least one should succeed
    const successCount = results.filter(r => r.success).length;
    expect(successCount).toBeGreaterThanOrEqual(1);

    // For successful ones, undoAvailable should match whether a hash exists
    // (a "successful" commit with no changes produces no hash, so nothing to undo)
    for (const result of results) {
      if (result.success && result.hash) {
        expect(result.undoAvailable).toBe(true);
      } else {
        expect(result.undoAvailable).toBe(false);
      }
    }
  });
});
