/**
 * Git integration tests for AUTO_COMMIT functionality
 * Tests that mutations properly create git commits when AUTO_COMMIT=true
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { simpleGit, SimpleGit } from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { writeVaultFile } from '../../../src/core/write/writer.js';
import { commitChange } from '../../../src/core/write/git.js';

// Helper to create a test vault with git
async function createGitVault(): Promise<string> {
  const vaultPath = path.join(os.tmpdir(), `test-vault-git-${Date.now()}`);
  await fs.mkdir(vaultPath, { recursive: true });

  // Initialize git
  const git: SimpleGit = simpleGit(vaultPath);
  await git.init();
  await git.addConfig('user.name', 'Test User');
  await git.addConfig('user.email', 'test@example.com');

  return vaultPath;
}

// Helper to create a test vault WITHOUT git
async function createNonGitVault(): Promise<string> {
  const vaultPath = path.join(os.tmpdir(), `test-vault-nogit-${Date.now()}`);
  await fs.mkdir(vaultPath, { recursive: true });
  return vaultPath;
}

// Helper to cleanup test vault
async function cleanupVault(vaultPath: string): Promise<void> {
  try {
    await fs.rm(vaultPath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// Helper to get last commit message
async function getLastCommitMessage(vaultPath: string): Promise<string | null> {
  try {
    const git: SimpleGit = simpleGit(vaultPath);
    const log = await git.log({ maxCount: 1 });
    return log.latest?.message || null;
  } catch {
    return null;
  }
}

// Helper to count commits
async function getCommitCount(vaultPath: string): Promise<number> {
  try {
    const git: SimpleGit = simpleGit(vaultPath);
    const log = await git.log();
    return log.total;
  } catch {
    return 0;
  }
}

describe('Git Integration - AUTO_COMMIT enabled', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await createGitVault();
  });

  afterEach(async () => {
    await cleanupVault(vaultPath);
  });

  it('should create commit with [Flywheel:Add] prefix for vault_add_to_section', async () => {
    // Create test note
    const notePath = 'test.md';
    await writeVaultFile(vaultPath, notePath, '## Log\n\n', {});

    // Initial commit
    const git: SimpleGit = simpleGit(vaultPath);
    await git.add('.');
    await git.commit('Initial commit');

    const initialCount = await getCommitCount(vaultPath);

    // Simulate mutation with auto-commit
    await writeVaultFile(vaultPath, notePath, '## Log\n\nNew entry\n', {});
    const result = await commitChange(vaultPath, notePath, '[Flywheel:Add]');

    expect(result.success).toBe(true);
    expect(result.hash).toBeDefined();
    expect(result.error).toBeUndefined();

    const finalCount = await getCommitCount(vaultPath);
    expect(finalCount).toBe(initialCount + 1);

    const message = await getLastCommitMessage(vaultPath);
    expect(message).toContain('[Flywheel:Add]');
    expect(message).toContain('test.md');
  });

  it('should create commit with [Flywheel:Remove] prefix for vault_remove_from_section', async () => {
    // Create test note
    const notePath = 'test.md';
    await writeVaultFile(vaultPath, notePath, '## Log\n\nEntry to remove\n', {});

    // Initial commit
    const git: SimpleGit = simpleGit(vaultPath);
    await git.add('.');
    await git.commit('Initial commit');

    // Simulate mutation with auto-commit
    await writeVaultFile(vaultPath, notePath, '## Log\n\n', {});
    const result = await commitChange(vaultPath, notePath, '[Flywheel:Remove]');

    expect(result.success).toBe(true);

    const message = await getLastCommitMessage(vaultPath);
    expect(message).toContain('[Flywheel:Remove]');
  });

  it('should create commit with [Flywheel:Replace] prefix for vault_replace_in_section', async () => {
    const notePath = 'test.md';
    await writeVaultFile(vaultPath, notePath, '## Log\n\nOld text\n', {});

    const git: SimpleGit = simpleGit(vaultPath);
    await git.add('.');
    await git.commit('Initial commit');

    await writeVaultFile(vaultPath, notePath, '## Log\n\nNew text\n', {});
    const result = await commitChange(vaultPath, notePath, '[Flywheel:Replace]');

    expect(result.success).toBe(true);

    const message = await getLastCommitMessage(vaultPath);
    expect(message).toContain('[Flywheel:Replace]');
  });

  it('should create commit with [Flywheel:Task] prefix for vault_toggle_task', async () => {
    const notePath = 'test.md';
    await writeVaultFile(vaultPath, notePath, '## Tasks\n\n- [ ] Todo\n', {});

    const git: SimpleGit = simpleGit(vaultPath);
    await git.add('.');
    await git.commit('Initial commit');

    await writeVaultFile(vaultPath, notePath, '## Tasks\n\n- [x] Todo\n', {});
    const result = await commitChange(vaultPath, notePath, '[Flywheel:Task]');

    expect(result.success).toBe(true);

    const message = await getLastCommitMessage(vaultPath);
    expect(message).toContain('[Flywheel:Task]');
  });

  it('should create commit with [Flywheel:Task] prefix for vault_add_task', async () => {
    const notePath = 'test.md';
    await writeVaultFile(vaultPath, notePath, '## Tasks\n\n', {});

    const git: SimpleGit = simpleGit(vaultPath);
    await git.add('.');
    await git.commit('Initial commit');

    await writeVaultFile(vaultPath, notePath, '## Tasks\n\n- [ ] New task\n', {});
    const result = await commitChange(vaultPath, notePath, '[Flywheel:Task]');

    expect(result.success).toBe(true);

    const message = await getLastCommitMessage(vaultPath);
    expect(message).toContain('[Flywheel:Task]');
  });

  it('should create commit with [Flywheel:FM] prefix for vault_update_frontmatter', async () => {
    const notePath = 'test.md';
    await writeVaultFile(vaultPath, notePath, 'Content', { status: 'draft' });

    const git: SimpleGit = simpleGit(vaultPath);
    await git.add('.');
    await git.commit('Initial commit');

    await writeVaultFile(vaultPath, notePath, 'Content', { status: 'published' });
    const result = await commitChange(vaultPath, notePath, '[Flywheel:FM]');

    expect(result.success).toBe(true);

    const message = await getLastCommitMessage(vaultPath);
    expect(message).toContain('[Flywheel:FM]');
  });

  it('should create commit with [Flywheel:FM] prefix for vault_add_frontmatter_field', async () => {
    const notePath = 'test.md';
    await writeVaultFile(vaultPath, notePath, 'Content', {});

    const git: SimpleGit = simpleGit(vaultPath);
    await git.add('.');
    await git.commit('Initial commit');

    await writeVaultFile(vaultPath, notePath, 'Content', { newField: 'value' });
    const result = await commitChange(vaultPath, notePath, '[Flywheel:FM]');

    expect(result.success).toBe(true);

    const message = await getLastCommitMessage(vaultPath);
    expect(message).toContain('[Flywheel:FM]');
  });

  it('should create commit with [Flywheel:Create] prefix for vault_create_note', async () => {
    const notePath = 'new-note.md';
    await writeVaultFile(vaultPath, notePath, 'New content', {});
    const result = await commitChange(vaultPath, notePath, '[Flywheel:Create]');

    expect(result.success).toBe(true);

    const message = await getLastCommitMessage(vaultPath);
    expect(message).toContain('[Flywheel:Create]');
    expect(message).toContain('new-note.md');
  });

  it('should create commit with [Flywheel:Delete] prefix for vault_delete_note', async () => {
    const notePath = 'to-delete.md';
    await writeVaultFile(vaultPath, notePath, 'Content', {});

    const git: SimpleGit = simpleGit(vaultPath);
    await git.add('.');
    await git.commit('Initial commit');

    // Delete the file
    await fs.unlink(path.join(vaultPath, notePath));
    const result = await commitChange(vaultPath, notePath, '[Flywheel:Delete]');

    expect(result.success).toBe(true);

    const message = await getLastCommitMessage(vaultPath);
    expect(message).toContain('[Flywheel:Delete]');
  });

  it('should include filename in commit message', async () => {
    const notePath = 'daily-notes/2026-01-28.md';
    await fs.mkdir(path.join(vaultPath, 'daily-notes'), { recursive: true });
    await writeVaultFile(vaultPath, notePath, 'Content', {});

    const result = await commitChange(vaultPath, notePath, '[Flywheel:Add]');

    expect(result.success).toBe(true);

    const message = await getLastCommitMessage(vaultPath);
    expect(message).toContain('2026-01-28.md');
  });
});

describe('Git Integration - AUTO_COMMIT disabled', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await createGitVault();
  });

  afterEach(async () => {
    await cleanupVault(vaultPath);
  });

  it('should not create commit when AUTO_COMMIT is false', async () => {
    const notePath = 'test.md';
    await writeVaultFile(vaultPath, notePath, '## Log\n\n', {});

    const git: SimpleGit = simpleGit(vaultPath);
    await git.add('.');
    await git.commit('Initial commit');

    const initialCount = await getCommitCount(vaultPath);

    // Mutate without committing (simulating AUTO_COMMIT=false)
    await writeVaultFile(vaultPath, notePath, '## Log\n\nNew entry\n', {});

    const finalCount = await getCommitCount(vaultPath);
    expect(finalCount).toBe(initialCount);
  });

  it('should leave file changes uncommitted when AUTO_COMMIT is false', async () => {
    const notePath = 'test.md';
    await writeVaultFile(vaultPath, notePath, '## Log\n\n', {});

    const git: SimpleGit = simpleGit(vaultPath);
    await git.add('.');
    await git.commit('Initial commit');

    // Mutate without committing
    await writeVaultFile(vaultPath, notePath, '## Log\n\nNew entry\n', {});

    const status = await git.status();
    expect(status.modified).toContain(notePath);
  });
});

describe('Git Integration - Non-git vault', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await createNonGitVault();
  });

  afterEach(async () => {
    await cleanupVault(vaultPath);
  });

  it('should return error when vault is not a git repo', async () => {
    const notePath = 'test.md';
    await writeVaultFile(vaultPath, notePath, 'Content', {});

    const result = await commitChange(vaultPath, notePath, '[Flywheel:Add]');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Not a git repository');
    expect(result.hash).toBeUndefined();
  });

  it('should allow mutation to succeed even if commit fails in non-git vault', async () => {
    const notePath = 'test.md';
    await writeVaultFile(vaultPath, notePath, 'Content', {});

    // File should be written successfully
    const content = await fs.readFile(path.join(vaultPath, notePath), 'utf-8');
    expect(content).toContain('Content');

    // But commit should fail
    const result = await commitChange(vaultPath, notePath, '[Flywheel:Add]');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Not a git repository');
  });
});

describe('Git Integration - Commit message format', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await createGitVault();
  });

  afterEach(async () => {
    await cleanupVault(vaultPath);
  });

  it('should format commit message as "[Prefix] Update filename.md"', async () => {
    const notePath = 'my-note.md';
    await writeVaultFile(vaultPath, notePath, 'Content', {});

    const result = await commitChange(vaultPath, notePath, '[Flywheel:Add]');

    expect(result.success).toBe(true);

    const message = await getLastCommitMessage(vaultPath);
    expect(message).toBe('[Flywheel:Add] Update my-note.md');
  });

  it('should use only filename, not full path, in commit message', async () => {
    const notePath = 'folder/subfolder/note.md';
    await fs.mkdir(path.join(vaultPath, 'folder/subfolder'), { recursive: true });
    await writeVaultFile(vaultPath, notePath, 'Content', {});

    const result = await commitChange(vaultPath, notePath, '[Flywheel:Task]');

    expect(result.success).toBe(true);

    const message = await getLastCommitMessage(vaultPath);
    expect(message).toBe('[Flywheel:Task] Update note.md');
    expect(message).not.toContain('folder/subfolder');
  });

  it('should preserve prefix brackets in commit message', async () => {
    const notePath = 'test.md';
    await writeVaultFile(vaultPath, notePath, 'Content', {});

    await commitChange(vaultPath, notePath, '[Flywheel:FM]');

    const message = await getLastCommitMessage(vaultPath);
    expect(message).toMatch(/^\[Flywheel:FM\]/);
  });
});

describe('Git Integration - Edge cases', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await createGitVault();
  });

  afterEach(async () => {
    await cleanupVault(vaultPath);
  });

  it('should handle committing a new file', async () => {
    const notePath = 'new-file.md';
    await writeVaultFile(vaultPath, notePath, 'New content', {});

    const result = await commitChange(vaultPath, notePath, '[Flywheel:Create]');

    expect(result.success).toBe(true);
    expect(result.hash).toBeDefined();
  });

  it('should handle committing file with spaces in name', async () => {
    const notePath = 'my note with spaces.md';
    await writeVaultFile(vaultPath, notePath, 'Content', {});

    const result = await commitChange(vaultPath, notePath, '[Flywheel:Add]');

    expect(result.success).toBe(true);

    const message = await getLastCommitMessage(vaultPath);
    expect(message).toContain('my note with spaces.md');
  });

  it('should return different commit hashes for sequential commits', async () => {
    const notePath = 'test.md';
    await writeVaultFile(vaultPath, notePath, 'Content 1', {});

    const result1 = await commitChange(vaultPath, notePath, '[Flywheel:Add]');

    await writeVaultFile(vaultPath, notePath, 'Content 2', {});
    const result2 = await commitChange(vaultPath, notePath, '[Flywheel:Add]');

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    expect(result1.hash).not.toBe(result2.hash);
  });

  it('should handle committing in nested directory', async () => {
    const notePath = 'a/b/c/deep-note.md';
    await fs.mkdir(path.join(vaultPath, 'a/b/c'), { recursive: true });
    await writeVaultFile(vaultPath, notePath, 'Content', {});

    const result = await commitChange(vaultPath, notePath, '[Flywheel:Add]');

    expect(result.success).toBe(true);

    const message = await getLastCommitMessage(vaultPath);
    expect(message).toContain('deep-note.md');
  });
});
