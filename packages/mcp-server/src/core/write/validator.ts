/**
 * Input validation and output guardrails for vault mutations
 *
 * Provides three layers of protection:
 * 1. Input validation - detect common input issues (double timestamps, wrong formats)
 * 2. Normalization - auto-fix common issues (non-markdown bullets, duplicate timestamps)
 * 3. Output guardrails - detect corruption before writing (broken tables, orphaned fences)
 */

import type { FormatType } from './types.js';

// ========================================
// Types
// ========================================

export type WarningType =
  | 'double-timestamp'
  | 'wrong-format-hint'
  | 'non-markdown-bullets'
  | 'embedded-heading'
  | 'orphaned-fence';

export type OutputIssueType =
  | 'broken-table'
  | 'orphaned-fence'
  | 'indented-fence'
  | 'broken-blockquote';

export type IssueSeverity = 'error' | 'warning';

export type GuardrailMode = 'warn' | 'strict' | 'off';

export interface ValidationWarning {
  type: WarningType;
  message: string;
  suggestion: string;
}

export interface OutputIssue {
  type: OutputIssueType;
  severity: IssueSeverity;
  message: string;
  line?: number;
}

export interface InputValidationResult {
  isValid: boolean;
  warnings: ValidationWarning[];
}

export interface NormalizationResult {
  content: string;
  normalized: boolean;
  changes: string[];
}

export interface OutputValidationResult {
  valid: boolean;
  issues: OutputIssue[];
}

export interface ValidationOptions {
  validate?: boolean;      // Default: true - check input for issues
  normalize?: boolean;     // Default: true - auto-fix common issues
  guardrails?: GuardrailMode;  // Default: 'warn'
}

// ========================================
// Constants
// ========================================

// Timestamp pattern: **HH:MM** at the start of content
const TIMESTAMP_PATTERN = /^\*\*\d{2}:\d{2}\*\*/;

// Non-markdown bullet patterns
const NON_MARKDOWN_BULLET_PATTERNS = [
  /^[\s]*\u2022/, // • (bullet)
  /^[\s]*\u25E6/, // ◦ (hollow bullet)
  /^[\s]*\u25AA/, // ▪ (small square)
  /^[\s]*\u25AB/, // ▫ (hollow small square)
  /^[\s]*\u2023/, // ‣ (triangular bullet)
  /^[\s]*\u2043/, // ⁃ (hyphen bullet)
];

// Embedded heading pattern (## at line start inside content)
const EMBEDDED_HEADING_PATTERN = /^#{1,6}\s+/m;

// ========================================
// Input Validation
// ========================================

/**
 * Validate input content for common issues.
 * Returns warnings about potential problems that may cause formatting issues.
 */
export function validateInput(
  content: string,
  format: FormatType
): InputValidationResult {
  const warnings: ValidationWarning[] = [];

  // Check for double timestamp (content has timestamp + format is timestamp-bullet)
  if (format === 'timestamp-bullet' && TIMESTAMP_PATTERN.test(content.trim())) {
    warnings.push({
      type: 'double-timestamp',
      message: 'Content already contains a timestamp prefix, and format is timestamp-bullet',
      suggestion: 'Use format: "plain" or "bullet" instead to avoid duplicate timestamps',
    });
  }

  // Check for non-markdown bullets
  const lines = content.split('\n');
  for (const line of lines) {
    for (const pattern of NON_MARKDOWN_BULLET_PATTERNS) {
      if (pattern.test(line)) {
        warnings.push({
          type: 'non-markdown-bullets',
          message: `Non-markdown bullet character detected: "${line.trim().charAt(0)}"`,
          suggestion: 'Use markdown bullets (-) for proper rendering',
        });
        break;
      }
    }
  }

  // Check for embedded headings
  if (EMBEDDED_HEADING_PATTERN.test(content)) {
    warnings.push({
      type: 'embedded-heading',
      message: 'Content contains markdown heading syntax (##)',
      suggestion: 'Use bold (**text**) instead of headings inside list items',
    });
  }

  // Check for orphaned code fences
  const fenceCount = (content.match(/^```/gm) || []).length;
  if (fenceCount % 2 !== 0) {
    warnings.push({
      type: 'orphaned-fence',
      message: 'Odd number of code fence markers (```) detected',
      suggestion: 'Ensure code blocks are properly closed',
    });
  }

  return {
    isValid: warnings.length === 0,
    warnings,
  };
}

// ========================================
// Input Normalization
// ========================================

/**
 * Normalize input content by fixing common issues.
 * Returns the normalized content and a list of changes made.
 */
export function normalizeInput(
  content: string,
  format: FormatType
): NormalizationResult {
  let normalized = content;
  const changes: string[] = [];

  // Strip duplicate timestamp if format is timestamp-bullet and content already has one
  if (format === 'timestamp-bullet' && TIMESTAMP_PATTERN.test(normalized.trim())) {
    normalized = normalized.trim().replace(TIMESTAMP_PATTERN, '').trim();
    changes.push('Removed duplicate timestamp prefix');
  }

  // Replace non-markdown bullets with markdown bullets
  const lines = normalized.split('\n');
  let bulletReplaced = false;
  const normalizedLines = lines.map(line => {
    for (const pattern of NON_MARKDOWN_BULLET_PATTERNS) {
      if (pattern.test(line)) {
        bulletReplaced = true;
        // Replace the non-markdown bullet with a markdown bullet
        // Match the bullet and any following space to avoid double spaces
        return line.replace(/^([\s]*)[•◦▪▫‣⁃]\s*/, '$1- ');
      }
    }
    return line;
  });

  if (bulletReplaced) {
    normalized = normalizedLines.join('\n');
    changes.push('Replaced non-markdown bullets with "-"');
  }

  // Trim excessive whitespace
  const trimmed = normalized.replace(/\n{3,}/g, '\n\n');
  if (trimmed !== normalized) {
    normalized = trimmed;
    changes.push('Trimmed excessive blank lines');
  }

  // Fix multi-line wikilinks: [[text\n...\n...]] → [[text ...]]
  const multiLineWikilink = /\[\[([^\]]*\n[^\]]*)\]\]/g;
  if (multiLineWikilink.test(normalized)) {
    normalized = normalized.replace(multiLineWikilink, (_match, inner: string) => {
      return '[[' + inner.replace(/\s*\n\s*/g, ' ').trim() + ']]';
    });
    changes.push('Fixed multi-line wikilinks');
  }

  return {
    content: normalized,
    normalized: changes.length > 0,
    changes,
  };
}

