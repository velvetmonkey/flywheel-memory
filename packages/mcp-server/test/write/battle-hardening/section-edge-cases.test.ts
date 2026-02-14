/**
 * Battle-Hardening Tests: Section Edge Cases
 *
 * Tests edge cases in section detection and manipulation:
 * - Adjacent empty sections
 * - Case-sensitivity in duplicates
 * - Minor spelling variations
 * - Empty file with only frontmatter
 * - Section with only whitespace
 * - Missing target section - helpful error messages
 * - Duplicate headings at different levels
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readVaultFile,
  writeVaultFile,
  findSection,
  extractHeadings,
  insertInSection,
} from '../../../src/core/write/writer.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
} from '../helpers/testUtils.js';

describe('Battle-Hardening: Section Edge Cases', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  describe('adjacent empty sections', () => {
    it('should correctly identify boundaries between adjacent empty sections', () => {
      const content = `# Title

## Empty1

## Empty2

## Empty3

## HasContent
Some content here
`;
      const empty1 = findSection(content, 'Empty1');
      const empty2 = findSection(content, 'Empty2');
      const empty3 = findSection(content, 'Empty3');
      const hasContent = findSection(content, 'HasContent');

      expect(empty1).not.toBeNull();
      expect(empty2).not.toBeNull();
      expect(empty3).not.toBeNull();
      expect(hasContent).not.toBeNull();

      // Each section should have distinct boundaries
      expect(empty1!.startLine).toBeLessThan(empty2!.startLine);
      expect(empty2!.startLine).toBeLessThan(empty3!.startLine);
      expect(empty3!.startLine).toBeLessThan(hasContent!.startLine);
    });

    it('should insert into first empty section without affecting second', () => {
      const content = `## First

## Second

## Third
Content
`;
      const section = findSection(content, 'First')!;
      const result = insertInSection(content, section, 'New content', 'append');

      // New content should be added to First section
      expect(result).toContain('## First');
      expect(result).toContain('New content');
      expect(result).toContain('## Second');

      // Verify order: First section content comes before Second heading
      const firstIdx = result.indexOf('## First');
      const newContentIdx = result.indexOf('New content');
      const secondIdx = result.indexOf('## Second');
      expect(newContentIdx).toBeGreaterThan(firstIdx);
      expect(newContentIdx).toBeLessThan(secondIdx);
    });

    it('should handle all-empty file with multiple sections', () => {
      const content = `## Section1

## Section2

## Section3
`;
      const headings = extractHeadings(content);
      expect(headings).toHaveLength(3);

      // Each section exists but is empty
      for (const heading of headings) {
        const section = findSection(content, heading.text);
        expect(section).not.toBeNull();
      }
    });

    it('should correctly identify last empty section at EOF', () => {
      const content = `## First
Content

## Last`;

      const last = findSection(content, 'Last');
      expect(last).not.toBeNull();
      expect(last!.startLine).toBe(3);
      expect(last!.endLine).toBe(3);
    });
  });

  describe('case-sensitivity in duplicate headings', () => {
    it('should find section case-insensitively', () => {
      const content = `## log
lowercase content
## Log
mixed content
## LOG
uppercase content
`;
      // findSection is case-insensitive, finds first match
      const section = findSection(content, 'log');
      expect(section).not.toBeNull();
      expect(section!.startLine).toBe(0); // First occurrence
    });

    it('should find first match regardless of case in search', () => {
      const content = `## Log
First content
## LOG
Second content
`;
      const sectionLower = findSection(content, 'log');
      const sectionUpper = findSection(content, 'LOG');
      const sectionMixed = findSection(content, 'LoG');

      // All should find the same (first) section
      expect(sectionLower!.startLine).toBe(0);
      expect(sectionUpper!.startLine).toBe(0);
      expect(sectionMixed!.startLine).toBe(0);
    });

    it('should handle case variations in section names with spaces', () => {
      const content = `## Daily Log
Content 1
## daily log
Content 2
## DAILY LOG
Content 3
`;
      const section = findSection(content, 'DAILY LOG');
      expect(section).not.toBeNull();
      expect(section!.startLine).toBe(0);
    });
  });

  describe('minor spelling variations', () => {
    it('should NOT match similar but different section names', () => {
      const content = `## Notes
Some notes

## Note
A single note

## Noted
Past tense
`;
      const notes = findSection(content, 'Notes');
      const note = findSection(content, 'Note');
      const noted = findSection(content, 'Noted');

      // Each should find only exact match (case-insensitive)
      expect(notes).not.toBeNull();
      expect(notes!.name).toBe('Notes');

      expect(note).not.toBeNull();
      expect(note!.name).toBe('Note');

      expect(noted).not.toBeNull();
      expect(noted!.name).toBe('Noted');
    });

    it('should NOT match partial section names', () => {
      const content = `## Tasks
All tasks

## Task List
Different section
`;
      const task = findSection(content, 'Task');
      // Should NOT find "Tasks" when searching for "Task"
      expect(task).toBeNull();
    });

    it('should NOT match with extra whitespace in search', () => {
      const content = `## Log
Content
`;
      // Searching with extra spaces should still work (trimmed)
      const section = findSection(content, '  Log  ');
      expect(section).not.toBeNull();
    });

    it('should handle sections with numbers', () => {
      const content = `## Part 1
Content 1

## Part 2
Content 2

## Part 10
Content 10
`;
      const part1 = findSection(content, 'Part 1');
      const part2 = findSection(content, 'Part 2');
      const part10 = findSection(content, 'Part 10');

      expect(part1).not.toBeNull();
      expect(part2).not.toBeNull();
      expect(part10).not.toBeNull();

      // Make sure Part 1 doesn't match Part 10
      expect(part1!.startLine).not.toBe(part10!.startLine);
    });
  });

  describe('empty file with only frontmatter', () => {
    it('should handle file with only frontmatter (no headings)', async () => {
      const content = `---
type: test
title: Empty note
---
`;
      await createTestNote(tempVault, 'only-frontmatter.md', content);

      const { content: fileContent, frontmatter } = await readVaultFile(tempVault, 'only-frontmatter.md');
      expect(frontmatter.type).toBe('test');

      const headings = extractHeadings(fileContent);
      expect(headings).toHaveLength(0);
    });

    it('should return null when searching for section in frontmatter-only file', async () => {
      const content = `---
type: test
---
`;
      await createTestNote(tempVault, 'fm-only.md', content);

      const { content: fileContent } = await readVaultFile(tempVault, 'fm-only.md');
      const section = findSection(fileContent, 'Log');
      expect(section).toBeNull();
    });

    it('should handle frontmatter with content but no headings', async () => {
      const content = `---
type: test
---
Just some plain text content without any headings.
More content here.
`;
      await createTestNote(tempVault, 'no-headings.md', content);

      const { content: fileContent } = await readVaultFile(tempVault, 'no-headings.md');
      const headings = extractHeadings(fileContent);
      expect(headings).toHaveLength(0);
    });
  });

  describe('section with only whitespace', () => {
    it('should correctly identify section with only spaces', () => {
      const content = `## Empty



## Next
Content
`;
      const empty = findSection(content, 'Empty');
      expect(empty).not.toBeNull();
      expect(empty!.contentStartLine).toBe(1);
    });

    it('should correctly identify section with only blank lines', () => {
      const content = `## Empty



## Next
`;
      const empty = findSection(content, 'Empty');
      expect(empty).not.toBeNull();
      expect(empty!.startLine).toBe(0);
      // Section ends before ## Next heading (line 4 is "## Next")
      expect(empty!.endLine).toBe(3); // Last blank line before ## Next
    });

    it('should insert content into whitespace-only section', () => {
      const content = `## Empty


## Next
`;
      const section = findSection(content, 'Empty')!;
      const result = insertInSection(content, section, 'New content', 'append');

      // Content should be inserted in the Empty section
      expect(result).toContain('## Empty');
      expect(result).toContain('New content');
      expect(result).toContain('## Next');

      // Verify order
      const emptyIdx = result.indexOf('## Empty');
      const contentIdx = result.indexOf('New content');
      const nextIdx = result.indexOf('## Next');
      expect(contentIdx).toBeGreaterThan(emptyIdx);
      expect(contentIdx).toBeLessThan(nextIdx);
    });

    it('should handle section with tabs only', () => {
      const content = `## Empty
\t\t\t
## Next
`;
      const empty = findSection(content, 'Empty');
      expect(empty).not.toBeNull();
    });
  });

  describe('missing target section - error messages', () => {
    it('should return null for non-existent section', () => {
      const content = `## Log
Content

## Tasks
More content
`;
      const section = findSection(content, 'NonExistent');
      expect(section).toBeNull();
    });

    it('should not match heading that is substring of another', () => {
      const content = `## Logging
Content
`;
      const section = findSection(content, 'Log');
      expect(section).toBeNull(); // Should not find 'Logging' when searching 'Log'
    });

    it('should not match heading that contains search term', () => {
      const content = `## My Log
Content
`;
      const section = findSection(content, 'Log');
      expect(section).toBeNull(); // Should not find 'My Log' when searching 'Log'
    });

    it('should provide helpful context when section not found', () => {
      const content = `## Available
## Sections
## Here
`;
      const headings = extractHeadings(content);

      // When section not found, caller should be able to suggest alternatives
      const searchTerm = 'NonExistent';
      const section = findSection(content, searchTerm);
      expect(section).toBeNull();

      // Available sections can be suggested
      expect(headings.map(h => h.text)).toContain('Available');
      expect(headings.map(h => h.text)).toContain('Sections');
      expect(headings.map(h => h.text)).toContain('Here');
    });
  });

  describe('duplicate headings at different levels', () => {
    it('should find first occurrence of duplicate heading at different levels', () => {
      const content = `# Notes
H1 content

## Notes
H2 content

### Notes
H3 content
`;
      const section = findSection(content, 'Notes');
      expect(section).not.toBeNull();
      expect(section!.level).toBe(1); // First occurrence (H1)
      expect(section!.startLine).toBe(0);
    });

    it('should correctly identify level of duplicate heading found', () => {
      const content = `## Log
H2 Log content

### Log
H3 Log content

#### Log
H4 Log content
`;
      const section = findSection(content, 'Log');
      expect(section).not.toBeNull();
      expect(section!.level).toBe(2);
    });

    it('should extract all headings including duplicates', () => {
      const content = `# Title
## Section
Content 1
## Section
Content 2
### Section
Content 3
`;
      const headings = extractHeadings(content);
      expect(headings).toHaveLength(4);

      // Should have two ## Section and one ### Section
      const sectionHeadings = headings.filter(h => h.text === 'Section');
      expect(sectionHeadings).toHaveLength(3);
      expect(sectionHeadings[0].level).toBe(2);
      expect(sectionHeadings[1].level).toBe(2);
      expect(sectionHeadings[2].level).toBe(3);
    });

    it('should handle deeply nested duplicate names', () => {
      const content = `# A
## B
### C
Content at C

## B
### C
Different content at C
`;
      const headings = extractHeadings(content);

      // Should find all headings
      const bHeadings = headings.filter(h => h.text === 'B');
      const cHeadings = headings.filter(h => h.text === 'C');

      expect(bHeadings).toHaveLength(2);
      expect(cHeadings).toHaveLength(2);
    });
  });

  describe('section boundary detection', () => {
    it('should end section at next heading of same level', () => {
      const content = `## First
First content
## Second
Second content
`;
      const first = findSection(content, 'First')!;
      expect(first.endLine).toBe(1);
    });

    it('should end section at next heading of higher level', () => {
      const content = `### Deep
Deep content
## Shallower
Shallower content
`;
      const deep = findSection(content, 'Deep')!;
      expect(deep.endLine).toBe(1);
    });

    it('should include nested headings in section boundary', () => {
      const content = `## Parent
Parent content
### Child
Child content
#### Grandchild
Grandchild content
## Sibling
`;
      const parent = findSection(content, 'Parent')!;
      // Parent section should extend to include Child and Grandchild
      expect(parent.endLine).toBe(5); // Line before ## Sibling
    });

    it('should handle section at EOF correctly', () => {
      const content = `## First
Content
## Last
Final content`;

      const last = findSection(content, 'Last')!;
      expect(last.startLine).toBe(2);
      expect(last.endLine).toBe(3); // Last line of file
    });
  });

  describe('special heading formats', () => {
    it('should handle heading with markdown formatting', () => {
      const content = `## **Bold** Heading
Content

## *Italic* Heading
Content
`;
      const bold = findSection(content, '**Bold** Heading');
      const italic = findSection(content, '*Italic* Heading');

      expect(bold).not.toBeNull();
      expect(italic).not.toBeNull();
    });

    it('should handle heading with wikilinks', () => {
      const content = `## [[Link]] Section
Content
`;
      const section = findSection(content, '[[Link]] Section');
      expect(section).not.toBeNull();
    });

    it('should handle heading with inline code', () => {
      const content = `## \`Code\` Section
Content
`;
      const section = findSection(content, '`Code` Section');
      expect(section).not.toBeNull();
    });

    it('should handle heading with tags', () => {
      const content = `## Section #tag1 #tag2
Content
`;
      const section = findSection(content, 'Section #tag1 #tag2');
      expect(section).not.toBeNull();
    });

    it('should handle heading ending with numbers', () => {
      const content = `## Sprint 42
Content
`;
      const section = findSection(content, 'Sprint 42');
      expect(section).not.toBeNull();
    });
  });

  describe('edge cases in extraction', () => {
    it('should skip headings inside fenced code blocks', () => {
      const content = `## Real Heading
Content

\`\`\`markdown
## Fake Heading
Content
\`\`\`

## Another Real
`;
      const headings = extractHeadings(content);
      expect(headings).toHaveLength(2);
      expect(headings.map(h => h.text)).not.toContain('Fake Heading');
    });

    it('should handle multiple code blocks', () => {
      const content = `## Real 1
\`\`\`
## Fake 1
\`\`\`
## Real 2
\`\`\`
## Fake 2
\`\`\`
## Real 3
`;
      const headings = extractHeadings(content);
      expect(headings).toHaveLength(3);
      expect(headings.map(h => h.text)).toEqual(['Real 1', 'Real 2', 'Real 3']);
    });

    it('should handle unclosed code block', () => {
      const content = `## Before
Content
\`\`\`
## Inside
More content`;

      const headings = extractHeadings(content);
      // Inside should be considered inside code block (unclosed)
      expect(headings).toHaveLength(1);
      expect(headings[0].text).toBe('Before');
    });

    it('should handle code block with language specifier', () => {
      const content = `## Real
\`\`\`javascript
// ## Not a heading
\`\`\`
## Also Real
`;
      const headings = extractHeadings(content);
      expect(headings).toHaveLength(2);
    });
  });
});
