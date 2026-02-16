# Architecture

Flywheel Memory is a single MCP server that gives AI agents full read/write access to Obsidian vaults. It builds an in-memory index of every note, then exposes 42 tools for search, graph queries, and mutations.

---

## Source Structure

```
packages/
├── mcp-server/                  # The MCP server (published as @velvetmonkey/flywheel-memory)
│   └── src/
│       ├── index.ts             # Entry point, tool preset gating, startup
│       ├── tools/
│       │   ├── read/            # Read tool registrations
│       │   │   ├── query.ts     # search (unified: metadata + content + entities)
│       │   │   ├── graph.ts     # get_backlinks (+ bidirectional), get_forward_links
│       │   │   ├── graphAdvanced.ts  # get_link_path, get_common_neighbors, get_connection_strength
│       │   │   ├── graphAnalysis.ts  # graph_analysis (unified: orphans, dead_ends, sources, hubs, stale)
│       │   │   ├── vaultSchema.ts    # vault_schema (unified: overview, field_values, inconsistencies, validate, conventions, incomplete)
│       │   │   ├── noteIntelligence.ts # note_intelligence (unified: prose_patterns, suggest_frontmatter, suggest_wikilinks, cross_layer, compute)
│       │   │   ├── primitives.ts     # get_note_structure, get_section_content, find_sections, tasks
│       │   │   ├── health.ts    # health_check, get_vault_stats (+ recent_activity), get_folder_structure
│       │   │   ├── system.ts    # refresh_index, get_all_entities, get_note_metadata, get_unlinked_mentions
│       │   │   ├── wikilinks.ts # suggest_wikilinks, validate_links (+ typo detection)
│       │   │   └── migrations.ts # rename_field, migrate_field_values
│       │   └── write/           # Write tool registrations
│       │       ├── mutations.ts # vault_add_to_section, vault_remove_from_section, vault_replace_in_section
│       │       ├── tasks.ts     # vault_toggle_task, vault_add_task
│       │       ├── notes.ts     # vault_create_note, vault_delete_note
│       │       ├── move-notes.ts # vault_move_note, vault_rename_note (with backlink updates)
│       │       ├── frontmatter.ts # vault_update_frontmatter (+ only_if_missing)
│       │       ├── system.ts    # vault_undo_last_mutation
│       │       └── policy.ts    # policy (unified: list, validate, preview, execute, author, revise)
│       └── core/
│           ├── read/            # Read-side core logic
│           │   ├── graph.ts     # Index building, backlinks, hubs, orphans, path finding
│           │   ├── vault.ts     # Vault scanner (find all .md files)
│           │   ├── parser.ts    # Note parser (frontmatter, outlinks, tags)
│           │   ├── fts5.ts      # FTS5 full-text search
│           │   ├── embeddings.ts # Embedding generation (all-MiniLM-L6-v2)
│           │   ├── similarity.ts # Semantic similarity search
│           │   ├── semantic.ts  # Hybrid search (BM25 + semantic via RRF)
│           │   ├── config.ts    # Config inference and storage
│           │   ├── types.ts     # VaultIndex, VaultNote, Backlink types
│           │   ├── constants.ts # MAX_LIMIT and other constants
│           │   ├── indexGuard.ts # Require-index-ready guard
│           │   └── watch/       # File watcher subsystem
│           │       ├── index.ts          # Vault watcher factory
│           │       ├── eventQueue.ts     # Per-path debouncing
│           │       ├── batchProcessor.ts # Event coalescing
│           │       ├── incrementalIndex.ts # Incremental index updates
│           │       ├── pathFilter.ts     # Path filtering (.obsidian, .git, etc.)
│           │       └── selfHeal.ts       # Error recovery
│           ├── write/           # Write-side core logic
│           │   ├── writer.ts    # File read/write, section finding, content insertion
│           │   ├── wikilinks.ts # Auto-wikilink application on writes
│           │   ├── git.ts       # Git commit, undo, diff
│           │   ├── validator.ts # Input validation and normalization
│           │   ├── hints.ts     # Mutation hints
│           │   ├── mutation-helpers.ts # Shared helpers (withVaultFile, error handling)
│           │   └── policy/      # Policy execution engine
│           │       ├── executor.ts  # Policy runner
│           │       ├── parser.ts    # YAML policy parser
│           │       ├── schema.ts    # Policy schema validation
│           │       ├── conditions.ts # Conditional execution
│           │       ├── template.ts  # Variable templating
│           │       ├── storage.ts   # Policy file storage
│           │       └── types.ts     # Policy types
│           └── shared/          # Shared between read/write
│               ├── recency.ts   # Entity recency tracking
│               ├── cooccurrence.ts # Co-occurrence analysis
│               ├── hubExport.ts # Hub score export to StateDb
│               └── stemmer.ts   # Porter stemming
├── core/                        # Shared library (@velvetmonkey/vault-core)
│   └── src/
│       ├── sqlite.ts            # SQLite StateDb (consolidated state)
│       ├── wikilinks.ts         # Wikilink application engine
│       ├── entities.ts          # Entity scanning and categorization
│       ├── protectedZones.ts    # Code/frontmatter/link zone detection
│       └── types.ts             # Shared types
├── bench/                       # Benchmark harness
└── demos/                       # Demo vault builder
```

