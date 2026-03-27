<div align="center">
  <img src="header.png" alt="Flywheel" width="256"/>
  <h1>Flywheel</h1>
  <p><strong>MCP tools that search, write, and auto-link your Obsidian vault — and learn from your edits.</strong><br/>
  All local. All yours. A few lines of config.</p>
</div>

**Search** — Ask a question, get a decision surface. One call returns section provenance, extracted dates, entity bridges, and confidence scores. Your AI decides what to read next without opening any files. [$0.06-0.09/query](#benchmarked), measured.

**Write** — Every mutation auto-links entities across your vault. Voice dump a meeting debrief, Flywheel recognises names, projects, and relationships and wikilinks them in real time. [13 scoring layers](docs/ALGORITHM.md), zero manual curation.

**Remember** — The system learns from your edits. Links you keep get stronger. Links you remove get suppressed. After a week, suggestions reflect how *you* think, not how the algorithm was configured. The graph compounds with use.

All local. No cloud. No account. No sync.

[![npm version](https://img.shields.io/npm/v/@velvetmonkey/flywheel-memory.svg)](https://www.npmjs.com/package/@velvetmonkey/flywheel-memory)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blueviolet.svg)](https://modelcontextprotocol.io/)
[![CI](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Clients](https://img.shields.io/badge/clients-Claude%20Code%20%7C%20Desktop%20%7C%20Cursor%20%7C%20Windsurf%20%7C%20VS%20Code%20%7C%20OpenClaw-blue.svg)](docs/SETUP.md)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue.svg)](https://github.com/velvetmonkey/flywheel-memory)
[![HotpotQA](https://img.shields.io/badge/HotpotQA-91.7%25%20recall%20(500q)-brightgreen.svg)](docs/TESTING.md#retrieval-benchmark-hotpotqa)
[![LoCoMo](https://img.shields.io/badge/LoCoMo-65%25%20single--hop%20%7C%2085%25%20recall%20(759q)-blue.svg)](docs/TESTING.md#retrieval-benchmark-locomo)
[![Cost](https://img.shields.io/badge/cost-%240.06--0.09%2Fquery-green.svg)](docs/TESTING.md#how-the-e2e-benchmark-works)
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
| Tokens per question | Read 10-50 files to find context (~50-200k tokens) | One search returns metadata + graph context (~2-5k tokens). [$0.06-0.09/query](#benchmarked) measured |
| "What's overdue?" | Read every file | Structured task queries with due dates, tags, and path filters |
| "What links here?" | Grep the vault, flat list | Weighted backlinks + outlinks, ranked by edge strength and recency |
| "Add a meeting note" | Raw write, no linking | Structured mutations that auto-link entities and densify the graph |
| "What should I link?" | Not possible | 13-layer scoring engine + semantic search |
| Your graph | Owned by the platform | Yours to [export](https://en.wikipedia.org/wiki/GraphML), analyse, or delete |
| Tool calls | Hidden behind abstractions | Traceable, auditable, opt-in git commits |

</details>

### Who this is for

**For** people who want control over their knowledge: developers, researchers, solo operators, and anyone who treats their notes as infrastructure, not disposable input. Every conversation you have with a cloud AI builds a cognitive profile of you that you don't own, can't export, and can't delete. Flywheel keeps that profile local. The people who use AI the most [want more control, not less](https://x.com/AnthropicAI/status/2036499691571953848). Also works as persistent memory for bots and agents — memory tools are included in the default preset, including [OpenClaw](https://github.com/openclaw/openclaw), where it replaces default amnesiac file access with graph-aware, learning memory.

**Not for** people who want a hosted service. Flywheel runs on your machine, on your files. If you want cloud-managed knowledge, this isn't it.

---

## See It Work

### Read: "How much have I billed Acme Corp?"

From the [carter-strategy](demos/carter-strategy/) demo: a solo consultant with 3 clients, 5 projects, and $27K in invoices.

<video src="https://github.com/user-attachments/assets/ec1b51a7-cb30-4c49-a35f-aa82c31ec976" autoplay loop muted playsinline width="100%"></video>

One search call returned everything: metadata (frontmatter) with amounts and status, backlink lists, outlink lists. Zero file reads needed. The graph did the joining, not the AI reading files one by one.

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

## What Makes Flywheel Different

### 1. Enriched Search

Most search tools return a list of matches and leave the AI to figure out which ones matter. Flywheel returns a **decision surface**: every result includes section provenance (where in the note), pre-extracted dates (when it happened), entity bridges (what it connects to), and confidence scores (whether it's worth reading). One search call replaces what would otherwise be 5–10 follow-up reads.

Results are multi-hop: a search for "Acme Corp" returns the client note *and* its connected invoices, projects, and people, each ranked by graph relevance. Frontmatter, scored backlinks, scored outlinks, content snippets — all from an in-memory index, zero file reads.

With semantic embeddings enabled, "login security" finds notes about authentication without that exact keyword. Everything runs locally. SQLite full-text search (BM25), in-memory embeddings for semantic similarity, fused together for best-of-both results.

### 2. Every Link Has a Reason

Those `→` suggestions aren't random. Ask why Flywheel suggested `Marcus Johnson`:

```
Entity              Score  Match  Co-oc  Type  Context  Recency  Cross  Hub  Feedback  Semantic  Edge
---------------------------------------------------------------------------------------------------
Marcus Johnson        34    +10     +3    +5     +5       +5      +3    +1     +2         0       0
```

13 scoring layers, every number traceable to vault usage. Recency from what you last wrote. Co-occurrence from notes you've written before. Hub score from eigenvector centrality (not just how many notes link there, but how important those linking notes are). The score learns as you use it.

See [docs/ALGORITHM.md](docs/ALGORITHM.md) for how scoring works.

### 3. Use It and It Gets Smarter

Every sentence you write through Flywheel makes your graph denser. A denser graph gives better search results, richer backlinks, and sharper suggestions. That's the flywheel.

- **Proactive linking:** edit a note in Obsidian and Flywheel links it in the background. The file watcher scores every unlinked entity mention and inserts wikilinks that clear the threshold (score ≥ 20, max 5 per file, max 10 per day). Your graph grows while you write. Tune the thresholds via the `flywheel_config` tool, or disable it entirely.
- **Co-occurrence** builds over time. Two entities appearing in 20 notes form a statistical bond
- **Edge weights** accumulate. Links that survive edits gain influence
- **Suppression** learns. When you delete a wikilink Flywheel inserted, it notices. Remove the same link enough times and Flywheel stops suggesting it - no manual configuration needed

Static tools give you the same results on day 1 and day 100. Flywheel's suggestions on day 100 are informed by everything you've written and edited since day 1. No retraining, no configuration, no manual curation. This isn't a claim - it's [measured](docs/TESTING.md#graph-quality-266-tests-31-files): 266 graph quality tests track F1 across 6 vault archetypes, a [50-generation stress test](docs/TESTING.md#multi-generation-stress-test) proves F1 doesn't collapse under 15% hostile feedback, and CI fails if any metric regresses more than 5pp.

#### What the system tracks

All learning data lives in a local SQLite database (`.flywheel/state.db`) on your machine. There are no network calls, no telemetry, no analytics — [enforced by CI](SECURITY.md). The system records which auto-links you keep or remove (feedback), which entities appear together across notes (co-occurrence), how link weights evolve over time (edge weights), and which entities get auto-suppressed after repeated removal (suppression). This is how scoring improves: real usage, measured locally.

None of this data leaves your machine unless you choose to share it. The `flywheel_calibration_export` tool produces a fully anonymized aggregate snapshot — vault size buckets (not exact counts), entity distribution by category (not names), survival rates, layer contributions, score distributions. No entity names, no note paths, no content. If you want to help tune scoring defaults across different vault sizes and styles, you can paste your export in the [Calibration Data](https://github.com/velvetmonkey/flywheel-memory/discussions/categories/calibration-data) discussion category. See [docs/SHARING.md](docs/SHARING.md) for what's safe to share and what isn't.

### 4. Agentic Memory & Policies

Your AI knows what you were working on yesterday without re-explaining it. `brief` delivers startup context, `search` retrieves across notes, entities (people, projects, concepts), and memories in one call, and `memory` stores observations that persist across sessions with automatic decay. Every result is structured for machine consumption — a decision surface, not a text dump.

Complex vault workflows become deterministic policies. Describe what you want, the AI authors the YAML, and you can execute it on demand. All steps succeed or all roll back. Commit with one flag - a single git commit covering every step.

Most agent frameworks solve the trust problem through containment: sandboxing arbitrary code in isolates or containers. Flywheel solves it through constraint: policies can only express vault operations, every step is auditable, and the entire execution can be committed as a single reversible git commit. No sandbox needed when the language itself can't do anything dangerous.

Under the hood, every write operation uses structured parsing - AST for protected-zone detection, gray-matter for frontmatter, heading-aware section targeting - not blind string replacement. Flywheel understands headings, frontmatter, lists, and code blocks as structure. Mutations target specific sections without corrupting surrounding content, even in complex documents. Safe writes aren't a promise. They're a property of the parser.

### 5. Portable Knowledge Graph

One call to `export_graph` and your entire vault (or any entity's neighborhood) becomes a [GraphML](https://en.wikipedia.org/wiki/GraphML) file. Open it in any graph tool, run community detection, find bottlenecks, or just see what's connected to what.

![Acme Corp ego network](demos/carter-strategy/carter-strategy-acme-graph.png)

*"Show me everything connected to Acme Corp." One call: `export_graph({ center_entity: "Acme Corp" })`. Sarah Mitchell is the single contact linking 3 projects to the client. The Data Migration Playbook bridges two engagements. Seven invoices, two team members, one proposal. All from plain markdown. [Try it yourself →](demos/carter-strategy/carter-strategy-acme.graphml)*

### 6. System Guarantees

These are rules, not preferences:

- **No surprise writes.** Tool-initiated mutations require explicit calls. Proactive linking (the only background write) is auditable (score-thresholded, configurable, tracked in state.db) and can be disabled entirely.
- **No hidden tool execution.** Every tool call is visible, scoped, and logged.
- **No required cloud dependency.** Core indexing, search, and graph run locally. No account, no sync, no phone-home.
- **All actions are auditable.** Every write can be a git commit - one parameter. Every change is reversible. Every change has a reason.
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

Two standard academic benchmarks. Reproducible: clone the repo, run the scripts, get the same numbers.

**How it works:** The benchmark builds a vault from the dataset, pre-warms it (index + auto-link + embeddings - same as production), then runs each question as an independent Claude session with Flywheel MCP tools. No cherry-picking, no prompt engineering. [Full methodology →](docs/TESTING.md#how-the-e2e-benchmark-works) | [`demos/hotpotqa/`](demos/hotpotqa/) | [`demos/locomo/`](demos/locomo/)

### Compared to other systems

> **⚠️ These comparisons are not controlled experiments.** Different systems use different document representations, different LLM judges, different prompts, and different vault structures. We run the same benchmark datasets and report honestly, but treat these as directional indicators - not head-to-head results. The numbers reproduce if you clone the repo and run them yourself.

**Conversational memory** ([LoCoMo](https://snap-research.github.io/locomo/), 759 questions):

| System | Single-hop | Multi-hop | Questions | Judge | Cost/question | Infrastructure |
|---|---|---|---|---|---|---|
| **Flywheel** | **65.4%** | **28.3%** | 759 | Claude Haiku | **$0.085** | Local SQLite + markdown |
| [Mem0](https://mem0.ai/) | 38.7 | 28.6 | 695 | GPT-4o | ~$0.30-0.50* | Redis + Qdrant |
| [Zep](https://getzep.com/) | 35.7 | 19.4 | 695 | GPT-4o | ~$0.30-0.50* | Cloud service |
| [LangMem](https://github.com/langchain-ai/langmem) | 35.5 | 26.0 | 695 | GPT-4o | ~$0.30-0.50* | Varies |
| [Letta](https://memgpt.ai/) | 26.7 | - | 695 | GPT-4o | ~$0.30-0.50* | Cloud/local |

\* Competitor costs are estimates based on GPT-4o pricing ($2.50/1M input, $10/1M output) for answer generation + judging. Actual costs not disclosed. Flywheel uses Claude Sonnet for answers + Claude Haiku for judging, roughly 3-5x cheaper per token for the judge step. Infrastructure costs (Redis, Qdrant, cloud hosting) are additional.

**Document retrieval** ([HotpotQA](https://hotpotqa.github.io/), 500 questions):

| System | Type | Recall@5 | Docs | Cost/question | Training |
|---|---|---|---|---|---|
| **Flywheel** | General-purpose MCP tool | **91.7%** | 4,960 | **$0.058** | None |
| [MDR](https://arxiv.org/abs/2009.12756) | Trained retriever | ~88% | 5M+ Wikipedia | N/A (inference only) | Trained on HotpotQA |
| [Baleen](https://arxiv.org/abs/2101.00436) | Trained retriever | ~85% | 5M+ Wikipedia | N/A (inference only) | Trained on HotpotQA |
| BM25 baseline | Industry-standard IR | ~70-75% | Varies | Negligible | None |

**What's comparable and what isn't:**

- **LoCoMo sample size differs.** Flywheel uses 759 questions; competitors use 695. Both are stratified samples from the same 1,986-question dataset. Competitor numbers from the [Mem0 paper](https://arxiv.org/abs/2504.19413).
- **LoCoMo judge model differs.** We use Claude Haiku; competitors use GPT-4o. Different judges may score differently. We haven't measured inter-judge agreement.
- **LoCoMo document pool differs.** Flywheel searches 272 markdown session notes. Competitors may chunk, summarise, or embed conversations differently - their document representations aren't published.
- **LoCoMo prompt differs.** Our agent uses a minimal system prompt with the `default` tool preset. Competitor prompt strategies aren't published.
- **HotpotQA is not a fair comparison.** MDR and Baleen were trained on HotpotQA specifically and search 5M+ Wikipedia articles. Flywheel is a general-purpose tool with zero training, searching a 4,960-document vault. The comparison shows where untrained retrieval sits relative to specialised systems - not that we "beat" them.

### Full LoCoMo results (759 questions)

| Category | Evidence Recall | Answer Accuracy | 95% CI | Questions |
|---|---|---|---|---|
| Commonsense | 94.2% | 75.6% | [70.5%, 80.0%] | 311 |
| Single-hop | 93.9% | 65.4% | [56.9%, 73.0%] | 130 |
| Adversarial | 96.0% | 46.8% | [39.5%, 54.2%] | 173 |
| Temporal | 63.3% | 40.6% | [25.5%, 57.7%] | 32 |
| Multi-hop | 67.5% | 28.3% | [20.8%, 37.2%] | 113 |
| **Overall** | **84.9%** | **58.8%** | **[55.2%, 62.2%]** | **759** |

Evidence recall = did the system find the right source notes. Answer accuracy = did it give the correct answer (LLM-as-judge, Claude Haiku). The vault is pre-warmed with auto-linking and embeddings before questions run - [how it works →](docs/TESTING.md#how-the-e2e-benchmark-works) · Reproduce: `demos/locomo/run-benchmark.sh`

Flywheel controls retrieval; the model controls comprehension. Evidence recall is ours — did we find the right documents? Answer accuracy is the model's — did it understand what it found? These are deliberately separate metrics. When models improve, answer accuracy goes up without changing a line of Flywheel code.

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

I've been writing code for over 30 years and tried every PKM tool going before landing on Obsidian. Flywheel is my third attempt at wiring AI into my knowledge vault. The first two failed because writes were non-deterministic and context didn't flow between sessions. This version unifies everything: one server with deterministic mutations, hybrid search, and a graph that compounds with use. The [[Architecture]] exists because I kept hitting the same walls and refusing to stop.

Your attention, memory, and even the way you reason are increasingly shaped by systems you didn't choose. Platforms that optimise for engagement, models trained on someone else's priorities, defaults that quietly steer how you organise what you know. I wanted a knowledge layer that works for the person using it. A system that only gets smarter from your own honest engagement is fundamentally different from one that optimises for someone else's metrics.

The entire codebase was built through Claude Code with Opus 4.5 and 4.6. I designed the architecture and made every decision, but I haven't read every line 🫠 I've got bills to pay. It's been through extensive code reviews and testing, but verify what matters to you.

I dogfood it daily through a Telegram bot using voice input. The volume of knowledge you can accumulate at speed through voice is staggering - even quiet days produce 20–30 links where they used to be 3–5. Flywheel exists partly because I needed something that could keep up. All suggestions are welcome! I'm looking for people who care about this space.

### The Cognitive Pipeline

What emerged from daily use is a workflow pattern: cheap models generate ideas at volume (Grok, ChatGPT — whatever's free), the Telegram bot filters for truth and persists to the vault, then a separate Claude Code session reads the stored context and executes from filtered material. Generate broadly, filter honestly, execute precisely.

It works because Flywheel makes every stage persistent. The bot's conversation is logged and auto-wikilinked. The filter's judgements become searchable memories. The executor reads yesterday's daily notes and picks up where the last session left off — no re-explaining, no context dump, no starting from scratch.

Because Flywheel is an MCP server, any client can be any stage. An OpenClaw bot, a Cursor session, Claude Desktop — they all get the same persistent, learning memory. The graph compounds across sessions. Your filing cabinet stops being passive storage and starts thinking with you.

To contribute back to Obsidian I'm also building [Flywheel Crank](https://github.com/velvetmonkey/flywheel-crank) (early days), an Obsidian plugin that surfaces suggestions, graph visibility, and management tools directly in the editor.

---

## License

**AGPL-3.0.** The architecture keeps your data local. The license keeps the code open. Together, they ensure no one can turn your knowledge graph into a closed product.

Every AI platform is building memory as a retention moat: your cognitive profile, packaged as a subscription you can't leave. AGPL means no one can fork Flywheel and do the same. Derivatives stay open. Your data stays yours.

Using Flywheel internally at your company? AGPL permits that. Network distribution triggers source disclosure, not internal use. Need a commercial license? [Get in touch](https://x.com/thevelvetmonke).

See [LICENSE](./LICENSE) for details.

> Your knowledge. Your graph. Your terms.
>
> *If you can keep your head when all about you are losing theirs...* -- Kipling
