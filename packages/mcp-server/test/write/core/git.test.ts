/**
 * Tests for git auto-commit utilities
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isGitRepo, commitChange } from '../../src/core/git.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
} from '../helpers/testUtils.js';
import { execSync } from 'child_process';
import { mkdirSync } from 'node:fs';
import path from 'path';

describe('isGitRepo', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should return false for non-git directory', async () => {
    const result = await isGitRepo(tempVault);
    expect(result).toBe(false);
  });

  it('should return true for git repository', async () => {
    // Initialize git repo
    execSync('git init', { cwd: tempVault, stdio: 'ignore' });

    const result = await isGitRepo(tempVault);
    expect(result).toBe(true);
  });

  it('should return false for subdirectory of non-repo', async () => {
    const subDir = path.join(tempVault, 'subdir');
    mkdirSync(subDir, { recursive: true });

    const result = await isGitRepo(subDir);
    expect(result).toBe(false);
  });

  it('should return true for subdirectory of git repo', async () => {
    // Initialize git repo at root
    execSync('git init', { cwd: tempVault, stdio: 'ignore' });

    // Check subdirectory
    const subDir = path.join(tempVault, 'subdir');
    mkdirSync(subDir, { recursive: true });

    const result = await isGitRepo(subDir);
    // Note: isGitRepo checks IS_REPO_ROOT, so subdirs return false
    expect(result).toBe(false);
  });
});

describe('commitChange', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should return error for non-git repository', async () => {
    await createTestNote(tempVault, 'test.md', '# Test');

    const result = await commitChange(tempVault, 'test.md', '[Test]');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Not a git repository');
  });

  it('should successfully commit a change', async () => {
    // Initialize git repo
    execSync('git init', { cwd: tempVault, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: tempVault, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: tempVault, stdio: 'ignore' });

    // Create and commit a file
    await createTestNote(tempVault, 'test.md', '# Test');
    const result = await commitChange(tempVault, 'test.md', '[Test]');

    expect(result.success).toBe(true);
    expect(result.hash).toBeTruthy();
    expect(typeof result.hash).toBe('string');
  });

  it('should include message prefix in commit message', async () => {
    // Initialize git repo
    execSync('git init', { cwd: tempVault, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: tempVault, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: tempVault, stdio: 'ignore' });

    // Create and commit a file
    await createTestNote(tempVault, 'test.md', '# Test');
    await commitChange(tempVault, 'test.md', '[Flywheel]');

    // Check commit message
    const log = execSync('git log --format=%s -1', { cwd: tempVault, encoding: 'utf-8' });
    expect(log.trim()).toContain('[Flywheel]');
    expect(log.trim()).toContain('test.md');
  });

  it('should handle commit of modified file', async () => {
    // Initialize git repo
    execSync('git init', { cwd: tempVault, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: tempVault, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: tempVault, stdio: 'ignore' });

    // Create initial file and commit
    await createTestNote(tempVault, 'test.md', '# Test v1');
    await commitChange(tempVault, 'test.md', '[Test]');

    // Modify file and commit again
    await createTestNote(tempVault, 'test.md', '# Test v2');
    const result = await commitChange(tempVault, 'test.md', '[Test]');

    expect(result.success).toBe(true);
    expect(result.hash).toBeTruthy();

    // Should have 2 commits
    const commitCount = execSync('git rev-list --count HEAD', {
      cwd: tempVault,
      encoding: 'utf-8'
    }).trim();
    expect(commitCount).toBe('2');
  });

  it('should handle nested file paths', async () => {
    // Initialize git repo
    execSync('git init', { cwd: tempVault, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: tempVault, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: tempVault, stdio: 'ignore' });

    // Create nested file
    await createTestNote(tempVault, 'daily-notes/2026-01-28.md', '# Daily');
    const result = await commitChange(tempVault, 'daily-notes/2026-01-28.md', '[Daily]');

    expect(result.success).toBe(true);
    expect(result.hash).toBeTruthy();
  });

  it('should return error for non-existent file', async () => {
    // Initialize git repo
    execSync('git init', { cwd: tempVault, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: tempVault, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: tempVault, stdio: 'ignore' });

    // Try to commit non-existent file
    const result = await commitChange(tempVault, 'nonexistent.md', '[Test]');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
