/**
 * Security tests for boundary enforcement
 *
 * Validates protection against:
 * - Unicode normalization collisions
 * - Case sensitivity collisions (macOS HFS+)
 * - Extreme content sizes (memory exhaustion)
 * - Deep heading nesting (stack exhaustion)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  extractHeadings,
  findSection,
  formatContent,
  insertInSection,
  validatePath,
  readVaultFile,
  writeVaultFile,
} from '../../../src/core/write/writer.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
} from '../helpers/testUtils.js';
import path from 'path';
import fs from 'fs/promises';

describe('Boundary Enforcement', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  // ========================================
  // Unicode Normalization Collisions
  // ========================================

  describe('Unicode normalization collisions', () => {
    it('should handle NFC vs NFD normalized filenames', async () => {
      // 'é' can be represented as single codepoint (NFC) or e + combining accent (NFD)
      const nfcName = '\u00e9'; // é (precomposed)
      const nfdName = 'e\u0301'; // e + combining acute accent (decomposed)

      // Both should be valid paths (filesystem handles normalization)
      expect(validatePath(tempVault, `${nfcName}.md`)).toBe(true);
      expect(validatePath(tempVault, `${nfdName}.md`)).toBe(true);
    });

    it('should handle full-width vs ASCII characters', async () => {
      // Full-width A (U+FF21) vs ASCII A
      const fullWidthA = '\uFF21'; // Ａ
      const asciiA = 'A';

      const result1 = validatePath(tempVault, `${fullWidthA}.md`);
      const result2 = validatePath(tempVault, `${asciiA}.md`);

      expect(result1).toBe(true);
      expect(result2).toBe(true);

      // These are different files
      await createTestNote(tempVault, `${fullWidthA}.md`, '# Full Width');
      await createTestNote(tempVault, `${asciiA}.md`, '# ASCII');

      const content1 = await readTestNote(tempVault, `${fullWidthA}.md`);
      const content2 = await readTestNote(tempVault, `${asciiA}.md`);

      expect(content1).toContain('Full Width');
      expect(content2).toContain('ASCII');
    });

    it('should handle homoglyph filenames', async () => {
      // Cyrillic 'а' (U+0430) vs Latin 'a' (U+0061)
      const cyrillicA = '\u0430';
      const latinA = 'a';

      await createTestNote(tempVault, `${cyrillicA}bc.md`, '# Cyrillic');
      await createTestNote(tempVault, `${latinA}bc.md`, '# Latin');

      // Both should exist as separate files
      const files = await fs.readdir(tempVault);
      // Depending on filesystem, they may or may not collide
      expect(files.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle Unicode combining characters in headings', async () => {
      const content = `---
title: Test
---
# Te\u0301st Note

## Se\u0301ction One

Content here
`;
      await createTestNote(tempVault, 'unicode.md', content);

      const result = await readVaultFile(tempVault, 'unicode.md');
      const headings = extractHeadings(result.content);

      expect(headings.length).toBe(2);
    });

    it('should handle zero-width joiner in content', async () => {
      // ZWJ can combine emoji
      const content = `---
title: Test
---
# Test

Family emoji: \u{1F468}\u200D\u{1F469}\u200D\u{1F467}
`;
      await createTestNote(tempVault, 'zwj.md', content);
      const result = await readTestNote(tempVault, 'zwj.md');

      expect(result).toContain('\u200D'); // ZWJ preserved
    });

    it('should handle bidirectional text in filenames', async () => {
      // Hebrew + Latin mix
      const mixedName = 'hello-שלום.md';

      await createTestNote(tempVault, mixedName, '# Mixed Text');
      const result = await readTestNote(tempVault, mixedName);

      expect(result).toContain('Mixed Text');
    });
  });

  // ========================================
  // Case Sensitivity Handling
  // ========================================

  describe('Case sensitivity handling', () => {
    it('should handle same filename with different cases', async () => {
      // On case-sensitive filesystems, these are different files
      // On case-insensitive (macOS HFS+), they're the same
      await createTestNote(tempVault, 'Note.md', '# Note Uppercase');

      try {
        await createTestNote(tempVault, 'note.md', '# Note Lowercase');

        // If we got here, filesystem is case-sensitive
        const upper = await readTestNote(tempVault, 'Note.md');
        const lower = await readTestNote(tempVault, 'note.md');

        expect(upper).toContain('Uppercase');
        expect(lower).toContain('Lowercase');
      } catch {
        // Case-insensitive filesystem - second write overwrote first
        const content = await readTestNote(tempVault, 'Note.md');
        expect(content).toContain('Note');
      }
    });

    it('should handle case variations in headings', async () => {
      const content = `---
title: Test
---
# Main Title

## Log

Content

## LOG

Different content

## log

Yet more content
`;
      await createTestNote(tempVault, 'case-headings.md', content);

      const result = await readVaultFile(tempVault, 'case-headings.md');
      const headings = extractHeadings(result.content);

      // All three should be detected as separate headings
      expect(headings.filter(h => h.text.toLowerCase() === 'log').length).toBe(3);
    });

    it('should find section case-insensitively', async () => {
      const content = `---
title: Test
---
# Title

## MySection

Content
`;
      await createTestNote(tempVault, 'case-section.md', content);

      const result = await readVaultFile(tempVault, 'case-section.md');

      // findSection should be case-insensitive
      const section1 = findSection(result.content, 'mysection');
      const section2 = findSection(result.content, 'MYSECTION');
      const section3 = findSection(result.content, 'MySection');

      expect(section1).not.toBeNull();
      expect(section2).not.toBeNull();
      expect(section3).not.toBeNull();
    });
  });

  // ========================================
  // Extreme Content Sizes
  // ========================================

  describe('Extreme content sizes', () => {
    it('should handle very long lines', async () => {
      const longLine = 'a'.repeat(100000);
      const content = `---
title: Test
---
# Title

## Log

${longLine}
`;
      await createTestNote(tempVault, 'long-line.md', content);

      const result = await readVaultFile(tempVault, 'long-line.md');
      expect(result.content).toContain(longLine);
    });

    it('should handle many short lines', async () => {
      const manyLines = Array(10000).fill('- Item').join('\n');
      const content = `---
title: Test
---
# Title

## Log

${manyLines}
`;
      await createTestNote(tempVault, 'many-lines.md', content);

      const result = await readVaultFile(tempVault, 'many-lines.md');
      const headings = extractHeadings(result.content);

      expect(headings.length).toBe(2);
    });

    it('should handle very large frontmatter', async () => {
      const tags = Array(1000).fill(0).map((_, i) => `tag-${i}`);
      const content = `---
title: Test
tags:
${tags.map(t => `  - ${t}`).join('\n')}
---
# Title

Content
`;
      await createTestNote(tempVault, 'large-frontmatter.md', content);

      const result = await readVaultFile(tempVault, 'large-frontmatter.md');
      expect(result.frontmatter.tags).toHaveLength(1000);
    });

    it('should handle deeply nested YAML', async () => {
      // Create deeply nested YAML structure
      let nested: Record<string, unknown> = { value: 'deep' };
      for (let i = 0; i < 50; i++) {
        nested = { level: nested };
      }

      const content = `---
title: Test
deep: ${JSON.stringify(nested)}
---
# Title

Content
`;
      await createTestNote(tempVault, 'deep-yaml.md', content);

      // Should parse without stack overflow
      const result = await readVaultFile(tempVault, 'deep-yaml.md');
      expect(result.frontmatter.deep).toBeDefined();
    });

    it('should handle empty content gracefully', async () => {
      const content = `---
title: Empty
---
`;
      await createTestNote(tempVault, 'empty.md', content);

      const result = await readVaultFile(tempVault, 'empty.md');
      expect(result.content.trim()).toBe('');
    });

    it('should handle content with only whitespace', async () => {
      const content = `---
title: Whitespace
---





`;
      await createTestNote(tempVault, 'whitespace.md', content);

      const result = await readVaultFile(tempVault, 'whitespace.md');
      expect(result.content).toBeDefined();
    });
  });

  // ========================================
  // Deep Heading Nesting
  // ========================================

  describe('Deep heading nesting', () => {
    it('should handle all 6 heading levels', async () => {
      const content = `---
title: Test
---
# Level 1
## Level 2
### Level 3
#### Level 4
##### Level 5
###### Level 6

Content
`;
      await createTestNote(tempVault, 'deep-headings.md', content);

      const result = await readVaultFile(tempVault, 'deep-headings.md');
      const headings = extractHeadings(result.content);

      expect(headings).toHaveLength(6);
      expect(headings[0].level).toBe(1);
      expect(headings[5].level).toBe(6);
    });

    it('should handle excessive hash marks (> 6)', async () => {
      const content = `---
title: Test
---
####### Not a heading
######## Also not a heading
# Real heading

Content
`;
      await createTestNote(tempVault, 'excess-hashes.md', content);

      const result = await readVaultFile(tempVault, 'excess-hashes.md');
      const headings = extractHeadings(result.content);

      // Only # through ###### are valid headings
      expect(headings).toHaveLength(1);
      expect(headings[0].text).toBe('Real heading');
    });

    it('should handle many sections at same level', async () => {
      const sections = Array(100)
        .fill(0)
        .map((_, i) => `## Section ${i}\n\nContent ${i}`)
        .join('\n\n');

      const content = `---
title: Test
---
# Main Title

${sections}
`;
      await createTestNote(tempVault, 'many-sections.md', content);

      const result = await readVaultFile(tempVault, 'many-sections.md');
      const headings = extractHeadings(result.content);

      expect(headings).toHaveLength(101); // 1 main + 100 sections
    });

    it('should find correct section boundaries with deep nesting', async () => {
      const content = `---
title: Test
---
# Title

## Parent

Content A

### Child

Content B

#### Grandchild

Content C

## Sibling

Content D
`;
      await createTestNote(tempVault, 'nested-sections.md', content);

      const result = await readVaultFile(tempVault, 'nested-sections.md');

      // Parent section should include Child and Grandchild
      const parentSection = findSection(result.content, 'Parent');
      expect(parentSection).not.toBeNull();

      // Find the content lines for the parent section
      const lines = result.content.split('\n');
      const parentContent = lines.slice(parentSection!.contentStartLine, parentSection!.endLine + 1);
      const parentText = parentContent.join('\n');

      expect(parentText).toContain('Content A');
      expect(parentText).toContain('Content B');
      expect(parentText).toContain('Content C');
      expect(parentText).not.toContain('Content D');
    });

    it('should handle section with no content', async () => {
      const content = `---
title: Test
---
# Title

## Empty Section

## Next Section

Content
`;
      await createTestNote(tempVault, 'empty-section.md', content);

      const result = await readVaultFile(tempVault, 'empty-section.md');
      const emptySection = findSection(result.content, 'Empty Section');

      expect(emptySection).not.toBeNull();
      // Empty section should have valid boundaries
      expect(emptySection!.contentStartLine).toBeLessThanOrEqual(emptySection!.endLine + 1);
    });
  });

  // ========================================
  // Special Characters in Headings
  // ========================================

  describe('Special characters in headings', () => {
    it('should handle headings with brackets', async () => {
      const content = `---
title: Test
---
# [2026-01-28] Daily Note

## [[Wikilink]] Section

Content
`;
      await createTestNote(tempVault, 'bracket-headings.md', content);

      const result = await readVaultFile(tempVault, 'bracket-headings.md');
      const headings = extractHeadings(result.content);

      expect(headings).toHaveLength(2);
      expect(headings[0].text).toBe('[2026-01-28] Daily Note');
    });

    it('should handle headings with emoji', async () => {
      const content = `---
title: Test
---
# 🚀 Launch Notes

## 📝 Log

Content
`;
      await createTestNote(tempVault, 'emoji-headings.md', content);

      const result = await readVaultFile(tempVault, 'emoji-headings.md');
      const logSection = findSection(result.content, '📝 Log');

      expect(logSection).not.toBeNull();
    });

    it('should handle headings with special markdown characters', async () => {
      const content = `---
title: Test
---
# Title *with* **bold** and _italic_

## Section \`with code\`

Content
`;
      await createTestNote(tempVault, 'markdown-headings.md', content);

      const result = await readVaultFile(tempVault, 'markdown-headings.md');
      const headings = extractHeadings(result.content);

      expect(headings).toHaveLength(2);
    });

    it('should handle headings with HTML entities', async () => {
      const content = `---
title: Test
---
# Title &amp; More

## Section &lt;tag&gt;

Content
`;
      await createTestNote(tempVault, 'html-headings.md', content);

      const result = await readVaultFile(tempVault, 'html-headings.md');
      const headings = extractHeadings(result.content);

      expect(headings).toHaveLength(2);
      expect(headings[0].text).toContain('&amp;');
    });
  });

  // ========================================
  // Format Content Edge Cases
  // ========================================

  describe('Format content edge cases', () => {
    it('should handle formatting with only whitespace', () => {
      const result = formatContent('   ', 'bullet');
      expect(result).toBe('-');
    });

    it('should handle formatting with tabs', () => {
      const result = formatContent('\t\tindented', 'bullet');
      expect(result).toBe('- indented');
    });

    it('should handle formatting with mixed newlines', () => {
      const result = formatContent('line1\r\nline2\nline3', 'bullet');
      expect(result).toContain('- line1');
    });

    it('should handle extremely long single word', () => {
      const longWord = 'a'.repeat(10000);
      const result = formatContent(longWord, 'bullet');
      expect(result).toBe(`- ${longWord}`);
    });
  });

  // ========================================
  // Insert Content Edge Cases
  // ========================================

  describe('Insert content edge cases', () => {
    it('should handle insert at very end of file', async () => {
      const content = `---
title: Test
---
# Title

## Log

Last line`;  // No trailing newline

      await createTestNote(tempVault, 'no-trailing.md', content);

      const result = await readVaultFile(tempVault, 'no-trailing.md');
      const section = findSection(result.content, 'Log');

      expect(section).not.toBeNull();

      const newContent = insertInSection(
        result.content,
        section!,
        'New entry',
        'append'
      );

      expect(newContent).toContain('New entry');
    });

    it('should handle insert into section with only whitespace', async () => {
      const content = `---
title: Test
---
# Title

## Log



## Next
`;
      await createTestNote(tempVault, 'whitespace-section.md', content);

      const result = await readVaultFile(tempVault, 'whitespace-section.md');
      const section = findSection(result.content, 'Log');

      const newContent = insertInSection(
        result.content,
        section!,
        '- Entry',
        'append'
      );

      expect(newContent).toContain('- Entry');
    });
  });

  // ========================================
  // Binary Content Protection
  // ========================================

  describe('Binary content handling', () => {
    it('should handle content with null bytes', async () => {
      const content = `---
title: Test
---
# Title

Content with\x00null byte
`;
      await createTestNote(tempVault, 'null-byte.md', content);

      const result = await readTestNote(tempVault, 'null-byte.md');
      expect(result).toContain('\x00');
    });

    it('should handle high ASCII characters', async () => {
      const content = `---
title: Test
---
# Title

Character: \xFF \xFE \xFD
`;
      await createTestNote(tempVault, 'high-ascii.md', content);

      const result = await readTestNote(tempVault, 'high-ascii.md');
      expect(result).toContain('Character:');
    });
  });
});
