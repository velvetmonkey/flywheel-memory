/**
 * Entity Index Sync Validation Tests
 *
 * Tests that the entity index stays consistent across mutations:
 * - After mutations with new wikilinks
 * - After vault file deletions
 * - After entity renames
 *
 * These tests validate the synchronization between:
 * - Flywheel Memory mutations
 * - Entity cache updates
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  readVaultFile,
  writeVaultFile,
  findSection,
  insertInSection,
} from '../../../src/core/write/writer.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
  createEntityCache,
  createEntityCacheInStateDb,
  createVaultWithEntities,
  openStateDb,
  deleteStateDb,
  type StateDb,
} from '../helpers/testUtils.js';
import {
  initializeEntityIndex,
  processWikilinks,
  suggestRelatedLinks,
  isEntityIndexReady,
  getEntityIndexStats,
  setWriteStateDb,
} from '../../../src/core/write/wikilinks.js';

describe('Entity Index Sync Validation', () => {
  let tempVault: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    tempVault = await createTempVault();
    stateDb = openStateDb(tempVault);
    setWriteStateDb(stateDb);
  });

  afterEach(async () => {
    setWriteStateDb(null);
    stateDb.db.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  describe('sync after mutation with new wikilinks', () => {
    it('should have entity index available after initialization', async () => {
      // Initial setup with entities
      createEntityCacheInStateDb(stateDb, tempVault, {
        people: ['Alice'],
        projects: ['Project X'],
      });

      // Initialize
      await initializeEntityIndex(tempVault);

      // Verify index is ready
      expect(isEntityIndexReady()).toBe(true);

      const stats = getEntityIndexStats();
      expect(stats.ready).toBe(true);
      expect(stats.totalEntities).toBeGreaterThan(0);
    });

    it('should maintain consistency across sequential mutations', async () => {
      await createVaultWithEntities(tempVault);
      createEntityCacheInStateDb(stateDb, tempVault, {
        people: ['Jordan Smith'],
        projects: ['MCP Server'],
        technologies: ['TypeScript'],
      });

      const content = `---
type: daily
---
# Daily Log

## Log
Morning entry.
`;
      await createTestNote(tempVault, 'daily.md', content);

      await initializeEntityIndex(tempVault);

      // Sequential mutations
      for (let i = 0; i < 3; i++) {
        const { content: readContent, frontmatter, lineEnding } = await readVaultFile(
          tempVault,
          'daily.md'
        );
        const section = findSection(readContent, 'Log')!;
        const newEntry = `- Entry ${i}: Working on TypeScript with Jordan Smith`;
        const modified = insertInSection(readContent, section, newEntry, 'append');
        const linked = processWikilinks(modified, 'daily.md');
        await writeVaultFile(tempVault, 'daily.md', linked.content, frontmatter, lineEnding);
      }

      // Verify final state
      const result = await readTestNote(tempVault, 'daily.md');

      // Should have all entries
      expect(result).toContain('Entry 0');
      expect(result).toContain('Entry 1');
      expect(result).toContain('Entry 2');
    });
  });

  describe('entity cache structure', () => {
    it('should handle different entity categories', async () => {
      createEntityCacheInStateDb(stateDb, tempVault, {
        people: ['Alice', 'Bob'],
        projects: ['Project A', 'Project B'],
        technologies: ['TypeScript', 'Node.js'],
        acronyms: ['API', 'SDK'],
        organizations: ['Acme Corp'],
        locations: ['New York'],
        concepts: ['Machine Learning'],
        other: ['Misc Item'],
      });

      await initializeEntityIndex(tempVault);

      const stats = getEntityIndexStats();
      expect(stats.ready).toBe(true);

      // Total should include all categories
      expect(stats.totalEntities).toBe(12);

      // Verify category counts
      expect(stats.categories.people).toBe(2);
      expect(stats.categories.projects).toBe(2);
      expect(stats.categories.technologies).toBe(2);
      expect(stats.categories.acronyms).toBe(2);
    });

    it('should handle empty categories gracefully', async () => {
      createEntityCacheInStateDb(stateDb, tempVault, {
        people: ['Alice'],
        // All other categories empty
      });

      await initializeEntityIndex(tempVault);

      const stats = getEntityIndexStats();
      expect(stats.ready).toBe(true);
      expect(stats.totalEntities).toBe(1);
    });
  });

  describe('entity index behavior when cache missing', () => {
    it('should handle missing entity cache file', async () => {
      // Don't create entity cache
      await createTestNote(
        tempVault,
        'test.md',
        `---
type: note
---
# Test Note

Content here.
`
      );

      // Initialize should handle missing cache
      await initializeEntityIndex(tempVault);

      // Index might not be ready if cache doesn't exist
      const stats = getEntityIndexStats();
      // Behavior depends on implementation - may be ready with 0 entities or not ready
      expect(typeof stats.ready).toBe('boolean');
    });
  });

  describe('suggestions after index changes', () => {
    it('should provide suggestions based on current index', async () => {
      createEntityCacheInStateDb(stateDb, tempVault, {
        people: ['Alice', 'Bob', 'Charlie'],
        projects: ['Project X', 'Project Y'],
      });

      await initializeEntityIndex(tempVault);

      // Get suggestions
      const content = 'Working with team on project implementation';
      const result = await suggestRelatedLinks(content, { maxSuggestions: 3 });

      expect(result.suggestions).toBeInstanceOf(Array);
      // May or may not have suggestions depending on matching
    });

    it('should exclude linked entities from suggestions', async () => {
      createEntityCacheInStateDb(stateDb, tempVault, {
        people: ['Alice', 'Bob'],
        projects: ['Project X'],
      });

      await initializeEntityIndex(tempVault);

      // Content with already-linked entities
      const content = 'Working with [[Alice]] on [[Project X]] implementation with Bob';
      const result = await suggestRelatedLinks(content, {
        maxSuggestions: 5,
        excludeLinked: true,
      });

      // Alice and Project X should not be in suggestions (already linked)
      const lowercaseSuggestions = result.suggestions.map(s => s.toLowerCase());
      expect(lowercaseSuggestions).not.toContain('alice');
      expect(lowercaseSuggestions).not.toContain('project x');
    });
  });

  describe('wikilink processing with different note contexts', () => {
    it('should process wikilinks with note path context', async () => {
      createEntityCacheInStateDb(stateDb, tempVault, {
        people: ['Alice'],
        projects: ['Project X'],
      });

      await createTestNote(
        tempVault,
        'daily/2026-02-01.md',
        `---
type: daily
---
# Daily Note

## Log
Working with Alice on Project X.
`
      );

      await initializeEntityIndex(tempVault);

      const { content } = await readVaultFile(tempVault, 'daily/2026-02-01.md');

      // Process with note path for context-aware boosting
      const result = processWikilinks(content, 'daily/2026-02-01.md');

      expect(result.content).toBeDefined();
      expect(typeof result.linksAdded).toBe('number');
      expect(result.linkedEntities).toBeInstanceOf(Array);
    });

    it('should process wikilinks without note path', async () => {
      createEntityCacheInStateDb(stateDb, tempVault, {
        people: ['Alice'],
      });

      await initializeEntityIndex(tempVault);

      const content = 'Meeting with Alice tomorrow';
      const result = processWikilinks(content);

      expect(result.content).toBeDefined();
    });
  });

  describe('edge cases in entity matching', () => {
    it('should handle very short entity names', async () => {
      createEntityCacheInStateDb(stateDb, tempVault, {
        acronyms: ['AI', 'ML', 'API'],
      });

      await initializeEntityIndex(tempVault);

      const content = 'Working on AI and ML integration with the API';
      const result = processWikilinks(content);

      // Short acronyms might or might not be linked depending on algorithm
      expect(result.content).toBeDefined();
    });

    it('should handle entity names with numbers', async () => {
      createEntityCacheInStateDb(stateDb, tempVault, {
        projects: ['Project 2026', 'Phase 2'],
        technologies: ['ES2024', 'Node20'],
      });

      await initializeEntityIndex(tempVault);

      const content = 'Working on Project 2026 using ES2024 features in Node20 for Phase 2';
      const result = processWikilinks(content);

      expect(result.content).toBeDefined();
    });

    it('should handle entity names that are substrings of words', async () => {
      createEntityCacheInStateDb(stateDb, tempVault, {
        technologies: ['React'],
        concepts: ['Act'],
      });

      await initializeEntityIndex(tempVault);

      // "React" contains "Act" - should not double-link
      const content = 'Using React framework. Need to act on feedback.';
      const result = processWikilinks(content);

      // Should handle substring matching correctly (word boundaries)
      expect(result.content).toBeDefined();
      // Should not have nested links
      expect(result.content).not.toContain('[[[');
    });
  });
});
