/**
 * Golden file tests for format preservation
 *
 * These tests verify that mutations preserve file formatting:
 * - Bullet styles (-, *, +)
 * - Checkbox formats ([ ], [x], [X])
 * - Frontmatter structure
 * - Line ending style (LF vs CRLF)
 * - Trailing newlines
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  readVaultFile,
  writeVaultFile,
  findSection,
  insertInSection,
  detectLineEnding,
  convertLineEndings,
  normalizeLineEndings,
  normalizeTrailingNewline,
} from '../../src/core/writer.js';
import { createTempVault, cleanupTempVault } from '../helpers/testUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT_DIR = path.join(__dirname, 'input');
const EXPECTED_DIR = path.join(__dirname, 'expected');

/**
 * Read a golden file
 */
async function readGoldenFile(dir: string, filename: string): Promise<string> {
  return await fs.readFile(path.join(dir, filename), 'utf-8');
}

describe('Golden File Tests', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  describe('Bullet style preservation', () => {
    it('should append to dash-style bullet list', async () => {
      const input = await readGoldenFile(INPUT_DIR, 'bullets.md');
      const expected = await readGoldenFile(EXPECTED_DIR, 'bullets.add-append.md');

      // Write input to temp vault
      await fs.writeFile(path.join(tempVault, 'test.md'), input);

      // Read, modify, write
      const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
      const section = findSection(content, 'Dash Style')!;
      const modified = insertInSection(content, section, '- New item', 'append');
      await writeVaultFile(tempVault, 'test.md', modified, frontmatter, lineEnding);

      // Compare result
      const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
      expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));
    });
  });

  describe('Checkbox handling', () => {
    it('should toggle unchecked to checked', async () => {
      const input = await readGoldenFile(INPUT_DIR, 'checkboxes.md');
      const expected = await readGoldenFile(EXPECTED_DIR, 'checkboxes.toggle.md');

      await fs.writeFile(path.join(tempVault, 'test.md'), input);

      const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
      // Toggle the first unchecked task
      const toggled = content.replace('- [ ] Unchecked task', '- [x] Unchecked task');
      await writeVaultFile(tempVault, 'test.md', toggled, frontmatter, lineEnding);

      const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
      expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));
    });
  });

  describe('Heading level operations', () => {
    it('should add content to level 3 heading', async () => {
      const input = await readGoldenFile(INPUT_DIR, 'headings.md');
      const expected = await readGoldenFile(EXPECTED_DIR, 'headings.add-to-level3.md');

      await fs.writeFile(path.join(tempVault, 'test.md'), input);

      const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
      const section = findSection(content, 'Level 3')!;
      const modified = insertInSection(content, section, 'New content in level 3', 'append');
      await writeVaultFile(tempVault, 'test.md', modified, frontmatter, lineEnding);

      const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
      expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));
    });
  });

  describe('Frontmatter preservation', () => {
    it('should preserve frontmatter structure when updating field', async () => {
      const input = await readGoldenFile(INPUT_DIR, 'frontmatter.md');
      const expected = await readGoldenFile(EXPECTED_DIR, 'frontmatter.update.md');

      await fs.writeFile(path.join(tempVault, 'test.md'), input);

      const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
      // Update status field
      frontmatter.status = 'completed';
      await writeVaultFile(tempVault, 'test.md', content, frontmatter, lineEnding);

      const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
      expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));
    });
  });
});

describe('Line Ending Detection', () => {
  it('should detect LF line endings', () => {
    const content = 'Line 1\nLine 2\nLine 3\n';
    expect(detectLineEnding(content)).toBe('LF');
  });

  it('should detect CRLF line endings', () => {
    const content = 'Line 1\r\nLine 2\r\nLine 3\r\n';
    expect(detectLineEnding(content)).toBe('CRLF');
  });

  it('should detect CRLF when majority are CRLF', () => {
    const content = 'Line 1\r\nLine 2\r\nLine 3\nLine 4\r\n';
    expect(detectLineEnding(content)).toBe('CRLF');
  });

  it('should detect LF for empty or single-line content', () => {
    expect(detectLineEnding('')).toBe('LF');
    expect(detectLineEnding('Single line')).toBe('LF');
  });
});

