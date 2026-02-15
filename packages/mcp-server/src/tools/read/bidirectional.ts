/**
 * Bidirectional Bridge Tools
 *
 * Bridge Graph-Native (wikilinks) and Schema-Native (frontmatter) paradigms.
 * These tools detect patterns in prose and suggest frontmatter/wikilink additions.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import matter from 'gray-matter';
import type { VaultIndex, VaultNote } from '../../core/read/types.js';

// =============================================================================
// TYPES
// =============================================================================

export interface ProsePattern {
  key: string;
  value: string;
  line: number;
  raw: string;
  isWikilink: boolean;
}

export interface DetectProsePatternsResult {
  path: string;
  patterns: ProsePattern[];
  error?: string;
}

export interface FrontmatterSuggestion {
  field: string;
  value: string | string[];
  source_lines: number[];
  confidence: number;
  preserveWikilink: boolean;
}

export interface SuggestFrontmatterResult {
  path: string;
  suggestions: FrontmatterSuggestion[];
  error?: string;
}

export interface WikilinkSuggestion {
  field: string;
  current_value: string;
  suggested_link: string;
  target_note: string;
  array_index?: number;
}

export interface SuggestWikilinksResult {
  path: string;
  suggestions: WikilinkSuggestion[];
  error?: string;
}

export interface CrossLayerReference {
  field?: string;
  pattern?: string;
  target: string;
  line?: number;
}

export interface ValidateCrossLayerResult {
  path: string;
  frontmatter_only: CrossLayerReference[];
  prose_only: CrossLayerReference[];
  consistent: CrossLayerReference[];
  error?: string;
}

// =============================================================================
// REGEX PATTERNS
// =============================================================================

/**
 * Match prose patterns like:
 * - Key: [[wikilink]]
 * - Key: Value
 * - Key: "quoted value"
 *
 * Captures: [fullMatch, key, wikilinkTarget?, plainValue?]
 */
const PROSE_PATTERN_REGEX =
  /^([A-Za-z][A-Za-z0-9 _-]*):\s*(?:\[\[([^\]]+)\]\]|"([^"]+)"|([^\n]+?))\s*$/gm;

