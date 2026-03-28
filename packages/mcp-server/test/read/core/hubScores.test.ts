/**
 * Tests for hub score persistence fix (hubExport.ts)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createTempVault,
  cleanupTempVault,
  openStateDb,
  deleteStateDb,
  type StateDb,
} from '../../helpers/testUtils.js';
import { computeHubScores, exportHubScores } from '../../../src/core/shared/hubExport.js';
import type { VaultIndex, VaultNote, Backlink } from '../../../src/core/read/types.js';

function makeNote(notePath: string, outlinks: Array<{ target: string }> = []): VaultNote {
  return {
    path: notePath,
    title: notePath.replace(/\.md$/, '').split('/').pop() || notePath,
    aliases: [],
    frontmatter: {},
    outlinks: outlinks.map(ol => ({ target: ol.target, line: 1 })),
    tags: [],
    modified: new Date(),
  };
}

function buildIndex(notes: VaultNote[]): VaultIndex {
  const noteMap = new Map<string, VaultNote>();
  const entities = new Map<string, string>();
  for (const note of notes) {
    noteMap.set(note.path, note);
    entities.set(note.title.toLowerCase(), note.path);
  }
  return {
    notes: noteMap,
    backlinks: new Map(),
    entities,
    tags: new Map(),
    builtAt: new Date(),
  };
}

describe('hub score persistence', () => {
  let vaultPath: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    vaultPath = await createTempVault();
    stateDb = openStateDb(vaultPath);
  });

  afterEach(async () => {
    stateDb.db.close();
    deleteStateDb(vaultPath);
    await cleanupTempVault(vaultPath);
  });

  it('should update hub scores for nested-path entities', async () => {
    // Insert entities with nested paths
    stateDb.db.prepare(`
      INSERT INTO entities (name, name_lower, path, category)
      VALUES (?, ?, ?, ?)
    `).run('Flywheel', 'flywheel', 'tech/flywheel/Flywheel.md', 'project');

    stateDb.db.prepare(`
      INSERT INTO entities (name, name_lower, path, category)
      VALUES (?, ?, ?, ?)
    `).run('React', 'react', 'tech/React.md', 'technology');

    // Build a graph where both notes link to each other
    const notes = [
      makeNote('tech/flywheel/Flywheel.md', [{ target: 'React' }]),
      makeNote('tech/React.md', [{ target: 'Flywheel' }]),
    ];
    const index = buildIndex(notes);

    const result = await exportHubScores(index, stateDb);
    expect(result).toBeGreaterThan(0);

    // Verify both nested entities got scores
    const fw = stateDb.db.prepare('SELECT hub_score FROM entities WHERE name_lower = ?').get('flywheel') as { hub_score: number };
    const react = stateDb.db.prepare('SELECT hub_score FROM entities WHERE name_lower = ?').get('react') as { hub_score: number };

    expect(fw.hub_score).toBeGreaterThan(0);
    expect(react.hub_score).toBeGreaterThan(0);
  });

  it('should still work for top-level entities', async () => {
    stateDb.db.prepare(`
      INSERT INTO entities (name, name_lower, path, category)
      VALUES (?, ?, ?, ?)
    `).run('Alpha', 'alpha', 'Alpha.md', 'concept');

    stateDb.db.prepare(`
      INSERT INTO entities (name, name_lower, path, category)
      VALUES (?, ?, ?, ?)
    `).run('Beta', 'beta', 'Beta.md', 'concept');

    const notes = [
      makeNote('Alpha.md', [{ target: 'Beta' }]),
      makeNote('Beta.md', [{ target: 'Alpha' }]),
    ];
    const index = buildIndex(notes);

    const result = await exportHubScores(index, stateDb);
    expect(result).toBeGreaterThan(0);

    const alpha = stateDb.db.prepare('SELECT hub_score FROM entities WHERE name_lower = ?').get('alpha') as { hub_score: number };
    expect(alpha.hub_score).toBeGreaterThan(0);
  });

  it('should reset stale hub scores to zero', async () => {
    // Insert entity with a pre-existing nonzero hub score
    stateDb.db.prepare(`
      INSERT INTO entities (name, name_lower, path, category, hub_score)
      VALUES (?, ?, ?, ?, ?)
    `).run('Stale', 'stale', 'Stale.md', 'concept', 50);

    // Empty graph — no notes, no edges
    const index = buildIndex([]);

    await exportHubScores(index, stateDb);

    const stale = stateDb.db.prepare('SELECT hub_score FROM entities WHERE name_lower = ?').get('stale') as { hub_score: number };
    expect(stale.hub_score).toBe(0);
  });

  it('should reset scores for entities not in current computed scores', async () => {
    // Two entities, but only one will be in the graph
    stateDb.db.prepare(`
      INSERT INTO entities (name, name_lower, path, category, hub_score)
      VALUES (?, ?, ?, ?, ?)
    `).run('Connected', 'connected', 'Connected.md', 'concept', 0);

    stateDb.db.prepare(`
      INSERT INTO entities (name, name_lower, path, category, hub_score)
      VALUES (?, ?, ?, ?, ?)
    `).run('Disconnected', 'disconnected', 'Disconnected.md', 'concept', 75);

    // Only Connected is in the graph
    const notes = [
      makeNote('Connected.md', [{ target: 'Connected' }]), // self-links don't create edges, but we need at least 2 nodes
      makeNote('Other.md', [{ target: 'Connected' }]),
    ];
    const index = buildIndex(notes);

    await exportHubScores(index, stateDb);

    const disconnected = stateDb.db.prepare('SELECT hub_score FROM entities WHERE name_lower = ?').get('disconnected') as { hub_score: number };
    expect(disconnected.hub_score).toBe(0);
  });
});
