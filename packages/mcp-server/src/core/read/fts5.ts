/**
 * FTS5 Full-Text Search Module
 *
 * Provides SQLite FTS5-based full-text search for vault content.
 * Uses the shared StateDb (notes_fts + fts_metadata tables).
 *
 * Features:
 * - Porter stemming (running matches run, runs, ran)
 * - Phrase search with quotes
 * - Boolean operators (AND, OR, NOT)
 * - Prefix matching with *
 * - Highlighted snippets in results
 */

import type Database from 'better-sqlite3';
import * as fs from 'fs';
import { scanVault } from './vault.js';
import { serverLog } from '../shared/serverLog.js';
import { SYSTEM_EXCLUDED_DIRS } from '../shared/constants.js';
import { getActiveScopeOrNull } from '../../vault-scope.js';

/** Search result with highlighted snippet */
export interface FTS5Result {
  path: string;
  title: string;
  snippet: string;
}

/** FTS5 index state */
export interface FTS5State {
  ready: boolean;
  building: boolean;
  lastBuilt: Date | null;
  noteCount: number;
  error: string | null;
}


/** Maximum file size to index (5MB) */
const MAX_INDEX_FILE_SIZE = 5 * 1024 * 1024;

/** Index staleness threshold (1 hour in ms) */
const STALE_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * Split frontmatter from markdown content for separate FTS5 indexing.
 * Extracts YAML values (not keys) as searchable text for the frontmatter column.
 */
function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  if (!raw.startsWith('---')) return { frontmatter: '', body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: '', body: raw };
  // Flatten frontmatter YAML values into searchable text
  const yaml = raw.substring(4, end);
  const values = yaml.split('\n')
    .map(line => line.replace(/^[\s-]*/, '').replace(/^[\w]+:\s*/, ''))
    .filter(v => v && !v.startsWith('[') && !v.startsWith('{'))
    .join(' ');
  return { frontmatter: values, body: raw.substring(end + 4) };
}

let db: Database.Database | null = null;

/** Resolve DB handle: ALS scope first, fallback to module-level. */
function getDb(): Database.Database | null {
  return getActiveScopeOrNull()?.stateDb?.db ?? db;
}

let state: FTS5State = {
  ready: false,
  building: false,
  lastBuilt: null,
  noteCount: 0,
  error: null,
};

/**
 * Set the FTS5 database handle (injected from StateDb)
 *
 * Call this once during startup after opening the StateDb.
 * The notes_fts and fts_metadata tables must already exist in the database.
 */
export function setFTS5Database(database: Database.Database): void {
  db = database;

  // Check if there's existing metadata indicating a previous build
  try {
    const row = db.prepare(
      'SELECT value FROM fts_metadata WHERE key = ?'
    ).get('last_built') as { value: string } | undefined;

    if (row) {
      const lastBuilt = new Date(row.value);
      const countRow = db.prepare('SELECT COUNT(*) as count FROM notes_fts').get() as { count: number };
      state = {
        ready: countRow.count > 0,
        building: false,
        lastBuilt,
        noteCount: countRow.count,
        error: null,
      };
    }
  } catch {
    // Tables may not have data yet, that's fine
  }
}

/**
 * Check if a file should be indexed
 */
function shouldIndexFile(filePath: string): boolean {
  const parts = filePath.split('/');
  return !parts.some(part => SYSTEM_EXCLUDED_DIRS.has(part));
}

/**
 * Build or rebuild the FTS5 index
 */
