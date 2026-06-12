/**
 * Audit-shard routing for edit_section add operations (arch-review S3).
 *
 * Bounded shard notes for append-only operational content: shard target
 * resolution by size/entry limits, shard note creation with the
 * daily-log-shard frontmatter contract, and canonical-note backlinking.
 * Orchestrated by handleAdd/handleShardedAdd in sections.ts.
 */

import fs from 'fs/promises';
import path from 'path';
import {
  formatContent,
  insertInSection,
  readVaultFile,
  writeVaultFile,
  findSection,
} from './writer.js';

const SHARD_INDEX_WIDTH = 3;

export interface ShardOptions {
  enabled?: boolean;
  pattern?: string;
  maxBytes?: number;
  maxEntries?: number;
  mode?: 'audit';
  lightIndex?: boolean;
}

export interface ShardTarget {
  notePath: string;
  index: number;
  created: boolean;
}

function shardIndexString(index: number): string {
  return String(index).padStart(SHARD_INDEX_WIDTH, '0');
}

function dateFromNotePath(notePath: string): string {
  return notePath.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? new Date().toISOString().split('T')[0];
}

function countAuditEntries(content: string): number {
  return content.match(/^\s*(?:-\s+)?\*\*\d{2}:\d{2}\*\*/gm)?.length ?? 0;
}

function shardPath(pattern: string, date: string, index: number): string {
  return pattern
    .replace(/\{date\}/g, date)
    .replace(/\{index\}/g, shardIndexString(index));
}

async function shardWithinLimits(vaultPath: string, notePath: string, maxBytes: number, maxEntries: number): Promise<boolean> {
  try {
    const fullPath = path.join(vaultPath, notePath);
    const stats = await fs.stat(fullPath);
    if (stats.size >= maxBytes) return false;
    const raw = await fs.readFile(fullPath, 'utf-8');
    return countAuditEntries(raw) < maxEntries;
  } catch (err: any) {
    if (err.code === 'ENOENT') return true;
    throw err;
  }
}

export async function resolveShardTarget(
  vaultPath: string,
  canonicalNotePath: string,
  options: ShardOptions
): Promise<ShardTarget> {
  const date = dateFromNotePath(canonicalNotePath);
  const pattern = options.pattern || 'daily-notes/logs/{date}-audit-{index}.md';
  const maxBytes = options.maxBytes || 262_144;
  const maxEntries = options.maxEntries || 250;

  for (let index = 1; index < 10_000; index++) {
    const current = shardPath(pattern, date, index);
    try {
      await fs.access(path.join(vaultPath, current));
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
      if (index === 1) return { notePath: current, index, created: true };

      const previous = shardPath(pattern, date, index - 1);
      if (await shardWithinLimits(vaultPath, previous, maxBytes, maxEntries)) {
        return { notePath: previous, index: index - 1, created: false };
      }
      return { notePath: current, index, created: true };
    }
  }

  throw new Error(`Shard index exhausted for ${canonicalNotePath}`);
}

export async function ensureShardNote(vaultPath: string, canonicalNotePath: string, target: ShardTarget, options: ShardOptions): Promise<void> {
  if (!target.created) return;

  const date = dateFromNotePath(canonicalNotePath);
  const indexLabel = shardIndexString(target.index);
  await fs.mkdir(path.dirname(path.join(vaultPath, target.notePath)), { recursive: true });
  await writeVaultFile(
    vaultPath,
    target.notePath,
    '# Log\n',
    {
      type: 'daily-log-shard',
      date,
      parent: `[[${canonicalNotePath.replace(/\.md$/, '')}]]`,
      tags: ['#daily', '#audit-log'],
      shard: options.mode || 'audit',
      shard_index: target.index,
      // No skipWikilinks stamp: shards must stay eligible for on-write linking and the
      // background enrich pass (enrich.ts skips any note whose frontmatter sets it true).
      flywheel_indexing: options.lightIndex === false ? undefined : 'light',
      description: `Operational audit log shard ${indexLabel} for ${date}`,
    }
  );
  console.error(`[Flywheel] Created audit shard ${target.notePath}`);
}

export async function linkShardFromCanonical(
  vaultPath: string,
  canonicalNotePath: string,
  section: string,
  target: ShardTarget
): Promise<void> {
  const { content, frontmatter, lineEnding, contentHash } = await readVaultFile(vaultPath, canonicalNotePath);
  const indexLabel = shardIndexString(target.index);
  const shardLink = `[[${target.notePath.replace(/\.md$/, '')}|Audit log shard ${indexLabel}]]`;
  if (content.includes(shardLink)) return;

  const sectionResult = findSection(content, section);
  if (!sectionResult) return;

  const formattedContent = formatContent(shardLink, 'bullet');
  const updatedContent = insertInSection(
    content,
    sectionResult,
    formattedContent,
    'append',
    { preserveListNesting: true, bumpHeadings: true }
  );
  await writeVaultFile(vaultPath, canonicalNotePath, updatedContent, frontmatter, lineEnding, contentHash);
}

