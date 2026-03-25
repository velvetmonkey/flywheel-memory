/**
 * SQLite Query Functions
 *
 * All database query operations: entity search, recency, write state,
 * flywheel config, merge dismissals, metadata, vault index cache,
 * and content hashes.
 */

import * as fs from 'fs';
import type { EntityCategory, EntityWithAliases, EntityIndex } from './types.js';
import type { StateDb, EntitySearchResult, RecencyRow, StateDbMetadata } from './sqlite.js';
import { getStateDbPath } from './migrations.js';

// =============================================================================
// Entity Operations
// =============================================================================

/**
 * Search entities using FTS5 with porter stemming
 *
 * @param stateDb - State database instance
 * @param query - Search query (supports FTS5 syntax)
 * @param limit - Maximum results to return
 * @returns Array of matching entities with relevance scores
 */
export function searchEntities(
  stateDb: StateDb,
  query: string,
  limit: number = 20
): EntitySearchResult[] {
  const escapedQuery = escapeFts5Query(query);

  // Handle empty query - return empty results
  if (!escapedQuery) {
    return [];
  }

  const rows = stateDb.searchEntitiesFts.all(escapedQuery, limit) as Array<{
    id: number;
    name: string;
    name_lower: string;
    path: string;
    category: string;
    aliases_json: string | null;
    hub_score: number;
    description: string | null;
    rank: number;
  }>;

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    nameLower: row.name_lower,
    path: row.path,
    category: row.category as EntityCategory,
    aliases: row.aliases_json ? JSON.parse(row.aliases_json) : [],
    hubScore: row.hub_score,
    description: row.description ?? undefined,
    rank: row.rank,
  }));
}

/**
 * Search entities by prefix for autocomplete
 *
 * @param stateDb - State database instance
 * @param prefix - Prefix to search for
 * @param limit - Maximum results to return
 */
export function searchEntitiesPrefix(
  stateDb: StateDb,
  prefix: string,
  limit: number = 20
): EntitySearchResult[] {
  return searchEntities(stateDb, `${escapeFts5Query(prefix)}*`, limit);
}

/**
 * Get entity by exact name (case-insensitive)
 */
export function getEntityByName(
  stateDb: StateDb,
  name: string
): EntitySearchResult | null {
  const row = stateDb.getEntityByName.get(name.toLowerCase()) as {
    id: number;
    name: string;
    name_lower: string;
    path: string;
    category: string;
    aliases_json: string | null;
    hub_score: number;
    description: string | null;
  } | undefined;

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    nameLower: row.name_lower,
    path: row.path,
    category: row.category as EntityCategory,
    aliases: row.aliases_json ? JSON.parse(row.aliases_json) : [],
    hubScore: row.hub_score,
    description: row.description ?? undefined,
    rank: 0,
  };
}

/**
 * Get all entities from the database
 */
export function getAllEntitiesFromDb(stateDb: StateDb): EntitySearchResult[] {
  const rows = stateDb.getAllEntities.all() as Array<{
    id: number;
    name: string;
    name_lower: string;
    path: string;
    category: string;
    aliases_json: string | null;
    hub_score: number;
    description: string | null;
  }>;

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    nameLower: row.name_lower,
    path: row.path,
    category: row.category as EntityCategory,
    aliases: row.aliases_json ? JSON.parse(row.aliases_json) : [],
    hubScore: row.hub_score,
    description: row.description ?? undefined,
    rank: 0,
  }));
}

/**
 * Convert database entities back to EntityIndex format
 */
export function getEntityIndexFromDb(stateDb: StateDb): EntityIndex {
  const entities = getAllEntitiesFromDb(stateDb);

  const index: EntityIndex = {
    technologies: [],
    acronyms: [],
    people: [],
    projects: [],
    organizations: [],
    locations: [],
    concepts: [],
    animals: [],
    media: [],
    events: [],
    documents: [],
    vehicles: [],
    health: [],
    finance: [],
    food: [],
    hobbies: [],
    periodical: [],
    other: [],
    _metadata: {
      total_entities: entities.length,
      generated_at: new Date().toISOString(),
      vault_path: stateDb.vaultPath,
      source: 'vault-core sqlite',
    },
  };

  for (const entity of entities) {
    const entityObj: EntityWithAliases = {
      name: entity.name,
      path: entity.path,
      aliases: entity.aliases,
      hubScore: entity.hubScore,
      description: entity.description,
    };
    index[entity.category].push(entityObj);
  }

  return index;
}

/**
 * Get entities that have a given alias (case-insensitive)
 *
 * @param stateDb - State database instance
 * @param alias - Alias to search for (case-insensitive)
 * @returns Array of matching entities
 */
