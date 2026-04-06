/**
 * Vault file I/O utilities.
 *
 * Reading and writing vault files with frontmatter parsing,
 * content hashing, and conflict detection.
 */

import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import { createHash } from 'node:crypto';
import { validatePathSecure } from './path-security.js';
import type { LineEnding } from './line-endings.js';
import { detectLineEnding, normalizeLineEndings, normalizeTrailingNewline, convertLineEndings } from './line-endings.js';

/**
 * Compute a short content hash for conflict detection.
 */
export function computeContentHash(rawContent: string): string {
  return createHash('sha256').update(rawContent).digest('hex').slice(0, 16);
}

/**
 * Error thrown when a write conflict is detected (file was modified externally).
 */
export class WriteConflictError extends Error {
  constructor(public readonly notePath: string) {
    super(`Write conflict on ${notePath}: file was modified externally since it was read. Re-read and retry.`);
    this.name = 'WriteConflictError';
  }
}

/**
 * Read a vault file with frontmatter parsing.
 *
 * Returns:
 * - content: The file content (after frontmatter), normalized to LF
 * - frontmatter: Parsed YAML frontmatter
 * - rawContent: The original raw content
 * - lineEnding: The detected line ending style (LF or CRLF)
 */
export async function readVaultFile(
  vaultPath: string,
  notePath: string
): Promise<{
  content: string;
  frontmatter: Record<string, unknown>;
  rawContent: string;
  lineEnding: LineEnding;
  mtimeMs: number;
  contentHash: string;
}> {
  const validation = await validatePathSecure(vaultPath, notePath);
  if (!validation.valid) {
    throw new Error(`Invalid path: ${validation.reason}`);
  }

  const fullPath = path.join(vaultPath, notePath);
  const [rawContent, stat] = await Promise.all([
    fs.readFile(fullPath, 'utf-8'),
    fs.stat(fullPath),
  ]);

  const contentHash = computeContentHash(rawContent);

  // Detect line ending before parsing
  const lineEnding = detectLineEnding(rawContent);

  // Normalize to LF for internal processing
  const normalizedContent = normalizeLineEndings(rawContent);

  const parsed = matter(normalizedContent);

  // Deep copy the frontmatter to avoid gray-matter's caching behavior
  // gray-matter caches parsed results and returns the same object reference,
  // which causes mutations to affect subsequent parses of the same content
  const frontmatter = deepCloneFrontmatter(parsed.data as Record<string, unknown>);

  return {
    content: parsed.content,
    frontmatter,
    rawContent,
    lineEnding,
    mtimeMs: stat.mtimeMs,
    contentHash,
  };
}

/**
 * Deep clone an object while preserving Date instances.
 * JSON.parse/stringify doesn't preserve Date objects, so we need a custom clone.
 */
function deepCloneFrontmatter(obj: Record<string, unknown>): Record<string, unknown> {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as unknown as Record<string, unknown>;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => {
      if (item instanceof Date) {
        return new Date(item.getTime());
      }
      if (item !== null && typeof item === 'object') {
        return deepCloneFrontmatter(item as Record<string, unknown>);
      }
      return item;
    }) as unknown as Record<string, unknown>;
  }

  const cloned: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value instanceof Date) {
      cloned[key] = new Date(value.getTime());
    } else if (value !== null && typeof value === 'object') {
      cloned[key] = deepCloneFrontmatter(value as Record<string, unknown>);
    } else {
      cloned[key] = value;
    }
  }
  return cloned;
}

/**
 * Write a vault file, preserving frontmatter and line endings.
 *
 * Uses validatePathSecure() to:
 * - Follow symlinks and ensure target is within vault
 * - Block writes to sensitive files (.env, .pem, etc.)
 *
 * @param lineEnding - Optional line ending style to use. If not provided, uses LF.
 */
export async function writeVaultFile(
  vaultPath: string,
  notePath: string,
  content: string,
  frontmatter: Record<string, unknown>,
  lineEnding: LineEnding = 'LF',
  expectedHash?: string
): Promise<void> {
  // Use secure validation for writes (follows symlinks, checks sensitive paths)
  const validation = await validatePathSecure(vaultPath, notePath);
  if (!validation.valid) {
    throw new Error(`Invalid path: ${validation.reason}`);
  }

  const fullPath = path.join(vaultPath, notePath);

  // Pre-write conflict check
  if (expectedHash) {
    const currentRaw = await fs.readFile(fullPath, 'utf-8');
    const currentHash = computeContentHash(currentRaw);
    if (currentHash !== expectedHash) {
      throw new WriteConflictError(notePath);
    }
  }

  // Stringify with gray-matter
  let output = matter.stringify(content, frontmatter);

  // Normalize trailing newline (exactly one)
  output = normalizeTrailingNewline(output);

  // Convert to target line ending style
  output = convertLineEndings(output, lineEnding);

  await fs.writeFile(fullPath, output, 'utf-8');
}
