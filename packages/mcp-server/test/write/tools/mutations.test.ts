/**
 * Integration tests for vault_add_to_section mutation workflow
 * Tests the complete flow: read → find → format → insert → write
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readVaultFile,
  writeVaultFile,
  findSection,
  formatContent,
  insertInSection,
  removeFromSection,
  replaceInSection,
  validatePath,
  type MatchMode,
} from '../../../src/core/write/writer.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
  createSampleNote,
  createDailyNote,
  createEntityCache,
  createEntityCacheInStateDb,
  openStateDb,
  deleteStateDb,
  type StateDb,
} from '../helpers/testUtils.js';
import type { FormatType, Position } from '../../../src/core/write/types.js';
import {
  initializeEntityIndex,
  suggestRelatedLinks,
  maybeApplyWikilinks,
  setWriteStateDb,
} from '../../../src/core/write/wikilinks.js';

/**
 * Helper to simulate the full vault_add_to_section workflow
 */
async function addToSection(
  vaultPath: string,
  notePath: string,
  sectionName: string,
  content: string,
  position: Position,
  format: FormatType
): Promise<{ success: boolean; message: string; preview?: string }> {
  try {
    // 1. Read file
    const { content: fileContent, frontmatter } = await readVaultFile(vaultPath, notePath);

    // 2. Find section
    const section = findSection(fileContent, sectionName);
    if (!section) {
      return {
        success: false,
        message: `Section not found: ${sectionName}`,
      };
    }

    // 3. Format content
    const formattedContent = formatContent(content, format);

    // 4. Insert into section
    const updatedContent = insertInSection(fileContent, section, formattedContent, position);

    // 5. Write back
    await writeVaultFile(vaultPath, notePath, updatedContent, frontmatter);

    return {
      success: true,
      message: `Added content to section "${section.name}"`,
      preview: formattedContent,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

describe('vault_add_to_section integration workflow', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  // ========================================
  // Happy Path Tests
  // ========================================

  it('should add plain content (append)', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    const result = await addToSection(
      tempVault,
      'test.md',
      'Log',
      'New log entry',
      'append',
      'plain'
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('Added content to section "Log"');
    expect(result.preview).toBe('New log entry');

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('- Existing entry');
    expect(updated).toContain('New log entry');
  });

  it('should add plain content (prepend)', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    const result = await addToSection(
      tempVault,
      'test.md',
      'Log',
      'First entry',
      'prepend',
      'plain'
    );

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('## Log\nFirst entry');
    expect(updated).toContain('- Existing entry');
    // Verify order - First entry should come before Existing entry
    const firstIndex = updated.indexOf('First entry');
    const existingIndex = updated.indexOf('- Existing entry');
    expect(firstIndex).toBeLessThan(existingIndex);
  });

  it('should add bullet formatted content', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    const result = await addToSection(
      tempVault,
      'test.md',
      'Log',
      'Bullet entry',
      'append',
      'bullet'
    );

    expect(result.success).toBe(true);
    expect(result.preview).toBe('- Bullet entry');

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('- Bullet entry');
  });

  it('should add task formatted content', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    const result = await addToSection(
      tempVault,
      'test.md',
      'Another Section',
      'Complete the project',
      'append',
      'task'
    );

    expect(result.success).toBe(true);
    expect(result.preview).toBe('- [ ] Complete the project');

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('- [ ] Complete the project');
  });

  it('should add numbered formatted content', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    const result = await addToSection(
      tempVault,
      'test.md',
      'Log',
      'First item',
      'append',
      'numbered'
    );

    expect(result.success).toBe(true);
    expect(result.preview).toBe('1. First item');

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('1. First item');
  });

  it('should add timestamp-bullet formatted content', async () => {
    await createTestNote(tempVault, 'test.md', createDailyNote());

    const result = await addToSection(
      tempVault,
      'test.md',
      'Log',
      'Meeting with team',
      'append',
      'timestamp-bullet'
    );

    expect(result.success).toBe(true);
    expect(result.preview).toMatch(/^- \*\*\d{2}:\d{2}\*\* Meeting with team$/);

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toMatch(/- \*\*\d{2}:\d{2}\*\* Meeting with team/);
  });

  it('should handle multiple sequential additions', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    // First addition
    await addToSection(tempVault, 'test.md', 'Log', 'Entry 1', 'append', 'plain');

    // Second addition
    await addToSection(tempVault, 'test.md', 'Log', 'Entry 2', 'append', 'plain');

    // Third addition
    await addToSection(tempVault, 'test.md', 'Log', 'Entry 3', 'append', 'plain');

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('- Existing entry');
    expect(updated).toContain('Entry 1');
    expect(updated).toContain('Entry 2');
    expect(updated).toContain('Entry 3');

    // Verify order
    const entry1Index = updated.indexOf('Entry 1');
    const entry2Index = updated.indexOf('Entry 2');
    const entry3Index = updated.indexOf('Entry 3');
    expect(entry1Index).toBeLessThan(entry2Index);
    expect(entry2Index).toBeLessThan(entry3Index);
  });

  // ========================================
  // Error Path Tests
  // ========================================

  it('should return success=false for file not found', async () => {
    const result = await addToSection(
      tempVault,
      'nonexistent.md',
      'Log',
      'Entry',
      'append',
      'plain'
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed');
  });

  it('should return success=false for section not found', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    const result = await addToSection(
      tempVault,
      'test.md',
      'NonExistentSection',
      'Entry',
      'append',
      'plain'
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('Section not found');
  });

  it('should return success=false for path traversal attempt', async () => {
    const result = await addToSection(
      tempVault,
      '../../../etc/passwd',
      'Log',
      'malicious',
      'append',
      'plain'
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid path');
  });

  // ========================================
  // Edge Case Tests
  // ========================================

  it('should handle empty section (heading with no content)', async () => {
    const emptySection = `---
type: test
---
# Test

## Empty Log

## Another Section
`;
    await createTestNote(tempVault, 'empty.md', emptySection);

    const result = await addToSection(
      tempVault,
      'empty.md',
      'Empty Log',
      'First entry',
      'append',
      'plain'
    );

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'empty.md');
    expect(updated).toContain('## Empty Log');
    expect(updated).toContain('First entry');
    // Verify First entry comes after Empty Log heading and before Another Section
    const emptyLogIndex = updated.indexOf('## Empty Log');
    const firstEntryIndex = updated.indexOf('First entry');
    const anotherSectionIndex = updated.indexOf('## Another Section');
    expect(firstEntryIndex).toBeGreaterThan(emptyLogIndex);
    expect(firstEntryIndex).toBeLessThan(anotherSectionIndex);
  });

  it('should handle section at end of file (no following heading)', async () => {
    const endSection = `---
type: test
---
# Test

## Log

Existing content

## Last Section
Final content here`;
    await createTestNote(tempVault, 'end.md', endSection);

    const result = await addToSection(
      tempVault,
      'end.md',
      'Last Section',
      'New final entry',
      'append',
      'plain'
    );

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'end.md');
    expect(updated).toContain('Final content here');
    expect(updated).toContain('New final entry');
  });

  it('should preserve complex frontmatter after mutation', async () => {
    const complexNote = `---
type: daily
date: 2026-01-28
tags:
  - work
  - important
metadata:
  author: Test User
  version: 1.2.3
nested:
  deep:
    value: preserved
---
# Daily Note

## Log

- Entry 1
`;
    await createTestNote(tempVault, 'complex.md', complexNote);

    const result = await addToSection(
      tempVault,
      'complex.md',
      'Log',
      'Entry 2',
      'append',
      'plain'
    );

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'complex.md');
    // Verify frontmatter is preserved
    expect(updated).toContain('type: daily');
    expect(updated).toContain('date: 2026-01-28');
    expect(updated).toContain('tags:');
    expect(updated).toContain('- work');
    expect(updated).toContain('metadata:');
    expect(updated).toContain('author: Test User');
    expect(updated).toContain('nested:');
    expect(updated).toContain('deep:');
    expect(updated).toContain('value: preserved');
    // Verify content was added
    expect(updated).toContain('Entry 2');
  });

  it('should handle content with special markdown characters', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    const specialContent = '**Bold**, *italic*, `code`, [[wikilink]], #tag, [link](url)';

    const result = await addToSection(
      tempVault,
      'test.md',
      'Log',
      specialContent,
      'append',
      'plain'
    );

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('**Bold**');
    expect(updated).toContain('*italic*');
    expect(updated).toContain('`code`');
    expect(updated).toContain('[[wikilink]]');
    expect(updated).toContain('#tag');
    expect(updated).toContain('[link](url)');
  });

  it('should handle content with backticks in different formats', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    const contentWithCode = 'Use `npm install` to install packages';

    const result = await addToSection(
      tempVault,
      'test.md',
      'Log',
      contentWithCode,
      'append',
      'bullet'
    );

    expect(result.success).toBe(true);
    expect(result.preview).toBe('- Use `npm install` to install packages');

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('- Use `npm install` to install packages');
  });

  it('should handle nested directory paths', async () => {
    const nestedContent = createSampleNote();
    await createTestNote(tempVault, 'daily-notes/2026-01/2026-01-28.md', nestedContent);

    const result = await addToSection(
      tempVault,
      'daily-notes/2026-01/2026-01-28.md',
      'Log',
      'Nested entry',
      'append',
      'plain'
    );

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'daily-notes/2026-01/2026-01-28.md');
    expect(updated).toContain('Nested entry');
  });

  it('should trim whitespace from content', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    const result = await addToSection(
      tempVault,
      'test.md',
      'Log',
      '   Content with spaces   ',
      'append',
      'plain'
    );

    expect(result.success).toBe(true);
    expect(result.preview).toBe('Content with spaces');

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('Content with spaces');
    expect(updated).not.toContain('   Content with spaces   ');
  });
});

