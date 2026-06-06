/**
 * Tests for vault root detection utilities
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { findVaultRoot } from '../../../src/core/write/vaultRoot.js';
import {
  createTempVault,
  cleanupTempVault,
} from '../helpers/testUtils.js';
import { mkdir } from 'fs/promises';
import path from 'path';

describe('findVaultRoot', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should find vault root by .obsidian marker', async () => {
    await mkdir(path.join(tempVault, '.obsidian'));
    const result = findVaultRoot(tempVault);
    expect(result).toBe(tempVault);
  });

  it('should NOT treat .claude as a vault marker (falls through to .obsidian parent)', async () => {
    // .claude exists in home dirs and most code repos; treating it as a vault
    // marker made findVaultRoot adopt ~/src as a vault. The real .obsidian
    // parent must win instead.
    await mkdir(path.join(tempVault, '.obsidian'));
    const childPath = path.join(tempVault, 'some-repo');
    await mkdir(childPath, { recursive: true });
    await mkdir(path.join(childPath, '.claude'));

    const result = findVaultRoot(childPath);
    expect(result).toBe(tempVault);
  });

  it('should NOT treat .flywheel as a vault marker (falls through to .obsidian parent)', async () => {
    await mkdir(path.join(tempVault, '.obsidian'));
    const childPath = path.join(tempVault, 'some-repo');
    await mkdir(childPath, { recursive: true });
    await mkdir(path.join(childPath, '.flywheel'));

    const result = findVaultRoot(childPath);
    expect(result).toBe(tempVault);
  });

  it('should walk up directory tree to find vault root', async () => {
    await mkdir(path.join(tempVault, '.obsidian'));
    await mkdir(path.join(tempVault, 'daily-notes'), { recursive: true });
    await mkdir(path.join(tempVault, 'daily-notes', '2026'), { recursive: true });

    const deepPath = path.join(tempVault, 'daily-notes', '2026');
    const result = findVaultRoot(deepPath);
    expect(result).toBe(tempVault);
  });

  it('should detect .obsidian even when .flywheel and .claude also exist', async () => {
    await mkdir(path.join(tempVault, '.obsidian'));
    await mkdir(path.join(tempVault, '.flywheel'));
    await mkdir(path.join(tempVault, '.claude'));

    const result = findVaultRoot(tempVault);
    expect(result).toBe(tempVault);
  });

  it('should not stop at a dir that only has .flywheel/.claude (no .obsidian anywhere)', async () => {
    // No .obsidian above, so no marker matches; it must fall back to the start
    // path rather than treating the .flywheel/.claude dir as a vault root.
    const childPath = path.join(tempVault, 'some-repo');
    await mkdir(childPath, { recursive: true });
    await mkdir(path.join(childPath, '.flywheel'));
    await mkdir(path.join(childPath, '.claude'));

    const result = findVaultRoot(childPath);
    expect(result).toBe(childPath);
  });

  it('should return start path if no markers found', async () => {
    const result = findVaultRoot(tempVault);
    expect(result).toBe(tempVault);
  });

  it('should use cwd if no start path provided and no markers found', () => {
    const result = findVaultRoot();
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('should resolve a nested project with .claude to the real .obsidian vault root', async () => {
    // Regression: a project subdir carrying .claude must NOT be treated as its
    // own vault. The enclosing .obsidian vault is the real root.
    await mkdir(path.join(tempVault, '.obsidian'));

    const projectPath = path.join(tempVault, 'projects', 'my-project');
    await mkdir(projectPath, { recursive: true });
    await mkdir(path.join(projectPath, '.claude'));

    const result = findVaultRoot(projectPath);
    expect(result).toBe(tempVault);
  });

  it('should stop at filesystem root if no markers found', async () => {
    const deepPath = path.join(tempVault, 'a', 'b', 'c', 'd');
    await mkdir(deepPath, { recursive: true });

    const result = findVaultRoot(deepPath);
    expect(result).toBe(deepPath);
  });
});
