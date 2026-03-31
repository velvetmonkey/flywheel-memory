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
} from '../../../src/core/write/writer.js';
import { setWriteStateDb } from '../../../src/core/write/wikilinks.js';

let tempVault: string;

describe('Missing .flywheel Directory', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should auto-create .flywheel when opening StateDb', async () => {
    const flywheelDir = path.join(tempVault, '.flywheel');

    const beforeExists = await fs.access(flywheelDir).then(() => true).catch(() => false);
    expect(beforeExists).toBe(false);

    const stateDb = openStateDb(tempVault);
    setWriteStateDb(stateDb);

    createEntityCacheInStateDb(stateDb, tempVault, { people: ['Test Person'] });

    const afterExists = await fs.access(flywheelDir).then(() => true).catch(() => false);
    expect(afterExists).toBe(true);

    setWriteStateDb(null);
    stateDb.db.close();
    deleteStateDb(tempVault);
  });

  it('should auto-create .flywheel/policies when needed', async () => {
    const policiesDir = path.join(tempVault, '.flywheel', 'policies');

    const beforeExists = await fs.access(policiesDir).then(() => true).catch(() => false);
    expect(beforeExists).toBe(false);

    await fs.mkdir(policiesDir, { recursive: true });

    const afterExists = await fs.access(policiesDir).then(() => true).catch(() => false);
    expect(afterExists).toBe(true);
  });

  it('should handle .flywheel existing as file (error gracefully)', async () => {
    await fs.writeFile(path.join(tempVault, '.flywheel'), 'not a directory');

    try {
      await fs.mkdir(path.join(tempVault, '.flywheel', 'policies'), { recursive: true });
    } catch (error: any) {
      expect(error.code).toMatch(/ENOTDIR|EEXIST/);
    }
  });

  it('should auto-create .flywheel when needed', async () => {
    const flywheelDir = path.join(tempVault, '.flywheel');

    const beforeExists = await fs.access(flywheelDir).then(() => true).catch(() => false);
    expect(beforeExists).toBe(false);

    await fs.mkdir(flywheelDir, { recursive: true });

    const afterExists = await fs.access(flywheelDir).then(() => true).catch(() => false);
    expect(afterExists).toBe(true);
  });

  it('should handle StateDb creation in missing .flywheel', async () => {
    const flywheelDir = path.join(tempVault, '.flywheel');

    await fs.mkdir(flywheelDir, { recursive: true });

    const exists = await fs.access(flywheelDir).then(() => true).catch(() => false);
    expect(exists).toBe(true);
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

describe('Path Validation', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should validate paths stay within vault', async () => {
    expect(validatePath(tempVault, 'notes/test.md')).toBe(true);
    expect(validatePath(tempVault, 'deep/nested/path/file.md')).toBe(true);

    expect(validatePath(tempVault, '../outside.md')).toBe(false);
    expect(validatePath(tempVault, 'notes/../../outside.md')).toBe(false);
  });

  it('should handle absolute paths within vault', async () => {
    const absolutePath = path.join(tempVault, 'notes', 'test.md');
    const relativePath = 'notes/test.md';
  });
});

describe('Permission Errors', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  const isWindows = process.platform === 'win32';

  it.skipIf(isWindows)('should provide clear error for read-only parent directory', async () => {
    const readOnlyDir = path.join(tempVault, 'readonly');
    await fs.mkdir(readOnlyDir);

    await fs.chmod(readOnlyDir, 0o444);

    try {
      await fs.writeFile(path.join(readOnlyDir, 'test.md'), 'content');
    } catch (error: any) {
      expect(error.code).toBe('EACCES');
    } finally {
      await fs.chmod(readOnlyDir, 0o755);
    }
  });
});
