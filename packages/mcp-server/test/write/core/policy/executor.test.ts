/**
 * Policy executor tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { executePolicy, previewPolicy } from '../../../src/core/policy/executor.js';
import type { PolicyDefinition } from '../../../src/core/policy/types.js';

// Test vault utilities
let tempVault: string;

async function createTempVault(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-test-'));
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

describe('executePolicy', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should execute a simple add to section policy', async () => {
    // Create test note
    await createTestNote(tempVault, 'test.md', '# Log\n\nExisting content');

    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'add-content',
      description: 'Add content to log',
      steps: [
        {
          id: 'add-step',
          tool: 'vault_add_to_section',
          params: {
            path: 'test.md',
            section: 'Log',
            content: 'New entry',
          },
        },
      ],
    };

    const result = await executePolicy(policy, tempVault, {});

    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(1);
    expect(result.stepResults[0].success).toBe(true);

    const content = await readTestNote(tempVault, 'test.md');
    expect(content).toContain('New entry');
  });

  it('should interpolate variables in params', async () => {
    await createTestNote(tempVault, 'daily.md', '# Tasks\n');

    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'add-task',
      description: 'Add a task',
      variables: {
        task_text: { type: 'string', required: true },
      },
      steps: [
        {
          id: 'add-task',
          tool: 'vault_add_task',
          params: {
            path: 'daily.md',
            section: 'Tasks',
            task: '{{task_text}}',
          },
        },
      ],
    };

    const result = await executePolicy(policy, tempVault, { task_text: 'Buy groceries' });

    expect(result.success).toBe(true);

    const content = await readTestNote(tempVault, 'daily.md');
    expect(content).toContain('Buy groceries');
  });

  it('should use default variable values', async () => {
    await createTestNote(tempVault, 'note.md', '# Log\n');

    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'with-defaults',
      description: 'Uses defaults',
      variables: {
        message: { type: 'string', default: 'Default message' },
      },
      steps: [
        {
          id: 'add',
          tool: 'vault_add_to_section',
          params: {
            path: 'note.md',
            section: 'Log',
            content: '{{message}}',
          },
        },
      ],
    };

    const result = await executePolicy(policy, tempVault, {});

    expect(result.success).toBe(true);

    const content = await readTestNote(tempVault, 'note.md');
    expect(content).toContain('Default message');
  });

  it('should fail fast on step error', async () => {
    // Note doesn't exist - first step should fail
    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'fail-fast',
      description: 'Should fail on first step',
      steps: [
        {
          id: 'step1',
          tool: 'vault_add_to_section',
          params: {
            path: 'nonexistent.md',
            section: 'Log',
            content: 'test',
          },
        },
        {
          id: 'step2',
          tool: 'vault_add_to_section',
          params: {
            path: 'another.md',
            section: 'Log',
            content: 'test',
          },
        },
      ],
    };

    const result = await executePolicy(policy, tempVault, {});

    expect(result.success).toBe(false);
    expect(result.stepResults).toHaveLength(1); // Only first step attempted
    expect(result.stepResults[0].success).toBe(false);
  });

  it('should track modified files', async () => {
    await createTestNote(tempVault, 'one.md', '# Log\n');
    await createTestNote(tempVault, 'two.md', '# Log\n');

    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'multi-file',
      description: 'Modifies multiple files',
      steps: [
        {
          id: 'step1',
          tool: 'vault_add_to_section',
          params: { path: 'one.md', section: 'Log', content: 'Entry 1' },
        },
        {
          id: 'step2',
          tool: 'vault_add_to_section',
          params: { path: 'two.md', section: 'Log', content: 'Entry 2' },
        },
      ],
    };

    const result = await executePolicy(policy, tempVault, {});

    expect(result.success).toBe(true);
    expect(result.filesModified).toContain('one.md');
    expect(result.filesModified).toContain('two.md');
  });

  it('should create notes with vault_create_note', async () => {
    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'create-note',
      description: 'Creates a new note',
      variables: {
        title: { type: 'string', required: true },
      },
      steps: [
        {
          id: 'create',
          tool: 'vault_create_note',
          params: {
            path: 'notes/{{title | slug}}.md',
            content: '# {{title}}\n\nContent here',
            frontmatter: { created: '{{today}}' },
          },
        },
      ],
    };

    const result = await executePolicy(policy, tempVault, { title: 'My New Note' });

    expect(result.success).toBe(true);

    const content = await readTestNote(tempVault, 'notes/my-new-note.md');
    expect(content).toContain('# My New Note');
  });

  it('should update frontmatter', async () => {
    await createTestNote(tempVault, 'note.md', '---\nstatus: draft\n---\n# Note\n');

    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'update-fm',
      description: 'Updates frontmatter',
      steps: [
        {
          id: 'update',
          tool: 'vault_update_frontmatter',
          params: {
            path: 'note.md',
            frontmatter: { status: 'published', updated: '{{today}}' },
          },
        },
      ],
    };

    const result = await executePolicy(policy, tempVault, {});

    expect(result.success).toBe(true);

    const content = await readTestNote(tempVault, 'note.md');
    expect(content).toContain('status: published');
    expect(content).toMatch(/updated: ['"]?\d{4}-\d{2}-\d{2}['"]?/);
  });
});

describe('previewPolicy', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should preview without making changes', async () => {
    await createTestNote(tempVault, 'test.md', '# Log\n');

    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'preview-test',
      description: 'Test preview',
      variables: {
        message: { type: 'string', required: true },
      },
      steps: [
        {
          id: 'add',
          tool: 'vault_add_to_section',
          params: {
            path: 'test.md',
            section: 'Log',
            content: '{{message}}',
          },
        },
      ],
    };

    const preview = await previewPolicy(policy, tempVault, { message: 'Preview message' });

    expect(preview.policyName).toBe('preview-test');
    expect(preview.resolvedVariables).toEqual({ message: 'Preview message' });
    expect(preview.stepsToExecute).toHaveLength(1);
    expect(preview.stepsToExecute[0].resolvedParams.content).toBe('Preview message');
    expect(preview.filesAffected).toContain('test.md');

    // Verify file wasn't changed
    const content = await readTestNote(tempVault, 'test.md');
    expect(content).not.toContain('Preview message');
  });

  it('should evaluate conditions in preview', async () => {
    await createTestNote(tempVault, 'existing.md', '# Log\n');

    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'conditional',
      description: 'Conditional steps',
      conditions: [
        { id: 'file_check', check: 'file_exists', path: 'existing.md' },
        { id: 'missing_check', check: 'file_exists', path: 'missing.md' },
      ],
      steps: [
        {
          id: 'step1',
          tool: 'vault_add_to_section',
          when: '{{conditions.file_check}}',
          params: { path: 'existing.md', section: 'Log', content: 'test' },
        },
        {
          id: 'step2',
          tool: 'vault_add_to_section',
          when: '{{conditions.missing_check}}',
          params: { path: 'missing.md', section: 'Log', content: 'test' },
        },
      ],
    };

    const preview = await previewPolicy(policy, tempVault, {});

    expect(preview.conditionResults.file_check).toBe(true);
    expect(preview.conditionResults.missing_check).toBe(false);
    expect(preview.stepsToExecute[0].skipped).toBe(false);
    expect(preview.stepsToExecute[1].skipped).toBe(true);
  });
});
