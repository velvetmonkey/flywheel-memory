# Configuration

All configuration is through environment variables in your MCP config. No config files to manage.

---

## MCP Config

### Claude Code (`.mcp.json` in vault root)

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-memory"],
      "env": {
        "FLYWHEEL_TOOLS": "full"
      }
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-memory"],
      "env": {
        "VAULT_PATH": "/path/to/your/vault",
        "FLYWHEEL_TOOLS": "full"
      }
    }
  }
}
```

Note: Claude Desktop requires `VAULT_PATH` because it doesn't launch from the vault directory. Claude Code auto-detects the vault root from the working directory.

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
3. Auto-detect: walks up from cwd looking for `.obsidian/` or `.mcp.json`

### Tool Presets

| Variable | Default | Description |
|----------|---------|-------------|
| `FLYWHEEL_TOOLS` | `full` | Preset, bundle, or comma-separated category list |

#### Quick Start

| Preset | Tools | ~Tokens | Use case |
|--------|-------|---------|----------|
| `full` | 36 | ~11,100 | Everything — graph, schema, tasks, policy |
| `minimal` | 13 | ~3,800 | Note-taking essentials — search, read, create, edit |

The fewer tools you load, the less context Claude needs to pick the right one.

#### Composable Bundles

Start with `minimal`, then add what you need:

| Bundle | Tools | ~Tokens | What it adds |
|--------|-------|---------|--------------|
| `graph` | 6 | ~1,850 | Backlinks, orphans, hubs, shortest paths |
| `analysis` | 6 | ~1,850 | Schema intelligence, wikilink validation |
| `tasks` | 3 | ~925 | Task queries and mutations |
| `health` | 6 | ~1,850 | Vault diagnostics, index management |
| `ops` | 2 | ~625 | Git undo, policy automation |

#### Recipes

| Config | Tools | ~Tokens | Categories |
|--------|-------|---------|------------|
| `minimal` | 13 | ~3,800 | search, structure, append, frontmatter, notes |
| `minimal,graph,tasks` | 22 | ~6,575 | + backlinks, orphans, hubs, paths, tasks |
| `minimal,graph,analysis` | 25 | ~7,500 | + backlinks, orphans, hubs, paths, schema, wikilinks |
| `minimal,graph,tasks,health` | 28 | ~8,425 | + backlinks, orphans, hubs, paths, tasks, health |
| `full` | 36 | ~11,100 | All 15 categories |

#### How It Works

Set `FLYWHEEL_TOOLS` to a preset, one or more bundles, individual categories, or any combination — comma-separated. Bundles expand to their constituent categories, and duplicates are deduplicated automatically.

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "minimal,graph,tasks"
  }
}
```

Unknown names are ignored with a warning. If nothing valid is found, falls back to `full`.

#### Category Reference

**Read categories (10):**

| Category | Tools | Description |
|----------|-------|-------------|
| `search` | 1 | Unified search (metadata, content, entities) |
| `backlinks` | 2 | Backlinks (+ bidirectional), forward links |
| `orphans` | 1 | Graph analysis (orphans, dead ends, sources, hubs, stale) |
| `hubs` | 1 | Connection strength |
| `paths` | 2 | Shortest path, common neighbors |
| `schema` | 4 | Vault schema, note intelligence, field migrations |
| `structure` | 4 | Note structure, section content, find sections, metadata |
| `tasks` | 3 | Task queries and mutations (read + write) |
| `health` | 6 | Vault stats, diagnostics, index management |
| `wikilinks` | 2 | Link suggestions, link validation |

**Write categories (5):**

| Category | Tools | Description |
|----------|-------|-------------|
| `append` | 3 | Add, remove, replace content in sections |
| `frontmatter` | 1 | Update frontmatter fields |
| `notes` | 4 | Create, delete, move, rename notes |
| `git` | 1 | Undo last mutation |
| `policy` | 1 | Policy workflow automation |

### File Watcher

| Variable | Default | Description |
|----------|---------|-------------|
| `FLYWHEEL_WATCH` | `true` | Set to `false` to disable file watching entirely |
| `FLYWHEEL_WATCH_V2` | `false` | Set to `true` for battle-hardened v2 watcher |
| `FLYWHEEL_WATCH_POLL` | `false` | Set to `true` for polling mode (enables v2 watcher). Use on network drives or Docker volumes. |
| `FLYWHEEL_DEBOUNCE_MS` | `60000` (v1) / `200` (v2) | Milliseconds to wait after last file change before rebuilding index |
| `FLYWHEEL_FLUSH_MS` | `1000` | v2 only: maximum wait time before flushing event batch |
| `FLYWHEEL_POLL_INTERVAL` | `30000` | v2 only: polling interval in ms (when `FLYWHEEL_WATCH_POLL=true`) |

#### Watcher v1 (default)

Uses chokidar with a simple debounce timer. Any `.md` file change starts a countdown; when the countdown expires, the full index is rebuilt. Good for most setups.

```json
{
  "env": {
    "FLYWHEEL_DEBOUNCE_MS": "30000"
  }
}
```

#### Watcher v2 (opt-in)

Per-path debouncing, event coalescing, backpressure handling, and error recovery. Better for large vaults or rapid editing sessions.

```json
{
  "env": {
    "FLYWHEEL_WATCH_V2": "true",
    "FLYWHEEL_DEBOUNCE_MS": "500"
  }
}
```

#### Polling Mode

For network drives, Docker volumes, or file systems where native events are unreliable:

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
    "FLYWHEEL_TOOLS": "minimal"
  }
}
```

### Note-Taking + Tasks

Daily notes, task management, basic editing:

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "minimal,tasks"
  }
}
```

### Knowledge Work

Note-taking + graph navigation for research and consulting:

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "minimal,graph,tasks"
  }
}
```

### Research Vault

Full graph + schema intelligence for deep analysis:

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "minimal,graph,analysis"
  }
}
```

### Read-Only Vault

All read tools, no mutations:

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "search,backlinks,orphans,hubs,paths,schema,structure,tasks,health,wikilinks"
  }
}
```
