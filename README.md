<div align="center">
  <img src="header.png" alt="Flywheel" width="256"/>
  <h1>Flywheel</h1>
  <p><strong>MCP tools that search, write, and auto-link your Obsidian vault — and learn from your edits.</strong><br/>
  All local. All yours. A few lines of config.</p>
</div>

[![npm version](https://img.shields.io/npm/v/@velvetmonkey/flywheel-memory.svg)](https://www.npmjs.com/package/@velvetmonkey/flywheel-memory)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blueviolet.svg)](https://modelcontextprotocol.io/)
[![CI](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Clients](https://img.shields.io/badge/clients-Claude%20Code%20%7C%20Desktop%20%7C%20Cursor%20%7C%20Windsurf%20%7C%20VS%20Code%20%7C%20OpenClaw-blue.svg)](docs/SETUP.md)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue.svg)](https://github.com/velvetmonkey/flywheel-memory)
[![HotpotQA](https://img.shields.io/badge/HotpotQA-92.4%25%20recall%20(500q)-brightgreen.svg)](docs/TESTING.md#retrieval-benchmark-hotpotqa)
[![LoCoMo](https://img.shields.io/badge/LoCoMo-79%25%20recall%20(695q)-blue.svg)](docs/TESTING.md#retrieval-benchmark-locomo)
[![Cost](https://img.shields.io/badge/cost-%240.06--0.10%2Fquery-green.svg)](docs/TESTING.md#how-the-e2e-benchmark-works)
[![Tests](https://img.shields.io/badge/tests-2,712%20passed-brightgreen.svg)](docs/TESTING.md)

**[See It Work](#see-it-work)** · **[Try It](#try-it)** · **[What Makes It Different](#what-makes-flywheel-different)** · **[Benchmarked](#benchmarked)** · **[Tested](#tested)** · **[Docs](#documentation)** · **[Story](#the-story-behind-this)** · **[License](#license)**

> **Cognitive sovereignty** = your knowledge graph stays on your machine. No platform builds a profile from it. No subscription locks you in. You choose the model. You own the memory.

<details>
<summary><strong>How this compares to not using Flywheel</strong></summary>

| | Without | With Flywheel |
|---|---|---|
| Your data | Leaves your machine | Stays local. No sync, no upload, no account |
| Model choice | Locked to one provider | Model-agnostic via MCP. Swap anytime |
| As models improve | Migration or vendor upgrade | Same tools, better reasoning. Your graph improves the model, not the other way around |
| Tokens per question | Read 10-50 files to find context (~50-200k tokens) | One search returns a decision surface — metadata, graph context, and section content (~2-5k tokens). [$0.06-0.09/query](#benchmarked) measured |
| "What's overdue?" | Read every file | Structured task queries with due dates, tags, and path filters |
| "What links here?" | Grep the vault, flat list | Weighted backlinks + outlinks, ranked by edge strength and recency |
| "Add a meeting note" | Raw write, no linking | Structured mutations that auto-link entities and densify the graph |
| "What should I link?" | Not possible | 13-layer scoring engine + semantic search |
| Your graph | Owned by the platform | Yours to [export](https://en.wikipedia.org/wiki/GraphML), analyse, or delete |
| Tool calls | Hidden behind abstractions | Traceable, auditable, opt-in git commits |

</details>

## See It Work

### Read: "How much have I billed Acme Corp?"

From the [carter-strategy](demos/carter-strategy/) demo: a solo consultant with 3 clients, 5 projects, and $27K in invoices.

<video src="https://github.com/user-attachments/assets/ec1b51a7-cb30-4c49-a35f-aa82c31ec976" autoplay loop muted playsinline width="100%"></video>

One search call returned a decision surface: metadata (frontmatter) with amounts and status, backlink lists, outlink lists, and full section content around each match. Zero follow-up reads needed. The graph did the joining, not the AI reading files one by one.

### Write: Auto-wikilinks on every mutation

```
❯ Log that Stacy reviewed the security checklist before the Beta Corp kickoff

● flywheel › vault_add_to_section
  path: "daily-notes/2026-01-04.md"
  section: "Log"
  suggestOutgoingLinks: true
  content: "[[Stacy Thompson|Stacy]] reviewed the [[API Security Checklist|security checklist]]
            before the [[Beta Corp Dashboard|Beta Corp]] kickoff
            → [[GlobalBank API Audit]], [[Acme Data Migration]]"
            ↑ 3 known entities auto-linked ("Stacy" resolved via alias, 100% precision)
            → 2 suggested links: entities co-occurring with Stacy + security across past notes
```

You typed a plain sentence. Flywheel recognized three entities and linked them: entity names, aliases, and fuzzy matches scored across [13 dimensions](docs/ALGORITHM.md). Links you keep strengthen future scoring; links you edit out get suppressed. The system learns.

`→` suggestions are off by default. Enable with `suggestOutgoingLinks: true` for daily notes, meeting logs, and voice capture. Anywhere you want the graph to grow organically. [Configuration guide →](docs/CONFIGURATION.md)

### Boundaries in action

```
You: "Log that I reviewed the security audit with Sarah before the Beta Corp deadline"

Flywheel:
  → vault_add_to_section("daily-notes/2026-03-24.md", "Log", ...)
  → Auto-links: [[Sarah Mitchell|Sarah]], [[Security Audit|security audit]], [[Beta Corp]]
  → Suggests: → [[GlobalBank API Audit]], [[Compliance Matrix]]
  → Git commit: 1 file changed, 1 insertion

What happened                         What didn't
✓ One explicit tool call              ✗ No hidden tool chains
✓ Every link visible before write     ✗ No files touched outside vault
✓ One reversible git commit           ✗ Nothing sent to cloud
```

> **Reproduce it yourself:** The carter-strategy demo includes a [`run-demo-test.sh`](demos/carter-strategy/run-demo-test.sh) script that runs all five beats end-to-end via `claude -p`, verifying tool usage and vault state between each step.

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

Flywheel does not replace Obsidian. It runs alongside as a background index. Watches for changes, indexes in real-time, and makes the full graph available to any AI client. No proprietary format, no cloud sync, no account. Delete `.flywheel/state.db` and it rebuilds from scratch.

### Configure your tools

| Preset | Tools | What you get |
|--------|-------|--------------|
| `default` | 18 | search, read, write, tasks, memory |
| `full` | 75 | Everything (all 12 categories) |

Start with `default` — it includes search, read, write, tasks, and memory. Add bundles as you need them: `graph` (includes GraphML export for Gephi/Cytoscape), `schema`, `wikilinks`, `temporal`, `diagnostics`.

```json
{ "env": { "FLYWHEEL_TOOLS": "default,graph" } }
```

[Browse all 75 tools →](docs/TOOLS.md) | [Preset recipes →](docs/CONFIGURATION.md)

<details>
<summary><strong>Windows users - read this before you start</strong></summary>

Three things differ from macOS/Linux:
1. **`cmd /c npx`** instead of `npx`: Windows installs npx as a `.cmd` batch script that can't be spawned directly
2. **`VAULT_PATH`**: set this to your vault's Windows path
3. **`FLYWHEEL_WATCH_POLL: "true"`**: **required**. Without this, Flywheel won't pick up changes you make in Obsidian.

See [docs/CONFIGURATION.md#windows](docs/CONFIGURATION.md#windows) for the full config example.
</details>

**Using Cursor, Windsurf, VS Code, OpenClaw, or another client?** See [docs/SETUP.md](docs/SETUP.md) for your client's config.

---

### Who this is for

**For** people who want control over their knowledge: developers, researchers, solo operators, and anyone who treats their notes as infrastructure, not disposable input. Every conversation you have with a cloud AI builds a cognitive profile of you that you don't own, can't export, and can't delete. Flywheel keeps that profile local. The people who use AI the most [want more control, not less](https://x.com/AnthropicAI/status/2036499691571953848). Also works as persistent memory for bots and agents — memory tools are included in the default preset, including [OpenClaw](https://github.com/openclaw/openclaw), where it replaces default amnesiac file access with graph-aware, learning memory.

**Not for** people who want a hosted service. Flywheel runs on your machine, on your files. If you want cloud-managed knowledge, this isn't it.

---

## What Makes Flywheel Different

- **Search** — One call returns a decision surface: section provenance, extracted dates, entity bridges, confidence scores, and full section content. Multi-hop: "Acme Corp" returns the client note *and* its invoices, projects, and people. [$0.06-0.10/query](#benchmarked), measured.
- **Write** — Every mutation auto-links entities across your vault. Voice dump a meeting debrief and Flywheel wikilinks names, projects, and relationships automatically. [13 scoring layers](docs/ALGORITHM.md), zero manual curation.
- **Remember** — `brief` delivers startup context, `memory` persists observations across sessions, and `search` retrieves across all three in one call. The system learns from your edits — links you keep get stronger, links you remove get suppressed.

All local. No cloud. No account. No sync.

### Every link has a reason

```
Entity              Score  Match  Co-oc  Type  Context  Recency  Cross  Hub  Feedback  Semantic  Edge
---------------------------------------------------------------------------------------------------
Marcus Johnson        34    +10     +3    +5     +5       +5      +3    +1     +2         0       0
```

13 scoring layers, every number traceable to vault usage. The score learns as you use it. [How scoring works →](docs/ALGORITHM.md)

### The flywheel effect

Every sentence you write makes your graph denser — better search results, richer backlinks, sharper suggestions.

- **Proactive linking:** edit a note in Obsidian and Flywheel links it in the background. Tune thresholds or disable entirely.
- **Co-occurrence** builds over time. Links that survive edits gain influence.
- **Suppression** learns. Remove a wikilink enough times and Flywheel stops suggesting it.

Day 100 suggestions are informed by everything you've written since day 1. This is [measured](docs/TESTING.md#graph-quality-266-tests-31-files), not a claim — CI fails if any metric regresses. All learning data is local SQLite. [What's tracked →](docs/SHARING.md)

### Agentic policies

Complex vault workflows become deterministic YAML policies. All steps succeed or all roll back. Commit with one flag. Every write uses structured parsing that understands headings, frontmatter, and code blocks as structure — not blind string replacement. [Architecture →](docs/ARCHITECTURE.md)

### Portable knowledge graph

One call to `export_graph` and your entire vault (or any entity's neighborhood) becomes a [GraphML](https://en.wikipedia.org/wiki/GraphML) file. Open it in any graph tool, run community detection, find bottlenecks, or just see what's connected to what.

![Acme Corp ego network](demos/carter-strategy/carter-strategy-acme-graph.png)

*"Show me everything connected to Acme Corp." One call: `export_graph({ center_entity: "Acme Corp" })`. Sarah Mitchell is the single contact linking 3 projects to the client. The Data Migration Playbook bridges two engagements. Seven invoices, two team members, one proposal. All from plain markdown. [Try it yourself →](demos/carter-strategy/carter-strategy-acme.graphml)*

### System guarantees

These are rules, not preferences:

- **No surprise writes.** Tool-initiated mutations require explicit calls. Proactive linking (the only background write) is auditable and can be disabled entirely.
- **No hidden tool execution.** Every tool call is visible, scoped, and logged.
- **No required cloud dependency.** Core indexing, search, and graph run locally. No account, no sync, no phone-home.
- **All actions are auditable.** Every write can be a git commit — one parameter. Every change is reversible.
- **No silent data exfiltration.** Your vault content is never sent anywhere except the AI model you chose to connect.

### How Flywheel compares

| | SaaS copilots | Agent frameworks | Flywheel |
|---|---|---|---|
| Execution | Guess, act silently | Chain tools opaquely | Explicit commands, scoped to vault |
| Data | Cloud-first | Cloud or hybrid | Local only. Your machine, your files |
| Trust model | "Trust us" | Trust the sandbox | Trust the constraint |
| Auditability | Opaque | Partial | Opt-in git commits. One flag, full audit trail |
| Model lock-in | Total | Varies | None. MCP is model-agnostic |

---

## Benchmarked

**92.4% retrieval recall** on [HotpotQA](https://hotpotqa.github.io/). **84.8% recall@5** on [LoCoMo](https://snap-research.github.io/locomo/) conversational memory. Zero training data. Fully local. $0.07/question.

Every number is reproducible: clone the repo, run the scripts, get the same results. No other MCP memory tool publishes retrieval benchmarks on standard academic datasets.

**Multi-hop retrieval vs. academic baselines** (HotpotQA, 500 questions, 4,960 documents):

| System | Recall | Training data |
|---|---|---|
| BM25 baseline | ~75% | None |
| [TF-IDF + Entity](https://arxiv.org/abs/1809.09600) | ~80% | None |
| [Baleen](https://arxiv.org/abs/2101.00436) (Stanford) | ~85% | HotpotQA |
| [MDR](https://arxiv.org/abs/2009.12756) (Facebook) | ~88% | HotpotQA |
| **Flywheel** | **92.4%** | **None** |
| [Beam Retrieval](https://arxiv.org/abs/2308.08973) | ~93% | End-to-end |

**Conversational memory** ([LoCoMo](https://snap-research.github.io/locomo/), 1,531 questions, 272 session notes):

| Category | Recall@5 | Recall@10 |
|---|---|---|
| **Overall** | **84.8%** | **90.4%** |
| Single-hop | 88.1% | 91.7% |
| Commonsense | 95.4% | 98.3% |
| Multi-hop | 58.1% | 72.7% |
| Temporal | 56.9% | 67.4% |

E2E with Claude Sonnet (695 questions): 95.5% single-hop evidence recall, 65.3% multi-hop, 79.1% overall. Competitors (Mem0, Zep, LangMem) report answer accuracy via GPT-4o judge but not evidence recall — metrics differ. [Full comparison →](docs/TESTING.md#retrieval-benchmark-locomo)

> **Directional, not apples-to-apples.** Different test settings, sample sizes, retrieval pools, and metrics. Flywheel searches 4,960 pooled docs (harder than HotpotQA distractor setting of 10, easier than fullwiki 5M+). Academic retrievers train on the benchmark; Flywheel has zero training data. Run-to-run variance of ~1pp is expected due to LLM non-determinism. [Full caveats →](docs/TESTING.md#retrieval-benchmark-hotpotqa)

[`demos/hotpotqa/`](demos/hotpotqa/) · [`demos/locomo/`](demos/locomo/) · [Full methodology →](docs/TESTING.md)

---

## Tested

2,712 tests across read, write, security, concurrency, and graph quality. CI-gated on Ubuntu + Windows, Node 22 + 24.

- **Graph quality:** 100% wikilink precision on ground truth vault, stress-tested over 50 generations with realistic noise. [Report →](docs/QUALITY_REPORT.md)
- **Live AI testing:** real `claude -p` sessions verify tool adoption end-to-end, not just handler logic
- **Write safety:** git-backed conflict detection, atomic rollback, 100 parallel writes with zero corruption
- **Security:** SQL injection, path traversal, Unicode normalization, permission bypass

[Full methodology and results →](docs/TESTING.md)

---

## Documentation

| Doc | Why read this |
|---|---|
| [PROVE-IT.md](docs/PROVE-IT.md) | **Start here.** See it working in 5 minutes |
| [TOOLS.md](docs/TOOLS.md) | All 75 tools documented |
| [COOKBOOK.md](docs/COOKBOOK.md) | Example prompts by use case |
| [SETUP.md](docs/SETUP.md) | Full setup guide for your vault |
| [CONFIGURATION.md](docs/CONFIGURATION.md) | Env vars, presets, custom tool sets |
| [ALGORITHM.md](docs/ALGORITHM.md) | How the scoring works |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Index strategy, graph, auto-wikilinks |
| [TESTING.md](docs/TESTING.md) | Test methodology and benchmarks |
| [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Error recovery and diagnostics |
| [SHARING.md](docs/SHARING.md) | What's tracked, privacy guarantees, sharing stats |
| [VISION.md](docs/VISION.md) | Where this is going |

---

## The Story Behind This

Flywheel started because I'm fundamentally lazy. I wanted to talk at my vault through a Telegram bot and have it not be rubbish - no typing, no manual linking, no curation. The lazy path needed to be the correct path, so I built a system where they're the same path.

I've been writing code for over 30 years and tried every PKM tool going before landing on Obsidian. Flywheel is my third attempt at wiring AI into my knowledge vault. The first two failed because writes were non-deterministic and context didn't flow between sessions. This version unifies everything: one server with deterministic mutations, hybrid search, and a graph that compounds with use. The Architecture exists because I kept hitting the same walls and refusing to stop.

Your attention, memory, and even the way you reason are increasingly shaped by systems you didn't choose. Platforms that optimise for engagement, models trained on someone else's priorities, defaults that quietly steer how you organise what you know. I wanted a knowledge layer that works for the person using it. A system that only gets smarter from your own honest engagement is fundamentally different from one that optimises for someone else's metrics.

The entire codebase was built through Claude Code with Opus 4.5 and 4.6. I designed the architecture and made every decision and it's been through extensive code reviews and testing, but verify what matters to you.

I dogfood it daily through a Telegram bot using voice input. The volume of knowledge you can accumulate at speed through voice is staggering - even quiet days produce 20–30 links where they used to be 3–5. Flywheel exists partly because I needed something that could keep up. All suggestions are welcome! I'm looking for people who care about this space.

### The Cognitive Pipeline

What emerged from daily use is a workflow pattern: cheap models generate ideas at volume (Grok, ChatGPT — whatever's free), the Telegram bot filters for truth and persists to the vault, then a separate Claude Code session reads the stored context and executes from filtered material. Generate broadly, filter honestly, execute precisely.

It works because Flywheel makes every stage persistent. The bot's conversation is logged and auto-wikilinked. The filter's judgements become searchable memories. The executor reads yesterday's daily notes and picks up where the last session left off — no re-explaining, no context dump, no starting from scratch.

Because Flywheel is an MCP server, any client can be any stage. An OpenClaw bot, a Cursor session, Claude Desktop — they all get the same persistent, learning memory. The graph compounds across sessions. Your filing cabinet stops being passive storage and starts thinking with you.

To contribute back to Obsidian I'm also building [Flywheel Crank](https://github.com/velvetmonkey/flywheel-crank) (early days), an Obsidian plugin that surfaces suggestions, graph visibility, and management tools directly in the editor.

---

## License

Apache-2.0. See [LICENSE](./LICENSE) for details.

> Your knowledge. Your graph. Your terms.
