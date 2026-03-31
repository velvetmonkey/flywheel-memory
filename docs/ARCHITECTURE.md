# Architecture

[← Back to docs](README.md)

Flywheel Memory is a single MCP server that gives AI agents full read/write access to Obsidian vaults. It builds an in-memory index of every note, then exposes tools for search, graph queries, and mutations.

- [Source Structure](#source-structure)
- [Startup Flow](#startup-flow)
- [Index Strategy](#index-strategy)
  - [In-Memory VaultIndex](#in-memory-vaultindex)
  - [Index Caching](#index-caching)
  - [File Watcher](#file-watcher)
- [SQLite FTS5 Full-Text Search](#sqlite-fts5-full-text-search)
  - [Content Search (`notes_fts` in `state.db`)](#content-search-notes_fts-in-statedb)
  - [Entity Search (`entities_fts` in `state.db`)](#entity-search-entities_fts-in-statedb)
- [Semantic Search & Embeddings](#semantic-search--embeddings)
  - [Embeddings Module](#embeddings-module)
  - [Storage](#storage)
  - [Hybrid Search](#hybrid-search)
  - [File Watcher Integration](#file-watcher-integration)
  - [Entity Embeddings](#entity-embeddings)
- [Knowledge Graph](#knowledge-graph)
  - [Backlinks](#backlinks)
  - [Forward Links](#forward-links)
  - [Hub Detection](#hub-detection)
  - [Path Finding](#path-finding)
  - [Orphan and Dead-End Detection](#orphan-and-dead-end-detection)
- [Auto-Wikilinks](#auto-wikilinks)
  - [How It Works](#how-it-works)
  - [Implicit Entity Detection](#implicit-entity-detection)
  - [Outgoing Link Suggestions](#outgoing-link-suggestions)
- [StateDb (Consolidated State)](#statedb-consolidated-state)
  - [Backup & Recovery](#backup--recovery)
- [Schema Versioning](#schema-versioning)
  - [Migration Pattern](#migration-pattern)
  - [Version History](#version-history)
- [Write Pipeline](#write-pipeline)
  - [Content Hash Conflict Detection](#content-hash-conflict-detection)
  - [Move and Rename](#move-and-rename)
- [Dependencies](#dependencies)
- [Audit Trail](#audit-trail)
  - [What's recorded](#whats-recorded)
  - [How to inspect](#how-to-inspect)
  - [Network access model](#network-access-model)
- [Tool Selection & Routing](#tool-selection--routing)
  - [Tiered Visibility (auto preset)](#tiered-visibility-auto-preset)
  - [Pattern Routing (auto preset)](#pattern-routing-auto-preset)
  - [Semantic Routing](#semantic-routing)
  - [Routing Modes](#routing-modes)
  - [Tool Invocation Tracking](#tool-invocation-tracking)
  - [Feedback Loop](#feedback-loop)
- [Module-Level State Isolation](#module-level-state-isolation)
  - [The Rule](#the-rule)
  - [Modules following this pattern](#modules-following-this-pattern)
  - [Exceptions](#exceptions)
  - [Enforced by](#enforced-by)

---

## Source Structure

```
packages/
├── mcp-server/                  # The MCP server (published as @velvetmonkey/flywheel-memory)
│   └── src/
│       ├── index.ts             # Entry point, tool preset gating, startup
│       ├── config.ts            # Tool categories, tiers, presets, instruction generation
│       ├── tool-registry.ts     # Tool gating, tiering, activation tracking
│       ├── vault-registry.ts    # Multi-vault context management (VaultRegistry, parseVaultConfig)
│       ├── vault-scope.ts       # Per-request vault isolation via AsyncLocalStorage
│       ├── tools/
│       │   ├── toolCatalog.ts   # Tool metadata collection for embedding manifest
│       │   ├── read/            # Read tool registrations
│       │   │   ├── query.ts     # search (unified: metadata + content + entities)
│       │   │   ├── graph.ts     # get_backlinks (+ bidirectional), get_forward_links
│       │   │   ├── graphAdvanced.ts  # get_link_path, get_common_neighbors, get_connection_strength
│       │   │   ├── graphAnalysis.ts  # graph_analysis (7 modes + centrality + cycles)
│       │   │   ├── vaultSchema.ts    # vault_schema (unified: overview, field_values, inconsistencies, validate, conventions, incomplete)
│       │   │   ├── noteIntelligence.ts # note_intelligence (unified: prose_patterns, suggest_frontmatter, suggest_wikilinks, compute, semantic_links)
│       │   │   ├── primitives.ts     # get_note_structure, get_section_content, find_sections, tasks
│       │   │   ├── health.ts    # health_check, get_vault_stats, get_folder_structure, flywheel_doctor
│       │   │   ├── system.ts    # refresh_index, get_all_entities, get_unlinked_mentions
│       │   │   ├── wikilinks.ts # suggest_wikilinks, validate_links (+ typo detection)
│       │   │   ├── migrations.ts # rename_field, migrate_field_values
│       │   │   ├── temporalAnalysis.ts # temporal_summary, predict_stale_notes, track_concept_evolution, get_context_around_date
│       │   │   ├── brief.ts         # brief (startup context assembly)
│       │   │   └── query.ts         # search (unified knowledge retrieval)
│       │   └── write/           # Write tool registrations
│       │       ├── mutations.ts # vault_add_to_section, vault_remove_from_section, vault_replace_in_section
│       │       ├── tasks.ts     # vault_toggle_task, vault_add_task
│       │       ├── notes.ts     # vault_create_note, vault_delete_note
│       │       ├── move-notes.ts # vault_move_note, vault_rename_note (with backlink updates)
│       │       ├── frontmatter.ts # vault_update_frontmatter (+ only_if_missing)
│       │       ├── system.ts    # vault_undo_last_mutation
│       │       ├── policy.ts    # policy (unified: list, validate, preview, execute, author, revise)
│       │       ├── memory.ts    # memory (agent working memory)
│       │       ├── config.ts    # flywheel_config (runtime configuration)
│       │       └── toolSelectionFeedback.ts # tool_selection_feedback
│       ├── core/
│       │   ├── read/            # Read-side core logic
│       │   │   ├── graph.ts     # Index building, backlinks, hubs, orphans, path finding
│       │   │   ├── vault.ts     # Vault scanner (find all .md files)
│       │   │   ├── parser.ts    # Note parser (frontmatter, outlinks, tags)
│       │   │   ├── fts5.ts      # FTS5 full-text search
│       │   │   ├── embeddings.ts # Embedding generation (all-MiniLM-L6-v2)
│       │   │   ├── similarity.ts # Semantic similarity search
│       │   │   ├── semantic.ts  # Hybrid search (BM25 + semantic via RRF)
│       │   │   ├── toolRouting.ts # Semantic tool routing, manifest loading
│       │   │   ├── config.ts    # Config inference and storage
│       │   │   ├── types.ts     # VaultIndex, VaultNote, Backlink types
│       │   │   ├── constants.ts # MAX_LIMIT and other constants
│       │   │   ├── indexGuard.ts # Require-index-ready guard
│       │   │   └── watch/       # File watcher subsystem
│       │   │       ├── index.ts          # Vault watcher factory
│       │   │       ├── eventQueue.ts     # Per-path debouncing
│       │   │       ├── batchProcessor.ts # Event coalescing
│       │   │       ├── incrementalIndex.ts # Incremental index updates
│       │   │       ├── pathFilter.ts     # Path filtering (.obsidian, .git, etc.)
│       │   │       └── selfHeal.ts       # Error recovery
│       │   ├── write/           # Write-side core logic
│       │   │   ├── writer.ts    # File read/write, section finding, content insertion
│       │   │   ├── wikilinks.ts # Auto-wikilink application on writes
│       │   │   ├── git.ts       # Git commit, undo, diff
│       │   │   ├── validator.ts # Input validation and normalization
│       │   │   ├── hints.ts     # Mutation hints
│       │   │   ├── mutation-helpers.ts # Shared helpers (withVaultFile, error handling)
│       │   │   └── policy/      # Policy execution engine
│       │   │       ├── executor.ts  # Policy runner
│       │   │       ├── parser.ts    # YAML policy parser
│       │   │       ├── schema.ts    # Policy schema validation
│       │   │       ├── conditions.ts # Conditional execution
│       │   │       ├── template.ts  # Variable templating
│       │   │       ├── storage.ts   # Policy file storage
│       │   │       └── types.ts     # Policy types
│       │   │   ├── memory.ts    # Agent memory lifecycle (store, search, brief)
│       │   │   ├── corrections.ts # Pending correction processing
│       │   │   ├── edgeWeights.ts # Edge weight computation
│       │   │   └── wikilinkFeedback.ts # Wikilink feedback tracking
│       │   └── shared/          # Shared between read/write
│       │       ├── recency.ts   # Entity recency tracking
│       │       ├── cooccurrence.ts # Co-occurrence analysis
│       │       ├── hubExport.ts # Hub score export to StateDb
│       │       ├── stemmer.ts   # Porter stemming
│       │       ├── edgeWeights.ts # Edge weight scoring and persistence
│       │       ├── taskCache.ts # Task cache for fast queries
│       │       ├── toolTracking.ts # Tool invocation and selection feedback tracking
│       │       ├── indexActivity.ts # Index rebuild activity logging
│       │       ├── graphSnapshots.ts # Graph topology snapshots
│       │       ├── retrievalCooccurrence.ts # Retrieval co-occurrence scoring (Adamic-Adar)
│       │       ├── levenshtein.ts # Levenshtein distance for fuzzy matching
│       │       └── metrics.ts    # Vault growth metrics
│       └── generated/
│           └── tool-embeddings.generated.ts  # Pre-computed tool embedding manifest (checked in)
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

1. **Detect vault root** -- `findVaultRoot()` walks up from cwd looking for `.obsidian/` or `.claude/`
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

The `embeddings.ts` module generates vector embeddings for note content using the `all-MiniLM-L6-v2` model from Hugging Face Transformers. The model is downloaded automatically to `~/.cache/huggingface/` on first use. Each note is embedded into a 384-dimensional vector.

Before embedding, each note's text is enriched with a contextual prefix: `"Note: {title}. Tags: {tag1}, {tag2}."` followed by the body content with frontmatter stripped. This matches the contextual retrieval technique (Anthropic, 2024) -- the embedding carries document identity alongside content meaning, so a search for "team lead" can surface a note titled "Emma" even when the body text doesn't repeat the name. An `EMBEDDING_TEXT_VERSION` constant is mixed into the content hash; bumping it forces a one-time re-embed on upgrade without schema changes.

### Storage

Embeddings are stored in the `note_embeddings` table in StateDb (`.flywheel/state.db`). Each row maps a note path to its embedding vector and a content hash (incorporating the embedding text version) for staleness detection.

### Hybrid Search

The `semantic.ts` module merges BM25 keyword results (from FTS5) with semantic similarity results (from cosine distance on context-enriched embeddings) using **Reciprocal Rank Fusion (RRF)**. RRF combines ranked lists by summing `1 / (k + rank)` for each result across all channels, producing a single ranking that benefits from keyword precision and semantic recall. Results then pass through graph reranking, U-shaped interleaving (placing best results at attention peaks), snippet extraction, and section expansion into a decision surface.

When embeddings exist, `search` and `find_similar` automatically upgrade to hybrid mode. When embeddings are not available, both tools fall back to FTS5-only mode with no degradation.

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

**Loading:** `loadEntityEmbeddingsToMemory()` loads all entity embeddings into an in-memory Map at startup. Layer 9 scoring queries this Map directly — no database access in the hot path (<1ms for 500 entities).

**Incremental updates:** The file watcher detects when an entity's backing note changes and regenerates its embedding. Entity additions and removals are handled on index rebuild.

**Integration points:**
- **Layer 9 scoring** in `suggestRelatedLinks()` — cosine similarity against in-memory entity embeddings
- **Semantic analysis** — `semantic_analysis` tool (clusters, bridges)
- **Semantic note intelligence** — `semantic_links` mode in `note_intelligence`
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

Hub scores are computed using **eigenvector centrality** — a power-iteration algorithm (50 iterations) on the bidirectional wikilink graph. Scores are scaled 0–100 and stored in `entities.hub_score`. This replaces simple backlink counting: a note linked by other well-connected notes scores higher than one with many links from peripheral notes. Hub scores are exported to StateDb for use by the auto-wikilink scoring system (Layer 7).

### Path Finding

`get_link_path` implements BFS from source to target, following outlinks at each hop. Returns the shortest path as a list of note paths, or reports no path found. Max depth is configurable (default: 10).

### Orphan and Dead-End Detection

- **Orphans:** Notes with zero backlinks (no other note links to them)
- **Dead ends:** Notes with backlinks but zero outlinks (consume but don't contribute)
- **Sources:** Notes with outlinks but zero backlinks (contribute but aren't referenced)

---

## Auto-Wikilinks

When Claude writes content through any mutation tool (`vault_add_to_section`, `vault_create_note`, `vault_add_task`, `vault_replace_in_section`), Flywheel automatically scans the text for mentions of both known entities and prospective entities, and wraps them in `[[wikilinks]]`.

### How It Works

1. **Entity index:** At startup, the vault is scanned for all note titles and frontmatter aliases. These become the known entity list.
2. **Protected zones:** Before linking, the engine identifies regions to skip: existing wikilinks, code blocks, frontmatter, headings, URLs, HTML, footnotes.
3. **Matching:** Entities are sorted longest-first to prevent partial matches. Case-insensitive word-boundary matching finds all occurrences.
4. **First-occurrence mode (default):** Only the first mention of each entity is linked, to avoid over-linking.
5. **Alias resolution:** If content matches an alias, the link resolves to the canonical entity name: `[[Entity Name|alias text]]`.
6. **Zone updates:** After each link insertion, protected zone positions are shifted to account for the added characters.
7. **Implicit entity detection:** Pattern-based detection links prospective entities that don't have existing notes (see below).

### Implicit Entity Detection

Pattern-based detection for prospective entities — on by default as the final stage of write-time auto-linking. Six configurable patterns:

- **Multi-word proper nouns** (e.g., "Marcus Johnson", "Project Alpha")
- **Single capitalized words** after lowercase text (e.g., "discussed with Marcus yesterday")
- **CamelCase compounds** (e.g., TypeScript, HuggingFace)
- **Acronyms** — 3–5 letter ALL-CAPS tokens (e.g., LLM, API)
- **Quoted terms** (e.g., `"Turbopump"` becomes `[[Turbopump]]`)
- **Ticket references** (e.g., FW-123, PROJ-456)

Common words, sentence starters, and technical terms are excluded to minimize false positives. Implicit detection is suppressed for prose-heavy content (>500 words) and can be toggled via `implicit_detection` or filtered by pattern via `implicit_patterns` in the flywheel config.

### Read-Side Prospect Discovery

Separately from write-time auto-linking, the `suggest_wikilinks` tool surfaces prospective entities through additional analysis:

- **Dead-link target matching:** Entities referenced by existing `[[wikilinks]]` in the vault but with no backing note. Targets with ≥3 backlinks are marked `confidence: 'high'`; those with 2 are `'medium'`.
- **Cross-reference boost:** When an implicit pattern match coincides with a dead-link target, confidence is elevated to `'high'` and source is marked `'both'`.
- **Scored suggestions:** With `detail: true`, `suggest_wikilinks` returns a per-layer scoring breakdown including Layer 3.5 fuzzy matching — token-level Levenshtein (≥80% similarity, ≥4 chars) and whole-term collapsed matching (`"turbo-pump"` = `"turbopump"` = `"turbo pump"`). Strictness modes (conservative / balanced / aggressive) control fuzzy bonus weights.

### Outgoing Link Suggestions

Write tools can append suggested outgoing links when enabled (`suggestOutgoingLinks: true`). For example, after adding a note about "React migration", the tool might append: `→ [[React]], [[Migration Plan]]`. Suggestions are off by default — enable them for daily notes, journals, meeting logs, or any capture-heavy context where you want the graph to grow organically. Auto-wikilinks (inline `[[linking]]`) are always on regardless of this setting.

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
| `suggestion_events` | Wikilink suggestion event log |
| `note_links` | Persisted note-to-note links (with weights) |
| `note_link_history` | Note link change history |
| `note_moves` | Note rename/move tracking |
| `note_tags` | Extracted tags per note |
| `entity_changes` | Entity change tracking |
| `tasks` | Task cache |
| `merge_dismissals` | Dismissed merge suggestions |
| `corrections` | Pending entity corrections |
| `cooccurrence_cache` | Serialized co-occurrence index (BLOB) |
| `content_hashes` | Content hash conflict detection (SHA-256, 16 hex chars) |
| `memories` | Agent memory storage |
| `memories_fts` | FTS5 index for memory search |
| `session_summaries` | Agent session summary storage |
| `retrieval_cooccurrence` | Notes co-retrieved in search sessions (Adamic-Adar weighted, 7-day decay) |

**Database settings:** WAL journal mode for concurrent read performance. Foreign keys enabled. Schema version tracking with migration support.

### Backup & Recovery

Flywheel's backup system is designed to protect accumulated feedback data — the signals that take weeks to build and can't be regenerated from markdown alone.

**Rotated backups (3 copies):** After each successful startup, Flywheel creates a WAL-safe backup using SQLite's backup API (not `fs.copyFileSync`, which can copy inconsistent state during WAL writes). Existing backups are rotated: `.backup` → `.backup.1` → `.backup.2` → `.backup.3`. The oldest is dropped. This means you always have at least one backup that predates the current session.

**Integrity checks:** On every startup, `PRAGMA quick_check` verifies database integrity after opening. The watcher pipeline also runs an integrity check every 6 hours, triggering a safe backup on pass.

**Automatic feedback salvage:** When corruption is detected, Flywheel:
1. Preserves the corrupted file as `state.db.corrupt`
2. Creates a fresh database
3. Attempts to recover 9 high-value tables from all available sources (newest first): `.backup`, `.backup.1`, `.backup.2`, `.backup.3`, `.corrupt`
4. Merges rows across all sources using `INSERT OR IGNORE` — each successive source fills in rows the previous ones didn't cover

The salvaged tables are: `wikilink_feedback`, `wikilink_applications`, `suggestion_events`, `wikilink_suppressions`, `note_links`, `note_link_history`, `memories`, `session_summaries`, `corrections`.

**What's regenerable vs. irreplaceable:**

| Regenerable (rebuilt from markdown) | Irreplaceable (accumulated over time) |
|-------------------------------------|---------------------------------------|
| Entity index, FTS5 search, hub scores, note tags, task cache | Wikilink feedback, suppressions, edge weights |
| Content hashes, co-occurrence cache, embeddings | Agent memories, session summaries, corrections |
| Graph snapshots, index events, tool invocations | Wikilink applications, suggestion events |

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md#statedb-corruption) for recovery steps.

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
| v11 | Added `frontmatter` column to `notes_fts` |
| v12 | Added `tasks` table |
| v13 | Added `merge_dismissals` table |
| v14 | Added `steps` column to `index_events` |
| v15 | Added `suggestion_events` table |
| v16 | Added `note_links` table |
| v17 | Added `entity_changes` table |
| v18 | Added `note_tags` table |
| v19 | Added `note_link_history` table |
| v20 | Added `note_moves` table |
| v21 | Added `description` column to `entities` |
| v22 | Added `weight`/`weight_updated_at` to `note_links` |
| v23 | Recreated `idx_wl_apps_unique` with `COLLATE NOCASE` |
| v24 | Added `corrections` table |
| v25 | Added `confidence` column to `wikilink_feedback` |
| v26 | Added `memories` + `memories_fts` + `session_summaries` tables (agentic memory) |
| v27 | Added `cooccurrence_cache` table (serialized co-occurrence BLOB) |
| v28 | Added `content_hashes` table (write conflict detection) |
| v29 | Added `idx_wl_feedback_note_path` index on `wikilink_feedback(note_path)` for temporal analysis queries |
| v30 | Added `response_tokens`/`baseline_tokens` on `tool_invocations` (token economics) + `retrieval_cooccurrence` table |
| v31 | Added `proactive_queue` table (deferred proactive linking) |
| v32 | Recreated `entity_changes` with rowid PK (drops composite PK that caused UNIQUE constraint crashes) |
| v33 | Added `performance_benchmarks` table (longitudinal tracking) |
| v34 | Rebuilt `entities_fts` as contentless FTS5 (fixes aliases column mismatch) |
| v35 | Added `matched_term` column on `wikilink_feedback` and `wikilink_applications` (per-alias feedback tracking) |
| v36 | Added `tool_selection_feedback` table + `query_context` column on `tool_invocations` |

---

## Write Pipeline

Every write tool follows the same pipeline:

1. **Path validation** -- Prevents path traversal attacks
1a. **Content hash check** -- Compares stored content hash against current file content. If a concurrent edit modified the file since last read, returns a `write_conflict` warning.
2. **File read** -- Reads current content and frontmatter with `gray-matter`
3. **Section finding** -- Locates target section by heading text
4. **Input validation** -- Checks for common issues (double timestamps, non-markdown bullets)
5. **Normalization** -- Auto-fixes issues (replace `*` with `-`, trim whitespace)
6. **Auto-wikilinks** -- Applies `[[wikilinks]]` to known and prospective entities
6a. **Heading level bumping** -- `bumpHeadingLevels()` adjusts heading levels in inserted content to nest under the target section's level
7. **Outgoing link suggestions** -- Appends suggested related links based on content (disabled by default, opt-in via `suggestOutgoingLinks: true`)
8. **Content formatting** -- Applies format (plain, bullet, task, numbered, timestamp-bullet)
9. **Section insertion** -- Inserts at position (append/prepend) with list nesting preservation
10. **Guardrails** -- Output validation (warn/strict/off modes). Write errors use `DiagnosticError` for structured diagnostics — includes closest match to target section, per-line analysis of the content, and actionable fix suggestions on `MutationResult.diagnostic`
11. **File write** -- Writes back with frontmatter via `gray-matter`
12. **Git commit** -- Optional auto-commit with `[Flywheel:*]` prefix

### Content Hash Conflict Detection

Every write path checks for concurrent edits using SHA-256 content hashes (truncated to 16 hex chars). The `content_hashes` table stores the last-known hash for each file. Before writing, the system compares the stored hash against the current file content. If they differ — indicating another process modified the file — the write succeeds but returns a `write_conflict` warning via `ValidationWarning[]` on `MutationResult.warnings`.

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

---

## Audit Trail

Every operation produces auditable records. This is a sovereignty guarantee, not a feature.

### What's recorded

| Layer | Mechanism | Storage | What |
|-------|-----------|---------|------|
| Tool calls | `recordToolInvocation()` | `tool_invocations` table in StateDb | Timestamp, tool name, session ID, affected note paths, duration, success/failure, token estimates |
| Write mutations | Git auto-commit | `.git/` in vault | Full diff of every write, author, timestamp, operation description |
| Wikilink feedback | `wikilink_feedback` table | StateDb | Accept/reject/implicit signals with confidence, timestamps |
| Index events | `index_events` table | StateDb | Rebuild triggers, step counts, durations |
| Entity changes | `entity_changes` table | StateDb | Entity lifecycle events (created, merged, renamed) |

### How to inspect

```bash
# Recent tool invocations
sqlite3 .flywheel/state.db \
  "SELECT datetime(timestamp/1000, 'unixepoch', 'localtime'), tool_name, success, duration_ms
   FROM tool_invocations ORDER BY timestamp DESC LIMIT 20"

# Write history
git log --oneline -20

# Undo the last write (or use vault_undo_last_mutation tool)
git revert HEAD
```

### Network access model

Core indexing, search, graph analysis, and all write operations run with **zero network access**. The only outbound call is:

- `@huggingface/transformers` model download (~23MB, one-time on `init_semantic`), cached locally at `~/.cache/huggingface/`

This is enforced by CI tests in `test/write/security/sovereignty.test.ts` that scan all production source files for network call patterns. Any new network call site must be added to an explicit allowlist with documentation.

No telemetry. No analytics. No phone-home. No remote git operations.

---

## Tool Selection & Routing

The `tool-registry.ts` module manages tool visibility via `applyToolGating()`, which monkey-patches `server.tool()` to track registrations and control visibility through a `ToolTierController`.

Under `full` (the default), all tools are visible at startup with no tiering. Under `agent`, only the fixed reduced surface is visible (search, read, write, tasks, memory).

### Tiered Visibility (auto preset)

When `FLYWHEEL_TOOLS=auto`, tools are progressively disclosed across three tiers:

| Tier | Visibility | Categories |
|------|-----------|------------|
| 1 | Always visible | search, read, write, tasks, memory, discover_tools |
| 2 | Context-triggered | graph, wikilinks, corrections, temporal, diagnostics |
| 3 | On-demand | schema, note-ops, deep diagnostics |

The `discover_tools` meta-tool (tier 1, auto-only) lets the LLM explicitly find and activate specialised tools by natural-language query.

### Pattern Routing (auto preset)

Seven `ACTIVATION_PATTERNS` in `tool-registry.ts` match query text from `search`, `brief`, and `discover_tools` calls:

- **Tier 2:** graph (backlinks, connections, hubs, paths), wikilinks (stubs, unlinked mentions), corrections (wrong links, mistakes), temporal (history, evolution, stale notes), diagnostics (health, config, pipeline)
- **Tier 3:** schema (frontmatter, conventions, rename field), note-ops (delete note, move note, merge)

### Semantic Routing

A pre-generated embedding manifest (`generated/tool-embeddings.generated.ts`) contains 384-dimensional vectors for each tool description, computed with `Xenova/all-MiniLM-L6-v2`. At query time, `toolRouting.ts` embeds the query and scores it against the manifest:

- Minimum query length: 2 tokens and 12 non-space characters
- Cosine similarity threshold: 0.30
- Tier-1 tools are skipped (always visible)
- Collapses to one activation per category (highest-scoring tool's tier)
- Returns at most 3 category/tier pairs

Semantic routing fires only on hybrid search calls (requires `init_semantic`).

### Routing Modes

Controlled by `FLYWHEEL_TOOL_ROUTING`:

| Mode | Behaviour |
|------|-----------|
| `pattern` | Regex activation only |
| `hybrid` | Pattern + semantic signals combined (default when all categories loaded — `full` or `auto`) |
| `semantic` | Semantic-only for hybrid search; regex fallback elsewhere |

Both signal types are unioned. Per category, the highest tier from either signal wins.

### Tool Invocation Tracking

Every tool call is recorded by `recordToolInvocation()` in `core/shared/toolTracking.ts`:

- Timestamp, tool name, session ID, affected note paths, duration, success/failure
- `query_context`: extracted from a strict parameter allowlist (`query`, `focus`, `analysis`, `entity`, `heading`, `field`, `date`, `concept`), max 500 characters
- Token estimates: `response_tokens` (from response size) and `baseline_tokens` (from file sizes)

Invocations are stored in the `tool_invocations` table and purged after 90 days.

### Feedback Loop

The `tool_selection_feedback` table (schema v36) stores explicit feedback on whether the right tool was selected:

- `tool_invocation_id` links to the original call (hydrates tool name, query context, session)
- `correct` (boolean) drives accuracy scoring
- `source`: `explicit` (user feedback) or `heuristic` (automated advisory, `correct = NULL`)

Accuracy is computed as a Beta-Binomial posterior with prior α=4, β=1: `posterior = (α + correct_count) / (α + β + total_count)`. Tools need at least 15 observations before scores are reported.

---

## Module-Level State Isolation

Flywheel Memory supports multi-vault operation where concurrent MCP requests may target different vaults. Each vault has its own StateDb, VaultIndex, and configuration. Per-request isolation uses `AsyncLocalStorage` (ALS) in `vault-scope.ts`.

### The Rule

**Never read module-level mutable state directly outside its designated getter function.**

Every module that holds vault-scoped state follows this pattern:

```typescript
// 1. Module-level variable (fallback for startup/watcher code paths)
let moduleStateDb: StateDb | null = null;

// 2. Scope-aware getter: ALS first, then fallback
function getStateDb(): StateDb | null {
  return getActiveScopeOrNull()?.stateDb ?? moduleStateDb;
}

// 3. Setter (called by activateVault during startup)
export function setFooStateDb(stateDb: StateDb | null): void {
  moduleStateDb = stateDb;
}

// 4. All other code uses the getter
export function doWork(): void {
  const db = getStateDb();  // never moduleStateDb directly
  if (!db) return;
  // ...
}
```

### Modules following this pattern

| Module | Variable | Getter |
|--------|----------|--------|
| `wikilinks.ts` | `moduleStateDb` | `getWriteStateDb()` |
| `git.ts` | `moduleStateDb` | `getStateDb()` |
| `hints.ts` | `moduleStateDb` | `getStateDb()` |
| `recency.ts` | `moduleStateDb` | `getStateDb()` |
| `fts5.ts` | `db` | `getDb()` |
| `taskCache.ts` | `db` | `getDb()` |
| `embeddings.ts` | `db` | `getDb()` |
| `graph.ts` | `indexState` | `getIndexState()` |

### Exceptions

- `embeddings.ts`: `pipeline` (ML model) and `embeddingCache` are content-addressed and legitimately shared across vaults
- `sweep.ts`: Results cache is informational only; no data corruption risk

### Enforced by

- `singleton-access.test.ts` — grep-based test that fails if module-level variables are accessed outside their getter/setter functions
- `singleton-stress.test.ts` — concurrent interleaving test that detects cross-vault data bleed
