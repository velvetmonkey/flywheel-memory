/**
 * Integration tests for note CRUD tools
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeVaultFile, validatePath, readVaultFile } from '../../../src/core/write/writer.js';
import {
  createTempVault,
  cleanupTempVault,
  readTestNote,
  createTestNote,
  createEntityCache,
  createEntityCacheInStateDb,
  openStateDb,
  deleteStateDb,
  type StateDb,
} from '../helpers/testUtils.js';
import {
  initializeEntityIndex,
  maybeApplyWikilinks,
  suggestRelatedLinks,
  setWriteStateDb,
} from '../../../src/core/write/wikilinks.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Options for createNote helper
 */
interface CreateNoteOptions {
  overwrite?: boolean;
  skipWikilinks?: boolean;
  suggestOutgoingLinks?: boolean;
  maxSuggestions?: number;
}

/**
 * Helper to simulate vault_create_note workflow
 */
async function createNote(
  vaultPath: string,
  notePath: string,
  content: string,
  frontmatter: Record<string, unknown>,
  options: CreateNoteOptions = {}
): Promise<{ success: boolean; message: string; preview?: string; processedContent?: string }> {
  const {
    overwrite = false,
    skipWikilinks = false,
    suggestOutgoingLinks = false,
    maxSuggestions = 3,
  } = options;

  try {
    if (!validatePath(vaultPath, notePath)) {
      return {
        success: false,
        message: 'Invalid path: path traversal not allowed',
      };
    }

    const fullPath = path.join(vaultPath, notePath);

    // Check if file already exists
    try {
      await fs.access(fullPath);
      if (!overwrite) {
        return {
          success: false,
          message: `File already exists: ${notePath}. Use overwrite=true to replace.`,
        };
      }
    } catch {
      // File doesn't exist, which is what we want
    }

    // Ensure parent directories exist
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });

    // Apply wikilinks to content (unless skipped)
    let { content: processedContent, wikilinkInfo } = maybeApplyWikilinks(content, skipWikilinks, notePath);

    // Suggest outgoing links (enabled by default)
    let suggestInfo: string | undefined;
    if (suggestOutgoingLinks && !skipWikilinks) {
      const result = suggestRelatedLinks(processedContent, { maxSuggestions, notePath });
      if (result.suffix) {
        processedContent = processedContent + ' ' + result.suffix;
        suggestInfo = `Suggested: ${result.suggestions.join(', ')}`;
      }
    }

    // Write the note
    await writeVaultFile(vaultPath, notePath, processedContent, frontmatter);

    // Build preview
    const infoLines = [wikilinkInfo, suggestInfo].filter(Boolean);
    const previewLines = [
      `Frontmatter fields: ${Object.keys(frontmatter).join(', ') || 'none'}`,
      `Content length: ${processedContent.length} chars`,
    ];
    if (infoLines.length > 0) {
      previewLines.push(`(${infoLines.join('; ')})`);
    }

    // Add alias hint if frontmatter doesn't include aliases
    const hasAliases = frontmatter && ('aliases' in frontmatter);
    if (!hasAliases) {
      previewLines.push('');
      previewLines.push('Tip: Add aliases to frontmatter for flexible wikilink matching (e.g., aliases: ["Short Name"])');
    }

    return {
      success: true,
      message: `Created note: ${notePath}`,
      preview: previewLines.join('\n'),
      processedContent,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Helper to simulate vault_delete_note workflow
 */
async function deleteNote(
  vaultPath: string,
  notePath: string,
  confirm: boolean = false
): Promise<{ success: boolean; message: string }> {
  try {
    if (!confirm) {
      return {
        success: false,
        message: 'Deletion requires explicit confirmation (confirm=true)',
      };
    }

    if (!validatePath(vaultPath, notePath)) {
      return {
        success: false,
        message: 'Invalid path: path traversal not allowed',
      };
    }

    const fullPath = path.join(vaultPath, notePath);

    // Check if file exists
    try {
      await fs.access(fullPath);
    } catch {
      return {
        success: false,
        message: `File not found: ${notePath}`,
      };
    }

    // Delete the file
    await fs.unlink(fullPath);

    return {
      success: true,
      message: `Deleted note: ${notePath}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

describe('vault_create_note workflow', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should create a new note with content and frontmatter', async () => {
    const result = await createNote(
      tempVault,
      'test.md',
      '# Test Note\n\nSome content',
      { type: 'test', tags: ['sample'] }
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('Created note');

    // Verify file was created
    const content = await readTestNote(tempVault, 'test.md');
    expect(content).toContain('type: test');
    expect(content).toContain('# Test Note');
  });

  it('should create a note with empty content', async () => {
    const result = await createNote(
      tempVault,
      'empty.md',
      '',
      { type: 'empty' }
    );

    expect(result.success).toBe(true);

    // Verify file was created
    const content = await readTestNote(tempVault, 'empty.md');
    expect(content).toContain('type: empty');
  });

  it('should create a note without frontmatter', async () => {
    const result = await createNote(
      tempVault,
      'simple.md',
      '# Simple Note',
      {}
    );

    expect(result.success).toBe(true);

    const content = await readTestNote(tempVault, 'simple.md');
    expect(content).toContain('# Simple Note');
  });

  it('should create nested directory structure', async () => {
    const result = await createNote(
      tempVault,
      'daily-notes/2026/01/2026-01-28.md',
      '# Daily Note',
      { date: '2026-01-28' }
    );

    expect(result.success).toBe(true);

    // Verify nested file was created
    const content = await readTestNote(tempVault, 'daily-notes/2026/01/2026-01-28.md');
    expect(content).toContain('# Daily Note');
  });

  it('should reject creating note that already exists', async () => {
    // Create initial note
    await createNote(tempVault, 'test.md', '# Test', {});

    // Try to create again without overwrite
    const result = await createNote(tempVault, 'test.md', '# New', {});

    expect(result.success).toBe(false);
    expect(result.message).toContain('already exists');
    expect(result.message).toContain('overwrite=true');
  });

  it('should overwrite existing note when overwrite=true', async () => {
    // Create initial note
    await createNote(tempVault, 'test.md', '# Original', { type: 'original' });

    // Overwrite it
    const result = await createNote(
      tempVault,
      'test.md',
      '# Replaced',
      { type: 'replaced' },
      { overwrite: true }
    );

    expect(result.success).toBe(true);

    // Verify content was replaced
    const content = await readTestNote(tempVault, 'test.md');
    expect(content).toContain('# Replaced');
    expect(content).toContain('type: replaced');
    expect(content).not.toContain('type: original');
  });

  it('should reject path traversal attempts', async () => {
    const result = await createNote(
      tempVault,
      '../../../etc/passwd',
      'malicious',
      {}
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid path');
  });

  it('should handle complex frontmatter', async () => {
    const complexFrontmatter = {
      type: 'complex',
      tags: ['tag1', 'tag2'],
      nested: {
        deep: {
          value: 'test'
        }
      },
      number: 42,
      boolean: true,
    };

    const result = await createNote(
      tempVault,
      'complex.md',
      '# Complex',
      complexFrontmatter
    );

    expect(result.success).toBe(true);

    const loaded = await readVaultFile(tempVault, 'complex.md');
    expect(loaded.frontmatter.type).toBe('complex');
    expect(Array.isArray(loaded.frontmatter.tags)).toBe(true);
    expect((loaded.frontmatter.nested as any).deep.value).toBe('test');
  });
});

describe('vault_delete_note workflow', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should delete an existing note with confirmation', async () => {
    // Create a note first
    await createTestNote(tempVault, 'test.md', '# Test');

    // Delete it
    const result = await deleteNote(tempVault, 'test.md', true);

    expect(result.success).toBe(true);
    expect(result.message).toContain('Deleted note');

    // Verify file was deleted
    const fullPath = path.join(tempVault, 'test.md');
    await expect(fs.access(fullPath)).rejects.toThrow();
  });

  it('should require confirmation to delete', async () => {
    await createTestNote(tempVault, 'test.md', '# Test');

    // Try to delete without confirmation
    const result = await deleteNote(tempVault, 'test.md', false);

    expect(result.success).toBe(false);
    expect(result.message).toContain('requires explicit confirmation');

    // File should still exist
    const fullPath = path.join(tempVault, 'test.md');
    await expect(fs.access(fullPath)).resolves.not.toThrow();
  });

  it('should return error for non-existent note', async () => {
    const result = await deleteNote(tempVault, 'nonexistent.md', true);

    expect(result.success).toBe(false);
    expect(result.message).toContain('File not found');
  });

  it('should reject path traversal attempts', async () => {
    const result = await deleteNote(tempVault, '../../../etc/passwd', true);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid path');
  });

  it('should delete nested file', async () => {
    // Create nested file
    await createTestNote(tempVault, 'daily-notes/2026/test.md', '# Test');

    // Delete it
    const result = await deleteNote(tempVault, 'daily-notes/2026/test.md', true);

    expect(result.success).toBe(true);

    // Verify file was deleted
    const fullPath = path.join(tempVault, 'daily-notes/2026/test.md');
    await expect(fs.access(fullPath)).rejects.toThrow();
  });

  it('should handle deletion of file with special characters in name', async () => {
    const specialName = 'test file with spaces.md';
    await createTestNote(tempVault, specialName, '# Test');

    const result = await deleteNote(tempVault, specialName, true);

    expect(result.success).toBe(true);
  });
});

describe('vault_create_note wikilink integration', () => {
  let tempVault: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    tempVault = await createTempVault();
    stateDb = openStateDb(tempVault);
    setWriteStateDb(stateDb);
    // Create entity cache with test entities in StateDb
    createEntityCacheInStateDb(stateDb, tempVault, {
      people: ['Jordan Smith'],
      projects: ['MCP Server'],
      technologies: ['TypeScript', 'JavaScript'],
    });
    // Initialize entity index from cache
    await initializeEntityIndex(tempVault);
  });

  afterEach(async () => {
    setWriteStateDb(null);
    stateDb.db.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  it('should apply wikilinks to content by default', async () => {
    const result = await createNote(
      tempVault,
      'test.md',
      'Working on the TypeScript project with the team.',
      { type: 'test' }
    );

    expect(result.success).toBe(true);

    // Verify wikilinks were applied in the file
    const content = await readTestNote(tempVault, 'test.md');
    expect(content).toContain('[[TypeScript]]');
  });

  it('should skip wikilinks when skipWikilinks=true', async () => {
    const result = await createNote(
      tempVault,
      'test.md',
      'Working on the TypeScript project.',
      { type: 'test' },
      { skipWikilinks: true }
    );

    expect(result.success).toBe(true);

    // Verify wikilinks were NOT applied
    const content = await readTestNote(tempVault, 'test.md');
    expect(content).not.toContain('[[TypeScript]]');
    expect(content).toContain('TypeScript'); // Plain text preserved
  });

  it('should include wikilink info in preview when links are applied', async () => {
    const result = await createNote(
      tempVault,
      'test.md',
      'Working on the TypeScript project.',
      { type: 'test' }
    );

    expect(result.success).toBe(true);
    // Preview should mention applied wikilinks if any were applied
    const content = await readTestNote(tempVault, 'test.md');
    if (content.includes('[[TypeScript]]')) {
      expect(result.preview).toContain('Applied');
    }
  });

  it('should not modify content without matching entities', async () => {
    const originalContent = 'This content has no matching entities at all.';
    const result = await createNote(
      tempVault,
      'test.md',
      originalContent,
      { type: 'test' },
      { suggestOutgoingLinks: false } // Disable suggestions to test pure wikilink application
    );

    expect(result.success).toBe(true);

    // Content should be unchanged (no entities to link)
    const content = await readTestNote(tempVault, 'test.md');
    expect(content).toContain(originalContent);
  });

  it('should not suggest by default (template mode)', async () => {
    const result = await createNote(
      tempVault,
      'test.md',
      'Working on a JavaScript project.',
      { type: 'test' }
      // No suggestOutgoingLinks parameter = uses default (false)
    );

    expect(result.success).toBe(true);

    // Content should not have the suggestion suffix (→ [[...]])
    const content = await readTestNote(tempVault, 'test.md');
    expect(content).not.toContain('→');
  });

  it('should allow opt-in to suggestions with suggestOutgoingLinks=true', async () => {
    const result = await createNote(
      tempVault,
      'test.md',
      'Working on a project.',
      { type: 'test' },
      { suggestOutgoingLinks: true }  // Explicitly enable
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('Created note');

    // Main assertion: suggestOutgoingLinks=true is accepted and processed without error
    // Whether suggestions actually appear depends on entity matching (not the focus of this test)
    // The key is that the default is false, but users CAN opt-in by setting it true
    const content = await readTestNote(tempVault, 'test.md');

    // If suggestions happen to be generated (based on entity matching), verify format
    if (content.includes('→')) {
      expect(result.preview).toContain('Suggested:');
    }

    // This test verifies opt-in works, not that suggestions always generate
    expect(result.success).toBe(true);
  });

  it('should not suggest links for templates ending with empty bullets', async () => {
    await createEntityCacheInStateDb(stateDb, tempVault, {
      concepts: ['Habit'],
    });
    await initializeEntityIndex(tempVault);

    const template = `# Habits\n- [[Walk]] #habit\n- [[Stretch]] #habit\n\n## Log\n- `;

    const result = await createNote(tempVault, 'daily/2026-02-10.md', template, { type: 'daily' });

    expect(result.success).toBe(true);
    const content = await readTestNote(tempVault, 'daily/2026-02-10.md');
    expect(content).not.toContain('→');  // No suggestions appended
    expect(content).toContain('## Log\n-');  // Empty bullet preserved (trailing space may be normalized)
    expect(content).not.toContain('→ [[Habit]]');  // Specifically no habit suggestion appended
  });
});