/** Match code blocks to exclude them */
const CODE_BLOCK_REGEX = /```[\s\S]*?```|`[^`\n]+`/g;

/** Match wikilinks in any text */
const WIKILINK_REGEX = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Read file content, returning null if file doesn't exist
 */
async function readFileContent(
  notePath: string,
  vaultPath: string
): Promise<string | null> {
  const fullPath = path.join(vaultPath, notePath);
  try {
    return await fs.readFile(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Get just the body (non-frontmatter) content with line numbers preserved
 */
function getBodyContent(content: string): { body: string; bodyStartLine: number } {
  try {
    const parsed = matter(content);
    // Count lines in frontmatter
    const frontmatterMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
    const bodyStartLine = frontmatterMatch
      ? frontmatterMatch[0].split('\n').length
      : 1;
    return { body: parsed.content, bodyStartLine };
  } catch {
    return { body: content, bodyStartLine: 1 };
  }
}

/**
 * Remove code blocks from content, preserving line numbers
 */
function removeCodeBlocks(content: string): string {
  return content.replace(CODE_BLOCK_REGEX, (match) => {
    // Replace with same number of newlines to preserve line numbers
    const newlines = (match.match(/\n/g) || []).length;
    return '\n'.repeat(newlines);
  });
}

/**
 * Extract wikilink targets from frontmatter values
 */
function extractWikilinksFromValue(value: unknown): string[] {
  if (typeof value === 'string') {
    const matches: string[] = [];
    let match;
    WIKILINK_REGEX.lastIndex = 0;
    while ((match = WIKILINK_REGEX.exec(value)) !== null) {
      matches.push(match[1].trim());
    }
    return matches;
  }
  if (Array.isArray(value)) {
    return value.flatMap((v) => extractWikilinksFromValue(v));
  }
  return [];
}

/**
 * Check if a string value is already a wikilink
 */
function isWikilinkValue(value: string): boolean {
  return /^\[\[.+\]\]$/.test(value.trim());
}

/**
 * Normalize a note reference for comparison
 */
function normalizeRef(ref: string): string {
  return ref.toLowerCase().replace(/\.md$/, '').trim();
}

// =============================================================================
// CORE FUNCTIONS (exported for testing)
// =============================================================================

/**
 * Detect "Key: Value" or "Key: [[wikilink]]" patterns in prose
 */
export async function detectProsePatterns(
  index: VaultIndex,
  notePath: string,
  vaultPath: string
): Promise<DetectProsePatternsResult> {
  const content = await readFileContent(notePath, vaultPath);

  if (content === null) {
    return {
      path: notePath,
      patterns: [],
      error: 'File not found',
    };
  }

  const { body, bodyStartLine } = getBodyContent(content);
  const cleanBody = removeCodeBlocks(body);

  const patterns: ProsePattern[] = [];
  const lines = cleanBody.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = bodyStartLine + i;

    // Skip empty lines
    if (!line.trim()) continue;

    // Reset regex
    PROSE_PATTERN_REGEX.lastIndex = 0;

    // Try to match the pattern
    const match = PROSE_PATTERN_REGEX.exec(line);
    if (match) {
      const key = match[1].trim();
      const wikilinkTarget = match[2]?.trim();
      const quotedValue = match[3]?.trim();
      const plainValue = match[4]?.trim();

      const value = wikilinkTarget || quotedValue || plainValue;
      if (value) {
        patterns.push({
          key,
          value,
          line: lineNumber,
          raw: line.trim(),
          isWikilink: !!wikilinkTarget,
        });
      }
    }
  }

  return {
    path: notePath,
    patterns,
  };
}

/**
 * Suggest frontmatter fields based on detected prose patterns
 */
export async function suggestFrontmatterFromProse(
  index: VaultIndex,
  notePath: string,
  vaultPath: string
): Promise<SuggestFrontmatterResult> {
  const content = await readFileContent(notePath, vaultPath);

  if (content === null) {
    return {
      path: notePath,
      suggestions: [],
      error: 'File not found',
    };
  }

  // Get existing frontmatter
  let existingFrontmatter: Record<string, unknown> = {};
  try {
    existingFrontmatter = matter(content).data as Record<string, unknown>;
  } catch {
    // No valid frontmatter
  }

  // Detect patterns
  const { patterns } = await detectProsePatterns(index, notePath, vaultPath);

  // Group patterns by key (lowercase for comparison)
  const patternsByKey = new Map<
    string,
    { patterns: ProsePattern[]; originalKey: string }
  >();

  for (const pattern of patterns) {
    const keyLower = pattern.key.toLowerCase();
    const existing = patternsByKey.get(keyLower);
    if (existing) {
      existing.patterns.push(pattern);
    } else {
      patternsByKey.set(keyLower, {
        patterns: [pattern],
        originalKey: pattern.key,
      });
    }
  }

  // Build suggestions
  const suggestions: FrontmatterSuggestion[] = [];

  for (const [keyLower, { patterns: keyPatterns, originalKey }] of patternsByKey) {
    // Skip if already in frontmatter
    const existingKey = Object.keys(existingFrontmatter).find(
      (k) => k.toLowerCase() === keyLower
    );
    if (existingKey) continue;

    // Convert key to snake_case for frontmatter
    const fieldName = originalKey
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/-/g, '_');

    // Collect values
    const values = keyPatterns.map((p) => {
      // Preserve wikilinks in suggested value
      if (p.isWikilink) {
        return `[[${p.value}]]`;
      }
      return p.value;
    });

    const uniqueValues = [...new Set(values)];
    const hasWikilink = keyPatterns.some((p) => p.isWikilink);

    suggestions.push({
      field: fieldName,
      value: uniqueValues.length === 1 ? uniqueValues[0] : uniqueValues,
      source_lines: keyPatterns.map((p) => p.line),
      confidence: hasWikilink ? 0.9 : 0.7, // Higher confidence for wikilink patterns
      preserveWikilink: hasWikilink,
    });
  }

  return {
    path: notePath,
    suggestions,
  };
}

/**
 * Suggest wikilinks for frontmatter values that match existing notes
 */
export async function suggestWikilinksInFrontmatter(
  index: VaultIndex,
  notePath: string,
  vaultPath: string
): Promise<SuggestWikilinksResult> {
  const content = await readFileContent(notePath, vaultPath);

  if (content === null) {
    return {
      path: notePath,
      suggestions: [],
      error: 'File not found',
    };
  }

  let frontmatter: Record<string, unknown> = {};
  try {
    frontmatter = matter(content).data as Record<string, unknown>;
  } catch {
    return {
      path: notePath,
      suggestions: [],
      error: 'Invalid frontmatter',
    };
  }

  const suggestions: WikilinkSuggestion[] = [];

  /**
   * Check if a string value matches an entity and suggest a wikilink
   */
  function checkValue(
    field: string,
    value: unknown,
    arrayIndex?: number
  ): void {
    if (typeof value !== 'string') return;

    // Skip if already a wikilink
    if (isWikilinkValue(value)) return;

    // Skip empty values
    if (!value.trim()) return;

    // Check if this value matches an entity (note title or alias)
    const normalizedValue = normalizeRef(value);
    const matchedPath = index.entities.get(normalizedValue);

    if (matchedPath) {
      const targetNote = index.notes.get(matchedPath);
      suggestions.push({
        field,
        current_value: value,
        suggested_link: `[[${targetNote?.title || value}]]`,
        target_note: matchedPath,
        array_index: arrayIndex,
      });
    }
  }

  // Check each frontmatter field
  for (const [field, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      value.forEach((v, i) => checkValue(field, v, i));
    } else {
      checkValue(field, value);
    }
  }

  return {
    path: notePath,
    suggestions,
  };
}

/**
 * Validate consistency between frontmatter references and prose wikilinks
 */
export async function validateCrossLayer(
  index: VaultIndex,
  notePath: string,
  vaultPath: string
): Promise<ValidateCrossLayerResult> {
  const content = await readFileContent(notePath, vaultPath);

  if (content === null) {
    return {
      path: notePath,
      frontmatter_only: [],
      prose_only: [],
      consistent: [],
      error: 'File not found',
    };
  }

  let frontmatter: Record<string, unknown> = {};
  let body = content;
  try {
    const parsed = matter(content);
    frontmatter = parsed.data as Record<string, unknown>;
    body = parsed.content;
  } catch {
    // No valid frontmatter
  }

  // Extract wikilinks from frontmatter
  const frontmatterRefs = new Map<string, { field: string; target: string }>();
  for (const [field, value] of Object.entries(frontmatter)) {
    const wikilinks = extractWikilinksFromValue(value);
    for (const target of wikilinks) {
      frontmatterRefs.set(normalizeRef(target), { field, target });
    }
    // Also check if plain string values match entities
    if (typeof value === 'string' && !isWikilinkValue(value)) {
      const normalized = normalizeRef(value);
      if (index.entities.has(normalized)) {
        frontmatterRefs.set(normalized, { field, target: value });
      }
    }
    if (Array.isArray(value)) {
      for (const v of value) {
        if (typeof v === 'string' && !isWikilinkValue(v)) {
          const normalized = normalizeRef(v);
          if (index.entities.has(normalized)) {
            frontmatterRefs.set(normalized, { field, target: v });
          }
        }
      }
    }
  }

  // Extract wikilinks from prose
  const proseRefs = new Map<string, { line: number; target: string }>();
  const cleanBody = removeCodeBlocks(body);
  const lines = cleanBody.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    WIKILINK_REGEX.lastIndex = 0;
    let match;
    while ((match = WIKILINK_REGEX.exec(line)) !== null) {
      const target = match[1].trim();
      proseRefs.set(normalizeRef(target), { line: i + 1, target });
    }
  }

  // Classify references
  const frontmatter_only: CrossLayerReference[] = [];
  const prose_only: CrossLayerReference[] = [];
  const consistent: CrossLayerReference[] = [];

  // Check frontmatter refs
  for (const [normalized, { field, target }] of frontmatterRefs) {
    if (proseRefs.has(normalized)) {
      consistent.push({ field, target });
    } else {
      frontmatter_only.push({ field, target });
    }
  }

  // Check prose refs
  for (const [normalized, { line, target }] of proseRefs) {
    if (!frontmatterRefs.has(normalized)) {
      prose_only.push({ pattern: `[[${target}]]`, target, line });
    }
  }

  return {
    path: notePath,
    frontmatter_only,
    prose_only,
    consistent,
  };
}

