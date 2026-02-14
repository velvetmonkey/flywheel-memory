/**
 * Git auto-commit utilities
 */

import { simpleGit, SimpleGit, CheckRepoActions } from 'simple-git';
import path from 'path';
import fs from 'fs/promises';
import {
  setCrankState,
  getCrankState,
  deleteCrankState,
  type StateDb,
} from '@velvetmonkey/vault-core';

/**
 * Module-level StateDb reference for crank state storage
 * Set via setStateDb() during initialization
 */
let moduleStateDb: StateDb | null = null;

/**
 * Set the StateDb instance for this module
 * Called during MCP server initialization
 */
export function setGitStateDb(stateDb: StateDb | null): void {
  moduleStateDb = stateDb;
}

/**
 * Configuration for retry logic on lock contention
 */
interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
}

const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 500,
  jitter: true,
};

const STALE_LOCK_THRESHOLD_MS = 30_000; // 30 seconds
const STAGING_DIR = '.flywheel-staging';

/**
 * Tracking data for the last successful Crank commit.
 * Used to prevent accidental undo of unrelated commits.
 */
export interface LastCrankCommit {
  hash: string;
  message: string;
  timestamp: string;
}

/**
 * Save tracking info for the last successful Crank commit.
 * This enables safe undo verification.
 */
export function saveLastCrankCommit(
  hash: string,
  message: string
): void {
  if (!moduleStateDb) {
    console.error('[Crank] No StateDb available for saving last commit');
    return;
  }

  const data: LastCrankCommit = {
    hash,
    message,
    timestamp: new Date().toISOString(),
  };

  try {
    setCrankState(moduleStateDb, 'last_commit', data);
  } catch (e) {
    console.error('[Crank] Failed to save last commit to StateDb:', e);
  }
}

/**
 * Get the last tracked Crank commit, if any.
 */
export function getLastCrankCommit(): LastCrankCommit | null {
  if (!moduleStateDb) {
    return null;
  }

  try {
    return getCrankState<LastCrankCommit>(moduleStateDb, 'last_commit');
  } catch {
    return null;
  }
}

/**
 * Clear the last Crank commit tracking (after successful undo).
 */
export function clearLastCrankCommit(): void {
  if (!moduleStateDb) {
    return;
  }

  try {
    deleteCrankState(moduleStateDb, 'last_commit');
  } catch {
    // Ignore errors
  }
}

export interface GitCommitResult {
  success: boolean;
  hash?: string;
  error?: string;
  /** True only if commit succeeded and undo is available */
  undoAvailable: boolean;
  /** True if a stale lock (>30s old) was detected during retries */
  staleLockDetected?: boolean;
  /** Age of the lock file in milliseconds (if detected) */
  lockAgeMs?: number;
}

/**
 * Result of checking git lock status
 */
export interface GitLockStatus {
  /** Whether the git index.lock file exists */
  locked: boolean;
  /** Whether the lock is considered stale (>30 seconds old) */
  stale?: boolean;
  /** Age of the lock file in milliseconds */
  ageMs?: number;
}

/**
 * Check if git index.lock exists (pre-flight check for strict mode)
 * Use this before starting operations that require atomic commits
 */
export async function checkGitLock(vaultPath: string): Promise<GitLockStatus> {
  const lockPath = path.join(vaultPath, '.git/index.lock');
  try {
    const stat = await fs.stat(lockPath);
    const ageMs = Date.now() - stat.mtimeMs;
    return {
      locked: true,
      stale: ageMs > STALE_LOCK_THRESHOLD_MS,
      ageMs,
    };
  } catch {
    return { locked: false };
  }
}

/**
 * Staging file helpers for atomic policy execution
 */
export interface StagedFile {
  /** Original file path (vault-relative) */
  originalPath: string;
  /** Staging file path (absolute) */
  stagingPath: string;
  /** Original content (for rollback) */
  originalContent: string | null;
  /** Whether the original file existed */
  originalExisted: boolean;
}

/**
 * Get the staging directory path for a vault
 */
export function getStagingDir(vaultPath: string): string {
  return path.join(vaultPath, STAGING_DIR);
}

