/**
 * Query tools - unified search across metadata, content, and entities
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex, VaultNote } from '../../core/read/types.js';
import { MAX_LIMIT } from '../../core/read/constants.js';
import { requireIndex } from '../../core/read/indexGuard.js';
import {
  searchFTS5,
  buildFTS5Index,
  isIndexStale,
  getFTS5State,
  type FTS5Result,
} from '../../core/read/fts5.js';
import {
  searchEntities,
  searchEntitiesPrefix,
  type StateDb,
  type EntitySearchResult,
} from '@velvetmonkey/vault-core';
import {
  semanticSearch,
  hasEmbeddingsIndex,
  reciprocalRankFusion,
  loadNoteEmbeddingsForPaths,
  embedTextCached,
  findSemanticallySimilarEntities,
  hasEntityEmbeddingsIndex,
  type ScoredNote,
} from '../../core/read/embeddings.js';
import {
  enrichResult,
  enrichResultLight,
  enrichResultCompact,
  enrichEntityCompact,
} from '../../core/read/enrichment.js';
import { multiHopBackfill, extractExpansionTerms, expandQuery } from '../../core/read/multihop.js';
import { getStoredNoteLinks, getAllFeedbackBoosts } from '../../core/write/wikilinkFeedback.js';
import { getCooccurrenceBoost } from '../../core/shared/cooccurrence.js';
import { getCooccurrenceIndex } from '../../core/write/wikilinks.js';
import { getRecencyBoost, loadRecencyFromStateDb } from '../../core/shared/recency.js';
import { getEntityEdgeWeightMap } from '../../core/write/edgeWeights.js';
import { extractBestSnippets, extractDates } from '../../core/read/snippets.js';
import { selectByMmr } from '../../core/read/mmr.js';
import { tokenize } from '../../core/shared/stemmer.js';
import { searchMemories, type Memory } from '../../core/write/memory.js';
import { getSectionContent } from './structure.js';


/**
 * Determine whether multi-hop backfill should run for a query + result set.
 *
 * Triggers on:
 * - Sparse results (< 3, existing behavior)
 * - Bridge structure: top results reference entities absent from the query
 * - Low diversity: top results cluster in the same folder/conversation
 */
function shouldRunMultiHop(
  query: string,
  results: Array<Record<string, unknown>>,
  index: VaultIndex,
): boolean {
  // Always run when results are sparse
  if (results.length < 3) return true;

  // Skip if already have many results — backfill won't help
  if (results.length >= 8) return false;

  // Check for bridge structure: do top results reference entities
  // that the query doesn't mention?
  const queryLower = query.toLowerCase();
  const topResults = results.slice(0, 5);
  let bridgeSignals = 0;
  for (const r of topResults) {
    const outlinks = r.outlink_names as string[] | undefined;
    if (!outlinks) continue;
    for (const name of outlinks) {
      if (name.length >= 3 && !queryLower.includes(name.toLowerCase())) {
        bridgeSignals++;
      }
    }
  }
  if (bridgeSignals >= 3) return true;

  // Check for low diversity: all top results in the same folder
  const folders = new Set<string>();
  for (const r of topResults) {
    const p = r.path as string;
    if (p) {
      const folder = p.split('/').slice(0, -1).join('/');
      folders.add(folder);
    }
  }
  if (folders.size === 1 && topResults.length >= 3) return true;

  return false;
}

/**
 * Apply graph signal re-ranking to search results.
 * Adds cooccurrence, recency, feedback, and edge weight boosts,
 * then re-sorts by combined score.
 */
function applyGraphReranking(
  results: Array<Record<string, unknown>>,
  stateDb: StateDb | null,
): void {
  if (!stateDb) return;

  const cooccurrenceIndex = getCooccurrenceIndex();
  const recencyIndex = loadRecencyFromStateDb();
  const feedbackBoosts = getAllFeedbackBoosts(stateDb);
  const edgeWeightMap = getEntityEdgeWeightMap(stateDb);

  if (!cooccurrenceIndex && !recencyIndex) return;

  // Build seed set from result titles/paths
  const seedEntities = new Set<string>();
  for (const r of results) {
    const name = (r.title as string) || (r.path as string)?.replace(/\.md$/, '').split('/').pop() || '';
    if (name) seedEntities.add(name);
  }

  for (const r of results) {
    const name = (r.title as string) || (r.path as string)?.replace(/\.md$/, '').split('/').pop() || '';
    let graphBoost = 0;
    if (cooccurrenceIndex) graphBoost += getCooccurrenceBoost(name, seedEntities, cooccurrenceIndex, recencyIndex);
    if (recencyIndex) graphBoost += getRecencyBoost(name, recencyIndex);
    graphBoost += feedbackBoosts.get(name) ?? 0;
    const avgWeight = edgeWeightMap.get(name.toLowerCase());
    if (avgWeight && avgWeight > 1.0) graphBoost += Math.min((avgWeight - 1.0) * 3, 6);

    if (graphBoost > 0) {
      r.graph_boost = graphBoost;
      const baseScore = (r.rrf_score as number) ?? 0;
      r._combined_score = baseScore + (graphBoost / 50);
    }
  }

  results.sort((a, b) =>
    ((b._combined_score as number) ?? (b.rrf_score as number) ?? 0) -
    ((a._combined_score as number) ?? (a.rrf_score as number) ?? 0)
  );
}

