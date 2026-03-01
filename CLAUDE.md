# Flywheel Memory - Claude Code Instructions

**Flywheel Memory** is an MCP server that gives Claude full read/write access to Obsidian vaults. 42 tools across 15 categories for search, graph analysis, schema intelligence, tasks, frontmatter, and note mutations — all local, all markdown. Hybrid search (BM25 + semantic via Reciprocal Rank Fusion) is available when embeddings are built via `init_semantic`.

---

## Architecture

### Source Structure

```
packages/mcp-server/src/
├── index.ts                 # MCP server entry point + tool preset gating
├── tools/
│   ├── read/                # Read tool registrations
│   │   ├── query.ts         # search (unified: metadata + content + entities)
│   │   ├── graph.ts         # get_backlinks (+ bidirectional), get_forward_links
│   │   ├── graphAdvanced.ts # (helper) get_connection_strength, get_link_path, get_common_neighbors — imported by graph.ts, primitives.ts, graphAnalysis.ts
│   │   ├── graphAnalysis.ts # graph_analysis (orphans, dead_ends, sources, hubs, stale, immature, evolution, emerging_hubs)
│   │   ├── vaultSchema.ts   # vault_schema (overview, field_values, inconsistencies, validate, conventions, incomplete, contradictions)
│   │   ├── noteIntelligence.ts # note_intelligence (prose_patterns, suggest_frontmatter, wikilinks, cross_layer, compute)
│   │   ├── primitives.ts    # get_note_structure, get_section_content, find_sections, tasks
│   │   ├── health.ts        # health_check, get_vault_stats, get_folder_structure
│   │   ├── system.ts        # refresh_index, get_all_entities, get_note_metadata, get_unlinked_mentions
│   │   ├── wikilinks.ts     # suggest_wikilinks, validate_links
│   │   ├── migrations.ts    # rename_field, migrate_field_values
│   │   ├── activity.ts      # vault_activity (session, sessions, note_access, tool_usage)
│   │   ├── similarity.ts    # find_similar (FTS5 BM25 content similarity)
│   │   └── semantic.ts      # init_semantic (on-demand semantic embedding build)
│   └── write/               # Write tool registrations
│       ├── mutations.ts     # vault_add_to_section, vault_remove_from_section, vault_replace_in_section
│       ├── tasks.ts         # vault_toggle_task, vault_add_task
│       ├── notes.ts         # vault_create_note, vault_delete_note
│       ├── move-notes.ts    # vault_move_note, vault_rename_note
│       ├── frontmatter.ts   # vault_update_frontmatter (+ only_if_missing)
│       ├── system.ts        # vault_undo_last_mutation
│       └── policy.ts        # policy (list, validate, preview, execute, author, revise)
└── core/
    ├── read/                # Read-side core logic (graph, vault, parser, fts5, config, watcher)
    ├── write/               # Write-side core logic (writer, wikilinks, git, validator, policy engine)
    ├── shared/              # Shared utilities (recency, cooccurrence, hub export, stemmer, metrics, indexActivity, toolTracking, graphSnapshots)
    └── semantic/            # Semantic search (embeddings.ts — embedding generation, similarity.ts — hybrid ranking)
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
- **`minimal`** — 11 tools: search, structure, append, frontmatter, notes
- **`writer`** — 14 tools: minimal + tasks
- **`agent`** — 14 tools: minimal + memory
- **`researcher`** — 12 tools: search, structure, backlinks, hubs, paths
- **`full`** (default) — All 16 categories, all tools

**Composable bundles** (add to presets or each other):
- **`graph`** — backlinks, orphans, hubs, paths (5 tools)
- **`analysis`** — schema, wikilinks (9 tools)
- **`tasks`** — tasks (3 tools)
- **`health`** — health (11+ tools)
- **`ops`** — git, policy (2 tools)
- **`note-ops`** — delete, move, rename, merge (4 tools)

**Categories (16):** `search`, `backlinks`, `orphans`, `hubs`, `paths`, `schema`, `structure`, `tasks`, `health`, `wikilinks`, `append`, `frontmatter`, `notes`, `note-ops`, `git`, `policy`, `memory`

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
