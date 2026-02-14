/**
 * Vault integrity checking - detect corruption after mutations
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { IntegrityCheckResult } from '../types.js';

/**
 * Check vault integrity
 */
export async function checkIntegrity(vaultPath: string): Promise<Omit<IntegrityCheckResult, 'iteration'>> {
  const timestamp = new Date().toISOString();
  const errors: string[] = [];

  let noteCount = 0;
  const entities = new Set<string>();
  const linkedEntities = new Set<string>();
  let orphanedLinks = 0;

  try {
    // Scan all markdown files
    const files = await getAllMarkdownFiles(vaultPath);
    noteCount = files.length;

    // Collect all note names (potential link targets)
    const noteNames = new Set<string>();
    for (const file of files) {
      const name = path.basename(file, '.md');
      noteNames.add(name.toLowerCase());
    }

    // Check each file
    for (const file of files) {
      try {
        const content = await fs.readFile(file, 'utf-8');

        // Check for file corruption
        if (!isValidMarkdown(content)) {
          errors.push(`Invalid markdown in ${path.relative(vaultPath, file)}`);
          continue;
        }

        // Extract wikilinks
        const wikilinks = extractWikilinks(content);
        for (const link of wikilinks) {
          linkedEntities.add(link.toLowerCase());

          // Check if link target exists
          if (!noteNames.has(link.toLowerCase())) {
            orphanedLinks++;
          }
        }

        // Extract entities from frontmatter
        const frontmatterEntities = extractFrontmatterEntities(content);
        for (const entity of frontmatterEntities) {
          entities.add(entity);
        }
      } catch (error) {
        errors.push(`Error reading ${path.relative(vaultPath, file)}: ${error}`);
      }
    }
  } catch (error) {
    errors.push(`Error scanning vault: ${error}`);
    return {
      timestamp,
      noteCount: 0,
      entityCount: 0,
      orphanedLinks: 0,
      corrupted: true,
      errors
    };
  }

  // A vault is corrupted if there are read errors
  const corrupted = errors.length > 0;

  return {
    timestamp,
    noteCount,
    entityCount: entities.size,
    orphanedLinks,
    corrupted,
    errors
  };
}

/**
 * Get all markdown files in vault
 */
async function getAllMarkdownFiles(vaultPath: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Skip hidden directories (like .git)
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          await walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Directory might not exist or be readable
    }
  }

  await walk(vaultPath);
  return files;
}

/**
 * Basic markdown validation
 */
function isValidMarkdown(content: string): boolean {
  // Check for null bytes or other binary corruption
  if (content.includes('\0')) {
    return false;
  }

  // Check for valid frontmatter if present
  if (content.startsWith('---')) {
    const endIndex = content.indexOf('---', 3);
    if (endIndex === -1) {
      return false; // Unclosed frontmatter
    }

    // Basic YAML validation
    const frontmatter = content.slice(4, endIndex);
    if (!isValidYamlish(frontmatter)) {
      return false;
    }
  }

  // Check for extremely unbalanced brackets (potential corruption)
  const openBrackets = (content.match(/\[\[/g) || []).length;
  const closeBrackets = (content.match(/\]\]/g) || []).length;

  // Allow some imbalance (could be code blocks) but flag severe cases
  if (Math.abs(openBrackets - closeBrackets) > Math.max(openBrackets, closeBrackets) * 0.1) {
    return false;
  }

  return true;
}

/**
 * Basic YAML-like validation
 */
function isValidYamlish(content: string): boolean {
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    // Check for basic key-value structure
    // Allow list items and nested content
    if (!trimmed.includes(':') && !trimmed.startsWith('-') && !trimmed.startsWith(' ')) {
      return false;
    }
  }

  return true;
}

/**
 * Extract wikilinks from content
 */
function extractWikilinks(content: string): string[] {
  const regex = /\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g;
  const matches: string[] = [];

  let match;
  while ((match = regex.exec(content)) !== null) {
    matches.push(match[1].trim());
  }

  return matches;
}

/**
 * Extract entity references from frontmatter
 */
function extractFrontmatterEntities(content: string): string[] {
  if (!content.startsWith('---')) {
    return [];
  }

  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return [];
  }

  const frontmatter = content.slice(4, endIndex);
  const entities: string[] = [];

  // Look for common entity fields
  const entityFields = ['person', 'people', 'project', 'topic', 'company', 'location', 'assignee'];

  for (const field of entityFields) {
    const regex = new RegExp(`^${field}:\\s*(.+)$`, 'mi');
    const match = frontmatter.match(regex);

    if (match) {
      // Handle both single values and arrays
      const value = match[1].trim();
      if (value.startsWith('[')) {
        // Array format: [a, b, c]
        const items = value.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
        entities.push(...items);
      } else {
        entities.push(value.replace(/^["']|["']$/g, ''));
      }
    }
  }

  return entities;
}

/**
 * Detailed integrity report
 */
export async function generateIntegrityReport(vaultPath: string): Promise<string> {
  const result = await checkIntegrity(vaultPath);

  const lines: string[] = [
    '# Vault Integrity Report',
    '',
    `**Timestamp:** ${result.timestamp}`,
    `**Path:** ${vaultPath}`,
    '',
    '## Summary',
    '',
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Notes | ${result.noteCount} |`,
    `| Entities | ${result.entityCount} |`,
    `| Orphaned Links | ${result.orphanedLinks} |`,
    `| Corrupted | ${result.corrupted ? '❌ YES' : '✅ NO'} |`,
    ''
  ];

  if (result.errors.length > 0) {
    lines.push('## Errors');
    lines.push('');
    for (const error of result.errors) {
      lines.push(`- ${error}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
