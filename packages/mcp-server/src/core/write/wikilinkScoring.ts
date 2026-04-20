import {
  getEntityAliases,
  getEntityName,
  type Entity,
} from '@velvetmonkey/vault-core';
import {
  computeNpmi,
  tokenIdf,
  type CooccurrenceIndex,
} from '../shared/cooccurrence.js';
import { scoreFuzzyMatch } from '../shared/levenshtein.js';
import { stem, tokenize } from '../shared/stemmer.js';
import type {
  ScoringLayer,
  StrictnessMode,
  SuggestionConfig,
} from './types.js';

export const STRICTNESS_CONFIGS: Record<StrictnessMode, SuggestionConfig> = {
  conservative: {
    minWordLength: 3,
    minSuggestionScore: 18,
    minMatchRatio: 0.6,
    requireMultipleMatches: true,
    stemMatchBonus: 3,
    exactMatchBonus: 10,
    fuzzyMatchBonus: 2,
    contentRelevanceFloor: 5,
    noRelevanceCap: 12,
    minCooccurrenceGate: 6,
    minContentMatch: 3,
  },
  balanced: {
    minWordLength: 3,
    minSuggestionScore: 10,
    minMatchRatio: 0.6,
    requireMultipleMatches: false,
    stemMatchBonus: 5,
    exactMatchBonus: 10,
    fuzzyMatchBonus: 4,
    contentRelevanceFloor: 5,
    noRelevanceCap: 9,
    minCooccurrenceGate: 6,
    minContentMatch: 2,
  },
  aggressive: {
    minWordLength: 3,
    minSuggestionScore: 5,
    minMatchRatio: 0.3,
    requireMultipleMatches: false,
    stemMatchBonus: 6,
    exactMatchBonus: 10,
    fuzzyMatchBonus: 5,
    contentRelevanceFloor: 3,
    noRelevanceCap: 18,
    minCooccurrenceGate: 3,
    minContentMatch: 0,
  },
};

const FULL_ALIAS_MATCH_BONUS = 8;

export interface LexicalScoreResult {
  exactScore: number;
  stemScore: number;
  lexicalScore: number;
  matchedWords: number;
  exactMatches: number;
  totalTokens: number;
  nameTokens: string[];
  unmatchedTokenIndices: number[];
}

export interface EntityScoreResult {
  contentMatch: number;
  fuzzyMatch: number;
  totalLexical: number;
  matchedWords: number;
  exactMatches: number;
  totalTokens: number;
}

export interface CooccurrenceAdmissionResult {
  hasContentOverlap: boolean;
  strongCooccurrence: boolean;
  qualifyingSeedCount: number;
  multiSeedOK: boolean;
  admitted: boolean;
}

export function capScoreWithoutContentRelevance(
  score: number,
  contentRelevance: number,
  config: SuggestionConfig,
): number {
  if (contentRelevance < config.contentRelevanceFloor) {
    return Math.min(score, config.noRelevanceCap);
  }
  return score;
}

export function getAdaptiveMinScore(contentLength: number, baseScore: number): number {
  if (contentLength < 50) {
    return Math.max(5, Math.floor(baseScore * 0.6));
  }
  if (contentLength > 200 && baseScore > 5) {
    return Math.floor(baseScore * 1.2);
  }
  return baseScore;
}

export function getContextBoostScore(
  category: string,
  contextBoosts: Partial<Record<string, number>>,
): number {
  return contextBoosts[category] ?? 0;
}

export function getSemanticStrictnessMultiplier(strictness: StrictnessMode): number {
  if (strictness === 'conservative') return 0.6;
  if (strictness === 'aggressive') return 1.3;
  return 1.0;
}

export function getFeedbackBoostScore(entityName: string, feedbackBoosts: Map<string, number>): number {
  return feedbackBoosts.get(entityName) ?? 0;
}

export function getSuppressionPenaltyScore(entityName: string, suppressionPenalties: Map<string, number>): number {
  return suppressionPenalties.get(entityName) ?? 0;
}

