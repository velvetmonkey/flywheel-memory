/**
 * Wikilink service tools - suggest and validate wikilinks
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import { MAX_LIMIT } from '../../core/read/constants.js';
import { resolveTarget } from '../../core/read/graph.js';
import { requireIndex } from '../../core/read/indexGuard.js';

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
      },
      outputSchema: SuggestWikilinksOutputSchema,
    },
    async ({ text, limit: requestedLimit, offset }): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      structuredContent: SuggestWikilinksOutput;
    }> => {
      const limit = Math.min(requestedLimit ?? 50, MAX_LIMIT);
      const index = getIndex();
      const allMatches = findEntityMatches(text, index.entities);
      const matches = allMatches.slice(offset, offset + limit);

      const output: SuggestWikilinksOutput = {
        input_length: text.length,
        suggestion_count: allMatches.length,
        returned_count: matches.length,
        suggestions: matches,
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
        limit: z.coerce.number().default(50).describe('Maximum number of broken links to return'),
        offset: z.coerce.number().default(0).describe('Number of broken links to skip (for pagination)'),
      },
      outputSchema: ValidateLinksOutputSchema,
    },
    async ({ path: notePath, limit: requestedLimit, offset }): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      structuredContent: ValidateLinksOutput;
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

            allBroken.push({
              source: sourcePath,
              target: link.target,
              line: link.line,
              suggestion,
            });
          }
        }
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
}
