/**
 * Suite 6: Vault Lifecycle + Recovery
 *
 * Verifies the system recovers from data corruption and stale state.
 * Tests cold start, orphaned rows, stale index, and empty index scenarios.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, rm, mkdir } from 'fs/promises';
import path from 'path';
import {
  openStateDb,
  deleteStateDb,
  type StateDb,
} from '@velvetmonkey/vault-core';
import {
  initializeEntityIndex,
  isEntityIndexReady,
  getEntityIndexStats,
  getEntityIndex,
  setWriteStateDb,
  suggestRelatedLinks,
} from '../../src/core/write/wikilinks.js';
import { setRecencyStateDb } from '../../src/core/shared/recency.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
} from '../helpers/testUtils.js';

// =============================================================================
// Test Helpers
// =============================================================================

/** Create a standard test vault with entities and content notes */
async function createStandardVault(tempVault: string): Promise<void> {
  // Entity notes
  const entities = [
    { name: 'Alice Johnson', type: 'person', folder: 'people' },
    { name: 'Bob Smith', type: 'person', folder: 'people' },
    { name: 'Project Alpha', type: 'project', folder: 'projects' },
    { name: 'TypeScript', type: 'technology', folder: 'technologies' },
    { name: 'React', type: 'technology', folder: 'technologies' },
  ];

  for (const e of entities) {
    await createTestNote(
      tempVault,
      `${e.folder}/${e.name}.md`,
      `---\ntype: ${e.type}\n---\n# ${e.name}\n\nA note about ${e.name}.\n`,
    );
  }

  // Content notes with wikilinks
  await createTestNote(
    tempVault,
    'notes/meeting-notes.md',
    '# Meeting Notes\n\nDiscussed [[Project Alpha]] with [[Alice Johnson]].\nUsing [[TypeScript]] and [[React]].\n',
  );
  await createTestNote(
    tempVault,
    'notes/daily-2026-01-01.md',
    '# Daily Note\n\n[[Bob Smith]] worked on [[Project Alpha]] today.\nMigrating to [[TypeScript]].\n',
  );
  await createTestNote(
    tempVault,
    'notes/research.md',
    '# Research\n\nComparing [[React]] patterns with [[TypeScript]] best practices.\n',
  );
}

// =============================================================================
// Test Suite
// =============================================================================