export function scoreNameAgainstContent(
  name: string,
  contentTokens: Set<string>,
  contentStems: Set<string>,
  config: SuggestionConfig,
  coocIndex?: CooccurrenceIndex | null,
  disableExact?: boolean,
  disableStem?: boolean,
): LexicalScoreResult {
  const nameTokens = tokenize(name);
  if (nameTokens.length === 0) {
    return {
      exactScore: 0,
      stemScore: 0,
      lexicalScore: 0,
      matchedWords: 0,
      exactMatches: 0,
      totalTokens: 0,
      nameTokens: [],
      unmatchedTokenIndices: [],
    };
  }

  const nameStems = nameTokens.map((token) => stem(token));
  let exactScore = 0;
  let stemScore = 0;
  let matchedWords = 0;
  let exactMatches = 0;
  const unmatchedTokenIndices: number[] = [];

  for (let index = 0; index < nameTokens.length; index++) {
    const token = nameTokens[index];
    const nameStem = nameStems[index];
    const idfWeight = coocIndex ? tokenIdf(token, coocIndex) : 1.0;

    if (!disableExact && contentTokens.has(token)) {
      exactScore += config.exactMatchBonus * idfWeight;
      matchedWords++;
      exactMatches++;
    } else if (!disableStem && contentStems.has(nameStem)) {
      stemScore += config.stemMatchBonus * idfWeight;
      matchedWords++;
    } else {
      unmatchedTokenIndices.push(index);
    }
  }

  return {
    exactScore,
    stemScore,
    lexicalScore: Math.round((exactScore + stemScore) * 10) / 10,
    matchedWords,
    exactMatches,
    totalTokens: nameTokens.length,
    nameTokens,
    unmatchedTokenIndices,
  };
}

export function scoreEntity(
  entity: Entity,
  contentTokens: Set<string>,
  contentStems: Set<string>,
  collapsedContentTerms: Set<string>,
  config: SuggestionConfig,
  disabled: Set<ScoringLayer>,
  coocIndex?: CooccurrenceIndex | null,
  tokenFuzzyCache?: Map<string, number>,
): EntityScoreResult {
  const zero: EntityScoreResult = {
    contentMatch: 0,
    fuzzyMatch: 0,
    totalLexical: 0,
    matchedWords: 0,
    exactMatches: 0,
    totalTokens: 0,
  };
  const entityName = getEntityName(entity);
  const aliases = getEntityAliases(entity);
  const disableExact = disabled.has('exact_match');
  const disableStem = disabled.has('stem_match');
  const disableFuzzy = disabled.has('fuzzy_match');
  const cache = tokenFuzzyCache ?? new Map<string, number>();
  const idfFn = (token: string) => coocIndex ? tokenIdf(token, coocIndex) : 1.0;

  const nameResult = scoreNameAgainstContent(
    entityName,
    contentTokens,
    contentStems,
    config,
    coocIndex,
    disableExact,
    disableStem,
  );

  let bestAliasResult: LexicalScoreResult = {
    exactScore: 0,
    stemScore: 0,
    lexicalScore: 0,
    matchedWords: 0,
    exactMatches: 0,
    totalTokens: 0,
    nameTokens: [],
    unmatchedTokenIndices: [],
  };
  for (const alias of aliases) {
    const aliasResult = scoreNameAgainstContent(
      alias,
      contentTokens,
      contentStems,
      config,
      coocIndex,
      disableExact,
      disableStem,
    );
    if (aliasResult.lexicalScore > bestAliasResult.lexicalScore) {
      bestAliasResult = aliasResult;
    }
  }

  const bestResult = nameResult.lexicalScore >= bestAliasResult.lexicalScore
    ? nameResult
    : bestAliasResult;
  let {
    lexicalScore,
    matchedWords,
    exactMatches,
    totalTokens,
    nameTokens,
    unmatchedTokenIndices,
  } = bestResult;
  const fuzzyTargetName = nameResult.lexicalScore >= bestAliasResult.lexicalScore
    ? entityName
    : (aliases[0] ?? entityName);

  if (totalTokens === 0) return zero;

  if (!disableExact) {
    for (const alias of aliases) {
      const aliasLower = alias.toLowerCase();
      if (
        aliasLower.length >= 3 &&
        !/\s/.test(aliasLower) &&
        contentTokens.has(aliasLower)
      ) {
        lexicalScore += FULL_ALIAS_MATCH_BONUS;
        break;
      }
    }
  }

  let fuzzyScore = 0;
  let fuzzyMatchedWords = 0;
  if (!disableFuzzy && unmatchedTokenIndices.length > 0) {
    const fuzzyResult = scoreFuzzyMatch(
      nameTokens,
      unmatchedTokenIndices,
      contentTokens,
      collapsedContentTerms,
      fuzzyTargetName,
      config.fuzzyMatchBonus,
      idfFn,
      cache,
    );
    fuzzyScore = fuzzyResult.fuzzyScore;
    fuzzyMatchedWords = fuzzyResult.fuzzyMatchedWords;
    if (fuzzyResult.isWholeTermMatch) {
      matchedWords = totalTokens;
    } else {
      matchedWords += fuzzyMatchedWords;
    }
  }

  if (totalTokens > 1) {
    const matchRatio = matchedWords / totalTokens;
    if (matchRatio < config.minMatchRatio) {
      return zero;
    }
  }

  if (config.requireMultipleMatches && totalTokens === 1) {
    if (exactMatches === 0 && fuzzyMatchedWords === 0) {
      return zero;
    }
  }

  const contentMatch = Math.round(lexicalScore * 10) / 10;
  const fuzzyMatch = Math.round(fuzzyScore * 10) / 10;
  return {
    contentMatch,
    fuzzyMatch,
    totalLexical: Math.round((contentMatch + fuzzyMatch) * 10) / 10,
    matchedWords,
    exactMatches,
    totalTokens,
  };
}

