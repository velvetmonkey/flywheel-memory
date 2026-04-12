# Configuration

[← Back to docs](README.md)

Flywheel has two configuration layers:

- startup configuration in your MCP client via environment variables
- runtime configuration via `doctor(action: "config")`

Most users only need `VAULT_PATH` and, optionally, `FLYWHEEL_TOOLS`.

- [MCP Config](#mcp-config)
- [Environment Variables](#environment-variables)
- [Tool Presets](#tool-presets)
- [Preset And Routing Model](#preset-and-routing-model)
- [Runtime Configuration](#runtime-configuration)
- [Multi-Vault](#multi-vault)
- [Transport And Platform Notes](#transport-and-platform-notes)
- [Retired And Merged Names](#retired-and-merged-names)

## MCP Config

### Codex (`.codex/config.toml`)

```toml
[mcp_servers.flywheel]
command = "npx"
args = ["-y", "@velvetmonkey/flywheel-memory@latest"]
cwd = "/path/to/project"
startup_timeout_sec = 120
tool_timeout_sec = 120
env = { FLYWHEEL_VAULTS = "personal:/path/to/vault", FLYWHEEL_TOOLS = "power" }
```

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

`agent` is the default. Add `FLYWHEEL_TOOLS` only if you want a different preset or explicit bundles.

<!-- GENERATED:claude-code-memory-note START -->
> **Claude Code note:** the `memory` merged tool is suppressed under Claude Code
> (`CLAUDECODE=1`) because Claude Code ships its own memory plane. Agent preset
> exposes 13 tools under Claude Code instead of 14;
> the briefing entrypoint still works as `memory(action: "brief")`.
<!-- GENERATED:claude-code-memory-note END -->

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

Claude Desktop usually needs `VAULT_PATH` because it does not launch from the vault directory.

## Environment Variables

| Variable | Default | Use it for |
|---|---|---|
| `PROJECT_PATH` | — | Preferred vault path alias if set |
| `VAULT_PATH` | cwd / auto-detect | Single-vault path |
| `FLYWHEEL_TOOLS` | `agent` | Preset, bundle, or comma-separated category list |
| `FLYWHEEL_PRESET` | — | Alias for `FLYWHEEL_TOOLS` |
| `FLYWHEEL_TOOL_ROUTING` | `hybrid` | Tool-selection hinting mode: `pattern`, `hybrid`, or `semantic` |
| `FLYWHEEL_VAULTS` | — | Multi-vault mode |
| `FLYWHEEL_TRANSPORT` | `stdio` | `stdio`, `http`, or `both` |
| `FLYWHEEL_HTTP_PORT` | `3111` | HTTP port |
| `FLYWHEEL_HTTP_HOST` | `127.0.0.1` | HTTP bind address |
| `FLYWHEEL_WATCH_POLL` | platform default | Polling watcher mode, mainly for Windows |
| `EMBEDDING_MODEL` | local default | Override the local embeddings model |

## Tool Presets

### Quick Start

| Preset | Best for |
|---|---|
| `agent` | Focused everyday read/write work |
| `power` | Agent plus link cleanup, schema work, corrections, and note ops |
| `full` | Entire tool surface visible immediately |
| `auto` | Backward compatibility with older discovery-first workflows |

<!-- GENERATED:preset-counts START -->
| Preset | Tools | Categories | Behaviour |
|--------|-------|------------|-----------|
| `agent` (default) | 14 | search, read, write, tasks, memory, diagnostics | Focused tier-1 surface — search, read, write, tasks, memory |
| `power` | 18 | search, read, write, tasks, memory, diagnostics, wikilinks, corrections, note-ops, schema | Tier 1+2 — agent + wikilinks, corrections, note-ops, schema |
| `full` | 20 | search, read, write, tasks, memory, diagnostics, wikilinks, corrections, note-ops, schema, graph, temporal | All categories visible at startup |
| `auto` | 21 | search, read, write, graph, schema, wikilinks, corrections, tasks, memory, note-ops, temporal, diagnostics | Full surface + informational `discover_tools` helper |
<!-- GENERATED:preset-counts END -->

### How Presets Work

- `agent` is the default.
- `power` and `full` are just larger static surfaces.
- `auto` now behaves like `full` plus the `discover_tools` compatibility helper.
- `discover_tools` does not reveal, unlock, or activate categories.
- Unknown preset or bundle names are ignored with a warning; if nothing valid remains, Flywheel falls back to `agent`.

## Preset And Routing Model

Preset choice and routing are separate concerns.

- `FLYWHEEL_TOOLS` / `FLYWHEEL_PRESET` decide which categories are visible.
- `FLYWHEEL_TOOL_ROUTING` affects how Flywheel chooses or suggests tools within that visible surface.

Today the visibility model is static:

- `agent` for the focused everyday surface
- `power` for link cleanup, schema work, corrections, and note operations
- `full` for the whole surface
- `auto` for backward compatibility only

What `auto` means now:

- it behaves like `full`
- it may include `discover_tools` for older clients
- it does not perform progressive disclosure

What routing means now:

- `pattern`, `hybrid`, and `semantic` influence tool-selection hints and analysis
- routing can improve which visible tool gets chosen first
- routing does not reveal hidden tools or expand the preset mid-session

What feedback means now:

- feedback improves reporting and future routing analysis
- feedback does not change runtime visibility during the current session

### Bundles And Categories

You can combine presets and bundles:

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "agent,graph,wikilinks"
  }
}
```

Supported bundle names match categories:
- `graph`
- `schema`
- `wikilinks`
- `corrections`
- `tasks`
- `memory`
- `note-ops`
- `temporal`
- `diagnostics`

#### Category Reference

<!-- GENERATED:category-reference START -->
| Category | Tools |
|----------|-------|
| `search` | init_semantic, search |
| `read` | find_notes, note_read, read |
| `write` | edit_section, note, policy, vault_update_frontmatter |
| `graph` | graph |
| `schema` | schema |
| `wikilinks` | link |
| `corrections` | correct |
| `tasks` | tasks, vault_add_task |
| `memory` | memory |
| `note-ops` | entity |
| `temporal` | insights |
| `diagnostics` | doctor, refresh_index |
<!-- GENERATED:category-reference END -->

#### Preset → Category Mapping

<!-- GENERATED:preset-category-map START -->
| Category | `agent` | `power` | `full` | `auto` |
|----------|:------:|:------:|:------:|:------:|
| search | Yes | Yes | Yes | Yes |
| read | Yes | Yes | Yes | Yes |
| write | Yes | Yes | Yes | Yes |
| graph |  |  | Yes | Yes |
| schema |  | Yes | Yes | Yes |
| wikilinks |  | Yes | Yes | Yes |
| corrections |  | Yes | Yes | Yes |
| tasks | Yes | Yes | Yes | Yes |
| memory | Yes | Yes | Yes | Yes |
| note-ops |  | Yes | Yes | Yes |
| temporal |  |  | Yes | Yes |
| diagnostics | Yes | Yes | Yes | Yes |
<!-- GENERATED:preset-category-map END -->

## Runtime Configuration

Use `doctor(action: "config")` for runtime settings. They are stored in StateDb and survive restarts.

### Read Current Config

```text
doctor({
  action: "config",
  mode: "get"
})
```

### Set One Config Key

```text
doctor({
  action: "config",
  mode: "set",
  key: "proactive_linking",
  value: false
})
```

### Common Keys

| Key | Type | Use it for |
|---|---|---|
| `wikilink_strictness` | `"conservative" | "balanced" | "aggressive"` | Overall suggestion strictness |
| `implicit_detection` | boolean | Whether prospective entities are detected during writes |
| `adaptive_strictness` | boolean | Whether scoring adapts based on vault signal quality |
| `proactive_linking` | boolean | Whether the watcher applies high-confidence links outside explicit tool calls |
| `proactive_min_score` | number | Minimum proactive score threshold |
| `proactive_max_per_file` | number | Cap proactive links per file |
| `proactive_max_per_day` | number | Daily proactive link cap |
| `exclude` | string[] | Tags or entities to suppress from suggestions |
| `exclude_entity_folders` | string[] | Folders to ignore during entity scanning |
| `implicit_patterns` | string[] | Override or narrow the pattern set used for prospective entities |
| `custom_categories` | object | Add `type:` categories with custom scoring boosts |
| `vault_name` | string | Friendly vault label |
| `tool_tier_override` | `"auto" | "full" | "minimal"` | Deprecated compatibility key; accepted but has no runtime effect |

### Deprecated Compatibility Keys

These keys are still accepted because older vaults and clients may already use them:

| Key | Status |
|---|---|
| `exclude_task_tags` | Deprecated alias; prefer `exclude` |
| `exclude_analysis_tags` | Deprecated alias; prefer `exclude` |
| `exclude_entities` | Deprecated alias; prefer `exclude` |

### Example Recipes

#### Turn Off Proactive Linking

```text
doctor({
  action: "config",
  mode: "set",
  key: "proactive_linking",
  value: false
})
```

#### Use Conservative Wikilinks

```text
doctor({
  action: "config",
  mode: "set",
  key: "wikilink_strictness",
  value: "conservative"
})
```

#### Add Custom Categories

```text
doctor({
  action: "config",
  mode: "set",
  key: "custom_categories",
  value: {
    "work-ticket": { "type_boost": 2 },
    "recipe": { "type_boost": 1 }
  }
})
```

#### Deprecated Tier Override

```text
doctor({
  action: "config",
  mode: "set",
  key: "tool_tier_override",
  value: "full"
})
```

This succeeds for compatibility but returns a warning because the setting no longer changes runtime visibility.

## Multi-Vault

Use `FLYWHEEL_VAULTS` to serve multiple vaults from one server:

```text
FLYWHEEL_VAULTS="personal:/home/you/obsidian/Personal,work:/home/you/obsidian/Work"
```

Rules:
- the first vault is the primary vault
- `search` without a `vault` parameter searches all vaults and merges results
- most other tools default to the primary vault when `vault` is omitted
- each vault keeps separate indexes, graph state, watcher state, and runtime config

## Transport And Platform Notes

### HTTP

```bash
VAULT_PATH=/path/to/vault FLYWHEEL_TRANSPORT=http npx -y @velvetmonkey/flywheel-memory
```

Use `FLYWHEEL_HTTP_PORT` and `FLYWHEEL_HTTP_HOST` if you need a different bind.

### Windows

On Windows:
- use `cmd /c npx`
- set `VAULT_PATH` explicitly
- set `FLYWHEEL_WATCH_POLL=true`

Without polling, edits made in Obsidian may not appear reliably in the index.

## Retired And Merged Names

- `flywheel_config` is now documented as `doctor(action: "config")`
- `brief()` is now `memory(action: "brief")`
- `tool_tier_override` is deprecated and inert

<!-- GENERATED:retired-tools START -->
- `dismiss_merge_suggestion`
- `flywheel_benchmark`
- `flywheel_calibration_export`
- `flywheel_learning_report`
- `flywheel_trust_report`
- `get_all_entities`
- `get_folder_structure`
- `get_unlinked_mentions`
- `get_vault_stats`
- `health_check`
- `semantic_analysis`
- `suggest_entity_merges`
- `temporal_summary`
- `tool_selection_feedback`
- `unlinked_mentions_report`
- `vault_activity`
- `vault_entity_history`
- `vault_init`
- `vault_session_history`
<!-- GENERATED:retired-tools END -->
