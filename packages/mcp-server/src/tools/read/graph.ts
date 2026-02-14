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
  findOrphanNotes,
  findHubNotes,
  resolveTarget,
} from '../../core/read/graph.js';
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
    const lines = content.split('\n');

    const startLine = Math.max(0, line - 1 - contextLines);
    const endLine = Math.min(lines.length, line + contextLines);

    return lines.slice(startLine, endLine).join('\n').trim();
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
  getVaultPath: () => string
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
        limit: z.coerce.number().default(50).describe('Maximum number of results to return'),
        offset: z.coerce.number().default(0).describe('Number of results to skip (for pagination)'),
      },
      outputSchema: GetBacklinksOutputSchema,
    },
    async ({ path: notePath, include_context, limit: requestedLimit, offset }): Promise<{
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

  // find_orphan_notes - Find notes with no backlinks
  const OrphanNoteSchema = z.object({
    path: z.string().describe('Path to the orphan note'),
    title: z.string().describe('Title of the note'),
    modified: z.string().describe('Last modified date (ISO format)'),
  });

  const FindOrphansOutputSchema = {
    orphan_count: z.coerce.number().describe('Total number of orphan notes found'),
    returned_count: z.coerce.number().describe('Number of orphans returned (may be limited)'),
    folder: z.string().optional().describe('Folder filter if specified'),
    orphans: z.array(OrphanNoteSchema).describe('List of orphan notes'),
  };

  type FindOrphansOutput = {
    orphan_count: number;
    returned_count: number;
    folder?: string;
    orphans: Array<{
      path: string;
      title: string;
      modified: string;
    }>;
  };

  server.registerTool(
    'find_orphan_notes',
    {
      title: 'Find Orphan Notes',
      description: 'Find notes that have no backlinks (no other notes link to them). Useful for finding disconnected content.',
      inputSchema: {
        folder: z.string().optional().describe('Limit search to a specific folder (e.g., "daily-notes/")'),
        limit: z.coerce.number().default(50).describe('Maximum number of results to return'),
        offset: z.coerce.number().default(0).describe('Number of results to skip (for pagination)'),
      },
      outputSchema: FindOrphansOutputSchema,
    },
    async ({ folder, limit: requestedLimit, offset }): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      structuredContent: FindOrphansOutput;
    }> => {
      requireIndex();
      const limit = Math.min(requestedLimit ?? 50, MAX_LIMIT);
      const index = getIndex();

      const allOrphans = findOrphanNotes(index, folder);
      const orphans = allOrphans.slice(offset, offset + limit);

      const output: FindOrphansOutput = {
        orphan_count: allOrphans.length,
        returned_count: orphans.length,
        folder,
        orphans: orphans.map((o) => ({
          path: o.path,
          title: o.title,
          modified: o.modified.toISOString(),
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

  // find_hub_notes - Find highly connected notes
  const HubNoteSchema = z.object({
    path: z.string().describe('Path to the hub note'),
    title: z.string().describe('Title of the note'),
    backlink_count: z.coerce.number().describe('Number of notes linking TO this note'),
    forward_link_count: z.coerce.number().describe('Number of notes this note links TO'),
    total_connections: z.coerce.number().describe('Total connections (backlinks + forward links)'),
  });

  const FindHubsOutputSchema = {
    hub_count: z.coerce.number().describe('Total number of hub notes found'),
    returned_count: z.coerce.number().describe('Number of hubs returned (may be limited)'),
    min_links: z.coerce.number().describe('Minimum connection threshold used'),
    hubs: z.array(HubNoteSchema).describe('List of hub notes, sorted by total connections'),
  };

  type FindHubsOutput = {
    hub_count: number;
    returned_count: number;
    min_links: number;
    hubs: Array<{
      path: string;
      title: string;
      backlink_count: number;
      forward_link_count: number;
      total_connections: number;
    }>;
  };

  server.registerTool(
    'find_hub_notes',
    {
      title: 'Find Hub Notes',
      description: 'Find highly connected notes (hubs) that have many links to/from other notes. Useful for identifying key concepts.',
      inputSchema: {
        min_links: z.coerce.number().default(5).describe('Minimum total connections (backlinks + forward links) to qualify as a hub'),
        limit: z.coerce.number().default(50).describe('Maximum number of results to return'),
        offset: z.coerce.number().default(0).describe('Number of results to skip (for pagination)'),
      },
      outputSchema: FindHubsOutputSchema,
    },
    async ({ min_links, limit: requestedLimit, offset }): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      structuredContent: FindHubsOutput;
    }> => {
      requireIndex();
      const limit = Math.min(requestedLimit ?? 50, MAX_LIMIT);
      const index = getIndex();

      const allHubs = findHubNotes(index, min_links);
      const hubs = allHubs.slice(offset, offset + limit);

      const output: FindHubsOutput = {
        hub_count: allHubs.length,
        returned_count: hubs.length,
        min_links,
        hubs: hubs.map((h) => ({
          path: h.path,
          title: h.title,
          backlink_count: h.backlink_count,
          forward_link_count: h.forward_link_count,
          total_connections: h.total_connections,
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
}
