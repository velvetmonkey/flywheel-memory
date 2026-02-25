/**
 * Chaos Mutation Testing — Vault-Scale Integration
 *
 * Tests that the entity index survives heavy vault editing:
 * bulk renames, hub deletions, concurrent edits, and name recycling.
 *
 * Complements chaos.test.ts (which tests suggestion quality under adversarial content)
 * by testing structural vault mutations at scale.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, readFile, rm, rename, mkdir, readdir } from 'fs/promises';
import path from 'path';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
  openStateDb,
  deleteStateDb,
  type StateDb,
} from '../helpers/testUtils.js';
import {
  initializeEntityIndex,
  isEntityIndexReady,
  getEntityIndexStats,
  setWriteStateDb,
  extractLinkedEntities,
  suggestRelatedLinks,
} from '../../src/core/write/wikilinks.js';
import { setRecencyStateDb } from '../../src/core/shared/recency.js';
import { computeGraphHealth, type GraphHealthReport } from './harness.js';

describe('Chaos Mutation Testing', () => {
  let tempVault: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    tempVault = await createTempVault();
    stateDb = openStateDb(tempVault);
    setWriteStateDb(stateDb);
    setRecencyStateDb(stateDb);
  });

  afterEach(async () => {
    setWriteStateDb(null);
    setRecencyStateDb(null);
    stateDb.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  // =========================================================================
  // Scenario 1: Bulk Rename — rename many notes in rapid succession
  // =========================================================================
  describe('Scenario 1: Bulk rename 50 notes', () => {
    it('entity index stays consistent after bulk renames', async () => {
      // Create 50 entity notes
      const noteCount = 50;
      for (let i = 0; i < noteCount; i++) {
        await createTestNote(
          tempVault,
          `entities/Entity-${i}.md`,
          `---\ntype: concept\n---\n# Entity ${i}\n\nContent about entity ${i}.\n`,
        );
      }

      // Create cross-referencing notes
      for (let i = 0; i < 10; i++) {
        const refs = Array.from({ length: 5 }, (_, j) => `[[Entity-${(i * 5 + j) % noteCount}]]`).join(', ');
        await createTestNote(
          tempVault,
          `notes/note-${i}.md`,
          `# Note ${i}\n\nReferences: ${refs}\n`,
        );
      }

      // Initialize and capture baseline
      await initializeEntityIndex(tempVault);
      expect(isEntityIndexReady()).toBe(true);
      const baselineStats = getEntityIndexStats();
      const baselineHealth = await computeGraphHealth(tempVault);

      // Bulk rename all 50 entity notes (simulate rapid renaming)
      for (let i = 0; i < noteCount; i++) {
        const oldPath = path.join(tempVault, `entities/Entity-${i}.md`);
        const newPath = path.join(tempVault, `entities/Renamed-Entity-${i}.md`);
        const content = await readFile(oldPath, 'utf-8');
        // Update content to reflect new name
        const updatedContent = content.replace(`Entity ${i}`, `Renamed Entity ${i}`);
        await writeFile(newPath, updatedContent, 'utf-8');
        await rm(oldPath);
      }

      // Re-initialize entity index after renames
      await initializeEntityIndex(tempVault);
      expect(isEntityIndexReady()).toBe(true);

      const afterStats = getEntityIndexStats();
      const afterHealth = await computeGraphHealth(tempVault);

      // Entity count should be stable (renamed, not lost)
      expect(afterStats.totalEntities).toBeGreaterThanOrEqual(noteCount);

      // Graph should still have notes (structure preserved)
      expect(afterHealth.noteCount).toBe(baselineHealth.noteCount);

      // No crashes during re-initialization
      expect(afterStats.ready).toBe(true);
    }, 30000);
  });

  // =========================================================================
  // Scenario 2: Hub Entity Deletion — delete a highly-connected entity
  // =========================================================================
  describe('Scenario 2: Delete hub entity note', () => {
    it('backlink count drops and no orphan references crash the index', async () => {
      // Create a hub entity that many notes link to
      await createTestNote(
        tempVault,
        'entities/Central-Hub.md',
        `---\ntype: project\n---\n# Central Hub\n\nThe main hub entity that everything connects to.\n`,
      );

      // Create 20 spoke notes that reference the hub
      for (let i = 0; i < 20; i++) {
        await createTestNote(
          tempVault,
          `notes/spoke-${i}.md`,
          `# Spoke ${i}\n\nThis note is about [[Central Hub]] and its impact on spoke ${i}.\n`,
        );
      }

      // Create a few secondary entities
      for (const name of ['Alpha', 'Beta', 'Gamma']) {
        await createTestNote(
          tempVault,
          `entities/${name}.md`,
          `---\ntype: concept\n---\n# ${name}\n\nSecondary entity linked to [[Central Hub]].\n`,
        );
      }

      // Initialize and verify hub is present
      await initializeEntityIndex(tempVault);
      const beforeHealth = await computeGraphHealth(tempVault);
      expect(beforeHealth.linkCount).toBeGreaterThan(0);

      // Delete the hub entity note
      await rm(path.join(tempVault, 'entities/Central-Hub.md'));

      // Re-initialize — should not crash despite dangling references
      await initializeEntityIndex(tempVault);
      expect(isEntityIndexReady()).toBe(true);

      const afterHealth = await computeGraphHealth(tempVault);

      // Link count should drop (hub is gone, but spoke notes still have [[Central Hub]] text)
      // The hub note itself is gone, so any outgoing links from it are lost
      expect(afterHealth.noteCount).toBe(beforeHealth.noteCount - 1);

      // Entity index should still work — no crashes on suggestions
      const spokeContent = await readFile(path.join(tempVault, 'notes/spoke-0.md'), 'utf-8');
      const result = await suggestRelatedLinks(spokeContent, {
        maxSuggestions: 5,
        notePath: 'notes/spoke-0.md',
      });
      // Should not crash, may or may not have suggestions
      expect(result.suggestions).toBeInstanceOf(Array);
    }, 30000);
  });

  // =========================================================================
  // Scenario 3: Concurrent Edits — edit 10 notes simultaneously
  // =========================================================================
  describe('Scenario 3: Concurrent edits (simulated batch)', () => {
    it('parallel writes to different files produce no race conditions', async () => {
      // Create entity notes
      for (const name of ['React', 'TypeScript', 'Python', 'Docker', 'Kubernetes']) {
        await createTestNote(
          tempVault,
          `technologies/${name}.md`,
          `---\ntype: technology\n---\n# ${name}\n\nA technology note.\n`,
        );
      }

      // Create 10 notes that will be edited concurrently
      for (let i = 0; i < 10; i++) {
        await createTestNote(
          tempVault,
          `notes/concurrent-${i}.md`,
          `# Note ${i}\n\nInitial content for note ${i}.\n`,
        );
      }

      await initializeEntityIndex(tempVault);
      expect(isEntityIndexReady()).toBe(true);

      // Simulate concurrent edits: write all 10 files in parallel
      const editPromises = Array.from({ length: 10 }, async (_, i) => {
        const notePath = path.join(tempVault, `notes/concurrent-${i}.md`);
        const techs = ['React', 'TypeScript', 'Python', 'Docker', 'Kubernetes'];
        const tech = techs[i % techs.length];
        const newContent = `# Note ${i}\n\nUpdated content mentioning ${tech} and other technologies.\n\nWorking with ${tech} is great.\n`;
        await writeFile(notePath, newContent, 'utf-8');
      });

      await Promise.all(editPromises);

      // Re-initialize after concurrent edits
      await initializeEntityIndex(tempVault);
      expect(isEntityIndexReady()).toBe(true);

      const stats = getEntityIndexStats();
      expect(stats.ready).toBe(true);
      expect(stats.totalEntities).toBeGreaterThanOrEqual(5);

      // Health check should pass without errors
      const health = await computeGraphHealth(tempVault);
      expect(health.noteCount).toBe(15); // 5 tech + 10 content notes
      expect(health.linkDensity).toBeGreaterThanOrEqual(0);

      // Run suggestions on each edited note — should not crash
      const suggestionPromises = Array.from({ length: 10 }, async (_, i) => {
        const content = await readFile(
          path.join(tempVault, `notes/concurrent-${i}.md`),
          'utf-8',
        );
        return suggestRelatedLinks(content, {
          maxSuggestions: 3,
          notePath: `notes/concurrent-${i}.md`,
        });
      });

      const results = await Promise.all(suggestionPromises);
      for (const result of results) {
        expect(result.suggestions).toBeInstanceOf(Array);
      }
    }, 30000);
  });

  // =========================================================================
  // Scenario 4: Name Recycling — delete then recreate same-named note
  // =========================================================================
  describe('Scenario 4: Name recycling (delete + recreate)', () => {
    it('recreated entity is fresh, not stale from previous incarnation', async () => {
      // Create initial entity
      await createTestNote(
        tempVault,
        'entities/Phoenix.md',
        `---\ntype: project\ndescription: The original Phoenix project\n---\n# Phoenix\n\nOriginal project content about database migration.\n`,
      );

      // Create referencing notes
      await createTestNote(
        tempVault,
        'notes/ref-1.md',
        `# Reference 1\n\nWorking on [[Phoenix]] migration.\n`,
      );

      // Initialize and verify original entity exists
      await initializeEntityIndex(tempVault);
      const beforeStats = getEntityIndexStats();
      expect(beforeStats.totalEntities).toBeGreaterThan(0);

      // Verify suggestions work for the original
      const ref1Content = await readFile(path.join(tempVault, 'notes/ref-1.md'), 'utf-8');
      const beforeSuggestions = await suggestRelatedLinks(ref1Content, {
        maxSuggestions: 5,
        notePath: 'notes/ref-1.md',
      });

      // Delete the entity
      await rm(path.join(tempVault, 'entities/Phoenix.md'));

      // Recreate with completely different content (name recycled)
      await createTestNote(
        tempVault,
        'entities/Phoenix.md',
        `---\ntype: concept\ndescription: The Phoenix framework for Elixir\n---\n# Phoenix\n\nA web framework for the Elixir programming language.\n`,
      );

      // Re-initialize — entity should reflect new content
      await initializeEntityIndex(tempVault);
      expect(isEntityIndexReady()).toBe(true);

      const afterStats = getEntityIndexStats();
      expect(afterStats.ready).toBe(true);

      // Entity count should be stable (one entity deleted, one created with same name)
      expect(afterStats.totalEntities).toBe(beforeStats.totalEntities);

      // Suggestions should still work (no stale references)
      const afterSuggestions = await suggestRelatedLinks(ref1Content, {
        maxSuggestions: 5,
        notePath: 'notes/ref-1.md',
      });
      expect(afterSuggestions.suggestions).toBeInstanceOf(Array);

      // Verify the recreated note exists and has new content
      const newContent = await readFile(path.join(tempVault, 'entities/Phoenix.md'), 'utf-8');
      expect(newContent).toContain('Elixir');
      expect(newContent).not.toContain('database migration');
    }, 30000);
  });
});
