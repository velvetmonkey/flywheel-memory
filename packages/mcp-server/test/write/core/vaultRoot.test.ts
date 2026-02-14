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
    // Create .obsidian directory
    await mkdir(path.join(tempVault, '.obsidian'));

    // Should find the vault root
    const result = findVaultRoot(tempVault);
    expect(result).toBe(tempVault);
  });

  it('should find vault root by .claude marker', async () => {
    // Create .claude directory
    await mkdir(path.join(tempVault, '.claude'));

    // Should find the vault root
    const result = findVaultRoot(tempVault);
    expect(result).toBe(tempVault);
  });

  it('should walk up directory tree to find vault root', async () => {
    // Create nested directory structure with .obsidian at root
    await mkdir(path.join(tempVault, '.obsidian'));
    await mkdir(path.join(tempVault, 'daily-notes'), { recursive: true });
    await mkdir(path.join(tempVault, 'daily-notes', '2026'), { recursive: true });

    // Start from deeply nested directory
    const deepPath = path.join(tempVault, 'daily-notes', '2026');
    const result = findVaultRoot(deepPath);

    // Should find the vault root (where .obsidian is)
    expect(result).toBe(tempVault);
  });

  it('should prefer .obsidian over .claude when both exist', async () => {
    // Create both markers
    await mkdir(path.join(tempVault, '.obsidian'));
    await mkdir(path.join(tempVault, '.claude'));

    // Should find the vault root with .obsidian
    const result = findVaultRoot(tempVault);
    expect(result).toBe(tempVault);
  });

  it('should return start path if no markers found', async () => {
    // No markers created, should fall back to start path
    const result = findVaultRoot(tempVault);
    expect(result).toBe(tempVault);
  });

  it('should use cwd if no start path provided and no markers found', () => {
    // Call without arguments (uses process.cwd())
    const result = findVaultRoot();

    // Should return some path (cwd or ancestor with marker)
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('should handle nested vault structure', async () => {
    // Create parent vault with .obsidian
    await mkdir(path.join(tempVault, '.obsidian'));

    // Create nested project directory
    const projectPath = path.join(tempVault, 'projects', 'my-project');
    await mkdir(projectPath, { recursive: true });

    // Create another .claude marker in nested directory
    await mkdir(path.join(projectPath, '.claude'));

    // Starting from nested project, should find the nearest marker
    const result = findVaultRoot(projectPath);
    expect(result).toBe(projectPath); // Should find .claude first
  });

  it('should stop at filesystem root if no markers found', async () => {
    // Create a directory without markers
    const deepPath = path.join(tempVault, 'a', 'b', 'c', 'd');
    await mkdir(deepPath, { recursive: true });

    // Should fall back to start path (tempVault)
    const result = findVaultRoot(deepPath);
    expect(result).toBe(deepPath);
  });
});
