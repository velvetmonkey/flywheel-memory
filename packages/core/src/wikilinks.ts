/**
 * Wikilink application logic
 *
 * Applies [[wikilinks]] to known entities in content while
 * respecting protected zones (code, frontmatter, existing links, etc.)
 *
 * Also supports:
 * - Pattern-based detection for implicit entities (proper nouns, quoted terms)
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

/**
 * Get all search terms for an entity (name + aliases)
 * Returns tuples of [searchTerm, entityName] for proper linking
 */
function getSearchTerms(entity: Entity): Array<{ term: string; entityName: string }> {
  if (typeof entity === 'string') {
    return [{ term: entity, entityName: entity }];
  }

  // Include the entity name and all aliases
  const terms: Array<{ term: string; entityName: string }> = [
    { term: entity.name, entityName: entity.name }
  ];

  for (const alias of entity.aliases) {
    terms.push({ term: alias, entityName: entity.name });
  }

  return terms;
}

/**
 * Common words to exclude from wikilink suggestions
 */
const EXCLUDE_WORDS = new Set([
  // Day names
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  // Month names
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  // Temporal words
  'today', 'tomorrow', 'yesterday', 'week', 'month', 'year',
  // Periodic review compounds
  'month end', 'month start', 'year end', 'year start',
  'quarter end', 'quarter start', 'quarterly review',
  'weekly review', 'monthly review', 'annual review',
  // Stop words
  'the', 'and', 'for', 'with', 'from', 'this', 'that',
  'christmas', 'holiday', 'break',
]);

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check if an entity should be excluded from wikilikning
 */
function shouldExcludeEntity(entity: string): boolean {
  return EXCLUDE_WORDS.has(entity.toLowerCase());
}

/**
 * Find all matches of an entity in content with word boundaries
 */
const BRACKET_CHARS = new Set(['(', ')', '[', ']', '{', '}']);

