<div align="center">
  <img src="header.png" alt="Flywheel" width="256"/>
  <h1>Flywheel</h1>
  <p><strong>Claude reads files. Flywheel reads your knowledge graph.</strong><br/>42 tools. Zero cloud. Your Obsidian vault becomes a queryable second brain.</p>
</div>

[![npm version](https://img.shields.io/npm/v/@velvetmonkey/flywheel-memory.svg)](https://www.npmjs.com/package/@velvetmonkey/flywheel-memory)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blueviolet.svg)](https://modelcontextprotocol.io/)
[![CI](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue.svg)](https://github.com/velvetmonkey/flywheel-memory)
[![Scale](https://img.shields.io/badge/scale-100k%20notes-brightgreen.svg)](https://github.com/velvetmonkey/flywheel-memory)
[![Tests](https://img.shields.io/badge/tests-1,824%20passed-brightgreen.svg)](docs/TESTING.md)

| | Without Flywheel | With Flywheel |
|---|---|---|
| "What's overdue?" | Read every file | Indexed query, <10ms |
| "What links here?" | grep every file | Pre-indexed backlink graph |
| "Add a meeting note" | Raw write, no linking | Write + auto-wikilink |
| "What should I link?" | Manual or grep | Smart scoring + semantic understanding |
| Token cost | 2,000-250,000 | 50-200 |

42 tools. 6-line config. Zero cloud dependencies.

---

## See It Work

![Flywheel demo — billing, auto-wikilinks, tasks, and search](demos/flywheel-demo.gif)

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

Claude didn't read any files. It navigated the graph: backlinks to find related notes, metadata to extract the numbers.

```
Same 3 queries without Flywheel: 11,150 tokens (reading files repeatedly)
Same 3 queries with Flywheel:       300 tokens (querying the index)
                                     37x savings
```

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

## What Makes Flywheel Different

### 1. Hybrid Search

Search "authentication" -- exact matches. Search "login security" -- same notes, plus every note about auth that never uses the word.

Keyword search finds what you said. Semantic search finds what you meant. Flywheel runs both and fuses the results. Runs locally on a 23 MB model. Nothing leaves your machine.

### 2. Every Suggestion Has a Receipt

Ask why Flywheel suggested `[[Marcus Johnson]]`:

```
Entity              Score  Match  Co-oc  Type  Recency  Cross  Hub
─────────────────────────────────────────────────────────────────────
Marcus Johnson        32    +10     +6    +5     +8      +3    +0
```

Every number traces to a vault property. No magic -- just math you can verify.

See [docs/ALGORITHM.md](docs/ALGORITHM.md) for how scoring works.

### 3. Your Vault's Hidden Structure

"What's the shortest path between AlphaFold and my docking experiment?"

Backlinks, forward links, hubs, orphans, shortest paths -- your vault is a queryable graph. Every note you write through Flywheel gets auto-linked. Denser graphs make every query more precise. That's the flywheel.

### 4. Semantic Understanding

Content about "deployment automation" suggests `[[CI/CD]]` — no keyword match needed. Entity-level embeddings mean your knowledge graph understands meaning, not just words.

- **Semantic bridges**: Discovers high-value missing links between conceptually related but unlinked notes
- **Semantic clusters**: Groups notes by meaning instead of folder structure
- **Semantic wikilinks**: Suggestions based on what you *mean*, not just what you typed

Build once with `init_semantic`. Everything upgrades automatically.

### How It Compares to Other Approaches

| | Pure Vector Search | Pure Keyword Search | Flywheel |
|---|---|---|---|
| "Why was this suggested?" | "Embeddings are close" | "Term frequency" | "10 + 6 + 5 + 8 + 3 = 32" |
| Semantic wikilinks | No | No | Yes (semantic) |
| Finds synonyms/concepts? | Yes | No | Yes (semantic search) |
| Exact phrase matching? | Weak | Yes | Yes |
| Same input → same output? | Not guaranteed | Always | Always |
| Runs offline? | Often not | Yes | Yes (local embeddings) |
| Learns your preferences? | Retraining | No | Implicit feedback loop |

---

## The Flywheel Effect

The name is literal. A flywheel is hard to start but once spinning, each push adds to the momentum.

### Week 1: Connections Appear

You have 30 disconnected notes. Auto-wikilinks create 47 connections on your first day of writing through Flywheel. You stop reading files and start querying a graph.

### Month 1: Intelligence Emerges

Hub notes surface. "Sarah Mitchell" has 23 backlinks -- she's clearly important. When you write about a project, her name appears in suggestions because co-occurrence tracking knows she's relevant. You didn't configure this. The vault structure revealed it.

### Month 3: The Graph Is Self-Sustaining

Every query leverages hundreds of accumulated connections. New content auto-links to the right places. You stop thinking about organization.

### What This Looks Like

```
Input:  "Met with Sarah about the data migration"
Output: "Met with [[Sarah Mitchell]] about the [[Acme Data Migration]]"
```

No manual linking. No broken references. Use compounds into structure, structure compounds into intelligence.

---

## Battle-Tested

**1,824 tests. 78 test files. 33,000+ lines of test code.**

### Performance

| Operation | Threshold | Typical |
|---|---|---|
| 1k-line mutation | <100ms | ~15ms |
| 10k-line mutation | <500ms | -- |
| 100k-line mutation | <2s | -- |

- **100 parallel writes, zero corruption** -- concurrent mutations verified under stress
- **Property-based fuzzing** -- fast-check with 50+ randomized scenarios
- **SQL injection prevention** -- parameterized queries throughout
- **Path traversal blocking** -- all file paths validated against vault root
- **Deterministic output** -- every tool produces the same result given the same input

Every demo vault is a real test fixture. If it works in the README, it passes in CI.

```bash
git clone https://github.com/velvetmonkey/flywheel-memory.git
cd flywheel-memory && npm install && npm test
```

See [docs/PROVE-IT.md](docs/PROVE-IT.md) and [docs/TESTING.md](docs/TESTING.md).

---

## How It Compares

| Feature | Flywheel Memory | Obsidian CLI (MCP) | Smart Connections | Khoj |
|---------|----------------|-------------------|-------------------|------|
| Backlink graph | Bidirectional | No | No | No |
| Hybrid search | Local (keyword + semantic) | No | Cloud only | Cloud |
| Auto-wikilinks | Yes (alias resolution) | No | No | No |
| Schema intelligence | 6 analysis modes | No | No | No |
| Entity extraction | Auto (8 categories) | No | No | No |
| Test coverage | 1,824 tests | Unknown | Unknown | Unknown |
| Tool count | 42 | ~10 | 0 (plugin) | ~5 |

---

## Try It

### Step 1: Try a demo

```bash
git clone https://github.com/velvetmonkey/flywheel-memory.git
cd flywheel-memory/demos/carter-strategy && claude
```

| Demo | You are | Ask this |
|------|---------|----------|
| [carter-strategy](demos/carter-strategy/) | Solo consultant | "How much have I billed Acme Corp?" |
| [artemis-rocket](demos/artemis-rocket/) | Rocket engineer | "What's blocking propulsion?" |
| [startup-ops](demos/startup-ops/) | SaaS co-founder | "What's our MRR?" |
| [nexus-lab](demos/nexus-lab/) | PhD researcher | "How does AlphaFold connect to my experiment?" |
| [solo-operator](demos/solo-operator/) | Content creator | "How's revenue this month?" |
| [support-desk](demos/support-desk/) | Support agent | "What's Sarah Chen's situation?" |
| [zettelkasten](demos/zettelkasten/) | Zettelkasten student | "How does spaced repetition connect to active recall?" |

### Step 2: Your own vault

Add `.mcp.json` to your vault root:

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

```bash
cd /path/to/your/vault && claude
```

Start with the `minimal` preset (13 tools, ~3,800 tokens). Add bundles as needed. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for all options.

---

## Tools Overview

| Preset | Tools | ~Tokens | What you get |
|--------|-------|---------|--------------|
| `full` (default) | 42 | ~12,400 | Everything |
| `minimal` | 13 | ~3,800 | Search, read, create, edit |

Composable bundles (add to minimal or each other):

| Bundle | Tools | ~Tokens | What it adds |
|--------|-------|---------|--------------|
| `graph` | 6 | ~1,850 | Backlinks, orphans, hubs, shortest paths |
| `analysis` | 8 | ~2,500 | Schema intelligence, wikilink validation |
| `tasks` | 3 | ~925 | Task queries and mutations |
| `health` | 7 | ~2,150 | Vault diagnostics, index management |
| `ops` | 2 | ~625 | Git undo, policy automation |

The fewer tools you load, the less context Claude needs to pick the right one. See [docs/TOOLS.md](docs/TOOLS.md) for the full reference.

---

## Documentation

| Doc | Why read this |
|---|---|
| [PROVE-IT.md](docs/PROVE-IT.md) | See it working in 5 minutes |
| [TOOLS.md](docs/TOOLS.md) | All 42 tools documented |
| [ALGORITHM.md](docs/ALGORITHM.md) | How the scoring works |
| [COOKBOOK.md](docs/COOKBOOK.md) | Example prompts by use case |
| [SETUP.md](docs/SETUP.md) | Full setup guide for your vault |
| [CONFIGURATION.md](docs/CONFIGURATION.md) | Env vars, presets, custom tool sets |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Index strategy, graph, auto-wikilinks |
| [TESTING.md](docs/TESTING.md) | Test methodology and benchmarks |
| [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Error recovery and diagnostics |
| [VISION.md](docs/VISION.md) | Where this is going |

---

## License

AGPL-3.0 -- [GitHub](https://github.com/velvetmonkey/flywheel-memory) | [Issues](https://github.com/velvetmonkey/flywheel-memory/issues)
