<div align="center">
  <img src="header.png" alt="Flywheel" width="256"/>
  <h1>Flywheel</h1>
  <p><strong>A knowledge graph engine that reads, writes, and learns.</strong><br/>Graph intelligence. Safe writes. A feedback loop that learns from every interaction.<br/>Zero cloud. Your Obsidian vault becomes a queryable second brain.</p>
</div>

[![npm version](https://img.shields.io/npm/v/@velvetmonkey/flywheel-memory.svg)](https://www.npmjs.com/package/@velvetmonkey/flywheel-memory)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blueviolet.svg)](https://modelcontextprotocol.io/)
[![CI](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue.svg)](https://github.com/velvetmonkey/flywheel-memory)
[![Scale](https://img.shields.io/badge/scale-100k--line%20files%20%7C%202.5k%20entities-brightgreen.svg)](docs/TESTING.md#performance-benchmarks)
[![Tests](https://img.shields.io/badge/tests-2,456%20passed-brightgreen.svg)](docs/TESTING.md)

| | Without Flywheel | With Flywheel |
|---|---|---|
| "What's overdue?" | Read every file | Indexed query, <10ms |
| "What links here?" | Grep for name, flat list | Backlink graph, pre-indexed |
| "Add a meeting note" | Raw write, no linking | Auto-wikilinks on every mutation |
| "What should I link?" | Not possible | 10-dimension scoring + semantic search |
| Token cost | ~800-2,000 per query | ~50-200 per query |

51 tools. 6-line config. Zero cloud.

**Try in 60 seconds:**

```bash
git clone https://github.com/velvetmonkey/flywheel-memory.git
cd flywheel-memory/demos/carter-strategy && claude
```

Then ask: *"How much have I billed Acme Corp?"*

---

## See It Work

### Read: "How much have I billed Acme Corp?"

From the [carter-strategy](demos/carter-strategy/) demo -- a solo consultant with 3 clients, 5 projects, and $27K in invoices.

```
❯ How much have I billed Acme Corp?

● flywheel › search
  query: "Acme Corp"
  → clients/Acme Corp.md
      frontmatter: { total_billed: 156000, rate: "$300/hr", status: "active" }
      category: "organization", backlink_count: 4
    invoices/INV-2025-047.md
      frontmatter: { amount: 15000, status: "paid", period: "November 2025" }
    invoices/INV-2025-048.md
      frontmatter: { amount: 12000, status: "pending", period: "December 2025" }
    projects/Acme Data Migration.md
      frontmatter: { client: "Acme Corp", status: "active" }

┌─ RESULT ──────────────────────────────────────────────┐
│ Acme Corp: $156K total billed                         │
│                                                       │
│   Paid:    $15,000 — Acme Data Migration (Nov 2025)   │
│   Pending: $12,000 — Acme Data Migration (Dec 2025)   │
│                                                       │
│ Also: $35K pending proposal (Analytics Add-on)        │
└───────────────────────────────────────────────────────┘
```

One search call returned everything -- frontmatter with amounts and status, entity category, backlink counts. No file reads needed. Without Flywheel, Claude would grep for "Acme" and scan every matching file.

### Write: Auto-wikilinks on every mutation

```
❯ Log that I finished the Acme strategy deck

● flywheel › vault_add_to_section
  path: "daily-notes/2026-01-04.md"
  section: "Log"
  content: "finished the [[Acme Corp|Acme]] strategy deck"
            ↑ "Acme" auto-linked to [[Acme Corp]] (alias match, no brackets typed)
```

You typed a plain sentence. Flywheel recognized "Acme" as an alias for `Acme Corp.md` and linked it — no brackets, no lookup, no manual work. That link is now a graph edge. It's why the read example above works.

But the link is also a learning signal. Keep it through 10 edits and it gains weight. Remove it and the system learns what to stop suggesting. Two entities that co-appear across 20 notes build a statistical bond that surfaces in future suggestions. Every write makes the graph denser and the suggestions sharper. This is the flywheel effect — use compounds into structure, structure compounds into intelligence.

After the flywheel has been spinning, a single sentence lights up the whole graph:

```
❯ Log that Stacy reviewed the security checklist before the Beta Corp kickoff

● flywheel › vault_add_to_section
  path: "daily-notes/2026-01-04.md"
  section: "Log"
  content: "[[Stacy Thompson]] reviewed the [[API Security Checklist]] before the [[Beta Corp Dashboard]] kickoff
            → [[GlobalBank API Audit]], [[Acme Data Migration]]"
            ↑ 3 entities auto-linked, "Stacy" resolved via alias
            → 2 suggestions: entities that co-occur with Stacy + security work across past notes
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

See [docs/ALGORITHM.md](docs/ALGORITHM.md) for how scoring works.

### 3. The Contextual Cloud

**Every auto-wikilink is a bet on future relevance — and the house edge is 100% precision.**

The loop compounds:
- **Write** → entities are auto-linked, creating edges
- **Keep** a link through 10 edits → that edge gains weight
- **Co-occurrence** → two entities in 20 notes build a statistical bond
- **Remove** a bad link → the system learns what to suppress
- **Query** → denser graphs return more precise answers, which drives more use

This is the uncontested gap. Competing tools are static — they find what's there today. Flywheel's graph gets better the more you use it. A static search tool gives you the same results on day 1 and day 100. Flywheel's suggestions on day 100 are informed by everything you've written and edited since day 1. Usage turns into data, data turns into better suggestions, compounding over time. No retraining, no configuration, no manual curation.

See [Graph Quality](#graph-quality) for the numbers: 100% precision, 72-82% recall, stable over 50 generations of noisy feedback.

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

Claude picks up where it left off.

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

Hub notes surface. "Sarah Mitchell" has 23 backlinks -- she's clearly important. When you write about a project, her name appears in suggestions because co-occurrence tracking knows she's relevant. You didn't configure this. The vault structure revealed it.

### Month 3: The Graph Is Self-Sustaining

Every query leverages hundreds of accumulated connections. New content auto-links to the right places. You stop thinking about organization.

### Looking Backwards

The real test isn't "did the right link appear today?" It's: "six months from now, can I trace how a decision was made?" Every auto-wikilink is a breadcrumb. The contextual cloud around a project grows silently — meeting notes link to people, people link to decisions, decisions link to outcomes. You never planned this structure. It emerged from use.

Suggestions that seemed marginal at the time — linking a throwaway standup note to `[[Q3 Roadmap]]` — become the connective tissue that makes "show me everything related to Q3 planning" actually work.

### What This Looks Like

```
Input:  "Stacy Thompson finished reviewing the API Security Checklist for the Beta Corp Dashboard"
Output: "[[Stacy Thompson]] finished reviewing the [[API Security Checklist]] for the [[Beta Corp Dashboard]]"
```

No manual linking. No broken references. Use compounds into structure, structure compounds into intelligence.

---

## Battle-Tested

**2,456 tests. 122 test files. 47,000+ lines of test code.**

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

See [docs/PROVE-IT.md](docs/PROVE-IT.md) and [docs/TESTING.md](docs/TESTING.md).

### Graph Quality

The feedback loop claim isn't asserted — it's measured. We build a test vault with known-correct links, strip them out, and measure how well the engine rediscovers them. CI locks these baselines and fails if quality regresses.

| Mode | Precision | Recall | F1 |
|---|---|---|---|
| Conservative | 100% | 71.7% | 83.5% |
| Balanced | 100% | 80.0% | 88.9% |
| Aggressive | 100% | 81.7% | 89.9% |

**Precision** = "of the links suggested, how many were correct?" (100% = never suggests a wrong link). **Recall** = "of the links that should exist, how many were found?" **F1** = the balance of both — higher is better.

Measured against a 96-note/61-entity ground truth vault.

- **50-generation stress test** — suggest → accept/reject (85% correct, 15% noise) → mutate vault → rebuild index → repeat. F1 holds steady — the feedback loop doesn't degrade under realistic noise.
- **7 vault archetypes** — hub-and-spoke, hierarchical, dense-mesh, sparse-orphan, bridge-network, small-world, chaos
- **13 scoring layers** individually ablated, contribution measured
- **Regression gate** — CI fails if any mode's F1/precision/recall drops >5pp from baseline

See [docs/TESTING.md](docs/TESTING.md) for full methodology. Auto-generated report: [docs/QUALITY_REPORT.md](docs/QUALITY_REPORT.md).

### Safe Writes

Every mutation is:

- **Git-committed** — one `vault_undo_last_mutation` away from reverting any change
- **Conflict-detected** — content hash check prevents clobbering concurrent edits (SHA-256)
- **Policy-governed** — configurable guardrails with warn/strict/off modes
- **Dry-run preview** — every write tool supports `dry_run: true` to see exactly what would change before touching disk
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
| Tool count | 51 | ~10 | 0 (plugin) | ~5 |

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
      "args": ["-y", "@velvetmonkey/flywheel-memory"]
    }
  }
}
```

```bash
cd /path/to/your/vault && claude
```

Defaults to the `minimal` preset (11 tools). Add bundles as needed. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for all options.

> **Note:** Developed and tested with Claude Code. Other MCP clients may work but are untested.

---

## Tools Overview

| Preset | Tools | What you get |
|--------|-------|--------------|
| `minimal` (default) | 11 | Note-taking essentials — search, read, create, edit |
| `full` | 51 | Everything — graph, schema, tasks, policy, memory |
| `writer` | 14 | minimal + task management |
| `agent` | 14 | minimal + agent memory (brief, recall, memory) |
| `researcher` | 12 | Search + graph navigation — read-heavy exploration |

Composable bundles (add to presets or each other):

| Bundle | Tools | What it adds |
|--------|-------|--------------|
| `graph` | 7 | Backlinks, orphans, hubs, shortest paths |
| `analysis` | 9 | Schema intelligence, wikilink validation, content similarity |
| `tasks` | 3 | Task queries and mutations |
| `health` | 12 | Vault diagnostics, index management, growth, config, merges |
| `ops` | 2 | Git undo, policy automation |
| `note-ops` | 4 | Delete, move, rename notes, merge entities |

The fewer tools you load, the less context Claude needs to pick the right one. See [docs/TOOLS.md](docs/TOOLS.md) for the full reference.

---

## Documentation

| Doc | Why read this |
|---|---|
| [PROVE-IT.md](docs/PROVE-IT.md) | See it working in 5 minutes |
| [TOOLS.md](docs/TOOLS.md) | All 51 tools documented |
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

Apache 2.0 — see [LICENSE](./LICENSE) for details.
