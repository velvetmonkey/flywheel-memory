/**
 * Tests for protected zones detection
 */

import { describe, it, expect } from 'vitest';
import {
  findFrontmatterEnd,
  getProtectedZones,
  isInProtectedZone,
  rangeOverlapsProtectedZone,
} from '../src/protectedZones.js';

describe('findFrontmatterEnd', () => {
  it('should return 0 when no frontmatter', () => {
    const content = '# Heading\nSome content';
    expect(findFrontmatterEnd(content)).toBe(0);
  });

  it('should find end of frontmatter', () => {
    const content = `---
title: Test
---
# Heading`;
    const end = findFrontmatterEnd(content);
    expect(end).toBeGreaterThan(0);
    expect(content.slice(end).trim()).toBe('# Heading');
  });

  it('should return 0 when frontmatter not closed', () => {
    const content = `---
title: Test
# Heading`;
    expect(findFrontmatterEnd(content)).toBe(0);
  });

  it('should handle empty frontmatter', () => {
    const content = `---
---
Content`;
    const end = findFrontmatterEnd(content);
    expect(end).toBeGreaterThan(0);
  });
});

describe('getProtectedZones', () => {
  it('should detect frontmatter zone', () => {
    const content = `---
title: Test
---
Content`;
    const zones = getProtectedZones(content);
    const frontmatter = zones.find(z => z.type === 'frontmatter');
    expect(frontmatter).toBeDefined();
    expect(frontmatter!.start).toBe(0);
  });

  it('should detect code blocks', () => {
    const content = 'Text\n```\ncode\n```\nMore text';
    const zones = getProtectedZones(content);
    const codeBlock = zones.find(z => z.type === 'code_block');
    expect(codeBlock).toBeDefined();
  });

  it('should detect inline code', () => {
    const content = 'Use `console.log` for debugging';
    const zones = getProtectedZones(content);
    const inlineCode = zones.find(z => z.type === 'inline_code');
    expect(inlineCode).toBeDefined();
  });

  it('should detect existing wikilinks', () => {
    const content = 'See [[Note Name]] for details';
    const zones = getProtectedZones(content);
    const wikilink = zones.find(z => z.type === 'wikilink');
    expect(wikilink).toBeDefined();
  });

  it('should detect markdown links', () => {
    const content = 'Check [this link](https://example.com) out';
    const zones = getProtectedZones(content);
    const mdLink = zones.find(z => z.type === 'markdown_link');
    expect(mdLink).toBeDefined();
  });

  it('should detect URLs', () => {
    const content = 'Visit https://example.com for more';
    const zones = getProtectedZones(content);
    const url = zones.find(z => z.type === 'url');
    expect(url).toBeDefined();
  });

  it('should detect hashtags', () => {
    const content = 'Tags: #project #work';
    const zones = getProtectedZones(content);
    const hashtags = zones.filter(z => z.type === 'hashtag');
    expect(hashtags).toHaveLength(2);
  });

  it('should detect HTML tags', () => {
    const content = 'Some <b>bold</b> text';
    const zones = getProtectedZones(content);
    const htmlTags = zones.filter(z => z.type === 'html_tag');
    expect(htmlTags).toHaveLength(2);
  });

  it('should detect Obsidian comments', () => {
    const content = 'Visible %% hidden comment %% visible';
    const zones = getProtectedZones(content);
    const comment = zones.find(z => z.type === 'obsidian_comment');
    expect(comment).toBeDefined();
  });

  it('should detect math expressions', () => {
    const content = 'Formula: $E = mc^2$ end';
    const zones = getProtectedZones(content);
    const math = zones.find(z => z.type === 'math');
    expect(math).toBeDefined();
  });

  it('should detect markdown headers', () => {
    const content = '# Main Title\nSome content\n## Subsection\nMore content';
    const zones = getProtectedZones(content);
    const headers = zones.filter(z => z.type === 'header');
    expect(headers.length).toBeGreaterThan(0);
    expect(headers.some(h => content.slice(h.start, h.end).includes('Main Title'))).toBe(true);
  });

  it('should detect various header levels', () => {
    const content = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6';
    const zones = getProtectedZones(content);
    const headers = zones.filter(z => z.type === 'header');
    expect(headers).toHaveLength(6);
  });

  it('should not treat hashtags without space as headers', () => {
    const content = '#notaheader and #hashtag\n# Valid Header';
    const zones = getProtectedZones(content);
    const headers = zones.filter(z => z.type === 'header');
    // Should only detect the valid header, not hashtags
    expect(headers).toHaveLength(1);
    expect(content.slice(headers[0].start, headers[0].end)).toBe('# Valid Header');
  });

  it('should detect Obsidian callouts', () => {
    const content = '> [!note]\n> This is a note\n\nRegular text';
    const zones = getProtectedZones(content);
    const callout = zones.find(z => z.type === 'obsidian_callout');
    expect(callout).toBeDefined();
  });

  it('should detect various callout types', () => {
    const content = '> [!note]\n> [!warning]\n> [!tip]\n> [!error]';
    const zones = getProtectedZones(content);
    const callouts = zones.filter(z => z.type === 'obsidian_callout');
    expect(callouts.length).toBe(4);
  });

  it('should detect callouts with custom types', () => {
    const content = '> [!custom-type]\n> Custom callout';
    const zones = getProtectedZones(content);
    const callout = zones.find(z => z.type === 'obsidian_callout');
    expect(callout).toBeDefined();
  });
});

describe('isInProtectedZone', () => {
  it('should return true when position is in zone', () => {
    const zones = [{ start: 10, end: 20, type: 'code_block' as const }];
    expect(isInProtectedZone(15, zones)).toBe(true);
    expect(isInProtectedZone(10, zones)).toBe(true);
  });

  it('should return false when position is outside zone', () => {
    const zones = [{ start: 10, end: 20, type: 'code_block' as const }];
    expect(isInProtectedZone(5, zones)).toBe(false);
    expect(isInProtectedZone(20, zones)).toBe(false);
    expect(isInProtectedZone(25, zones)).toBe(false);
  });
});

describe('rangeOverlapsProtectedZone', () => {
  it('should detect overlap when range starts inside zone', () => {
    const zones = [{ start: 10, end: 20, type: 'code_block' as const }];
    expect(rangeOverlapsProtectedZone(15, 25, zones)).toBe(true);
  });

  it('should detect overlap when range ends inside zone', () => {
    const zones = [{ start: 10, end: 20, type: 'code_block' as const }];
    expect(rangeOverlapsProtectedZone(5, 15, zones)).toBe(true);
  });

  it('should detect overlap when range contains zone', () => {
    const zones = [{ start: 10, end: 20, type: 'code_block' as const }];
    expect(rangeOverlapsProtectedZone(5, 25, zones)).toBe(true);
  });

  it('should return false when no overlap', () => {
    const zones = [{ start: 10, end: 20, type: 'code_block' as const }];
    expect(rangeOverlapsProtectedZone(0, 5, zones)).toBe(false);
    expect(rangeOverlapsProtectedZone(25, 30, zones)).toBe(false);
  });
});
