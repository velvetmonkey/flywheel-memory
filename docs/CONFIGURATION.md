# Configuration

Two layers of configuration: **environment variables** set in your MCP config (startup-time), and **runtime config** adjustable via the `flywheel_config` tool (persisted in StateDb). No config files to manage.

---

## MCP Config

### Claude Code (`.mcp.json` in vault root)

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-memory"]
    }
  }
}
```

No `FLYWHEEL_TOOLS` needed — defaults to `default` (16 tools). Add it only to override.

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-memory"],
      "env": {
        "VAULT_PATH": "/path/to/your/vault"
      }
    }
  }
}
```

Note: Claude Desktop requires `VAULT_PATH` because it doesn't launch from the vault directory. Claude Code auto-detects the vault root from the working directory.

---

## Windows

On Windows, three things differ from macOS/Linux: the command, the vault path, and file watching.

**`cmd /c` wrapper** — Windows installs `npx` as `npx.cmd` (a batch script). MCP clients use `spawn()` which can't execute `.cmd` files directly, so you must wrap it with `cmd /c`. Without this, the server silently fails with "Connection closed."

**`VAULT_PATH`** — Set this to your vault's Windows path. Claude Code can auto-detect it if you `cd` into the vault first, but setting it explicitly avoids issues.

**`FLYWHEEL_WATCH_POLL`** — Required on Windows. Native file system events are unreliable on Windows, so you must enable polling for the file watcher to track changes. Without it, Flywheel starts fine and searches work, but edits you make in Obsidian won't appear in search results until you manually refresh. This is the most common source of "stale index" issues on Windows.

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@velvetmonkey/flywheel-memory"],
      "env": {
        "VAULT_PATH": "C:\\Users\\you\\obsidian\\MyVault",
        "FLYWHEEL_WATCH_POLL": "true"
      }
    }
  }
}
```

---

## Environment Variables

### Vault Path

| Variable | Default | Description |
|----------|---------|-------------|
| `VAULT_PATH` | cwd | Absolute path to your Obsidian vault |
| `PROJECT_PATH` | — | Alias for `VAULT_PATH` (takes precedence if both set) |

Vault root detection order:
1. `PROJECT_PATH` env var (if set)
2. `VAULT_PATH` env var (if set)
3. Auto-detect: walks up from cwd looking for `.obsidian/` or `.claude/`

### Tool Presets

| Variable | Default | Description |
|----------|---------|-------------|
| `FLYWHEEL_TOOLS` | `default` | Preset, bundle, or comma-separated category list |
| `FLYWHEEL_PRESET` | — | Alias for `FLYWHEEL_TOOLS` (either works) |

#### Quick Start

| Preset | Tools | Use case |
|--------|-------|----------|
| `default` (default) | 16 | Note-taking essentials — search, read, write, tasks |
| `agent` | 16 | Autonomous AI agents — search, read, write, memory |
| `full` | 66 | Everything except memory — add `,memory` for all 69 |

The fewer tools you load, the less context Claude needs to pick the right one.

#### Composable Bundles

Start with `default`, then add what you need:

| Bundle | Tools | What it adds |
|--------|-------|--------------|
| `graph` | 11 | Structural analysis, semantic analysis, backlinks, forward links, hubs, paths, connections, graph export |
| `schema` | 7 | Schema inspection, conventions, validation, note intelligence, migrations, tag rename |
| `wikilinks` | 7 | Link suggestions, validation, feedback, discovery |
| `corrections` | 4 | Correction recording + resolution |
| `tasks` | 3 | Task queries and mutations (already included in `default`) |
| `memory` | 3 | Agent working memory + recall + brief |
| `note-ops` | 4 | Delete, move, rename notes, merge entities |
| `temporal` | 4 | Time-based vault intelligence: get_context_around_date, predict_stale_notes, track_concept_evolution, temporal_summary |
| `diagnostics` | 14 | Vault health, stats, config, activity, merges, doctor |

#### Recipes

| Config | Tools | What you get |
|--------|-------|--------------|
| `default` | 16 | search, read, write, tasks |
| `agent` | 16 | search, read, write, memory |
| `default,graph` | 26 | default + graph analysis, semantic analysis, paths, hubs |
| `default,graph,wikilinks` | 33 | + link suggestions, validation |
| `full` | 66 | All categories except memory |

#### How It Works

Set `FLYWHEEL_TOOLS` to a preset, one or more bundles, individual categories, or any combination — comma-separated. Bundles expand to their constituent categories, and duplicates are deduplicated automatically.

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "default,graph,tasks"
  }
}
```

