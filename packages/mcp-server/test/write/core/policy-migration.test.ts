/**
 * Tests for policy migration from .claude/policies/ to .flywheel/policies/
 *
 * Validates that policies stored at the legacy location are automatically
 * migrated to .flywheel/policies/ on first access via the real execution path.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  createTempVault,
  cleanupTempVault,
} from '../helpers/testUtils.js';
import { loadPolicy } from '../../../src/core/write/policy/parser.js';
import { listPolicies, deletePolicy } from '../../../src/core/write/policy/storage.js';
import {
  migratePoliciesIfNeeded,
  resetMigrationCache,
  getPoliciesDir,
  getLegacyPoliciesDir,
} from '../../../src/core/write/policy/policyPaths.js';

const SAMPLE_POLICY = `
version: "1.0"
name: "test-policy"
description: "A test policy for migration"

steps:
  - id: "step-1"
    tool: vault_add_to_section
    params:
      path: "notes/test.md"
      section: "## Log"
      content: "Hello"
`.trim();

const ALTERNATE_POLICY = `
version: "1.0"
name: "test-policy"
description: "A DIFFERENT test policy (newer version in .flywheel)"

steps:
  - id: "step-1"
    tool: vault_add_to_section
    params:
      path: "notes/other.md"
      section: "## Log"
      content: "World"
`.trim();

describe('Policy Migration', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await createTempVault();
    resetMigrationCache();
  });

  afterEach(async () => {
    await cleanupTempVault(vaultPath);
  });

  it('should migrate a policy from .claude/policies/ via loadPolicy()', async () => {
    // Place policy only at legacy location
    const legacyDir = getLegacyPoliciesDir(vaultPath);
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(path.join(legacyDir, 'test-policy.yaml'), SAMPLE_POLICY);

    // loadPolicy is the real execution path for policy execute/preview/revise
    const result = await loadPolicy(vaultPath, 'test-policy');
    expect(result.valid).toBe(true);
    expect(result.policy?.name).toBe('test-policy');

    // Verify it was migrated to .flywheel/policies/
    const newPath = path.join(getPoliciesDir(vaultPath), 'test-policy.yaml');
    const exists = await fs.access(newPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    // Verify legacy file was removed
    const legacyExists = await fs.access(path.join(legacyDir, 'test-policy.yaml')).then(() => true).catch(() => false);
    expect(legacyExists).toBe(false);
  });

  it('should list policies after migration from legacy location', async () => {
    // Place policy only at legacy location
    const legacyDir = getLegacyPoliciesDir(vaultPath);
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(path.join(legacyDir, 'test-policy.yaml'), SAMPLE_POLICY);

    // listPolicies should trigger migration and find the policy
    const policies = await listPolicies(vaultPath);
    expect(policies.length).toBe(1);
    expect(policies[0].name).toBe('test-policy');
  });

  it('should delete a legacy policy after migration', async () => {
    // Place policy only at legacy location
    const legacyDir = getLegacyPoliciesDir(vaultPath);
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(path.join(legacyDir, 'test-policy.yaml'), SAMPLE_POLICY);

    // deletePolicy should trigger migration first, then delete
    const result = await deletePolicy(vaultPath, 'test-policy');
    expect(result.success).toBe(true);

    // Verify gone from both locations
    const newExists = await fs.access(path.join(getPoliciesDir(vaultPath), 'test-policy.yaml')).then(() => true).catch(() => false);
    const legacyExists = await fs.access(path.join(legacyDir, 'test-policy.yaml')).then(() => true).catch(() => false);
    expect(newExists).toBe(false);
    expect(legacyExists).toBe(false);
  });

  it('should preserve .flywheel/ version on conflict and remove legacy copy', async () => {
    // Place different versions in both locations
    const legacyDir = getLegacyPoliciesDir(vaultPath);
    const newDir = getPoliciesDir(vaultPath);
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.mkdir(newDir, { recursive: true });
    await fs.writeFile(path.join(legacyDir, 'test-policy.yaml'), SAMPLE_POLICY);
    await fs.writeFile(path.join(newDir, 'test-policy.yaml'), ALTERNATE_POLICY);

    await migratePoliciesIfNeeded(vaultPath);

    // .flywheel/ version should be preserved (the ALTERNATE content)
    const content = await fs.readFile(path.join(newDir, 'test-policy.yaml'), 'utf-8');
    expect(content).toContain('A DIFFERENT test policy');

    // Legacy copy should be removed (convergence)
    const legacyExists = await fs.access(path.join(legacyDir, 'test-policy.yaml')).then(() => true).catch(() => false);
    expect(legacyExists).toBe(false);
  });

  it('should be idempotent — running migration twice is safe', async () => {
    // Place policy at legacy location
    const legacyDir = getLegacyPoliciesDir(vaultPath);
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(path.join(legacyDir, 'test-policy.yaml'), SAMPLE_POLICY);

    // First migration
    await migratePoliciesIfNeeded(vaultPath);

    // Verify migrated
    const newPath = path.join(getPoliciesDir(vaultPath), 'test-policy.yaml');
    const exists = await fs.access(newPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    // Second migration — should not throw
    await migratePoliciesIfNeeded(vaultPath);

    // File should still be there and valid
    const content = await fs.readFile(newPath, 'utf-8');
    expect(content).toContain('test-policy');
  });

  it('should clean up empty .claude/ directory after migration', async () => {
    // Place policy at legacy location (only .claude/policies/ in .claude/)
    const legacyDir = getLegacyPoliciesDir(vaultPath);
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(path.join(legacyDir, 'test-policy.yaml'), SAMPLE_POLICY);

    await migratePoliciesIfNeeded(vaultPath);

    // .claude/policies/ should be gone
    const policiesDirExists = await fs.access(legacyDir).then(() => true).catch(() => false);
    expect(policiesDirExists).toBe(false);

    // .claude/ itself should be gone (was empty)
    const claudeDirExists = await fs.access(path.join(vaultPath, '.claude')).then(() => true).catch(() => false);
    expect(claudeDirExists).toBe(false);
  });

  it('should not remove .claude/ if it contains other files', async () => {
    // Place policy at legacy location AND another file in .claude/
    const legacyDir = getLegacyPoliciesDir(vaultPath);
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(path.join(legacyDir, 'test-policy.yaml'), SAMPLE_POLICY);
    await fs.writeFile(path.join(vaultPath, '.claude', 'settings.json'), '{}');

    await migratePoliciesIfNeeded(vaultPath);

    // .claude/policies/ should be gone (empty after migration)
    const policiesDirExists = await fs.access(legacyDir).then(() => true).catch(() => false);
    expect(policiesDirExists).toBe(false);

    // .claude/ should still exist (has settings.json)
    const claudeDirExists = await fs.access(path.join(vaultPath, '.claude')).then(() => true).catch(() => false);
    expect(claudeDirExists).toBe(true);

    // settings.json should be untouched
    const settingsContent = await fs.readFile(path.join(vaultPath, '.claude', 'settings.json'), 'utf-8');
    expect(settingsContent).toBe('{}');
  });

  it('should no-op when no legacy policies exist', async () => {
    // No .claude/policies/ at all
    await migratePoliciesIfNeeded(vaultPath);

    // Should not create .flywheel/policies/ unnecessarily
    const newDir = getPoliciesDir(vaultPath);
    const exists = await fs.access(newDir).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });
});
