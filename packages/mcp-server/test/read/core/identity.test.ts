/**
 * Tests for note identity helpers (core/read/identity.ts)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createTempVault,
  cleanupTempVault,
  openStateDb,
  deleteStateDb,
  type StateDb,
} from '../../helpers/testUtils.js';
import { normalizeResolvedPath, getInboundTargetsForNote } from '../../../src/core/read/identity.js';

describe('normalizeResolvedPath', () => {
  it('should strip .md and lowercase', () => {
    expect(normalizeResolvedPath('Foo.md')).toBe('foo');
  });

  it('should handle nested paths', () => {
    expect(normalizeResolvedPath('projects/My-Project.md')).toBe('projects/my-project');
  });

  it('should handle deeply nested paths', () => {
    expect(normalizeResolvedPath('tech/flywheel/Flywheel.md')).toBe('tech/flywheel/flywheel');
  });

  it('should handle already-normalized paths', () => {
    expect(normalizeResolvedPath('foo')).toBe('foo');
  });

  it('should handle paths without .md extension', () => {
    expect(normalizeResolvedPath('projects/Foo')).toBe('projects/foo');
  });
});

describe('getInboundTargetsForNote', () => {
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

  it('should return stem only when stateDb is null', () => {
    const targets = getInboundTargetsForNote(null, 'projects/foo.md');
    expect(targets).toEqual(['foo']);
  });

  it('should return stem only when no entity exists', () => {
    const targets = getInboundTargetsForNote(stateDb, 'projects/foo.md');
    expect(targets).toEqual(['foo']);
  });

  it('should return entity name_lower, aliases, and stem when entity exists', () => {
    // Insert an entity
    stateDb.db.prepare(`
      INSERT INTO entities (name, name_lower, path, category, aliases_json)
      VALUES (?, ?, ?, ?, ?)
    `).run('Flywheel', 'flywheel', 'tech/flywheel/Flywheel.md', 'project', JSON.stringify(['FM', 'flywheel-memory']));

    const targets = getInboundTargetsForNote(stateDb, 'tech/flywheel/Flywheel.md');

    // Should have: name_lower first, aliases, then stem
    expect(targets).toContain('flywheel');
    expect(targets).toContain('fm');
    expect(targets).toContain('flywheel-memory');
    // stem is same as name_lower here, should be deduped
    expect(targets.filter(t => t === 'flywheel').length).toBe(1);
  });

  it('should deduplicate targets', () => {
    stateDb.db.prepare(`
      INSERT INTO entities (name, name_lower, path, category, aliases_json)
      VALUES (?, ?, ?, ?, ?)
    `).run('Foo', 'foo', 'projects/Foo.md', 'concept', JSON.stringify(['foo']));

    const targets = getInboundTargetsForNote(stateDb, 'projects/Foo.md');
    // All resolve to 'foo' — should only appear once
    expect(targets).toEqual(['foo']);
  });

  it('should include stem even when entity has different name', () => {
    stateDb.db.prepare(`
      INSERT INTO entities (name, name_lower, path, category, aliases_json)
      VALUES (?, ?, ?, ?, ?)
    `).run('My Project', 'my project', 'projects/my-project.md', 'project', null);

    const targets = getInboundTargetsForNote(stateDb, 'projects/my-project.md');
    expect(targets).toContain('my project');
    expect(targets).toContain('my-project');
  });
});
