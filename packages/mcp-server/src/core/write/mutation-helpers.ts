/**
 * Shared helpers for mutation tools
 * Reduces boilerplate for file access, git commits, and result formatting
 */

import fs from 'fs/promises';
import path from 'path';
import {
  readVaultFile,
  writeVaultFile,
  findSection,
  extractHeadings,
  DiagnosticError,
  WriteConflictError,
  validatePathSecure,
  type SectionBoundary,
} from './writer.js';
import { commitChange } from './git.js';
import { estimateTokens } from './constants.js';
import type { MutationResult, ValidationWarning, OutputIssue, ScopingMetadata } from './types.js';
import { injectMutationMetadata } from './writer.js';
import { getWriteStateDb } from './wikilinks.js';
import { processImplicitFeedback } from './wikilinkFeedback.js';
import { getPoliciesDir } from './policy/policyPaths.js';

/**
 * Context provided to mutation operations
 */
export interface VaultFileContext {
  /** File content (without frontmatter) */
  content: string;
  /** Parsed frontmatter object */
  frontmatter: Record<string, unknown>;
  /** Line ending style (CRLF or LF) */
  lineEnding: string;
  /** Section boundary if section was requested and found */
  sectionBoundary?: SectionBoundary;
  /** Full path to the vault */
  vaultPath: string;
  /** Vault-relative path to the file */
  notePath: string;
}

/**
 * Result from a mutation operation
 */
export interface MutationOperation {
  /** Updated file content */
  updatedContent: string;
  /** Updated frontmatter (optional - uses original if not provided) */
  updatedFrontmatter?: Record<string, unknown>;
  /** Success message */
  message: string;
  /** Preview of changes */
  preview?: string;
  /** Input validation warnings */
  warnings?: ValidationWarning[];
  /** Output guardrail issues */
  outputIssues?: OutputIssue[];
  /** Normalization changes applied */
  normalizationChanges?: string[];
}

/**
 * Options for withVaultFile
 */
export interface WithVaultFileOptions {
  /** Vault root path */
  vaultPath: string;
  /** Vault-relative path to the file */
  notePath: string;
  /** Whether to commit changes to git */
  commit: boolean;
  /** Prefix for git commit message (e.g., '[Flywheel:Add]') */
  commitPrefix: string;
  /** Optional: section to find (returns error if not found) */
  section?: string;
  /** Action description for error messages (e.g., 'add content') */
  actionDescription: string;
  /** Optional: agent/session scoping for multi-agent deployments */
  scoping?: ScopingMetadata;
  /** If true, compute the mutation but skip all writes and git commits */
  dryRun?: boolean;
  /** If true and section not found, auto-create the section heading in the note */
  autoCreateSection?: boolean;
}

/**
 * MCP response format
 */
export type McpResponse = { content: [{ type: 'text'; text: string }] };

/**
 * Format a MutationResult as an MCP response
 */
