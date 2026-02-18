/**
 * Task Cache — SQLite-backed task index for fast queries
 *
 * Follows the FTS5/embeddings pattern: module-level db ref, injected via setter.
 * Replaces full vault scan with indexed SQL queries.
 */

import type Database from 'better-sqlite3';
import * as path from 'path';
import type { VaultIndex } from './types.js';
import { extractTasksFromNote, type Task } from '../../tools/read/tasks.js';
import { serverLog } from '../shared/serverLog.js';

// Module-level database reference
let db: Database.Database | null = null;

/** Staleness threshold: 30 minutes */
const TASK_CACHE_STALE_MS = 30 * 60 * 1000;

/** Whether the cache has been built at least once this session */
let cacheReady = false;

/** Whether a background rebuild is in progress */
let rebuildInProgress = false;

/**
 * Inject database handle (called from index.ts after StateDb init)
 */
export function setTaskCacheDatabase(database: Database.Database): void {
  db = database;

  // Check if cache was previously built
  try {
    const row = db.prepare(
      'SELECT value FROM fts_metadata WHERE key = ?'
    ).get('task_cache_built') as { value: string } | undefined;

    if (row) {
      cacheReady = true;
    }
  } catch {
    // Table might not exist yet
  }
}

/**
 * Check if the task cache is ready to serve queries
 */
export function isTaskCacheReady(): boolean {
  return cacheReady && db !== null;
}

/**
 * Check if a task cache rebuild is currently in progress
 */
export function isTaskCacheBuilding(): boolean {
  return rebuildInProgress;
}

/**
 * Full rebuild: scan all notes, extract tasks, bulk INSERT
 *
 * If the cache was previously built (cacheReady=true from a prior session),
 * we keep serving stale data during the rebuild rather than falling through
 * to the expensive full-disk scan.
 */
