/**
 * Wikilink integration for Flywheel Memory
 *
 * Manages entity index lifecycle and provides wikilink processing
 * for mutation tools. Mirrors Flywheel's startup pattern.
 *
 * ARCHITECTURE NOTE: Flywheel Memorymaintains its own entity index independent of Flywheel.
 * This is by design for resilience - Flywheel Memoryworks even if Flywheel isn't running.
 * Both Flywheel and Flywheel Memoryuse @velvetmonkey/vault-core for consistent scanning
 * logic, but each maintains its own cached copy of the entity index.
 *
 * Storage: SQLite StateDb at .claude/state.db (managed by vault-core)
 *
 * Lifecycle:
 * 1. On startup: Load from StateDb if valid, else full vault scan
 * 2. StateDb includes version number for migration detection
 * 3. Index is held in memory for the duration of the MCP session
 * 4. Flywheel exposes entity data via MCP for LLM queries
 * 5. Flywheel Memoryuses its local copy for wikilink application during mutations
 */

import {
  scanVaultEntities,
  getAllEntities,
  getAllEntitiesWithTypes,
  getEntityName,
  getEntityAliases,
  applyWikilinks,
  resolveAliasWikilinks,
  getEntityIndexFromDb,
  getStateDbMetadata,
  getEntityByName,
  getEntitiesByAlias,
  searchEntities as searchEntitiesDb,
  type EntityIndex,
  type EntityCategory,
  type EntityWithType,
  type WikilinkResult,
  type Entity,
  type StateDb,
  type EntitySearchResult,
} from '@velvetmonkey/vault-core';
import { isSuppressed, getAllFeedbackBoosts, getEntityStats, trackWikilinkApplications } from './wikilinkFeedback.js';
import { setGitStateDb } from './git.js';
import { setHintsStateDb } from './hints.js';
import { setRecencyStateDb } from '../shared/recency.js';
import path from 'path';
import type { SuggestOptions, SuggestResult, SuggestionConfig, StrictnessMode, NoteContext, ScoreBreakdown, ScoredSuggestion, ConfidenceLevel } from './types.js';
import { stem, tokenize } from '../shared/stemmer.js';
import {
  mineCooccurrences,
  getCooccurrenceBoost,
  serializeCooccurrenceIndex,
  deserializeCooccurrenceIndex,
  type CooccurrenceIndex,
} from '../shared/cooccurrence.js';
import {
  buildRecencyIndex,
  getRecencyBoost,
  loadRecencyFromStateDb,
  saveRecencyToStateDb,
  type RecencyIndex,
} from '../shared/recency.js';
import { embedTextCached, findSemanticallySimilarEntities, hasEntityEmbeddingsIndex } from '../read/embeddings.js';

/**
 * Module-level StateDb reference
 */
let moduleStateDb: StateDb | null = null;

/**
 * Set the StateDb instance for all Flywheel Memorycore modules
 * Called during MCP server initialization
 */
export function setWriteStateDb(stateDb: StateDb | null): void {
  moduleStateDb = stateDb;
  // Propagate to other modules
  setGitStateDb(stateDb);
  setHintsStateDb(stateDb);
  setRecencyStateDb(stateDb);
}

/**
 * Get the StateDb instance (for use by other modules like mutation-helpers)
 */
export function getWriteStateDb(): StateDb | null {
  return moduleStateDb;
}

/**
 * Global entity index state
 */
let entityIndex: EntityIndex | null = null;
let indexReady = false;
let indexError: Error | null = null;

/**
 * Timestamp when entity index was last loaded from StateDb
 * Used to detect when Flywheel has updated entities and we need to refresh
 */
let lastLoadedAt: number = 0;

/**
 * Global co-occurrence index state
 */
let cooccurrenceIndex: CooccurrenceIndex | null = null;

/**
 * Global recency index state
 */
let recencyIndex: RecencyIndex | null = null;

/**
 * Folders to exclude from entity scanning
 * Includes periodic notes, working folders, and clippings/external content
 */
const DEFAULT_EXCLUDE_FOLDERS = [
  // Periodic notes
  'daily-notes',
  'daily',
  'weekly',
  'weekly-notes',
  'monthly',
  'monthly-notes',
  'quarterly',
  'yearly-notes',
  'periodic',
  'journal',
  // Working folders
  'inbox',
  'templates',
  'attachments',
  'tmp',
  // Clippings & external content (article titles are not concepts)
  'clippings',
  'readwise',
  'articles',
  'bookmarks',
  'web-clips',
];

/**
 * Initialize entity index in background
 * Called at MCP server startup - returns immediately, builds in background
 *
 * Tries loading from StateDb first, then full rebuild.
 */
export async function initializeEntityIndex(vaultPath: string): Promise<void> {
  try {
    // Try loading from StateDb (fastest path)
    if (moduleStateDb) {
      try {
        const dbIndex = getEntityIndexFromDb(moduleStateDb);
        if (dbIndex._metadata.total_entities > 0) {
          entityIndex = dbIndex;
          indexReady = true;
          lastLoadedAt = Date.now();
          console.error(`[Flywheel] Loaded ${dbIndex._metadata.total_entities} entities from StateDb`);
          return;
        }
      } catch (e) {
        console.error('[Flywheel] Failed to load from StateDb:', e);
      }
    }

    // No StateDb or empty - build index
    await rebuildIndex(vaultPath);
  } catch (error) {
    indexError = error instanceof Error ? error : new Error(String(error));
    console.error(`[Flywheel] Failed to initialize entity index: ${indexError.message}`);
    // Don't throw - wikilinks will just be disabled
  }
}

/**
 * Rebuild index synchronously
 */
