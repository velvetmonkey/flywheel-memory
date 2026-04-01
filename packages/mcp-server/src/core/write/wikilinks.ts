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
  detectImplicitEntities,
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
  STOPWORDS_EN,
  IMPLICIT_EXCLUDE_WORDS,
  COMMON_ENGLISH_WORDS,
} from '@velvetmonkey/vault-core';
import { isSuppressed, getAllFeedbackBoosts, getAllSuppressionPenalties, getEntityStats, trackWikilinkApplications } from './wikilinkFeedback.js';
import { getCorrectedEntityNotePairs } from './corrections.js';
import { setGitStateDb } from './git.js';
import { setHintsStateDb } from './hints.js';
import { setRecencyStateDb } from '../shared/recency.js';
import path from 'path';
import * as fs from 'fs/promises';
import type { FlywheelConfig } from '../read/config.js';
import type { SuggestOptions, SuggestResult, SuggestionConfig, StrictnessMode, NoteContext, ScoreBreakdown, ScoredSuggestion, ConfidenceLevel, ScoringLayer } from './types.js';
import { stem, tokenize } from '../shared/stemmer.js';
import { getProspectBoostMap } from '../shared/prospects.js';
import {
  mineCooccurrences,
  getCooccurrenceBoost,
  tokenIdf,
  entityRarity,
  serializeCooccurrenceIndex,
  deserializeCooccurrenceIndex,
  type CooccurrenceIndex,
} from '../shared/cooccurrence.js';
import { buildRetrievalBoostMap, getRetrievalBoost } from '../shared/retrievalCooccurrence.js';
import {
  buildRecencyIndex,
  getRecencyBoost,
  loadRecencyFromStateDb,
  saveRecencyToStateDb,
  type RecencyIndex,
} from '../shared/recency.js';
import {
  embedTextCached,
  findSemanticallySimilarEntities,
  getInferredCategory,
  hasEntityEmbeddingsIndex,
} from '../read/embeddings.js';
import { getEntityEdgeWeightMap } from './edgeWeights.js';
import { scoreFuzzyMatch, buildCollapsedContentTerms, normalizeFuzzyTerm } from '../shared/levenshtein.js';
import { getActiveScopeOrNull } from '../../vault-scope.js';

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
 * Get the StateDb instance (for use by other modules like mutation-helpers).
 * Checks ALS scope first for per-request isolation.
 */
export function getWriteStateDb(): StateDb | null {
  return getActiveScopeOrNull()?.stateDb ?? moduleStateDb;
}

/**
 * Module-level FlywheelConfig reference for wikilink behavior
 */
let moduleConfig: FlywheelConfig | null = null;

const ALL_IMPLICIT_PATTERNS = ['proper-nouns', 'single-caps', 'camel-case', 'acronyms', 'quoted-terms', 'ticket-refs'] as const;

/** Set the FlywheelConfig for wikilink behavior (called at startup and on config change) */
export function setWikilinkConfig(config: FlywheelConfig): void {
  moduleConfig = config;
}

/** Get the effective config (VaultScope if available, else module-level) */
function getConfig(): FlywheelConfig | null {
  const scope = getActiveScopeOrNull();
  return scope ? scope.flywheelConfig : moduleConfig;
}

/** Get the configured strictness mode (reads from VaultScope if available) */
export function getWikilinkStrictness(): StrictnessMode {
  return getConfig()?.wikilink_strictness ?? 'balanced';
}

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

/** Get the co-occurrence index (reads from VaultScope if available) */
export function getCooccurrenceIndex(): CooccurrenceIndex | null {
  const scope = getActiveScopeOrNull();
  return scope ? scope.cooccurrenceIndex : cooccurrenceIndex;
}

/**
 * Set the co-occurrence index (called by watcher to inject rebuilt index).
 * Follows established pattern from setWriteStateDb, setRecencyStateDb, etc.
 */