// ========================================
// Output Guardrails
// ========================================

/**
 * Validate output content before writing to file.
 * Detects corruption patterns that would break markdown rendering.
 */
export function validateOutput(formatted: string): OutputValidationResult {
  const issues: OutputIssue[] = [];

  // Check for broken table alignment
  const tableRows = formatted.match(/^\s*\|.*\|/gm);
  if (tableRows && tableRows.length > 1) {
    const pipeCounts = tableRows.map(row => (row.match(/\|/g) || []).length);
    const firstPipeCount = pipeCounts[0];
    const hasInconsistentPipes = pipeCounts.some(count => count !== firstPipeCount);

    if (hasInconsistentPipes) {
      issues.push({
        type: 'broken-table',
        severity: 'error',
        message: 'Table rows have inconsistent pipe counts - table alignment may be broken',
      });
    }
  }

  // Check for orphaned code fences
  const fenceCount = (formatted.match(/^```/gm) || []).length;
  if (fenceCount % 2 !== 0) {
    issues.push({
      type: 'orphaned-fence',
      severity: 'error',
      message: 'Odd number of code fence markers - code block may be unclosed',
    });
  }

  // Check for accidentally indented code fences
  const indentedFences = formatted.match(/^[ \t]+```/gm);
  if (indentedFences && indentedFences.length > 0) {
    // Find the line numbers
    const lines = formatted.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/^[ \t]+```/.test(lines[i])) {
        issues.push({
          type: 'indented-fence',
          severity: 'warning',
          message: 'Code fence marker is indented - this may break the code block',
          line: i + 1,
        });
      }
    }
  }

  // Check for broken blockquotes (> followed by inconsistent structure)
  const blockquoteLines = formatted.match(/^[ \t]*>/gm);
  if (blockquoteLines) {
    // Check for lines that look like they should be blockquotes but aren't
    const lines = formatted.split('\n');
    let inBlockquote = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isBlockquoteLine = /^[ \t]*>/.test(line);

      if (isBlockquoteLine) {
        inBlockquote = true;
      } else if (inBlockquote && line.trim() !== '' && !/^[ \t]*>/.test(line)) {
        // Line after blockquote that isn't empty and doesn't continue the quote
        // This could be intentional, so only warn if the line looks like it should be indented
        if (/^[ \t]+[^-*>\d]/.test(line)) {
          issues.push({
            type: 'broken-blockquote',
            severity: 'warning',
            message: 'Blockquote structure may be broken - continuation line not prefixed with >',
            line: i + 1,
          });
        }
        inBlockquote = false;
      } else if (line.trim() === '') {
        inBlockquote = false;
      }
    }
  }

  return {
    valid: issues.filter(i => i.severity === 'error').length === 0,
    issues,
  };
}

// ========================================
// Combined Validation Pipeline
// ========================================

export interface PipelineResult {
  content: string;
  inputWarnings: ValidationWarning[];
  outputIssues: OutputIssue[];
  normalizationChanges: string[];
  blocked: boolean;
  blockReason?: string;
}

/**
 * Run the full validation pipeline on content.
 *
 * @param content - The content to validate and optionally normalize
 * @param format - The format type being applied
 * @param options - Validation options
 * @returns Pipeline result with processed content and any warnings/issues
 */
export function runValidationPipeline(
  content: string,
  format: FormatType,
  options: ValidationOptions = {}
): PipelineResult {
  const {
    validate = true,
    normalize = true,
    guardrails = 'warn',
  } = options;

  let processedContent = content;
  let inputWarnings: ValidationWarning[] = [];
  let normalizationChanges: string[] = [];
  let outputIssues: OutputIssue[] = [];
  let blocked = false;
  let blockReason: string | undefined;

  // Step 1: Input validation
  if (validate) {
    const inputResult = validateInput(content, format);
    inputWarnings = inputResult.warnings;
  }

  // Step 2: Normalization
  if (normalize) {
    const normResult = normalizeInput(processedContent, format);
    processedContent = normResult.content;
    normalizationChanges = normResult.changes;
  }

  // Step 3: Output guardrails (run on the processed content)
  if (guardrails !== 'off') {
    const outputResult = validateOutput(processedContent);
    outputIssues = outputResult.issues;

    if (guardrails === 'strict' && !outputResult.valid) {
      blocked = true;
      const errors = outputIssues.filter(i => i.severity === 'error');
      blockReason = `Output validation failed: ${errors.map(e => e.message).join('; ')}`;
    }
  }

  return {
    content: processedContent,
    inputWarnings,
    outputIssues,
    normalizationChanges,
    blocked,
    blockReason,
  };
}