Unknown names are ignored with a warning. If nothing valid is found, falls back to `default`.

#### Category Reference

| Category | Tools | What's included |
|----------|-------|-----------------|
| `search` | 3 | search, init_semantic, find_similar |
| `read` | 3 | get_note_structure, get_section_content, find_sections |
| `write` | 7 | vault_add/remove/replace_in_section, vault_update_frontmatter, vault_create_note, vault_undo_last_mutation, policy |
| `graph` | 11 | graph_analysis, semantic_analysis, get_backlinks, get_forward_links, connection strength, entities, paths, neighbors, weighted/strong links, export_graph |
| `schema` | 7 | vault_schema, schema_conventions, schema_validate, note_intelligence, rename_field, migrate_field_values, rename_tag |
| `wikilinks` | 7 | suggest_wikilinks, validate_links, wikilink_feedback, discover_stub_candidates, discover_cooccurrence_gaps, suggest_entity_aliases, unlinked_mentions_report |
| `corrections` | 4 | vault_record_correction, vault_list/resolve_correction, absorb_as_alias |
| `tasks` | 3 | tasks, vault_toggle_task, vault_add_task |
| `memory` | 3 | memory, recall, brief |
| `note-ops` | 4 | vault_delete/move/rename_note, merge_entities |
| `diagnostics` | 14 | health_check, get_vault_stats, get_folder_structure, refresh_index, get_all_entities, get_unlinked_mentions, vault_growth, vault_activity, flywheel_config, server_log, suggest/dismiss_merge, vault_init, flywheel_doctor |

Deprecated aliases (`minimal`, `writer`, `researcher`, `backlinks`, `structure`, `append`, `frontmatter`, `notes`, `orphans`, `hubs`, `paths`, `health`, `analysis`, `git`, `ops`) still work with a warning — they resolve to current category names.

#### Preset → Category Mapping

| Category | Tools | `default` | `agent` | `full` |
|----------|------:|:---------:|:-------:|:------:|
| search | 3 | Yes | Yes | Yes |
| read | 3 | Yes | Yes | Yes |
| write | 7 | Yes | Yes | Yes |
| tasks | 3 | Yes | | Yes |
| memory | 3 | | Yes | |
| graph | 11 | | | Yes |
| schema | 7 | | | Yes |
| wikilinks | 7 | | | Yes |
| corrections | 4 | | | Yes |
| note-ops | 4 | | | Yes |
| temporal | 4 | | | Yes |
| diagnostics | 14 | | | Yes |
| **Total** | **69** | **16** | **16** | **66** |

### Semantic Embeddings

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | HuggingFace model for semantic embeddings. Model change triggers rebuild. |

Known models (pre-configured dimensions):

| Model | Dimensions | Notes |
|-------|-----------|-------|
| `Xenova/all-MiniLM-L6-v2` | 384 | Default. Good quality/speed balance. 23 MB. |
| `Xenova/all-MiniLM-L12-v2` | 384 | Slightly better quality, 2x slower. |
| `Xenova/bge-small-en-v1.5` | 384 | BGE family, strong on retrieval benchmarks. |
| `nomic-ai/nomic-embed-text-v1` | 768 | Higher dimensional, better for large vaults. |

Any HuggingFace Transformers-compatible model can be used — unknown models auto-probe their output dimensions on first run.

**How hybrid search works:** The `init_semantic` tool builds embeddings for all vault notes. Once built, `search` and `find_similar` automatically upgrade to hybrid mode — queries run through both BM25 (keyword matching via FTS5) and semantic similarity (cosine distance on embeddings), merged via Reciprocal Rank Fusion (RRF). The model is downloaded automatically on first run to `~/.cache/huggingface/`. The file watcher keeps embeddings current as you edit.

### Advanced

| Variable | Default | Description |
|----------|---------|-------------|
| `FLYWHEEL_SKIP_FTS5` | `false` | Skip FTS5 full-text search index build at startup. Useful for testing. |
| `FLYWHEEL_SKIP_EMBEDDINGS` | `false` | Skip automatic embedding rebuild at startup |
| `FLYWHEEL_AGENT_ID` | — | Agent identifier for multi-agent memory provenance. When set, memories stored via the `memory` tool are tagged with this ID. |