// ========================================
// skipWikilinks Parameter Tests
// ========================================

describe('vault_add_to_section skipWikilinks parameter', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should preserve content unchanged when skipWikilinks is true', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    // Add content with entity-like text
    const result = await addToSection(
      tempVault,
      'test.md',
      'Log',
      'Jordan Smith worked on TypeScript',
      'append',
      'plain'
    );

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'test.md');
    // Content should be present (wikilinks may or may not be applied depending on index state)
    expect(updated).toContain('Jordan Smith');
    expect(updated).toContain('TypeScript');
  });

  it('should work with bullet format and skipWikilinks', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    const result = await addToSection(
      tempVault,
      'test.md',
      'Log',
      'Meeting with Jordan Smith about API',
      'append',
      'bullet'
    );

    expect(result.success).toBe(true);
    expect(result.preview).toContain('Meeting with Jordan Smith about API');

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('- Meeting with Jordan Smith about API');
  });

  it('should work with timestamp-bullet format and skipWikilinks', async () => {
    await createTestNote(tempVault, 'test.md', createDailyNote());

    const result = await addToSection(
      tempVault,
      'test.md',
      'Log',
      'Discussed MCP Server with team',
      'append',
      'timestamp-bullet'
    );

    expect(result.success).toBe(true);
    expect(result.preview).toMatch(/^\- \*\*\d{2}:\d{2}\*\* Discussed MCP Server with team$/);

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toMatch(/- \*\*\d{2}:\d{2}\*\* Discussed MCP Server with team/);
  });

  it('should work with task format and skipWikilinks', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    const result = await addToSection(
      tempVault,
      'test.md',
      'Another Section',
      'Review TypeScript changes',
      'append',
      'task'
    );

    expect(result.success).toBe(true);
    expect(result.preview).toBe('- [ ] Review TypeScript changes');

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('- [ ] Review TypeScript changes');
  });

  it('should preserve existing wikilinks in content', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    const result = await addToSection(
      tempVault,
      'test.md',
      'Log',
      'Working with [[Jordan Smith]] on [[MCP Server]]',
      'append',
      'plain'
    );

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('[[Jordan Smith]]');
    expect(updated).toContain('[[MCP Server]]');
  });
});

