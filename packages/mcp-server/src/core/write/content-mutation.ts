/**
 * Content mutation utilities for section-scoped operations.
 *
 * Remove, replace, and diagnostic support for vault section mutations.
 */

import type { SectionBoundary } from './markdown-structure.js';
import type { ScopingMetadata, ScopingFrontmatter } from './types.js';
import { safeRegexTest, safeRegexReplace, createSafeRegex } from './regex-safety.js';
import { levenshteinDistance } from '../shared/levenshtein.js';

export type MatchMode = 'first' | 'last' | 'all';

export interface RemoveResult {
  content: string;
  removedCount: number;
  removedLines: string[];
}

/**
 * Remove content from a section matching a pattern
 */
export function removeFromSection(
  content: string,
  section: SectionBoundary,
  pattern: string,
  mode: MatchMode = 'first',
  useRegex: boolean = false
): RemoveResult {
  const lines = content.split('\n');
  const removedLines: string[] = [];
  const indicesToRemove: number[] = [];

  // Search within section bounds
  for (let i = section.contentStartLine; i <= section.endLine; i++) {
    const line = lines[i];
    const matches = safeRegexTest(pattern, line, useRegex);

    if (matches) {
      indicesToRemove.push(i);
      removedLines.push(line);

      if (mode === 'first') break;
    }
  }

  // If mode is 'last', only keep the last match
  if (mode === 'last' && indicesToRemove.length > 1) {
    const lastIndex = indicesToRemove[indicesToRemove.length - 1];
    const lastLine = removedLines[removedLines.length - 1];
    indicesToRemove.length = 0;
    removedLines.length = 0;
    indicesToRemove.push(lastIndex);
    removedLines.push(lastLine);
  }

  // Remove lines in reverse order to maintain correct indices
  const sortedIndices = [...indicesToRemove].sort((a, b) => b - a);
  for (const idx of sortedIndices) {
    lines.splice(idx, 1);
  }

  return {
    content: lines.join('\n'),
    removedCount: indicesToRemove.length,
    removedLines,
  };
}

export interface ReplaceResult {
  content: string;
  replacedCount: number;
  originalLines: string[];
  newLines: string[];
}

/**
 * Replace content in a section matching a pattern.
 * Supports multi-line search strings (containing \n) by operating on the
 * joined section text instead of line-by-line.
 */
