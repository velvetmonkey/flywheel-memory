/**
 * Tests for AST-based protected zone detection
 */

import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../src/parseMarkdown.js';
import { getProtectedZonesFromAst } from '../src/astProtectedZones.js';
import { getProtectedZonesRegex, getProtectedZones } from '../src/protectedZones.js';
import type { ProtectedZone } from '../src/types.js';

/** Helper: get AST zones for content */
function astZones(content: string): ProtectedZone[] {
  const tree = parseMarkdown(content);
  expect(tree).not.toBeNull();
  return getProtectedZonesFromAst(tree!, content);
}

/** Helper: check that a zone type exists covering the given substring */
function hasZoneCovering(
  zones: ProtectedZone[],
  content: string,
  type: string,
  substring: string
): boolean {
  const idx = content.indexOf(substring);
  if (idx === -1) throw new Error(`Substring "${substring}" not found in content`);
  return zones.some(
    z => z.type === type && z.start <= idx && z.end >= idx + substring.length
  );
}

// ==========================================
// Parity tests: AST zones match regex zones
// ==========================================

describe('AST parity with regex', () => {
  it('detects frontmatter', () => {
    const content = `---\ntitle: Test\n---\n# Heading`;
    const ast = astZones(content);
    const regex = getProtectedZonesRegex(content);
    const astFm = ast.find(z => z.type === 'frontmatter');
    const regexFm = regex.find(z => z.type === 'frontmatter');
    expect(astFm).toBeDefined();
    expect(regexFm).toBeDefined();
    // AST and regex should both protect frontmatter
    expect(astFm!.start).toBe(0);
  });

  it('detects code blocks', () => {
    const content = 'Text\n```js\nconst x = 1;\n```\nMore text';
    const ast = astZones(content);
    expect(ast.some(z => z.type === 'code_block')).toBe(true);
  });

  it('detects inline code', () => {
    const content = 'Use `console.log` for debugging';
    const ast = astZones(content);
    expect(ast.some(z => z.type === 'inline_code')).toBe(true);
  });

  it('detects existing wikilinks', () => {
    const content = 'See [[Note Name]] for details';
    const ast = astZones(content);
    expect(ast.some(z => z.type === 'wikilink')).toBe(true);
  });

  it('detects markdown links', () => {
    const content = 'Check [this link](https://example.com) out';
    const ast = astZones(content);
    expect(ast.some(z => z.type === 'markdown_link')).toBe(true);
  });

  it('detects bare URLs', () => {
    const content = 'Visit https://example.com for more';
    const ast = astZones(content);
    expect(ast.some(z => z.type === 'url')).toBe(true);
  });

  it('detects hashtags', () => {
    const content = 'Tags: #project #work';
    const ast = astZones(content);
    const hashtags = ast.filter(z => z.type === 'hashtag');
    expect(hashtags).toHaveLength(2);
  });

  it('detects HTML tags', () => {
    const content = 'Some <b>bold</b> text';
    const ast = astZones(content);
    expect(ast.some(z => z.type === 'html_tag')).toBe(true);
  });

  it('detects Obsidian comments', () => {
    const content = 'Visible %% hidden comment %% visible';
    const ast = astZones(content);
    expect(ast.some(z => z.type === 'obsidian_comment')).toBe(true);
  });

  it('detects math expressions', () => {
    const content = 'Formula: $E = mc^2$ end';
    const ast = astZones(content);
    expect(ast.some(z => z.type === 'math')).toBe(true);
  });

  it('detects markdown headers', () => {
    const content = '# Main Title\nSome content\n## Subsection';
    const ast = astZones(content);
    const headers = ast.filter(z => z.type === 'header');
    expect(headers.length).toBeGreaterThanOrEqual(2);
  });

  it('detects callouts', () => {
    const content = '> [!note]\n> This is a note\n\nRegular text';
    const ast = astZones(content);
    expect(ast.some(z => z.type === 'obsidian_callout')).toBe(true);
  });
});

// ==========================================
// Regression tests: AST fixes for known bugs
// ==========================================

describe('AST regression: nested callouts', () => {
  it('protects entire nested callout block', () => {
    const content = `> [!note] Title
> First line
> > [!warning] Nested
> > Inner content
> Back to outer

Regular text with Entity Name here`;

    const zones = astZones(content);
    const callout = zones.find(z => z.type === 'obsidian_callout');
    expect(callout).toBeDefined();
    // The zone should cover the entire blockquote, including nested content
    const calloutContent = content.slice(callout!.start, callout!.end);
    expect(calloutContent).toContain('Nested');
    expect(calloutContent).toContain('Inner content');
    expect(calloutContent).toContain('Back to outer');
  });

  it('protects callout content from wikilink insertion', () => {
    const content = `> [!tip] Pro Tip
> Use Artificial Intelligence and Machine Learning together

Some text about Artificial Intelligence`;

    const zones = astZones(content);
    const callout = zones.find(z => z.type === 'obsidian_callout');
    expect(callout).toBeDefined();
    // "Artificial Intelligence" inside the callout should be protected
    const aiInCallout = content.indexOf('Artificial Intelligence');
    expect(aiInCallout).toBeGreaterThan(callout!.start);
    expect(aiInCallout).toBeLessThan(callout!.end);
  });

  it('regex only protects the callout header line (bug)', () => {
    const content = `> [!note] Title
> Content with Entity Name
> More content`;

    const regexZones = getProtectedZonesRegex(content);
    const callout = regexZones.find(z => z.type === 'obsidian_callout');
    expect(callout).toBeDefined();
    // Regex only catches the first line
    const calloutText = content.slice(callout!.start, callout!.end);
    expect(calloutText).not.toContain('Entity Name');
  });
});

