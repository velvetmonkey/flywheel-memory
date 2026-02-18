/**
 * Phase 5 Primitives - Pure MCP value tools
 *
 * Registers all new temporal, structure, task, graph, and frontmatter primitives
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import { MAX_LIMIT } from '../../core/read/constants.js';
import { requireIndex } from '../../core/read/indexGuard.js';

// Import primitive implementations
import {
  getNoteStructure,
  getSectionContent,
  findSections,
} from './structure.js';

import {
  getAllTasks,
  getTasksFromNote,
  getTasksWithDueDates,
} from './tasks.js';

import {
  getLinkPath,
  getWeightedLinkPath,
  getCommonNeighbors,
  getConnectionStrength,
} from './graphAdvanced.js';

import type { FlywheelConfig } from '../../core/read/config.js';
import { isTaskCacheReady, queryTasksFromCache, refreshIfStale } from '../../core/read/taskCache.js';

/**
 * Register all Phase 5 primitive tools
 */
export function registerPrimitiveTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string,
  getConfig: () => FlywheelConfig = () => ({})
) {
  // ============================================
  // STRUCTURE PRIMITIVES
  // ============================================

  // get_note_structure - also absorbs get_headings and vault_list_sections
  server.registerTool(
    'get_note_structure',
    {
      title: 'Get Note Structure',
      description: 'Get the heading structure and sections of a note. Returns headings, sections hierarchy, word count, and line count.',
      inputSchema: {
        path: z.string().describe('Path to the note'),
        include_content: z.boolean().default(false).describe('Include the text content under each top-level section'),
      },
    },
    async ({ path, include_content }) => {
      const index = getIndex();
      const vaultPath = getVaultPath();
      const result = await getNoteStructure(index, path, vaultPath);

      if (!result) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Note not found', path }, null, 2) }],
        };
      }

      // Optionally include section content
      if (include_content) {
        for (const section of result.sections) {
          const sectionResult = await getSectionContent(index, path, section.heading.text, vaultPath, true);
          if (sectionResult) {
            (section as any).content = sectionResult.content;
          }
        }
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // get_section_content
  server.registerTool(
    'get_section_content',
    {
      title: 'Get Section Content',
      description: 'Get the content under a specific heading in a note.',
      inputSchema: {
        path: z.string().describe('Path to the note'),
        heading: z.string().describe('Heading text to find'),
        include_subheadings: z.boolean().default(true).describe('Include content under subheadings'),
      },
    },
    async ({ path, heading, include_subheadings }) => {
      const index = getIndex();
      const vaultPath = getVaultPath();
      const result = await getSectionContent(index, path, heading, vaultPath, include_subheadings);

      if (!result) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            error: 'Section not found',
            path,
            heading,
          }, null, 2) }],
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // find_sections
  server.registerTool(
    'find_sections',
    {
      title: 'Find Sections',
      description: 'Find all sections across vault matching a heading pattern.',
      inputSchema: {
        pattern: z.string().describe('Regex pattern to match heading text'),
        folder: z.string().optional().describe('Limit to notes in this folder'),
        limit: z.coerce.number().default(50).describe('Maximum number of results to return'),
        offset: z.coerce.number().default(0).describe('Number of results to skip (for pagination)'),
      },
    },
    async ({ pattern, folder, limit: requestedLimit, offset }) => {
      const limit = Math.min(requestedLimit ?? 50, MAX_LIMIT);
      const index = getIndex();
      const vaultPath = getVaultPath();
      const allResults = await findSections(index, pattern, vaultPath, folder);
      const result = allResults.slice(offset, offset + limit);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          pattern,
          folder,
          total_count: allResults.length,
          returned_count: result.length,
          sections: result,
        }, null, 2) }],
      };
    }
  );

  // ============================================
  // UNIFIED TASKS TOOL
  // ============================================

  server.registerTool(
    'tasks',
    {
      title: 'Tasks',
      description: 'Query tasks from the vault. Use path to scope to a single note. Use status to filter (default: "open"). Use has_due_date to find tasks with due dates.',
      inputSchema: {
        path: z.string().optional().describe('Scope to tasks from this specific note path'),
        status: z.enum(['open', 'completed', 'cancelled', 'all']).default('open').describe('Filter by task status'),
        has_due_date: z.boolean().optional().describe('If true, only return tasks with due dates (sorted by date)'),
        folder: z.string().optional().describe('Limit to tasks in notes within this folder'),
        tag: z.string().optional().describe('Filter to tasks with this tag'),
        limit: z.coerce.number().default(25).describe('Maximum tasks to return'),
        offset: z.coerce.number().default(0).describe('Number of results to skip (for pagination)'),
      },
    },
    async ({ path, status, has_due_date, folder, tag, limit: requestedLimit, offset }) => {
      const limit = Math.min(requestedLimit ?? 25, MAX_LIMIT);
      const index = getIndex();
      const vaultPath = getVaultPath();
      const config = getConfig();

      // Single-note mode — always read from file (fast for one note)
      if (path) {
        const result = await getTasksFromNote(index, path, vaultPath, config.exclude_task_tags || []);

        if (!result) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Note not found', path }, null, 2) }],
          };
        }

        // Filter by status
        let filtered = result;
        if (status !== 'all') {
          filtered = result.filter(t => t.status === status);
        }

        const paged = filtered.slice(offset, offset + limit);

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            path,
            total_count: filtered.length,
            returned_count: paged.length,
            open: result.filter(t => t.status === 'open').length,
            completed: result.filter(t => t.status === 'completed').length,
            tasks: paged,
          }, null, 2) }],
        };
      }

      // Use task cache if available (fast SQL queries vs full disk scan)
      if (isTaskCacheReady()) {
        // Trigger background refresh if stale
        refreshIfStale(vaultPath, index, config.exclude_task_tags);

        if (has_due_date) {
          const result = queryTasksFromCache({
            status,
            folder,
            excludeTags: config.exclude_task_tags,
            has_due_date: true,
            limit,
            offset,
          });

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              total_count: result.total,
              returned_count: result.tasks.length,
              tasks: result.tasks,
            }, null, 2) }],
          };
        }

        const result = queryTasksFromCache({
          status,
          folder,
          tag,
          excludeTags: config.exclude_task_tags,
          limit,
          offset,
        });

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            total_count: result.total,
            open_count: result.open_count,
            completed_count: result.completed_count,
            cancelled_count: result.cancelled_count,
            returned_count: result.tasks.length,
            tasks: result.tasks,
          }, null, 2) }],
        };
      }

      // Fallback: full disk scan (cache not ready yet)
      if (has_due_date) {
        const allResults = await getTasksWithDueDates(index, vaultPath, {
          status,
          folder,
          excludeTags: config.exclude_task_tags,
        });
        const paged = allResults.slice(offset, offset + limit);

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            total_count: allResults.length,
            returned_count: paged.length,
            tasks: paged,
          }, null, 2) }],
        };
      }

      const result = await getAllTasks(index, vaultPath, {
        status,
        folder,
        tag,
        limit: limit + offset,
        excludeTags: config.exclude_task_tags,
      });
      const paged = result.tasks.slice(offset, offset + limit);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          total_count: result.total,
          open_count: result.open_count,
          completed_count: result.completed_count,
          cancelled_count: result.cancelled_count,
          returned_count: paged.length,
          tasks: paged,
        }, null, 2) }],
      };
    }
  );

  // ============================================
  // ADVANCED GRAPH PRIMITIVES
  // ============================================

  // get_link_path
  server.registerTool(
    'get_link_path',
    {
      title: 'Get Link Path',
      description: 'Find the shortest path of links between two notes. Use weighted=true to penalize hub nodes for more meaningful paths.',
      inputSchema: {
        from: z.string().describe('Starting note path'),
        to: z.string().describe('Target note path'),
        max_depth: z.coerce.number().default(10).describe('Maximum path length to search'),
        weighted: z.boolean().default(false).describe('Use weighted path-finding that penalizes hub nodes for more meaningful paths'),
      },
    },
    async ({ from, to, max_depth, weighted }) => {
      const index = getIndex();
      const result = weighted
        ? getWeightedLinkPath(index, from, to, max_depth)
        : getLinkPath(index, from, to, max_depth);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          from,
          to,
          ...result,
        }, null, 2) }],
      };
    }
  );

  // get_common_neighbors
  server.registerTool(
    'get_common_neighbors',
    {
      title: 'Get Common Neighbors',
      description: 'Find notes that both specified notes link to.',
      inputSchema: {
        note_a: z.string().describe('First note path'),
        note_b: z.string().describe('Second note path'),
      },
    },
    async ({ note_a, note_b }) => {
      const index = getIndex();
      const result = getCommonNeighbors(index, note_a, note_b);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          note_a,
          note_b,
          common_count: result.length,
          common_neighbors: result,
        }, null, 2) }],
      };
    }
  );

  // get_connection_strength
  server.registerTool(
    'get_connection_strength',
    {
      title: 'Get Connection Strength',
      description: 'Calculate the connection strength between two notes based on various factors.',
      inputSchema: {
        note_a: z.string().describe('First note path'),
        note_b: z.string().describe('Second note path'),
      },
    },
    async ({ note_a, note_b }) => {
      const index = getIndex();
      const result = getConnectionStrength(index, note_a, note_b);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          note_a,
          note_b,
          ...result,
        }, null, 2) }],
      };
    }
  );

}
