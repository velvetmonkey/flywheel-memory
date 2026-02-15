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

let db: Database.Database | null = null;
let state: FTS5State = {
  ready: false,
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

    if (!db) {
      throw new Error('FTS5 database not initialized. Call setFTS5Database() first.');
    }

    // Clear existing index
    db.exec('DELETE FROM notes_fts');

    // Scan vault for markdown files
    const files = await scanVault(vaultPath);
    const indexableFiles = files.filter(f => shouldIndexFile(f.path));

    // Prepare insert statement
    const insert = db.prepare(
      'INSERT INTO notes_fts (path, title, content) VALUES (?, ?, ?)'
    );

    // Index files in a transaction for performance
    const insertMany = db.transaction((filesToIndex: typeof indexableFiles) => {
      let indexed = 0;
      for (const file of filesToIndex) {
        try {
          const stats = fs.statSync(file.absolutePath);
          if (stats.size > MAX_INDEX_FILE_SIZE) {
            continue; // Skip very large files
          }

          const content = fs.readFileSync(file.absolutePath, 'utf-8');

          // Extract title from filename
          const title = file.path.replace(/\.md$/, '').split('/').pop() || file.path;

          insert.run(file.path, title, content);
          indexed++;
        } catch (err) {
          // Skip files we can't read
          console.error(`[FTS5] Skipping ${file.path}:`, err);
        }
      }
      return indexed;
    });

    const indexed = insertMany(indexableFiles);

    // Update metadata
    const now = new Date();
    db.prepare(
      'INSERT OR REPLACE INTO fts_metadata (key, value) VALUES (?, ?)'
    ).run('last_built', now.toISOString());

    state = {
      ready: true,
      lastBuilt: now,
      noteCount: indexed,
      error: null,
    };

    console.error(`[FTS5] Indexed ${indexed} notes`);
    return state;
  } catch (err) {
    state = {
      ready: false,
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
    // Use snippet() to get highlighted matches with context
    const stmt = db.prepare(`
      SELECT
        path,
        title,
        snippet(notes_fts, 2, '[', ']', '...', 20) as snippet
      FROM notes_fts
      WHERE notes_fts MATCH ?
      ORDER BY rank
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
 * Close the database connection
 * Note: With injected db, this is a no-op since the StateDb owns the connection.
 */
export function closeFTS5(): void {
  // Don't close - the StateDb owns the connection lifecycle
  db = null;
  state = {
    ready: false,
    lastBuilt: null,
    noteCount: 0,
    error: null,
  };
}
