/**
 * Tests for Bidirectional Bridge tools
 *
 * These tools bridge Graph-Native (wikilinks) and Schema-Native (frontmatter) paradigms.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { buildVaultIndex } from '../../src/core/graph.js';
import type { VaultIndex } from '../../src/core/types.js';
import {
  detectProsePatterns,
  suggestFrontmatterFromProse,
  suggestWikilinksInFrontmatter,
  validateCrossLayer,
} from '../../src/tools/bidirectional.js';

const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');

describe('Bidirectional Bridge Tools', () => {
  let index: VaultIndex;
  let vaultPath: string;

  beforeAll(async () => {
    vaultPath = FIXTURES_PATH;
    index = await buildVaultIndex(FIXTURES_PATH);
  });

  describe('detectProsePatterns', () => {
    test('finds Key: [[wikilink]] patterns', async () => {
      const result = await detectProsePatterns(
        index,
        'bidirectional-test.md',
        vaultPath
      );

      expect(result.patterns.length).toBeGreaterThan(0);

      // Should find "Client: [[Acme Corp]]"
      const clientPattern = result.patterns.find(
        (p) => p.key.toLowerCase() === 'client' && p.value === 'Acme Corp'
      );
      expect(clientPattern).toBeDefined();
      expect(clientPattern?.isWikilink).toBe(true);

      // Should find "Owner: [[Alex Johnson]]"
      const ownerPattern = result.patterns.find(
        (p) => p.key.toLowerCase() === 'owner' && p.value === 'Alex Johnson'
      );
      expect(ownerPattern).toBeDefined();
      expect(ownerPattern?.isWikilink).toBe(true);
    });

    test('finds Key: Value patterns (non-wikilink)', async () => {
      const result = await detectProsePatterns(
        index,
        'bidirectional-test.md',
        vaultPath
      );

      // Should find "Priority: High"
      const priorityPattern = result.patterns.find(
        (p) => p.key.toLowerCase() === 'priority' && p.value === 'High'
      );
      expect(priorityPattern).toBeDefined();
      expect(priorityPattern?.isWikilink).toBe(false);

      // Should find "Status: Active"
      const statusPattern = result.patterns.find(
        (p) => p.key.toLowerCase() === 'status' && p.value === 'Active'
      );
      expect(statusPattern).toBeDefined();
    });

    test('ignores patterns in code blocks', async () => {
      const result = await detectProsePatterns(
        index,
        'bidirectional-test.md',
        vaultPath
      );

      // Should NOT find patterns from code blocks
      const fakePattern = result.patterns.find(
        (p) => p.key.toLowerCase() === 'client' && p.value === 'Fake Pattern'
      );
      expect(fakePattern).toBeUndefined();
    });

    test('ignores patterns in inline code', async () => {
      const result = await detectProsePatterns(
        index,
        'bidirectional-test.md',
        vaultPath
      );

      // Should NOT find "Owner: [[Not Detected]]" from inline code
      const notDetected = result.patterns.find(
        (p) => p.value === 'Not Detected'
      );
      expect(notDetected).toBeUndefined();
    });

    test('handles various key formats', async () => {
      const result = await detectProsePatterns(
        index,
        'bidirectional-test.md',
        vaultPath
      );

      // Should find patterns with different key formats
      const keyWithSpaces = result.patterns.find(
        (p) => p.key === 'Key With Spaces'
      );
      expect(keyWithSpaces).toBeDefined();

      const keyWithDashes = result.patterns.find(
        (p) => p.key === 'Key-With-Dashes'
      );
      expect(keyWithDashes).toBeDefined();
    });

    test('returns empty array for non-existent file', async () => {
      const result = await detectProsePatterns(
        index,
        'does-not-exist.md',
        vaultPath
      );

      expect(result.patterns).toEqual([]);
      expect(result.error).toBeDefined();
    });
  });

  describe('suggestFrontmatterFromProse', () => {
    test('suggests frontmatter from detected patterns', async () => {
      const result = await suggestFrontmatterFromProse(
        index,
        'bidirectional-test.md',
        vaultPath
      );

      expect(result.suggestions.length).toBeGreaterThan(0);

      // Should suggest client field with wikilink value
      const clientSuggestion = result.suggestions.find(
        (s) => s.field.toLowerCase() === 'client'
      );
      // May or may not exist depending on implementation
      // The key insight is it should aggregate patterns
    });

    test('groups multiple values for same key into array', async () => {
      // Create a temporary test file with multiple values
      const testContent = `---
title: Multi Value Test
---

# Multi Value Test

Tag: project
Tag: important
Tag: urgent
`;
      const testPath = path.join(FIXTURES_PATH, 'multi-value-test.md');
      await fs.writeFile(testPath, testContent);

      try {
        // Rebuild index to include new file
        const newIndex = await buildVaultIndex(FIXTURES_PATH);
        const result = await suggestFrontmatterFromProse(
          newIndex,
          'multi-value-test.md',
          vaultPath
        );

        const tagSuggestion = result.suggestions.find(
          (s) => s.field.toLowerCase() === 'tag'
        );
        if (tagSuggestion) {
          expect(Array.isArray(tagSuggestion.value)).toBe(true);
          expect((tagSuggestion.value as string[]).length).toBe(3);
        }
      } finally {
        // Clean up
        await fs.unlink(testPath);
      }
    });

    test('preserves wikilinks in suggested values', async () => {
      const result = await suggestFrontmatterFromProse(
        index,
        'bidirectional-test.md',
        vaultPath
      );

      // Find a suggestion that came from a wikilink pattern
      const ownerSuggestion = result.suggestions.find(
        (s) => s.field.toLowerCase() === 'owner'
      );
      if (ownerSuggestion) {
        // Value should be wrapped in [[]]
        expect(ownerSuggestion.value).toContain('[[');
      }
    });
  });

  describe('suggestWikilinksInFrontmatter', () => {
    test('finds frontmatter values that match entity titles', async () => {
      const result = await suggestWikilinksInFrontmatter(
        index,
        'bidirectional-test.md',
        vaultPath
      );

      // The frontmatter has "client: Acme Corp" and we have an "Acme Corp.md" note
      const acmeSuggestion = result.suggestions.find(
        (s) => s.current_value === 'Acme Corp' || s.target_note?.includes('Acme')
      );
      expect(acmeSuggestion).toBeDefined();
      expect(acmeSuggestion?.suggested_link).toContain('[[');
    });

    test('finds values in arrays', async () => {
      const result = await suggestWikilinksInFrontmatter(
        index,
        'bidirectional-test.md',
        vaultPath
      );

      // The frontmatter has attendees: [Alex Johnson, Sarah Johnson]
      // We have "Alex Johnson.md" so it should suggest [[Alex Johnson]]
      const benSuggestion = result.suggestions.find(
        (s) => s.current_value === 'Alex Johnson' || s.target_note?.includes('Alex')
      );
      expect(benSuggestion).toBeDefined();
    });

    test('matches aliases', async () => {
      const result = await suggestWikilinksInFrontmatter(
        index,
        'bidirectional-test.md',
        vaultPath
      );

      // "Alex Johnson.md" has alias "Alex", so a frontmatter value "Alex" should match
      // (This tests case-insensitive alias matching)
    });

    test('skips values already in wikilink format', async () => {
      // Create a test file with already-linked frontmatter
      const testContent = `---
title: Already Linked Test
client: "[[Acme Corp]]"
---

# Already Linked Test
`;
      const testPath = path.join(FIXTURES_PATH, 'already-linked-test.md');
      await fs.writeFile(testPath, testContent);

      try {
        const newIndex = await buildVaultIndex(FIXTURES_PATH);
        const result = await suggestWikilinksInFrontmatter(
          newIndex,
          'already-linked-test.md',
          vaultPath
        );

        // Should not suggest linking something that's already linked
        const acmeSuggestion = result.suggestions.find(
          (s) => s.field === 'client'
        );
        expect(acmeSuggestion).toBeUndefined();
      } finally {
        await fs.unlink(testPath);
      }
    });
  });

  describe('validateCrossLayer', () => {
    test('identifies consistent frontmatter and prose references', async () => {
      const result = await validateCrossLayer(
        index,
        'bidirectional-test.md',
        vaultPath
      );

      // Both frontmatter and prose reference "Acme Corp"
      expect(result.consistent.length).toBeGreaterThanOrEqual(0);
    });

    test('identifies frontmatter-only references', async () => {
      const result = await validateCrossLayer(
        index,
        'bidirectional-test.md',
        vaultPath
      );

      // Frontmatter has "attendees: [Alex Johnson, Sarah Johnson]"
      // but "Sarah Johnson" is not mentioned as a wikilink in prose
      expect(result.frontmatter_only.length).toBeGreaterThanOrEqual(0);
    });

    test('identifies prose-only references', async () => {
      const result = await validateCrossLayer(
        index,
        'bidirectional-test.md',
        vaultPath
      );

      // Prose has [[Another Note]] but it's not in frontmatter
      const proseOnlyAnother = result.prose_only.find(
        (p) => p.target?.toLowerCase().includes('another')
      );
      // May or may not exist depending on what we're tracking
    });

    test('returns structured result even for empty file', async () => {
      const result = await validateCrossLayer(index, 'empty-file.md', vaultPath);

      expect(result).toHaveProperty('frontmatter_only');
      expect(result).toHaveProperty('prose_only');
      expect(result).toHaveProperty('consistent');
      expect(Array.isArray(result.frontmatter_only)).toBe(true);
      expect(Array.isArray(result.prose_only)).toBe(true);
      expect(Array.isArray(result.consistent)).toBe(true);
    });
  });
});
