# Flywheel Memory - Claude Code Instructions

**Flywheel Memory** is an MCP server that gives Claude full read/write access to Obsidian vaults. 39 tools across 15 categories for search, graph analysis, schema intelligence, tasks, frontmatter, and note mutations — all local, all markdown.

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
│   │   ├── graphAnalysis.ts # graph_analysis (orphans, dead_ends, sources, hubs, stale)
│   │   ├── vaultSchema.ts   # vault_schema (overview, field_values, inconsistencies, validate, conventions, incomplete)
│   │   ├── noteIntelligence.ts # note_intelligence (prose_patterns, suggest_frontmatter, wikilinks, cross_layer, compute)
│   │   ├── primitives.ts    # get_note_structure, get_section_content, find_sections, tasks
│   │   ├── health.ts        # health_check, get_vault_stats, get_folder_structure
│   │   ├── system.ts        # refresh_index, get_all_entities, get_note_metadata, get_unlinked_mentions
│   │   ├── wikilinks.ts     # suggest_wikilinks, validate_links
│   │   └── migrations.ts    # rename_field, migrate_field_values
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
    └── shared/              # Shared utilities (recency, cooccurrence, hub export, stemmer)
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

Controlled by `FLYWHEEL_TOOLS` env var. Per-tool category gating in `index.ts` via monkey-patched `server.tool()`.

**Presets:**
- **`full`** (default) — All 15 categories, 39 tools (~11,800 tokens)
- **`minimal`** — 5 categories, 13 tools (~3,800 tokens): search, structure, append, frontmatter, notes

**Composable bundles** (add to minimal or each other):
- **`graph`** — 6 tools: backlinks, orphans, hubs, paths
- **`analysis`** — 8 tools: schema, wikilinks
- **`tasks`** — 3 tools: tasks
- **`health`** — 7 tools: health
- **`ops`** — 2 tools: git, policy

**Categories (15):** `search`, `backlinks`, `orphans`, `hubs`, `paths`, `schema`, `structure`, `tasks`, `health`, `wikilinks`, `append`, `frontmatter`, `notes`, `git`, `policy`

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
