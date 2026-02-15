/**
 * Test utilities for creating temporary vaults and test fixtures
 */

import { mkdtemp, writeFile, readFile, rm, mkdir } from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  ENTITY_CACHE_VERSION,
  openStateDb,
  deleteStateDb,
  type StateDb,
  type EntityIndex,
  type Entity,
} from '@velvetmonkey/vault-core';
import { setWriteStateDb } from '../../../src/core/write/wikilinks.js';

// Re-export StateDb types for test files
export { openStateDb, deleteStateDb, type StateDb };

/**
 * Create a temporary vault directory for testing
 * Returns the absolute path to the temp vault
 */
export async function createTempVault(): Promise<string> {
  const tmpDir = os.tmpdir();
  const vaultPath = await mkdtemp(path.join(tmpDir, 'flywheel-test-'));
  return vaultPath;
}

/**
 * Create a test note within the vault
 * @param vaultPath - Absolute path to the vault
 * @param notePath - Relative path within the vault (e.g., "daily-notes/2026-01-28.md")
 * @param content - Markdown content including frontmatter
 */
export async function createTestNote(
  vaultPath: string,
  notePath: string,
  content: string
): Promise<void> {
  const fullPath = path.join(vaultPath, notePath);
  const dir = path.dirname(fullPath);

  // Ensure parent directories exist
  await mkdir(dir, { recursive: true });

  await writeFile(fullPath, content, 'utf-8');
}

/**
 * Read a test note from the vault
 * @param vaultPath - Absolute path to the vault
 * @param notePath - Relative path within the vault
 * @returns The file content as a string
 */
export async function readTestNote(
  vaultPath: string,
  notePath: string
): Promise<string> {
  const fullPath = path.join(vaultPath, notePath);
  return await readFile(fullPath, 'utf-8');
}

/**
 * Clean up a temporary vault
 * @param vaultPath - Absolute path to the vault
 */
export async function cleanupTempVault(vaultPath: string): Promise<void> {
  await rm(vaultPath, { recursive: true, force: true });
}

/**
 * Create a sample note with frontmatter and sections
 */
export function createSampleNote(): string {
  return `---
type: test
tags:
  - tag1
  - tag2
nested:
  key: value
---
# Test Note

## Log

- Existing entry

## Another Section

Content here
`;
}

/**
 * Create a simple daily note fixture
 */
export function createDailyNote(): string {
  return `---
date: 2026-01-28
type: daily
---
# 2026-01-28

## Habits

- [ ] Exercise
- [ ] Meditation

## Log

- **09:00** Started work

## Tasks

- [ ] Complete project
`;
}

/**
 * Create a note without frontmatter
 */
export function createNoteWithoutFrontmatter(): string {
  return `# Simple Note

## Section 1

Some content

## Section 2

More content
`;
}

// ========================================
// Entity Cache Helpers (for wikilink tests)
// ========================================

/**
 * Entity categories for createEntityCache
 */
export interface EntityCategories {
  people?: string[];
  projects?: string[];
  technologies?: string[];
  acronyms?: string[];
  organizations?: string[];
  locations?: string[];
  concepts?: string[];
  other?: string[];
}

/**
 * Create a minimal vault structure with entity-rich notes
 */
export async function createVaultWithEntities(vaultPath: string): Promise<void> {
  // Create .claude directory for cache
  await mkdir(path.join(vaultPath, '.claude'), { recursive: true });

  // Create a person note
  await createTestNote(
    vaultPath,
    'people/Jordan Smith.md',
    `---
type: person
tags:
  - team-member
---
# Jordan Smith

Senior engineer working on [[MCP Server]].
`
  );

  // Create a project note
  await createTestNote(
    vaultPath,
    'projects/MCP Server.md',
    `---
type: project
tags:
  - active
---
# MCP Server

Model Context Protocol server implementation.
`
  );

  // Create a technology note
  await createTestNote(
    vaultPath,
    'technologies/TypeScript.md',
    `---
type: technology
tags:
  - language
---
# TypeScript

JavaScript with static types.
`
  );

  // Create an acronym note
  await createTestNote(
    vaultPath,
    'glossary/API.md',
    `---
type: acronym
aliases:
  - Application Programming Interface
---
# API

Application Programming Interface.
`
  );
}

/**
 * Create a pre-populated entity cache file
 */
