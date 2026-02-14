/**
 * Recency weighting for wikilink suggestions
 *
 * Tracks when entities were last mentioned in vault files
 * and provides boost scores for recently-mentioned entities.
 *
 * Recency detection uses file modification time as a proxy for
 * "when entity was mentioned" - this is a lightweight approach
 * that doesn't require parsing every file on every update.
 *
 * All recency data is stored in SQLite StateDb.
 */

import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import {
  getEntityName,
  type Entity,
  recordEntityMention,
  getAllRecency as getAllRecencyFromDb,
  type StateDb,
  type RecencyRow,
} from '@velvetmonkey/vault-core';

/**
 * Module-level StateDb reference for recency storage
 * Set via setRecencyStateDb() during initialization
 */
let moduleStateDb: StateDb | null = null;

/**
 * Set the StateDb instance for this module
 * Called during MCP server initialization
 */
export function setRecencyStateDb(stateDb: StateDb | null): void {
  moduleStateDb = stateDb;
}

/**
 * Recency index tracking last mention times for entities
 */
export interface RecencyIndex {
  /** Map of entity name (lowercase) to last mention timestamp (epoch ms) */
  lastMentioned: Map<string, number>;
  /** When this index was last updated */
  lastUpdated: number;
  /** Cache version for migration detection */
  version: number;
}

/**
 * Current cache version - bump when schema changes
 */
export const RECENCY_CACHE_VERSION = 1;


/**
 * Folders to exclude from recency scanning
 */
const EXCLUDED_FOLDERS = new Set([
  'node_modules',
  '.git',
  '.obsidian',
  '.claude',
  'templates',
]);

/**
 * Recursively scan directory for markdown files
 */
async function* walkMarkdownFiles(
  dir: string,
  baseDir: string
): AsyncGenerator<{ path: string; relativePath: string }> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      // Skip excluded folders
      const topFolder = relativePath.split(path.sep)[0];
      if (EXCLUDED_FOLDERS.has(topFolder)) {
        continue;
      }

      if (entry.isDirectory()) {
        yield* walkMarkdownFiles(fullPath, baseDir);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        yield { path: fullPath, relativePath };
      }
    }
  } catch {
    // Silently skip directories we can't read
  }
}

/**
 * Build recency index by scanning vault files
 *
 * For each entity, checks which markdown files contain it
 * and records the most recent file modification time.
 *
 * @param vaultPath - Path to vault root
 * @param entities - Array of entities to track
 * @returns RecencyIndex with last mention times
 */
export async function buildRecencyIndex(
  vaultPath: string,
  entities: Entity[]
): Promise<RecencyIndex> {
  const lastMentioned = new Map<string, number>();

  // Get entity names for matching (lowercase for case-insensitive)
  const entityNames = entities
    .map(e => getEntityName(e).toLowerCase())
    .filter(name => name.length >= 3); // Skip very short names

  if (entityNames.length === 0) {
    return { lastMentioned, lastUpdated: Date.now(), version: RECENCY_CACHE_VERSION };
  }

  // Create a Set for faster lookups
  const entitySet = new Set(entityNames);

  try {
    // Scan all markdown files
    for await (const file of walkMarkdownFiles(vaultPath, vaultPath)) {
      try {
        const [fileStat, content] = await Promise.all([
          stat(file.path),
          readFile(file.path, 'utf-8'),
        ]);

        const contentLower = content.toLowerCase();
        const mtime = fileStat.mtimeMs;

        // Check which entities appear in this file
        for (const entityName of entitySet) {
          if (contentLower.includes(entityName)) {
            const existing = lastMentioned.get(entityName) || 0;
            // Keep the most recent mtime
            if (mtime > existing) {
              lastMentioned.set(entityName, mtime);
            }
          }
        }
      } catch {
        // Skip files we can't read
      }
    }
  } catch (error) {
    console.error(`[Crank] Error building recency index: ${error}`);
  }

  return {
    lastMentioned,
    lastUpdated: Date.now(),
    version: RECENCY_CACHE_VERSION,
  };
}

/**
 * Get recency boost for an entity
 *
 * Returns a boost score based on how recently the entity was mentioned:
 * - Mentioned in last hour: +8 (high priority for current work)
 * - Mentioned in last 24 hours: +5
 * - Mentioned in last 3 days (72h): +3
 * - Mentioned in last week (168h): +1
 * - Older or not found: 0
 *
 * Higher boosts ensure recently-mentioned entities dominate suggestions
 * over entities with high co-occurrence from historical mentions.
 *
 * @param entityName - Name of entity to check
 * @param index - Recency index to check against
 * @returns Boost score (0-8)
 */
export function getRecencyBoost(entityName: string, index: RecencyIndex): number {
  const lastMention = index.lastMentioned.get(entityName.toLowerCase());
  if (!lastMention) return 0;

  const ageMs = Date.now() - lastMention;
  const ageHours = ageMs / (1000 * 60 * 60);

  if (ageHours < 1)   return 8;     // Mentioned in last hour (high priority)
  if (ageHours < 24)  return 5;     // Mentioned in last 24h
  if (ageHours < 72)  return 3;     // Mentioned in last 3 days
  if (ageHours < 168) return 1;     // Mentioned in last week (168h)
  return 0;
}

/**
 * Load recency index from StateDb
 *
 * @returns RecencyIndex or null if StateDb unavailable or empty
 */
export function loadRecencyFromStateDb(): RecencyIndex | null {
  if (!moduleStateDb) return null;

  try {
    const rows = getAllRecencyFromDb(moduleStateDb);
    if (rows.length === 0) return null;

    const lastMentioned = new Map<string, number>();
    let maxTime = 0;

    for (const row of rows) {
      lastMentioned.set(row.entityNameLower, row.lastMentionedAt);
      if (row.lastMentionedAt > maxTime) {
        maxTime = row.lastMentionedAt;
      }
    }

    return {
      lastMentioned,
      lastUpdated: maxTime,
      version: RECENCY_CACHE_VERSION,
    };
  } catch {
    return null;
  }
}


/**
 * Save recency index to StateDb
 *
 * @param index - RecencyIndex to save
 */
export function saveRecencyToStateDb(index: RecencyIndex): void {
  if (!moduleStateDb) {
    console.error('[Crank] No StateDb available for saving recency');
    return;
  }

  try {
    for (const [entityNameLower, timestamp] of index.lastMentioned) {
      recordEntityMention(moduleStateDb, entityNameLower, new Date(timestamp));
    }
    console.error(`[Crank] Saved ${index.lastMentioned.size} recency entries to StateDb`);
  } catch (e) {
    console.error('[Crank] Failed to save recency to StateDb:', e);
  }
}
