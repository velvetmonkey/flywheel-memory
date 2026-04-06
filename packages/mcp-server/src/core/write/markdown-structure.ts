/**
 * Markdown structural analysis and manipulation utilities.
 *
 * Heading extraction, section finding, content formatting,
 * list indentation detection, and section insertion.
 */

import { HEADING_REGEX } from './constants.js';
import type { FormatType, Position, InsertionOptions } from './types.js';

/**
 * Patterns for detecting empty placeholder lines in templates
 * These are format lines that should be replaced rather than appended after
 */
const EMPTY_PLACEHOLDER_PATTERNS = [
  /^\d+\.\s*$/,           // "1. " or "2. " (numbered list placeholder)
  /^-\s*$/,               // "- " (bullet placeholder)
  /^-\s*\[\s*\]\s*$/,     // "- [ ] " (empty task placeholder)
  /^-\s*\[x\]\s*$/i,      // "- [x] " (completed task placeholder)
  /^\*\s*$/,              // "* " (asterisk bullet placeholder)
];

/**
 * Check if a line is an empty format placeholder that should be replaced
 */
export function isEmptyPlaceholder(line: string): boolean {
  const trimmed = line.trim();
  return EMPTY_PLACEHOLDER_PATTERNS.some(p => p.test(trimmed));
}

export interface Heading {
  level: number;
  text: string;
  line: number;
}

export interface SectionBoundary {
  name: string;
  level: number;
  startLine: number;
  endLine: number;
  contentStartLine: number;
}

/**
 * Extract all headings from markdown content
 */
export function extractHeadings(content: string): Heading[] {
  const lines = content.split('\n');
  const headings: Heading[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track code block boundaries
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    // Skip lines inside code blocks
    if (inCodeBlock) continue;

    // Match heading pattern
    const match = line.match(HEADING_REGEX);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        line: i,
      });
    }
  }

  return headings;
}

/**
 * Find section boundaries by heading name (case-insensitive)
 * Section ends at the next heading of equal or higher level
 */
export function findSection(content: string, sectionName: string): SectionBoundary | null {
  const headings = extractHeadings(content);
  const lines = content.split('\n');

  // Normalize section name (remove # prefix if present)
  const normalizedSearch = sectionName.replace(/^#+\s*/, '').trim().toLowerCase();

  // Find the target heading
  const headingIndex = headings.findIndex(
    (h) => h.text.toLowerCase() === normalizedSearch
  );

  if (headingIndex === -1) return null;

  const targetHeading = headings[headingIndex];
  const startLine = targetHeading.line;
  const contentStartLine = startLine + 1;

  // Find where section ends (next heading of same or higher level)
  let endLine = lines.length - 1;
  for (let i = headingIndex + 1; i < headings.length; i++) {
    if (headings[i].level <= targetHeading.level) {
      endLine = headings[i].line - 1;
      break;
    }
  }

  return {
    name: targetHeading.text,
    level: targetHeading.level,
    startLine,
    endLine,
    contentStartLine,
  };
}

/**
 * Check if we're inside a code block at the given line index.
 * Counts code fence markers (```) before the current line.
 * An odd count means we're inside a code block.
 */
export function isInsideCodeBlock(lines: string[], currentIndex: number): boolean {
  let fenceCount = 0;
  for (let i = 0; i < currentIndex; i++) {
    if (lines[i].trim().startsWith('```')) {
      fenceCount++;
    }
  }
  return fenceCount % 2 === 1;
}

/**
 * Detect lines that represent structured markdown elements that shouldn't be indented.
 * These include:
 * - Table rows (starting with |)
 * - Blockquotes (starting with >)
 * - Code fence markers (```)
 * - Horizontal rules (---, ***, ___)
 */
export function isStructuredLine(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith('|') ||           // Table row
    trimmed.startsWith('>') ||           // Blockquote
    trimmed.startsWith('```') ||         // Code fence
    /^-{3,}$/.test(trimmed) ||           // Horizontal rule (dashes)
    /^\*{3,}$/.test(trimmed) ||          // Horizontal rule (asterisks)
    /^_{3,}$/.test(trimmed)              // Horizontal rule (underscores)
  );
}

/**
 * Check if a line is a code fence marker (```)
 */
export function isCodeFenceLine(line: string): boolean {
  return line.trim().startsWith('```');
}

/**
 * Check if content is already a pre-formatted markdown list.
 * Returns true if the first non-empty line starts with a list marker.
 * This prevents double-wrapping when content is already structured.
 */
