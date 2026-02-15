/**
 * Tests for SQLite State Management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  openStateDb,
  deleteStateDb,
  stateDbExists,
  searchEntities,
  searchEntitiesPrefix,
  getEntityByName,
  getEntitiesByAlias,
  getAllEntitiesFromDb,
  getEntityIndexFromDb,
  recordEntityMention,
  getEntityRecency,
  getAllRecency,
  setWriteState,
  getWriteState,
  deleteWriteState,
  getStateDbMetadata,
  isEntityDataStale,
  escapeFts5Query,
  FLYWHEEL_DIR,
  STATE_DB_FILENAME,
} from '../src/sqlite.js';
import type { StateDb } from '../src/sqlite.js';
import type { EntityIndex, EntityWithAliases } from '../src/types.js';

describe('SQLite State Management', () => {
  let testVaultPath: string;
  let stateDb: StateDb;

  beforeEach(() => {
    // Create a temporary directory for testing
    testVaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
  });

  afterEach(() => {
    // Close database and clean up
    if (stateDb) {
      stateDb.close();
    }
    if (fs.existsSync(testVaultPath)) {
      fs.rmSync(testVaultPath, { recursive: true });
    }
  });

  describe('Database Initialization', () => {
    it('should create database in .flywheel directory', () => {
      stateDb = openStateDb(testVaultPath);

      const expectedPath = path.join(testVaultPath, FLYWHEEL_DIR, STATE_DB_FILENAME);
      expect(fs.existsSync(expectedPath)).toBe(true);
    });

    it('should report database exists after creation', () => {
      expect(stateDbExists(testVaultPath)).toBe(false);
      stateDb = openStateDb(testVaultPath);
      expect(stateDbExists(testVaultPath)).toBe(true);
    });

    it('should delete database and WAL files', () => {
      stateDb = openStateDb(testVaultPath);
      stateDb.close();

      deleteStateDb(testVaultPath);
      expect(stateDbExists(testVaultPath)).toBe(false);
    });

    it('should have correct schema version', () => {
      stateDb = openStateDb(testVaultPath);
      const metadata = getStateDbMetadata(stateDb);
      expect(metadata.schemaVersion).toBe(3);
    });
  });

  describe('Entity Operations', () => {
    beforeEach(() => {
      stateDb = openStateDb(testVaultPath);
    });

    it('should insert and retrieve entities', () => {
      const entity: EntityWithAliases = {
        name: 'TypeScript',
        path: 'tech/typescript.md',
        aliases: ['TS'],
        hubScore: 10,
      };

      stateDb.insertEntity.run(
        entity.name,
        entity.name.toLowerCase(),
        entity.path,
        'technologies',
        JSON.stringify(entity.aliases),
        entity.hubScore
      );

      const result = getEntityByName(stateDb, 'TypeScript');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('TypeScript');
      expect(result!.category).toBe('technologies');
      expect(result!.aliases).toEqual(['TS']);
    });

    it('should search entities with FTS5', () => {
      // Insert test entities
      stateDb.insertEntity.run('TypeScript', 'typescript', 'tech/typescript.md', 'technologies', '["TS"]', 10);
      stateDb.insertEntity.run('JavaScript', 'javascript', 'tech/javascript.md', 'technologies', '["JS"]', 8);
      stateDb.insertEntity.run('Python', 'python', 'tech/python.md', 'technologies', '[]', 5);

      // Search for "technologies" - should match all three
      const results = searchEntities(stateDb, 'technologies');
      expect(results.length).toBe(3);

      // Search for exact word "typescript"
      const tsResults = searchEntities(stateDb, 'typescript');
      expect(tsResults.length).toBe(1);
      expect(tsResults[0].name).toBe('TypeScript');
    });

    it('should search entities by prefix', () => {
      stateDb.insertEntity.run('TypeScript', 'typescript', 'tech/typescript.md', 'technologies', '[]', 10);
      stateDb.insertEntity.run('Types', 'types', 'tech/types.md', 'concepts', '[]', 5);
      stateDb.insertEntity.run('Python', 'python', 'tech/python.md', 'technologies', '[]', 5);

      const results = searchEntitiesPrefix(stateDb, 'type');
      expect(results.length).toBe(2);
      expect(results.some(r => r.name === 'TypeScript')).toBe(true);
      expect(results.some(r => r.name === 'Types')).toBe(true);
    });

    it('should replace all entities from EntityIndex', () => {
      const index: EntityIndex = {
        technologies: [
          { name: 'React', path: 'tech/react.md', aliases: ['ReactJS'] },
          { name: 'Vue', path: 'tech/vue.md', aliases: [] },
        ],
        acronyms: [],
        people: [
          { name: 'John Doe', path: 'people/john.md', aliases: ['JD'] },
        ],
        projects: [],
        organizations: [],
        locations: [],
        concepts: [],
        other: [],
        _metadata: {
          total_entities: 3,
          generated_at: new Date().toISOString(),
          vault_path: testVaultPath,
          source: 'test',
        },
      };

      const count = stateDb.replaceAllEntities(index);
      expect(count).toBe(3);

      const allEntities = getAllEntitiesFromDb(stateDb);
      expect(allEntities.length).toBe(3);

      const metadata = getStateDbMetadata(stateDb);
      expect(metadata.entityCount).toBe(3);
    });

    it('should convert database entities back to EntityIndex', () => {
      const index: EntityIndex = {
        technologies: [{ name: 'React', path: 'tech/react.md', aliases: [] }],
        acronyms: [{ name: 'API', path: 'concepts/api.md', aliases: [] }],
        people: [],
        projects: [],
        organizations: [],
        locations: [],
        concepts: [],
        other: [],
        _metadata: {
          total_entities: 2,
          generated_at: new Date().toISOString(),
          vault_path: testVaultPath,
          source: 'test',
        },
      };

      stateDb.replaceAllEntities(index);

      const result = getEntityIndexFromDb(stateDb);
      expect(result.technologies.length).toBe(1);
      expect(result.acronyms.length).toBe(1);
      expect(result._metadata.total_entities).toBe(2);
    });
  });

  describe('Entity Alias Lookup', () => {
    beforeEach(() => {
      stateDb = openStateDb(testVaultPath);
    });

    it('should find entities by alias', () => {
      stateDb.insertEntity.run('TypeScript', 'typescript', 'tech/typescript.md', 'technologies', '["TS", "typescript"]', 10);
      stateDb.insertEntity.run('JavaScript', 'javascript', 'tech/javascript.md', 'technologies', '["JS"]', 8);

      const results = getEntitiesByAlias(stateDb, 'TS');
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('TypeScript');
    });

    it('should be case-insensitive', () => {
      stateDb.insertEntity.run('TypeScript', 'typescript', 'tech/typescript.md', 'technologies', '["TS"]', 10);

      const results = getEntitiesByAlias(stateDb, 'ts');
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('TypeScript');
    });

    it('should find multiple entities with the same alias', () => {
      stateDb.insertEntity.run('Production Environment', 'production environment', 'ops/prod.md', 'concepts', '["production"]', 5);
      stateDb.insertEntity.run('Production Line', 'production line', 'manufacturing/line.md', 'concepts', '["production"]', 3);

      const results = getEntitiesByAlias(stateDb, 'production');
      expect(results.length).toBe(2);
    });

    it('should return empty array for non-existent alias', () => {
      stateDb.insertEntity.run('TypeScript', 'typescript', 'tech/typescript.md', 'technologies', '["TS"]', 10);

      const results = getEntitiesByAlias(stateDb, 'nonexistent');
      expect(results.length).toBe(0);
    });

    it('should handle null aliases_json', () => {
      stateDb.insertEntity.run('TypeScript', 'typescript', 'tech/typescript.md', 'technologies', null, 10);

      const results = getEntitiesByAlias(stateDb, 'typescript');
      expect(results.length).toBe(0);
    });
  });

  describe('Recency Operations', () => {
    beforeEach(() => {
      stateDb = openStateDb(testVaultPath);
    });

    it('should record entity mentions', () => {
      const now = new Date();
      recordEntityMention(stateDb, 'TypeScript', now);

      const recency = getEntityRecency(stateDb, 'TypeScript');
      expect(recency).not.toBeNull();
      expect(recency!.mentionCount).toBe(1);
      expect(recency!.lastMentionedAt).toBe(now.getTime());
    });

    it('should increment mention count on subsequent mentions', () => {
      recordEntityMention(stateDb, 'TypeScript');
      recordEntityMention(stateDb, 'TypeScript');
      recordEntityMention(stateDb, 'TypeScript');

      const recency = getEntityRecency(stateDb, 'TypeScript');
      expect(recency!.mentionCount).toBe(3);
    });

    it('should get all recency data ordered by most recent', () => {
      recordEntityMention(stateDb, 'TypeScript', new Date(1000));
      recordEntityMention(stateDb, 'React', new Date(3000));
      recordEntityMention(stateDb, 'Vue', new Date(2000));

      const all = getAllRecency(stateDb);
      expect(all.length).toBe(3);
      expect(all[0].entityNameLower).toBe('react');
      expect(all[1].entityNameLower).toBe('vue');
      expect(all[2].entityNameLower).toBe('typescript');
    });
  });

  describe('Write State Operations', () => {
    beforeEach(() => {
      stateDb = openStateDb(testVaultPath);
    });

    it('should store and retrieve write state', () => {
      const state = {
        hash: 'abc123',
        message: 'Test commit',
        timestamp: Date.now(),
      };

      setWriteState(stateDb, 'last_commit', state);

      const result = getWriteState<typeof state>(stateDb, 'last_commit');
      expect(result).toEqual(state);
    });

    it('should update existing write state', () => {
      setWriteState(stateDb, 'key1', { value: 1 });
      setWriteState(stateDb, 'key1', { value: 2 });

      const result = getWriteState<{ value: number }>(stateDb, 'key1');
      expect(result!.value).toBe(2);
    });

    it('should delete write state', () => {
      setWriteState(stateDb, 'temp_key', { data: 'temp' });
      expect(getWriteState(stateDb, 'temp_key')).not.toBeNull();

      deleteWriteState(stateDb, 'temp_key');
      expect(getWriteState(stateDb, 'temp_key')).toBeNull();
    });
  });

  describe('Metadata and Staleness', () => {
    beforeEach(() => {
      stateDb = openStateDb(testVaultPath);
    });

    it('should report data as stale when no entities built', () => {
      expect(isEntityDataStale(stateDb)).toBe(true);
    });

    it('should not report data as stale immediately after build', () => {
      const index: EntityIndex = {
        technologies: [{ name: 'Test', path: 'test.md', aliases: [] }],
        acronyms: [],
        people: [],
        projects: [],
        organizations: [],
        locations: [],
        concepts: [],
        other: [],
        _metadata: {
          total_entities: 1,
          generated_at: new Date().toISOString(),
          vault_path: testVaultPath,
          source: 'test',
        },
      };

      stateDb.replaceAllEntities(index);
      expect(isEntityDataStale(stateDb, 60 * 60 * 1000)).toBe(false);
    });
  });

  describe('FTS5 Query Escaping', () => {
    it('should escape special characters', () => {
      expect(escapeFts5Query('test (query)')).toBe('test query');
      expect(escapeFts5Query('test: value')).toBe('test value');
      expect(escapeFts5Query('test "value"')).toBe('test ""value""');
    });

    it('should preserve wildcards for prefix search', () => {
      // The * character should be preserved for prefix matching
      const query = escapeFts5Query('test');
      expect(query + '*').toBe('test*');
    });
  });

  describe('Bulk Operations Performance', () => {
    beforeEach(() => {
      stateDb = openStateDb(testVaultPath);
    });

    it('should efficiently insert 1000 entities', () => {
      const entities: EntityWithAliases[] = Array.from({ length: 1000 }, (_, i) => ({
        name: `Entity${i}`,
        path: `entities/entity${i}.md`,
        aliases: [`E${i}`, `Ent${i}`],
        hubScore: Math.floor(Math.random() * 100),
      }));

      const start = performance.now();
      const count = stateDb.bulkInsertEntities(entities, 'concepts');
      const duration = performance.now() - start;

      expect(count).toBe(1000);
      expect(duration).toBeLessThan(500); // Should complete in under 500ms
    });

    it('should efficiently search 10k entities', () => {
      // Insert 10k entities
      const categories = ['technologies', 'concepts', 'people', 'projects', 'other'] as const;
      for (const category of categories) {
        const entities: EntityWithAliases[] = Array.from({ length: 2000 }, (_, i) => ({
          name: `${category.slice(0, 4)}${i}`,
          path: `${category}/${category}${i}.md`,
          aliases: [],
          hubScore: 0,
        }));
        stateDb.bulkInsertEntities(entities, category);
      }

      // Search should be fast - use prefix search for "tech*"
      const start = performance.now();
      const results = searchEntitiesPrefix(stateDb, 'tech');
      const duration = performance.now() - start;

      expect(results.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(10); // Should complete in under 10ms
    });
  });
});