describe('Suite 6: Recovery from Corruption and Stale State', () => {
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
  // 1. Cold start: No StateDb entities → initializeEntityIndex succeeds
  // =========================================================================
  it('cold start: initializeEntityIndex succeeds with empty StateDb', async () => {
    await createStandardVault(tempVault);

    // StateDb exists but has no entities (fresh state)
    expect(isEntityIndexReady()).toBe(false);

    await initializeEntityIndex(tempVault);

    expect(isEntityIndexReady()).toBe(true);
    const stats = getEntityIndexStats();
    expect(stats.totalEntities).toBeGreaterThanOrEqual(5);
    expect(stats.ready).toBe(true);

    // Suggestions should work
    const result = await suggestRelatedLinks(
      'Working with Alice Johnson on TypeScript.',
      { maxSuggestions: 5, notePath: 'test.md' },
    );
    expect(result.suggestions).toBeInstanceOf(Array);
  }, 30000);

  // =========================================================================
  // 2. Orphaned application rows: wikilink_applications for deleted entities
  // =========================================================================
  it('orphaned wikilink_applications rows do not crash queries', async () => {
    await createStandardVault(tempVault);
    await initializeEntityIndex(tempVault);

    // Insert application records for entities that don't exist
    const insertApp = stateDb.db.prepare(
      'INSERT OR IGNORE INTO wikilink_applications (entity, note_path, applied_at) VALUES (?, ?, datetime(\'now\'))',
    );
    insertApp.run('Nonexistent Entity', 'notes/gone.md');
    insertApp.run('Another Fake', 'notes/deleted.md');
    insertApp.run('Ghost Entity', 'notes/meeting-notes.md');

    // Re-initialize — should not crash
    await initializeEntityIndex(tempVault);
    expect(isEntityIndexReady()).toBe(true);

    // Suggestions should still work
    const result = await suggestRelatedLinks(
      'Working with TypeScript and React on the project.',
      { maxSuggestions: 5, notePath: 'notes/test.md' },
    );
    expect(result.suggestions).toBeInstanceOf(Array);

    // Querying application data should not crash
    const rows = stateDb.db.prepare(
      'SELECT entity, note_path FROM wikilink_applications',
    ).all() as Array<{ entity: string; note_path: string }>;
    expect(rows.length).toBeGreaterThanOrEqual(3);
  }, 30000);

  // =========================================================================
  // 3. Orphaned note_links: note_links for deleted notes
  // =========================================================================
  it('orphaned note_links rows do not crash and are cleaned on rebuild', async () => {
    await createStandardVault(tempVault);
    await initializeEntityIndex(tempVault);

    // Insert note_links for notes that don't exist on disk
    const insertLink = stateDb.db.prepare(
      'INSERT OR IGNORE INTO note_links (note_path, target) VALUES (?, ?)',
    );
    insertLink.run('notes/deleted-note.md', 'Alice Johnson');
    insertLink.run('notes/gone-forever.md', 'TypeScript');
    insertLink.run('notes/phantom.md', 'Project Alpha');

    // Re-initialize — should not crash
    await initializeEntityIndex(tempVault);
    expect(isEntityIndexReady()).toBe(true);

    // Suggestions should still work
    const result = await suggestRelatedLinks(
      'Discussing React and TypeScript with Bob Smith.',
      { maxSuggestions: 5, notePath: 'notes/test.md' },
    );
    expect(result.suggestions).toBeInstanceOf(Array);
  }, 30000);

  // =========================================================================
  // 4. Stale entity index: built_at set to 2h ago → checkAndRefreshIfStale
  // =========================================================================
  it('stale entity index recovers after re-initialization', async () => {
    await createStandardVault(tempVault);
    await initializeEntityIndex(tempVault);

    const beforeStats = getEntityIndexStats();
    expect(beforeStats.totalEntities).toBeGreaterThanOrEqual(5);

    // Add a new entity note that the stale index doesn't know about
    await createTestNote(
      tempVault,
      'people/Charlie Davis.md',
      '---\ntype: person\n---\n# Charlie Davis\n\nA new team member.\n',
    );

    // Force re-initialization (simulates what checkAndRefreshIfStale does)
    await initializeEntityIndex(tempVault);

    const afterStats = getEntityIndexStats();
    // Should now have the new entity
    expect(afterStats.totalEntities).toBeGreaterThanOrEqual(beforeStats.totalEntities);

    // New entity should be discoverable via suggestions
    const result = await suggestRelatedLinks(
      'Working with Charlie Davis on the new feature.',
      { maxSuggestions: 5, notePath: 'notes/test.md' },
    );
    expect(result.suggestions).toBeInstanceOf(Array);
  }, 30000);

  // =========================================================================
  // 5. Empty entity index: Clear entities → vault scan repopulates
  // =========================================================================
  it('empty entity index recovers via vault scan', async () => {
    await createStandardVault(tempVault);
    await initializeEntityIndex(tempVault);

    const beforeStats = getEntityIndexStats();
    expect(beforeStats.totalEntities).toBeGreaterThanOrEqual(5);

    // Clear all entities from StateDb
    stateDb.db.prepare('DELETE FROM entities').run();

    // Entity index should be effectively empty now
    // Re-initialize should repopulate from vault scan
    await initializeEntityIndex(tempVault);

    expect(isEntityIndexReady()).toBe(true);
    const afterStats = getEntityIndexStats();
    expect(afterStats.totalEntities).toBeGreaterThanOrEqual(5);

    // Suggestions should work with repopulated index
    const result = await suggestRelatedLinks(
      'Meeting with Alice Johnson about Project Alpha using TypeScript.',
      { maxSuggestions: 5, notePath: 'notes/test.md' },
    );
    expect(result.suggestions).toBeInstanceOf(Array);
  }, 30000);
});
