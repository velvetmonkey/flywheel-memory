/**
 * Wikilink application logic
 *
 * Applies [[wikilinks]] to known entities in content while
 * respecting protected zones (code, frontmatter, existing links, etc.)
 *
 * Also supports:
 * - Pattern-based detection for implicit entities (proper nouns, acronyms, CamelCase)
 * - Alias resolution for existing wikilinks (resolves [[alias]] to [[Entity|alias]])
 */

import type {
  WikilinkOptions,
  WikilinkResult,
  Entity,
  ExtendedWikilinkOptions,
  ImplicitEntityMatch,
  ImplicitEntityConfig,
  ResolveAliasOptions,
} from './types.js';
import { getProtectedZones, rangeOverlapsProtectedZone } from './protectedZones.js';
import { stem } from './stemmer.js';
import {
  EXCLUDE_WORDS_BASE,
  ALWAYS_CAPITALIZED,
  IMPLICIT_EXCLUDE_WORDS,
  SENTENCE_STARTER_WORDS,
} from './wikilinkLexicon.js';

// Re-export lexicon sets so existing import paths keep working
// (packages/core/src/index.ts and mcp-server import these from this module).
export { ALWAYS_CAPITALIZED, IMPLICIT_EXCLUDE_WORDS } from './wikilinkLexicon.js';

/**
 * Get all search terms for an entity (name + aliases)
 * Returns tuples of [searchTerm, entityName] for proper linking
 */
function getSearchTerms(entity: Entity): Array<{ term: string; entityName: string; isAlias: boolean }> {
  if (typeof entity === 'string') {
    return [{ term: entity, entityName: entity, isAlias: false }];
  }

  // Include the entity name and all aliases
  const terms: Array<{ term: string; entityName: string; isAlias: boolean }> = [
    { term: entity.name, entityName: entity.name, isAlias: false }
  ];

  for (const alias of entity.aliases) {
    terms.push({ term: alias, entityName: entity.name, isAlias: true });
  }

  return terms;
}

/**
 * Unified EXCLUDE_WORDS: base set (300+) merged with IMPLICIT_EXCLUDE_WORDS (1100+).
 * This ensures shouldExcludeEntity() checks all 1200+ common English words,
 * not just the smaller base set. Fixes words like "phase", "tier", "recall"
 * that were in IMPLICIT but not in the explicit matching path.
 *
 * Note: IMPLICIT_EXCLUDE_WORDS is defined later in this file.
 * We use a lazy getter to avoid forward-reference issues.
 */
let _mergedExcludeWords: Set<string> | null = null;

