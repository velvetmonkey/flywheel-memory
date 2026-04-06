/**
 * ReDoS (Regular Expression Denial of Service) protection utilities.
 *
 * Validates user-provided regex patterns against known dangerous constructs
 * and provides safe wrappers for regex operations.
 */

/**
 * Patterns that indicate potentially dangerous regex (ReDoS vectors)
 *
 * Dangerous patterns that can cause exponential backtracking:
 * - Nested quantifiers: (a+)+ or (a*)*
 * - Overlapping alternations with quantifiers: (a|a)+
 * - Quantifiers on groups with repetition: (.+)+
 */
const REDOS_PATTERNS = [
  // Nested quantifiers: (a+)+, (a*)+, (a+)*, (a*)*, etc.
  /(\([^)]*[+*][^)]*\))[+*]/,
  // Quantifiers followed by optional same-type quantifiers
  /[+*]\??\s*[+*]/,
  // Overlapping character classes with quantifiers followed by similar
  /\[[^\]]*\][+*].*\[[^\]]*\][+*]/,
  // Multiple adjacent capturing groups with quantifiers
  /(\([^)]+[+*]\)){2,}/,
  // Extremely long alternation groups
  /\([^)]{100,}\)/,
];

/**
 * Maximum length for user-provided regex patterns
 */
const MAX_REGEX_LENGTH = 500;

/**
 * Check if a regex pattern is potentially dangerous (ReDoS vector)
 * @returns Error message if dangerous, null if safe
 */
export function checkRegexSafety(pattern: string): string | null {
  // Length check
  if (pattern.length > MAX_REGEX_LENGTH) {
    return `Regex pattern too long (${pattern.length} chars, max ${MAX_REGEX_LENGTH})`;
  }

  // Check for dangerous patterns
  for (const dangerous of REDOS_PATTERNS) {
    if (dangerous.test(pattern)) {
      return 'Regex pattern may cause performance issues (potential ReDoS). Simplify the pattern or use literal string matching.';
    }
  }

  return null;
}

/**
 * Create a safe regex from a user-provided pattern
 * @throws Error if pattern is dangerous or invalid
 */
export function createSafeRegex(pattern: string, flags?: string): RegExp {
  // Check for ReDoS
  const safetyError = checkRegexSafety(pattern);
  if (safetyError) {
    throw new Error(safetyError);
  }

  // Try to compile the regex
  try {
    return new RegExp(pattern, flags);
  } catch (err) {
    throw new Error(`Invalid regex pattern: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Safely test a pattern against a string
 * Falls back to literal matching if regex fails
 */
export function safeRegexTest(pattern: string, input: string, useRegex: boolean): boolean {
  if (!useRegex) {
    return input.includes(pattern);
  }

  const regex = createSafeRegex(pattern);
  return regex.test(input);
}

/**
 * Safely replace using a pattern
 * Falls back to literal replacement if regex fails
 */
export function safeRegexReplace(
  input: string,
  pattern: string,
  replacement: string,
  useRegex: boolean,
  global: boolean = false
): string {
  if (!useRegex) {
    return global
      ? input.split(pattern).join(replacement)
      : input.replace(pattern, replacement);
  }

  const regex = createSafeRegex(pattern, global ? 'g' : undefined);
  return input.replace(regex, replacement);
}
