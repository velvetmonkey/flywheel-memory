/**
 * Tests for Entity Search Tool in Flywheel Memory
 *
 * Tests the search_entities tool which uses FTS5 full-text search
 * with Porter stemming for finding vault entities.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import {
  openStateDb,
  deleteStateDb,
  searchEntities,
  searchEntitiesPrefix,
  type StateDb,
} from '@velvetmonkey/vault-core';
import {
  createTempVault,
  cleanupTempVault,
} from '../helpers/testUtils.js';

describe('Entity Search Tool (search_entities)', () => {
  let tempVault: string;
  let stateDb: StateDb | null = null;

  beforeEach(async () => {
    tempVault = await createTempVault();

    // Set up test database with some entities
    stateDb = openStateDb(tempVault);

    // Clear and insert test entities
    stateDb.clearEntities.run();

    const entities = [
      { name: 'TypeScript', category: 'technologies', aliases: ['TS'], hubScore: 10 },
      { name: 'JavaScript', category: 'technologies', aliases: ['JS'], hubScore: 8 },
      { name: 'React', category: 'technologies', aliases: ['ReactJS'], hubScore: 15 },
      { name: 'John Smith', category: 'people', aliases: [], hubScore: 5 },
      { name: 'Project Alpha', category: 'projects', aliases: ['Alpha'], hubScore: 3 },
      { name: 'Running Tests', category: 'concepts', aliases: ['run test'], hubScore: 2 },
      { name: 'Authentication', category: 'concepts', aliases: ['auth', 'authn'], hubScore: 7 },
    ];

    for (const entity of entities) {
      stateDb.insertEntity.run(
        entity.name,
        entity.name.toLowerCase(),
        '',
        entity.category,
        JSON.stringify(entity.aliases),
        entity.hubScore
      );
    }

    stateDb.setMetadataValue.run('entities_built_at', new Date().toISOString());
    stateDb.setMetadataValue.run('entity_count', String(entities.length));
  });

  afterEach(async () => {
    if (stateDb) {
      stateDb.close();
      stateDb = null;
    }
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  describe('FTS5 Search Functionality', () => {
    it('finds entities by exact name match', () => {
      if (!stateDb) throw new Error('StateDb not initialized');

      const results = searchEntities(stateDb, 'TypeScript', 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(e => e.name === 'TypeScript')).toBe(true);
    });

    it('finds entities by full word match', () => {
      if (!stateDb) throw new Error('StateDb not initialized');

      // FTS5 matches full words, not substrings. "TypeScript" is a single token.
      const results = searchEntities(stateDb, 'TypeScript', 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(e => e.name === 'TypeScript')).toBe(true);
    });

    it('uses Porter stemming (running matches run)', () => {
      if (!stateDb) throw new Error('StateDb not initialized');

      const results = searchEntities(stateDb, 'run', 10);
      // Should find "Running Tests" due to Porter stemming
      expect(results.some(e => e.name.toLowerCase().includes('running'))).toBe(true);
    });

    it('uses Porter stemming (tests matches test)', () => {
      if (!stateDb) throw new Error('StateDb not initialized');

      const results = searchEntities(stateDb, 'test', 10);
      // Should find "Running Tests" due to Porter stemming
      expect(results.some(e => e.name.toLowerCase().includes('tests'))).toBe(true);
    });

    it('returns results ordered by relevance', () => {
      if (!stateDb) throw new Error('StateDb not initialized');

      const results = searchEntities(stateDb, 'TypeScript', 10);
      if (results.length > 0) {
        expect(results[0].name).toBe('TypeScript');
      }
    });
  });

  describe('Prefix Search (Autocomplete)', () => {
    it('finds entities with prefix matching', () => {
      if (!stateDb) throw new Error('StateDb not initialized');

      const results = searchEntitiesPrefix(stateDb, 'Type', 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(e => e.name.startsWith('Type'))).toBe(true);
    });

    it('prefix search works for authentication autocomplete', () => {
      if (!stateDb) throw new Error('StateDb not initialized');

      const results = searchEntitiesPrefix(stateDb, 'auth', 10);
      expect(results.some(e => e.name === 'Authentication')).toBe(true);
    });

    it('prefix search returns empty for no matches', () => {
      if (!stateDb) throw new Error('StateDb not initialized');

      const results = searchEntitiesPrefix(stateDb, 'xyz', 10);
      expect(results.length).toBe(0);
    });
  });

  describe('Result Structure', () => {
    it('returns correct result properties', () => {
      if (!stateDb) throw new Error('StateDb not initialized');

      const results = searchEntities(stateDb, 'React', 1);
      expect(results.length).toBeGreaterThan(0);

      const entity = results[0];
      expect(entity).toHaveProperty('id');
      expect(entity).toHaveProperty('name');
      expect(entity).toHaveProperty('nameLower');
      expect(entity).toHaveProperty('path');
      expect(entity).toHaveProperty('category');
      expect(entity).toHaveProperty('aliases');
      expect(entity).toHaveProperty('hubScore');
      expect(entity).toHaveProperty('rank');
    });

    it('returns category information', () => {
      if (!stateDb) throw new Error('StateDb not initialized');

      const results = searchEntities(stateDb, 'TypeScript', 1);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].category).toBe('technologies');
    });

    it('returns hub score information', () => {
      if (!stateDb) throw new Error('StateDb not initialized');

      const results = searchEntities(stateDb, 'React', 1);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].hubScore).toBe(15);
    });
  });

  describe('Limit Parameter', () => {
    it('respects limit parameter', () => {
      if (!stateDb) throw new Error('StateDb not initialized');

      const results = searchEntitiesPrefix(stateDb, 'a', 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('returns all matching results up to limit', () => {
      if (!stateDb) throw new Error('StateDb not initialized');

      const results = searchEntitiesPrefix(stateDb, 'J', 10);
      // Should find JavaScript and John Smith
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Edge Cases', () => {
    it('handles empty query', () => {
      if (!stateDb) throw new Error('StateDb not initialized');

      const results = searchEntities(stateDb, '', 10);
      // Empty query may return all or no results depending on FTS5 behavior
      expect(Array.isArray(results)).toBe(true);
    });

    it('handles special characters in query', () => {
      if (!stateDb) throw new Error('StateDb not initialized');

      // Should not throw, special characters are escaped
      const results = searchEntities(stateDb, 'Type-Script', 10);
      expect(Array.isArray(results)).toBe(true);
    });

    it('handles query with no matches', () => {
      if (!stateDb) throw new Error('StateDb not initialized');

      const results = searchEntities(stateDb, 'xyznonexistentquery', 10);
      expect(results.length).toBe(0);
    });

    it('handles aliases in search', () => {
      if (!stateDb) throw new Error('StateDb not initialized');

      // "TS" is an alias for TypeScript
      const results = searchEntities(stateDb, 'TS', 10);
      // The alias is indexed in FTS5, so it should be found
      expect(results.some(e => e.name === 'TypeScript' || e.aliases.includes('TS'))).toBe(true);
    });
  });

  describe('Integration with StateDb', () => {
    it('new entities are searchable immediately', () => {
      if (!stateDb) throw new Error('StateDb not initialized');

      // Add a new entity
      stateDb.insertEntity.run(
        'New Entity',
        'new entity',
        '',
        'concepts',
        JSON.stringify([]),
        0
      );

      // Should be immediately searchable
      const results = searchEntities(stateDb, 'New Entity', 10);
      expect(results.some(e => e.name === 'New Entity')).toBe(true);
    });

    it('deleted entities are not searchable', () => {
      if (!stateDb) throw new Error('StateDb not initialized');

      // Get TypeScript entity ID
      const entity = stateDb.getEntityByName.get('typescript') as { id: number } | undefined;
      if (entity) {
        stateDb.deleteEntity.run(entity.id);
      }

      // Should not find deleted entity
      const results = searchEntities(stateDb, 'TypeScript', 10);
      expect(results.some(e => e.name === 'TypeScript')).toBe(false);
    });
  });
});