describe('Line Ending Conversion', () => {
  it('should convert LF to CRLF', () => {
    const content = 'Line 1\nLine 2\nLine 3\n';
    const converted = convertLineEndings(content, 'CRLF');
    expect(converted).toBe('Line 1\r\nLine 2\r\nLine 3\r\n');
  });

  it('should convert CRLF to LF', () => {
    const content = 'Line 1\r\nLine 2\r\nLine 3\r\n';
    const converted = convertLineEndings(content, 'LF');
    expect(converted).toBe('Line 1\nLine 2\nLine 3\n');
  });

  it('should handle mixed line endings when converting', () => {
    const content = 'Line 1\r\nLine 2\nLine 3\r\n';
    const toLF = convertLineEndings(content, 'LF');
    expect(toLF).toBe('Line 1\nLine 2\nLine 3\n');

    const toCRLF = convertLineEndings(content, 'CRLF');
    expect(toCRLF).toBe('Line 1\r\nLine 2\r\nLine 3\r\n');
  });
});

describe('Trailing Newline Normalization', () => {
  it('should add trailing newline if missing', () => {
    const content = 'Content without newline';
    expect(normalizeTrailingNewline(content)).toBe('Content without newline\n');
  });

  it('should preserve single trailing newline', () => {
    const content = 'Content with newline\n';
    expect(normalizeTrailingNewline(content)).toBe('Content with newline\n');
  });

  it('should reduce multiple trailing newlines to one', () => {
    const content = 'Content with extra newlines\n\n\n';
    expect(normalizeTrailingNewline(content)).toBe('Content with extra newlines\n');
  });

  it('should handle trailing spaces and newlines', () => {
    const content = 'Content with trailing whitespace  \n\n  \n';
    expect(normalizeTrailingNewline(content)).toBe('Content with trailing whitespace\n');
  });
});

describe('Nested List Preservation', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should preserve 3-level nested bullet structure', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'nested-lists.md');
    const expected = await readGoldenFile(EXPECTED_DIR, 'nested-lists.add-nested.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');

    // Find the Level 3 content area and add a new nested item
    // We need to insert after "Level 3 Item A1b" which is at level 3
    const lines = content.split('\n');
    const insertIndex = lines.findIndex(l => l.includes('Level 3 Item A1b')) + 1;
    lines.splice(insertIndex, 0, '    - New nested item');
    const modified = lines.join('\n');

    await writeVaultFile(tempVault, 'test.md', modified, frontmatter, lineEnding);

    const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
    expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));
  });

  it('should prepend to indented section with preserveListNesting', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'nested-prepend.md');
    const expected = await readGoldenFile(EXPECTED_DIR, 'nested-prepend.prepend-indented.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(content, 'Indented Section')!;
    const modified = insertInSection(content, section, '- Prepended item', 'prepend', {
      preserveListNesting: true,
    });
    await writeVaultFile(tempVault, 'test.md', modified, frontmatter, lineEnding);

    const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
    expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));
  });

  it('should prepend to top-level list with preserveListNesting', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'nested-prepend.md');
    const expected = await readGoldenFile(EXPECTED_DIR, 'nested-prepend.prepend-top-level.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(content, 'Mixed Section')!;
    const modified = insertInSection(content, section, '- Prepended item', 'prepend', {
      preserveListNesting: true,
    });
    await writeVaultFile(tempVault, 'test.md', modified, frontmatter, lineEnding);

    const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
    expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));
  });
});

describe('Code Block Handling', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should not match headings inside code blocks', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'code-blocks.md');
    const expected = await readGoldenFile(EXPECTED_DIR, 'code-blocks.add-content.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(content, 'Code Section')!;
    const modified = insertInSection(content, section, 'New content after code block', 'append');
    await writeVaultFile(tempVault, 'test.md', modified, frontmatter, lineEnding);

    const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
    expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));
  });
});

