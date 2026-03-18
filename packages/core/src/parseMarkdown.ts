/**
 * Markdown AST parser for protected zone detection
 *
 * Uses mdast (fromMarkdown) with GFM, frontmatter, and math extensions.
 * Returns null on parse error to trigger regex fallback.
 */

import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import { mathFromMarkdown } from 'mdast-util-math';
import { gfm } from 'micromark-extension-gfm';
import { frontmatter } from 'micromark-extension-frontmatter';
import { math } from 'micromark-extension-math';
import type { Root } from 'mdast';

export interface ParseMarkdownOptions {
  /** Skip AST parsing entirely, return null */
  forceRegex?: boolean;
}

/**
 * Parse markdown content into an AST tree.
 * Returns null on parse error (triggers regex fallback).
 */
export function parseMarkdown(content: string, options?: ParseMarkdownOptions): Root | null {
  if (options?.forceRegex) {
    return null;
  }

  try {
    return fromMarkdown(content, {
      extensions: [gfm(), frontmatter(['yaml']), math()],
      mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(['yaml']), mathFromMarkdown()],
    });
  } catch {
    return null;
  }
}
