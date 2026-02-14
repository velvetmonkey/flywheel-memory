/**
 * Tests for SQLite State Migration
 *
 * Tests the migration from legacy JSON files to SQLite StateDb,
 * including entity migration, recency data, and crank state.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  openStateDb,
  deleteStateDb,
  migrateFromJsonToSqlite,
  getLegacyPaths,
  backupLegacyFiles,
  deleteLegacyFiles,
  getStateDbMetadata,
  getAllEntitiesFromDb,
  getAllRecency,
  getCrankState,
  type StateDb,
  type EntityIndex,
} from '@velvetmonkey/vault-core';
import {
  createTempVault,
  cleanupTempVault,
} from '../helpers/testUtils.js';

describe('SQLite State Migration', () => {
  let tempVault: string;
  let stateDb: StateDb | null = null;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    if (stateDb) {
      stateDb.close();
      stateDb = null;
    }
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  describe('Entity Migration', () => {
    it('migrates entities from JSON cache', async () => {
      // Create legacy entity cache
      const claudeDir = path.join(tempVault, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });

      const entityIndex: EntityIndex = {
        technologies: [
          { name: 'TypeScript', path: 'tech/typescript.md', aliases: ['TS'], hubScore: 10 },
          { name: 'JavaScript', path: 'tech/javascript.md', aliases: ['JS'], hubScore: 8 },
        ],
        people: [
          { name: 'John Smith', path: 'people/john-smith.md', aliases: [], hubScore: 5 },
        ],
        projects: [],
        organizations: [],
        locations: [],
        concepts: [],
        acronyms: [],
        other: [],
        _metadata: {
          total_entities: 3,
          generated_at: new Date().toISOString(),
          vault_path: tempVault,
          source: 'test',
        },
      };

      fs.writeFileSync(
        path.join(claudeDir, 'wikilink-entities.json'),
        JSON.stringify(entityIndex, null, 2)
      );

      // Open StateDb and migrate
      stateDb = openStateDb(tempVault);
      const legacyPaths = getLegacyPaths(tempVault);
      const result = await migrateFromJsonToSqlite(stateDb, legacyPaths);

      expect(result.success).toBe(true);
      expect(result.entitiesMigrated).toBe(3);

      // Verify entities in database
      const entities = getAllEntitiesFromDb(stateDb);
      expect(entities.length).toBe(3);
      expect(entities.some(e => e.name === 'TypeScript')).toBe(true);
      expect(entities.some(e => e.name === 'John Smith')).toBe(true);
    });

    it('preserves entity aliases during migration', async () => {
      const claudeDir = path.join(tempVault, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });

      const entityIndex: EntityIndex = {
        technologies: [
          { name: 'TypeScript', path: '', aliases: ['TS', 'ts'], hubScore: 0 },
        ],
        people: [],
        projects: [],
        organizations: [],
        locations: [],
        concepts: [],
        acronyms: [],
        other: [],
        _metadata: {
          total_entities: 1,
          generated_at: new Date().toISOString(),
          vault_path: tempVault,
          source: 'test',
        },
      };

      fs.writeFileSync(
        path.join(claudeDir, 'wikilink-entities.json'),
        JSON.stringify(entityIndex, null, 2)
      );

      stateDb = openStateDb(tempVault);
      const legacyPaths = getLegacyPaths(tempVault);
      await migrateFromJsonToSqlite(stateDb, legacyPaths);

      const entities = getAllEntitiesFromDb(stateDb);
      const ts = entities.find(e => e.name === 'TypeScript');
      expect(ts).toBeDefined();
      expect(ts?.aliases).toEqual(['TS', 'ts']);
    });

    it('preserves hub scores during migration', async () => {
      const claudeDir = path.join(tempVault, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });

      const entityIndex: EntityIndex = {
        technologies: [
          { name: 'React', path: '', aliases: [], hubScore: 42 },
        ],
        people: [],
        projects: [],
        organizations: [],
        locations: [],
        concepts: [],
        acronyms: [],
        other: [],
        _metadata: {
          total_entities: 1,
          generated_at: new Date().toISOString(),
          vault_path: tempVault,
          source: 'test',
        },
      };

      fs.writeFileSync(
        path.join(claudeDir, 'wikilink-entities.json'),
        JSON.stringify(entityIndex, null, 2)
      );

      stateDb = openStateDb(tempVault);
      const legacyPaths = getLegacyPaths(tempVault);
      await migrateFromJsonToSqlite(stateDb, legacyPaths);

      const entities = getAllEntitiesFromDb(stateDb);
      const react = entities.find(e => e.name === 'React');
      expect(react).toBeDefined();
      expect(react?.hubScore).toBe(42);
    });
  });

  describe('Recency Migration', () => {
    it('migrates recency data from JSON', async () => {
      const claudeDir = path.join(tempVault, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });

      const recencyData = {
        lastMentioned: {
          'typescript': Date.now() - 1000,
          'react': Date.now() - 5000,
        },
        lastUpdated: Date.now(),
        version: 1,
      };

      fs.writeFileSync(
        path.join(claudeDir, 'entity-recency.json'),
        JSON.stringify(recencyData, null, 2)
      );

      stateDb = openStateDb(tempVault);
      const legacyPaths = getLegacyPaths(tempVault);
      const result = await migrateFromJsonToSqlite(stateDb, legacyPaths);

      expect(result.success).toBe(true);
      expect(result.recencyMigrated).toBe(2);

      // Verify recency in database
      const recency = getAllRecency(stateDb);
      expect(recency.length).toBe(2);
      expect(recency.some(r => r.entityNameLower === 'typescript')).toBe(true);
      expect(recency.some(r => r.entityNameLower === 'react')).toBe(true);
    });
  });

  describe('Crank State Migration', () => {
    it('migrates last commit tracking from JSON', async () => {
      const claudeDir = path.join(tempVault, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });

      const lastCommit = {
        hash: 'abc123',
        message: '[Crank] Test commit',
        timestamp: new Date().toISOString(),
      };

      fs.writeFileSync(
        path.join(claudeDir, 'last-crank-commit.json'),
        JSON.stringify(lastCommit, null, 2)
      );

      stateDb = openStateDb(tempVault);
      const legacyPaths = getLegacyPaths(tempVault);
      const result = await migrateFromJsonToSqlite(stateDb, legacyPaths);

      expect(result.success).toBe(true);
      expect(result.crankStateMigrated).toBeGreaterThanOrEqual(1);

      // Verify in database
      const stored = getCrankState<typeof lastCommit>(stateDb, 'last_commit');
      expect(stored).toBeDefined();
      expect(stored?.hash).toBe('abc123');
    });

    it('migrates mutation hints from JSON', async () => {
      const claudeDir = path.join(tempVault, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });

      const hints = {
        version: 1,
        mutations: [
          {
            timestamp: new Date().toISOString(),
            path: 'notes/test.md',
            operation: 'add_to_section',
            beforeHash: 'aaa',
            afterHash: 'bbb',
          },
        ],
      };

      fs.writeFileSync(
        path.join(claudeDir, 'crank-mutation-hints.json'),
        JSON.stringify(hints, null, 2)
      );

      stateDb = openStateDb(tempVault);
      const legacyPaths = getLegacyPaths(tempVault);
      const result = await migrateFromJsonToSqlite(stateDb, legacyPaths);

      expect(result.success).toBe(true);

      // Verify in database
      const stored = getCrankState<typeof hints>(stateDb, 'mutation_hints');
      expect(stored).toBeDefined();
      expect(stored?.mutations.length).toBe(1);
    });
  });

  describe('Backup and Cleanup', () => {
    it('identifies legacy files for backup', async () => {
      const claudeDir = path.join(tempVault, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });

      fs.writeFileSync(
        path.join(claudeDir, 'wikilink-entities.json'),
        JSON.stringify({ technologies: [], _metadata: { total_entities: 0 } })
      );
      fs.writeFileSync(
        path.join(claudeDir, 'entity-recency.json'),
        JSON.stringify({ lastMentioned: {}, version: 1 })
      );

      const legacyPaths = getLegacyPaths(tempVault);
      const backed = await backupLegacyFiles(legacyPaths);

      // backupLegacyFiles reports which files were identified for backup
      expect(backed.success).toBe(true);
      expect(backed.backedUpFiles.length).toBe(2);
      expect(backed.backedUpFiles).toContain(path.join(claudeDir, 'wikilink-entities.json'));
      expect(backed.backedUpFiles).toContain(path.join(claudeDir, 'entity-recency.json'));
    });

    it('deletes legacy files', async () => {
      const claudeDir = path.join(tempVault, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });

      fs.writeFileSync(
        path.join(claudeDir, 'wikilink-entities.json'),
        JSON.stringify({ technologies: [], _metadata: { total_entities: 0 } })
      );

      const legacyPaths = getLegacyPaths(tempVault);

      // Delete the legacy files
      const deleted = await deleteLegacyFiles(legacyPaths);
      expect(deleted.success).toBe(true);
      expect(deleted.deletedFiles.length).toBe(1);
      expect(fs.existsSync(path.join(claudeDir, 'wikilink-entities.json'))).toBe(false);
    });

    it('handles already-deleted files gracefully', async () => {
      const claudeDir = path.join(tempVault, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });

      // No legacy files exist
      const legacyPaths = getLegacyPaths(tempVault);
      const deleted = await deleteLegacyFiles(legacyPaths);

      expect(deleted.success).toBe(true);
      expect(deleted.deletedFiles.length).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('handles missing legacy files gracefully', async () => {
      stateDb = openStateDb(tempVault);
      const legacyPaths = getLegacyPaths(tempVault);
      const result = await migrateFromJsonToSqlite(stateDb, legacyPaths);

      expect(result.success).toBe(true);
      expect(result.entitiesMigrated).toBe(0);
      expect(result.recencyMigrated).toBe(0);
      expect(result.crankStateMigrated).toBe(0);
    });

    it('handles malformed JSON gracefully', async () => {
      const claudeDir = path.join(tempVault, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });

      // Write invalid JSON
      fs.writeFileSync(
        path.join(claudeDir, 'wikilink-entities.json'),
        'not valid json {'
      );

      stateDb = openStateDb(tempVault);
      const legacyPaths = getLegacyPaths(tempVault);
      const result = await migrateFromJsonToSqlite(stateDb, legacyPaths);

      // Migration should report failure for that file
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.entitiesMigrated).toBe(0);
    });

    it('database is created even without migration', async () => {
      stateDb = openStateDb(tempVault);

      const metadata = getStateDbMetadata(stateDb);
      expect(metadata.schemaVersion).toBe(1);
      expect(metadata.entityCount).toBe(0);
    });
  });

  describe('Metadata Tracking', () => {
    it('tracks migration timestamp in metadata', async () => {
      const claudeDir = path.join(tempVault, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });

      const entityIndex: EntityIndex = {
        technologies: [{ name: 'Test', path: '', aliases: [], hubScore: 0 }],
        people: [],
        projects: [],
        organizations: [],
        locations: [],
        concepts: [],
        acronyms: [],
        other: [],
        _metadata: {
          total_entities: 1,
          generated_at: new Date().toISOString(),
          vault_path: tempVault,
          source: 'test',
        },
      };

      fs.writeFileSync(
        path.join(claudeDir, 'wikilink-entities.json'),
        JSON.stringify(entityIndex, null, 2)
      );

      stateDb = openStateDb(tempVault);
      const legacyPaths = getLegacyPaths(tempVault);
      await migrateFromJsonToSqlite(stateDb, legacyPaths);

      const metadata = getStateDbMetadata(stateDb);
      expect(metadata.entitiesBuiltAt).toBeDefined();
      expect(metadata.entityCount).toBe(1);
    });
  });
});