export async function createEntityCache(
  vaultPath: string,
  entities: EntityCategories,
  generatedAt?: Date
): Promise<void> {
  const cacheDir = path.join(vaultPath, '.claude');
  await mkdir(cacheDir, { recursive: true });

  const cache = {
    _metadata: {
      generated_at: (generatedAt || new Date()).toISOString(),
      vault_path: vaultPath,
      source: 'test-utils createEntityCache',
      version: ENTITY_CACHE_VERSION, // Use current cache version from vault-core
      total_entities:
        (entities.people?.length || 0) +
        (entities.projects?.length || 0) +
        (entities.technologies?.length || 0) +
        (entities.acronyms?.length || 0) +
        (entities.organizations?.length || 0) +
        (entities.locations?.length || 0) +
        (entities.concepts?.length || 0) +
        (entities.other?.length || 0),
    },
    people: (entities.people || []).map((name) => ({
      name,
      path: `people/${name}.md`,
      aliases: [],
    })),
    projects: (entities.projects || []).map((name) => ({
      name,
      path: `projects/${name}.md`,
      aliases: [],
    })),
    technologies: (entities.technologies || []).map((name) => ({
      name,
      path: `technologies/${name}.md`,
      aliases: [],
    })),
    acronyms: (entities.acronyms || []).map((name) => ({
      name,
      path: `glossary/${name}.md`,
      aliases: [],
    })),
    organizations: (entities.organizations || []).map((name) => ({
      name,
      path: `organizations/${name}.md`,
      aliases: [],
    })),
    locations: (entities.locations || []).map((name) => ({
      name,
      path: `locations/${name}.md`,
      aliases: [],
    })),
    concepts: (entities.concepts || []).map((name) => ({
      name,
      path: `concepts/${name}.md`,
      aliases: [],
    })),
    other: (entities.other || []).map((name) => ({
      name,
      path: `other/${name}.md`,
      aliases: [],
    })),
  };

  await writeFile(
    path.join(cacheDir, 'wikilink-entities.json'),
    JSON.stringify(cache, null, 2)
  );
}

/**
 * Full entity details for createEntityCacheWithDetails
 */
export interface EntityDetails {
  name: string;
  path: string;
  aliases?: string[];
  hubScore?: number;
}

/**
 * Entity categories with full details for createEntityCacheWithDetails
 */
export interface EntityCategoriesWithDetails {
  people?: EntityDetails[];
  projects?: EntityDetails[];
  technologies?: EntityDetails[];
  acronyms?: EntityDetails[];
  concepts?: EntityDetails[];
  organizations?: EntityDetails[];
  locations?: EntityDetails[];
  other?: EntityDetails[];
}

/**
 * Create a pre-populated entity cache file with full entity details
 * Supports custom paths and hubScores for testing cross-folder and hub boosts
 */
export async function createEntityCacheWithDetails(
  vaultPath: string,
  entities: EntityCategoriesWithDetails,
  generatedAt?: Date
): Promise<void> {
  const cacheDir = path.join(vaultPath, '.claude');
  await mkdir(cacheDir, { recursive: true });

  const normalizeEntities = (entityList?: EntityDetails[]) =>
    (entityList || []).map((e) => ({
      name: e.name,
      path: e.path,
      aliases: e.aliases || [],
      hubScore: e.hubScore,
    }));

  const cache = {
    _metadata: {
      generated_at: (generatedAt || new Date()).toISOString(),
      vault_path: vaultPath,
      source: 'test-utils createEntityCacheWithDetails',
      version: ENTITY_CACHE_VERSION,
      total_entities:
        (entities.people?.length || 0) +
        (entities.projects?.length || 0) +
        (entities.technologies?.length || 0) +
        (entities.acronyms?.length || 0) +
        (entities.concepts?.length || 0) +
        (entities.organizations?.length || 0) +
        (entities.locations?.length || 0) +
        (entities.other?.length || 0),
    },
    people: normalizeEntities(entities.people),
    projects: normalizeEntities(entities.projects),
    technologies: normalizeEntities(entities.technologies),
    acronyms: normalizeEntities(entities.acronyms),
    concepts: normalizeEntities(entities.concepts),
    organizations: normalizeEntities(entities.organizations),
    locations: normalizeEntities(entities.locations),
    other: normalizeEntities(entities.other),
  };

  await writeFile(
    path.join(cacheDir, 'wikilink-entities.json'),
    JSON.stringify(cache, null, 2)
  );
}

// ========================================
// StateDb-based Entity Helpers (SQLite)
// ========================================

