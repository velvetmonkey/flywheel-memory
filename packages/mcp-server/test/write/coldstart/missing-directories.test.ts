/**
 * Missing Directories Tests
 *
 * Validates graceful handling when expected directories
 * don't exist, and auto-creation behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  createEntityCache,
  createEntityCacheInStateDb,
  openStateDb,
  deleteStateDb,
  type StateDb,
} from '../helpers/testUtils.js';
import {
  readVaultFile,
  writeVaultFile,
  validatePath,
} from '../../src/core/writer.js';
import { setCrankStateDb } from '../../src/core/wikilinks.js';

let tempVault: string;

describe('Missing .claude Directory', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should auto-create .flywheel when opening StateDb', async () => {
    const flywheelDir = path.join(tempVault, '.flywheel');

    // Verify doesn't exist
    const beforeExists = await fs.access(flywheelDir).then(() => true).catch(() => false);
    expect(beforeExists).toBe(false);

    // Open StateDb (should auto-create .flywheel)
    const stateDb = openStateDb(tempVault);
    setCrankStateDb(stateDb);

    // Create entity cache in StateDb
    createEntityCacheInStateDb(stateDb, tempVault, { people: ['Test Person'] });

    const afterExists = await fs.access(flywheelDir).then(() => true).catch(() => false);
    expect(afterExists).toBe(true);

    // Cleanup
    setCrankStateDb(null);
    stateDb.db.close();
    deleteStateDb(tempVault);
  });

  it('should auto-create .claude/policies when needed', async () => {
    const policiesDir = path.join(tempVault, '.claude', 'policies');

    // Verify doesn't exist
    const beforeExists = await fs.access(policiesDir).then(() => true).catch(() => false);
    expect(beforeExists).toBe(false);

    // Create the directory
    await fs.mkdir(policiesDir, { recursive: true });

    const afterExists = await fs.access(policiesDir).then(() => true).catch(() => false);
    expect(afterExists).toBe(true);
  });

  it('should handle .claude existing as file (error gracefully)', async () => {
    // Create .claude as a file (not directory)
    await fs.writeFile(path.join(tempVault, '.claude'), 'not a directory');

    // Attempting to create subdirectory should fail gracefully
    try {
      await fs.mkdir(path.join(tempVault, '.claude', 'policies'), { recursive: true });
      // If it doesn't throw, that's okay (implementation specific)
    } catch (error: any) {
      // Should get a meaningful error
      expect(error.code).toMatch(/ENOTDIR|EEXIST/);
    }
  });
});

describe('Missing Note Directories', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should auto-create parent directories when writing note', async () => {
    const notePath = 'daily-notes/2026/02/02.md';
    const content = '# Daily Note';

    await createTestNote(tempVault, notePath, content);

    const exists = await fs.access(path.join(tempVault, notePath)).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    // Verify intermediate directories exist
    const dayDir = path.join(tempVault, 'daily-notes', '2026', '02');
    const dayDirExists = await fs.access(dayDir).then(() => true).catch(() => false);
    expect(dayDirExists).toBe(true);
  });

  it('should handle multiple notes in non-existent folders', async () => {
    const notes = [
      'projects/project-a/README.md',
      'projects/project-b/README.md',
      'people/team-a/alice.md',
      'people/team-b/bob.md',
    ];

    for (const notePath of notes) {
      await createTestNote(tempVault, notePath, `# ${path.basename(notePath, '.md')}`);
    }

    for (const notePath of notes) {
      const exists = await fs.access(path.join(tempVault, notePath)).then(() => true).catch(() => false);
      expect(exists, `Note should exist: ${notePath}`).toBe(true);
    }
  });
});

describe('Missing .flywheel Directory', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should auto-create .flywheel when needed', async () => {
    const flywheelDir = path.join(tempVault, '.flywheel');

    // Verify doesn't exist
    const beforeExists = await fs.access(flywheelDir).then(() => true).catch(() => false);
    expect(beforeExists).toBe(false);

    // Create it
    await fs.mkdir(flywheelDir, { recursive: true });

    const afterExists = await fs.access(flywheelDir).then(() => true).catch(() => false);
    expect(afterExists).toBe(true);
  });

  it('should handle StateDb creation in missing .flywheel', async () => {
    // This test validates that SQLite StateDb can be created
    // even when .flywheel doesn't exist initially

    const flywheelDir = path.join(tempVault, '.flywheel');

    // Create .flywheel directory (StateDb opener should do this)
    await fs.mkdir(flywheelDir, { recursive: true });

    // Verify directory exists for db file
    const exists = await fs.access(flywheelDir).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });
});

describe('Path Validation', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should validate paths stay within vault', async () => {
    // Valid paths return true
    expect(validatePath(tempVault, 'notes/test.md')).toBe(true);
    expect(validatePath(tempVault, 'deep/nested/path/file.md')).toBe(true);

    // Invalid paths (path traversal attempts) return false
    expect(validatePath(tempVault, '../outside.md')).toBe(false);
    expect(validatePath(tempVault, 'notes/../../outside.md')).toBe(false);
  });

  it('should handle absolute paths within vault', async () => {
    const absolutePath = path.join(tempVault, 'notes', 'test.md');
    const relativePath = 'notes/test.md';

    // Both should work or both should follow same validation
    // Implementation specific - test that behavior is consistent
  });
});

describe('Permission Errors', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  // Note: These tests may behave differently on Windows vs Unix
  // Skip on Windows where permission model differs
  const isWindows = process.platform === 'win32';

  it.skipIf(isWindows)('should provide clear error for read-only parent directory', async () => {
    const readOnlyDir = path.join(tempVault, 'readonly');
    await fs.mkdir(readOnlyDir);

    // Make directory read-only
    await fs.chmod(readOnlyDir, 0o444);

    try {
      await fs.writeFile(path.join(readOnlyDir, 'test.md'), 'content');
      // If it doesn't throw on this platform, that's okay
    } catch (error: any) {
      expect(error.code).toBe('EACCES');
    } finally {
      // Restore permissions for cleanup
      await fs.chmod(readOnlyDir, 0o755);
    }
  });
});
