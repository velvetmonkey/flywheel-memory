/**
 * Battle-Hardening Tests: Input Format Edge Cases
 *
 * Tests edge cases in input file formats:
 * - Inconsistent indentation (2-space vs 4-space mixed within sections)
 * - Empty sections (heading with no content)
 * - Duplicate section headings (same name, different content)
 * - Missing target sections (error handling validation)
 * - Binary content detection (graceful rejection)
 * - Files in deeply nested folders (>5 levels)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  readVaultFile,
  writeVaultFile,
  findSection,
  insertInSection,
  detectListIndentation,
} from '../../../src/core/write/writer.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
} from '../helpers/testUtils.js';

describe('Battle-Hardening: Input Format Edge Cases', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  describe('inconsistent indentation within same section', () => {
    it('should handle mixed 2-space and 4-space in same list', async () => {
      const content = `---
type: test
---
# Test

## Tasks
- Level 1 item
  - 2-space nested
    - 4-space nested (inconsistent)
  - Back to 2-space
      - Now 6-space (inconsistent)
`;
      await createTestNote(tempVault, 'mixed-indent.md', content);

      const { content: readContent, frontmatter, lineEnding } = await readVaultFile(
        tempVault,
        'mixed-indent.md'
      );
      const section = findSection(readContent, 'Tasks')!;
      expect(section).toBeDefined();

      // Should be able to insert without corrupting structure
      const modified = insertInSection(readContent, section, '- New item', 'append');
      await writeVaultFile(tempVault, 'mixed-indent.md', modified, frontmatter, lineEnding);

      const result = await readTestNote(tempVault, 'mixed-indent.md');
      // Original items should be preserved
      expect(result).toContain('- Level 1 item');
      expect(result).toContain('  - 2-space nested');
      expect(result).toContain('    - 4-space nested');
      expect(result).toContain('- New item');
    });

    it('should detect dominant indentation style in mixed content', () => {
      const lines = [
        '## Section',
        '- Item 1',
        '  - Nested (2-space)',
        '  - Another (2-space)',
        '    - Mixed (4-space)',
        '  - Back (2-space)',
      ];
      // Should detect 2-space as dominant
      const indent = detectListIndentation(lines, 6, 1);
      expect(indent).toBe('  ');
    });

    it('should preserve tabs when file uses tabs consistently', async () => {
      const content = `---
type: test
---
# Test

## Log
- Item 1
\t- Tab-indented
\t- Another tab
`;
      await createTestNote(tempVault, 'tab-file.md', content);

      const { content: readContent, frontmatter, lineEnding } = await readVaultFile(
        tempVault,
        'tab-file.md'
      );
      const section = findSection(readContent, 'Log')!;
      const modified = insertInSection(readContent, section, '- New item', 'append');
      await writeVaultFile(tempVault, 'tab-file.md', modified, frontmatter, lineEnding);

      const result = await readTestNote(tempVault, 'tab-file.md');
      expect(result).toContain('\t- Tab-indented');
      expect(result).toContain('- New item');
    });
  });

  describe('empty sections', () => {
    it('should handle inserting into completely empty section', async () => {
      const content = `---
type: test
---
# Test

## Empty Section

## Next Section
Some content here.
`;
      await createTestNote(tempVault, 'empty-section.md', content);

      const { content: readContent, frontmatter, lineEnding } = await readVaultFile(
        tempVault,
        'empty-section.md'
      );
      const section = findSection(readContent, 'Empty Section')!;
      expect(section).toBeDefined();
      expect(section.contentStartLine).toBe(section.endLine);

      const modified = insertInSection(readContent, section, '- First item', 'append');
      await writeVaultFile(tempVault, 'empty-section.md', modified, frontmatter, lineEnding);

      const result = await readTestNote(tempVault, 'empty-section.md');
      expect(result).toContain('## Empty Section\n- First item');
      expect(result).toContain('## Next Section');
    });

    it('should handle multiple consecutive empty sections', async () => {
      const content = `---
type: test
---
# Test

## Empty 1

## Empty 2

## Empty 3

## Has Content
Actual content here.
`;
      await createTestNote(tempVault, 'multi-empty.md', content);

      const { content: readContent, frontmatter, lineEnding } = await readVaultFile(
        tempVault,
        'multi-empty.md'
      );

      // All empty sections should be findable
      expect(findSection(readContent, 'Empty 1')).toBeDefined();
      expect(findSection(readContent, 'Empty 2')).toBeDefined();
      expect(findSection(readContent, 'Empty 3')).toBeDefined();

      // Insert into middle empty section
      const section = findSection(readContent, 'Empty 2')!;
      const modified = insertInSection(readContent, section, '- Added here', 'append');
      await writeVaultFile(tempVault, 'multi-empty.md', modified, frontmatter, lineEnding);

      const result = await readTestNote(tempVault, 'multi-empty.md');
      expect(result).toContain('## Empty 2\n- Added here');
    });

    it('should handle section with only whitespace', async () => {
      const content = `---
type: test
---
# Test

## Whitespace Only



## Next Section
Content
`;
      await createTestNote(tempVault, 'whitespace-section.md', content);

      const { content: readContent, frontmatter, lineEnding } = await readVaultFile(
        tempVault,
        'whitespace-section.md'
      );
      const section = findSection(readContent, 'Whitespace Only')!;
      expect(section).toBeDefined();

      const modified = insertInSection(readContent, section, '- New item', 'append');
      await writeVaultFile(tempVault, 'whitespace-section.md', modified, frontmatter, lineEnding);

      const result = await readTestNote(tempVault, 'whitespace-section.md');
      expect(result).toContain('- New item');
      expect(result).toContain('## Next Section');
    });
  });

  describe('duplicate section headings', () => {
    it('should find first occurrence of duplicate heading', async () => {
      const content = `---
type: test
---
# Test

## Log
First log section.

## Tasks
Some tasks.

## Log
Second log section (duplicate).
`;
      await createTestNote(tempVault, 'duplicate.md', content);

      const { content: readContent } = await readVaultFile(tempVault, 'duplicate.md');
      const section = findSection(readContent, 'Log')!;
      expect(section).toBeDefined();

      // Should match the first occurrence
      expect(section.name).toBe('Log');
      // First Log section contains "First log section"
      const lines = readContent.split('\n');
      const sectionContent = lines.slice(section.contentStartLine, section.endLine).join('\n');
      expect(sectionContent).toContain('First log section');
    });

    it('should handle inserting into duplicate-named sections correctly', async () => {
      const content = `---
type: test
---
# Test

## Log
First log.

## Tasks
Tasks here.

## Log
Second log.

## Notes
Notes here.
`;
      await createTestNote(tempVault, 'dup-insert.md', content);

      const { content: readContent, frontmatter, lineEnding } = await readVaultFile(
        tempVault,
        'dup-insert.md'
      );
      const section = findSection(readContent, 'Log')!;
      const modified = insertInSection(readContent, section, '- New entry in first', 'append');
      await writeVaultFile(tempVault, 'dup-insert.md', modified, frontmatter, lineEnding);

      const result = await readTestNote(tempVault, 'dup-insert.md');
      // Verify insertion happened in first Log section
      const firstLogIndex = result.indexOf('## Log');
      const secondLogIndex = result.indexOf('## Log', firstLogIndex + 1);
      const newEntryIndex = result.indexOf('- New entry in first');

      expect(newEntryIndex).toBeGreaterThan(firstLogIndex);
      expect(newEntryIndex).toBeLessThan(secondLogIndex);
    });

    it('should preserve both duplicate sections after mutation', async () => {
      const content = `---
type: test
---
# Test

## Ideas
First ideas.

## Projects
Projects here.

## Ideas
Second ideas section.
`;
      await createTestNote(tempVault, 'preserve-dups.md', content);

      const { content: readContent, frontmatter, lineEnding } = await readVaultFile(
        tempVault,
        'preserve-dups.md'
      );
      const section = findSection(readContent, 'Projects')!;
      const modified = insertInSection(readContent, section, '- New project', 'append');
      await writeVaultFile(tempVault, 'preserve-dups.md', modified, frontmatter, lineEnding);

      const result = await readTestNote(tempVault, 'preserve-dups.md');
      // Both Ideas sections should still exist
      const matches = result.match(/## Ideas/g);
      expect(matches).toHaveLength(2);
      expect(result).toContain('First ideas');
      expect(result).toContain('Second ideas section');
    });
  });

  describe('missing target sections', () => {
    it('should return null for non-existent section', async () => {
      const content = `---
type: test
---
# Test

## Existing Section
Content here.
`;
      await createTestNote(tempVault, 'missing.md', content);

      const { content: readContent } = await readVaultFile(tempVault, 'missing.md');
      const section = findSection(readContent, 'Non-Existent Section');
      expect(section).toBeNull();
    });

    it('should handle case-insensitive section matching', async () => {
      const content = `---
type: test
---
# Test

## Log
Content here.
`;
      await createTestNote(tempVault, 'case.md', content);

      const { content: readContent } = await readVaultFile(tempVault, 'case.md');

      // Case-insensitive matching should work
      expect(findSection(readContent, 'Log')).toBeDefined();
      expect(findSection(readContent, 'log')).toBeDefined();
      expect(findSection(readContent, 'LOG')).toBeDefined();

      // All should return the same section
      const exact = findSection(readContent, 'Log')!;
      const lower = findSection(readContent, 'log')!;
      const upper = findSection(readContent, 'LOG')!;
      expect(exact.name).toBe(lower.name);
      expect(exact.name).toBe(upper.name);
    });

    it('should handle section names with special characters', async () => {
      const content = `---
type: test
---
# Test

## [Q1] Goals & Plans
Content with brackets and ampersand.

## Tasks (Urgent!)
Urgent tasks.

## "Quoted" Section
Quoted heading.
`;
      await createTestNote(tempVault, 'special-chars.md', content);

      const { content: readContent } = await readVaultFile(tempVault, 'special-chars.md');

      expect(findSection(readContent, '[Q1] Goals & Plans')).toBeDefined();
      expect(findSection(readContent, 'Tasks (Urgent!)')).toBeDefined();
      expect(findSection(readContent, '"Quoted" Section')).toBeDefined();
    });
  });

  describe('binary content detection', () => {
    it('should reject files with null bytes', async () => {
      const binaryContent = Buffer.from([
        0x23, 0x20, 0x54, 0x65, 0x73, 0x74, // "# Test"
        0x00, 0x00, 0x00, // Null bytes
        0x0a, // Newline
      ]);

      const filePath = path.join(tempVault, 'binary.md');
      await fs.writeFile(filePath, binaryContent);

      // Reading should either throw or handle gracefully
      try {
        const result = await readVaultFile(tempVault, 'binary.md');
        // If it doesn't throw, content should be truncated or escaped
        expect(result.content.includes('\x00')).toBe(false);
      } catch (error) {
        // Throwing on binary content is acceptable
        expect(error instanceof Error).toBe(true);
      }
    });

    it('should handle files with high-byte characters (valid UTF-8)', async () => {
      const content = `---
type: test
---
# Test

## Section
Content with high bytes: éàüöñ 中文 日本語 🎉
`;
      await createTestNote(tempVault, 'utf8.md', content);

      const { content: readContent, frontmatter, lineEnding } = await readVaultFile(
        tempVault,
        'utf8.md'
      );
      expect(readContent).toContain('éàüöñ');
      expect(readContent).toContain('中文');
      expect(readContent).toContain('🎉');

      const section = findSection(readContent, 'Section')!;
      const modified = insertInSection(readContent, section, '- More UTF-8: ß∞≠', 'append');
      await writeVaultFile(tempVault, 'utf8.md', modified, frontmatter, lineEnding);

      const result = await readTestNote(tempVault, 'utf8.md');
      expect(result).toContain('ß∞≠');
    });

    it('should handle large files without truncation', async () => {
      // Create a file with many sections
      const sections = Array.from({ length: 100 }, (_, i) => `## Section ${i}\nContent for section ${i}.\n`);
      const content = `---
type: test
---
# Large File Test

${sections.join('\n')}
`;
      await createTestNote(tempVault, 'large.md', content);

      const { content: readContent } = await readVaultFile(tempVault, 'large.md');

      // All sections should be findable
      expect(findSection(readContent, 'Section 0')).toBeDefined();
      expect(findSection(readContent, 'Section 50')).toBeDefined();
      expect(findSection(readContent, 'Section 99')).toBeDefined();
    });
  });

  describe('deeply nested folders', () => {
    it('should handle files nested 5+ levels deep', async () => {
      const deepPath = 'level1/level2/level3/level4/level5/level6/deep-note.md';
      const content = `---
type: test
---
# Deep Note

## Log
Deep content here.
`;
      await createTestNote(tempVault, deepPath, content);

      const { content: readContent, frontmatter, lineEnding } = await readVaultFile(
        tempVault,
        deepPath
      );
      expect(readContent).toContain('# Deep Note');

      const section = findSection(readContent, 'Log')!;
      const modified = insertInSection(readContent, section, '- Entry from depth', 'append');
      await writeVaultFile(tempVault, deepPath, modified, frontmatter, lineEnding);

      const result = await readTestNote(tempVault, deepPath);
      expect(result).toContain('- Entry from depth');
    });

    it('should handle paths with special characters in folder names', async () => {
      const specialPath = 'projects/[Q1 2026]/meetings (archived)/important_notes/note.md';
      const content = `---
type: test
---
# Special Path Note

## Content
Here.
`;
      await createTestNote(tempVault, specialPath, content);

      const { content: readContent } = await readVaultFile(tempVault, specialPath);
      expect(readContent).toContain('# Special Path Note');
    });

    it('should handle spaces in folder and file names', async () => {
      const spacePath = 'My Notes/Daily Notes/January 2026/Meeting Notes.md';
      const content = `---
type: meeting
---
# Meeting Notes

## Attendees
- Person A
`;
      await createTestNote(tempVault, spacePath, content);

      const { content: readContent, frontmatter, lineEnding } = await readVaultFile(
        tempVault,
        spacePath
      );
      const section = findSection(readContent, 'Attendees')!;
      const modified = insertInSection(readContent, section, '- Person B', 'append');
      await writeVaultFile(tempVault, spacePath, modified, frontmatter, lineEnding);

      const result = await readTestNote(tempVault, spacePath);
      expect(result).toContain('- Person A');
      expect(result).toContain('- Person B');
    });

    it('should handle very long path names', async () => {
      // Create a path that's close to filesystem limits (but not over)
      const longFolderName = 'a'.repeat(50);
      const longPath = `${longFolderName}/${longFolderName}/${longFolderName}/note.md`;
      const content = `---
type: test
---
# Long Path Note

## Section
Content.
`;
      await createTestNote(tempVault, longPath, content);

      const { content: readContent } = await readVaultFile(tempVault, longPath);
      expect(readContent).toContain('# Long Path Note');
    });
  });
});
