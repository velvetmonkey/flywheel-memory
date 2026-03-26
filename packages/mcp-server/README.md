<div align="center">
  <img src="https://raw.githubusercontent.com/velvetmonkey/flywheel-memory/main/header.png" alt="Flywheel" width="256"/>
  <h1>Flywheel</h1>
  <p><strong>A knowledge graph engine that reads, writes, and learns.</strong><br/>Graph intelligence. Safe writes. A feedback loop that learns from every interaction.<br/>Zero cloud. Your Obsidian vault becomes a queryable second brain.</p>
</div>

[![npm version](https://img.shields.io/npm/v/@velvetmonkey/flywheel-memory.svg)](https://www.npmjs.com/package/@velvetmonkey/flywheel-memory)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blueviolet.svg)](https://modelcontextprotocol.io/)
[![CI](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue.svg)](https://github.com/velvetmonkey/flywheel-memory)
[![Scale](https://img.shields.io/badge/scale-100k--line%20files%20%7C%202.5k%20entities-brightgreen.svg)](https://github.com/velvetmonkey/flywheel-memory/blob/main/docs/TESTING.md#performance-benchmarks)
[![Tests](https://img.shields.io/badge/tests-2,482%20passed-brightgreen.svg)](https://github.com/velvetmonkey/flywheel-memory/blob/main/docs/TESTING.md)

| | Grep approach | Flywheel |
|---|---|---|
| "What's overdue?" | Grep + read matches (~500-2,000 tokens) | Indexed metadata query (~50-200 tokens) |
| "What links here?" | Grep for note name (flat list, no graph) | Pre-indexed backlink graph (<10ms) |
| "Add a meeting note" | Raw write, no linking | Structured write + auto-wikilink |
| "What should I link?" | Not possible | 10-dimension scoring + semantic search |
| Hubs, orphans, paths? | Not possible | Pre-indexed graph analysis |

76 tools across 12 categories. 6-line config. Zero cloud dependencies.

**Try in 60 seconds:**

```bash
git clone https://github.com/velvetmonkey/flywheel-memory.git
cd flywheel-memory/demos/carter-strategy && claude
```

Then ask: *"How much have I billed Acme Corp?"*

---

## See It Work

### Read: "How much have I billed Acme Corp?"

From the [carter-strategy](https://github.com/velvetmonkey/flywheel-memory/tree/main/demos/carter-strategy/) demo -- a solo consultant with 3 clients, 5 projects, and $27K in invoices.

```
❯ How much have I billed Acme Corp?

● flywheel › search
  query: "Acme Corp"
  → clients/Acme Corp.md, invoices/INV-2025-047.md,
    invoices/INV-2025-048.md, projects/Acme Data Migration.md

● read_file("clients/Acme Corp.md")
  ← total_billed: 156000, rate: $300/hr, status: active

● read_file("invoices/INV-2025-047.md")
  ← amount: 15000, status: paid, period: November 2025

● read_file("invoices/INV-2025-048.md")
  ← amount: 12000, status: pending, period: December 2025

┌─ RESULT ──────────────────────────────────────────────┐
│ Acme Corp: $156K total billed                         │
│                                                       │
│   Paid:    $15,000 — Acme Data Migration (Nov 2025)   │
│   Pending: $12,000 — Acme Data Migration (Dec 2025)   │
│                                                       │
│ Also: $35K pending proposal (Analytics Add-on)        │
└───────────────────────────────────────────────────────┘
```

[[Flywheel]]'s indexed search found all Acme-related notes in one call. The AI read the files it needed for billing details. No grepping, no guessing paths.

Flywheel's search found all related notes in one call. Without it, the AI would grep for "Acme" and scan every matching file.

The bigger difference isn't just tokens — it's that Flywheel answers structural questions (backlinks, hubs, shortest paths, schema analysis) that file-level access can't answer at all.

### Write: Auto-wikilinks on every mutation

```
❯ Log that Stacy Thompson reviewed the API Security Checklist for Acme before the Beta Corp Dashboard kickoff

● flywheel › vault_add_to_section
  path: "daily-notes/2026-01-04.md"
  section: "Log"
  content: "[[Stacy Thompson]] reviewed the [[API Security Checklist]] for [[Acme Corp|Acme]] before the [[Beta Corp Dashboard]] kickoff → [[GlobalBank API Audit]], [[Acme Analytics Add-on]], [[Acme Data Migration]]"
            ↑ 4 entities auto-linked — "Acme" resolved to Acme Corp via alias
            → 3 contextual suggestions appended (scored ≥12 via co-occurrence with linked entities)
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
Entity              Score  Match  Co-oc  Type  Context  Recency  Cross  Hub  Feedback  Semantic  Edge
──────────────────────────────────────────────────────────────────────────────────────────────────────
Marcus Johnson        34    +10     +3    +5     +5       +5      +3    +1     +2         0       0
```

10 scoring dimensions, every number traceable to vault usage. Recency came from what you last wrote. Co-occurrence came from notes you've written before. Hub came from how many other notes link there. The score learns as you use it.

See [docs/ALGORITHM.md](https://github.com/velvetmonkey/flywheel-memory/blob/main/docs/ALGORITHM.md) for how scoring works.

### 3. The Self-Improving Loop

**Every interaction is a graph-building operation — and a learning signal.**

When you write a note, entities are auto-linked — creating edges. When you keep a `[[link]]` through 10 edits, that edge gains weight. When two entities appear together in 20 notes, they build a co-occurrence bond (NPMI — a measure of how strongly two things associate beyond chance). When you read frequently, recent entities surface in suggestions. When you remove a bad link, the system learns what to stop suggesting (it tracks accept/reject ratios per entity and gradually suppresses low-quality matches).

This is the uncontested gap — no competitor has a feedback loop that learns from knowledge management actions.

We prove it: auto-linked entities achieve 100% entity precision (never suggests a non-existent entity), 51% strict precision, and the system finds 72–82% of links it should (recall) — stable over 50 generations of noisy feedback. See [Graph Quality](#graph-quality) below.

Result: a queryable graph. "What's the shortest path between AlphaFold and my docking experiment?" Backlinks, forward links, hubs, orphans, shortest paths — every query leverages hundreds of accumulated connections. Denser graphs make every query more precise.

### 4. Semantic Understanding

Content about "deployment automation" suggests `[[CI/CD]]` — no keyword match needed. Entity-level embeddings mean your knowledge graph understands meaning, not just words.

- **Semantic bridges**: Discovers high-value missing links between conceptually related but unlinked notes
- **Semantic clusters**: Groups notes by meaning instead of folder structure
- **Semantic wikilinks**: Suggestions based on what you *mean*, not just what you typed

Build once with `init_semantic`. Everything upgrades automatically. Configurable model via `EMBEDDING_MODEL` env var.

### 5. Agentic Memory

The system remembers context across sessions. No more starting from scratch.

- **`brief`** assembles startup context: recent sessions, active entities, stored memories, corrections, vault pulse — token-budgeted
- **`recall`** retrieves across all knowledge channels: entities, notes, memories, and semantic search — ranked by the same scoring signals as the wikilink engine
- **`memory`** stores observations with confidence decay, TTL, and lifecycle management

Your AI picks up where it left off.

### How It Compares to Other Approaches

| | Pure Vector Search | Pure Keyword Search | Flywheel |
|---|---|---|---|
| "Why was this suggested?" | "Embeddings are close" | "Term frequency" | "10 + 3 + 5 + 5 + 3 + 1 = 34" |
| Semantic wikilinks | No | No | Yes (semantic) |
| Finds synonyms/concepts? | Yes | No | Yes (semantic search) |
| Exact phrase matching? | Weak | Yes | Yes |
| Same input → same output? | Not guaranteed | Always | Always |
| Runs offline? | Often not | Yes | Yes (local embeddings) |
| Learns from usage? | Retraining | No | Implicit feedback loop |
| Agent memory | No | No | Yes (brief + recall + memory) |

---

## The Flywheel Effect

The name is literal. A flywheel is hard to start but once spinning, each push adds to the momentum.

### Day 1: Instant Value

You point Flywheel at your vault. It indexes every note, extracts entities, builds a backlink graph. First query returns in <10ms. First write auto-links three entities you would have missed. No training period. No configuration.

### Week 1: Connections Appear

You have 30 disconnected notes. Auto-wikilinks create 47 connections on your first day of writing through Flywheel. You stop reading files and start querying a graph.

### Month 1: Intelligence Emerges

Hub notes surface. "[[Sarah Mitchell]]" has 23 backlinks -- she's clearly important. When you write about a project, her name appears in suggestions because co-occurrence tracking knows she's relevant. You didn't configure this. The vault structure revealed it.

### Month 3: The Graph Is Self-Sustaining

Every query leverages hundreds of accumulated connections. New content auto-links to the right places. You stop thinking about organization.

### What This Looks Like

```mermaid
graph LR
    W[Write] --> A[Auto-link]
    A --> D[Denser Graph]
    D --> B[Better Queries]
    B --> M[More Use]
    M --> W
```

```
Input:  "Stacy Thompson finished reviewing the API Security Checklist for the Beta Corp Dashboard"
Output: "[[Stacy Thompson]] finished reviewing the [[API Security Checklist]] for the [[Beta Corp Dashboard]]"
```

No manual linking. No broken references. Use compounds into structure, structure compounds into intelligence.

---

## Battle-Tested

**2,482 tests. 122 test files. 47,000+ lines of test code.**

### Performance

| Operation | Threshold | Typical |
|---|---|---|
| 1k-line mutation | <100ms | ~15ms |
| 10k-line mutation | <500ms | -- |
| 100k-line mutation | <2s | -- |

- **100 parallel writes, zero corruption** -- concurrent mutations verified under stress
- **Property-based fuzzing** -- fast-check with 700+ randomized scenarios
- **SQL injection prevention** -- parameterized queries throughout
- **Path traversal blocking** -- all file paths validated against vault root
- **Deterministic output** -- every tool produces the same result given the same input

Every demo vault is a real test fixture. If it works in the README, it passes in CI.

```bash
git clone https://github.com/velvetmonkey/flywheel-memory.git
cd flywheel-memory && npm install && npm test
```

See [docs/PROVE-IT.md](https://github.com/velvetmonkey/flywheel-memory/blob/main/docs/PROVE-IT.md) and [docs/TESTING.md](https://github.com/velvetmonkey/flywheel-memory/blob/main/docs/TESTING.md).

### Graph Quality

The feedback loop claim isn't asserted — it's measured. We build a test vault with known-correct links, strip them out, and measure how well the engine rediscovers them. CI locks these baselines and fails if quality regresses.

| Mode | Strict Precision | Entity Precision | Recall | F1 |
|---|---|---|---|---|
| Conservative | 51.2% | 100% | 71.7% | 59.7% |
| Balanced | 27.5% | 100% | 76.7% | 40.5% |
| Aggressive | 26.1% | 100% | 76.7% | 39.0% |

**Precision** = "of the links suggested, how many were correct?" (strict: counts all wrong suggestions; entity precision: excludes known-entity suggestions). **Recall** = "of the links that should exist, how many were found?" **F1** = the balance of both — higher is better.

Measured against a 96-note/61-entity ground truth vault.

- **50-generation stress test** — suggest → accept/reject (85% correct, 15% noise) → mutate vault → rebuild index → repeat. F1 holds steady — the feedback loop doesn't degrade under realistic noise.
- **7 vault archetypes** — hub-and-spoke, hierarchical, dense-mesh, sparse-orphan, bridge-network, small-world, chaos
- **13 pipeline stages** (10 scoring dimensions + filters + suppression) individually ablated, contribution measured
- **Regression gate** — CI fails if any mode's F1/precision/recall drops >5pp from baseline

See [docs/TESTING.md](https://github.com/velvetmonkey/flywheel-memory/blob/main/docs/TESTING.md) for full methodology. Auto-generated report: [docs/QUALITY_REPORT.md](https://github.com/velvetmonkey/flywheel-memory/blob/main/docs/QUALITY_REPORT.md).

### Safe Writes

Every mutation is:

- **Git-committed** — one `vault_undo_last_mutation` away from reverting any change
- **Conflict-detected** — content hash check prevents clobbering concurrent edits (SHA-256)
- **Policy-governed** — configurable guardrails with warn/strict/off modes
- **Precise** — auto-wikilinks have 1.0 precision in production (never inserts a wrong link)

---

## How It Compares

| Feature | Flywheel Memory | Obsidian CLI (MCP) | Smart Connections | Khoj |
|---------|----------------|-------------------|-------------------|------|
| Backlink graph | Bidirectional | No | No | No |
| Hybrid search | Local (keyword + semantic) | No | Cloud only | Cloud |
| Auto-wikilinks | Yes (alias resolution) | No | No | No |
| Schema intelligence | 6 analysis modes | No | No | No |
| Entity extraction | Auto (18 categories) | No | No | No |
| Learns from usage | Feedback loop + suppression | No | No | No |
| Agent memory | brief + recall + memory | No | No | No |
| Safe writes | Git + conflict detection | No | N/A | N/A |
| Test coverage | 2,456 tests | Unknown | Unknown | Unknown |
| Tool count | 72 | ~10 | 0 (plugin) | ~5 |

---

## Try It

### Step 1: Try a demo

```bash
git clone https://github.com/velvetmonkey/flywheel-memory.git
cd flywheel-memory/demos/carter-strategy && claude
```

| Demo | You are | Ask this |
|------|---------|----------|
| [carter-strategy](https://github.com/velvetmonkey/flywheel-memory/tree/main/demos/carter-strategy/) | Solo consultant | "How much have I billed Acme Corp?" |
| [artemis-rocket](https://github.com/velvetmonkey/flywheel-memory/tree/main/demos/artemis-rocket/) | Rocket engineer | "What's blocking propulsion?" |
| [startup-ops](https://github.com/velvetmonkey/flywheel-memory/tree/main/demos/startup-ops/) | SaaS co-founder | "What's our MRR?" |
| [nexus-lab](https://github.com/velvetmonkey/flywheel-memory/tree/main/demos/nexus-lab/) | PhD researcher | "How does AlphaFold connect to my experiment?" |
| [solo-operator](https://github.com/velvetmonkey/flywheel-memory/tree/main/demos/solo-operator/) | Content creator | "How's revenue this month?" |
| [support-desk](https://github.com/velvetmonkey/flywheel-memory/tree/main/demos/support-desk/) | Support agent | "What's Sarah Chen's situation?" |
| [zettelkasten](https://github.com/velvetmonkey/flywheel-memory/tree/main/demos/zettelkasten/) | Zettelkasten student | "How does spaced repetition connect to active recall?" |

### Step 2: Your own vault

Add `.mcp.json` to your vault root:

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-memory"],
      "env": {
        "FLYWHEEL_PRESET": "default"
      }
    }
  }
}
```

```bash
cd /path/to/your/vault && claude
```

Defaults to the `default` preset (16 tools). Add bundles as needed. See [docs/CONFIGURATION.md](https://github.com/velvetmonkey/flywheel-memory/blob/main/docs/CONFIGURATION.md) for all options.

> **Works with any MCP client.** Primarily tested with Claude. See [Transport Options](#transport-options) for HTTP setup (Cursor, Windsurf, Aider, LangGraph, Ollama, etc.).

### Transport Options

By default, Flywheel uses stdio transport (works with [[Claude Code]] and Claude Desktop). Set `FLYWHEEL_TRANSPORT` to enable HTTP transport for other clients (Cursor, Windsurf, Aider, LangGraph, Ollama):

| Env Var | Values | Default |
|---------|--------|---------|
| `FLYWHEEL_TRANSPORT` | `stdio`, `http`, `both` | `stdio` |
| `FLYWHEEL_HTTP_PORT` | Port number | `3111` |
| `FLYWHEEL_HTTP_HOST` | Bind address | `127.0.0.1` |

```bash
# HTTP only
FLYWHEEL_TRANSPORT=http npx @velvetmonkey/flywheel-memory

# Both stdio and HTTP simultaneously
FLYWHEEL_TRANSPORT=both npx @velvetmonkey/flywheel-memory

# Health check
curl http://localhost:3111/health

# MCP request (JSON-RPC over HTTP)
curl -X POST http://localhost:3111/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

DNS rebinding protection is automatically enabled when bound to localhost.

### Multi-Vault

Serve multiple Obsidian vaults from a single server:

```bash
FLYWHEEL_VAULTS="personal:/path/to/personal,work:/path/to/work" \
  FLYWHEEL_TRANSPORT=http npx @velvetmonkey/flywheel-memory
```

When multi-vault is active, every tool gains an optional `vault` parameter. The `search` tool automatically searches all vaults when `vault` is omitted, merging results across vaults. Other tools default to the primary vault (first in list).

---

## Tools Overview

| Preset | Tools | What you get |
|--------|-------|--------------|
| `default` | 19 | Note-taking essentials — search, read, write, tasks |
| `agent` | 19 | Autonomous AI agents — search, read, write, memory |
| `full` | 69 | Everything — all 12 categories |

Composable bundles add capabilities to any preset. See [docs/CONFIGURATION.md](https://github.com/velvetmonkey/flywheel-memory/blob/main/docs/CONFIGURATION.md) for all bundles and fine-grained categories.

The fewer tools you load, the less context the AI needs to pick the right one. See [docs/TOOLS.md](https://github.com/velvetmonkey/flywheel-memory/blob/main/docs/TOOLS.md) for the full reference.

---

## Documentation

| Doc | Why read this |
|---|---|
| [PROVE-IT.md](https://github.com/velvetmonkey/flywheel-memory/blob/main/docs/PROVE-IT.md) | See it working in 5 minutes |
| [TOOLS.md](https://github.com/velvetmonkey/flywheel-memory/blob/main/docs/TOOLS.md) | All 76 tools documented |
| [ALGORITHM.md](https://github.com/velvetmonkey/flywheel-memory/blob/main/docs/ALGORITHM.md) | How the scoring works |
| [COOKBOOK.md](https://github.com/velvetmonkey/flywheel-memory/blob/main/docs/COOKBOOK.md) | Example prompts by use case |
| [SETUP.md](https://github.com/velvetmonkey/flywheel-memory/blob/main/docs/SETUP.md) | Full setup guide for your vault |
| [CONFIGURATION.md](https://github.com/velvetmonkey/flywheel-memory/blob/main/docs/CONFIGURATION.md) | Env vars, presets, custom tool sets |
| [ARCHITECTURE.md](https://github.com/velvetmonkey/flywheel-memory/blob/main/docs/ARCHITECTURE.md) | Index strategy, graph, auto-wikilinks |
| [TESTING.md](https://github.com/velvetmonkey/flywheel-memory/blob/main/docs/TESTING.md) | Test methodology and benchmarks |
| [TROUBLESHOOTING.md](https://github.com/velvetmonkey/flywheel-memory/blob/main/docs/TROUBLESHOOTING.md) | Error recovery and diagnostics |
| [VISION.md](https://github.com/velvetmonkey/flywheel-memory/blob/main/docs/VISION.md) | Where this is going |

---

## License

AGPL-3.0 — see [LICENSE](https://github.com/velvetmonkey/flywheel-memory/blob/main/LICENSE) for details.
