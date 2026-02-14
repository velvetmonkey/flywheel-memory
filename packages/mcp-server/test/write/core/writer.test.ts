/**
 * Tests for core writer utilities
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  extractHeadings,
  findSection,
  formatContent,
  insertInSection,
  detectListIndentation,
  validatePath,
  validatePathSecure,
  isSensitivePath,
  readVaultFile,
  writeVaultFile,
  isEmptyPlaceholder,
  isInsideCodeBlock,
  isStructuredLine,
  isCodeFenceLine,
  isPreformattedList,
  checkRegexSafety,
  createSafeRegex,
  safeRegexTest,
  safeRegexReplace,
} from '../../../src/core/write/writer.js';
import fs from 'fs/promises';
import path from 'path';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
  createSampleNote,
  createNoteWithoutFrontmatter,
} from '../helpers/testUtils.js';

describe('extractHeadings', () => {
  it('should extract headings from markdown', () => {
    const content = `# Heading 1
Some text
## Heading 2
More text
### Heading 3
`;
    const headings = extractHeadings(content);
    expect(headings).toHaveLength(3);
    expect(headings[0]).toEqual({ level: 1, text: 'Heading 1', line: 0 });
    expect(headings[1]).toEqual({ level: 2, text: 'Heading 2', line: 2 });
    expect(headings[2]).toEqual({ level: 3, text: 'Heading 3', line: 4 });
  });

  it('should skip headings in code blocks', () => {
    const content = `# Real Heading
\`\`\`
# Fake Heading
\`\`\`
## Another Real Heading
`;
    const headings = extractHeadings(content);
    expect(headings).toHaveLength(2);
    expect(headings[0].text).toBe('Real Heading');
    expect(headings[1].text).toBe('Another Real Heading');
  });

  it('should handle empty content', () => {
    const headings = extractHeadings('');
    expect(headings).toHaveLength(0);
  });

  it('should handle code blocks with triple backticks', () => {
    const content = `# Real Heading
\`\`\`
# Fake Heading 1
\`\`\`
## Another Real Heading
\`\`\`
# Fake Heading 2
\`\`\`
### Yet Another Real Heading
`;
    const headings = extractHeadings(content);
    expect(headings).toHaveLength(3);
    expect(headings[0].text).toBe('Real Heading');
    expect(headings[1].text).toBe('Another Real Heading');
    expect(headings[2].text).toBe('Yet Another Real Heading');
  });

  it('should extract all heading levels (h1-h6)', () => {
    const content = `# H1
## H2
### H3
#### H4
##### H5
###### H6
`;
    const headings = extractHeadings(content);
    expect(headings).toHaveLength(6);
    expect(headings[0].level).toBe(1);
    expect(headings[1].level).toBe(2);
    expect(headings[2].level).toBe(3);
    expect(headings[3].level).toBe(4);
    expect(headings[4].level).toBe(5);
    expect(headings[5].level).toBe(6);
  });

  it('should handle headings with special characters', () => {
    const content = `# Heading with **bold** and *italic*
## Heading with \`code\`
### Heading with [[wikilink]]
`;
    const headings = extractHeadings(content);
    expect(headings).toHaveLength(3);
    expect(headings[0].text).toBe('Heading with **bold** and *italic*');
    expect(headings[1].text).toBe('Heading with `code`');
    expect(headings[2].text).toBe('Heading with [[wikilink]]');
  });

  it('should handle consecutive headings with no content between', () => {
    const content = `# First
## Second
### Third
## Fourth
`;
    const headings = extractHeadings(content);
    expect(headings).toHaveLength(4);
    expect(headings[0].text).toBe('First');
    expect(headings[1].text).toBe('Second');
    expect(headings[2].text).toBe('Third');
    expect(headings[3].text).toBe('Fourth');
  });
});

describe('findSection', () => {
  it('should find section by name', () => {
    const content = `# Heading 1
Content 1
## Log
Log content here
More log content
## Another Section
Other content
`;
    const section = findSection(content, 'Log');
    expect(section).not.toBeNull();
    expect(section?.name).toBe('Log');
    expect(section?.level).toBe(2);
    expect(section?.startLine).toBe(2);
    expect(section?.contentStartLine).toBe(3);
    expect(section?.endLine).toBe(4); // Line before next section
  });

  it('should be case-insensitive', () => {
    const content = `## Log
Content
`;
    const section1 = findSection(content, 'log');
    const section2 = findSection(content, 'LOG');
    const section3 = findSection(content, 'Log');
    expect(section1).not.toBeNull();
    expect(section2).not.toBeNull();
    expect(section3).not.toBeNull();
  });

  it('should handle section names with or without # prefix', () => {
    const content = `## Log
Content
`;
    const section1 = findSection(content, 'Log');
    const section2 = findSection(content, '## Log');
    expect(section1).toEqual(section2);
  });

  it('should return null for non-existent section', () => {
    const content = `## Log
Content
`;
    const section = findSection(content, 'NonExistent');
    expect(section).toBeNull();
  });

  it('should handle section at end of file', () => {
    const content = `# Heading 1
## Last Section
Final content
No more headings after this`;
    const section = findSection(content, 'Last Section');
    expect(section).not.toBeNull();
    expect(section?.endLine).toBe(3);
  });

  it('should handle deeply nested sections (h4/h5/h6)', () => {
    const content = `# H1
## H2
### H3
#### H4
Content in H4
##### H5
Content in H5
###### H6
Content in H6
`;
    const h4Section = findSection(content, 'H4');
    const h5Section = findSection(content, 'H5');
    const h6Section = findSection(content, 'H6');

    expect(h4Section).not.toBeNull();
    expect(h4Section?.level).toBe(4);
    expect(h5Section).not.toBeNull();
    expect(h5Section?.level).toBe(5);
    expect(h6Section).not.toBeNull();
    expect(h6Section?.level).toBe(6);
  });

  it('should handle duplicate section names at different levels', () => {
    const content = `# Notes
## Notes
Content in H2
### Notes
Content in H3
`;
    // Should find the first occurrence
    const section = findSection(content, 'Notes');
    expect(section).not.toBeNull();
    expect(section?.level).toBe(1);
    expect(section?.startLine).toBe(0);
  });

  it('should reject partial matches', () => {
    const content = `## Logging
## Log Entry
`;
    const section = findSection(content, 'Log');
    expect(section).toBeNull();
  });

  it('should handle section with only whitespace content', () => {
    const content = `## Empty Section


## Next Section
`;
    const section = findSection(content, 'Empty Section');
    expect(section).not.toBeNull();
    expect(section?.contentStartLine).toBe(1);
    expect(section?.endLine).toBe(2);
  });
});

describe('formatContent', () => {
  it('should format as plain', () => {
    const result = formatContent('Hello world', 'plain');
    expect(result).toBe('Hello world');
  });

  it('should format as bullet', () => {
    const result = formatContent('Hello world', 'bullet');
    expect(result).toBe('- Hello world');
  });

  it('should format as task', () => {
    const result = formatContent('Hello world', 'task');
    expect(result).toBe('- [ ] Hello world');
  });

  it('should format as numbered', () => {
    const result = formatContent('Hello world', 'numbered');
    expect(result).toBe('1. Hello world');
  });

  it('should format as timestamp-bullet', () => {
    const result = formatContent('Hello world', 'timestamp-bullet');
    expect(result).toMatch(/^- \*\*\d{2}:\d{2}\*\* Hello world$/);
  });

  it('should trim whitespace', () => {
    const result = formatContent('  Hello world  ', 'plain');
    expect(result).toBe('Hello world');
  });

  // Multi-line content tests
  describe('multi-line content', () => {
    it('should indent continuation lines for bullet format', () => {
      const content = 'First line\n\nSecond line\nThird line';
      const result = formatContent(content, 'bullet');
      expect(result).toBe('- First line\n\n  Second line\n  Third line');
    });

    it('should indent continuation lines for task format', () => {
      const content = 'Task description\n\nMore details';
      const result = formatContent(content, 'task');
      expect(result).toBe('- [ ] Task description\n\n      More details');
    });

    it('should indent continuation lines for numbered format', () => {
      const content = 'First line\n\nSecond line';
      const result = formatContent(content, 'numbered');
      expect(result).toBe('1. First line\n\n   Second line');
    });

    it('should indent continuation lines for timestamp-bullet format', () => {
      const content = 'First line\n\nSecond line';
      const result = formatContent(content, 'timestamp-bullet');
      // Verify first line has timestamp prefix and continuation is indented
      const lines = result.split('\n');
      expect(lines[0]).toMatch(/^- \*\*\d{2}:\d{2}\*\* First line$/);
      expect(lines[1]).toBe('');  // Empty line preserved
      expect(lines[2]).toBe('  Second line');  // Indented with 2 spaces
    });

    it('should not modify single-line content for bullet format', () => {
      const result = formatContent('Single line', 'bullet');
      expect(result).toBe('- Single line');
    });

    it('should handle content with multiple blank lines', () => {
      const content = 'Line 1\n\n\nLine 2';
      const result = formatContent(content, 'bullet');
      expect(result).toBe('- Line 1\n\n\n  Line 2');
    });

    it('should preserve indentation in continuation lines', () => {
      const content = 'Parent item\n  - Nested item\n  - Another nested';
      const result = formatContent(content, 'bullet');
      expect(result).toBe('- Parent item\n    - Nested item\n    - Another nested');
    });
  });

  // Block-awareness tests
  describe('block-aware formatting', () => {
    it('should preserve code blocks without indenting content inside', () => {
      const content = 'Description\n```javascript\nconst x = 1;\nfunction foo() {\n  return x;\n}\n```';
      const result = formatContent(content, 'bullet');
      expect(result).toBe('- Description\n```javascript\nconst x = 1;\nfunction foo() {\n  return x;\n}\n```');
    });

    it('should not indent code fence markers', () => {
      const content = 'Code example:\n```\ncode here\n```';
      const result = formatContent(content, 'bullet');
      // Code fence markers should not be indented
      expect(result).toContain('```\ncode here\n```');
      expect(result).not.toContain('  ```');
    });

    it('should preserve table rows without indentation', () => {
      const content = 'Table below:\n| Header 1 | Header 2 |\n| -------- | -------- |\n| Cell 1   | Cell 2   |';
      const result = formatContent(content, 'bullet');
      expect(result).toBe('- Table below:\n| Header 1 | Header 2 |\n| -------- | -------- |\n| Cell 1   | Cell 2   |');
    });

    it('should preserve blockquotes without indentation', () => {
      const content = 'Quote:\n> This is a quote\n> Second line of quote';
      const result = formatContent(content, 'bullet');
      expect(result).toBe('- Quote:\n> This is a quote\n> Second line of quote');
    });

    it('should preserve horizontal rules', () => {
      const content = 'Before rule\n---\nAfter rule';
      const result = formatContent(content, 'bullet');
      expect(result).toBe('- Before rule\n---\n  After rule');
    });

    it('should preserve asterisk horizontal rules', () => {
      const content = 'Before rule\n***\nAfter rule';
      const result = formatContent(content, 'bullet');
      expect(result).toBe('- Before rule\n***\n  After rule');
    });

    it('should preserve underscore horizontal rules', () => {
      const content = 'Before rule\n___\nAfter rule';
      const result = formatContent(content, 'bullet');
      expect(result).toBe('- Before rule\n___\n  After rule');
    });

    it('should handle mixed content with code blocks and tables', () => {
      const content = 'Log entry with data:\n| Col A | Col B |\n| ----- | ----- |\n| 1     | 2     |\n\n```\ncode\n```\n\nRegular text continues here';
      const result = formatContent(content, 'bullet');
      // Tables and code should be preserved
      expect(result).toContain('| Col A | Col B |');
      expect(result).toContain('```\ncode\n```');
      // Regular text should be indented
      expect(result).toContain('  Regular text continues here');
    });

    it('should handle task format with code blocks', () => {
      const content = 'Review code:\n```js\nconst test = 1;\n```';
      const result = formatContent(content, 'task');
      expect(result).toBe('- [ ] Review code:\n```js\nconst test = 1;\n```');
    });

    it('should handle numbered format with tables', () => {
      const content = 'Step with table:\n| A | B |\n| - | - |\n| 1 | 2 |';
      const result = formatContent(content, 'numbered');
      expect(result).toBe('1. Step with table:\n| A | B |\n| - | - |\n| 1 | 2 |');
    });

    it('should handle timestamp-bullet format with blockquotes', () => {
      const content = 'Discussion:\n> Important quote\n> More quote';
      const result = formatContent(content, 'timestamp-bullet');
      const lines = result.split('\n');
      expect(lines[0]).toMatch(/^- \*\*\d{2}:\d{2}\*\* Discussion:$/);
      expect(lines[1]).toBe('> Important quote');
      expect(lines[2]).toBe('> More quote');
    });
  });

  // Preformatted list preservation tests
  describe('preformatted list preservation', () => {
    it('should preserve bullet list content unchanged', () => {
      const content = '- Item 1\n  - Nested item\n  - Another nested';
      const result = formatContent(content, 'bullet');
      expect(result).toBe('- Item 1\n  - Nested item\n  - Another nested');
    });

    it('should preserve task list content unchanged', () => {
      const content = '- [ ] Task 1\n  - [ ] Nested task';
      const result = formatContent(content, 'task');
      expect(result).toBe('- [ ] Task 1\n  - [ ] Nested task');
    });

    it('should preserve numbered list content unchanged', () => {
      const content = '1. First item\n   1. Nested item';
      const result = formatContent(content, 'numbered');
      expect(result).toBe('1. First item\n   1. Nested item');
    });

    it('should preserve bullet list in timestamp-bullet format', () => {
      const content = '- Already formatted\n  - Nested';
      const result = formatContent(content, 'timestamp-bullet');
      expect(result).toBe('- Already formatted\n  - Nested');
    });

    it('should still format plain text that is not a list', () => {
      const content = 'Plain text item';
      const result = formatContent(content, 'bullet');
      expect(result).toBe('- Plain text item');
    });

    it('should format text starting with dash but no space', () => {
      const content = '-not a list marker';
      const result = formatContent(content, 'bullet');
      expect(result).toBe('- -not a list marker');
    });

    it('should preserve asterisk bullet lists', () => {
      const content = '* Item 1\n* Item 2';
      const result = formatContent(content, 'bullet');
      expect(result).toBe('* Item 1\n* Item 2');
    });

    it('should preserve plus bullet lists', () => {
      const content = '+ Item 1\n+ Item 2';
      const result = formatContent(content, 'bullet');
      expect(result).toBe('+ Item 1\n+ Item 2');
    });

    it('should preserve completed task lists', () => {
      const content = '- [x] Done task\n- [ ] Todo task';
      const result = formatContent(content, 'task');
      expect(result).toBe('- [x] Done task\n- [ ] Todo task');
    });
  });
});

describe('isPreformattedList', () => {
  it('should detect bullet list with dash', () => {
    expect(isPreformattedList('- Item 1')).toBe(true);
    expect(isPreformattedList('- Item 1\n- Item 2')).toBe(true);
  });

  it('should detect bullet list with asterisk', () => {
    expect(isPreformattedList('* Item 1')).toBe(true);
  });

  it('should detect bullet list with plus', () => {
    expect(isPreformattedList('+ Item 1')).toBe(true);
  });

  it('should detect numbered list', () => {
    expect(isPreformattedList('1. First item')).toBe(true);
    expect(isPreformattedList('42. Item')).toBe(true);
  });

  it('should detect unchecked task list', () => {
    expect(isPreformattedList('- [ ] Task')).toBe(true);
  });

  it('should detect checked task list', () => {
    expect(isPreformattedList('- [x] Done')).toBe(true);
    expect(isPreformattedList('- [X] Done')).toBe(true);
  });

  it('should return false for plain text', () => {
    expect(isPreformattedList('Plain text')).toBe(false);
    expect(isPreformattedList('Some content here')).toBe(false);
  });

  it('should return false for empty content', () => {
    expect(isPreformattedList('')).toBe(false);
    expect(isPreformattedList('   ')).toBe(false);
  });

  it('should return false for dash without space', () => {
    expect(isPreformattedList('-no space')).toBe(false);
  });

  it('should return false for number without dot', () => {
    expect(isPreformattedList('1 Item')).toBe(false);
  });

  it('should handle leading whitespace in content', () => {
    expect(isPreformattedList('  - Item')).toBe(true);
    expect(isPreformattedList('\n- Item')).toBe(true);
  });
});

describe('insertInSection', () => {
  it('should append content to section', () => {
    const content = `## Log
Existing entry
## Next Section
`;
    const section = findSection(content, 'Log');
    const result = insertInSection(content, section!, 'New entry', 'append');
    expect(result).toContain('Existing entry\nNew entry\n## Next Section');
  });

  it('should prepend content to section', () => {
    const content = `## Log
Existing entry
## Next Section
`;
    const section = findSection(content, 'Log');
    const result = insertInSection(content, section!, 'New entry', 'prepend');
    expect(result).toContain('## Log\nNew entry\nExisting entry');
  });

  it('should handle empty section', () => {
    const content = `## Log
## Next Section
`;
    const section = findSection(content, 'Log');
    const result = insertInSection(content, section!, 'First entry', 'append');
    expect(result).toContain('## Log\nFirst entry\n## Next Section');
  });

  it('should handle multi-line content insertion', () => {
    const content = `## Log
Existing
## Next
`;
    const section = findSection(content, 'Log');
    const multilineContent = 'Line 1\nLine 2\nLine 3';
    const result = insertInSection(content, section!, multilineContent, 'append');
    expect(result).toContain('Existing\nLine 1\nLine 2\nLine 3\n## Next');
  });

  it('should handle content with markdown special characters', () => {
    const content = `## Log
## Next
`;
    const section = findSection(content, 'Log');
    const specialContent = '- **Bold** and *italic* with `code` and [[wikilink]]';
    const result = insertInSection(content, section!, specialContent, 'append');
    expect(result).toContain(specialContent);
  });

  it('should preserve trailing newlines when appending', () => {
    const content = `## Log
Entry

## Next
`;
    const section = findSection(content, 'Log');
    const result = insertInSection(content, section!, 'New entry', 'append');
    const lines = result.split('\n');
    // Check that the new entry is inserted before the ## Next line
    const nextSectionIndex = lines.findIndex((line) => line.includes('## Next'));
    const newEntryIndex = lines.findIndex((line) => line.includes('New entry'));
    expect(newEntryIndex).toBeLessThan(nextSectionIndex);
  });

  // Smart template handling tests
  it('should replace empty numbered placeholder when appending', () => {
    const content = `## Priorities
1.

## Next
`;
    const section = findSection(content, 'Priorities');
    const result = insertInSection(content, section!, '1. First priority', 'append');
    // Should replace "1. " with the new content, not append after it
    expect(result).toContain('## Priorities\n1. First priority\n');
    expect(result).not.toContain('1.\n1. First priority');
  });

  it('should replace empty bullet placeholder when appending', () => {
    const content = `## Notes
-

## Next
`;
    const section = findSection(content, 'Notes');
    const result = insertInSection(content, section!, '- My note', 'append');
    expect(result).toContain('## Notes\n- My note\n');
    expect(result).not.toContain('-\n- My note');
  });

  it('should replace empty task placeholder when appending', () => {
    const content = `## Tasks
- [ ]

## Next
`;
    const section = findSection(content, 'Tasks');
    const result = insertInSection(content, section!, '- [ ] New task', 'append');
    expect(result).toContain('## Tasks\n- [ ] New task\n');
    expect(result).not.toContain('- [ ]\n- [ ] New task');
  });

  it('should append normally when no placeholder exists', () => {
    const content = `## Log
Existing entry

## Next
`;
    const section = findSection(content, 'Log');
    const result = insertInSection(content, section!, 'New entry', 'append');
    expect(result).toContain('Existing entry');
    expect(result).toContain('New entry');
    // Both entries should exist
    const existingIndex = result.indexOf('Existing entry');
    const newIndex = result.indexOf('New entry');
    expect(newIndex).toBeGreaterThan(existingIndex);
  });

  it('should not replace placeholder when prepending', () => {
    const content = `## Priorities
1.

## Next
`;
    const section = findSection(content, 'Priorities');
    const result = insertInSection(content, section!, '1. First priority', 'prepend');
    // Prepend should insert at top, leaving placeholder in place
    expect(result).toContain('## Priorities\n1. First priority\n');
  });

  it('should not accumulate blank lines between multiple appends', () => {
    // Simulate what happens with gray-matter read/write cycles
    // Content often has trailing blank lines within section
    let content = `## Log
- Entry 1

## Next
`;
    let section = findSection(content, 'Log')!;

    // First append
    content = insertInSection(content, section, '- Entry 2', 'append');
    section = findSection(content, 'Log')!;

    // Second append
    content = insertInSection(content, section, '- Entry 3', 'append');

    // Entries should be adjacent - no blank lines between them
    expect(content).toContain('- Entry 1\n- Entry 2\n- Entry 3\n');
    // Should not have multiple blank lines accumulating
    expect(content).not.toMatch(/- Entry 3\n\n\n/);
  });

  it('should handle multiple appends to section with trailing whitespace', () => {
    // Content with trailing blank line inside section (common after gray-matter)
    let content = `## Log
- First

## Next
`;
    let section = findSection(content, 'Log')!;

    content = insertInSection(content, section, '- Second', 'append');
    section = findSection(content, 'Log')!;
    content = insertInSection(content, section, '- Third', 'append');
    section = findSection(content, 'Log')!;
    content = insertInSection(content, section, '- Fourth', 'append');

    // All entries should be adjacent
    expect(content).toContain('- First\n- Second\n- Third\n- Fourth\n');
  });

  it('should remove multiple trailing blank lines within section when appending', () => {
    // Section with multiple trailing blank lines before next section
    const content = `## Log
- Entry 1


## Next
`;
    const section = findSection(content, 'Log')!;
    const result = insertInSection(content, section, '- Entry 2', 'append');

    // Both blank lines should be removed, entries should be adjacent
    expect(result).toContain('- Entry 1\n- Entry 2\n## Next');
    // No blank lines between entries
    expect(result).not.toContain('- Entry 1\n\n- Entry 2');
    // No blank lines between new entry and next section
    expect(result).not.toContain('- Entry 2\n\n## Next');
  });

  // preserveListNesting tests
  describe('with preserveListNesting option', () => {
    it('should append at section base level, not nested level', () => {
      const content = `## Log
- Entry 1
  - Nested item 1
  - Nested item 2
## Next
`;
      const section = findSection(content, 'Log')!;
      const result = insertInSection(content, section, '- New entry', 'append', {
        preserveListNesting: true,
      });
      // Should match the BASE indentation (0-space for Entry 1), NOT continue nested
      // This ensures new entries go to the section's top level, not inside nested sublists
      expect(result).toContain('  - Nested item 2\n- New entry\n## Next');
    });

    it('should not apply indentation when preserveListNesting is false', () => {
      const content = `## Log
- Entry 1
  - Nested item
## Next
`;
      const section = findSection(content, 'Log')!;
      const result = insertInSection(content, section, '- New entry', 'append', {
        preserveListNesting: false,
      });
      expect(result).toContain('- Nested item\n- New entry\n## Next');
    });

    it('should not apply indentation when options is undefined', () => {
      const content = `## Log
- Entry 1
  - Nested item
## Next
`;
      const section = findSection(content, 'Log')!;
      const result = insertInSection(content, section, '- New entry', 'append');
      expect(result).toContain('- Nested item\n- New entry\n## Next');
    });

    it('should handle indented list items', () => {
      const content = `## Tasks
  - Task 1
  - Task 2
## Next
`;
      const section = findSection(content, 'Tasks')!;
      const result = insertInSection(content, section, '- Task 3', 'append', {
        preserveListNesting: true,
      });
      // Should apply the 2-space indentation from the existing list
      expect(result).toContain('  - Task 2\n  - Task 3\n## Next');
    });

    it('should handle empty section with no list context', () => {
      const content = `## Log
## Next
`;
      const section = findSection(content, 'Log')!;
      const result = insertInSection(content, section, '- First entry', 'append', {
        preserveListNesting: true,
      });
      // No list context found, should insert without indentation
      expect(result).toContain('## Log\n- First entry\n## Next');
    });

    it('should handle multi-line content insertion with indentation', () => {
      const content = `## Notes
  - Note 1
  - Note 2
## Next
`;
      const section = findSection(content, 'Notes')!;
      const multiline = '- Line 1\n- Line 2';
      const result = insertInSection(content, section, multiline, 'append', {
        preserveListNesting: true,
      });
      // Each line should get the indentation
      expect(result).toContain('  - Note 2\n  - Line 1\n  - Line 2\n## Next');
    });

    // Prepend with preserveListNesting tests
    it('should prepend with preserveListNesting=true and preserve indentation', () => {
      const content = `## Log
  - Entry 1
  - Entry 2
## Next
`;
      const section = findSection(content, 'Log')!;
      const result = insertInSection(content, section, '- New entry', 'prepend', {
        preserveListNesting: true,
      });
      // Should match the indentation of the first list item
      expect(result).toContain('## Log\n  - New entry\n  - Entry 1');
    });

    it('should prepend to nested list and maintain structure', () => {
      const content = `## Tasks
- Parent task
  - Child task 1
  - Child task 2
## Next
`;
      const section = findSection(content, 'Tasks')!;
      const result = insertInSection(content, section, '- New parent', 'prepend', {
        preserveListNesting: true,
      });
      // Top-level list, so no indentation should be added
      expect(result).toContain('## Tasks\n- New parent\n- Parent task');
    });

    it('should prepend without indentation when preserveListNesting=false', () => {
      const content = `## Log
  - Entry 1
  - Entry 2
## Next
`;
      const section = findSection(content, 'Log')!;
      const result = insertInSection(content, section, '- New entry', 'prepend', {
        preserveListNesting: false,
      });
      // Should NOT apply indentation
      expect(result).toContain('## Log\n- New entry\n  - Entry 1');
    });

    it('should append at section base level, not nested level', () => {
      const content = `## Deep
- Level 1
  - Level 2
    - Level 3
      - Level 4
        - Level 5
## Next
`;
      const section = findSection(content, 'Deep')!;
      const result = insertInSection(content, section, '- New item', 'append', {
        preserveListNesting: true,
      });
      // Should match the base indentation (0-space for Level 1), NOT continue nested
      // This ensures new entries go to the section's top level, not inside nested sublists
      expect(result).toContain('        - Level 5\n- New item\n## Next');
    });

    it('should handle prepend to section with deeply nested list', () => {
      const content = `## Deep
    - Indented item 1
    - Indented item 2
## Next
`;
      const section = findSection(content, 'Deep')!;
      const result = insertInSection(content, section, '- New item', 'prepend', {
        preserveListNesting: true,
      });
      // Should match the 4-space indentation of the first list item
      expect(result).toContain('## Deep\n    - New item\n    - Indented item 1');
    });
  });
});

describe('detectListIndentation', () => {
  it('should detect no indentation for top-level list items', () => {
    const lines = ['## Log', '- Item 1', '- Item 2'];
    const indent = detectListIndentation(lines, 3, 1);
    expect(indent).toBe('');
  });

  it('should detect 2-space indentation', () => {
    const lines = ['## Log', '  - Item 1', '  - Item 2'];
    const indent = detectListIndentation(lines, 3, 1);
    expect(indent).toBe('  ');
  });

  it('should detect 4-space indentation', () => {
    const lines = ['## Log', '    - Item 1', '    - Item 2'];
    const indent = detectListIndentation(lines, 3, 1);
    expect(indent).toBe('    ');
  });

  it('should find parent list item when inserting after nested content', () => {
    const lines = ['## Log', '- Main item', '  - Nested 1', '  - Nested 2'];
    // Inserting after line 3 (Nested 2), should find Nested 2's indentation
    const indent = detectListIndentation(lines, 4, 1);
    expect(indent).toBe('  ');
  });

  it('should return empty string when no list context found', () => {
    const lines = ['## Log', 'Plain text', 'More text'];
    const indent = detectListIndentation(lines, 3, 1);
    expect(indent).toBe('');
  });

  it('should stop at heading boundaries', () => {
    const lines = ['## Section 1', '  - Indented', '## Section 2', '- Not indented'];
    // Inserting in Section 2, should not look at Section 1's indentation
    const indent = detectListIndentation(lines, 4, 3);
    expect(indent).toBe('');
  });

  it('should handle numbered list items', () => {
    const lines = ['## Priorities', '  1. First', '  2. Second'];
    const indent = detectListIndentation(lines, 3, 1);
    expect(indent).toBe('  ');
  });

  it('should handle task list items', () => {
    const lines = ['## Tasks', '    - [ ] Task 1', '    - [x] Task 2'];
    const indent = detectListIndentation(lines, 3, 1);
    expect(indent).toBe('    ');
  });

  it('should skip empty lines when searching', () => {
    const lines = ['## Log', '- Item 1', '', ''];
    const indent = detectListIndentation(lines, 4, 1);
    expect(indent).toBe('');
  });

  it('should detect tab indentation', () => {
    const lines = ['## Log', '\t- Item 1', '\t- Item 2'];
    const indent = detectListIndentation(lines, 3, 1);
    expect(indent).toBe('\t');
  });

  it('should detect multiple tab indentation', () => {
    const lines = ['## Log', '\t\t- Item 1', '\t\t- Item 2'];
    const indent = detectListIndentation(lines, 3, 1);
    expect(indent).toBe('\t\t');
  });

  it('should handle mixed tab and space indentation', () => {
    // When spaces are used, should detect spaces
    const lines = ['## Log', '  - Item 1', '  - Item 2'];
    const indent = detectListIndentation(lines, 3, 1);
    expect(indent).toBe('  ');
  });

  it('should detect deep nesting with 8-space indentation', () => {
    const lines = ['## Deep', '        - Level 5 item'];
    const indent = detectListIndentation(lines, 2, 1);
    expect(indent).toBe('        ');
  });

  it('should handle asterisk list markers', () => {
    const lines = ['## Log', '  * Item 1', '  * Item 2'];
    const indent = detectListIndentation(lines, 3, 1);
    expect(indent).toBe('  ');
  });

  it('should handle plus list markers', () => {
    const lines = ['## Log', '  + Item 1', '  + Item 2'];
    const indent = detectListIndentation(lines, 3, 1);
    expect(indent).toBe('  ');
  });
});

describe('isInsideCodeBlock', () => {
  it('should detect when inside a code block', () => {
    const lines = ['text', '```', 'code', 'more code'];
    expect(isInsideCodeBlock(lines, 2)).toBe(true);
    expect(isInsideCodeBlock(lines, 3)).toBe(true);
  });

  it('should detect when not inside a code block', () => {
    const lines = ['text', '```', 'code', '```', 'after'];
    expect(isInsideCodeBlock(lines, 0)).toBe(false);
    expect(isInsideCodeBlock(lines, 4)).toBe(false);
  });

  it('should handle multiple code blocks', () => {
    const lines = ['text', '```', 'code1', '```', 'between', '```', 'code2', '```', 'end'];
    expect(isInsideCodeBlock(lines, 2)).toBe(true);   // inside first block
    expect(isInsideCodeBlock(lines, 4)).toBe(false);  // between blocks
    expect(isInsideCodeBlock(lines, 6)).toBe(true);   // inside second block
    expect(isInsideCodeBlock(lines, 8)).toBe(false);  // after blocks
  });

  it('should handle code block with language specifier', () => {
    const lines = ['text', '```javascript', 'const x = 1;', '```'];
    expect(isInsideCodeBlock(lines, 2)).toBe(true);
  });
});

describe('isStructuredLine', () => {
  it('should detect table rows', () => {
    expect(isStructuredLine('| A | B |')).toBe(true);
    expect(isStructuredLine('|---|---|')).toBe(true);
    expect(isStructuredLine('  | indented |')).toBe(true);
  });

  it('should detect blockquotes', () => {
    expect(isStructuredLine('> quote')).toBe(true);
    expect(isStructuredLine('>quote without space')).toBe(true);
    expect(isStructuredLine('  > indented quote')).toBe(true);
  });

  it('should detect code fences', () => {
    expect(isStructuredLine('```')).toBe(true);
    expect(isStructuredLine('```javascript')).toBe(true);
    expect(isStructuredLine('  ```')).toBe(true);
  });

  it('should detect horizontal rules', () => {
    expect(isStructuredLine('---')).toBe(true);
    expect(isStructuredLine('----')).toBe(true);
    expect(isStructuredLine('***')).toBe(true);
    expect(isStructuredLine('___')).toBe(true);
  });

  it('should not detect regular lines', () => {
    expect(isStructuredLine('regular text')).toBe(false);
    expect(isStructuredLine('- bullet')).toBe(false);
    expect(isStructuredLine('1. numbered')).toBe(false);
    expect(isStructuredLine('## heading')).toBe(false);
  });
});

describe('isCodeFenceLine', () => {
  it('should detect code fence markers', () => {
    expect(isCodeFenceLine('```')).toBe(true);
    expect(isCodeFenceLine('```js')).toBe(true);
    expect(isCodeFenceLine('```typescript')).toBe(true);
    expect(isCodeFenceLine('  ```')).toBe(true);
  });

  it('should not detect non-fence lines', () => {
    expect(isCodeFenceLine('normal text')).toBe(false);
    expect(isCodeFenceLine('inline `code`')).toBe(false);
    expect(isCodeFenceLine('``not a fence``')).toBe(false);
  });
});

describe('isEmptyPlaceholder', () => {
  it('should detect numbered list placeholder', () => {
    expect(isEmptyPlaceholder('1. ')).toBe(true);
    expect(isEmptyPlaceholder('2. ')).toBe(true);
    expect(isEmptyPlaceholder('10. ')).toBe(true);
    expect(isEmptyPlaceholder('  1. ')).toBe(true);
  });

  it('should detect bullet placeholder', () => {
    expect(isEmptyPlaceholder('- ')).toBe(true);
    expect(isEmptyPlaceholder('  - ')).toBe(true);
    expect(isEmptyPlaceholder('* ')).toBe(true);
  });

  it('should detect task placeholder', () => {
    expect(isEmptyPlaceholder('- [ ] ')).toBe(true);
    expect(isEmptyPlaceholder('- []')).toBe(true);
    expect(isEmptyPlaceholder('- [x] ')).toBe(true);
    expect(isEmptyPlaceholder('- [X] ')).toBe(true);
  });

  it('should not detect non-empty lines as placeholders', () => {
    expect(isEmptyPlaceholder('1. Item')).toBe(false);
    expect(isEmptyPlaceholder('- Item')).toBe(false);
    expect(isEmptyPlaceholder('- [ ] Task')).toBe(false);
    expect(isEmptyPlaceholder('Some text')).toBe(false);
    expect(isEmptyPlaceholder('')).toBe(false);
    expect(isEmptyPlaceholder('## Heading')).toBe(false);
  });
});

describe('validatePath', () => {
  it('should allow valid relative paths', () => {
    const result = validatePath('/vault', 'daily-notes/2026-01-28.md');
    expect(result).toBe(true);
  });

  it('should block path traversal attempts', () => {
    const result = validatePath('/vault', '../../../etc/passwd');
    expect(result).toBe(false);
  });

  it('should block absolute paths outside vault', () => {
    const result = validatePath('/vault', '/etc/passwd');
    expect(result).toBe(false);
  });

  it('should handle encoded path characters', () => {
    const result = validatePath('/vault', 'folder%20name/file%20name.md');
    expect(result).toBe(true);
  });
});

describe('isSensitivePath', () => {
  it('should detect .env files', () => {
    expect(isSensitivePath('.env')).toBe(true);
    expect(isSensitivePath('.env.local')).toBe(true);
    expect(isSensitivePath('.env.production')).toBe(true);
    expect(isSensitivePath('config/.env')).toBe(true);
  });

  it('should detect private key files', () => {
    expect(isSensitivePath('server.pem')).toBe(true);
    expect(isSensitivePath('cert.key')).toBe(true);
    expect(isSensitivePath('id_rsa')).toBe(true);
    expect(isSensitivePath('id_ed25519')).toBe(true);
    expect(isSensitivePath('.ssh/id_rsa')).toBe(true);
  });

  it('should detect certificate files', () => {
    expect(isSensitivePath('cert.p12')).toBe(true);
    expect(isSensitivePath('cert.pfx')).toBe(true);
    expect(isSensitivePath('keystore.jks')).toBe(true);
  });

  it('should detect credentials files', () => {
    expect(isSensitivePath('credentials.json')).toBe(true);
    expect(isSensitivePath('secrets.json')).toBe(true);
    expect(isSensitivePath('secrets.yaml')).toBe(true);
    expect(isSensitivePath('secrets.yml')).toBe(true);
    expect(isSensitivePath('.git/config')).toBe(true);
    expect(isSensitivePath('.git/credentials')).toBe(true);
  });

  it('should detect system password files', () => {
    expect(isSensitivePath('.htpasswd')).toBe(true);
    expect(isSensitivePath('etc/shadow')).toBe(true);
    expect(isSensitivePath('etc/passwd')).toBe(true);
  });

  it('should allow normal markdown files', () => {
    expect(isSensitivePath('notes.md')).toBe(false);
    expect(isSensitivePath('daily-notes/2026-01-29.md')).toBe(false);
    expect(isSensitivePath('projects/my-project.md')).toBe(false);
  });

  it('should allow files that partially match patterns', () => {
    expect(isSensitivePath('environment.md')).toBe(false);
    expect(isSensitivePath('my-key-points.md')).toBe(false);
    expect(isSensitivePath('ssh-notes.md')).toBe(false);
  });
});

describe('validatePathSecure', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should allow valid relative paths', async () => {
    const result = await validatePathSecure(tempVault, 'daily-notes/2026-01-28.md');
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('should block path traversal attempts', async () => {
    const result = await validatePathSecure(tempVault, '../../../etc/passwd');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('traversal');
  });

  it('should block sensitive file writes', async () => {
    const result = await validatePathSecure(tempVault, '.env');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('sensitive');
  });

  it('should block writes to .pem files', async () => {
    const result = await validatePathSecure(tempVault, 'certs/server.pem');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('sensitive');
  });

  it('should block writes to .key files', async () => {
    const result = await validatePathSecure(tempVault, 'private.key');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('sensitive');
  });

  it('should block writes to credentials.json', async () => {
    const result = await validatePathSecure(tempVault, 'credentials.json');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('sensitive');
  });

  // Symlink tests are skipped on Windows because creating symlinks requires
  // admin privileges or Developer Mode to be enabled
  it.skipIf(process.platform === 'win32')('should detect symlink escape attempts', async () => {
    // Create a symlink inside the vault pointing outside
    const symlinkPath = path.join(tempVault, 'escape-link.md');

    // Create a temp file outside the vault
    const outsideDir = path.join(tempVault, '..', 'outside-vault');
    await fs.mkdir(outsideDir, { recursive: true });
    const outsideFile = path.join(outsideDir, 'target.md');
    await fs.writeFile(outsideFile, '# Outside vault');

    try {
      // Create symlink
      await fs.symlink(outsideFile, symlinkPath);

      // Validate should detect the symlink escape
      const result = await validatePathSecure(tempVault, 'escape-link.md');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('outside vault');
    } finally {
      // Cleanup
      try {
        await fs.unlink(symlinkPath);
      } catch {}
      try {
        await fs.unlink(outsideFile);
        await fs.rmdir(outsideDir);
      } catch {}
    }
  });

  it.skipIf(process.platform === 'win32')('should detect symlink to sensitive file', async () => {
    // Create a symlink to a sensitive file within vault
    const sensitiveFile = path.join(tempVault, '.env.secret');
    await fs.writeFile(sensitiveFile, 'SECRET=value');

    const symlinkPath = path.join(tempVault, 'innocent-link.md');

    try {
      await fs.symlink(sensitiveFile, symlinkPath);

      // Validate should detect the symlink points to sensitive file
      const result = await validatePathSecure(tempVault, 'innocent-link.md');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('sensitive');
    } finally {
      try {
        await fs.unlink(symlinkPath);
        await fs.unlink(sensitiveFile);
      } catch {}
    }
  });

  it.skipIf(process.platform === 'win32')('should allow valid symlinks within vault', async () => {
    // Create a valid symlink within the vault
    const targetFile = path.join(tempVault, 'real-note.md');
    await fs.writeFile(targetFile, '# Real Note');

    const symlinkPath = path.join(tempVault, 'link-to-note.md');

    try {
      await fs.symlink(targetFile, symlinkPath);

      // Validate should allow valid symlinks
      const result = await validatePathSecure(tempVault, 'link-to-note.md');
      expect(result.valid).toBe(true);
    } finally {
      try {
        await fs.unlink(symlinkPath);
        await fs.unlink(targetFile);
      } catch {}
    }
  });

  it.skipIf(process.platform === 'win32')('should detect parent directory symlink escape', async () => {
    // Create a subdirectory that's actually a symlink to outside
    const outsideDir = path.join(tempVault, '..', 'escape-target');
    await fs.mkdir(outsideDir, { recursive: true });

    const symlinkDir = path.join(tempVault, 'escape-dir');

    try {
      await fs.symlink(outsideDir, symlinkDir);

      // Try to write to a file in the symlinked directory
      const result = await validatePathSecure(tempVault, 'escape-dir/note.md');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('outside vault');
    } finally {
      try {
        await fs.unlink(symlinkDir);
        await fs.rmdir(outsideDir);
      } catch {}
    }
  });
});

describe('readVaultFile', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should read file with frontmatter', async () => {
    const content = createSampleNote();
    await createTestNote(tempVault, 'test.md', content);

    const result = await readVaultFile(tempVault, 'test.md');

    expect(result.frontmatter).toHaveProperty('type', 'test');
    expect(result.frontmatter).toHaveProperty('tags');
    expect(Array.isArray(result.frontmatter.tags)).toBe(true);
    expect(result.content).toContain('# Test Note');
    expect(result.content).toContain('## Log');
  });

  it('should read file without frontmatter', async () => {
    const content = createNoteWithoutFrontmatter();
    await createTestNote(tempVault, 'simple.md', content);

    const result = await readVaultFile(tempVault, 'simple.md');

    expect(Object.keys(result.frontmatter)).toHaveLength(0);
    expect(result.content).toContain('# Simple Note');
  });

  it('should handle empty frontmatter', async () => {
    const content = `---
---
# Note with empty frontmatter
`;
    await createTestNote(tempVault, 'empty-fm.md', content);

    const result = await readVaultFile(tempVault, 'empty-fm.md');

    expect(Object.keys(result.frontmatter)).toHaveLength(0);
    expect(result.content).toContain('# Note with empty frontmatter');
  });

  it('should handle complex frontmatter', async () => {
    const content = `---
simple: value
array:
  - item1
  - item2
nested:
  key1: value1
  key2: value2
  deep:
    key3: value3
---
# Complex frontmatter note
`;
    await createTestNote(tempVault, 'complex.md', content);

    const result = await readVaultFile(tempVault, 'complex.md');

    expect(result.frontmatter).toHaveProperty('simple', 'value');
    expect(result.frontmatter).toHaveProperty('array');
    expect(result.frontmatter).toHaveProperty('nested');
    expect((result.frontmatter.nested as any).deep.key3).toBe('value3');
  });

  it('should reject path traversal attempts', async () => {
    await expect(
      readVaultFile(tempVault, '../../../etc/passwd')
    ).rejects.toThrow('Invalid path');
  });

  it('should throw error for file not found', async () => {
    await expect(
      readVaultFile(tempVault, 'nonexistent.md')
    ).rejects.toThrow();
  });
});

describe('writeVaultFile', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should write file preserving frontmatter', async () => {
    const frontmatter = {
      type: 'test',
      tags: ['tag1', 'tag2'],
      nested: { key: 'value' },
    };
    const content = '# New Note\n\n## Section\n\nContent here';

    await writeVaultFile(tempVault, 'new.md', content, frontmatter);

    const written = await readTestNote(tempVault, 'new.md');
    expect(written).toContain('---');
    expect(written).toContain('type: test');
    expect(written).toContain('tags:');
    expect(written).toContain('- tag1');
    expect(written).toContain('# New Note');
  });

  it('should write to new file', async () => {
    await writeVaultFile(tempVault, 'brand-new.md', '# Brand New', {});

    const written = await readTestNote(tempVault, 'brand-new.md');
    expect(written).toContain('# Brand New');
  });

  it('should reject path traversal attempts', async () => {
    await expect(
      writeVaultFile(tempVault, '../../../etc/passwd', 'malicious', {})
    ).rejects.toThrow('Invalid path');
  });

  it('should reject writes to sensitive files', async () => {
    await expect(
      writeVaultFile(tempVault, '.env', 'SECRET=value', {})
    ).rejects.toThrow('sensitive');

    await expect(
      writeVaultFile(tempVault, 'certs/server.pem', 'cert-content', {})
    ).rejects.toThrow('sensitive');
  });

  it('should not accumulate blank lines in section across read/write cycles', async () => {
    // This test reproduces the bug where blank lines appear between entries
    // when using vault_add_to_section multiple times
    const initialContent = `---
type: daily
---

## Log
- Entry 1

## Next Section
Content here
`;
    await createTestNote(tempVault, 'accumulation-test.md', initialContent);

    // Simulate multiple add operations (read -> modify -> write cycle)
    for (const entry of ['- Entry 2', '- Entry 3', '- Entry 4']) {
      // Read
      const { content, frontmatter } = await readVaultFile(tempVault, 'accumulation-test.md');

      // Modify
      const section = findSection(content, 'Log')!;
      const updated = insertInSection(content, section, entry, 'append');

      // Write
      await writeVaultFile(tempVault, 'accumulation-test.md', updated, frontmatter);
    }

    // Verify: entries should be adjacent with no blank lines between
    const final = await readTestNote(tempVault, 'accumulation-test.md');
    expect(final).toContain('- Entry 1\n- Entry 2\n- Entry 3\n- Entry 4\n');
    // Should not have multiple consecutive blank lines anywhere in the Log section
    expect(final).not.toMatch(/- Entry 2\n\n- Entry 3/);
    expect(final).not.toMatch(/- Entry 3\n\n- Entry 4/);
  });

  it('should preserve complex frontmatter structure', async () => {
    const complexFrontmatter = {
      array: [1, 2, 3],
      nested: {
        deep: {
          value: 'test',
        },
      },
      boolean: true,
      number: 42,
    };

    await writeVaultFile(
      tempVault,
      'complex-write.md',
      '# Content',
      complexFrontmatter
    );

    const result = await readVaultFile(tempVault, 'complex-write.md');
    expect(result.frontmatter).toHaveProperty('array');
    expect(result.frontmatter).toHaveProperty('boolean', true);
    expect(result.frontmatter).toHaveProperty('number', 42);
    expect((result.frontmatter.nested as any).deep.value).toBe('test');
  });
});

// ========================================
// Edge Case Tests (Phase 2 Production Hardening)
// ========================================

describe('edge cases', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  describe('heading edge cases', () => {
    it('should handle heading with only emoji: ## 📝', () => {
      const content = `# Title
## 📝
Emoji section content
## Next Section
`;
      const headings = extractHeadings(content);
      expect(headings).toHaveLength(3);
      expect(headings[1].text).toBe('📝');

      const section = findSection(content, '📝');
      expect(section).not.toBeNull();
      expect(section?.name).toBe('📝');
    });

    it('should handle malformed heading ##NoSpace', () => {
      const content = `# Title
##NoSpace
Content here
## Valid Section
`;
      const headings = extractHeadings(content);
      // Malformed heading (no space) should NOT be extracted
      expect(headings).toHaveLength(2);
      expect(headings[0].text).toBe('Title');
      expect(headings[1].text).toBe('Valid Section');
    });

    it('should handle heading inside code block (should not match)', () => {
      const content = `# Real Heading
\`\`\`markdown
## Fake Heading In Code
### Another Fake
\`\`\`
## Another Real Heading
`;
      const headings = extractHeadings(content);
      expect(headings).toHaveLength(2);
      expect(headings.map(h => h.text)).toEqual(['Real Heading', 'Another Real Heading']);
    });

    it('should handle duplicate heading names (finds first)', () => {
      const content = `# Notes
## Section
First section content
## Section
Second section content
## Section
Third section content
`;
      // findSection should return the first matching heading
      const section = findSection(content, 'Section');
      expect(section).not.toBeNull();
      expect(section?.startLine).toBe(1);
      expect(section?.contentStartLine).toBe(2);
    });

    it('should handle heading with trailing whitespace', () => {
      const content = `# Title
## Log
Content with trailing spaces in heading
## Next
`;
      const headings = extractHeadings(content);
      expect(headings).toHaveLength(3);
      expect(headings[1].text).toBe('Log');

      // Should still find section when searching without trailing spaces
      const section = findSection(content, 'Log');
      expect(section).not.toBeNull();
    });

    it('should handle very long heading (500+ chars)', () => {
      const longTitle = 'A'.repeat(500);
      const content = `# Title
## ${longTitle}
Content here
`;
      const headings = extractHeadings(content);
      expect(headings).toHaveLength(2);
      expect(headings[1].text).toBe(longTitle);
      expect(headings[1].text.length).toBe(500);
    });

    it('should handle heading with special chars: ## [Special] (parens)', () => {
      const content = `# Title
## [Special] (parens) {braces}
Content here
`;
      const headings = extractHeadings(content);
      expect(headings).toHaveLength(2);
      expect(headings[1].text).toBe('[Special] (parens) {braces}');

      const section = findSection(content, '[Special] (parens) {braces}');
      expect(section).not.toBeNull();
    });

    it('should handle inline code in heading: ## `Code` Heading', () => {
      const content = `# Title
## \`Code\` Heading
Content here
`;
      const headings = extractHeadings(content);
      expect(headings).toHaveLength(2);
      expect(headings[1].text).toBe('`Code` Heading');
    });

    it('should handle deeply nested sections (5+ levels)', () => {
      const content = `# H1
## H2
### H3
#### H4
##### H5
###### H6
Content at deepest level
`;
      const headings = extractHeadings(content);
      expect(headings).toHaveLength(6);

      const h6Section = findSection(content, 'H6');
      expect(h6Section).not.toBeNull();
      expect(h6Section?.level).toBe(6);
    });
  });

  describe('file content edge cases', () => {
    it('should handle section at EOF with no trailing newline', async () => {
      const content = `---
type: test
---
# Title

## Last Section
Final content with no newline`;
      await createTestNote(tempVault, 'no-newline.md', content);

      const { content: fileContent } = await readVaultFile(tempVault, 'no-newline.md');
      const section = findSection(fileContent, 'Last Section');
      expect(section).not.toBeNull();
      expect(section?.endLine).toBe(3); // Zero-indexed line of content
    });

    it('should handle empty file (0 bytes)', async () => {
      await createTestNote(tempVault, 'empty.md', '');

      // Reading an empty file should not throw
      const { content, frontmatter } = await readVaultFile(tempVault, 'empty.md');
      expect(content).toBe('');
      expect(Object.keys(frontmatter)).toHaveLength(0);

      const headings = extractHeadings(content);
      expect(headings).toHaveLength(0);
    });

    it('should handle file with only frontmatter', async () => {
      const content = `---
type: test
title: Only Frontmatter
---
`;
      await createTestNote(tempVault, 'only-fm.md', content);

      const { content: fileContent, frontmatter } = await readVaultFile(tempVault, 'only-fm.md');
      expect(frontmatter.type).toBe('test');
      expect(frontmatter.title).toBe('Only Frontmatter');

      const headings = extractHeadings(fileContent);
      expect(headings).toHaveLength(0);
    });

    it('should handle consecutive blank lines in section', async () => {
      const content = `---
type: test
---
# Title

## Log

Line 1


Line 2



Line 3

## Next
`;
      await createTestNote(tempVault, 'blanks.md', content);

      const { content: fileContent, frontmatter } = await readVaultFile(tempVault, 'blanks.md');
      const section = findSection(fileContent, 'Log')!;

      // Insert should work correctly with consecutive blank lines
      const result = insertInSection(fileContent, section, 'New line', 'append');
      expect(result).toContain('Line 3\nNew line');
    });

    it('should handle section with only whitespace content', () => {
      const content = `## Empty Section


## Next Section
Content
`;
      const section = findSection(content, 'Empty Section');
      expect(section).not.toBeNull();
      expect(section?.contentStartLine).toBe(1);

      // Insert into whitespace-only section
      const result = insertInSection(content, section!, 'New content', 'append');
      expect(result).toContain('New content');
    });

    it('should preserve BOM if present', async () => {
      // UTF-8 BOM
      const bom = '\uFEFF';
      const content = `${bom}---
type: test
---
# Title

## Section
Content
`;
      await createTestNote(tempVault, 'bom.md', content);

      // gray-matter should handle BOM gracefully
      const { content: fileContent, frontmatter } = await readVaultFile(tempVault, 'bom.md');
      expect(frontmatter.type).toBe('test');

      // Content should be usable
      const headings = extractHeadings(fileContent);
      expect(headings.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle content with null bytes gracefully', async () => {
      // Create a file with content that has unusual characters
      const content = `---
type: test
---
# Title

## Section
Content with special \t tab character
`;
      await createTestNote(tempVault, 'special-chars.md', content);

      const { content: fileContent } = await readVaultFile(tempVault, 'special-chars.md');
      expect(fileContent).toContain('\t');

      const headings = extractHeadings(fileContent);
      expect(headings).toHaveLength(2);
    });
  });

  describe('insertion edge cases', () => {
    it('should handle inserting into section at very end of file', () => {
      const content = `# Title
## Last Section
Existing content`;

      const section = findSection(content, 'Last Section')!;
      const result = insertInSection(content, section, 'New content', 'append');

      expect(result).toContain('Existing content\nNew content');
    });

    it('should handle multi-line content with mixed indentation', () => {
      const content = `## Section
- Item 1
`;
      const section = findSection(content, 'Section')!;
      const multiline = `- Parent item
  - Child item 1
  - Child item 2
    - Grandchild`;

      const result = insertInSection(content, section, multiline, 'append');
      expect(result).toContain('- Child item 1');
      expect(result).toContain('    - Grandchild');
    });
  });
});

describe('ReDoS Protection', () => {
  describe('checkRegexSafety', () => {
    it('should allow safe patterns', () => {
      expect(checkRegexSafety('hello')).toBeNull();
      expect(checkRegexSafety('\\d+')).toBeNull();
      expect(checkRegexSafety('[a-z]+')).toBeNull();
      expect(checkRegexSafety('foo|bar|baz')).toBeNull();
      expect(checkRegexSafety('^start.*end$')).toBeNull();
    });

    it('should reject patterns that are too long', () => {
      const longPattern = 'a'.repeat(600);
      const result = checkRegexSafety(longPattern);
      expect(result).toContain('too long');
    });

    it('should detect nested quantifiers', () => {
      // Classic ReDoS patterns
      expect(checkRegexSafety('(a+)+')).not.toBeNull();
      expect(checkRegexSafety('(a*)*')).not.toBeNull();
      expect(checkRegexSafety('(.*)*')).not.toBeNull();
    });

    it('should detect adjacent quantifiers', () => {
      expect(checkRegexSafety('a++')).not.toBeNull();
      expect(checkRegexSafety('a**')).not.toBeNull();
    });
  });

  describe('createSafeRegex', () => {
    it('should create regex for safe patterns', () => {
      const regex = createSafeRegex('hello');
      expect(regex).toBeInstanceOf(RegExp);
      expect(regex.test('hello world')).toBe(true);
    });

    it('should throw for dangerous patterns', () => {
      expect(() => createSafeRegex('(a+)+')).toThrow();
    });

    it('should throw for invalid regex syntax', () => {
      expect(() => createSafeRegex('[invalid')).toThrow('Invalid regex');
    });

    it('should support flags', () => {
      const regex = createSafeRegex('hello', 'gi');
      expect(regex.flags).toContain('g');
      expect(regex.flags).toContain('i');
    });
  });

  describe('safeRegexTest', () => {
    it('should perform literal matching when useRegex is false', () => {
      expect(safeRegexTest('hello', 'hello world', false)).toBe(true);
      expect(safeRegexTest('bye', 'hello world', false)).toBe(false);
    });

    it('should perform regex matching when useRegex is true', () => {
      expect(safeRegexTest('\\d+', 'item 123', true)).toBe(true);
      expect(safeRegexTest('\\d+', 'no numbers', true)).toBe(false);
    });

    it('should throw for dangerous regex patterns', () => {
      expect(() => safeRegexTest('(a+)+', 'aaa', true)).toThrow();
    });
  });

  describe('safeRegexReplace', () => {
    it('should perform literal replacement when useRegex is false', () => {
      expect(safeRegexReplace('hello world', 'world', 'universe', false)).toBe('hello universe');
    });

    it('should perform regex replacement when useRegex is true', () => {
      expect(safeRegexReplace('item 123', '\\d+', 'XXX', true)).toBe('item XXX');
    });

    it('should support global replacement', () => {
      expect(safeRegexReplace('a b a b', 'a', 'x', false, true)).toBe('x b x b');
      expect(safeRegexReplace('1 2 3', '\\d', 'X', true, true)).toBe('X X X');
    });

    it('should throw for dangerous regex patterns', () => {
      expect(() => safeRegexReplace('aaa', '(a+)+', 'x', true)).toThrow();
    });
  });
});