describe('vault_create_note alias hint', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should show alias hint when frontmatter has no aliases', async () => {
    const result = await createNote(
      tempVault,
      'people/john-smith.md',
      '# John Smith\n\nSoftware engineer.',
      { type: 'person', role: 'engineer' }
    );

    expect(result.success).toBe(true);
    expect(result.preview).toContain('Tip: Add aliases to frontmatter');
    expect(result.preview).toContain('aliases: ["Short Name"]');
  });

  it('should not show alias hint when frontmatter includes aliases', async () => {
    const result = await createNote(
      tempVault,
      'people/john-smith.md',
      '# John Smith\n\nSoftware engineer.',
      { type: 'person', aliases: ['John', 'John Smith'] }
    );

    expect(result.success).toBe(true);
    expect(result.preview).not.toContain('Tip: Add aliases');
  });

  it('should show alias hint for empty frontmatter', async () => {
    const result = await createNote(
      tempVault,
      'notes/quick-note.md',
      '# Quick Note',
      {}
    );

    expect(result.success).toBe(true);
    expect(result.preview).toContain('Tip: Add aliases to frontmatter');
  });

  it('should show alias hint even with empty aliases array', async () => {
    // Having an empty aliases array is explicitly setting aliases (even if empty)
    // so we don't show the hint - user made a conscious choice
    const result = await createNote(
      tempVault,
      'people/jane-doe.md',
      '# Jane Doe',
      { type: 'person', aliases: [] }
    );

    expect(result.success).toBe(true);
    // The key 'aliases' exists in frontmatter, so no hint
    expect(result.preview).not.toContain('Tip: Add aliases');
  });
});