function getMergedExcludeWords(): Set<string> {
  if (!_mergedExcludeWords) {
    _mergedExcludeWords = new Set([...EXCLUDE_WORDS_BASE, ...IMPLICIT_EXCLUDE_WORDS]);
  }
  return _mergedExcludeWords;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check if an entity should be excluded from wikilikning
 */
function shouldExcludeEntity(entity: string, isAlias = false): boolean {
  // Skip single-char terms (e.g. alias "I" for Max)
  if (entity.length < 2) return true;
  if (getMergedExcludeWords().has(entity.toLowerCase())) return true;
  // Skip lowercase hyphenated descriptors (e.g., self-improving, local-first, Claude-native)
  if (entity.includes('-') && entity === entity.toLowerCase()) return true;
  // Short aliases (≤3 chars) must be ALL-UPPERCASE to survive (e.g., "CI", "ML" ok, "api", "tF" blocked)
  // Entity names like "Max" (3 chars, mixed case) are unaffected since isAlias=false for names.
  if (isAlias && entity.length <= 3 && entity !== entity.toUpperCase()) return true;
  return false;
}

/**
 * True when entity's lowercase form is a common word but its casing is distinctive
 * AND the word is not always-capitalized in English (like Monday, January, American).
 * These terms are allowed through exclusion but matched case-sensitively.
 * e.g. "REST" (common word "rest") → match only "REST" in content, not "rest"
 */
export function isCommonWordEntity(entity: string): boolean {
  const lower = entity.toLowerCase();
  if (!getMergedExcludeWords().has(lower)) return false;
  if (entity === lower) return false; // all-lowercase → stay excluded
  if (lower.includes(' ')) return false; // multi-word phrases → stay excluded
  if (ALWAYS_CAPITALIZED.has(lower)) return false; // always capitalized in English
  return true;
}

/**
 * Find all matches of an entity in content with word boundaries
 */
const BRACKET_CHARS = new Set(['(', ')', '[', ']', '{', '}']);

export function findEntityMatches(
  content: string,
  entity: string,
  caseInsensitive: boolean
): Array<{ start: number; end: number; matched: string }> {
  const pattern = `\\b${escapeRegex(entity)}\\b`;
  const flags = caseInsensitive ? 'gi' : 'g';
  const regex = new RegExp(pattern, flags);

  const matches: Array<{ start: number; end: number; matched: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const charBefore = start > 0 ? content[start - 1] : '';
    const charAfter = end < content.length ? content[end] : '';
    if (BRACKET_CHARS.has(charBefore) || BRACKET_CHARS.has(charAfter)) continue;

    matches.push({
      start,
      end,
      matched: match[0],
    });
  }

  return matches;
}

/**
 * Defense-in-depth overlap predicate shared by candidate-selection passes:
 * true when the candidate range overlaps the existing range (partial overlap
 * from either side, or full containment). Used by applyWikilinks,
 * detectImplicitEntities, processWikilinks, and the mcp-server write-side
 * orchestrator when filtering candidate matches against already-accepted ones.
 */
export function overlapsExistingLink(
  candidate: { start: number; end: number },
  existing: { start: number; end: number }
): boolean {
  return (
    (candidate.start >= existing.start && candidate.start < existing.end) ||
    (candidate.end > existing.start && candidate.end <= existing.end) ||
    (candidate.start <= existing.start && candidate.end >= existing.end)
  );
}

/**
 * Filter implicit-entity matches against already-linked entities and the
 * current note name (self-link avoidance). Shared by core's processWikilinks
 * and the mcp-server write-side orchestrator — callers build their own
 * alreadyLinked set (the write side additionally includes aliases).
 */
export function filterNewImplicitMatches(
  matches: ImplicitEntityMatch[],
  alreadyLinked: Set<string>,
  currentNoteName: string | null | undefined
): ImplicitEntityMatch[] {
  return matches.filter(match => {
    const normalized = match.text.toLowerCase();

    // Skip if already linked as known entity
    if (alreadyLinked.has(normalized)) return false;

    // Skip self-links
    if (currentNoteName && normalized === currentNoteName) return false;

    return true;
  });
}

/**
 * Build the candidate search-term list for a set of entities (names +
 * aliases): apply exclusion with the common-word distinctive-casing rescue,
 * then sort longest-term-first. Shared by applyWikilinks and
 * suggestWikilinks; the optional guards (ambiguous-alias skip, per-alias
 * suppression) are only supplied by applyWikilinks.
 */
function buildSearchTerms(
  entities: Entity[],
  opts: { ambiguousAliases?: Set<string>; suppressedTerms?: Set<string> } = {}
): Array<{ term: string; entityName: string; isAlias: boolean; needsCasingCheck: boolean }> {
  const { ambiguousAliases, suppressedTerms } = opts;
  const allSearchTerms: Array<{ term: string; entityName: string; isAlias: boolean; needsCasingCheck: boolean }> = [];
  for (const entity of entities) {
    const terms = getSearchTerms(entity);
    for (const t of terms) {
      // Skip ambiguous aliases (shared by multiple entities)
      if (ambiguousAliases && t.isAlias && ambiguousAliases.has(t.term.toLowerCase())) continue;
      // Per-alias suppression: drop this one (entity, term) pair without
      // touching the entity's other terms.
      if (suppressedTerms?.has(`${t.entityName.toLowerCase()}||${t.term.toLowerCase()}`)) continue;
      if (shouldExcludeEntity(t.term, t.isAlias)) {
        // Rescue common-word entities with distinctive casing (REST, Go, Rust, Swift)
        // They will be matched case-sensitively to avoid false positives
        if (isCommonWordEntity(t.term)) {
          allSearchTerms.push({ ...t, needsCasingCheck: true });
        }
        continue;
      }
      allSearchTerms.push({ ...t, needsCasingCheck: false });
    }
  }

  // Sort by term length (longest first) to avoid partial matches
  allSearchTerms.sort((a, b) => b.term.length - a.term.length);

  return allSearchTerms;
}

/**
 * Apply wikilinks to entities in content
 *
 * @param content - The markdown content to process
 * @param entities - List of entity names or Entity objects to look for
 * @param options - Wikilink options
 * @returns Result with updated content and statistics
 */
export function applyWikilinks(
  content: string,
  entities: Entity[],
  options: WikilinkOptions = {}
): WikilinkResult {
  const {
    firstOccurrenceOnly = true,
    caseInsensitive = true,
    alreadyLinked,
    suppressedTerms,
  } = options;

  if (!entities.length) {
    return {
      content,
      linksAdded: 0,
      linkedEntities: [],
      linkedTerms: [],
    };
  }

  // Detect ambiguous aliases — aliases claimed by multiple entities
  // Skip these to avoid wrong entity resolution (same pattern as resolveAliasWikilinks)
  const aliasCounts = new Map<string, Set<string>>();
  for (const entity of entities) {
    if (typeof entity === 'string') continue;
    for (const alias of entity.aliases) {
      const key = alias.toLowerCase();
      const owners = aliasCounts.get(key) ?? new Set();
      owners.add(entity.name);
      aliasCounts.set(key, owners);
    }
  }
  const ambiguousAliases = new Set<string>();
  for (const [key, owners] of aliasCounts) {
    if (owners.size > 1) ambiguousAliases.add(key);
  }

  // Build search terms from all entities (names + aliases)
  // Each term maps back to its canonical entity name
  const allSearchTerms = buildSearchTerms(entities, { ambiguousAliases, suppressedTerms });

  // Get protected zones
  let zones = getProtectedZones(content);

  let result = content;
  let linksAdded = 0;
  const linkedEntities: string[] = [];
  const linkedTerms: Array<{ entity: string; matchedTerm: string }> = [];

  if (firstOccurrenceOnly) {
    // For firstOccurrenceOnly mode, we need to find the earliest match across
    // all terms (name + aliases) for each entity, then link that one
    // Also need to handle overlapping matches between different entities

    // First, collect ALL valid matches for each entity (name + aliases combined)
    const entityAllMatches = new Map<string, Array<{ term: string; match: { start: number; end: number; matched: string } }>>();

    for (const { term, entityName, isAlias, needsCasingCheck } of allSearchTerms) {
      const entityKey = entityName.toLowerCase();

      // Short uppercase aliases (≤4 chars, all-caps) match case-sensitively
      // so "CI" matches "CI" but not "ci" or "Ci"
      const useCaseInsensitive = !(isAlias && term.length <= 4 && term === term.toUpperCase());
      // Common-word entities (REST, Go, Rust, Swift) always match case-sensitively
      const effectiveCaseInsensitive = needsCasingCheck ? false : (useCaseInsensitive ? caseInsensitive : false);
      const matches = findEntityMatches(result, term, effectiveCaseInsensitive);

      // Filter out matches in protected zones
      const validMatches = matches.filter(
        match => !rangeOverlapsProtectedZone(match.start, match.end, zones)
      );

      if (validMatches.length === 0) {
        continue;
      }

      // Add to entity's matches
      const existingMatches = entityAllMatches.get(entityKey) || [];
      for (const match of validMatches) {
        existingMatches.push({ term, match });
      }
      entityAllMatches.set(entityKey, existingMatches);
    }

    // Sort each entity's matches by position
    for (const [_entityKey, matches] of entityAllMatches.entries()) {
      matches.sort((a, b) => a.match.start - b.match.start);
    }

    // Build final list: for each entity, pick the earliest non-overlapping match
    // Process entities in order of their earliest match length (longest first for same position)
    let allCandidates: Array<{ entityName: string; term: string; match: { start: number; end: number; matched: string } }> = [];

    for (const [entityKey, matches] of entityAllMatches.entries()) {
      // Find the original entityName (with correct casing)
      const entityName = allSearchTerms.find(t => t.entityName.toLowerCase() === entityKey)?.entityName || entityKey;
      for (const m of matches) {
        allCandidates.push({ entityName, ...m });
      }
    }

    // Sort by position, then by match length (descending), then by term length (ascending)
    // The term length tiebreaker ensures "API" wins over "API Management" when both match "api"
    allCandidates.sort((a, b) => {
      // Primary: earliest position first
      if (a.match.start !== b.match.start) return a.match.start - b.match.start;
      // Secondary: longest matched text first
      if (a.match.matched.length !== b.match.matched.length)
        return b.match.matched.length - a.match.matched.length;
      // Tertiary: shorter entity term first (more exact match)
      return a.term.length - b.term.length;
    });

    // Select non-overlapping matches, preferring longer ones at same position
    // Each entity gets at most one match.
    // Pre-seed with any entities already linked by a prior step (e.g. resolveAliasWikilinks)
    // so firstOccurrenceOnly skips them in this pass.
    const selectedMatches: typeof allCandidates = [];
    const selectedEntityNames = new Set<string>(alreadyLinked ?? []);

    for (const candidate of allCandidates) {
      const entityKey = candidate.entityName.toLowerCase();

      // Skip if this entity already has a selected match
      if (selectedEntityNames.has(entityKey)) {
        continue;
      }

      // Check if this overlaps with any already selected match
      const overlaps = selectedMatches.some(
        existing => overlapsExistingLink(candidate.match, existing.match)
      );

      if (!overlaps) {
        selectedMatches.push(candidate);
        selectedEntityNames.add(entityKey);
      }
    }

    // Sort by position from end to start to preserve offsets when inserting
    selectedMatches.sort((a, b) => b.match.start - a.match.start);

    for (const { entityName, term, match } of selectedMatches) {
      // Bare [[Name]] ONLY when the matched text is the entity name
      // EXACTLY (case included). A case-insensitive match keeps the original
      // display via the piped form so the source's casing is never lost —
      // text "AI" linked to entity "ai" emits [[ai|AI]], not [[ai]]. Losing
      // case here breaks consumers that round-trip through the rendered note
      // (the mega-monkey reconcile loop: [[ai]] normalizes to "ai" but the DB
      // source said "AI" → permanent false drift).
      const wikilink = match.matched === entityName
        ? `[[${entityName}]]`
        : `[[${entityName}|${match.matched}]]`;

      result = result.slice(0, match.start) + wikilink + result.slice(match.end);

      // Update protected zones (shift positions after insertion)
      const shift = wikilink.length - match.matched.length;
      zones = zones.map(zone => ({
        ...zone,
        start: zone.start <= match.start ? zone.start : zone.start + shift,
        end: zone.end <= match.start ? zone.end : zone.end + shift,
      }));

      // Add new wikilink as protected zone
      zones.push({
        start: match.start,
        end: match.start + wikilink.length,
        type: 'wikilink',
      });
      zones.sort((a, b) => a.start - b.start);

      linksAdded++;
      if (!linkedEntities.includes(entityName)) {
        linkedEntities.push(entityName);
      }
      linkedTerms.push({ entity: entityName, matchedTerm: term });
    }

    // Stemmed matching pass: for single-word entities (≥4 chars) that didn't match
    // exactly, find content words with the same Porter stem and link them.
    // This eliminates the need for explicit morphological aliases
    // (e.g., Pipelines matches "Pipeline", Sprint matches "Sprinting").
    for (const entity of entities) {
      if (typeof entity === 'string') continue;
      const entityName = entity.name;
      if (selectedEntityNames.has(entityName.toLowerCase())) continue;
      // Only single-word entities ≥4 chars — multi-word needs exact matching
      if (entityName.includes(' ') || entityName.length < 4) continue;
      if (shouldExcludeEntity(entityName)) continue;

      const entityStem = stem(entityName);
      // Find word-boundary matches in content for words with same stem
      const wordPattern = /\b[A-Za-z]{4,}\b/g;
      let wordMatch: RegExpExecArray | null;
      let bestStemMatch: { start: number; end: number; matched: string } | null = null;

      while ((wordMatch = wordPattern.exec(result)) !== null) {
        const word = wordMatch[0];
        if (stem(word) !== entityStem) continue;
        // Skip if same as entity name (already tried in exact pass)
        if (word.toLowerCase() === entityName.toLowerCase()) continue;
        const start = wordMatch.index;
        const end = start + word.length;
        // Must not be in a protected zone
        if (rangeOverlapsProtectedZone(start, end, zones)) continue;
        // Check bracket chars
        const charBefore = start > 0 ? result[start - 1] : '';
        const charAfter = end < result.length ? result[end] : '';
        if ('()[]{}' .includes(charBefore) || '()[]{}' .includes(charAfter)) continue;
        bestStemMatch = { start, end, matched: word };
        break; // First occurrence only
      }

      if (bestStemMatch) {
        const wikilink = `[[${entityName}|${bestStemMatch.matched}]]`;
        result = result.slice(0, bestStemMatch.start) + wikilink + result.slice(bestStemMatch.end);
        const shift = wikilink.length - bestStemMatch.matched.length;
        zones = zones.map(zone => ({
          ...zone,
          start: zone.start <= bestStemMatch!.start ? zone.start : zone.start + shift,
          end: zone.end <= bestStemMatch!.start ? zone.end : zone.end + shift,
        }));
        zones.push({ start: bestStemMatch.start, end: bestStemMatch.start + wikilink.length, type: 'wikilink' });
        zones.sort((a, b) => a.start - b.start);
        linksAdded++;
        if (!linkedEntities.includes(entityName)) {
          linkedEntities.push(entityName);
        }
        linkedTerms.push({ entity: entityName, matchedTerm: bestStemMatch.matched });
      }
    }
  } else {
    // For all occurrences mode, process each term
    for (const { term, entityName, needsCasingCheck } of allSearchTerms) {
      // Find all matches of the search term
      // Common-word entities (REST, Go, Rust, Swift) always match case-sensitively
      const effectiveCaseInsensitive = needsCasingCheck ? false : caseInsensitive;
      const matches = findEntityMatches(result, term, effectiveCaseInsensitive);

      // Filter out matches in protected zones
      const validMatches = matches.filter(
        match => !rangeOverlapsProtectedZone(match.start, match.end, zones)
      );

      if (validMatches.length === 0) {
        continue;
      }

      // Process from end to start to preserve positions
      const matchesToProcess = [...validMatches].reverse();

      for (const match of matchesToProcess) {
        // Bare [[Name]] ONLY when matched text is the entity name EXACTLY
        // (case included) — preserve original display casing otherwise.
        const wikilink = match.matched === entityName
          ? `[[${entityName}]]`
          : `[[${entityName}|${match.matched}]]`;

        result = result.slice(0, match.start) + wikilink + result.slice(match.end);

        // Update protected zones (shift positions after insertion)
        const shift = wikilink.length - match.matched.length;
        zones = zones.map(zone => ({
          ...zone,
          start: zone.start <= match.start ? zone.start : zone.start + shift,
          end: zone.end <= match.start ? zone.end : zone.end + shift,
        }));

        // Add new wikilink as protected zone
        zones.push({
          start: match.start,
          end: match.start + wikilink.length,
          type: 'wikilink',
        });
        zones.sort((a, b) => a.start - b.start);

        linksAdded++;
        if (!linkedEntities.includes(entityName)) {
          linkedEntities.push(entityName);
        }
        linkedTerms.push({ entity: entityName, matchedTerm: term });
      }
    }
  }

  return {
    content: result,
    linksAdded,
    linkedEntities,
    linkedTerms,
  };
}

/**
 * Suggest wikilinks without applying them
 * Returns a list of potential links with their positions
 *
 * Supports both entity names and aliases - if content matches an alias,
 * the suggestion will contain the canonical entity name.
 */
export function suggestWikilinks(
  content: string,
  entities: Entity[],
  options: WikilinkOptions = {}
): Array<{ entity: string; start: number; end: number; context: string }> {
  const {
    firstOccurrenceOnly = true,
    caseInsensitive = true,
  } = options;

  const suggestions: Array<{
    entity: string;
    start: number;
    end: number;
    context: string;
  }> = [];

  if (!entities.length) {
    return suggestions;
  }

  // Build search terms from all entities (names + aliases)
  // Each term maps back to its canonical entity name
  // (sorted longest first to prioritize longer matches)
  const allSearchTerms = buildSearchTerms(entities);

  // Get protected zones
  const zones = getProtectedZones(content);

  if (firstOccurrenceOnly) {
    // For firstOccurrenceOnly mode, find the earliest match across all terms
    // for each entity, similar to applyWikilinks behavior
    const entityAllMatches = new Map<string, Array<{ match: { start: number; end: number }; entityName: string }>>();

    for (const { term, entityName, isAlias, needsCasingCheck } of allSearchTerms) {
      const entityKey = entityName.toLowerCase();
      const useCaseInsensitive = !(isAlias && term.length <= 4 && term === term.toUpperCase());
      const effectiveCaseInsensitive = needsCasingCheck ? false : (useCaseInsensitive ? caseInsensitive : false);
      const matches = findEntityMatches(content, term, effectiveCaseInsensitive);

      // Filter out matches in protected zones
      const validMatches = matches.filter(
        match => !rangeOverlapsProtectedZone(match.start, match.end, zones)
      );

      if (validMatches.length === 0) continue;

      // Add to entity's matches
      const existingMatches = entityAllMatches.get(entityKey) || [];
      for (const match of validMatches) {
        existingMatches.push({ match, entityName });
      }
      entityAllMatches.set(entityKey, existingMatches);
    }

    // For each entity, pick the earliest match
    const selectedSuggestions: Array<{ entity: string; start: number; end: number; context: string }> = [];

    for (const [_entityKey, matches] of entityAllMatches.entries()) {
      // Sort by position and pick the earliest
      matches.sort((a, b) => a.match.start - b.match.start);
      const earliest = matches[0];

      const contextStart = Math.max(0, earliest.match.start - 20);
      const contextEnd = Math.min(content.length, earliest.match.end + 20);
      const context = content.slice(contextStart, contextEnd);

      selectedSuggestions.push({
        entity: earliest.entityName,
        start: earliest.match.start,
        end: earliest.match.end,
        context: contextStart > 0 ? '...' + context : context,
      });
    }

    // Sort suggestions by position
    selectedSuggestions.sort((a, b) => a.start - b.start);
    return selectedSuggestions;
  }

  // For all occurrences mode, process each term
  for (const { term, entityName, needsCasingCheck } of allSearchTerms) {
    const effectiveCaseInsensitive = needsCasingCheck ? false : caseInsensitive;
    const matches = findEntityMatches(content, term, effectiveCaseInsensitive);

    for (const match of matches) {
      // Skip if in protected zone
      if (rangeOverlapsProtectedZone(match.start, match.end, zones)) {
        continue;
      }

      // Extract context (surrounding text)
      const contextStart = Math.max(0, match.start - 20);
      const contextEnd = Math.min(content.length, match.end + 20);
      const context = content.slice(contextStart, contextEnd);

      // Return the canonical entity name, not the matched term
      suggestions.push({
        entity: entityName,
        start: match.start,
        end: match.end,
        context: contextStart > 0 ? '...' + context : context,
      });
    }
  }

  return suggestions;
}

/**
 * Resolve wikilinks that target aliases to their canonical entity names
 *
 * When a user types [[model context protocol]], and "Model Context Protocol"
 * is an alias for entity "MCP", this function transforms it to:
 * [[MCP|model context protocol]]
 *
 * This preserves the user's original text as display text while resolving
 * to the canonical entity target.
 *
 * @param content - The markdown content to process
 * @param entities - List of entity names or Entity objects to look for
 * @param options - Resolution options
 * @returns Result with updated content and statistics
 */
export function resolveAliasWikilinks(
  content: string,
  entities: Entity[],
  options: ResolveAliasOptions = {}
): WikilinkResult {
  const { caseInsensitive = true } = options;

  if (!entities.length) {
    return {
      content,
      linksAdded: 0,
      linkedEntities: [],
    };
  }

  // Build alias → entity lookup map
  // Key: alias (lowercase if caseInsensitive)
  // Value: { entityName: canonical name, aliasText: original alias casing }
  const aliasMap = new Map<string, { entityName: string; aliasText: string }>();
  // Track ambiguous aliases (shared by multiple entities) — skip these to avoid wrong resolution
  const ambiguousAliases = new Set<string>();

  for (const entity of entities) {
    if (typeof entity === 'string') continue;

    for (const alias of entity.aliases) {
      const key = caseInsensitive ? alias.toLowerCase() : alias;
      const existing = aliasMap.get(key);
      if (existing && existing.entityName !== entity.name) {
        // Two different entities claim this alias — mark as ambiguous
        ambiguousAliases.add(key);
      }
      aliasMap.set(key, { entityName: entity.name, aliasText: alias });
    }

    // Also map the entity name itself so we can detect if target already points to entity
    const nameKey = caseInsensitive ? entity.name.toLowerCase() : entity.name;
    // Don't overwrite if name happens to be an alias of another entity
    if (!aliasMap.has(nameKey)) {
      aliasMap.set(nameKey, { entityName: entity.name, aliasText: entity.name });
    }
  }

  // Find wikilinks: [[target]] or [[target|display]]
  const wikilinkRegex = /\[\[([^\]|]+)(\|[^\]]+)?\]\]/g;
  let result = content;
  let linksResolved = 0;
  const resolvedEntities: string[] = [];

  // Collect all matches first, then process from end to preserve positions
  const matches: Array<{
    fullMatch: string;
    target: string;
    displayPart: string | undefined;
    index: number;
  }> = [];

  let match: RegExpExecArray | null;
  while ((match = wikilinkRegex.exec(content)) !== null) {
    matches.push({
      fullMatch: match[0],
      target: match[1],
      displayPart: match[2], // includes | if present
      index: match.index,
    });
  }

  // Process from end to start to preserve positions
  for (let i = matches.length - 1; i >= 0; i--) {
    const { fullMatch, target, displayPart, index } = matches[i];
    const targetKey = caseInsensitive ? target.toLowerCase() : target;

    // Check if target matches an alias
    const aliasInfo = aliasMap.get(targetKey);
    if (!aliasInfo) {
      // Target doesn't match any alias or entity name - leave unchanged
      continue;
    }

    // Skip ambiguous aliases — multiple entities claim this alias, resolution would be arbitrary
    if (ambiguousAliases.has(targetKey)) {
      continue;
    }

    // Check if already pointing to the entity name (no resolution needed)
    const entityNameKey = caseInsensitive ? aliasInfo.entityName.toLowerCase() : aliasInfo.entityName;
    if (targetKey === entityNameKey) {
      // Already pointing to entity name, no change needed
      continue;
    }

    // Target matches an alias! Resolve to canonical entity
    let newWikilink: string;
    if (displayPart) {
      // Has existing display text: [[alias|display]] → [[Entity|display]]
      newWikilink = `[[${aliasInfo.entityName}${displayPart}]]`;
    } else {
      // No display text: [[alias]] → [[Entity|alias]]
      // Preserve the user's original casing of the alias
      newWikilink = `[[${aliasInfo.entityName}|${target}]]`;
    }

    result = result.slice(0, index) + newWikilink + result.slice(index + fullMatch.length);
    linksResolved++;
    if (!resolvedEntities.includes(aliasInfo.entityName)) {
      resolvedEntities.push(aliasInfo.entityName);
    }
  }

  return {
    content: result,
    linksAdded: linksResolved,
    linkedEntities: resolvedEntities,
  };
}

