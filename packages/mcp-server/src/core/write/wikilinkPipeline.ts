/**
 * Wikilink write-pipeline orchestration (arch-review G5, part F2)
 *
 * Validation/sanitization/prioritization of wikilink text plus the
 * mutation-time processing entry points (processWikilinks /
 * maybeApplyWikilinks) used by the write tools.
 */

import {
  getAllEntities,
  getEntityName,
  getEntityAliases,
  applyWikilinks,
  resolveAliasWikilinks,
  detectImplicitEntities,
  filterNewImplicitMatches,
  overlapsExistingLink,
  getEntitiesByAlias,
  applyThreadMarkerLinks,
  type Entity,
  type WikilinkResult,
} from '@velvetmonkey/vault-core';
import { isSuppressed, getSuppressedAliasTerms, trackWikilinkApplications } from './wikilinkFeedback.js';
import { getCorrectedEntityNotePairs } from './corrections.js';
import {
  getWriteStateDb,
  getConfig,
  getScopedEntityIndex,
  isEntityIndexReady,
  checkAndRefreshIfStale,
} from './wikilinkState.js';
import { getCrossFolderBoost, getHubBoost, getNoteContext } from './wikilinkScoringConfig.js';

const ALL_IMPLICIT_PATTERNS = ['proper-nouns', 'single-caps', 'camel-case', 'acronyms', 'quoted-terms', 'ticket-refs'] as const;

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
  const scopedEntityIndex = getScopedEntityIndex();
  if (!isEntityIndexReady() || !scopedEntityIndex) {
    return {
      content,
      linksAdded: 0,
      linkedEntities: [],
    };
  }

  let entities = getAllEntities(scopedEntityIndex);

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

  // Step 0: Thread-marker pass — 🧵#thr-<hex> / 🧵#<handle> markers resolve
  // via the thread note's frontmatter aliases (engine writes the marker
  // forms as aliases). Runs FIRST: markers can't be matched by the normal
  // alias path (word boundaries + lowercase-hyphen exclusion) and must link
  // on every occurrence. Unresolved markers stay plain text.
  let markerResult: WikilinkResult | null = null;
  let working = content;
  if (stateDb) {
    markerResult = applyThreadMarkerLinks(content, (ref) => {
      const hits = getEntitiesByAlias(stateDb, `🧵#${ref}`);
      if (hits.length !== 1) return null; // ambiguous or unknown → leave as-is
      // Link target: note stem (matches how applyWikilinks targets entities)
      return hits[0].name;
    });
    working = markerResult.content;
  }

  // Per-alias suppression: one bad alias must not poison the whole entity —
  // drop only the suppressed (entity, term) pairs inside applyWikilinks.
  const suppressedTerms = stateDb ? getSuppressedAliasTerms(stateDb) : undefined;

  // Step 1: Resolve existing wikilinks that use aliases (case-insensitive)
  // [[model context protocol]] → [[MCP|model context protocol]]
  const resolved = resolveAliasWikilinks(working, sortedEntities, {
    caseInsensitive: true,
  });

  // Step 2: Apply wikilinks to plain text (normal processing)
  // Pass entities resolved by Step 1 as alreadyLinked so firstOccurrenceOnly
  // treats them as already seen and won't link a second occurrence.
  const step1LinkedEntities = new Set(resolved.linkedEntities.map(e => e.toLowerCase()));
  // Thread notes linked by the marker pass count as already linked.
  if (markerResult) {
    for (const e of markerResult.linkedEntities) step1LinkedEntities.add(e.toLowerCase());
  }

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
    suppressedTerms,
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

  let newImplicits = filterNewImplicitMatches(implicitMatches, alreadyLinked, currentNoteName);

  // Filter overlapping matches (defense-in-depth)
  const nonOverlapping: typeof newImplicits = [];
  for (const match of newImplicits) {
    const overlaps = nonOverlapping.some(existing => overlapsExistingLink(match, existing));
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

  const markerLinks = markerResult?.linksAdded ?? 0;
  const totalLinksAdded = markerLinks + resolved.linksAdded + result.linksAdded + (newImplicits.length - removed.length);

  return {
    content: sanitizedContent,
    linksAdded: Math.max(0, totalLinksAdded),
    linkedEntities: [
      ...(markerResult?.linkedEntities ?? []),
      ...resolved.linkedEntities,
      ...result.linkedEntities,
    ],
    linkedTerms: [
      ...(markerResult?.linkedTerms ?? []),
      ...(result.linkedTerms ?? []),
    ],
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
    // Track applications for implicit feedback detection — carry the
    // matched term so per-alias feedback/suppression can attribute it.
    const stateDb = getWriteStateDb();
    if (stateDb && notePath) {
      if (result.linkedTerms?.length) {
        trackWikilinkApplications(stateDb, notePath, result.linkedTerms);
      } else {
        trackWikilinkApplications(stateDb, notePath, result.linkedEntities);
      }
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
