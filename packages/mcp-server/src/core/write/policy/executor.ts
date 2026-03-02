/**
 * Policy executor
 *
 * Executes policy steps by calling tool functions directly.
 * All steps in a policy are executed atomically with a single git commit.
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
  type MatchMode,
} from '../writer.js';
import {
  commitPolicyChanges,
  checkGitLock,
  isGitRepo,
  createStagingFile,
  commitStagedFiles,
  rollbackStagedFiles,
  cleanupStagingDir,
  type StagedFile,
} from '../git.js';
import { maybeApplyWikilinks, suggestRelatedLinks } from '../wikilinks.js';
import { runValidationPipeline, type GuardrailMode } from '../validator.js';
import { estimateTokens } from '../constants.js';

/**
 * Execute a single step of a policy
 */
async function executeStep(
  step: PolicyStep,
  vaultPath: string,
  context: PolicyContext,
  conditionResults: Record<string, boolean>
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
 * Execute vault_add_to_section
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
  const suggestOutgoingLinks = params.suggestOutgoingLinks !== false;
  const maxSuggestions = Number(params.maxSuggestions) || 3;

  const fullPath = path.join(vaultPath, notePath);

  // Check file exists
  try {
    await fs.access(fullPath);
  } catch {
    return { success: false, message: `File not found: ${notePath}`, path: notePath };
  }

  // Read file
  const { content: fileContent, frontmatter, lineEnding, contentHash } = await readVaultFile(vaultPath, notePath);

  // Find section
  const sectionBoundary = findSection(fileContent, section);
  if (!sectionBoundary) {
    return { success: false, message: `Section '${section}' not found`, path: notePath };
  }

  // Run validation pipeline
  const validationResult = runValidationPipeline(content, format, {
    validate: true,
    normalize: true,
    guardrails: 'warn',
  });

  let workingContent = validationResult.content;

  // Apply wikilinks
  const { content: processedContent } = maybeApplyWikilinks(workingContent, skipWikilinks, notePath);

  // Format and insert
  const formattedContent = formatContent(processedContent, format);
  const updatedContent = insertInSection(
    fileContent,
    sectionBoundary,
    formattedContent,
    position,
    { preserveListNesting }
  );

  // Write file (no commit - done at policy level)
  await writeVaultFile(vaultPath, notePath, updatedContent, frontmatter, lineEnding, contentHash);

  return {
    success: true,
    message: `Added content to section "${sectionBoundary.name}" in ${notePath}`,
    path: notePath,
    preview: formattedContent,
  };
}

/**
 * Execute vault_remove_from_section
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

  const fullPath = path.join(vaultPath, notePath);

  try {
    await fs.access(fullPath);
  } catch {
    return { success: false, message: `File not found: ${notePath}`, path: notePath };
  }

  const { content: fileContent, frontmatter, lineEnding, contentHash } = await readVaultFile(vaultPath, notePath);

  const sectionBoundary = findSection(fileContent, section);
  if (!sectionBoundary) {
    return { success: false, message: `Section '${section}' not found`, path: notePath };
  }

  const removeResult = removeFromSection(fileContent, sectionBoundary, pattern, mode, useRegex);

  if (removeResult.removedCount === 0) {
    return { success: false, message: `No content matching "${pattern}" found`, path: notePath };
  }

  await writeVaultFile(vaultPath, notePath, removeResult.content, frontmatter, lineEnding, contentHash);

  return {
    success: true,
    message: `Removed ${removeResult.removedCount} line(s) from section "${sectionBoundary.name}"`,
    path: notePath,
    preview: removeResult.removedLines.join('\n'),
  };
}

/**
 * Execute vault_replace_in_section
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

  const fullPath = path.join(vaultPath, notePath);

  try {
    await fs.access(fullPath);
  } catch {
    return { success: false, message: `File not found: ${notePath}`, path: notePath };
  }

  const { content: fileContent, frontmatter, lineEnding, contentHash } = await readVaultFile(vaultPath, notePath);

  const sectionBoundary = findSection(fileContent, section);
  if (!sectionBoundary) {
    return { success: false, message: `Section '${section}' not found`, path: notePath };
  }

  const { content: processedReplacement } = maybeApplyWikilinks(replacement, skipWikilinks, notePath);

  const replaceResult = replaceInSection(
    fileContent,
    sectionBoundary,
    search,
    processedReplacement,
    mode,
    useRegex
  );

  if (replaceResult.replacedCount === 0) {
    return { success: false, message: `No content matching "${search}" found`, path: notePath };
  }

  await writeVaultFile(vaultPath, notePath, replaceResult.content, frontmatter, lineEnding, contentHash);

  return {
    success: true,
    message: `Replaced ${replaceResult.replacedCount} occurrence(s) in section "${sectionBoundary.name}"`,
    path: notePath,
    preview: replaceResult.originalLines.map((orig, i) =>
      `- ${orig}\n+ ${replaceResult.newLines[i]}`
    ).join('\n'),
  };
}

/**
 * Execute vault_create_note
 */
