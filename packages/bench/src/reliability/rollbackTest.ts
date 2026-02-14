/**
 * Rollback verification tests
 *
 * Tests that policy rollback works correctly when git operations fail.
 * Ensures vault state is restored to pre-execution state on failure.
 */

import fs from 'fs/promises';
import path from 'path';
import type {
  ReliabilityTestResult,
  ReliabilityTestConfig,
  StagedFileInfo,
  GitFailureType,
} from './types.js';

/**
 * Create a test vault with sample files
 */
export async function createTestVault(config: ReliabilityTestConfig): Promise<string[]> {
  const files = [
    { path: 'note1.md', content: '# Note 1\n\n## Section A\n\nOriginal content A\n' },
    { path: 'note2.md', content: '# Note 2\n\n## Section B\n\nOriginal content B\n' },
    { path: 'note3.md', content: '# Note 3\n\n## Section C\n\nOriginal content C\n' },
  ];

  const createdFiles: string[] = [];

  for (const file of files) {
    const fullPath = path.join(config.vaultPath, file.path);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, file.content);
    createdFiles.push(file.path);
  }

  return createdFiles;
}

/**
 * Read all files in vault for comparison
 */
export async function readVaultState(
  vaultPath: string,
  files: string[]
): Promise<Map<string, string>> {
  const state = new Map<string, string>();

  for (const file of files) {
    try {
      const content = await fs.readFile(path.join(vaultPath, file), 'utf-8');
      state.set(file, content);
    } catch {
      // File doesn't exist
      state.set(file, '');
    }
  }

  return state;
}

/**
 * Compare two vault states
 */
export function compareVaultStates(
  before: Map<string, string>,
  after: Map<string, string>
): { changed: string[]; unchanged: string[] } {
  const changed: string[] = [];
  const unchanged: string[] = [];

  for (const [file, beforeContent] of before) {
    const afterContent = after.get(file) || '';
    if (beforeContent === afterContent) {
      unchanged.push(file);
    } else {
      changed.push(file);
    }
  }

  return { changed, unchanged };
}

/**
 * Simulate a multi-file mutation that should be rolled back
 */
export async function simulateMultiFileMutation(
  vaultPath: string,
  files: string[],
  newContents: Map<string, string>
): Promise<StagedFileInfo[]> {
  const staged: StagedFileInfo[] = [];

  for (const file of files) {
    const fullPath = path.join(vaultPath, file);
    let originalContent: string | null = null;

    try {
      originalContent = await fs.readFile(fullPath, 'utf-8');
    } catch {
      // File doesn't exist
    }

    const newContent = newContents.get(file) || '';
    await fs.writeFile(fullPath, newContent);

    staged.push({
      path: file,
      originalContent,
      newContent,
    });
  }

  return staged;
}

/**
 * Rollback staged files to their original state
 */
export async function rollbackStagedFiles(
  vaultPath: string,
  staged: StagedFileInfo[]
): Promise<void> {
  for (const file of staged) {
    const fullPath = path.join(vaultPath, file.path);

    if (file.originalContent === null) {
      // File was newly created - delete it
      try {
        await fs.unlink(fullPath);
      } catch {
        // Already deleted
      }
    } else {
      // Restore original content
      await fs.writeFile(fullPath, file.originalContent);
    }
  }
}

/**
 * Test: Verify rollback restores all files after simulated git failure
 */
