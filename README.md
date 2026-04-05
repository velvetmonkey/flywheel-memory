<div align="center">
  <img src="header.png" alt="Flywheel" width="256"/>
  <h1>Flywheel</h1>
  <p><strong>Flywheel turns an Obsidian vault into a local MCP workspace for AI agents: fast to query and safe to write.</strong></p>
</div>

[![npm version](https://img.shields.io/npm/v/@velvetmonkey/flywheel-memory.svg)](https://www.npmjs.com/package/@velvetmonkey/flywheel-memory)
[![CI](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![HotpotQA](https://img.shields.io/badge/HotpotQA-92.4%25%20recall%20(500q)-brightgreen.svg)](docs/TESTING.md#retrieval-benchmark-hotpotqa)
[![LoCoMo](https://img.shields.io/badge/LoCoMo-84.3%25%20evidence%20recall%20(695q)-blue.svg)](docs/TESTING.md#retrieval-benchmark-locomo)

> **Part of the Flywheel suite** &mdash; Flywheel Memory is the MCP server. [**Flywheel Crank**](https://github.com/velvetmonkey/flywheel-crank) is the Obsidian plugin that visualizes it.

**[What It Does](#what-it-does)** · **[See It Work](#see-it-work)** · **[Skills + Flywheel](#skills--flywheel)** · **[Get Started](#get-started)** · **[Benchmarks](#benchmarks)** · **[Testing](#testing)** · **[Documentation](#documentation)** · **[License](#license)**

Flywheel is a local MCP server that gives AI agents structured access to an Obsidian vault. Search returns a *decision surface* with frontmatter, scored backlinks and outlinks, snippets with section context, dates, entity bridges, and confidence. In many cases that is enough context to answer without opening a chain of files. Writes are git-committed, conflict-detected, and reversible. Auto-wikilinks use a deterministic scoring algorithm, and every suggestion has a traceable receipt.

Everything runs on your machine. Nothing leaves your disk. Every action is bounded, inspectable, and reversible.

---

## What It Does

### Search your vault

One call returns everything the model needs to answer: frontmatter, scored backlinks and outlinks, snippets with section context, dates, entity bridges, and confidence. Under the hood, entities give the system stable identity, the graph gives it load-bearing structure, and semantic search bridges the gaps when meaning exists without an explicit link. Keyword search (BM25) finds what you said. Semantic search finds what you meant. Both are fused via Reciprocal Rank Fusion, running locally. [How search works ->](docs/ARCHITECTURE.md)

### Write safely

Every mutation is git-committed, conflict-detected with a SHA-256 content hash, and reversible with one undo. Writes preserve markdown structure, so edits do not corrupt tables, callouts, code blocks, frontmatter, links, comments, or math. Auto-wikilinks use a deterministic 13-layer scoring algorithm where every suggestion has a traceable receipt. For one-off edits, use the direct write tools. For repeatable workflows that search the vault and act on the results, use **policies**, which are saved YAML workflows that branch on vault state and run multiple write steps as a single atomic operation. [How scoring works ->](docs/ALGORITHM.md) | [Policies guide ->](docs/POLICIES.md)

### Build context over time

Every accepted link strengthens the graph. Every rejected link updates the scorer. Every write adds more context for the next read. `brief` assembles a token-budgeted summary of recent activity, and `memory` persists observations with confidence decay. The graph can be exported as GraphML for visualization in tools like [Gephi](https://gephi.org) or NetworkX — see the [carter-strategy demo](demos/carter-strategy/) for an example. [Configuration ->](docs/CONFIGURATION.md)

---

## See It Work

### Voice: The learning loop

From the [carter-strategy](demos/carter-strategy/) demo: log a call by voice, watch wikilinks and suggestions appear, accept and reject a few, then log again — the suggestions improve immediately.

https://github.com/user-attachments/assets/bfdae034-6217-426e-bb1d-ff8e2f0d4bc3

https://github.com/user-attachments/assets/4a0635ff-dd73-4fb1-933d-bf384822e2ce

### Write: Auto-wikilinks on mutation

```text
> Log that Stacy reviewed the security checklist before the Beta Corp kickoff

flywheel -> vault_add_to_section
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
  Step 2: vault_add_to_section: would append to daily-notes/2026-03-31.md#Tasks
  (no changes made; preview only)

> Execute it

flywheel -> policy action=execute name=overdue-invoice-chaser
  ✓ 2 steps executed, 1 note modified, committed as single git commit
```

Policies search the vault, then write back. Author them in plain language, preview before running, and undo with one call if needed. [Policies guide ->](docs/POLICIES.md) | [Examples ->](docs/POLICY_EXAMPLES.md)

</details>

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

Flywheel watches the vault, maintains local indexes, and serves the graph to MCP clients. Your source of truth stays in markdown. If you delete `.flywheel/state.db`, Flywheel rebuilds from the vault.

### Tool presets

The `agent` preset (default) provides a focused set of core tools. Use `full` to expose the entire tool surface immediately, or `auto` for progressive disclosure via `discover_tools`.

| Preset | Behaviour |
|--------|-----------|
| `agent` (default) | Fixed set: search, read, write, tasks, memory |
| `full` | All tools visible at startup |
| `auto` | Progressive disclosure across the full surface |

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

## Benchmarks

Agent-first tools should prove their claims. Flywheel ships with reproducible benchmarks against academic retrieval standards:

- **HotpotQA full end to end:** **92.4% document recall** on **500 questions / 4,960 docs**. Latest artifact: **March 28, 2026**. Cost in that run: **$0.074/question**.
- **LoCoMo full end to end:** **84.3% evidence recall** and **58.7% answer accuracy** on **695 scored questions / 272 sessions**. Latest artifact: **March 28, 2026**. Final token F1: **0.483**.
- **LoCoMo unit retrieval:** **84.8% Recall@5** and **90.4% Recall@10** on the full non-adversarial retrieval set.

Every number below ties back to a checked-in report or reproducible harness in the repo.

**Multi-hop retrieval vs. academic baselines** (HotpotQA, 500 questions, 4,960 documents):

| System | Recall | Training data |
|---|---|---|
| BM25 baseline | ~75% | None |
| [TF-IDF + Entity](https://arxiv.org/abs/1809.09600) | ~80% | None |
| [Baleen](https://arxiv.org/abs/2101.00436) (Stanford) | ~85% | HotpotQA |
| [MDR](https://arxiv.org/abs/2009.12756) (Facebook) | ~88% | HotpotQA |
| **Flywheel** | **92.4%** | **None** |
| [Beam Retrieval](https://arxiv.org/abs/2308.08973) | ~93% | End-to-end |

**Conversational memory retrieval** ([LoCoMo](https://snap-research.github.io/locomo/), 1,531 scored retrieval queries, 272 session notes):

| Category | Recall@5 | Recall@10 |
|---|---|---|
| **Overall** | **84.8%** | **90.4%** |
| Single-hop | 88.1% | 91.7% |
| Commonsense | 95.4% | 98.3% |
| Multi-hop | 58.1% | 72.7% |
| Temporal | 56.9% | 67.4% |

E2E with Claude Sonnet (latest checked-in 695-question run): **97.4%** single-hop evidence recall, **73.7%** multi-hop evidence recall, **84.3%** overall evidence recall, and **58.7%** answer accuracy (Claude Haiku judge). [Full methodology and caveats ->](docs/TESTING.md#retrieval-benchmark-locomo)

> **Directional, not apples-to-apples.** Test settings, sample sizes, retrieval pools, and metrics differ. Flywheel searches 4,960 pooled docs, which is harder than the standard HotpotQA distractor setting of 10 docs and much smaller than fullwiki. Academic retrievers are trained on the benchmark; Flywheel uses no benchmark training data. Expect about 1 percentage point of run-to-run variance from LLM non-determinism. [Full caveats ->](docs/TESTING.md#retrieval-benchmark-hotpotqa)

[`demos/hotpotqa/`](demos/hotpotqa/) · [`demos/locomo/`](demos/locomo/) · [Full methodology ->](docs/TESTING.md)

---

## Testing

3,292 defined tests across 185 test files and about 64.4k lines of test code. CI runs focused jobs on Ubuntu, plus a full matrix on Ubuntu and Windows across Node 22 and 24.

- **Graph quality:** Latest generated report shows balanced-mode **40.2% precision / 71.7% recall / 51.5% F1** on the primary synthetic vault, along with multi-generation, archetype, chaos, and regression coverage. [Report ->](docs/QUALITY_REPORT.md)
- **Live AI testing:** Real `claude -p` sessions verify tool adoption end to end, not just handler logic.
- **Write safety:** Git-backed conflict detection, atomic rollback, and 100 parallel writes with zero corruption in the checked-in test suite.
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
