/**
 * Computed Frontmatter Tools
 *
 * Auto-compute derived fields from note content.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import matter from 'gray-matter';
import type { VaultIndex } from '../../core/read/types.js';

// =============================================================================
// TYPES
// =============================================================================

/** A computed field result */
export interface ComputedField {
  name: string;
  value: unknown;
  method: string;              // How it was computed
  already_exists: boolean;     // If frontmatter already has this field
  differs: boolean | null;     // If computed value differs from existing
}

/** Result of computing frontmatter */
export interface ComputedFrontmatterResult {
  path: string;
  computed: ComputedField[];
  suggested_additions: Record<string, unknown>;  // Ready-to-add YAML
  error?: string;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Read file content
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
 * Get file stats
 */
async function getFileStats(
  notePath: string,
  vaultPath: string
): Promise<{ modified: Date; created: Date } | null> {
  const fullPath = path.join(vaultPath, notePath);
  try {
    const stats = await fs.stat(fullPath);
    return {
      modified: stats.mtime,
      created: stats.birthtime,
    };
  } catch {
    return null;
  }
}

/**
 * Count words in text (excluding code blocks and frontmatter)
 */
function countWords(text: string): number {
  // Remove code blocks
  let clean = text.replace(/```[\s\S]*?```/g, '');
  clean = clean.replace(/`[^`\n]+`/g, '');

  // Remove wikilinks syntax but keep the text
  clean = clean.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias || target);

  // Remove markdown syntax
  clean = clean.replace(/[#*_~`]/g, '');

  // Split and count non-empty words
  const words = clean.split(/\s+/).filter(w => w.length > 0);
  return words.length;
}

/**
 * Format date as ISO string (YYYY-MM-DD)
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Calculate reading time in minutes
 */
function calculateReadingTime(wordCount: number): string {
  const minutes = Math.ceil(wordCount / 200);
  return `${minutes} min`;
}

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/** Available computed fields */
const COMPUTABLE_FIELDS = [
  'word_count',
  'link_count',
  'backlink_count',
  'tag_count',
  'reading_time',
  'created',
  'last_updated',
] as const;

type ComputableField = typeof COMPUTABLE_FIELDS[number];

/**
 * Compute frontmatter fields for a note
 */
export async function computeFrontmatter(
  index: VaultIndex,
  notePath: string,
  vaultPath: string,
  fields?: string[]
): Promise<ComputedFrontmatterResult> {
  const content = await readFileContent(notePath, vaultPath);

  if (content === null) {
    return {
      path: notePath,
      computed: [],
      suggested_additions: {},
      error: 'File not found',
    };
  }

  // Parse existing frontmatter
  let existingFrontmatter: Record<string, unknown> = {};
  let body = content;
  try {
    const parsed = matter(content);
    existingFrontmatter = parsed.data as Record<string, unknown>;
    body = parsed.content;
  } catch {
    // No valid frontmatter
  }

  // Get note from index
  const note = index.notes.get(notePath);

  // Get file stats
  const stats = await getFileStats(notePath, vaultPath);

  // Determine which fields to compute
  const fieldsToCompute = fields
    ? fields.filter(f => COMPUTABLE_FIELDS.includes(f as ComputableField))
    : [...COMPUTABLE_FIELDS];

  const computed: ComputedField[] = [];
  const suggestedAdditions: Record<string, unknown> = {};

  for (const fieldName of fieldsToCompute) {
    let value: unknown = null;
    let method = '';

    switch (fieldName) {
      case 'word_count': {
        value = countWords(body);
        method = 'prose_word_count';
        break;
      }

      case 'link_count': {
        value = note?.outlinks.length ?? 0;
        method = 'outlink_count';
        break;
      }

      case 'backlink_count': {
        const backlinks = index.backlinks.get(note?.title.toLowerCase() ?? '');
        value = backlinks?.length ?? 0;
        method = 'backlink_index';
        break;
      }

      case 'tag_count': {
        value = note?.tags.length ?? 0;
        method = 'tag_count';
        break;
      }

      case 'reading_time': {
        const words = countWords(body);
        value = calculateReadingTime(words);
        method = 'word_count / 200';
        break;
      }

      case 'created': {
        if (stats?.created) {
          value = formatDate(stats.created);
          method = 'file_birthtime';
        }
        break;
      }

      case 'last_updated': {
        if (stats?.modified) {
          value = formatDate(stats.modified);
          method = 'file_mtime';
        }
        break;
      }
    }

    if (value !== null) {
      const existingValue = existingFrontmatter[fieldName];
      const alreadyExists = existingValue !== undefined;
      let differs: boolean | null = null;

      if (alreadyExists) {
        differs = JSON.stringify(existingValue) !== JSON.stringify(value);
      }

      computed.push({
        name: fieldName,
        value,
        method,
        already_exists: alreadyExists,
        differs,
      });

      // Only suggest adding if doesn't exist
      if (!alreadyExists) {
        suggestedAdditions[fieldName] = value;
      }
    }
  }

  return {
    path: notePath,
    computed,
    suggested_additions: suggestedAdditions,
  };
}

