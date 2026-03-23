<div align="center">
  <img src="header.png" alt="Flywheel" width="256"/>
  <h1>Flywheel</h1>
  <p><strong>Give Claude your entire Obsidian vault.</strong><br/>
  69 MCP tools. Indexed search in milliseconds. Auto-wikilinks on every write. A feedback loop that learns from your edits.<br/>
  Zero cloud. Six lines of config.</p>
</div>

[![npm version](https://img.shields.io/npm/v/@velvetmonkey/flywheel-memory.svg)](https://www.npmjs.com/package/@velvetmonkey/flywheel-memory)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blueviolet.svg)](https://modelcontextprotocol.io/)
[![CI](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Clients](https://img.shields.io/badge/clients-Claude%20Code%20%7C%20Desktop%20%7C%20Cursor%20%7C%20Windsurf%20%7C%20VS%20Code-blue.svg)](docs/SETUP.md)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue.svg)](https://github.com/velvetmonkey/flywheel-memory)
[![HotpotQA](https://img.shields.io/badge/HotpotQA-84.8%25%20recall-brightgreen.svg)](docs/TESTING.md#retrieval-benchmark-hotpotqa)
[![LoCoMo](https://img.shields.io/badge/LoCoMo-90.4%25%20Recall%4010-brightgreen.svg)](docs/TESTING.md#retrieval-benchmark-locomo)
[![Tests](https://img.shields.io/badge/tests-2,541%20passed-brightgreen.svg)](docs/TESTING.md)

**[Try It](#try-it)** · **[See It Work](#see-it-work)** · **[What Makes It Different](#what-makes-flywheel-different)** · **[How It Compares](#how-it-compares)** · **[Benchmarked](#benchmarked)** · **[Docs](#documentation)**

| | Without Flywheel | With Flywheel |
|---|---|---|
| "What's overdue?" | Read every file | Indexed query, <10ms |
| "What links here?" | Grep for name, flat list | Backlink graph, pre-indexed |
| "Add a meeting note" | Raw write, no linking | Auto-wikilinks on every mutation |
| "What should I link?" | Not possible | 10-dimension scoring + semantic search |
| Token cost | ~800-2,000 per query | ~50-200 per query ([53x savings measured](docs/PROVE-IT.md#token-economics)) |

Every number on this page is measured, CI-gated, and reproducible on your machine.

---

## Try It

### Quick start (60 seconds)

```bash
git clone https://github.com/velvetmonkey/flywheel-memory.git
cd flywheel-memory/demos/carter-strategy && claude
```

Then ask: *"How much have I billed Acme Corp?"*

### Demos

| Demo | You are | Ask this |
|------|---------|----------|
| [carter-strategy](demos/carter-strategy/) | Solo consultant | "How much have I billed Acme Corp?" |
| [artemis-rocket](demos/artemis-rocket/) | Rocket engineer | "What's blocking propulsion?" |
| [startup-ops](demos/startup-ops/) | SaaS co-founder | "What's our MRR?" |
| [nexus-lab](demos/nexus-lab/) | PhD researcher | "How does AlphaFold connect to my experiment?" |
| [solo-operator](demos/solo-operator/) | Content creator | "How's revenue looking?" |
| [support-desk](demos/support-desk/) | Support agent | "What's Sarah Chen's situation?" |
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

Flywheel does not replace Obsidian. You keep writing and organizing notes exactly as you do now. Flywheel runs alongside it as a background index — it watches for changes, indexes them in real-time, and makes the full graph available to any AI client. When Flywheel writes a note, it appears in Obsidian as a normal markdown file. There is no proprietary format, no cloud sync, no account. Delete `.flywheel/state.db` and it rebuilds from scratch.

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

## How It Compares

Most Obsidian AI tools are either simple MCP bridges (read/write files, no graph) or cloud-dependent embedding search (no local processing, no learning). Flywheel is neither:

| Capability | Flywheel Memory | Typical MCP bridge | Typical AI plugin |
|---------|----------------|-------------------|-------------------|
| Backlink graph | Bidirectional, eigenvector centrality | No | No |
| Search | Local hybrid (BM25 + semantic) | Basic file read | Cloud embedding |
| Auto-wikilinks | Yes (alias resolution, 18 entity categories) | No | No |
| Schema intelligence | 9 analysis modes | No | No |
| Learns from usage | Feedback loop + suppression + co-occurrence | No | No |
| Agent memory | brief + recall + memory | No | No |
| Safe writes | Git + conflict detection + dry-run | No | N/A |
| Retrieval benchmarks | HotpotQA 84.8%, LoCoMo 55.0% | None published | None published |

---

## Benchmarked

No other MCP memory tool publishes retrieval benchmarks on standard academic datasets. Flywheel does — on two of them.

### Retrieval Quality

| Benchmark | What it tests | Questions | Key result |
|---|---|---|---|
| [HotpotQA](https://hotpotqa.github.io/) | Multi-hop document retrieval | 200 | **84.8%** document recall |
| [LoCoMo](https://snap-research.github.io/locomo/) | Conversational memory | 1,531 | **90.4%** Recall@10 |

**HotpotQA** (200 hard multi-hop questions, 1,993 documents, v2.0.126) — End-to-end via real `claude -p` sessions, not a component test. 82.1% on multi-hop bridge questions. 99.5% partial recall (199/200 questions had at least one supporting doc found). $0.061/question. Zero training. For context: BM25 keyword search — the standard baseline — scores ~75%. Purpose-built neural retrievers trained on this dataset score 85-93%. Flywheel scores 84.8% with general-purpose vault tools.

**LoCoMo** (10 conversations, 272 session notes, 5 question categories, ACL 2024) — Unit-level: 84.8% Recall@5, 90.4% Recall@10. End-to-end (200 questions, balanced across categories): 55.0% answer accuracy (LLM-as-judge), 70.0% on single-hop, 75.0% on commonsense.

### How Flywheel Compares

**Document retrieval (HotpotQA):**

| System | Type | Recall | Context |
|---|---|---|---|
| **Flywheel** | MCP vault tool | **84.8%** | Zero training, general-purpose, end-to-end via Claude |
| BM25 baseline | IR baseline | ~70-75% | Powers Elasticsearch (Wikipedia, GitHub, Netflix, Uber) |
| [Baleen](https://arxiv.org/abs/2101.00436) | Trained retriever | ~85% | Stanford, NeurIPS 2021. Trained on HotpotQA |
| [MDR](https://arxiv.org/abs/2009.12756) | Trained retriever | ~88% | Meta AI Research, ICLR 2021. Trained on HotpotQA |

> Flywheel has never seen HotpotQA training data. Baleen and MDR were trained on it. BM25 is the industry-standard algorithm behind every major search engine.

**Conversational memory (LoCoMo, answer accuracy via LLM-as-judge):**

| System | Single-hop | Multi-hop | Commonsense | Backed By |
|---|---|---|---|---|
| **Flywheel** | **70.0%** | 15.0% | **75.0%** | Self-funded, local-only (SQLite + markdown) |
| [Mem0](https://mem0.ai/) | 38.7 | **28.6** | — | YC ($24M), AWS Agent SDK partner |
| [Zep](https://getzep.com/) | 35.7 | 19.4 | — | YC, enterprise memory platform |
| [LangMem](https://github.com/langchain-ai/langmem) | 35.5 | 26.0 | — | LangChain ($25M+ raised) |
| [Letta](https://memgpt.ai/) | 26.7 | — | — | UC Berkeley research ($10M, Felicis Ventures) |

> **Transparency notes:**
> - All numbers are answer accuracy via LLM-as-judge (binary CORRECT/WRONG) — same methodology across all systems. Flywheel uses Claude Haiku as judge; competitor numbers from the Mem0 paper.
> - Flywheel: 200 questions (balanced, 40 per category, all 10 conversations). Competitors: 695 questions.
> - Multi-hop (15%) is below competitors. The retrieval pipeline finds 60% of evidence sessions, but synthesizing facts from multiple sessions into a concise answer remains hard. This is an active area of improvement.

**What we don't claim:**
- We don't claim to beat trained retrievers. We sit *next to* them without any training.
- We don't claim multi-hop is solved. 15% — retrieval works, synthesis doesn't yet.
- We don't claim Flywheel is the best at everything. Dedicated GraphRAG systems may edge ahead on complex multi-step reasoning.

[Full benchmark methodology →](docs/TESTING.md) | Run them yourself: [`demos/hotpotqa/`](demos/hotpotqa/) | [`demos/locomo/`](demos/locomo/)

<details>
<summary><strong>Graph quality, live AI testing, and safety</strong></summary>

### Graph Quality

The feedback loop claim is measured, not asserted. A test vault with known-correct links is stripped, and the engine rediscovers them. CI regression-gates these baselines — if any metric drops >5pp, the build fails.

| Mode | Precision | Recall | F1 |
|---|---|---|---|
| Conservative | 100.0% | 71.7% | 83.5% |
| Balanced | 100.0% | 76.7% | 86.8% |
| Aggressive | 100.0% | 76.7% | 86.8% |

Measured against a 96-note/61-entity ground truth vault. 100% precision = zero wrong links suggested. [Auto-generated report →](docs/QUALITY_REPORT.md)

- **50-generation stress test** — suggest → accept/reject (85% correct, 15% noise) → mutate → rebuild → repeat. F1 holds steady under realistic noise.
- **7 vault archetypes** — hub-and-spoke, hierarchical, dense-mesh, sparse-orphan, bridge-network, small-world, chaos
- **13 scoring layers** individually ablated, contribution measured

### Live AI Testing

Most MCP servers unit-test their handlers. Flywheel also tests whether the AI picks the right tool — using real `claude -p` sessions with `--strict-mcp-config` (no filesystem, no web).

| Test | Sessions | Result |
|------|----------|--------|
| Bundle adoption | 36 (12 bundles × 3) | 11/12 at 100% |
| Sequential workflow | 7 beats (cumulative state) | 7/7 passed |
| HotpotQA retrieval | 200 questions | 84.8% recall |
| LoCoMo retrieval | 1,531 questions | 90.4% Recall@10 |

Every session is captured as JSONL, analyzed by Python scripts, and reported with tool sequences. Nothing is mocked. [Full results →](docs/TESTING.md#live-ai-testing)

### Performance & Safety

**2,541 tests. 124 test files. 47,000+ lines of test code.** 10 focused CI jobs plus cross-platform matrix (Ubuntu + Windows, Node 20 + 22).

| Category | What it proves |
|---|---|
| Read tools + graph | Search, backlinks, scoring, FTS5 |
| Write safety | Mutations, conflict detection, git integration |
| Security | SQL injection, path traversal, permission bypass, Unicode normalization |
| Concurrency | 100 parallel writes, zero corruption |
| Property-based fuzzing | 700+ randomized scenarios |
| Graph quality | 266 tests — precision/recall, archetypes, feedback loops |

Every mutation is git-committed (one `vault_undo_last_mutation` away from reverting), conflict-detected (SHA-256 hash before every write), and dry-run capable. Auto-wikilinks are AST-protected — code blocks, frontmatter, existing links, callouts, math, and HTML are never touched.

</details>

---

## What Makes Flywheel Different

### 1. Enriched Search

Every search result comes back enriched — frontmatter, ranked backlinks, ranked outlinks, and content snippets, all from an in-memory index. That's how one call answers a billing question: the search finds `Acme Corp.md` with its frontmatter totals, and the backlinks surface every invoice and project — each with its own frontmatter. The graph did the joining.

With semantic embeddings enabled, "login security" finds notes about authentication without that exact keyword. Everything runs locally — SQLite + FTS5 for BM25, in-memory embeddings for semantic, Reciprocal Rank Fusion to merge results.

### 2. Every Link Has a Reason

Those `→` suggestions aren't random. Ask why Flywheel suggested `[[Marcus Johnson]]`:

```
Entity              Score  Match  Co-oc  Type  Context  Recency  Cross  Hub  Feedback  Semantic  Edge
──────────────────────────────────────────────────────────────────────────────────────────────────────
Marcus Johnson        34    +10     +3    +5     +5       +5      +3    +1     +2         0       0
```

10 scoring dimensions, every number traceable to vault usage. Recency from what you last wrote. Co-occurrence from notes you've written before. Hub score from eigenvector centrality — not just how many notes link there, but how important those linking notes are. The score learns as you use it.

See [docs/ALGORITHM.md](docs/ALGORITHM.md) for how scoring works.

### 3. Use It and It Gets Smarter

Every sentence you write through Flywheel makes your graph denser. A denser graph gives better search results, richer backlinks, and sharper suggestions. That's the flywheel.

- **Co-occurrence** builds over time — two entities appearing in 20 notes form a statistical bond
- **Edge weights** accumulate — links that survive edits gain influence
- **Suppression** learns — connections you repeatedly break stop being suggested (Beta-Binomial posterior model, not a blacklist)

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
