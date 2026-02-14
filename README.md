<div align="center">
  <h1>Flywheel Memory</h1>
  <p><strong>MCP server that gives Claude full read/write access to your Obsidian vault.</strong></p>
  <p>Search, backlinks, graph queries, daily notes, tasks, frontmatter — 76 tools, all local.</p>
</div>

[![npm version](https://img.shields.io/npm/v/@velvetmonkey/flywheel-memory.svg)](https://www.npmjs.com/package/@velvetmonkey/flywheel-memory)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blueviolet.svg)](https://modelcontextprotocol.io/)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)

---

## Quickstart

Add to your Claude Code MCP config (`.mcp.json` in your vault root):

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

Open your vault in Claude Code. That's it — Claude can now search, query, and edit your vault.

---

## What Can Claude Do With Your Vault?

**Ask questions:**
- "What links to [[Project Alpha]]?"
- "Show me all notes tagged #meeting from last week"
- "What are my incomplete tasks?"
- "How does [[React Hooks]] connect to [[State Management]]?"

**Make changes:**
- "Add a note to today's daily note under ## Log"
- "Create a new note for the meeting I just had"
- "Mark the deployment task as done"
- "Update the status field on [[Project Alpha]] to completed"

**Understand your graph:**
- "What are the most connected notes in my vault?"
- "Find orphan notes with no links"
- "Show me the shortest path between [[Note A]] and [[Note B]]"

---

## 76 Tools

| Category | Tools | Examples |
|----------|-------|---------|
| **Search** | Full-text search, tag search, frontmatter queries | `search_notes`, `search_by_tag`, `search_by_frontmatter` |
| **Graph** | Backlinks, outlinks, hubs, orphans, paths | `get_backlinks`, `find_hub_notes`, `get_shortest_path` |
| **Read** | Sections, frontmatter, tasks, periodic notes | `get_section_content`, `get_frontmatter`, `get_incomplete_tasks` |
| **Write** | Add/remove content, create/move/rename notes | `vault_add_to_section`, `vault_create_note`, `vault_rename_note` |
| **Tasks** | Toggle, add, query tasks | `vault_toggle_task`, `vault_add_task` |
| **Frontmatter** | Update metadata fields | `vault_update_frontmatter` |
| **Git** | Commit, diff, log | `vault_git_commit`, `vault_git_diff` |

### Auto-Wikilinks

When Claude writes to your vault, mentions of existing notes are automatically linked:

```
Input:  "Met with Sarah about the React migration"
Output: "Met with [[Sarah Chen]] about the [[React Migration]]"
```

Flywheel scans your vault for note titles and aliases, then links them on write. No configuration needed.

---

## Why Not Just Let Claude Read Files?

Claude Code can already read and write files. Flywheel adds **vault intelligence**:

| | Raw file access | Flywheel |
|---|---|---|
| **Find what links here** | Grep every file | `get_backlinks` (indexed, <10ms) |
| **Search across vault** | Read every file into context | FTS5 index with BM25 ranking |
| **Graph queries** | Not possible | Hub detection, path finding, orphan detection |
| **Periodic notes** | Manual date math | `get_daily_note`, `get_weekly_note` with template support |
| **Auto-wikilinks** | Manual | Automatic entity linking on every write |
| **Token cost** | Reads full files | Returns just metadata, links, and structure |

A 500-note vault is ~250k tokens to read. Flywheel answers most questions from the index in <10ms and ~100 tokens.

---

## Demo Vaults

Try Flywheel with realistic vaults:

| Demo | Scenario |
|------|----------|
| [Solo Operator](./demos/solo-operator/) | One-person newsletter business |
| [Carter Strategy](./demos/carter-strategy/) | Solo strategy consultant |
| [Support Desk](./demos/support-desk/) | SaaS support team |
| [Artemis Rocket](./demos/artemis-rocket/) | Rocket engineering team |
| [Startup Ops](./demos/startup-ops/) | SaaS startup co-founder |
| [Nexus Lab](./demos/nexus-lab/) | Computational biology researcher |

```bash
cd demos/carter-strategy
# Claude Code will auto-detect .mcp.json
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VAULT_PATH` | cwd | Path to your Obsidian vault |
| `FLYWHEEL_TOOLS` | `full` | Tool preset: `full` (76 tools) or `minimal` (~30 tools) |

### Tool Presets

- **`full`** (default) — All 76 tools. Best for general use.
- **`minimal`** — ~30 tools focused on search, backlinks, tasks, and note editing. Lower context overhead.

You can also pass comma-separated categories: `FLYWHEEL_TOOLS=search,backlinks,tasks,notes`

---

## Migration from Flywheel + Flywheel-Crank

If you're using the separate packages:

```diff
- "flywheel": { "command": "npx", "args": ["-y", "@velvetmonkey/flywheel-mcp"] }
- "flywheel-crank": { "command": "npx", "args": ["-y", "@velvetmonkey/flywheel-crank"] }
+ "flywheel": { "command": "npx", "args": ["-y", "@velvetmonkey/flywheel-memory"] }
```

All tools work the same. One server instead of two.

---

## License

Apache-2.0

---

<div align="center">
  <p><strong>Your vault, indexed. Your notes, linked. Your graph, queryable.</strong></p>
</div>
