<div align="center">
  <img src="header.png" alt="Flywheel Memory" width="256"/>
  <h1>Flywheel Memory</h1>
  <p><strong>Your vault, queryable.</strong></p>
</div>

[![npm version](https://img.shields.io/npm/v/@velvetmonkey/flywheel-memory.svg)](https://www.npmjs.com/package/@velvetmonkey/flywheel-memory)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blueviolet.svg)](https://modelcontextprotocol.io/)
[![CI](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue.svg)](https://github.com/velvetmonkey/flywheel-memory)
[![Scale](https://img.shields.io/badge/scale-100k%20notes-brightgreen.svg)](https://github.com/velvetmonkey/flywheel-memory)

One MCP server. 76 tools. Full read/write access to your Obsidian vault.

Claude can already read files. Flywheel gives it spatial intelligence — backlinks, graph traversal, full-text search, frontmatter queries, and auto-wikilinks. Your vault is 250k tokens. Flywheel answers in 100.

---

## What Changes

| | Raw file access | With Flywheel Memory |
|---|---|---|
| **"What links here?"** | Grep every file | `get_backlinks` — indexed, <10ms |
| **Search across vault** | Read every file into context | FTS5 index with BM25 ranking |
| **Graph queries** | Not possible | Hub detection, path finding, orphan detection |
| **Periodic notes** | Manual date math | `get_daily_note`, `get_weekly_note` with template support |
| **Auto-wikilinks** | Manual | Automatic entity linking on every write |
| **Token cost** | Reads full files | Returns metadata, links, and structure |

---

## Quick Start

**1.** Add `.mcp.json` to your vault root:

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

**2.** Open your vault in Claude Code.

**3.** Ask a question. Claude can now search, query, and edit your vault.

---

## Real Example: Meeting Prep in 30 Seconds

You're Carter, a solo consultant. Three active clients, $200K in annual revenue, and a meeting with Acme Corp in 10 minutes. You haven't looked at their file in weeks.

**The prompt:**
```
What do I need to know about Acme Corp before this call?
```

**Claude uses Flywheel:**
```
[search_notes: "Acme Corp"]
[get_backlinks: "clients/Acme Corp.md"]
[get_note_metadata: "clients/Acme Corp.md"]
```

**The answer (2 seconds, ~200 tokens):**
```
Acme Corp - Quick Brief:
━━━━━━━━━━━━━━━━━━━━━━━━
Contact: Sarah Mitchell, VP Technology
Status: Active - Phase 2 of data migration

Current Project: [[Acme Data Migration]]
  Budget: $75,000 | Billed: $42,000
  Timeline: Oct 2025 - Mar 2026

Pending: [[INV-2025-048]] - $12,000 (December)
Opportunity: [[Acme Analytics Add-on]] - $35,000 proposal

Last touch: 2025-12-30
```

Without Flywheel: search through files manually, read them into context, hope you picked the right ones.
With Flywheel: ask the question, get the answer. The vault is already indexed.

**Follow-up: "What if they delay to Q3?"**
```
Claude: [get_backlinks + frontmatter queries across projects/]

If Acme Data Migration slips:
  - Q1 gap: $33,000 (remaining Acme budget)
  - Current Q1 pipeline: $42,000

Mitigation: [[Beta Corp Dashboard]] needs React help.
Your Q1 stays green if Beta Corp accelerates.
```

Try it yourself: `cd demos/carter-strategy && claude`

---

## Auto-Wikilinks

When Claude writes to your vault, mentions of existing notes are automatically linked:

```
Input:  "Met with Alex about the React migration"
Output: "Met with [[Alex Chen]] about the [[React Migration]]"
```

Flywheel scans your vault for note titles and aliases, then links on every write. Your knowledge graph builds itself.

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

---

## Demo Vaults

6 production-ready vaults representing real knowledge work:

| Demo | Persona | Notes | Try Asking |
|------|---------|-------|------------|
| **[carter-strategy](demos/carter-strategy/)** | Solo Consultant | 32 | "How much have I billed Acme Corp?" |
| **[artemis-rocket](demos/artemis-rocket/)** | Aerospace Engineer | 65 | "What's blocking the propulsion milestone?" |
| **[startup-ops](demos/startup-ops/)** | SaaS Co-Founder | 31 | "Walk me through onboarding DataDriven" |
| **[nexus-lab](demos/nexus-lab/)** | PhD Researcher | 32 | "How does AlphaFold connect to my experiment?" |
| **[solo-operator](demos/solo-operator/)** | Content Creator | 19 | "What's my financial runway?" |
| **[support-desk](demos/support-desk/)** | SaaS Support Team | — | "What are the open P1 tickets?" |

```bash
git clone https://github.com/velvetmonkey/flywheel-memory.git
cd flywheel-memory/demos/carter-strategy && claude
```

---

## Tool Sets

All 76 tools are on by default. Compose your own set from 18 categories.

### Read (12 categories)

| Category | Tools | What it does |
|----------|-------|-------------|
| `search` | `search_notes`, `search_by_tag`, ... | Full-text and tag search |
| `backlinks` | `get_backlinks`, `get_outlinks`, ... | Link graph traversal |
| `orphans` | `find_orphan_notes` | Disconnected note detection |
| `hubs` | `find_hub_notes` | Most-connected notes |
| `paths` | `get_shortest_path` | Graph path finding |
| `temporal` | `get_recent_notes`, `get_notes_in_range` | Time-based queries |
| `periodic` | `get_daily_note`, `get_weekly_note` | Periodic note access |
| `schema` | `get_frontmatter_schema`, ... | Frontmatter analysis |
| `structure` | `get_headings`, `get_note_structure` | Note structure |
| `tasks` | `get_all_tasks`, `get_tasks_with_due_dates` | Task queries |
| `health` | `health_check`, `get_vault_stats` | Vault diagnostics |
| `wikilinks` | `suggest_wikilinks`, `find_broken_links` | Link intelligence |

### Write (6 categories)

| Category | Tools | What it does |
|----------|-------|-------------|
| `append` | `vault_add_to_section`, ... | Section mutations |
| `frontmatter` | `vault_update_frontmatter` | Metadata updates |
| `sections` | `vault_remove_from_section`, ... | Section edits |
| `notes` | `vault_create_note`, `vault_rename_note` | Note CRUD |
| `git` | `vault_git_commit`, `vault_undo` | Version control |
| `policy` | `policy_execute`, `policy_author` | Workflow automation |

### Presets

- **`full`** (default) — All 18 categories, 76 tools
- **`minimal`** — 7 categories (~30 tools) for voice/mobile workflows

### Compose Your Own

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-memory"],
      "env": {
        "FLYWHEEL_TOOLS": "search,backlinks,tasks,notes"
      }
    }
  }
}
```

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `VAULT_PATH` | cwd | Path to your Obsidian vault |
| `FLYWHEEL_TOOLS` | `full` | Tool preset or comma-separated categories |

---

## Migration from Flywheel + Flywheel-Crank

```diff
- "flywheel": { "command": "npx", "args": ["-y", "@velvetmonkey/flywheel-mcp"] }
- "flywheel-crank": { "command": "npx", "args": ["-y", "@velvetmonkey/flywheel-crank"] }
+ "flywheel": { "command": "npx", "args": ["-y", "@velvetmonkey/flywheel-memory"] }
```

All tools work the same. One server instead of two.

---

## Prove It

```bash
git clone https://github.com/velvetmonkey/flywheel-memory.git
cd flywheel-memory && npm install && npm test
```

---

## License

Apache-2.0 — [GitHub](https://github.com/velvetmonkey/flywheel-memory) · [Issues](https://github.com/velvetmonkey/flywheel-memory/issues)
