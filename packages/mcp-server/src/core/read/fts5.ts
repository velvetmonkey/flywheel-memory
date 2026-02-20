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

/** Directories to exclude from indexing */
const EXCLUDED_DIRS = new Set([
  '.obsidian',
  '.trash',
  '.git',
  'node_modules',
  'templates',
  '.claude',
  '.flywheel',
]);

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
  return !parts.some(part => EXCLUDED_DIRS.has(part));
}

/**
 * Build or rebuild the FTS5 index
 */
export async function buildFTS5Index(vaultPath: string): Promise<FTS5State> {
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
        console.error(`[FTS5] Skipping ${file.path}:`, err);
      }
    }

    // Atomic swap: DELETE + INSERT all in one transaction
    const insert = db.prepare(
      'INSERT INTO notes_fts (path, title, frontmatter, content) VALUES (?, ?, ?, ?)'
    );
    const now = new Date();

    const swapAll = db.transaction(() => {
      db!.exec('DELETE FROM notes_fts');
      for (const row of rows) {
        insert.run(...row);
      }
      db!.prepare(
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

    console.error(`[FTS5] Indexed ${indexed} notes`);
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
 * Search the FTS5 index
 *
 * Supports FTS5 query syntax:
 * - Simple terms: authentication
 * - Phrases: "exact phrase"
 * - Boolean: term1 AND term2, term1 OR term2, NOT term
 * - Prefix: auth*
 * - Column filter: title:api
 */
export function searchFTS5(
  _vaultPath: string,
  query: string,
  limit: number = 10
): FTS5Result[] {
  if (!db) {
    throw new Error('FTS5 database not initialized. Call setFTS5Database() first.');
  }

  try {
    // Use snippet() on content column (index 3) with BM25 column weights:
    // path=0 (ignore), title=5x, frontmatter=10x, content=1x (baseline)
    const stmt = db.prepare(`
      SELECT
        path,
        title,
        snippet(notes_fts, 3, '<mark>', '</mark>', '...', 20) as snippet
      FROM notes_fts
      WHERE notes_fts MATCH ?
      ORDER BY bm25(notes_fts, 0.0, 5.0, 10.0, 1.0)
      LIMIT ?
    `);

    const results = stmt.all(query, limit) as FTS5Result[];
    return results;
  } catch (err) {
    // Handle common FTS5 query errors
    if (err instanceof Error && err.message.includes('fts5: syntax error')) {
      throw new Error(`Invalid search query: ${query}. Check FTS5 syntax.`);
    }
    throw err;
  }
}

/**
 * Get the current FTS5 state
 */
export function getFTS5State(): FTS5State {
  return { ...state };
}

/**
 * Count how many notes mention a term (exact phrase match via FTS5).
 * Returns 0 if FTS5 is not ready or query fails.
 */
export function countFTS5Mentions(term: string): number {
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
