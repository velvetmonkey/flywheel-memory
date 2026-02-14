/**
 * Structure primitives - note content structure analysis
 *
 * Answer: "What's inside this note?"
 */

import * as fs from 'fs';
import * as path from 'path';
import type { VaultIndex } from '../../core/read/types.js';

/** A heading extracted from a note */
export interface Heading {
  level: number;       // 1-6
  text: string;        // Heading text without # prefix
  line: number;        // 1-indexed line number
}

/** A section of a note */
export interface Section {
  heading: Heading;
  line_start: number;  // Start line (the heading itself)
  line_end: number;    // End line (before next same-or-higher level heading)
  subsections: Section[];
}

/** Structure of a note */
export interface NoteStructure {
  path: string;
  headings: Heading[];
  sections: Section[];
  word_count: number;
  line_count: number;
}

/** Regex to match markdown headings */
const HEADING_REGEX = /^(#{1,6})\s+(.+)$/;

/**
 * Extract all headings from markdown content
 */
function extractHeadings(content: string): Heading[] {
  const lines = content.split('\n');
  const headings: Heading[] = [];

  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track code blocks
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) continue;

    const match = line.match(HEADING_REGEX);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        line: i + 1,  // 1-indexed
      });
    }
  }

  return headings;
}

/**
 * Build section hierarchy from headings
 */
function buildSections(headings: Heading[], totalLines: number): Section[] {
  if (headings.length === 0) return [];

  const sections: Section[] = [];
  const stack: Section[] = [];

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const nextHeading = headings[i + 1];
    const lineEnd = nextHeading ? nextHeading.line - 1 : totalLines;

    const section: Section = {
      heading,
      line_start: heading.line,
      line_end: lineEnd,
      subsections: [],
    };

    // Find parent section (lower level number = higher in hierarchy)
    while (stack.length > 0 && stack[stack.length - 1].heading.level >= heading.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      sections.push(section);
    } else {
      stack[stack.length - 1].subsections.push(section);
    }

    stack.push(section);
  }

  return sections;
}

/**
 * Get the full structure of a note
 */
export async function getNoteStructure(
  index: VaultIndex,
  notePath: string,
  vaultPath: string
): Promise<NoteStructure | null> {
  const note = index.notes.get(notePath);
  if (!note) return null;

  const absolutePath = path.join(vaultPath, notePath);

  let content: string;
  try {
    content = await fs.promises.readFile(absolutePath, 'utf-8');
  } catch {
    return null;
  }

  const lines = content.split('\n');
  const headings = extractHeadings(content);
  const sections = buildSections(headings, lines.length);

  // Count words (rough estimate, excluding code blocks)
  const contentWithoutCode = content.replace(/```[\s\S]*?```/g, '');
  const words = contentWithoutCode.split(/\s+/).filter(w => w.length > 0);

  return {
    path: notePath,
    headings,
    sections,
    word_count: words.length,
    line_count: lines.length,
  };
}

/**
 * Get just the headings from a note (lightweight)
 */
export async function getHeadings(
  index: VaultIndex,
  notePath: string,
  vaultPath: string
): Promise<Heading[] | null> {
  const note = index.notes.get(notePath);
  if (!note) return null;

  const absolutePath = path.join(vaultPath, notePath);

  let content: string;
  try {
    content = await fs.promises.readFile(absolutePath, 'utf-8');
  } catch {
    return null;
  }

  return extractHeadings(content);
}

/**
 * Get content under a specific heading
 */
export async function getSectionContent(
  index: VaultIndex,
  notePath: string,
  headingText: string,
  vaultPath: string,
  includeSubheadings: boolean = true
): Promise<{
  heading: string;
  level: number;
  content: string;
  line_start: number;
  line_end: number;
} | null> {
  const note = index.notes.get(notePath);
  if (!note) return null;

  const absolutePath = path.join(vaultPath, notePath);

  let content: string;
  try {
    content = await fs.promises.readFile(absolutePath, 'utf-8');
  } catch {
    return null;
  }

  const lines = content.split('\n');
  const headings = extractHeadings(content);

  // Find the target heading (case-insensitive)
  const targetHeading = headings.find(
    h => h.text.toLowerCase() === headingText.toLowerCase()
  );

  if (!targetHeading) return null;

  // Find where this section ends
  let lineEnd = lines.length;

  for (const h of headings) {
    if (h.line > targetHeading.line) {
      if (includeSubheadings) {
        // Stop at same or higher level heading
        if (h.level <= targetHeading.level) {
          lineEnd = h.line - 1;
          break;
        }
      } else {
        // Stop at any heading
        lineEnd = h.line - 1;
        break;
      }
    }
  }

  // Extract content (skip the heading line itself)
  const sectionLines = lines.slice(targetHeading.line, lineEnd);
  const sectionContent = sectionLines.join('\n').trim();

  return {
    heading: targetHeading.text,
    level: targetHeading.level,
    content: sectionContent,
    line_start: targetHeading.line,
    line_end: lineEnd,
  };
}

/**
 * Get all sections matching a pattern
 */
export async function findSections(
  index: VaultIndex,
  headingPattern: string,  // Regex pattern
  vaultPath: string,
  folder?: string
): Promise<Array<{
  path: string;
  heading: string;
  level: number;
  line: number;
}>> {
  const regex = new RegExp(headingPattern, 'i');
  const results: Array<{
    path: string;
    heading: string;
    level: number;
    line: number;
  }> = [];

  for (const note of index.notes.values()) {
    if (folder && !note.path.startsWith(folder)) continue;

    const absolutePath = path.join(vaultPath, note.path);

    let content: string;
    try {
      content = await fs.promises.readFile(absolutePath, 'utf-8');
    } catch {
      continue;
    }

    const headings = extractHeadings(content);

    for (const heading of headings) {
      if (regex.test(heading.text)) {
        results.push({
          path: note.path,
          heading: heading.text,
          level: heading.level,
          line: heading.line,
        });
      }
    }
  }

  return results;
}
