/**
 * Wikilink suggestion scoring engine (arch-review G5, part F2)
 *
 * suggestRelatedLinks — the multi-layer scoring engine that turns note
 * content into ranked entity suggestions. Boost tables/pure helpers live in
 * wikilinkScoringConfig.ts; strictness configs + per-layer scoring math in
 * wikilinkScoring.ts; SQL persistence in wikilinkFeedbackStore.ts.
 */

import {
  getAllEntitiesWithTypes,
  type EntityCategory,
  STOPWORDS_EN,
} from '@velvetmonkey/vault-core';
import { extractLinkedEntities } from './wikilinkText.js';
import { getAllFeedbackBoosts, getAllSuppressionPenalties, getEntityStats } from './wikilinkFeedback.js';
import { insertSuggestionEvents, type SuggestionEventInsert } from './wikilinkFeedbackStore.js';
import { getCorrectedEntityNotePairs } from './corrections.js';
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
} from './wikilinkScoring.js';
import type { SuggestOptions, SuggestResult, StrictnessMode, ScoreBreakdown, ScoredSuggestion, ConfidenceLevel, ScoringLayer } from './types.js';
import { stem } from '../shared/stemmer.js';
import { getProspectBoostMap } from '../shared/prospects.js';
import {
  getCooccurrenceBoost,
  entityRarity,
} from '../shared/cooccurrence.js';
import { buildRetrievalBoostMap, getRetrievalBoost } from '../shared/retrievalCooccurrence.js';
import { getRecencyBoost, type RecencyIndex } from '../shared/recency.js';
import {
  embedTextCached,
  findSemanticallySimilarEntities,
  hasEntityEmbeddingsIndex,
} from '../read/embeddings.js';
import { getEntityEdgeWeightMap } from './edgeWeights.js';
import { buildCollapsedContentTerms, normalizeFuzzyTerm } from '../shared/levenshtein.js';
import {
  getWriteStateDb,
  getConfig,
  getWikilinkStrictness,
  checkAndRefreshIfStale,
  getScopedEntityIndex,
  isEntityIndexReady,
  getScopedRecencyIndex,
  getUnscopedCooccurrenceIndex,
} from './wikilinkState.js';
import {
  tokenizeForMatching,
  MAX_ENTITY_LENGTH,
  isLikelyArticleTitle,
  getTypeBoost,
  isCommonWordFalsePositive,
  getCrossFolderBoost,
  getHubBoost,
  CONTEXT_BOOST,
  SEMANTIC_MIN_SIMILARITY,
  SEMANTIC_MAX_BOOST,
  getNoteContext,
} from './wikilinkScoringConfig.js';

/**
 * Pattern to detect existing suggestion suffix (for idempotency)
 */