export async function testRollbackOnGitFailure(
  config: ReliabilityTestConfig
): Promise<ReliabilityTestResult> {
  const startTime = Date.now();

  try {
    // Setup test vault
    const files = await createTestVault(config);
    const stateBefore = await readVaultState(config.vaultPath, files);

    // Simulate multi-file mutation
    const newContents = new Map([
      ['note1.md', '# Note 1\n\n## Section A\n\nMODIFIED content A\n'],
      ['note2.md', '# Note 2\n\n## Section B\n\nMODIFIED content B\n'],
      ['note3.md', '# Note 3\n\n## Section C\n\nMODIFIED content C\n'],
    ]);

    const staged = await simulateMultiFileMutation(config.vaultPath, files, newContents);

    // Verify files were modified
    const stateAfterMutation = await readVaultState(config.vaultPath, files);
    const { changed: changedAfterMutation } = compareVaultStates(stateBefore, stateAfterMutation);

    if (changedAfterMutation.length !== 3) {
      return {
        name: 'rollback_on_git_failure',
        passed: false,
        message: `Expected 3 files changed, got ${changedAfterMutation.length}`,
        duration_ms: Date.now() - startTime,
      };
    }

    // Simulate git failure and rollback
    await rollbackStagedFiles(config.vaultPath, staged);

    // Verify all files restored
    const stateAfterRollback = await readVaultState(config.vaultPath, files);
    const { changed, unchanged } = compareVaultStates(stateBefore, stateAfterRollback);

    if (changed.length !== 0) {
      return {
        name: 'rollback_on_git_failure',
        passed: false,
        message: `Rollback failed: ${changed.length} files still changed: ${changed.join(', ')}`,
        duration_ms: Date.now() - startTime,
        metrics: {
          files_changed: changed.length,
          files_restored: unchanged.length,
        },
      };
    }

    return {
      name: 'rollback_on_git_failure',
      passed: true,
      message: `All ${unchanged.length} files restored correctly after rollback`,
      duration_ms: Date.now() - startTime,
      metrics: {
        files_tested: files.length,
        files_restored: unchanged.length,
      },
    };
  } catch (error) {
    return {
      name: 'rollback_on_git_failure',
      passed: false,
      message: `Test error: ${error instanceof Error ? error.message : String(error)}`,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Test: Verify rollback handles new file creation correctly
 */
export async function testRollbackNewFiles(
  config: ReliabilityTestConfig
): Promise<ReliabilityTestResult> {
  const startTime = Date.now();

  try {
    // Setup: Create vault with only note1.md
    const existingFiles = ['note1.md'];
    await fs.mkdir(config.vaultPath, { recursive: true });
    await fs.writeFile(
      path.join(config.vaultPath, 'note1.md'),
      '# Note 1\n\nOriginal\n'
    );

    const stateBefore = await readVaultState(config.vaultPath, existingFiles);

    // Simulate creating new files as part of policy
    const newFile = 'new-note.md';
    const newContent = '# New Note\n\nCreated by policy\n';
    await fs.writeFile(path.join(config.vaultPath, newFile), newContent);

    // Verify new file exists
    try {
      await fs.access(path.join(config.vaultPath, newFile));
    } catch {
      return {
        name: 'rollback_new_files',
        passed: false,
        message: 'Failed to create new file',
        duration_ms: Date.now() - startTime,
      };
    }

    // Rollback (should delete newly created file)
    const staged: StagedFileInfo[] = [
      {
        path: newFile,
        originalContent: null, // Didn't exist
        newContent,
      },
    ];

    await rollbackStagedFiles(config.vaultPath, staged);

    // Verify new file was deleted
    try {
      await fs.access(path.join(config.vaultPath, newFile));
      return {
        name: 'rollback_new_files',
        passed: false,
        message: 'New file still exists after rollback',
        duration_ms: Date.now() - startTime,
      };
    } catch {
      // Good - file should not exist
    }

    return {
      name: 'rollback_new_files',
      passed: true,
      message: 'New file correctly deleted during rollback',
      duration_ms: Date.now() - startTime,
    };
  } catch (error) {
    return {
      name: 'rollback_new_files',
      passed: false,
      message: `Test error: ${error instanceof Error ? error.message : String(error)}`,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Test: Verify partial rollback (some files succeed, some fail)
 */
export async function testPartialRollback(
  config: ReliabilityTestConfig
): Promise<ReliabilityTestResult> {
  const startTime = Date.now();

  try {
    // Setup
    const files = await createTestVault(config);
    const stateBefore = await readVaultState(config.vaultPath, files);

    // Modify only first 2 files (simulating partial policy execution)
    const newContents = new Map([
      ['note1.md', '# Note 1\n\n## Section A\n\nMODIFIED content A\n'],
      ['note2.md', '# Note 2\n\n## Section B\n\nMODIFIED content B\n'],
    ]);

    const staged: StagedFileInfo[] = [];
    for (const [file, content] of newContents) {
      const fullPath = path.join(config.vaultPath, file);
      const original = await fs.readFile(fullPath, 'utf-8');
      await fs.writeFile(fullPath, content);
      staged.push({
        path: file,
        originalContent: original,
        newContent: content,
      });
    }

    // Rollback only the staged files
    await rollbackStagedFiles(config.vaultPath, staged);

    // Verify state matches before
    const stateAfter = await readVaultState(config.vaultPath, files);
    const { changed } = compareVaultStates(stateBefore, stateAfter);

    if (changed.length !== 0) {
      return {
        name: 'partial_rollback',
        passed: false,
        message: `Partial rollback failed: ${changed.join(', ')} still changed`,
        duration_ms: Date.now() - startTime,
      };
    }

    return {
      name: 'partial_rollback',
      passed: true,
      message: 'Partial rollback restored all modified files',
      duration_ms: Date.now() - startTime,
      metrics: {
        files_modified: staged.length,
        files_untouched: files.length - staged.length,
      },
    };
  } catch (error) {
    return {
      name: 'partial_rollback',
      passed: false,
      message: `Test error: ${error instanceof Error ? error.message : String(error)}`,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Run all rollback tests
 */
export async function runRollbackTests(
  config: ReliabilityTestConfig
): Promise<ReliabilityTestResult[]> {
  const results: ReliabilityTestResult[] = [];

  results.push(await testRollbackOnGitFailure(config));
  results.push(await testRollbackNewFiles(config));
  results.push(await testPartialRollback(config));

  return results;
}