async function executeCreateNote(
  params: Record<string, unknown>,
  vaultPath: string,
  context: PolicyContext
): Promise<MutationResult> {
  const notePath = String(params.path || '');
  const content = String(params.content || '');
  const frontmatter = (params.frontmatter as Record<string, unknown>) || {};
  const overwrite = Boolean(params.overwrite);
  const skipWikilinks = Boolean(params.skipWikilinks);

  if (!validatePath(vaultPath, notePath)) {
    return { success: false, message: 'Invalid path: path traversal not allowed', path: notePath };
  }

  const fullPath = path.join(vaultPath, notePath);

  // Check if exists
  try {
    await fs.access(fullPath);
    if (!overwrite) {
      return { success: false, message: `File already exists: ${notePath}`, path: notePath };
    }
  } catch {
    // File doesn't exist - good
  }

  // Create parent directories
  const dir = path.dirname(fullPath);
  await fs.mkdir(dir, { recursive: true });

  // Process content
  const { content: processedContent } = maybeApplyWikilinks(content, skipWikilinks, notePath);

  // Write note
  await writeVaultFile(vaultPath, notePath, processedContent, frontmatter);

  return {
    success: true,
    message: `Created note: ${notePath}`,
    path: notePath,
    preview: `Frontmatter: ${Object.keys(frontmatter).join(', ') || 'none'}, Content: ${processedContent.length} chars`,
  };
}

/**
 * Execute vault_delete_note
 */
async function executeDeleteNote(
  params: Record<string, unknown>,
  vaultPath: string
): Promise<MutationResult> {
  const notePath = String(params.path || '');
  const confirm = Boolean(params.confirm);

  if (!confirm) {
    return { success: false, message: 'Deletion requires explicit confirmation (confirm=true)', path: notePath };
  }

  if (!validatePath(vaultPath, notePath)) {
    return { success: false, message: 'Invalid path: path traversal not allowed', path: notePath };
  }

  const fullPath = path.join(vaultPath, notePath);

  try {
    await fs.access(fullPath);
  } catch {
    return { success: false, message: `File not found: ${notePath}`, path: notePath };
  }

  await fs.unlink(fullPath);

  return {
    success: true,
    message: `Deleted note: ${notePath}`,
    path: notePath,
  };
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
 * Execute vault_add_task
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

  const fullPath = path.join(vaultPath, notePath);

  try {
    await fs.access(fullPath);
  } catch {
    return { success: false, message: `File not found: ${notePath}`, path: notePath };
  }

  const { content: fileContent, frontmatter, contentHash } = await readVaultFile(vaultPath, notePath);

  const sectionBoundary = findSection(fileContent, section);
  if (!sectionBoundary) {
    return { success: false, message: `Section not found: ${section}`, path: notePath };
  }

  // Process task text
  const validationResult = runValidationPipeline(task.trim(), 'task', {
    validate: true,
    normalize: true,
    guardrails: 'warn',
  });

  const { content: processedTask } = maybeApplyWikilinks(validationResult.content, skipWikilinks, notePath);

  const checkbox = completed ? '[x]' : '[ ]';
  const taskLine = `- ${checkbox} ${processedTask}`;

  const updatedContent = insertInSection(
    fileContent,
    sectionBoundary,
    taskLine,
    position,
    { preserveListNesting }
  );

  await writeVaultFile(vaultPath, notePath, updatedContent, frontmatter, 'LF', contentHash);

  return {
    success: true,
    message: `Added task to section "${sectionBoundary.name}"`,
    path: notePath,
    preview: taskLine,
  };
}

/**
 * Execute vault_update_frontmatter
 */
async function executeUpdateFrontmatter(
  params: Record<string, unknown>,
  vaultPath: string
): Promise<MutationResult> {
  const notePath = String(params.path || '');
  const updates = (params.frontmatter as Record<string, unknown>) || {};

  const fullPath = path.join(vaultPath, notePath);

  try {
    await fs.access(fullPath);
  } catch {
    return { success: false, message: `File not found: ${notePath}`, path: notePath };
  }

  const { content, frontmatter, contentHash } = await readVaultFile(vaultPath, notePath);

  const updatedFrontmatter = { ...frontmatter, ...updates };

  await writeVaultFile(vaultPath, notePath, content, updatedFrontmatter, 'LF', contentHash);

  const updatedKeys = Object.keys(updates);
  const preview = updatedKeys.map(k => `${k}: ${JSON.stringify(updates[k])}`).join('\n');

  return {
    success: true,
    message: `Updated ${updatedKeys.length} frontmatter field(s)`,
    path: notePath,
    preview,
  };
}

