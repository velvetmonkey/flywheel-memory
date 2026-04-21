<div align="center">
  <img src="header.png" alt="Flywheel" width="256"/>
  <h1>Flywheel</h1>
  <p><strong>Flywheel turns your Obsidian vault into safe local memory for AI agents.</strong></p>
  <p>Search your notes with real context, write back safely, and keep your Markdown on your machine.</p>
</div>

[![npm version](https://img.shields.io/npm/v/@velvetmonkey/flywheel-memory.svg)](https://www.npmjs.com/package/@velvetmonkey/flywheel-memory)
[![CI](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)

**[Get Started](#get-started)** · **[See It Work](#see-it-work)** · **[What It Does](#what-it-does)** · **[Skills + Flywheel](#skills--flywheel)** · **[Benchmarks](#benchmarks)** · **[Testing](#testing)** · **[Documentation](#documentation)** · **[License](#license)**

Flywheel is a local-first memory layer for AI agents working over Obsidian and plain Markdown. It gives agents grounded search across your notes, safe bounded writes back into the vault, and local indexes that stay on your machine.

Built for people who want AI to work over real notes without handing their vault to a cloud app. Your files stay readable Markdown, semantic search is optional and local, and every write is inspectable and reversible.

- **Grounded search** — find the notes that matter, plus the linked context around them, without making the model trawl through a pile of files.
- **Safe reversible writes** — update a live vault through bounded operations that preserve Markdown structure and can be undone.
- **Local-first by default** — keep your notes on disk, use plain Markdown as the source of truth, and add local semantic search only if you want it.

### Why not raw file access or naive RAG?

Raw file access gives an agent text, not memory. Flywheel adds better ranking across notes, linked context that helps the model stay grounded, and write operations that are bounded enough to trust inside a live vault.

### A 30-second workflow

From the [carter-strategy](demos/carter-strategy/) demo:

1. Ask: *"How much have I billed Acme Corp?"*
2. Flywheel searches the right notes, returns connected context, and answers from the vault.
3. If you want to act on the result, the same session can log follow-ups or update the right note as a visible, bounded change.

---

## Get Started

### Quick start

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

### Your Vault in 2 Minutes

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

Flywheel watches the vault, maintains local indexes, and serves structured context to MCP clients. Your source of truth stays in Markdown. If you delete `.flywheel/state.db`, Flywheel rebuilds from the vault.

### Optional: Tool presets

The `agent` preset (default) provides a focused set of core tools. Use `power` for tier 1+2 (adds wikilinks, corrections, note-ops, schema), `full` to expose the entire tool surface immediately, or `auto` for the full surface plus the informational `discover_tools` helper.

<!-- GENERATED:preset-counts START -->
| Preset | Tools | Categories | Behaviour |
|--------|-------|------------|-----------|
| `agent` (default) | 13 | search, read, write, tasks, memory, diagnostics | Focused tier-1 surface — search, read, write, tasks, memory |
| `power` | 17 | search, read, write, tasks, memory, diagnostics, wikilinks, corrections, note-ops, schema | Tier 1+2 — agent + wikilinks, corrections, note-ops, schema |
| `full` | 19 | search, read, write, tasks, memory, diagnostics, wikilinks, corrections, note-ops, schema, graph, temporal | All categories visible at startup |
| `auto` | 20 | search, read, write, graph, schema, wikilinks, corrections, tasks, memory, note-ops, temporal, diagnostics | Full surface + informational `discover_tools` helper |
<!-- GENERATED:preset-counts END -->

<!-- GENERATED:claude-code-memory-note START -->
> **Claude Code note:** the `memory` merged tool is suppressed under Claude Code
> (`CLAUDECODE=1`) because Claude Code ships its own memory plane. Agent preset
> exposes 12 tools under Claude Code instead of 13;
> the briefing entrypoint still works as `memory(action: "brief")`.
<!-- GENERATED:claude-code-memory-note END -->

Compose bundles for custom configurations:

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-memory"],
      "env": {
        "FLYWHEEL_TOOLS": "agent,graph"
      }
    }
  }
}
```

[Browse all tools ->](docs/TOOLS.md) | [Preset recipes ->](docs/CONFIGURATION.md)

### Multiple vaults

Serve more than one vault from a single Flywheel instance with `FLYWHEEL_VAULTS`:

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-memory"],
      "env": {
        "FLYWHEEL_VAULTS": "personal:/home/you/obsidian/Personal,work:/home/you/obsidian/Work"
      }
    }
  }
}
```

Search automatically spans all vaults and tags each result with its source vault. Each vault keeps separate indexes, graph state, file watchers, and config.

[Full multi-vault configuration ->](docs/CONFIGURATION.md#multi-vault) | [Client setup examples ->](docs/SETUP.md#multi-vault)

<details>
<summary><strong>Windows users</strong></summary>

Three things differ from macOS and Linux:

1. Use **`cmd /c npx`** instead of `npx`. On Windows, `npx` is installed as a `.cmd` script and cannot be spawned directly.
2. Set **`VAULT_PATH`** to your vault's Windows path.
3. Set **`FLYWHEEL_WATCH_POLL: "true"`**. Without polling, Flywheel will not reliably pick up changes made from Obsidian on Windows.

See [docs/CONFIGURATION.md#windows](docs/CONFIGURATION.md#windows) for the full example.
</details>

If you use Cursor, Windsurf, VS Code, OpenClaw, or another client, see [docs/SETUP.md](docs/SETUP.md) for client-specific configuration. For OpenClaw, use the dedicated [OpenClaw integration guide](docs/OPENCLAW.md).

---

## See It Work

### Voice: The learning loop

From the [carter-strategy](demos/carter-strategy/) demo: log a call by voice, watch wikilinks and suggestions appear, accept and reject a few, then log again — the suggestions improve immediately.

https://github.com/user-attachments/assets/cb9e4945-7f0b-410d-85ef-0c42ffc18c6e

https://github.com/user-attachments/assets/bfdae034-6217-426e-bb1d-ff8e2f0d4bc3

https://github.com/user-attachments/assets/4a0635ff-dd73-4fb1-933d-bf384822e2ce

### Write: Auto-wikilinks on mutation

```text
> Log that Stacy reviewed the security checklist before the Beta Corp kickoff

flywheel -> edit_section action=add
  path: "daily-notes/2026-01-04.md"
  section: "Log"
  suggestOutgoingLinks: true
  content: "[[Stacy Thompson|Stacy]] reviewed the [[API Security Checklist|security checklist]]
            before the [[Beta Corp Dashboard|Beta Corp]] kickoff
            -> [[GlobalBank API Audit]], [[Acme Data Migration]]"
```

You type a normal sentence. Flywheel resolves known entities, detects prospective entities (proper nouns, acronyms, CamelCase terms), and adds wikilinks and suggests related links based on aliases, co-occurrence, graph structure, and semantic context. Suggested outgoing links are optional and off by default. Enable them where you want the graph to grow naturally, such as daily notes, meeting logs, or voice capture. [Configuration guide ->](docs/CONFIGURATION.md)

### Boundaries

- Writes happen through visible tool calls.
- Changes stay within the vault unless you explicitly point a tool somewhere else.
- Git commits are opt-in.
- Proactive linking can be disabled.

> **Reproduce it yourself:** The carter-strategy demo includes a [`run-demo-test.sh`](demos/run-demo-test.sh) script that runs the full sequence end to end with `claude -p`, checking tool usage and vault state between steps.

<details>
<summary><strong>Policy example: Search the vault, then act on it</strong></summary>

```text
> Create a policy that finds overdue invoices and logs follow-up tasks in today's daily note

flywheel -> policy action=author
  description: "Find invoices with status:sent, create follow-up task list in daily note"
  ✓ Saved to .flywheel/policies/overdue-invoice-chaser.yaml

> Preview the overdue-invoice-chaser policy

flywheel -> policy action=preview name=overdue-invoice-chaser
  Step 1: vault_search: query "type:invoice status:sent" in invoices/ -> 3 results
  Step 2: edit_section: would append to daily-notes/2026-03-31.md#Tasks
  (no changes made; preview only)

> Execute it

flywheel -> policy action=execute name=overdue-invoice-chaser
  ✓ 2 steps executed, 1 note modified, committed as single git commit
```

Policies search the vault, then write back. Author them in plain language, preview before running, and undo with one call if needed. [Policies guide ->](docs/POLICIES.md) | [Examples ->](docs/POLICY_EXAMPLES.md)

</details>

---

## What It Does

### Search with context

One search call returns enough context for the model to answer grounded questions: frontmatter, section-aware snippets, dates, and linked notes that matter. Keyword search (BM25) handles exact terms. Optional local semantic search helps when the right note is related but not explicitly linked yet. Together they reduce file-hopping and make answers more reliable over a real vault. [How search works ->](docs/ARCHITECTURE.md)

### Write safely

Every mutation is conflict-detected with a SHA-256 content hash and reversible with one undo. Writes preserve Markdown structure, so edits do not corrupt tables, callouts, code blocks, frontmatter, links, comments, or math. Auto-wikilinks stay deterministic and traceable. For one-off edits, use the direct write tools. For repeatable workflows that search the vault and act on the results, use **policies**, saved YAML workflows that branch on vault state, perform live writes, and attempt compensating rollback on failure. [How scoring works ->](docs/ALGORITHM.md) | [Policies guide ->](docs/POLICIES.md)

### Build memory over time

Every accepted link strengthens the graph. Every rejected link updates the scorer. Every write adds more context for the next read. `memory(action: "brief")` assembles a token-budgeted summary of recent activity, and `memory` persists observations with confidence decay. The graph can be exported through `graph(action: "export")` as GraphML for visualization in tools like [Gephi](https://gephi.org) or NetworkX — see the [carter-strategy demo](demos/carter-strategy/) for an example. [Configuration ->](docs/CONFIGURATION.md)

---

## Skills + Flywheel

Skills encode methodology: how to do something. Flywheel encodes knowledge: what you know. They are complementary layers:

| Layer | What it provides | Example |
|---|---|---|
| Skills | Procedures, templates, reasoning frameworks | "How to write a client proposal" |
| Flywheel | Entities, relationships, history, context | "Everything you know about this client" |

An agent calling a proposal-writing skill works better when it can also search your vault for the client's history, past invoices, project notes, and team relationships. Skills tell agents how to work. Flywheel tells them what you know.

[OpenClaw](https://github.com/openclaw) skills and Flywheel connect through MCP. OpenClaw routes intent and manages session flow; Flywheel provides the structured context and safe writes that make responses accurate. [Integration guide ->](docs/OPENCLAW.md)

---

## The Flywheel Suite

Flywheel Memory is the core memory engine. [Flywheel Crank](https://github.com/velvetmonkey/flywheel-crank) is the Obsidian plugin that visualizes the same local graph and workflows. [Flywheel Engine](https://github.com/velvetmonkey/flywheel-engine) is the service layer that calls Flywheel over MCP. Start with Flywheel Memory; add the other layers when you want UI or automation around the same vault.

---

## Benchmarks

[![HotpotQA](https://img.shields.io/badge/HotpotQA-90.0%25%20recall%20(50q)-brightgreen.svg)](docs/TESTING.md#retrieval-benchmark-hotpotqa)
[![LoCoMo](https://img.shields.io/badge/LoCoMo-81.9%25%20evidence%20recall%20(695q)-blue.svg)](docs/TESTING.md#retrieval-benchmark-locomo)

Agent-first tools should prove their claims. Flywheel ships with reproducible benchmarks against academic retrieval standards:

- **HotpotQA full end to end:** **90.0% document recall** on **50 questions / 4,960 docs**. Latest artifact: **April 10, 2026**. Cost in that run: **$0.083/question**.
- **LoCoMo full end to end:** **81.9% evidence recall** and **54.0% answer accuracy** on **695 scored questions / 272 sessions**. Latest artifact: **April 10, 2026**. Final token F1: **0.431**.
- **LoCoMo unit retrieval:** **84.8% Recall@5** and **90.4% Recall@10** on the full non-adversarial retrieval set.

Every number below ties back to a checked-in report or reproducible harness in the repo.

**Multi-hop retrieval vs. academic baselines** (HotpotQA, 500 questions, 4,960 documents):

| System | Recall | Training data |
|---|---|---|
| BM25 baseline | ~75% | None |
| [TF-IDF + Entity](https://arxiv.org/abs/1809.09600) | ~80% | None |
| [Baleen](https://arxiv.org/abs/2101.00436) (Stanford) | ~85% | HotpotQA |
| [MDR](https://arxiv.org/abs/2009.12756) (Facebook) | ~88% | HotpotQA |
| **Flywheel** | **90.0%** | **None** |
| [Beam Retrieval](https://arxiv.org/abs/2308.08973) | ~93% | End-to-end |

**Conversational memory retrieval** ([LoCoMo](https://snap-research.github.io/locomo/), 1,531 scored retrieval queries, 272 session notes):

| Category | Recall@5 | Recall@10 |
|---|---|---|
| **Overall** | **84.8%** | **90.4%** |
| Single-hop | 88.1% | 91.7% |
| Commonsense | 95.4% | 98.3% |
| Multi-hop | 58.1% | 72.7% |
| Temporal | 56.9% | 67.4% |

E2E with Claude Sonnet (latest checked-in 695-question run): **97.4%** single-hop evidence recall, **73.7%** multi-hop evidence recall, **81.9%** overall evidence recall, and **54.0%** answer accuracy (Claude Haiku judge). [Full methodology and caveats ->](docs/TESTING.md#retrieval-benchmark-locomo)

> **Directional, not apples-to-apples.** Test settings, sample sizes, retrieval pools, and metrics differ. Flywheel searches 4,960 pooled docs, which is harder than the standard HotpotQA distractor setting of 10 docs and much smaller than fullwiki. Academic retrievers are trained on the benchmark; Flywheel uses no benchmark training data. Expect about 1 percentage point of run-to-run variance from LLM non-determinism. [Full caveats ->](docs/TESTING.md#retrieval-benchmark-hotpotqa)

[`demos/hotpotqa/`](demos/hotpotqa/) · [`demos/locomo/`](demos/locomo/) · [Full methodology ->](docs/TESTING.md)

---

## Testing

3,292 defined tests across 185 test files and about 64.4k lines of test code. CI runs focused jobs on Ubuntu, plus a full matrix on Ubuntu and Windows across Node 22 and 24.

- **Graph quality:** Latest generated report shows balanced-mode **50.6% precision / 66.7% recall / 57.6% F1** on the primary synthetic vault, along with multi-generation, archetype, chaos, and regression coverage. [Report ->](docs/QUALITY_REPORT.md)
- **Live AI testing:** Real `claude -p` sessions verify tool adoption end to end, not just handler logic.
- **Write safety:** Git-backed conflict detection, compensating rollback for policy failures, and 100 parallel writes with zero corruption in the checked-in test suite.
- **Security:** Coverage includes SQL injection, path traversal, Unicode normalization, and permission bypass cases.

[Full methodology and results ->](docs/TESTING.md)

---

## Documentation

| Doc | Why read it |
|---|---|
| [PROVE-IT.md](docs/PROVE-IT.md) | Start here to see the project working quickly |
| [TOOLS.md](docs/TOOLS.md) | Full tool reference |
| [COOKBOOK.md](docs/COOKBOOK.md) | Example prompts by use case |
| [SETUP.md](docs/SETUP.md) | Full setup guide for your vault |
| [CONFIGURATION.md](docs/CONFIGURATION.md) | Environment variables, presets, and custom tool sets |
| [ALGORITHM.md](docs/ALGORITHM.md) | Link scoring and search ranking details |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Indexing, graph, and auto-wikilink design |
| [TESTING.md](docs/TESTING.md) | Benchmarks, methodology, and test coverage |
| [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Diagnostics and recovery |
| [SHARING.md](docs/SHARING.md) | Privacy notes, tracked data, and shareable stats |
| [VISION.md](docs/VISION.md) | Project direction and longer-term goals |

## License

Apache-2.0. See [LICENSE](./LICENSE) for details.
