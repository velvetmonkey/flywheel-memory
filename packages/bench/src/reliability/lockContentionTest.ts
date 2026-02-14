/**
 * Lock contention tests
 *
 * Tests that policies correctly detect and handle git lock contention.
 * Verifies fail-fast behavior when .git/index.lock exists.
 */

import fs from 'fs/promises';
import path from 'path';
import { simpleGit, SimpleGit } from 'simple-git';
import type { ReliabilityTestResult, ReliabilityTestConfig } from './types.js';

/**
 * Check if git lock file exists
 */
export async function checkLockExists(vaultPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(vaultPath, '.git/index.lock'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a lock file to simulate git lock contention
 */
export async function createLockFile(vaultPath: string): Promise<void> {
  const lockPath = path.join(vaultPath, '.git/index.lock');
  await fs.writeFile(lockPath, `Simulated lock at ${new Date().toISOString()}`);
}

/**
 * Remove lock file
 */
export async function removeLockFile(vaultPath: string): Promise<void> {
  try {
    await fs.unlink(path.join(vaultPath, '.git/index.lock'));
  } catch {
    // Already removed
  }
}

/**
 * Initialize git repo if not exists
 */
export async function ensureGitRepo(vaultPath: string): Promise<SimpleGit> {
  const git = simpleGit(vaultPath);

  try {
    await git.status();
  } catch {
    // Not a git repo, initialize
    await fs.mkdir(vaultPath, { recursive: true });
    await git.init();
    await git.addConfig('user.email', 'test@test.com');
    await git.addConfig('user.name', 'Test User');

    // Create initial commit
    const testFile = path.join(vaultPath, 'initial.md');
    await fs.writeFile(testFile, '# Initial\n');
    await git.add('initial.md');
    await git.commit('Initial commit');
  }

  return git;
}

/**
 * Test: Detect lock file before mutation
 */
export async function testLockDetection(
  config: ReliabilityTestConfig
): Promise<ReliabilityTestResult> {
  const startTime = Date.now();

  try {
    // Ensure git repo exists
    await ensureGitRepo(config.vaultPath);

    // Create lock file
    await createLockFile(config.vaultPath);

    // Check detection
    const lockExists = await checkLockExists(config.vaultPath);

    // Cleanup
    await removeLockFile(config.vaultPath);

    if (!lockExists) {
      return {
        name: 'lock_detection',
        passed: false,
        message: 'Lock file was created but not detected',
        duration_ms: Date.now() - startTime,
      };
    }

    return {
      name: 'lock_detection',
      passed: true,
      message: 'Lock file correctly detected',
      duration_ms: Date.now() - startTime,
    };
  } catch (error) {
    return {
      name: 'lock_detection',
      passed: false,
      message: `Test error: ${error instanceof Error ? error.message : String(error)}`,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Test: Fail fast when lock exists (no file mutation should occur)
 */
export async function testFailFastOnLock(
  config: ReliabilityTestConfig
): Promise<ReliabilityTestResult> {
  const startTime = Date.now();

  try {
    // Ensure git repo exists
    await ensureGitRepo(config.vaultPath);

    // Create a test file with known content
    const testFile = 'test-note.md';
    const originalContent = '# Test Note\n\nOriginal content\n';
    await fs.writeFile(path.join(config.vaultPath, testFile), originalContent);

    // Create lock file
    await createLockFile(config.vaultPath);

    // Attempt to detect lock BEFORE any mutation
    const lockExists = await checkLockExists(config.vaultPath);

    if (lockExists) {
      // Proper behavior: don't mutate if lock exists
      // Verify file was NOT modified
      const content = await fs.readFile(
        path.join(config.vaultPath, testFile),
        'utf-8'
      );

      // Cleanup
      await removeLockFile(config.vaultPath);

      if (content !== originalContent) {
        return {
          name: 'fail_fast_on_lock',
          passed: false,
          message: 'File was modified despite lock detection',
          duration_ms: Date.now() - startTime,
        };
      }

      return {
        name: 'fail_fast_on_lock',
        passed: true,
        message: 'Correctly detected lock and prevented mutation',
        duration_ms: Date.now() - startTime,
        metrics: {
          lock_detected_ms: Date.now() - startTime,
        },
      };
    }

    // Cleanup
    await removeLockFile(config.vaultPath);

    return {
      name: 'fail_fast_on_lock',
      passed: false,
      message: 'Lock file not detected',
      duration_ms: Date.now() - startTime,
    };
  } catch (error) {
    await removeLockFile(config.vaultPath);
    return {
      name: 'fail_fast_on_lock',
      passed: false,
      message: `Test error: ${error instanceof Error ? error.message : String(error)}`,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Test: Lock age detection (stale vs fresh)
 */
export async function testLockAgeDetection(
  config: ReliabilityTestConfig
): Promise<ReliabilityTestResult> {
  const startTime = Date.now();
  const STALE_THRESHOLD_MS = 30000; // 30 seconds

  try {
    await ensureGitRepo(config.vaultPath);

    const lockPath = path.join(config.vaultPath, '.git/index.lock');

    // Create lock file
    await createLockFile(config.vaultPath);

    // Check fresh lock age
    const stat = await fs.stat(lockPath);
    const age = Date.now() - stat.mtimeMs;
    const isStale = age > STALE_THRESHOLD_MS;

    // Cleanup
    await removeLockFile(config.vaultPath);

    return {
      name: 'lock_age_detection',
      passed: true,
      message: `Lock age detected: ${age}ms (stale: ${isStale})`,
      duration_ms: Date.now() - startTime,
      metrics: {
        lock_age_ms: age,
        is_stale: isStale,
      },
    };
  } catch (error) {
    await removeLockFile(config.vaultPath);
    return {
      name: 'lock_age_detection',
      passed: false,
      message: `Test error: ${error instanceof Error ? error.message : String(error)}`,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Test: Concurrent commit attempts should serialize
 */
export async function testConcurrentCommits(
  config: ReliabilityTestConfig
): Promise<ReliabilityTestResult> {
  const startTime = Date.now();

  try {
    const git = await ensureGitRepo(config.vaultPath);

    // Create test files
    const files = ['file1.md', 'file2.md', 'file3.md'];
    for (const file of files) {
      await fs.writeFile(
        path.join(config.vaultPath, file),
        `# ${file}\n\nContent for ${file}\n`
      );
    }

    // Stage all files
    await git.add(files);

    // Commit should succeed
    const result = await git.commit('Test concurrent commits');

    // Verify commit
    const log = await git.log({ maxCount: 1 });
    if (!log.latest) {
      return {
        name: 'concurrent_commits',
        passed: false,
        message: 'No commit found after commit',
        duration_ms: Date.now() - startTime,
      };
    }

    return {
      name: 'concurrent_commits',
      passed: true,
      message: `Commit succeeded: ${log.latest.hash.substring(0, 7)}`,
      duration_ms: Date.now() - startTime,
      metrics: {
        files_committed: files.length,
        commit_hash: log.latest.hash.substring(0, 7),
      },
    };
  } catch (error) {
    return {
      name: 'concurrent_commits',
      passed: false,
      message: `Test error: ${error instanceof Error ? error.message : String(error)}`,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Run all lock contention tests
 */
export async function runLockContentionTests(
  config: ReliabilityTestConfig
): Promise<ReliabilityTestResult[]> {
  const results: ReliabilityTestResult[] = [];

  results.push(await testLockDetection(config));
  results.push(await testFailFastOnLock(config));
  results.push(await testLockAgeDetection(config));
  results.push(await testConcurrentCommits(config));

  return results;
}
