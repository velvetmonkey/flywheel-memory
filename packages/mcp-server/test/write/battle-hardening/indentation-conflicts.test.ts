/**
 * Battle-Hardening Tests: Indentation Conflicts
 *
 * Tests edge cases in indentation detection and handling:
 * - Mixed 2-space AND 4-space within same file
 * - Inconsistent tabs vs spaces in nested lists
 * - Broken indentation detection (trailing spaces)
 * - Context loss: which style to choose when inserting
 * - Deep nesting with mixed indentation styles
 * - Indentation normalization behavior
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readVaultFile,
  writeVaultFile,
  findSection,
  insertInSection,
  detectListIndentation,
  detectSectionBaseIndentation,
  formatContent,
} from '../../src/core/writer.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
} from '../helpers/testUtils.js';

describe('Battle-Hardening: Indentation Conflicts', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  describe('mixed 2-space and 4-space indentation', () => {
    it('should detect 2-space indentation in a 2-space section', () => {
      const lines = [
        '## Log',
        '- Item 1',
        '  - Nested 2-space',
        '  - Another nested',
      ];
      const indent = detectListIndentation(lines, 4, 1);
      expect(indent).toBe('  ');
    });

    it('should detect 4-space indentation in a 4-space section', () => {
      const lines = [
        '## Log',
        '- Item 1',
        '    - Nested 4-space',
        '    - Another nested',
      ];
      const indent = detectListIndentation(lines, 4, 1);
      expect(indent).toBe('    ');
    });

    it('should handle file with mixed indentation styles in different sections', () => {
      const content = `## Section A
- Item A1
  - Nested A (2-space)
  - Nested A2

## Section B
- Item B1
    - Nested B (4-space)
    - Nested B2
`;
      const sectionA = findSection(content, 'Section A')!;
      const sectionB = findSection(content, 'Section B')!;

      const lines = content.split('\n');

      const indentA = detectSectionBaseIndentation(lines, sectionA.contentStartLine, sectionA.endLine);
      const indentB = detectSectionBaseIndentation(lines, sectionB.contentStartLine, sectionB.endLine);

      // Both should detect the base level (no indentation for top-level items)
      expect(indentA).toBe('');
      expect(indentB).toBe('');
    });

    it('should preserve existing indentation when inserting', () => {
      const content = `## Tasks
  - Task 1
  - Task 2
## Next
`;
      const section = findSection(content, 'Tasks')!;
      const result = insertInSection(content, section, '- New task', 'append', {
        preserveListNesting: true,
      });

      // Should use 2-space indentation to match existing
      expect(result).toContain('  - Task 2\n  - New task');
    });

    it('should detect section base indentation correctly with mixed nesting', () => {
      const content = `## Log
- Top level item
  - 2-space nested
    - 4-space deep nested
`;
      const lines = content.split('\n');
      const section = findSection(content, 'Log')!;

      const baseIndent = detectSectionBaseIndentation(lines, section.contentStartLine, section.endLine);
      // Base indentation should be '' (no indent) for the top-level item
      expect(baseIndent).toBe('');
    });
  });

  describe('tabs vs spaces in nested lists', () => {
    it('should detect tab indentation', () => {
      const lines = [
        '## Log',
        '- Item 1',
        '\t- Tab nested',
        '\t- Another tab nested',
      ];
      const indent = detectListIndentation(lines, 4, 1);
      expect(indent).toBe('\t');
    });

    it('should detect multiple tab indentation', () => {
      const lines = [
        '## Log',
        '- Item 1',
        '\t\t- Double tab nested',
      ];
      const indent = detectListIndentation(lines, 3, 1);
      expect(indent).toBe('\t\t');
    });

    it('should handle mixed tabs and spaces in same file', async () => {
      // This is a common source of errors in real files
      const content = `## Tab Section
- Item 1
\t- Tab nested

## Space Section
- Item 2
  - Space nested
`;
      await createTestNote(tempVault, 'mixed-indent.md', content);

      const { content: fileContent } = await readVaultFile(tempVault, 'mixed-indent.md');

      const tabSection = findSection(fileContent, 'Tab Section')!;
      const spaceSection = findSection(fileContent, 'Space Section')!;

      const lines = fileContent.split('\n');

      // Each section should detect its own indentation style
      const tabBase = detectSectionBaseIndentation(lines, tabSection.contentStartLine, tabSection.endLine);
      const spaceBase = detectSectionBaseIndentation(lines, spaceSection.contentStartLine, spaceSection.endLine);

      // Both base levels are unindented (top-level items)
      expect(tabBase).toBe('');
      expect(spaceBase).toBe('');
    });

    it('should not mix tab and space when preserving nesting', () => {
      const content = `## Log
\t- Tab indented item
\t- Another tab item
`;
      const section = findSection(content, 'Log')!;
      const result = insertInSection(content, section, '- New item', 'append', {
        preserveListNesting: true,
      });

      // Should preserve tab indentation
      expect(result).toContain('\t- Another tab item\n\t- New item');
    });
  });

  describe('trailing spaces and broken indentation', () => {
    it('should handle lines with trailing spaces', () => {
      const content = `## Log
- Item 1
  - Nested
`;
      const section = findSection(content, 'Log')!;
      expect(section).not.toBeNull();

      // Insert should still work
      const result = insertInSection(content, section, '- New item', 'append');
      expect(result).toContain('- New item');
    });

    it('should handle only-whitespace lines between list items', () => {
      const lines = [
        '## Log',
        '- Item 1',
        '    ',  // Only spaces
        '- Item 2',
      ];
      const indent = detectListIndentation(lines, 4, 1);
      expect(indent).toBe('');  // Should find Item 2's indentation
    });

    it('should handle inconsistent indentation in nested items', () => {
      // Real-world scenario: user accidentally used different indentation
      const lines = [
        '## Tasks',
        '- Task 1',
        '  - Subtask (2 space)',
        '   - Subtask (3 space)',  // Inconsistent
        '    - Subtask (4 space)', // Even more inconsistent
      ];
      // Should detect the most recent list item's indentation
      const indent = detectListIndentation(lines, 5, 1);
      expect(indent).toBe('    ');
    });

    it('should handle CR+LF line endings with indentation', async () => {
      const content = `---\r\ntype: test\r\n---\r\n## Log\r\n- Item 1\r\n  - Nested\r\n`;
      await createTestNote(tempVault, 'crlf.md', content);

      const { content: fileContent, lineEnding } = await readVaultFile(tempVault, 'crlf.md');
      expect(lineEnding).toBe('CRLF');

      const section = findSection(fileContent, 'Log')!;
      expect(section).not.toBeNull();
    });
  });

  describe('context loss - choosing indentation style', () => {
    it('should use base indentation when appending to section with nested content', () => {
      const content = `## Log
- Parent item
  - Child item 1
  - Child item 2
    - Grandchild
## Next
`;
      const section = findSection(content, 'Log')!;
      const result = insertInSection(content, section, '- New parent', 'append', {
        preserveListNesting: true,
      });

      // Should add at base level, not nested
      expect(result).toContain('    - Grandchild\n- New parent\n## Next');
    });

    it('should use first list item indentation when prepending', () => {
      const content = `## Log
  - Indented item 1
  - Indented item 2
## Next
`;
      const section = findSection(content, 'Log')!;
      const result = insertInSection(content, section, '- New item', 'prepend', {
        preserveListNesting: true,
      });

      // Should match the 2-space indentation of existing items
      expect(result).toContain('## Log\n  - New item\n  - Indented item 1');
    });

    it('should handle empty section with no indentation context', () => {
      const content = `## Empty

## Next
`;
      const section = findSection(content, 'Empty')!;
      const result = insertInSection(content, section, '- New item', 'append', {
        preserveListNesting: true,
      });

      // No context, should not add indentation
      expect(result).toContain('## Empty');
      expect(result).toContain('- New item');
      expect(result).toContain('## Next');

      // Verify the item is not indented
      expect(result).not.toContain('  - New item');
    });

    it('should use previous sections style when current section is empty', async () => {
      // This tests that we don't accidentally inherit indentation from other sections
      const content = `## Populated
  - Indented item

## Empty

## Next
`;
      const section = findSection(content, 'Empty')!;
      const result = insertInSection(content, section, '- New item', 'append', {
        preserveListNesting: true,
      });

      // Should NOT inherit the 2-space from Populated section
      // Verify that the new item in Empty section is NOT indented
      const lines = result.split('\n');
      const emptyIdx = lines.findIndex(l => l === '## Empty');
      const nextIdx = lines.findIndex(l => l === '## Next');

      // Find the line with "- New item" between Empty and Next
      let foundUnindented = false;
      for (let i = emptyIdx + 1; i < nextIdx; i++) {
        if (lines[i] === '- New item') {
          foundUnindented = true;
          break;
        }
      }
      expect(foundUnindented).toBe(true);
    });
  });

  describe('deep nesting with mixed styles', () => {
    it('should handle 10+ levels of nesting', () => {
      const lines = [
        '## Deep',
        '- L1',
        '  - L2',
        '    - L3',
        '      - L4',
        '        - L5',
        '          - L6',
        '            - L7',
        '              - L8',
        '                - L9',
        '                  - L10',
      ];

      // Detect indentation at various levels
      const indentL10 = detectListIndentation(lines, 11, 1);
      expect(indentL10).toBe('                  '); // 18 spaces

      const indentL5 = detectListIndentation(lines, 6, 1);
      expect(indentL5).toBe('        '); // 8 spaces
    });

    it('should handle mixed 2-space/4-space at different nesting levels', () => {
      const lines = [
        '## Mixed',
        '- L1 (no indent)',
        '  - L2 (2 space)',
        '      - L3 (6 space - jumped from 2 to 6)',
        '        - L4 (8 space)',
      ];

      const indentL4 = detectListIndentation(lines, 5, 1);
      expect(indentL4).toBe('        ');
    });

    it('should handle alternating tab and space at different levels', () => {
      const lines = [
        '## Alternating',
        '- L1',
        '\t- L2 (tab)',
        '\t  - L3 (tab + 2 space)',
        '\t\t- L4 (2 tabs)',
      ];

      const indentL4 = detectListIndentation(lines, 5, 1);
      expect(indentL4).toBe('\t\t');
    });
  });

  describe('indentation normalization behavior', () => {
    it('should preserve existing indentation when not using preserveListNesting', () => {
      const content = `## Log
  - Existing item
`;
      const section = findSection(content, 'Log')!;
      const result = insertInSection(content, section, '- New item', 'append', {
        preserveListNesting: false,
      });

      // Without preserveListNesting, should NOT add indentation
      expect(result).toContain('  - Existing item\n- New item');
    });

    it('should not modify indentation of multi-line content in code blocks', () => {
      const multiline = `- Item with code:
\`\`\`
  indented code
    more indented
\`\`\``;

      const result = formatContent(multiline, 'plain');
      // Code block should preserve its internal indentation
      expect(result).toContain('  indented code');
      expect(result).toContain('    more indented');
    });

    it('should handle list item with sub-list in content', () => {
      const content = `## Log
- Parent item
  - Existing child
`;
      const section = findSection(content, 'Log')!;

      // Appending a new parent-level item
      const newContent = `- New parent
  - New child`;

      const result = insertInSection(content, section, newContent, 'append');
      expect(result).toContain('- New parent');
      expect(result).toContain('  - New child');
    });

    it('should not double-indent when content already has proper structure', () => {
      const content = `## Tasks
- Task 1
  - Subtask 1
`;
      const section = findSection(content, 'Tasks')!;

      // Content that's already formatted correctly
      const newContent = `- Task 2
  - Subtask 2`;

      const result = insertInSection(content, section, newContent, 'append', {
        preserveListNesting: true,
      });

      // Should NOT add extra indentation
      expect(result).not.toContain('  - Task 2');
      expect(result).toContain('- Task 2');
      expect(result).toContain('  - Subtask 2');
    });
  });

  describe('edge cases in indentation detection', () => {
    it('should handle asterisk bullet markers', () => {
      const lines = [
        '## Log',
        '* Item 1',
        '  * Nested with asterisk',
      ];
      const indent = detectListIndentation(lines, 3, 1);
      expect(indent).toBe('  ');
    });

    it('should handle plus bullet markers', () => {
      const lines = [
        '## Log',
        '+ Item 1',
        '  + Nested with plus',
      ];
      const indent = detectListIndentation(lines, 3, 1);
      expect(indent).toBe('  ');
    });

    it('should handle numbered list markers', () => {
      const lines = [
        '## Log',
        '1. Item 1',
        '   1. Nested numbered',
      ];
      const indent = detectListIndentation(lines, 3, 1);
      expect(indent).toBe('   ');
    });

    it('should handle task list markers', () => {
      const lines = [
        '## Tasks',
        '- [ ] Task 1',
        '  - [ ] Subtask',
      ];
      const indent = detectListIndentation(lines, 3, 1);
      expect(indent).toBe('  ');
    });

    it('should handle completed task markers', () => {
      const lines = [
        '## Tasks',
        '- [x] Done task',
        '  - [x] Done subtask',
      ];
      const indent = detectListIndentation(lines, 3, 1);
      expect(indent).toBe('  ');
    });

    it('should return empty string when at section start with no list items', () => {
      const lines = [
        '## Plain Text Section',
        'This is just text',
        'No list items here',
      ];
      const indent = detectListIndentation(lines, 3, 1);
      expect(indent).toBe('');
    });

    it('should stop searching at heading boundary', () => {
      const lines = [
        '## Section 1',
        '    - Indented in Section 1',
        '## Section 2',
        '- Not indented in Section 2',
      ];
      // When in Section 2, should not find Section 1's indentation
      const indent = detectListIndentation(lines, 4, 3);
      expect(indent).toBe('');
    });
  });
});
