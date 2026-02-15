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
  type SectionBoundary,
} from './writer.js';
import { commitChange } from './git.js';
import { estimateTokens } from './constants.js';
import type { MutationResult, ValidationWarning, OutputIssue, ScopingMetadata } from './types.js';
import { injectMutationMetadata } from './writer.js';

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
 * Check if a file exists and return an error result if not
 */
export async function ensureFileExists(
  vaultPath: string,
  notePath: string
): Promise<MutationResult | null> {
  const fullPath = path.join(vaultPath, notePath);
  try {
    await fs.access(fullPath);
    return null; // File exists
  } catch {
    return errorResult(notePath, `File not found: ${notePath}`);
  }
}

/**
 * Find a section and return an error result if not found
 */
export function ensureSectionExists(
  content: string,
  section: string,
  notePath: string
): { boundary: SectionBoundary } | { error: MutationResult } {
  const boundary = findSection(content, section);
  if (boundary) {
    return { boundary };
  }

  // Provide context-aware error message
  const headings = extractHeadings(content);
  let message: string;
  if (headings.length === 0) {
    message = `Section '${section}' not found. This file has no headings. Add section structure (## Heading) to enable section-scoped mutations.`;
  } else {
    const availableSections = headings.map(h => h.text).join(', ');
    message = `Section '${section}' not found. Available sections: ${availableSections}`;
  }

  return { error: errorResult(notePath, message) };
}

/**
 * Higher-order function that handles common file mutation patterns
 *
 * @example
 * ```typescript
 * const result = await withVaultFile(
 *   {
 *     vaultPath,
 *     notePath,
 *     commit,
 *     commitPrefix: '[Flywheel:Add]',
 *     section: 'Log',
 *     actionDescription: 'add content',
 *   },
 *   async (ctx) => {
 *     // ctx.content, ctx.frontmatter, ctx.sectionBoundary are available
 *     const updatedContent = insertInSection(ctx.content, ctx.sectionBoundary!, text, 'append');
 *     return {
 *       updatedContent,
 *       message: `Added to section "${ctx.sectionBoundary!.name}"`,
 *       preview: text,
 *     };
 *   }
 * );
 * ```
 */
export async function withVaultFile(
  options: WithVaultFileOptions,
  operation: (ctx: VaultFileContext) => Promise<MutationOperation>
): Promise<McpResponse> {
  const { vaultPath, notePath, commit, commitPrefix, section, actionDescription, scoping } = options;

  try {
    // 1. Check file exists
    const existsError = await ensureFileExists(vaultPath, notePath);
    if (existsError) {
      return formatMcpResult(existsError);
    }

    // 2. Read file with frontmatter
    const { content, frontmatter, lineEnding } = await readVaultFile(vaultPath, notePath);

    // 3. Find section if requested
    let sectionBoundary: SectionBoundary | undefined;
    if (section) {
      const sectionResult = ensureSectionExists(content, section, notePath);
      if ('error' in sectionResult) {
        return formatMcpResult(sectionResult.error);
      }
      sectionBoundary = sectionResult.boundary;
    }

    // 4. Build context for operation
    const ctx: VaultFileContext = {
      content,
      frontmatter,
      lineEnding,
      sectionBoundary,
      vaultPath,
      notePath,
    };

    // 5. Execute the mutation operation
    const opResult = await operation(ctx);

    // 6. Prepare frontmatter (inject metadata if scoping provided)
    let finalFrontmatter = opResult.updatedFrontmatter ?? frontmatter;
    if (scoping && (scoping.agent_id || scoping.session_id)) {
      finalFrontmatter = injectMutationMetadata(finalFrontmatter, scoping);
    }

    // 7. Write file back
    await writeVaultFile(vaultPath, notePath, opResult.updatedContent, finalFrontmatter, lineEnding);

    // 8. Handle git commit
    const gitInfo = await handleGitCommit(vaultPath, notePath, commit, commitPrefix);

    // 9. Build result
    const result = successResult(notePath, opResult.message, gitInfo, {
      preview: opResult.preview,
      warnings: opResult.warnings,
      outputIssues: opResult.outputIssues,
      normalizationChanges: opResult.normalizationChanges,
    });

    return formatMcpResult(result);
  } catch (error) {
    const result = errorResult(
      notePath,
      `Failed to ${actionDescription}: ${error instanceof Error ? error.message : String(error)}`
    );
    return formatMcpResult(result);
  }
}

/**
 * Simplified wrapper for frontmatter-only operations
 * (No section handling, just read/modify frontmatter/write)
 */
export async function withVaultFrontmatter(
  options: Omit<WithVaultFileOptions, 'section' | 'actionDescription'> & { actionDescription: string },
  operation: (ctx: Omit<VaultFileContext, 'sectionBoundary'>) => Promise<{
    updatedFrontmatter: Record<string, unknown>;
    message: string;
    preview?: string;
  }>
): Promise<McpResponse> {
  const { vaultPath, notePath, commit, commitPrefix, actionDescription } = options;

  try {
    // 1. Check file exists
    const existsError = await ensureFileExists(vaultPath, notePath);
    if (existsError) {
      return formatMcpResult(existsError);
    }

    // 2. Read file
    const { content, frontmatter, lineEnding } = await readVaultFile(vaultPath, notePath);

    // 3. Execute operation
    const ctx = { content, frontmatter, lineEnding, vaultPath, notePath };
    const opResult = await operation(ctx);

    // 4. Write file back (content unchanged, only frontmatter updated)
    await writeVaultFile(vaultPath, notePath, content, opResult.updatedFrontmatter, lineEnding);

    // 5. Handle git commit
    const gitInfo = await handleGitCommit(vaultPath, notePath, commit, commitPrefix);

    // 6. Build result
    const result = successResult(notePath, opResult.message, gitInfo, {
      preview: opResult.preview,
    });

    return formatMcpResult(result);
  } catch (error) {
    const result = errorResult(
      notePath,
      `Failed to ${actionDescription}: ${error instanceof Error ? error.message : String(error)}`
    );
    return formatMcpResult(result);
  }
}
