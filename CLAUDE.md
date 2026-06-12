# Flywheel Memory - Claude Code Instructions

**[[Flywheel]] Memory** — MCP tools that search, write, and auto-link your Obsidian vault — and learn from your edits. 20 merged action-param tools across 3 preset tiers (agent/power/full) organized into 12 categories: search, read, write, graph, schema, wikilinks, corrections, tasks, memory, note-ops, temporal, and diagnostics — all local, all markdown. Hybrid search (BM25 + semantic via Reciprocal Rank Fusion) is available when embeddings are built via `init_semantic`.

---

## Git Workflow

**Direct pushes to main are allowed.** (The repo is private on a free plan, so GitHub
branch protection isn't available; PRs are optional, not required.)

- Commit and push to `main` directly, or open a PR via `gh pr create` if you want review
- Never run `npm run build` while a benchmark is running

---

## Architecture

### Source Structure

```
packages/mcp-server/src/
├── index.ts                    # Composition root: import-time stdio server construction + main() boot sequencing
├── tool-registry.ts            # applyToolGating() (gating, tiering, vault injection, tracking) + registerAllTools()
├── tool-registry/              # Gating support: tiering, activation signals, client suppressions, cross-vault
├── config.ts                   # Tool categories, tiers, presets (pure configuration)
├── instructions.ts             # generateInstructions() — server instructions (runtime embeddings check)
├── vault-registry.ts           # VaultContext + VaultRegistry + parseVaultConfig()
├── vault-types.ts              # Shared vault state types
├── vault-scope.ts              # Per-request vault scope (AsyncLocalStorage)
├── caller-scope.ts             # Per-request caller attribution (X-Flywheel-Caller, AsyncLocalStorage)
├── boot/                       # Boot phases: state, serverFactory (+HTTP pool), vaultBoot, transport, integrity, shutdown, cli
├── resources/vault.ts          # MCP resources (vault://stats, vault://schema, vault://recent)
├── tools/                      # THIN registration layer — zod schemas + dispatch into core/
│   ├── toolCatalog.ts          # Tool metadata collection for embedding manifest
│   ├── read/                   # Read-side registrations (helpers omitted)
│   │   ├── query.ts            # search
│   │   ├── primitives.ts       # read (structure|section|sections|raw), tasks (list|toggle)
│   │   ├── graphTools.ts       # graph (analyse|backlinks|forward_links|strong_connections|path|neighbors|strength|cooccurrence_gaps|export)
│   │   ├── system.ts           # refresh_index
│   │   ├── health.ts           # doctor (health|diagnosis|stats|pipeline|config|log)
│   │   ├── schemaTools.ts      # schema (overview|field_values|conventions|folders|rename_field|rename_tag|migrate|validate)
│   │   ├── insightsTools.ts    # insights (evolution|staleness|context|note_intelligence|growth)
│   │   ├── find_notes.ts       # find_notes
│   │   ├── semantic.ts         # init_semantic
│   │   ├── discovery.ts        # discover_tools (auto preset only)
│   │   └── (helper libs)       # graphAnalysis.ts, graphAdvanced.ts, migrations.ts, schema.ts, frontmatter.ts, brief.ts — no registrations
│   └── write/                  # Write-side tool registrations
│       ├── editSection.ts      # edit_section (add|remove|replace)
│       ├── tasks.ts            # vault_add_task (standalone), tasks(action: toggle) in primitives.ts
│       ├── note.ts             # note (create|move|rename|delete)
│       ├── frontmatter.ts      # vault_update_frontmatter
│       ├── entity.ts           # entity (list|alias|suggest_aliases|merge|suggest_merges|dismiss_merge)
│       ├── correct.ts          # correct (record|list|resolve|undo)
│       ├── link.ts             # link (suggest|feedback|unlinked|validate|stubs|dashboard|unsuppress|timeline|...)
│       ├── memory.ts           # memory (store|get|search|list|forget|supersede|unsupersede|summarize_session|brief)
│       ├── enrich.ts           # (init helpers)
│       └── policy.ts           # policy
├── core/
│   ├── read/                   # Read-side core logic (graph, vault, parser, fts5, config, watch/, toolRouting)
│   │   ├── embeddings/         # Embedding stores, provider, runtime, semantic search
│   │   └── similarity.ts       # Hybrid ranking (BM25 + semantic via RRF)
│   ├── search/                 # Search pipeline: ranking, merge, postProcess, assemble, bridging
│   ├── diagnostics/            # doctor internals: report, diagnosis, stats, healthQueries, configStore
│   ├── write/                  # Write-side core logic (writer, wikilinks, git, validator, policy engine)
│   │   └── pipeline/           # Watcher-driven index/linking/learning/maintenance pipeline
│   └── shared/                 # Shared utilities (recency, cooccurrence, prospects, observer, hub export, stemmer, metrics, indexActivity, toolTracking, graphSnapshots, toolSelectionFeedback)
└── generated/
    └── tool-embeddings.generated.ts  # Pre-computed tool embedding manifest
```

### Multi-Vault & Transport

```
packages/mcp-server/src/
├── vault-registry.ts              # VaultContext interface + VaultRegistry class + parseVaultConfig()
├── tool-registry.ts               # applyToolGating(), registerAllTools()
├── boot/serverFactory.ts          # createConfiguredServer() + HTTP server pool
```

- `vault-registry.ts` — `VaultContext` holds per-vault state (name, vaultPath, stateDb, vaultIndex, flywheelConfig, watcher). `VaultRegistry` tracks all contexts with a primary vault name. `parseVaultConfig()` reads `FLYWHEEL_VAULTS` env var.
- `applyToolGating()` — Monkey-patches `server.tool()` to filter by category. In multi-vault mode, wraps handlers with `activateVault()` and injects optional `vault` parameter on all tools.
- `registerAllTools()` — Calls all tool registration functions. Write tools use `getVaultPath: () => string` getter (not a captured string) so vault switching works.
- `createConfiguredServer()` — Creates a stateless per-request McpServer for HTTP transport (fresh server per POST /mcp).
- `activateVault(ctx)` — Swaps the boot-time fallback/module handles that still need explicit vault activation: `setWriteStateDb`, `setFTS5Database`, `setEmbeddingsDatabase` + `loadEntityEmbeddingsToMemory`. Normal request, watcher, and maintenance execution should run through `runInVaultScope()` / `VaultScope`; recency and task-cache runtime state now resolve from ALS instead of normal module-level setters.
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

Controlled by `FLYWHEEL_TOOLS` / `FLYWHEEL_PRESET` env var. Per-tool category gating in `tool-registry.ts` via monkey-patched `server.tool()`.

**Presets (3-tier progressive disclosure):**

<!-- GENERATED:preset-counts START -->
| Preset | Tools | Categories | Behaviour |
|--------|-------|------------|-----------|
| `agent` (default) | 13 | search, read, write, tasks, memory, diagnostics | Focused tier-1 surface — search, read, write, tasks, memory |
| `power` | 17 | search, read, write, tasks, memory, diagnostics, wikilinks, corrections, note-ops, schema | Tier 1+2 — agent + wikilinks, corrections, note-ops, schema |
| `full` | 19 | search, read, write, tasks, memory, diagnostics, wikilinks, corrections, note-ops, schema, graph, temporal | All categories visible at startup |
| `auto` | 20 | search, read, write, graph, schema, wikilinks, corrections, tasks, memory, note-ops, temporal, diagnostics | Full surface + informational `discover_tools` helper |
<!-- GENERATED:preset-counts END -->

<!-- GENERATED:claude-code-memory-note START -->
> **Claude Code note:** the `memory` merged tool is suppressed under Claude Code
> (`CLAUDECODE=1`) because Claude Code ships its own memory plane. Agent preset
> exposes 12 tools under Claude Code instead of 13;
> the briefing entrypoint still works as `memory(action: "brief")`.
<!-- GENERATED:claude-code-memory-note END -->

Switch preset at runtime: `doctor(action: "config")` with `key: tool_preset, value: agent|power|full`

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
- `memory` — `action: store|get|search|list|forget|supersede|unsupersede|summarize_session|brief`
- `note` — `action: create|move|rename|delete`
- `policy` — `action: list|validate|preview|execute|author|revise`
- `read` — `action: structure|section|sections|raw`
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
