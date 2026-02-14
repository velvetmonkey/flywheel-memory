/**
 * Git Init Tests
 *
 * Validates behavior when vault is not a git repository:
 * mutations should succeed, commits should fail gracefully.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
} from '../helpers/testUtils.js';
import {
  isGitRepo,
  commitChange,
  getLastCommit,
  hasUncommittedChanges,
} from '../../src/core/git.js';
import {
  readVaultFile,
  writeVaultFile,
  findSection,
  insertInSection,
} from '../../src/core/writer.js';

let tempVault: string;

describe('Non-Git Vault Operations', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  describe('isGitRepo Detection', () => {
    it('should detect non-git directory', async () => {
      const result = await isGitRepo(tempVault);
      expect(result).toBe(false);
    });

    it('should detect git directory after init', async () => {
      execSync('git init', { cwd: tempVault, stdio: 'ignore' });

      const result = await isGitRepo(tempVault);
      expect(result).toBe(true);
    });

    it('should handle non-existent directory', async () => {
      const nonExistent = path.join(tempVault, 'does-not-exist');

      const result = await isGitRepo(nonExistent);
      expect(result).toBe(false);
    });
  });

  describe('Mutations Without Git', () => {
    it('should successfully read and write files', async () => {
      const content = `---
type: test
---
# Test Note

## Log

- Entry 1
`;
      await createTestNote(tempVault, 'test.md', content);

      const { content: readContent, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');

      expect(readContent).toContain('# Test Note');
      expect(frontmatter.type).toBe('test');

      // Modify and write back
      const section = findSection(readContent, 'Log');
      expect(section).not.toBeNull();

      const modified = insertInSection(readContent, section!, '- Entry 2', 'append');
      await writeVaultFile(tempVault, 'test.md', modified, frontmatter, lineEnding);

      const final = await readTestNote(tempVault, 'test.md');
      expect(final).toContain('- Entry 1');
      expect(final).toContain('- Entry 2');
    });

    it('should create new notes successfully', async () => {
      const notePath = 'new-note.md';
      await createTestNote(tempVault, notePath, '# New Note');

      const exists = await fs.access(path.join(tempVault, notePath)).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should delete notes successfully', async () => {
      const notePath = 'to-delete.md';
      await createTestNote(tempVault, notePath, '# To Delete');

      await fs.unlink(path.join(tempVault, notePath));

      const exists = await fs.access(path.join(tempVault, notePath)).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });
  });

  describe('Commit Failures', () => {
    it('should fail gracefully when committing in non-git vault', async () => {
      await createTestNote(tempVault, 'test.md', '# Test');

      const result = await commitChange(tempVault, 'test.md', '[Crank]');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.toLowerCase()).toContain('git');
    });

    it('should return clear error message for non-git vault', async () => {
      await createTestNote(tempVault, 'test.md', '# Test');

      const result = await commitChange(tempVault, 'test.md', '[Crank]');

      expect(result.error).toMatch(/not a git repository|git/i);
    });

    it('should not throw exception on commit failure', async () => {
      await createTestNote(tempVault, 'test.md', '# Test');

      // Should not throw
      await expect(commitChange(tempVault, 'test.md', '[Crank]')).resolves.toBeDefined();
    });
  });

  describe('Git Status Queries', () => {
    it('should handle hasUncommittedChanges in non-git vault', async () => {
      // Should return false or throw meaningful error
      try {
        const result = await hasUncommittedChanges(tempVault);
        // If it returns, should be false (no uncommitted changes in non-git)
        expect(result).toBe(false);
      } catch (error: any) {
        // If it throws, should have meaningful message
        expect(error.message).toMatch(/git|repository/i);
      }
    });

    it('should handle getLastCommit in non-git vault', async () => {
      // Should return null or throw meaningful error
      try {
        const result = await getLastCommit(tempVault);
        expect(result).toBeNull();
      } catch (error: any) {
        expect(error.message).toMatch(/git|repository/i);
      }
    });
  });
});

describe('Mixed Vault State', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should handle vault becoming git repo mid-session', async () => {
    // Start as non-git
    expect(await isGitRepo(tempVault)).toBe(false);

    // Create a file
    await createTestNote(tempVault, 'before-git.md', '# Before Git');

    // Initialize git
    execSync('git init', { cwd: tempVault, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: tempVault, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: tempVault, stdio: 'ignore' });

    // Now should be git repo
    expect(await isGitRepo(tempVault)).toBe(true);

    // Create another file
    await createTestNote(tempVault, 'after-git.md', '# After Git');

    // Commit should now work
    const result = await commitChange(tempVault, 'after-git.md', '[Crank]');
    expect(result.success).toBe(true);
  });

  it('should handle operations while git init in progress', async () => {
    // Create file first
    await createTestNote(tempVault, 'test.md', '# Test');

    // Initialize git
    execSync('git init', { cwd: tempVault, stdio: 'ignore' });

    // File operations should still work
    const content = await readTestNote(tempVault, 'test.md');
    expect(content).toContain('# Test');
  });
});

describe('Error Message Quality', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should provide actionable error for non-git vault', async () => {
    await createTestNote(tempVault, 'test.md', '# Test');

    const result = await commitChange(tempVault, 'test.md', '[Crank]');

    expect(result.success).toBe(false);
    // Error should help user understand what to do
    expect(result.error).toBeDefined();
    expect(result.error!.length).toBeGreaterThan(10); // Non-trivial message
  });

  it('should distinguish between "not a git repo" and other git errors', async () => {
    // Non-git vault
    await createTestNote(tempVault, 'test.md', '# Test');
    const nonGitResult = await commitChange(tempVault, 'test.md', '[Crank]');

    expect(nonGitResult.error).toMatch(/not a git|repository/i);

    // Git vault but with issues (e.g., no commits yet)
    execSync('git init', { cwd: tempVault, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: tempVault, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: tempVault, stdio: 'ignore' });

    // This should work (first commit)
    const gitResult = await commitChange(tempVault, 'test.md', '[Crank]');
    expect(gitResult.success).toBe(true);
  });
});