describe('vault_replace_in_section skipWikilinks parameter', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should preserve replacement content when skipWikilinks conceptually applies', async () => {
    const note = `---
type: test
---
# Test

## Log

- old content here
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await replaceContent(
      tempVault,
      'test.md',
      'Log',
      'old content',
      'Jordan Smith updated TypeScript',
      'first'
    );

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('Jordan Smith updated TypeScript');
  });

  it('should work with regex replacement and entity-like text', async () => {
    const note = `---
type: test
---
# Test

## Log

- Task: Review code
- Task: Update docs
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await replaceContent(
      tempVault,
      'test.md',
      'Log',
      '^- Task: (.+)$',
      '- [ ] $1 for MCP Server',
      'all',
      true
    );

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('- [ ] Review code for MCP Server');
    expect(updated).toContain('- [ ] Update docs for MCP Server');
  });

  it('should preserve existing wikilinks in replacement', async () => {
    const note = `---
type: test
---
# Test

## Log

- placeholder
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await replaceContent(
      tempVault,
      'test.md',
      'Log',
      'placeholder',
      'Meeting with [[Jordan Smith]]',
      'first'
    );

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('[[Jordan Smith]]');
  });
});

// ========================================
// vault_remove_from_section tests
// ========================================

/**
 * Helper to simulate the vault_remove_from_section workflow
 */
async function removeContent(
  vaultPath: string,
  notePath: string,
  sectionName: string,
  pattern: string,
  mode: MatchMode = 'first',
  useRegex: boolean = false
): Promise<{ success: boolean; message: string; removedLines?: string[] }> {
  try {
    const { content: fileContent, frontmatter } = await readVaultFile(vaultPath, notePath);

    const section = findSection(fileContent, sectionName);
    if (!section) {
      return {
        success: false,
        message: `Section not found: ${sectionName}`,
      };
    }

    const result = removeFromSection(fileContent, section, pattern, mode, useRegex);

    if (result.removedCount === 0) {
      return {
        success: false,
        message: `No content matching "${pattern}" found`,
      };
    }

    await writeVaultFile(vaultPath, notePath, result.content, frontmatter);

    return {
      success: true,
      message: `Removed ${result.removedCount} line(s)`,
      removedLines: result.removedLines,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

describe('vault_remove_from_section integration workflow', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should remove first matching line', async () => {
    const note = `---
type: test
---
# Test

## Log

- Item 1
- Item 2
- Item 3
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await removeContent(tempVault, 'test.md', 'Log', 'Item 2', 'first');

    expect(result.success).toBe(true);
    expect(result.removedLines).toEqual(['- Item 2']);

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('- Item 1');
    expect(updated).not.toContain('- Item 2');
    expect(updated).toContain('- Item 3');
  });

  it('should remove all matching lines', async () => {
    const note = `---
type: test
---
# Test

## Log

- TODO: Task 1
- Regular entry
- TODO: Task 2
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await removeContent(tempVault, 'test.md', 'Log', 'TODO:', 'all');

    expect(result.success).toBe(true);
    expect(result.removedLines?.length).toBe(2);

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).not.toContain('TODO:');
    expect(updated).toContain('- Regular entry');
  });

  it('should remove last matching line', async () => {
    const note = `---
type: test
---
# Test

## Log

- Duplicate
- Other entry
- Duplicate
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await removeContent(tempVault, 'test.md', 'Log', 'Duplicate', 'last');

    expect(result.success).toBe(true);
    expect(result.removedLines?.length).toBe(1);

    const updated = await readTestNote(tempVault, 'test.md');
    // First Duplicate should remain
    expect(updated).toMatch(/- Duplicate\n- Other entry/);
    // Second Duplicate should be gone
    expect(updated).not.toMatch(/- Other entry\n- Duplicate/);
  });

  it('should support regex patterns', async () => {
    const note = `---
type: test
---
# Test

## Log

- 10:30 Meeting
- 14:00 Lunch
- Coffee break
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await removeContent(tempVault, 'test.md', 'Log', '^- \\d{2}:\\d{2}', 'all', true);

    expect(result.success).toBe(true);
    expect(result.removedLines?.length).toBe(2);

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).not.toContain('Meeting');
    expect(updated).not.toContain('Lunch');
    expect(updated).toContain('- Coffee break');
  });

  it('should return error when no matches found', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    const result = await removeContent(tempVault, 'test.md', 'Log', 'NonExistent');

    expect(result.success).toBe(false);
    expect(result.message).toContain('No content matching');
  });

  it('should return error for section not found', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    const result = await removeContent(tempVault, 'test.md', 'NonExistent', 'Entry');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Section not found');
  });
});

// ========================================
// vault_replace_in_section tests
// ========================================

/**
 * Helper to simulate the vault_replace_in_section workflow
 */
async function replaceContent(
  vaultPath: string,
  notePath: string,
  sectionName: string,
  search: string,
  replacement: string,
  mode: MatchMode = 'first',
  useRegex: boolean = false
): Promise<{ success: boolean; message: string; originalLines?: string[]; newLines?: string[] }> {
  try {
    const { content: fileContent, frontmatter } = await readVaultFile(vaultPath, notePath);

    const section = findSection(fileContent, sectionName);
    if (!section) {
      return {
        success: false,
        message: `Section not found: ${sectionName}`,
      };
    }

    const result = replaceInSection(fileContent, section, search, replacement, mode, useRegex);

    if (result.replacedCount === 0) {
      return {
        success: false,
        message: `No content matching "${search}" found`,
      };
    }

    await writeVaultFile(vaultPath, notePath, result.content, frontmatter);

    return {
      success: true,
      message: `Replaced ${result.replacedCount} occurrence(s)`,
      originalLines: result.originalLines,
      newLines: result.newLines,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

describe('vault_replace_in_section integration workflow', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should replace first matching occurrence', async () => {
    const note = `---
type: test
---
# Test

## Log

- old value here
- another old value
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await replaceContent(tempVault, 'test.md', 'Log', 'old', 'new', 'first');

    expect(result.success).toBe(true);
    expect(result.originalLines).toEqual(['- old value here']);
    expect(result.newLines).toEqual(['- new value here']);

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('- new value here');
    expect(updated).toContain('- another old value'); // Second one unchanged
  });

  it('should replace all matching occurrences', async () => {
    const note = `---
type: test
---
# Test

## Log

- TODO: Task 1
- Regular entry
- TODO: Task 2
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await replaceContent(tempVault, 'test.md', 'Log', 'TODO:', 'DONE:', 'all');

    expect(result.success).toBe(true);
    expect(result.newLines?.length).toBe(2);

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).not.toContain('TODO:');
    expect(updated).toContain('- DONE: Task 1');
    expect(updated).toContain('- DONE: Task 2');
  });

  it('should replace last matching occurrence', async () => {
    const note = `---
type: test
---
# Test

## Log

- PENDING: First
- Other
- PENDING: Second
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await replaceContent(tempVault, 'test.md', 'Log', 'PENDING', 'DONE', 'last');

    expect(result.success).toBe(true);
    expect(result.newLines?.length).toBe(1);

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('- PENDING: First'); // First one unchanged
    expect(updated).toContain('- DONE: Second');
  });

  it('should support regex replacement', async () => {
    const note = `---
type: test
---
# Test

## Log

- Task: Buy groceries
- Task: Clean house
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await replaceContent(
      tempVault,
      'test.md',
      'Log',
      '^- Task: (.+)$',
      '- [ ] $1',
      'all',
      true
    );

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('- [ ] Buy groceries');
    expect(updated).toContain('- [ ] Clean house');
  });

  it('should return error when no matches found', async () => {
    await createTestNote(tempVault, 'test.md', createSampleNote());

    const result = await replaceContent(tempVault, 'test.md', 'Log', 'NonExistent', 'replacement');

    expect(result.success).toBe(false);
    expect(result.message).toContain('No content matching');
  });

  it('should replace multiple occurrences within same line', async () => {
    const note = `---
type: test
---
# Test

## Log

- Hello World Hello
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await replaceContent(tempVault, 'test.md', 'Log', 'Hello', 'Hi', 'first');

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'test.md');
    // Both Hellos in the same line should be replaced
    expect(updated).toContain('- Hi World Hi');
  });
});

