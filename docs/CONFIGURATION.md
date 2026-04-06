# Configuration

[← Back to docs](README.md)

Two layers of configuration: **environment variables** set in your MCP config (startup-time), and **runtime config** adjustable via the `flywheel_config` tool (persisted in StateDb). No config files to manage.

> **First time?** You only need the [MCP Config](#mcp-config) section — one JSON block, zero environment variables. Everything else is optional.

- [MCP Config](#mcp-config)
  - [Claude Code (`.mcp.json` in vault root)](#claude-code-mcpjson-in-vault-root)
  - [Claude Desktop (`claude_desktop_config.json`)](#claude-desktop-claude_desktop_configjson)
- [Windows](#windows)
- [Environment Variables](#environment-variables)
  - [Vault Path](#vault-path)
  - [Tool Presets](#tool-presets)
    - [Quick Start](#quick-start)
    - [Composable Bundles](#composable-bundles)
    - [Recipes](#recipes)
    - [How It Works](#how-it-works)
    - [Category Reference](#category-reference)
    - [Preset → Category Mapping](#preset--category-mapping)
  - [Semantic Embeddings](#semantic-embeddings)
  - [Advanced](#advanced)
  - [Transport](#transport)
  - [Multi-Vault](#multi-vault)
    - [When to use multi-vault](#when-to-use-multi-vault)
    - [How it works](#how-it-works-1)
    - [Tool behavior](#tool-behavior)
    - [Cross-vault search](#cross-vault-search)
    - [Configuration examples](#configuration-examples)
    - [Health endpoint](#health-endpoint)
  - [File Watcher](#file-watcher)
    - [Polling Mode](#polling-mode)
- [Auto-Inferred Configuration](#auto-inferred-configuration)
  - [Periodic Note Folders](#periodic-note-folders)
  - [Recurring Task Tags](#recurring-task-tags)
  - [Vault Name](#vault-name)
- [Runtime Configuration](#runtime-configuration)
  - [Common Toggles](#common-toggles)
  - [Reading Config](#reading-config)
  - [Setting Config](#setting-config)
  - [Available Keys](#available-keys)
    - [Wikilink Behavior](#wikilink-behavior)
    - [Custom Categories](#custom-categories)
    - [Exclusions](#exclusions)
    - [Vault Structure (auto-inferred, read-only)](#vault-structure-auto-inferred-read-only)
  - [Examples](#examples)
- [Data Storage](#data-storage)
- [Common Configurations](#common-configurations)
  - [Voice/Mobile (Minimal)](#voicemobile-minimal)
  - [Note-Taking + Tasks](#note-taking--tasks)
  - [Memory-Enabled Sessions](#memory-enabled-sessions)
  - [Knowledge Work](#knowledge-work)
  - [Research Vault](#research-vault)
  - [Read-Only Vault](#read-only-vault)

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

No `FLYWHEEL_TOOLS` needed — defaults to `agent` (search, read, write, tasks, memory). Add it only to override.

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

Note: Claude Desktop requires `VAULT_PATH` because it doesn't launch from the vault directory. `Claude Code` auto-detects the vault root from the working directory.

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
| `FLYWHEEL_TOOLS` | `agent` | Preset, bundle, or comma-separated category list |
| `FLYWHEEL_PRESET` | — | Alias for `FLYWHEEL_TOOLS` (either works) |

#### Quick Start

| Preset | Behaviour |
|--------|-----------|
| `agent` (default) | Fixed set — search, read, write, tasks, memory |
| `full` | All tools visible at startup |
| `auto` | Progressive disclosure across the full surface via `discover_tools` |

#### Composable Bundles

Start with `agent`, then add what you need:

| Bundle | What it adds |
|--------|--------------|
| `graph` | Structural analysis, semantic analysis, entity lists, paths, neighbor overlap, connection strength |
| `schema` | Schema inspection, conventions, validation, note intelligence, migrations, tag rename |
| `wikilinks` | Link suggestions, validation, feedback, discovery |
| `corrections` | Correction recording + resolution |
| `tasks` | Task queries and mutations (already included in `agent`) |
| `memory` | Session memory + brief |
| `note-ops` | Delete, move, rename notes, merge entities |
| `temporal` | get_context_around_date, predict_stale_notes, track_concept_evolution |
| `diagnostics` | Vault health, config, merges, doctor, trust, benchmark, session/entity history, learning report, calibration export, pipeline status |

#### Recipes

| Config | What you get |
|--------|--------------|
| `agent` | search, read, write, tasks, memory |
| `agent,graph` | agent + graph analysis, semantic analysis, paths, hubs |
| `agent,graph,wikilinks` | + link suggestions, validation |
| `full` | All categories, all tools visible immediately |
| `auto` | All categories, progressive disclosure |

#### How It Works

Set `FLYWHEEL_TOOLS` to a preset, one or more bundles, individual categories, or any combination — comma-separated. Bundles expand to their constituent categories, and duplicates are deduplicated automatically.

`agent` is the default — search, read, write, tasks, memory. No progressive disclosure. Compose with bundles for more capabilities (e.g. `agent,graph`).

`full` enables all categories and advertises the 65-tool surface at startup. Use this when you want everything visible immediately.

`auto` enables progressive disclosure via `discover_tools` across three tiers:

- **Tier 1** stays visible at startup: 19 core tools from `agent` plus `discover_tools`
- **Tier 2** unlocks when the conversation shifts into graph, wikilink, correction, temporal, or diagnostics work
- **Tier 3** stays on-demand for schema operations, note operations, and deep diagnostics

`default` is a deprecated alias for `agent`, retained for backward compatibility.

In `auto` mode, use `flywheel_config({ mode: "set", key: "tool_tier_override", value: "full" })` to reveal everything immediately, or `"minimal"` to keep only tier-1 tools advertised. This setting has no effect in `full` or `agent` mode.

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "agent,graph,tasks"
  }
}
```

Unknown names are ignored with a warning. If nothing valid is found, falls back to `agent`.

#### Tool Routing

`FLYWHEEL_TOOL_ROUTING` controls how tier-2 and tier-3 tools are activated:

| Mode | Behaviour |
|------|-----------|
| `pattern` | Regex-only activation from query keywords |
| `hybrid` (default when all categories loaded — `full` or `auto`) | Regex + semantic embedding signals combined |
| `semantic` | Semantic-only for hybrid search calls; regex fallback elsewhere |

Semantic activation fires only on `search` and `brief` calls that use the hybrid search path (requires `init_semantic`). The query is embedded and compared against a pre-generated tool description manifest. Hits with cosine similarity ≥ 0.30 activate the corresponding category, up to three categories per query. Both pattern and semantic signals are combined; the highest tier per category wins.

Custom `EMBEDDING_MODEL` users fall back to `pattern` unless the tool manifest was regenerated for that model (`npm run generate:tool-embeddings`).

#### Category Reference

| Category | What's included |
|----------|-----------------|
| `search` | search, init_semantic, find_similar, discover_tools (`auto` only) |
| `read` | get_note_structure, get_section_content, find_sections |
| `write` | vault_add_to_section, vault_remove_from_section, vault_replace_in_section, vault_update_frontmatter, vault_create_note, vault_undo_last_mutation, policy |
| `graph` | graph_analysis, semantic_analysis, get_connection_strength, list_entities, get_link_path, get_common_neighbors |
| `schema` | vault_schema, schema_conventions, schema_validate, note_intelligence, rename_field, migrate_field_values, rename_tag |
| `wikilinks` | suggest_wikilinks, validate_links, wikilink_feedback, discover_stub_candidates, discover_cooccurrence_gaps, suggest_entity_aliases, unlinked_mentions_report |
| `corrections` | vault_record_correction, vault_list_corrections, vault_resolve_correction, absorb_as_alias |
| `tasks` | tasks, vault_toggle_task, vault_add_task |
| `memory` | memory, brief |
| `note-ops` | vault_delete_note, vault_move_note, vault_rename_note, merge_entities |
| `temporal` | get_context_around_date, predict_stale_notes, track_concept_evolution |
| `diagnostics` | pipeline_status, refresh_index, vault_growth, flywheel_config, server_log, suggest_entity_merges, dismiss_merge_suggestion, vault_init, flywheel_doctor, flywheel_trust_report, flywheel_benchmark, vault_session_history, vault_entity_history, flywheel_learning_report, flywheel_calibration_export, tool_selection_feedback |

Deprecated aliases (`minimal`, `writer`, `researcher`, `backlinks`, `structure`, `append`, `frontmatter`, `notes`, `orphans`, `hubs`, `paths`, `health`, `analysis`, `git`, `ops`) still work — they resolve to current category names.

#### Preset → Category Mapping

| Category | `agent` | `full` |
|----------|:-------:|:------:|
| search | Yes | Yes |
| read | Yes | Yes |
| write | Yes | Yes |
| tasks | Yes | Yes |
| memory | Yes | Yes |
| graph | | Yes |
| schema | | Yes |
| wikilinks | | Yes |
| corrections | | Yes |
| note-ops | | Yes |
| temporal | | Yes |
| diagnostics | | Yes |

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
| `FLYWHEEL_TOOL_ROUTING` | `hybrid` | Tool activation routing mode. `pattern` = regex-only (T13 behavior), `hybrid` = regex + semantic embedding signals, `semantic` = semantic-only for hybrid search calls (regex fallback elsewhere). Default is `hybrid` when tiered exposure is active, `pattern` otherwise. Semantic activation only fires on search calls that use the hybrid search path (requires `init_semantic`). Custom `EMBEDDING_MODEL` users fall back to `pattern` unless the manifest was regenerated for that model. See [Tool Routing](#tool-routing) above for details. |

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
| `proactive_max_per_file` | number | `5` | Maximum number of wikilinks the watcher will proactively insert per file per drain cycle. The daily cap (`proactive_max_per_day`) is the primary safety net. |
| `proactive_max_per_day` | number | `10` | Maximum number of wikilinks the watcher will proactively insert per file per day. Prevents accumulated queue drains from flooding a single note over time. |
| `tool_tier_override` | `"auto"` \| `"full"` \| `"minimal"` | `"auto"` | Controls tiered tool visibility when `FLYWHEEL_TOOLS=auto`. `auto` keeps tiered exposure, `full` reveals all tools, `minimal` keeps only tier-1 tools visible. Has no effect in `full` or `agent` mode. |
| `custom_categories` | object | `{}` | Define custom entity categories from frontmatter `type:` values. Keys are the type strings; values have optional `type_boost` (scoring weight, default 0). See [Custom Categories](#custom-categories) below. |

#### Custom Categories

By default, Flywheel classifies entities into 18 built-in categories (people, projects, technologies, etc.). Entities that don't match any pattern end up in "other" — which means they get zero type boost in scoring and are invisible to category-level analytics.

**Custom categories fix this.** If your vault uses frontmatter `type:` fields that don't map to built-in categories, define them here and they'll be treated as first-class categories with their own scoring weight.

```
flywheel_config({
  mode: "set",
  key: "custom_categories",
  value: {
    "work-ticket": { "type_boost": 2 },
    "recipe": { "type_boost": 1 },
    "client": { "type_boost": 3 },
    "statute": { "type_boost": 2 }
  }
})
```

**How it works:**
- An entity note with `type: work-ticket` in its frontmatter gets category `work-ticket` instead of falling through to "other"
- The `type_boost` controls how strongly the scoring pipeline favors linking this category (0 = neutral, 5 = strong preference, like people)
- Built-in frontmatter type mappings still work (`type: person` → people, `type: tool` → technologies, etc.)
- Custom categories appear in `flywheel_calibration_export` survival-by-category data, making the calibration signal meaningful for your vault's ontology
- No schema migration needed — the database already stores categories as free text

**When to use this:**
- Your vault has domain-specific note types (legal: statutes/cases, cooking: recipes/ingredients, work: tickets/sprints)
- More than ~15% of your entities are categorized as "other"
- You want the scoring pipeline to weight your custom types differently from the defaults

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
    "FLYWHEEL_TOOLS": "agent"
  }
}
```

### Note-Taking + Tasks

Daily notes, task management, basic editing — the `agent` preset includes tasks:

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "agent"
  }
}
```

### Memory-Enabled Sessions

Memory tools (brief, memory) are included in the `agent` preset. No additional configuration needed.

### Knowledge Work

Note-taking + graph navigation for research and consulting:

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "agent,graph,tasks"
  }
}
```

### Research Vault

Full graph + schema + wikilink intelligence for deep analysis:

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "agent,graph,wikilinks"
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
