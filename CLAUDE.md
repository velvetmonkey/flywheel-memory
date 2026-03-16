# Flywheel Memory - Claude Code Instructions

**Flywheel Memory** is an MCP server that gives Claude full read/write access to Obsidian vaults. 61 tools across 12 categories for search, graph analysis, schema intelligence, tasks, frontmatter, note mutations, and agent memory — all local, all markdown. Hybrid search (BM25 + semantic via Reciprocal Rank Fusion) is available when embeddings are built via `init_semantic`.

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
│   │   ├── graphAnalysis.ts    # graph_analysis, list_entities, get_connection_strength,
│   │   │                       #   get_link_path, get_common_neighbors, get_weighted_links, get_strong_connections
│   │   ├── system.ts           # refresh_index, get_all_entities, get_unlinked_mentions
│   │   ├── health.ts           # health_check, get_vault_stats, get_folder_structure, server_log
│   │   ├── vaultSchema.ts      # vault_schema
│   │   ├── noteIntelligence.ts # note_intelligence
│   │   ├── wikilinks.ts        # suggest_wikilinks, validate_links, discover_stub_candidates,
│   │   │                       #   discover_cooccurrence_gaps, suggest_entity_aliases, unlinked_mentions_report
│   │   ├── migrations.ts       # rename_field, migrate_field_values
│   │   ├── activity.ts         # vault_activity
│   │   ├── metrics.ts          # vault_growth
│   │   ├── merges.ts           # suggest_entity_merges, dismiss_merge_suggestion
│   │   ├── similarity.ts       # find_similar
│   │   ├── semantic.ts         # init_semantic
│   │   ├── recall.ts           # recall
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
    ├── shared/                 # Shared utilities (recency, cooccurrence, hub export, stemmer, metrics, indexActivity, toolTracking, graphSnapshots)
    └── semantic/               # Semantic search (embeddings.ts — embedding generation, similarity.ts — hybrid ranking)
```

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
- **`default`** — 14 tools: search, read, write, tasks
- **`agent`** — 14 tools: search, read, write, memory
- **`full`** — All 12 categories, all 61 tools

**Composable bundles** (add to presets or each other):
- **`graph`** — structural analysis, paths, hubs, connections (7 tools)
- **`schema`** — schema intelligence + migrations (5 tools)
- **`wikilinks`** — suggestions, validation, discovery (7 tools)
- **`corrections`** — correction recording + resolution (4 tools)
- **`tasks`** — task queries and mutations (3 tools)
- **`memory`** — agent working memory + recall + brief (3 tools)
- **`note-ops`** — delete, move, rename, merge (4 tools)
- **`diagnostics`** — vault health, stats, config, activity (13 tools)
- **`automation`** — git undo, policy engine (2 tools)

**Categories (12):** `search`, `read`, `write`, `graph`, `schema`, `wikilinks`, `corrections`, `tasks`, `memory`, `note-ops`, `diagnostics`, `automation`

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

Apache-2.0