export function getEntitiesByAlias(
  stateDb: StateDb,
  alias: string
): EntitySearchResult[] {
  const rows = stateDb.getEntitiesByAlias.all(alias.toLowerCase()) as Array<{
    id: number;
    name: string;
    name_lower: string;
    path: string;
    category: string;
    aliases_json: string | null;
    hub_score: number;
    description: string | null;
  }>;

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    nameLower: row.name_lower,
    path: row.path,
    category: row.category as EntityCategory,
    aliases: row.aliases_json ? JSON.parse(row.aliases_json) : [],
    hubScore: row.hub_score,
    description: row.description ?? undefined,
    rank: 0,
  }));
}

// =============================================================================
// Recency Operations
// =============================================================================

/**
 * Record a mention of an entity
 */
export function recordEntityMention(
  stateDb: StateDb,
  entityName: string,
  mentionedAt: Date = new Date()
): void {
  stateDb.upsertRecency.run(
    entityName.toLowerCase(),
    mentionedAt.getTime()
  );
}

/**
 * Get recency info for an entity
 */
export function getEntityRecency(
  stateDb: StateDb,
  entityName: string
): RecencyRow | null {
  const row = stateDb.getRecency.get(entityName.toLowerCase()) as {
    entity_name_lower: string;
    last_mentioned_at: number;
    mention_count: number;
  } | undefined;

  if (!row) return null;

  return {
    entityNameLower: row.entity_name_lower,
    lastMentionedAt: row.last_mentioned_at,
    mentionCount: row.mention_count,
  };
}

/**
 * Get all recency data ordered by most recent
 */
export function getAllRecency(stateDb: StateDb): RecencyRow[] {
  const rows = stateDb.getAllRecency.all() as Array<{
    entity_name_lower: string;
    last_mentioned_at: number;
    mention_count: number;
  }>;

  return rows.map(row => ({
    entityNameLower: row.entity_name_lower,
    lastMentionedAt: row.last_mentioned_at,
    mentionCount: row.mention_count,
  }));
}

// =============================================================================
// Write State Operations
// =============================================================================

/**
 * Set a write state value
 */
export function setWriteState(
  stateDb: StateDb,
  key: string,
  value: unknown
): void {
  stateDb.setWriteState.run(key, JSON.stringify(value));
}

/**
 * Get a write state value
 */
export function getWriteState<T>(stateDb: StateDb, key: string): T | null {
  const row = stateDb.getWriteState.get(key) as { value: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.value) as T;
}

/**
 * Delete a write state key
 */
export function deleteWriteState(stateDb: StateDb, key: string): void {
  stateDb.deleteWriteState.run(key);
}

// =============================================================================
// Flywheel Config Operations
// =============================================================================

/** Flywheel config row from database */
export interface FlywheelConfigRow {
  key: string;
  value: string;
}

/**
 * Set a flywheel config value
 */
export function setFlywheelConfig(
  stateDb: StateDb,
  key: string,
  value: unknown
): void {
  stateDb.setFlywheelConfigStmt.run(key, JSON.stringify(value));
}

/**
 * Get a flywheel config value
 */
export function getFlywheelConfig<T>(stateDb: StateDb, key: string): T | null {
  const row = stateDb.getFlywheelConfigStmt.get(key) as { value: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.value) as T;
}

/**
 * Get all flywheel config values as an object
 */
export function getAllFlywheelConfig(stateDb: StateDb): Record<string, unknown> {
  const rows = stateDb.getAllFlywheelConfigStmt.all() as FlywheelConfigRow[];
  const config: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      config[row.key] = JSON.parse(row.value);
    } catch {
      config[row.key] = row.value;
    }
  }
  return config;
}

/**
 * Delete a flywheel config key
 */
export function deleteFlywheelConfig(stateDb: StateDb, key: string): void {
  stateDb.deleteFlywheelConfigStmt.run(key);
}

/**
 * Save entire Flywheel config object to database
 * Stores each top-level key as a separate row
 */
export function saveFlywheelConfigToDb(
  stateDb: StateDb,
  config: Record<string, unknown>
): void {
  const transaction = stateDb.db.transaction(() => {
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined) {
        setFlywheelConfig(stateDb, key, value);
      }
    }
  });
  transaction();
}

/**
 * Load Flywheel config from database and reconstruct as typed object
 */
export function loadFlywheelConfigFromDb(stateDb: StateDb): Record<string, unknown> | null {
  const config = getAllFlywheelConfig(stateDb);
  if (Object.keys(config).length === 0) {
    return null;
  }
  return config;
}

// =============================================================================
// Merge Dismissal Operations
// =============================================================================

/**
 * Record a merge dismissal so the pair never reappears in suggestions.
 */
