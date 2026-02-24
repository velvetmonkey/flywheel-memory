/**
 * Graph intelligence tools
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import { MAX_LIMIT } from '../../core/read/constants.js';
import {
  getBacklinksForNote,
  getForwardLinksForNote,
  resolveTarget,
} from '../../core/read/graph.js';
import { findBidirectionalLinks } from './graphAdvanced.js';
import { requireIndex } from '../../core/read/indexGuard.js';

/**
 * Get surrounding context for a backlink
 */
async function getContext(
  vaultPath: string,
  sourcePath: string,
  line: number,
  contextLines: number = 1
): Promise<string> {
  try {
    const fullPath = path.join(vaultPath, sourcePath);
    const content = await fs.promises.readFile(fullPath, 'utf-8');
    const allLines = content.split('\n');

    // Line numbers from the parser are relative to the body (after frontmatter).
    // Compute the frontmatter offset so we index into the full file correctly.
    let fmLines = 0;
    if (allLines[0]?.trimEnd() === '---') {
      for (let i = 1; i < allLines.length; i++) {
        if (allLines[i].trimEnd() === '---') {
          fmLines = i + 1; // lines consumed by frontmatter (including both ---)
          break;
        }
      }
    }

    const absLine = line + fmLines; // convert body-relative to absolute (1-indexed)
    const startLine = Math.max(0, absLine - 1 - contextLines);
    const endLine = Math.min(allLines.length, absLine + contextLines);

    return allLines.slice(startLine, endLine).join('\n').trim();
  } catch {
    return '';
  }
}

// Output schemas for structured content
const BacklinkItemSchema = z.object({
  source: z.string().describe('Path of the note containing the link'),
  line: z.coerce.number().describe('Line number where the link appears'),
  context: z.string().optional().describe('Surrounding text for context'),
});

const GetBacklinksOutputSchema = {
  note: z.string().describe('The resolved note path'),
  backlink_count: z.coerce.number().describe('Total number of backlinks found'),
  returned_count: z.coerce.number().describe('Number of backlinks returned (may be limited)'),
  backlinks: z.array(BacklinkItemSchema).describe('List of backlinks'),
};

// TypeScript type derived from schema
type GetBacklinksOutput = {
  note: string;
  backlink_count: number;
  returned_count: number;
  backlinks: Array<{
    source: string;
    line: number;
    context?: string;
  }>;
};

/**
 * Register graph intelligence tools with the MCP server
 */