/**
 * Default configuration for implicit entity detection
 */
const DEFAULT_IMPLICIT_CONFIG: Required<ImplicitEntityConfig> = {
  detectImplicit: false,
  implicitPatterns: ['proper-nouns', 'quoted-terms'],
  excludePatterns: [
    '^The ', '^A ', '^An ', '^This ', '^That ', '^These ', '^Those ',
    '^v?\\d+(?:\\.\\d+){1,3}(?:[-.][a-zA-Z0-9]+)?$',
  ],
  minEntityLength: 3,
};

/**
 * Detect implicit entities in content using pattern matching
 *
 * This finds potential entities that don't have existing files:
 * - Multi-word proper nouns (e.g., "Marcus Johnson", "Project Alpha")
 * - Single capitalized words after lowercase (e.g., "discussed with Marcus")
 * - CamelCase words (e.g., TypeScript, HuggingFace)
 *
 * @param content - The markdown content to analyze
 * @param config - Configuration for detection patterns
 * @returns Array of detected implicit entity matches
 */
export function detectImplicitEntities(
  content: string,
  config: ImplicitEntityConfig = {}
): ImplicitEntityMatch[] {
  const {
    implicitPatterns = DEFAULT_IMPLICIT_CONFIG.implicitPatterns,
    excludePatterns = DEFAULT_IMPLICIT_CONFIG.excludePatterns,
    minEntityLength = DEFAULT_IMPLICIT_CONFIG.minEntityLength,
  } = config;

  const detected: ImplicitEntityMatch[] = [];
  const seenTexts = new Set<string>();

  // Get protected zones to avoid detecting entities in code/links/etc.
  const zones = getProtectedZones(content);

  // Build exclude regex from patterns
  const excludeRegexes = excludePatterns.map(p => new RegExp(p, 'i'));

  /**
   * Check if detected text should be excluded
   */
  function shouldExclude(text: string): boolean {
    // Length check
    if (text.length < minEntityLength) return true;

    // Must contain at least one letter — pure punctuation/symbols are never entities
    if (!/[a-zA-Z]/.test(text)) return true;

    // Common words
    if (getMergedExcludeWords().has(text.toLowerCase())) return true;

    // Exclude patterns
    for (const regex of excludeRegexes) {
      if (regex.test(text)) return true;
    }

    // Already seen (dedup)
    const normalized = text.toLowerCase();
    if (seenTexts.has(normalized)) return true;

    return false;
  }

  /**
   * Check if match is in a protected zone
   */
  function isProtected(start: number, end: number): boolean {
    return rangeOverlapsProtectedZone(start, end, zones);
  }

  // Pattern 1: Multi-word proper nouns
  // Matches "Marcus Johnson", "Project Alpha", "San Francisco Bay Area"
  if (implicitPatterns.includes('proper-nouns')) {
    const properNounRegex = /\b([A-Z][a-z]+(?:[^\S\n]+[A-Z][a-z]+)+)\b/g;
    let match: RegExpExecArray | null;

    while ((match = properNounRegex.exec(content)) !== null) {
      let text = match[1];
      let start = match.index;
      let end = start + match[0].length;

      // Check if first word is a common sentence starter (e.g., "Visit", "Also", "See")
      // If so, trim it and use the remaining words as the entity
      const firstSpaceIndex = text.indexOf(' ');
      if (firstSpaceIndex > 0) {
        const firstWord = text.substring(0, firstSpaceIndex).toLowerCase();
        if (SENTENCE_STARTER_WORDS.has(firstWord)) {
          // Trim the first word and recalculate positions
          text = text.substring(firstSpaceIndex + 1);
          start = start + firstSpaceIndex + 1;
          // Only keep if remaining text has 2+ words (still a proper noun phrase)
          if (!text.includes(' ')) {
            continue; // Skip single-word remainder
          }
        }
      }

      // Guard: max 4 words — longer phrases are almost always prose, not entity names
      const wordCount = text.split(/\s+/).length;
      if (wordCount > 4) continue;

      // Guard: max 40 chars
      if (text.length > 40) continue;

      // Guard: strip trailing punctuation from match text
      const stripped = text.replace(/[,.:;!?]+$/, '');
      if (stripped.length < minEntityLength) continue;
      if (stripped !== text) {
        end = start + stripped.length;
        text = stripped;
      }

      // Guard: sentence-start capitalization — if match begins at start of line
      // (after list marker or newline), first word cap is positional, not semantic.
      // Require at least 2 capitalized words remaining after the first.
      if (start > 0) {
        const lineStart = content.lastIndexOf('\n', start - 1) + 1;
        const before = content.substring(lineStart, start).trim();
        // After list marker (- * >) or empty (line start), first cap is positional
        if (before === '' || /^[-*>]+$/.test(before) || /^\d+\.$/.test(before)) {
          // Already trimmed sentence starters above; this catches the remaining
          // cases where the first word is capitalized only because of its position
          const wordsArr = text.split(/\s+/);
          if (wordsArr.length <= 2) continue; // Too few words to trust positional cap
        }
      }

      if (!shouldExclude(text) && !isProtected(start, end)) {
        detected.push({ text, start, end, pattern: 'proper-nouns' });
        seenTexts.add(text.toLowerCase());
      }
    }
  }

  // Pattern 2: Single capitalized words after lowercase
  // Matches "discussed with Marcus yesterday" -> "Marcus"
  if (implicitPatterns.includes('single-caps')) {
    // Lookbehind for lowercase letter + space
    const singleCapRegex = /(?<=[a-z]\s)([A-Z][a-z]{3,})\b/g;
    let match: RegExpExecArray | null;

    while ((match = singleCapRegex.exec(content)) !== null) {
      const text = match[1];
      const start = match.index;
      const end = start + match[0].length;

      if (!shouldExclude(text) && !isProtected(start, end)) {
        detected.push({ text, start, end, pattern: 'single-caps' });
        seenTexts.add(text.toLowerCase());
      }
    }
  }

  // Pattern 3: Quoted terms (explicit entity markers)
  // Matches "Turbopump" -> [[Turbopump]]
  if (implicitPatterns.includes('quoted-terms')) {
    const quotedRegex = /"([^"]{3,30})"/g;
    let match: RegExpExecArray | null;
    while ((match = quotedRegex.exec(content)) !== null) {
      const text = match[1];
      const start = match.index;
      const end = start + match[0].length;
      if (!shouldExclude(text) && !isProtected(start, end)) {
        detected.push({ text, start, end, pattern: 'quoted-terms' });
        seenTexts.add(text.toLowerCase());
      }
    }
  }

  // Pattern 4: CamelCase words (TypeScript, YouTube, HuggingFace)
  if (implicitPatterns.includes('camel-case')) {
    const camelRegex = /\b([A-Z][a-z]+[A-Z][a-zA-Z]*)\b/g;
    let match: RegExpExecArray | null;
    while ((match = camelRegex.exec(content)) !== null) {
      const text = match[1];
      const start = match.index;
      const end = start + text.length;
      if (!shouldExclude(text) && !isProtected(start, end)) {
        detected.push({ text, start, end, pattern: 'camel-case' });
        seenTexts.add(text.toLowerCase());
      }
    }
  }

  // Pattern 5: ALL-CAPS acronyms (OBS, ONNX, AGPL, LLM)
  if (implicitPatterns.includes('acronyms')) {
    const acronymRegex = /\b([A-Z]{3,})\b/g;
    let match: RegExpExecArray | null;
    while ((match = acronymRegex.exec(content)) !== null) {
      const text = match[1];
      // Skip long ALL-CAPS words (>5 chars) — likely English words in caps, not acronyms
      // Real acronyms are typically 2-5 chars (API, SQL, LLM, ONNX)
      if (text.length > 5) continue;
      const start = match.index;
      const end = start + text.length;
      if (!shouldExclude(text) && !isProtected(start, end)) {
        detected.push({ text, start, end, pattern: 'acronyms' });
        seenTexts.add(text.toLowerCase());
      }
    }
  }

  // Pattern 6: Ticket/issue references (FW-123, PROJ-456, JIRA-1234)
  if (implicitPatterns.includes('ticket-refs')) {
    const ticketRegex = /\b([A-Z]{2,6}-\d{1,6})\b/g;
    let match: RegExpExecArray | null;
    while ((match = ticketRegex.exec(content)) !== null) {
      const text = match[1];
      const start = match.index;
      const end = start + text.length;
      if (!shouldExclude(text) && !isProtected(start, end)) {
        detected.push({ text, start, end, pattern: 'ticket-refs' });
        seenTexts.add(text.toLowerCase());
      }
    }
  }

  // Sort by position (earliest first; longest first at same position)
  detected.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return (b.end - b.start) - (a.end - a.start);
  });

  // Filter overlapping matches — prefer longer matches (earlier in sorted order at same position)
  const filtered: ImplicitEntityMatch[] = [];
  for (const match of detected) {
    const overlaps = filtered.some(existing => overlapsExistingLink(match, existing));
    if (!overlaps) {
      filtered.push(match);
    }
  }

  return filtered;
}

