/**
 * Line ending detection, normalization, and conversion utilities.
 */

/**
 * Line ending types
 */
export type LineEnding = 'LF' | 'CRLF';

/**
 * Detect the line ending style used in content.
 * Returns 'CRLF' if Windows-style line endings are detected, 'LF' otherwise.
 */
export function detectLineEnding(content: string): LineEnding {
  // Count occurrences of each line ending type
  const crlfCount = (content.match(/\r\n/g) || []).length;
  const lfCount = (content.match(/(?<!\r)\n/g) || []).length;

  // If CRLF appears more frequently, treat as Windows file
  return crlfCount > lfCount ? 'CRLF' : 'LF';
}

/**
 * Normalize line endings to LF for internal processing.
 */
export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

/**
 * Convert line endings to the specified style.
 */
export function convertLineEndings(content: string, style: LineEnding): string {
  // First normalize to LF, then convert if needed
  const normalized = content.replace(/\r\n/g, '\n');
  return style === 'CRLF' ? normalized.replace(/\n/g, '\r\n') : normalized;
}

/**
 * Ensure content ends with exactly one newline.
 */
export function normalizeTrailingNewline(content: string): string {
  // Remove all trailing whitespace/newlines, then add exactly one
  return content.replace(/[\r\n\s]+$/, '') + '\n';
}
