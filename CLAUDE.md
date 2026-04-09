# Flywheel Memory - Claude Code Instructions

**[[Flywheel]] Memory** — MCP tools that search, write, and auto-link your Obsidian vault — and learn from your edits. 17 merged tools across 3 preset tiers (agent/power/full) for search, graph analysis, schema intelligence, tasks, note mutations, temporal analysis, and memory — all local, all markdown. Hybrid search (BM25 + semantic via Reciprocal Rank Fusion) is available when embeddings are built via `doctor(action: init_semantic)`.

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
├── tool-registry.ts            # Tool gating, tiering, activation tracking
├── config.ts                   # Tool categories, tiers, presets, instructions
├── tools/
│   ├── toolCatalog.ts          # Tool metadata collection for embedding manifest
│   ├── read/                   # Read-side tool registrations (20 files, helpers omitted)
│   │   ├── query.ts            # search
│   │   ├── primitives.ts       # get_note_structure, get_section_content, find_sections, tasks
│   │   ├── graphAnalysis.ts    # graph_analysis (7 modes), list_entities, get_connection_strength,
│   │   │                       #   get_link_path, get_common_neighbors
│   │   ├── semanticAnalysis.ts # semantic_analysis (clusters, bridges)
│   │   ├── system.ts           # refresh_index, suggest_entity_aliases, unlinked_mentions_report
│   │   ├── health.ts           # flywheel_doctor, pipeline_status, server_log
│   │   ├── vaultSchema.ts      # vault_schema, schema_conventions, schema_validate
│   │   ├── noteIntelligence.ts # note_intelligence
│   │   ├── wikilinks.ts        # suggest_wikilinks, validate_links, discover_stub_candidates,
│   │   │                       #   discover_cooccurrence_gaps, suggest_entity_aliases, unlinked_mentions_report
│   │   ├── migrations.ts       # rename_field, migrate_field_values
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
│       ├── toolSelectionFeedback.ts # tool_selection_feedback
│       ├── tags.ts             # rename_tag
│       ├── memory.ts           # memory
│       ├── config.ts           # flywheel_config
│       ├── enrich.ts           # vault_init
│       ├── system.ts           # vault_undo_last_mutation
│       └── policy.ts           # policy
├── core/
│   ├── read/                   # Read-side core logic (graph, vault, parser, fts5, config, watcher)
│   │   └── toolRouting.ts      # Semantic tool routing, manifest loading
│   ├── write/                  # Write-side core logic (writer, wikilinks, git, validator, policy engine)
│   ├── shared/                 # Shared utilities (recency, cooccurrence, retrievalCooccurrence, hub export, stemmer, metrics, indexActivity, toolTracking, graphSnapshots, toolSelectionFeedback)
│   └── semantic/               # Semantic search (embeddings.ts — embedding generation, similarity.ts — hybrid ranking)
└── generated/
    └── tool-embeddings.generated.ts  # Pre-computed tool embedding manifest
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
- Tool routing: `FLYWHEEL_TOOL_ROUTING` (pattern/hybrid/semantic). Default is `hybrid` when `full` preset is active, `pattern` otherwise.

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

**Presets (T43 — 3-tier collapsed surface):**
- **`agent`** (default) — 8 tools: `search`, `read`, `edit_section`, `note`, `memory`, `tasks`, `doctor`, `policy`
- **`power`** — 14 tools: agent + `find_notes`, `vault_update_frontmatter`, `link`, `correct`, `entity`, `schema`
- **`full`** — 17 tools: power + `graph`, `insights`, `export_graph`

Switch preset at runtime: `doctor(action: config, key: tool_preset, value: agent|power|full)`

**Merged tool → actions:**
- `search` — text search; `action: similar` for similarity search
- `read` — `path` (full note), `path+section` (section only), `pattern` (find headings)
- `edit_section` — `action: add|remove|replace`
- `note` — `action: create|move|rename|delete`
- `memory` — `action: store|recall|brief` (brief = startup context)
- `tasks` — `action: list|add|toggle`
- `doctor` — `action: health|pipeline|config|refresh|log|init_semantic`
- `link` — `action: suggest|feedback|unlinked|validate|stubs|dashboard|unsuppress|timeline|layer_timeseries|snapshot_diff`
- `correct` — `action: record|list|resolve|undo`
- `entity` — `action: list|alias|suggest_aliases|merge`
- `schema` — `action: overview|conventions|folders|rename_field|rename_tag|migrate|validate`
- `graph` — `action: analyse|backlinks|forward_links|strong_connections|path|neighbors|strength|cooccurrence_gaps`
- `insights` — `action: evolution|staleness|context|note_intelligence|growth`

---

## Search

### FTS5 (Built-in)

SQLite Full-Text Search 5 in `.flywheel/state.db`:
- BM25 ranking
- Stemming (Porter)
- Phrase matching, prefix search
- <10ms queries on 10k+ notes

### Context Engineering (P38)

Search results pass through a post-processing pipeline that optimises for LLM consumption:
- **U-shaped interleaving** — results reordered so best items land at positions 1 and N (attention peaks), lowest-ranked in the middle (Liu et al. 2024)
- **Section expansion** — top-N results include `section_content` (full `## Section` around the snippet match, up to 2,500 chars) alongside the snippet
- **Contextual embedding prefix** — note embeddings prepend `"Note: {title}. Tags: ..."` to body text, matching Anthropic's contextual retrieval technique. `EMBEDDING_TEXT_VERSION` bump forces re-embed on upgrade
- **Decision surface** — each result carries frontmatter, scored backlinks/outlinks, section provenance, dates, bridges, and confidence — structured for machine reasoning, not human scanning

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
