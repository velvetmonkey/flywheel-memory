/**
 * Tests for policy executor step output passing
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { executePolicy } from '../../../src/core/write/policy/executor.js';
import type { PolicyDefinition } from '../../../src/core/write/policy/types.js';
import {
  createTempVault,
  cleanupTempVault,
  openStateDb,
  deleteStateDb,
  type StateDb,
} from '../helpers/testUtils.js';
import { setWriteStateDb } from '../../../src/core/write/wikilinks.js';
import { readVaultFile } from '../../../src/core/write/writer.js';
import path from 'path';
import fs from 'fs/promises';

describe('Policy Executor - Step Output Passing', () => {
  let vaultPath: string;
  let db: StateDb | null = null;

  beforeEach(async () => {
    vaultPath = await createTempVault();
    db = await openStateDb(vaultPath);
    setWriteStateDb(db);
  });

  afterEach(async () => {
    if (db) {
      setWriteStateDb(null);
      db.db.close();
      deleteStateDb(vaultPath);
    }
    await cleanupTempVault(vaultPath);
  });

  it('should pass step outputs to subsequent steps', async () => {
    // Create daily note for logging
    const today = new Date().toISOString().split('T')[0];
    const dailyNotePath = `daily-notes/${today}.md`;
    await fs.mkdir(path.join(vaultPath, 'daily-notes'), { recursive: true });
    await fs.writeFile(
      path.join(vaultPath, dailyNotePath),
      '# Daily Note\n\n## Log\n\n'
    );

    // Policy that creates a note and logs it
    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'test-step-chaining',
      description: 'Test step output passing',
      variables: {
        title: { type: 'string', required: true },
        content: { type: 'string', default: 'Test content' },
      },
      steps: [
        {
          id: 'create-note',
          tool: 'vault_create_note',
          params: {
            path: 'test/{{title}}.md',
            content: '{{content}}',
          },
        },
        {
          id: 'log-creation',
          tool: 'vault_add_to_section',
          params: {
            path: dailyNotePath,
            section: '## Log',
            content: '📝 **Created:** [[{{steps.create-note.path}}]]',
            format: 'plain',
          },
        },
      ],
    };

    const result = await executePolicy(
      policy,
      vaultPath,
      { title: 'Test Note', content: 'This is a test' },
      false // Don't commit
    );

    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(2);

    // Check first step captured output
    const createStep = result.stepResults[0];
    expect(createStep.stepId).toBe('create-note');
    expect(createStep.success).toBe(true);
    expect(createStep.outputs).toBeDefined();
    expect(createStep.outputs?.path).toBe('test/Test Note.md');

    // Check second step used the output
    const logStep = result.stepResults[1];
    expect(logStep.stepId).toBe('log-creation');
    expect(logStep.success).toBe(true);

    // Verify the daily note has the link (path includes .md extension)
    const { content: dailyContent } = await readVaultFile(vaultPath, dailyNotePath);
    expect(dailyContent).toContain('[[test/Test Note.md]]');
  });

  it('should handle multiple step outputs', async () => {
    // Create daily note
    const today = new Date().toISOString().split('T')[0];
    const dailyNotePath = `daily-notes/${today}.md`;
    await fs.mkdir(path.join(vaultPath, 'daily-notes'), { recursive: true });
    await fs.writeFile(
      path.join(vaultPath, dailyNotePath),
      '# Daily Note\n\n## Notes\n\n## Summary\n\n'
    );

    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'multi-step-outputs',
      description: 'Test multiple step outputs',
      steps: [
        {
          id: 'create-note-1',
          tool: 'vault_create_note',
          params: {
            path: 'notes/first.md',
            content: 'First note',
          },
        },
        {
          id: 'create-note-2',
          tool: 'vault_create_note',
          params: {
            path: 'notes/second.md',
            content: 'Second note',
          },
        },
        {
          id: 'add-to-notes',
          tool: 'vault_add_to_section',
          params: {
            path: dailyNotePath,
            section: '## Notes',
            content: '- [[{{steps.create-note-1.path}}]]',
            format: 'plain',
          },
        },
        {
          id: 'add-to-summary',
          tool: 'vault_add_to_section',
          params: {
            path: dailyNotePath,
            section: '## Summary',
            content: 'Created [[{{steps.create-note-1.path}}]] and [[{{steps.create-note-2.path}}]]',
            format: 'plain',
          },
        },
      ],
    };

    const result = await executePolicy(policy, vaultPath, {}, false);

    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(4);

    // Verify outputs captured
    expect(result.stepResults[0].outputs?.path).toBe('notes/first.md');
    expect(result.stepResults[1].outputs?.path).toBe('notes/second.md');

    // Verify daily note content (paths include .md extension)
    const { content: dailyContent } = await readVaultFile(vaultPath, dailyNotePath);
    expect(dailyContent).toContain('[[notes/first.md]]');
    expect(dailyContent).toContain('[[notes/second.md]]');
    expect(dailyContent).toContain('Created [[notes/first.md]] and [[notes/second.md]]');
  });

  it('should not fail if step output is not used', async () => {
    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'unused-output',
      description: 'Step output not used',
      steps: [
        {
          id: 'create-note',
          tool: 'vault_create_note',
          params: {
            path: 'test/note.md',
            content: 'Content',
          },
        },
        {
          id: 'create-another',
          tool: 'vault_create_note',
          params: {
            path: 'test/another.md',
            content: 'More content',
          },
        },
      ],
    };

    const result = await executePolicy(policy, vaultPath, {}, false);

    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(2);
    expect(result.stepResults[0].outputs?.path).toBe('test/note.md');
    expect(result.stepResults[1].outputs?.path).toBe('test/another.md');
  });

  it('should handle skipped steps gracefully', async () => {
    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'conditional-output',
      description: 'Test skipped step outputs',
      conditions: [
        {
          id: 'file_missing',
          check: 'file_not_exists',
          path: 'missing.md',
        },
      ],
      steps: [
        {
          id: 'create-if-missing',
          tool: 'vault_create_note',
          when: '{{conditions.file_missing}}',
          params: {
            path: 'new.md',
            content: 'Created when condition is false',
          },
        },
        {
          id: 'always-create',
          tool: 'vault_create_note',
          params: {
            path: 'always.md',
            content: 'Always created',
          },
        },
      ],
    };

    const result = await executePolicy(policy, vaultPath, {}, false);

    expect(result.success).toBe(true);
    // First step should execute because condition is true (file doesn't exist)
    expect(result.stepResults[0].skipped).toBeFalsy();
    expect(result.stepResults[0].outputs?.path).toBe('new.md');
    expect(result.stepResults[1].outputs?.path).toBe('always.md');
  });
});
