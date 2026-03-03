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
| `FLYWHEEL_PRESET` | — | Alias for `FLYWHEEL_TOOLS` (either works) |

#### Quick Start

| Preset | Tools | Use case |
|--------|-------|----------|
| `full` (default) | 51 | Everything — graph, schema, tasks, policy, memory |
| `minimal` | 11 | Note-taking essentials — search, read, create, edit |
| `writer` | 14 | minimal + task management |
| `agent` | 14 | minimal + agent memory (brief, recall, memory) |
| `researcher` | 12 | Search + graph navigation — read-heavy exploration |

The fewer tools you load, the less context Claude needs to pick the right one.

#### Composable Bundles

Start with `minimal`, then add what you need:

| Bundle | Tools | What it adds |
|--------|-------|--------------|
| `graph` | 7 | Backlinks, orphans, hubs, shortest paths |
| `analysis` | 9 | Schema intelligence, wikilink validation, content similarity |
| `tasks` | 3 | Task queries and mutations |
| `health` | 12 | Vault diagnostics, index management, growth, activity, config, merges |
| `ops` | 2 | Git undo, policy automation |
| `note-ops` | 4 | Delete, move, rename notes, merge entities |

#### Recipes

| Config | Tools | Categories |
|--------|-------|------------|
| `minimal` | 11 | search, structure, append, frontmatter, notes |
| `writer` | 14 | minimal + tasks |
| `agent` | 14 | minimal + memory |
| `minimal,graph,tasks` | 21 | minimal + backlinks, orphans, hubs, paths, tasks |
| `minimal,graph,analysis` | 27 | minimal + backlinks, orphans, hubs, paths, schema, wikilinks |
| `full` | 51 | All 17 categories |

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

**Read categories (12):**

| Category | Tools | Description |
|----------|-------|-------------|
| `search` | 2 | Unified search (metadata, content, entities), semantic index initialization |
| `backlinks` | 2 | Backlinks (+ bidirectional), forward links |
| `orphans` | 1 | Graph analysis (orphans, dead ends, sources, hubs, stale, immature, evolution, emerging hubs) |
| `hubs` | 2 | Connection strength, entity listing |
| `paths` | 2 | Shortest path, common neighbors |
| `schema` | 6 | Vault schema, note intelligence, field migrations, content similarity |
| `structure` | 4 | Note structure, section content, find sections, metadata |
| `tasks` | 3 | Task queries and mutations (read + write) |
| `health` | 12 | Vault stats, diagnostics, index management, growth metrics, activity tracking, config, merge suggestions |
| `wikilinks` | 3 | Link suggestions, link validation, feedback |
| `memory` | 3 | Agent working memory (store/recall/brief) |

Note: `memory` spans read+write. `tasks` also spans read+write.

**Write categories (6):**

| Category | Tools | Description |
|----------|-------|-------------|
| `append` | 3 | Add, remove, replace content in sections |
| `frontmatter` | 1 | Update frontmatter fields |
| `notes` | 1 | Create notes |
| `note-ops` | 4 | Delete, move, rename notes, merge entities |
| `git` | 1 | Undo last mutation |
| `policy` | 1 | Policy workflow automation |

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

### Advanced

| Variable | Default | Description |
|----------|---------|-------------|
| `FLYWHEEL_SKIP_FTS5` | `false` | Skip FTS5 full-text search index build at startup. Useful for testing. |
| `FLYWHEEL_AGENT_ID` | — | Agent identifier for multi-agent memory provenance. When set, memories stored via the `memory` tool are tagged with this ID. |

### File Watcher

| Variable | Default | Description |
|----------|---------|-------------|
| `FLYWHEEL_WATCH` | `true` | Set to `false` to disable file watching entirely |
| `FLYWHEEL_WATCH_POLL` | `false` | Set to `true` for polling mode. Use on network drives, Docker volumes, or WSL. |
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

For network drives, Docker volumes, or file systems where native events are unreliable:

```json
{
  "env": {
    "FLYWHEEL_WATCH_POLL": "true",
    "FLYWHEEL_POLL_INTERVAL": "15000"
  }
}
```

#### Windows

Native file system events (`inotify`) don't work across the WSL/Windows boundary. If your vault lives on the Windows side (e.g. `/mnt/c/...`), you must enable polling:

```json
{
  "env": {
    "FLYWHEEL_WATCH_POLL": "true",
    "VAULT_PATH": "/mnt/c/Users/you/Obsidian/MyVault"
  }
}
```

This also applies to Docker volumes mounted from Windows and network drives (SMB/CIFS). Native Windows (no WSL) works without polling.

### Semantic Search

The `init_semantic` tool builds a semantic search index by generating embeddings for all vault notes using the `all-MiniLM-L6-v2` model. This is a one-time build step — once the index exists, `search` and `find_similar` automatically upgrade to hybrid mode.

**How hybrid search works:** Queries run through both BM25 (keyword matching via FTS5) and semantic similarity (cosine distance on embeddings). Results are merged using Reciprocal Rank Fusion (RRF), which combines the two ranked lists into a single ranking that benefits from both keyword precision and semantic recall.

**Model selection:** The embedding model defaults to `Xenova/all-MiniLM-L6-v2` but can be changed via the `EMBEDDING_MODEL` environment variable. A model registry includes 4 known models with pre-configured dimensions; unknown models auto-probe their output dimensions. Changing models triggers a full embedding rebuild.

**Model download:** The model is downloaded automatically on first run to `~/.cache/huggingface/`. No environment variables are needed — just run `init_semantic` and the index builds from your existing vault content.

**Keeping embeddings current:** The file watcher automatically generates embeddings for new and modified notes, so the semantic index stays up to date after the initial build.

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

Runtime config is persisted in StateDb and survives server restarts. Read or update via the `flywheel_config` tool (requires `health` category).

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

#### Exclusions

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `exclude_entities` | string[] | `[]` | Entity names to never auto-link. Use when a valid entity name collides with a common word in your vault. |
| `exclude_entity_folders` | string[] | `[]` | Folders to exclude from entity scanning. Notes in these folders won't be indexed as entities. Useful for `templates/`, `archive/`, etc. |
| `exclude_task_tags` | string[] | `[]` | Tags to exclude from task queries. Tasks with these tags are filtered out of `tasks` tool results. |
| `exclude_analysis_tags` | string[] | `[]` | Tags to exclude from schema analysis. Notes with these tags are skipped by `vault_schema` and `note_intelligence`. |

#### Vault Structure (auto-inferred, overridable)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `vault_name` | string | (inferred from folder name) | Display name for the vault. |
| `paths` | object | (auto-detected) | Periodic note folder paths. Sub-keys: `daily_notes`, `weekly_notes`, `monthly_notes`, `quarterly_notes`, `yearly_notes`, `templates`. Override if auto-detection picks the wrong folder. |
| `templates` | object | (auto-detected) | Template file paths. Sub-keys: `daily`, `weekly`, `monthly`, `quarterly`, `yearly`. |

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