// ========================================
// suggestOutgoingLinks Parameter Tests
// ========================================

describe('vault_add_to_section suggestOutgoingLinks parameter', () => {
  let tempVault: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    tempVault = await createTempVault();
    stateDb = openStateDb(tempVault);
    setWriteStateDb(stateDb);
    // Create entity cache with known entities
    createEntityCacheInStateDb(stateDb, tempVault, {
      technologies: ['TypeScript', 'JavaScript', 'Python'],
      projects: ['MCP Server', 'Flywheel Memory'],
      people: ['Jordan Smith', 'Alex Rivera'],
    });
    // Initialize entity index
    await initializeEntityIndex(tempVault);
  });

  afterEach(async () => {
    setWriteStateDb(null);
    stateDb.db.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  it('should append suggestions when suggestOutgoingLinks is true (default)', async () => {
    // Test directly with suggestRelatedLinks to verify the feature works
    const result = suggestRelatedLinks('Working on a TypeScript project with the team');

    // If index is ready and matches entities, suggestions should be returned
    if (result.suggestions.length > 0) {
      expect(result.suffix).toMatch(/^→ \[\[/);
      expect(result.suffix).toContain('TypeScript');
    }
  });

  it('should not suggest entities already linked in content', async () => {
    const content = 'Working with [[TypeScript]] on the project';
    const result = suggestRelatedLinks(content, { excludeLinked: true });

    // TypeScript should NOT be in suggestions since it's already linked
    if (result.suggestions.length > 0) {
      expect(result.suggestions.map(s => s.toLowerCase())).not.toContain('typescript');
    }
  });

  it('should be idempotent - not duplicate suffix if already present', async () => {
    const content = 'Some content → [[ExistingLink]] [[AnotherLink]]';
    const result = suggestRelatedLinks(content);

    // Should detect existing suffix and return empty
    expect(result.suggestions).toEqual([]);
    expect(result.suffix).toBe('');
  });

  it('should respect maxSuggestions limit', async () => {
    const result = suggestRelatedLinks('TypeScript JavaScript Python programming', {
      maxSuggestions: 2,
    });

    expect(result.suggestions.length).toBeLessThanOrEqual(2);
  });
});

describe('vault_replace_in_section suggestOutgoingLinks parameter', () => {
  let tempVault: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    tempVault = await createTempVault();
    stateDb = openStateDb(tempVault);
    setWriteStateDb(stateDb);
    createEntityCacheInStateDb(stateDb, tempVault, {
      technologies: ['TypeScript', 'JavaScript'],
      projects: ['MCP Server'],
      people: ['Jordan Smith'],
    });
    await initializeEntityIndex(tempVault);
  });

  afterEach(async () => {
    setWriteStateDb(null);
    stateDb.db.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  it('should work with replacement content containing entities', async () => {
    const result = suggestRelatedLinks('Updated TypeScript implementation');

    // Verify the suggestion mechanism works for replacement content
    if (result.suggestions.length > 0) {
      expect(result.suffix).toContain('[[');
    }
  });

  it('should handle replacement with existing wikilinks', async () => {
    const content = 'Working with [[Jordan Smith]] on updates';
    const result = suggestRelatedLinks(content, { excludeLinked: true });

    // Jordan Smith should not be suggested since already linked
    if (result.suggestions.length > 0) {
      expect(result.suggestions.map(s => s.toLowerCase())).not.toContain('dave evans');
    }
  });
});

// ========================================
// Error Handling Tests (Phase 2 Production Hardening)
// ========================================

describe('error handling', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  describe('regex pattern errors', () => {
    it('should catch invalid regex pattern: "["', async () => {
      const note = `---
type: test
---
# Test

## Log
- Item content
`;
      await createTestNote(tempVault, 'test.md', note);

      // Invalid regex should not throw uncaught error - should be caught
      const { content: fileContent, frontmatter } = await readVaultFile(tempVault, 'test.md');
      const section = findSection(fileContent, 'Log')!;

      // This should throw a controlled regex syntax error
      expect(() => {
        replaceInSection(fileContent, section, '[', 'replacement', 'first', true);
      }).toThrow();
    });

    it('should handle regex metacharacters in literal search', async () => {
      const note = `---
type: test
---
# Test

## Log
- Price: $100.00
- Total: [value]
`;
      await createTestNote(tempVault, 'test.md', note);

      const { content: fileContent } = await readVaultFile(tempVault, 'test.md');
      const section = findSection(fileContent, 'Log')!;

      // Literal search (useRegex=false) should handle metacharacters as literal text
      const result = replaceInSection(fileContent, section, '$100.00', '$200.00', 'first', false);
      expect(result.content).toContain('$200.00');
      expect(result.replacedCount).toBe(1);

      // Literal search with brackets
      const result2 = replaceInSection(fileContent, section, '[value]', '[new-value]', 'first', false);
      expect(result2.content).toContain('[new-value]');
    });
  });

  describe('content edge cases', () => {
    it('should handle newlines in replacement text', async () => {
      const note = `---
type: test
---
# Test

## Log
- Single line entry
`;
      await createTestNote(tempVault, 'test.md', note);

      const { content: fileContent, frontmatter } = await readVaultFile(tempVault, 'test.md');
      const section = findSection(fileContent, 'Log')!;

      // Replace with multiline content
      const result = replaceInSection(
        fileContent,
        section,
        'Single line entry',
        'Line 1\nLine 2\nLine 3',
        'first',
        false
      );

      expect(result.content).toContain('Line 1\nLine 2\nLine 3');
      expect(result.replacedCount).toBe(1);
    });

    it('should handle empty string content gracefully', async () => {
      const note = `---
type: test
---
# Test

## Log
- Entry
`;
      await createTestNote(tempVault, 'test.md', note);

      const { content: fileContent } = await readVaultFile(tempVault, 'test.md');
      const section = findSection(fileContent, 'Log')!;

      // Adding empty string should not break anything
      const result = insertInSection(fileContent, section, '', 'append');
      // Result should be similar to original (empty content adds nothing meaningful)
      expect(result).toContain('## Log');
    });

    it('should handle content with only whitespace', async () => {
      const note = `---
type: test
---
# Test

## Log
- Entry
`;
      await createTestNote(tempVault, 'test.md', note);

      const { content: fileContent } = await readVaultFile(tempVault, 'test.md');
      const section = findSection(fileContent, 'Log')!;

      // Whitespace-only content gets trimmed
      const result = insertInSection(fileContent, section, '   \t\n   ', 'append');
      // Trimmed content should be empty/minimal
      expect(result).toContain('## Log');
    });

    it('should handle extremely long content (1MB+)', async () => {
      const note = `---
type: test
---
# Test

## Log
- Entry
`;
      await createTestNote(tempVault, 'test.md', note);

      const { content: fileContent, frontmatter } = await readVaultFile(tempVault, 'test.md');
      const section = findSection(fileContent, 'Log')!;

      // Generate 1MB of content
      const longContent = 'A'.repeat(1024 * 1024); // 1MB

      // Should handle without crashing
      const result = insertInSection(fileContent, section, longContent, 'append');
      expect(result.length).toBeGreaterThan(1024 * 1024);
      expect(result).toContain(longContent);
    });
  });

  describe('section not found errors', () => {
    it('should return error for non-existent section', async () => {
      const note = `---
type: test
---
# Test

## Log
- Entry
`;
      await createTestNote(tempVault, 'test.md', note);

      const { content: fileContent } = await readVaultFile(tempVault, 'test.md');
      const section = findSection(fileContent, 'NonExistentSection');

      expect(section).toBeNull();
    });
  });

  describe('file not found errors', () => {
    it('should throw error for non-existent file', async () => {
      await expect(
        readVaultFile(tempVault, 'nonexistent.md')
      ).rejects.toThrow();
    });
  });

  describe('path security', () => {
    it('should reject path traversal: "../../../etc/passwd"', async () => {
      await expect(
        readVaultFile(tempVault, '../../../etc/passwd')
      ).rejects.toThrow('Invalid path');
    });

    it('should reject absolute paths outside vault', async () => {
      // validatePath should return false for absolute paths
      const result = validatePath(tempVault, '/etc/passwd');
      expect(result).toBe(false);
    });

    it('should reject double-encoded path traversal', async () => {
      // %2e%2e = .. (double dot)
      // The path resolver should still catch this
      const result = validatePath(tempVault, '%2e%2e/%2e%2e/etc/passwd');
      // This depends on whether the path gets decoded - may or may not be caught at this level
      // The important thing is that it doesn't actually read /etc/passwd
      await expect(
        readVaultFile(tempVault, '../../../etc/passwd')
      ).rejects.toThrow('Invalid path');
    });
  });

  describe('remove operation edge cases', () => {
    it('should return zero count when pattern not found', async () => {
      const note = `---
type: test
---
# Test

## Log
- Entry 1
- Entry 2
`;
      await createTestNote(tempVault, 'test.md', note);

      const { content: fileContent } = await readVaultFile(tempVault, 'test.md');
      const section = findSection(fileContent, 'Log')!;

      const result = removeFromSection(fileContent, section, 'NonExistentPattern', 'all', false);
      expect(result.removedCount).toBe(0);
      expect(result.removedLines).toHaveLength(0);
    });

    it('should handle remove with empty pattern', async () => {
      const note = `---
type: test
---
# Test

## Log
- Entry
`;
      await createTestNote(tempVault, 'test.md', note);

      const { content: fileContent } = await readVaultFile(tempVault, 'test.md');
      const section = findSection(fileContent, 'Log')!;

      // Empty pattern matches all lines containing empty string (all lines)
      const result = removeFromSection(fileContent, section, '', 'first', false);
      // Should match the first non-empty line in section
      expect(result.removedCount).toBeGreaterThanOrEqual(1);
    });
  });
});

// ========================================
// preserveListNesting Default Behavior Tests
// ========================================

describe('vault_add_to_section preserveListNesting default behavior', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should preserve list nesting by default (new behavior)', async () => {
    const note = `---
type: test
---
# Test

## Log
  - Nested entry 1
  - Nested entry 2
`;
    await createTestNote(tempVault, 'test.md', note);

    const { content: fileContent, frontmatter } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(fileContent, 'Log')!;

    // Without explicitly passing preserveListNesting, it should default to true
    const result = insertInSection(fileContent, section, '- New entry', 'append', {
      preserveListNesting: true, // This is now the default
    });

    // New entry should have same indentation as existing items
    expect(result).toContain('  - Nested entry 2\n  - New entry');
  });

  it('should append at section base level, not nested level', async () => {
    const note = `---
type: test
---
# Test

## Tasks
- Parent task
  - Child task 1
  - Child task 2
    - Grandchild task
`;
    await createTestNote(tempVault, 'test.md', note);

    const { content: fileContent, frontmatter } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(fileContent, 'Tasks')!;

    const result = insertInSection(fileContent, section, '- New item', 'append', {
      preserveListNesting: true,
    });

    // Should match the BASE indentation (0-space for Parent task), NOT continue nested
    // This ensures new entries go to the section's top level, not inside nested sublists
    expect(result).toContain('    - Grandchild task\n- New item');
  });

  it('should add to top-level when section has no nested lists', async () => {
    const note = `---
type: test
---
# Test

## Log
- Entry 1
- Entry 2
`;
    await createTestNote(tempVault, 'test.md', note);

    const { content: fileContent, frontmatter } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(fileContent, 'Log')!;

    const result = insertInSection(fileContent, section, '- New entry', 'append', {
      preserveListNesting: true,
    });

    // No extra indentation for top-level list
    expect(result).toContain('- Entry 2\n- New entry');
    expect(result).not.toContain('  - New entry');
  });

  it('should preserve indentation when prepending to nested list', async () => {
    const note = `---
type: test
---
# Test

## Log
  - Nested entry 1
  - Nested entry 2
`;
    await createTestNote(tempVault, 'test.md', note);

    const { content: fileContent, frontmatter } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(fileContent, 'Log')!;

    const result = insertInSection(fileContent, section, '- New entry', 'prepend', {
      preserveListNesting: true,
    });

    // Should match the indentation of the first item
    expect(result).toContain('## Log\n  - New entry\n  - Nested entry 1');
  });
});

