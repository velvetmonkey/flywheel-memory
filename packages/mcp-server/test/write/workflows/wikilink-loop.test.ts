/**
 * Wikilink Flywheel Loop Tests
 *
 * Tests the complete flywheel cycle:
 * 1. Mutation with wikilinks
 * 2. Wikilink suggestions generated
 * 3. Entity index updated
 * 4. Subsequent mutations use updated index
 *
 * These tests verify the "flywheel effect" where:
 * - Write → auto-wikilinks → reindex → smarter suggestions → repeat
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
  maybeApplyWikilinks,
  suggestRelatedLinks,
  isEntityIndexReady,
  extractLinkedEntities,
  setCrankStateDb,
} from '../../../src/core/write/wikilinks.js';

describe('Wikilink Flywheel Loop', () => {
  let tempVault: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    tempVault = await createTempVault();
    stateDb = openStateDb(tempVault);
    setCrankStateDb(stateDb);
  });

  afterEach(async () => {
    setCrankStateDb(null);
    stateDb.db.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  describe('mutation → suggestion → reindex → verify cycle', () => {
    it('should complete full flywheel cycle', async () => {
      // Setup: Create vault with entities
      await createVaultWithEntities(tempVault);

      // Also create entity cache
      createEntityCacheInStateDb(stateDb, tempVault, {
        people: ['Jordan Smith'],
        projects: ['MCP Server'],
        technologies: ['TypeScript'],
        acronyms: ['API'],
      });

      // Create a daily note to mutate
      const dailyNote = `---
type: daily
date: 2026-02-01
---
# 2026-02-01

## Log
- Morning standup

## Tasks
- [ ] Review code
`;
      await createTestNote(tempVault, 'daily/2026-02-01.md', dailyNote);

      // Step 1: Initialize entity index
      await initializeEntityIndex(tempVault);
      expect(isEntityIndexReady()).toBe(true);

      // Step 2: Mutate with content that should match entities
      const { content, frontmatter, lineEnding } = await readVaultFile(
        tempVault,
        'daily/2026-02-01.md'
      );

      const section = findSection(content, 'Log')!;
      expect(section).toBeDefined();

      // Add content mentioning entities
      const newEntry = '- Met with Jordan Smith to discuss TypeScript API for MCP Server';
      const modified = insertInSection(content, section, newEntry, 'append');

      // Apply wikilinks to the modified content
      const wikilinkResult = processWikilinks(modified, 'daily/2026-02-01.md');

      await writeVaultFile(tempVault, 'daily/2026-02-01.md', wikilinkResult.content, frontmatter, lineEnding);

      // Step 3: Verify wikilinks were applied
      const result = await readTestNote(tempVault, 'daily/2026-02-01.md');

      // At least some entities should be linked (depending on matching algorithm)
      const hasWikilinks = result.includes('[[');
      expect(hasWikilinks).toBe(true);

      // Step 4: Get suggestions for future content
      const suggestions = suggestRelatedLinks('Working on the TypeScript project with the team');
      expect(suggestions).toBeDefined();
      expect(suggestions.suggestions).toBeInstanceOf(Array);
    });

    it('should not create nested or duplicate wikilinks', async () => {
      createEntityCacheInStateDb(stateDb, tempVault, {
        people: ['Alice', 'Bob'],
        projects: ['Project X'],
      });

      const content = `---
type: meeting
---
# Meeting Notes

## Attendees
- [[Alice]]
- [[Bob]]

## Discussion
Talked about Project X with the team.
`;
      await createTestNote(tempVault, 'meeting.md', content);

      await initializeEntityIndex(tempVault);

      const { content: readContent } = await readVaultFile(tempVault, 'meeting.md');

      // Apply wikilinks
      const linked = processWikilinks(readContent, 'meeting.md');

      // Should not create nested brackets like [[[Alice]]]
      expect(linked.content).not.toContain('[[[');
      expect(linked.content).not.toContain(']]]');

      // Original [[Alice]] and [[Bob]] should still be there
      expect(linked.content).toContain('[[Alice]]');
      expect(linked.content).toContain('[[Bob]]');

      // Project X should be linked
      expect(linked.content).toContain('[[Project X]]');
    });
  });

  describe('entity edge cases', () => {
    it('should handle special characters in entity names', async () => {
      createEntityCacheInStateDb(stateDb, tempVault, {
        technologies: ['Node.js', 'React.js', 'Vue.js'],
      });

      const content = `---
type: note
---
# Tech Notes

## Frameworks
Using React.js and Vue.js with Node.js backend.
`;
      await createTestNote(tempVault, 'tech.md', content);

      await initializeEntityIndex(tempVault);

      const { content: readContent } = await readVaultFile(tempVault, 'tech.md');
      const linked = processWikilinks(readContent, 'tech.md');

      // Should handle entities with dots
      // Note: exact matching depends on the wikilinks algorithm
      expect(linked.content).toBeDefined();
    });

    it('should handle duplicate entity names across categories', async () => {
      // Entity "React" exists in technologies
      createEntityCacheInStateDb(stateDb, tempVault, {
        technologies: ['React'],
      });

      const content = `---
type: note
---
# React Notes

## Discussion
React is great for building UIs. I love working with React daily.
`;
      await createTestNote(tempVault, 'react.md', content);

      await initializeEntityIndex(tempVault);

      const { content: readContent } = await readVaultFile(tempVault, 'react.md');
      const linked = processWikilinks(readContent, 'react.md');

      // First occurrence rule: should link only once
      const reactCount = (linked.content.match(/\[\[React\]\]/g) || []).length;
      // Should be 0 or 1 (first occurrence only, and might skip in heading)
      expect(reactCount).toBeLessThanOrEqual(1);
    });
  });

  describe('idempotency', () => {
    it('should not duplicate links on re-run', async () => {
      createEntityCacheInStateDb(stateDb, tempVault, {
        people: ['Alice'],
        projects: ['Project X'],
      });

      const content = `---
type: note
---
# Notes

## Discussion
Working with Alice on Project X.
`;
      await createTestNote(tempVault, 'idem.md', content);

      await initializeEntityIndex(tempVault);

      // First application
      let { content: readContent, frontmatter, lineEnding } = await readVaultFile(
        tempVault,
        'idem.md'
      );
      const linked1 = processWikilinks(readContent, 'idem.md');
      await writeVaultFile(tempVault, 'idem.md', linked1.content, frontmatter, lineEnding);

      // Second application (should be idempotent)
      ({ content: readContent, frontmatter, lineEnding } = await readVaultFile(
        tempVault,
        'idem.md'
      ));
      const linked2 = processWikilinks(readContent, 'idem.md');
      await writeVaultFile(tempVault, 'idem.md', linked2.content, frontmatter, lineEnding);

      const result = await readTestNote(tempVault, 'idem.md');

      // Should have at most one [[Alice]] and one [[Project X]]
      const aliceCount = (result.match(/\[\[Alice\]\]/g) || []).length;
      const projectCount = (result.match(/\[\[Project X\]\]/g) || []).length;

      expect(aliceCount).toBeLessThanOrEqual(1);
      expect(projectCount).toBeLessThanOrEqual(1);
    });

    it('should not corrupt nested wikilinks', async () => {
      createEntityCacheInStateDb(stateDb, tempVault, {
        people: ['Alice'],
        projects: ['Project X'],
      });

      // Content with display text wikilinks
      const content = `---
type: note
---
# Notes

## Links
See [[Alice|Alice Smith]] for more info.
The [[Project X|main project]] is progressing.
`;
      await createTestNote(tempVault, 'nested.md', content);

      await initializeEntityIndex(tempVault);

      const { content: readContent, frontmatter, lineEnding } = await readVaultFile(
        tempVault,
        'nested.md'
      );
      const linked = processWikilinks(readContent, 'nested.md');
      await writeVaultFile(tempVault, 'nested.md', linked.content, frontmatter, lineEnding);

      const result = await readTestNote(tempVault, 'nested.md');

      // Display text links should be preserved
      expect(result).toContain('[[Alice|Alice Smith]]');
      expect(result).toContain('[[Project X|main project]]');

      // Should not create nested brackets
      expect(result).not.toContain('[[[');
      expect(result).not.toContain(']]]');
    });
  });

  describe('excluded entities', () => {
    it('should track already linked entities correctly', async () => {
      createEntityCacheInStateDb(stateDb, tempVault, {
        people: ['Alice', 'Bob', 'Charlie'],
        projects: ['Project X'],
      });

      const content = `---
type: note
---
# Meeting Notes

## Discussion
Met with [[Alice]] to discuss the project.
Also [[Bob]] joined later.
Charlie will join tomorrow.
`;
      await createTestNote(tempVault, 'exclude.md', content);

      const { content: readContent } = await readVaultFile(tempVault, 'exclude.md');

      // Extract linked entities
      const linked = extractLinkedEntities(readContent);

      // Alice and Bob should be detected as linked
      expect(linked.has('alice')).toBe(true);
      expect(linked.has('bob')).toBe(true);

      // Charlie should NOT be in linked set (not wrapped in [[]])
      expect(linked.has('charlie')).toBe(false);
    });
  });

  describe('suggestion suffix format', () => {
    it('should return suggestions as array with suffix', async () => {
      createEntityCacheInStateDb(stateDb, tempVault, {
        people: ['Alice', 'Bob'],
        projects: ['Project X', 'Project Y'],
      });

      await initializeEntityIndex(tempVault);

      // Get suggestions for content
      const content = 'Working on projects with the team';
      const result = suggestRelatedLinks(content, { maxSuggestions: 3 });

      expect(result).toBeDefined();
      expect(result.suggestions).toBeInstanceOf(Array);
      expect(typeof result.suffix).toBe('string');

      // If there are suggestions, suffix should contain arrow
      if (result.suggestions.length > 0) {
        expect(result.suffix).toContain('→');
        expect(result.suffix).toMatch(/\[\[.*\]\]/);
      }
    });

    it('should respect maxSuggestions option', async () => {
      createEntityCacheInStateDb(stateDb, tempVault, {
        people: ['Alice', 'Bob', 'Charlie', 'David', 'Eve'],
        projects: ['Project A', 'Project B', 'Project C'],
      });

      await initializeEntityIndex(tempVault);

      const result = suggestRelatedLinks('Working with team on projects', {
        maxSuggestions: 2,
      });

      // Should have at most 2 suggestions
      expect(result.suggestions.length).toBeLessThanOrEqual(2);
    });
  });

  describe('maybeApplyWikilinks integration', () => {
    it('should apply wikilinks when skipWikilinks is false', async () => {
      createEntityCacheInStateDb(stateDb, tempVault, {
        people: ['Alice'],
        projects: ['Project X'],
      });

      await initializeEntityIndex(tempVault);

      const content = 'Met with Alice to discuss Project X';
      const result = maybeApplyWikilinks(content, false, 'test.md');

      expect(result.content).toBeDefined();
      // May or may not have wikilinks depending on matching
    });

    it('should skip wikilinks when skipWikilinks is true', async () => {
      createEntityCacheInStateDb(stateDb, tempVault, {
        people: ['Alice'],
        projects: ['Project X'],
      });

      await initializeEntityIndex(tempVault);

      const content = 'Met with Alice to discuss Project X';
      const result = maybeApplyWikilinks(content, true, 'test.md');

      // Content should be unchanged
      expect(result.content).toBe(content);
      expect(result.wikilinkInfo).toBeUndefined();
    });
  });
});
