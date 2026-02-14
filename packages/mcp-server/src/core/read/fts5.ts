/**
 * FTS5 Full-Text Search Module
 *
 * Provides SQLite FTS5-based full-text search for vault content.
 * Features:
 * - Porter stemming (running matches run, runs, ran)
 * - Phrase search with quotes
 * - Boolean operators (AND, OR, NOT)
 * - Prefix matching with *
 * - Highlighted snippets in results
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
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
 * Get the database path for a vault
 */
function getDbPath(vaultPath: string): string {
  const claudeDir = path.join(vaultPath, '.claude');
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }
  return path.join(claudeDir, 'vault-search.db');
}

/**
 * Initialize the FTS5 database
 */
function initDatabase(vaultPath: string): Database.Database {
  const dbPath = getDbPath(vaultPath);
  const database = new Database(dbPath);

  // Create FTS5 virtual table with porter tokenizer for stemming
  database.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      path,
      title,
      content,
      tokenize='porter'
    );

    CREATE TABLE IF NOT EXISTS fts_metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  return database;
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

    // Initialize database
    db = initDatabase(vaultPath);

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
export function isIndexStale(vaultPath: string): boolean {
  const dbPath = getDbPath(vaultPath);

  // No database = definitely stale
  if (!fs.existsSync(dbPath)) {
    return true;
  }

  // Check last build time from metadata
  try {
    const database = new Database(dbPath, { readonly: true });
    const row = database.prepare(
      'SELECT value FROM fts_metadata WHERE key = ?'
    ).get('last_built') as { value: string } | undefined;
    database.close();

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
 * Ensure database is ready for queries
 */
function ensureDb(vaultPath: string): Database.Database {
  if (!db) {
    const dbPath = getDbPath(vaultPath);
    if (!fs.existsSync(dbPath)) {
      throw new Error('Search index not built. Call rebuild_search_index first.');
    }
    db = new Database(dbPath);
  }
  return db;
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
  vaultPath: string,
  query: string,
  limit: number = 10
): FTS5Result[] {
  const database = ensureDb(vaultPath);

  try {
    // Use snippet() to get highlighted matches with context
    const stmt = database.prepare(`
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
 */
export function closeFTS5(): void {
  if (db) {
    db.close();
    db = null;
  }
}