export function isPreformattedList(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  const firstLine = trimmed.split('\n')[0];
  // Check for bullet (-, *, +), numbered (1.), or task list (- [ ])
  return /^[-*+]\s/.test(firstLine) ||           // Bullet
         /^\d+\.\s/.test(firstLine) ||            // Numbered
         /^[-*+]\s*\[[ xX]\]/.test(firstLine);    // Task
}

/**
 * Sanitize content that will be placed inside a markdown list item.
 * Converts structural markdown elements that break list parsing into
 * list-safe equivalents:
 * - `### Heading` -> `**Heading**` (bold, not structural)
 * - `* item` -> `- item` (normalize bullet style)
 * - `---` horizontal rules -> em-dash separator
 *
 * Code blocks are preserved as-is (content inside fences is not touched).
 */
export function sanitizeForList(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }
    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    // Convert markdown headings to bold text
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      result.push(`**${headingMatch[2]}**`);
      continue;
    }

    // Convert * bullets to - bullets for consistency
    const starBulletMatch = line.match(/^(\s*)\*\s(.+)$/);
    if (starBulletMatch) {
      result.push(`${starBulletMatch[1]}- ${starBulletMatch[2]}`);
      continue;
    }

    // Convert horizontal rules to em-dash separators
    if (/^-{3,}$/.test(line.trim()) || /^\*{3,}$/.test(line.trim()) || /^_{3,}$/.test(line.trim())) {
      result.push('\u2014');
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}

/**
 * Format content according to format type.
 *
 * For multi-line content, continuation lines are indented to align under
 * the parent bullet/task/number text, ensuring proper markdown rendering.
 * Empty lines are preserved as empty (not indented).
 *
 * Block-aware: Code blocks, tables, blockquotes, and horizontal rules
 * are preserved as-is without indentation to maintain their structure.
 */
export function formatContent(content: string, format: FormatType): string {
  const trimmed = content.trim();

  // Handle empty/whitespace-only content
  if (trimmed === '') {
    switch (format) {
      case 'plain':
        return '';
      case 'bullet':
        return '-';
      case 'task':
        return '- [ ]';
      case 'numbered':
        return '1.';
      case 'timestamp-bullet':
        return `- ${new Date().toTimeString().slice(0, 5)}`;
      default:
        return '';
    }
  }

  switch (format) {
    case 'plain':
      return trimmed;
    case 'bullet': {
      // If content is already a list, preserve it as-is
      if (isPreformattedList(trimmed)) {
        return sanitizeForList(trimmed);
      }
      // Sanitize structural elements that break list parsing (headings -> bold, * -> -)
      const sanitized = sanitizeForList(trimmed);
      const lines = sanitized.split('\n');
      let inCodeBlock = false;
      return lines.map((line, i) => {
        if (isCodeFenceLine(line)) inCodeBlock = !inCodeBlock;
        if (i === 0) return `- ${line}`;
        // Blank lines with only whitespace get stripped by Obsidian, breaking list nesting.
        // Use an invisible HTML comment outside code blocks to keep the line non-empty.
        if (line === '') return inCodeBlock ? '  ' : '  <!-- -->';
        return `  ${line}`;
      }).join('\n');
    }
    case 'task': {
      // If content is already a list, preserve it as-is
      if (isPreformattedList(trimmed)) {
        return trimmed;
      }
      // Indent continuation lines with 6 spaces to align under "- [ ] " text
      const lines = trimmed.split('\n');
      let inCodeBlock = false;
      return lines.map((line, i) => {
        if (isCodeFenceLine(line)) inCodeBlock = !inCodeBlock;
        if (i === 0) return `- [ ] ${line}`;
        if (line === '') return inCodeBlock ? '      ' : '      <!-- -->';
        return `      ${line}`;
      }).join('\n');
    }
    case 'numbered': {
      // If content is already a list, preserve it as-is
      if (isPreformattedList(trimmed)) {
        return trimmed;
      }
      // Indent continuation lines with 3 spaces to align under "1. " text
      const lines = trimmed.split('\n');
      let inCodeBlock = false;
      return lines.map((line, i) => {
        if (isCodeFenceLine(line)) inCodeBlock = !inCodeBlock;
        if (i === 0) return `1. ${line}`;
        if (line === '') return inCodeBlock ? '   ' : '   <!-- -->';
        return `   ${line}`;
      }).join('\n');
    }
    case 'timestamp-bullet': {
      // If content is already a list, preserve it as-is
      if (isPreformattedList(trimmed)) {
        return sanitizeForList(trimmed);
      }
      // Sanitize structural elements that break list parsing (headings -> bold, * -> -)
      const sanitized = sanitizeForList(trimmed);
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const prefix = `- **${hours}:${minutes}** `;
      const lines = sanitized.split('\n');
      // Indent continuation lines to align under the text after "- "
      // Preserve structured blocks (code, tables, blockquotes) as-is
      const indent = '  ';
      let inCodeBlock = false;
      return lines.map((line, i) => {
        if (isCodeFenceLine(line)) inCodeBlock = !inCodeBlock;
        if (i === 0) return `${prefix}${line}`;
        if (line === '') return inCodeBlock ? indent : `${indent}<!-- -->`;
        return `${indent}${line}`;
      }).join('\n');
    }
    default:
      return trimmed;
  }
}