/**
 * Process wikilinks with support for both existing entities and implicit detection
 *
 * This is the main entry point that combines:
 * 1. applyWikilinks() for known entities from the vault index
 * 2. detectImplicitEntities() for pattern-based detection
 *
 * @param content - The markdown content to process
 * @param entities - List of known entity names or Entity objects
 * @param options - Extended options including implicit entity config
 * @returns Result with updated content and statistics
 */
export function processWikilinks(
  content: string,
  entities: Entity[],
  options: ExtendedWikilinkOptions = {}
): WikilinkResult {
  const {
    detectImplicit = false,
    implicitPatterns,
    excludePatterns,
    minEntityLength,
    notePath,
    ...wikilinkOptions
  } = options;

  // Step 1: Apply wikilinks for known entities
  const result = applyWikilinks(content, entities, wikilinkOptions);

  // If implicit detection is disabled, return the basic result
  if (!detectImplicit) {
    return result;
  }

  // Step 2: Detect implicit entities in the already-processed content
  const implicitMatches = detectImplicitEntities(result.content, {
    detectImplicit: true,
    implicitPatterns,
    excludePatterns,
    minEntityLength,
  });

  if (implicitMatches.length === 0) {
    return result;
  }

  // Step 3: Build set of already-linked entities (case-insensitive)
  const alreadyLinked = new Set(
    result.linkedEntities.map(e => e.toLowerCase())
  );

  // Also add all known entity names to avoid duplicate linking
  for (const entity of entities) {
    const name = typeof entity === 'string' ? entity : entity.name;
    alreadyLinked.add(name.toLowerCase());
  }

  // Get current note name if provided (to avoid self-links)
  const currentNoteName = notePath
    ? notePath.replace(/\.md$/, '').split('/').pop()?.toLowerCase()
    : null;

  // Step 4: Filter implicit matches that don't conflict with existing links
  const newImplicitMatches = filterNewImplicitMatches(implicitMatches, alreadyLinked, currentNoteName);

  if (newImplicitMatches.length === 0) {
    return result;
  }

  // Step 4b: Filter overlapping matches (defense-in-depth)
  const nonOverlapping: typeof newImplicitMatches = [];
  for (const match of newImplicitMatches) {
    const overlaps = nonOverlapping.some(existing => overlapsExistingLink(match, existing));
    if (!overlaps) {
      nonOverlapping.push(match);
    }
  }

  if (nonOverlapping.length === 0) {
    return result;
  }

  // Step 5: Apply implicit wikilinks (process from end to preserve positions)
  let processedContent = result.content;
  const implicitEntities: string[] = [];

  // Process from end to start
  for (let i = nonOverlapping.length - 1; i >= 0; i--) {
    const match = nonOverlapping[i];

    // Replace the matched span (quotes included for quoted terms) with [[Term]]
    const wikilink = `[[${match.text}]]`;
    const replaceStart = match.start;
    const replaceEnd = match.end;

    processedContent =
      processedContent.slice(0, replaceStart) +
      wikilink +
      processedContent.slice(replaceEnd);

    if (!implicitEntities.includes(match.text)) {
      implicitEntities.push(match.text);
    }
  }

  return {
    content: processedContent,
    linksAdded: result.linksAdded + nonOverlapping.length,
    linkedEntities: result.linkedEntities,
    implicitEntities,
  };
}

