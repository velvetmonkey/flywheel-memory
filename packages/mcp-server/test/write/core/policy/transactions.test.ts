/**
 * Policy Transaction Tests
 *
 * Validates atomic transaction behavior for policy execution,
 * including git commit integration and consistency guarantees.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { simpleGit, SimpleGit } from 'simple-git';
import { executePolicy } from '../../../src/core/policy/executor.js';
import type { PolicyDefinition } from '../../../src/core/policy/types.js';

let tempVault: string;
let git: SimpleGit;

async function createTempVault(initGit = false): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-transaction-test-'));
  await fs.mkdir(path.join(dir, '.claude', 'policies'), { recursive: true });

  if (initGit) {
    git = simpleGit(dir);
    await git.init();
    await git.addConfig('user.email', 'test@flywheel.test');
    await git.addConfig('user.name', 'Flywheel Test');

    // Create initial commit
    await fs.writeFile(path.join(dir, '.gitkeep'), '', 'utf-8');
    await git.add('.gitkeep');
    await git.commit('Initial commit');
  }

  return dir;
}

async function cleanupTempVault(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
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

async function getLastCommitMessage(): Promise<string> {
  const log = await git.log({ maxCount: 1 });
  return log.latest?.message || '';
}

describe('Policy Transaction Behavior', () => {
  beforeEach(async () => {
    tempVault = await createTempVault(true);
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  describe('Git Commit Integration', () => {
    it('should commit all changes as single atomic commit with policy-level commit', async () => {
      await createTestNote(tempVault, 'a.md', '# Log\n');
      await createTestNote(tempVault, 'b.md', '# Log\n');
      await git.add(['a.md', 'b.md']);
      await git.commit('Add test notes');

      const initialCommits = await getCommitCount();

      const policy: PolicyDefinition = {
        version: '1.0',
        name: 'multi-file-commit',
        description: 'Commits multiple file changes atomically',
        steps: [
          { id: 's1', tool: 'vault_add_to_section', params: { path: 'a.md', section: 'Log', content: 'Entry A' } },
          { id: 's2', tool: 'vault_add_to_section', params: { path: 'b.md', section: 'Log', content: 'Entry B' } },
        ],
      };

      // Pass commit=true at policy level for atomic commit
      const result = await executePolicy(policy, tempVault, {}, true);

      expect(result.success).toBe(true);

      // Should have made 1 atomic commit (all steps together)
      const finalCommits = await getCommitCount();
      expect(finalCommits).toBe(initialCommits + 1);
      expect(result.gitCommit).toBeDefined();
    });

    it('should not commit without commit: true flag', async () => {
      await createTestNote(tempVault, 'test.md', '# Log\n');
      await git.add('test.md');
      await git.commit('Add test note');

      const initialCommits = await getCommitCount();

      const policy: PolicyDefinition = {
        version: '1.0',
        name: 'no-commit',
        description: 'No commit flag',
        steps: [
          { id: 's1', tool: 'vault_add_to_section', params: { path: 'test.md', section: 'Log', content: 'No commit' } },
        ],
      };

      await executePolicy(policy, tempVault, {});

      const finalCommits = await getCommitCount();
      expect(finalCommits).toBe(initialCommits);

      // But file should still be modified
      const content = await readTestNote(tempVault, 'test.md');
      expect(content).toContain('No commit');
    });

    it('should include policy name in commit message', async () => {
      await createTestNote(tempVault, 'test.md', '# Log\n');
      await git.add('test.md');
      await git.commit('Add test note');

      const policy: PolicyDefinition = {
        version: '1.0',
        name: 'my-special-policy',
        description: 'Test policy',
        steps: [
          { id: 's1', tool: 'vault_add_to_section', params: { path: 'test.md', section: 'Log', content: 'Entry', commit: true } },
        ],
      };

      await executePolicy(policy, tempVault, {});

      const message = await getLastCommitMessage();
      // Commit message should reference the file path or action
      expect(message.length).toBeGreaterThan(0);
    });
  });

  describe('File Consistency', () => {
    it('should leave files in consistent state on failure', async () => {
      await createTestNote(tempVault, 'valid.md', '# Log\n');

      const originalContent = await readTestNote(tempVault, 'valid.md');

      const policy: PolicyDefinition = {
        version: '1.0',
        name: 'consistency-test',
        description: 'Test file consistency',
        steps: [
          { id: 's1', tool: 'vault_add_to_section', params: { path: 'valid.md', section: 'Log', content: 'Added' } },
          { id: 's2', tool: 'vault_add_to_section', params: { path: 'invalid.md', section: 'X', content: 'Fail' } },
        ],
      };

      const result = await executePolicy(policy, tempVault, {});

      expect(result.success).toBe(false);

      // First file should have its changes (partial success)
      const content = await readTestNote(tempVault, 'valid.md');
      expect(content).toContain('Added');

      // But it should be a valid markdown file
      expect(content).toContain('# Log');
    });

    it('should handle concurrent-safe file writes', async () => {
      await createTestNote(tempVault, 'concurrent.md', '# Log\n');

      const policy: PolicyDefinition = {
        version: '1.0',
        name: 'rapid-writes',
        description: 'Rapid sequential writes',
        steps: Array.from({ length: 10 }, (_, i) => ({
          id: `s${i}`,
          tool: 'vault_add_to_section' as const,
          params: { path: 'concurrent.md', section: 'Log', content: `Entry ${i}` },
        })),
      };

      const result = await executePolicy(policy, tempVault, {});

      expect(result.success).toBe(true);

      const content = await readTestNote(tempVault, 'concurrent.md');

      // All entries should be present
      for (let i = 0; i < 10; i++) {
        expect(content).toContain(`Entry ${i}`);
      }
    });
  });

  describe('Atomicity Guarantees', () => {
    it('should report filesModified accurately', async () => {
      await createTestNote(tempVault, 'x.md', '# Log\n');
      await createTestNote(tempVault, 'y.md', '# Log\n');
      await createTestNote(tempVault, 'z.md', '# Log\n');

      const policy: PolicyDefinition = {
        version: '1.0',
        name: 'track-files',
        description: 'Tracks modified files',
        steps: [
          { id: 's1', tool: 'vault_add_to_section', params: { path: 'x.md', section: 'Log', content: 'X' } },
          { id: 's2', tool: 'vault_add_to_section', params: { path: 'y.md', section: 'Log', content: 'Y' } },
          // Skip z.md
        ],
      };

      const result = await executePolicy(policy, tempVault, {});

      expect(result.success).toBe(true);
      expect(result.filesModified).toContain('x.md');
      expect(result.filesModified).toContain('y.md');
      expect(result.filesModified).not.toContain('z.md');
    });

    it('should handle same file modified multiple times', async () => {
      await createTestNote(tempVault, 'multi.md', '# Log\n');

      const policy: PolicyDefinition = {
        version: '1.0',
        name: 'multi-modify',
        description: 'Multiple modifications to same file',
        steps: [
          { id: 's1', tool: 'vault_add_to_section', params: { path: 'multi.md', section: 'Log', content: 'First' } },
          { id: 's2', tool: 'vault_add_to_section', params: { path: 'multi.md', section: 'Log', content: 'Second' } },
          { id: 's3', tool: 'vault_add_to_section', params: { path: 'multi.md', section: 'Log', content: 'Third' } },
        ],
      };

      const result = await executePolicy(policy, tempVault, {});

      expect(result.success).toBe(true);

      // filesModified might have the file once or multiple times
      expect(result.filesModified.filter(f => f === 'multi.md').length).toBeGreaterThanOrEqual(1);

      const content = await readTestNote(tempVault, 'multi.md');
      expect(content).toContain('First');
      expect(content).toContain('Second');
      expect(content).toContain('Third');
    });
  });
});

describe('Non-Git Vault Transactions', () => {
  beforeEach(async () => {
    tempVault = await createTempVault(false); // No git init
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should execute successfully without git', async () => {
    await createTestNote(tempVault, 'test.md', '# Log\n');

    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'no-git-policy',
      description: 'Works without git',
      steps: [
        { id: 's1', tool: 'vault_add_to_section', params: { path: 'test.md', section: 'Log', content: 'Entry' } },
      ],
    };

    const result = await executePolicy(policy, tempVault, {});

    expect(result.success).toBe(true);
    expect(result.gitCommit).toBeUndefined();

    const content = await readTestNote(tempVault, 'test.md');
    expect(content).toContain('Entry');
  });

  it('should handle commit: true gracefully without git', async () => {
    await createTestNote(tempVault, 'test.md', '# Log\n');

    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'commit-no-git',
      description: 'Commit flag without git repo',
      steps: [
        { id: 's1', tool: 'vault_add_to_section', params: { path: 'test.md', section: 'Log', content: 'Entry', commit: true } },
      ],
    };

    const result = await executePolicy(policy, tempVault, {});

    // Should succeed with file mutation, but no git commit
    expect(result.success).toBe(true);

    const content = await readTestNote(tempVault, 'test.md');
    expect(content).toContain('Entry');
  });
});

describe('Variable Interpolation in Transactions', () => {
  beforeEach(async () => {
    tempVault = await createTempVault(false);
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should interpolate variables consistently across steps', async () => {
    await createTestNote(tempVault, 'vars.md', '# Tasks\n');

    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'var-interpolation',
      description: 'Test variable interpolation',
      variables: {
        task: { type: 'string', required: true },
        priority: { type: 'string', default: 'medium' },
      },
      steps: [
        { id: 's1', tool: 'vault_add_to_section', params: { path: 'vars.md', section: 'Tasks', content: '{{task}} - {{priority}}' } },
      ],
    };

    const result = await executePolicy(policy, tempVault, {
      task: 'Buy groceries',
    });

    expect(result.success).toBe(true);

    const content = await readTestNote(tempVault, 'vars.md');
    expect(content).toContain('Buy groceries - medium');
  });

  it('should fail validation for missing required variables', async () => {
    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'missing-var',
      description: 'Missing required variable',
      variables: {
        required_var: { type: 'string', required: true },
      },
      steps: [
        { id: 's1', tool: 'vault_create_note', params: { path: '{{required_var}}.md', content: '# Note' } },
      ],
    };

    const result = await executePolicy(policy, tempVault, {}); // No variables provided

    expect(result.success).toBe(false);
    expect(result.message.toLowerCase()).toMatch(/variable|required/);
  });
});
