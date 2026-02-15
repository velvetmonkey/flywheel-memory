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
[![Tests](https://img.shields.io/badge/tests-1,757%20passed-brightgreen.svg)](docs/TESTING.md)

One MCP server. 36 tools. Your Obsidian vault becomes a queryable knowledge graph.

---

## The Problem

You have 500 notes. Claude has to read them to answer a question.

A 500-note Obsidian vault is ~250,000 tokens of raw markdown. Dumping that into context
is expensive, slow, and imprecise. Worse, it misses the structure that makes a vault
useful: which notes link to which, what's changed recently, what's orphaned, what's a hub.

File access gives Claude your content. Flywheel gives it your knowledge graph.

| | Without Flywheel | With Flywheel |
|---|---|---|
| "What's overdue?" | Read every file, hope you catch it | Indexed query, <10ms, ~90 tokens |
| "What links here?" | `grep` every file | `get_backlinks` -- pre-indexed graph |
| "Add a meeting note" | Raw file write, no linking | Write + auto-wikilink to existing notes |
| Token cost per query | 2,000-250,000 | 50-200 |
| Query speed | Seconds of file I/O | <10ms in-memory index |
| Scale tested to | Unknown | 100,000 notes |

36 tools. 6-line config. Zero cloud dependencies.

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

**2.** Open your vault in Claude Code:

```bash
cd /path/to/your/vault && claude
```

**3.** Ask a question. Claude can now search, query, and edit your vault through Flywheel's indexed tools instead of reading raw files.

That's it. No API keys. No config files. No cloud accounts.

---

## Live Example: The Flywheel in Action

### Read: "How much have I billed Acme Corp?"

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

Claude didn't read any files. It navigated the graph: backlinks to find related notes,
metadata to extract the numbers. 4 tool calls. ~160 tokens. 0 files read.

The same question without Flywheel would require reading every file in the vault --
thousands of tokens just to find two invoice amounts.

### Write: Auto-wikilinks on every mutation

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

## The Flywheel Effect

The name is literal. Every interaction makes the next one better.

1. **Claude reads** your vault through indexed queries instead of raw file scans
2. **Claude writes** to your vault with auto-wikilinks, connecting new content to existing notes
3. **The graph grows** -- more links mean better search results, hub detection, and path finding
4. **Queries get richer** -- backlinks surface related context that raw search would miss
5. **Repeat** -- each write strengthens the graph, each read leverages it

When Claude writes to your vault, Flywheel scans every note title and alias, then links automatically:

```
Input:  "Met with Sarah about the data migration"
Output: "Met with [[Sarah Mitchell]] about the [[Acme Data Migration]]"
```

No manual linking. No broken references. Use compounds into structure, structure compounds into intelligence.

The more you use it, the smarter it gets. No training. No ML. Just your vault, getting more connected with every interaction.

That's the flywheel.

---

## Prove It: The Numbers

### Test Coverage

| Metric | Count |
|---|---|
| Tests | 1,757 |
| Test files | 78 |
| Lines of test code | 33,000+ |

### Performance

| Operation | Threshold | Typical |
|---|---|---|
| 1k-line mutation | <100ms | ~15ms |
| 10k-line mutation | <500ms | -- |
| 100k-line mutation | <2s | -- |

### Battle-Hardened

This isn't a prototype. Flywheel is tested like production infrastructure:

- **100 parallel writes, zero corruption** -- concurrent mutations verified under stress
- **Property-based fuzzing** -- fast-check with 50+ randomized scenarios testing edge cases
- **SQL injection prevention** -- parameterized queries throughout, no string interpolation
- **Path traversal blocking** -- all file paths validated against vault root
- **Deterministic output** -- every tool produces the same result given the same input

Every demo vault is a real test fixture. If it works in the README, it passes in CI.

```bash
git clone https://github.com/velvetmonkey/flywheel-memory.git
cd flywheel-memory && npm install && npm test
```

See [docs/TESTING.md](docs/TESTING.md) for the full testing methodology.

---

## Demo Vaults

6 production-ready vaults representing real knowledge work:

| Demo | You are | Ask this | Notes |
|------|---------|----------|-------|
| [carter-strategy](demos/carter-strategy/) | Solo consultant | "How much have I billed Acme Corp?" | 32 |
| [artemis-rocket](demos/artemis-rocket/) | Rocket engineer | "What's blocking the propulsion milestone?" | 63 |
| [startup-ops](demos/startup-ops/) | SaaS co-founder | "What's our MRR?" | 31 |
| [nexus-lab](demos/nexus-lab/) | PhD researcher | "How does AlphaFold connect to my experiment?" | 32 |
| [solo-operator](demos/solo-operator/) | Content creator | "How's revenue this month?" | 16 |
| [support-desk](demos/support-desk/) | Support agent | "What's Sarah Chen's situation?" | 12 |

Every demo is a real test fixture. If it works in the README, it passes in CI.

```bash
git clone https://github.com/velvetmonkey/flywheel-memory.git
cd flywheel-memory/demos/carter-strategy && claude
```

---

## Tools Overview

15 categories. 36 tools. Load all of them, or just the ones you need.

| Preset | Tools | ~Tokens | What you get |
|--------|-------|---------|--------------|
| `full` | 36 | ~11,100 | Everything |
| `minimal` | 13 | ~3,800 | Search, read, create, edit |

Start with `minimal`, then add composable bundles:

| Bundle | Tools | What it adds |
|--------|-------|--------------|
| `graph` | 6 | Backlinks, orphans, hubs, shortest paths |
| `analysis` | 6 | Schema intelligence, wikilink validation |
| `tasks` | 3 | Task queries and mutations |
| `health` | 6 | Vault diagnostics, index management |
| `ops` | 2 | Git undo, policy automation |

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-memory"],
      "env": {
        "FLYWHEEL_TOOLS": "minimal,graph,tasks"
      }
    }
  }
}
```

The fewer tools you load, the less context Claude needs to pick the right one.

See [docs/TOOLS.md](docs/TOOLS.md) for the full reference.

---

## Who This Is For

Flywheel is for anyone who uses an Obsidian vault as their working memory
and wants Claude to understand it -- not just read it.

- **Consultants** tracking clients, projects, invoices, and meetings -- see [carter-strategy](demos/carter-strategy/)
- **Engineers** maintaining project docs, decision logs, and architecture notes -- see [artemis-rocket](demos/artemis-rocket/)
- **Founders** running ops, tracking MRR, and managing investors -- see [startup-ops](demos/startup-ops/)
- **Researchers** navigating literature, experiment logs, and citation networks -- see [nexus-lab](demos/nexus-lab/)
- **Creators** managing editorial calendars, drafts, and revenue -- see [solo-operator](demos/solo-operator/)

If your vault has more than a handful of notes, Flywheel makes Claude meaningfully better at working with it.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `VAULT_PATH` | cwd | Path to your Obsidian vault |
| `FLYWHEEL_TOOLS` | `full` | Tool preset or comma-separated categories |

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for all options, presets, and platform-specific setup.

---

## The Vision

Flywheel is one layer of something bigger:

```
voice → transcription → AI agent → structured knowledge → queryable vault
```

Speak into your phone. Your AI processes it. Flywheel writes it to your vault
with proper wikilinks, frontmatter, and structure. Tomorrow, you ask a question
and the answer is already there -- linked, indexed, searchable.

Your vault isn't a filing cabinet. It's a second brain that actually works.

Files are data. Links are relationships. AI agents are operators.

See [docs/VISION.md](docs/VISION.md) for the full picture.

---

## Documentation

| Doc | Description |
|---|---|
| [TOOLS.md](docs/TOOLS.md) | Full tool reference -- all 36 tools, parameters, examples |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Index strategy, FTS5, graph, auto-wikilinks |
| [CONFIGURATION.md](docs/CONFIGURATION.md) | Env vars, presets, custom tool sets |
| [TESTING.md](docs/TESTING.md) | Test methodology, coverage, performance benchmarks |
| [VISION.md](docs/VISION.md) | The flywheel effect and where this goes |

---

## License

Apache-2.0 -- [GitHub](https://github.com/velvetmonkey/flywheel-memory) | [Issues](https://github.com/velvetmonkey/flywheel-memory/issues)