// ============================================================================
// Thread-marker linking (🧵#thr-<hex> / 🧵#<handle>)
// ============================================================================

/**
 * Matches engine thread markers: `🧵#thr-<10 hex>` (guid form) or
 * `🧵#<adjective>-<noun>[-N]` (speakable handle form). The emoji+`#` prefix
 * makes false positives effectively impossible, so markers link on EVERY
 * occurrence — each one is an explicit reference.
 *
 * NOTE: this is deliberately NOT routed through findEntityMatches — `\b`
 * word boundaries cannot anchor against the emoji/`#` prefix, and
 * shouldExcludeEntity rejects lowercase-hyphenated terms (correctly, for
 * prose) which would block both marker forms.
 */
export const THREAD_MARKER_RE = /🧵#(thr-[0-9a-fA-F]{10}|[a-z]+-[a-z]+(?:-\d+)?)/gu;

/**
 * Link thread markers in content to their thread notes.
 *
 * @param content - markdown to process
 * @param resolveThread - maps the marker ref (e.g. "thr-a1b2c3d4e5" or
 *   "amber-anchor") to the link target (note stem or vault-relative path
 *   without .md), or null when unknown — unresolved markers are left as-is,
 *   never turned into dead links.
 * @returns WikilinkResult; linkedTerms carries the full marker (🧵#…) as the
 *   matched term for feedback tracking.
 */