---

## Startup Flow

1. **Detect vault root** -- `findVaultRoot()` walks up from cwd looking for `.obsidian/` or `.mcp.json`
2. **Open StateDb** -- `openStateDb(vaultPath)` creates/opens `.flywheel/state.db` (SQLite with WAL mode)
3. **Initialize entity index** -- Loads entities from StateDb for auto-wikilinks
4. **Connect MCP transport** -- `StdioServerTransport` for Claude Code / Claude Desktop
5. **Load index from cache** -- Checks `vault_index_cache` table in StateDb (valid if note count matches within 5% and age < 24h)
6. **Build index if cache miss** -- Scans all `.md` files, parses notes in parallel (concurrency limit: 50), builds backlink/entity/tag maps
7. **Post-index work** -- Scans vault entities, exports hub scores, infers config (periodic note folders, templates, etc.), starts file watcher

---

## Index Strategy

### In-Memory VaultIndex

The primary data structure is `VaultIndex`, built at startup and held in memory:

```typescript
interface VaultIndex {
  notes: Map<string, VaultNote>;       // path -> note metadata
  backlinks: Map<string, Backlink[]>;  // normalized target -> sources
  entities: Map<string, string>;       // normalized name/alias -> path
  tags: Map<string, Set<string>>;      // tag -> set of note paths
  builtAt: Date;
}
```

**VaultNote** stores: path, title, aliases, frontmatter, outlinks, tags, modified, created.

**Performance:** Index build uses parallel parsing with `Promise.allSettled` in batches of 50 files. Progress is reported every 100 files. 5-minute timeout protects against runaway indexing.

### Index Caching

The VaultIndex is serialized to JSON and stored in the `vault_index_cache` table in StateDb. On startup:

- If cached index exists, note count matches within 5%, and age < 24 hours: **cache hit** (startup in ~100ms)
- Otherwise: **full rebuild** (seconds for small vaults, 30-60s for 10k+ notes)

### File Watcher

Chokidar-based watcher with per-path debouncing (default 200ms), event coalescing, backpressure handling, and error recovery. Any `.md` change triggers an index rebuild after the debounce period, updating the VaultIndex, entity index, hub scores, and index cache. Polling mode available for network drives and WSL (`FLYWHEEL_WATCH_POLL=true`).

---

## SQLite FTS5 Full-Text Search

Two FTS5 indexes, both in `.flywheel/state.db`:

### Content Search (`notes_fts` in `state.db`)

- Indexes all `.md` file content with Porter stemming
- Stored in `.flywheel/state.db`
- Supports: simple terms, phrases (`"exact match"`), boolean operators (`AND`, `OR`, `NOT`), prefix matching (`auth*`), column filters (`title:api`)
- BM25 ranking with highlighted snippets
- Auto-rebuilds when stale (>1 hour)
- Max file size: 5MB

### Entity Search (`entities_fts` in `state.db`)

- FTS5 virtual table backed by the `entities` table
- Porter stemmer with unicode61 tokenizer
- Auto-synced via SQLite triggers on insert/update/delete
- Used by `search` tool (entity mode)

---

## Semantic Search & Embeddings

Optional semantic search layer that complements FTS5 keyword search. Built on-demand via the `init_semantic` tool.

### Embeddings Module

The `embeddings.ts` module generates vector embeddings for note content using the `all-MiniLM-L6-v2` model from Hugging Face Transformers. The model is downloaded automatically to `~/.cache/huggingface/` on first use. Each note's content is chunked and embedded into a 384-dimensional vector.

### Storage

Embeddings are stored in the `note_embeddings` table in StateDb (`.flywheel/state.db`). Each row maps a note path to its embedding vector and a content hash for staleness detection.

### Hybrid Search

The `semantic.ts` module merges BM25 keyword results (from FTS5) with semantic similarity results (from cosine distance on embeddings) using **Reciprocal Rank Fusion (RRF)**. RRF combines two ranked lists by summing `1 / (k + rank)` for each result across both lists, producing a single ranking that benefits from keyword precision and semantic recall.