/**
 * Detect the base indentation level for a section.
 * Returns the indentation string (spaces) of the first list item in the section,
 * which represents the "top level" for that section.
 *
 * This should be used when appending new entries to ensure they're added at
 * the section's base level, not nested inside existing sublists.
 */
export function detectSectionBaseIndentation(
  lines: string[],
  sectionStartLine: number,
  sectionEndLine: number
): string {
  // Clamp endLine to array bounds (array may have been modified by splicing)
  const maxEndLine = Math.min(sectionEndLine, lines.length - 1);

  // Look forward to find the first list item in the section
  for (let i = sectionStartLine; i <= maxEndLine; i++) {
    const line = lines[i];
    if (line === undefined) continue; // Safety check
    const trimmed = line.trim();

    // Skip empty lines
    if (trimmed === '') continue;

    // Check if this is a list item (bullet, numbered, or task)
    const listMatch = line.match(/^(\s*)[-*+]\s|^(\s*)\d+\.\s|^(\s*)[-*+]\s*\[[ xX]\]/);
    if (listMatch) {
      // Found the first list item - return its indentation as the base
      const indent = listMatch[1] || listMatch[2] || listMatch[3] || '';
      return indent;
    }

    // If we hit a heading (not the section heading itself), stop searching
    if (i > sectionStartLine && trimmed.match(/^#+\s/)) {
      break;
    }
  }

  return ''; // No list context found, use no indentation
}

/**
 * Detect the indentation level of the list context at a given line.
 * Returns the indentation string (spaces) that should be used for content
 * being inserted at this position to match the surrounding list structure.
 *
 * Walks backward from the insertion point to find the most recent list item,
 * then determines if we're inserting at the same level or nested.
 *
 * NOTE: This function is suitable for continuing a nested list. For adding
 * new top-level entries to a section, use detectSectionBaseIndentation instead.
 */
export function detectListIndentation(
  lines: string[],
  insertLineIndex: number,
  sectionStartLine: number
): string {
  // Walk backward to find the most recent list item
  for (let i = insertLineIndex - 1; i >= sectionStartLine; i--) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (trimmed === '') continue;

    // Check if this is a list item (bullet, numbered, or task)
    const listMatch = line.match(/^(\s*)[-*+]\s|^(\s*)\d+\.\s|^(\s*)[-*+]\s*\[[ xX]\]/);
    if (listMatch) {
      // Found a list item - return its indentation
      // This ensures new content starts at the same level as existing list items
      const indent = listMatch[1] || listMatch[2] || listMatch[3] || '';
      return indent;
    }

    // If we hit a heading, stop searching
    if (trimmed.match(/^#+\s/)) {
      break;
    }

    // If we hit non-list content (like indented text under a list item),
    // continue searching backward for the parent list item
  }

  return ''; // No list context found, use no indentation
}

/**
 * Bump heading levels in content so they nest under a parent heading.
 *
 * Algorithm:
 * 1. Find the minimum heading level in content (ignoring code blocks)
 * 2. Calculate bump = parentLevel + 1 - minLevel
 * 3. If bump <= 0 or no headings found, return content unchanged
 * 4. Add bump additional # characters to each heading line (cap at 6)
 */
export function bumpHeadingLevels(content: string, parentLevel: number): string {
  const lines = content.split('\n');
  let inCodeBlock = false;
  let minLevel = Infinity;

  // First pass: find minimum heading level (outside code blocks)
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = line.match(HEADING_REGEX);
    if (match) {
      const level = match[1].length;
      if (level < minLevel) {
        minLevel = level;
      }
    }
  }

  // No headings found or already nested correctly
  if (minLevel === Infinity) return content;

  const bump = parentLevel + 1 - minLevel;
  if (bump <= 0) return content;

  // Second pass: bump heading levels
  inCodeBlock = false;
  const result = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inCodeBlock = !inCodeBlock;
      return line;
    }
    if (inCodeBlock) return line;

    const match = line.match(HEADING_REGEX);
    if (match) {
      const newLevel = Math.min(match[1].length + bump, 6);
      return '#'.repeat(newLevel) + ' ' + match[2];
    }
    return line;
  });

  return result.join('\n');
}