/**
 * Create entities directly in StateDb (no JSON file)
 * This is the preferred method for tests after removing JSON fallback
 */
export function createEntityCacheInStateDb(
  stateDb: StateDb,
  vaultPath: string,
  entities: EntityCategories
): number {
  const index = buildEntityIndex(vaultPath, entities);
  return stateDb.replaceAllEntities(index);
}

/**
 * Create entities with full details directly in StateDb (no JSON file)
 * This is the preferred method for tests after removing JSON fallback
 */
export function createEntityCacheWithDetailsInStateDb(
  stateDb: StateDb,
  vaultPath: string,
  entities: EntityCategoriesWithDetails
): number {
  const index = buildEntityIndexWithDetails(vaultPath, entities);
  return stateDb.replaceAllEntities(index);
}

/**
 * Build an EntityIndex from EntityCategories (used internally)
 */
function buildEntityIndex(vaultPath: string, entities: EntityCategories): EntityIndex {
  return {
    _metadata: {
      generated_at: new Date().toISOString(),
      vault_path: vaultPath,
      source: 'test-utils buildEntityIndex',
      version: ENTITY_CACHE_VERSION,
      total_entities:
        (entities.people?.length || 0) +
        (entities.projects?.length || 0) +
        (entities.technologies?.length || 0) +
        (entities.acronyms?.length || 0) +
        (entities.organizations?.length || 0) +
        (entities.locations?.length || 0) +
        (entities.concepts?.length || 0) +
        (entities.other?.length || 0),
    },
    people: (entities.people || []).map((name) => ({
      name,
      path: `people/${name}.md`,
      aliases: [],
    })),
    projects: (entities.projects || []).map((name) => ({
      name,
      path: `projects/${name}.md`,
      aliases: [],
    })),
    technologies: (entities.technologies || []).map((name) => ({
      name,
      path: `technologies/${name}.md`,
      aliases: [],
    })),
    acronyms: (entities.acronyms || []).map((name) => ({
      name,
      path: `glossary/${name}.md`,
      aliases: [],
    })),
    organizations: (entities.organizations || []).map((name) => ({
      name,
      path: `organizations/${name}.md`,
      aliases: [],
    })),
    locations: (entities.locations || []).map((name) => ({
      name,
      path: `locations/${name}.md`,
      aliases: [],
    })),
    concepts: (entities.concepts || []).map((name) => ({
      name,
      path: `concepts/${name}.md`,
      aliases: [],
    })),
    other: (entities.other || []).map((name) => ({
      name,
      path: `other/${name}.md`,
      aliases: [],
    })),
  };
}

/**
 * Build an EntityIndex from EntityCategoriesWithDetails (used internally)
 */
function buildEntityIndexWithDetails(
  vaultPath: string,
  entities: EntityCategoriesWithDetails
): EntityIndex {
  const normalizeEntities = (entityList?: EntityDetails[]): Entity[] =>
    (entityList || []).map((e) => ({
      name: e.name,
      path: e.path,
      aliases: e.aliases || [],
      hubScore: e.hubScore,
    }));

  return {
    _metadata: {
      generated_at: new Date().toISOString(),
      vault_path: vaultPath,
      source: 'test-utils buildEntityIndexWithDetails',
      version: ENTITY_CACHE_VERSION,
      total_entities:
        (entities.people?.length || 0) +
        (entities.projects?.length || 0) +
        (entities.technologies?.length || 0) +
        (entities.acronyms?.length || 0) +
        (entities.concepts?.length || 0) +
        (entities.organizations?.length || 0) +
        (entities.locations?.length || 0) +
        (entities.other?.length || 0),
    },
    people: normalizeEntities(entities.people),
    projects: normalizeEntities(entities.projects),
    technologies: normalizeEntities(entities.technologies),
    acronyms: normalizeEntities(entities.acronyms),
    concepts: normalizeEntities(entities.concepts),
    organizations: normalizeEntities(entities.organizations),
    locations: normalizeEntities(entities.locations),
    other: normalizeEntities(entities.other),
  };
}

/**
 * Setup StateDb for tests and initialize the wikilinks module
 * Returns a cleanup function
 */
export function setupTestStateDb(vaultPath: string): { stateDb: StateDb; cleanup: () => void } {
  const stateDb = openStateDb(vaultPath);
  setWriteStateDb(stateDb);

  return {
    stateDb,
    cleanup: () => {
      setWriteStateDb(null);
      stateDb.db.close();
      deleteStateDb(vaultPath);
    },
  };
}