describe('AST regression: tables', () => {
  it('protects GFM table content', () => {
    const content = `# Data

| Name | Type |
|------|------|
| Machine Learning | Technology |
| John Smith | Person |

Regular text about Machine Learning`;

    const zones = astZones(content);
    const table = zones.find(z => z.type === 'table');
    expect(table).toBeDefined();
    const tableContent = content.slice(table!.start, table!.end);
    expect(tableContent).toContain('Machine Learning');
    expect(tableContent).toContain('John Smith');
  });

  it('regex does not detect tables at all', () => {
    const content = `| Name | Type |
|------|------|
| Entity | Category |`;

    const regexZones = getProtectedZonesRegex(content);
    const table = regexZones.find(z => z.type === 'table');
    expect(table).toBeUndefined();
  });
});

describe('AST regression: HTML comments', () => {
  it('protects multi-line HTML comments', () => {
    const content = `Text before

<!-- This is a
multi-line HTML comment
with Entity Name inside -->

Text after with Entity Name`;

    const zones = astZones(content);
    const htmlZones = zones.filter(z => z.type === 'html_tag');
    // Should have at least one HTML zone covering the entire comment
    const commentZone = htmlZones.find(z => {
      const text = content.slice(z.start, z.end);
      return text.includes('multi-line');
    });
    expect(commentZone).toBeDefined();
  });
});

// ==========================================
// Fallback tests
// ==========================================

describe('fallback behavior', () => {
  it('getProtectedZones falls back to regex when forceRegex is used via parseMarkdown', () => {
    const content = '# Heading\nSome `code` and [[link]]';
    // parseMarkdown with forceRegex returns null
    const tree = parseMarkdown(content, { forceRegex: true });
    expect(tree).toBeNull();

    // getProtectedZones should still work (via regex fallback)
    const zones = getProtectedZones(content);
    expect(zones.some(z => z.type === 'inline_code')).toBe(true);
    expect(zones.some(z => z.type === 'wikilink')).toBe(true);
  });

  it('getProtectedZones uses AST by default', () => {
    const content = `| Name | Type |
|------|------|
| Entity | Category |

Regular text`;

    const zones = getProtectedZones(content);
    // AST path detects tables, regex doesn't
    const table = zones.find(z => z.type === 'table');
    expect(table).toBeDefined();
  });
});

// ==========================================
// Performance benchmark
// ==========================================

describe('AST performance', () => {
  it('AST parses a typical note in under 20ms', () => {
    // Generate a realistic note
    const lines = [
      '---',
      'title: Performance Test',
      'tags: [test, benchmark]',
      '---',
      '',
      '# Performance Test Note',
      '',
      'This is a note about [[Machine Learning]] and [[Artificial Intelligence]].',
      '',
      '> [!note] Important',
      '> This is a callout with some content about Python and JavaScript.',
      '> > [!warning] Nested',
      '> > Be careful with nested callouts.',
      '',
      '## Code Example',
      '',
      '```python',
      'def hello():',
      '    print("Hello, World!")',
      '```',
      '',
      '| Feature | Status |',
      '|---------|--------|',
      '| Tables  | Done   |',
      '| AST     | Done   |',
      '',
      'Some text with `inline code` and a [link](https://example.com).',
      '',
      'More text about various entities like TypeScript, React, and Node.js.',
      '',
      '$E = mc^2$',
      '',
      '%% This is a hidden comment %%',
      '',
    ];
    const content = lines.join('\n');

    const iterations = 100;

    // Warmup (JIT + module init)
    for (let i = 0; i < 10; i++) {
      const tree = parseMarkdown(content);
      if (tree) getProtectedZonesFromAst(tree, content);
    }

    // Time AST (warmed up)
    const astStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      const tree = parseMarkdown(content);
      if (tree) getProtectedZonesFromAst(tree, content);
    }
    const astTime = performance.now() - astStart;
    const perNote = astTime / iterations;

    // AST should parse a typical note in under 20ms (relaxed for WSL2 variability)
    expect(perNote).toBeLessThan(20);
  });
});
