/**
 * Markdown parser - extracts wikilinks, tags, and frontmatter
 *
 * Handles edge cases:
 * - Malformed YAML frontmatter (graceful fallback)
 * - Binary files disguised as .md
 * - Empty files
 * - Files with only frontmatter
 * - Very large files
 */

import * as fs from 'fs';
import matter from 'gray-matter';
import type { OutLink, VaultNote } from './types.js';
import type { VaultFile } from './vault.js';

/** Maximum file size to parse (10MB) - skip larger files */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Check if content appears to be binary */
function isBinaryContent(content: string): boolean {
  // Check for null bytes or high ratio of non-printable characters
  const nullBytes = (content.match(/\x00/g) || []).length;
  if (nullBytes > 0) return true;

  // Check first 1000 chars for non-printable (excluding common whitespace)
  const sample = content.slice(0, 1000);
  const nonPrintable = sample.replace(/[\x20-\x7E\t\n\r]/g, '').length;
  return nonPrintable / sample.length > 0.1;
}

/** Regex to match wikilinks: [[target]], [[target|alias]], [[target#heading]] */
const WIKILINK_REGEX = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;

/** Regex to match tags: #tag (but not in URLs or hex colors) */
const TAG_REGEX = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_/-]*)/g;

/** Regex to detect code blocks (to skip parsing inside them) */
const CODE_BLOCK_REGEX = /```[\s\S]*?```|`[^`\n]+`/g;

/**
 * Extract wikilinks from markdown content
 */
function extractWikilinks(content: string): OutLink[] {
  const links: OutLink[] = [];

  // Remove code blocks to avoid false matches
  const contentWithoutCode = content.replace(CODE_BLOCK_REGEX, (match) => ' '.repeat(match.length));

  // Track line numbers
  const lines = contentWithoutCode.split('\n');
  let charIndex = 0;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    let match;

    // Reset regex state for each line
    WIKILINK_REGEX.lastIndex = 0;

    while ((match = WIKILINK_REGEX.exec(line)) !== null) {
      const target = match[1].trim();
      const alias = match[2]?.trim();

      if (target) {
        links.push({
          target,
          alias,
          line: lineNum + 1, // 1-indexed
        });
      }
    }

    charIndex += line.length + 1; // +1 for newline
  }

  return links;
}

/**
 * Extract tags from markdown content and frontmatter
 */
function extractTags(content: string, frontmatter: Record<string, unknown>): string[] {
  const tags = new Set<string>();

  // Tags from frontmatter
  const fmTags = frontmatter.tags;
  if (Array.isArray(fmTags)) {
    for (const tag of fmTags) {
      if (typeof tag === 'string') {
        tags.add(tag.replace(/^#/, '')); // Remove leading # if present
      }
    }
  } else if (typeof fmTags === 'string') {
    tags.add(fmTags.replace(/^#/, ''));
  }

  // Tags from content (skip code blocks)
  const contentWithoutCode = content.replace(CODE_BLOCK_REGEX, '');
  let match;
  TAG_REGEX.lastIndex = 0;

  while ((match = TAG_REGEX.exec(contentWithoutCode)) !== null) {
    tags.add(match[1]);
  }

  return Array.from(tags);
}

/**
 * Extract aliases from frontmatter
 */
function extractAliases(frontmatter: Record<string, unknown>): string[] {
  const aliases = frontmatter.aliases;
  if (Array.isArray(aliases)) {
    return aliases.filter((a): a is string => typeof a === 'string');
  }
  if (typeof aliases === 'string') {
    return [aliases];
  }
  return [];
}

/** Result of parsing a note - includes warnings for partial failures */
export interface ParseResult {
  note: VaultNote;
  warnings: string[];
  skipped: boolean;
  skipReason?: string;
}

/**
 * Parse a markdown file into a VaultNote
 *
 * Handles edge cases gracefully:
 * - Empty files: Returns note with no links/tags
 * - Malformed YAML: Treats entire file as content
 * - Binary files: Skips with warning
 * - Large files: Skips with warning
 */
export async function parseNote(file: VaultFile): Promise<VaultNote> {
  const result = await parseNoteWithWarnings(file);

  if (result.skipped) {
    throw new Error(result.skipReason || 'File skipped');
  }

  if (result.warnings.length > 0) {
    for (const warning of result.warnings) {
      console.error(`Warning [${file.path}]: ${warning}`);
    }
  }

  return result.note;
}

/**
 * Parse a markdown file with detailed result including warnings
 */
export async function parseNoteWithWarnings(file: VaultFile): Promise<ParseResult> {
  const warnings: string[] = [];

  // Check file size first
  try {
    const stats = await fs.promises.stat(file.absolutePath);
    if (stats.size > MAX_FILE_SIZE) {
      return {
        note: createEmptyNote(file),
        warnings: [],
        skipped: true,
        skipReason: `File too large (${(stats.size / 1024 / 1024).toFixed(1)}MB > ${MAX_FILE_SIZE / 1024 / 1024}MB limit)`,
      };
    }
  } catch {
    // If we can't stat, try to read anyway
  }

  let content: string;
  try {
    content = await fs.promises.readFile(file.absolutePath, 'utf-8');
  } catch (err) {
    return {
      note: createEmptyNote(file),
      warnings: [],
      skipped: true,
      skipReason: `Could not read file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Check for empty file
  if (content.trim().length === 0) {
    return {
      note: createEmptyNote(file),
      warnings: ['Empty file'],
      skipped: false,
    };
  }

  // Check for binary content
  if (isBinaryContent(content)) {
    return {
      note: createEmptyNote(file),
      warnings: [],
      skipped: true,
      skipReason: 'Binary content detected',
    };
  }

  // Parse frontmatter
  let frontmatter: Record<string, unknown> = {};
  let markdown = content;

  try {
    const parsed = matter(content);
    frontmatter = parsed.data as Record<string, unknown>;
    markdown = parsed.content;
  } catch (err) {
    // Malformed frontmatter - treat entire file as content
    warnings.push(`Malformed frontmatter: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Extract title from filename
  const title = file.path.replace(/\.md$/, '').split('/').pop() || file.path;

  return {
    note: {
      path: file.path,
      title,
      aliases: extractAliases(frontmatter),
      frontmatter,
      outlinks: extractWikilinks(markdown),
      tags: extractTags(markdown, frontmatter),
      modified: file.modified,
      created: file.created,
    },
    warnings,
    skipped: false,
  };
}

/**
 * Create an empty note for skipped/failed files
 */
function createEmptyNote(file: VaultFile): VaultNote {
  const title = file.path.replace(/\.md$/, '').split('/').pop() || file.path;
  return {
    path: file.path,
    title,
    aliases: [],
    frontmatter: {},
    outlinks: [],
    tags: [],
    modified: file.modified,
    created: file.created,
  };
}