async function rebuildIndex(vaultPath: string): Promise<void> {
  console.error(`[Flywheel] Scanning vault for entities...`);
  const startTime = Date.now();

  entityIndex = await scanVaultEntities(vaultPath, {
    excludeFolders: DEFAULT_EXCLUDE_FOLDERS,
  });

  indexReady = true;
  lastLoadedAt = Date.now();
  const entityDuration = Date.now() - startTime;
  console.error(`[Flywheel] Entity index built: ${entityIndex._metadata.total_entities} entities in ${entityDuration}ms`);

  // Save to StateDb for fast subsequent loads
  if (moduleStateDb) {
    try {
      moduleStateDb.replaceAllEntities(entityIndex);
      console.error(`[Flywheel] Saved entities to StateDb`);
    } catch (e) {
      console.error(`[Flywheel] Failed to save entities to StateDb: ${e}`);
    }
  }

  // Get entities for secondary indexes
  const entities = getAllEntities(entityIndex);
  const entityNames = entities.map(e => typeof e === 'string' ? e : getEntityName(e));

  // Mine co-occurrences for conceptual suggestions
  try {
    const cooccurrenceStart = Date.now();
    cooccurrenceIndex = await mineCooccurrences(vaultPath, entityNames);
    const cooccurrenceDuration = Date.now() - cooccurrenceStart;
    console.error(`[Flywheel] Co-occurrence index built: ${cooccurrenceIndex._metadata.total_associations} associations in ${cooccurrenceDuration}ms`);
  } catch (e) {
    console.error(`[Flywheel] Failed to build co-occurrence index: ${e}`);
  }

  // Build recency index for temporal suggestions
  try {
    // Try loading from StateDb first
    const cachedRecency = loadRecencyFromStateDb();
    const cacheAgeMs = cachedRecency ? Date.now() - cachedRecency.lastUpdated : Infinity;

    if (cachedRecency && cacheAgeMs < 60 * 60 * 1000) {
      // Cache is valid and less than 1 hour old
      recencyIndex = cachedRecency;
      console.error(`[Flywheel] Recency index loaded from StateDb (${recencyIndex.lastMentioned.size} entities)`);
    } else {
      // Build fresh recency index
      const recencyStart = Date.now();
      recencyIndex = await buildRecencyIndex(vaultPath, entities);
      const recencyDuration = Date.now() - recencyStart;
      console.error(`[Flywheel] Recency index built: ${recencyIndex.lastMentioned.size} entities in ${recencyDuration}ms`);

      // Save to StateDb
      saveRecencyToStateDb(recencyIndex);
    }
  } catch (e) {
    console.error(`[Flywheel] Failed to build recency index: ${e}`);
  }
}

/**
 * Check if entity index is ready
 */
export function isEntityIndexReady(): boolean {
  return indexReady && entityIndex !== null;
}

/**
 * Get the entity index (may be null if not ready)
 */
export function getEntityIndex(): EntityIndex | null {
  return entityIndex;
}

/**
 * Check if Flywheel has updated StateDb since we loaded, and refresh if so.
 *
 * This enables Flywheel Memoryto detect when Flywheel's file watcher has reindexed
 * the vault (adding new entities) without requiring Flywheel Memoryrestart.
 *
 * Called before applying wikilinks to ensure fresh entity data.
 */
export function checkAndRefreshIfStale(): void {
  if (!moduleStateDb || !indexReady) return;

  try {
    const metadata = getStateDbMetadata(moduleStateDb);
    if (!metadata.entitiesBuiltAt) return;

    const dbBuiltAt = new Date(metadata.entitiesBuiltAt).getTime();

    // If StateDb was updated after we loaded, refresh
    if (dbBuiltAt > lastLoadedAt) {
      console.error('[Flywheel] Entity index stale, reloading from StateDb...');
      const dbIndex = getEntityIndexFromDb(moduleStateDb);
      if (dbIndex._metadata.total_entities > 0) {
        entityIndex = dbIndex;
        lastLoadedAt = Date.now();
        console.error(`[Flywheel] Reloaded ${dbIndex._metadata.total_entities} entities`);
      }
    }
  } catch (e) {
    // StateDb might be locked or corrupted - skip refresh silently
    // Flywheel Memorywill continue using its cached version
    console.error('[Flywheel] Failed to check for stale entities:', e);
  }
}

/**
 * Sort entities by priority for inline wikilink detection
 *
 * vault-core's applyWikilinks re-sorts by name length (longest first),
 * but preserves order for same-length entities. By sorting by priority
 * first, we ensure higher-priority entities (cross-folder, hub notes)
 * get linked first when multiple entities have the same length.
 *
 * @param entities - Entities to sort
 * @param notePath - Path to the note being edited (for cross-folder boost)
 * @returns Sorted entities with highest priority first
 */
function sortEntitiesByPriority(entities: Entity[], notePath?: string): Entity[] {
  return [...entities].sort((a, b) => {
    const entityA = typeof a === 'string' ? { name: a, path: '', aliases: [] } : a;
    const entityB = typeof b === 'string' ? { name: b, path: '', aliases: [] } : b;

    // Calculate priority scores
    let priorityA = 0;
    let priorityB = 0;

    // Cross-folder boost
    if (notePath) {
      priorityA += getCrossFolderBoost(entityA.path, notePath);
      priorityB += getCrossFolderBoost(entityB.path, notePath);
    }

    // Hub score boost
    priorityA += getHubBoost(entityA);
    priorityB += getHubBoost(entityB);

    // Higher priority first
    return priorityB - priorityA;
  });
}

/**
 * Process content through wikilink application
 *
 * Two-step processing:
 * 1. Resolve existing wikilinks that use aliases (e.g., [[model context protocol]] → [[MCP|model context protocol]])
 * 2. Apply wikilinks to plain text (normal auto-wikilink processing)
 *
 * @param content - Content to process
 * @param notePath - Optional path to the note for priority sorting
 * @returns Content with wikilinks applied, or original if index not ready
 */
export function processWikilinks(content: string, notePath?: string): WikilinkResult {
  if (!isEntityIndexReady() || !entityIndex) {
    // eslint-disable-next-line no-console
    console.error('[Flywheel:DEBUG] Entity index not ready, entities:', entityIndex?._metadata?.total_entities ?? 0);
    return {
      content,
      linksAdded: 0,
      linkedEntities: [],
    };
  }

  let entities = getAllEntities(entityIndex);
  // eslint-disable-next-line no-console
  console.error(`[Flywheel:DEBUG] Processing wikilinks with ${entities.length} entities`);

  // Filter out suppressed entities (from wikilink feedback, with folder context)
  if (moduleStateDb) {
    const folder = notePath ? notePath.split('/')[0] : undefined;
    entities = entities.filter(e => {
      const name = getEntityName(e);
      return !isSuppressed(moduleStateDb!, name, folder);
    });
  }

  // Sort by priority (cross-folder + hub) for same-length entity preference
  const sortedEntities = sortEntitiesByPriority(entities, notePath);

  // Step 1: Resolve existing wikilinks that use aliases (case-insensitive)
  // [[model context protocol]] → [[MCP|model context protocol]]
  const resolved = resolveAliasWikilinks(content, sortedEntities, {
    caseInsensitive: true,
  });

  // Step 2: Apply wikilinks to plain text (normal processing)
  const result = applyWikilinks(resolved.content, sortedEntities, {
    firstOccurrenceOnly: true,
    caseInsensitive: true,
  });

  // Combine results from both steps
  return {
    content: result.content,
    linksAdded: resolved.linksAdded + result.linksAdded,
    linkedEntities: [...resolved.linkedEntities, ...result.linkedEntities],
  };
}

