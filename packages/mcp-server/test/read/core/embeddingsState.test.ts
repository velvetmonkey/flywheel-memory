/**
 * Tests for embeddings state recovery (embeddings.ts)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createTempVault,
  cleanupTempVault,
  openStateDb,
  deleteStateDb,
  type StateDb,
} from '../../helpers/testUtils.js';
import {
  hasEmbeddingsIndex,
  setEmbeddingsBuildState,
  setEmbeddingsBuilding,
  setEmbeddingsDatabase,
} from '../../../src/core/read/embeddings.js';

describe('embeddings state recovery', () => {
  let vaultPath: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    vaultPath = await createTempVault();
    stateDb = openStateDb(vaultPath);
    // Point the embeddings module at our test DB
    setEmbeddingsDatabase(stateDb.db);
    // Ensure no active build
    setEmbeddingsBuilding(false);
  });

  afterEach(async () => {
    stateDb.db.close();
    deleteStateDb(vaultPath);
    await cleanupTempVault(vaultPath);
  });

  it('should return true when state is complete', () => {
    setEmbeddingsBuildState('complete');
    expect(hasEmbeddingsIndex()).toBe(true);
  });

  it('should return true when state is none but rows exist (backward compat)', () => {
    setEmbeddingsBuildState('none');
    // Insert a fake embedding row
    stateDb.db.prepare(`
      INSERT INTO note_embeddings (path, embedding, content_hash, model, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('test.md', Buffer.alloc(16), 'hash1', 'test-model', Date.now());

    expect(hasEmbeddingsIndex()).toBe(true);
  });

  it('should return false when state is none and no rows', () => {
    setEmbeddingsBuildState('none');
    expect(hasEmbeddingsIndex()).toBe(false);
  });

  it('should recover stale building_notes with existing rows to complete', () => {
    setEmbeddingsBuildState('building_notes');
    setEmbeddingsBuilding(false); // No active build

    // Insert a fake embedding row
    stateDb.db.prepare(`
      INSERT INTO note_embeddings (path, embedding, content_hash, model, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('test.md', Buffer.alloc(16), 'hash1', 'test-model', Date.now());

    expect(hasEmbeddingsIndex()).toBe(true);

    // Verify state was repaired
    const state = stateDb.db.prepare(`SELECT value FROM fts_metadata WHERE key = 'embeddings_state'`).get() as { value: string };
    expect(state.value).toBe('complete');
  });

  it('should recover stale building_entities with existing rows to complete', () => {
    setEmbeddingsBuildState('building_entities');
    setEmbeddingsBuilding(false);

    stateDb.db.prepare(`
      INSERT INTO note_embeddings (path, embedding, content_hash, model, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('test.md', Buffer.alloc(16), 'hash1', 'test-model', Date.now());

    expect(hasEmbeddingsIndex()).toBe(true);

    const state = stateDb.db.prepare(`SELECT value FROM fts_metadata WHERE key = 'embeddings_state'`).get() as { value: string };
    expect(state.value).toBe('complete');
  });

  it('should recover stale building_notes with no rows to none', () => {
    setEmbeddingsBuildState('building_notes');
    setEmbeddingsBuilding(false);

    expect(hasEmbeddingsIndex()).toBe(false);

    const state = stateDb.db.prepare(`SELECT value FROM fts_metadata WHERE key = 'embeddings_state'`).get() as { value: string };
    expect(state.value).toBe('none');
  });

  it('should NOT repair state during active build', () => {
    setEmbeddingsBuildState('building_notes');
    setEmbeddingsBuilding(true); // Active build

    stateDb.db.prepare(`
      INSERT INTO note_embeddings (path, embedding, content_hash, model, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('test.md', Buffer.alloc(16), 'hash1', 'test-model', Date.now());

    // Should return false even though rows exist — build is active
    expect(hasEmbeddingsIndex()).toBe(false);

    // State should NOT have been repaired
    const state = stateDb.db.prepare(`SELECT value FROM fts_metadata WHERE key = 'embeddings_state'`).get() as { value: string };
    expect(state.value).toBe('building_notes');
  });
});
