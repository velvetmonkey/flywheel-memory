import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  STRICTNESS_CONFIGS,
  capScoreWithoutContentRelevance,
  evaluateCooccurrenceAdmission,
  getAdaptiveMinScore,
  getContextBoostScore,
  getEdgeWeightBoostScore,
  getFeedbackBoostScore,
  getSemanticStrictnessMultiplier,
  getSuppressionPenaltyScore,
  scoreEntity,
  scoreNameAgainstContent,
} from '../../../src/core/write/wikilinkScoring.js';

function makeCooccurrenceIndex(): any {
  return {
    associations: {
      'Seed One': new Map([['Graph Entity', 2]]),
      'Seed Two': new Map([['Graph Entity', 2]]),
      'Seed Lone': new Map([['Graph Entity', 2]]),
    },
    documentFrequency: new Map([
      ['Graph Entity', 3],
      ['Seed One', 3],
      ['Seed Two', 3],
      ['Seed Lone', 3],
    ]),
    totalNotesScanned: 10,
    minCount: 2,
  };
}

describe('wikilink scoring helpers', () => {
  it('scores exact and stem matches from content tokens', () => {
    const result = scoreNameAgainstContent(
      'TypeScript projects',
      new Set(['typescript', 'project']),
      new Set(['typescript', 'project']),
      STRICTNESS_CONFIGS.balanced,
    );

    expect(result.exactMatches).toBe(1);
    expect(result.matchedWords).toBe(2);
    expect(result.lexicalScore).toBe(15);
  });

  it('scores multi-word entities through the extracted entity scorer', () => {
    const result = scoreEntity(
      { name: 'Project Alpha', aliases: [], path: '' } as any,
      new Set(['project', 'alpha']),
      new Set(['project', 'alpha']),
      new Set(['project alpha']),
      STRICTNESS_CONFIGS.balanced,
      new Set(),
    );

    expect(result.contentMatch).toBe(20);
    expect(result.totalLexical).toBe(20);
  });

  it('applies the graph-only cooccurrence gate with multi-seed protection', () => {
    const cooccurrenceIndex = makeCooccurrenceIndex();

    const admitted = evaluateCooccurrenceAdmission(
      'Graph Entity',
      new Set(),
      new Set(),
      new Set(['Seed One', 'Seed Two']),
      cooccurrenceIndex,
      7,
      STRICTNESS_CONFIGS.balanced,
    );
    expect(admitted.admitted).toBe(true);
    expect(admitted.qualifyingSeedCount).toBe(2);

    const rejected = evaluateCooccurrenceAdmission(
      'Graph Entity',
      new Set(),
      new Set(),
      new Set(['Seed Lone']),
      cooccurrenceIndex,
      7,
      STRICTNESS_CONFIGS.balanced,
    );
    expect(rejected.admitted).toBe(false);
    expect(rejected.multiSeedOK).toBe(false);
  });

  it('caps low-relevance boosts and keeps edge-weight boosts bounded', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 200 }),
      fc.integer({ min: 0, max: 10 }),
      fc.constantFrom(...Object.values(STRICTNESS_CONFIGS)),
      (score, contentRelevance, config) => {
        const capped = capScoreWithoutContentRelevance(score, contentRelevance, config);
        if (capped > score) return false;
        if (contentRelevance < config.contentRelevanceFloor) {
          return capped <= config.noRelevanceCap;
        }
        return capped === score;
      },
    ));

    expect(getAdaptiveMinScore(30, STRICTNESS_CONFIGS.balanced.minSuggestionScore)).toBe(6);
    expect(getAdaptiveMinScore(300, STRICTNESS_CONFIGS.balanced.minSuggestionScore)).toBe(12);
    expect(getContextBoostScore('people', { people: 5 })).toBe(5);
    expect(getSemanticStrictnessMultiplier('conservative')).toBe(0.6);
    expect(getSemanticStrictnessMultiplier('aggressive')).toBe(1.3);
    expect(getFeedbackBoostScore('Alice', new Map([['Alice', 3]]))).toBe(3);
    expect(getSuppressionPenaltyScore('Alice', new Map([['Alice', -2]]))).toBe(-2);
    expect(getEdgeWeightBoostScore('TypeScript', new Map([['typescript', 4]]))).toBe(4);
  });
});