export function replaceInSection(
  content: string,
  section: SectionBoundary,
  search: string,
  replacement: string,
  mode: MatchMode = 'first',
  useRegex: boolean = false
): ReplaceResult {
  const lines = content.split('\n');

  // Multi-line path: when the search string contains newlines, we must
  // match against the joined section text rather than individual lines.
  if (search.includes('\n')) {
    const sectionLines = lines.slice(section.contentStartLine, section.endLine + 1);
    const sectionText = sectionLines.join('\n');
    const originalLines: string[] = [];
    const newLines: string[] = [];

    let newSectionText: string;
    let replacedCount: number;

    if (useRegex) {
      // Regex mode: use global regex to find all matches, then select by mode
      const globalRegex = createSafeRegex(search, 'g');
      const matches: Array<{ index: number; match: string }> = [];
      let m: RegExpExecArray | null;
      while ((m = globalRegex.exec(sectionText)) !== null) {
        matches.push({ index: m.index, match: m[0] });
        // Prevent infinite loops on zero-length matches
        if (m[0].length === 0) globalRegex.lastIndex++;
      }

      if (matches.length === 0) {
        return { content, replacedCount: 0, originalLines: [], newLines: [] };
      }

      let selectedMatches: Array<{ index: number; match: string }>;
      if (mode === 'first') {
        selectedMatches = [matches[0]];
      } else if (mode === 'last') {
        selectedMatches = [matches[matches.length - 1]];
      } else {
        selectedMatches = matches;
      }

      // Build new section text by replacing selected matches (process in reverse to preserve indices)
      newSectionText = sectionText;
      for (let i = selectedMatches.length - 1; i >= 0; i--) {
        const sm = selectedMatches[i];
        const replacedText = sm.match.replace(createSafeRegex(search), replacement);
        originalLines.unshift(sm.match);
        newLines.unshift(replacedText);
        newSectionText =
          newSectionText.slice(0, sm.index) +
          replacedText +
          newSectionText.slice(sm.index + sm.match.length);
      }
      replacedCount = selectedMatches.length;
    } else {
      // Literal mode: use indexOf to find all occurrences
      const occurrences: number[] = [];
      let startPos = 0;
      while (true) {
        const idx = sectionText.indexOf(search, startPos);
        if (idx === -1) break;
        occurrences.push(idx);
        startPos = idx + search.length;
      }

      if (occurrences.length === 0) {
        return { content, replacedCount: 0, originalLines: [], newLines: [] };
      }

      let selectedIndices: number[];
      if (mode === 'first') {
        selectedIndices = [occurrences[0]];
      } else if (mode === 'last') {
        selectedIndices = [occurrences[occurrences.length - 1]];
      } else {
        selectedIndices = occurrences;
      }

      // Build new section text by replacing selected occurrences (process in reverse to preserve indices)
      newSectionText = sectionText;
      for (let i = selectedIndices.length - 1; i >= 0; i--) {
        const idx = selectedIndices[i];
        const matched = sectionText.slice(idx, idx + search.length);
        originalLines.unshift(matched);
        newLines.unshift(replacement);
        newSectionText =
          newSectionText.slice(0, idx) +
          replacement +
          newSectionText.slice(idx + search.length);
      }
      replacedCount = selectedIndices.length;
    }

    // Splice the new section lines back into the full document
    const newSectionLines = newSectionText.split('\n');
    lines.splice(
      section.contentStartLine,
      section.endLine - section.contentStartLine + 1,
      ...newSectionLines
    );

    return {
      content: lines.join('\n'),
      replacedCount,
      originalLines,
      newLines,
    };
  }

  // Single-line path: original line-by-line matching (unchanged for backwards compatibility)
  const originalLines: string[] = [];
  const newLines: string[] = [];
  const indicesToReplace: number[] = [];

  // Find matching lines within section bounds
  for (let i = section.contentStartLine; i <= section.endLine; i++) {
    const line = lines[i];
    const matches = safeRegexTest(search, line, useRegex);

    if (matches) {
      indicesToReplace.push(i);
      originalLines.push(line);

      if (mode === 'first') break;
    }
  }

  // If mode is 'last', only keep the last match
  if (mode === 'last' && indicesToReplace.length > 1) {
    const lastIndex = indicesToReplace[indicesToReplace.length - 1];
    const lastLine = originalLines[originalLines.length - 1];
    indicesToReplace.length = 0;
    originalLines.length = 0;
    indicesToReplace.push(lastIndex);
    originalLines.push(lastLine);
  }

  // Perform replacements
  for (const idx of indicesToReplace) {
    const originalLine = lines[idx];
    const newLine = safeRegexReplace(originalLine, search, replacement, useRegex, true);

    lines[idx] = newLine;
    newLines.push(newLine);
  }

  return {
    content: lines.join('\n'),
    replacedCount: indicesToReplace.length,
    originalLines,
    newLines,
  };
}

// ========================================
// Diagnostic Error Support
// ========================================

/**
 * Error class that carries structured diagnostic information.
 * Used to provide actionable feedback when mutations fail.
 */
export class DiagnosticError extends Error {
  public diagnostic: Record<string, unknown>;
  constructor(message: string, diagnostic: Record<string, unknown>) {
    super(message);
    this.name = 'DiagnosticError';
    this.diagnostic = diagnostic;
  }
}

/**
 * Build a structured diagnostic for "replace not found" errors.
 * Analyzes the section content to find the closest match and provide suggestions.
 */
