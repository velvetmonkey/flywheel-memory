/**
 * Tests for co-occurrence NPMI scoring and persistence
 *
 * Tests computeNpmi edge cases, serialization round-trip,
 * and StateDb save/load lifecycle including staleness checks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  computeNpmi,
  serializeCooccurrenceIndex,
  deserializeCooccurrenceIndex,
  saveCooccurrenceToStateDb,
  loadCooccurrenceFromStateDb,
  type CooccurrenceIndex,
} from '../../../src/core/shared/cooccurrence.js';
import {
  createTempVault,
  cleanupTempVault,
  openStateDb,
  deleteStateDb,
  type StateDb,
} from '../../helpers/testUtils.js';

// ========================================
// computeNpmi Edge Cases
// ========================================

describe('computeNpmi', () => {
  it('should return 0 for zero document frequency of entity', () => {
    expect(computeNpmi(5, 0, 10, 100)).toBe(0);
  });

  it('should return 0 for zero co-occurrence count', () => {
    expect(computeNpmi(0, 10, 10, 100)).toBe(0);
  });

  it('should return 0 for zero totalNotes', () => {
    expect(computeNpmi(5, 10, 10, 0)).toBe(0);
  });

  it('should return 0 for zero document frequency of seed', () => {
    expect(computeNpmi(5, 10, 0, 100)).toBe(0);
  });

  it('should return value close to 1 for single-document entity with perfect co-occurrence', () => {
    // Both entities appear in exactly 1 note out of 100, and they co-occur in that 1 note
    const npmi = computeNpmi(1, 1, 1, 100);
    expect(npmi).toBeGreaterThan(0.9);
    expect(npmi).toBeLessThanOrEqual(1);
  });

  it('should return 1 for entity appearing in every document (perfect co-occurrence)', () => {
    // Both entities appear in all 100 notes, and co-occur in all 100
    const npmi = computeNpmi(100, 100, 100, 100);
    expect(npmi).toBe(1);
  });

  it('should return low but positive NPMI for modest co-occurrence in large corpus', () => {
    // Entity A in 50 notes, entity B in 50 notes, co-occur in 5 notes out of 1000
    // P(x,y) = 0.005, P(x)*P(y) = 0.0025 — co-occur slightly above chance
    const npmi = computeNpmi(5, 50, 50, 1000);
    expect(npmi).toBeGreaterThan(0);
    expect(npmi).toBeLessThan(0.3);
  });

  it('should return 0 for negative association (clamped)', () => {
    // Entities that co-occur less than expected by chance
    // Entity A in 500 notes, entity B in 500 notes, co-occur in only 1 note out of 1000
    // P(A) = 0.5, P(B) = 0.5, expected P(A,B) = 0.25, actual P(A,B) = 0.001
    const npmi = computeNpmi(1, 500, 500, 1000);
    expect(npmi).toBe(0);
  });
});

// ========================================
// Serialization Round-Trip
// ========================================

describe('serializeCooccurrenceIndex / deserializeCooccurrenceIndex', () => {
  it('should round-trip a CooccurrenceIndex through serialize/deserialize', () => {
    const original: CooccurrenceIndex = {
      associations: {
        TypeScript: new Map([
          ['React', 5],
          ['Node', 3],
        ]),
        React: new Map([
          ['TypeScript', 5],
          ['CSS', 2],
        ]),
      },
      minCount: 2,
      documentFrequency: new Map([
        ['TypeScript', 20],
        ['React', 15],
        ['Node', 8],
        ['CSS', 12],
      ]),
      totalNotesScanned: 100,
      _metadata: {
        generated_at: '2026-02-27T00:00:00.000Z',
        total_associations: 4,
        notes_scanned: 100,
      },
    };

    const serialized = serializeCooccurrenceIndex(original);
    const deserialized = deserializeCooccurrenceIndex(serialized);

    expect(deserialized).not.toBeNull();

    // Verify associations
    expect(deserialized!.associations['TypeScript'].get('React')).toBe(5);
    expect(deserialized!.associations['TypeScript'].get('Node')).toBe(3);
    expect(deserialized!.associations['React'].get('TypeScript')).toBe(5);
    expect(deserialized!.associations['React'].get('CSS')).toBe(2);

    // Verify document frequency
    expect(deserialized!.documentFrequency.get('TypeScript')).toBe(20);
    expect(deserialized!.documentFrequency.get('React')).toBe(15);
    expect(deserialized!.documentFrequency.get('Node')).toBe(8);
    expect(deserialized!.documentFrequency.get('CSS')).toBe(12);

    // Verify scalars
    expect(deserialized!.minCount).toBe(2);
    expect(deserialized!.totalNotesScanned).toBe(100);
    expect(deserialized!._metadata.total_associations).toBe(4);
    expect(deserialized!._metadata.notes_scanned).toBe(100);
    expect(deserialized!._metadata.generated_at).toBe('2026-02-27T00:00:00.000Z');
  });

  it('should return null for missing associations field', () => {
    const result = deserializeCooccurrenceIndex({ minCount: 2 });
    expect(result).toBeNull();
  });

  it('should handle empty associations', () => {
    const original: CooccurrenceIndex = {
      associations: {},
      minCount: 0.5,
      documentFrequency: new Map(),
      totalNotesScanned: 0,
      _metadata: {
        generated_at: '2026-02-27T00:00:00.000Z',
        total_associations: 0,
        notes_scanned: 0,
      },
    };

    const serialized = serializeCooccurrenceIndex(original);
    const deserialized = deserializeCooccurrenceIndex(serialized);

    expect(deserialized).not.toBeNull();
    expect(Object.keys(deserialized!.associations)).toHaveLength(0);
    expect(deserialized!.documentFrequency.size).toBe(0);
  });
});

// ========================================
// StateDb Persistence
// ========================================

describe('StateDb persistence', () => {
  let tempVault: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    tempVault = await createTempVault();
    stateDb = openStateDb(tempVault);
  });

  afterEach(async () => {
    stateDb.db.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  it('should save and load co-occurrence index from StateDb', () => {
    const original: CooccurrenceIndex = {
      associations: {
        Flywheel: new Map([
          ['MCP', 4],
          ['Obsidian', 3],
        ]),
        MCP: new Map([
          ['Flywheel', 4],
        ]),
      },
      minCount: 0.5,
      documentFrequency: new Map([
        ['Flywheel', 10],
        ['MCP', 8],
        ['Obsidian', 6],
      ]),
      totalNotesScanned: 50,
      _metadata: {
        generated_at: '2026-02-27T12:00:00.000Z',
        total_associations: 3,
        notes_scanned: 50,
      },
    };

    saveCooccurrenceToStateDb(stateDb, original);
    const loaded = loadCooccurrenceFromStateDb(stateDb);

    expect(loaded).not.toBeNull();
    expect(loaded!.index.associations['Flywheel'].get('MCP')).toBe(4);
    expect(loaded!.index.associations['Flywheel'].get('Obsidian')).toBe(3);
    expect(loaded!.index.associations['MCP'].get('Flywheel')).toBe(4);
    expect(loaded!.index.documentFrequency.get('Flywheel')).toBe(10);
    expect(loaded!.index.documentFrequency.get('MCP')).toBe(8);
    expect(loaded!.index.totalNotesScanned).toBe(50);
    expect(loaded!.builtAt).toBeGreaterThan(0);
  });

  it('should return null when StateDb has no cached co-occurrence data', () => {
    const loaded = loadCooccurrenceFromStateDb(stateDb);
    expect(loaded).toBeNull();
  });

  it('should return null for stale data (>1h old)', () => {
    const original: CooccurrenceIndex = {
      associations: {
        Alpha: new Map([['Beta', 2]]),
      },
      minCount: 0.5,
      documentFrequency: new Map([
        ['Alpha', 5],
        ['Beta', 5],
      ]),
      totalNotesScanned: 20,
      _metadata: {
        generated_at: '2026-02-27T00:00:00.000Z',
        total_associations: 1,
        notes_scanned: 20,
      },
    };

    // Save normally first
    saveCooccurrenceToStateDb(stateDb, original);

    // Overwrite built_at to 2 hours ago directly in the database
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    stateDb.db.prepare(
      'UPDATE cooccurrence_cache SET built_at = ? WHERE id = 1'
    ).run(twoHoursAgo);

    const loaded = loadCooccurrenceFromStateDb(stateDb);
    expect(loaded).toBeNull();
  });

  it('should return data that is less than 1h old', () => {
    const original: CooccurrenceIndex = {
      associations: {
        Gamma: new Map([['Delta', 7]]),
      },
      minCount: 0.5,
      documentFrequency: new Map([
        ['Gamma', 12],
        ['Delta', 9],
      ]),
      totalNotesScanned: 30,
      _metadata: {
        generated_at: '2026-02-27T00:00:00.000Z',
        total_associations: 1,
        notes_scanned: 30,
      },
    };

    // Save normally — built_at is now, well within 1h
    saveCooccurrenceToStateDb(stateDb, original);

    const loaded = loadCooccurrenceFromStateDb(stateDb);
    expect(loaded).not.toBeNull();
    expect(loaded!.index.associations['Gamma'].get('Delta')).toBe(7);
  });
});
