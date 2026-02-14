/**
 * Git health checking - validate .git directory health
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { GitHealthResult } from '../types.js';

/**
 * Check git repository health
 */
export async function checkGitHealth(vaultPath: string): Promise<GitHealthResult> {
  const gitDir = path.join(vaultPath, '.git');
  const issues: string[] = [];

  // Check if .git exists
  try {
    const stat = await fs.stat(gitDir);
    if (!stat.isDirectory()) {
      return {
        totalObjects: 0,
        looseObjects: 0,
        packedObjects: 0,
        totalSize_mb: 0,
        isHealthy: false,
        issues: ['.git is not a directory']
      };
    }
  } catch {
    return {
      totalObjects: 0,
      looseObjects: 0,
      packedObjects: 0,
      totalSize_mb: 0,
      isHealthy: false,
      issues: ['No .git directory found']
    };
  }

  let totalObjects = 0;
  let looseObjects = 0;
  let packedObjects = 0;
  let totalSize_mb = 0;

  try {
    // Get object counts using git count-objects
    const countOutput = execSync('git count-objects -v', {
      cwd: vaultPath,
      encoding: 'utf-8'
    });

    const lines = countOutput.split('\n');
    for (const line of lines) {
      const [key, value] = line.split(':').map(s => s.trim());
      switch (key) {
        case 'count':
          looseObjects = parseInt(value, 10) || 0;
          break;
        case 'in-pack':
          packedObjects = parseInt(value, 10) || 0;
          break;
        case 'size':
          totalSize_mb += (parseInt(value, 10) || 0) / 1024; // KB to MB
          break;
        case 'size-pack':
          totalSize_mb += (parseInt(value, 10) || 0) / 1024; // KB to MB
          break;
      }
    }

    totalObjects = looseObjects + packedObjects;

    // Check for excessive loose objects
    if (looseObjects > 1000) {
      issues.push(`High loose object count: ${looseObjects} (consider running git gc)`);
    }

    // Run git fsck for deeper health check (quick mode)
    try {
      execSync('git fsck --connectivity-only', {
        cwd: vaultPath,
        encoding: 'utf-8',
        timeout: 30000 // 30 second timeout
      });
    } catch (fsckError) {
      // fsck outputs to stderr even for warnings
      const errorStr = String(fsckError);
      if (errorStr.includes('dangling') || errorStr.includes('unreachable')) {
        issues.push('Git has dangling or unreachable objects');
      } else if (errorStr.includes('broken') || errorStr.includes('corrupt')) {
        issues.push('Git repository corruption detected');
      }
    }

    // Check for excessive repository size
    const estimatedNotesSize = totalSize_mb * 10; // Rough estimate
    if (totalSize_mb > estimatedNotesSize) {
      issues.push(`Repository size (${totalSize_mb.toFixed(1)}MB) seems large for the content`);
    }

    // Check HEAD is valid
    try {
      execSync('git rev-parse HEAD', {
        cwd: vaultPath,
        encoding: 'utf-8'
      });
    } catch {
      issues.push('Invalid HEAD reference');
    }

    // Check for uncommitted changes (unexpected in a test context)
    try {
      const status = execSync('git status --porcelain', {
        cwd: vaultPath,
        encoding: 'utf-8'
      });
      if (status.trim()) {
        const changedFiles = status.trim().split('\n').length;
        issues.push(`${changedFiles} uncommitted changes`);
      }
    } catch {
      issues.push('Could not check git status');
    }

  } catch (error) {
    issues.push(`Git health check failed: ${error}`);
  }

  return {
    totalObjects,
    looseObjects,
    packedObjects,
    totalSize_mb,
    isHealthy: issues.length === 0,
    issues
  };
}

/**
 * Run git maintenance operations
 */
export async function runGitMaintenance(vaultPath: string): Promise<void> {
  try {
    // Garbage collection
    execSync('git gc --auto', {
      cwd: vaultPath,
      encoding: 'utf-8',
      timeout: 60000
    });

    // Prune unreachable objects
    execSync('git prune', {
      cwd: vaultPath,
      encoding: 'utf-8',
      timeout: 30000
    });

  } catch (error) {
    console.warn(`Git maintenance failed: ${error}`);
  }
}

/**
 * Get git repository statistics
 */
export async function getGitStats(vaultPath: string): Promise<{
  commitCount: number;
  branchCount: number;
  firstCommit: string | null;
  lastCommit: string | null;
}> {
  try {
    const commitCount = parseInt(
      execSync('git rev-list --count HEAD', {
        cwd: vaultPath,
        encoding: 'utf-8'
      }).trim(),
      10
    );

    const branchOutput = execSync('git branch', {
      cwd: vaultPath,
      encoding: 'utf-8'
    });
    const branchCount = branchOutput.trim().split('\n').filter(l => l.trim()).length;

    let firstCommit: string | null = null;
    let lastCommit: string | null = null;

    try {
      firstCommit = execSync('git log --reverse --format=%H | head -1', {
        cwd: vaultPath,
        encoding: 'utf-8',
        shell: '/bin/bash'
      }).trim();

      lastCommit = execSync('git rev-parse HEAD', {
        cwd: vaultPath,
        encoding: 'utf-8'
      }).trim();
    } catch {
      // May fail on empty repo
    }

    return {
      commitCount,
      branchCount,
      firstCommit,
      lastCommit
    };
  } catch {
    return {
      commitCount: 0,
      branchCount: 0,
      firstCommit: null,
      lastCommit: null
    };
  }
}

/**
 * Measure git operation performance
 */
export async function measureGitPerformance(vaultPath: string): Promise<{
  status_ms: number;
  log_ms: number;
  diff_ms: number;
}> {
  const measure = async (cmd: string): Promise<number> => {
    const start = performance.now();
    try {
      execSync(cmd, {
        cwd: vaultPath,
        encoding: 'utf-8',
        timeout: 10000
      });
    } catch {
      // Command might fail, but we still want timing
    }
    return performance.now() - start;
  };

  return {
    status_ms: await measure('git status'),
    log_ms: await measure('git log --oneline -100'),
    diff_ms: await measure('git diff HEAD~1 --stat 2>/dev/null || true')
  };
}