function findEntityMatches(
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
  } = options;

  if (!entities.length) {
    return {
      content,
      linksAdded: 0,
      linkedEntities: [],
    };
  }

  // Build search terms from all entities (names + aliases)
  // Each term maps back to its canonical entity name
  const allSearchTerms: Array<{ term: string; entityName: string }> = [];
  for (const entity of entities) {
    const terms = getSearchTerms(entity);
    for (const t of terms) {
      if (!shouldExcludeEntity(t.term)) {
        allSearchTerms.push(t);
      }
    }
  }

  // Sort by term length (longest first) to avoid partial matches
  allSearchTerms.sort((a, b) => b.term.length - a.term.length);

  // Get protected zones
  let zones = getProtectedZones(content);

  let result = content;
  let linksAdded = 0;
  const linkedEntities: string[] = [];

  if (firstOccurrenceOnly) {
    // For firstOccurrenceOnly mode, we need to find the earliest match across
    // all terms (name + aliases) for each entity, then link that one
    // Also need to handle overlapping matches between different entities

    // First, collect ALL valid matches for each entity (name + aliases combined)
    const entityAllMatches = new Map<string, Array<{ term: string; match: { start: number; end: number; matched: string } }>>();

    for (const { term, entityName } of allSearchTerms) {
      const entityKey = entityName.toLowerCase();

      // Find all matches of the search term
      const matches = findEntityMatches(result, term, caseInsensitive);

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
        existing =>
          (candidate.match.start >= existing.match.start && candidate.match.start < existing.match.end) ||
          (candidate.match.end > existing.match.start && candidate.match.end <= existing.match.end) ||
          (candidate.match.start <= existing.match.start && candidate.match.end >= existing.match.end)
      );

      if (!overlaps) {
        selectedMatches.push(candidate);
        selectedEntityNames.add(entityKey);
      }
    }

    // Sort by position from end to start to preserve offsets when inserting
    selectedMatches.sort((a, b) => b.match.start - a.match.start);

    for (const { entityName, term: _term, match } of selectedMatches) {
      // Use display text format when matched text differs from entity name
      const matchedTextLower = match.matched.toLowerCase();
      const entityNameLower = entityName.toLowerCase();
      const wikilink = matchedTextLower === entityNameLower
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
    }
  } else {
    // For all occurrences mode, process each term
    for (const { term, entityName } of allSearchTerms) {
      // Find all matches of the search term
      const matches = findEntityMatches(result, term, caseInsensitive);

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
        // Use display text format when matched text differs from entity name
        const matchedTextLower = match.matched.toLowerCase();
        const entityNameLower = entityName.toLowerCase();
        const wikilink = matchedTextLower === entityNameLower
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
      }
    }
  }

  return {
    content: result,
    linksAdded,
    linkedEntities,
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
  const allSearchTerms: Array<{ term: string; entityName: string }> = [];
  for (const entity of entities) {
    const terms = getSearchTerms(entity);
    for (const t of terms) {
      if (!shouldExcludeEntity(t.term)) {
        allSearchTerms.push(t);
      }
    }
  }

  // Sort by term length (longest first) to prioritize longer matches
  allSearchTerms.sort((a, b) => b.term.length - a.term.length);

  // Get protected zones
  const zones = getProtectedZones(content);

  if (firstOccurrenceOnly) {
    // For firstOccurrenceOnly mode, find the earliest match across all terms
    // for each entity, similar to applyWikilinks behavior
    const entityAllMatches = new Map<string, Array<{ match: { start: number; end: number }; entityName: string }>>();

    for (const { term, entityName } of allSearchTerms) {
      const entityKey = entityName.toLowerCase();
      const matches = findEntityMatches(content, term, caseInsensitive);

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
  for (const { term, entityName } of allSearchTerms) {
    const matches = findEntityMatches(content, term, caseInsensitive);

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

  for (const entity of entities) {
    if (typeof entity === 'string') continue;

    for (const alias of entity.aliases) {
      const key = caseInsensitive ? alias.toLowerCase() : alias;
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
  excludePatterns: ['^The ', '^A ', '^An ', '^This ', '^That ', '^These ', '^Those '],
  minEntityLength: 3,
};

/**
 * Common words that should not be detected as implicit entities
 */
const IMPLICIT_EXCLUDE_WORDS = new Set([
  // Days and months (already in EXCLUDE_WORDS but duplicated for safety)
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  // Common sentence starters
  'this', 'that', 'these', 'those', 'there', 'here', 'when', 'where', 'what',
  'which', 'while', 'since', 'after', 'before', 'during', 'until', 'because',
  'however', 'therefore', 'although', 'though', 'unless', 'whether',
  // Common proper-looking words that aren't entities
  'note', 'notes', 'example', 'chapter', 'section', 'part', 'item', 'figure',
  'table', 'list', 'step', 'task', 'todo', 'idea', 'thought', 'question',
  'answer', 'summary', 'overview', 'introduction', 'conclusion',
  // Technical terms that look like proper nouns
  'true', 'false', 'null', 'undefined', 'none', 'class', 'function', 'method',
  // Common short words that appear as ALL-CAPS but aren't entities
  'the', 'and', 'but', 'for', 'not', 'you', 'all', 'can', 'had', 'her',
  'was', 'one', 'our', 'out', 'are', 'has', 'his', 'how', 'its', 'may',
  'new', 'now', 'old', 'see', 'way', 'who', 'did', 'got', 'let', 'say',
  // Common abbreviations that aren't entities
  'etc', 'aka', 'btw', 'fyi', 'imo', 'tldr', 'asap', 'rsvp',
  'url', 'html', 'css', 'http', 'https', 'json', 'xml', 'sql', 'ssh', 'tcp', 'udp', 'dns',
]);

/**
 * Words that commonly start sentences but should not start a proper noun entity.
 * These are checked separately because they might appear capitalized at sentence start.
 */
const SENTENCE_STARTER_WORDS = new Set([
  'visit', 'also', 'see', 'please', 'note', 'check', 'read', 'look', 'find',
  'get', 'set', 'add', 'use', 'try', 'make', 'take', 'give', 'keep', 'let',
  'call', 'run', 'ask', 'tell', 'show', 'help', 'need', 'want', 'like',
  'think', 'know', 'feel', 'seem', 'look', 'hear', 'watch', 'wait', 'work',
  'start', 'stop', 'open', 'close', 'move', 'turn', 'bring', 'send', 'leave',
  'meet', 'join', 'follow', 'include', 'consider', 'remember', 'forget',
]);

/**
 * Detect implicit entities in content using pattern matching
 *
 * This finds potential entities that don't have existing files:
 * - Multi-word proper nouns (e.g., "Marcus Johnson", "Project Alpha")
 * - Single capitalized words after lowercase (e.g., "discussed with Marcus")
 * - Quoted terms (e.g., "Turbopump" becomes [[Turbopump]])
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

    // Common words
    if (IMPLICIT_EXCLUDE_WORDS.has(text.toLowerCase())) return true;

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
    const properNounRegex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
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
      // Include the quotes in the position for replacement
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
      const start = match.index;
      const end = start + text.length;
      if (!shouldExclude(text) && !isProtected(start, end)) {
        detected.push({ text, start, end, pattern: 'acronyms' });
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
    const overlaps = filtered.some(
      existing =>
        (match.start >= existing.start && match.start < existing.end) ||
        (match.end > existing.start && match.end <= existing.end) ||
        (match.start <= existing.start && match.end >= existing.end)
    );
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
  const newImplicitMatches = implicitMatches.filter(match => {
    const normalized = match.text.toLowerCase();

    // Skip if already linked as known entity
    if (alreadyLinked.has(normalized)) return false;

    // Skip self-links
    if (currentNoteName && normalized === currentNoteName) return false;

    return true;
  });

  if (newImplicitMatches.length === 0) {
    return result;
  }

  // Step 4b: Filter overlapping matches (defense-in-depth)
  const nonOverlapping: typeof newImplicitMatches = [];
  for (const match of newImplicitMatches) {
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

  if (nonOverlapping.length === 0) {
    return result;
  }

  // Step 5: Apply implicit wikilinks (process from end to preserve positions)
  let processedContent = result.content;
  const implicitEntities: string[] = [];

  // Process from end to start
  for (let i = nonOverlapping.length - 1; i >= 0; i--) {
    const match = nonOverlapping[i];

    // For quoted terms, we replace "Term" with [[Term]]
    // For other patterns, we replace Term with [[Term]]
    let wikilink: string;
    let replaceStart: number;
    let replaceEnd: number;

    if (match.pattern === 'quoted-terms') {
      // Replace "Term" with [[Term]] (remove quotes)
      wikilink = `[[${match.text}]]`;
      replaceStart = match.start;
      replaceEnd = match.end;
    } else {
      // Replace Term with [[Term]]
      wikilink = `[[${match.text}]]`;
      replaceStart = match.start;
      replaceEnd = match.end;
    }

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
