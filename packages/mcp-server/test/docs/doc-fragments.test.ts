/**
 * Doc fragment drift contract test.
 *
 * For every target doc file, for every fragment sentinel block present,
 * extract the content between the markers and assert it equals the
 * canonical fragment in DOC_FRAGMENTS.
 *
 * This is the guardrail that prevents hand-edited doc drift: if you edit
 * config.ts (TOOL_CATEGORY, PRESETS, ACTION_PARAM_MAP, etc.) without running
 * `npm run generate:doc-fragments`, this test fails in CI.
 *
 * Sentinels: <!-- GENERATED:<id> START --> ... <!-- GENERATED:<id> END -->
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DOC_FRAGMENTS, DOC_FRAGMENT_IDS } from '../../src/generated/doc-fragments.generated.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '../../../..');

const TARGET_FILES = [
  'README.md',
  'CLAUDE.md',
  'docs/CONFIGURATION.md',
] as const;

interface ExtractedBlock {
  id: string;
  file: string;
  body: string;
}

/**
 * Normalize CRLF → LF. Windows CI checks out with CRLF endings, but the
 * canonical DOC_FRAGMENTS strings are LF-only (written by the generator on
 * Linux). Compare on LF-normalized content so the test is OS-independent.
 */
function normalizeLineEndings(s: string): string {
  return s.replace(/\r\n/g, '\n');
}

/**
 * Extract every GENERATED:<id> block from a file.
 * Uses a loose regex for the id so a stale/renamed id still shows up as a
 * failure (rather than silently passing by being skipped).
 */
function extractBlocks(file: string, content: string): ExtractedBlock[] {
  const re = /<!-- GENERATED:([\w-]+) START -->\n?([\s\S]*?)\n?<!-- GENERATED:\1 END -->/g;
  const blocks: ExtractedBlock[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    blocks.push({ id: m[1], file, body: m[2] });
  }
  return blocks;
}

describe('doc fragment contract', () => {
  const allBlocks: ExtractedBlock[] = [];
  for (const rel of TARGET_FILES) {
    const full = join(REPO_ROOT, rel);
    if (!existsSync(full)) continue;
    const content = normalizeLineEndings(readFileSync(full, 'utf-8'));
    allBlocks.push(...extractBlocks(rel, content));
  }

  it('at least one sentinel block exists across target docs', () => {
    // If this trips, the doc retrofit step never happened and the guardrail
    // is vacuously passing — fail loudly so we notice.
    expect(
      allBlocks.length,
      'No GENERATED sentinels found in README.md, CLAUDE.md, or docs/CONFIGURATION.md. Run `npm run generate:doc-fragments` after inserting sentinels.'
    ).toBeGreaterThan(0);
  });

  it('every sentinel block references a known fragment id', () => {
    const known = new Set<string>(DOC_FRAGMENT_IDS);
    for (const block of allBlocks) {
      expect(
        known.has(block.id),
        `Unknown fragment id "${block.id}" in ${block.file}. Valid ids: ${[...known].join(', ')}`
      ).toBe(true);
    }
  });

  it('every sentinel block matches its canonical fragment', () => {
    for (const block of allBlocks) {
      const expected = DOC_FRAGMENTS[block.id];
      expect(
        block.body,
        `${block.file}: fragment "${block.id}" is stale. Run \`npm run generate:doc-fragments\`.`
      ).toBe(expected);
    }
  });
});