### Transport

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `FLYWHEEL_TRANSPORT` | `stdio`, `http`, `both` | `stdio` | Transport mode |
| `FLYWHEEL_HTTP_PORT` | number | `3111` | HTTP server port |
| `FLYWHEEL_HTTP_HOST` | string | `127.0.0.1` | HTTP bind address |

- **`stdio`** — Standard MCP transport for Claude Code and Claude Desktop
- **`http`** — HTTP transport for non-Claude clients (Cursor, Windsurf, VS Code, Continue, LangGraph)
- **`both`** — Runs stdio + HTTP simultaneously (two McpServer instances, shared state)

DNS rebinding protection is automatically enabled when bound to localhost/127.0.0.1/::1.

```json
{
  "env": {
    "FLYWHEEL_TRANSPORT": "http",
    "FLYWHEEL_HTTP_PORT": "3111"
  }
}
```

### Multi-Vault

| Variable | Format | Default |
|----------|--------|---------|
| `FLYWHEEL_VAULTS` | `name1:/path1,name2:/path2` | (single vault) |

Serve multiple Obsidian vaults from a single server instance. Falls back to `VAULT_PATH`/`PROJECT_PATH` for single-vault mode when not set.

#### When to use multi-vault

- **Personal + work vaults** — keep personal notes separate from work, search across both
- **Client-specific vaults** alongside a shared knowledge base
- **Team vaults** with individual workspaces

#### How it works

Each vault gets fully isolated state:

- Separate `.flywheel/state.db` per vault root
- Separate in-memory graph index
- Separate file watcher
- Separate runtime config (`FlywheelConfig`)

The first vault in the list is the **primary**. Tools without a `vault` parameter default to the primary vault — except `search`, which searches all vaults.

#### Tool behavior

| Behavior | `vault` specified | `vault` omitted |
|----------|-------------------|-----------------|
| `search` | Searches that vault only | Searches **all** vaults, merges results |
| All other tools | Operates on that vault | Operates on primary vault |

#### Cross-vault search

1. Query runs independently against each vault's index
2. Results merged into a single list with a `vault` field on each result
3. Sorted by `rrf_score`
4. Response includes `method: "cross_vault"` and `vaults_searched: [...]`

#### Configuration examples

**Personal + Work** (most common):

```json
{
  "env": {
    "FLYWHEEL_VAULTS": "personal:/home/user/obsidian/Personal,work:/home/user/obsidian/Work",
    "FLYWHEEL_TRANSPORT": "http"
  }
}
```

**Team setup** (3 vaults):

```json
{
  "env": {
    "FLYWHEEL_VAULTS": "shared:/data/team-vault,alice:/home/alice/vault,bob:/home/bob/vault"
  }
}
```

