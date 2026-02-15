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
| `FLYWHEEL_TOOLS` | `full` | Preset name or comma-separated category list |

#### Presets

| Preset | Categories | Tool Count | Token Cost |
|--------|------------|------------|------------|
| `full` | All 15 categories | 36 tools | ~11,100 tokens |
| `minimal` | 8 categories | 24 tools | ~5,200 tokens |

**`full` categories:**
`search`, `backlinks`, `orphans`, `hubs`, `paths`, `schema`, `structure`, `tasks`, `health`, `wikilinks`, `append`, `frontmatter`, `notes`, `git`, `policy`

**`minimal` categories:**
`search`, `backlinks`, `health`, `tasks`, `append`, `frontmatter`, `notes`, `structure`

#### Custom Tool Sets

Compose your own set from the 15 categories:

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "search,backlinks,tasks,notes"
  }
}
```

You can also mix presets with categories:

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "minimal,schema,git"
  }
}
```

Unknown categories are ignored with a warning. If no valid categories are found, falls back to `full`.

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
| `structure` | 3 | Note structure, section content, find sections |
| `tasks` | 3 | Task queries and mutations (read + write) |
| `health` | 7 | Vault stats, diagnostics, index management, metadata |
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

### Read-Only Vault

Only search and graph tools, no mutations:

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "search,backlinks,orphans,hubs,paths,schema,structure,tasks,health,wikilinks"
  }
}
```

### Voice/Mobile (Minimal)

Smallest tool set for voice pipelines or mobile contexts:

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "minimal"
  }
}
```

### Research Vault

Search, graph analysis, and schema intelligence:

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "search,backlinks,orphans,hubs,paths,schema,structure,health"
  }
}
```

### Task Management

Focus on tasks with minimal graph tools:

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "search,tasks,append,frontmatter,notes"
  }
}
```