const SUGGESTION_PATTERN = /→\s*\[\[.+$/;

/**
 * Get effective strictness, adapting for note type.
 * Default: balanced everywhere, aggressive for daily notes.
 * When adaptive_strictness is enabled (default), daily notes use aggressive
 * to maximize link discovery on quick captures.
 */
function getEffectiveStrictness(notePath?: string): StrictnessMode {
  const base = getWikilinkStrictness();
  if (getConfig()?.adaptive_strictness === false) return base;
  // Adaptive is on by default — daily notes get aggressive
  const context = notePath ? getNoteContext(notePath) : 'general';
  if (context === 'daily') return 'aggressive';
  return base;
}

/**
 * Per-call inputs shared by every layer-boost computation
 * (loaded once at the top of suggestRelatedLinks).
 */
interface LayerBoostContext {
  disabled: Set<ScoringLayer>;
  contextBoosts: Partial<Record<EntityCategory, number>>;
  notePath?: string;
  recencyIndex: RecencyIndex | null;
  feedbackBoosts: Map<string, number>;
  suppressionPenalties: Map<string, number>;
  edgeWeightMap: Map<string, number>;
  prospectBoosts: Map<string, number>;
}

/** Per-branch differences for the layer-boost computation. */
interface LayerBoostOptions {
  /**
   * Whether the recency layer (Layer 7) applies. Main loop: always;
   * co-occurrence branch: gated on content overlap (graph-only entities
   * must not get a "recently seen" lift); semantic branch: omitted.
   */
  includeRecency: boolean;
  /**
   * Optional cap applied to BOTH hub (Layer 9) and cross-folder (Layer 8)
   * boosts — co-occurrence branch uses 2 for no-content-overlap entities so
   * hub entities can't dominate via graph signals alone. undefined = no cap.
   */
  hubCrossFolderCap?: number;
}

/** One value per boost layer; the CALLER sums them in its branch's original order. */
interface LayerBoosts {
  typeBoost: number;
  contextBoost: number;
  recencyBoost: number;
  crossFolderBoost: number;
  hubBoost: number;
  feedbackAdjustment: number;
  edgeWeightBoost: number;
  prospectBoost: number;
  suppressionPenalty: number;
}

/**
 * Compute the per-layer boost values shared by the three scoring branches
 * of suggestRelatedLinks (main lexical loop, co-occurrence admission,
 * semantic admission). IMPORTANT: this helper only computes the individual
 * layer values — each call site sums them itself, preserving that branch's
 * original floating-point addition order (the semantic branch adds hub
 * before cross-folder; the other two add cross-folder before hub).
 */
function computeLayerBoosts(
  entityName: string,
  entity: { path?: string; hubScore?: number },
  category: EntityCategory,
  ctx: LayerBoostContext,
  opts: LayerBoostOptions,
): LayerBoosts {
  const { disabled, contextBoosts, notePath, recencyIndex, feedbackBoosts, suppressionPenalties, edgeWeightMap, prospectBoosts } = ctx;
  // Layer 5: Type boost - prioritize people, projects over common technologies
  const typeBoost = disabled.has('type_boost') ? 0 : getTypeBoost(category, getConfig()?.custom_categories, entityName);
  // Layer 6: Context boost - boost types relevant to note context
  const contextBoost = disabled.has('context_boost') ? 0 : getContextBoostScore(category, contextBoosts);
  // Layer 7: Recency boost - boost recently-mentioned entities (branch-gated)
  const recencyBoost = opts.includeRecency && !disabled.has('recency')
    ? (recencyIndex ? getRecencyBoost(entityName, recencyIndex) : 0)
    : 0;
  // Layer 8: Cross-folder boost - prioritize cross-cutting connections
  const rawCrossFolderBoost = disabled.has('cross_folder') ? 0 : ((notePath && entity.path) ? getCrossFolderBoost(entity.path, notePath) : 0);
  // Layer 9: Hub score boost - prioritize well-connected notes
  const rawHubBoost = disabled.has('hub_boost') ? 0 : getHubBoost(entity);
  const crossFolderBoost = opts.hubCrossFolderCap !== undefined
    ? Math.min(rawCrossFolderBoost, opts.hubCrossFolderCap)
    : rawCrossFolderBoost;
  const hubBoost = opts.hubCrossFolderCap !== undefined
    ? Math.min(rawHubBoost, opts.hubCrossFolderCap)
    : rawHubBoost;
  // Layer 10: Feedback boost - adjust based on historical accuracy
  const feedbackAdjustment = disabled.has('feedback') ? 0 : getFeedbackBoostScore(entityName, feedbackBoosts);
  // Layer 12: Edge weight boost — entities with high-quality incoming links
  const edgeWeightBoost = disabled.has('edge_weight') ? 0 : getEdgeWeightBoostScore(entityName, edgeWeightMap);
  // Layer 14: Prospect boost — accumulated pre-entity evidence (exact name/alias match only)
  const prospectBoost = disabled.has('prospect_boost') ? 0 : (prospectBoosts.get(entityName.toLowerCase()) ?? 0);
  // Layer 0: Soft suppression penalty (proportional to Beta-Binomial posterior)
  const suppressionPenalty = disabled.has('feedback') ? 0 : getSuppressionPenaltyScore(entityName, suppressionPenalties);
  return { typeBoost, contextBoost, recencyBoost, crossFolderBoost, hubBoost, feedbackAdjustment, edgeWeightBoost, prospectBoost, suppressionPenalty };
}

/**
 * Suggest related wikilinks based on content analysis
 *
 * Analyzes content tokens and scores entities from the cache,
 * returning the top matches as suggested outgoing links.
 *
 * Filtering layers:
 * 1a. Length filter: Skip entities >25 chars (article titles, clippings)
 * 1b. Article pattern filter: Skip "Guide to", "How to", etc. and >3 words
 *
 * Scoring layers:
 * 2. Exact match: +10 per word (highest confidence)
 * 3. Stem match: +5 per word (medium confidence)
 * 4. Co-occurrence boost: +3 per related entity (conceptual links)
 *
 * Multi-word entities require 40% of words to match.
 * Minimum score of 5 required (at least one stem match).
 *
 * @param content - Content to analyze for suggestions
 * @param options - Configuration options
 * @returns Suggestion result with entity names and formatted suffix
 */

export async function suggestRelatedLinks(
  content: string,
  options: SuggestOptions = {}
): Promise<SuggestResult> {
  const {
    maxSuggestions = 8,
    excludeLinked = true,
    strictness = getEffectiveStrictness(options.notePath),
    notePath,
    detail = false,
    disabledLayers = [],
  } = options;

  // Build disabled layer set for ablation testing
  const disabled = new Set<ScoringLayer>(disabledLayers);

  // Get config for the specified strictness mode
  const config = STRICTNESS_CONFIGS[strictness];

  // Compute adaptive minimum score based on content length
  const adaptiveMinScore = getAdaptiveMinScore(content.length, config.minSuggestionScore);

  // Detect note context for context-aware boosting
  const noteContext = notePath ? getNoteContext(notePath) : 'general';
  const contextBoosts = CONTEXT_BOOST[noteContext];

  // Empty result for quick returns
  const emptyResult: SuggestResult = { suggestions: [], suffix: '' };

  // Check for existing suggestion suffix (idempotency)
  if (SUGGESTION_PATTERN.test(content)) {
    return emptyResult;
  }

  // Refresh entity index if Flywheel has updated it
  checkAndRefreshIfStale();

  // Check if entity index is ready
  const scopedEntityIndex = getScopedEntityIndex();
  if (!isEntityIndexReady() || !scopedEntityIndex) {
    return emptyResult;
  }

  // Get all entities with type information for category-based boosting
  const entitiesWithTypes = getAllEntitiesWithTypes(scopedEntityIndex);
  if (entitiesWithTypes.length === 0) {
    return emptyResult;
  }

  // Tokenize content and compute stems for matching
  const { tokens: rawTokens } = tokenizeForMatching(content);
  if (rawTokens.size === 0) {
    return emptyResult;
  }

  // Filter content tokens:
  // 1. Enforce minWordLength from strictness config (conservative=5, balanced/aggressive=4)
  // 2. Filter out generic words that cause false positives via co-occurrence
  const contentTokens = new Set<string>();
  const contentStems = new Set<string>();
  for (const token of rawTokens) {
    if (token.length >= config.minWordLength && !STOPWORDS_EN.has(token)) {
      contentTokens.add(token);
      contentStems.add(stem(token));
    }
  }

  // After filtering, check if any meaningful tokens remain
  if (contentTokens.size === 0) {
    return emptyResult;
  }

  // Precompute collapsed content terms for whole-term fuzzy matching
  // Adjacent windows of 1-3 tokens, normalized (lowercased, non-alpha stripped)
  const orderedContentTokens = [...rawTokens]
    .filter(token => token.length >= config.minWordLength && !STOPWORDS_EN.has(token))
    .map(normalizeFuzzyTerm)
    .filter(token => token.length > 0);
  const collapsedContentTerms = disabled.has('fuzzy_match')
    ? new Set<string>()
    : buildCollapsedContentTerms(orderedContentTokens);

  // Per-note fuzzy cache: avoids rescanning the same fuzzy candidate sets
  const tokenFuzzyCache = new Map<string, number>();

  // Get already-linked entities
  const linkedEntities = excludeLinked ? extractLinkedEntities(content) : new Set<string>();

  // Load feedback boosts once (Layer 10), with folder context for stratification
  const noteFolder = notePath ? notePath.split('/')[0] : undefined;
  const stateDb = getWriteStateDb();
  const feedbackBoosts = stateDb ? getAllFeedbackBoosts(stateDb, noteFolder) : new Map<string, number>();

  // Load suppression penalties once (Layer 0, soft proportional penalty)
  const suppressionPenalties = stateDb ? getAllSuppressionPenalties(stateDb) : new Map<string, number>();

  // Load correction exclusions (entity+note pairs with wrong_link corrections)
  const correctedPairs = stateDb ? getCorrectedEntityNotePairs(stateDb) : new Map();

  // Load edge weight map once (Layer 12)
  const edgeWeightMap = stateDb ? getEntityEdgeWeightMap(stateDb) : new Map<string, number>();

  // Load prospect boost map (Layer 14)
  const prospectBoosts = disabled.has('prospect_boost') ? new Map<string, number>() : getProspectBoostMap();

  // First pass: Score entities and track which ones matched directly
  interface ScoredEntry {
    name: string;
    path: string;
    score: number;
    category: EntityCategory;
    breakdown: ScoreBreakdown;
  }
  const scoredEntities: ScoredEntry[] = [];
  const directlyMatchedEntities = new Set<string>();
  // Track entities admitted by any scoring path (lexical, cooccurrence, semantic) — minContentMatch gate applied later
  const entitiesWithAnyScoringPath = new Set<string>();
  const scopedRecencyIndex = getScopedRecencyIndex();
  // The scoring engine reads the raw module-level co-occurrence index (never
  // the ALS-scoped one) — preserved verbatim from before the module split;
  // all reads happen before the first await, so a single capture is exact.
  const cooccurrenceIndex = getUnscopedCooccurrenceIndex();

  // Shared per-layer boost inputs for all three scoring branches
  const boostCtx: LayerBoostContext = {
    disabled, contextBoosts, notePath, recencyIndex: scopedRecencyIndex,
    feedbackBoosts, suppressionPenalties, edgeWeightMap, prospectBoosts,
  };

  for (const { entity, category } of entitiesWithTypes) {
    // Get entity name
    const entityName = entity.name;
    if (!entityName) continue;
    if (isCommonWordFalsePositive(entityName, content, category)) continue;

    // Layer 1a: Length filter - skip article titles, clippings (>25 chars)
    if (!disabled.has('length_filter') && entityName.length > MAX_ENTITY_LENGTH) {
      continue;
    }

    // Layer 1b: Article pattern filter - skip "Guide to", "How to", >3 words, etc.
    if (!disabled.has('article_filter') && isLikelyArticleTitle(entityName)) {
      continue;
    }

    // Skip if already linked
    if (linkedEntities.has(entityName.toLowerCase())) {
      continue;
    }

    // Skip entities with wrong_link corrections for this note
    if (notePath && correctedPairs.has(entityName.toLowerCase())) {
      const paths = correctedPairs.get(entityName.toLowerCase())!;
      if (paths.has(notePath)) continue;
    }

    // Layers 2+3+3.5: Exact match, stem match, fuzzy match, and alias matching
    const entityScore = (disabled.has('exact_match') && disabled.has('stem_match') && disabled.has('fuzzy_match'))
      ? { contentMatch: 0, fuzzyMatch: 0, totalLexical: 0, matchedWords: 0, exactMatches: 0, totalTokens: 0 }
      : scoreEntity(entity, contentTokens, contentStems, collapsedContentTerms, config, disabled, cooccurrenceIndex, tokenFuzzyCache);
    const contentScore = entityScore.contentMatch;
    const fuzzyMatchScore = entityScore.fuzzyMatch;
    const hasLexicalEvidence = entityScore.totalLexical > 0;

    // Layer 4.5: Rarity adjustment — boost rare entities, no penalty for common ones.
    // Only positive adjustments: common entities score as before, rare entities get a lift.
    // Capped at +5 to prevent dominating the total score.
    let layerRarityAdjustment = 0;
    if (hasLexicalEvidence && !disabled.has('rarity')) {
      const multiplier = entityRarity(entityName, cooccurrenceIndex);
      if (multiplier > 1.0) {
        const raw = entityScore.totalLexical * (multiplier - 1);
        layerRarityAdjustment = Math.round(Math.min(5, raw) * 10) / 10;
      }
    }
    let score = entityScore.totalLexical + layerRarityAdjustment;

    // Track entities with actual lexical matches (content + fuzzy)
    if (hasLexicalEvidence) {
      entitiesWithAnyScoringPath.add(entityName);
    }

    // Layers 5-14 + Layer 0, summed below in this branch's original order
    const boosts = computeLayerBoosts(entityName, entity, category, boostCtx, {
      includeRecency: true,
    });
    score += boosts.typeBoost;
    score += boosts.contextBoost;
    score += boosts.recencyBoost;
    score += boosts.crossFolderBoost;
    score += boosts.hubBoost;
    score += boosts.feedbackAdjustment;
    score += boosts.edgeWeightBoost;
    score += boosts.prospectBoost;

    // Add to directlyMatchedEntities BEFORE suppression penalty
    // Only lexically-matched entities should seed co-occurrence lookups;
    // entities with only type/hub/recency boosts (no lexical evidence) are noise seeds.
    if (hasLexicalEvidence) {
      directlyMatchedEntities.add(entityName);
    }

    // Layer 0: Soft suppression penalty (proportional to Beta-Binomial posterior)
    score += boosts.suppressionPenalty;
    score = capScoreWithoutContentRelevance(score, contentScore + fuzzyMatchScore, config);

    // Minimum threshold (adaptive based on content length)
    // Require lexical evidence — entities with only type/hub/recency boosts are
    // discovered via the co-occurrence loop below if they're graph-connected.
    if (hasLexicalEvidence && score >= adaptiveMinScore) {
      scoredEntities.push({
        name: entityName,
        path: entity.path || '',
        score,
        category,
        breakdown: {
          contentMatch: contentScore,
          fuzzyMatch: fuzzyMatchScore,
          cooccurrenceBoost: 0,
          rarityAdjustment: layerRarityAdjustment,
          typeBoost: boosts.typeBoost,
          contextBoost: boosts.contextBoost,
          recencyBoost: boosts.recencyBoost,
          crossFolderBoost: boosts.crossFolderBoost,
          hubBoost: boosts.hubBoost,
          feedbackAdjustment: boosts.feedbackAdjustment,
          suppressionPenalty: boosts.suppressionPenalty,
          edgeWeightBoost: boosts.edgeWeightBoost,
          prospectBoost: boosts.prospectBoost,
        },
      });
    }
  }

  // Layer 4: Add co-occurrence boost for entities related to matched ones
  // This allows entities that didn't match directly but are conceptually related
  // to be suggested.
  // Use both directly matched AND already-linked entities as co-occurrence seeds.
  // Linked entities provide strong context about what's in the note, even though
  // they're excluded from suggestions themselves.
  const cooccurrenceSeeds = new Set(directlyMatchedEntities);
  // linkedEntities are lowercase; co-occurrence index uses display-case names.
  // Build a lowercase→display-case lookup from entitiesWithTypes.
  if (linkedEntities.size > 0) {
    const lowerToDisplay = new Map<string, string>();
    for (const { entity } of entitiesWithTypes) {
      if (entity.name) lowerToDisplay.set(entity.name.toLowerCase(), entity.name);
    }
    for (const linked of linkedEntities) {
      const displayName = lowerToDisplay.get(linked);
      if (displayName) cooccurrenceSeeds.add(displayName);
    }
  }
  // Build retrieval co-occurrence boost map (bulk query)
  let retrievalBoostMap = new Map<string, number>();
  if (!disabled.has('cooccurrence') && stateDb && cooccurrenceSeeds.size > 0) {
    // Collect note paths for seed entities
    const seedNotePaths = new Set<string>();
    for (const seedName of cooccurrenceSeeds) {
      const seedEntity = entitiesWithTypes.find(e => e.entity.name === seedName);
      if (seedEntity?.entity.path) seedNotePaths.add(seedEntity.entity.path);
    }
    if (seedNotePaths.size > 0) {
      try {
        retrievalBoostMap = buildRetrievalBoostMap(seedNotePaths, stateDb);
      } catch { /* table may not exist yet */ }
    }
  }

  if (!disabled.has('cooccurrence') && cooccurrenceIndex && cooccurrenceSeeds.size > 0) {
    for (const { entity, category } of entitiesWithTypes) {
      const entityName = entity.name;
      if (!entityName) continue;
      if (isCommonWordFalsePositive(entityName, content, category)) continue;

      // Skip if already scored, already linked, too long, or article-like
      if (!disabled.has('length_filter') && entityName.length > MAX_ENTITY_LENGTH) continue;
      if (!disabled.has('article_filter') && isLikelyArticleTitle(entityName)) continue;
      if (linkedEntities.has(entityName.toLowerCase())) continue;

      // Get co-occurrence boost: max(content co-occurrence, retrieval co-occurrence)
      const contentCoocBoost = getCooccurrenceBoost(entityName, cooccurrenceSeeds, cooccurrenceIndex, scopedRecencyIndex);
      const retrievalCoocBoost = getRetrievalBoost(entity.path, retrievalBoostMap);
      const boost = Math.max(contentCoocBoost, retrievalCoocBoost);

      if (boost > 0) {
        // Check if entity is already in scored list (already has content match)
        const existing = scoredEntities.find(e => e.name === entityName);
        if (existing) {
          existing.score += boost;
          existing.breakdown.cooccurrenceBoost += boost;
          const existingContentRelevance = existing.breakdown.contentMatch + existing.breakdown.fuzzyMatch + (existing.breakdown.semanticBoost ?? 0);
          existing.score = capScoreWithoutContentRelevance(existing.score, existingContentRelevance, config);
        } else {
          const admission = evaluateCooccurrenceAdmission(
            entityName,
            contentTokens,
            contentStems,
            cooccurrenceSeeds,
            cooccurrenceIndex,
            boost,
            config,
          );
          const { admitted, hasContentOverlap } = admission;
          if (!admitted) continue;

          // Entity passed content overlap or strong co-occurrence check —
          // qualify it for final results
          entitiesWithAnyScoringPath.add(entityName);

          // For purely co-occurrence-based suggestions, add relevant boosts.
          // Recency is omitted for graph-only entities — it's a "recently seen" signal
          // that shouldn't inflate scores for entities absent from the note's text.
          // Hub + crossFolder capped at 2 when there's no content overlap so hub
          // entities can't dominate suffix lines via graph signals alone.
          const boosts = computeLayerBoosts(entityName, entity, category, boostCtx, {
            includeRecency: hasContentOverlap,
            hubCrossFolderCap: hasContentOverlap ? undefined : 2,
          });
          let totalBoost = boost + boosts.typeBoost + boosts.contextBoost + boosts.recencyBoost + boosts.crossFolderBoost + boosts.hubBoost + boosts.feedbackAdjustment + boosts.edgeWeightBoost + boosts.prospectBoost + boosts.suppressionPenalty;
          const coocContentRelevance = hasContentOverlap ? 5 : 0;
          totalBoost = capScoreWithoutContentRelevance(totalBoost, coocContentRelevance, config);

          // Graph-only suggestions (no content overlap) need a higher score floor
          const effectiveMinScore = !hasContentOverlap
            ? Math.max(adaptiveMinScore, 7)
            : adaptiveMinScore;

          if (totalBoost >= effectiveMinScore) {
            // Add entity if boost meets threshold
            scoredEntities.push({
              name: entityName,
              path: entity.path || '',
              score: totalBoost,
              category,
              breakdown: {
                contentMatch: 0,
                fuzzyMatch: 0,
                cooccurrenceBoost: boost,
                rarityAdjustment: 0,
                typeBoost: boosts.typeBoost,
                contextBoost: boosts.contextBoost,
                recencyBoost: boosts.recencyBoost,
                crossFolderBoost: boosts.crossFolderBoost,
                hubBoost: boosts.hubBoost,
                feedbackAdjustment: boosts.feedbackAdjustment,
                suppressionPenalty: boosts.suppressionPenalty,
                edgeWeightBoost: boosts.edgeWeightBoost,
                prospectBoost: boosts.prospectBoost,
              },
            });
          }
        }
      }
    }
  }

  // ═══════════════════════════════════
  // LAYER 11: Semantic Similarity
  // ═══════════════════════════════════
  if (!disabled.has('semantic') && content.length >= 20 && hasEntityEmbeddingsIndex()) {
    try {
      const contentEmbedding = await embedTextCached(content);

      // Strictness multiplier for semantic boost
      const semanticStrictnessMultiplier = getSemanticStrictnessMultiplier(strictness);

      const semanticMatches = findSemanticallySimilarEntities(
        contentEmbedding,
        (maxSuggestions || 3) * 3,
        linkedEntities
      );

      for (const match of semanticMatches) {
        if (match.similarity < SEMANTIC_MIN_SIMILARITY) continue;

        const semanticEntityWithType = entitiesWithTypes.find(
          et => et.entity.name === match.entityName
        );
        if (!semanticEntityWithType) continue;
        if (isCommonWordFalsePositive(match.entityName, content, semanticEntityWithType.category)) continue;

        const boost = match.similarity * SEMANTIC_MAX_BOOST * semanticStrictnessMultiplier;

        // Check if entity already has a score
        const existing = scoredEntities.find(e => e.name === match.entityName);
        if (existing) {
          existing.score += boost;
          existing.breakdown.semanticBoost = boost;
        } else if (!linkedEntities.has(match.entityName.toLowerCase())) {
          // NEW entity not in scored list and not already linked

          // Look up the entity in the entity index
          // Skip length/article filters (same as main loop)
          if (!disabled.has('length_filter') && match.entityName.length > MAX_ENTITY_LENGTH) continue;
          if (!disabled.has('article_filter') && isLikelyArticleTitle(match.entityName)) continue;

          const { entity, category } = semanticEntityWithType;

          // Reuse existing layer logic for base boosts (recency omitted;
          // summed in this branch's original order: hub BEFORE cross-folder)
          const boosts = computeLayerBoosts(match.entityName, entity, category, boostCtx, {
            includeRecency: false,
          });

          const totalScore = boost + boosts.typeBoost + boosts.contextBoost + boosts.hubBoost + boosts.crossFolderBoost + boosts.feedbackAdjustment + boosts.edgeWeightBoost + boosts.prospectBoost + boosts.suppressionPenalty;

          if (totalScore >= adaptiveMinScore) {
            scoredEntities.push({
              name: match.entityName,
              path: entity.path || '',
              score: totalScore,
              category,
              breakdown: {
                contentMatch: 0,
                fuzzyMatch: 0,
                cooccurrenceBoost: 0,
                rarityAdjustment: 0,
                typeBoost: boosts.typeBoost,
                contextBoost: boosts.contextBoost,
                recencyBoost: 0,
                crossFolderBoost: boosts.crossFolderBoost,
                hubBoost: boosts.hubBoost,
                feedbackAdjustment: boosts.feedbackAdjustment,
                suppressionPenalty: boosts.suppressionPenalty,
                semanticBoost: boost,
                edgeWeightBoost: boosts.edgeWeightBoost,
                prospectBoost: boosts.prospectBoost,
              },
            });

            // Add to scoring-path set — semantic admission; minContentMatch applied at final filter
            entitiesWithAnyScoringPath.add(match.entityName);
          }
        }
      }
    } catch {
      // Semantic scoring failure never breaks suggestions
    }
  }

  for (const entry of scoredEntities) {
    const contentRelevance =
      entry.breakdown.contentMatch +
      entry.breakdown.fuzzyMatch +
      (entry.breakdown.semanticBoost ?? 0);
    entry.score = capScoreWithoutContentRelevance(entry.score, contentRelevance, config);
  }

  // Filter to entities admitted by a scoring path, then enforce minContentMatch floor
  // This prevents popularity-based suggestions (high hub score, recency) for unrelated content
  const relevantEntities = scoredEntities.filter(e => {
    if (!entitiesWithAnyScoringPath.has(e.name)) return false;
    if (config.minContentMatch > 0 && e.breakdown.contentMatch < config.minContentMatch) return false;
    return true;
  });

  // If no content matches at all, return empty rather than popularity-based suggestions
  if (relevantEntities.length === 0) {
    return emptyResult;
  }

  // Sort by score (descending) with recency as tiebreaker
  relevantEntities.sort((a, b) => {
    // Primary: score (descending)
    if (b.score !== a.score) return b.score - a.score;

    // Secondary: recency (more recent first)
    if (scopedRecencyIndex) {
      const aRecency = scopedRecencyIndex.lastMentioned.get(a.name.toLowerCase()) || 0;
      const bRecency = scopedRecencyIndex.lastMentioned.get(b.name.toLowerCase()) || 0;
      return bRecency - aRecency;
    }

    return 0;
  });

  // Persist suggestion events for pipeline observability (Pillar 6)
  const persistDb = getWriteStateDb();
  if (persistDb && notePath) {
    try {
      const now = Date.now();
      const events: SuggestionEventInsert[] = relevantEntities.map(e => ({
        entity: e.name,
        totalScore: e.score,
        breakdownJson: JSON.stringify(e.breakdown),
        passed: 1 as const,  // passed threshold (these are relevantEntities)
      }));
      // Also persist entities that were scored but didn't meet threshold
      for (const e of scoredEntities) {
        if (!entitiesWithAnyScoringPath.has(e.name)) continue;
        if (relevantEntities.some(r => r.name === e.name)) continue;
        events.push({
          entity: e.name,
          totalScore: e.score,
          breakdownJson: JSON.stringify(e.breakdown),
          passed: 0,  // did not pass threshold
        });
      }
      insertSuggestionEvents(persistDb, now, notePath, adaptiveMinScore, strictness, events);
    } catch {
      // Score persistence failure never breaks suggestions
    }
  }

  // Self-reference avoidance: don't suggest the entity whose note IS the current note
  const currentNoteStem = notePath
    ? notePath.replace(/\.md$/, '').split('/').pop()?.toLowerCase()
    : null;
  const filtered = currentNoteStem
    ? relevantEntities.filter(e => e.name.toLowerCase() !== currentNoteStem)
    : relevantEntities;

  const topEntries = filtered.slice(0, maxSuggestions);
  const topSuggestions = topEntries.map(e => e.name);

  if (topSuggestions.length === 0) {
    return emptyResult;
  }

  // Score floor + content relevance gate: only append entities to note content
  // that meet the score threshold AND have some form of content relevance.
  // This prevents hub entities from appearing in every suffix via graph signals alone.
  // Lower-scoring entities still appear in suggestions/suggestion_events for
  // dashboard observability — we just don't write them into the suffix.
  const MAX_SUFFIX_ENTRIES = 3;
  const MAX_SUFFIX_PER_CATEGORY = 2;
  const MAX_SUFFIX_PER_FOLDER = 2;
  const MAX_SUFFIX_APPEARANCES = 5; // hard block after 5 appearances in file
  const MIN_SUFFIX_SCORE = noteContext === 'daily' ? 8 : 12;
  const MIN_SUFFIX_CONTENT = noteContext === 'daily' ? 2 : 3;

  // Per-file fatigue: count existing suffix appearances for each entity
  const suffixCandidates = topEntries.filter(e => {
    if (e.score < MIN_SUFFIX_SCORE) return false;
    if (e.breakdown.contentMatch < MIN_SUFFIX_CONTENT) return false;

    // Count how many times this entity already appears in → suffix lines
    if (!disabled.has('fatigue')) {
      const escapedName = e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const suffixPattern = new RegExp(`→ .*\\[\\[${escapedName}\\]\\]`, 'g');
      const appearances = (content.match(suffixPattern) || []).length;
      if (appearances >= MAX_SUFFIX_APPEARANCES) return false;
    }

    return true;
  });

  // Suffix diversity: greedy selection with category + folder caps
  const suffixEntries: typeof suffixCandidates = [];
  const categoryCount = new Map<string, number>();
  const folderCount = new Map<string, number>();
  for (const c of suffixCandidates) {
    const cat = c.category ?? 'other';
    const folder = c.path?.split('/')[0] ?? '';
    const catN = categoryCount.get(cat) ?? 0;
    const folderN = folderCount.get(folder) ?? 0;
    if (catN >= MAX_SUFFIX_PER_CATEGORY) continue;
    if (folderN >= MAX_SUFFIX_PER_FOLDER) continue;
    suffixEntries.push(c);
    categoryCount.set(cat, catN + 1);
    folderCount.set(folder, folderN + 1);
    if (suffixEntries.length >= MAX_SUFFIX_ENTRIES) break;
  }
  const suffix = suffixEntries.length > 0
    ? '→ ' + suffixEntries.map(e => `[[${e.name}]]`).join(', ')
    : '';

  const result: SuggestResult = {
    suggestions: topSuggestions,
    suffix,
  };

  // Build detailed breakdown when requested
  if (detail) {
    // Load feedback stats for count/accuracy (only when detail requested)
    const feedbackStats = stateDb ? getEntityStats(stateDb) : [];
    const feedbackMap = new Map(feedbackStats.map(s => [s.entity, s]));

    result.detailed = topEntries.map((e): ScoredSuggestion => {
      const fb = feedbackMap.get(e.name);
      const confidence: ConfidenceLevel = e.score >= 20 ? 'high' : e.score >= 12 ? 'medium' : 'low';
      return {
        entity: e.name,
        path: e.path,
        totalScore: e.score,
        breakdown: e.breakdown,
        confidence,
        feedbackCount: fb?.total ?? 0,
        accuracy: fb ? fb.accuracy : undefined,
      };
    });
  }

  return result;
}