export function applyThreadMarkerLinks(
  content: string,
  resolveThread: (ref: string) => string | null,
): WikilinkResult {
  // The marker's own `#thr-…` registers as a hashtag protected zone — drop
  // hashtag zones that immediately follow the 🧵 emoji (they ARE the marker),
  // while keeping genuine hashtags, code fences, and existing wikilinks
  // protected. '🧵' is two UTF-16 code units.
  const zones = getProtectedZones(content).filter(
    z => !(z.type === 'hashtag' && content.slice(Math.max(0, z.start - 2), z.start) === '🧵'),
  );
  const linkedEntities: string[] = [];
  const linkedTerms: Array<{ entity: string; matchedTerm: string }> = [];
  let linksAdded = 0;

  const out = content.replace(THREAD_MARKER_RE, (matched, ref: string, offset: number) => {
    // Skip markers inside code fences, inline code, existing wikilinks, etc.
    if (rangeOverlapsProtectedZone(offset, offset + matched.length, zones)) return matched;
    const target = resolveThread(ref);
    if (!target) return matched;
    linksAdded++;
    if (!linkedEntities.includes(target)) linkedEntities.push(target);
    linkedTerms.push({ entity: target, matchedTerm: matched });
    // Display text keeps the human-visible marker; target is the real note.
    return `[[${target}|${matched}]]`;
  });

  return { content: out, linksAdded, linkedEntities, linkedTerms };
}
