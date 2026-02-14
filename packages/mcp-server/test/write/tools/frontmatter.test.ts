/**
 * Integration tests for frontmatter mutation tools
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readVaultFile,
  writeVaultFile,
} from '../../../src/core/write/writer.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
  createSampleNote,
} from '../helpers/testUtils.js';

/**
 * Helper to simulate vault_update_frontmatter workflow
 */
async function updateFrontmatter(
  vaultPath: string,
  notePath: string,
  updates: Record<string, unknown>
): Promise<{ success: boolean; message: string; preview?: string }> {
  try {
    const { content, frontmatter } = await readVaultFile(vaultPath, notePath);
    const updatedFrontmatter = { ...frontmatter, ...updates };
    await writeVaultFile(vaultPath, notePath, content, updatedFrontmatter);

    const updatedKeys = Object.keys(updates);
    const preview = updatedKeys.map(k => `${k}: ${JSON.stringify(updates[k])}`).join('\n');

    return {
      success: true,
      message: `Updated ${updatedKeys.length} frontmatter field(s) in ${notePath}`,
      preview,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Helper to simulate vault_add_frontmatter_field workflow
 */
async function addFrontmatterField(
  vaultPath: string,
  notePath: string,
  key: string,
  value: unknown
): Promise<{ success: boolean; message: string; preview?: string }> {
  try {
    const { content, frontmatter } = await readVaultFile(vaultPath, notePath);

    if (key in frontmatter) {
      return {
        success: false,
        message: `Field "${key}" already exists. Use vault_update_frontmatter to modify existing fields.`,
      };
    }

    const updatedFrontmatter = { ...frontmatter, [key]: value };
    await writeVaultFile(vaultPath, notePath, content, updatedFrontmatter);

    return {
      success: true,
      message: `Added frontmatter field "${key}" to ${notePath}`,
      preview: `${key}: ${JSON.stringify(value)}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

describe('vault_update_frontmatter workflow', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should update existing frontmatter field', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    const result = await updateFrontmatter(tempVault, 'test.md', {
      type: 'updated',
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('Updated 1 frontmatter');

    const updated = await readVaultFile(tempVault, 'test.md');
    expect(updated.frontmatter.type).toBe('updated');
  });

  it('should update multiple frontmatter fields', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    const result = await updateFrontmatter(tempVault, 'test.md', {
      type: 'updated',
      status: 'active',
      version: 2,
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('Updated 3 frontmatter');

    const updated = await readVaultFile(tempVault, 'test.md');
    expect(updated.frontmatter.type).toBe('updated');
    expect(updated.frontmatter.status).toBe('active');
    expect(updated.frontmatter.version).toBe(2);
  });

  it('should add new frontmatter field via update', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    const result = await updateFrontmatter(tempVault, 'test.md', {
      newField: 'newValue',
    });

    expect(result.success).toBe(true);

    const updated = await readVaultFile(tempVault, 'test.md');
    expect(updated.frontmatter.newField).toBe('newValue');
    // Existing fields should be preserved
    expect(updated.frontmatter.type).toBe('test');
  });

  it('should preserve existing frontmatter fields', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    const result = await updateFrontmatter(tempVault, 'test.md', {
      type: 'updated',
    });

    expect(result.success).toBe(true);

    const updated = await readVaultFile(tempVault, 'test.md');
    // Updated field
    expect(updated.frontmatter.type).toBe('updated');
    // Preserved fields
    expect(updated.frontmatter.tags).toBeDefined();
    expect(updated.frontmatter.nested).toBeDefined();
  });

  it('should preserve content when updating frontmatter', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    await updateFrontmatter(tempVault, 'test.md', {
      type: 'updated',
    });

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('# Test Note');
    expect(updated).toContain('## Log');
    expect(updated).toContain('- Existing entry');
  });

  it('should handle complex value types', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    const result = await updateFrontmatter(tempVault, 'test.md', {
      array: [1, 2, 3],
      nested: { deep: { value: 'test' } },
      boolean: true,
      number: 42,
    });

    expect(result.success).toBe(true);

    const updated = await readVaultFile(tempVault, 'test.md');
    expect(Array.isArray(updated.frontmatter.array)).toBe(true);
    expect((updated.frontmatter.nested as any).deep.value).toBe('test');
    expect(updated.frontmatter.boolean).toBe(true);
    expect(updated.frontmatter.number).toBe(42);
  });

  it('should return error for non-existent file', async () => {
    const result = await updateFrontmatter(tempVault, 'nonexistent.md', {
      type: 'test',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed');
  });
});

describe('vault_add_frontmatter_field workflow', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should add new frontmatter field', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    const result = await addFrontmatterField(tempVault, 'test.md', 'status', 'active');

    expect(result.success).toBe(true);
    expect(result.message).toContain('Added frontmatter field "status"');
    expect(result.preview).toContain('status: "active"');

    const updated = await readVaultFile(tempVault, 'test.md');
    expect(updated.frontmatter.status).toBe('active');
  });

  it('should reject adding field that already exists', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    // Try to add field that already exists (type: 'test')
    const result = await addFrontmatterField(tempVault, 'test.md', 'type', 'new-value');

    expect(result.success).toBe(false);
    expect(result.message).toContain('already exists');
    expect(result.message).toContain('vault_update_frontmatter');

    // Original value should be unchanged
    const unchanged = await readVaultFile(tempVault, 'test.md');
    expect(unchanged.frontmatter.type).toBe('test');
  });

  it('should preserve existing fields when adding new field', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    await addFrontmatterField(tempVault, 'test.md', 'newField', 'newValue');

    const updated = await readVaultFile(tempVault, 'test.md');
    // New field
    expect(updated.frontmatter.newField).toBe('newValue');
    // Existing fields preserved
    expect(updated.frontmatter.type).toBe('test');
    expect(updated.frontmatter.tags).toBeDefined();
  });

  it('should preserve content when adding field', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    await addFrontmatterField(tempVault, 'test.md', 'status', 'active');

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('# Test Note');
    expect(updated).toContain('## Log');
  });

  it('should handle complex value types', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    await addFrontmatterField(tempVault, 'test.md', 'metadata', {
      author: 'Test User',
      version: 1.2,
      active: true,
    });

    const updated = await readVaultFile(tempVault, 'test.md');
    expect(updated.frontmatter.metadata).toBeDefined();
    expect((updated.frontmatter.metadata as any).author).toBe('Test User');
    expect((updated.frontmatter.metadata as any).version).toBe(1.2);
    expect((updated.frontmatter.metadata as any).active).toBe(true);
  });

  it('should handle array values', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    await addFrontmatterField(tempVault, 'test.md', 'categories', ['work', 'project', 'active']);

    const updated = await readVaultFile(tempVault, 'test.md');
    expect(Array.isArray(updated.frontmatter.categories)).toBe(true);
    expect((updated.frontmatter.categories as string[]).length).toBe(3);
  });

  it('should return error for non-existent file', async () => {
    const result = await addFrontmatterField(tempVault, 'nonexistent.md', 'field', 'value');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed');
  });
});