/**
 * U-shaped reorder: distribute results so the highest-ranked items land at
 * positions 1 and N (the attention peaks), while the lowest-ranked items
 * sit in the middle (the attention trough).
 *
 * Given score-sorted input [1,2,3,4,5,6,7,8], produces [1,3,5,7,8,6,4,2].
 * Odd-ranked items fill from the front, even-ranked from the back.
 *
 * Research: LLMs have a U-shaped attention curve — 30%+ accuracy drop for
 * information placed in middle positions. (Liu et al. 2024, "Lost in the Middle")
 */
export function applySandwichOrdering(results: Array<Record<string, unknown>>): void {
  if (results.length < 3) return;
  const n = results.length;
  const out = new Array<Record<string, unknown>>(n);
  let front = 0;
  let back = n - 1;
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) {
      out[front++] = results[i];
    } else {
      out[back--] = results[i];
    }
  }
  for (let i = 0; i < n; i++) {
    results[i] = out[i];
  }
}

/**
 * Compute entity-mediated bridges between results.
 * For each result pair, find entities (outlink targets) that appear in both notes.
 * This is the key signal for multi-hop reasoning — tells the agent HOW results connect.
 */
function applyEntityBridging(
  results: Array<Record<string, unknown>>,
  stateDb: StateDb | null,
  maxBridgesPerResult: number = 5,
): void {
  if (!stateDb || results.length < 2) return;

  // Build map: note_path → set of outlink targets
  const linkMap = new Map<string, Set<string>>();
  try {
    const paths = results.map(r => r.path as string).filter(Boolean);
    for (const path of paths) {
      const rows = stateDb.db.prepare(
        'SELECT target FROM note_links WHERE note_path = ?'
      ).all(path) as Array<{ target: string }>;
      linkMap.set(path, new Set(rows.map(r => r.target)));
    }
  } catch { return; /* best-effort */ }

  // For each result, find entities shared with other results
  for (const r of results) {
    const myPath = r.path as string;
    const myLinks = linkMap.get(myPath);
    if (!myLinks || myLinks.size === 0) continue;

    const bridges: Array<{ entity: string; in_result: string }> = [];
    for (const other of results) {
      const otherPath = other.path as string;
      if (otherPath === myPath) continue;
      const otherLinks = linkMap.get(otherPath);
      if (!otherLinks) continue;

      // Find intersection
      for (const entity of myLinks) {
        if (otherLinks.has(entity) && bridges.length < maxBridgesPerResult) {
          bridges.push({ entity, in_result: otherPath });
        }
      }
      if (bridges.length >= maxBridgesPerResult) break;
    }

    if (bridges.length > 0) {
      r.bridges = bridges;
    }
  }
}

/**
 * Strip internal scoring/provenance fields that waste context tokens.
 * Results are already sorted by these scores; exposing them adds no agent value.
 */
function stripInternalFields(results: Array<Record<string, unknown>>): void {
  const INTERNAL = ['rrf_score', 'in_fts5', 'in_semantic', 'in_entity', 'graph_boost', '_combined_score'];
  for (const r of results) {
    for (const key of INTERNAL) delete r[key];
  }
}

/**
 * Score and rank memory search results.
 * Ported from recall.ts Channel 3 scoring logic.
 * BM25 handles text relevance; this re-ranks by confidence + type boost.
 */