export function formatMcpResult(result: MutationResult): McpResponse {
  // Ensure tokensEstimate is set
  if (result.tokensEstimate === undefined || result.tokensEstimate === 0) {
    result.tokensEstimate = estimateTokens(result);
  }
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

/**
 * Create an error MutationResult
 */
export function errorResult(
  notePath: string,
  message: string,
  extras?: Partial<MutationResult>
): MutationResult {
  const result: MutationResult = {
    success: false,
    message,
    path: notePath,
    tokensEstimate: 0,
    ...extras,
  };
  result.tokensEstimate = estimateTokens(result);
  return result;
}

/**
 * Create a success MutationResult
 */
export function successResult(
  notePath: string,
  message: string,
  gitInfo: GitCommitInfo,
  extras?: Partial<MutationResult>
): MutationResult {
  const result: MutationResult = {
    success: true,
    message,
    path: notePath,
    tokensEstimate: 0,
    ...gitInfo,
    ...extras,
  };
  result.tokensEstimate = estimateTokens(result);
  return result;
}

/**
 * Git commit information
 */
export interface GitCommitInfo {
  gitCommit?: string;
  undoAvailable?: boolean;
  staleLockDetected?: boolean;
  lockAgeMs?: number;
}

/**
 * Handle git commit with standard error handling
 */
export async function handleGitCommit(
  vaultPath: string,
  notePath: string,
  commit: boolean,
  prefix: string
): Promise<GitCommitInfo> {
  if (!commit) {
    return {};
  }

  const gitResult = await commitChange(vaultPath, notePath, prefix);
  const info: GitCommitInfo = {};

  if (gitResult.success && gitResult.hash) {
    info.gitCommit = gitResult.hash;
    info.undoAvailable = gitResult.undoAvailable;
  }

  if (gitResult.staleLockDetected) {
    info.staleLockDetected = gitResult.staleLockDetected;
    info.lockAgeMs = gitResult.lockAgeMs;
  }

  return info;
}

/**
 * Check if saved policies exist in the vault's .flywheel/policies/ directory.
 * Returns a hint string if policies are available, or empty string if not.
 */
async function getPolicyHint(vaultPath: string): Promise<string> {
  try {
    const policiesDir = getPoliciesDir(vaultPath);
    const files = await fs.readdir(policiesDir);
    const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    if (yamlFiles.length > 0) {
      const names = yamlFiles.map(f => f.replace(/\.ya?ml$/, '')).join(', ');
      return ` This vault has saved policies (${names}) — run policy(action="list") and use a matching policy to create the note with proper structure.`;
    }
  } catch { /* no policies dir */ }
  return '';
}

/**
 * Check if a file exists and return an error result if not
 */
export async function ensureFileExists(
  vaultPath: string,
  notePath: string
): Promise<MutationResult | null> {
  // Validate path before any filesystem access
  const validation = await validatePathSecure(vaultPath, notePath);
  if (!validation.valid) {
    return errorResult(notePath, `Invalid path: ${validation.reason}`);
  }
  const fullPath = path.join(vaultPath, notePath);
  try {
    await fs.access(fullPath);
    return null; // File exists
  } catch {
    const hint = await getPolicyHint(vaultPath);
    return errorResult(notePath, `File not found: ${notePath}.${hint}`);
  }
}

/**
 * Find a section and return an error result if not found
 */
export async function ensureSectionExists(
  content: string,
  section: string,
  notePath: string,
  vaultPath?: string
): Promise<{ boundary: SectionBoundary } | { error: MutationResult }> {
  const boundary = findSection(content, section);
  if (boundary) {
    return { boundary };
  }

  // Provide context-aware error message
  const headings = extractHeadings(content);
  const hint = vaultPath ? await getPolicyHint(vaultPath) : '';
  let message: string;
  if (headings.length === 0) {
    message = `Section '${section}' not found. This file has no headings.${hint || ' Add section structure (## Heading) to enable section-scoped mutations.'}`;
  } else {
    const availableSections = headings.map(h => h.text).join(', ');
    message = `Section '${section}' not found. Available sections: ${availableSections}.${hint}`;
  }

  return { error: errorResult(notePath, message) };
}

/**
 * Options for executeMutation (core mutation logic without git/MCP concerns)
 */
export interface MutationOptions {
  /** Vault root path */
  vaultPath: string;
  /** Vault-relative path to the file */
  notePath: string;
  /** Optional: section to find (returns error if not found) */
  section?: string;
  /** Action description for error messages */
  actionDescription: string;
  /** Optional: agent/session scoping for multi-agent deployments */
  scoping?: ScopingMetadata;
  /** If true, compute the mutation but skip all writes */
  dryRun?: boolean;
  /** Whether to run implicit feedback detection. Default: true */
  implicitFeedback?: boolean;
  /** If true and section not found, auto-create the section heading in the note.
   *  Used when a note was just created from template/fallback and the target section
   *  may not exist yet. The heading level is inferred from the document structure. */
  autoCreateSection?: boolean;
}

/**
 * Outcome from executeMutation — raw result before git commit or MCP formatting.
 * Used by both direct tools (via withVaultFile) and policy executor.
 */
export interface MutationOutcome {
  success: boolean;
  result: MutationResult;
  /** Vault-relative paths of files written (empty on error or dry run) */
  filesWritten: string[];
}

/**
 * Core mutation logic: read file, find section, run operation, write back.
 * Does NOT handle git commits or MCP response formatting.
 * Used by withVaultFile (direct tools) and the policy executor.
 */
export async function executeMutation(
  options: MutationOptions,
  operation: (ctx: VaultFileContext) => Promise<MutationOperation>
): Promise<MutationOutcome> {
  const { vaultPath, notePath, section, actionDescription, scoping, dryRun } = options;
  const implicitFeedback = options.implicitFeedback !== false;

  try {
    // 1. Check file exists
    const existsError = await ensureFileExists(vaultPath, notePath);
    if (existsError) {
      return { success: false, result: existsError, filesWritten: [] };
    }

    // 2. Read file
    let { content, frontmatter, lineEnding, contentHash } = await readVaultFile(vaultPath, notePath);

    // 3. Find section if requested
    let sectionBoundary: SectionBoundary | undefined;
    if (section) {
      const sectionResult = await ensureSectionExists(content, section, notePath, vaultPath);
      if ('error' in sectionResult) {
        // Auto-create missing section when the note was just created (e.g., from fallback template)
        if (options.autoCreateSection) {
          const sectionName = section.replace(/^#+\s*/, '').trim();
          const headings = extractHeadings(content);
          // Infer heading level: use same level as existing headings, or one below the top heading
          let level = 1;
          if (headings.length > 0) {
            const topLevel = Math.min(...headings.map(h => h.level));
            // If there's a single top-level heading (e.g., # 2026-03-27), nest below it
            const topHeadings = headings.filter(h => h.level === topLevel);
            level = topHeadings.length === 1 ? topLevel + 1 : topLevel;
          }
          const hashes = '#'.repeat(level);
          // Append new section heading with a placeholder
          const newSection = `\n${hashes} ${sectionName}\n- \n`;
          content = content.trimEnd() + '\n' + newSection;
          // Write the updated content so the section exists for the mutation
          await writeVaultFile(vaultPath, notePath, content, frontmatter, lineEnding, contentHash);
          // Re-read to get fresh content hash
          ({ content, frontmatter, lineEnding, contentHash } = await readVaultFile(vaultPath, notePath));
          // Retry section lookup
          const retryResult = await ensureSectionExists(content, section, notePath, vaultPath);
          if ('error' in retryResult) {
            return { success: false, result: retryResult.error, filesWritten: [] };
          }
          sectionBoundary = retryResult.boundary;
          console.error(`[Flywheel] Auto-created section "${sectionName}" (${hashes}) in ${notePath}`);
        } else {
          return { success: false, result: sectionResult.error, filesWritten: [] };
        }
      } else {
        sectionBoundary = sectionResult.boundary;
      }
    }

    // 4. Build context and run operation
    const ctx: VaultFileContext = { content, frontmatter, lineEnding, sectionBoundary, vaultPath, notePath };
    const opResult = await operation(ctx);

    // 5. Dry run: return preview without writing
    if (dryRun) {
      const result = successResult(notePath, `[dry run] ${opResult.message}`, {}, {
        preview: opResult.preview,
        warnings: opResult.warnings,
        outputIssues: opResult.outputIssues,
        normalizationChanges: opResult.normalizationChanges,
        dryRun: true,
      });
      return { success: true, result, filesWritten: [] };
    }

    // 6. Implicit feedback — detect removed auto-applied wikilinks
    if (implicitFeedback) {
      const writeStateDb = getWriteStateDb();
      if (writeStateDb) {
        processImplicitFeedback(writeStateDb, notePath, content);
      }
    }

    // 7. Prepare frontmatter (inject metadata if scoping provided)
    let finalFrontmatter = opResult.updatedFrontmatter ?? frontmatter;
    if (scoping && (scoping.agent_id || scoping.session_id)) {
      finalFrontmatter = injectMutationMetadata(finalFrontmatter, scoping);
    }

    // 8. Write file back (hash guard detects external modifications)
    await writeVaultFile(vaultPath, notePath, opResult.updatedContent, finalFrontmatter, lineEnding, contentHash);

    // 9. Build result (without git info — caller adds that)
    const result = successResult(notePath, opResult.message, {}, {
      preview: opResult.preview,
      warnings: opResult.warnings,
      outputIssues: opResult.outputIssues,
      normalizationChanges: opResult.normalizationChanges,
    });
    return { success: true, result, filesWritten: [notePath] };
  } catch (error) {
    const extras: Partial<MutationResult> = {};
    if (error instanceof WriteConflictError) {
      extras.warnings = [{
        type: 'write_conflict',
        message: error.message,
        suggestion: 'The file was modified while processing. Re-read and retry.',
      }];
    }
    if (error instanceof DiagnosticError) {
      extras.diagnostic = error.diagnostic;
    }
    const result = errorResult(
      notePath,
      `Failed to ${actionDescription}: ${error instanceof Error ? error.message : String(error)}`,
      extras
    );
    return { success: false, result, filesWritten: [] };
  }
}

/**
 * Higher-order function that handles common file mutation patterns.
 * Thin wrapper around executeMutation that adds git commits and MCP response formatting.
 */
export async function withVaultFile(
  options: WithVaultFileOptions,
  operation: (ctx: VaultFileContext) => Promise<MutationOperation>
): Promise<McpResponse> {
  const outcome = await executeMutation({
    vaultPath: options.vaultPath,
    notePath: options.notePath,
    section: options.section,
    actionDescription: options.actionDescription,
    scoping: options.scoping,
    dryRun: options.dryRun,
    autoCreateSection: options.autoCreateSection,
  }, operation);

  if (!outcome.success || options.dryRun) {
    return formatMcpResult(outcome.result);
  }

  // Add git commit info
  const gitInfo = await handleGitCommit(options.vaultPath, options.notePath, options.commit, options.commitPrefix);
  if (gitInfo.gitCommit) outcome.result.gitCommit = gitInfo.gitCommit;
  if (gitInfo.undoAvailable) outcome.result.undoAvailable = gitInfo.undoAvailable;
  if (gitInfo.staleLockDetected) {
    outcome.result.staleLockDetected = gitInfo.staleLockDetected;
    outcome.result.lockAgeMs = gitInfo.lockAgeMs;
  }

  return formatMcpResult(outcome.result);
}

/**
 * Result from a frontmatter operation callback
 */
export interface FrontmatterOperation {
  updatedFrontmatter: Record<string, unknown>;
  message: string;
  preview?: string;
}

/**
 * Core frontmatter mutation logic: read file, run operation, write back.
 * Does NOT handle git commits or MCP response formatting.
 * Used by withVaultFrontmatter (direct tools) and the policy executor.
 */
export async function executeFrontmatterMutation(
  options: Pick<MutationOptions, 'vaultPath' | 'notePath' | 'actionDescription' | 'dryRun'>,
  operation: (ctx: Omit<VaultFileContext, 'sectionBoundary'>) => Promise<FrontmatterOperation>
): Promise<MutationOutcome> {
  const { vaultPath, notePath, actionDescription, dryRun } = options;

  try {
    // 1. Check file exists
    const existsError = await ensureFileExists(vaultPath, notePath);
    if (existsError) {
      return { success: false, result: existsError, filesWritten: [] };
    }

    // 2. Read file
    const { content, frontmatter, lineEnding, contentHash } = await readVaultFile(vaultPath, notePath);

    // 3. Execute operation
    const ctx = { content, frontmatter, lineEnding, vaultPath, notePath };
    const opResult = await operation(ctx);

    // 4. Dry run: return preview without writing
    if (dryRun) {
      const result = successResult(notePath, `[dry run] ${opResult.message}`, {}, {
        preview: opResult.preview,
        dryRun: true,
      });
      return { success: true, result, filesWritten: [] };
    }

    // 5. Write file back (content unchanged, only frontmatter updated; hash guard)
    await writeVaultFile(vaultPath, notePath, content, opResult.updatedFrontmatter, lineEnding, contentHash);

    // 6. Build result (without git info)
    const result = successResult(notePath, opResult.message, {}, {
      preview: opResult.preview,
    });
    return { success: true, result, filesWritten: [notePath] };
  } catch (error) {
    const extras: Partial<MutationResult> = {};
    if (error instanceof WriteConflictError) {
      extras.warnings = [{
        type: 'write_conflict',
        message: error.message,
        suggestion: 'The file was modified while processing. Re-read and retry.',
      }];
    }
    const result = errorResult(
      notePath,
      `Failed to ${actionDescription}: ${error instanceof Error ? error.message : String(error)}`,
      extras
    );
    return { success: false, result, filesWritten: [] };
  }
}

/**
 * Simplified wrapper for frontmatter-only operations.
 * Thin wrapper around executeFrontmatterMutation that adds git commits and MCP response formatting.
 */
export async function withVaultFrontmatter(
  options: Omit<WithVaultFileOptions, 'section' | 'actionDescription'> & { actionDescription: string },
  operation: (ctx: Omit<VaultFileContext, 'sectionBoundary'>) => Promise<FrontmatterOperation>
): Promise<McpResponse> {
  const outcome = await executeFrontmatterMutation({
    vaultPath: options.vaultPath,
    notePath: options.notePath,
    actionDescription: options.actionDescription,
    dryRun: options.dryRun,
  }, operation);

  if (!outcome.success || options.dryRun) {
    return formatMcpResult(outcome.result);
  }

  // Add git commit info
  const gitInfo = await handleGitCommit(options.vaultPath, options.notePath, options.commit, options.commitPrefix);
  if (gitInfo.gitCommit) outcome.result.gitCommit = gitInfo.gitCommit;
  if (gitInfo.undoAvailable) outcome.result.undoAvailable = gitInfo.undoAvailable;
  if (gitInfo.staleLockDetected) {
    outcome.result.staleLockDetected = gitInfo.staleLockDetected;
    outcome.result.lockAgeMs = gitInfo.lockAgeMs;
  }

  return formatMcpResult(outcome.result);
}

// ============================================================================
// Shared Create/Delete Note Logic
// ============================================================================

/**
 * Options for executeCreateNote
 */
export interface CreateNoteOptions {
  vaultPath: string;
  notePath: string;
  content: string;
  frontmatter: Record<string, unknown>;
  overwrite?: boolean;
  skipWikilinks?: boolean;
  scoping?: ScopingMetadata;
}

/**
 * Core create-note logic: validate path, check exists, create dirs, apply wikilinks, write.
 * Does NOT handle: templates, preflight checks, alias detection, git commits, MCP formatting.
 * Callers (direct tool, policy executor) add their own pre-write intelligence.
 */
export async function executeCreateNote(options: CreateNoteOptions): Promise<MutationOutcome> {
  const { vaultPath, notePath, content, frontmatter, overwrite, skipWikilinks, scoping } = options;

  try {
    // 1. Validate path
    const pathCheck = await validatePathSecure(vaultPath, notePath);
    if (!pathCheck.valid) {
      return { success: false, result: errorResult(notePath, `Path blocked: ${pathCheck.reason}`), filesWritten: [] };
    }

    // 2. Check if file already exists
    const fullPath = path.join(vaultPath, notePath);
    let fileExists = false;
    try {
      await fs.access(fullPath);
      fileExists = true;
    } catch {
      // File doesn't exist — good
    }

    if (fileExists && !overwrite) {
      return { success: false, result: errorResult(notePath, `File already exists: ${notePath}. Use overwrite=true to replace.`), filesWritten: [] };
    }

    // 3. Create parent directories
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    // 4. Apply wikilinks
    const { maybeApplyWikilinks } = await import('./wikilinks.js');
    const { content: processedContent } = maybeApplyWikilinks(content, skipWikilinks ?? false, notePath);

    // 5. Inject scoping metadata
    let finalFrontmatter = frontmatter;
    if (scoping && (scoping.agent_id || scoping.session_id)) {
      finalFrontmatter = injectMutationMetadata(frontmatter, scoping);
    }

    // 6. Write file
    await writeVaultFile(vaultPath, notePath, processedContent, finalFrontmatter);

    const result = successResult(notePath, `Created note: ${notePath}`, {}, {
      preview: `Frontmatter: ${Object.keys(frontmatter).join(', ') || 'none'}, Content: ${processedContent.length} chars`,
    });
    return { success: true, result, filesWritten: [notePath] };
  } catch (error) {
    return {
      success: false,
      result: errorResult(notePath, `Failed to create note: ${error instanceof Error ? error.message : String(error)}`),
      filesWritten: [],
    };
  }
}

/**
 * Core delete-note logic: validate path, check exists, confirm, delete.
 * Does NOT handle: backlink checking, git commits, MCP formatting.
 */
export async function executeDeleteNote(options: {
  vaultPath: string;
  notePath: string;
  confirm: boolean;
}): Promise<MutationOutcome> {
  const { vaultPath, notePath, confirm } = options;

  try {
    if (!confirm) {
      return {
        success: false,
        result: errorResult(notePath, 'Deletion requires explicit confirmation (confirm=true)'),
        filesWritten: [],
      };
    }

    // 1. Validate path
    const pathCheck = await validatePathSecure(vaultPath, notePath);
    if (!pathCheck.valid) {
      return { success: false, result: errorResult(notePath, `Path blocked: ${pathCheck.reason}`), filesWritten: [] };
    }

    // 2. Check file exists
    const fullPath = path.join(vaultPath, notePath);
    try {
      await fs.access(fullPath);
    } catch {
      return { success: false, result: errorResult(notePath, `File not found: ${notePath}`), filesWritten: [] };
    }

    // 3. Delete
    await fs.unlink(fullPath);

    const result = successResult(notePath, `Deleted note: ${notePath}`, {});
    return { success: true, result, filesWritten: [notePath] };
  } catch (error) {
    return {
      success: false,
      result: errorResult(notePath, `Failed to delete note: ${error instanceof Error ? error.message : String(error)}`),
      filesWritten: [],
    };
  }
}
