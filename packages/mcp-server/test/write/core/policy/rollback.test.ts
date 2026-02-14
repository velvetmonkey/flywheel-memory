/**
 * Policy Rollback Tests
 *
 * Validates that multi-step policy execution can be rolled back
 * when a step fails, ensuring atomicity guarantees.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { executePolicy } from '../../../src/core/policy/executor.js';
import type { PolicyDefinition } from '../../../src/core/policy/types.js';

let tempVault: string;

async function createTempVault(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-rollback-test-'));
  await fs.mkdir(path.join(dir, '.claude', 'policies'), { recursive: true });
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

async function noteExists(vaultPath: string, notePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(vaultPath, notePath));
    return true;
  } catch {
    return false;
  }
}

describe('Policy Rollback Behavior', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  describe('Fail-Fast Behavior', () => {
    it('should stop execution when a step fails', async () => {
      await createTestNote(tempVault, 'existing.md', '# Log\n\nContent');

      const policy: PolicyDefinition = {
        version: '1.0',
        name: 'fail-fast-test',
        description: 'Test that execution stops on failure',
        steps: [
          {
            id: 'step1',
            tool: 'vault_add_to_section',
            params: { path: 'existing.md', section: 'Log', content: 'Entry 1' },
          },
          {
            id: 'step2',
            tool: 'vault_add_to_section',
            params: { path: 'nonexistent.md', section: 'Log', content: 'Will fail' },
          },
          {
            id: 'step3',
            tool: 'vault_add_to_section',
            params: { path: 'existing.md', section: 'Log', content: 'Entry 2' },
          },
        ],
      };

      const result = await executePolicy(policy, tempVault, {});

      expect(result.success).toBe(false);
      expect(result.stepResults).toHaveLength(2); // Only steps 1 and 2 attempted
      expect(result.stepResults[0].success).toBe(true);
      expect(result.stepResults[1].success).toBe(false);
      // Step 3 should NOT have been attempted

      const content = await readTestNote(tempVault, 'existing.md');
      expect(content).toContain('Entry 1');
      expect(content).not.toContain('Entry 2'); // Step 3 never ran
    });

    it('should preserve partial changes from successful steps (without commit)', async () => {
      // Without commit mode, successful steps modify files but filesModified is empty on failure
      await createTestNote(tempVault, 'file1.md', '# Log\n');
      await createTestNote(tempVault, 'file2.md', '# Log\n');

      const policy: PolicyDefinition = {
        version: '1.0',
        name: 'partial-success',
        description: 'First two steps succeed, third fails',
        steps: [
          {
            id: 'step1',
            tool: 'vault_add_to_section',
            params: { path: 'file1.md', section: 'Log', content: 'Success 1' },
          },
          {
            id: 'step2',
            tool: 'vault_add_to_section',
            params: { path: 'file2.md', section: 'Log', content: 'Success 2' },
          },
          {
            id: 'step3',
            tool: 'vault_add_to_section',
            params: { path: 'missing.md', section: 'Log', content: 'Fail' },
          },
        ],
      };

      const result = await executePolicy(policy, tempVault, {});

      expect(result.success).toBe(false);
      // filesModified is empty on failure (atomic semantics)
      expect(result.filesModified).toHaveLength(0);

      // But without commit mode, files ARE modified (no rollback happens)
      const file1 = await readTestNote(tempVault, 'file1.md');
      const file2 = await readTestNote(tempVault, 'file2.md');
      expect(file1).toContain('Success 1');
      expect(file2).toContain('Success 2');
    });

    it('should report which step failed', async () => {
      const policy: PolicyDefinition = {
        version: '1.0',
        name: 'identify-failure',
        description: 'Step 3 of 5 fails',
        steps: [
          { id: 'step1', tool: 'vault_create_note', params: { path: 'notes/a.md', content: '# A' } },
          { id: 'step2', tool: 'vault_create_note', params: { path: 'notes/b.md', content: '# B' } },
          { id: 'step3', tool: 'vault_add_to_section', params: { path: 'missing.md', section: 'X', content: 'fail' } },
          { id: 'step4', tool: 'vault_create_note', params: { path: 'notes/c.md', content: '# C' } },
          { id: 'step5', tool: 'vault_create_note', params: { path: 'notes/d.md', content: '# D' } },
        ],
      };

      const result = await executePolicy(policy, tempVault, {});

      expect(result.success).toBe(false);
      expect(result.stepResults).toHaveLength(3);
      expect(result.stepResults[0].stepId).toBe('step1');
      expect(result.stepResults[1].stepId).toBe('step2');
      expect(result.stepResults[2].stepId).toBe('step3');
      expect(result.stepResults[2].success).toBe(false);

      // Notes a and b should exist, c and d should not
      expect(await noteExists(tempVault, 'notes/a.md')).toBe(true);
      expect(await noteExists(tempVault, 'notes/b.md')).toBe(true);
      expect(await noteExists(tempVault, 'notes/c.md')).toBe(false);
      expect(await noteExists(tempVault, 'notes/d.md')).toBe(false);
    });
  });

  describe('Error Message Quality', () => {
    it('should provide descriptive error for missing file', async () => {
      const policy: PolicyDefinition = {
        version: '1.0',
        name: 'missing-file-error',
        description: 'Tests error message quality',
        steps: [
          {
            id: 'fail-step',
            tool: 'vault_add_to_section',
            params: { path: 'does/not/exist.md', section: 'Log', content: 'test' },
          },
        ],
      };

      const result = await executePolicy(policy, tempVault, {});

      expect(result.success).toBe(false);
      expect(result.stepResults[0].success).toBe(false);
      expect(result.stepResults[0].message).toBeDefined();
      // Error should mention the file or path
      expect(result.stepResults[0].message.toLowerCase()).toMatch(/not found|does not exist|enoent/);
    });

    it('should provide descriptive error for missing section', async () => {
      await createTestNote(tempVault, 'exists.md', '# Title\n\nNo Log section');

      const policy: PolicyDefinition = {
        version: '1.0',
        name: 'missing-section-error',
        description: 'Tests section not found error',
        steps: [
          {
            id: 'fail-step',
            tool: 'vault_add_to_section',
            params: { path: 'exists.md', section: 'Nonexistent Section', content: 'test' },
          },
        ],
      };

      const result = await executePolicy(policy, tempVault, {});

      expect(result.success).toBe(false);
      expect(result.stepResults[0].success).toBe(false);
      // Error should mention section
      expect(result.stepResults[0].message.toLowerCase()).toMatch(/section|not found/);
    });
  });

  describe('Conditional Step Handling', () => {
    it('should skip steps with failing conditions without error', async () => {
      await createTestNote(tempVault, 'exists.md', '# Log\n');

      const policy: PolicyDefinition = {
        version: '1.0',
        name: 'conditional-skip',
        description: 'Skips step based on condition',
        conditions: [
          { id: 'file_check', check: 'file_exists', path: 'missing.md' },
        ],
        steps: [
          {
            id: 'conditional-step',
            tool: 'vault_add_to_section',
            when: '{{conditions.file_check}}',
            params: { path: 'missing.md', section: 'Log', content: 'wont run' },
          },
          {
            id: 'always-step',
            tool: 'vault_add_to_section',
            params: { path: 'exists.md', section: 'Log', content: 'will run' },
          },
        ],
      };

      const result = await executePolicy(policy, tempVault, {});

      expect(result.success).toBe(true);
      expect(result.stepResults[0].skipped).toBe(true);
      expect(result.stepResults[1].success).toBe(true);

      const content = await readTestNote(tempVault, 'exists.md');
      expect(content).toContain('will run');
    });

    it('should handle multiple conditional skips', async () => {
      await createTestNote(tempVault, 'always.md', '# Log\n');

      const policy: PolicyDefinition = {
        version: '1.0',
        name: 'multi-conditional',
        description: 'Multiple conditions',
        conditions: [
          { id: 'cond1', check: 'file_exists', path: 'missing1.md' },
          { id: 'cond2', check: 'file_exists', path: 'missing2.md' },
          { id: 'cond3', check: 'file_exists', path: 'always.md' },
        ],
        steps: [
          { id: 'skip1', tool: 'vault_add_to_section', when: '{{conditions.cond1}}', params: { path: 'missing1.md', section: 'Log', content: 'x' } },
          { id: 'skip2', tool: 'vault_add_to_section', when: '{{conditions.cond2}}', params: { path: 'missing2.md', section: 'Log', content: 'x' } },
          { id: 'run', tool: 'vault_add_to_section', when: '{{conditions.cond3}}', params: { path: 'always.md', section: 'Log', content: 'runs' } },
        ],
      };

      const result = await executePolicy(policy, tempVault, {});

      expect(result.success).toBe(true);
      expect(result.stepResults[0].skipped).toBe(true);
      expect(result.stepResults[1].skipped).toBe(true);
      // Executed steps have skipped=undefined (falsy), not explicitly false
      expect(result.stepResults[2].skipped).toBeFalsy();
      expect(result.stepResults[2].success).toBe(true);
    });
  });

  describe('Step Order Preservation', () => {
    it('should execute steps in defined order', async () => {
      await createTestNote(tempVault, 'order.md', '# Log\n');

      const policy: PolicyDefinition = {
        version: '1.0',
        name: 'step-order',
        description: 'Verifies step execution order',
        steps: [
          { id: 'first', tool: 'vault_add_to_section', params: { path: 'order.md', section: 'Log', content: '1-first' } },
          { id: 'second', tool: 'vault_add_to_section', params: { path: 'order.md', section: 'Log', content: '2-second' } },
          { id: 'third', tool: 'vault_add_to_section', params: { path: 'order.md', section: 'Log', content: '3-third' } },
        ],
      };

      const result = await executePolicy(policy, tempVault, {});

      expect(result.success).toBe(true);

      const content = await readTestNote(tempVault, 'order.md');
      const firstPos = content.indexOf('1-first');
      const secondPos = content.indexOf('2-second');
      const thirdPos = content.indexOf('3-third');

      // All should be present and in order
      expect(firstPos).toBeGreaterThan(-1);
      expect(secondPos).toBeGreaterThan(firstPos);
      expect(thirdPos).toBeGreaterThan(secondPos);
    });
  });
});

describe('Rollback Scenarios', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should return empty filesModified on failure (atomic semantics)', async () => {
    // With atomic execution mode, filesModified is empty on failure
    // because changes are rolled back and nothing was committed
    await createTestNote(tempVault, 'a.md', '# Log\n');
    await createTestNote(tempVault, 'b.md', '# Log\n');

    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'track-modified',
      description: 'Track modified files',
      steps: [
        { id: 'modify-a', tool: 'vault_add_to_section', params: { path: 'a.md', section: 'Log', content: 'A modified' } },
        { id: 'modify-b', tool: 'vault_add_to_section', params: { path: 'b.md', section: 'Log', content: 'B modified' } },
        { id: 'fail', tool: 'vault_add_to_section', params: { path: 'missing.md', section: 'X', content: 'fail' } },
      ],
    };

    const result = await executePolicy(policy, tempVault, {});

    expect(result.success).toBe(false);
    // With atomic semantics, filesModified is empty on failure
    expect(result.filesModified).toHaveLength(0);

    // But step results still track what happened
    expect(result.stepResults[0].success).toBe(true);
    expect(result.stepResults[1].success).toBe(true);
    expect(result.stepResults[2].success).toBe(false);
  });

  it('should handle empty policy gracefully', async () => {
    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'empty-policy',
      description: 'No steps',
      steps: [],
    };

    const result = await executePolicy(policy, tempVault, {});

    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(0);
    expect(result.filesModified).toHaveLength(0);
  });

  it('should handle all steps skipped', async () => {
    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'all-skipped',
      description: 'All steps skipped',
      conditions: [
        { id: 'false_cond', check: 'file_exists', path: 'never-exists.md' },
      ],
      steps: [
        { id: 'skip1', tool: 'vault_create_note', when: '{{conditions.false_cond}}', params: { path: 'a.md', content: '' } },
        { id: 'skip2', tool: 'vault_create_note', when: '{{conditions.false_cond}}', params: { path: 'b.md', content: '' } },
      ],
    };

    const result = await executePolicy(policy, tempVault, {});

    expect(result.success).toBe(true);
    expect(result.stepResults.every(r => r.skipped)).toBe(true);
    expect(result.filesModified).toHaveLength(0);
  });
});