/**
 * Create a staging file for atomic writes
 * Returns the staging file path where content should be written
 */
export async function createStagingFile(
  vaultPath: string,
  notePath: string
): Promise<StagedFile> {
  const stagingDir = getStagingDir(vaultPath);
  await fs.mkdir(stagingDir, { recursive: true });

  // Create a unique staging file name based on hash of path
  const hash = Buffer.from(notePath).toString('base64url').replace(/[^a-zA-Z0-9]/g, '');
  const stagingPath = path.join(stagingDir, `${hash}.md`);

  // Read original content for potential rollback
  const fullPath = path.join(vaultPath, notePath);
  let originalContent: string | null = null;
  let originalExisted = false;

  try {
    originalContent = await fs.readFile(fullPath, 'utf-8');
    originalExisted = true;
  } catch {
    // File doesn't exist yet - that's fine for new notes
  }

  return {
    originalPath: notePath,
    stagingPath,
    originalContent,
    originalExisted,
  };
}

/**
 * Commit staged files - move from staging to real locations
 */
export async function commitStagedFiles(
  vaultPath: string,
  stagedFiles: StagedFile[]
): Promise<void> {
  for (const staged of stagedFiles) {
    const realPath = path.join(vaultPath, staged.originalPath);

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(realPath), { recursive: true });

    // Move staging file to real location
    try {
      await fs.rename(staged.stagingPath, realPath);
    } catch {
      // rename might fail across filesystems, fall back to copy+delete
      const content = await fs.readFile(staged.stagingPath, 'utf-8');
      await fs.writeFile(realPath, content);
      await fs.unlink(staged.stagingPath);
    }
  }
}

/**
 * Rollback staged files - delete staging files and restore originals
 */
export async function rollbackStagedFiles(
  vaultPath: string,
  stagedFiles: StagedFile[]
): Promise<void> {
  for (const staged of stagedFiles) {
    // Delete staging file
    try {
      await fs.unlink(staged.stagingPath);
    } catch {
      // Already deleted or doesn't exist
    }

    // Restore original if it existed and was overwritten
    const realPath = path.join(vaultPath, staged.originalPath);
    if (staged.originalExisted && staged.originalContent !== null) {
      // Restore original content
      await fs.writeFile(realPath, staged.originalContent);
    } else if (!staged.originalExisted) {
      // File was newly created - delete it
      try {
        await fs.unlink(realPath);
      } catch {
        // File doesn't exist - that's fine
      }
    }
  }
}

/**
 * Clean up staging directory
 */
export async function cleanupStagingDir(vaultPath: string): Promise<void> {
  const stagingDir = getStagingDir(vaultPath);
  try {
    const files = await fs.readdir(stagingDir);
    for (const file of files) {
      await fs.unlink(path.join(stagingDir, file));
    }
    await fs.rmdir(stagingDir);
  } catch {
    // Directory doesn't exist or is not empty
  }
}

/**
 * Check if the vault is a git repository
 */
export async function isGitRepo(vaultPath: string): Promise<boolean> {
  try {
    const git: SimpleGit = simpleGit(vaultPath);
    const isRepo = await git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT);
    return isRepo;
  } catch {
    return false;
  }
}

/**
 * Check if the git index lock file exists and get its age
 * @returns null if no lock exists, or an object with stale status and age
 */
async function checkLockFile(vaultPath: string): Promise<{ stale: boolean; ageMs: number } | null> {
  const lockPath = path.join(vaultPath, '.git/index.lock');
  try {
    const stat = await fs.stat(lockPath);
    const ageMs = Date.now() - stat.mtimeMs;
    return { stale: ageMs > STALE_LOCK_THRESHOLD_MS, ageMs };
  } catch {
    return null; // No lock exists
  }
}

/**
 * Check if an error is a lock contention error
 */
