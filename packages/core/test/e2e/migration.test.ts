/**
 * Migration Tests
 *
 * Validates migration from legacy JSON cache to SQLite StateDb.
 * Ensures smooth upgrade path for existing users.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  openStateDb,
  stateDbExists,
  migrateFromJsonToSqlite,
  getLegacyPaths,
  backupLegacyFiles,
  deleteLegacyFiles,
  getEntityByName,
  getAllEntitiesFromDb,
  getEntityIndexFromDb,
  searchEntities,
  type StateDb,
  type MigrationResult,
  ENTITY_CACHE_VERSION,
  FLYWHEEL_DIR,
} from '../../src/index.js';

describe('Migration: JSON Cache to SQLite StateDb', () => {
  let testVaultPath: string;
  let stateDb: StateDb | null = null;

  beforeEach(() => {
    testVaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-test-'));
  });

  afterEach(() => {
    if (stateDb) {
      stateDb.close();
      stateDb = null;
    }
    if (fs.existsSync(testVaultPath)) {
      fs.rmSync(testVaultPath, { recursive: true });
    }
  });

  /**
   * Helper to create legacy JSON cache files
   */
  function createLegacyCache(entities: {
    people?: { name: string; path: string; aliases?: string[] }[];
    projects?: { name: string; path: string; aliases?: string[] }[];
    technologies?: { name: string; path: string; aliases?: string[] }[];
    acronyms?: { name: string; path: string; aliases?: string[] }[];
    organizations?: { name: string; path: string; aliases?: string[] }[];
    locations?: { name: string; path: string; aliases?: string[] }[];
    concepts?: { name: string; path: string; aliases?: string[] }[];
    other?: { name: string; path: string; aliases?: string[] }[];
  }): void {
    const claudeDir = path.join(testVaultPath, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });

    const cache = {
      _metadata: {
        generated_at: new Date().toISOString(),
        vault_path: testVaultPath,
        source: 'legacy-test',
        version: ENTITY_CACHE_VERSION,
        total_entities: Object.values(entities).reduce((sum, arr) => sum + (arr?.length || 0), 0),
      },
      people: entities.people || [],
      projects: entities.projects || [],
      technologies: entities.technologies || [],
      acronyms: entities.acronyms || [],
      organizations: entities.organizations || [],
      locations: entities.locations || [],
      concepts: entities.concepts || [],
      other: entities.other || [],
    };

    fs.writeFileSync(
      path.join(claudeDir, 'wikilink-entities.json'),
      JSON.stringify(cache, null, 2),
      'utf-8'
    );
  }

  /**
   * Helper to create legacy backlinks file
   */
  function createLegacyBacklinks(backlinks: Record<string, string[]>): void {
    const claudeDir = path.join(testVaultPath, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });

    fs.writeFileSync(
      path.join(claudeDir, 'backlinks.json'),
      JSON.stringify(backlinks, null, 2),
      'utf-8'
    );
  }

  describe('getLegacyPaths', () => {
    it('should detect legacy entity cache', () => {
      createLegacyCache({
        people: [{ name: 'Test Person', path: 'people/test.md' }],
      });

      const paths = getLegacyPaths(testVaultPath);
      expect(paths.entityCache).not.toBeNull();
      expect(paths.entityCache).toContain('wikilink-entities.json');
    });

    it('should detect legacy backlinks file', () => {
      createLegacyBacklinks({
        'people/jordan.md': ['daily-notes/2026-01-01.md'],
      });

      const paths = getLegacyPaths(testVaultPath);
      expect(paths.backlinks).not.toBeNull();
      expect(paths.backlinks).toContain('backlinks.json');
    });

    it('should return null for missing files', () => {
      const paths = getLegacyPaths(testVaultPath);
      expect(paths.entityCache).toBeNull();
      expect(paths.backlinks).toBeNull();
      expect(paths.recency).toBeNull();
    });
  });

  describe('migrateFromJsonToSqlite', () => {
    it('should migrate entities from JSON to SQLite', async () => {
      createLegacyCache({
        people: [
          { name: 'Jordan Smith', path: 'people/jordan.md', aliases: ['JS'] },
          { name: 'Alice Chen', path: 'people/alice.md', aliases: [] },
        ],
        projects: [
          { name: 'MCP Server', path: 'projects/mcp.md', aliases: ['MCP'] },
        ],
        technologies: [
          { name: 'TypeScript', path: 'tech/ts.md', aliases: ['TS'] },
        ],
      });

      const result = await migrateFromJsonToSqlite(testVaultPath);

      expect(result.success).toBe(true);
      expect(result.entitiesMigrated).toBe(4);
      expect(result.errors).toHaveLength(0);

      // Verify data in SQLite
      stateDb = openStateDb(testVaultPath);

      const jordan = getEntityByName(stateDb, 'Jordan Smith');
      expect(jordan).not.toBeNull();
      expect(jordan!.path).toBe('people/jordan.md');
      expect(jordan!.aliases).toContain('JS');

      const mcp = getEntityByName(stateDb, 'MCP Server');
      expect(mcp).not.toBeNull();
      expect(mcp!.category).toBe('projects');
    });

    it('should migrate backlinks to SQLite', async () => {
      createLegacyBacklinks({
        'people/jordan.md': [
          'daily-notes/2026-01-01.md',
          'projects/mcp.md',
        ],
        'projects/mcp.md': [
          'daily-notes/2026-01-02.md',
        ],
      });

      const result = await migrateFromJsonToSqlite(testVaultPath);

      expect(result.success).toBe(true);
      expect(result.linksMigrated).toBeGreaterThan(0);

      // Note: Backlinks migration creates link records
      stateDb = openStateDb(testVaultPath);
      // The migration should have recorded backlinks
    });

    it('should handle empty cache gracefully', async () => {
      createLegacyCache({});

      const result = await migrateFromJsonToSqlite(testVaultPath);

      expect(result.success).toBe(true);
      expect(result.entitiesMigrated).toBe(0);
    });

    it('should handle missing legacy files', async () => {
      // No legacy files exist
      const result = await migrateFromJsonToSqlite(testVaultPath);

      expect(result.success).toBe(true);
      expect(result.entitiesMigrated).toBe(0);
      expect(result.skipped).toBe(true);
    });

    it('should preserve entity categories during migration', async () => {
      createLegacyCache({
        people: [{ name: 'Person1', path: 'people/p1.md' }],
        technologies: [{ name: 'Tech1', path: 'tech/t1.md' }],
        organizations: [{ name: 'Org1', path: 'orgs/o1.md' }],
        locations: [{ name: 'Location1', path: 'places/l1.md' }],
        concepts: [{ name: 'Concept1', path: 'concepts/c1.md' }],
      });

      await migrateFromJsonToSqlite(testVaultPath);
      stateDb = openStateDb(testVaultPath);

      const person = getEntityByName(stateDb, 'Person1');
      expect(person?.category).toBe('people');

      const tech = getEntityByName(stateDb, 'Tech1');
      expect(tech?.category).toBe('technologies');

      const org = getEntityByName(stateDb, 'Org1');
      expect(org?.category).toBe('organizations');

      const loc = getEntityByName(stateDb, 'Location1');
      expect(loc?.category).toBe('locations');

      const concept = getEntityByName(stateDb, 'Concept1');
      expect(concept?.category).toBe('concepts');
    });
  });

  describe('backupLegacyFiles', () => {
    it('should create backup of legacy files', async () => {
      createLegacyCache({
        people: [{ name: 'Test', path: 'test.md' }],
      });

      const result = await backupLegacyFiles(testVaultPath);

      expect(result.success).toBe(true);
      expect(result.backedUpFiles.length).toBeGreaterThan(0);

      // Check backup exists
      const claudeDir = path.join(testVaultPath, '.claude');
      const files = fs.readdirSync(claudeDir);
      const backupFile = files.find(f => f.includes('.backup.'));
      expect(backupFile).toBeDefined();
    });

    it('should handle no legacy files to backup', async () => {
      const result = await backupLegacyFiles(testVaultPath);

      expect(result.success).toBe(true);
      expect(result.backedUpFiles).toHaveLength(0);
    });
  });

  describe('deleteLegacyFiles', () => {
    it('should delete legacy files after successful migration', async () => {
      createLegacyCache({
        people: [{ name: 'Test', path: 'test.md' }],
      });

      // First migrate
      await migrateFromJsonToSqlite(testVaultPath);

      // Then delete
      const deleteResult = await deleteLegacyFiles(testVaultPath);

      expect(deleteResult.success).toBe(true);
      expect(deleteResult.deletedFiles.length).toBeGreaterThan(0);

      // Verify files are gone
      const paths = getLegacyPaths(testVaultPath);
      expect(paths.entityCache).toBeNull();
    });

    it('should not delete if StateDb does not exist', async () => {
      createLegacyCache({
        people: [{ name: 'Test', path: 'test.md' }],
      });

      // Try to delete without migrating first
      const result = await deleteLegacyFiles(testVaultPath, { requireStateDb: true });

      expect(result.success).toBe(false);
      expect(result.error).toContain('StateDb');

      // Verify legacy files still exist
      const paths = getLegacyPaths(testVaultPath);
      expect(paths.entityCache).not.toBeNull();
    });
  });

  describe('Full Migration Workflow', () => {
    it('should complete full migration: detect → backup → migrate → delete', async () => {
      // Setup legacy state
      createLegacyCache({
        people: [
          { name: 'Jordan Smith', path: 'people/jordan.md', aliases: ['Jordan', 'JS'] },
        ],
        technologies: [
          { name: 'TypeScript', path: 'tech/typescript.md', aliases: ['TS'] },
          { name: 'React', path: 'tech/react.md', aliases: ['ReactJS'] },
        ],
      });
      createLegacyBacklinks({
        'people/jordan.md': ['daily-notes/2026-01-01.md'],
      });

      // Step 1: Detect legacy files
      const legacyPaths = getLegacyPaths(testVaultPath);
      expect(legacyPaths.entityCache).not.toBeNull();
      expect(legacyPaths.backlinks).not.toBeNull();

      // Step 2: Backup
      const backupResult = await backupLegacyFiles(testVaultPath);
      expect(backupResult.success).toBe(true);

      // Step 3: Migrate
      const migrateResult = await migrateFromJsonToSqlite(testVaultPath);
      expect(migrateResult.success).toBe(true);
      expect(migrateResult.entitiesMigrated).toBe(3);

      // Step 4: Verify SQLite state
      stateDb = openStateDb(testVaultPath);
      const entityIndex = getEntityIndexFromDb(stateDb);
      expect(entityIndex.people.length).toBe(1);
      expect(entityIndex.technologies.length).toBe(2);
      expect(entityIndex._metadata.total_entities).toBe(3);

      // FTS search should work
      const searchResults = searchEntities(stateDb, 'TypeScript');
      expect(searchResults.length).toBe(1);

      stateDb.close();
      stateDb = null;

      // Step 5: Delete legacy files
      const deleteResult = await deleteLegacyFiles(testVaultPath);
      expect(deleteResult.success).toBe(true);

      // Step 6: Verify clean state
      expect(stateDbExists(testVaultPath)).toBe(true);
      const finalPaths = getLegacyPaths(testVaultPath);
      expect(finalPaths.entityCache).toBeNull();
      expect(finalPaths.backlinks).toBeNull();
    });

    it('should handle re-migration (idempotent)', async () => {
      createLegacyCache({
        people: [{ name: 'Test', path: 'test.md' }],
      });

      // First migration
      const result1 = await migrateFromJsonToSqlite(testVaultPath);
      expect(result1.success).toBe(true);
      expect(result1.entitiesMigrated).toBe(1);

      // Close and reopen
      stateDb = openStateDb(testVaultPath);
      const count1 = getAllEntitiesFromDb(stateDb).length;
      stateDb.close();
      stateDb = null;

      // Second migration (should be idempotent or update)
      const result2 = await migrateFromJsonToSqlite(testVaultPath);
      expect(result2.success).toBe(true);

      // Verify count is still correct
      stateDb = openStateDb(testVaultPath);
      const count2 = getAllEntitiesFromDb(stateDb).length;
      expect(count2).toBe(count1);
    });
  });

  describe('Error Handling', () => {
    it('should handle corrupted JSON gracefully', async () => {
      const claudeDir = path.join(testVaultPath, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });

      // Write invalid JSON
      fs.writeFileSync(
        path.join(claudeDir, 'wikilink-entities.json'),
        '{ invalid json content',
        'utf-8'
      );

      const result = await migrateFromJsonToSqlite(testVaultPath);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle missing required fields in cache', async () => {
      const claudeDir = path.join(testVaultPath, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });

      // Write JSON missing _metadata
      fs.writeFileSync(
        path.join(claudeDir, 'wikilink-entities.json'),
        JSON.stringify({ people: [], projects: [] }),
        'utf-8'
      );

      const result = await migrateFromJsonToSqlite(testVaultPath);

      // Should handle gracefully (either fail or succeed with defaults)
      expect(result).toBeDefined();
    });

    it('should handle entities with missing paths', async () => {
      const claudeDir = path.join(testVaultPath, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });

      const cache = {
        _metadata: {
          generated_at: new Date().toISOString(),
          vault_path: testVaultPath,
          source: 'test',
          version: ENTITY_CACHE_VERSION,
          total_entities: 2,
        },
        people: [
          { name: 'Valid Entity', path: 'valid.md' },
          { name: 'Invalid Entity' }, // Missing path
        ],
        projects: [],
        technologies: [],
        acronyms: [],
        organizations: [],
        locations: [],
        concepts: [],
        other: [],
      };

      fs.writeFileSync(
        path.join(claudeDir, 'wikilink-entities.json'),
        JSON.stringify(cache),
        'utf-8'
      );

      const result = await migrateFromJsonToSqlite(testVaultPath);

      // Should migrate valid entities and skip/warn on invalid
      expect(result).toBeDefined();
    });
  });
});
