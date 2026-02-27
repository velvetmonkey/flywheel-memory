/**
 * Wikilink service tools - suggest and validate wikilinks
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import type { ScoredSuggestion } from '../../core/write/types.js';
import { MAX_LIMIT } from '../../core/read/constants.js';
import { resolveTarget } from '../../core/read/graph.js';
import { requireIndex } from '../../core/read/indexGuard.js';
import { suggestRelatedLinks, getCooccurrenceIndex } from '../../core/write/wikilinks.js';
import { countFTS5Mentions } from '../../core/read/fts5.js';
import { detectImplicitEntities } from '@velvetmonkey/vault-core';

/**
 * Match entity in text, avoiding existing wikilinks and code blocks
 */
interface EntityMatch {
  entity: string;       // The matched text
  start: number;        // Start position in text
  end: number;          // End position in text
  target: string;       // Path to the target note
}

/**
 * A prospect entity — not yet a known entity but detected via patterns or dead link analysis
 */
interface ProspectMatch {
  entity: string;       // The detected text
  start: number;        // Start position in text
  end: number;          // End position in text
  source: 'dead_link' | 'implicit' | 'both';  // How it was detected
  confidence: 'high' | 'medium' | 'low';      // Confidence level
  backlink_count?: number;  // Number of backlinks (for dead link targets)
}

/**
 * Find entity matches in text
 * - Case-insensitive matching
 * - Avoids matching inside existing [[wikilinks]]
 * - Avoids matching inside `code` or ```code blocks```
 * - Avoids matching inside markdown headings (lines starting with #)
 * - Avoids matching inside YAML frontmatter (--- blocks at document start)
 * - Avoids matching inside footnote definitions ([^1]: text)
 * - Avoids matching inside HTML tags and comments
 * - Matches longest entities first (e.g., "Claude Code" before "Claude")
 */
