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
  findTasks,
  toggleTask,
} from '../write/tasks.js';

import {
  readVaultFile,
  writeVaultFile,
  WriteConflictError,
  findSection,
  injectMutationMetadata,
} from '../../core/write/writer.js';

import {
  ensureFileExists,
  handleGitCommit,
  formatMcpResult,
  errorResult,
  successResult,
} from '../../core/write/mutation-helpers.js';


import {
  getLinkPath,
  getWeightedLinkPath,
  getCommonNeighbors,
  getConnectionStrength,
} from './graphAdvanced.js';

import { getExcludeTags, type FlywheelConfig } from '../../core/read/config.js';
import { isTaskCacheReady, queryTasksFromCache, refreshIfStale, updateTaskCacheForFile } from '../../core/read/taskCache.js';
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
  // READ — merged structure/section/sections tool (T43 B2)
  // ============================================

  // Shared schema/handler for the canonical read tool
  const noteReadDesc = 'Read vault note content. action=structure (default): heading outline, frontmatter, backlinks, outlinks, word count, optional full section text — prefer over built-in Read for vault notes. action=section: text under one heading by name. action=sections: vault-wide heading search by regex. Returns enriched note metadata. Does not search or mutate.';
  const noteReadSchema = {
    action: z.enum(['structure', 'section', 'sections']).describe(
      'Operation: structure (read note outline + metadata) | section (read one section by heading) | sections (vault-wide heading search)'
    ),
    path: z.string().optional().describe('[structure|section] Vault-relative note path'),
    include_content: z.boolean().optional().describe('[structure] Include full section text under each heading (default false)'),
    max_content_chars: z.number().optional().describe('[structure] Max total chars of section content (default 20000)'),
    heading: z.string().optional().describe('[section] Heading text to find'),
    include_subheadings: z.boolean().optional().describe('[section] Include content under subheadings (default true)'),
    max_section_chars: z.number().optional().describe('[section] Max chars of section content (default 10000)'),
    pattern: z.string().optional().describe('[sections] Regex to match heading text'),
    folder: z.string().optional().describe('[sections] Limit to notes in this folder'),
    limit: z.coerce.number().optional().describe('[sections] Max results (default 50)'),
    offset: z.coerce.number().optional().describe('[sections] Results to skip for pagination (default 0)'),
  } as const;

  type NoteReadArgs = {
    action: 'structure' | 'section' | 'sections';
    path?: string; include_content?: boolean; max_content_chars?: number;
    heading?: string; include_subheadings?: boolean; max_section_chars?: number;
    pattern?: string; folder?: string; limit?: number; offset?: number;
  };

  const noteReadImpl = async ({ action, path, include_content, max_content_chars, heading, include_subheadings, max_section_chars, pattern, folder, limit: requestedLimit, offset: requestedOffset }: NoteReadArgs) => {
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
  }; // end noteReadImpl

  server.tool('read', noteReadDesc, noteReadSchema, noteReadImpl);

  // ============================================
  // UNIFIED TASKS TOOL
  // ============================================

  server.registerTool(
    'tasks',
    {
      title: 'Tasks',
      description: `Use to list, filter, or toggle tasks in the vault. Returns task items with path, status, and text. Does not create tasks — use vault_add_task for that. action: list (filter by status/folder/tag/path) | toggle (check/uncheck by path + text match)`,
      inputSchema: {
        action: z.enum(['list', 'toggle']).optional().default('list').describe('Operation: list=query tasks (default), toggle=check/uncheck a task'),
        // [list] query params
        path: z.string().optional().describe('[list] Scope to tasks from this note path. [toggle] Note containing the task (required for toggle)'),
        status: z.enum(['open', 'completed', 'cancelled']).default('open').describe('[list] Filter by task status'),
        has_due_date: z.boolean().optional().describe('[list] Only return tasks with due dates'),
        folder: z.string().optional().describe('[list] Limit to notes in this folder'),
        tag: z.string().optional().describe('[list] Filter to tasks with this tag'),
        limit: z.coerce.number().default(25).describe('[list] Maximum tasks to return'),
        offset: z.coerce.number().default(0).describe('[list] Results to skip (pagination)'),
        // [toggle] mutation params
        task: z.string().optional().describe('[toggle] Task text to find (partial match)'),
        section: z.string().optional().describe('[toggle] Limit task search to this section'),
        commit: z.boolean().optional().default(false).describe('[toggle] Commit this change to git'),
        dry_run: z.boolean().optional().default(false).describe('[toggle] Preview without writing'),
        agent_id: z.string().optional().describe('[toggle] Agent identifier for scoping'),
        session_id: z.string().optional().describe('[toggle] Session identifier for scoping'),
      },
    },
    async ({ action = 'list', path, status, has_due_date, folder, tag, limit: requestedLimit, offset, task, section, commit, dry_run, agent_id, session_id }) => {
      // ── action: toggle ──────────────────────────────────────────────────────
      if (action === 'toggle') {
        if (!path || !task) {
          return formatMcpResult(errorResult(path ?? '', 'toggle requires path and task'));
        }
        const vaultPath = getVaultPath();
        try {
          const existsError = await ensureFileExists(vaultPath, path);
          if (existsError) return formatMcpResult(existsError);

          const { content: fileContent, frontmatter, contentHash } = await readVaultFile(vaultPath, path);

          let sectionBoundary: ReturnType<typeof findSection> | undefined;
          if (section) {
            const found = findSection(fileContent, section);
            if (!found) return formatMcpResult(errorResult(path, `Section not found: ${section}`));
            sectionBoundary = found;
          }

          const tasks = findTasks(fileContent, sectionBoundary ?? undefined);
          const searchLower = task.toLowerCase();
          const matchingTask = tasks.find(t => t.text.toLowerCase().includes(searchLower));
          if (!matchingTask) return formatMcpResult(errorResult(path, `No task found matching "${task}"`));

          const toggleResult = toggleTask(fileContent, matchingTask.line);
          if (!toggleResult) return formatMcpResult(errorResult(path, 'Failed to toggle task'));

          const newStatus = toggleResult.newState ? 'completed' : 'incomplete';
          const checkbox = toggleResult.newState ? '[x]' : '[ ]';

          if (dry_run) {
            return formatMcpResult(successResult(path, `[dry run] Would toggle task to ${newStatus}`, {}, {
              preview: `${checkbox} ${matchingTask.text}`, dryRun: true,
            }));
          }

          let finalFrontmatter = frontmatter;
          if (agent_id || session_id) {
            finalFrontmatter = injectMutationMetadata(frontmatter, { agent_id, session_id });
          }
          await writeVaultFile(vaultPath, path, toggleResult.content, finalFrontmatter, 'LF', contentHash);
          await updateTaskCacheForFile(vaultPath, path).catch(() => {});
          const gitInfo = await handleGitCommit(vaultPath, path, commit ?? false, '[Flywheel:Task]');
          return formatMcpResult(successResult(path, `Toggled task to ${newStatus}`, gitInfo, {
            preview: `${checkbox} ${matchingTask.text}`,
          }));
        } catch (error) {
          const extras: Partial<import('../../core/write/types.js').MutationResult> = {};
          if (error instanceof WriteConflictError) {
            extras.warnings = [{ type: 'write_conflict', message: (error as Error).message, suggestion: 'Re-read and retry.' }];
          }
          return formatMcpResult(errorResult(path, `Failed to toggle task: ${error instanceof Error ? error.message : String(error)}`, extras));
        }
      }

      // ── action: list (default) ───────────────────────────────────────────────
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

  // get_link_path, get_common_neighbors, get_connection_strength retired (T43 B3+)
  // Use graph(action: path|neighbors|strength) instead

}