export function setCooccurrenceIndex(index: CooccurrenceIndex | null): void {
  cooccurrenceIndex = index;
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
    const stateDb = getWriteStateDb();
    if (stateDb) {
      try {
        const dbIndex = getEntityIndexFromDb(stateDb);
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
    customCategories: getConfig()?.custom_categories,
  });

  indexReady = true;
  lastLoadedAt = Date.now();
  const entityDuration = Date.now() - startTime;
  console.error(`[Flywheel] Entity index built: ${entityIndex._metadata.total_entities} entities in ${entityDuration}ms`);

  // Save to StateDb for fast subsequent loads
  const stateDb = getWriteStateDb();
  if (stateDb) {
    try {
      stateDb.replaceAllEntities(entityIndex);
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
  const stateDb = getWriteStateDb();
  if (!stateDb || !indexReady) return;

  try {
    const metadata = getStateDbMetadata(stateDb);
    if (!metadata.entitiesBuiltAt) return;

    const dbBuiltAt = new Date(metadata.entitiesBuiltAt).getTime();

    // If StateDb was updated after we loaded, refresh
    if (dbBuiltAt > lastLoadedAt) {
      console.error('[Flywheel] Entity index stale, reloading from StateDb...');
      const dbIndex = getEntityIndexFromDb(stateDb);
      if (dbIndex._metadata.total_entities > 0) {
        entityIndex = dbIndex;
        lastLoadedAt = Date.now();
        console.error(`[Flywheel] Reloaded ${dbIndex._metadata.total_entities} entities`);
      }
    }

    // Always refresh recency from StateDb (watcher updates it independently of entities)
    const freshRecency = loadRecencyFromStateDb();
    if (freshRecency && freshRecency.lastUpdated > (recencyIndex?.lastUpdated ?? 0)) {
      recencyIndex = freshRecency;
      console.error(`[Flywheel] Refreshed recency index (${freshRecency.lastMentioned.size} entities)`);
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
 * Check if a wikilink's inner text looks like a valid entity name.
 * Returns false for prose phrases, punctuation-laden text, questions, etc.
 */
export function isValidWikilinkText(text: string): boolean {
  // Strip alias display text: [[target|display]] → check target
  const target = text.includes('|') ? text.split('|')[0] : text;

  // Starts or ends with whitespace
  if (target !== target.trim()) return false;

  const trimmed = target.trim();
  if (trimmed.length === 0) return false;

  // Contains newline — wikilinks must be single-line
  if (/\n/.test(trimmed)) return false;

  // Contains question mark, exclamation, or semicolon — not an entity name
  if (/[?!;]/.test(trimmed)) return false;

  // Ends with comma or period
  if (/[,.]$/.test(trimmed)) return false;

  // Contains blockquote character
  if (trimmed.includes('>')) return false;

  // Starts with markdown syntax (* # - for list items, headings, emphasis)
  if (/^[*#\-]/.test(trimmed)) return false;

  // Too long for an entity name (>60 chars)
  if (trimmed.length > 60) return false;

  // Too many words (>5 words)
  const words = trimmed.split(/\s+/);
  if (words.length > 5) return false;

  // All lowercase with >3 words — prose phrase, not entity
  if (words.length > 3 && trimmed === trimmed.toLowerCase()) return false;

  // Contains contraction pattern (apostrophe in a word) with >2 words — conversational phrase
  if (words.length > 2 && /\w'\w/.test(trimmed)) return false;

  // Ends with common verb suffixes suggesting a phrase, not a name (>3 words)
  if (words.length > 3 && /(?:ing|tion|ment|ness|ould|ould|ight)$/i.test(words[words.length - 1])) return false;

  return true;
}

/**
 * Sanitize wikilinks in content — unwrap (remove [[ ]]) any wikilinks
 * that don't look like valid entity names. Catches bad links from both
 * LLM-generated content and implicit entity detection.
 */
export function sanitizeWikilinks(content: string): { content: string; removed: string[] } {
  const removed: string[] = [];

  // Repair broken bracket pairs split by whitespace/newlines: [\n[ → [[  and ]\n] → ]]
  let repaired = content.replace(/\[\s*\n\s*\[/g, '[[');
  repaired = repaired.replace(/\]\s*\n\s*\]/g, ']]');

  // Match all wikilinks: [[text]] or [[target|display]]
  const sanitized = repaired.replace(/\[\[([^\]]+?)\]\]/g, (fullMatch, inner: string) => {
    if (isValidWikilinkText(inner)) {
      return fullMatch; // Keep valid wikilinks
    }
    removed.push(inner);
    // Unwrap: return the display text (or target if no alias)
    const display = inner.includes('|') ? inner.split('|')[1] : inner;
    return display;
  });

  return { content: sanitized, removed };
}

/**
 * Process content through wikilink application
 *
 * Three-step processing:
 * 1. Resolve existing wikilinks that use aliases (e.g., [[model context protocol]] → [[MCP|model context protocol]])
 * 2. Apply wikilinks to plain text (normal auto-wikilink processing)
 * 3. Sanitize all wikilinks — strip invalid ones (punctuation, prose phrases, broken fragments)
 *
 * @param content - Content to process
 * @param notePath - Optional path to the note for priority sorting
 * @returns Content with wikilinks applied, or original if index not ready
 */
export function processWikilinks(content: string, notePath?: string, existingContent?: string): WikilinkResult {
  if (!isEntityIndexReady() || !entityIndex) {
    return {
      content,
      linksAdded: 0,
      linkedEntities: [],
    };
  }

  let entities = getAllEntities(entityIndex);

  // Filter out suppressed entities (from wikilink feedback, with folder context)
  const stateDb = getWriteStateDb();
  if (stateDb) {
    const folder = notePath ? notePath.split('/')[0] : undefined;
    entities = entities.filter(e => {
      const name = getEntityName(e);
      return !isSuppressed(stateDb, name, folder);
    });
  }

  // Filter out entities with wrong_link corrections for this specific note
  if (stateDb && notePath) {
    const correctedPairs = getCorrectedEntityNotePairs(stateDb);
    entities = entities.filter(e => {
      const name = getEntityName(e).toLowerCase();
      const paths = correctedPairs.get(name);
      return !paths || !paths.has(notePath);
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
  // Pass entities resolved by Step 1 as alreadyLinked so firstOccurrenceOnly
  // treats them as already seen and won't link a second occurrence.
  const step1LinkedEntities = new Set(resolved.linkedEntities.map(e => e.toLowerCase()));

  // Also treat entities already linked in the existing note content as already seen.
  // This prevents duplicate wikilinks when vault_add_to_section is called multiple
  // times on the same note — each call independently applies wikilinks, so without
  // this guard the same entity ends up linked in every section it appears in.
  // Exception: daily/periodic notes — each entry is independent and should have its own links.
  const noteContext = notePath ? getNoteContext(notePath) : 'general';
  if (existingContent && noteContext !== 'daily') {
    // Strip suggestion suffixes (→ [[Entity1]], [[Entity2]]) before scanning
    // — suggestions are metadata, not body links, and shouldn't prevent future linking
    const cleanedExisting = existingContent.replace(/ → \[\[.*$/gm, '');
    for (const match of cleanedExisting.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g)) {
      step1LinkedEntities.add(match[1].toLowerCase());
    }
  }

  const result = applyWikilinks(resolved.content, sortedEntities, {
    firstOccurrenceOnly: true,
    caseInsensitive: true,
    alreadyLinked: step1LinkedEntities,
  });

  // Step 3: Detect implicit entities (dead wikilinks for unrecognized proper nouns, camelCase, acronyms)
  // Disable implicit detection on prose-heavy content (>500 words) — too many false positives.
  // Known entities (Step 2) are still linked; only speculative pattern-based detection is suppressed.
  const wordCount = content.split(/\s+/).length;
  const cfg = getConfig();
  const implicitEnabled = cfg?.implicit_detection !== false && wordCount <= 500;
  const validPatterns = new Set<string>(ALL_IMPLICIT_PATTERNS);
  const implicitPatterns = cfg?.implicit_patterns?.length
    ? cfg.implicit_patterns.filter(p => validPatterns.has(p)) as Array<typeof ALL_IMPLICIT_PATTERNS[number]>
    : [...ALL_IMPLICIT_PATTERNS];
  const implicitMatches = detectImplicitEntities(result.content, {
    detectImplicit: implicitEnabled,
    implicitPatterns,
    minEntityLength: 3,
  });

  // Filter: skip terms already linked or matching known entity names
  const alreadyLinked = new Set(
    [...resolved.linkedEntities, ...result.linkedEntities].map(e => e.toLowerCase())
  );
  for (const entity of sortedEntities) {
    const name = getEntityName(entity);
    alreadyLinked.add(name.toLowerCase());
    // Also exclude aliases
    const aliases = getEntityAliases(entity);
    for (const alias of aliases) {
      alreadyLinked.add(alias.toLowerCase());
    }
  }

  // Self-link avoidance
  const currentNoteName = notePath
    ? notePath.replace(/\.md$/, '').split('/').pop()?.toLowerCase()
    : null;

  let newImplicits = implicitMatches.filter(m => {
    const normalized = m.text.toLowerCase();
    if (alreadyLinked.has(normalized)) return false;
    if (currentNoteName && normalized === currentNoteName) return false;
    return true;
  });

  // Filter overlapping matches (defense-in-depth)
  const nonOverlapping: typeof newImplicits = [];
  for (const match of newImplicits) {
    const overlaps = nonOverlapping.some(
      existing =>
        (match.start >= existing.start && match.start < existing.end) ||
        (match.end > existing.start && match.end <= existing.end) ||
        (match.start <= existing.start && match.end >= existing.end)
    );
    if (!overlaps) {
      nonOverlapping.push(match);
    }
  }
  newImplicits = nonOverlapping;

  let finalContent = result.content;
  let implicitEntities: string[] | undefined;

  if (newImplicits.length > 0) {
    // Apply in reverse order to preserve positions
    for (let i = newImplicits.length - 1; i >= 0; i--) {
      const m = newImplicits[i];
      finalContent = finalContent.slice(0, m.start) + `[[${m.text}]]` + finalContent.slice(m.end);
    }
    implicitEntities = newImplicits.map(m => m.text);
  }

  // Step 3: Sanitize all wikilinks — remove invalid ones (punctuation, prose phrases, broken fragments)
  const { content: sanitizedContent, removed } = sanitizeWikilinks(finalContent);

  const totalLinksAdded = resolved.linksAdded + result.linksAdded + (newImplicits.length - removed.length);

  return {
    content: sanitizedContent,
    linksAdded: Math.max(0, totalLinksAdded),
    linkedEntities: [...resolved.linkedEntities, ...result.linkedEntities],
    ...(implicitEntities ? { implicitEntities } : {}),
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
  notePath?: string,
  existingContent?: string,
): { content: string; wikilinkInfo?: string } {
  if (skipWikilinks) {
    return { content };
  }

  // Check if Flywheel updated entities since we loaded
  checkAndRefreshIfStale();

  const result = processWikilinks(content, notePath, existingContent);

  if (result.linksAdded > 0) {
    // Track applications for implicit feedback detection
    const stateDb = getWriteStateDb();
    if (stateDb && notePath) {
      trackWikilinkApplications(stateDb, notePath, result.linkedEntities);
    }

    const implicitCount = result.implicitEntities?.length ?? 0;
    const implicitInfo = implicitCount > 0
      ? ` + ${implicitCount} implicit: ${result.implicitEntities!.join(', ')}`
      : '';
    return {
      content: result.content,
      wikilinkInfo: `Applied ${result.linksAdded} wikilink(s): ${result.linkedEntities.join(', ')}${implicitInfo}`,
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
      animals: entityIndex.animals?.length ?? 0,
      media: entityIndex.media?.length ?? 0,
      events: entityIndex.events?.length ?? 0,
      documents: entityIndex.documents?.length ?? 0,
      vehicles: entityIndex.vehicles?.length ?? 0,
      health: entityIndex.health?.length ?? 0,
      finance: entityIndex.finance?.length ?? 0,
      food: entityIndex.food?.length ?? 0,
      hobbies: entityIndex.hobbies?.length ?? 0,
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
    minSuggestionScore: 18,    // Requires exact match (10) + stem (5) + at least one boost
    minMatchRatio: 0.6,        // 60% of multi-word entity must match
    requireMultipleMatches: true, // Single-word entities need multiple content matches
    stemMatchBonus: 3,         // Lower bonus for stem-only matches
    exactMatchBonus: 10,       // Standard bonus for exact matches
    fuzzyMatchBonus: 2,        // Low fuzzy bonus — supplementary signal only
    contentRelevanceFloor: 5,
    noRelevanceCap: 12,
    minCooccurrenceGate: 6,
    minContentMatch: 3,
  },
  balanced: {
    minWordLength: 3,
    minSuggestionScore: 10,    // Exact match (10) or two stem matches
    minMatchRatio: 0.4,        // 40% of multi-word entity must match
    requireMultipleMatches: false,
    stemMatchBonus: 5,         // Standard bonus for stem matches
    exactMatchBonus: 10,       // Standard bonus for exact matches
    fuzzyMatchBonus: 4,        // Moderate fuzzy bonus
    contentRelevanceFloor: 5,
    noRelevanceCap: 10,
    minCooccurrenceGate: 5,
    minContentMatch: 2,
  },
  aggressive: {
    minWordLength: 3,
    minSuggestionScore: 5,     // Single stem match is enough
    minMatchRatio: 0.3,        // 30% of multi-word entity must match
    requireMultipleMatches: false,
    stemMatchBonus: 6,         // Higher bonus for stem matches
    exactMatchBonus: 10,       // Standard bonus for exact matches
    fuzzyMatchBonus: 5,        // Higher fuzzy bonus — discovery mode
    contentRelevanceFloor: 3,
    noRelevanceCap: 18,
    minCooccurrenceGate: 3,
    minContentMatch: 0,
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
const TYPE_BOOST: Record<string, number> = {
  people: 5,         // Names are high value for connections
  animals: 3,        // Pets and animals are personal and specific
  projects: 3,       // Projects provide context
  organizations: 2,  // Companies/teams relevant
  events: 2,         // Meetings, trips, milestones
  media: 2,          // Movies, books, shows
  health: 2,         // Medical, fitness — personal relevance
  vehicles: 2,       // Cars, bikes — specific items
  locations: 1,      // Geographic context
  concepts: 1,       // Abstract concepts
  documents: 1,      // Reports, guides
  food: 1,           // Recipes, restaurants
  hobbies: 1,        // Crafts, sports
  finance: 2,        // Accounts, budgets
  periodical: 1,     // Daily/weekly/monthly notes — low boost
  technologies: 0,   // Common, avoid over-suggesting
  acronyms: 0,       // Acronyms may be ambiguous
  other: 0,          // Unknown category
};

/** Get type boost for a category, checking custom config overrides first */
function getTypeBoost(
  category: string,
  customCategories?: Record<string, { type_boost?: number }>,
  entityName?: string,
): number {
  if (customCategories?.[category]?.type_boost != null) {
    return customCategories[category].type_boost!;
  }
  if (category === 'other' && entityName) {
    const inferred = getInferredCategory(entityName);
    if (inferred) {
      return TYPE_BOOST[inferred.category] || 0;
    }
  }
  return TYPE_BOOST[category] || 0;
}

function isCommonWordFalsePositive(
  entityName: string,
  rawContent: string,
  category: string,
): boolean {
  const nameTokens = tokenize(entityName);
  if (nameTokens.length !== 1) return false;

  const EXEMPT_CATEGORIES = new Set(['people', 'animals', 'projects', 'organizations']);
  if (EXEMPT_CATEGORIES.has(category)) return false;

  const lowerName = entityName.toLowerCase();
  if (!IMPLICIT_EXCLUDE_WORDS.has(lowerName) && !COMMON_ENGLISH_WORDS.has(lowerName)) return false;

  return !rawContent.includes(entityName);
}

function capScoreWithoutContentRelevance(
  score: number,
  contentRelevance: number,
  config: SuggestionConfig,
): number {
  if (contentRelevance < config.contentRelevanceFloor) {
    return Math.min(score, config.noRelevanceCap);
  }
  return score;
}

/**
 * Cross-folder boost - prioritize cross-cutting connections
 *
 * Entities from different top-level folders are more valuable for
 * building cross-cutting connections in the knowledge graph.
 * A person note linking to a project note is more valuable than
 * project notes linking to other project notes.
 */
/**
 * Generic folders that shouldn't penalize cross-folder suggestions
 * (these folders contain notes that naturally reference all domains)
 */
const GENERIC_FOLDERS = new Set(['daily-notes', 'weekly-notes', 'clippings', 'templates', 'new']);

/**
 * Hub note boost - logarithmic scaling
 *
 * Notes with many backlinks (hub notes) are more central to the knowledge graph,
 * but tiered scoring gave mega-hubs (hubScore 100+) the same +8 as hubScore 700,
 * letting ~6 entities dominate 60-90% of all suffix lines regardless of content.
 *
 * Log₂ scaling gives a smooth curve: 5→1.4, 20→2.6, 50→3.4, 100→4.0, 200→4.6, 700→5.7
 * Capped at 6 (down from 8). The gap between hub=100 and hub=700 is now 1.7 instead of 0.
 */

/**
 * Semantic similarity constants for Layer 11
 */
const SEMANTIC_MIN_SIMILARITY = 0.30;
const SEMANTIC_MAX_BOOST = 12;

/**
 * Get domain affinity boost/penalty for an entity relative to the current note.
 *
 * Replaces the old flat CROSS_FOLDER_BOOST=3 with bidirectional scoring:
 * - Same top-level folder: +2 (same domain, encouraged)
 * - Same second-level folder: +3 (strong same-domain)
 * - Cross-folder from generic folders: 0 (neutral)
 * - Cross-folder into daily notes: -1 (daily notes are inherently cross-domain)
 * - Cross-folder, other: -3 (cross-domain penalty)
 */
function getCrossFolderBoost(entityPath: string, notePath: string): number {
  if (!entityPath || !notePath) return 0;

  const entityParts = entityPath.split('/');
  const noteParts = notePath.split('/');
  const entityFolder = entityParts[0];
  const noteFolder = noteParts[0];

  if (!entityFolder || !noteFolder) return 0;

  // Same top-level folder
  if (entityFolder === noteFolder) {
    // Same second-level folder = strong affinity
    if (entityParts[1] && noteParts[1] && entityParts[1] === noteParts[1]) {
      return 3;
    }
    return 2;
  }

  // Cross-folder: entity comes from a generic folder (neutral)
  if (GENERIC_FOLDERS.has(entityFolder)) return 0;

  // Cross-folder: target is a daily note (mild penalty — daily notes are cross-domain by nature)
  if (GENERIC_FOLDERS.has(noteFolder)) return -1;

  // Cross-folder: different domains (penalty)
  return -3;
}

/**
 * Get hub score boost for an entity using logarithmic scaling
 *
 * @param entity - Entity object with optional hubScore
 * @returns Boost value based on log₂(hubScore), capped at 6
 */
function getHubBoost(entity: { hubScore?: number }): number {
  const hubScore = entity.hubScore ?? 0;
  if (hubScore <= 0) return 0;

  // Dampened log scaling: 5→0.8, 20→1.6, 50→2.1, 100→2.4, 200→2.8, 700→3.4
  // Max cap 4 (down from 6). Slope factor 0.6 prevents mega-hubs from dominating.
  return Math.min(Math.round(Math.log2(hubScore) * 6) / 10, 4);
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
    animals: 3,      // Pets in daily life
    events: 3,       // Daily events and meetings
    projects: 2,     // Work updates reference projects
    food: 2,         // Meals and recipes in daily logs
    health: 2,       // Fitness and wellness tracking
  },
  project: {
    projects: 5,     // Project docs reference other projects
    technologies: 2, // Technical dependencies
    documents: 2,    // Reference documents
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
export function getNoteContext(notePath: string): NoteContext {
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
  if (contentLength > 200 && baseScore > 5) {
    // Long content: tighten threshold for conservative/balanced only
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
 * When coocIndex is provided, weights each token's contribution by its IDF
 * (Inverse Document Frequency). Informative tokens like "hackathon" contribute
 * more than common tokens like "spring". Without coocIndex, all tokens contribute
 * equally (IDF weight = 1.0).
 *
 * @param name - Entity name or alias to score
 * @param contentTokens - Set of tokenized content words
 * @param contentStems - Set of stemmed content words
 * @param config - Scoring configuration from strictness mode
 * @param coocIndex - Optional co-occurrence index for IDF weighting
 * @returns Object with score, matchedWords, and exactMatches
 */
interface LexicalScoreResult {
  exactScore: number;
  stemScore: number;
  lexicalScore: number;
  matchedWords: number;
  exactMatches: number;
  totalTokens: number;
  nameTokens: string[];
  unmatchedTokenIndices: number[];
}

function scoreNameAgainstContent(
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
    return { exactScore: 0, stemScore: 0, lexicalScore: 0, matchedWords: 0, exactMatches: 0, totalTokens: 0, nameTokens: [], unmatchedTokenIndices: [] };
  }

  const nameStems = nameTokens.map(t => stem(t));

  let exactScore = 0;
  let stemScore = 0;
  let matchedWords = 0;
  let exactMatches = 0;
  const unmatchedTokenIndices: number[] = [];

  for (let i = 0; i < nameTokens.length; i++) {
    const token = nameTokens[i];
    const nameStem = nameStems[i];

    // IDF weight: informative tokens contribute more than common ones
    const idfWeight = coocIndex ? tokenIdf(token, coocIndex) : 1.0;

    if (!disableExact && contentTokens.has(token)) {
      // Exact word match - highest confidence, IDF-weighted
      exactScore += config.exactMatchBonus * idfWeight;
      matchedWords++;
      exactMatches++;
    } else if (!disableStem && contentStems.has(nameStem)) {
      // Stem match only - medium confidence, IDF-weighted
      stemScore += config.stemMatchBonus * idfWeight;
      matchedWords++;
    } else {
      unmatchedTokenIndices.push(i);
    }
  }

  const lexicalScore = Math.round((exactScore + stemScore) * 10) / 10;

  return { exactScore, stemScore, lexicalScore, matchedWords, exactMatches, totalTokens: nameTokens.length, nameTokens, unmatchedTokenIndices };
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
interface EntityScoreResult {
  contentMatch: number;  // exact + stem only
  fuzzyMatch: number;    // fuzzy layer only
  totalLexical: number;  // contentMatch + fuzzyMatch
  matchedWords: number;
  exactMatches: number;
  totalTokens: number;
}

function scoreEntity(
  entity: Entity,
  contentTokens: Set<string>,
  contentStems: Set<string>,
  collapsedContentTerms: Set<string>,
  config: SuggestionConfig,
  disabled: Set<ScoringLayer>,
  coocIndex?: CooccurrenceIndex | null,
  tokenFuzzyCache?: Map<string, number>,
): EntityScoreResult {
  const zero: EntityScoreResult = { contentMatch: 0, fuzzyMatch: 0, totalLexical: 0, matchedWords: 0, exactMatches: 0, totalTokens: 0 };
  const entityName = getEntityName(entity);
  const aliases = getEntityAliases(entity);
  const disableExact = disabled.has('exact_match');
  const disableStem = disabled.has('stem_match');
  const disableFuzzy = disabled.has('fuzzy_match');

  const cache = tokenFuzzyCache ?? new Map<string, number>();
  const idfFn = (token: string) => coocIndex ? tokenIdf(token, coocIndex) : 1.0;

  // Score the primary name (exact + stem)
  const nameResult = scoreNameAgainstContent(entityName, contentTokens, contentStems, config, coocIndex, disableExact, disableStem);

  // Score each alias and take the best match
  let bestAliasResult: LexicalScoreResult = { exactScore: 0, stemScore: 0, lexicalScore: 0, matchedWords: 0, exactMatches: 0, totalTokens: 0, nameTokens: [], unmatchedTokenIndices: [] };
  for (const alias of aliases) {
    const aliasResult = scoreNameAgainstContent(alias, contentTokens, contentStems, config, coocIndex, disableExact, disableStem);
    if (aliasResult.lexicalScore > bestAliasResult.lexicalScore) {
      bestAliasResult = aliasResult;
    }
  }

  // Use the best score between name and aliases
  const bestResult = nameResult.lexicalScore >= bestAliasResult.lexicalScore ? nameResult : bestAliasResult;
  let { lexicalScore, matchedWords, exactMatches, totalTokens, nameTokens, unmatchedTokenIndices } = bestResult;
  // Use name for whole-term fuzzy (entity name, not alias — the alias may be short)
  const fuzzyTargetName = nameResult.lexicalScore >= bestAliasResult.lexicalScore ? entityName : (aliases[0] ?? entityName);

  if (totalTokens === 0) return zero;

  // Bonus for single-word aliases that exactly match a content token
  if (!disableExact) {
    for (const alias of aliases) {
      const aliasLower = alias.toLowerCase();
      if (aliasLower.length >= 3 &&
          !/\s/.test(aliasLower) &&
          contentTokens.has(aliasLower)) {
        lexicalScore += FULL_ALIAS_MATCH_BONUS;
        break;
      }
    }
  }

  // Fuzzy matching (Layer 3.5) — only for unmatched tokens
  let fuzzyScore = 0;
  let fuzzyMatchedWords = 0;
  if (!disableFuzzy && unmatchedTokenIndices.length > 0) {
    const fuzzyResult = scoreFuzzyMatch(
      nameTokens, unmatchedTokenIndices, contentTokens, collapsedContentTerms,
      fuzzyTargetName, config.fuzzyMatchBonus, idfFn, cache,
    );
    fuzzyScore = fuzzyResult.fuzzyScore;
    fuzzyMatchedWords = fuzzyResult.fuzzyMatchedWords;
    if (fuzzyResult.isWholeTermMatch) {
      // Whole-term match: count all tokens as matched for ratio check
      matchedWords = totalTokens;
    } else {
      matchedWords += fuzzyMatchedWords;
    }
  }

  // Multi-word entities need minimum match ratio
  if (totalTokens > 1) {
    const matchRatio = matchedWords / totalTokens;
    if (matchRatio < config.minMatchRatio) {
      return zero;
    }
  }

  // For conservative mode: single-word entities need multiple content word matches
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

/**
 * Layer 12: Compute edge weight boost for an entity.
 * Entities with high-quality incoming links (avg weight > 1.0) get a boost.
 * Capped at 4 points to prevent domination.
 */
function getEdgeWeightBoostScore(entityName: string, map: Map<string, number>): number {
  const avgWeight = map.get(entityName.toLowerCase());
  if (!avgWeight) return 0;
  return Math.min((avgWeight - 1.0) * 2, 4);
}

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

    // Layer 5: Type boost - prioritize people, projects over common technologies
    const layerTypeBoost = disabled.has('type_boost') ? 0 : getTypeBoost(category, getConfig()?.custom_categories, entityName);
    score += layerTypeBoost;

    // Layer 6: Context boost - boost types relevant to note context
    const layerContextBoost = disabled.has('context_boost') ? 0 : (contextBoosts[category] || 0);
    score += layerContextBoost;

    // Layer 7: Recency boost - boost recently-mentioned entities
    const layerRecencyBoost = disabled.has('recency') ? 0 : (recencyIndex ? getRecencyBoost(entityName, recencyIndex) : 0);
    score += layerRecencyBoost;

    // Layer 8: Cross-folder boost - prioritize cross-cutting connections
    const layerCrossFolderBoost = disabled.has('cross_folder') ? 0 : ((notePath && entity.path) ? getCrossFolderBoost(entity.path, notePath) : 0);
    score += layerCrossFolderBoost;

    // Layer 9: Hub score boost - prioritize well-connected notes
    const layerHubBoost = disabled.has('hub_boost') ? 0 : getHubBoost(entity);
    score += layerHubBoost;

    // Layer 10: Feedback boost - adjust based on historical accuracy
    const layerFeedbackAdj = disabled.has('feedback') ? 0 : (feedbackBoosts.get(entityName) ?? 0);
    score += layerFeedbackAdj;

    // Layer 12: Edge weight boost — entities with high-quality incoming links
    const layerEdgeWeightBoost = disabled.has('edge_weight') ? 0 : getEdgeWeightBoostScore(entityName, edgeWeightMap);
    score += layerEdgeWeightBoost;

    // Layer 14: Prospect boost — accumulated pre-entity evidence (exact name/alias match only)
    const layerProspectBoost = disabled.has('prospect_boost') ? 0 : (prospectBoosts.get(entityName.toLowerCase()) ?? 0);
    score += layerProspectBoost;

    // Add to directlyMatchedEntities BEFORE suppression penalty
    // Only lexically-matched entities should seed co-occurrence lookups;
    // entities with only type/hub/recency boosts (no lexical evidence) are noise seeds.
    if (hasLexicalEvidence) {
      directlyMatchedEntities.add(entityName);
    }

    // Layer 0: Soft suppression penalty (proportional to Beta-Binomial posterior)
    const layerSuppressionPenalty = disabled.has('feedback') ? 0 : (suppressionPenalties.get(entityName) ?? 0);
    score += layerSuppressionPenalty;
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
          typeBoost: layerTypeBoost,
          contextBoost: layerContextBoost,
          recencyBoost: layerRecencyBoost,
          crossFolderBoost: layerCrossFolderBoost,
          hubBoost: layerHubBoost,
          feedbackAdjustment: layerFeedbackAdj,
          suppressionPenalty: layerSuppressionPenalty,
          edgeWeightBoost: layerEdgeWeightBoost,
          prospectBoost: layerProspectBoost,
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
      const contentCoocBoost = getCooccurrenceBoost(entityName, cooccurrenceSeeds, cooccurrenceIndex, recencyIndex);
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
          // Require minimal content overlap for co-occurrence suggestions,
          // UNLESS the entity has strong co-occurrence with multiple content-matched entities.
          // This allows graph-only T3 entities through when they have ≥2 associations.
          const entityTokens = tokenize(entityName);
          const hasContentOverlap = entityTokens.some(token =>
            contentTokens.has(token) || contentStems.has(stem(token))
          );

          // Requires stronger graph signal to admit entities with no content overlap
          const strongCooccurrence = boost >= config.minCooccurrenceGate;

          if (!hasContentOverlap && !strongCooccurrence) {
            continue;  // Skip entities with zero content relevance and weak co-occurrence
          }

          // Entity passed content overlap or strong co-occurrence check —
          // qualify it for final results
          if (hasContentOverlap || strongCooccurrence) {
            entitiesWithAnyScoringPath.add(entityName);
          }

          // For purely co-occurrence-based suggestions, add relevant boosts.
          // Recency is omitted for graph-only entities — it's a "recently seen" signal
          // that shouldn't inflate scores for entities absent from the note's text.
          const typeBoost = disabled.has('type_boost') ? 0 : getTypeBoost(category, getConfig()?.custom_categories, entityName);
          const contextBoost = disabled.has('context_boost') ? 0 : (contextBoosts[category] || 0);
          const recencyBoostVal = hasContentOverlap && !disabled.has('recency')
            ? (recencyIndex ? getRecencyBoost(entityName, recencyIndex) : 0)
            : 0;
          const rawCrossFolderBoost = disabled.has('cross_folder') ? 0 : ((notePath && entity.path) ? getCrossFolderBoost(entity.path, notePath) : 0);
          const rawHubBoost = disabled.has('hub_boost') ? 0 : getHubBoost(entity);
          // Cap hub + crossFolder for co-occurrence-only entities (no content overlap)
          // to prevent hub entities from dominating suffix lines via graph signals alone
          const hubBoost = hasContentOverlap ? rawHubBoost : Math.min(rawHubBoost, 2);
          const crossFolderBoost = hasContentOverlap ? rawCrossFolderBoost : Math.min(rawCrossFolderBoost, 2);
          const feedbackAdj = disabled.has('feedback') ? 0 : (feedbackBoosts.get(entityName) ?? 0);
          const edgeWeightBoost = disabled.has('edge_weight') ? 0 : getEdgeWeightBoostScore(entityName, edgeWeightMap);
          const prospectBoost = disabled.has('prospect_boost') ? 0 : (prospectBoosts.get(entityName.toLowerCase()) ?? 0);
          const suppPenalty = disabled.has('feedback') ? 0 : (suppressionPenalties.get(entityName) ?? 0);
          let totalBoost = boost + typeBoost + contextBoost + recencyBoostVal + crossFolderBoost + hubBoost + feedbackAdj + edgeWeightBoost + prospectBoost + suppPenalty;
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
                typeBoost,
                contextBoost,
                recencyBoost: recencyBoostVal,
                crossFolderBoost,
                hubBoost,
                feedbackAdjustment: feedbackAdj,
                suppressionPenalty: suppPenalty,
                edgeWeightBoost,
                prospectBoost,
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

          // Reuse existing layer logic for base boosts
          const layerTypeBoost = disabled.has('type_boost') ? 0 : getTypeBoost(category, getConfig()?.custom_categories, match.entityName);
          const layerContextBoost = disabled.has('context_boost') ? 0 : (contextBoosts[category] || 0);
          const layerHubBoost = disabled.has('hub_boost') ? 0 : getHubBoost(entity);
          const layerCrossFolderBoost = disabled.has('cross_folder') ? 0 : ((notePath && entity.path) ? getCrossFolderBoost(entity.path, notePath) : 0);
          const layerFeedbackAdj = disabled.has('feedback') ? 0 : (feedbackBoosts.get(match.entityName) ?? 0);
          const layerEdgeWeightBoost = disabled.has('edge_weight') ? 0 : getEdgeWeightBoostScore(match.entityName, edgeWeightMap);
          const layerProspectBoost = disabled.has('prospect_boost') ? 0 : (prospectBoosts.get(match.entityName.toLowerCase()) ?? 0);
          const layerSuppPenalty = disabled.has('feedback') ? 0 : (suppressionPenalties.get(match.entityName) ?? 0);

          const totalScore = boost + layerTypeBoost + layerContextBoost + layerHubBoost + layerCrossFolderBoost + layerFeedbackAdj + layerEdgeWeightBoost + layerProspectBoost + layerSuppPenalty;

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
                typeBoost: layerTypeBoost,
                contextBoost: layerContextBoost,
                recencyBoost: 0,
                crossFolderBoost: layerCrossFolderBoost,
                hubBoost: layerHubBoost,
                feedbackAdjustment: layerFeedbackAdj,
                suppressionPenalty: layerSuppPenalty,
                semanticBoost: boost,
                edgeWeightBoost: layerEdgeWeightBoost,
                prospectBoost: layerProspectBoost,
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
    if (recencyIndex) {
      const aRecency = recencyIndex.lastMentioned.get(a.name.toLowerCase()) || 0;
      const bRecency = recencyIndex.lastMentioned.get(b.name.toLowerCase()) || 0;
      return bRecency - aRecency;
    }

    return 0;
  });

  // Persist suggestion events for pipeline observability (Pillar 6)
  const persistDb = getWriteStateDb();
  if (persistDb && notePath) {
    try {
      const now = Date.now();
      const insertStmt = persistDb.db.prepare(`
        INSERT OR IGNORE INTO suggestion_events
          (timestamp, note_path, entity, total_score, breakdown_json, threshold, passed, strictness, applied, pipeline_event_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
      `);
      const persistTransaction = persistDb.db.transaction(() => {
        for (const e of relevantEntities) {
          insertStmt.run(
            now,
            notePath,
            e.name,
            e.score,
            JSON.stringify(e.breakdown),
            adaptiveMinScore,
            1,  // passed threshold (these are relevantEntities)
            strictness
          );
        }
        // Also persist entities that were scored but didn't meet threshold
        for (const e of scoredEntities) {
          if (!entitiesWithAnyScoringPath.has(e.name)) continue;
          if (relevantEntities.some(r => r.name === e.name)) continue;
          insertStmt.run(
            now,
            notePath,
            e.name,
            e.score,
            JSON.stringify(e.breakdown),
            adaptiveMinScore,
            0,  // did not pass threshold
            strictness
          );
        }
      });
      persistTransaction();
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
  const stateDb = getWriteStateDb();
  if (!stateDb) return [];

  const collisions: AliasCollision[] = [];

  // 1. Note name matches an existing entity's alias
  const nameAsAlias = getEntitiesByAlias(stateDb, noteName);
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
    const existingByName = getEntityByName(stateDb, alias);
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
    const existingByAlias = getEntitiesByAlias(stateDb, alias);
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
    const db = getWriteStateDb();
    if (!db) return true;
    const existing = getEntityByName(db, alias);
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

  const stateDb = getWriteStateDb();
  if (!stateDb) return result;

  // 1. Exact name match
  const exact = getEntityByName(stateDb, noteName);
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
    const searchResults = searchEntitiesDb(stateDb, noteName, 5);
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
        const entity = getEntityByName(stateDb, match.entityName);
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

/**
 * Apply high-confidence proactive wikilinks to a file.
 *
 * Only inserts entities that scored above the proactive threshold with
 * 'high' confidence. Uses applyWikilinks from vault-core (no implicit
 * entity detection). Skips files modified within the last 30 seconds
 * to avoid clashing with active editing.
 */
export async function applyProactiveSuggestions(
  filePath: string,
  vaultPath: string,
  suggestions: Array<{ entity: string; score: number; confidence: string }>,
  config: { minScore: number; maxPerFile: number },
): Promise<{ applied: string[]; skipped: string[] }> {
  const stateDb = getWriteStateDb();

  // Filter to high-confidence suggestions above threshold
  const candidates = suggestions
    .filter(s => s.score >= config.minScore && s.confidence === 'high')
    .slice(0, config.maxPerFile);

  if (candidates.length === 0) {
    return { applied: [], skipped: [] };
  }

  const fullPath = path.join(vaultPath, filePath);

  // Skip files modified within last 30 seconds (active editing)
  try {
    const stat = await fs.stat(fullPath);
    if (Date.now() - stat.mtimeMs < 30_000) {
      return { applied: [], skipped: candidates.map(c => c.entity) };
    }
  } catch {
    return { applied: [], skipped: candidates.map(c => c.entity) };
  }

  // Read current file content
  let content: string;
  try {
    content = await fs.readFile(fullPath, 'utf-8');
  } catch {
    return { applied: [], skipped: candidates.map(c => c.entity) };
  }

  // Build Entity objects for candidates, filtering out suppressed entities
  const entityObjects: Entity[] = [];
  for (const candidate of candidates) {
    if (stateDb && isSuppressed(stateDb, candidate.entity)) continue;

    // Look up entity in stateDb to get aliases and category
    if (stateDb) {
      const entityObj = getEntityByName(stateDb, candidate.entity);
      // Defense-in-depth: skip common-word false positives
      const category = entityObj?.category ?? 'other';
      if (isCommonWordFalsePositive(candidate.entity, content, category)) continue;
      if (entityObj) {
        entityObjects.push({
          name: entityObj.name,
          path: entityObj.path,
          aliases: entityObj.aliases ?? [],
        });
        continue;
      }
    }
    // Fallback: use entity name as a string entity
    entityObjects.push(candidate.entity);
  }

  if (entityObjects.length === 0) {
    return { applied: [], skipped: candidates.map(c => c.entity) };
  }

  // Apply wikilinks with only the high-confidence entities (no implicit detection)
  const result = applyWikilinks(content, entityObjects, {
    firstOccurrenceOnly: true,
    caseInsensitive: true,
  });

  if (result.linksAdded === 0) {
    return { applied: [], skipped: candidates.map(c => c.entity) };
  }

  // Write back to file
  try {
    await fs.writeFile(fullPath, result.content, 'utf-8');
  } catch {
    return { applied: [], skipped: candidates.map(c => c.entity) };
  }

  // Track applications for feedback loop
  if (stateDb) {
    trackWikilinkApplications(stateDb, filePath, result.linkedEntities, 'proactive');

    // Mark as applied in suggestion_events
    try {
      const markApplied = stateDb.db.prepare(
        `UPDATE suggestion_events SET applied = 1
         WHERE note_path = ? AND entity = ? AND applied = 0`,
      );
      for (const entity of result.linkedEntities) {
        markApplied.run(filePath, entity);
      }
    } catch {
      // Non-critical
    }
  }

  return {
    applied: result.linkedEntities,
    skipped: candidates
      .map(c => c.entity)
      .filter(e => !result.linkedEntities.includes(e)),
  };
}
