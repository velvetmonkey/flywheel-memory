<div align="center">
  <img src="header.png" alt="Flywheel" width="256"/>
  <h1>Flywheel</h1>
  <p><strong>Give Claude your entire Obsidian vault.</strong><br/>
  MCP tools for search, write, and graph. Auto-wikilinks on every mutation.<br/>
  A feedback loop that learns from your edits. Zero cloud. Six lines of config.</p>
</div>

[![npm version](https://img.shields.io/npm/v/@velvetmonkey/flywheel-memory.svg)](https://www.npmjs.com/package/@velvetmonkey/flywheel-memory)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blueviolet.svg)](https://modelcontextprotocol.io/)
[![CI](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Clients](https://img.shields.io/badge/clients-Claude%20Code%20%7C%20Desktop%20%7C%20Cursor%20%7C%20Windsurf%20%7C%20VS%20Code-blue.svg)](docs/SETUP.md)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue.svg)](https://github.com/velvetmonkey/flywheel-memory)
[![HotpotQA](https://img.shields.io/badge/HotpotQA-84.8%25%20recall-brightgreen.svg)](docs/TESTING.md#retrieval-benchmark-hotpotqa)
[![LoCoMo](https://img.shields.io/badge/LoCoMo-58.5%25%20answer%20accuracy-brightgreen.svg)](docs/TESTING.md#retrieval-benchmark-locomo)
[![Tests](https://img.shields.io/badge/tests-2,640%20passed-brightgreen.svg)](docs/TESTING.md)

**[See It Work](#see-it-work)** · **[Try It](#try-it)** · **[What Makes It Different](#what-makes-flywheel-different)** · **[Benchmarked](#benchmarked)** · **[Tested](#tested)** · **[Docs](#documentation)**

| | Without Flywheel | With Flywheel |
|---|---|---|
| "What's overdue?" | Read every file | Indexed query, <10ms |
| "What links here?" | Grep the vault, flat list | Ranked backlinks + outlinks, pre-indexed |
| "Add a meeting note" | Raw write, no linking | Auto-wikilinks on every mutation |
| "What should I link?" | Not possible | 13-layer scoring engine + semantic search |
| Token cost per query | Hundreds to thousands | [53x less](docs/PROVE-IT.md#token-economics) — graph does the joining |

---

## See It Work

### Read: "How much have I billed Acme Corp?"

From the [carter-strategy](demos/carter-strategy/) demo — a solo consultant with 3 clients, 5 projects, and $27K in invoices.

<video src="https://github.com/user-attachments/assets/ec1b51a7-cb30-4c49-a35f-aa82c31ec976" autoplay loop muted playsinline width="100%"></video>

One search call returned everything — frontmatter with amounts and status, backlink lists, outlink lists. Zero file reads needed. The graph did the joining, not the AI reading files one by one.

### Write: Auto-wikilinks on every mutation

```
❯ Log that Stacy reviewed the security checklist before the Beta Corp kickoff

● flywheel › vault_add_to_section
  path: "daily-notes/2026-01-04.md"
  section: "Log"
  content: "[[Stacy Thompson|Stacy]] reviewed the [[API Security Checklist|security checklist]]
            before the [[Beta Corp Dashboard|Beta Corp]] kickoff
            → [[GlobalBank API Audit]], [[Acme Data Migration]]"
            ↑ 3 known entities auto-linked ("Stacy" resolved via alias, 100% precision)
            → 2 suggested links: entities co-occurring with Stacy + security across past notes
```

You typed a plain sentence. Flywheel recognized three entities from your vault and linked them — no brackets, no lookup, no manual work. Those links are graph edges that make future search richer. The `→` suggestions are contextual: entities that co-occur with Stacy and security across your past notes, scored and ranked. Links you keep strengthen future scoring; links you edit out get suppressed. The system learns.

---

## Try It

### Quick start (60 seconds)

```bash
git clone https://github.com/velvetmonkey/flywheel-memory.git
cd flywheel-memory/demos/carter-strategy && claude
```

Then ask: *"How much have I billed Acme Corp?"*

| Demo | You are | Ask this |
|------|---------|----------|
| [carter-strategy](demos/carter-strategy/) | Solo consultant | "How much have I billed Acme Corp?" |
| [artemis-rocket](demos/artemis-rocket/) | Rocket engineer | "What's blocking propulsion?" |
| [nexus-lab](demos/nexus-lab/) | PhD researcher | "How does AlphaFold connect to my experiment?" |
| [zettelkasten](demos/zettelkasten/) | Zettelkasten student | "How does spaced repetition connect to active recall?" |

### Install on your own vault

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

Flywheel does not replace Obsidian. It runs alongside as a background index — watches for changes, indexes in real-time, and makes the full graph available to any AI client. No proprietary format, no cloud sync, no account. Delete `.flywheel/state.db` and it rebuilds from scratch.

### Configure your tools

| Preset | Tools | What you get |
|--------|-------|--------------|
| `default` | 16 | search, read, write, tasks |
| `agent` | 16 | search, read, write, memory |
| `full` | 66 | Everything except memory (all 12 categories) |

Start with `default`. Add bundles as you need them: `graph`, `schema`, `wikilinks`, `temporal`, `diagnostics`, and more.

```json
{ "env": { "FLYWHEEL_TOOLS": "default,graph" } }
```

[Browse all 69 tools →](docs/TOOLS.md) | [Preset recipes →](docs/CONFIGURATION.md)

<details>
<summary><strong>Windows users — read this before you start</strong></summary>

Three things differ from macOS/Linux:
1. **`cmd /c npx`** instead of `npx` — Windows installs npx as a `.cmd` batch script that can't be spawned directly
2. **`VAULT_PATH`** — set this to your vault's Windows path
3. **`FLYWHEEL_WATCH_POLL: "true"`** — **required**. Without this, Flywheel won't pick up changes you make in Obsidian.

See [docs/CONFIGURATION.md#windows](docs/CONFIGURATION.md#windows) for the full config example.
</details>

**Using Cursor, Windsurf, VS Code, or another editor?** See [docs/SETUP.md](docs/SETUP.md) for your client's config.

---

## What Makes Flywheel Different

### 1. Enriched Search

Every search result comes back enriched — frontmatter, ranked backlinks, ranked outlinks, and content snippets, all from an in-memory index. That's how one call answers a billing question: the search finds `Acme Corp.md` with its frontmatter totals, and the backlinks surface every invoice and project — each with its own frontmatter. The graph did the joining.

With semantic embeddings enabled, "login security" finds notes about authentication without that exact keyword. Everything runs locally — SQLite + FTS5 for BM25, in-memory embeddings for semantic, Reciprocal Rank Fusion to merge results.

### 2. Every Link Has a Reason

Those `→` suggestions aren't random. Ask why Flywheel suggested `[[Marcus Johnson]]`:

```
Entity              Score  Match  Co-oc  Type  Context  Recency  Cross  Hub  Feedback  Semantic  Edge
---------------------------------------------------------------------------------------------------
Marcus Johnson        34    +10     +3    +5     +5       +5      +3    +1     +2         0       0
```

13 scoring layers, every number traceable to vault usage. Recency from what you last wrote. Co-occurrence from notes you've written before. Hub score from eigenvector centrality — not just how many notes link there, but how important those linking notes are. The score learns as you use it.

See [docs/ALGORITHM.md](docs/ALGORITHM.md) for how scoring works.

### 3. Use It and It Gets Smarter

Every sentence you write through Flywheel makes your graph denser. A denser graph gives better search results, richer backlinks, and sharper suggestions. That's the flywheel.

- **Co-occurrence** builds over time — two entities appearing in 20 notes form a statistical bond
- **Edge weights** accumulate — links that survive edits gain influence
- **Suppression** learns — connections you repeatedly break stop being suggested

Static tools give you the same results on day 1 and day 100. Flywheel's suggestions on day 100 are informed by everything you've written and edited since day 1. No retraining, no configuration, no manual curation.

### 4. Agentic Memory

Your AI knows what you were working on yesterday without you re-explaining it.

- **`brief`** — startup context: what happened recently, what's active, what needs attention
- **`recall`** — retrieves across notes, entities, memories, and semantic search in one call
- **`memory`** — stores observations that persist across sessions, with automatic decay

No session is a blank slate.

### 5. Deterministic Policies

Complex vault workflows shouldn't be ad-hoc. Describe what you want in plain language — the AI creates the policy, saves it, and executes it on demand.

```
❯ Create a policy that generates a weekly review note, pulls open tasks,
  and updates project frontmatter with hours logged

● flywheel › policy action=author
  → Saved .claude/policies/weekly-review.yaml

❯ Run the weekly review for this week

● flywheel › policy action=execute name=weekly-review
  variables: { week: "2026-W12" }
  → Created weekly-notes/2026-W12.md
  → Updated 3 project frontmatter files
  → All steps committed atomically
```

Policies chain vault tools into atomic operations — all steps succeed or all roll back, committed as a single git commit.

---

## Benchmarked

Measured on standard academic datasets. Reproducible on your machine: [`demos/hotpotqa/`](demos/hotpotqa/) | [`demos/locomo/`](demos/locomo/)

### Document Retrieval (HotpotQA)

200 multi-hop questions across 1,993 documents. End-to-end via real Claude sessions, not a component test. Zero training data.

| System | Type | Recall | |
|---|---|---|---|
| **Flywheel** | General-purpose MCP tool | **84.8%** | No training, end-to-end |
| BM25 baseline | Industry-standard IR | ~70-75% | Powers Elasticsearch, GitHub, Netflix |
| [Baleen](https://arxiv.org/abs/2101.00436) | Trained retriever | ~85% | Stanford, NeurIPS 2021 |
| [MDR](https://arxiv.org/abs/2009.12756) | Trained retriever | ~88% | Meta AI, ICLR 2021 |

> Flywheel has never seen HotpotQA training data. Baleen and MDR were trained on it.

### Conversational Memory (LoCoMo)

200 questions across 10 conversations. Answer accuracy via LLM-as-judge — same methodology as competitor benchmarks.

| System | Single-hop | Multi-hop | Commonsense |
|---|---|---|---|
| **Flywheel** | **75.0%** | 27.5% | **80.0%** |
| [Mem0](https://mem0.ai/) | 38.7 | **28.6** | — |
| [Zep](https://getzep.com/) | 35.7 | 19.4 | — |
| [LangMem](https://github.com/langchain-ai/langmem) | 35.5 | 26.0 | — |
| [Letta](https://memgpt.ai/) | 26.7 | — | — |

> Competitor numbers from the [Mem0 paper](https://arxiv.org/abs/2504.19413) (695 questions). Flywheel: 200 questions balanced across categories.

[Full benchmark methodology →](docs/TESTING.md)

---

## Tested

2,640 tests across read, write, security, concurrency, and graph quality. CI-gated on Ubuntu + Windows, Node 20 + 22.

- **Graph quality** — 100% wikilink precision on ground truth vault, stress-tested over 50 generations with realistic noise. [Report →](docs/QUALITY_REPORT.md)
- **Live AI testing** — Real `claude -p` sessions verify tool adoption end-to-end, not just handler logic
- **Write safety** — Git-backed conflict detection, atomic rollback, 100 parallel writes with zero corruption
- **Security** — SQL injection, path traversal, Unicode normalization, permission bypass

[Full methodology and results →](docs/TESTING.md)

---

## Documentation

| Doc | Why read this |
|---|---|
| [PROVE-IT.md](docs/PROVE-IT.md) | **Start here** — see it working in 5 minutes |
| [TOOLS.md](docs/TOOLS.md) | All 69 tools documented |
| [COOKBOOK.md](docs/COOKBOOK.md) | Example prompts by use case |
| [SETUP.md](docs/SETUP.md) | Full setup guide for your vault |
| [CONFIGURATION.md](docs/CONFIGURATION.md) | Env vars, presets, custom tool sets |
| [ALGORITHM.md](docs/ALGORITHM.md) | How the scoring works |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Index strategy, graph, auto-wikilinks |
| [TESTING.md](docs/TESTING.md) | Test methodology and benchmarks |
| [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Error recovery and diagnostics |
| [VISION.md](docs/VISION.md) | Where this is going |

---

## License

AGPL-3.0 — see [LICENSE](./LICENSE) for details. The source stays open. If someone forks this and offers it as a service, they must publish their changes. Your data is local; the code is transparent.
