/**
 * Note Intelligence - Unified note analysis tool
 *
 * Replaces: detect_prose_patterns, suggest_frontmatter_from_prose,
 *           suggest_wikilinks_in_frontmatter, validate_cross_layer, compute_frontmatter
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import { requireIndex } from '../../core/read/indexGuard.js';
import {
  detectProsePatterns,
  suggestFrontmatterFromProse,
  suggestWikilinksInFrontmatter,
  validateCrossLayer,
} from './bidirectional.js';
import { computeFrontmatter } from './computed.js';

/**
 * Register the unified note_intelligence tool
 */
export function registerNoteIntelligenceTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string
): void {
  server.registerTool(
    'note_intelligence',
    {
      title: 'Note Intelligence',
      description:
        'Analyze a note for patterns, suggestions, and consistency. Use analysis to pick the mode:\n' +
        '- "prose_patterns": Find "Key: Value" or "Key: [[wikilink]]" patterns in prose\n' +
        '- "suggest_frontmatter": Suggest YAML frontmatter from detected prose patterns\n' +
        '- "suggest_wikilinks": Find frontmatter values that could be wikilinks\n' +
        '- "cross_layer": Check consistency between frontmatter and prose references\n' +
        '- "compute": Auto-compute derived fields (word_count, link_count, etc.)\n' +
        '- "all": Run all analyses and return combined result\n\n' +
        'Example: note_intelligence({ path: "projects/alpha.md", analysis: "wikilinks" })\n' +
        'Example: note_intelligence({ path: "projects/alpha.md", analysis: "compute", fields: ["word_count", "link_count"] })',
      inputSchema: {
        analysis: z.enum([
          'prose_patterns', 'suggest_frontmatter', 'suggest_wikilinks',
          'cross_layer', 'compute', 'all',
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

        case 'cross_layer': {
          const result = await validateCrossLayer(index, notePath, vaultPath);
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

        case 'all': {
          const [prosePatterns, suggestedFrontmatter, suggestedWikilinks, crossLayer, computed] =
            await Promise.all([
              detectProsePatterns(index, notePath, vaultPath),
              suggestFrontmatterFromProse(index, notePath, vaultPath),
              suggestWikilinksInFrontmatter(index, notePath, vaultPath),
              validateCrossLayer(index, notePath, vaultPath),
              computeFrontmatter(index, notePath, vaultPath, fields),
            ]);

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              path: notePath,
              prose_patterns: prosePatterns,
              suggested_frontmatter: suggestedFrontmatter,
              suggested_wikilinks: suggestedWikilinks,
              cross_layer: crossLayer,
              computed,
            }, null, 2) }],
          };
        }
      }
    }
  );
}
