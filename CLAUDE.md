# Flywheel Memory - Claude Code Instructions

**[[Flywheel]] Memory** is an MCP server that gives Claude full read/write access to Obsidian vaults. 75 [[TOOLS]] across 12 categories for search, graph analysis, schema intelligence, tasks, frontmatter, note mutations, temporal analysis, and memory — all local, all markdown. Hybrid search (BM25 + semantic via Reciprocal Rank Fusion) is available when embeddings are built via `init_semantic`.

---

## Git Workflow

**No direct pushes to main.** Branch protection is enforced — all changes require a PR.

- Create a feature branch for code changes
- Push the branch and open a PR via `gh pr create`
- Docs-only changes still need a PR but can be fast-tracked
- Never run `npm run build` while a benchmark is running

---

## Architecture

### Source Structure

```
packages/mcp-server/src/
├── index.ts                    # MCP server entry point + tool preset gating
├── tools/
│   ├── read/                   # Read-side tool registrations (20 files, helpers omitted)
│   │   ├── query.ts            # search
│   │   ├── primitives.ts       # get_note_structure, get_section_content, find_sections, tasks
│   │   ├── graph.ts            # get_backlinks, get_forward_links
│   │   ├── graphAnalysis.ts    # graph_analysis (7 modes), list_entities, get_connection_strength,
│   │   │                       #   get_link_path, get_common_neighbors, get_weighted_links, get_strong_connections
│   │   ├── semanticAnalysis.ts # semantic_analysis (clusters, bridges)
│   │   ├── system.ts           # refresh_index, get_all_entities, get_unlinked_mentions
│   │   ├── health.ts           # health_check, get_vault_stats, get_folder_structure, server_log
│   │   ├── vaultSchema.ts      # vault_schema, schema_conventions, schema_validate
│   │   ├── noteIntelligence.ts # note_intelligence
│   │   ├── wikilinks.ts        # suggest_wikilinks, validate_links, discover_stub_candidates,
│   │   │                       #   discover_cooccurrence_gaps, suggest_entity_aliases, unlinked_mentions_report
│   │   ├── migrations.ts       # rename_field, migrate_field_values
│   │   ├── activity.ts         # vault_activity
│   │   ├── metrics.ts          # vault_growth
│   │   ├── merges.ts           # suggest_entity_merges, dismiss_merge_suggestion
│   │   ├── similarity.ts       # find_similar
│   │   ├── semantic.ts         # init_semantic
│   │   └── brief.ts            # brief
│   └── write/                  # Write-side tool registrations
│       ├── mutations.ts        # vault_add_to_section, vault_remove_from_section, vault_replace_in_section
│       ├── tasks.ts            # vault_toggle_task, vault_add_task
│       ├── notes.ts            # vault_create_note, vault_delete_note
│       ├── move-notes.ts       # vault_move_note, vault_rename_note
│       ├── frontmatter.ts      # vault_update_frontmatter
│       ├── merge.ts            # merge_entities, absorb_as_alias
│       ├── corrections.ts      # vault_record_correction, vault_list_corrections, vault_resolve_correction
│       ├── wikilinkFeedback.ts # wikilink_feedback
│       ├── tags.ts             # rename_tag
│       ├── memory.ts           # memory
│       ├── config.ts           # flywheel_config
│       ├── enrich.ts           # vault_init
│       ├── system.ts           # vault_undo_last_mutation
│       └── policy.ts           # policy
└── core/
    ├── read/                   # Read-side core logic (graph, vault, parser, fts5, config, watcher)
    ├── write/                  # Write-side core logic (writer, wikilinks, git, validator, policy engine)
    ├── shared/                 # Shared utilities (recency, cooccurrence, retrievalCooccurrence, hub export, stemmer, metrics, indexActivity, toolTracking, graphSnapshots)
    └── semantic/               # Semantic search (embeddings.ts — embedding generation, similarity.ts — hybrid ranking)
```

### Multi-Vault & Transport