export function buildReplaceNotFoundDiagnostic(
  sectionContent: string,
  searchText: string,
  sectionName: string,
  sectionStartLine: number
): Record<string, unknown> {
  const sectionLines = sectionContent.split('\n');
  const sectionLineCount = sectionLines.length;
  const sectionEndLine = sectionStartLine + sectionLineCount - 1;

  // Find closest match via sliding window over section lines
  const searchLines = searchText.split('\n');
  const isMultiLine = searchLines.length > 1;

  let closestMatch: { text: string; distance: number; line: number } | null = null;

  if (!isMultiLine) {
    // Single-line search: compare against each line in section
    for (let i = 0; i < sectionLines.length; i++) {
      const line = sectionLines[i].trim();
      if (line === '') continue;

      const dist = levenshteinDistance(searchText.trim(), line);
      if (closestMatch === null || dist < closestMatch.distance) {
        closestMatch = {
          text: sectionLines[i],
          distance: dist,
          line: sectionStartLine + i,
        };
      }
    }
  } else {
    // Multi-line search: sliding window of searchLines.length over section
    const windowSize = searchLines.length;
    for (let i = 0; i <= sectionLines.length - windowSize; i++) {
      const windowText = sectionLines.slice(i, i + windowSize).join('\n');
      const dist = levenshteinDistance(searchText, windowText);
      if (closestMatch === null || dist < closestMatch.distance) {
        closestMatch = {
          text: windowText,
          distance: dist,
          line: sectionStartLine + i,
        };
      }
    }
  }

  // For multi-line search: analyze per-line matches
  let lineAnalysis: Array<{ lineNumber: number; searchLine: string; found: boolean }> | null = null;
  if (isMultiLine) {
    lineAnalysis = searchLines.map((searchLine, idx) => {
      const trimmedSearch = searchLine.trim();
      const found = sectionLines.some(sl => sl.includes(trimmedSearch));
      return {
        lineNumber: idx + 1,
        searchLine: trimmedSearch,
        found,
      };
    });
  }

  // Build suggestions
  const suggestions: string[] = [];

  if (closestMatch && closestMatch.distance <= Math.max(3, Math.floor(searchText.length * 0.2))) {
    suggestions.push(`Did you mean: "${closestMatch.text.trim()}"?`);
  }

  suggestions.push('Try using useRegex: true for pattern matching');

  if (isMultiLine) {
    suggestions.push('For multi-line content, try breaking into smaller replacements');
  }

  if (searchText !== searchText.trim() || /^\s|\s$/.test(searchText)) {
    suggestions.push('Check for whitespace differences');
  }

  return {
    sectionName,
    sectionLineRange: { start: sectionStartLine, end: sectionEndLine },
    sectionLineCount,
    closestMatch: closestMatch ? {
      text: closestMatch.text,
      distance: closestMatch.distance,
      line: closestMatch.line,
    } : null,
    lineAnalysis,
    suggestions,
  };
}

// ========================================
// AI Agent Memory Helpers
// ========================================

/**
 * Inject mutation metadata into frontmatter for agent scoping and relevance tracking.
 *
 * This function:
 * - Always updates `_last_modified_at` with current ISO timestamp
 * - Always increments `_modification_count`
 * - Injects `_agent_id` and `_session_id` when provided in scoping
 * - Sets `_last_modified_by` to identify the modifier (agent:id or session:id)
 *
 * @param frontmatter - Existing frontmatter object (will be mutated)
 * @param scoping - Optional agent/session scoping metadata
 * @returns The modified frontmatter with injected metadata
 */
export function injectMutationMetadata(
  frontmatter: Record<string, unknown>,
  scoping?: ScopingMetadata
): Record<string, unknown> & ScopingFrontmatter {
  const now = new Date().toISOString();

  // Always update modification timestamp
  frontmatter._last_modified_at = now;

  // Always increment modification count
  const currentCount = typeof frontmatter._modification_count === 'number'
    ? frontmatter._modification_count
    : 0;
  frontmatter._modification_count = currentCount + 1;

  // Handle scoping metadata when provided
  if (scoping) {
    if (scoping.agent_id) {
      frontmatter._agent_id = scoping.agent_id;
    }
    if (scoping.session_id) {
      frontmatter._session_id = scoping.session_id;
    }

    // Mark content as AI-generated
    frontmatter._source = 'ai';

    // Set last_modified_by based on available identifiers
    if (scoping.agent_id && scoping.session_id) {
      frontmatter._last_modified_by = `${scoping.agent_id}:${scoping.session_id}`;
    } else if (scoping.agent_id) {
      frontmatter._last_modified_by = `agent:${scoping.agent_id}`;
    } else if (scoping.session_id) {
      frontmatter._last_modified_by = `session:${scoping.session_id}`;
    }
  }

  return frontmatter as Record<string, unknown> & ScopingFrontmatter;
}