export async function buildFTS5Index(vaultPath: string): Promise<FTS5State> {
  const db = getDb();
  try {
    state.error = null;
    state.building = true;

    if (!db) {
      throw new Error('FTS5 database not initialized. Call setFTS5Database() first.');
    }

    // Scan vault for markdown files
    const files = await scanVault(vaultPath);
    const indexableFiles = files.filter(f => shouldIndexFile(f.path));

    // Read all file content into memory first, then do atomic swap
    const rows: Array<[string, string, string, string]> = [];
    for (const file of indexableFiles) {
      try {
        const stats = fs.statSync(file.absolutePath);
        if (stats.size > MAX_INDEX_FILE_SIZE) {
          continue; // Skip very large files
        }

        const raw = fs.readFileSync(file.absolutePath, 'utf-8');
        const { frontmatter, body } = splitFrontmatter(raw);
        const title = file.path.replace(/\.md$/, '').split('/').pop() || file.path;
        rows.push([file.path, title, frontmatter, body]);
      } catch (err) {
        // Skip files we can't read
        serverLog('fts5', `Skipping ${file.path}: ${err}`, 'warn');
      }
    }

    // Atomic swap: DELETE + INSERT all in one transaction
    const insert = db.prepare(
      'INSERT INTO notes_fts (path, title, frontmatter, content) VALUES (?, ?, ?, ?)'
    );
    const now = new Date();

    const swapAll = db.transaction(() => {
      db.exec('DELETE FROM notes_fts');
      for (const row of rows) {
        insert.run(...row);
      }
      db.prepare(
        'INSERT OR REPLACE INTO fts_metadata (key, value) VALUES (?, ?)'
      ).run('last_built', now.toISOString());
    });

    swapAll();
    const indexed = rows.length;

    state = {
      ready: true,
      building: false,
      lastBuilt: now,
      noteCount: indexed,
      error: null,
    };

    serverLog('fts5', `Indexed ${indexed} notes`);
    return state;
  } catch (err) {
    state = {
      ready: false,
      building: false,
      lastBuilt: null,
      noteCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
    throw err;
  }
}

/**
 * Check if index needs rebuilding
 */
export function isIndexStale(_vaultPath?: string): boolean {
  const db = getDb();
  if (!db) {
    return true;
  }

  try {
    const row = db.prepare(
      'SELECT value FROM fts_metadata WHERE key = ?'
    ).get('last_built') as { value: string } | undefined;

    if (!row) {
      return true;
    }

    const lastBuilt = new Date(row.value);
    const age = Date.now() - lastBuilt.getTime();
    return age > STALE_THRESHOLD_MS;
  } catch {
    return true;
  }
}

/**
 * Incrementally update the FTS5 index for changed/new files and remove deleted ones.
 * Called by the watcher pipeline after each batch.
 */
export function updateFTS5Incremental(
  vaultPath: string,
  changed: string[],
  deleted: string[],
): { updated: number; removed: number } {
  const db = getDb();
  if (!db || !state.ready) return { updated: 0, removed: 0 };

  const del = db.prepare('DELETE FROM notes_fts WHERE path = ?');
  const ins = db.prepare(
    'INSERT INTO notes_fts (path, title, frontmatter, content) VALUES (?, ?, ?, ?)'
  );

  let updated = 0;
  let removed = 0;

  const run = db.transaction(() => {
    // Remove deleted/moved files
    for (const p of deleted) {
      del.run(p);
      removed++;
    }

    // Upsert changed files (delete + re-insert)
    for (const p of changed) {
      if (!shouldIndexFile(p)) continue;
      const absPath = `${vaultPath}/${p}`.replace(/\\/g, '/');
      try {
        const stats = fs.statSync(absPath);
        if (stats.size > MAX_INDEX_FILE_SIZE) continue;
        const raw = fs.readFileSync(absPath, 'utf-8');
        const { frontmatter, body } = splitFrontmatter(raw);
        const title = p.replace(/\.md$/, '').split('/').pop() || p;
        del.run(p);
        ins.run(p, title, frontmatter, body);
        updated++;
      } catch {
        // File unreadable — remove stale entry if any
        del.run(p);
      }
    }
  });

  run();
  if (updated > 0 || removed > 0) {
    state.noteCount = (db.prepare('SELECT COUNT(*) as count FROM notes_fts').get() as { count: number }).count;
  }
  return { updated, removed };
}

/**
 * Search the FTS5 index
 *
 * Supports FTS5 query syntax:
 * - Simple terms: authentication
 * - Phrases: "exact phrase"
 * - Boolean: term1 AND term2, term1 OR term2, NOT term
 * - Prefix: auth*
 * - Column filter: title:api
 */
/**
 * Sanitize a natural language query for FTS5 MATCH.
 * Strips operators, escapes quotes, normalizes whitespace.
 */
function sanitizeFTS5Query(query: string): string {
  if (!query?.trim()) return '';

  // Extract quoted phrases first (preserve as AND-joined phrase matches)
  const phrases: string[] = [];
  const withoutPhrases = query.replace(/"([^"]+)"/g, (_, phrase) => {
    phrases.push(`"${phrase.replace(/"/g, '""')}"`);
    return '';
  });

  // Clean remaining tokens
  const cleaned = withoutPhrases
    .replace(/[(){}[\]^~:\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Split into tokens, skip explicit AND/OR operators
  const tokens = cleaned.split(' ').filter(t => t && t !== 'AND' && t !== 'OR' && t !== 'NOT');

  // Combine: quoted phrases + OR-joined tokens
  // OR semantics with BM25 ranking: documents matching more terms score higher
  const parts = [...phrases];
  if (tokens.length === 1) {
    parts.push(tokens[0]);
  } else if (tokens.length > 1) {
    parts.push(tokens.join(' OR '));
  }

  return parts.join(' ') || '';
}

export function searchFTS5(
  _vaultPath: string,
  query: string,
  limit: number = 10
): FTS5Result[] {
  const db = getDb();
  if (!db) {
    throw new Error('FTS5 database not initialized. Call setFTS5Database() first.');
  }

  const sanitized = sanitizeFTS5Query(query);
  if (!sanitized) return [];

  try {
    // Use snippet() on content column (index 3) with BM25 column weights:
    // path=0 (ignore), title=5x, frontmatter=10x, content=1x (baseline)
    const stmt = db.prepare(`
      SELECT
        path,
        title,
        snippet(notes_fts, 3, '<mark>', '</mark>', '...', 64) as snippet
      FROM notes_fts
      WHERE notes_fts MATCH ?
      ORDER BY bm25(notes_fts, 0.0, 5.0, 10.0, 1.0)
      LIMIT ?
    `);

    const results = stmt.all(sanitized, limit) as FTS5Result[];
    return results;
  } catch (err) {
    // Handle common FTS5 query errors — return empty instead of crashing
    if (err instanceof Error && err.message.includes('fts5:')) {
      return [];
    }
    throw err;
  }
}

/**
 * Get the current FTS5 state.
 * Derives from the scope-aware DB when available, falling back to module-level state
 * during builds (when the state is being modified in-flight).
 */
export function getFTS5State(): FTS5State {
  // During builds, the module-level state tracks progress — return it directly
  if (state.building) return { ...state };

  // Otherwise derive from the scope-aware DB for multi-vault safety
  const scopeDb = getDb();
  if (scopeDb) {
    try {
      const row = scopeDb.prepare(
        'SELECT value FROM fts_metadata WHERE key = ?'
      ).get('last_built') as { value: string } | undefined;
      const countRow = scopeDb.prepare('SELECT COUNT(*) as count FROM notes_fts').get() as { count: number };
      return {
        ready: countRow.count > 0,
        building: false,
        lastBuilt: row ? new Date(row.value) : null,
        noteCount: countRow.count,
        error: null,
      };
    } catch {
      // DB not ready — fall through to module-level state
    }
  }

  return { ...state };
}

/**
 * Get a content preview for a note from the FTS5 index (zero filesystem I/O).
 * Returns the first ~maxChars of the note body, truncated at a word boundary.
 */
export function getContentPreview(notePath: string, maxChars: number = 300): string | null {
  const db = getDb();
  if (!db) return null;
  try {
    const row = db.prepare(
      'SELECT substr(content, 1, ?) as preview FROM notes_fts WHERE path = ?'
    ).get(maxChars + 50, notePath) as { preview: string } | undefined;
    if (!row?.preview) return null;
    const truncated = row.preview.length > maxChars
      ? row.preview.slice(0, maxChars).replace(/\s\S*$/, '') + '...'
      : row.preview;
    return truncated;
  } catch { return null; }
}

/**
 * Count how many notes mention a term (exact phrase match via FTS5).
 * Returns 0 if FTS5 is not ready or query fails.
 */
export function countFTS5Mentions(term: string): number {
  const db = getDb();
  if (!db) return 0;
  try {
    const result = db.prepare(
      'SELECT COUNT(*) as cnt FROM notes_fts WHERE content MATCH ?'
    ).get(`"${term}"`) as { cnt: number } | undefined;
    return result?.cnt ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Close the database connection
 * Note: With injected db, this is a no-op since the StateDb owns the connection.
 */
export function closeFTS5(): void {
  // Don't close - the StateDb owns the connection lifecycle
  db = null;
  state = {
    ready: false,
    building: false,
    lastBuilt: null,
    noteCount: 0,
    error: null,
  };
}
