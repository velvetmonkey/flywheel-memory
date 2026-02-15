/**
 * Integration tests for system tools
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readVaultFile,
  extractHeadings,
  validatePath,
} from '../../../src/core/write/writer.js';
import {
  isGitRepo,
  getLastCommit,
  undoLastCommit,
  commitChange,
  saveLastMutationCommit,
  getLastMutationCommit,
  clearLastMutationCommit,
  setGitStateDb,
} from '../../../src/core/write/git.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
} from '../helpers/testUtils.js';
import { simpleGit } from 'simple-git';
import path from 'path';
import { openStateDb, deleteStateDb, type StateDb } from '@velvetmonkey/vault-core';

/**
 * Helper to simulate vault_list_sections workflow
 */
async function listSections(
  vaultPath: string,
  notePath: string,
  minLevel: number = 1,
  maxLevel: number = 6
): Promise<{
  success: boolean;
  message: string;
  sections?: Array<{ level: number; name: string; line: number }>;
}> {
  try {
    if (!validatePath(vaultPath, notePath)) {
      return {
        success: false,
        message: 'Invalid path: path traversal not allowed',
      };
    }

    const { content: fileContent } = await readVaultFile(vaultPath, notePath);
    const headings = extractHeadings(fileContent);

    const filteredHeadings = headings.filter(
      (h) => h.level >= minLevel && h.level <= maxLevel
    );

    const sections = filteredHeadings.map((h) => ({
      level: h.level,
      name: h.text,
      line: h.line + 1, // 1-indexed
    }));

    return {
      success: true,
      message: `Found ${sections.length} section(s)`,
      sections,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

describe('vault_list_sections integration workflow', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should list all sections in a note', async () => {
    const note = `---
type: test
---
# Main Title

## Section A

Content A

## Section B

Content B

### Subsection B1

Content B1
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await listSections(tempVault, 'test.md');

    expect(result.success).toBe(true);
    expect(result.sections?.length).toBe(4);
    // Line numbers are 1-indexed and relative to content (after frontmatter)
    expect(result.sections?.[0]).toEqual({ level: 1, name: 'Main Title', line: 1 });
    expect(result.sections?.[1]).toEqual({ level: 2, name: 'Section A', line: 3 });
    expect(result.sections?.[2]).toEqual({ level: 2, name: 'Section B', line: 7 });
    expect(result.sections?.[3]).toEqual({ level: 3, name: 'Subsection B1', line: 11 });
  });

  it('should filter sections by level', async () => {
    const note = `---
type: test
---
# H1

## H2

### H3

#### H4
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await listSections(tempVault, 'test.md', 2, 3);

    expect(result.success).toBe(true);
    expect(result.sections?.length).toBe(2);
    expect(result.sections?.[0].name).toBe('H2');
    expect(result.sections?.[1].name).toBe('H3');
  });

  it('should return empty array for file with no headings', async () => {
    const note = `---
type: test
---
Just some content without any headings.

More content here.
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await listSections(tempVault, 'test.md');

    expect(result.success).toBe(true);
    expect(result.sections?.length).toBe(0);
  });

  it('should ignore headings inside code blocks', async () => {
    const note = `---
type: test
---
# Real Heading

\`\`\`markdown
# Fake Heading in Code
\`\`\`

## Another Real Heading
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await listSections(tempVault, 'test.md');

    expect(result.success).toBe(true);
    expect(result.sections?.length).toBe(2);
    expect(result.sections?.[0].name).toBe('Real Heading');
    expect(result.sections?.[1].name).toBe('Another Real Heading');
  });

  it('should return error for non-existent file', async () => {
    const result = await listSections(tempVault, 'nonexistent.md');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed');
  });

  it('should return error for path traversal', async () => {
    const result = await listSections(tempVault, '../../../etc/passwd');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid path');
  });
});

describe('vault_undo_last_mutation integration workflow', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
    // Initialize git repo
    const git = simpleGit(tempVault);
    await git.init();
    await git.addConfig('user.email', 'test@test.com');
    await git.addConfig('user.name', 'Test User');
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should undo the last commit', async () => {
    // Create a note and commit it
    await createTestNote(tempVault, 'test.md', '# Test\n\nOriginal content');
    await commitChange(tempVault, 'test.md', '[Flywheel]');

    // Make a change and commit it
    await createTestNote(tempVault, 'test.md', '# Test\n\nModified content');
    await commitChange(tempVault, 'test.md', '[Flywheel]');

    // Get the commit we're about to undo
    const beforeUndo = await getLastCommit(tempVault);
    expect(beforeUndo?.message).toContain('test.md');

    // Undo
    const result = await undoLastCommit(tempVault);

    expect(result.success).toBe(true);
    expect(result.undoneCommit?.hash).toBe(beforeUndo?.hash);

    // Verify we're now back to the previous commit
    const afterUndo = await getLastCommit(tempVault);
    expect(afterUndo?.hash).not.toBe(beforeUndo?.hash);
  });

  it('should return error when no commits exist', async () => {
    // Empty git repo with no commits
    const result = await undoLastCommit(tempVault);

    expect(result.success).toBe(false);
    expect(result.message).toContain('No commits');
  });

  it('should return error for non-git directory', async () => {
    // Create a new temp vault without git
    const nonGitVault = await createTempVault();

    const result = await undoLastCommit(nonGitVault);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Not a git repository');

    await cleanupTempVault(nonGitVault);
  });

  it('getLastCommit should return null for non-git directory', async () => {
    const nonGitVault = await createTempVault();

    const result = await getLastCommit(nonGitVault);

    expect(result).toBeNull();

    await cleanupTempVault(nonGitVault);
  });

  it('getLastCommit should return commit info', async () => {
    await createTestNote(tempVault, 'test.md', '# Test');
    await commitChange(tempVault, 'test.md', '[Flywheel]');

    const result = await getLastCommit(tempVault);

    expect(result).not.toBeNull();
    expect(result?.hash).toBeDefined();
    expect(result?.message).toContain('test.md');
    expect(result?.author).toBe('Test User');
  });

  it('isGitRepo should return true for git directory', async () => {
    const result = await isGitRepo(tempVault);
    expect(result).toBe(true);
  });

  it('isGitRepo should return false for non-git directory', async () => {
    const nonGitVault = await createTempVault();

    const result = await isGitRepo(nonGitVault);
    expect(result).toBe(false);

    await cleanupTempVault(nonGitVault);
  });
});

describe('Flywheel commit tracking for safe undo', () => {
  let tempVault: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    tempVault = await createTempVault();
    // Initialize git repo
    const git = simpleGit(tempVault);
    await git.init();
    await git.addConfig('user.email', 'test@test.com');
    await git.addConfig('user.name', 'Test User');
    stateDb = openStateDb(tempVault);
    setGitStateDb(stateDb);
  });

  afterEach(async () => {
    setGitStateDb(null);
    stateDb.db.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  it('commitChange should save tracking info after successful commit', async () => {
    await createTestNote(tempVault, 'test.md', '# Test');
    await commitChange(tempVault, 'test.md', '[Flywheel]');

    const tracked = getLastMutationCommit();
    expect(tracked).not.toBeNull();
    expect(tracked?.hash).toBeDefined();
    expect(tracked?.message).toContain('[Flywheel]');
    expect(tracked?.timestamp).toBeDefined();
  });

  it('getLastMutationCommit should return null when no tracking exists', async () => {
    const result = getLastMutationCommit();
    expect(result).toBeNull();
  });

  it('clearLastMutationCommit should remove tracking file', async () => {
    // Save some tracking
    saveLastMutationCommit('abc123', 'Test message');

    // Verify it exists
    const before = getLastMutationCommit();
    expect(before).not.toBeNull();

    // Clear it
    clearLastMutationCommit();

    // Verify it's gone
    const after = getLastMutationCommit();
    expect(after).toBeNull();
  });

  it('clearLastMutationCommit should not throw when no tracking exists', () => {
    // Should not throw
    expect(() => clearLastMutationCommit()).not.toThrow();
  });

  it('saveLastMutationCommit should create .claude directory if needed', async () => {
    saveLastMutationCommit('abc123', 'Test message');

    const tracked = getLastMutationCommit();
    expect(tracked?.hash).toBe('abc123');
    expect(tracked?.message).toBe('Test message');
  });

  it('undo should succeed when HEAD matches tracked commit', async () => {
    // Create initial commit
    await createTestNote(tempVault, 'test.md', '# Original');
    await commitChange(tempVault, 'test.md', '[Flywheel:Setup]');

    // Make a tracked change
    await createTestNote(tempVault, 'test.md', '# Modified');
    await commitChange(tempVault, 'test.md', '[Flywheel:Modify]');

    // Undo should succeed because HEAD matches tracked commit
    const result = await undoLastCommit(tempVault);
    expect(result.success).toBe(true);
  });

  it('undo should work when no tracking exists (backwards compatibility)', async () => {
    // Create commits without tracking
    await createTestNote(tempVault, 'test.md', '# Original');
    const git = simpleGit(tempVault);
    await git.add('test.md');
    await git.commit('Manual commit');

    await createTestNote(tempVault, 'test.md', '# Modified');
    await git.add('test.md');
    await git.commit('Another manual commit');

    // Undo should succeed even without tracking
    const result = await undoLastCommit(tempVault);
    expect(result.success).toBe(true);
  });

  it('should detect when HEAD does not match tracked commit', async () => {
    // This tests the safety check logic used by vault_undo_last_mutation
    // Step 1: Create a Flywheel commit (tracked)
    await createTestNote(tempVault, 'test.md', '# Original');
    await commitChange(tempVault, 'test.md', '[Flywheel]');

    const trackedCommit = getLastMutationCommit();
    expect(trackedCommit).not.toBeNull();

    // Step 2: Make a manual commit (HEAD moves, tracking stays)
    await createTestNote(tempVault, 'other.md', '# Other');
    const git = simpleGit(tempVault);
    await git.add('other.md');
    await git.commit('Manual commit from another process');

    // Step 3: Verify HEAD no longer matches tracked commit
    const currentHead = await getLastCommit(tempVault);
    expect(currentHead).not.toBeNull();
    expect(currentHead!.hash).not.toBe(trackedCommit!.hash);

    // This is the condition that vault_undo_last_mutation checks
    // If HEAD !== tracked, it should refuse to undo
  });

  it('should clear tracking after undo so subsequent undos work normally', async () => {
    // Create two Flywheel commits
    await createTestNote(tempVault, 'test.md', '# Original');
    await commitChange(tempVault, 'test.md', '[Flywheel:1]');

    await createTestNote(tempVault, 'test.md', '# Modified');
    await commitChange(tempVault, 'test.md', '[Flywheel:2]');

    // Tracking should point to second commit
    const tracked = getLastMutationCommit();
    expect(tracked?.message).toContain('[Flywheel:2]');

    // Undo and clear tracking (simulating what tool handler does)
    await undoLastCommit(tempVault);
    clearLastMutationCommit();

    // After clearing, tracking should be null
    const afterClear = getLastMutationCommit();
    expect(afterClear).toBeNull();
  });
});