export function evaluateCooccurrenceAdmission(
  entityName: string,
  contentTokens: Set<string>,
  contentStems: Set<string>,
  cooccurrenceSeeds: Iterable<string>,
  cooccurrenceIndex: CooccurrenceIndex | null | undefined,
  boost: number,
  config: SuggestionConfig,
): CooccurrenceAdmissionResult {
  const entityTokens = tokenize(entityName);
  const hasContentOverlap = entityTokens.some((token) =>
    contentTokens.has(token) || contentStems.has(stem(token)),
  );
  const strongCooccurrence = boost >= config.minCooccurrenceGate;

  let qualifyingSeedCount = 0;
  let multiSeedOK = true;
  if (!hasContentOverlap && cooccurrenceIndex && config.minContentMatch > 0) {
    qualifyingSeedCount = 0;
    for (const seed of cooccurrenceSeeds) {
      const entityAssociations = cooccurrenceIndex.associations[seed];
      if (!entityAssociations) continue;
      const cooccurrenceCount = entityAssociations.get(entityName) || 0;
      if (cooccurrenceCount < (cooccurrenceIndex.minCount ?? 2)) continue;
      const dfEntity = cooccurrenceIndex.documentFrequency?.get(entityName) || 0;
      const dfSeed = cooccurrenceIndex.documentFrequency?.get(seed) || 0;
      if (dfEntity === 0 || dfSeed === 0) continue;
      const npmi = computeNpmi(
        cooccurrenceCount,
        dfEntity,
        dfSeed,
        cooccurrenceIndex.totalNotesScanned ?? 1,
      );
      if (npmi > 0) qualifyingSeedCount++;
    }
    multiSeedOK = qualifyingSeedCount >= 2;
  }

  return {
    hasContentOverlap,
    strongCooccurrence,
    qualifyingSeedCount,
    multiSeedOK,
    admitted: hasContentOverlap || (strongCooccurrence && multiSeedOK),
  };
}

export function getEdgeWeightBoostScore(entityName: string, map: Map<string, number>): number {
  const averageWeight = map.get(entityName.toLowerCase());
  if (!averageWeight) return 0;
  return Math.min((averageWeight - 1.0) * 2, 4);
}