When embeddings exist, `search` (content scope) and `find_similar` automatically upgrade to hybrid mode. When embeddings are not available, both tools fall back to FTS5-only mode with no degradation.

### File Watcher Integration

The file watcher automatically generates embeddings for new and modified notes after the initial build, keeping the semantic index up to date without requiring manual rebuilds.

### Entity Embeddings

In addition to note-level embeddings, Flywheel builds entity-level embeddings for semantic wikilink scoring and graph analysis.

**Text composition:** Each entity's embedding text is composed from:
- Entity name (doubled for emphasis)
- Aliases
- Category (people, projects, technologies, etc.)
- First 500 characters of the entity's backing note body

**Storage:** `entity_embeddings` table in StateDb (path, name, vector, content hash).

**Loading:** `loadEntityEmbeddingsToMemory()` loads all entity embeddings into an in-memory Map at startup. Layer 11 scoring queries this Map directly — no database access in the hot path (<1ms for 500 entities).

**Incremental updates:** The file watcher detects when an entity's backing note changes and regenerates its embedding. Entity additions and removals are handled on index rebuild.

**Integration points:**
- **Layer 11 scoring** in `suggestRelatedLinks()` — cosine similarity against in-memory entity embeddings
- **Semantic graph analysis** — `semantic_clusters` and `semantic_bridges` modes
- **Semantic note intelligence** — `semantic_links` mode
- **Preflight duplicate detection** — `vault_create_note` checks semantic similarity before creation
- **Broken link fallback** — `validate_links` uses embedding similarity to suggest corrections

---

## Knowledge Graph

### Backlinks

Every note's outlinks are parsed at index time. The backlink map inverts this: for any note, you can instantly find all notes that link to it.

- **Resolution:** Links are resolved case-insensitively against note titles, full paths (without `.md`), and aliases
- **Normalization:** All targets are lowercased and `.md` stripped for matching
- **Performance:** Backlink lookup is O(1) via Map

### Forward Links

Each `VaultNote` stores its outlinks with: target string, optional alias, line number. The `get_forward_links` tool resolves each target against the entity map to determine if the target exists.

### Hub Detection

`find_hub_notes` counts backlinks + forward links for every note and returns those above a threshold (default: 5). Hub scores are exported to StateDb for use by the auto-wikilink system.

### Path Finding

`get_link_path` implements BFS from source to target, following outlinks at each hop. Returns the shortest path as a list of note paths, or reports no path found. Max depth is configurable (default: 10).

### Orphan and Dead-End Detection