describe('Unicode Content Handling', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should handle emoji in sections and content', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'unicode-content.md');
    const expected = await readGoldenFile(EXPECTED_DIR, 'unicode-content.add-emoji.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(content, 'Emoji Section 📝')!;
    const modified = insertInSection(content, section, '- 🌟 New star entry', 'append');
    await writeVaultFile(tempVault, 'test.md', modified, frontmatter, lineEnding);

    const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
    expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));
  });

  it('should preserve CJK characters', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'unicode-content.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content } = await readVaultFile(tempVault, 'test.md');

    // Verify CJK content is preserved
    expect(content).toContain('你好世界');
    expect(content).toContain('こんにちは');
    expect(content).toContain('안녕하세요');
  });
});

describe('Empty Section Handling', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should add content to empty section', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'empty-sections.md');
    const expected = await readGoldenFile(EXPECTED_DIR, 'empty-sections.add-to-empty.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(content, 'Empty Section')!;
    const modified = insertInSection(content, section, 'First content in empty section', 'append');
    await writeVaultFile(tempVault, 'test.md', modified, frontmatter, lineEnding);

    const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
    expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));
  });
});

describe('Special Headings Handling', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should handle headings with brackets, parens, and special chars', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'special-headings.md');
    const expected = await readGoldenFile(EXPECTED_DIR, 'special-headings.add-to-brackets.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(content, '[Bracketed] Heading')!;
    const modified = insertInSection(content, section, 'New content added', 'append');
    await writeVaultFile(tempVault, 'test.md', modified, frontmatter, lineEnding);

    const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
    expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));
  });

  it('should find heading with backticks', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'special-headings.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(content, '`Backtick` Code Heading');

    expect(section).not.toBeNull();
    expect(section?.name).toBe('`Backtick` Code Heading');
  });

  it('should find emoji heading', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'special-headings.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(content, '📝 Emoji Heading 🚀');

    expect(section).not.toBeNull();
    expect(section?.name).toBe('📝 Emoji Heading 🚀');
  });
});

describe('Daily Note Realistic Scenario', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should add timestamped log entry to realistic daily note', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'daily-note-realistic.md');
    const expected = await readGoldenFile(EXPECTED_DIR, 'daily-note-realistic.add-log.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(content, 'Log')!;
    const modified = insertInSection(content, section, '- **14:00** Afternoon standup', 'append');
    await writeVaultFile(tempVault, 'test.md', modified, frontmatter, lineEnding);

    const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
    expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));
  });

  it('should preserve complex frontmatter in daily note', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'daily-note-realistic.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { frontmatter } = await readVaultFile(tempVault, 'test.md');

    // gray-matter parses YAML dates as Date objects
    expect(frontmatter.date).toBeInstanceOf(Date);
    expect(frontmatter.type).toBe('daily');
    expect(frontmatter.tags).toContain('daily');
    expect(frontmatter.tags).toContain('work');
    expect(frontmatter.weather).toBe('sunny');
    expect(frontmatter.mood).toBe('productive');
  });
});

describe('Trailing Newline Handling', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should normalize trailing newlines', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'trailing-newline.md');
    const expected = await readGoldenFile(EXPECTED_DIR, 'trailing-newline.normalized.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(content, 'Section')!;
    const modified = insertInSection(content, section, 'New content added', 'append');
    await writeVaultFile(tempVault, 'test.md', modified, frontmatter, lineEnding);

    const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
    expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));
  });
});

describe('Mixed Line Endings Handling', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should handle files with mixed line endings', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'mixed-line-endings.md');
    const expected = await readGoldenFile(EXPECTED_DIR, 'mixed-line-endings.add-item.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(content, 'Section')!;
    const modified = insertInSection(content, section, '- Item 3', 'append');
    await writeVaultFile(tempVault, 'test.md', modified, frontmatter, lineEnding);

    const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
    expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));
  });
});

