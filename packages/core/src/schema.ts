/**
 * SQLite Schema Constants
 *
 * Contains the schema version, file path constants, and full SQL schema
 * for the flywheel state database.
 */

// =============================================================================
// Constants
// =============================================================================

/** Current schema version - bump when schema changes */
export const SCHEMA_VERSION = 31;

/** State database filename */
export const STATE_DB_FILENAME = 'state.db';

/** Directory for flywheel state */
export const FLYWHEEL_DIR = '.flywheel';

// =============================================================================
// Schema
// =============================================================================

export const SCHEMA_SQL = `
-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT DEFAULT (datetime('now'))
);

-- Metadata key-value store
CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Entity index (replaces wikilink-entities.json)
CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  name_lower TEXT NOT NULL,
  path TEXT NOT NULL,
  category TEXT NOT NULL,
  aliases_json TEXT,
  hub_score INTEGER DEFAULT 0,
  description TEXT
);
CREATE INDEX IF NOT EXISTS idx_entities_name_lower ON entities(name_lower);
CREATE INDEX IF NOT EXISTS idx_entities_category ON entities(category);

-- FTS5 for entity search with porter stemmer
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
  name, aliases, category,
  content='entities', content_rowid='id',
  tokenize='porter unicode61'
);

-- Auto-sync triggers for entities_fts
CREATE TRIGGER IF NOT EXISTS entities_ai AFTER INSERT ON entities BEGIN
  INSERT INTO entities_fts(rowid, name, aliases, category)
  VALUES (
    new.id,
    new.name,
    COALESCE((SELECT group_concat(value, ' ') FROM json_each(new.aliases_json)), ''),
    new.category
  );
END;

CREATE TRIGGER IF NOT EXISTS entities_ad AFTER DELETE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name, aliases, category)
  VALUES (
    'delete',
    old.id,
    old.name,
    COALESCE((SELECT group_concat(value, ' ') FROM json_each(old.aliases_json)), ''),
    old.category
  );
END;

CREATE TRIGGER IF NOT EXISTS entities_au AFTER UPDATE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name, aliases, category)
  VALUES (
    'delete',
    old.id,
    old.name,
    COALESCE((SELECT group_concat(value, ' ') FROM json_each(old.aliases_json)), ''),
    old.category
  );
  INSERT INTO entities_fts(rowid, name, aliases, category)
  VALUES (
    new.id,
    new.name,
    COALESCE((SELECT group_concat(value, ' ') FROM json_each(new.aliases_json)), ''),
    new.category
  );
END;

-- Recency tracking (replaces entity-recency.json)
CREATE TABLE IF NOT EXISTS recency (
  entity_name_lower TEXT PRIMARY KEY,
  last_mentioned_at INTEGER NOT NULL,
  mention_count INTEGER DEFAULT 1
);

-- Write state (replaces last-commit.json and other write state)
CREATE TABLE IF NOT EXISTS write_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Content search FTS5 (migrated from vault-search.db)
-- v11: Added frontmatter column for weighted search (path, title, frontmatter, content)
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  path, title, frontmatter, content,
  tokenize='porter'
);

-- FTS5 build metadata (consolidated from vault-search.db)
CREATE TABLE IF NOT EXISTS fts_metadata (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Vault index cache (for fast startup)
-- Stores serialized VaultIndex to avoid full rebuild on startup
CREATE TABLE IF NOT EXISTS vault_index_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data BLOB NOT NULL,
  built_at INTEGER NOT NULL,
  note_count INTEGER NOT NULL,
  version INTEGER DEFAULT 1
);

-- Flywheel configuration (replaces .flywheel.json)
CREATE TABLE IF NOT EXISTS flywheel_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Vault metrics (v4: growth tracking)
CREATE TABLE IF NOT EXISTS vault_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vault_metrics_ts ON vault_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_vault_metrics_m ON vault_metrics(metric, timestamp);

-- Wikilink feedback (v4: quality tracking)
CREATE TABLE IF NOT EXISTS wikilink_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  context TEXT NOT NULL,
  note_path TEXT NOT NULL,
  correct INTEGER NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wl_feedback_entity ON wikilink_feedback(entity);
CREATE INDEX IF NOT EXISTS idx_wl_feedback_note_path ON wikilink_feedback(note_path);

-- Wikilink suppressions (v4: auto-suppress false positives)
CREATE TABLE IF NOT EXISTS wikilink_suppressions (
  entity TEXT PRIMARY KEY,
  false_positive_rate REAL NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Wikilink applications tracking (v5: implicit feedback)
CREATE TABLE IF NOT EXISTS wikilink_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  note_path TEXT NOT NULL,
  applied_at TEXT DEFAULT (datetime('now')),
  status TEXT DEFAULT 'applied'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wl_apps_unique ON wikilink_applications(entity COLLATE NOCASE, note_path);

-- Index events tracking (v6: index activity history)
CREATE TABLE IF NOT EXISTS index_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  trigger TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  success INTEGER NOT NULL DEFAULT 1,
  note_count INTEGER,
  files_changed INTEGER,
  changed_paths TEXT,
  error TEXT,
  steps TEXT
);
CREATE INDEX IF NOT EXISTS idx_index_events_ts ON index_events(timestamp);

-- Tool invocation tracking (v7: usage analytics)
CREATE TABLE IF NOT EXISTS tool_invocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  session_id TEXT,
  note_paths TEXT,
  duration_ms INTEGER,
  success INTEGER NOT NULL DEFAULT 1,
  response_tokens INTEGER,
  baseline_tokens INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tool_inv_ts ON tool_invocations(timestamp);
CREATE INDEX IF NOT EXISTS idx_tool_inv_tool ON tool_invocations(tool_name, timestamp);
CREATE INDEX IF NOT EXISTS idx_tool_inv_session ON tool_invocations(session_id, timestamp);

-- Graph topology snapshots (v8: structural evolution)
CREATE TABLE IF NOT EXISTS graph_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  details TEXT
);
CREATE INDEX IF NOT EXISTS idx_graph_snap_ts ON graph_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_graph_snap_m ON graph_snapshots(metric, timestamp);

-- Note embeddings for semantic search (v9)
CREATE TABLE IF NOT EXISTS note_embeddings (
  path TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  content_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Entity embeddings for semantic entity search (v10)
CREATE TABLE IF NOT EXISTS entity_embeddings (
  entity_name TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  source_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Task cache for fast task queries (v12)
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  line INTEGER NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  raw TEXT NOT NULL,
  context TEXT,
  tags_json TEXT,
  due_date TEXT,
  UNIQUE(path, line)
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_path ON tasks(path);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);

-- Merge dismissals (v13: persistent merge pair suppression)
CREATE TABLE IF NOT EXISTS merge_dismissals (
  pair_key TEXT PRIMARY KEY,
  source_path TEXT NOT NULL,
  target_path TEXT NOT NULL,
  source_name TEXT NOT NULL,
  target_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  dismissed_at TEXT DEFAULT (datetime('now'))
);

-- Suggestion events audit log (v15: pipeline observability)
CREATE TABLE IF NOT EXISTS suggestion_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  note_path TEXT NOT NULL,
  entity TEXT NOT NULL,
  total_score REAL NOT NULL,
  breakdown_json TEXT NOT NULL,
  threshold REAL NOT NULL,
  passed INTEGER NOT NULL,
  strictness TEXT NOT NULL,
  applied INTEGER DEFAULT 0,
  pipeline_event_id INTEGER,
  UNIQUE(timestamp, note_path, entity)
);
CREATE INDEX IF NOT EXISTS idx_suggestion_entity ON suggestion_events(entity);
CREATE INDEX IF NOT EXISTS idx_suggestion_note ON suggestion_events(note_path);

-- Forward-link persistence for diff-based feedback (v16), edge weights (v22)
CREATE TABLE IF NOT EXISTS note_links (
  note_path TEXT NOT NULL,
  target TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  weight_updated_at INTEGER,
  PRIMARY KEY (note_path, target)
);

-- Entity field change audit log (v17)
CREATE TABLE IF NOT EXISTS entity_changes (
  entity TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (entity, field, changed_at)
);

-- Note tag persistence for diff-based feedback (v18)
CREATE TABLE IF NOT EXISTS note_tags (
  note_path TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (note_path, tag)
);

-- Wikilink survival tracking for positive feedback signals (v19)
CREATE TABLE IF NOT EXISTS note_link_history (
  note_path TEXT NOT NULL,
  target TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  edits_survived INTEGER NOT NULL DEFAULT 0,
  last_positive_at TEXT,
  PRIMARY KEY (note_path, target)
);

-- Note move history (v20): records when files are moved/renamed to a different folder
CREATE TABLE IF NOT EXISTS note_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  old_path TEXT NOT NULL,
  new_path TEXT NOT NULL,
  moved_at TEXT NOT NULL DEFAULT (datetime('now')),
  old_folder TEXT,
  new_folder TEXT
);
CREATE INDEX IF NOT EXISTS idx_note_moves_old_path ON note_moves(old_path);
CREATE INDEX IF NOT EXISTS idx_note_moves_new_path ON note_moves(new_path);
CREATE INDEX IF NOT EXISTS idx_note_moves_moved_at ON note_moves(moved_at);

-- Corrections (v24): persistent correction records from user/engine feedback
CREATE TABLE IF NOT EXISTS corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT,
  note_path TEXT,
  correction_type TEXT NOT NULL,
  description TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user',
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_corrections_status ON corrections(status);
CREATE INDEX IF NOT EXISTS idx_corrections_entity ON corrections(entity);

-- Memories (v26): lightweight key-value working memory for agents
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  entity TEXT,
  entities_json TEXT,
  source_agent_id TEXT,
  source_session_id TEXT,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  accessed_at INTEGER NOT NULL,
  ttl_days INTEGER,
  superseded_by INTEGER REFERENCES memories(id),
  visibility TEXT NOT NULL DEFAULT 'shared'
);
CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key);
CREATE INDEX IF NOT EXISTS idx_memories_entity ON memories(entity);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  key, value,
  content=memories, content_rowid=id,
  tokenize='porter unicode61'
);

-- Auto-sync triggers for memories_fts
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, key, value)
  VALUES (new.id, new.key, new.value);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, key, value)
  VALUES ('delete', old.id, old.key, old.value);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, key, value)
  VALUES ('delete', old.id, old.key, old.value);
  INSERT INTO memories_fts(rowid, key, value)
  VALUES (new.id, new.key, new.value);
END;

-- Co-occurrence cache (v27): persist co-occurrence index to avoid full vault scan on restart
CREATE TABLE IF NOT EXISTS cooccurrence_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  built_at INTEGER NOT NULL,
  entity_count INTEGER NOT NULL,
  association_count INTEGER NOT NULL
);

-- Content hashes (v28): persist watcher content hashes across restarts
CREATE TABLE IF NOT EXISTS content_hashes (
  path TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Session summaries (v26): agent session tracking
CREATE TABLE IF NOT EXISTS session_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  topics_json TEXT,
  notes_modified_json TEXT,
  agent_id TEXT,
  started_at INTEGER,
  ended_at INTEGER NOT NULL,
  tool_count INTEGER
);

-- Retrieval co-occurrence (v30): notes retrieved together build implicit edges
CREATE TABLE IF NOT EXISTS retrieval_cooccurrence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_a TEXT NOT NULL,
  note_b TEXT NOT NULL,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  UNIQUE(note_a, note_b, session_id)
);
CREATE INDEX IF NOT EXISTS idx_retcooc_notes ON retrieval_cooccurrence(note_a, note_b);
CREATE INDEX IF NOT EXISTS idx_retcooc_ts ON retrieval_cooccurrence(timestamp);

-- Deferred proactive linking queue (v31)
CREATE TABLE IF NOT EXISTS proactive_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_path TEXT NOT NULL,
  entity TEXT NOT NULL,
  score REAL NOT NULL,
  confidence TEXT NOT NULL,
  queued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  applied_at INTEGER,
  UNIQUE(note_path, entity)
);
CREATE INDEX IF NOT EXISTS idx_pq_status ON proactive_queue(status, expires_at);
`;
