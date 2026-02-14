/**
 * Battle-Hardening Tests: Sequential Mutations
 *
 * Tests consistency when multiple mutations are applied sequentially to the same section.
 * This addresses the bug where:
 * - Entry 1: 2-space indent
 * - Entry 2: 4-space indent
 * - Entry 3: 2-space indent
 *
 * Root cause: Each mutation independently detects indentation based on current section
 * state, which changes after each mutation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readVaultFile,
  writeVaultFile,
  findSection,
  insertInSection,
  formatContent,
  detectSectionBaseIndentation,
} from '../../../src/core/write/writer.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
} from '../helpers/testUtils.js';

describe('Battle-Hardening: Sequential Mutations', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  describe('consistent indentation across sequential appends', () => {
    it('should produce same indentation for 5 sequential appends to empty section', async () => {
      // Start with empty Log section
      const initialContent = `---
type: daily
---
# Daily Note

## Log

## Tasks
`;
      await createTestNote(tempVault, 'daily.md', initialContent);

      // Perform 5 sequential appends
      const entries = [
        'First entry',
        'Second entry',
        'Third entry',
        'Fourth entry',
        'Fifth entry',
      ];

      for (const entry of entries) {
        const { content: fileContent, frontmatter, lineEnding } = await readVaultFile(tempVault, 'daily.md');
        const section = findSection(fileContent, 'Log')!;
        const formatted = formatContent(entry, 'bullet');
        const updated = insertInSection(fileContent, section, formatted, 'append', {
          preserveListNesting: true,
        });
        await writeVaultFile(tempVault, 'daily.md', updated, frontmatter, lineEnding);
      }

      // Read final result
      const finalContent = await readTestNote(tempVault, 'daily.md');
      const lines = finalContent.split('\n');

      // Find all bullet lines in Log section
      const logStart = lines.findIndex(l => l.includes('## Log'));
      const tasksStart = lines.findIndex(l => l.includes('## Tasks'));
      const bulletLines = lines.slice(logStart + 1, tasksStart).filter(l => l.trim().startsWith('-'));

      expect(bulletLines.length).toBe(5);

      // All bullets should have the SAME indentation (none for empty section)
      const indentations = bulletLines.map(l => l.match(/^(\s*)/)?.[1] || '');
      const uniqueIndents = [...new Set(indentations)];

      expect(uniqueIndents.length).toBe(1);
      expect(uniqueIndents[0]).toBe(''); // Empty section defaults to no indentation
    });

    it('should produce same indentation for 5 sequential appends to populated section', async () => {
      // Start with section that has existing 2-space indented items
      const initialContent = `---
type: daily
---
# Daily Note

## Log

  - **09:00** Started work
  - **10:00** Had meeting

## Tasks
`;
      await createTestNote(tempVault, 'daily.md', initialContent);

      // Perform 5 sequential appends
      const entries = ['Entry 1', 'Entry 2', 'Entry 3', 'Entry 4', 'Entry 5'];

      for (const entry of entries) {
        const { content: fileContent, frontmatter, lineEnding } = await readVaultFile(tempVault, 'daily.md');
        const section = findSection(fileContent, 'Log')!;
        const formatted = formatContent(entry, 'bullet');
        const updated = insertInSection(fileContent, section, formatted, 'append', {
          preserveListNesting: true,
        });
        await writeVaultFile(tempVault, 'daily.md', updated, frontmatter, lineEnding);
      }

      // Read final result
      const finalContent = await readTestNote(tempVault, 'daily.md');
      const lines = finalContent.split('\n');

      // Find all bullet lines in Log section
      const logStart = lines.findIndex(l => l.includes('## Log'));
      const tasksStart = lines.findIndex(l => l.includes('## Tasks'));
      const bulletLines = lines.slice(logStart + 1, tasksStart).filter(l => l.trim().startsWith('-'));

      expect(bulletLines.length).toBe(7); // 2 original + 5 new

      // All bullets should have the SAME indentation (2 spaces)
      const indentations = bulletLines.map(l => l.match(/^(\s*)/)?.[1] || '');
      const uniqueIndents = [...new Set(indentations)];

      expect(uniqueIndents.length).toBe(1);
      expect(uniqueIndents[0]).toBe('  '); // Should match existing 2-space
    });

    it('should maintain consistent indentation with mixed format types', async () => {
      // Start with section that has existing items
      const initialContent = `---
type: daily
---
# Daily Note

## Log

- First item

## Tasks
`;
      await createTestNote(tempVault, 'daily.md', initialContent);

      // Perform appends with different format types
      const mutations: Array<{ content: string; format: 'bullet' | 'timestamp-bullet' | 'plain' }> = [
        { content: 'Bullet entry', format: 'bullet' },
        { content: 'Timestamp entry', format: 'timestamp-bullet' },
        { content: 'Another bullet', format: 'bullet' },
        { content: 'Plain text', format: 'plain' },
        { content: 'Final bullet', format: 'bullet' },
      ];

      for (const { content, format } of mutations) {
        const { content: fileContent, frontmatter, lineEnding } = await readVaultFile(tempVault, 'daily.md');
        const section = findSection(fileContent, 'Log')!;
        const formatted = formatContent(content, format);
        const updated = insertInSection(fileContent, section, formatted, 'append', {
          preserveListNesting: true,
        });
        await writeVaultFile(tempVault, 'daily.md', updated, frontmatter, lineEnding);
      }

      // Read final result
      const finalContent = await readTestNote(tempVault, 'daily.md');

      // All bullet-formatted lines should have consistent indentation
      const lines = finalContent.split('\n');
      const logStart = lines.findIndex(l => l.includes('## Log'));
      const tasksStart = lines.findIndex(l => l.includes('## Tasks'));
      const bulletLines = lines.slice(logStart + 1, tasksStart).filter(l => l.trim().startsWith('-'));

      const indentations = bulletLines.map(l => l.match(/^(\s*)/)?.[1] || '');
      const uniqueIndents = [...new Set(indentations)];

      expect(uniqueIndents.length).toBe(1);
    });

    it('should maintain base indentation even when nested items exist', async () => {
      // Start with section that has nested items
      const initialContent = `---
type: daily
---
# Daily Note

## Log

- Parent item
  - Nested child
    - Deep nested

## Tasks
`;
      await createTestNote(tempVault, 'daily.md', initialContent);

      // Append new items - they should go at base level, not nested
      const entries = ['New entry 1', 'New entry 2', 'New entry 3'];

      for (const entry of entries) {
        const { content: fileContent, frontmatter, lineEnding } = await readVaultFile(tempVault, 'daily.md');
        const section = findSection(fileContent, 'Log')!;
        const formatted = formatContent(entry, 'bullet');
        const updated = insertInSection(fileContent, section, formatted, 'append', {
          preserveListNesting: true,
        });
        await writeVaultFile(tempVault, 'daily.md', updated, frontmatter, lineEnding);
      }

      // Read final result
      const finalContent = await readTestNote(tempVault, 'daily.md');

      // New entries should be at base level (no indent), not nested
      expect(finalContent).toContain('- New entry 1');
      expect(finalContent).toContain('- New entry 2');
      expect(finalContent).toContain('- New entry 3');

      // Verify they're NOT indented
      expect(finalContent).not.toContain('  - New entry 1');
      expect(finalContent).not.toContain('    - New entry 1');
    });
  });

  describe('line ending preservation across mutations', () => {
    it('should preserve CRLF line endings through 3 sequential mutations', async () => {
      // Create file with CRLF line endings
      const crlfContent = '---\r\ntype: daily\r\n---\r\n# Note\r\n\r\n## Log\r\n\r\n## End\r\n';
      await createTestNote(tempVault, 'crlf.md', crlfContent);

      // Verify initial detection
      const initial = await readVaultFile(tempVault, 'crlf.md');
      expect(initial.lineEnding).toBe('CRLF');

      // Perform 3 mutations
      for (let i = 1; i <= 3; i++) {
        const { content: fileContent, frontmatter, lineEnding } = await readVaultFile(tempVault, 'crlf.md');
        const section = findSection(fileContent, 'Log')!;
        const formatted = formatContent(`Entry ${i}`, 'bullet');
        const updated = insertInSection(fileContent, section, formatted, 'append');
        await writeVaultFile(tempVault, 'crlf.md', updated, frontmatter, lineEnding);
      }

      // Verify line endings preserved
      const rawContent = await readTestNote(tempVault, 'crlf.md');
      const crlfCount = (rawContent.match(/\r\n/g) || []).length;
      const lfOnlyCount = (rawContent.match(/(?<!\r)\n/g) || []).length;

      expect(crlfCount).toBeGreaterThan(0);
      expect(lfOnlyCount).toBe(0);
    });

    it('should preserve LF line endings through 3 sequential mutations', async () => {
      // Create file with LF line endings
      const lfContent = '---\ntype: daily\n---\n# Note\n\n## Log\n\n## End\n';
      await createTestNote(tempVault, 'lf.md', lfContent);

      // Verify initial detection
      const initial = await readVaultFile(tempVault, 'lf.md');
      expect(initial.lineEnding).toBe('LF');

      // Perform 3 mutations
      for (let i = 1; i <= 3; i++) {
        const { content: fileContent, frontmatter, lineEnding } = await readVaultFile(tempVault, 'lf.md');
        const section = findSection(fileContent, 'Log')!;
        const formatted = formatContent(`Entry ${i}`, 'bullet');
        const updated = insertInSection(fileContent, section, formatted, 'append');
        await writeVaultFile(tempVault, 'lf.md', updated, frontmatter, lineEnding);
      }

      // Verify line endings preserved (no CRLF introduced)
      const rawContent = await readTestNote(tempVault, 'lf.md');
      const crlfCount = (rawContent.match(/\r\n/g) || []).length;

      expect(crlfCount).toBe(0);
    });
  });

  describe('user manual edit between mutations', () => {
    it('should handle user adding content between mutations', async () => {
      const initialContent = `---
type: daily
---
# Note

## Log

- Initial entry

## End
`;
      await createTestNote(tempVault, 'note.md', initialContent);

      // First mutation
      const { content: content1, frontmatter: fm1, lineEnding: le1 } = await readVaultFile(tempVault, 'note.md');
      const section1 = findSection(content1, 'Log')!;
      const formatted1 = formatContent('Agent entry 1', 'bullet');
      const updated1 = insertInSection(content1, section1, formatted1, 'append', { preserveListNesting: true });
      await writeVaultFile(tempVault, 'note.md', updated1, fm1, le1);

      // Simulate user manually editing the file (adding their own content)
      const userContent = await readTestNote(tempVault, 'note.md');
      const userEdited = userContent.replace(
        '- Agent entry 1',
        '- Agent entry 1\n- User manual entry with different style'
      );
      await createTestNote(tempVault, 'note.md', userEdited);

      // Second mutation after user edit
      const { content: content2, frontmatter: fm2, lineEnding: le2 } = await readVaultFile(tempVault, 'note.md');
      const section2 = findSection(content2, 'Log')!;
      const formatted2 = formatContent('Agent entry 2', 'bullet');
      const updated2 = insertInSection(content2, section2, formatted2, 'append', { preserveListNesting: true });
      await writeVaultFile(tempVault, 'note.md', updated2, fm2, le2);

      // Final result should contain all entries
      const finalContent = await readTestNote(tempVault, 'note.md');
      expect(finalContent).toContain('- Initial entry');
      expect(finalContent).toContain('- Agent entry 1');
      expect(finalContent).toContain('- User manual entry');
      expect(finalContent).toContain('- Agent entry 2');
    });

    it('should adapt to user changing indentation style', async () => {
      const initialContent = `---
type: daily
---
# Note

## Log

- Initial (no indent)

## End
`;
      await createTestNote(tempVault, 'note.md', initialContent);

      // First mutation (should use no indent)
      const { content: content1, frontmatter: fm1, lineEnding: le1 } = await readVaultFile(tempVault, 'note.md');
      const section1 = findSection(content1, 'Log')!;
      const formatted1 = formatContent('Entry 1', 'bullet');
      const updated1 = insertInSection(content1, section1, formatted1, 'append', { preserveListNesting: true });
      await writeVaultFile(tempVault, 'note.md', updated1, fm1, le1);

      // User changes file to use 2-space indent everywhere
      const userContent = (await readTestNote(tempVault, 'note.md'))
        .replace('- Initial', '  - Initial')
        .replace('- Entry 1', '  - Entry 1');
      await createTestNote(tempVault, 'note.md', userContent);

      // Second mutation should detect new 2-space style
      const { content: content2, frontmatter: fm2, lineEnding: le2 } = await readVaultFile(tempVault, 'note.md');
      const section2 = findSection(content2, 'Log')!;
      const formatted2 = formatContent('Entry 2', 'bullet');
      const updated2 = insertInSection(content2, section2, formatted2, 'append', { preserveListNesting: true });
      await writeVaultFile(tempVault, 'note.md', updated2, fm2, le2);

      // Entry 2 should use 2-space indent to match user's style
      const finalContent = await readTestNote(tempVault, 'note.md');
      expect(finalContent).toContain('  - Entry 2');
    });
  });

  describe('prepend vs append consistency', () => {
    it('should maintain same indentation for alternating prepend/append', async () => {
      const initialContent = `---
type: daily
---
# Note

## Log

  - Middle item

## End
`;
      await createTestNote(tempVault, 'note.md', initialContent);

      // Alternate between prepend and append
      const operations: Array<{ content: string; position: 'prepend' | 'append' }> = [
        { content: 'Append 1', position: 'append' },
        { content: 'Prepend 1', position: 'prepend' },
        { content: 'Append 2', position: 'append' },
        { content: 'Prepend 2', position: 'prepend' },
      ];

      for (const { content, position } of operations) {
        const { content: fileContent, frontmatter, lineEnding } = await readVaultFile(tempVault, 'note.md');
        const section = findSection(fileContent, 'Log')!;
        const formatted = formatContent(content, 'bullet');
        const updated = insertInSection(fileContent, section, formatted, position, {
          preserveListNesting: true,
        });
        await writeVaultFile(tempVault, 'note.md', updated, frontmatter, lineEnding);
      }

      // All entries should use 2-space indent (matching original)
      const finalContent = await readTestNote(tempVault, 'note.md');
      const lines = finalContent.split('\n');
      const logStart = lines.findIndex(l => l.includes('## Log'));
      const endStart = lines.findIndex(l => l.includes('## End'));
      const bulletLines = lines.slice(logStart + 1, endStart).filter(l => l.trim().startsWith('-'));

      const indentations = bulletLines.map(l => l.match(/^(\s*)/)?.[1] || '');
      const uniqueIndents = [...new Set(indentations)];

      expect(uniqueIndents.length).toBe(1);
      expect(uniqueIndents[0]).toBe('  ');
    });
  });

  describe('tab indentation consistency', () => {
    it('should maintain tab indentation across sequential mutations', async () => {
      // Section with tab-indented items
      const initialContent = `---
type: daily
---
# Note

## Log

\t- Tab item 1
\t- Tab item 2

## End
`;
      await createTestNote(tempVault, 'note.md', initialContent);

      // Perform 3 appends
      for (let i = 1; i <= 3; i++) {
        const { content: fileContent, frontmatter, lineEnding } = await readVaultFile(tempVault, 'note.md');
        const section = findSection(fileContent, 'Log')!;
        const formatted = formatContent(`New entry ${i}`, 'bullet');
        const updated = insertInSection(fileContent, section, formatted, 'append', {
          preserveListNesting: true,
        });
        await writeVaultFile(tempVault, 'note.md', updated, frontmatter, lineEnding);
      }

      // All new entries should use tab indentation
      const finalContent = await readTestNote(tempVault, 'note.md');
      expect(finalContent).toContain('\t- New entry 1');
      expect(finalContent).toContain('\t- New entry 2');
      expect(finalContent).toContain('\t- New entry 3');
    });
  });

  describe('empty section bootstrap consistency', () => {
    it('should use consistent default when bootstrapping empty section', async () => {
      const initialContent = `---
type: daily
---
# Note

## Log

## End
`;
      await createTestNote(tempVault, 'note.md', initialContent);

      // First entry sets the style
      const { content: content1, frontmatter: fm1, lineEnding: le1 } = await readVaultFile(tempVault, 'note.md');
      const section1 = findSection(content1, 'Log')!;
      const formatted1 = formatContent('First entry', 'bullet');
      const updated1 = insertInSection(content1, section1, formatted1, 'append', { preserveListNesting: true });
      await writeVaultFile(tempVault, 'note.md', updated1, fm1, le1);

      // Subsequent entries should match
      for (let i = 2; i <= 5; i++) {
        const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'note.md');
        const section = findSection(content, 'Log')!;
        const formatted = formatContent(`Entry ${i}`, 'bullet');
        const updated = insertInSection(content, section, formatted, 'append', { preserveListNesting: true });
        await writeVaultFile(tempVault, 'note.md', updated, frontmatter, lineEnding);
      }

      // All entries should have same indentation (no indent for empty bootstrap)
      const finalContent = await readTestNote(tempVault, 'note.md');
      const lines = finalContent.split('\n');
      const logStart = lines.findIndex(l => l.includes('## Log'));
      const endStart = lines.findIndex(l => l.includes('## End'));
      const bulletLines = lines.slice(logStart + 1, endStart).filter(l => l.trim().startsWith('-'));

      expect(bulletLines.length).toBe(5);
      const indentations = bulletLines.map(l => l.match(/^(\s*)/)?.[1] || '');
      const uniqueIndents = [...new Set(indentations)];

      expect(uniqueIndents.length).toBe(1);
    });
  });
});