describe('CRLF Round-Trip Preservation', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should preserve CRLF line endings through read/write cycle', async () => {
    // Create a file with CRLF line endings
    const crlfContent = '---\r\ntype: test\r\n---\r\n\r\n# Test\r\n\r\n## Section\r\n- Item 1\r\n';
    await fs.writeFile(path.join(tempVault, 'crlf-test.md'), crlfContent);

    // Read the file
    const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'crlf-test.md');
    expect(lineEnding).toBe('CRLF');

    // Modify and write back
    const section = findSection(content, 'Section')!;
    const modified = insertInSection(content, section, '- Item 2', 'append');
    await writeVaultFile(tempVault, 'crlf-test.md', modified, frontmatter, lineEnding);

    // Verify CRLF is preserved
    const result = await fs.readFile(path.join(tempVault, 'crlf-test.md'), 'utf-8');
    expect(detectLineEnding(result)).toBe('CRLF');
    expect(result).toContain('\r\n');
    expect(result).toContain('- Item 2\r\n');
  });

  it('should preserve LF line endings through read/write cycle', async () => {
    // Create a file with LF line endings
    const lfContent = '---\ntype: test\n---\n\n# Test\n\n## Section\n- Item 1\n';
    await fs.writeFile(path.join(tempVault, 'lf-test.md'), lfContent);

    // Read the file
    const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'lf-test.md');
    expect(lineEnding).toBe('LF');

    // Modify and write back
    const section = findSection(content, 'Section')!;
    const modified = insertInSection(content, section, '- Item 2', 'append');
    await writeVaultFile(tempVault, 'lf-test.md', modified, frontmatter, lineEnding);

    // Verify LF is preserved (no CRLF)
    const result = await fs.readFile(path.join(tempVault, 'lf-test.md'), 'utf-8');
    expect(detectLineEnding(result)).toBe('LF');
    expect(result).not.toContain('\r\n');
  });
});

describe('Block-Aware Formatting Golden Tests', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should preserve table alignment when adding log entry with embedded table', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'complex-log-entry.md');
    const expected = await readGoldenFile(EXPECTED_DIR, 'complex-log-entry.add-table.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(content, 'Log')!;

    // Add a log entry with an embedded table
    const newContent = `- **11:00** Released v0.10.1
| Component | Version | Status |
| --------- | ------- | ------ |
| Server    | 0.10.1  | OK     |
| Client    | 0.10.1  | OK     |`;

    const modified = insertInSection(content, section, newContent, 'append');
    await writeVaultFile(tempVault, 'test.md', modified, frontmatter, lineEnding);

    const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
    expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));
  });

  it('should preserve code block fences when adding log entry with code', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'code-in-bullet.md');
    const expected = await readGoldenFile(EXPECTED_DIR, 'code-in-bullet.add-code.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(content, 'Log')!;

    // Add a log entry with an embedded code block
    const newContent = `- **10:00** Found the bug:
\`\`\`javascript
function broken() {
  return undefined;
}
\`\`\``;

    const modified = insertInSection(content, section, newContent, 'append');
    await writeVaultFile(tempVault, 'test.md', modified, frontmatter, lineEnding);

    const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
    expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));
  });

  it('should preserve mixed structures (blockquote, table, code) in single entry', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'mixed-structures.md');
    const expected = await readGoldenFile(EXPECTED_DIR, 'mixed-structures.add-complex.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(content, 'Discussion')!;

    // Add content with blockquote, table, and code block
    const newContent = `- Review of architecture:
> The key insight is that we need
> to separate concerns properly.

| Module | Owner | Status |
| ------ | ----- | ------ |
| Auth   | Alice | Done   |
| API    | Bob   | WIP    |

\`\`\`typescript
interface Config {
  debug: boolean;
}
\`\`\``;

    const modified = insertInSection(content, section, newContent, 'append');
    await writeVaultFile(tempVault, 'test.md', modified, frontmatter, lineEnding);

    const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
    expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));
  });
});