function scoreAndRankMemories(memories: Memory[], limit: number): Array<Record<string, unknown>> {
  const now = Date.now();
  const scored: Array<{ memory: Memory; score: number }> = [];

  for (const m of memories) {
    const confidenceBoost = m.confidence * 5;
    let typeBoost = 0;
    switch (m.memory_type) {
      case 'fact': typeBoost = 3; break;
      case 'preference': typeBoost = 2; break;
      case 'observation': {
        const ageDays = (now - m.updated_at) / 86400000;
        const recencyFactor = Math.max(0.2, 1 - ageDays / 7);
        typeBoost = 1 + (4 * recencyFactor);
        break;
      }
      case 'summary': typeBoost = 1; break;
    }
    scored.push({ memory: m, score: confidenceBoost + typeBoost });
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(({ memory: m }) => {
    const result: Record<string, unknown> = {
      key: m.key,
      value: m.value,
      type: m.memory_type,
    };
    if (m.entity) result.entity = m.entity;
    if (m.entities_json) {
      try {
        const entities = JSON.parse(m.entities_json);
        if (Array.isArray(entities) && entities.length > 0) result.entities = entities;
      } catch { /* skip malformed */ }
    }
    return result;
  });
}

/**
 * Build enriched entity section from entity search results.
 * Adds semantic entity search for longer queries when embeddings available.
 * Ported from recall.ts Channel 1 + Channel 4.
 */
async function buildEntitySection(
  entityResults: EntitySearchResult[],
  query: string,
  stateDb: StateDb | null,
  index: VaultIndex,
  limit: number,
): Promise<Array<Record<string, unknown>>> {
  if (!stateDb || entityResults.length === 0 && query.length < 20) return [];

  // Start with FTS5 entity results (keyed by lowercase name for dedup)
  const entityMap = new Map<string, EntitySearchResult>();
  for (const e of entityResults) {
    entityMap.set(e.name.toLowerCase(), e);
  }

  // Channel 4: Semantic entity search (for longer queries)
  if (query.length >= 20 && hasEntityEmbeddingsIndex()) {
    try {
      const embedding = await embedTextCached(query);
      const semanticMatches = findSemanticallySimilarEntities(embedding, limit);
      for (const match of semanticMatches) {
        if (match.similarity < 0.3) continue;
        const key = match.entityName.toLowerCase();
        if (!entityMap.has(key)) {
          entityMap.set(key, {
            id: 0, name: match.entityName, nameLower: key,
            path: '', category: 'unknown' as EntitySearchResult['category'],
            aliases: [], hubScore: 0, rank: 0,
          });
        }
      }
    } catch { /* semantic search failure is non-fatal */ }
  }

  if (entityMap.size === 0) return [];

  // Enrich and return (capped at limit)
  const enriched: Array<Record<string, unknown>> = [];
  let count = 0;
  for (const [, entity] of entityMap) {
    if (count >= limit) break;
    enriched.push({
      name: entity.name,
      ...(entity.description ? { description: entity.description } : {}),
      ...enrichEntityCompact(entity.name, stateDb, index),
    });
    count++;
  }

  return enriched;
}

/**
 * Enhance snippets with semantic + token matching when embeddings are available.
 * Falls back to existing FTS5 snippets when embeddings are not built.
 */
async function enhanceSnippets(
  results: Array<Record<string, unknown>>,
  query: string,
  vaultPath: string,
): Promise<void> {
  if (!hasEmbeddingsIndex()) return;

  const queryTokens = tokenize(query).map(t => t.toLowerCase());
  let queryEmb: Float32Array | null = null;
  try { queryEmb = await embedTextCached(query); } catch { /* non-fatal */ }

  for (const r of results) {
    if (!r.path) continue;
    try {
      const snippets = await extractBestSnippets(`${vaultPath}/${r.path}`, queryEmb, queryTokens);
      if (snippets.length > 0 && snippets[0].text.length > 0) {
        r.snippet = snippets[0].text;
        if (snippets[0].section) r.section = snippets[0].section;
        if (snippets[0].confidence != null) r.snippet_confidence = Math.round(snippets[0].confidence * 100) / 100;
        // Extract dates from snippet text
        const dates = extractDates(snippets[0].text);
        if (dates.length > 0) r.dates_mentioned = dates;
      }
    } catch { /* non-fatal */ }
  }
}

/**
 * Expand top-N results from snippet to full section content.
 * The snippet is the precision signal (which paragraph matched); the section
 * provides surrounding context so the LLM can reason about the match in context.
 * Requires enhanceSnippets() to have run first (populates r.section).
 */
async function expandToSections(
  results: Array<Record<string, unknown>>,
  index: VaultIndex,
  vaultPath: string,
  maxExpand: number = 5,
  maxSectionChars: number = 2500,
): Promise<void> {
  const toExpand = results.slice(0, maxExpand);
  for (const r of toExpand) {
    const sectionHeading = r.section as string | undefined;
    const notePath = r.path as string | undefined;
    if (!sectionHeading || !notePath) continue;
    try {
      const section = await getSectionContent(index, notePath, sectionHeading, vaultPath, true);
      if (!section || !section.content) continue;
      const heading = `## ${section.heading}`;
      let content = section.content;
      if (content.length > maxSectionChars) {
        // Truncate at last paragraph boundary within budget
        const truncated = content.slice(0, maxSectionChars);
        const lastBreak = truncated.lastIndexOf('\n\n');
        content = (lastBreak > 0 ? truncated.slice(0, lastBreak) : truncated) + '\n\u2026';
      }
      r.section_content = `${heading}\n\n${content}`;
    } catch { /* non-fatal — disk read failure or missing file */ }
  }
}

/**
 * Check if a note matches frontmatter filters
 */
function matchesFrontmatter(
  note: VaultNote,
  where: Record<string, unknown>
): boolean {
  for (const [key, value] of Object.entries(where)) {
    const noteValue = note.frontmatter[key];

    // Handle null/undefined
    if (value === null || value === undefined) {
      if (noteValue !== null && noteValue !== undefined) {
        return false;
      }
      continue;
    }

    // Handle arrays - check if any value matches
    if (Array.isArray(noteValue)) {
      if (!noteValue.some((v) => String(v).toLowerCase() === String(value).toLowerCase())) {
        return false;
      }
      continue;
    }

    // Handle string comparison (case-insensitive)
    if (typeof value === 'string' && typeof noteValue === 'string') {
      if (noteValue.toLowerCase() !== value.toLowerCase()) {
        return false;
      }
      continue;
    }

    // Handle other types (exact match)
    if (noteValue !== value) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a note has a specific tag.
 * When includeChildren is true, also matches child tags (e.g., "project" matches "project/active").
 */
function hasTag(note: VaultNote, tag: string, includeChildren: boolean = false): boolean {
  const normalizedTag = tag.replace(/^#/, '').toLowerCase();
  return note.tags.some((t) => {
    const normalizedNoteTag = t.toLowerCase();
    if (normalizedNoteTag === normalizedTag) return true;
    if (includeChildren && normalizedNoteTag.startsWith(normalizedTag + '/')) return true;
    return false;
  });
}

/**
 * Check if a note has any of the specified tags
 */
function hasAnyTag(note: VaultNote, tags: string[], includeChildren: boolean = false): boolean {
  return tags.some((tag) => hasTag(note, tag, includeChildren));
}

/**
 * Check if a note has all of the specified tags
 */
function hasAllTags(note: VaultNote, tags: string[], includeChildren: boolean = false): boolean {
  return tags.every((tag) => hasTag(note, tag, includeChildren));
}

/**
 * Check if a note is in a folder
 */
function inFolder(note: VaultNote, folder: string): boolean {
  const normalizedFolder = folder.endsWith('/') ? folder : folder + '/';
  return note.path.startsWith(normalizedFolder) || note.path.split('/')[0] === folder.replace('/', '');
}


/**
 * Sort notes by a field
 */
function sortNotes(
  notes: VaultNote[],
  sortBy: 'modified' | 'created' | 'title',
  order: 'asc' | 'desc'
): VaultNote[] {
  const sorted = [...notes];

  sorted.sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case 'modified':
        comparison = a.modified.getTime() - b.modified.getTime();
        break;
      case 'created':
        const aCreated = a.created || a.modified;
        const bCreated = b.created || b.modified;
        comparison = aCreated.getTime() - bCreated.getTime();
        break;
      case 'title':
        comparison = a.title.localeCompare(b.title);
        break;
    }

    return order === 'desc' ? -comparison : comparison;
  });

  return sorted;
}

/**
 * Register query tools
 */
export function registerQueryTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string,
  getStateDb: () => StateDb | null
): void {
  // ========================================
  // Unified search tool
  // ========================================
  server.tool(
    'search',
    'Search everything — notes, entities, and memories — in one call. Returns a decision surface with three sections: note results (with section provenance, full section content, dates, bridges, confidence), matching entity profiles, and relevant memories.\n\nTop note results carry full metadata (frontmatter, scored backlinks/outlinks, snippets) plus section_content — the complete ## section around the match (up to 2,500 chars). Start with just a query, no filters. Narrow with filters only if needed. Between snippet, section_content, and frontmatter, most questions can be answered without follow-up reads.\n\nSearches note content (FTS5 + hybrid semantic with contextual embeddings), entity profiles (people, projects, technologies), and stored memories. Hybrid results included automatically when embeddings are built (via init_semantic).\n\nExample: search({ query: "quarterly review", limit: 5 })\nExample: search({ where: { type: "project", status: "active" } })\n\nMulti-vault: omitting `vault` searches all vaults and merges results. Pass `vault` to search a specific vault.',
    {
      query: z.string().optional().describe('Search query text. Required unless using metadata filters (where, has_tag, folder, etc.)'),

      // Metadata filters
      where: z.record(z.unknown()).optional().describe('Frontmatter filters as key-value pairs. Example: { "type": "project", "status": "active" }'),
      has_tag: z.string().optional().describe('Filter to notes with this tag'),
      has_any_tag: z.array(z.string()).optional().describe('Filter to notes with any of these tags'),
      has_all_tags: z.array(z.string()).optional().describe('Filter to notes with all of these tags'),
      include_children: z.boolean().default(false).describe('When true, tag filters also match child tags (e.g., has_tag: "project" also matches "project/active")'),
      folder: z.string().optional().describe('Filter results to a folder. Prefer searching without folder first, then add folder to narrow.'),
      title_contains: z.string().optional().describe('Filter to notes whose title contains this text (case-insensitive)'),

      // Date filters (absorbs temporal tools)
      modified_after: z.string().optional().describe('Only notes modified after this date (YYYY-MM-DD)'),
      modified_before: z.string().optional().describe('Only notes modified before this date (YYYY-MM-DD)'),

      // Sorting
      sort_by: z.enum(['modified', 'created', 'title']).default('modified').describe('Field to sort by'),
      order: z.enum(['asc', 'desc']).default('desc').describe('Sort order'),

      // Entity options (prefix mode for autocomplete)
      prefix: z.boolean().default(false).describe('Enable prefix matching for entity search (autocomplete)'),

      // Pagination
      limit: z.number().default(10).describe('Maximum number of results to return'),
      detail_count: z.number().optional().describe('Number of top results to return with full metadata (backlinks, outlinks, headings, frontmatter). Remaining results get lightweight summaries. Default: 5.'),

      // Context boost (edge weights)
      context_note: z.string().optional().describe('Path of the note providing context. When set, results connected to this note via weighted edges get an RRF boost.'),

      // Consumer format
      consumer: z.enum(['llm', 'human']).default('llm').describe('Output format: "llm" applies sandwich ordering and strips scoring fields for context efficiency. "human" preserves score order and all scoring metadata for UI display.'),
    },
    async ({ query, where, has_tag, has_any_tag, has_all_tags, include_children, folder, title_contains, modified_after, modified_before, sort_by, order, prefix, limit: requestedLimit, detail_count: requestedDetailCount, context_note, consumer }) => {
      requireIndex();
      const limit = Math.min(requestedLimit ?? 10, MAX_LIMIT);
      const detailN = requestedDetailCount ?? 5;
      const index = getIndex();
      const vaultPath = getVaultPath();

      // ---- ENTITY AUTOCOMPLETE ----
      if (prefix && query) {
        const stateDb = getStateDb();
        if (!stateDb) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ results: [], count: 0, query, error: 'StateDb not initialized' }, null, 2) }] };
        }
        try {
          const results = searchEntitiesPrefix(stateDb, query, limit);
          return { content: [{ type: 'text' as const, text: JSON.stringify({ query, count: results.length, entities: results }, null, 2) }] };
        } catch (err) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ query, count: 0, entities: [], error: err instanceof Error ? err.message : String(err) }, null, 2) }] };
        }
      }

      // ---- METADATA SEARCH (no query, just filters) ----
      const hasMetadataFilters = where || has_tag || has_any_tag || has_all_tags || title_contains || modified_after || modified_before;

      if (!query && (hasMetadataFilters || folder)) {
        let matchingNotes: VaultNote[] = Array.from(index.notes.values());

        // Apply frontmatter filters
        if (where && Object.keys(where).length > 0) {
          matchingNotes = matchingNotes.filter((note) => matchesFrontmatter(note, where));
        }
        if (has_tag) {
          matchingNotes = matchingNotes.filter((note) => hasTag(note, has_tag, include_children));
        }
        if (has_any_tag && has_any_tag.length > 0) {
          matchingNotes = matchingNotes.filter((note) => hasAnyTag(note, has_any_tag, include_children));
        }
        if (has_all_tags && has_all_tags.length > 0) {
          matchingNotes = matchingNotes.filter((note) => hasAllTags(note, has_all_tags, include_children));
        }
        if (folder) {
          matchingNotes = matchingNotes.filter((note) => inFolder(note, folder));
        }
        if (title_contains) {
          const searchTerm = title_contains.toLowerCase();
          matchingNotes = matchingNotes.filter((note) =>
            note.title.toLowerCase().includes(searchTerm)
          );
        }
        // Date filters use local timezone — correct for Obsidian which stores file
        // modification times in the local filesystem's timezone
        if (modified_after) {
          const afterDate = new Date(modified_after);
          afterDate.setHours(0, 0, 0, 0); // Start of day, local timezone
          matchingNotes = matchingNotes.filter((note) => note.modified >= afterDate);
        }
        if (modified_before) {
          const beforeDate = new Date(modified_before);
          beforeDate.setHours(23, 59, 59, 999); // End of day, local timezone
          matchingNotes = matchingNotes.filter((note) => note.modified <= beforeDate);
        }

        // Sort
        matchingNotes = sortNotes(matchingNotes, sort_by ?? 'modified', order ?? 'desc');

        const totalMatches = matchingNotes.length;
        const limitedNotes = matchingNotes.slice(0, limit);

        const stateDb = getStateDb();
        const notes = limitedNotes.map((note, i) =>
          (i < detailN ? enrichResult : enrichResultLight)({ path: note.path, title: note.title }, index, stateDb)
        );

        return { content: [{ type: 'text' as const, text: JSON.stringify({
          total_matches: totalMatches,
          returned: notes.length,
          notes,
        }, null, 2) }] };
      }

      // ---- CONTENT SEARCH (FTS5, with automatic hybrid when semantic enabled) ----
      if (query) {

        // Ensure FTS5 index is ready
        const ftsState = getFTS5State();
        if (ftsState.building) {
          // FTS5 is building (triggered at startup), return immediately
          return { content: [{ type: 'text' as const, text: JSON.stringify({
            method: 'fts5', query, building: true,
            total_results: 0, results: [],
            message: 'Search index is building, try again shortly',
          }, null, 2) }] };
        }
        if (!ftsState.ready || isIndexStale(vaultPath)) {
          console.error('[FTS5] Index stale or missing, rebuilding...');
          await buildFTS5Index(vaultPath);
        }

        const fts5Results = searchFTS5(vaultPath, query, limit);

        // Entity search — always included in content search
        let entityResults: EntitySearchResult[] = [];
        const stateDbEntity = getStateDb();
        if (stateDbEntity) {
          try {
            entityResults = searchEntities(stateDbEntity, query, limit);
          } catch { /* entity search is best-effort */ }
        }

        // Memory search — always included in content search
        let memoryResults: Array<Record<string, unknown>> = [];
        if (stateDbEntity) {
          try {
            const rawMemories = searchMemories(stateDbEntity, { query, limit });
            memoryResults = scoreAndRankMemories(rawMemories, limit);
          } catch { /* memory search is best-effort */ }
        }

        // Entity section — enriched profiles + semantic entity search
        const entitySectionPromise = buildEntitySection(entityResults, query, stateDbEntity, index, limit);

        // Build edge-weight ranked list if context_note is provided
        let edgeRanked: Array<{ path: string; title: string }> = [];
        if (context_note) {
          const ctxStateDb = getStateDb();
          if (ctxStateDb) {
            try {
              // Get weighted edges from context_note, resolve targets to paths via entities
              const edgeRows = ctxStateDb.db.prepare(`
                SELECT nl.target, nl.weight FROM note_links nl
                WHERE nl.note_path = ? AND nl.weight > 1.0
                ORDER BY nl.weight DESC LIMIT ?
              `).all(context_note, limit) as Array<{ target: string; weight: number }>;

              if (edgeRows.length > 0) {
                // Build target->path map from entities table (only matching targets)
                const targets = edgeRows.map(r => r.target);
                const placeholders = targets.map(() => '?').join(',');
                const entityRows = ctxStateDb.db.prepare(
                  `SELECT path, name_lower FROM entities WHERE name_lower IN (${placeholders})`
                ).all(...targets) as Array<{ path: string; name_lower: string }>;
                const targetToPath = new Map<string, string>();
                for (const e of entityRows) {
                  targetToPath.set(e.name_lower, e.path);
                }

                edgeRanked = edgeRows
                  .map(r => {
                    const entityPath = targetToPath.get(r.target);
                    return entityPath ? { path: entityPath, title: r.target } : null;
                  })
                  .filter((r): r is { path: string; title: string } => r !== null);
              }
            } catch {
              // Edge weight boost is best-effort
            }
          }
        }

        // Helper: apply folder post-filter if specified
        const applyFolderFilter = <T extends { path: string }>(items: T[]): T[] => {
          if (!folder) return items;
          return items.filter(item => {
            const normalizedFolder = folder.endsWith('/') ? folder : folder + '/';
            return item.path.startsWith(normalizedFolder) || item.path.split('/')[0] === folder.replace('/', '');
          });
        };

        // Hybrid merge with semantic when embeddings exist
        if (hasEmbeddingsIndex()) {
          try {
            const semanticResults = await semanticSearch(query, limit);

            // Normalize paths to deduplicate across sources
            const normalizePath = (p: string) => p.replace(/\\/g, '/').replace(/\/+/g, '/');

            // RRF merge of FTS5, semantic, entity, and edge-weight results
            const fts5Ranked = fts5Results.map(r => ({ path: normalizePath(r.path), title: r.title, snippet: r.snippet }));
            const semanticRanked = semanticResults.map(r => ({ path: normalizePath(r.path), title: r.title }));
            const entityRankedList = entityResults.map(r => ({ path: normalizePath(r.path), title: r.name }));
            const edgeRankedNorm = edgeRanked.map(r => ({ path: normalizePath(r.path), title: r.title }));
            const rrfLists: Array<Array<{ path: string; title?: string }>> = [fts5Ranked, semanticRanked, entityRankedList];
            if (edgeRankedNorm.length > 0) rrfLists.push(edgeRankedNorm);
            const rrfScores = reciprocalRankFusion(...rrfLists);
            const allPaths = new Set([
              ...fts5Results.map(r => normalizePath(r.path)),
              ...semanticResults.map(r => normalizePath(r.path)),
              ...entityResults.map(r => normalizePath(r.path)),
              ...edgeRanked.map(r => normalizePath(r.path)),
            ]);
            const fts5Map = new Map(fts5Results.map(r => [normalizePath(r.path), r]));
            const semanticMap = new Map(semanticResults.map(r => [normalizePath(r.path), r]));
            const entityMap = new Map(entityResults.map(r => [normalizePath(r.path), r]));

            const queryLower = query.toLowerCase().trim();
            const scored = Array.from(allPaths).map(p => {
              const title = fts5Map.get(p)?.title || semanticMap.get(p)?.title || entityMap.get(p)?.name || p.replace(/\.md$/, '').split('/').pop() || p;
              let rrf_score = rrfScores.get(p) || 0;
              // Boost exact title matches so "emma" always ranks Emma first
              if (title.toLowerCase() === queryLower) rrf_score += 0.5;
              else if (title.toLowerCase().startsWith(queryLower)) rrf_score += 0.2;
              return {
                path: p,
                title,
                snippet: fts5Map.get(p)?.snippet,
                rrf_score,
                in_fts5: fts5Map.has(p),
                in_semantic: semanticMap.has(p),
                in_entity: entityMap.has(p),
              };
            });

            scored.sort((a, b) => b.rrf_score - a.rrf_score);
            const filtered = applyFolderFilter(scored);

            const stateDb = getStateDb();
            const results: Array<Record<string, unknown>> = filtered.slice(0, limit).map(item => ({
              ...enrichResultCompact({ path: item.path, title: item.title, snippet: item.snippet }, index, stateDb),
              rrf_score: item.rrf_score,
              in_fts5: item.in_fts5,
              in_semantic: item.in_semantic,
              in_entity: item.in_entity,
            }));

            // Multi-hop backfill — when results suggest bridge structure
            if (shouldRunMultiHop(query, results, index)) {
              const hopResults = multiHopBackfill(results, index, stateDb, { maxBackfill: limit });
              const expansionTerms = extractExpansionTerms(results, query, index);
              const expansionResults = expandQuery(expansionTerms, [...results, ...hopResults], index, stateDb);
              results.push(...hopResults, ...expansionResults);
            }

            // Graph re-ranking + bridging + context engineering (LLM only) + enhanced snippets
            applyGraphReranking(results, stateDb);
            applyEntityBridging(results, stateDb);
            await enhanceSnippets(results, query, vaultPath);
            if (consumer === 'llm') {
              applySandwichOrdering(results);
              await expandToSections(results, index, vaultPath, detailN);
              stripInternalFields(results);
            }

            const entitySection = await entitySectionPromise;
            return { content: [{ type: 'text' as const, text: JSON.stringify({
              method: 'hybrid',
              query,
              total_results: filtered.length,
              results,
              ...(entitySection.length > 0 ? { entities: entitySection } : {}),
              ...(memoryResults.length > 0 ? { memories: memoryResults } : {}),
            }, null, 2) }] };
          } catch (err) {
            // Semantic failed, fall back to FTS5 + entity only
            console.error('[Semantic] Hybrid search failed, falling back to FTS5:', err instanceof Error ? err.message : err);
          }
        }

        // Non-hybrid: merge FTS5 + entity results
        if (entityResults.length > 0) {
          const normalizePath = (p: string) => p.replace(/\\/g, '/').replace(/\/+/g, '/');
          const fts5Map = new Map(fts5Results.map(r => [normalizePath(r.path), r]));
          const entityRanked = entityResults.filter(r => !fts5Map.has(normalizePath(r.path)));
          const queryLower = query.toLowerCase().trim();
          const mergedItems = [
            ...fts5Results.map(r => ({ path: r.path, title: r.title, snippet: r.snippet, in_fts5: true as const })),
            ...entityRanked.map(r => ({ path: r.path, title: r.name, snippet: undefined as string | undefined, in_entity: true as const })),
          ];
          // Boost exact title matches to the top
          mergedItems.sort((a, b) => {
            const aExact = a.title.toLowerCase() === queryLower ? 2 : a.title.toLowerCase().startsWith(queryLower) ? 1 : 0;
            const bExact = b.title.toLowerCase() === queryLower ? 2 : b.title.toLowerCase().startsWith(queryLower) ? 1 : 0;
            return bExact - aExact;
          });
          const filtered = applyFolderFilter(mergedItems);
          const stateDb = getStateDb();
          const sliced = filtered.slice(0, limit);
          const results: Array<Record<string, unknown>> = sliced.map(item => ({
            ...enrichResultCompact({ path: item.path, title: item.title, snippet: item.snippet }, index, stateDb),
            ...('in_fts5' in item ? { in_fts5: true } : { in_entity: true }),
          }));

          // Multi-hop backfill — when results suggest bridge structure
          if (shouldRunMultiHop(query, results, index)) {
            const hopResults = multiHopBackfill(results, index, stateDb, { maxBackfill: limit });
            const expansionTerms = extractExpansionTerms(results, query, index);
            const expansionResults = expandQuery(expansionTerms, [...results, ...hopResults], index, stateDb);
            results.push(...hopResults, ...expansionResults);
          }

          // Graph re-ranking + bridging + context engineering (LLM only) + enhanced snippets
          applyGraphReranking(results, stateDb);
          applyEntityBridging(results, stateDb);
          await enhanceSnippets(results, query, vaultPath);
          if (consumer === 'llm') {
            applySandwichOrdering(results);
            await expandToSections(results, index, vaultPath, detailN);
            stripInternalFields(results);
          }

          const entitySection = await entitySectionPromise;
          return { content: [{ type: 'text' as const, text: JSON.stringify({
            method: 'fts5',
            query,
            total_results: filtered.length,
            results,
            ...(entitySection.length > 0 ? { entities: entitySection } : {}),
            ...(memoryResults.length > 0 ? { memories: memoryResults } : {}),
          }, null, 2) }] };
        }

        const stateDbFts = getStateDb();
        const fts5Filtered = applyFolderFilter(fts5Results);
        const results: Array<Record<string, unknown>> = fts5Filtered.map(r => ({ ...enrichResultCompact({ path: r.path, title: r.title, snippet: r.snippet }, index, stateDbFts), in_fts5: true }));

        // Multi-hop backfill — when results suggest bridge structure
        if (shouldRunMultiHop(query, results, index)) {
          const hopResults = multiHopBackfill(results, index, stateDbFts, { maxBackfill: limit });
          const expansionTerms = extractExpansionTerms(results, query, index);
          const expansionResults = expandQuery(expansionTerms, [...results, ...hopResults], index, stateDbFts);
          results.push(...hopResults, ...expansionResults);
        }

        // Graph re-ranking + bridging + context engineering (LLM only) + enhanced snippets
        applyGraphReranking(results, stateDbFts);
        applyEntityBridging(results, stateDbFts);
        await enhanceSnippets(results, query, vaultPath);
        if (consumer === 'llm') {
          applySandwichOrdering(results);
          await expandToSections(results, index, vaultPath, detailN);
          stripInternalFields(results);
        }

        const entitySection = await entitySectionPromise;
        return { content: [{ type: 'text' as const, text: JSON.stringify({
          method: 'fts5',
          query,
          total_results: results.length,
          results,
          ...(entitySection.length > 0 ? { entities: entitySection } : {}),
          ...(memoryResults.length > 0 ? { memories: memoryResults } : {}),
        }, null, 2) }] };
      }

      // No query and no filters — return error
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Provide a query or metadata filters (where, has_tag, folder, etc.)' }, null, 2) }] };
    }
  );
}
