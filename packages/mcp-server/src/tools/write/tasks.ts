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
  getVaultPath: () => string
): void {
  // vault_toggle_task retired (T43 B3+) — use tasks(action: toggle) instead
  // Toggle logic now lives in primitives.ts (tasks merged tool, action: toggle)

  // ========================================
  // Tool: vault_add_task
  // ========================================
  server.tool(
    'vault_add_task',
    'Use when adding a new task checkbox to a note section. Produces a markdown task line inserted under the specified heading. Returns the written task text with line number. Does not toggle existing tasks — use vault_toggle_task to check or uncheck.',
    {
      path: z.string().describe('Vault-relative path to the note'),
      section: z.string().describe('Section to add the task to'),
      task: z.string().describe('Task text (without checkbox)'),
      position: z.enum(['append', 'prepend']).default('append').describe('Where to add the task'),
      completed: z.boolean().default(false).describe('Whether the task should start as completed'),
      commit: z.boolean().default(false).describe('If true, commit this change to git (creates undo point)'),
      skipWikilinks: z.boolean().default(false).describe('If true, skip auto-wikilink application (wikilinks are applied by default)'),
      suggestOutgoingLinks: z.boolean().default(false).describe('Append suggested outgoing wikilinks based on content (e.g., "→ [[AI]], [[Philosophy]]"). Off by default — set true for daily notes, journals, or capture-heavy contexts.'),
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
      const vaultPath = getVaultPath();
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

          // 3. Suggest outgoing links when explicitly enabled
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
