/**
 * Tests for policy executor step output passing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executePolicy } from '../../../src/core/write/policy/executor.js';
import type { PolicyDefinition } from '../../../src/core/write/policy/types.js';
import {
  createTempVault,
  cleanupTempVault,
  openStateDb,
  deleteStateDb,
  createEntityCacheInStateDb,
  type StateDb,
} from '../helpers/testUtils.js';
import { initializeEntityIndex, setWriteStateDb } from '../../../src/core/write/wikilinks.js';
import * as wikilinksModule from '../../../src/core/write/wikilinks.js';
import * as gitModule from '../../../src/core/write/git.js';
import { readVaultFile } from '../../../src/core/write/writer.js';
import { runInVaultScope, type VaultScope } from '../../../src/vault-scope.js';
import { createEmptyPipelineActivity } from '../../../src/core/read/watch/pipeline.js';
import path from 'path';
import fs from 'fs/promises';

describe('Policy Executor - Step Output Passing', () => {
  let vaultPath: string;
  let db: StateDb | null = null;

  async function createTestEntitySetup(): Promise<void> {
    createEntityCacheInStateDb(db!, vaultPath, {
      technologies: ['TypeScript', 'JavaScript', 'Python'],
      projects: ['MCP Server'],
    });
    await initializeEntityIndex(vaultPath);
  }

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

  function makePolicyScope(name: string = 'policy-test'): VaultScope {
    return {
      name,
      vaultPath,
      stateDb: db,
      flywheelConfig: {},
      vaultIndex: { notes: new Map(), entities: new Map(), backlinks: new Map(), tags: new Map(), builtAt: new Date() } as any,
      cooccurrenceIndex: null,
      indexState: 'ready',
      indexError: null,
      embeddingsBuilding: false,
      writeEntityIndex: null,
      writeEntityIndexReady: false,
      writeEntityIndexError: null,
      writeEntityIndexLastLoadedAt: 0,
      writeRecencyIndex: null,
      taskCacheBuilding: false,
      entityEmbeddingsMap: new Map(),
      inferredCategoriesMap: new Map(),
      mutedWatcherPaths: new Set(),
      dirtyMutedWatcherPaths: new Set(),
      reconcileMutedWatcherPaths: null,
      pipelineActivity: createEmptyPipelineActivity(),
      bootState: 'ready',
      integrityState: 'healthy',
      integrityCheckInProgress: false,
      integrityStartedAt: null,
      integritySource: null,
      lastIntegrityCheckedAt: null,
      lastIntegrityDurationMs: null,
      lastIntegrityDetail: null,
      lastBackupAt: null,
    };
  }

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

  it('should preserve frontmatter on rollback after step failure', async () => {
    // Create a note with frontmatter
    const notePath = 'rollback-test.md';
    const originalContent = `---
title: Important Note
tags:
  - project
  - critical
custom_field: preserve-me
---
# Rollback Test

## Content

Original content here.
`;
    await fs.writeFile(path.join(vaultPath, notePath), originalContent);

    // Policy: step 1 modifies the note, step 2 targets a non-existent file (will fail)
    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'test-rollback-frontmatter',
      description: 'Test that rollback preserves frontmatter',
      steps: [
        {
          id: 'modify-note',
          tool: 'vault_add_to_section',
          params: {
            path: notePath,
            section: '## Content',
            content: 'Added by policy',
            format: 'plain',
          },
        },
        {
          id: 'fail-step',
          tool: 'vault_add_to_section',
          params: {
            path: 'nonexistent/deeply/nested/file.md',
            section: '## Missing',
            content: 'This will fail',
            format: 'plain',
          },
        },
      ],
    };

    const result = await executePolicy(policy, vaultPath, {}, true);

    expect(result.success).toBe(false);

    // Read back the file — frontmatter must be intact
    const restored = await fs.readFile(path.join(vaultPath, notePath), 'utf-8');
    expect(restored).toBe(originalContent);
    expect(restored).toContain('title: Important Note');
    expect(restored).toContain('custom_field: preserve-me');
    expect(restored).toContain('tags:');
  });

  it('does not add outgoing link suffixes by default for policy writes', async () => {
    await fs.writeFile(
      path.join(vaultPath, 'project.md'),
      '# Project\n\n## Notes\n\n'
    );
    await createTestEntitySetup();
    const suggestSpy = vi.spyOn(wikilinksModule, 'suggestRelatedLinks');

    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'policy-default-no-suffix',
      description: 'Policy writes should not append suffix suggestions unless enabled',
      steps: [
        {
          id: 'add-note',
          tool: 'vault_add_to_section',
          params: {
            path: 'project.md',
            section: '## Notes',
            content: 'Discussed TypeScript and JavaScript today.',
            format: 'plain',
          },
        },
      ],
    };

    const result = await executePolicy(policy, vaultPath, {}, false);

    expect(result.success).toBe(true);
    expect(suggestSpy).not.toHaveBeenCalled();
    const { content } = await readVaultFile(vaultPath, 'project.md');
    expect(content).toContain('[[TypeScript]]');
    expect(content).toContain('[[JavaScript]]');
    expect(content).not.toContain('→ [[');
    suggestSpy.mockRestore();
  });

  it('adds outgoing link suffixes for policy writes when explicitly enabled', async () => {
    await fs.writeFile(
      path.join(vaultPath, 'project.md'),
      '# Project\n\n## Notes\n\n'
    );
    const suggestSpy = vi.spyOn(wikilinksModule, 'suggestRelatedLinks').mockResolvedValue({
      suggestions: ['MCP Server'],
      suffix: '→ [[MCP Server]]',
    });

    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'policy-explicit-suffix',
      description: 'Policy writes should append suffix suggestions when enabled',
      steps: [
        {
          id: 'add-note',
          tool: 'vault_add_to_section',
          params: {
            path: 'project.md',
            section: '## Notes',
            content: 'Discussed TypeScript and JavaScript today.',
            format: 'plain',
            suggestOutgoingLinks: true,
          },
        },
      ],
    };

    const result = await executePolicy(policy, vaultPath, {}, false);

    expect(result.success).toBe(true);
    expect(suggestSpy).toHaveBeenCalled();
    const { content } = await readVaultFile(vaultPath, 'project.md');
    expect(content).toContain('→ [[MCP Server]]');
    suggestSpy.mockRestore();
  });
  it('reports rollback failure details when compensating rollback cannot restore changes', async () => {
    const createdNotePath = 'notes/rollback-created.md';
    const normalizedCreatedNotePath = createdNotePath.replace(/\\/g, '/').toLowerCase();
    const originalUnlink = fs.unlink;
    const unlinkSpy = vi.spyOn(fs, 'unlink').mockImplementation(async (filePath) => {
      const normalizedFilePath = String(filePath).replace(/\\/g, '/').toLowerCase();
      if (normalizedFilePath.endsWith(normalizedCreatedNotePath)) {
        throw new Error('simulated unlink failure during rollback');
      }
      return originalUnlink.call(fs, filePath as Parameters<typeof fs.unlink>[0]);
    });

    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'rollback-failure-reporting',
      description: 'Rollback failure reporting',
      steps: [
        {
          id: 'create-note',
          tool: 'vault_create_note',
          params: {
            path: createdNotePath,
            content: 'Created before failure',
          },
        },
        {
          id: 'fail-step',
          tool: 'vault_add_to_section',
          params: {
            path: 'missing/file.md',
            section: '## Missing',
            content: 'This step fails',
            format: 'plain',
          },
        },
      ],
    };

    const result = await executePolicy(policy, vaultPath, {}, false);

    unlinkSpy.mockRestore();

    expect(result.success).toBe(false);
    expect(result.rollbackFailed).toBe(true);
    expect(result.rollbackError).toMatch(/simulated unlink failure during rollback/i);
    expect(result.filesModified).toContain(createdNotePath);
    expect(result.message).toMatch(/rollback also failed/i);
    await expect(fs.access(path.join(vaultPath, createdNotePath))).resolves.toBeUndefined();
  });

  it('rolls back live writes when git commit fails after successful steps', async () => {
    const notePath = 'commit-failure.md';
    const originalContent = '# Commit Failure\n\n## Log\n\nOriginal content.\n';
    await fs.writeFile(path.join(vaultPath, notePath), originalContent);

    const isRepoSpy = vi.spyOn(gitModule, 'isGitRepo').mockResolvedValue(true);
    const lockSpy = vi.spyOn(gitModule, 'checkGitLock').mockResolvedValue({ locked: false });
    const commitSpy = vi.spyOn(gitModule, 'commitPolicyChanges').mockResolvedValue({
      success: false,
      error: 'simulated git commit failure',
      undoAvailable: false,
      filesCommitted: 0,
    });

    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'commit-failure-rolls-back',
      description: 'Commit failure rollback',
      steps: [
        {
          id: 'append-log',
          tool: 'vault_add_to_section',
          params: {
            path: notePath,
            section: '## Log',
            content: 'Added before commit failure',
            format: 'plain',
          },
        },
      ],
    };

    const result = await executePolicy(policy, vaultPath, {}, true);

    commitSpy.mockRestore();
    lockSpy.mockRestore();
    isRepoSpy.mockRestore();

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/git commit failed/i);
    expect(result.rollbackFailed).toBe(false);
    expect(result.filesModified).toEqual([]);

    const restored = await fs.readFile(path.join(vaultPath, notePath), 'utf-8');
    expect(restored).toBe(originalContent);
  });

  it('reconciles watcher-muted paths once after a scoped policy write', async () => {
    const notePath = 'policy-watch.md';
    await fs.writeFile(path.join(vaultPath, notePath), '# Policy Watch\n\n## Log\n\n');

    const scope = makePolicyScope('watcher-success');
    scope.dirtyMutedWatcherPaths.add(notePath);
    const reconcileSpy = vi.fn(async (_paths: string[]) => {});
    scope.reconcileMutedWatcherPaths = reconcileSpy;

    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'watcher-reconcile-success',
      description: 'Policy watcher reconciliation success',
      steps: [
        {
          id: 'append-log',
          tool: 'vault_add_to_section',
          params: {
            path: notePath,
            section: '## Log',
            content: 'Watcher-safe update',
            format: 'plain',
          },
        },
      ],
    };

    const result = await runInVaultScope(scope, () => executePolicy(policy, vaultPath, {}, false));

    expect(result.success).toBe(true);
    expect(reconcileSpy).toHaveBeenCalledTimes(1);
    expect(reconcileSpy).toHaveBeenCalledWith([notePath]);
    expect(scope.mutedWatcherPaths.size).toBe(0);
    expect(scope.dirtyMutedWatcherPaths.size).toBe(0);
  });

  it('surfaces watcher reconciliation failures after scoped policy execution', async () => {
    const notePath = 'policy-watch-failure.md';
    await fs.writeFile(path.join(vaultPath, notePath), '# Policy Watch\n\n## Log\n\n');

    const scope = makePolicyScope('watcher-failure');
    scope.dirtyMutedWatcherPaths.add(notePath);
    scope.reconcileMutedWatcherPaths = vi.fn(async () => {
      throw new Error('simulated watcher reconcile failure');
    });

    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'watcher-reconcile-failure',
      description: 'Policy watcher reconciliation failure',
      steps: [
        {
          id: 'append-log',
          tool: 'vault_add_to_section',
          params: {
            path: notePath,
            section: '## Log',
            content: 'Watcher failure update',
            format: 'plain',
          },
        },
      ],
    };

    const result = await runInVaultScope(scope, () => executePolicy(policy, vaultPath, {}, false));

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/watcher reconciliation failed/i);
    expect(result.message).toMatch(/simulated watcher reconcile failure/i);
    expect(scope.mutedWatcherPaths.size).toBe(0);
  });
});
