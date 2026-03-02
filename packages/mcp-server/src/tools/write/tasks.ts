/**
 * Task tools for Flywheel Memory
 * Tools: vault_toggle_task, vault_add_task
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  readVaultFile,
  writeVaultFile,
  WriteConflictError,
  findSection,
  insertInSection,
  injectMutationMetadata,
  type SectionBoundary,
} from '../../core/write/writer.js';
import type { Position } from '../../core/write/types.js';
import { maybeApplyWikilinks, suggestRelatedLinks } from '../../core/write/wikilinks.js';
import {
  runValidationPipeline,
  type GuardrailMode,
} from '../../core/write/validator.js';
import {
  withVaultFile,
  ensureFileExists,
  handleGitCommit,
  formatMcpResult,
  errorResult,
  successResult,
} from '../../core/write/mutation-helpers.js';
import { updateTaskCacheForFile } from '../../core/read/taskCache.js';

// Task regex patterns
const TASK_REGEX = /^(\s*)-\s*\[([ xX])\]\s*(.*)$/;
const UNCHECKED_TASK = '- [ ]';
const CHECKED_TASK = '- [x]';

export interface TaskInfo {
  line: number;
  text: string;
  completed: boolean;
  indent: string;
  rawLine: string;
}

/**
 * Find all tasks in content, optionally within a section
 */
export function findTasks(content: string, section?: SectionBoundary): TaskInfo[] {
  const lines = content.split('\n');
  const tasks: TaskInfo[] = [];

  const startLine = section?.contentStartLine ?? 0;
  const endLine = section?.endLine ?? lines.length - 1;

  for (let i = startLine; i <= endLine; i++) {
    const line = lines[i];
    const match = line.match(TASK_REGEX);

    if (match) {
      tasks.push({
        line: i,
        text: match[3].trim(),
        completed: match[2].toLowerCase() === 'x',
        indent: match[1],
        rawLine: line,
      });
    }
  }

  return tasks;
}

/**
 * Toggle a task's completion state
 */
export function toggleTask(content: string, lineNumber: number): { content: string; newState: boolean } | null {
  const lines = content.split('\n');

  if (lineNumber < 0 || lineNumber >= lines.length) {
    return null;
  }

  const line = lines[lineNumber];
  const match = line.match(TASK_REGEX);

  if (!match) {
    return null;
  }

  const wasCompleted = match[2].toLowerCase() === 'x';
  const newState = !wasCompleted;

  // Toggle the checkbox
  if (wasCompleted) {
    lines[lineNumber] = line.replace(/\[[ xX]\]/, '[ ]');
  } else {
    lines[lineNumber] = line.replace(/\[[ xX]\]/, '[x]');
  }

  return {
    content: lines.join('\n'),
    newState,
  };
}

