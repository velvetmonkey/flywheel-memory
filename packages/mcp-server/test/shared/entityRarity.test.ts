import { describe, it, expect } from 'vitest';
import { entityRarity, type CooccurrenceIndex } from '../../src/core/shared/cooccurrence.js';

function makeCoocIndex(df: Map<string, number>, totalNotes: number): CooccurrenceIndex {
  return {
    associations: {},
    minCount: 2,
    documentFrequency: df,
    totalNotesScanned: totalNotes,
    _metadata: {
      generated_at: new Date().toISOString(),
      total_associations: 0,
      notes_scanned: totalNotes,
    },
  };
}

describe('entityRarity', () => {
  it('returns 1.0 when no co-occurrence index exists', () => {
    expect(entityRarity('anything', null)).toBe(1.0);
  });

  it('returns 1.0 when totalNotesScanned is 0', () => {
    const index = makeCoocIndex(new Map(), 0);
    expect(entityRarity('anything', index)).toBe(1.0);
  });

  it('returns 1.3 for unknown entity when index exists', () => {
    const index = makeCoocIndex(new Map([['Known', 10]]), 100);
    expect(entityRarity('Unknown', index)).toBe(1.3);
  });

  it('returns low multiplier (~0.7) for very common entities', () => {
    // Entity appears in almost every note
    const index = makeCoocIndex(new Map([['API', 200]]), 200);
    const rarity = entityRarity('API', index);
    expect(rarity).toBeGreaterThanOrEqual(0.7);
    expect(rarity).toBeLessThan(0.9);
  });

  it('returns high multiplier (~1.8) for very rare entities', () => {
    // Entity appears in only 1 out of 1000 notes
    const index = makeCoocIndex(new Map([['Zorbatix', 1]]), 1000);
    const rarity = entityRarity('Zorbatix', index);
    expect(rarity).toBeGreaterThan(1.5);
    expect(rarity).toBeLessThanOrEqual(1.8);
  });

  it('returns moderate multiplier for medium-frequency entities', () => {
    // Entity appears in ~20% of notes
    const index = makeCoocIndex(new Map([['TypeScript', 20]]), 100);
    const rarity = entityRarity('TypeScript', index);
    expect(rarity).toBeGreaterThan(0.9);
    expect(rarity).toBeLessThan(1.5);
  });

  it('clamps to [0.7, 1.8] range', () => {
    // Test with extreme values
    const indexCommon = makeCoocIndex(new Map([['X', 10000]]), 10000);
    expect(entityRarity('X', indexCommon)).toBeGreaterThanOrEqual(0.7);

    const indexRare = makeCoocIndex(new Map([['Y', 1]]), 100000);
    expect(entityRarity('Y', indexRare)).toBeLessThanOrEqual(1.8);
  });

  it('rare entity scores higher than common entity', () => {
    const df = new Map([['API', 200], ['Zorbatix', 3]]);
    const index = makeCoocIndex(df, 1000);
    expect(entityRarity('Zorbatix', index)).toBeGreaterThan(entityRarity('API', index));
  });
});