export function registerGraphTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string,
  getStateDb?: () => import('@velvetmonkey/vault-core').StateDb | null
) {
  // get_backlinks - What notes link TO this note?
  server.registerTool(
    'get_backlinks',
    {
      title: 'Get Backlinks',
      description: 'Get all notes that link TO the specified note. Returns the source file paths and line numbers where links appear.',
      inputSchema: {
        path: z.string().describe('Path to the note (e.g., "daily/2024-01-15.md" or just "My Note")'),
        include_context: z.boolean().default(true).describe('Include surrounding text for context'),
        include_bidirectional: z.boolean().default(false).describe('Also return bidirectional (mutual) link pairs involving this note'),
        limit: z.coerce.number().default(50).describe('Maximum number of results to return'),
        offset: z.coerce.number().default(0).describe('Number of results to skip (for pagination)'),
      },
      outputSchema: GetBacklinksOutputSchema,
    },
    async ({ path: notePath, include_context, include_bidirectional, limit: requestedLimit, offset }): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      structuredContent: GetBacklinksOutput;
    }> => {
      requireIndex();
      const limit = Math.min(requestedLimit ?? 50, MAX_LIMIT);
      const index = getIndex();
      const vaultPath = getVaultPath();

      // Try to resolve the path if it's just a title
      let resolvedPath = notePath;
      if (!notePath.endsWith('.md')) {
        const resolved = resolveTarget(index, notePath);
        if (resolved) {
          resolvedPath = resolved;
        } else {
          resolvedPath = notePath + '.md';
        }
      }

      // Get backlinks
      const allBacklinks = getBacklinksForNote(index, resolvedPath);
      const backlinks = allBacklinks.slice(offset, offset + limit);

      // Enhance with context if requested
      const results = await Promise.all(
        backlinks.map(async (bl) => {
          const result: {
            source: string;
            line: number;
            context?: string;
          } = {
            source: bl.source,
            line: bl.line,
          };

          if (include_context) {
            result.context = await getContext(vaultPath, bl.source, bl.line);
          }

          return result;
        })
      );

      // Format response with structured content
      const output: GetBacklinksOutput = {
        note: resolvedPath,
        backlink_count: allBacklinks.length,
        returned_count: results.length,
        backlinks: results,
      };

      // Optionally include bidirectional pairs
      if (include_bidirectional) {
        const biPairs = findBidirectionalLinks(index, resolvedPath);
        (output as any).bidirectional_pairs = biPairs;
        (output as any).bidirectional_count = biPairs.length;
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

  // get_forward_links - What notes does this note link TO?
  const ForwardLinkItemSchema = z.object({
    target: z.string().describe('The link target as written'),
    alias: z.string().optional().describe('Display text if using [[target|alias]] syntax'),
    line: z.coerce.number().describe('Line number where the link appears'),
    resolved_path: z.string().optional().describe('Resolved path if target exists'),
    exists: z.boolean().describe('Whether the target note exists'),
  });

  const GetForwardLinksOutputSchema = {
    note: z.string().describe('The source note path'),
    forward_link_count: z.coerce.number().describe('Total number of forward links'),
    forward_links: z.array(ForwardLinkItemSchema).describe('List of forward links'),
  };

  type GetForwardLinksOutput = {
    note: string;
    forward_link_count: number;
    forward_links: Array<{
      target: string;
      alias?: string;
      line: number;
      resolved_path?: string;
      exists: boolean;
    }>;
  };

  server.registerTool(
    'get_forward_links',
    {
      title: 'Get Forward Links',
      description: 'Get all notes that this note links TO. Returns the target paths and whether they exist.',
      inputSchema: {
        path: z.string().describe('Path to the note (e.g., "daily/2024-01-15.md" or just "My Note")'),
      },
      outputSchema: GetForwardLinksOutputSchema,
    },
    async ({ path: notePath }): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      structuredContent: GetForwardLinksOutput;
    }> => {
      requireIndex();
      const index = getIndex();

      // Try to resolve the path if it's just a title
      let resolvedPath = notePath;
      if (!notePath.endsWith('.md')) {
        const resolved = resolveTarget(index, notePath);
        if (resolved) {
          resolvedPath = resolved;
        } else {
          resolvedPath = notePath + '.md';
        }
      }

      // Get forward links
      const forwardLinks = getForwardLinksForNote(index, resolvedPath);

      const output: GetForwardLinksOutput = {
        note: resolvedPath,
        forward_link_count: forwardLinks.length,
        forward_links: forwardLinks.map((link) => ({
          target: link.target,
          alias: link.alias,
          line: link.line,
          resolved_path: link.resolvedPath,
          exists: link.exists,
        })),
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

  // get_weighted_links - Get outgoing links with edge weights
  server.tool(
    'get_weighted_links',
    'Get outgoing links from a note ranked by edge weight. Weights reflect link survival, co-session access, and source activity. Time decay is applied at query time.',
    {
      path: z.string().describe('Path to the note (e.g., "daily/2026-02-24.md")'),
      min_weight: z.number().default(0).describe('Minimum weight threshold (default 0 = all links)'),
      limit: z.number().default(20).describe('Maximum number of results to return'),
    },
    async ({ path: notePath, min_weight, limit: requestedLimit }) => {
      const stateDb = getStateDb?.();
      if (!stateDb) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not initialized' }) }] };
      }

      const limit = Math.min(requestedLimit ?? 20, MAX_LIMIT);
      const now = Date.now();

      const rows = stateDb.db.prepare(`
        SELECT target, weight, weight_updated_at
        FROM note_links
        WHERE note_path = ?
        ORDER BY weight DESC
      `).all(notePath) as Array<{ target: string; weight: number; weight_updated_at: number | null }>;

      const results = rows
        .map(row => {
          const daysSinceUpdated = row.weight_updated_at
            ? (now - row.weight_updated_at) / (1000 * 60 * 60 * 24)
            : 0;
          const decayFactor = Math.max(0.1, 1.0 - daysSinceUpdated / 180);
          const effectiveWeight = Math.round(row.weight * decayFactor * 1000) / 1000;
          return {
            target: row.target,
            weight: row.weight,
            weight_effective: effectiveWeight,
            last_updated: row.weight_updated_at,
          };
        })
        .filter(r => r.weight_effective >= min_weight)
        .slice(0, limit);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            note: notePath,
            count: results.length,
            links: results,
          }, null, 2),
        }],
      };
    }
  );

  // get_strong_connections - Bidirectional connections ranked by combined weight
  server.tool(
    'get_strong_connections',
    'Get bidirectional connections for a note ranked by combined edge weight. Returns both outgoing and incoming links.',
    {
      path: z.string().describe('Path to the note (e.g., "daily/2026-02-24.md")'),
      limit: z.number().default(20).describe('Maximum number of results to return'),
    },
    async ({ path: notePath, limit: requestedLimit }) => {
      const stateDb = getStateDb?.();
      if (!stateDb) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not initialized' }) }] };
      }

      const limit = Math.min(requestedLimit ?? 20, MAX_LIMIT);

      // For incoming links, we need to resolve target names to note_paths.
      // note_links.target stores lowercase wikilink text, so we look for
      // rows where target matches the note's entity name (file stem).
      const stem = notePath.replace(/\.md$/, '').split('/').pop()?.toLowerCase() ?? '';

      const rows = stateDb.db.prepare(`
        SELECT target AS node, weight, 'outgoing' AS direction
        FROM note_links WHERE note_path = ?
        UNION ALL
        SELECT note_path AS node, weight, 'incoming' AS direction
        FROM note_links WHERE target = ?
        ORDER BY weight DESC
        LIMIT ?
      `).all(notePath, stem, limit) as Array<{ node: string; weight: number; direction: string }>;

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            note: notePath,
            count: rows.length,
            connections: rows.map(r => ({
              node: r.node,
              weight: r.weight,
              direction: r.direction,
            })),
          }, null, 2),
        }],
      };
    }
  );

}