export function registerTaskTools(
  server: McpServer,
  vaultPath: string
): void {
  // ========================================
  // Tool: vault_toggle_task
  // ========================================
  server.tool(
    'vault_toggle_task',
    'Toggle a task checkbox between checked and unchecked.\n\nExample: vault_toggle_task({ path: "daily/2026-02-15.md", task: "review PR", section: "Tasks" })',
    {
      path: z.string().describe('Vault-relative path to the note'),
      task: z.string().describe('Task text to find (partial match supported)'),
      section: z.string().optional().describe('Optional: limit search to this section'),
      commit: z.boolean().default(false).describe('If true, commit this change to git (creates undo point)'),
      dry_run: z.boolean().optional().default(false).describe('Preview changes without writing to disk'),
      agent_id: z.string().optional().describe('Agent identifier for multi-agent scoping'),
      session_id: z.string().optional().describe('Session identifier for conversation scoping'),
    },
    async ({ path: notePath, task, section, commit, dry_run, agent_id, session_id }) => {
      try {
        // 1. Check if file exists
        const existsError = await ensureFileExists(vaultPath, notePath);
        if (existsError) {
          return formatMcpResult(existsError);
        }

        // 2. Read file
        const { content: fileContent, frontmatter, contentHash } = await readVaultFile(vaultPath, notePath);

        // 3. Find section if specified
        let sectionBoundary: SectionBoundary | undefined;
        if (section) {
          const found = findSection(fileContent, section);
          if (!found) {
            return formatMcpResult(errorResult(notePath, `Section not found: ${section}`));
          }
          sectionBoundary = found;
        }

        // 4. Find tasks
        const tasks = findTasks(fileContent, sectionBoundary);

        // 5. Find matching task (case-insensitive partial match)
        const searchLower = task.toLowerCase();
        const matchingTask = tasks.find((t) =>
          t.text.toLowerCase().includes(searchLower)
        );

        if (!matchingTask) {
          return formatMcpResult(
            errorResult(notePath, `No task found matching "${task}"${section ? ` in section "${section}"` : ''}`)
          );
        }

        // 6. Toggle the task
        const toggleResult = toggleTask(fileContent, matchingTask.line);
        if (!toggleResult) {
          return formatMcpResult(errorResult(notePath, 'Failed to toggle task'));
        }

        const newStatus = toggleResult.newState ? 'completed' : 'incomplete';
        const checkbox = toggleResult.newState ? '[x]' : '[ ]';

        // Dry run: return preview without writing or committing
        if (dry_run) {
          return formatMcpResult(
            successResult(notePath, `[dry run] Toggled task to ${newStatus} in ${notePath}`, {}, {
              preview: `${checkbox} ${matchingTask.text}`,
              dryRun: true,
            })
          );
        }

        // 7. Inject scoping metadata if provided
        let finalFrontmatter = frontmatter;
        if (agent_id || session_id) {
          finalFrontmatter = injectMutationMetadata(frontmatter, { agent_id, session_id });
        }

        // 8. Write file
        await writeVaultFile(vaultPath, notePath, toggleResult.content, finalFrontmatter, 'LF', contentHash);

        // 8b. Update task cache immediately
        await updateTaskCacheForFile(vaultPath, notePath).catch(() => {});

        // 9. Handle git commit
        const gitInfo = await handleGitCommit(vaultPath, notePath, commit, '[Flywheel:Task]');

        return formatMcpResult(
          successResult(notePath, `Toggled task to ${newStatus} in ${notePath}`, gitInfo, {
            preview: `${checkbox} ${matchingTask.text}`,
          })
        );
      } catch (error) {
        const extras: Partial<import('../../core/write/types.js').MutationResult> = {};
        if (error instanceof WriteConflictError) {
          extras.warnings = [{
            type: 'write_conflict',
            message: error.message,
            suggestion: 'The file was modified while processing. Re-read and retry.',
          }];
        }
        return formatMcpResult(
          errorResult(notePath, `Failed to toggle task: ${error instanceof Error ? error.message : String(error)}`, extras)
        );
      }
    }
  );

  // ========================================
  // Tool: vault_add_task
  // ========================================
  server.tool(
    'vault_add_task',
    'Add a new task to a section in a markdown note.\n\nExample: vault_add_task({ path: "daily/2026-02-15.md", section: "Tasks", task: "Write unit tests for auth module" })',
    {
      path: z.string().describe('Vault-relative path to the note'),
      section: z.string().describe('Section to add the task to'),
      task: z.string().describe('Task text (without checkbox)'),
      position: z.enum(['append', 'prepend']).default('append').describe('Where to add the task'),
      completed: z.boolean().default(false).describe('Whether the task should start as completed'),
      commit: z.boolean().default(false).describe('If true, commit this change to git (creates undo point)'),
      skipWikilinks: z.boolean().default(false).describe('If true, skip auto-wikilink application (wikilinks are applied by default)'),
      suggestOutgoingLinks: z.boolean().default(true).describe('Append suggested outgoing wikilinks based on content (e.g., "→ [[AI]], [[Philosophy]]"). Set false to disable.'),
      maxSuggestions: z.number().min(1).max(10).default(5).describe('Maximum number of suggested wikilinks to append (1-10, default: 5)'),
      preserveListNesting: z.boolean().default(true).describe('Preserve indentation when inserting into nested lists. Default: true'),
      validate: z.boolean().default(true).describe('Check input for common issues'),
      normalize: z.boolean().default(true).describe('Auto-fix common issues before formatting'),
      guardrails: z.enum(['warn', 'strict', 'off']).default('warn').describe('Output validation mode'),
      dry_run: z.boolean().optional().default(false).describe('Preview changes without writing to disk'),
      agent_id: z.string().optional().describe('Agent identifier for multi-agent scoping'),
      session_id: z.string().optional().describe('Session identifier for conversation scoping'),
    },
    async ({ path: notePath, section, task, position, completed, commit, skipWikilinks, suggestOutgoingLinks, maxSuggestions, preserveListNesting, validate, normalize, guardrails, dry_run, agent_id, session_id }) => {
      return withVaultFile(
        {
          vaultPath,
          notePath,
          commit,
          commitPrefix: '[Flywheel:Task]',
          section,
          actionDescription: 'add task',
          scoping: agent_id || session_id ? { agent_id, session_id } : undefined,
          dryRun: dry_run,
        },
        async (ctx) => {
          // 1. Run validation pipeline on task text
          const validationResult = runValidationPipeline(task.trim(), 'task', {
            validate,
            normalize,
            guardrails: guardrails as GuardrailMode,
          });

          // If guardrails=strict and validation failed, abort
          if (validationResult.blocked) {
            throw new Error(validationResult.blockReason || 'Output validation failed');
          }

          // Use normalized task text
          let workingTask = validationResult.content;

          // 2. Apply wikilinks to task text (unless skipped)
          let { content: processedTask, wikilinkInfo } = maybeApplyWikilinks(workingTask, skipWikilinks, notePath);

          // 3. Suggest outgoing links (enabled by default)
          let suggestInfo: string | undefined;
          if (suggestOutgoingLinks && !skipWikilinks) {
            const result = await suggestRelatedLinks(processedTask, { maxSuggestions, notePath });
            if (result.suffix) {
              processedTask = processedTask + ' ' + result.suffix;
              suggestInfo = `Suggested: ${result.suggestions.join(', ')}`;
            }
          }

          // 4. Format the task
          const checkbox = completed ? '[x]' : '[ ]';
          const taskLine = `- ${checkbox} ${processedTask}`;

          // 5. Insert into section
          const updatedContent = insertInSection(
            ctx.content,
            ctx.sectionBoundary!,
            taskLine,
            position as Position,
            { preserveListNesting }
          );

          const infoLines = [wikilinkInfo, suggestInfo].filter(Boolean);

          return {
            updatedContent,
            message: `Added task to section "${ctx.sectionBoundary!.name}" in ${notePath}`,
            preview: taskLine + (infoLines.length > 0 ? `\n(${infoLines.join('; ')})` : ''),
            warnings: validationResult.inputWarnings.length > 0 ? validationResult.inputWarnings : undefined,
            outputIssues: validationResult.outputIssues.length > 0 ? validationResult.outputIssues : undefined,
            normalizationChanges: validationResult.normalizationChanges.length > 0 ? validationResult.normalizationChanges : undefined,
          };
        }
      );
    }
  );
}