function findEntityMatches(text: string, entities: Map<string, string>): EntityMatch[] {
  const matches: EntityMatch[] = [];

  // Build list of entities sorted by length (longest first)
  const sortedEntities = Array.from(entities.entries())
    .filter(([name]) => name.length >= 2) // Skip single-char entities
    .sort((a, b) => b[0].length - a[0].length);

  // Find regions to skip (existing wikilinks and code blocks)
  const skipRegions: Array<{ start: number; end: number }> = [];

  // Skip YAML frontmatter (must be at document start)
  const frontmatterRegex = /^---\r?\n[\s\S]*?\r?\n---/;
  let match = frontmatterRegex.exec(text);
  if (match) {
    skipRegions.push({ start: match.index, end: match.index + match[0].length });
  }

  // Skip existing wikilinks
  const wikilinkRegex = /\[\[[^\]]+\]\]/g;
  while ((match = wikilinkRegex.exec(text)) !== null) {
    skipRegions.push({ start: match.index, end: match.index + match[0].length });
  }

  // Skip code blocks
  const codeBlockRegex = /```[\s\S]*?```|`[^`\n]+`/g;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    skipRegions.push({ start: match.index, end: match.index + match[0].length });
  }

  // Skip URLs
  const urlRegex = /https?:\/\/[^\s)>\]]+/g;
  while ((match = urlRegex.exec(text)) !== null) {
    skipRegions.push({ start: match.index, end: match.index + match[0].length });
  }

  // Skip markdown headings (lines starting with #)
  const headingRegex = /^#{1,6}\s.*$/gm;
  while ((match = headingRegex.exec(text)) !== null) {
    skipRegions.push({ start: match.index, end: match.index + match[0].length });
  }

  // Skip footnote definitions ([^id]: content until next blank line or EOF)
  const footnoteRegex = /^\[\^[^\]]+\]:.*(?:\r?\n(?![\r\n]).*)*$/gm;
  while ((match = footnoteRegex.exec(text)) !== null) {
    skipRegions.push({ start: match.index, end: match.index + match[0].length });
  }

  // Skip HTML comments
  const htmlCommentRegex = /<!--[\s\S]*?-->/g;
  while ((match = htmlCommentRegex.exec(text)) !== null) {
    skipRegions.push({ start: match.index, end: match.index + match[0].length });
  }

  // Skip HTML tags (both self-closing and paired)
  const htmlTagRegex = /<[a-zA-Z][^>]*>[\s\S]*?<\/[a-zA-Z][^>]*>|<[a-zA-Z][^>]*\/>/g;
  while ((match = htmlTagRegex.exec(text)) !== null) {
    skipRegions.push({ start: match.index, end: match.index + match[0].length });
  }

  // Track positions already matched (to avoid overlapping matches)
  const matchedPositions = new Set<number>();

  // Check if a position is in a skip region or already matched
  function shouldSkip(start: number, end: number): boolean {
    // Check skip regions
    for (const region of skipRegions) {
      if (start < region.end && end > region.start) {
        return true;
      }
    }

    // Check already matched positions
    for (let i = start; i < end; i++) {
      if (matchedPositions.has(i)) {
        return true;
      }
    }

    return false;
  }

  // Mark positions as matched
  function markMatched(start: number, end: number): void {
    for (let i = start; i < end; i++) {
      matchedPositions.add(i);
    }
  }

  // Search for each entity
  const textLower = text.toLowerCase();

  for (const [entityName, targetPath] of sortedEntities) {
    const entityLower = entityName.toLowerCase();
    let searchStart = 0;

    while (searchStart < textLower.length) {
      const pos = textLower.indexOf(entityLower, searchStart);
      if (pos === -1) break;

      const end = pos + entityName.length;

      // Check word boundaries
      const charBefore = pos > 0 ? text[pos - 1] : ' ';
      const charAfter = end < text.length ? text[end] : ' ';
      const isWordBoundaryBefore = /[\s\n\r.,;:!?()[\]{}'"<>-]/.test(charBefore);
      const isWordBoundaryAfter = /[\s\n\r.,;:!?()[\]{}'"<>-]/.test(charAfter);

      if (isWordBoundaryBefore && isWordBoundaryAfter && !shouldSkip(pos, end)) {
        // Get the original case from the text
        const originalText = text.substring(pos, end);

        matches.push({
          entity: originalText,
          start: pos,
          end,
          target: targetPath,
        });

        markMatched(pos, end);
      }

      searchStart = pos + 1;
    }
  }

  // Sort by position
  return matches.sort((a, b) => a.start - b.start);
}

/**
 * Register wikilink service tools
 */
export function registerWikilinkTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string
): void {
  // suggest_wikilinks - Find entities in text that could be linked
  const SuggestionSchema = z.object({
    entity: z.string().describe('The matched text in the input'),
    start: z.coerce.number().describe('Start position in text (0-indexed)'),
    end: z.coerce.number().describe('End position in text (0-indexed)'),
    target: z.string().describe('Path to the target note'),
  });

  const SuggestWikilinksOutputSchema = {
    input_length: z.coerce.number().describe('Length of the input text'),
    suggestion_count: z.coerce.number().describe('Total number of suggestions found'),
    returned_count: z.coerce.number().describe('Number of suggestions returned (may be limited)'),
    suggestions: z.array(SuggestionSchema).describe('List of wikilink suggestions'),
  };

  type SuggestWikilinksOutput = {
    input_length: number;
    suggestion_count: number;
    returned_count: number;
    suggestions: EntityMatch[];
    prospects?: ProspectMatch[];
    scored_suggestions?: ScoredSuggestion[];
  };

  server.registerTool(
    'suggest_wikilinks',
    {
      title: 'Suggest Wikilinks',
      description:
        'Analyze text and suggest where wikilinks could be added. Finds mentions of existing note titles and aliases.',
      inputSchema: {
        text: z.string().describe('The text to analyze for potential wikilinks'),
        limit: z.coerce.number().default(50).describe('Maximum number of suggestions to return'),
        offset: z.coerce.number().default(0).describe('Number of suggestions to skip (for pagination)'),
        detail: z.boolean().default(false).describe('Include per-layer score breakdown for each suggestion'),
      },
      outputSchema: SuggestWikilinksOutputSchema,
    },
    async ({ text, limit: requestedLimit, offset, detail }): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      structuredContent: SuggestWikilinksOutput;
    }> => {
      const limit = Math.min(requestedLimit ?? 50, MAX_LIMIT);
      const index = getIndex();
      const allMatches = findEntityMatches(text, index.entities);
      const matches = allMatches.slice(offset, offset + limit);

      // Build set of already-linked entities for exclusion
      const linkedSet = new Set(allMatches.map(m => m.entity.toLowerCase()));

      // --- Prospect detection ---
      const prospects: ProspectMatch[] = [];
      const prospectSeen = new Set<string>();

      // T2: Dead link target matching — find backlink targets that aren't entities
      // but appear as plain text in the input
      for (const [target, links] of index.backlinks) {
        if (links.length < 2) continue;                        // need >= 2 backlinks
        if (index.entities.has(target.toLowerCase())) continue; // already a known entity
        if (linkedSet.has(target.toLowerCase())) continue;      // already matched

        // Search for the dead link target as plain text
        const targetLower = target.toLowerCase();
        const textLower = text.toLowerCase();
        let searchPos = 0;
        while (searchPos < textLower.length) {
          const pos = textLower.indexOf(targetLower, searchPos);
          if (pos === -1) break;
          const end = pos + target.length;
          // Word boundary check
          const before = pos > 0 ? text[pos - 1] : ' ';
          const after = end < text.length ? text[end] : ' ';
          if (/[\s\n\r.,;:!?()[\]{}'"<>-]/.test(before) && /[\s\n\r.,;:!?()[\]{}'"<>-]/.test(after)) {
            if (!prospectSeen.has(targetLower)) {
              prospectSeen.add(targetLower);
              prospects.push({
                entity: text.substring(pos, end),
                start: pos,
                end,
                source: 'dead_link',
                confidence: links.length >= 3 ? 'high' : 'medium',
                backlink_count: links.length,
              });
            }
            break; // first occurrence only
          }
          searchPos = pos + 1;
        }
      }

      // T3: Implicit entity detection — proper nouns, CamelCase, etc.
      const implicit = detectImplicitEntities(text);
      for (const imp of implicit) {
        const impLower = imp.text.toLowerCase();
        if (linkedSet.has(impLower)) continue;       // already a known entity match
        if (prospectSeen.has(impLower)) {
          // Cross-reference: implicit entity matches a dead link target — boost to high
          const existing = prospects.find(p => p.entity.toLowerCase() === impLower);
          if (existing) {
            existing.source = 'both';
            existing.confidence = 'high';
          }
          continue;
        }
        prospectSeen.add(impLower);
        prospects.push({
          entity: imp.text,
          start: imp.start,
          end: imp.end,
          source: 'implicit',
          confidence: 'low',
        });
      }

      const output: SuggestWikilinksOutput = {
        input_length: text.length,
        suggestion_count: allMatches.length,
        returned_count: matches.length,
        suggestions: matches,
      };

      if (prospects.length > 0) {
        output.prospects = prospects;
      }

      // When detail=true, also call the scoring engine for per-layer breakdown
      if (detail) {
        const scored = await suggestRelatedLinks(text, {
          detail: true,
          maxSuggestions: limit,
          strictness: 'balanced',
        });
        if (scored.detailed) {
          output.scored_suggestions = scored.detailed;
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(output, null, 2),
          },
        ],
        structuredContent: output,
      };
    }
  );

  // validate_links - Check if links in a note (or all notes) are valid
  const BrokenLinkSchema = z.object({
    source: z.string().describe('Path to the note containing the broken link'),
    target: z.string().describe('The broken link target'),
    line: z.coerce.number().describe('Line number where the link appears'),
    suggestion: z.string().optional().describe('Suggested fix if a similar note exists'),
  });

  const ValidateLinksOutputSchema = {
    scope: z.string().describe('What was validated (note path or "all")'),
    total_links: z.coerce.number().describe('Total number of links checked'),
    valid_links: z.coerce.number().describe('Number of valid links'),
    broken_links: z.coerce.number().describe('Total number of broken links'),
    returned_count: z.coerce.number().describe('Number of broken links returned (may be limited)'),
    broken: z.array(BrokenLinkSchema).describe('List of broken links'),
  };

  type BrokenLink = {
    source: string;
    target: string;
    line: number;
    suggestion?: string;
  };

  type ValidateLinksOutput = {
    scope: string;
    total_links: number;
    valid_links: number;
    broken_links: number;
    returned_count: number;
    broken: BrokenLink[];
  };

  /**
   * Find similar entity names for suggestions
   */
  function findSimilarEntity(target: string, entities: Map<string, string>): string | undefined {
    const targetLower = target.toLowerCase();

    // Try exact prefix match
    for (const [name, path] of entities) {
      if (name.startsWith(targetLower) || targetLower.startsWith(name)) {
        return path;
      }
    }

    // Try contains match
    for (const [name, path] of entities) {
      if (name.includes(targetLower) || targetLower.includes(name)) {
        return path;
      }
    }

    return undefined;
  }

  server.registerTool(
    'validate_links',
    {
      title: 'Validate Links',
      description:
        'Check wikilinks in a note (or all notes) and report broken links. Optionally suggests fixes.',
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe('Path to a specific note to validate. If omitted, validates all notes.'),
        typos_only: z.boolean().default(false).describe('If true, only report broken links that have a similar existing note (likely typos)'),
        group_by_target: z.boolean().default(false).describe('If true, aggregate dead links by target and rank by mention frequency. Returns targets[] instead of broken[].'),
        limit: z.coerce.number().default(50).describe('Maximum number of broken links to return'),
        offset: z.coerce.number().default(0).describe('Number of broken links to skip (for pagination)'),
      },
      outputSchema: ValidateLinksOutputSchema,
    },
    async ({ path: notePath, typos_only, group_by_target, limit: requestedLimit, offset }): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      structuredContent: ValidateLinksOutput | Record<string, unknown>;
    }> => {
      const limit = Math.min(requestedLimit ?? 50, MAX_LIMIT);
      const index = getIndex();
      const allBroken: BrokenLink[] = [];
      let totalLinks = 0;
      let validLinks = 0;

      // Determine which notes to check
      let notesToCheck: string[];
      if (notePath) {
        // Resolve the path if it's just a title
        let resolvedPath = notePath;
        if (!notePath.endsWith('.md')) {
          const resolved = resolveTarget(index, notePath);
          if (resolved) {
            resolvedPath = resolved;
          } else {
            resolvedPath = notePath + '.md';
          }
        }
        notesToCheck = [resolvedPath];
      } else {
        notesToCheck = Array.from(index.notes.keys());
      }

      // Check each note
      for (const sourcePath of notesToCheck) {
        const note = index.notes.get(sourcePath);
        if (!note) continue;

        for (const link of note.outlinks) {
          totalLinks++;

          const resolved = resolveTarget(index, link.target);
          if (resolved) {
            validLinks++;
          } else {
            // Find a suggestion
            const suggestion = findSimilarEntity(link.target, index.entities);

            // When typos_only is true, only include broken links that have a suggestion
            if (typos_only && !suggestion) continue;

            allBroken.push({
              source: sourcePath,
              target: link.target,
              line: link.line,
              suggestion,
            });
          }
        }
      }

      // Group by target mode: aggregate and rank by frequency
      if (group_by_target) {
        const targetMap = new Map<string, { count: number; sources: Set<string>; suggestion?: string }>();
        for (const broken of allBroken) {
          const key = broken.target.toLowerCase();
          const existing = targetMap.get(key);
          if (existing) {
            existing.count++;
            if (existing.sources.size < 5) existing.sources.add(broken.source);
            if (!existing.suggestion && broken.suggestion) existing.suggestion = broken.suggestion;
          } else {
            targetMap.set(key, {
              count: 1,
              sources: new Set([broken.source]),
              suggestion: broken.suggestion,
            });
          }
        }

        const targets = Array.from(targetMap.entries())
          .map(([target, data]) => ({
            target,
            mention_count: data.count,
            sources: Array.from(data.sources),
            ...(data.suggestion ? { suggestion: data.suggestion } : {}),
          }))
          .sort((a, b) => b.mention_count - a.mention_count)
          .slice(offset, offset + limit);

        const grouped = {
          scope: notePath || 'all',
          total_dead_targets: targetMap.size,
          total_broken_links: allBroken.length,
          returned_count: targets.length,
          targets,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(grouped, null, 2) }],
          structuredContent: grouped,
        };
      }

      const broken = allBroken.slice(offset, offset + limit);

      const output: ValidateLinksOutput = {
        scope: notePath || 'all',
        total_links: totalLinks,
        valid_links: validLinks,
        broken_links: allBroken.length,
        returned_count: broken.length,
        broken,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(output, null, 2),
          },
        ],
        structuredContent: output,
      };
    }
  );

  // discover_stub_candidates - Find terms that are referenced frequently but have no note
  server.registerTool(
    'discover_stub_candidates',
    {
      title: 'Discover Stub Candidates',
      description:
        'Find terms referenced via dead wikilinks across the vault that have no backing note. These are "invisible concepts" — topics your vault considers important enough to link to but that don\'t have their own notes yet. Ranked by reference frequency.',
      inputSchema: {
        min_frequency: z.coerce.number().default(2).describe('Minimum number of references to include (default 2)'),
        limit: z.coerce.number().default(20).describe('Maximum candidates to return (default 20)'),
      },
    },
    async ({ min_frequency, limit: requestedLimit }): Promise<{
      content: Array<{ type: 'text'; text: string }>;
    }> => {
      const index = getIndex();
      const limit = Math.min(requestedLimit ?? 20, 100);
      const minFreq = min_frequency ?? 2;

      // Collect all dead link targets with their sources
      const targetMap = new Map<string, { count: number; sources: Set<string> }>();
      for (const note of index.notes.values()) {
        for (const link of note.outlinks) {
          if (!resolveTarget(index, link.target)) {
            const key = link.target.toLowerCase();
            const existing = targetMap.get(key);
            if (existing) {
              existing.count++;
              if (existing.sources.size < 3) existing.sources.add(note.path);
            } else {
              targetMap.set(key, { count: 1, sources: new Set([note.path]) });
            }
          }
        }
      }

      // Also check FTS5 for additional plain-text mentions of each dead target
      const candidates = Array.from(targetMap.entries())
        .filter(([, data]) => data.count >= minFreq)
        .map(([target, data]) => {
          const fts5Mentions = countFTS5Mentions(target);
          return {
            term: target,
            wikilink_references: data.count,
            content_mentions: fts5Mentions,
            sample_notes: Array.from(data.sources),
          };
        })
        .sort((a, b) => b.wikilink_references - a.wikilink_references)
        .slice(0, limit);

      const output = {
        total_dead_targets: targetMap.size,
        candidates_above_threshold: candidates.length,
        candidates,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      };
    }
  );

  // discover_cooccurrence_gaps - Find entity pairs that co-occur but lack connecting notes
  server.registerTool(
    'discover_cooccurrence_gaps',
    {
      title: 'Discover Co-occurrence Gaps',
      description:
        'Find entity pairs that frequently co-occur across vault notes but where one or both entities lack a backing note. These represent relationship patterns worth making explicit with hub notes or links.',
      inputSchema: {
        min_cooccurrence: z.coerce.number().default(3).describe('Minimum co-occurrence count to include (default 3)'),
        limit: z.coerce.number().default(20).describe('Maximum gaps to return (default 20)'),
      },
    },
    async ({ min_cooccurrence, limit: requestedLimit }): Promise<{
      content: Array<{ type: 'text'; text: string }>;
    }> => {
      const index = getIndex();
      const coocIndex = getCooccurrenceIndex();
      const limit = Math.min(requestedLimit ?? 20, 100);
      const minCount = min_cooccurrence ?? 3;

      if (!coocIndex) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Co-occurrence index not built yet. Wait for entity index initialization.' }) }],
        };
      }

      const gaps: Array<{
        entity_a: string;
        entity_b: string;
        cooccurrence_count: number;
        a_has_note: boolean;
        b_has_note: boolean;
      }> = [];

      // Deduplicate pairs (A↔B and B↔A are the same)
      const seenPairs = new Set<string>();

      for (const [entityA, associations] of Object.entries(coocIndex.associations)) {
        for (const [entityB, count] of associations) {
          if (count < minCount) continue;

          const pairKey = [entityA, entityB].sort().join('||');
          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);

          const aHasNote = resolveTarget(index, entityA) !== null;
          const bHasNote = resolveTarget(index, entityB) !== null;

          // Only report gaps where at least one entity lacks a note
          if (aHasNote && bHasNote) continue;

          gaps.push({
            entity_a: entityA,
            entity_b: entityB,
            cooccurrence_count: count,
            a_has_note: aHasNote,
            b_has_note: bHasNote,
          });
        }
      }

      gaps.sort((a, b) => b.cooccurrence_count - a.cooccurrence_count);
      const top = gaps.slice(0, limit);

      const output = {
        total_gaps: gaps.length,
        returned_count: top.length,
        gaps: top,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      };
    }
  );
}
