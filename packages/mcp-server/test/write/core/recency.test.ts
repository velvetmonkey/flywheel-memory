/**
 * Tests for recency weighting module
 *
 * Tests the recency index building and boost calculation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import {
  buildRecencyIndex,
  getRecencyBoost,
  loadRecencyFromStateDb,
  saveRecencyToStateDb,
  setRecencyStateDb,
  RECENCY_CACHE_VERSION,
  type RecencyIndex,
} from '../../../src/core/shared/recency.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
} from '../helpers/testUtils.js';
import { openStateDb, deleteStateDb, type StateDb } from '@velvetmonkey/vault-core';

// ========================================
// buildRecencyIndex Tests
// ========================================

describe('buildRecencyIndex', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should return empty index for empty vault', async () => {
    const index = await buildRecencyIndex(tempVault, []);

    expect(index.lastMentioned.size).toBe(0);
    expect(index.version).toBe(RECENCY_CACHE_VERSION);
    expect(index.lastUpdated).toBeGreaterThan(0);
  });

  it('should track entity mentions in vault files', async () => {
    // Create a note that mentions an entity
    await createTestNote(
      tempVault,
      'test.md',
      '# Test Note\n\nWorking on TypeScript today.'
    );

    const index = await buildRecencyIndex(tempVault, ['TypeScript']);

    expect(index.lastMentioned.has('typescript')).toBe(true);
    expect(index.lastMentioned.get('typescript')).toBeGreaterThan(0);
  });

  it('should use file modification time as mention timestamp', async () => {
    const now = Date.now();

    await createTestNote(
      tempVault,
      'test.md',
      '# Test\n\nMention of Python here.'
    );

    const index = await buildRecencyIndex(tempVault, ['Python']);

    const mentionTime = index.lastMentioned.get('python');
    expect(mentionTime).toBeDefined();
    // Should be close to now (within last second)
    expect(Math.abs(mentionTime! - now)).toBeLessThan(5000);
  });

  it('should track multiple entities', async () => {
    await createTestNote(
      tempVault,
      'test.md',
      '# Project\n\nUsing TypeScript and React together.'
    );

    const index = await buildRecencyIndex(tempVault, ['TypeScript', 'React']);

    expect(index.lastMentioned.has('typescript')).toBe(true);
    expect(index.lastMentioned.has('react')).toBe(true);
    expect(index.lastMentioned.size).toBe(2);
  });

  it('should use most recent file for entity mentioned in multiple files', async () => {
    // Create older file
    await createTestNote(
      tempVault,
      'old.md',
      '# Old\n\nOld mention of TypeScript.'
    );

    // Small delay to ensure different mtime
    await new Promise(resolve => setTimeout(resolve, 50));

    // Create newer file
    await createTestNote(
      tempVault,
      'new.md',
      '# New\n\nNew mention of TypeScript.'
    );

    const index = await buildRecencyIndex(tempVault, ['TypeScript']);

    // Should have tracked the entity
    expect(index.lastMentioned.has('typescript')).toBe(true);
  });

  it('should handle case-insensitive entity matching', async () => {
    await createTestNote(
      tempVault,
      'test.md',
      '# Test\n\nUsing TYPESCRIPT and typescript.'
    );

    const index = await buildRecencyIndex(tempVault, ['TypeScript']);

    expect(index.lastMentioned.has('typescript')).toBe(true);
  });

  it('should skip very short entity names (< 3 chars)', async () => {
    await createTestNote(
      tempVault,
      'test.md',
      '# Test\n\nUsing JS and AI today.'
    );

    const index = await buildRecencyIndex(tempVault, ['JS', 'AI', 'TypeScript']);

    // Short names should be skipped
    expect(index.lastMentioned.has('js')).toBe(false);
    expect(index.lastMentioned.has('ai')).toBe(false);
  });

  it('should ignore node_modules and .git directories', async () => {
    await mkdir(path.join(tempVault, 'node_modules'), { recursive: true });
    await writeFile(
      path.join(tempVault, 'node_modules', 'test.md'),
      '# Test\n\nTypeScript content.'
    );

    const index = await buildRecencyIndex(tempVault, ['TypeScript']);

    // Should not have tracked from node_modules
    expect(index.lastMentioned.has('typescript')).toBe(false);
  });
});

// ========================================
// getRecencyBoost Tests
// ========================================

describe('getRecencyBoost', () => {
  it('should return 8 for entity mentioned within 1 hour', () => {
    const index: RecencyIndex = {
      lastMentioned: new Map([
        ['typescript', Date.now() - 1000 * 60 * 30], // 30 minutes ago
      ]),
      lastUpdated: Date.now(),
      version: RECENCY_CACHE_VERSION,
    };

    expect(getRecencyBoost('TypeScript', index)).toBe(8);
  });

  it('should return 5 for entity mentioned within 24 hours', () => {
    const index: RecencyIndex = {
      lastMentioned: new Map([
        ['typescript', Date.now() - 1000 * 60 * 60 * 2], // 2 hours ago
      ]),
      lastUpdated: Date.now(),
      version: RECENCY_CACHE_VERSION,
    };

    expect(getRecencyBoost('TypeScript', index)).toBe(5);
  });

  it('should return 3 for entity mentioned within 3 days', () => {
    const index: RecencyIndex = {
      lastMentioned: new Map([
        ['typescript', Date.now() - 1000 * 60 * 60 * 48], // 48 hours ago
      ]),
      lastUpdated: Date.now(),
      version: RECENCY_CACHE_VERSION,
    };

    expect(getRecencyBoost('TypeScript', index)).toBe(3);
  });

  it('should return 1 for entity mentioned within last week', () => {
    const index: RecencyIndex = {
      lastMentioned: new Map([
        ['typescript', Date.now() - 1000 * 60 * 60 * 100], // 100 hours ago (>72h, <168h)
      ]),
      lastUpdated: Date.now(),
      version: RECENCY_CACHE_VERSION,
    };

    expect(getRecencyBoost('TypeScript', index)).toBe(1);
  });

  it('should return 0 for entity mentioned over a week ago', () => {
    const index: RecencyIndex = {
      lastMentioned: new Map([
        ['typescript', Date.now() - 1000 * 60 * 60 * 24 * 10], // 10 days ago
      ]),
      lastUpdated: Date.now(),
      version: RECENCY_CACHE_VERSION,
    };

    expect(getRecencyBoost('TypeScript', index)).toBe(0);
  });

  it('should return 0 for entity not in index', () => {
    const index: RecencyIndex = {
      lastMentioned: new Map(),
      lastUpdated: Date.now(),
      version: RECENCY_CACHE_VERSION,
    };

    expect(getRecencyBoost('TypeScript', index)).toBe(0);
  });

  it('should be case-insensitive', () => {
    const index: RecencyIndex = {
      lastMentioned: new Map([
        ['typescript', Date.now() - 1000 * 60 * 60 * 2], // 2 hours ago (within 24h tier)
      ]),
      lastUpdated: Date.now(),
      version: RECENCY_CACHE_VERSION,
    };

    expect(getRecencyBoost('TYPESCRIPT', index)).toBe(5);
    expect(getRecencyBoost('TypeScript', index)).toBe(5);
    expect(getRecencyBoost('typescript', index)).toBe(5);
  });

  it('should return 5 at 23 hours (within 24h tier)', () => {
    const index: RecencyIndex = {
      lastMentioned: new Map([
        ['typescript', Date.now() - 1000 * 60 * 60 * 23], // 23 hours ago
      ]),
      lastUpdated: Date.now(),
      version: RECENCY_CACHE_VERSION,
    };

    expect(getRecencyBoost('TypeScript', index)).toBe(5);
  });

  it('should return 1 at exactly 168 hour (1 week) boundary', () => {
    const index: RecencyIndex = {
      lastMentioned: new Map([
        ['typescript', Date.now() - 1000 * 60 * 60 * 167], // 167 hours ago
      ]),
      lastUpdated: Date.now(),
      version: RECENCY_CACHE_VERSION,
    };

    expect(getRecencyBoost('TypeScript', index)).toBe(1);
  });
});

// ========================================
// StateDb Persistence Tests
// ========================================

describe('StateDb persistence', () => {
  let tempVault: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    tempVault = await createTempVault();
    stateDb = openStateDb(tempVault);
    setRecencyStateDb(stateDb);
  });

  afterEach(async () => {
    setRecencyStateDb(null);
    stateDb.db.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  it('should save and load recency from StateDb', () => {
    const original: RecencyIndex = {
      lastMentioned: new Map([
        ['typescript', Date.now()],
        ['react', Date.now() - 1000],
      ]),
      lastUpdated: Date.now(),
      version: RECENCY_CACHE_VERSION,
    };

    saveRecencyToStateDb(original);
    const loaded = loadRecencyFromStateDb();

    expect(loaded).not.toBeNull();
    expect(loaded!.lastMentioned.has('typescript')).toBe(true);
    expect(loaded!.lastMentioned.has('react')).toBe(true);
  });

  it('should return null when StateDb is empty', () => {
    const loaded = loadRecencyFromStateDb();
    expect(loaded).toBeNull();
  });
});

// ========================================
// Integration Tests
// ========================================

describe('recency integration', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should build index from vault with multiple files', async () => {
    // Create several notes mentioning different entities
    await createTestNote(
      tempVault,
      'projects/flywheel.md',
      '# Flywheel\n\nWorking on the Flywheel Crank project.'
    );

    await createTestNote(
      tempVault,
      'daily-notes/2026-01-31.md',
      '# 2026-01-31\n\nMet with Alex Johnson about TypeScript.'
    );

    await createTestNote(
      tempVault,
      'tech/typescript.md',
      '# TypeScript\n\nNotes about TypeScript and React.'
    );

    const entities = ['Flywheel Crank', 'Alex Johnson', 'TypeScript', 'React'];
    const index = await buildRecencyIndex(tempVault, entities);

    // Should have tracked all entities
    expect(index.lastMentioned.has('flywheel crank')).toBe(true);
    expect(index.lastMentioned.has('alex johnson')).toBe(true);
    expect(index.lastMentioned.has('typescript')).toBe(true);
    expect(index.lastMentioned.has('react')).toBe(true);
  });

  it('should handle entity objects with name property', async () => {
    await createTestNote(
      tempVault,
      'test.md',
      '# Test\n\nUsing TypeScript today.'
    );

    // Pass entity as object with name property (as vault-core does)
    const entities = [{ name: 'TypeScript', path: 'TypeScript.md', aliases: [] }];
    const index = await buildRecencyIndex(tempVault, entities as any);

    expect(index.lastMentioned.has('typescript')).toBe(true);
  });
});