- **Orphans:** Notes with zero backlinks (no other note links to them)
- **Dead ends:** Notes with backlinks but zero outlinks (consume but don't contribute)
- **Sources:** Notes with outlinks but zero backlinks (contribute but aren't referenced)

---

## Auto-Wikilinks

When Claude writes content through any mutation tool (`vault_add_to_section`, `vault_create_note`, `vault_add_task`, `vault_replace_in_section`), Flywheel automatically scans the text for mentions of known entities and wraps them in `[[wikilinks]]`.

### How It Works

1. **Entity index:** At startup, the vault is scanned for all note titles and frontmatter aliases. These become the entity list.
2. **Protected zones:** Before linking, the engine identifies regions to skip: existing wikilinks, code blocks, frontmatter, headings, URLs, HTML, footnotes.
3. **Matching:** Entities are sorted longest-first to prevent partial matches. Case-insensitive word-boundary matching finds all occurrences.
4. **First-occurrence mode (default):** Only the first mention of each entity is linked, to avoid over-linking.
5. **Alias resolution:** If content matches an alias, the link resolves to the canonical entity name: `[[Entity Name|alias text]]`.
6. **Zone updates:** After each link insertion, protected zone positions are shifted to account for the added characters.

### Implicit Entity Detection

Optional pattern-based detection for entities that don't have existing files:

- **Multi-word proper nouns** (e.g., "Marcus Johnson", "Project Alpha")
- **Quoted terms** (e.g., `"Turbopump"` becomes `[[Turbopump]]`)
- **Single capitalized words** after lowercase text (opt-in)

Common words, sentence starters, and technical terms are excluded to minimize false positives.

### Outgoing Link Suggestions

Write tools can optionally append suggested outgoing links based on content analysis. For example, after adding a note about "React migration", the tool might append: `-> [[React]], [[Migration Plan]]`.

---

## StateDb (Consolidated State)

All persistent state is stored in a single SQLite database at `.flywheel/state.db`:

| Table | Purpose |
|-------|---------|
| `entities` | Entity index (name, path, category, aliases, hub score) |
| `entities_fts` | FTS5 virtual table for entity search |
| `notes_fts` | FTS5 content search index |
| `fts_metadata` | FTS rebuild tracking (last rebuild time, counts) |
| `recency` | Entity recency tracking (last mentioned, mention count) |
| `vault_index_cache` | Serialized VaultIndex for fast startup |
| `flywheel_config` | Configuration key-value store |
| `write_state` | Write-side state (last commit, mutation hints) |
| `metadata` | Schema version, build timestamps, counts |
| `schema_version` | Schema migration tracking |
| `vault_metrics` | Growth tracking metrics |
| `wikilink_feedback` | Link quality feedback |
| `wikilink_suppressions` | Auto-suppressed false positives |
| `wikilink_applications` | Implicit feedback tracking |
| `index_events` | Index rebuild activity |
| `tool_invocations` | Tool usage analytics |
| `graph_snapshots` | Graph topology evolution |
| `note_embeddings` | Semantic search embeddings (path, vector, content hash) |
| `entity_embeddings` | Entity-level embeddings for semantic scoring (path, name, vector, content hash) |

**Database settings:** WAL journal mode for concurrent read performance. Foreign keys enabled. Schema version tracking with migration support.

---

## Schema Versioning

The StateDb schema is versioned via the `SCHEMA_VERSION` constant in `packages/core/src/sqlite.ts`.

### Migration Pattern

`initSchema()` runs `SCHEMA_SQL` (a set of `CREATE TABLE IF NOT EXISTS` statements) to ensure all tables exist, then checks the current schema version stored in the `schema_version` table. If the stored version is behind `SCHEMA_VERSION`, version-specific migration blocks run in order to bring the database up to date.

New tables are added directly to `SCHEMA_SQL` with `CREATE TABLE IF NOT EXISTS`, so they are created automatically on first open. Version-specific migrations only handle renames, drops, and data transformations that can't be expressed as idempotent `CREATE TABLE` statements.

### Version History

| Version | Changes |
|---------|---------|
| v1 | Initial schema: `entities`, `entities_fts`, `recency`, `notes_fts`, `fts_metadata`, `vault_index_cache`, `flywheel_config`, `metadata`, `schema_version` |
| v2 | Dropped dead `notes`/`links` tables from v1 |
| v3 | Renamed `crank_state` to `write_state` |
| v4 | Added `vault_metrics`, `wikilink_feedback`, `wikilink_suppressions` tables |
| v5 | Added `wikilink_applications` table (implicit feedback tracking) |
| v6 | Added `index_events` table (index activity history) |
| v7 | Added `tool_invocations` table (usage analytics) |
| v8 | Added `graph_snapshots` table (structural evolution) |
| v9 | Added `note_embeddings` table (semantic search) |
| v10 | Added `entity_embeddings` table (semantic entity scoring) |

---

## Write Pipeline

Every write tool follows the same pipeline:

1. **Path validation** -- Prevents path traversal attacks
2. **File read** -- Reads current content and frontmatter with `gray-matter`
3. **Section finding** -- Locates target section by heading text
4. **Input validation** -- Checks for common issues (double timestamps, non-markdown bullets)
5. **Normalization** -- Auto-fixes issues (replace `*` with `-`, trim whitespace)
6. **Auto-wikilinks** -- Applies `[[wikilinks]]` to known entities
6a. **Heading level bumping** -- `bumpHeadingLevels()` adjusts heading levels in inserted content to nest under the target section's level (opt-out via `bumpHeadings: false`)
7. **Outgoing link suggestions** -- Suggests related links based on content
8. **Content formatting** -- Applies format (plain, bullet, task, numbered, timestamp-bullet)
9. **Section insertion** -- Inserts at position (append/prepend) with list nesting preservation
10. **Guardrails** -- Output validation (warn/strict/off modes). Write errors use `DiagnosticError` for structured diagnostics — includes closest match to target section, per-line analysis of the content, and actionable fix suggestions on `MutationResult.diagnostic`
11. **File write** -- Writes back with frontmatter via `gray-matter`
12. **Git commit** -- Optional auto-commit with `[Flywheel:*]` prefix

### Move and Rename

`vault_move_note` and `vault_rename_note` update all backlinks across the entire vault. They find every note containing a wikilink to the old name/path, rewrite the link to point to the new location, and optionally commit the changes.

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP protocol implementation |
| `@velvetmonkey/vault-core` | Shared SQLite, entity scanning, wikilinks |
| `better-sqlite3` | SQLite with FTS5 support |
| `gray-matter` | YAML frontmatter parsing |
| `simple-git` | Git operations (commit, undo, diff) |
| `chokidar` | File system watching |
| `zod` | Input schema validation |
| `@huggingface/transformers` | Embedding generation (all-MiniLM-L6-v2) |
