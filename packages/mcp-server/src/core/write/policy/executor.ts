/**
 * Policy executor
 *
 * Executes policy steps by calling tool functions directly.
 * Policy writes happen live and use compensating rollback on failure.
 * If the process is terminated mid-run (for example SIGKILL, OOM, or power loss),
 * rollback cannot run and partial filesystem state may remain.
 */

import fs from 'fs/promises';
import path from 'path';
import type {
  PolicyDefinition,
  PolicyStep,
  PolicyContext,
  PolicyExecutionResult,
  StepExecutionResult,
  PolicyPreviewResult,
  PolicyToolName,
  PolicySearchFn,
  PolicySearchResult,
} from './types.js';
import type { MutationResult, FormatType, Position } from '../types.js';
import { createContext, interpolateObject, interpolate } from './template.js';
import { evaluateAllConditions, shouldStepExecute } from './conditions.js';
import { resolveVariables } from './schema.js';
import {
  readVaultFile,
  writeVaultFile,
  WriteConflictError,
  findSection,
  formatContent,
  insertInSection,
  removeFromSection,
  replaceInSection,
  validatePath,
  validatePathSecure,
  type MatchMode,
} from '../writer.js';
import {
  commitPolicyChanges,
  checkGitLock,
  isGitRepo,
} from '../git.js';
import { maybeApplyWikilinks, suggestRelatedLinks } from '../wikilinks.js';
import { runValidationPipeline, type GuardrailMode } from '../validator.js';
import { estimateTokens } from '../constants.js';
import { executeMutation, executeFrontmatterMutation, executeCreateNote as executeCreateNoteCore, executeDeleteNote as executeDeleteNoteCore } from '../mutation-helpers.js';
import { createPolicyWatcherGuard, type PolicyWatcherGuard } from './watcherIsolation.js';

/**
 * Execute a single step of a policy
 */