export async function buildTaskCache(
  vaultPath: string,
  index: VaultIndex,
  excludeTags?: string[]
): Promise<void> {
  if (!db) {
    throw new Error('Task cache database not initialized. Call setTaskCacheDatabase() first.');
  }

  if (rebuildInProgress) return;
  rebuildInProgress = true;

  // Keep cacheReady=true if it was already set (serve stale data during rebuild)
  // Only mark as not-ready if this is the very first build (no prior cache data)

  const start = Date.now();

  try {
    // Collect all note paths
    const notePaths: string[] = [];
    for (const note of index.notes.values()) {
      notePaths.push(note.path);
    }

    // Phase 1: Extract all tasks into memory (async file reads, no DB writes)
    const allRows: Array<[string, number, string, string, string, string | null, string | null, string | null]> = [];
    for (const notePath of notePaths) {
      const absolutePath = path.join(vaultPath, notePath);
      const tasks = await extractTasksFromNote(notePath, absolutePath);

      for (const task of tasks) {
        if (excludeTags?.length && excludeTags.some(t => task.tags.includes(t))) {
          continue;
        }
        allRows.push([
          task.path,
          task.line,
          task.text,
          task.status,
          task.raw,
          task.context ?? null,
          task.tags.length > 0 ? JSON.stringify(task.tags) : null,
          task.due_date ?? null,
        ]);
      }
    }

    // Phase 2: Atomic swap — DELETE + INSERT all in one transaction
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO tasks (path, line, text, status, raw, context, tags_json, due_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const swapAll = db.transaction(() => {
      db!.prepare('DELETE FROM tasks').run();
      for (const row of allRows) {
        insertStmt.run(...row);
      }
      db!.prepare(
        'INSERT OR REPLACE INTO fts_metadata (key, value) VALUES (?, ?)'
      ).run('task_cache_built', new Date().toISOString());
    });

    swapAll();

    cacheReady = true;
    const duration = Date.now() - start;
    serverLog('tasks', `Task cache built: ${allRows.length} tasks from ${notePaths.length} notes in ${duration}ms`);
  } finally {
    rebuildInProgress = false;
  }
}

/**
 * Incremental: re-extract tasks for one file, replace in cache
 */
export async function updateTaskCacheForFile(
  vaultPath: string,
  relativePath: string
): Promise<void> {
  if (!db) return;

  // Delete existing tasks for this path
  db.prepare('DELETE FROM tasks WHERE path = ?').run(relativePath);

  // Read file and extract tasks
  const absolutePath = path.join(vaultPath, relativePath);
  const tasks = await extractTasksFromNote(relativePath, absolutePath);

  if (tasks.length > 0) {
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO tasks (path, line, text, status, raw, context, tags_json, due_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertBatch = db.transaction(() => {
      for (const task of tasks) {
        insertStmt.run(
          task.path,
          task.line,
          task.text,
          task.status,
          task.raw,
          task.context ?? null,
          task.tags.length > 0 ? JSON.stringify(task.tags) : null,
          task.due_date ?? null
        );
      }
    });
    insertBatch();
  }
}

/**
 * Remove tasks for a deleted file
 */
export function removeTaskCacheForFile(relativePath: string): void {
  if (!db) return;
  db.prepare('DELETE FROM tasks WHERE path = ?').run(relativePath);
}

/**
 * Query tasks from cache
 */
export function queryTasksFromCache(options: {
  status?: 'open' | 'completed' | 'cancelled' | 'all';
  folder?: string;
  tag?: string;
  excludeTags?: string[];
  has_due_date?: boolean;
  limit?: number;
  offset?: number;
}): { total: number; open_count: number; completed_count: number; cancelled_count: number; tasks: Task[] } {
  if (!db) {
    throw new Error('Task cache database not initialized.');
  }

  const { status = 'all', folder, tag, excludeTags = [], has_due_date, limit, offset = 0 } = options;

  // Build WHERE clauses
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (status !== 'all') {
    conditions.push('status = ?');
    params.push(status);
  }

  if (folder) {
    conditions.push('path LIKE ?');
    params.push(folder + '%');
  }

  if (has_due_date) {
    conditions.push('due_date IS NOT NULL');
  }

  if (tag) {
    conditions.push("EXISTS (SELECT 1 FROM json_each(tags_json) WHERE value = ?)");
    params.push(tag);
  }

  if (excludeTags.length > 0) {
    const placeholders = excludeTags.map(() => '?').join(', ');
    conditions.push(`NOT EXISTS (SELECT 1 FROM json_each(tags_json) WHERE value IN (${placeholders}))`);
    params.push(...excludeTags);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  // Get counts (unfiltered by status for totals, but filtered by folder/tags)
  const countConditions: string[] = [];
  const countParams: unknown[] = [];

  if (folder) {
    countConditions.push('path LIKE ?');
    countParams.push(folder + '%');
  }

  if (excludeTags.length > 0) {
    const placeholders = excludeTags.map(() => '?').join(', ');
    countConditions.push(`NOT EXISTS (SELECT 1 FROM json_each(tags_json) WHERE value IN (${placeholders}))`);
    countParams.push(...excludeTags);
  }

  const countWhere = countConditions.length > 0 ? 'WHERE ' + countConditions.join(' AND ') : '';

  const countRows = db.prepare(
    `SELECT status, COUNT(*) as cnt FROM tasks ${countWhere} GROUP BY status`
  ).all(...countParams) as Array<{ status: string; cnt: number }>;

  let openCount = 0;
  let completedCount = 0;
  let cancelledCount = 0;
  let total = 0;

  for (const row of countRows) {
    total += row.cnt;
    if (row.status === 'open') openCount = row.cnt;
    else if (row.status === 'completed') completedCount = row.cnt;
    else if (row.status === 'cancelled') cancelledCount = row.cnt;
  }

  // Query tasks with ordering
  let orderBy: string;
  if (has_due_date) {
    orderBy = 'ORDER BY due_date ASC, path';
  } else {
    orderBy = 'ORDER BY CASE WHEN due_date IS NOT NULL THEN 0 ELSE 1 END, due_date DESC, path';
  }

  let limitClause = '';
  const queryParams = [...params];
  if (limit !== undefined) {
    limitClause = ' LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);
  }

  const rows = db.prepare(
    `SELECT path, line, text, status, raw, context, tags_json, due_date FROM tasks ${whereClause} ${orderBy}${limitClause}`
  ).all(...queryParams) as Array<{
    path: string;
    line: number;
    text: string;
    status: string;
    raw: string;
    context: string | null;
    tags_json: string | null;
    due_date: string | null;
  }>;

  const tasks: Task[] = rows.map(row => ({
    path: row.path,
    line: row.line,
    text: row.text,
    status: row.status as 'open' | 'completed' | 'cancelled',
    raw: row.raw,
    context: row.context ?? undefined,
    tags: row.tags_json ? JSON.parse(row.tags_json) : [],
    due_date: row.due_date ?? undefined,
  }));

  return {
    total,
    open_count: openCount,
    completed_count: completedCount,
    cancelled_count: cancelledCount,
    tasks,
  };
}

/**
 * Check if the task cache is stale
 */
export function isTaskCacheStale(): boolean {
  if (!db) return true;

  try {
    const row = db.prepare(
      'SELECT value FROM fts_metadata WHERE key = ?'
    ).get('task_cache_built') as { value: string } | undefined;

    if (!row) return true;

    const builtAt = new Date(row.value).getTime();
    const age = Date.now() - builtAt;
    return age > TASK_CACHE_STALE_MS;
  } catch {
    return true;
  }
}

/**
 * Trigger a background rebuild if stale.
 * Returns immediately — the rebuild happens async.
 */
export function refreshIfStale(
  vaultPath: string,
  index: VaultIndex,
  excludeTags?: string[]
): void {
  if (!isTaskCacheStale() || rebuildInProgress) return;

  buildTaskCache(vaultPath, index, excludeTags).catch(err => {
    serverLog('tasks', `Task cache background refresh failed: ${err instanceof Error ? err.message : err}`, 'error');
  });
}
