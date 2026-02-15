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
[![Tests](https://img.shields.io/badge/tests-1,812%20passed-brightgreen.svg)](docs/TESTING.md)

One MCP server. 39 tools. Your Obsidian vault becomes a queryable knowledge graph.

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

39 tools. 6-line config. Zero cloud dependencies.

---

## Why Deterministic

When Flywheel suggests `[[Marcus Johnson]]`, it can tell you exactly why:

| Layer | What | Score |
|-------|------|------:|
| Content match | "Marcus" exact word match | +10 |
| Co-occurrence | Appears with "Turbopump" in 4 notes | +6 |
| Type boost | Person entity | +5 |
| Recency | Mentioned 2 hours ago | +8 |
| Cross-folder | Entity in `team/`, note in `projects/` | +3 |
| **Total** | | **32** |

No black box. No embedding. No hallucinated connections.

| | ML/Vector Approach | Flywheel |
|---|---|---|
| "Why was this suggested?" | "Embeddings are close" | "10 + 6 + 5 + 8 + 3 = 32" |
| Requires training data? | Yes | No |
| Same input → same output? | Not guaranteed | Always |
| Runs offline? | Often not | Always |
| Learns your preferences? | Retraining | Implicit feedback loop |

Every number traces to a vault property. See [docs/ALGORITHM.md](docs/ALGORITHM.md) for the full 10-layer pipeline.

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

The name is literal. A flywheel is hard to start but once spinning, each push adds to the momentum. Your vault works the same way.

### Week 1: Connections Appear

You have 30 disconnected notes. Auto-wikilinks create 47 connections on your first day of writing through Flywheel. Search returns structured metadata instead of raw files. You stop reading files and start querying a graph.

### Month 1: Intelligence Emerges

Hub notes surface. "Sarah Mitchell" has 23 backlinks -- she's clearly important. When you write about a project, her name appears in suggestions because co-occurrence tracking knows she's relevant. You didn't configure this. The vault structure revealed it.

### Month 3: The Graph Is Self-Sustaining

Every query leverages hundreds of accumulated connections. New content auto-links to the right places. The feedback system has learned which entities matter in which folders. You stop thinking about organization.

### The Math

A vault with 50 notes has 1,225 potential pairwise connections. With 500 notes: 124,750. Human ability to remember connections stays flat. The graph doesn't forget.

### What This Looks Like

```
Input:  "Met with Sarah about the data migration"
Output: "Met with [[Sarah Mitchell]] about the [[Acme Data Migration]]"
```

No manual linking. No broken references. Use compounds into structure, structure compounds into intelligence.

That's the flywheel.

---

## See How It Thinks

Ask Flywheel to suggest wikilinks with detail mode and it shows its work:

```
❯ Suggest wikilinks for: "Turbopump delivery delayed. Marcus tracking with Acme."

Entity              Score  Match  Co-oc  Type  Recency  Cross  Hub  Feedback
─────────────────────────────────────────────────────────────────────────────
Marcus Johnson        32    +10     +6    +5     +8      +3    +0     +0
Acme Corp             25    +10     +6    +2     +5      +0    +1     +1
Turbopump Assembly    21    +10     +3    +3     +3      +0    +3     -1

→ [[Marcus Johnson]], [[Acme Corp]], [[Turbopump Assembly]]
```

Every column is a scoring layer. Every number traces to a vault property. No magic -- just math you can verify.

See [docs/ALGORITHM.md](docs/ALGORITHM.md) for the full 10-layer pipeline.

---

## Prove It: The Numbers

### Test Coverage

| Metric | Count |
|---|---|
| Tests | 1,812 |
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

7 production-ready vaults representing real knowledge work:

| Demo | You are | Ask this | Notes |
|------|---------|----------|-------|
| [carter-strategy](demos/carter-strategy/) | Solo consultant | "How much have I billed Acme Corp?" | 32 |
| [artemis-rocket](demos/artemis-rocket/) | Rocket engineer | "What's blocking the propulsion milestone?" | 63 |
| [startup-ops](demos/startup-ops/) | SaaS co-founder | "What's our MRR?" | 31 |
| [nexus-lab](demos/nexus-lab/) | PhD researcher | "How does AlphaFold connect to my experiment?" | 32 |
| [solo-operator](demos/solo-operator/) | Content creator | "How's revenue this month?" | 16 |
| [support-desk](demos/support-desk/) | Support agent | "What's Sarah Chen's situation?" | 12 |
| [zettelkasten](demos/zettelkasten/) | Zettelkasten student | "How does spaced repetition connect to active recall?" | 47 |

Every demo is a real test fixture. If it works in the README, it passes in CI.

```bash
git clone https://github.com/velvetmonkey/flywheel-memory.git
cd flywheel-memory/demos/carter-strategy && claude
```

---

## Set Up Your Own Vault

After trying the demos, point Flywheel at your own vault:

**1.** Add `.mcp.json` to your vault root:

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-memory"],
      "env": {
        "FLYWHEEL_TOOLS": "minimal"
      }
    }
  }
}
```

Start with the `minimal` preset (13 tools, ~3,800 tokens). Add bundles like `graph` or `tasks` as needed -- see [Tools Overview](#tools-overview) below.

**2.** Optionally, add a `CLAUDE.md` persona file to your vault root. This tells Claude how to navigate your vault -- what folders matter, what frontmatter fields exist, what questions to expect. See the [demo vaults](demos/) for examples (e.g., [carter-strategy/CLAUDE.md](demos/carter-strategy/CLAUDE.md)).

**3.** Open your vault in Claude Code:

```bash
cd /path/to/your/vault && claude
```

On first run, Flywheel creates a `.flywheel/` directory containing its SQLite index. Add `.flywheel/` to your `.gitignore`. Indexing is automatic and typically takes under a second for vaults up to a few thousand notes. The index is derived and deletable -- see [Troubleshooting](#troubleshooting) if anything goes wrong.

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for all environment variables and advanced options.

---

## Tools Overview

15 categories. 39 tools. Load all of them, or just the ones you need.

| Preset | Tools | ~Tokens | What you get |
|--------|-------|---------|--------------|
| `full` (default) | 39 | ~11,800 | Everything |
| `minimal` | 13 | ~3,800 | Search, read, create, edit |

Start with `minimal`, then add composable bundles:

| Bundle | Tools | ~Tokens | What it adds |
|--------|-------|---------|--------------|
| `graph` | 6 | ~1,850 | Backlinks, orphans, hubs, shortest paths |
| `analysis` | 8 | ~2,500 | Schema intelligence, wikilink validation |
| `tasks` | 3 | ~925 | Task queries and mutations |
| `health` | 7 | ~2,150 | Vault diagnostics, index management |
| `ops` | 2 | ~625 | Git undo, policy automation |

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

## How It Compares

| Feature | Flywheel Memory | Obsidian CLI (MCP) | Smart Connections | Khoj |
|---------|----------------|-------------------|-------------------|------|
| Protocol | MCP (native) | MCP | Obsidian plugin | Web API |
| Backlink graph | Yes (bidirectional) | No | No | No |
| FTS5 search | Yes (<10ms) | Basic | Semantic only | Yes |
| Entity extraction | Auto (8 categories) | No | No | No |
| Auto-wikilinks | Yes (with alias resolution) | No | No | No |
| Schema intelligence | Yes (6 analysis modes) | No | No | No |
| Git integration | Yes (auto-commit, undo) | No | No | No |
| Test coverage | 1,812 tests | Unknown | Unknown | Unknown |
| Runs locally | Yes (zero cloud) | Yes | Yes | Optional |
| Tool count | 39 tools | ~10 | 0 (plugin) | ~5 |

---

## Who This Is For

Flywheel is for anyone who uses an Obsidian vault as their working memory
and wants Claude to understand it -- not just read it.

- **Consultants** tracking clients, projects, invoices, and meetings -- see [carter-strategy](demos/carter-strategy/)
- **Engineers** maintaining project docs, decision logs, and architecture notes -- see [artemis-rocket](demos/artemis-rocket/)
- **Founders** running ops, tracking MRR, and managing investors -- see [startup-ops](demos/startup-ops/)
- **Researchers** navigating literature, experiment logs, and citation networks -- see [nexus-lab](demos/nexus-lab/)
- **Creators** managing editorial calendars, drafts, and revenue -- see [solo-operator](demos/solo-operator/)
- **Students** building Zettelkasten-style knowledge graphs across sources -- see [zettelkasten](demos/zettelkasten/)

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

## Troubleshooting

**Safety model:** Your markdown files are the source of truth. The `.flywheel/` directory (SQLite index, FTS5 data) is entirely derived and can be deleted at any time -- Flywheel rebuilds it on next startup.

**Undo a mutation:** Every write tool records a git-backed snapshot. Use `vault_undo_last_mutation` to revert the last change (soft git reset). If you need to go further back, use standard `git log` / `git checkout` on your vault.

**Rebuild the index:** If searches return stale results or the server behaves unexpectedly, delete the `.flywheel/` directory and restart. The index rebuilds automatically.

**Failed mutations:** If a write operation fails validation (path traversal, missing file, protected zone), Flywheel rejects it before touching disk. You will see an error message explaining why the operation was blocked. No partial writes occur.

---

## Documentation

| Doc | Description |
|---|---|
| [SETUP.md](docs/SETUP.md) | Set up your own vault -- prerequisites, config, first commands |
| [TOOLS.md](docs/TOOLS.md) | Full tool reference -- all 39 tools, parameters, examples |
| [COOKBOOK.md](docs/COOKBOOK.md) | Example prompts organized by use case |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Index strategy, FTS5, graph, auto-wikilinks |
| [CONFIGURATION.md](docs/CONFIGURATION.md) | Env vars, presets, custom tool sets |
| [TESTING.md](docs/TESTING.md) | Test methodology, coverage, performance benchmarks |
| [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Error recovery, diagnostics, common issues |
| [VISION.md](docs/VISION.md) | The flywheel effect and where this goes |
| [ALGORITHM.md](docs/ALGORITHM.md) | The 10-layer scoring system explained |
| [PROVE-IT.md](docs/PROVE-IT.md) | Clone it, run it, see it in 5 minutes |

---

## License

Apache-2.0 -- [GitHub](https://github.com/velvetmonkey/flywheel-memory) | [Issues](https://github.com/velvetmonkey/flywheel-memory/issues)