async function executeStep(
  step: PolicyStep,
  vaultPath: string,
  context: PolicyContext,
  conditionResults: Record<string, boolean>,
  searchFn?: PolicySearchFn,
  watcherGuard?: PolicyWatcherGuard,
): Promise<StepExecutionResult> {
  // Check if step should execute based on condition
  const { execute, reason } = shouldStepExecute(step.when, conditionResults);

  if (!execute) {
    return {
      stepId: step.id,
      success: true,
      message: `Step skipped: ${reason}`,
      skipped: true,
      skipReason: reason,
    };
  }

  // Interpolate params with context
  const resolvedParams = interpolateObject(step.params, context) as Record<string, unknown>;

  try {
    // Handle vault_search separately (read-only, no MutationResult)
    if (step.tool === 'vault_search') {
      return executeSearch(step.id, resolvedParams, searchFn);
    }

    const maybePath = typeof resolvedParams.path === 'string' ? resolvedParams.path.trim() : '';
    if (maybePath) {
      watcherGuard?.registerPath(maybePath);
    }

    const result = await executeToolCall(step.tool, resolvedParams, vaultPath, context);

    // Capture outputs from tool result
    const outputs: Record<string, unknown> = {};
    if (result.path) {
      outputs.path = result.path;
    }

    return {
      stepId: step.id,
      success: result.success,
      message: result.message,
      path: result.path,
      preview: result.preview,
      outputs,
    };
  } catch (error) {
    return {
      stepId: step.id,
      success: false,
      message: `Step failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Execute a tool by name with given params
 * Calls the underlying functions directly for efficiency
 */
async function executeToolCall(
  tool: PolicyToolName,
  params: Record<string, unknown>,
  vaultPath: string,
  context: PolicyContext
): Promise<MutationResult> {
  switch (tool) {
    case 'vault_add_to_section':
      return executeAddToSection(params, vaultPath, context);

    case 'vault_remove_from_section':
      return executeRemoveFromSection(params, vaultPath);

    case 'vault_replace_in_section':
      return executeReplaceInSection(params, vaultPath, context);

    case 'vault_create_note':
      return executeCreateNote(params, vaultPath, context);

    case 'vault_delete_note':
      return executeDeleteNote(params, vaultPath);

    case 'vault_toggle_task':
      return executeToggleTask(params, vaultPath);

    case 'vault_add_task':
      return executeAddTask(params, vaultPath, context);

    case 'vault_update_frontmatter':
      return executeUpdateFrontmatter(params, vaultPath);

    case 'vault_add_frontmatter_field':
      return executeAddFrontmatterField(params, vaultPath);

    default:
      return {
        success: false,
        message: `Unknown tool: ${tool}`,
        path: String(params.path || ''),
      };
  }
}

/**
 * Execute vault_add_to_section via unified executeMutation path
 */
async function executeAddToSection(
  params: Record<string, unknown>,
  vaultPath: string,
  context: PolicyContext
): Promise<MutationResult> {
  const notePath = String(params.path || '');
  const section = String(params.section || '');
  const content = String(params.content || '');
  const position = (params.position as Position) || 'append';
  const format = (params.format as FormatType) || 'plain';
  const skipWikilinks = Boolean(params.skipWikilinks);
  const preserveListNesting = params.preserveListNesting !== false;
  const suggestOutgoingLinks = params.suggestOutgoingLinks === true;
  const maxSuggestions = Number(params.maxSuggestions) || 3;

  const outcome = await executeMutation(
    { vaultPath, notePath, section, actionDescription: 'add content' },
    async (ctx) => {
      const validationResult = runValidationPipeline(content, format, {
        validate: true, normalize: true, guardrails: 'warn',
      });
      if (validationResult.blocked) {
        throw new Error(validationResult.blockReason || 'Output validation failed');
      }

      let workingContent = validationResult.content;
      let { content: processedContent, wikilinkInfo } = maybeApplyWikilinks(workingContent, skipWikilinks, notePath, ctx.content);

      let suggestInfo: string | undefined;
      if (suggestOutgoingLinks && !skipWikilinks) {
        const result = await suggestRelatedLinks(processedContent, { maxSuggestions, notePath });
        if (result.suffix) {
          processedContent = processedContent + ' ' + result.suffix;
          suggestInfo = `Suggested: ${result.suggestions.join(', ')}`;
        }
      }

      const formattedContent = formatContent(processedContent, format);
      const updatedContent = insertInSection(ctx.content, ctx.sectionBoundary!, formattedContent, position, { preserveListNesting });

      const infoLines = [wikilinkInfo, suggestInfo].filter(Boolean);
      const preview = formattedContent + (infoLines.length > 0 ? `\n(${infoLines.join('; ')})` : '');

      return {
        updatedContent,
        message: `Added content to section "${ctx.sectionBoundary!.name}" in ${notePath}`,
        preview,
        warnings: validationResult.inputWarnings.length > 0 ? validationResult.inputWarnings : undefined,
        outputIssues: validationResult.outputIssues.length > 0 ? validationResult.outputIssues : undefined,
        normalizationChanges: validationResult.normalizationChanges.length > 0 ? validationResult.normalizationChanges : undefined,
      };
    }
  );

  return outcome.result;
}

/**
 * Execute vault_remove_from_section via unified executeMutation path
 */
async function executeRemoveFromSection(
  params: Record<string, unknown>,
  vaultPath: string
): Promise<MutationResult> {
  const notePath = String(params.path || '');
  const section = String(params.section || '');
  const pattern = String(params.pattern || '');
  const mode = (params.mode as MatchMode) || 'first';
  const useRegex = Boolean(params.useRegex);

  const outcome = await executeMutation(
    { vaultPath, notePath, section, actionDescription: 'remove content' },
    async (ctx) => {
      const removeResult = removeFromSection(ctx.content, ctx.sectionBoundary!, pattern, mode, useRegex);
      if (removeResult.removedCount === 0) {
        throw new Error(`No content matching "${pattern}" found in section "${ctx.sectionBoundary!.name}"`);
      }
      return {
        updatedContent: removeResult.content,
        message: `Removed ${removeResult.removedCount} line(s) from section "${ctx.sectionBoundary!.name}"`,
        preview: removeResult.removedLines.join('\n'),
      };
    }
  );

  return outcome.result;
}

/**
 * Execute vault_replace_in_section via unified executeMutation path
 */
async function executeReplaceInSection(
  params: Record<string, unknown>,
  vaultPath: string,
  context: PolicyContext
): Promise<MutationResult> {
  const notePath = String(params.path || '');
  const section = String(params.section || '');
  const search = String(params.search || '');
  const replacement = String(params.replacement || '');
  const mode = (params.mode as MatchMode) || 'first';
  const useRegex = Boolean(params.useRegex);
  const skipWikilinks = Boolean(params.skipWikilinks);
  const suggestOutgoingLinks = params.suggestOutgoingLinks === true;
  const maxSuggestions = Number(params.maxSuggestions) || 3;

  const outcome = await executeMutation(
    { vaultPath, notePath, section, actionDescription: 'replace content' },
    async (ctx) => {
      const validationResult = runValidationPipeline(replacement, 'plain', {
        validate: true, normalize: true, guardrails: 'warn',
      });
      if (validationResult.blocked) {
        throw new Error(validationResult.blockReason || 'Output validation failed');
      }

      let { content: processedReplacement } = maybeApplyWikilinks(validationResult.content, skipWikilinks, notePath, ctx.content);

      if (suggestOutgoingLinks && !skipWikilinks) {
        const result = await suggestRelatedLinks(processedReplacement, { maxSuggestions, notePath });
        if (result.suffix) {
          processedReplacement = processedReplacement + ' ' + result.suffix;
        }
      }

      const replaceResult = replaceInSection(ctx.content, ctx.sectionBoundary!, search, processedReplacement, mode, useRegex);
      if (replaceResult.replacedCount === 0) {
        throw new Error(`No content matching "${search}" found in section "${ctx.sectionBoundary!.name}"`);
      }

      const previewLines = replaceResult.originalLines.map((orig, i) =>
        `- ${orig}\n+ ${replaceResult.newLines[i]}`
      );

      return {
        updatedContent: replaceResult.content,
        message: `Replaced ${replaceResult.replacedCount} occurrence(s) in section "${ctx.sectionBoundary!.name}"`,
        preview: previewLines.join('\n'),
        warnings: validationResult.inputWarnings.length > 0 ? validationResult.inputWarnings : undefined,
        outputIssues: validationResult.outputIssues.length > 0 ? validationResult.outputIssues : undefined,
        normalizationChanges: validationResult.normalizationChanges.length > 0 ? validationResult.normalizationChanges : undefined,
      };
    }
  );

  return outcome.result;
}

/**
 * Execute vault_create_note via shared executeCreateNote path
 */
async function executeCreateNote(
  params: Record<string, unknown>,
  vaultPath: string,
  context: PolicyContext
): Promise<MutationResult> {
  const notePath = String(params.path || '');
  let content = String(params.content || '');
  let frontmatter = (params.frontmatter as Record<string, unknown>) || {};

  // Template expansion — matches logic in tools/write/notes.ts
  if (params.template) {
    try {
      const templatePath = path.join(vaultPath, String(params.template));
      const raw = await fs.readFile(templatePath, 'utf-8');
      const matter = (await import('gray-matter')).default;
      const parsed = matter(raw);

      const dateStr = new Date().toISOString().split('T')[0];
      const title = path.basename(notePath, '.md');
      let templateContent = parsed.content
        .replace(/\{\{date\}\}/g, dateStr)
        .replace(/\{\{title\}\}/g, title);

      if (content) {
        templateContent = templateContent.trimEnd() + '\n\n' + content;
      }
      content = templateContent;

      // Template frontmatter as base, policy-provided overrides
      frontmatter = { ...(parsed.data || {}), ...frontmatter };
    } catch {
      return { success: false, path: notePath, message: `Template not found: ${params.template}` };
    }
  }

  const outcome = await executeCreateNoteCore({
    vaultPath,
    notePath,
    content,
    frontmatter,
    overwrite: Boolean(params.overwrite),
    skipWikilinks: Boolean(params.skipWikilinks),
  });
  return outcome.result;
}

/**
 * Execute vault_delete_note via shared executeDeleteNote path
 */
async function executeDeleteNote(
  params: Record<string, unknown>,
  vaultPath: string
): Promise<MutationResult> {
  const outcome = await executeDeleteNoteCore({
    vaultPath,
    notePath: String(params.path || ''),
    confirm: Boolean(params.confirm),
  });
  return outcome.result;
}

/**
 * Execute vault_toggle_task
 */
async function executeToggleTask(
  params: Record<string, unknown>,
  vaultPath: string
): Promise<MutationResult> {
  const notePath = String(params.path || '');
  const task = String(params.task || '');
  const section = params.section ? String(params.section) : undefined;

  const fullPath = path.join(vaultPath, notePath);

  try {
    await fs.access(fullPath);
  } catch {
    return { success: false, message: `File not found: ${notePath}`, path: notePath };
  }

  const { content: fileContent, frontmatter, contentHash } = await readVaultFile(vaultPath, notePath);

  // Find section if specified
  let sectionBoundary;
  if (section) {
    sectionBoundary = findSection(fileContent, section);
    if (!sectionBoundary) {
      return { success: false, message: `Section not found: ${section}`, path: notePath };
    }
  }

  // Import task utilities dynamically to avoid circular deps
  const { findTasks, toggleTask } = await import('../policy/taskHelpers.js');

  const tasks = findTasks(fileContent, sectionBoundary);
  const searchLower = task.toLowerCase();
  const matchingTask = tasks.find(t => t.text.toLowerCase().includes(searchLower));

  if (!matchingTask) {
    return { success: false, message: `No task found matching "${task}"`, path: notePath };
  }

  const toggleResult = toggleTask(fileContent, matchingTask.line);
  if (!toggleResult) {
    return { success: false, message: 'Failed to toggle task', path: notePath };
  }

  await writeVaultFile(vaultPath, notePath, toggleResult.content, frontmatter, 'LF', contentHash);

  const newStatus = toggleResult.newState ? 'completed' : 'incomplete';
  const checkbox = toggleResult.newState ? '[x]' : '[ ]';

  return {
    success: true,
    message: `Toggled task to ${newStatus}`,
    path: notePath,
    preview: `${checkbox} ${matchingTask.text}`,
  };
}

/**
 * Execute vault_add_task via unified executeMutation path
 */
async function executeAddTask(
  params: Record<string, unknown>,
  vaultPath: string,
  context: PolicyContext
): Promise<MutationResult> {
  const notePath = String(params.path || '');
  const section = String(params.section || '');
  const task = String(params.task || '');
  const position = (params.position as Position) || 'append';
  const completed = Boolean(params.completed);
  const skipWikilinks = Boolean(params.skipWikilinks);
  const preserveListNesting = params.preserveListNesting !== false;

  const outcome = await executeMutation(
    { vaultPath, notePath, section, actionDescription: 'add task' },
    async (ctx) => {
      const validationResult = runValidationPipeline(task.trim(), 'task', {
        validate: true, normalize: true, guardrails: 'warn',
      });

      const { content: processedTask } = maybeApplyWikilinks(validationResult.content, skipWikilinks, notePath, ctx.content);

      const checkbox = completed ? '[x]' : '[ ]';
      const taskLine = `- ${checkbox} ${processedTask}`;

      const updatedContent = insertInSection(ctx.content, ctx.sectionBoundary!, taskLine, position, { preserveListNesting });

      return {
        updatedContent,
        message: `Added task to section "${ctx.sectionBoundary!.name}"`,
        preview: taskLine,
      };
    }
  );

  return outcome.result;
}

/**
 * Execute vault_update_frontmatter via unified executeFrontmatterMutation path
 */
async function executeUpdateFrontmatter(
  params: Record<string, unknown>,
  vaultPath: string
): Promise<MutationResult> {
  const notePath = String(params.path || '');
  const updates = (params.frontmatter as Record<string, unknown>) || {};

  const outcome = await executeFrontmatterMutation(
    { vaultPath, notePath, actionDescription: 'update frontmatter' },
    async (ctx) => {
      const updatedFrontmatter = { ...ctx.frontmatter, ...updates };
      const updatedKeys = Object.keys(updates);
      const preview = updatedKeys.map(k => `${k}: ${JSON.stringify(updates[k])}`).join('\n');
      return {
        updatedFrontmatter,
        message: `Updated ${updatedKeys.length} frontmatter field(s)`,
        preview,
      };
    }
  );

  return outcome.result;
}

/**
 * Execute vault_add_frontmatter_field via unified executeFrontmatterMutation path
 */
async function executeAddFrontmatterField(
  params: Record<string, unknown>,
  vaultPath: string
): Promise<MutationResult> {
  const notePath = String(params.path || '');
  const key = String(params.key || '');
  const value = params.value;

  const outcome = await executeFrontmatterMutation(
    { vaultPath, notePath, actionDescription: 'add frontmatter field' },
    async (ctx) => {
      if (key in ctx.frontmatter) {
        throw new Error(`Field "${key}" already exists`);
      }
      const updatedFrontmatter = { ...ctx.frontmatter, [key]: value };
      return {
        updatedFrontmatter,
        message: `Added frontmatter field "${key}"`,
        preview: `${key}: ${JSON.stringify(value)}`,
      };
    }
  );

  return outcome.result;
}

/**
 * Execute a vault_search step (read-only, no file mutation)
 */
function executeSearch(
  stepId: string,
  params: Record<string, unknown>,
  searchFn?: PolicySearchFn
): StepExecutionResult {
  if (!searchFn) {
    return {
      stepId,
      success: false,
      message: 'vault_search requires a search function — not available in this context',
    };
  }

  const query = params.query != null ? String(params.query) : undefined;
  const folder = params.folder ? String(params.folder) : undefined;
  const where = (params.where && typeof params.where === 'object')
    ? params.where as Record<string, unknown>
    : undefined;
  const limit = params.limit ? Number(params.limit) : 10;

  const results = searchFn({ query, folder, where, limit });

  // Build human-readable summary from results
  const summaryLines = results.map(r => {
    const fm = r.frontmatter;
    const parts = [r.title];
    if (fm.status) parts.push(`status: ${fm.status}`);
    if (fm.amount) parts.push(`$${fm.amount}`);
    if (fm.budget) parts.push(`budget: $${fm.budget}`);
    if (fm.utilization) parts.push(`utilization: ${fm.utilization}`);
    if (fm.due_date) parts.push(`due: ${fm.due_date}`);
    return `- ${parts.join(' | ')}`;
  });
  const summary = summaryLines.length > 0
    ? summaryLines.join('\n')
    : '(no results)';

  return {
    stepId,
    success: true,
    message: `Found ${results.length} result(s)`,
    outputs: {
      results,
      summary,
      count: results.length,
    },
  };
}

/**
 * Execute a complete policy with compensating rollback semantics.
 *
 * Policies perform live writes, optionally followed by a single git commit.
 * On step failure or commit failure, the executor attempts to roll back any
 * files it already modified and reports whether that rollback succeeded.
 * This is best-effort recovery, not transactional staging.
 */
export async function executePolicy(
  policy: PolicyDefinition,
  vaultPath: string,
  variables: Record<string, unknown>,
  commit: boolean = false,
  searchFn?: PolicySearchFn
): Promise<PolicyExecutionResult> {
  // Validate required variables before execution
  const { validateVariables } = await import('./schema.js');
  const varValidation = validateVariables(policy, variables);
  if (!varValidation.valid) {
    const executionResult: PolicyExecutionResult = {
      success: false,
      policyName: policy.name,
      message: `Variable validation failed: ${varValidation.errors.join(', ')}`,
      stepResults: [],
      filesModified: [],
      retryable: false,
    };
    executionResult.tokensEstimate = estimateTokens(executionResult);
    return executionResult;
  }

  // Pre-flight: Check for git lock contention if commit is requested
  if (commit) {
    const isRepo = await isGitRepo(vaultPath);
    if (isRepo) {
      const lockStatus = await checkGitLock(vaultPath);
      if (lockStatus.locked) {
        // Fail fast with retryable error
        const retryAfterMs = lockStatus.stale ? 100 : 500;
        const executionResult: PolicyExecutionResult = {
          success: false,
          policyName: policy.name,
          message: lockStatus.stale
            ? `Git lock contention: stale lock detected (${Math.round((lockStatus.ageMs || 0) / 1000)}s old). Retry recommended.`
            : `Git lock contention: another process is committing. Retry in ${retryAfterMs}ms.`,
          stepResults: [],
          filesModified: [],
          retryable: true,
          retryAfterMs,
          lockContention: true,
        };
        executionResult.tokensEstimate = estimateTokens(executionResult);
        return executionResult;
      }
    }
  }

  // Resolve variables with defaults
  const resolvedVars = resolveVariables(policy, variables);

  // Create execution context
  const context = createContext(resolvedVars);

  // Evaluate all conditions
  if (policy.conditions) {
    context.conditions = await evaluateAllConditions(policy.conditions, vaultPath, context);
  }

  const watcherGuard = createPolicyWatcherGuard();
  const finalizeExecutionResult = async (
    executionResult: PolicyExecutionResult,
  ): Promise<PolicyExecutionResult> => {
    const watcherError = await watcherGuard.finish();
    if (watcherError) {
      executionResult.message = `${executionResult.message} Watcher reconciliation failed: ${watcherError}`;
      if (executionResult.success) {
        executionResult.success = false;
        executionResult.retryable = false;
      }
    }
    executionResult.tokensEstimate = estimateTokens(executionResult);
    return executionResult;
  };

  // Track files for rollback on failure
  const filesModified = new Set<string>();
  const originalContents = new Map<string, string | null>();

  // Capture original contents before any mutations
  for (const step of policy.steps) {
    if (step.params.path) {
      const notePath = interpolate(String(step.params.path), context);
      if (!originalContents.has(notePath)) {
        try {
          const { rawContent } = await readVaultFile(vaultPath, notePath);
          originalContents.set(notePath, rawContent);
        } catch {
          // File doesn't exist yet
          originalContents.set(notePath, null);
        }
      }
    }
  }

  // Execute steps
  const stepResults: StepExecutionResult[] = [];

  for (const step of policy.steps) {
    const result = await executeStep(step, vaultPath, context, context.conditions, searchFn, watcherGuard);
    stepResults.push(result);

    // Track modified files
    if (result.path && result.success && !result.skipped) {
      filesModified.add(result.path);
    }

    // Capture step outputs for subsequent steps
    if (result.success && !result.skipped && result.outputs) {
      context.steps[step.id] = result.outputs;
    }

    // Fail-fast: stop on first error
    if (!result.success && !result.skipped) {
      let rollbackError: string | undefined;
      if (filesModified.size > 0) {
        rollbackError = await rollbackChanges(vaultPath, originalContents, filesModified);
      }
      const rollbackFailed = rollbackError !== undefined;

      const executionResult: PolicyExecutionResult = {
        success: false,
        policyName: policy.name,
        message: rollbackFailed
          ? `Policy failed at step '${step.id}': ${result.message}. Rollback also failed: ${rollbackError}`
          : `Policy failed at step '${step.id}': ${result.message}${filesModified.size > 0 ? '. Changes rolled back.' : ''}`,
        stepResults,
        filesModified: rollbackFailed ? Array.from(filesModified) : [],
        retryable: false,  // Step failure is not retryable
        rollbackFailed,
        rollbackError,
      };
      return finalizeExecutionResult(executionResult);
    }
  }

  // Create a single git commit if requested after all live writes succeed
  let gitCommit: string | undefined;
  let undoAvailable: boolean | undefined;
  let commitError: string | undefined;
  let isRetryable = false;
  let isLockContention = false;
  let rollbackError: string | undefined;
  let rollbackFailed = false;

  if (commit && filesModified.size > 0) {
    // Commit all modified files together as a single policy commit
    const files = Array.from(filesModified);
    const stepsSummary = stepResults
      .filter(r => r.success && !r.skipped)
      .map(r => `${r.stepId}: ${r.message}`);

    const gitResult = await commitPolicyChanges(
      vaultPath,
      files,
      policy.name,
      stepsSummary
    );

    if (gitResult.success && gitResult.hash) {
      gitCommit = gitResult.hash;
      undoAvailable = gitResult.undoAvailable;
    } else if (!gitResult.success) {
      rollbackError = await rollbackChanges(vaultPath, originalContents, filesModified);
      rollbackFailed = rollbackError !== undefined;

      // Check if this is a retryable error (lock contention)
      const errorLower = (gitResult.error || '').toLowerCase();
      isLockContention = errorLower.includes('lock') ||
                         errorLower.includes('index.lock') ||
                         errorLower.includes('could not obtain');
      isRetryable = isLockContention;

      commitError = gitResult.error;
    }
  }

  // If commit failed, return failure with proper retry hints
  if (commit && filesModified.size > 0 && commitError) {
    const executionResult: PolicyExecutionResult = {
      success: false,
      policyName: policy.name,
      message: rollbackFailed
        ? `Policy steps succeeded but git commit failed: ${commitError}. Rollback also failed: ${rollbackError}`
        : `Policy steps succeeded but git commit failed: ${commitError}. Changes rolled back.`,
      stepResults,
      filesModified: rollbackFailed ? Array.from(filesModified) : [],
      retryable: isRetryable,
      retryAfterMs: isRetryable ? 500 : undefined,
      lockContention: isLockContention,
      rollbackFailed,
      rollbackError,
    };
    return finalizeExecutionResult(executionResult);
  }

  // Generate summary from output template
  let summary: string | undefined;
  if (policy.output?.summary) {
    summary = interpolate(policy.output.summary, context);
  }

  const executionResult: PolicyExecutionResult = {
    success: true,
    policyName: policy.name,
    message: `Policy '${policy.name}' executed successfully`,
    stepResults,
    gitCommit,
    undoAvailable,
    filesModified: Array.from(filesModified),
    summary,
  };
  return finalizeExecutionResult(executionResult);
}

/**
 * Rollback file changes to original state
 */
async function rollbackChanges(
  vaultPath: string,
  originalContents: Map<string, string | null>,
  filesModified: Set<string>
): Promise<string | undefined> {
  const errors: string[] = [];

  for (const filePath of filesModified) {
    // Full secure validation during rollback (defense in depth)
    const pathCheck = await validatePathSecure(vaultPath, filePath);
    if (!pathCheck.valid) {
      errors.push(`${filePath}: ${pathCheck.reason}`);
      continue;
    }

    const original = originalContents.get(filePath);
    const fullPath = path.join(vaultPath, filePath);

    if (original === null) {
      // File was newly created - delete it
      try {
        await fs.unlink(fullPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          errors.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } else if (original !== undefined) {
      // Restore original content
      try {
        await fs.writeFile(fullPath, original);
      } catch (error) {
        errors.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return errors.length > 0 ? errors.join('; ') : undefined;
}

/**
 * Preview policy execution without making changes (dry run)
 */
export async function previewPolicy(
  policy: PolicyDefinition,
  vaultPath: string,
  variables: Record<string, unknown>
): Promise<PolicyPreviewResult> {
  // Resolve variables with defaults
  const resolvedVars = resolveVariables(policy, variables);

  // Create execution context
  const context = createContext(resolvedVars);

  // Evaluate all conditions
  const conditionResults: Record<string, boolean> = {};
  if (policy.conditions) {
    for (const cond of policy.conditions) {
      const { evaluateCondition } = await import('./conditions.js');
      const result = await evaluateCondition(cond, vaultPath, context);
      conditionResults[cond.id] = result.met;
    }
  }
  context.conditions = conditionResults;

  // Preview each step
  const stepsToExecute: PolicyPreviewResult['stepsToExecute'] = [];
  const filesAffected = new Set<string>();

  for (const step of policy.steps) {
    const { execute, reason } = shouldStepExecute(step.when, conditionResults);
    const resolvedParams = interpolateObject(step.params, context) as Record<string, unknown>;

    stepsToExecute.push({
      stepId: step.id,
      tool: step.tool,
      resolvedParams,
      skipped: !execute,
      skipReason: reason,
    });

    if (execute && resolvedParams.path) {
      filesAffected.add(String(resolvedParams.path));
    }
  }

  const previewResult: PolicyPreviewResult = {
    policyName: policy.name,
    resolvedVariables: resolvedVars,
    conditionResults,
    stepsToExecute,
    filesAffected: Array.from(filesAffected),
  };
  previewResult.tokensEstimate = estimateTokens(previewResult);

  return previewResult;
}