/**
 * Execute vault_add_frontmatter_field
 */
async function executeAddFrontmatterField(
  params: Record<string, unknown>,
  vaultPath: string
): Promise<MutationResult> {
  const notePath = String(params.path || '');
  const key = String(params.key || '');
  const value = params.value;

  const fullPath = path.join(vaultPath, notePath);

  try {
    await fs.access(fullPath);
  } catch {
    return { success: false, message: `File not found: ${notePath}`, path: notePath };
  }

  const { content, frontmatter, contentHash } = await readVaultFile(vaultPath, notePath);

  if (key in frontmatter) {
    return { success: false, message: `Field "${key}" already exists`, path: notePath };
  }

  const updatedFrontmatter = { ...frontmatter, [key]: value };

  await writeVaultFile(vaultPath, notePath, content, updatedFrontmatter, 'LF', contentHash);

  return {
    success: true,
    message: `Added frontmatter field "${key}"`,
    path: notePath,
    preview: `${key}: ${JSON.stringify(value)}`,
  };
}

/**
 * Execute a complete policy with strict atomic mode
 *
 * Policies always use strict atomic mode for commits:
 * 1. Pre-flight: Check git lock before any mutations
 * 2. Execute: Perform all file mutations
 * 3. Commit: Atomic git commit of all changes
 * 4. On failure: Report retryable status for lock contention
 *
 * This ensures agents get clear success/failure semantics:
 * - success=true means ALL changes committed atomically
 * - success=false with retryable=true means try again
 * - success=false with retryable=false means fix the issue
 */
export async function executePolicy(
  policy: PolicyDefinition,
  vaultPath: string,
  variables: Record<string, unknown>,
  commit: boolean = false
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

  // Track files for rollback on failure
  const filesModified = new Set<string>();
  const originalContents = new Map<string, string | null>();

  // Capture original contents before any mutations
  for (const step of policy.steps) {
    if (step.params.path) {
      const notePath = interpolate(String(step.params.path), context);
      if (!originalContents.has(notePath)) {
        try {
          const { content } = await readVaultFile(vaultPath, notePath);
          originalContents.set(notePath, content);
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
    const result = await executeStep(step, vaultPath, context, context.conditions);
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
      // Rollback any changes made so far (if commit was requested)
      if (commit && filesModified.size > 0) {
        await rollbackChanges(vaultPath, originalContents, filesModified);
      }

      const executionResult: PolicyExecutionResult = {
        success: false,
        policyName: policy.name,
        message: `Policy failed at step '${step.id}': ${result.message}`,
        stepResults,
        filesModified: [], // Nothing committed due to failure
        retryable: false,  // Step failure is not retryable
      };
      executionResult.tokensEstimate = estimateTokens(executionResult);
      return executionResult;
    }
  }

  // Create atomic commit if requested
  let gitCommit: string | undefined;
  let undoAvailable: boolean | undefined;
  let commitError: string | undefined;
  let isRetryable = false;
  let isLockContention = false;

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
      // Git commit failed - rollback file changes for atomic semantics
      await rollbackChanges(vaultPath, originalContents, filesModified);

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
      message: `Policy steps succeeded but git commit failed: ${commitError}. All changes rolled back.`,
      stepResults,
      filesModified: [], // Nothing committed due to rollback
      retryable: isRetryable,
      retryAfterMs: isRetryable ? 500 : undefined,
      lockContention: isLockContention,
    };
    executionResult.tokensEstimate = estimateTokens(executionResult);
    return executionResult;
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
  executionResult.tokensEstimate = estimateTokens(executionResult);

  return executionResult;
}

/**
 * Rollback file changes to original state
 */
async function rollbackChanges(
  vaultPath: string,
  originalContents: Map<string, string | null>,
  filesModified: Set<string>
): Promise<void> {
  for (const filePath of filesModified) {
    const original = originalContents.get(filePath);
    const fullPath = path.join(vaultPath, filePath);

    if (original === null) {
      // File was newly created - delete it
      try {
        await fs.unlink(fullPath);
      } catch {
        // File might not exist anymore
      }
    } else if (original !== undefined) {
      // Restore original content
      try {
        await fs.writeFile(fullPath, original);
      } catch {
        // Best effort rollback
      }
    }
  }
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