export function recordMergeDismissal(
  db: StateDb,
  sourcePath: string,
  targetPath: string,
  sourceName: string,
  targetName: string,
  reason: string
): void {
  const pairKey = [sourcePath, targetPath].sort().join('::');
  db.db.prepare(`INSERT OR IGNORE INTO merge_dismissals
    (pair_key, source_path, target_path, source_name, target_name, reason)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(pairKey, sourcePath, targetPath, sourceName, targetName, reason);
}

/**
 * Get all dismissed merge pair keys for filtering.
 */
export function getDismissedMergePairs(db: StateDb): Set<string> {
  const rows = db.db.prepare('SELECT pair_key FROM merge_dismissals').all() as { pair_key: string }[];
  return new Set(rows.map(r => r.pair_key));
}

// =============================================================================
// Metadata Operations
// =============================================================================

/**
 * Get database metadata
 */
export function getStateDbMetadata(stateDb: StateDb): StateDbMetadata {
  const schemaRow = stateDb.db.prepare(
    'SELECT MAX(version) as version FROM schema_version'
  ).get() as { version: number } | undefined;

  const entitiesBuiltRow = stateDb.getMetadataValue.get('entities_built_at') as { value: string } | undefined;
  const entityCountRow = stateDb.getMetadataValue.get('entity_count') as { value: string } | undefined;
  const notesBuiltRow = stateDb.getMetadataValue.get('notes_built_at') as { value: string } | undefined;
  const noteCountRow = stateDb.getMetadataValue.get('note_count') as { value: string } | undefined;

  return {
    schemaVersion: schemaRow?.version ?? 0,
    entitiesBuiltAt: entitiesBuiltRow?.value ?? null,
    entityCount: entityCountRow ? parseInt(entityCountRow.value, 10) : 0,
    notesBuiltAt: notesBuiltRow?.value ?? null,
    noteCount: noteCountRow ? parseInt(noteCountRow.value, 10) : 0,
  };
}

/**
 * Check if entity data is stale (older than threshold)
 */
export function isEntityDataStale(
  stateDb: StateDb,
  thresholdMs: number = 60 * 60 * 1000 // 1 hour default
): boolean {
  const metadata = getStateDbMetadata(stateDb);

  if (!metadata.entitiesBuiltAt) {
    return true;
  }

  const builtAt = new Date(metadata.entitiesBuiltAt).getTime();
  const age = Date.now() - builtAt;
  return age > thresholdMs;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Escape special FTS5 characters and convert to OR-joined query.
 * BM25 ranking naturally scores documents with more matching terms higher,
 * so OR semantics gives AND-like results at the top while surfacing partial matches.
 * Preserves quoted phrases as exact matches and * for prefix matching.
 */
export function escapeFts5Query(query: string): string {
  if (!query || !query.trim()) {
    return '';
  }

  // Extract quoted phrases first (preserve as AND-joined phrase matches)
  const phrases: string[] = [];
  const withoutPhrases = query.replace(/"([^"]+)"/g, (_, phrase) => {
    phrases.push(`"${phrase.replace(/"/g, '""')}"`);
    return '';
  });

  // Clean remaining tokens
  const cleaned = withoutPhrases
    .replace(/[(){}[\]^~:-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Split into tokens, skip explicit AND/OR/NOT operators
  const tokens = cleaned.split(' ').filter(t => t && t !== 'AND' && t !== 'OR' && t !== 'NOT');

  // Combine: quoted phrases + OR-joined tokens
  const parts = [...phrases];
  if (tokens.length === 1) {
    parts.push(tokens[0]);
  } else if (tokens.length > 1) {
    parts.push(tokens.join(' OR '));
  }

  return parts.join(' ') || '';
}

/**
 * Rebuild the entities_fts index from the entities table.
 * Contentless FTS5 tables don't support the 'rebuild' command,
 * so we manually delete all entries and re-insert from the entities table.
 */
export function rebuildEntitiesFts(stateDb: StateDb): void {
  stateDb.db.transaction(() => {
    stateDb.db.exec(`DELETE FROM entities_fts`);
    stateDb.db.exec(`
      INSERT INTO entities_fts(rowid, name, aliases, category)
      SELECT id, name,
        COALESCE((SELECT group_concat(value, ' ') FROM json_each(aliases_json)), ''),
        category
      FROM entities
    `);
  })();
}

/**
 * Check if the state database exists for a vault
 */
export function stateDbExists(vaultPath: string): boolean {
  const dbPath = getStateDbPath(vaultPath);
  return fs.existsSync(dbPath);
}

/**
 * Delete the state database (for testing or reset)
 */
export function deleteStateDb(vaultPath: string): void {
  const dbPath = getStateDbPath(vaultPath);
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
  // Also remove WAL and SHM files if they exist
  const walPath = dbPath + '-wal';
  const shmPath = dbPath + '-shm';
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
}

// =============================================================================
// Vault Index Cache Operations
// =============================================================================

/** Serializable VaultIndex for caching */
export interface VaultIndexCacheData {
  notes: Array<{
    path: string;
    title: string;
    aliases: string[];
    frontmatter: Record<string, unknown>;
    outlinks: Array<{ target: string; alias?: string; line: number }>;
    tags: string[];
    modified: number;
    created?: number;
  }>;
  backlinks: Array<[string, Array<{ source: string; line: number; context?: string }>]>;
  entities: Array<[string, string]>;
  prospects?: Array<[string, { displayName: string; backlinkCount: number }]>;
  tags: Array<[string, string[]]>;
  builtAt: number;
}

/** Cache metadata */
export interface VaultIndexCacheInfo {
  builtAt: Date;
  noteCount: number;
  version: number;
}

/**
 * Save VaultIndex to cache
 *
 * @param stateDb - State database instance
 * @param indexData - Serialized VaultIndex data
 */
export function saveVaultIndexCache(
  stateDb: StateDb,
  indexData: VaultIndexCacheData
): void {
  const data = JSON.stringify(indexData);
  const stmt = stateDb.db.prepare(`
    INSERT OR REPLACE INTO vault_index_cache (id, data, built_at, note_count, version)
    VALUES (1, ?, ?, ?, 1)
  `);
  stmt.run(data, indexData.builtAt, indexData.notes.length);
}

/**
 * Load VaultIndex from cache
 *
 * @param stateDb - State database instance
 * @returns Cached VaultIndex data or null if not found
 */
export function loadVaultIndexCache(
  stateDb: StateDb
): VaultIndexCacheData | null {
  const stmt = stateDb.db.prepare(`
    SELECT data, built_at, note_count FROM vault_index_cache WHERE id = 1
  `);
  const row = stmt.get() as { data: string; built_at: number; note_count: number } | undefined;

  if (!row) return null;

  try {
    return JSON.parse(row.data) as VaultIndexCacheData;
  } catch {
    return null;
  }
}

/**
 * Get cache metadata without loading full data
 */
export function getVaultIndexCacheInfo(stateDb: StateDb): VaultIndexCacheInfo | null {
  const stmt = stateDb.db.prepare(`
    SELECT built_at, note_count, version FROM vault_index_cache WHERE id = 1
  `);
  const row = stmt.get() as { built_at: number; note_count: number; version: number } | undefined;

  if (!row) return null;

  return {
    builtAt: new Date(row.built_at),
    noteCount: row.note_count,
    version: row.version,
  };
}

/**
 * Clear the vault index cache
 */
export function clearVaultIndexCache(stateDb: StateDb): void {
  stateDb.db.prepare('DELETE FROM vault_index_cache').run();
}

/**
 * Check if cache is valid (not too old and note count matches)
 *
 * @param stateDb - State database instance
 * @param actualNoteCount - Current number of notes in vault
 * @param maxAgeMs - Maximum cache age in milliseconds (default 24 hours)
 */
export function isVaultIndexCacheValid(
  stateDb: StateDb,
  actualNoteCount: number,
  maxAgeMs: number = 24 * 60 * 60 * 1000
): boolean {
  const info = getVaultIndexCacheInfo(stateDb);
  if (!info) return false;

  // Check note count matches (quick validation)
  if (info.noteCount !== actualNoteCount) return false;

  // Check age
  const age = Date.now() - info.builtAt.getTime();
  if (age > maxAgeMs) return false;

  return true;
}

// =============================================================================
// Content Hash Operations
// =============================================================================

/** Load all persisted content hashes */
export function loadContentHashes(stateDb: StateDb): Map<string, string> {
  const rows = stateDb.db.prepare(
    'SELECT path, hash FROM content_hashes'
  ).all() as Array<{ path: string; hash: string }>;
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.path, row.hash);
  }
  return map;
}

/** Persist hash changes from a watcher batch (upserts + deletes in one transaction) */
export function saveContentHashBatch(
  stateDb: StateDb,
  upserts: Array<{ path: string; hash: string }>,
  deletes: string[]
): void {
  const upsertStmt = stateDb.db.prepare(
    'INSERT OR REPLACE INTO content_hashes (path, hash, updated_at) VALUES (?, ?, ?)'
  );
  const deleteStmt = stateDb.db.prepare(
    'DELETE FROM content_hashes WHERE path = ?'
  );
  const now = Date.now();
  const runBatch = stateDb.db.transaction(() => {
    for (const { path, hash } of upserts) {
      upsertStmt.run(path, hash, now);
    }
    for (const p of deletes) {
      deleteStmt.run(p);
    }
  });
  runBatch();
}

/** Rename a hash entry (for file renames) */
export function renameContentHash(stateDb: StateDb, oldPath: string, newPath: string): void {
  stateDb.db.prepare(
    'UPDATE content_hashes SET path = ?, updated_at = ? WHERE path = ?'
  ).run(newPath, Date.now(), oldPath);
}