/**
 * Insert content into a section at the specified position
 *
 * Smart template handling: When appending, if the last content line is an
 * empty placeholder (like "1. " or "- "), replace it instead of appending after.
 *
 * When preserveListNesting is true, the function will detect the indentation
 * level of the surrounding list and apply it to the inserted content.
 */
export function insertInSection(
  content: string,
  section: SectionBoundary,
  newContent: string,
  position: Position,
  options?: InsertionOptions
): string {
  const lines = content.split('\n');
  let formattedContent = newContent.trim();

  // Bump heading levels so inserted headings nest under the parent section
  if (options?.bumpHeadings !== false) {
    formattedContent = bumpHeadingLevels(formattedContent, section.level);
  }

  if (position === 'prepend') {
    // Insert right after the heading
    // If preserveListNesting is enabled, use section base indentation for consistency
    if (options?.preserveListNesting) {
      // Use the same detection as append to ensure consistent indentation
      const indent = detectSectionBaseIndentation(lines, section.contentStartLine, section.endLine);

      if (indent) {
        const contentLines = formattedContent.split('\n');
        const indentedContent = contentLines
          .map((line) => {
            if (line === '') return indent || line;  // Carry indent on blank lines to preserve list nesting
            return indent + line;
          })
          .join('\n');
        lines.splice(section.contentStartLine, 0, indentedContent);
      } else {
        lines.splice(section.contentStartLine, 0, formattedContent);
      }
    } else {
      lines.splice(section.contentStartLine, 0, formattedContent);
    }
  } else {
    // Append at end of section
    // First, check if the last non-empty line in the section is a placeholder
    let lastContentLineIdx = -1;
    for (let i = section.endLine; i >= section.contentStartLine; i--) {
      if (lines[i].trim() !== '') {
        lastContentLineIdx = i;
        break;
      }
    }

    // Check if last content line is an empty placeholder to replace
    if (lastContentLineIdx >= section.contentStartLine && isEmptyPlaceholder(lines[lastContentLineIdx])) {
      // Replace the placeholder with the new content
      // Apply section base indentation if preserveListNesting is enabled
      if (options?.preserveListNesting) {
        const indent = detectSectionBaseIndentation(lines, section.contentStartLine, section.endLine);
        const contentLines = formattedContent.split('\n');
        const indentedContent = contentLines
          .map((line) => {
            if (line === '') return indent || line;  // Carry indent on blank lines to preserve list nesting
            return indent + line;
          })
          .join('\n');
        lines[lastContentLineIdx] = indentedContent;
      } else {
        lines[lastContentLineIdx] = formattedContent;
      }
    } else {
      // Normal append behavior - insert after last non-blank line to avoid
      // accumulating blank lines between entries
      let insertLine: number;

      if (lastContentLineIdx >= section.contentStartLine) {
        // Remove any trailing blank lines within the section before inserting
        // This prevents blank lines from accumulating between entries across
        // read/write cycles (e.g., with gray-matter)
        for (let i = section.endLine; i > lastContentLineIdx; i--) {
          if (lines[i].trim() === '') {
            lines.splice(i, 1);
          }
        }
        // Insert right after the last non-blank content line
        insertLine = lastContentLineIdx + 1;
      } else {
        // Empty section (no non-blank content), add right after heading
        insertLine = section.contentStartLine;
      }

      // Apply section base indentation if preserveListNesting is enabled
      // Use section base (first list item) to add new top-level entries,
      // not the last item's indentation which could be nested
      if (options?.preserveListNesting) {
        const indent = detectSectionBaseIndentation(lines, section.contentStartLine, section.endLine);
        const contentLines = formattedContent.split('\n');
        const indentedContent = contentLines
          .map((line) => {
            if (line === '') return indent || line;  // Carry indent on blank lines to preserve list nesting
            return indent + line;
          })
          .join('\n');
        lines.splice(insertLine, 0, indentedContent);
      } else {
        lines.splice(insertLine, 0, formattedContent);
      }
    }
  }

  return lines.join('\n');
}
