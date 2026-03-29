import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

const DOCS_DIR = path.join(__dirname, '../../../../../docs');

type Heading = {
  title: string;
  anchor: string;
};

function createGithubSlugger(): (title: string) => string {
  const seen = new Map<string, number>();

  return (title: string) => {
    const base = title
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/`/g, '')
      .replace(/[^\w\- ]/g, '')
      .trim()
      .replace(/ /g, '-');

    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return `#${count === 0 ? base : `${base}-${count}`}`;
  };
}

async function walkDocs(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walkDocs(fullPath);
    }
    return entry.isFile() && entry.name.endsWith('.md') ? [fullPath] : [];
  }));

  return files.flat().sort();
}

function extractHeadings(content: string): Heading[] {
  const lines = content.split(/\r?\n/);
  const slug = createGithubSlugger();
  const headings: Heading[] = [];
  let inFence = false;

  for (const line of lines) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }

    const match = line.match(/^(#{2,4})\s+(.*)$/);
    if (!match) {
      continue;
    }

    const title = match[2].trim();
    headings.push({ title, anchor: slug(title) });
  }

  return headings;
}

function extractTocAnchors(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const anchors: string[] = [];
  let inFence = false;

  for (const line of lines) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }

    if (/^##\s+/.test(line)) {
      break;
    }

    const match = line.match(/^\s*-\s+\[[^\]]+\]\((#[^)]+)\)\s*$/);
    if (match) {
      anchors.push(match[1]);
    }
  }

  return anchors;
}

describe('Documentation TOC completeness', () => {
  it('every docs page has a complete TOC for all H2-H4 headings', async () => {
    const files = await walkDocs(DOCS_DIR);

    for (const file of files) {
      const content = await fs.readFile(file, 'utf-8');
      const headings = extractHeadings(content);
      const tocAnchors = extractTocAnchors(content);
      const expectedAnchors = headings.map(heading => heading.anchor);

      expect(
        tocAnchors,
        `${path.relative(DOCS_DIR, file)} TOC did not match the H2-H4 heading anchors`
      ).toEqual(expectedAnchors);
    }
  });
});