/**
 * Apply wikilinks to content if enabled
 *
 * @param content - Content to potentially wikilink
 * @param skipWikilinks - If true, skip wikilink processing
 * @param notePath - Optional path to the note for priority sorting
 * @returns Processed content (with or without wikilinks)
 */
export function maybeApplyWikilinks(
  content: string,
  skipWikilinks: boolean,
  notePath?: string
): { content: string; wikilinkInfo?: string } {
  if (skipWikilinks) {
    return { content };
  }

  // Check if Flywheel updated entities since we loaded
  checkAndRefreshIfStale();

  const result = processWikilinks(content, notePath);

  if (result.linksAdded > 0) {
    // Track applications for implicit feedback detection
    if (moduleStateDb && notePath) {
      trackWikilinkApplications(moduleStateDb, notePath, result.linkedEntities);
    }

    return {
      content: result.content,
      wikilinkInfo: `Applied ${result.linksAdded} wikilink(s): ${result.linkedEntities.join(', ')}`,
    };
  }

  return { content: result.content };
}

/**
 * Get entity index statistics (for debugging/status)
 */
export function getEntityIndexStats(): {
  ready: boolean;
  totalEntities: number;
  categories: Record<string, number>;
  error?: string;
} {
  if (!indexReady || !entityIndex) {
    return {
      ready: false,
      totalEntities: 0,
      categories: {},
      error: indexError?.message,
    };
  }

  return {
    ready: true,
    totalEntities: entityIndex._metadata.total_entities,
    categories: {
      technologies: entityIndex.technologies.length,
      acronyms: entityIndex.acronyms.length,
      people: entityIndex.people.length,
      projects: entityIndex.projects.length,
      organizations: entityIndex.organizations?.length ?? 0,
      locations: entityIndex.locations?.length ?? 0,
      concepts: entityIndex.concepts?.length ?? 0,
      other: entityIndex.other.length,
    },
  };
}

// ========================================
// Suggestion Link Logic
// ========================================

/**
 * Pattern to detect existing suggestion suffix (for idempotency)
 */
