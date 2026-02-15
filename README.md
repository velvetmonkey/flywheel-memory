<div align="center">
  <img src="header.png" alt="Flywheel" width="256"/>
  <h1>Flywheel</h1>
  <p><strong>Your vault already knows the answer. Flywheel finds it.</strong></p>
</div>

[![npm version](https://img.shields.io/npm/v/@velvetmonkey/flywheel-memory.svg)](https://www.npmjs.com/package/@velvetmonkey/flywheel-memory)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blueviolet.svg)](https://modelcontextprotocol.io/)
[![CI](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue.svg)](https://github.com/velvetmonkey/flywheel-memory)
[![Scale](https://img.shields.io/badge/scale-100k%20notes-brightgreen.svg)](https://github.com/velvetmonkey/flywheel-memory)

One MCP server. Your Obsidian vault becomes a queryable knowledge graph --
backlinks, full-text search, auto-wikilinks, and structured writes.
Load every tool or just the ones you need.

---

## The Problem

You have 500 notes. Claude has to read them to answer a question.

| | Without Flywheel | With Flywheel |
|---|---|---|
| "What's overdue?" | Read every file, hope you catch it | Indexed query, <10ms, ~90 tokens |
| "What links here?" | `grep` every file | `get_backlinks` -- pre-indexed graph |
| "Add a meeting note" | Raw file write, no linking | Write + auto-wikilink to existing notes |
| Token cost per query | 2,000-250,000 | 50-200 |

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

## Real Example: "How much have I billed Acme Corp?"

From the [carter-strategy](demos/carter-strategy/) demo -- a solo consultant with 3 clients, 5 projects, and $27K in invoices.

```
❯ How much have I billed Acme Corp?

● flywheel › get_backlinks
  path: "clients/Acme Corp.md"
  ← invoices/INV-2025-047.md
    invoices/INV-2025-048.md
    projects/Acme Data Migration.md
    proposals/Acme Analytics Add-on.md

┌─ CLAUDE THINKS ───────────────────────────────────────┐
│ 2 invoices found. Pull frontmatter for amounts.       │
│ Skip projects, proposals -- not billing data.         │
└───────────────────────────────────────────────────────┘

● flywheel › get_note_metadata
  path: "invoices/INV-2025-047.md"
  ← amount: 15000, status: paid, period: November 2025

● flywheel › get_note_metadata
  path: "invoices/INV-2025-048.md"
  ← amount: 12000, status: pending, period: December 2025

┌─ RESULT ──────────────────────────────────────────────┐
│ Acme Corp Billing: $27,000                            │
│                                                       │
│   Paid:    $15,000 — Acme Data Migration (Nov 2025)   │
│   Pending: $12,000 — Acme Data Migration (Dec 2025)   │
│                                                       │
│ 4 tool calls · ~160 tokens · 0 files read             │
└───────────────────────────────────────────────────────┘
```

Now write something:

```
❯ Log that I finished the Acme strategy deck

● flywheel › vault_add_to_section
  path: "daily-notes/2026-01-04.md"
  section: "Log"
  content: "finished the [[Acme Corp]] strategy deck"
                       ↑ auto-linked because Acme Corp.md exists
```

Try it yourself: `cd demos/carter-strategy && claude`

---

## Your graph builds itself

When Claude writes to your vault, Flywheel scans every note title
and alias, then links automatically:

```
Input:  "Met with Sarah about the data migration"
Output: "Met with [[Sarah Mitchell]] about the [[Acme Data Migration]]"
```

Every write operation strengthens your knowledge graph. No manual linking.
No broken references. The more you use it, the more connected it gets.

That's the flywheel.

---

## Where This Goes

Flywheel is one layer of something bigger:

```
voice → transcription → AI agent → structured knowledge → queryable vault
```

Speak into your phone. Your AI processes it. Flywheel writes it to your vault
with proper wikilinks, frontmatter, and structure. Tomorrow, you ask a question
and the answer is already there -- linked, indexed, searchable.

Your vault isn't a filing cabinet. It's a second brain that actually works.

---

## Try It

6 production-ready vaults representing real knowledge work:

| Demo | You are | Ask this | Notes |
|------|---------|----------|-------|
| [carter-strategy](demos/carter-strategy/) | Solo consultant | "How much have I billed Acme Corp?" | 32 |
| [artemis-rocket](demos/artemis-rocket/) | Rocket engineer | "What's blocking the propulsion milestone?" | 63 |
| [startup-ops](demos/startup-ops/) | SaaS co-founder | "What's our MRR?" | 31 |
| [nexus-lab](demos/nexus-lab/) | PhD researcher | "How does AlphaFold connect to my experiment?" | 32 |
| [solo-operator](demos/solo-operator/) | Content creator | "How's revenue this month?" | 16 |
| [support-desk](demos/support-desk/) | Support agent | "What's Sarah Chen's situation?" | 12 |

```bash
git clone https://github.com/velvetmonkey/flywheel-memory.git
cd flywheel-memory/demos/carter-strategy && claude
```

---

## Tools

Flywheel ships 15 tool categories. Load all of them, or just the ones you need.

**Presets:**
- `full` (default) -- everything
- `minimal` -- search, backlinks, tasks, notes (~24 tools, great for voice/mobile)

**Or compose your own:**

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

The fewer tools you load, the less context Claude needs to pick the right one.

See [docs/TOOLS.md](docs/TOOLS.md) for the full reference.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `VAULT_PATH` | cwd | Path to your Obsidian vault |
| `FLYWHEEL_TOOLS` | `full` | Tool preset or comma-separated categories |

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for all options, presets, and platform-specific setup.

---

## Prove It

1,757 tests. Verified at 100,000 notes. Every demo vault is a real test case.

```bash
git clone https://github.com/velvetmonkey/flywheel-memory.git
cd flywheel-memory && npm install && npm test
```

---

## Docs

| | |
|---|---|
| [TOOLS.md](docs/TOOLS.md) | Full tool reference |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Index strategy, FTS5, graph, auto-wikilinks |
| [CONFIGURATION.md](docs/CONFIGURATION.md) | Env vars, presets, custom tool sets |
| [VISION.md](docs/VISION.md) | The flywheel effect and where this goes |

---

## License

Apache-2.0 -- [GitHub](https://github.com/velvetmonkey/flywheel-memory) · [Issues](https://github.com/velvetmonkey/flywheel-memory/issues)
