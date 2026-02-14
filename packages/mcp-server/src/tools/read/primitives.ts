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
  getNotesModifiedOn,
  getNotesInRange,
  getStaleNotes,
  getContemporaneousNotes,
  getActivitySummary,
} from './temporal.js';

import {
  getNoteStructure,
  getHeadings,
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
  getCommonNeighbors,
  findBidirectionalLinks,
  findDeadEnds,
  findSources,
  getConnectionStrength,
} from './graphAdvanced.js';

import {
  getFrontmatterSchema,
  getFieldValues,
  findFrontmatterInconsistencies,
  validateFrontmatter,
  findMissingFrontmatter,
} from './frontmatter.js';

import type { FlywheelConfig } from '../../core/read/config.js';

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
  // TEMPORAL PRIMITIVES
  // ============================================

  // get_notes_modified_on
  server.registerTool(
    'get_notes_modified_on',
    {
      title: 'Get Notes Modified On Date',
      description: 'Get all notes that were modified on a specific date.',
      inputSchema: {
        date: z.string().describe('Date in YYYY-MM-DD format'),
        limit: z.coerce.number().default(50).describe('Maximum number of results to return'),
        offset: z.coerce.number().default(0).describe('Number of results to skip (for pagination)'),
      },
    },
    async ({ date, limit: requestedLimit, offset }) => {
      const limit = Math.min(requestedLimit ?? 50, MAX_LIMIT);
      const index = getIndex();
      const allResults = getNotesModifiedOn(index, date);
      const result = allResults.slice(offset, offset + limit);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          date,
          total_count: allResults.length,
          returned_count: result.length,
          notes: result.map(n => ({
            ...n,
            created: n.created?.toISOString(),
            modified: n.modified.toISOString(),
          })),
        }, null, 2) }],
      };
    }
  );

  // get_notes_in_range
  server.registerTool(
    'get_notes_in_range',
    {
      title: 'Get Notes In Date Range',
      description: 'Get all notes modified within a date range.',
      inputSchema: {
        start_date: z.string().describe('Start date in YYYY-MM-DD format'),
        end_date: z.string().describe('End date in YYYY-MM-DD format'),
        limit: z.coerce.number().default(50).describe('Maximum number of results to return'),
        offset: z.coerce.number().default(0).describe('Number of results to skip (for pagination)'),
      },
    },
    async ({ start_date, end_date, limit: requestedLimit, offset }) => {
      const limit = Math.min(requestedLimit ?? 50, MAX_LIMIT);
      const index = getIndex();
      const allResults = getNotesInRange(index, start_date, end_date);
      const result = allResults.slice(offset, offset + limit);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          start_date,
          end_date,
          total_count: allResults.length,
          returned_count: result.length,
          notes: result.map(n => ({
            ...n,
            created: n.created?.toISOString(),
            modified: n.modified.toISOString(),
          })),
        }, null, 2) }],
      };
    }
  );

  // get_stale_notes
  server.registerTool(
    'get_stale_notes',
    {
      title: 'Get Stale Notes',
      description: 'Find important notes (by backlink count) that have not been modified recently.',
      inputSchema: {
        days: z.coerce.number().describe('Notes not modified in this many days'),
        min_backlinks: z.coerce.number().default(1).describe('Minimum backlinks to be considered important'),
        limit: z.coerce.number().default(50).describe('Maximum results to return'),
      },
    },
    async ({ days, min_backlinks, limit: requestedLimit }) => {
      const limit = Math.min(requestedLimit ?? 50, MAX_LIMIT);
      const index = getIndex();
      const result = getStaleNotes(index, days, min_backlinks).slice(0, limit);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          criteria: { days, min_backlinks },
          count: result.length,
          notes: result.map(n => ({
            ...n,
            modified: n.modified.toISOString(),
          })),
        }, null, 2) }],
      };
    }
  );

  // get_contemporaneous_notes
  server.registerTool(
    'get_contemporaneous_notes',
    {
      title: 'Get Contemporaneous Notes',
      description: 'Find notes that were edited around the same time as a given note.',
      inputSchema: {
        path: z.string().describe('Path to the reference note'),
        hours: z.coerce.number().default(24).describe('Time window in hours'),
        limit: z.coerce.number().default(50).describe('Maximum number of results to return'),
        offset: z.coerce.number().default(0).describe('Number of results to skip (for pagination)'),
      },
    },
    async ({ path, hours, limit: requestedLimit, offset }) => {
      const limit = Math.min(requestedLimit ?? 50, MAX_LIMIT);
      const index = getIndex();
      const allResults = getContemporaneousNotes(index, path, hours);
      const result = allResults.slice(offset, offset + limit);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          reference_note: path,
          window_hours: hours,
          total_count: allResults.length,
          returned_count: result.length,
          notes: result.map(n => ({
            ...n,
            modified: n.modified.toISOString(),
          })),
        }, null, 2) }],
      };
    }
  );

  // get_activity_summary
  server.registerTool(
    'get_activity_summary',
    {
      title: 'Get Activity Summary',
      description: 'Get a summary of vault activity over a period.',
      inputSchema: {
        days: z.coerce.number().default(7).describe('Number of days to analyze'),
      },
    },
    async ({ days }) => {
      const index = getIndex();
      const result = getActivitySummary(index, days);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ============================================
  // STRUCTURE PRIMITIVES
  // ============================================

  // get_note_structure
  server.registerTool(
    'get_note_structure',
    {
      title: 'Get Note Structure',
      description: 'Get the heading structure and sections of a note.',
      inputSchema: {
        path: z.string().describe('Path to the note'),
      },
    },
    async ({ path }) => {
      const index = getIndex();
      const vaultPath = getVaultPath();
      const result = await getNoteStructure(index, path, vaultPath);

      if (!result) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Note not found', path }, null, 2) }],
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // get_headings
  server.registerTool(
    'get_headings',
    {
      title: 'Get Headings',
      description: 'Get all headings from a note (lightweight).',
      inputSchema: {
        path: z.string().describe('Path to the note'),
      },
    },
    async ({ path }) => {
      const index = getIndex();
      const vaultPath = getVaultPath();
      const result = await getHeadings(index, path, vaultPath);

      if (!result) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Note not found', path }, null, 2) }],
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          path,
          heading_count: result.length,
          headings: result,
        }, null, 2) }],
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
  // TASK PRIMITIVES
  // ============================================

  // get_all_tasks
  server.registerTool(
    'get_all_tasks',
    {
      title: 'Get All Tasks',
      description: 'Get all tasks from the vault with filtering options.',
      inputSchema: {
        status: z.enum(['open', 'completed', 'cancelled', 'all']).default('all').describe('Filter by task status'),
        folder: z.string().optional().describe('Limit to notes in this folder'),
        tag: z.string().optional().describe('Filter to tasks with this tag'),
        limit: z.coerce.number().default(25).describe('Maximum tasks to return'),
      },
    },
    async ({ status, folder, tag, limit: requestedLimit }) => {
      const limit = Math.min(requestedLimit ?? 25, MAX_LIMIT);
      const index = getIndex();
      const vaultPath = getVaultPath();
      const config = getConfig();
      const result = await getAllTasks(index, vaultPath, {
        status,
        folder,
        tag,
        limit,
        excludeTags: config.exclude_task_tags,
      });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // get_tasks_from_note
  server.registerTool(
    'get_tasks_from_note',
    {
      title: 'Get Tasks From Note',
      description: 'Get all tasks from a specific note.',
      inputSchema: {
        path: z.string().describe('Path to the note'),
      },
    },
    async ({ path }) => {
      const index = getIndex();
      const vaultPath = getVaultPath();
      const config = getConfig();
      const result = await getTasksFromNote(index, path, vaultPath, config.exclude_task_tags || []);

      if (!result) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Note not found', path }, null, 2) }],
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          path,
          task_count: result.length,
          open: result.filter(t => t.status === 'open').length,
          completed: result.filter(t => t.status === 'completed').length,
          tasks: result,
        }, null, 2) }],
      };
    }
  );

  // get_tasks_with_due_dates
  server.registerTool(
    'get_tasks_with_due_dates',
    {
      title: 'Get Tasks With Due Dates',
      description: 'Get tasks that have due dates, sorted by date.',
      inputSchema: {
        status: z.enum(['open', 'completed', 'cancelled', 'all']).default('open').describe('Filter by status'),
        folder: z.string().optional().describe('Limit to notes in this folder'),
        limit: z.coerce.number().default(25).describe('Maximum number of results to return'),
        offset: z.coerce.number().default(0).describe('Number of results to skip (for pagination)'),
      },
    },
    async ({ status, folder, limit: requestedLimit, offset }) => {
      const limit = Math.min(requestedLimit ?? 25, MAX_LIMIT);
      const index = getIndex();
      const vaultPath = getVaultPath();
      const config = getConfig();
      const allResults = await getTasksWithDueDates(index, vaultPath, {
        status,
        folder,
        excludeTags: config.exclude_task_tags,
      });
      const result = allResults.slice(offset, offset + limit);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          total_count: allResults.length,
          returned_count: result.length,
          tasks: result,
        }, null, 2) }],
      };
    }
  );

  // get_incomplete_tasks
  server.registerTool(
    'get_incomplete_tasks',
    {
      title: 'Get Incomplete Tasks',
      description: 'Get all incomplete (open) tasks from the vault. Simpler interface that defaults to open tasks only.',
      inputSchema: {
        folder: z.string().optional().describe('Limit to notes in this folder'),
        tag: z.string().optional().describe('Filter to tasks with this tag'),
        limit: z.coerce.number().default(50).describe('Maximum tasks to return'),
        offset: z.coerce.number().default(0).describe('Number of results to skip (for pagination)'),
      },
    },
    async ({ folder, tag, limit: requestedLimit, offset }) => {
      const limit = Math.min(requestedLimit ?? 50, MAX_LIMIT);
      const index = getIndex();
      const vaultPath = getVaultPath();
      const config = getConfig();
      const result = await getAllTasks(index, vaultPath, {
        status: 'open',
        folder,
        tag,
        limit: limit + offset,
        excludeTags: config.exclude_task_tags,
      });
      const paginatedTasks = result.tasks.slice(offset, offset + limit);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          total_incomplete: result.open_count,
          returned_count: paginatedTasks.length,
          tasks: paginatedTasks,
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
      description: 'Find the shortest path of links between two notes.',
      inputSchema: {
        from: z.string().describe('Starting note path'),
        to: z.string().describe('Target note path'),
        max_depth: z.coerce.number().default(10).describe('Maximum path length to search'),
      },
    },
    async ({ from, to, max_depth }) => {
      const index = getIndex();
      const result = getLinkPath(index, from, to, max_depth);

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

  // find_bidirectional_links
  server.registerTool(
    'find_bidirectional_links',
    {
      title: 'Find Bidirectional Links',
      description: 'Find pairs of notes that link to each other (mutual links).',
      inputSchema: {
        path: z.string().optional().describe('Limit to links involving this note'),
        limit: z.coerce.number().default(50).describe('Maximum number of results to return'),
        offset: z.coerce.number().default(0).describe('Number of results to skip (for pagination)'),
      },
    },
    async ({ path, limit: requestedLimit, offset }) => {
      const limit = Math.min(requestedLimit ?? 50, MAX_LIMIT);
      const index = getIndex();
      const allResults = findBidirectionalLinks(index, path);
      const result = allResults.slice(offset, offset + limit);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          scope: path || 'all',
          total_count: allResults.length,
          returned_count: result.length,
          pairs: result,
        }, null, 2) }],
      };
    }
  );

  // find_dead_ends
  server.registerTool(
    'find_dead_ends',
    {
      title: 'Find Dead Ends',
      description: 'Find notes with backlinks but no outgoing links (consume but do not contribute).',
      inputSchema: {
        folder: z.string().optional().describe('Limit to notes in this folder'),
        min_backlinks: z.coerce.number().default(1).describe('Minimum backlinks required'),
        limit: z.coerce.number().default(50).describe('Maximum number of results to return'),
        offset: z.coerce.number().default(0).describe('Number of results to skip (for pagination)'),
      },
    },
    async ({ folder, min_backlinks, limit: requestedLimit, offset }) => {
      const limit = Math.min(requestedLimit ?? 50, MAX_LIMIT);
      const index = getIndex();
      const allResults = findDeadEnds(index, folder, min_backlinks);
      const result = allResults.slice(offset, offset + limit);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          criteria: { folder, min_backlinks },
          total_count: allResults.length,
          returned_count: result.length,
          dead_ends: result,
        }, null, 2) }],
      };
    }
  );

  // find_sources
  server.registerTool(
    'find_sources',
    {
      title: 'Find Sources',
      description: 'Find notes with outgoing links but no backlinks (contribute but not referenced).',
      inputSchema: {
        folder: z.string().optional().describe('Limit to notes in this folder'),
        min_outlinks: z.coerce.number().default(1).describe('Minimum outlinks required'),
        limit: z.coerce.number().default(50).describe('Maximum number of results to return'),
        offset: z.coerce.number().default(0).describe('Number of results to skip (for pagination)'),
      },
    },
    async ({ folder, min_outlinks, limit: requestedLimit, offset }) => {
      const limit = Math.min(requestedLimit ?? 50, MAX_LIMIT);
      const index = getIndex();
      const allResults = findSources(index, folder, min_outlinks);
      const result = allResults.slice(offset, offset + limit);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          criteria: { folder, min_outlinks },
          total_count: allResults.length,
          returned_count: result.length,
          sources: result,
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

  // ============================================
  // FRONTMATTER PRIMITIVES
  // ============================================

  // get_frontmatter_schema
  server.registerTool(
    'get_frontmatter_schema',
    {
      title: 'Get Frontmatter Schema',
      description: 'Analyze all frontmatter fields used across the vault.',
      inputSchema: {},
    },
    async () => {
      const index = getIndex();
      const result = getFrontmatterSchema(index);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // get_field_values
  server.registerTool(
    'get_field_values',
    {
      title: 'Get Field Values',
      description: 'Get all unique values for a specific frontmatter field.',
      inputSchema: {
        field: z.string().describe('Frontmatter field name'),
      },
    },
    async ({ field }) => {
      const index = getIndex();
      const result = getFieldValues(index, field);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // find_frontmatter_inconsistencies
  server.registerTool(
    'find_frontmatter_inconsistencies',
    {
      title: 'Find Frontmatter Inconsistencies',
      description: 'Find fields that have multiple different types across notes.',
      inputSchema: {},
    },
    async () => {
      const index = getIndex();
      const result = findFrontmatterInconsistencies(index);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          inconsistency_count: result.length,
          inconsistencies: result,
        }, null, 2) }],
      };
    }
  );

  // validate_frontmatter
  server.registerTool(
    'validate_frontmatter',
    {
      title: 'Validate Frontmatter',
      description: 'Validate notes against a schema. Returns notes with issues (missing fields, wrong types, invalid values).',
      inputSchema: {
        schema: z.record(z.object({
          required: z.boolean().optional().describe('Whether field is required'),
          type: z.union([z.string(), z.array(z.string())]).optional().describe('Expected type(s)'),
          values: z.array(z.unknown()).optional().describe('Allowed values'),
        })).describe('Schema defining expected frontmatter fields'),
        folder: z.string().optional().describe('Limit to notes in this folder'),
      },
    },
    async (params) => {
      const index = getIndex();
      const result = validateFrontmatter(
        index,
        params.schema as Record<string, { required?: boolean; type?: string | string[]; values?: unknown[] }>,
        params.folder
      );

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          notes_with_issues: result.length,
          results: result,
        }, null, 2) }],
      };
    }
  );

  // find_missing_frontmatter
  server.registerTool(
    'find_missing_frontmatter',
    {
      title: 'Find Missing Frontmatter',
      description: 'Find notes missing expected frontmatter fields based on their folder.',
      inputSchema: {
        folder_schemas: z.record(z.array(z.string())).describe('Map of folder paths to required field names'),
      },
    },
    async (params) => {
      const index = getIndex();
      const result = findMissingFrontmatter(
        index,
        params.folder_schemas as Record<string, string[]>
      );

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          notes_with_missing_fields: result.length,
          results: result,
        }, null, 2) }],
      };
    }
  );
}
