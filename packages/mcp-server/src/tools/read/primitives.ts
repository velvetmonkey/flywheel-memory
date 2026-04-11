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

import { getExcludeTags, type FlywheelConfig } from '../../core/read/config.js';
import { isTaskCacheReady, queryTasksFromCache, refreshIfStale } from '../../core/read/taskCache.js';
import { getEntityByName, type StateDb } from '@velvetmonkey/vault-core';

/**
 * Register all Phase 5 primitive tools
 */
export function registerPrimitiveTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string,
  getConfig: () => FlywheelConfig = () => ({}),
  getStateDb: () => StateDb | null = () => null
) {
  // ============================================
  // NOTE_READ — merged structure/section/sections tool (T43 B2)
  // ============================================

  server.tool(
    'note_read',
    'Read vault note content. action=structure (default): heading outline, frontmatter, backlinks, outlinks, word count, optional full section text — prefer over built-in Read for vault notes. action=section: text under one heading by name. action=sections: vault-wide heading search by regex. Returns enriched note metadata. Does not search or mutate.',
    {
      action: z.enum(['structure', 'section', 'sections']).describe(
        'Operation: structure (read note outline + metadata) | section (read one section by heading) | sections (vault-wide heading search)'
      ),

      // [structure|section] params
      path: z.string().optional().describe('[structure|section] Vault-relative note path'),
      include_content: z.boolean().optional().describe('[structure] Include full section text under each heading (default false)'),
      max_content_chars: z.number().optional().describe('[structure] Max total chars of section content (default 20000)'),

      // [section] params
      heading: z.string().optional().describe('[section] Heading text to find'),
      include_subheadings: z.boolean().optional().describe('[section] Include content under subheadings (default true)'),
      max_section_chars: z.number().optional().describe('[section] Max chars of section content (default 10000)'),

      // [sections] params
      pattern: z.string().optional().describe('[sections] Regex to match heading text'),
      folder: z.string().optional().describe('[sections] Limit to notes in this folder'),
      limit: z.coerce.number().optional().describe('[sections] Max results (default 50)'),
      offset: z.coerce.number().optional().describe('[sections] Results to skip for pagination (default 0)'),
    },
    async ({ action, path, include_content, max_content_chars, heading, include_subheadings, max_section_chars, pattern, folder, limit: requestedLimit, offset: requestedOffset }) => {
      const index = getIndex();
      const vaultPath = getVaultPath();

      // ── action=structure ───────────────────────────────────────────────
      if (action === 'structure') {
        if (!path) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({
            error: 'action=structure requires path.',
            example: { action: 'structure', path: 'projects/alpha.md' },
          }, null, 2) }] };
        }

        const result = await getNoteStructure(index, path, vaultPath);
        if (!result) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Note not found', path }, null, 2) }] };
        }

        const maxChars = max_content_chars ?? 20000;
        let totalChars = 0;
        let truncated = false;
        if (include_content) {
          for (const section of result.sections) {
            if (totalChars >= maxChars) { truncated = true; break; }
            const sectionResult = await getSectionContent(index, path, section.heading.text, vaultPath, true);
            if (sectionResult) {
              let content = sectionResult.content;
              const remaining = maxChars - totalChars;
              if (content.length > remaining) {
                const sliced = content.slice(0, remaining);
                const lastBreak = sliced.lastIndexOf('\n\n');
                content = lastBreak > 0 ? sliced.slice(0, lastBreak) : sliced;
                truncated = true;
              }
              (section as any).content = content;
              totalChars += content.length;
            }
          }
        }

        const note = index.notes.get(path);
        const enriched: Record<string, unknown> = { ...result };
        if (note) {
          enriched.frontmatter = note.frontmatter;
          enriched.tags = note.tags;
          enriched.aliases = note.aliases;
          const normalizedPath = path.toLowerCase().replace(/\.md$/, '');
          const backlinks = index.backlinks.get(normalizedPath) || [];
          enriched.backlink_count = backlinks.length;
          enriched.outlink_count = note.outlinks.length;
        }

        const stateDb = getStateDb();
        if (stateDb && note) {
          try {
            const entity = getEntityByName(stateDb, note.title);
            if (entity) {
              enriched.category = entity.category;
              enriched.hub_score = entity.hubScore;
              if (entity.description) enriched.description = entity.description;
            }
          } catch { /* entity lookup is best-effort */ }
        }

        if (include_content) {
          enriched.truncated = truncated;
          enriched.returned_chars = totalChars;
        }

        return { content: [{ type: 'text' as const, text: JSON.stringify(enriched, null, 2) }] };
      }

      // ── action=section ─────────────────────────────────────────────────
      if (action === 'section') {
        if (!path) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({
            error: 'action=section requires path.',
            example: { action: 'section', path: 'projects/alpha.md', heading: 'Background' },
          }, null, 2) }] };
        }
        if (!heading) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({
            error: 'action=section requires heading.',
            example: { action: 'section', path: 'projects/alpha.md', heading: 'Background' },
          }, null, 2) }] };
        }

        const result = await getSectionContent(index, path, heading, vaultPath, include_subheadings ?? true);
        if (!result) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Section not found', path, heading }, null, 2) }] };
        }

        const maxChars = max_section_chars ?? 10000;
        let truncated = false;
        if (result.content.length > maxChars) {
          const sliced = result.content.slice(0, maxChars);
          const lastBreak = sliced.lastIndexOf('\n\n');
          result.content = lastBreak > 0 ? sliced.slice(0, lastBreak) : sliced;
          truncated = true;
        }

        return { content: [{ type: 'text' as const, text: JSON.stringify({ ...result, truncated }, null, 2) }] };
      }

      // ── action=sections ────────────────────────────────────────────────
      if (!pattern) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({
          error: 'action=sections requires pattern.',
          example: { action: 'sections', pattern: 'Status', folder: 'projects/' },
        }, null, 2) }] };
      }

      const limit = Math.min(requestedLimit ?? 50, MAX_LIMIT);
      const offset = requestedOffset ?? 0;
      const allResults = await findSections(index, pattern, vaultPath, folder);
      const result = allResults.slice(offset, offset + limit);

      return { content: [{ type: 'text' as const, text: JSON.stringify({
        pattern,
        folder,
        total_count: allResults.length,
        returned_count: result.length,
        sections: result,
      }, null, 2) }] };
    }
  );

  // ============================================
  // UNIFIED TASKS TOOL
  // ============================================

  server.registerTool(
    'tasks',
    {
      title: 'Tasks',
      description: 'Use when listing, filtering, or counting tasks across the vault. Produces task items with status, text, due date, path, and line number. Returns total and per-status counts with paginated results. Does not toggle or create tasks — use vault_toggle_task or vault_add_task to mutate.',
      inputSchema: {
        path: z.string().optional().describe('Scope to tasks from this specific note path'),
        status: z.enum(['open', 'completed', 'cancelled']).default('open').describe('Filter by task status'),
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
        const result = await getTasksFromNote(index, path, vaultPath, getExcludeTags(config));

        if (!result) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Note not found', path }, null, 2) }],
          };
        }

        // Filter by status
        let filtered = result;
        if (status) {
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
        refreshIfStale(vaultPath, index, getExcludeTags(config));

        if (has_due_date) {
          const result = queryTasksFromCache({
            status,
            folder,
            excludeTags: getExcludeTags(config),
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
          excludeTags: getExcludeTags(config),
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
          excludeTags: getExcludeTags(config),
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
        excludeTags: getExcludeTags(config),
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
      description: 'Use when tracing how two notes connect. Produces the shortest chain of wikilinks from source to target, showing each intermediate note. Returns an ordered path array. Answers: "What\'s the connection chain between A and B?" Does not consider semantic similarity — only follows explicit wikilinks.',
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
      description: 'Use when finding what two notes have in common. Produces shared backlinks and forward links between two specified notes — the notes they both link to or are both linked from. Returns common neighbor paths with link directions. Answers: "How are these two notes related through shared connections?"',
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
      description: 'Use when measuring how strongly two notes relate. Produces a composite score from direct links, shared neighbors, co-occurrence, and path distance. Returns a numeric strength value with factor breakdown. Does not list individual connections — use get_common_neighbors for detail.',
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