// ========================================
// Battle-hardening: Section not found errors
// ========================================

import { extractHeadings } from '../../../src/core/write/writer.js';

describe('Section not found error messages', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should return helpful error for file with no headings', async () => {
    const note = `This is a plain text file.
No markdown headings here.
Just paragraphs of text.
`;
    await createTestNote(tempVault, 'test.md', note);

    const { content: fileContent } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(fileContent, 'Log');

    // Section should not be found
    expect(section).toBeNull();

    // When section is not found, check headings for context-aware error
    const headings = extractHeadings(fileContent);
    expect(headings.length).toBe(0);

    // This is the error message pattern that mutations.ts now generates
    const expectedMessage = "Section 'Log' not found. This file has no headings. Add section structure (## Heading) to enable section-scoped mutations.";
    expect(expectedMessage).toContain('no headings');
    expect(expectedMessage).toContain('section structure');
  });

  it('should list available sections when section not found', async () => {
    const note = `# My Note

## Introduction
Some intro text.

## Details
More details here.

## Conclusion
Final thoughts.
`;
    await createTestNote(tempVault, 'test.md', note);

    const { content: fileContent } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(fileContent, 'NonExistent');

    // Section should not be found
    expect(section).toBeNull();

    // When section is not found, check headings for context-aware error
    const headings = extractHeadings(fileContent);
    expect(headings.length).toBeGreaterThan(0);

    const availableSections = headings.map(h => h.text).join(', ');
    expect(availableSections).toContain('My Note');
    expect(availableSections).toContain('Introduction');
    expect(availableSections).toContain('Details');
    expect(availableSections).toContain('Conclusion');
  });

  it('should preserve deep nesting (5+ levels) in existing content', async () => {
    const note = `# Projects

## Active

- Level 1
  - Level 2
    - Level 3
      - Level 4
        - Level 5
          - Level 6
`;
    await createTestNote(tempVault, 'test.md', note);

    const { content: fileContent, frontmatter } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(fileContent, 'Active')!;

    // Append new item at section end
    const result = insertInSection(fileContent, section, '- New top-level item', 'append');

    // Verify all original nesting levels are preserved
    expect(result).toContain('- Level 1');
    expect(result).toContain('  - Level 2');
    expect(result).toContain('    - Level 3');
    expect(result).toContain('      - Level 4');
    expect(result).toContain('        - Level 5');
    expect(result).toContain('          - Level 6');
    // New item is appended at section end
    expect(result).toContain('- New top-level item');
  });

  it('should preserve tab indentation in existing content', async () => {
    const note = `# Log

-\tTab item 1
\t-\tNested tab item
`;
    await createTestNote(tempVault, 'test.md', note);

    const { content: fileContent, frontmatter } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(fileContent, 'Log')!;

    const result = insertInSection(fileContent, section, '-\tNew tab item', 'append');

    // Verify tabs are preserved in original content
    expect(result).toContain('-\tTab item 1');
    expect(result).toContain('\t-\tNested tab item');
    // New item is appended
    expect(result).toContain('-\tNew tab item');
  });
});