function isLockContentionError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('index.lock') ||
           msg.includes('unable to create') ||
           msg.includes('could not obtain lock');
  }
  return false;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateDelay(attempt: number, config: RetryConfig): number {
  // Exponential backoff: baseDelay * 2^attempt
  let delay = config.baseDelayMs * Math.pow(2, attempt);
  delay = Math.min(delay, config.maxDelayMs);

  if (config.jitter) {
    // Add random jitter between 0-50% of delay to prevent thundering herd
    delay = delay + Math.random() * delay * 0.5;
  }

  return Math.round(delay);
}

/**
 * Commit a change to a specific file
 * Includes retry logic for lock contention with exponential backoff
 */
export async function commitChange(
  vaultPath: string,
  filePath: string,
  messagePrefix: string,
  retryConfig: RetryConfig = DEFAULT_RETRY
): Promise<GitCommitResult> {
  // Check if repo first (no retry needed for this)
  const isRepo = await isGitRepo(vaultPath);
  if (!isRepo) {
    return {
      success: false,
      error: 'Not a git repository',
      undoAvailable: false,
    };
  }

  const git: SimpleGit = simpleGit(vaultPath);
  let lastError: Error | undefined;
  let staleLockDetected = false;
  let lockAgeMs: number | undefined;

  for (let attempt = 0; attempt < retryConfig.maxAttempts; attempt++) {
    try {
      // Check lock status before each attempt (for reporting)
      const lockInfo = await checkLockFile(vaultPath);
      if (lockInfo) {
        lockAgeMs = lockInfo.ageMs;
        if (lockInfo.stale) {
          staleLockDetected = true;
        }
      }

      // Stage the file
      await git.add(filePath);

      // Create commit message
      const fileName = path.basename(filePath);
      const commitMessage = `${messagePrefix} Update ${fileName}`;

      // Commit
      const result = await git.commit(commitMessage);

      // Track this commit for safe undo verification
      if (result.commit) {
        saveLastCrankCommit(result.commit, commitMessage);
      }

      return {
        success: true,
        hash: result.commit,
        undoAvailable: !!result.commit,
        // Report stale lock if detected during retries, even if we succeeded
        ...(staleLockDetected && { staleLockDetected: true }),
        ...(lockAgeMs !== undefined && staleLockDetected && { lockAgeMs }),
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Only retry on lock contention errors
      if (!isLockContentionError(error)) {
        return {
          success: false,
          error: lastError.message,
          undoAvailable: false,
        };
      }

      // Check if lock is stale before retrying
      const lockInfo = await checkLockFile(vaultPath);
      if (lockInfo) {
        lockAgeMs = lockInfo.ageMs;
        if (lockInfo.stale) {
          staleLockDetected = true;
        }
      }

      // Wait before retry (unless this was the last attempt)
      if (attempt < retryConfig.maxAttempts - 1) {
        const delay = calculateDelay(attempt, retryConfig);
        await sleep(delay);
      }
    }
  }

  // All retries exhausted
  return {
    success: false,
    error: lastError?.message ?? 'Lock contention - all retries exhausted',
    undoAvailable: false,
    ...(staleLockDetected && { staleLockDetected: true }),
    ...(lockAgeMs !== undefined && { lockAgeMs }),
  };
}

export interface CommitInfo {
  hash: string;
  message: string;
  date: string;
  author: string;
}

/**
 * Get information about the last commit
 */
export async function getLastCommit(vaultPath: string): Promise<CommitInfo | null> {
  try {
    const git: SimpleGit = simpleGit(vaultPath);

    const isRepo = await isGitRepo(vaultPath);
    if (!isRepo) {
      return null;
    }

    const log = await git.log({ maxCount: 1 });
    if (!log.latest) {
      return null;
    }

    return {
      hash: log.latest.hash,
      message: log.latest.message,
      date: log.latest.date,
      author: log.latest.author_name,
    };
  } catch {
    return null;
  }
}

export interface UndoResult {
  success: boolean;
  message: string;
  undoneCommit?: CommitInfo;
}

/**
 * Undo the last commit by resetting to HEAD~1
 * This is a soft reset - changes are preserved in working directory
 */
export async function undoLastCommit(vaultPath: string): Promise<UndoResult> {
  try {
    const git: SimpleGit = simpleGit(vaultPath);

    const isRepo = await isGitRepo(vaultPath);
    if (!isRepo) {
      return {
        success: false,
        message: 'Not a git repository',
      };
    }

    // Get the commit we're about to undo
    const lastCommit = await getLastCommit(vaultPath);
    if (!lastCommit) {
      return {
        success: false,
        message: 'No commits to undo',
      };
    }

    // Perform soft reset (keeps file changes)
    await git.reset(['--soft', 'HEAD~1']);

    return {
      success: true,
      message: `Undone commit: ${lastCommit.message}`,
      undoneCommit: lastCommit,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check if there are uncommitted changes
 */
export async function hasUncommittedChanges(vaultPath: string): Promise<boolean> {
  try {
    const git: SimpleGit = simpleGit(vaultPath);
    const status = await git.status();
    return !status.isClean();
  } catch {
    return false;
  }
}

/**
 * Result of a policy commit
 */
export interface PolicyCommitResult {
  success: boolean;
  hash?: string;
  error?: string;
  undoAvailable: boolean;
  filesCommitted: number;
  staleLockDetected?: boolean;
  lockAgeMs?: number;
}

/**
 * Commit multiple files as a single atomic policy commit.
 * Used by policy_execute for batch commits.
 */
export async function commitPolicyChanges(
  vaultPath: string,
  files: string[],
  policyName: string,
  stepsSummary?: string[],
  retryConfig: RetryConfig = DEFAULT_RETRY
): Promise<PolicyCommitResult> {
  if (files.length === 0) {
    return {
      success: false,
      error: 'No files to commit',
      undoAvailable: false,
      filesCommitted: 0,
    };
  }

  const isRepo = await isGitRepo(vaultPath);
  if (!isRepo) {
    return {
      success: false,
      error: 'Not a git repository',
      undoAvailable: false,
      filesCommitted: 0,
    };
  }

  const git: SimpleGit = simpleGit(vaultPath);
  let lastError: Error | undefined;
  let staleLockDetected = false;
  let lockAgeMs: number | undefined;

  for (let attempt = 0; attempt < retryConfig.maxAttempts; attempt++) {
    try {
      // Check lock status before each attempt
      const lockInfo = await checkLockFile(vaultPath);
      if (lockInfo) {
        lockAgeMs = lockInfo.ageMs;
        if (lockInfo.stale) {
          staleLockDetected = true;
        }
      }

      // Stage ALL modified files
      for (const file of files) {
        await git.add(file);
      }

      // Build commit message
      let commitMessage = `[Policy:${policyName}] Update ${files.length} file(s)`;
      if (stepsSummary && stepsSummary.length > 0) {
        commitMessage += '\n\nSteps:\n' + stepsSummary.map(s => `- ${s}`).join('\n');
      }
      commitMessage += `\n\nFiles:\n${files.map(f => `- ${f}`).join('\n')}`;

      // Commit
      const result = await git.commit(commitMessage);

      // Track this commit for safe undo verification
      if (result.commit) {
        saveLastCrankCommit(result.commit, commitMessage);
      }

      return {
        success: true,
        hash: result.commit,
        undoAvailable: !!result.commit,
        filesCommitted: files.length,
        ...(staleLockDetected && { staleLockDetected: true }),
        ...(lockAgeMs !== undefined && staleLockDetected && { lockAgeMs }),
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (!isLockContentionError(error)) {
        return {
          success: false,
          error: lastError.message,
          undoAvailable: false,
          filesCommitted: 0,
        };
      }

      const lockInfo = await checkLockFile(vaultPath);
      if (lockInfo) {
        lockAgeMs = lockInfo.ageMs;
        if (lockInfo.stale) {
          staleLockDetected = true;
        }
      }

      if (attempt < retryConfig.maxAttempts - 1) {
        const delay = calculateDelay(attempt, retryConfig);
        await sleep(delay);
      }
    }
  }

  return {
    success: false,
    error: lastError?.message ?? 'Lock contention - all retries exhausted',
    undoAvailable: false,
    filesCommitted: 0,
    ...(staleLockDetected && { staleLockDetected: true }),
    ...(lockAgeMs !== undefined && { lockAgeMs }),
  };
}
