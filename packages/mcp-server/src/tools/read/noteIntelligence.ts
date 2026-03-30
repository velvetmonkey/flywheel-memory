/**
 * Note Intelligence - Unified note analysis tool
 *
 * Replaces: detect_prose_patterns, suggest_frontmatter_from_prose,
 *           suggest_wikilinks_in_frontmatter, compute_frontmatter
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import { requireIndex } from '../../core/read/indexGuard.js';
import {
  detectProsePatterns,
  suggestFrontmatterFromProse,
  suggestWikilinksInFrontmatter,
} from './bidirectional.js';
import { computeFrontmatter } from './computed.js';
import {
  hasEntityEmbeddingsIndex,
  embedTextCached,
  findSemanticallySimilarEntities,
} from '../../core/read/embeddings.js';
import { getExcludeTags, type FlywheelConfig } from '../../core/read/config.js';
import fs from 'node:fs';
import nodePath from 'node:path';

/**
 * Register the unified note_intelligence tool
 */
export function registerNoteIntelligenceTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string,
  getConfig?: () => FlywheelConfig
): void {
  server.registerTool(
    'note_intelligence',
    {
      title: 'Note Intelligence',
      description:
        'Analyze a note for patterns, suggestions, and consistency. Modes: prose_patterns (find Key: Value or Key: [[wikilink]] patterns), suggest_frontmatter (suggest YAML from detected prose patterns), suggest_wikilinks (find frontmatter values that could be wikilinks), compute (auto-compute derived fields like word_count, link_count), semantic_links (find semantically related unlinked entities, requires init_semantic), all (combined result). Returns per-mode analysis with actionable suggestions.',
      inputSchema: {
        analysis: z.enum([
          'prose_patterns', 'suggest_frontmatter', 'suggest_wikilinks',
          'compute', 'semantic_links', 'all',
        ]).describe('Type of note analysis to perform'),
        path: z.string().describe('Path to the note to analyze'),
        fields: z.array(z.string()).optional().describe('Specific fields to compute (compute/all modes)'),
      },
    },
    async ({ analysis, path: notePath, fields }) => {
      requireIndex();
      const index = getIndex();
      const vaultPath = getVaultPath();

      switch (analysis) {
        case 'prose_patterns': {
          const result = await detectProsePatterns(index, notePath, vaultPath);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }

        case 'suggest_frontmatter': {
          const result = await suggestFrontmatterFromProse(index, notePath, vaultPath);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }

        case 'suggest_wikilinks': {
          const result = await suggestWikilinksInFrontmatter(index, notePath, vaultPath);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }

        case 'compute': {
          const result = await computeFrontmatter(index, notePath, vaultPath, fields);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }

        case 'semantic_links': {
          if (!hasEntityEmbeddingsIndex()) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'Entity embeddings not available. Run init_semantic first.',
              }, null, 2) }],
            };
          }

          // Read the note content
          let noteContent: string;
          try {
            noteContent = fs.readFileSync(nodePath.join(vaultPath, notePath), 'utf-8');
          } catch {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: `Could not read note: ${notePath}`,
              }, null, 2) }],
            };
          }

          // Extract already-linked entities
          const linkedEntities = new Set<string>();
          const wikilinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
          let wlMatch;
          while ((wlMatch = wikilinkRegex.exec(noteContent)) !== null) {
            linkedEntities.add(wlMatch[1].toLowerCase());
          }

          // Build set of excluded tags for filtering
          const excludeTags = new Set(
            getExcludeTags(getConfig?.() ?? {}).map(t => t.toLowerCase())
          );

          try {
            const contentEmbedding = await embedTextCached(noteContent);
            const matches = findSemanticallySimilarEntities(contentEmbedding, 20, linkedEntities);

            const suggestions = matches
              .filter(m => {
                if (m.similarity < 0.3) return false;
                // Filter out entities whose backing notes have excluded tags
                if (excludeTags.size > 0) {
                  const entityPath = index.entities.get(m.entityName.toLowerCase());
                  const entityNote = entityPath ? index.notes.get(entityPath) : [...index.notes.values()].find(n => n.title.toLowerCase() === m.entityName.toLowerCase());
                  if (entityNote) {
                    const noteTags = Object.keys(entityNote.frontmatter)
                      .filter(k => k === 'tags')
                      .flatMap(k => {
                        const v = entityNote.frontmatter[k];
                        return Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
                      })
                      .map(t => String(t).toLowerCase());
                    if (noteTags.some(t => excludeTags.has(t))) return false;
                  }
                }
                return true;
              })
              .map(m => ({
                entity: m.entityName,
                similarity: m.similarity,
              }));

            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                path: notePath,
                analysis: 'semantic_links',
                linked_count: linkedEntities.size,
                suggestion_count: suggestions.length,
                suggestions,
              }, null, 2) }],
            };
          } catch {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'Failed to compute semantic links',
              }, null, 2) }],
            };
          }
        }

        case 'all': {
          const [prosePatterns, suggestedFrontmatter, suggestedWikilinks, computed] =
            await Promise.all([
              detectProsePatterns(index, notePath, vaultPath),
              suggestFrontmatterFromProse(index, notePath, vaultPath),
              suggestWikilinksInFrontmatter(index, notePath, vaultPath),
              computeFrontmatter(index, notePath, vaultPath, fields),
            ]);

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              path: notePath,
              prose_patterns: prosePatterns,
              suggested_frontmatter: suggestedFrontmatter,
              suggested_wikilinks: suggestedWikilinks,
              computed,
            }, null, 2) }],
          };
        }
      }
    }
  );
}
