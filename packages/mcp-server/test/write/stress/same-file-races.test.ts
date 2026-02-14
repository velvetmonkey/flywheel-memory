/**
 * Same-File Race Condition Tests
 *
 * Validates behavior when multiple operations target the same file
 * concurrently. Ensures no corruption, even if some writes are lost.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
} from '../helpers/testUtils.js';
import {
  readVaultFile,
  writeVaultFile,
  findSection,
  insertInSection,
} from '../../../src/core/write/writer.js';

let tempVault: string;

describe('Concurrent Same-File Writes', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  describe('Parallel Write Safety', () => {
    it('should not corrupt file with 5 concurrent writes', async () => {
      // Create initial file
      const content = `---
type: log
---
# Log

## Entries

- Initial entry
`;
      await createTestNote(tempVault, 'concurrent.md', content);

      // Perform 5 concurrent mutations
      const mutations = Array.from({ length: 5 }, async (_, i) => {
        const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'concurrent.md');
        const section = findSection(content, 'Entries');

        if (section) {
          const modified = insertInSection(content, section, `- Concurrent entry ${i}`, 'append');
          await writeVaultFile(tempVault, 'concurrent.md', modified, frontmatter, lineEnding);
        }

        return i;
      });

      // Wait for all mutations to complete
      await Promise.all(mutations);

      // Verify file is not corrupted
      const finalContent = await readTestNote(tempVault, 'concurrent.md');

      // File should still be valid markdown
      expect(finalContent).toContain('# Log');
      expect(finalContent).toContain('## Entries');
      expect(finalContent).toContain('- Initial entry');

      // At least one concurrent entry should be present
      // (Last-write-wins means some may be lost, but file is valid)
      const hasAtLeastOne = /- Concurrent entry \d/.test(finalContent);
      expect(hasAtLeastOne).toBe(true);

      // Frontmatter should be intact
      expect(finalContent).toMatch(/^---\ntype: log\n---/);
    });

    it('should maintain file integrity under rapid sequential writes', async () => {
      const content = `---
type: test
---
# Test

## Log

`;
      await createTestNote(tempVault, 'rapid.md', content);

      // Perform 20 rapid sequential writes
      for (let i = 0; i < 20; i++) {
        const { content: currentContent, frontmatter, lineEnding } = await readVaultFile(tempVault, 'rapid.md');
        const section = findSection(currentContent, 'Log');

        if (section) {
          const modified = insertInSection(currentContent, section, `- Entry ${i}`, 'append');
          await writeVaultFile(tempVault, 'rapid.md', modified, frontmatter, lineEnding);
        }
      }

      const finalContent = await readTestNote(tempVault, 'rapid.md');

      // All 20 entries should be present in sequential writes
      for (let i = 0; i < 20; i++) {
        expect(finalContent).toContain(`- Entry ${i}`);
      }

      // Order should be preserved
      const entry0Pos = finalContent.indexOf('- Entry 0');
      const entry19Pos = finalContent.indexOf('- Entry 19');
      expect(entry0Pos).toBeLessThan(entry19Pos);
    });

    it('should handle 10 parallel reads correctly', async () => {
      const content = `---
count: 42
---
# Data File

Content that shouldn't change during reads.
`;
      await createTestNote(tempVault, 'readonly.md', content);

      // Perform 10 parallel reads
      const reads = Array.from({ length: 10 }, async () => {
        const { content: readContent, frontmatter } = await readVaultFile(tempVault, 'readonly.md');
        return { content: readContent, frontmatter };
      });

      const results = await Promise.all(reads);

      // All reads should return identical content
      const firstContent = results[0].content;
      const firstFrontmatter = results[0].frontmatter;

      for (const result of results) {
        expect(result.content).toBe(firstContent);
        expect(result.frontmatter.count).toBe(firstFrontmatter.count);
      }
    });
  });

  describe('Read-Modify-Write Races', () => {
    it('should handle concurrent read-modify-write cycles', async () => {
      const content = `# Counter

## Value

0
`;
      await createTestNote(tempVault, 'counter.md', content);

      // Simulate concurrent "increment" operations
      const increments = Array.from({ length: 3 }, async (_, i) => {
        // Read current value
        const { content: currentContent, frontmatter, lineEnding } = await readVaultFile(tempVault, 'counter.md');

        // Extract current value (simplified)
        const section = findSection(currentContent, 'Value');

        if (section) {
          // Append our increment attempt
          const modified = insertInSection(currentContent, section, `Increment attempt ${i}`, 'append');
          await writeVaultFile(tempVault, 'counter.md', modified, frontmatter, lineEnding);
        }

        return i;
      });

      await Promise.all(increments);

      const finalContent = await readTestNote(tempVault, 'counter.md');

      // File should be valid
      expect(finalContent).toContain('# Counter');

      // At least one increment should be visible
      const hasIncrement = /Increment attempt \d/.test(finalContent);
      expect(hasIncrement).toBe(true);
    });

    it('should not interleave content from different writes', async () => {
      const content = `# Document

## Section

`;
      await createTestNote(tempVault, 'interleave.md', content);

      // Write two distinct multi-line blocks concurrently
      const writeA = async () => {
        const { content: c, frontmatter, lineEnding } = await readVaultFile(tempVault, 'interleave.md');
        const section = findSection(c, 'Section');
        if (section) {
          const modified = insertInSection(c, section, 'AAA-START\nAAA-MIDDLE\nAAA-END', 'append');
          await writeVaultFile(tempVault, 'interleave.md', modified, frontmatter, lineEnding);
        }
      };

      const writeB = async () => {
        const { content: c, frontmatter, lineEnding } = await readVaultFile(tempVault, 'interleave.md');
        const section = findSection(c, 'Section');
        if (section) {
          const modified = insertInSection(c, section, 'BBB-START\nBBB-MIDDLE\nBBB-END', 'append');
          await writeVaultFile(tempVault, 'interleave.md', modified, frontmatter, lineEnding);
        }
      };

      await Promise.all([writeA(), writeB()]);

      const finalContent = await readTestNote(tempVault, 'interleave.md');

      // Content blocks should not be interleaved
      // Either AAA or BBB should be complete (or both)
      if (finalContent.includes('AAA-START')) {
        expect(finalContent).toContain('AAA-MIDDLE');
        expect(finalContent).toContain('AAA-END');

        // Order within block should be preserved
        const startPos = finalContent.indexOf('AAA-START');
        const middlePos = finalContent.indexOf('AAA-MIDDLE');
        const endPos = finalContent.indexOf('AAA-END');
        expect(startPos).toBeLessThan(middlePos);
        expect(middlePos).toBeLessThan(endPos);
      }

      if (finalContent.includes('BBB-START')) {
        expect(finalContent).toContain('BBB-MIDDLE');
        expect(finalContent).toContain('BBB-END');
      }
    });
  });

  describe('File Integrity Guarantees', () => {
    it('should never produce truncated content', async () => {
      const largeContent = `---
type: large
---
# Large Document

## Section

${'X'.repeat(10000)}
`;
      await createTestNote(tempVault, 'large.md', largeContent);

      // Concurrent reads and writes
      const operations = Array.from({ length: 5 }, async (_, i) => {
        if (i % 2 === 0) {
          // Read operation
          const { content } = await readVaultFile(tempVault, 'large.md');
          return content.length;
        } else {
          // Write operation
          const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'large.md');
          const section = findSection(content, 'Section');
          if (section) {
            const modified = insertInSection(content, section, `Line ${i}`, 'append');
            await writeVaultFile(tempVault, 'large.md', modified, frontmatter, lineEnding);
          }
          return 0;
        }
      });

      await Promise.all(operations);

      const finalContent = await readTestNote(tempVault, 'large.md');

      // Should still have full content
      expect(finalContent.length).toBeGreaterThan(10000);
      expect(finalContent).toContain('X'.repeat(1000)); // At least partial original content
      expect(finalContent).toMatch(/^---\ntype: large\n---/);
    });

    it('should preserve frontmatter under concurrent modifications', async () => {
      const content = `---
type: test
tags:
  - important
  - urgent
metadata:
  version: 1
  author: Test
---
# Test Note

## Log

`;
      await createTestNote(tempVault, 'frontmatter.md', content);

      // Concurrent modifications to body
      const mods = Array.from({ length: 5 }, async (_, i) => {
        const { content: c, frontmatter, lineEnding } = await readVaultFile(tempVault, 'frontmatter.md');
        const section = findSection(c, 'Log');
        if (section) {
          const modified = insertInSection(c, section, `- Entry ${i}`, 'append');
          await writeVaultFile(tempVault, 'frontmatter.md', modified, frontmatter, lineEnding);
        }
      });

      await Promise.all(mods);

      const finalContent = await readTestNote(tempVault, 'frontmatter.md');

      // Frontmatter should be fully intact
      expect(finalContent).toContain('type: test');
      expect(finalContent).toContain('- important');
      expect(finalContent).toContain('- urgent');
      expect(finalContent).toContain('version: 1');
      expect(finalContent).toContain('author: Test');
    });
  });
});