describe('Battle-hardening edge cases', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should preserve 6+ levels of deep nesting', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'deep-nesting.md');
    const expected = await readGoldenFile(EXPECTED_DIR, 'deep-nesting.add-deep.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(content, 'Active')!;
    // Append at section end - verify deep nesting is preserved
    const modified = insertInSection(content, section, '- New item at section end', 'append');
    await writeVaultFile(tempVault, 'test.md', modified, frontmatter, lineEnding);

    const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
    expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));

    // Also verify the deep nesting structure is preserved
    expect(result).toContain('          - Level 6 item');
    expect(result).toContain('            - Level 7 item');
  });

  it('should preserve mixed numbered/bullet list markers', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'mixed-list-markers.md');
    const expected = await readGoldenFile(EXPECTED_DIR, 'mixed-list-markers.add-numbered-sublist.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(content, 'Today')!;
    // Append at section end - verify all marker types are preserved
    const modified = insertInSection(content, section, '- New bullet item', 'append');
    await writeVaultFile(tempVault, 'test.md', modified, frontmatter, lineEnding);

    const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
    expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));

    // Verify mixed markers are preserved
    expect(result).toContain('   - Bullet subitem with dash');
    expect(result).toContain('   * Asterisk subitem');
    expect(result).toContain('   + Plus subitem');
  });

  it('should preserve tab indentation', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'tab-indentation.md');
    const expected = await readGoldenFile(EXPECTED_DIR, 'tab-indentation.add-tabbed.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(content, 'Log')!;
    // Append with tab-style bullet to match file convention
    const modified = insertInSection(content, section, '-\tNew tabbed item', 'append');
    await writeVaultFile(tempVault, 'test.md', modified, frontmatter, lineEnding);

    const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
    expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));

    // Verify tabs are preserved in existing content
    expect(result).toContain('\t-\tNested with tab');
    expect(result).toContain('\t\t-\tDouble nested');
  });
});

describe('Inconsistent Indentation Handling', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should add to mixed indentation section without corruption', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'inconsistent-indent.md');
    const expected = await readGoldenFile(EXPECTED_DIR, 'inconsistent-indent.add-to-mixed.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(content, 'Mixed Section')!;
    const modified = insertInSection(content, section, '- New item added to mixed', 'append');
    await writeVaultFile(tempVault, 'test.md', modified, frontmatter, lineEnding);

    const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
    expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));
  });

  it('should preserve 2-space indentation in 2-space section', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'inconsistent-indent.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content } = await readVaultFile(tempVault, 'test.md');

    // Verify 2-space section maintains its style
    expect(content).toContain('  - Nested with 2-space');
  });

  it('should preserve 4-space indentation in 4-space section', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'inconsistent-indent.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content } = await readVaultFile(tempVault, 'test.md');

    // Verify 4-space section maintains its style
    expect(content).toContain('    - Nested with 4-space');
  });

  it('should preserve tab indentation', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'inconsistent-indent.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content } = await readVaultFile(tempVault, 'test.md');

    // Verify tab section maintains tabs
    expect(content).toContain('\t- Tab-indented nested');
  });
});

describe('Duplicate Headings Handling', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should add to first occurrence of duplicate heading', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'duplicate-headings.md');
    const expected = await readGoldenFile(EXPECTED_DIR, 'duplicate-headings.add-to-first.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(content, 'Log')!;
    const modified = insertInSection(content, section, '- New entry in first Log', 'append');
    await writeVaultFile(tempVault, 'test.md', modified, frontmatter, lineEnding);

    const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
    expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));
  });

  it('should preserve all duplicate sections after mutation', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'duplicate-headings.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(content, 'Tasks')!;
    const modified = insertInSection(content, section, '- [ ] New task', 'append');
    await writeVaultFile(tempVault, 'test.md', modified, frontmatter, lineEnding);

    const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');

    // All three Log sections should still exist
    const logMatches = result.match(/## Log/g);
    expect(logMatches).toHaveLength(3);

    // Content from each section should be preserved
    expect(result).toContain('Entry 1 in first Log');
    expect(result).toContain('Entry 1 in second Log');
    expect(result).toContain('Entry in third Log');
  });

  it('should find first Log section and verify correct content range', async () => {
    const input = await readGoldenFile(INPUT_DIR, 'duplicate-headings.md');

    await fs.writeFile(path.join(tempVault, 'test.md'), input);

    const { content } = await readVaultFile(tempVault, 'test.md');
    const section = findSection(content, 'Log')!;

    // Get the section content
    const lines = content.split('\n');
    const sectionContent = lines.slice(section.contentStartLine, section.endLine).join('\n');

    // First Log section should contain "first Log" entries
    expect(sectionContent).toContain('first Log');
    expect(sectionContent).not.toContain('second Log');
    expect(sectionContent).not.toContain('third Log');
  });
});
