/**
 * Note embedding store — index build, single-note update/remove, orphan
 * cleanup, and bulk loads for note embeddings (arch-review S8).
 * Extracted verbatim from core/read/embeddings.ts.
 */

import * as fs from 'fs';
import { scanVault } from '../vault.js';
import { SYSTEM_EXCLUDED_DIRS } from '../../shared/constants.js';
import {
  type EmbeddingRow,
  activeModelConfig,
  contentHash,
  getDb,
  setEmbeddingsBuilding,
  setEmbeddingsBuildState,
  setStoredTextVersion,
  EMBEDDING_TEXT_VERSION,
} from './runtime.js';
import { initEmbeddings, embedText } from './provider.js';

// =============================================================================
// Constants
// =============================================================================

/** Maximum file size to embed (5MB) */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// =============================================================================
// Contextual Embedding Prefix
// =============================================================================

/**
 * Build the text that gets embedded for a note. Prepends document-level context
 * (title + tags) so the embedding carries the note's identity — matching the
 * "contextual retrieval" technique (Anthropic, 2024).
 *
 * Before: raw markdown (starting with frontmatter YAML syntax)
 * After:  "Note: Emma. Tags: person, team-lead.\n\n{body without frontmatter}"
 */
export function buildNoteEmbeddingText(content: string, filePath: string): string {
  const title = filePath.replace(/\.md$/, '').split('/').pop() || '';

  // Strip frontmatter
  const fmMatch = content.match(/^---[\s\S]*?---\n([\s\S]*)$/);
  const body = fmMatch ? fmMatch[1] : content;
  const frontmatter = fmMatch ? content.slice(0, content.indexOf('---', 3) + 3) : '';

  // Extract tags — handle both array style [a, b] and list style (- a\n- b)
  const tags: string[] = [];
  const arrayMatch = frontmatter.match(/^tags:\s*\[([^\]]*)\]/m);
  if (arrayMatch) {
    tags.push(...arrayMatch[1].split(',').map(t => t.trim().replace(/['"]/g, '')).filter(Boolean));
  } else {
    // List-style: tags:\n  - foo\n  - bar
    const listMatch = frontmatter.match(/^tags:\s*\n((?:\s+-\s+.+\n?)+)/m);
    if (listMatch) {
      const items = listMatch[1].matchAll(/^\s+-\s+(.+)/gm);
      for (const m of items) tags.push(m[1].trim().replace(/['"]/g, ''));
    }
  }

  // Build context prefix
  const parts = [`Note: ${title}`];
  if (tags.length > 0) parts.push(`Tags: ${tags.slice(0, 5).join(', ')}`);

  return parts.join('. ') + '.\n\n' + body;
}

// =============================================================================
// Index Building
// =============================================================================

function shouldIndexFile(filePath: string): boolean {
  const parts = filePath.split('/');
  return !parts.some(part => SYSTEM_EXCLUDED_DIRS.has(part));
}

export interface BuildProgress {
  total: number;
  current: number;
  skipped: number;
}

/**
 * Build embeddings for all vault notes.
 * Skips notes whose content hasn't changed (by content_hash).
 *
 * @param vaultPath - Absolute path to vault root
 * @param onProgress - Optional progress callback
 */
export async function buildEmbeddingsIndex(
  vaultPath: string,
  onProgress?: (progress: BuildProgress) => void
): Promise<BuildProgress> {
  const db = getDb();
  if (!db) {
    throw new Error('Embeddings database not initialized. Call setEmbeddingsDatabase() first.');
  }

  setEmbeddingsBuilding(true);
  setEmbeddingsBuildState('building_notes');
  await initEmbeddings();

  const files = await scanVault(vaultPath);
  const indexable = files.filter(f => shouldIndexFile(f.path));

  // Load existing hashes for change detection
  const existingHashes = new Map<string, string>();
  const rows = db.prepare('SELECT path, content_hash FROM note_embeddings').all() as Array<{ path: string; content_hash: string }>;
  for (const row of rows) {
    existingHashes.set(row.path, row.content_hash);
  }

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO note_embeddings (path, embedding, content_hash, model, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const progress: BuildProgress = { total: indexable.length, current: 0, skipped: 0 };

  for (const file of indexable) {
    progress.current++;

    // Yield the event loop periodically so the MCP server stays responsive
    // during a long build. Placed at the TOP of the loop body because the
    // content-hash skip path `continue`s before the bottom — a run of
    // thousands of unchanged notes is otherwise fully synchronous.
    if (progress.current % 50 === 0) {
      await new Promise<void>(resolve => setImmediate(resolve));
    }

    try {
      const stats = fs.statSync(file.absolutePath);
      if (stats.size > MAX_FILE_SIZE) {
        progress.skipped++;
        continue;
      }

      const content = fs.readFileSync(file.absolutePath, 'utf-8');
      const hash = contentHash(content);

      // Skip if unchanged
      if (existingHashes.get(file.path) === hash) {
        progress.skipped++;
        if (onProgress) onProgress(progress);
        continue;
      }

      const embedding = await embedText(buildNoteEmbeddingText(content, file.path));
      const buf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
      upsert.run(file.path, buf, hash, activeModelConfig.id, Date.now());
    } catch (err) {
      progress.skipped++;
      if (progress.skipped <= 3) {
        console.error(`[Semantic] Failed to embed ${file.path}: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (onProgress) onProgress(progress);
  }

  // Remove embeddings for deleted notes. Guard: an empty scan over a vault
  // that previously had embeddings means the scan failed (scanVault swallows
  // a failed root readdir and returns [] silently) — deleting everything on
  // that basis is the same wipe failure mode as the FTS-orphan one.
  if (indexable.length === 0 && existingHashes.size > 0) {
    console.error(`[Semantic] Skipping deleted-note sweep: scan returned 0 indexable files but ${existingHashes.size} embeddings exist (failed vault scan?)`);
  } else {
    const currentPaths = new Set(indexable.map(f => f.path));
    const deleteStmt = db.prepare('DELETE FROM note_embeddings WHERE path = ?');
    for (const existingPath of existingHashes.keys()) {
      if (!currentPaths.has(existingPath)) {
        deleteStmt.run(existingPath);
      }
    }
  }

  // Persist the text version so startup can detect version changes without loading the model
  setStoredTextVersion(EMBEDDING_TEXT_VERSION);

  setEmbeddingsBuilding(false);
  console.error(`[Semantic] Indexed ${progress.current - progress.skipped} notes, skipped ${progress.skipped}`);
  return progress;
}

/**
 * Update embedding for a single note (used by file watcher).
 */
export async function updateEmbedding(notePath: string, absolutePath: string): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    const content = fs.readFileSync(absolutePath, 'utf-8');
    const hash = contentHash(content);

    // Check if unchanged
    const existing = db.prepare('SELECT content_hash FROM note_embeddings WHERE path = ?').get(notePath) as { content_hash: string } | undefined;
    if (existing?.content_hash === hash) return;

    const embedding = await embedText(buildNoteEmbeddingText(content, notePath));
    const buf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);

    db.prepare(`
      INSERT OR REPLACE INTO note_embeddings (path, embedding, content_hash, model, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(notePath, buf, hash, activeModelConfig.id, Date.now());
  } catch {
    // Skip files we can't process
  }
}

/**
 * Remove embedding for a deleted note.
 */
export function removeEmbedding(notePath: string): void {
  const db = getDb();
  if (!db) return;
  db.prepare('DELETE FROM note_embeddings WHERE path = ?').run(notePath);
}

/**
 * Remove note embeddings whose paths no longer exist in the vault.
 *
 * When `validPaths` is provided (the live VaultIndex path set) it is the
 * authoritative truth source and the comparison happens SQL-side under the
 * column's COLLATE NOCASE (a JS lowercased Set diverges from SQLite NOCASE
 * on non-ASCII paths). Without it, falls back to notes_fts — an UNTRUSTED
 * source guarded against the witnessed failure mode where a failed FTS5
 * rebuild left notes_fts empty and this delete wiped every embedding
 * (3,023 → 0 on 2026-06-06):
 *   - empty guard: never delete when notes_fts has zero rows
 *   - ratio guard: abort if >50% of embeddings would go in one call
 *     (a partial FTS index is never a legitimate mass-orphaning)
 */
export function removeOrphanedNoteEmbeddings(validPaths?: Set<string>): number {
  const db = getDb();
  if (!db) return 0;

  const existing = (db.prepare('SELECT COUNT(*) as cnt FROM note_embeddings').get() as { cnt: number }).cnt;
  if (existing === 0) return 0;

  if (validPaths) {
    if (validPaths.size === 0) {
      console.error(`[Semantic] Orphan cleanup skipped: empty validPaths with ${existing} note embeddings present (vault index not built?)`);
      return 0;
    }
    // Trusted source: no ratio guard — legitimate mass deletion must still clean up.
    db.exec('CREATE TEMP TABLE IF NOT EXISTS tmp_valid_note_paths (p TEXT PRIMARY KEY COLLATE NOCASE)');
    db.prepare('DELETE FROM tmp_valid_note_paths').run();
    const ins = db.prepare('INSERT OR IGNORE INTO tmp_valid_note_paths (p) VALUES (?)');
    const fill = db.transaction((paths: string[]) => {
      for (const p of paths) ins.run(p);
    });
    fill([...validPaths]);
    const result = db.prepare(
      'DELETE FROM note_embeddings WHERE path NOT IN (SELECT p FROM tmp_valid_note_paths)'
    ).run();
    db.prepare('DELETE FROM tmp_valid_note_paths').run();
    return result.changes;
  }

  const ftsCount = (db.prepare('SELECT COUNT(*) as cnt FROM notes_fts').get() as { cnt: number }).cnt;
  if (ftsCount === 0) {
    console.error(`[Semantic] Orphan cleanup skipped: notes_fts is empty but ${existing} note embeddings exist — refusing to wipe (failed/incomplete FTS rebuild?)`);
    return 0;
  }

  const wouldDelete = (db.prepare(
    'SELECT COUNT(*) as cnt FROM note_embeddings WHERE path NOT IN (SELECT path FROM notes_fts)'
  ).get() as { cnt: number }).cnt;
  if (wouldDelete > existing * 0.5) {
    console.error(`[Semantic] Orphan cleanup aborted: would delete ${wouldDelete}/${existing} embeddings (>50%) against notes_fts(${ftsCount} rows) — likely partial FTS index; pass validPaths to override with an authoritative set`);
    return 0;
  }

  const result = db.prepare(
    'DELETE FROM note_embeddings WHERE path NOT IN (SELECT path FROM notes_fts)'
  ).run();
  return result.changes;
}

/**
 * Load all note embeddings from DB as a Map<path, Float32Array>.
 * Used by graph analysis for clustering and bridge detection.
 */
export function loadAllNoteEmbeddings(): Map<string, Float32Array> {
  const db = getDb();
  const result = new Map<string, Float32Array>();
  if (!db) return result;

  try {
    const rows = db.prepare('SELECT path, embedding FROM note_embeddings').all() as EmbeddingRow[];
    for (const row of rows) {
      const embedding = new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT
      );
      result.set(row.path, embedding);
    }
  } catch {
    // Table might not exist
  }

  return result;
}

/**
 * Batch-load note embeddings for a set of paths (for MMR diversity).
 * Returns only embeddings that exist in the database.
 */
export function loadNoteEmbeddingsForPaths(paths: string[]): Map<string, Float32Array> {
  const db = getDb();
  const result = new Map<string, Float32Array>();
  if (!db || paths.length === 0) return result;

  try {
    const stmt = db.prepare('SELECT path, embedding FROM note_embeddings WHERE path = ?');
    for (const p of paths) {
      const row = stmt.get(p) as EmbeddingRow | undefined;
      if (row) {
        const embedding = new Float32Array(
          row.embedding.buffer,
          row.embedding.byteOffset,
          row.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT
        );
        result.set(p, embedding);
      }
    }
  } catch {
    // Table might not exist
  }

  return result;
}
