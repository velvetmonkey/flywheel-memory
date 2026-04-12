# Flywheel Memory - Claude Code Instructions

**[[Flywheel]] Memory** — MCP tools that search, write, and auto-link your Obsidian vault — and learn from your edits. 21 merged action-param tools across 3 preset tiers (agent/power/full) organized into 12 categories: search, read, write, graph, schema, wikilinks, corrections, tasks, memory, note-ops, temporal, and diagnostics — all local, all markdown. Hybrid search (BM25 + semantic via Reciprocal Rank Fusion) is available when embeddings are built via `init_semantic`.

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
│   │   ├── primitives.ts       # read/note_read (structure|section|sections), tasks (list|toggle)
│   │   ├── graphAnalysis.ts    # graph (analyse|backlinks|forward_links|strong_connections|path|neighbors|strength|cooccurrence_gaps)
│   │   ├── system.ts           # refresh_index, entity (list|alias|suggest_aliases|merge|suggest_merges|dismiss_merge)
│   │   ├── health.ts           # doctor (health|pipeline|config|log|stats)
│   │   ├── schemaTools.ts      # schema (overview|field_values|conventions|folders|rename_field|rename_tag|migrate|validate|note_intelligence)
│   │   ├── noteIntelligence.ts # insights (evolution|staleness|context|note_intelligence|growth)
│   │   ├── wikilinks.ts        # link (suggest|validate|feedback|stubs|unlinked|dashboard|unsuppress|timeline|...)
│   │   ├── migrations.ts       # (schema actions: rename_field, migrate absorbed into schema)
│   │   ├── metrics.ts          # (insights action: growth)
│   │   ├── semantic.ts         # init_semantic
│   │   └── brief.ts            # (memory action: brief)
│   └── write/                  # Write-side tool registrations
│       ├── mutations.ts        # edit_section (add|remove|replace)
│       ├── tasks.ts            # vault_add_task (standalone), tasks(action: toggle) in primitives.ts
│       ├── notes.ts            # note (create|delete) and legacy note files
│       ├── move-notes.ts       # note (move|rename)
│       ├── frontmatter.ts      # vault_update_frontmatter
│       ├── entity.ts           # entity (alias|merge) + correct (record|list|resolve|undo)
│       ├── corrections.ts      # correct tool source logic
│       ├── wikilinkFeedback.ts # link (feedback action)
│       ├── tags.ts             # schema (rename_tag action)
│       ├── memory.ts           # memory (store|get|search|list|forget|summarize_session|brief)
│       ├── config.ts           # (doctor action: config)
│       ├── system.ts           # (correct action: undo)
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

**Presets (3-tier progressive disclosure):**

<!-- GENERATED:preset-counts START -->
| Preset | Tools | Categories | Behaviour |
|--------|-------|------------|-----------|
| `agent` (default) | 14 | search, read, write, tasks, memory, diagnostics | Focused tier-1 surface — search, read, write, tasks, memory |
| `power` | 18 | search, read, write, tasks, memory, diagnostics, wikilinks, corrections, note-ops, schema | Tier 1+2 — agent + wikilinks, corrections, note-ops, schema |
| `full` | 20 | search, read, write, tasks, memory, diagnostics, wikilinks, corrections, note-ops, schema, graph, temporal | All categories visible at startup |
| `auto` | 21 | search, read, write, graph, schema, wikilinks, corrections, tasks, memory, note-ops, temporal, diagnostics | Full surface + informational `discover_tools` helper |
<!-- GENERATED:preset-counts END -->

<!-- GENERATED:claude-code-memory-note START -->
> **Claude Code note:** the `memory` merged tool is suppressed under Claude Code
> (`CLAUDECODE=1`) because Claude Code ships its own memory plane. Agent preset
> exposes 13 tools under Claude Code instead of 14;
> the briefing entrypoint still works as `memory(action: "brief")`.
<!-- GENERATED:claude-code-memory-note END -->

Switch preset at runtime: `flywheel_config` with `key: tool_preset, value: agent|power|full`

Tool counts are computed from `TOOL_CATEGORY` and `TOOL_TIER` in `config.ts` — never hardcode.

**Action-param tools** (merged tools with `action` discriminator):

<!-- GENERATED:action-param-tools START -->
- `correct` — `action: record|list|resolve|undo`
- `doctor` — `action: health|diagnosis|stats|pipeline|config|log`
- `edit_section` — `action: add|remove|replace`
- `entity` — `action: list|alias|suggest_aliases|merge|suggest_merges|dismiss_merge`
- `graph` — `action: analyse|backlinks|forward_links|strong_connections|path|neighbors|strength|cooccurrence_gaps|export`
- `insights` — `action: evolution|staleness|context|note_intelligence|growth`
- `link` — `action: suggest|feedback|unlinked|validate|stubs|dashboard|unsuppress|timeline|layer_timeseries|snapshot_diff`
- `memory` — `action: store|get|search|list|forget|summarize_session|brief`
- `note` — `action: create|move|rename|delete`
- `note_read` — `action: structure|section|sections`
- `policy` — `action: list|validate|preview|execute|author|revise`
- `read` — `action: structure|section|sections`
- `schema` — `action: overview|field_values|conventions|folders|rename_field|rename_tag|migrate|validate`
- `search` — `action: query|similar`
- `tasks` — `action: list|toggle`
<!-- GENERATED:action-param-tools END -->

Note: `tasks(action: toggle)` was merged in T43 B3+; `vault_toggle_task` is retired. `vault_add_task` is still registered as a standalone tool.

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