```
packages/mcp-server/src/
├── vault-registry.ts              # VaultContext interface + VaultRegistry class + parseVaultConfig()
├── index.ts                       # applyToolGating(), registerAllTools(), createConfiguredServer()
```

- `vault-registry.ts` — `VaultContext` holds per-vault state (name, vaultPath, stateDb, vaultIndex, flywheelConfig, watcher). `VaultRegistry` tracks all contexts with a primary vault name. `parseVaultConfig()` reads `FLYWHEEL_VAULTS` env var.
- `applyToolGating()` — Monkey-patches `server.tool()` to filter by category. In multi-vault mode, wraps handlers with `activateVault()` and injects optional `vault` parameter on all tools.
- `registerAllTools()` — Calls all tool registration functions. Write tools use `getVaultPath: () => string` getter (not a captured string) so vault switching works.
- `createConfiguredServer()` — Creates a stateless per-request McpServer for HTTP transport (fresh server per POST /mcp).
- `activateVault(ctx)` — Swaps 5 module-level singletons: `setWriteStateDb`, `setFTS5Database`, `setRecencyStateDb`, `setTaskCacheDatabase`, `setEmbeddingsDatabase` + `loadEntityEmbeddingsToMemory`. (Edge weights removed — functions take `stateDb` as parameter.)
- Transport env vars: `FLYWHEEL_TRANSPORT` (stdio/http/both), `FLYWHEEL_HTTP_PORT` (default 3111), `FLYWHEEL_HTTP_HOST` (default 127.0.0.1).
- Multi-vault: `FLYWHEEL_VAULTS=name1:/path1,name2:/path2`. First vault is primary. Falls back to `PROJECT_PATH`/`VAULT_PATH` for single-vault mode.
- Cross-vault search: `wrapWithVaultActivation` detects `search` tool with no `vault` param → calls `crossVaultSearch()` which iterates all contexts, runs search per vault, merges results with `vault` field, sorts by `rrf_score`. Returns `method: 'cross_vault'`.

### Dependencies

- `@velvetmonkey/vault-core` — Shared utilities (entity scanning, wikilinks, SQLite)
- `@modelcontextprotocol/sdk` — MCP protocol
- `better-sqlite3` — SQLite with FTS5
- `gray-matter` — Frontmatter parsing
- `simple-git` — Git operations
- `chokidar` — File watching

---

## Tool Presets

Controlled by `FLYWHEEL_TOOLS` / `FLYWHEEL_PRESET` env var. Per-tool category gating in `index.ts` via monkey-patched `server.tool()`.

**Presets:**
- **`default`** — 18 tools: search, read, write, tasks, memory
- **`full`** — All categories (75 tools)

**Composable bundles** (add to presets or each other):
- **`graph`** — structural analysis, semantic analysis, paths, [[Hub|hubs]], connections, export (11 tools)
- **`schema`** — schema intelligence + migrations (7 tools)
- **`wikilinks`** — suggestions, validation, discovery (7 tools)
- **`corrections`** — correction recording + resolution (4 tools)
- **`tasks`** — task queries and mutations (3 tools)
- **`memory`** — session memory + brief (2 tools)
- **`note-ops`** — delete, move, rename, merge (4 tools)
- **`temporal`** — time-based vault intelligence (4 tools)
- **`diagnostics`** — vault health, stats, config, activity, merges, doctor, trust, benchmark, session/entity history, learning report, calibration export (20 tools)
**Categories (12):** `search`, `read`, `write`, `graph`, `schema`, `wikilinks`, `corrections`, `tasks`, `memory`, `note-ops`, `temporal`, `diagnostics`

---

## Search

### FTS5 (Built-in)

SQLite Full-Text Search 5 in `.flywheel/state.db`:
- BM25 ranking
- Stemming (Porter)
- Phrase matching, prefix search
- <10ms queries on 10k+ notes

---

## Development

```bash
npm run build    # Build both packages
npm test         # Run tests (packages/mcp-server)
npm run dev      # Watch mode
npm run lint     # Type check
```

---

## License

AGPL-3.0
