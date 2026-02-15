# Migration Guide

Flywheel Memory replaces two separate packages with one unified server.

---

## Before and After

**Before:** Two servers, two processes, shared vault access.

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-mcp"]
    },
    "flywheel-crank": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-crank"]
    }
  }
}
```

**After:** One server, one process, all tools.

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

---

## What Changed

### Package Consolidation

| Old Package | New Home | Notes |
|-------------|----------|-------|
| `@velvetmonkey/flywheel-mcp` | `@velvetmonkey/flywheel-memory` | All 54 read tools preserved |
| `@velvetmonkey/flywheel-crank` | `@velvetmonkey/flywheel-memory` | All 22 write tools preserved |

### Tool Names

All tool names are unchanged. No code or prompt changes needed.

- `search_notes` works the same
- `get_backlinks` works the same
- `vault_add_to_section` works the same
- `vault_create_note` works the same

Every tool from both packages exists in Flywheel Memory with the same name, parameters, and behavior.

### State Storage

| Old | New |
|-----|-----|
| `.flywheel/entities.json` | `.flywheel/state.db` (SQLite) |
| `.flywheel/entity-index.json` | `.flywheel/state.db` |
| `.flywheel/config.json` | `.flywheel/state.db` |
| `.claude/vault-search.db` | `.claude/vault-search.db` (unchanged) |

Flywheel Memory consolidates JSON config files into a single SQLite database. Legacy JSON files are auto-migrated on first startup.

### New Capabilities

Features added in the consolidation:

- **Tool presets** -- `FLYWHEEL_TOOLS` env var for category-based tool selection
- **Index caching** -- Cached index in StateDb for faster startup (~100ms vs seconds)
- **Unified entity index** -- Single source of truth for entities, shared between read and write
- **v2 file watcher** -- Optional battle-hardened watcher with per-path debouncing
- **Policy engine** -- YAML-based workflow automation (9 new tools)
- **Schema intelligence** -- 13 tools for frontmatter analysis, validation, and migration

---

## Step-by-Step Migration

### 1. Update MCP Config

**Claude Code** (`.mcp.json`):

```diff
{
  "mcpServers": {
-   "flywheel": {
-     "command": "npx",
-     "args": ["-y", "@velvetmonkey/flywheel-mcp"]
-   },
-   "flywheel-crank": {
-     "command": "npx",
-     "args": ["-y", "@velvetmonkey/flywheel-crank"]
-   }
+   "flywheel": {
+     "command": "npx",
+     "args": ["-y", "@velvetmonkey/flywheel-memory"]
+   }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`):

```diff
{
  "mcpServers": {
-   "flywheel": {
-     "command": "npx",
-     "args": ["-y", "@velvetmonkey/flywheel-mcp"],
-     "env": { "VAULT_PATH": "/path/to/vault" }
-   },
-   "flywheel-crank": {
-     "command": "npx",
-     "args": ["-y", "@velvetmonkey/flywheel-crank"],
-     "env": { "VAULT_PATH": "/path/to/vault" }
-   }
+   "flywheel": {
+     "command": "npx",
+     "args": ["-y", "@velvetmonkey/flywheel-memory"],
+     "env": { "VAULT_PATH": "/path/to/vault" }
+   }
  }
}
```

### 2. Restart Claude

Claude Code: restart your terminal session or Claude Code.

Claude Desktop: restart the application.

### 3. Verify

Ask Claude: "Run health_check" -- should show all tools registered and vault accessible.

---

## Environment Variable Changes

| Old (flywheel-mcp) | Old (flywheel-crank) | New (flywheel-memory) |
|---------------------|----------------------|-----------------------|
| `VAULT_PATH` | `VAULT_PATH` | `VAULT_PATH` (same) |
| — | — | `FLYWHEEL_TOOLS` (new) |
| — | — | `FLYWHEEL_WATCH` (new) |
| — | — | `FLYWHEEL_WATCH_V2` (new) |
| — | — | `FLYWHEEL_DEBOUNCE_MS` (new) |

---

## FAQ

**Do I need to delete the old packages?**

No. npm will simply stop using them when you update your MCP config. You can optionally remove the npx cache with `npx clear-npx-cache` if you want to reclaim disk space.

**Will my vault data be affected?**

No. Flywheel Memory only reads `.md` files and writes to `.flywheel/state.db`. Your vault content is untouched during migration.

**What about legacy `.flywheel/*.json` files?**

They are auto-migrated to SQLite on first startup. You can safely delete the JSON files afterward.

**Can I run the old and new packages side by side?**

Not recommended. Both would try to write to the same vault, potentially causing conflicts with the entity index and wikilinks. Switch completely to Flywheel Memory.

**What if a tool I use is missing?**

All tools from both old packages are included. If `FLYWHEEL_TOOLS` is set to a preset other than `full`, some categories may be disabled. Set `FLYWHEEL_TOOLS=full` (or remove the env var) to restore all tools.
