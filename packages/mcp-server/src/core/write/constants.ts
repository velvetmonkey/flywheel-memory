/**
 * Shared constants for Flywheel Memory
 */

export const DEFAULT_AUTO_COMMIT = false;
export const DEFAULT_COMMIT_MESSAGE_PREFIX = '[Flywheel]';

/**
 * Valid markdown heading markers
 */
export const HEADING_REGEX = /^(#{1,6})\s+(.+)$/;

/**
 * Task checkbox patterns
 */
export const TASK_CHECKBOX_REGEX = /^(\s*)-\s+\[([ xX-])\]\s+(.*)$/;

/**
 * Estimate token count from a string or object.
 * Uses the rough approximation of ~4 characters per token.
 * This is an estimate for cost tracking, not an exact count.
 *
 * @param content - String or object to estimate
 * @returns Estimated token count (rounded up)
 */
export function estimateTokens(content: string | object): number {
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  // Claude tokenization averages ~4 chars per token for English text
  // We round up to be conservative in estimates
  return Math.ceil(str.length / 4);
}