**Windows paths** — note that single-character vault names followed by `:\` are ambiguous with drive letters. Use descriptive names:

```json
{
  "env": {
    "FLYWHEEL_VAULTS": "personal:C:\\Users\\you\\obsidian\\Personal,work:C:\\Users\\you\\obsidian\\Work"
  }
}
```

#### Health endpoint

With multi-vault, the health endpoint reports all vault names:

```json
{ "status": "ok", "version": "2.0.103", "vault": "/path/primary", "vaults": ["personal", "work"] }
```

For client-specific configuration examples (Cursor, Windsurf, VS Code, Continue), see [SETUP.md](SETUP.md).

### File Watcher

| Variable | Default | Description |
|----------|---------|-------------|
| `FLYWHEEL_WATCH` | `true` | Set to `false` to disable file watching entirely |
| `FLYWHEEL_WATCH_POLL` | `false` | Set to `true` for polling mode. Required on Windows. |
| `FLYWHEEL_DEBOUNCE_MS` | `200` | Milliseconds to wait after last file change before rebuilding index |
| `FLYWHEEL_FLUSH_MS` | `1000` | Maximum wait time before flushing event batch |
| `FLYWHEEL_BATCH_SIZE` | `50` | Maximum events per batch before forcing flush |
| `FLYWHEEL_POLL_INTERVAL` | `10000` | Polling interval in ms (when `FLYWHEEL_WATCH_POLL=true`) |

The file watcher uses per-path debouncing, event coalescing, backpressure handling, and error recovery. Any `.md` file change triggers an index rebuild after the debounce period.

```json
{
  "env": {
    "FLYWHEEL_DEBOUNCE_MS": "500"
  }
}
```

#### Polling Mode

For file systems where native events are unreliable (required on Windows — see [Windows](#windows) above):

```json
{
  "env": {
    "FLYWHEEL_WATCH_POLL": "true",
    "FLYWHEEL_POLL_INTERVAL": "15000"
  }
}
```

---

## Auto-Inferred Configuration

Flywheel automatically detects vault conventions at startup. No manual configuration needed.

### Periodic Note Folders

Flywheel scans your folder structure and matches against common naming patterns:

| Type | Detected folder names |
|------|----------------------|
| Daily | `daily`, `dailies`, `journal`, `journals`, `daily-notes`, `daily_notes` |
| Weekly | `weekly`, `weeklies`, `weekly-notes`, `weekly_notes` |
| Monthly | `monthly`, `monthlies`, `monthly-notes`, `monthly_notes` |
| Quarterly | `quarterly`, `quarterlies`, `quarterly-notes`, `quarterly_notes` |
| Yearly | `yearly`, `yearlies`, `annual`, `yearly-notes`, `yearly_notes` |
| Templates | `template`, `templates` |

Root-level folders are preferred over nested ones.

### Recurring Task Tags

Tags matching these patterns are auto-detected for task filtering:

`habit`, `habits`, `daily`, `weekly`, `monthly`, `recurring`, `routine`, `template`

### Vault Name

Inferred from the vault root folder name.

---

## Runtime Configuration

Runtime config is persisted in StateDb and survives server restarts. Read or update via the `flywheel_config` tool (requires `diagnostics` category).

### Common Toggles

Most people only need a handful of these. Here's what to reach for:

**"Too many links on my notes"**

```
flywheel_config({ mode: "set", key: "wikilink_strictness", value: "conservative" })
```

Raises the minimum score threshold from 10 → 18. Only high-confidence matches get through.

**"I don't want background linking — only link when I explicitly ask"**

```
flywheel_config({ mode: "set", key: "proactive_linking", value: false })
```

Disables the file watcher's auto-insert. Wikilinks still apply on explicit write tool calls.

**"Daily notes are getting flooded with links"**

```
flywheel_config({ mode: "set", key: "adaptive_strictness", value: false })
```

By default, daily notes use aggressive strictness regardless of your global setting. This turns that off.

**"Stop linking common words that happen to be entity names"**

```
flywheel_config({ mode: "set", key: "exclude_entities", value: ["API", "MCP", "UI"] })
```

These entity names will never be auto-linked. Useful when short/common words collide with note titles.

**"I don't want dead wikilinks to notes that don't exist"**

```
flywheel_config({ mode: "set", key: "implicit_detection", value: false })
```

Turns off pattern-based detection (proper nouns, CamelCase, acronyms). Only existing notes get linked.

**"I want more links, not fewer"**

```
flywheel_config({ mode: "set", key: "wikilink_strictness", value: "aggressive" })
flywheel_config({ mode: "set", key: "proactive_max_per_file", value: 5 })
flywheel_config({ mode: "set", key: "proactive_max_per_day", value: 20 })
```

Lowers the score threshold to 5, increases the watcher limits. More links, more graph density, more noise.

**"Show me everything that's currently set"**

```
flywheel_config({ mode: "get" })
```

Returns the full config object. Every key, current value, and default.

---

The full reference for all keys is below.

### Reading Config

```
flywheel_config({ mode: "get" })
```

Returns the full config object with all current values.

### Setting Config

```
flywheel_config({ mode: "set", key: "wikilink_strictness", value: "conservative" })
```

Sets a single key and returns the updated config.

### Available Keys

#### Wikilink Behavior

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `wikilink_strictness` | `"conservative"` \| `"balanced"` \| `"aggressive"` | `"balanced"` | Controls the minimum score threshold for auto-wikilink suggestions. Conservative (18) reduces noise. Aggressive (5) maximizes discovery. |
| `adaptive_strictness` | boolean | `true` | When enabled, daily notes automatically use aggressive strictness regardless of the global setting. Disable if daily notes are getting too many links. |
| `implicit_detection` | boolean | `true` | Detect potential entities from patterns like proper nouns, CamelCase, quoted terms — even when no backing note exists. Creates dead wikilinks that signal "this could be a note." |
| `implicit_patterns` | string[] | all 5 | Which implicit detection patterns to use. Options: `"proper-nouns"`, `"single-caps"`, `"quoted-terms"`, `"camel-case"`, `"acronyms"`. |
| `proactive_linking` | boolean | `true` | When enabled, the file watcher automatically inserts high-confidence wikilinks into vault files during batch processing. Only links scoring above `proactive_min_score` are applied. Disable if you want auto-linking only through explicit write tool calls. |
| `proactive_min_score` | number | `20` | Minimum suggestion score for proactive linking. Higher values mean fewer but more confident auto-links. The default of 20 is well above the balanced threshold (10), ensuring only strong matches are applied automatically. |
| `proactive_max_per_file` | number | `3` | Maximum number of wikilinks the watcher will proactively insert per file per batch. Prevents flooding notes with links during a single watcher cycle. |
| `proactive_max_per_day` | number | `10` | Maximum number of wikilinks the watcher will proactively insert per file per day. Prevents accumulated queue drains from flooding a single note over time. |

#### Exclusions

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `exclude_entities` | string[] | `[]` | Entity names to never auto-link. Use when a valid entity name collides with a common word in your vault. |
| `exclude_entity_folders` | string[] | `[]` | Folders to exclude from entity scanning. Notes in these folders won't be indexed as entities. Useful for `templates/`, `archive/`, etc. |
| `exclude_task_tags` | string[] | `[]` | Tags to exclude from task queries. Tasks with these tags are filtered out of `tasks` tool results. |
| `exclude_analysis_tags` | string[] | `[]` | Tags to exclude from schema analysis. Notes with these tags are skipped by `vault_schema` and `note_intelligence`. |

#### Vault Structure (auto-inferred, read-only)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `vault_name` | string | (inferred from folder name) | Display name for the vault. |
| `paths` | object | (auto-detected) | Periodic note folder paths. Sub-keys: `daily_notes`, `weekly_notes`, `monthly_notes`, `quarterly_notes`, `yearly_notes`, `templates`. Override if auto-detection picks the wrong folder. |
| `templates` | object | (auto-detected) | Template file paths. Sub-keys: `daily`, `weekly`, `monthly`, `quarterly`, `yearly`. |

> **Note:** `paths` and `templates` are auto-detected at startup. They cannot be changed via `flywheel_config` — use `vault_init` to override them.

### Examples

**Reduce link noise** — switch to conservative and disable implicit detection:

```
flywheel_config({ mode: "set", key: "wikilink_strictness", value: "conservative" })
flywheel_config({ mode: "set", key: "implicit_detection", value: false })
```

**Exclude archive from entity scanning:**

```
flywheel_config({ mode: "set", key: "exclude_entity_folders", value: ["archive", "templates"] })
```

**Stop a specific entity from being auto-linked:**

```
flywheel_config({ mode: "set", key: "exclude_entities", value: ["MCP", "API"] })
```

**Only detect proper nouns (disable CamelCase, acronyms, etc.):**

```
flywheel_config({ mode: "set", key: "implicit_patterns", value: ["proper-nouns"] })
```

---

## Data Storage

Flywheel stores its state in your vault directory:

| Path | Purpose |
|------|---------|
| `.flywheel/state.db` | Consolidated state database (SQLite, WAL mode) |

This is local-only and safe to delete (it rebuilds automatically). Add it to `.gitignore` if your vault is version-controlled.

---

## Common Configurations

### Voice/Mobile (Minimal)

Smallest tool set for voice pipelines or mobile contexts:

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "default"
  }
}
```

### Note-Taking + Tasks

Daily notes, task management, basic editing — the `default` preset includes tasks:

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "default"
  }
}
```

### Autonomous Agent

Memory-enabled preset for agents (e.g., flywheel-engine):

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "agent"
  }
}
```

### Knowledge Work

Note-taking + graph navigation for research and consulting:

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "default,graph,tasks"
  }
}
```

### Research Vault

Full graph + schema + wikilink intelligence for deep analysis:

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "default,graph,wikilinks"
  }
}
```

### Read-Only Vault

All read tools, no mutations:

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "search,read,graph,schema,wikilinks,tasks,diagnostics"
  }
}
```
