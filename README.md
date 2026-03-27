<div align="center">
  <img src="header.png" alt="Flywheel" width="256"/>
  <h1>Flywheel</h1>
  <p><strong>Persistent, learning AI memory for your Obsidian vault.</strong><br/>
  All local. 60 seconds to install.</p>

[![npm version](https://img.shields.io/npm/v/@velvetmonkey/flywheel-memory.svg)](https://www.npmjs.com/package/@velvetmonkey/flywheel-memory)
[![CI](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Tests](https://img.shields.io/badge/tests-2,712%20passed-brightgreen.svg)](docs/TESTING.md)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blueviolet.svg)](https://modelcontextprotocol.io/)
[![Clients](https://img.shields.io/badge/clients-Claude%20Code%20%7C%20Cursor%20%7C%20Windsurf%20%7C%20VS%20Code%20%7C%20OpenClaw-blue.svg)](docs/SETUP.md)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue.svg)](https://github.com/velvetmonkey/flywheel-memory)
</div>

**[Get started](#try-it)** · **[See it work](#see-it-work)** · **[What's different](#what-makes-flywheel-different)** · **[Benchmarked](#benchmarked)** · **[Docs](#documentation)** · **[Story](#the-story-behind-this)**

**Search** — Ask a question, get an answer — not a list of files to open. One call returns structured results with metadata, graph context, and section content. Your AI reasons across your vault without reading files one by one. [$0.06-0.10/query](#benchmarked), measured.

**Write** — Every mutation auto-links entities across your vault. Voice dump a meeting debrief — Flywheel recognizes names, projects, and relationships and wikilinks them automatically. Zero manual curation.

**Remember** — Your AI knows what you were working on yesterday without re-explaining it. Links you keep get stronger. Links you remove get suppressed. After a week, suggestions reflect how *you* think, not defaults. The graph compounds with use.

All local. No cloud. No account. No sync.

---

## See It Work

### "How much have I billed Acme Corp?"

From the [carter-strategy](demos/carter-strategy/) demo: a solo consultant with 3 clients, 5 projects, and $27K in invoices.

<video src="https://github.com/user-attachments/assets/ec1b51a7-cb30-4c49-a35f-aa82c31ec976" autoplay loop muted playsinline width="100%"></video>

*One search call answered a multi-file question — metadata, graph context, and section content. No file reads needed. The graph did the joining, not the AI reading files one by one.*

### Auto-wikilinks on every mutation

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

You typed a plain sentence. Flywheel recognized three entities and linked them — names, aliases, and fuzzy matches, scored and [explainable](docs/ALGORITHM.md). Links you keep strengthen future scoring; links you edit out get suppressed. The system learns.

`→` suggestions are off by default. Enable with `suggestOutgoingLinks: true` for daily notes, meeting logs, and voice capture. [Configuration guide →](docs/CONFIGURATION.md)

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

> Nothing leaves your machine. Nothing writes unless you ask. Every change is a reversible git commit.

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

Requires Node.js 22+ and an MCP client: [Claude Code](https://claude.ai/code), [Cursor](https://cursor.sh), [Windsurf](https://windsurf.com), [OpenClaw](https://github.com/openclaw/openclaw), or [others](docs/SETUP.md).

Flywheel runs alongside Obsidian as a background index. No proprietary format, no cloud sync, no account. Delete `.flywheel/state.db` and it rebuilds from scratch.

### Try a demo vault

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

[See all 7 demos →](demos/)

### Configure your tools

18 tools by default. Add bundles as you need them: `graph`, `schema`, `wikilinks`, `temporal`, `diagnostics`. [Browse all 75 tools →](docs/TOOLS.md)

```json
{ "env": { "FLYWHEEL_TOOLS": "default,graph" } }
```

<details>
<summary><strong>Windows users - read this before you start</strong></summary>

Three things differ from macOS/Linux:
1. **`cmd /c npx`** instead of `npx`: Windows installs npx as a `.cmd` batch script that can't be spawned directly
2. **`VAULT_PATH`**: set this to your vault's Windows path
3. **`FLYWHEEL_WATCH_POLL: "true"`**: **required**. Without this, Flywheel won't pick up changes you make in Obsidian.

See [docs/CONFIGURATION.md#windows](docs/CONFIGURATION.md#windows) for the full config example.
</details>

---

## What Makes Flywheel Different

### Every link has a reason

Suggestions aren't random. Every suggestion is scored across multiple dimensions — match quality, co-occurrence, recency, context, and more. Ask why any link was suggested and get a traceable breakdown. [How scoring works →](docs/ALGORITHM.md)

### The flywheel effect

Every sentence you write through Flywheel makes your graph denser. A denser graph gives better search results, richer backlinks, and sharper suggestions. That's the flywheel.

- **Proactive linking:** edit a note in Obsidian and Flywheel links it in the background. Tune thresholds or disable entirely.
- **Co-occurrence** builds over time. Edge weights accumulate. Links that survive edits gain influence.
- **Suppression** learns. Delete a wikilink Flywheel inserted and it notices. Remove the same link enough times and Flywheel stops suggesting it — no manual configuration needed.

Static tools give you the same results on day 1 and day 100. Flywheel's suggestions on day 100 are informed by everything you've written and edited since day 1. This is [measured](docs/TESTING.md#graph-quality-266-tests-31-files), not a claim — CI fails if any metric regresses.

All learning data is local SQLite. No telemetry. [What's tracked →](docs/SHARING.md)

### Agentic policies

Complex vault workflows become deterministic YAML policies. All steps succeed or all roll back. Commit with one flag — a single git commit covering every step. Every write uses structured parsing that understands your document's headings, frontmatter, and code blocks. [Architecture →](docs/ARCHITECTURE.md)

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

**91.7% retrieval recall** on [HotpotQA](https://hotpotqa.github.io/) — 500 hard multi-hop questions across 4,960 documents. Zero training data. $0.06/question. 2-8ms search.

Flywheel controls retrieval — did we find the right documents? The model controls comprehension. Every number is reproducible: clone the repo, run the scripts, get the same numbers.

**Retrieval vs. academic baselines** (HotpotQA, 500 questions):

| System | Type | Recall | Training data |
|---|---|---|---|
| BM25 baseline | IR | ~75% | None |
| [TF-IDF + Entity](https://arxiv.org/abs/1809.09600) | IR | ~80% | None |
| [Baleen](https://arxiv.org/abs/2101.00436) (Stanford) | Trained retriever | ~85% | HotpotQA |
| [MDR](https://arxiv.org/abs/2009.12756) (Facebook) | Trained retriever | ~88% | HotpotQA |
| **Flywheel** | **MCP vault tool** | **91.7%** | **None** |
| [Beam Retrieval](https://arxiv.org/abs/2308.08973) | Trained retriever | ~93% | End-to-end |

Not apples-to-apples — different test settings, sample sizes, and retrieval pools. [Full caveats →](docs/TESTING.md#retrieval-benchmark-hotpotqa)

**Conversational memory** ([LoCoMo](https://snap-research.github.io/locomo/), 695 questions): **95.5%** single-hop recall, **65.3%** multi-hop, **79.1%** evidence recall overall. $0.095/question. No other MCP memory tool publishes retrieval benchmarks on a standard academic dataset. [LoCoMo details →](docs/TESTING.md#retrieval-benchmark-locomo) | [`demos/hotpotqa/`](demos/hotpotqa/) | [`demos/locomo/`](demos/locomo/)

| Metric | Measured |
|---|---|
| Tests | 2,712 across 129 files |
| Search latency | 2-8ms (FTS5), 10-30ms (hybrid) |
| Wikilink precision | 100% on ground truth vault, 50 generations |
| Write safety | 100 parallel writes, zero corruption |
| Security | SQL injection, path traversal, Unicode normalization |
| CI | 12 jobs, Ubuntu + Windows, Node 22 + 24 |

[Full methodology →](docs/TESTING.md) · [Graph quality report →](docs/QUALITY_REPORT.md)

---

## Who this is for

**For** developers building AI agents and assistants that need persistent memory. Works as the memory backend for [OpenClaw](https://github.com/openclaw/openclaw) and any MCP client. Also for anyone who treats their Obsidian vault as infrastructure, not disposable notes.

**Not for** people who want a hosted service. Flywheel runs on your machine, on your files.

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
| [BENCHMARKS.md](docs/BENCHMARKS.md) | Performance characteristics and scaling |
| [POLICY_EXAMPLES.md](docs/POLICY_EXAMPLES.md) | Ready-to-run policy YAML examples |
| [QUALITY_REPORT.md](docs/QUALITY_REPORT.md) | Graph quality metrics and regression tracking |
| [VISION.md](docs/VISION.md) | Where this is going |

Common questions — data privacy, scale, safety, cost: [FAQ →](docs/README.md#faq)

---

## The Story Behind This

Flywheel started because I'm fundamentally lazy. I wanted to talk at my vault through a Telegram bot and have it not be rubbish — no typing, no manual linking, no curation. The lazy path needed to be the correct path, so I built a system where they're the same path.

This is my third attempt at wiring AI into a knowledge vault. The first two failed because writes were non-deterministic and context didn't flow between sessions. This version unifies everything: one server with deterministic mutations, hybrid search, and a graph that compounds with use.

Built through Claude Code — I designed the architecture and made every decision. 2,712 tests across 2 platforms verify it works. As always, check what matters to you.

I dogfood it daily through a Telegram bot using voice input. Even quiet days produce 20–30 links where they used to be 3–5. All suggestions are welcome — I'm looking for people who care about this space. The full story and vision: [VISION.md](docs/VISION.md)

To contribute back to Obsidian I'm also building [Flywheel Crank](https://github.com/velvetmonkey/flywheel-crank) (early days), an Obsidian plugin that surfaces suggestions, graph visibility, and management tools directly in the editor.

---

## License

Apache-2.0. See [LICENSE](./LICENSE) for details.

> Your knowledge. Your graph. Your terms.

**[Get started in 60 seconds.](#try-it)**
