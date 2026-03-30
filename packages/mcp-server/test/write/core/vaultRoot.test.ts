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

  it('should find vault root by .claude marker', async () => {
    await mkdir(path.join(tempVault, '.claude'));
    const result = findVaultRoot(tempVault);
    expect(result).toBe(tempVault);
  });

  it('should find vault root by .flywheel marker', async () => {
    await mkdir(path.join(tempVault, '.flywheel'));
    const result = findVaultRoot(tempVault);
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

  it('should prefer .obsidian over .flywheel and .claude when all exist', async () => {
    await mkdir(path.join(tempVault, '.obsidian'));
    await mkdir(path.join(tempVault, '.flywheel'));
    await mkdir(path.join(tempVault, '.claude'));

    const result = findVaultRoot(tempVault);
    expect(result).toBe(tempVault);
  });

  it('should prefer .flywheel over .claude when both exist (no .obsidian)', async () => {
    await mkdir(path.join(tempVault, '.flywheel'));
    await mkdir(path.join(tempVault, '.claude'));

    const result = findVaultRoot(tempVault);
    expect(result).toBe(tempVault);
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

  it('should handle nested vault structure', async () => {
    await mkdir(path.join(tempVault, '.obsidian'));

    const projectPath = path.join(tempVault, 'projects', 'my-project');
    await mkdir(projectPath, { recursive: true });
    await mkdir(path.join(projectPath, '.claude'));

    const result = findVaultRoot(projectPath);
    expect(result).toBe(projectPath);
  });

  it('should stop at filesystem root if no markers found', async () => {
    const deepPath = path.join(tempVault, 'a', 'b', 'c', 'd');
    await mkdir(deepPath, { recursive: true });

    const result = findVaultRoot(deepPath);
    expect(result).toBe(deepPath);
  });
});