const SUGGESTION_PATTERN = /→\s*\[\[.+$/;

/**
 * Common stopwords to exclude from tokenization
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'this', 'that',
  'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what',
  'which', 'who', 'whom', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also',
]);

/**
 * Generic words that are too common to trigger entity suggestions
 *
 * These words pass tokenization filters (4+ chars, not stopwords) but are
 * semantically too generic to meaningfully connect to specific entities.
 * They cause false positives through co-occurrence boosting.
 *
 * Example: "a test message" would match entities containing "message",
 * which then co-occur with unrelated entities like Azure services.
 *
 * NOTE: Intentionally conservative list. Words like "service", "system", "process"
 * are excluded because they're meaningful in tech contexts (e.g., "Azure App Service").
 */
const GENERIC_WORDS = new Set([
  // Common nouns that appear everywhere and rarely mean anything specific
  'message', 'messages',
  'file', 'files',
  'info', 'information',
  'item', 'items',
  'list', 'lists',
  'name', 'names',
  'type', 'types',
  'value', 'values',
  'result', 'results',
  'issue', 'issues',
  'problem', 'problems',
  'point', 'points',
  'example', 'examples',
  'case', 'cases',
  'object', 'objects',
  'option', 'options',
  'line', 'lines',
  'text', 'string', 'strings',
  'number', 'numbers',
  'size', 'length',
  'level', 'levels',
  'mode', 'modes',
]);

/**
 * Extract entities that are already linked in content
 * @param content - Content to scan for existing wikilinks
 * @returns Set of linked entity names (lowercase for comparison)
 */
export function extractLinkedEntities(content: string): Set<string> {
  const linked = new Set<string>();
  const wikilinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

  let match;
  while ((match = wikilinkRegex.exec(content)) !== null) {
    linked.add(match[1].toLowerCase());
  }

  return linked;
}

/**
 * Tokenize content into significant words for matching
 * Uses the shared stemmer module for consistent tokenization
 * @param content - Content to tokenize
 * @returns Array of significant words (lowercase, 4+ chars, no stopwords)
 */
function tokenizeContent(content: string): string[] {
  return tokenize(content);
}

/**
 * Tokenize content and compute stems for matching
 * @param content - Content to tokenize
 * @returns Object with tokens set and stems set
 */
function tokenizeForMatching(content: string): {
  tokens: Set<string>;
  stems: Set<string>;
} {
  const tokens = tokenize(content);
  const tokenSet = new Set(tokens);
  const stems = new Set(tokens.map(t => stem(t)));
  return { tokens: tokenSet, stems };
}

/**
 * Maximum entity name length for suggestions
 * Filters out article titles, clippings, and other long names
 */
const MAX_ENTITY_LENGTH = 25;

/**
 * Maximum word count for entity names
 * Concepts are typically 1-3 words; longer names are article titles
 */
const MAX_ENTITY_WORDS = 3;

/**
 * Patterns that indicate an entity is an article title, not a concept
 * Case-insensitive matching
 */
const ARTICLE_PATTERNS = [
  /\bguide\s+to\b/i,
  /\bhow\s+to\b/i,
  /\bcomplete\s+/i,
  /\bultimate\s+/i,
  /\bchecklist\b/i,
  /\bcheatsheet\b/i,
  /\bcheat\s+sheet\b/i,
  /\bbest\s+practices\b/i,
  /\bintroduction\s+to\b/i,
  /\btutorial\b/i,
  /\bworksheet\b/i,
];

/**
 * Check if an entity name looks like an article title rather than a concept
 *
 * Heuristics:
 * - Matches known article patterns ("Guide to", "How to", etc.)
 * - Has more than 3 words (concepts are usually 1-3 words)
 *
 * @param name - Entity name to check
 * @returns true if this looks like an article title
 */
export function isLikelyArticleTitle(name: string): boolean {
  // Check against article patterns
  if (ARTICLE_PATTERNS.some(pattern => pattern.test(name))) {
    return true;
  }

  // Count words (split on whitespace, filter empty)
  const words = name.split(/\s+/).filter(w => w.length > 0);
  if (words.length > MAX_ENTITY_WORDS) {
    return true;
  }

  return false;
}

/**
 * Strictness mode configurations for suggestion scoring
 *
 * Each mode provides different trade-offs between precision and recall:
 * - conservative: High precision, fewer false positives (default)
 * - balanced: Moderate precision, matches v0.7 behavior
 * - aggressive: Maximum recall, may include loose matches
 */
const STRICTNESS_CONFIGS: Record<StrictnessMode, SuggestionConfig> = {
  conservative: {
    minWordLength: 3,
    minSuggestionScore: 15,    // Requires exact match (10) + at least one stem (5)
    minMatchRatio: 0.6,        // 60% of multi-word entity must match
    requireMultipleMatches: true, // Single-word entities need multiple content matches
    stemMatchBonus: 3,         // Lower bonus for stem-only matches
    exactMatchBonus: 10,       // Standard bonus for exact matches
  },
  balanced: {
    minWordLength: 3,
    minSuggestionScore: 8,     // At least one exact match or two stem matches
    minMatchRatio: 0.4,        // 40% of multi-word entity must match
    requireMultipleMatches: false,
    stemMatchBonus: 5,         // Standard bonus for stem matches
    exactMatchBonus: 10,       // Standard bonus for exact matches
  },
  aggressive: {
    minWordLength: 3,
    minSuggestionScore: 5,     // Single stem match is enough
    minMatchRatio: 0.3,        // 30% of multi-word entity must match
    requireMultipleMatches: false,
    stemMatchBonus: 6,         // Higher bonus for stem matches
    exactMatchBonus: 10,       // Standard bonus for exact matches
  },
};

/**
 * Default strictness mode
 */
const DEFAULT_STRICTNESS: StrictnessMode = 'conservative';

/**
 * Type-based score boost per entity category
 *
 * People and projects are typically more useful to link than
 * common technologies (which may over-saturate links).
 */
const TYPE_BOOST: Record<EntityCategory, number> = {
  people: 5,         // Names are high value for connections
  projects: 3,       // Projects provide context
  organizations: 2,  // Companies/teams relevant
  locations: 1,      // Geographic context
  concepts: 1,       // Abstract concepts
  technologies: 0,   // Common, avoid over-suggesting
  acronyms: 0,       // Acronyms may be ambiguous
  other: 0,          // Unknown category
};

/**
 * Cross-folder boost - prioritize cross-cutting connections
 *
 * Entities from different top-level folders are more valuable for
 * building cross-cutting connections in the knowledge graph.
 * A person note linking to a project note is more valuable than
 * project notes linking to other project notes.
 */
const CROSS_FOLDER_BOOST = 3;

/**
 * Hub note boost tiers - prioritize well-connected notes
 *
 * Notes with many backlinks (hub notes) are typically more central
 * to the knowledge graph and more useful to link to.
 *
 * Tiered scoring ensures major hubs (Stretch, Walk, ESGHub with 100+ backlinks)
 * get significantly higher priority than entities with minimal connections.
 */
const HUB_TIERS = [
  { threshold: 100, boost: 8 },  // Major hubs (Stretch, Walk, ESGHub)
  { threshold: 50,  boost: 5 },  // Significant hubs
  { threshold: 20,  boost: 3 },  // Medium hubs
  { threshold: 5,   boost: 1 },  // Small hubs
] as const;

/**
 * Semantic similarity constants for Layer 11
 */
const SEMANTIC_MIN_SIMILARITY = 0.30;
const SEMANTIC_MAX_BOOST = 12;

/**
 * Get cross-folder boost for an entity
 *
 * @param entityPath - Path to the entity note
 * @param notePath - Path to the note being edited
 * @returns Boost value if cross-folder, 0 otherwise
 */
function getCrossFolderBoost(entityPath: string, notePath: string): number {
  if (!entityPath || !notePath) return 0;

  // Get top-level folder for each path
  const entityFolder = entityPath.split('/')[0];
  const noteFolder = notePath.split('/')[0];

  // Boost if folders are different and both are non-empty
  if (entityFolder && noteFolder && entityFolder !== noteFolder) {
    return CROSS_FOLDER_BOOST;
  }

  return 0;
}

/**
 * Get hub score boost for an entity using tiered scoring
 *
 * @param entity - Entity object with optional hubScore
 * @returns Boost value based on backlink count tier (0-8)
 */
function getHubBoost(entity: { hubScore?: number }): number {
  const hubScore = entity.hubScore ?? 0;
  if (hubScore === 0) return 0;

  // Find the highest tier that applies
  for (const tier of HUB_TIERS) {
    if (hubScore >= tier.threshold) {
      return tier.boost;
    }
  }

  return 0;
}

/**
 * Context-aware boost per note type and entity category
 *
 * Boosts entity types that are more relevant to specific note contexts:
 * - Daily notes: people are most relevant (who did I interact with?)
 * - Project notes: projects and technologies are most relevant
 * - Tech docs: technologies and acronyms are most relevant
 */
const CONTEXT_BOOST: Record<NoteContext, Partial<Record<EntityCategory, number>>> = {
  daily: {
    people: 5,       // Daily notes often mention people
    projects: 2,     // Work updates reference projects
  },
  project: {
    projects: 5,     // Project docs reference other projects
    technologies: 2, // Technical dependencies
  },
  tech: {
    technologies: 5, // Tech docs reference technologies
    acronyms: 3,     // Technical acronyms
  },
  general: {},       // No context-specific boost
};

/**
 * Detect note context from path
 *
 * Analyzes path segments to determine note type for context-aware boosting.
 *
 * @param notePath - Path to the note (vault-relative)
 * @returns Detected note context
 */
function getNoteContext(notePath: string): NoteContext {
  const lower = notePath.toLowerCase();

  // Daily notes, journals, logs
  if (
    lower.includes('daily-notes') ||
    lower.includes('daily/') ||
    lower.includes('journal') ||
    lower.includes('logs/') ||
    lower.includes('/log/')
  ) {
    return 'daily';
  }

  // Project and systems documentation
  if (
    lower.includes('projects/') ||
    lower.includes('project/') ||
    lower.includes('systems/') ||
    lower.includes('initiatives/')
  ) {
    return 'project';
  }

  // Technical documentation
  if (
    lower.includes('tech/') ||
    lower.includes('code/') ||
    lower.includes('engineering/') ||
    lower.includes('docs/') ||
    lower.includes('documentation/')
  ) {
    return 'tech';
  }

  return 'general';
}

/**
 * Get adaptive minimum score based on content length
 *
 * Short content (<50 chars) needs lower thresholds to get any suggestions.
 * Long content (>200 chars) should require stronger matches to avoid noise.
 *
 * @param contentLength - Length of content in characters
 * @param baseScore - Base minimum score from strictness config
 * @returns Adjusted minimum score
 */
function getAdaptiveMinScore(contentLength: number, baseScore: number): number {
  if (contentLength < 50) {
    // Short content: lower threshold to allow suggestions
    return Math.max(5, Math.floor(baseScore * 0.6));
  }
  if (contentLength > 200) {
    // Long content: higher threshold for stronger matches
    return Math.floor(baseScore * 1.2);
  }
  // Standard threshold for medium-length content
  return baseScore;
}

// Legacy constants (kept for backward compatibility, use STRICTNESS_CONFIGS instead)
const MIN_SUGGESTION_SCORE = STRICTNESS_CONFIGS.balanced.minSuggestionScore;
const MIN_MATCH_RATIO = STRICTNESS_CONFIGS.balanced.minMatchRatio;

/**
 * Bonus for single-word aliases that exactly match a content token
 * This ensures "production" alias matches "production" in content in conservative mode
 */
const FULL_ALIAS_MATCH_BONUS = 8;

/**
 * Score a name (entity name or alias) against content
 *
 * @param name - Entity name or alias to score
 * @param contentTokens - Set of tokenized content words
 * @param contentStems - Set of stemmed content words
 * @param config - Scoring configuration from strictness mode
 * @returns Object with score, matchedWords, and exactMatches
 */
function scoreNameAgainstContent(
  name: string,
  contentTokens: Set<string>,
  contentStems: Set<string>,
  config: SuggestionConfig
): { score: number; matchedWords: number; exactMatches: number; totalTokens: number } {
  const nameTokens = tokenize(name);
  if (nameTokens.length === 0) {
    return { score: 0, matchedWords: 0, exactMatches: 0, totalTokens: 0 };
  }

  const nameStems = nameTokens.map(t => stem(t));

  let score = 0;
  let matchedWords = 0;
  let exactMatches = 0;

  for (let i = 0; i < nameTokens.length; i++) {
    const token = nameTokens[i];
    const nameStem = nameStems[i];

    if (contentTokens.has(token)) {
      // Exact word match - highest confidence
      score += config.exactMatchBonus;
      matchedWords++;
      exactMatches++;
    } else if (contentStems.has(nameStem)) {
      // Stem match only - medium confidence
      score += config.stemMatchBonus;
      matchedWords++;
    }
  }

  return { score, matchedWords, exactMatches, totalTokens: nameTokens.length };
}

/**
 * Score an entity based on word overlap with content
 *
 * Scoring layers:
 * - Exact match: +exactMatchBonus per word (highest confidence)
 * - Stem match: +stemMatchBonus per word (medium confidence)
 * - Alias matching: Also scores against entity aliases
 *
 * The config determines thresholds and bonuses based on strictness mode.
 *
 * @param entity - Entity object (with name and aliases) or string name
 * @param contentTokens - Set of tokenized content words
 * @param contentStems - Set of stemmed content words
 * @param config - Scoring configuration from strictness mode
 * @returns Score (higher = more relevant), 0 if doesn't meet threshold
 */
function scoreEntity(
  entity: Entity,
  contentTokens: Set<string>,
  contentStems: Set<string>,
  config: SuggestionConfig
): number {
  const entityName = getEntityName(entity);
  const aliases = getEntityAliases(entity);

  // Score the primary name
  const nameResult = scoreNameAgainstContent(entityName, contentTokens, contentStems, config);

  // Score each alias and take the best match
  let bestAliasResult = { score: 0, matchedWords: 0, exactMatches: 0, totalTokens: 0 };
  for (const alias of aliases) {
    const aliasResult = scoreNameAgainstContent(alias, contentTokens, contentStems, config);
    if (aliasResult.score > bestAliasResult.score) {
      bestAliasResult = aliasResult;
    }
  }

  // Use the best score between name and aliases
  const bestResult = nameResult.score >= bestAliasResult.score ? nameResult : bestAliasResult;
  let { score, matchedWords, exactMatches, totalTokens } = bestResult;

  if (totalTokens === 0) return 0;

  // Bonus for single-word aliases that exactly match a content token
  // This ensures "production" alias matches "production" in content in conservative mode
  for (const alias of aliases) {
    const aliasLower = alias.toLowerCase();
    // Single-word alias (4+ chars) that matches a content token exactly
    if (aliasLower.length >= 4 &&
        !/\s/.test(aliasLower) &&
        contentTokens.has(aliasLower)) {
      score += FULL_ALIAS_MATCH_BONUS;
      break;  // Only apply bonus once
    }
  }

  // Multi-word entities need minimum match ratio
  if (totalTokens > 1) {
    const matchRatio = matchedWords / totalTokens;
    if (matchRatio < config.minMatchRatio) {
      return 0;
    }
  }

  // For conservative mode: single-word entities need multiple content word matches
  // This prevents "Complete" matching just because content has "completed"
  if (config.requireMultipleMatches && totalTokens === 1) {
    // Check if the entity word appears multiple times or has strong context
    // For single-word entities, require at least one exact match
    if (exactMatches === 0) {
      return 0;
    }
  }

  return score;
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
    maxSuggestions = 3,
    excludeLinked = true,
    strictness = DEFAULT_STRICTNESS,
    notePath,
    detail = false,
  } = options;

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
  if (!isEntityIndexReady() || !entityIndex) {
    return emptyResult;
  }

  // Get all entities with type information for category-based boosting
  const entitiesWithTypes = getAllEntitiesWithTypes(entityIndex);
  if (entitiesWithTypes.length === 0) {
    return emptyResult;
  }

  // Tokenize content and compute stems for matching
  const { tokens: rawTokens, stems: rawStems } = tokenizeForMatching(content);
  if (rawTokens.size === 0) {
    return emptyResult;
  }

  // Filter content tokens:
  // 1. Enforce minWordLength from strictness config (conservative=5, balanced/aggressive=4)
  // 2. Filter out generic words that cause false positives via co-occurrence
  const contentTokens = new Set<string>();
  const contentStems = new Set<string>();
  for (const token of rawTokens) {
    if (token.length >= config.minWordLength && !GENERIC_WORDS.has(token)) {
      contentTokens.add(token);
      contentStems.add(stem(token));
    }
  }

  // After filtering, check if any meaningful tokens remain
  if (contentTokens.size === 0) {
    return emptyResult;
  }

  // Get already-linked entities
  const linkedEntities = excludeLinked ? extractLinkedEntities(content) : new Set<string>();

  // Load feedback boosts once (Layer 10), with folder context for stratification
  const noteFolder = notePath ? notePath.split('/')[0] : undefined;
  const feedbackBoosts = moduleStateDb ? getAllFeedbackBoosts(moduleStateDb, noteFolder) : new Map<string, number>();

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
  // Track entities that have actual content matches (not just boosts)
  const entitiesWithContentMatch = new Set<string>();

  for (const { entity, category } of entitiesWithTypes) {
    // Get entity name
    const entityName = entity.name;
    if (!entityName) continue;

    // Layer 1a: Length filter - skip article titles, clippings (>25 chars)
    if (entityName.length > MAX_ENTITY_LENGTH) {
      continue;
    }

    // Layer 1b: Article pattern filter - skip "Guide to", "How to", >3 words, etc.
    if (isLikelyArticleTitle(entityName)) {
      continue;
    }

    // Skip if already linked
    if (linkedEntities.has(entityName.toLowerCase())) {
      continue;
    }

    // Layers 2+3: Exact match, stem match, and alias matching (bonuses depend on strictness)
    const contentScore = scoreEntity(entity, contentTokens, contentStems, config);
    let score = contentScore;

    // Track entities with actual content matches
    if (contentScore > 0) {
      entitiesWithContentMatch.add(entityName);
    }

    // Layer 5: Type boost - prioritize people, projects over common technologies
    const layerTypeBoost = TYPE_BOOST[category] || 0;
    score += layerTypeBoost;

    // Layer 6: Context boost - boost types relevant to note context
    const layerContextBoost = contextBoosts[category] || 0;
    score += layerContextBoost;

    // Layer 7: Recency boost - boost recently-mentioned entities
    const layerRecencyBoost = recencyIndex ? getRecencyBoost(entityName, recencyIndex) : 0;
    score += layerRecencyBoost;

    // Layer 8: Cross-folder boost - prioritize cross-cutting connections
    const layerCrossFolderBoost = (notePath && entity.path) ? getCrossFolderBoost(entity.path, notePath) : 0;
    score += layerCrossFolderBoost;

    // Layer 9: Hub score boost - prioritize well-connected notes
    const layerHubBoost = getHubBoost(entity);
    score += layerHubBoost;

    // Layer 10: Feedback boost - adjust based on historical accuracy
    const layerFeedbackAdj = feedbackBoosts.get(entityName) ?? 0;
    score += layerFeedbackAdj;

    if (score > 0) {
      directlyMatchedEntities.add(entityName);
    }

    // Minimum threshold (adaptive based on content length)
    if (score >= adaptiveMinScore) {
      scoredEntities.push({
        name: entityName,
        path: entity.path || '',
        score,
        category,
        breakdown: {
          contentMatch: contentScore,
          cooccurrenceBoost: 0,
          typeBoost: layerTypeBoost,
          contextBoost: layerContextBoost,
          recencyBoost: layerRecencyBoost,
          crossFolderBoost: layerCrossFolderBoost,
          hubBoost: layerHubBoost,
          feedbackAdjustment: layerFeedbackAdj,
        },
      });
    }
  }

  // Layer 4: Add co-occurrence boost for entities related to matched ones
  // This allows entities that didn't match directly but are conceptually related
  // to be suggested
  if (cooccurrenceIndex && directlyMatchedEntities.size > 0) {
    for (const { entity, category } of entitiesWithTypes) {
      const entityName = entity.name;
      if (!entityName) continue;

      // Skip if already scored, already linked, too long, or article-like
      if (entityName.length > MAX_ENTITY_LENGTH) continue;
      if (isLikelyArticleTitle(entityName)) continue;
      if (linkedEntities.has(entityName.toLowerCase())) continue;

      // Get co-occurrence boost (with recency weighting)
      const boost = getCooccurrenceBoost(entityName, directlyMatchedEntities, cooccurrenceIndex, recencyIndex);

      if (boost > 0) {
        // Check if entity is already in scored list (already has content match)
        const existing = scoredEntities.find(e => e.name === entityName);
        if (existing) {
          existing.score += boost;
          existing.breakdown.cooccurrenceBoost += boost;
        } else {
          // NEW: Require minimal content overlap for co-occurrence suggestions
          // Prevents suggesting completely unrelated entities just because they're
          // popular (high hub score) or recent. At least one word must overlap.
          const entityTokens = tokenize(entityName);
          const hasContentOverlap = entityTokens.some(token =>
            contentTokens.has(token) || contentStems.has(stem(token))
          );

          if (!hasContentOverlap) {
            continue;  // Skip entities with zero content relevance
          }

          // Entity passed content overlap check - mark as having content match
          entitiesWithContentMatch.add(entityName);

          // For purely co-occurrence-based suggestions, also add type, context, recency, cross-folder, hub, and feedback boosts
          const typeBoost = TYPE_BOOST[category] || 0;
          const contextBoost = contextBoosts[category] || 0;
          const recencyBoostVal = recencyIndex ? getRecencyBoost(entityName, recencyIndex) : 0;
          const crossFolderBoost = (notePath && entity.path) ? getCrossFolderBoost(entity.path, notePath) : 0;
          const hubBoost = getHubBoost(entity);
          const feedbackAdj = feedbackBoosts.get(entityName) ?? 0;
          const totalBoost = boost + typeBoost + contextBoost + recencyBoostVal + crossFolderBoost + hubBoost + feedbackAdj;
          if (totalBoost >= adaptiveMinScore) {
            // Add entity if boost meets threshold
            scoredEntities.push({
              name: entityName,
              path: entity.path || '',
              score: totalBoost,
              category,
              breakdown: {
                contentMatch: 0,
                cooccurrenceBoost: boost,
                typeBoost,
                contextBoost,
                recencyBoost: recencyBoostVal,
                crossFolderBoost,
                hubBoost,
                feedbackAdjustment: feedbackAdj,
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
  if (content.length >= 20 && hasEntityEmbeddingsIndex()) {
    try {
      const contentEmbedding = await embedTextCached(content);

      // Build sets for already-scored and already-linked entity names
      const alreadyScoredNames = new Set(scoredEntities.map(e => e.name));

      // Strictness multiplier for semantic boost
      const semanticStrictnessMultiplier = strictness === 'conservative' ? 0.6
        : strictness === 'aggressive' ? 1.3
        : 1.0;

      const semanticMatches = findSemanticallySimilarEntities(
        contentEmbedding,
        (maxSuggestions || 3) * 3,
        linkedEntities
      );

      for (const match of semanticMatches) {
        if (match.similarity < SEMANTIC_MIN_SIMILARITY) continue;

        const boost = match.similarity * SEMANTIC_MAX_BOOST * semanticStrictnessMultiplier;

        // Check if entity already has a score
        const existing = scoredEntities.find(e => e.name === match.entityName);
        if (existing) {
          existing.score += boost;
          existing.breakdown.semanticBoost = boost;
        } else if (!linkedEntities.has(match.entityName.toLowerCase())) {
          // NEW entity not in scored list and not already linked
          // Look up the entity in the entity index
          const entityWithType = entitiesWithTypes.find(
            et => et.entity.name === match.entityName
          );
          if (!entityWithType) continue;

          // Skip length/article filters (same as main loop)
          if (match.entityName.length > MAX_ENTITY_LENGTH) continue;
          if (isLikelyArticleTitle(match.entityName)) continue;

          const { entity, category } = entityWithType;

          // Reuse existing layer logic for base boosts
          const layerTypeBoost = TYPE_BOOST[category] || 0;
          const layerContextBoost = contextBoosts[category] || 0;
          const layerHubBoost = getHubBoost(entity);
          const layerCrossFolderBoost = (notePath && entity.path) ? getCrossFolderBoost(entity.path, notePath) : 0;
          const layerFeedbackAdj = feedbackBoosts.get(match.entityName) ?? 0;

          const totalScore = boost + layerTypeBoost + layerContextBoost + layerHubBoost + layerCrossFolderBoost + layerFeedbackAdj;

          if (totalScore >= adaptiveMinScore) {
            scoredEntities.push({
              name: match.entityName,
              path: entity.path || '',
              score: totalScore,
              category,
              breakdown: {
                contentMatch: 0,
                cooccurrenceBoost: 0,
                typeBoost: layerTypeBoost,
                contextBoost: layerContextBoost,
                recencyBoost: 0,
                crossFolderBoost: layerCrossFolderBoost,
                hubBoost: layerHubBoost,
                feedbackAdjustment: layerFeedbackAdj,
                semanticBoost: boost,
              },
            });

            // Add to content match set so it passes the gate below
            entitiesWithContentMatch.add(match.entityName);
          }
        }
      }
    } catch {
      // Semantic scoring failure never breaks suggestions
    }
  }

  // Filter to only entities with actual content matches
  // This prevents popularity-based suggestions (high hub score, recency) for unrelated content
  const relevantEntities = scoredEntities.filter(e =>
    entitiesWithContentMatch.has(e.name)
  );

  // If no content matches at all, return empty rather than popularity-based suggestions
  if (relevantEntities.length === 0) {
    return emptyResult;
  }

  // Sort by score (descending) with recency as tiebreaker
  relevantEntities.sort((a, b) => {
    // Primary: score (descending)
    if (b.score !== a.score) return b.score - a.score;

    // Secondary: recency (more recent first)
    if (recencyIndex) {
      const aRecency = recencyIndex.lastMentioned.get(a.name.toLowerCase()) || 0;
      const bRecency = recencyIndex.lastMentioned.get(b.name.toLowerCase()) || 0;
      return bRecency - aRecency;
    }

    return 0;
  });
  const topEntries = relevantEntities.slice(0, maxSuggestions);
  const topSuggestions = topEntries.map(e => e.name);

  if (topSuggestions.length === 0) {
    return emptyResult;
  }

  // Format suffix: → [[Entity1]], [[Entity2]]
  const suffix = '→ ' + topSuggestions.map(name => `[[${name}]]`).join(', ');

  const result: SuggestResult = {
    suggestions: topSuggestions,
    suffix,
  };

  // Build detailed breakdown when requested
  if (detail) {
    // Load feedback stats for count/accuracy (only when detail requested)
    const feedbackStats = moduleStateDb ? getEntityStats(moduleStateDb) : [];
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

// ========================================
// Note Creation Intelligence
// ========================================

/** Collision between a note name/alias and existing entities */
export interface AliasCollision {
  term: string;
  source: 'name' | 'alias';
  collidedWith: {
    name: string;
    path: string;
    matchType: 'name' | 'alias';
  };
}

/** Smart alias suggestion with reasoning */
export interface AliasSuggestion {
  alias: string;
  reason: string;
}

/** Result of preflight similarity check */
export interface PreflightResult {
  existingEntity?: { name: string; path: string; category: string };
  similarEntities: Array<{ name: string; path: string; category: string; rank: number }>;
}

/**
 * Detect alias collisions for a new note
 *
 * Checks three collision types:
 * 1. Note name matches an existing entity's alias
 * 2. Provided alias matches an existing entity's primary name
 * 3. Provided alias matches another entity's alias
 *
 * @param noteName - Name of the new note
 * @param aliases - Aliases for the new note
 * @returns Array of collisions found
 */
export function detectAliasCollisions(
  noteName: string,
  aliases: string[] = []
): AliasCollision[] {
  if (!moduleStateDb) return [];

  const collisions: AliasCollision[] = [];

  // 1. Note name matches an existing entity's alias
  const nameAsAlias = getEntitiesByAlias(moduleStateDb, noteName);
  for (const entity of nameAsAlias) {
    // Skip self (if this note already exists as an entity)
    if (entity.name.toLowerCase() === noteName.toLowerCase()) continue;
    collisions.push({
      term: noteName,
      source: 'name',
      collidedWith: {
        name: entity.name,
        path: entity.path,
        matchType: 'alias',
      },
    });
  }

  for (const alias of aliases) {
    // 2. Alias matches an existing entity's primary name
    const existingByName = getEntityByName(moduleStateDb, alias);
    if (existingByName && existingByName.name.toLowerCase() !== noteName.toLowerCase()) {
      collisions.push({
        term: alias,
        source: 'alias',
        collidedWith: {
          name: existingByName.name,
          path: existingByName.path,
          matchType: 'name',
        },
      });
    }

    // 3. Alias matches another entity's alias
    const existingByAlias = getEntitiesByAlias(moduleStateDb, alias);
    for (const entity of existingByAlias) {
      // Skip self
      if (entity.name.toLowerCase() === noteName.toLowerCase()) continue;
      // Skip if already reported as name collision
      if (existingByName && existingByName.name.toLowerCase() === entity.name.toLowerCase()) continue;
      collisions.push({
        term: alias,
        source: 'alias',
        collidedWith: {
          name: entity.name,
          path: entity.path,
          matchType: 'alias',
        },
      });
    }
  }

  return collisions;
}

/**
 * Suggest aliases for a new note based on its name and category
 *
 * Category-aware suggestions:
 * - people: First name, last name
 * - technologies/projects: Acronym if 3+ words
 * - any: Unhyphenated form for hyphenated names
 * - any: Acronym for 3+ words
 *
 * Each suggestion is checked against existing entity names to avoid creating new collisions.
 *
 * @param noteName - Name of the new note
 * @param existingAliases - Aliases already provided (to avoid duplicates)
 * @param category - Optional category hint for smarter suggestions
 * @returns Array of alias suggestions with reasoning
 */
export function suggestAliases(
  noteName: string,
  existingAliases: string[] = [],
  category?: string
): AliasSuggestion[] {
  const suggestions: AliasSuggestion[] = [];
  const existingLower = new Set(existingAliases.map(a => a.toLowerCase()));
  const words = noteName.split(/\s+/).filter(w => w.length > 0);

  // Helper: check if alias is safe (not already an entity name, not already provided)
  function isSafe(alias: string): boolean {
    if (existingLower.has(alias.toLowerCase())) return false;
    if (alias.toLowerCase() === noteName.toLowerCase()) return false;
    if (!moduleStateDb) return true;
    const existing = getEntityByName(moduleStateDb, alias);
    return !existing;
  }

  // Infer category from path or name if not provided
  const inferredCategory = category || inferCategoryFromName(noteName);

  // People: suggest first name and last name
  if (inferredCategory === 'people' && words.length >= 2) {
    const firstName = words[0];
    const lastName = words[words.length - 1];
    if (firstName.length >= 2 && isSafe(firstName)) {
      suggestions.push({ alias: firstName, reason: 'First name for quick reference' });
    }
    if (lastName.length >= 2 && lastName !== firstName && isSafe(lastName)) {
      suggestions.push({ alias: lastName, reason: 'Last name for quick reference' });
    }
  }

  // Acronym for 3+ word names
  if (words.length >= 3) {
    const acronym = words
      .map(w => w[0])
      .join('')
      .toUpperCase();
    if (acronym.length >= 3 && isSafe(acronym)) {
      suggestions.push({ alias: acronym, reason: `Acronym for "${noteName}"` });
    }
  }

  // Unhyphenated form for hyphenated names
  if (noteName.includes('-')) {
    const unhyphenated = noteName.replace(/-/g, '');
    if (unhyphenated !== noteName && isSafe(unhyphenated)) {
      suggestions.push({ alias: unhyphenated, reason: 'Unhyphenated form' });
    }
    // Also try space-separated form
    const spaced = noteName.replace(/-/g, ' ');
    if (spaced !== noteName && isSafe(spaced)) {
      suggestions.push({ alias: spaced, reason: 'Space-separated form' });
    }
  }

  return suggestions;
}

/**
 * Infer entity category from note name heuristics
 */
function inferCategoryFromName(name: string): string | undefined {
  const words = name.split(/\s+/);

  // People: Two capitalized words (First Last pattern)
  if (words.length === 2 || words.length === 3) {
    const allCapitalized = words.every(w => /^[A-Z][a-z]/.test(w));
    if (allCapitalized) return 'people';
  }

  return undefined;
}

/**
 * Check for similar or duplicate entities before creating a note
 *
 * Checks:
 * 1. Exact name match: Does an entity with this name already exist?
 * 2. FTS5 search: Find entities with similar names
 * 3. Semantic similarity: Find conceptually similar entities via embeddings
 *
 * @param noteName - Name of the note to check
 * @returns Preflight result with existing/similar entities
 */
export async function checkPreflightSimilarity(noteName: string): Promise<PreflightResult> {
  const result: PreflightResult = { similarEntities: [] };

  if (!moduleStateDb) return result;

  // 1. Exact name match
  const exact = getEntityByName(moduleStateDb, noteName);
  if (exact) {
    result.existingEntity = {
      name: exact.name,
      path: exact.path,
      category: exact.category,
    };
  }

  // 2. FTS5 search for similar entities
  const ftsNames = new Set<string>();
  try {
    const searchResults = searchEntitiesDb(moduleStateDb, noteName, 5);
    for (const sr of searchResults) {
      // Skip exact match (already reported above)
      if (sr.name.toLowerCase() === noteName.toLowerCase()) continue;
      ftsNames.add(sr.name.toLowerCase());
      result.similarEntities.push({
        name: sr.name,
        path: sr.path,
        category: sr.category,
        rank: sr.rank,
      });
    }
  } catch {
    // FTS5 query may fail on special characters - that's fine
  }

  // 3. Semantic similarity check via entity embeddings
  try {
    if (hasEntityEmbeddingsIndex()) {
      const titleEmbedding = await embedTextCached(noteName);
      const semanticMatches = findSemanticallySimilarEntities(titleEmbedding, 5);

      for (const match of semanticMatches) {
        // Only surface high-confidence semantic duplicates
        if (match.similarity < 0.85) continue;
        // Skip if already found by exact match or FTS5
        if (match.entityName.toLowerCase() === noteName.toLowerCase()) continue;
        if (ftsNames.has(match.entityName.toLowerCase())) continue;

        // Look up entity details from StateDb
        const entity = getEntityByName(moduleStateDb!, match.entityName);
        if (entity) {
          result.similarEntities.push({
            name: entity.name,
            path: entity.path,
            category: entity.category,
            rank: match.similarity,
          });
        }
      }
    }
  } catch {
    // Semantic check failure never blocks note creation
  }

  return result;
}
