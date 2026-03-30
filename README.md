<div align="center">
  <img src="header.png" alt="Flywheel" width="256"/>
  <h1>Flywheel</h1>
  <p><strong>Local-first memory for Obsidian.</strong><br/>
  Give AI clients structured access to your vault for search, writing, tasks, and graph-aware context.</p>
</div>

[![npm version](https://img.shields.io/npm/v/@velvetmonkey/flywheel-memory.svg)](https://www.npmjs.com/package/@velvetmonkey/flywheel-memory)
[![CI](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![HotpotQA](https://img.shields.io/badge/HotpotQA-92.4%25%20recall%20(500q)-brightgreen.svg)](docs/TESTING.md#retrieval-benchmark-hotpotqa)
[![LoCoMo](https://img.shields.io/badge/LoCoMo-84.3%25%20evidence%20recall%20(695q)-blue.svg)](docs/TESTING.md#retrieval-benchmark-locomo)

**[See It Work](#see-it-work)** · **[Get Started](#get-started)** · **[Why Flywheel](#why-flywheel)** · **[Benchmarks](#benchmarks)** · **[Testing](#testing)** · **[Documentation](#documentation)** · **[License](#license)**

Flywheel is a local-first MCP server for Obsidian vaults. It indexes your markdown and gives AI clients tools to search notes, write safely, query tasks, follow links, and carry context across sessions. One server can serve multiple vaults with isolated state and cross-vault search.

Search returns a *decision surface* — frontmatter, backlinks, outlinks, snippets, section context, extracted dates, entity bridges, and confidence scores — so the model can reason from one call instead of opening file after file.

Every write auto-links entities through a deterministic *13-layer scoring algorithm* where every suggestion has a traceable receipt. *Proactive linking* means edits made in Obsidian are scored too — the graph grows whether you're using Claude or not. Links you keep get stronger; links you remove get suppressed. This is the *flywheel effect*: use compounds into structure, structure into intelligence, intelligence into more use.

## See It Work

### Read: "How much have I billed Acme Corp?"

From the [carter-strategy](demos/carter-strategy/) demo: a consultant vault with clients, invoices, projects, notes, and graph structure the model can query directly.

<video src="https://github.com/user-attachments/assets/ec1b51a7-cb30-4c49-a35f-aa82c31ec976" autoplay loop muted playsinline width="100%"></video>

In this demo, a single search returns the invoice and client context needed to answer the question: frontmatter with amounts and status, related links, and the surrounding section content. The graph is doing the joining, so the model does not need a chain of follow-up reads to piece the answer together.

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

You type a normal sentence. Flywheel can resolve known entities, add wikilinks, and suggest related links based on aliases, co-occurrence, graph structure, and semantic context. Suggested outgoing links are optional and off by default. Enable them where you want the graph to grow naturally, such as daily notes, meeting logs, or voice capture. [Configuration guide ->](docs/CONFIGURATION.md)

### Boundaries

Flywheel is designed to be explicit about what it does.

- Writes happen through visible tool calls.
- Changes stay within the vault unless you explicitly point a tool somewhere else.
- Git commits are opt-in.
- Proactive linking can be disabled.

> **Reproduce it yourself:** The carter-strategy demo includes a [`run-demo-test.sh`](demos/carter-strategy/run-demo-test.sh) script that runs the full sequence end to end with `claude -p`, checking tool usage and vault state between steps.

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

| Preset | Behaviour |
|--------|-----------|
| `full` (default) | All capabilities, progressively disclosed as your queries need them |
| `agent` | Fixed reduced set — search, read, write, tasks, memory |

Out of the box, Flywheel progressively surfaces specialised tools as the conversation needs them. For a fixed reduced set, use `agent`. Compose bundles for custom configurations.

```json
{ "env": { "FLYWHEEL_TOOLS": "agent,graph" } }
```

[Browse all tools ->](docs/TOOLS.md) | [Preset recipes ->](docs/CONFIGURATION.md)

### Multiple vaults

Serve more than one vault from a single Flywheel instance with `FLYWHEEL_VAULTS`:

```json
{
  "env": {
    "FLYWHEEL_VAULTS": "personal:/home/you/obsidian/Personal,work:/home/you/obsidian/Work"
  }
}
```

Search automatically spans all vaults and tags each result with its source vault. Other tools default to the primary vault (first in the list) unless you pass a `vault` parameter. Each vault gets fully isolated state — separate indexes, graph, file watcher, and config.

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

### Who this is for

Flywheel is for people who want AI to work against their vault without handing the vault over to a hosted product: developers, researchers, solo operators, and anyone who treats notes as working infrastructure. It also works as persistent memory for bots and agents through MCP.

If you want a managed cloud knowledge product, Flywheel is probably the wrong fit. It is intentionally local-first.

---

## Why Flywheel

**Decision surface** — Search returns frontmatter, backlinks, outlinks, section context, dates, entity bridges, and confidence in one call. The model reasons across structured metadata instead of opening files.

**Deterministic linking** — A 13-layer scoring algorithm produces a traceable receipt for every suggestion. Same input, same output. See [docs/ALGORITHM.md](docs/ALGORITHM.md) for the full specification.

**Self-improving graph** — Proactive linking scores edits made anywhere — Obsidian, synced files, external tools. Links you keep accumulate weight; links you remove get suppressed. The graph compounds with use.

**Brief + memory** — `brief` assembles a token-budgeted cold-start summary. `memory` persists observations with confidence decay. The AI picks up where it left off.

**Policies** — Repeatable vault workflows defined in YAML — parameterized steps, conditions, variable substitution, optional atomic git commits. [Examples ->](docs/POLICY_EXAMPLES.md)

**Hybrid search** — Keyword search (BM25) finds what you said. Semantic search finds what you meant. Both fused via Reciprocal Rank Fusion, running locally. Nothing leaves your machine.

**Multi-vault** — One server, multiple vaults, isolated state. Search without a vault filter queries all vaults and merges results.

**Adaptive tool loading** — Under `full`, specialised tools surface when the conversation needs them. The default context stays focused; graph, schema, and temporal capabilities appear on demand.

**Auditable writes** — Every mutation is git-committed, conflict-detected (SHA-256 content hash), and policy-governed. One undo reverts any change.

### Link scoring

Flywheel's deterministic 13-layer scoring algorithm produces a traceable receipt for every link suggestion — covering exact matches, aliases, co-occurrence, type information, recent usage, graph structure, user feedback, and semantic similarity. The goal is not to hide the logic but to make it inspectable and tunable. [How scoring works ->](docs/ALGORITHM.md)

### Policies and workflows

Vault workflows expressed as YAML policies — parameterized steps, conditions, variable substitution, atomic git commits. [Examples ->](docs/POLICY_EXAMPLES.md) | [Architecture ->](docs/ARCHITECTURE.md)

### Graph export

One call to `export_graph` can turn the whole vault, or a selected neighborhood around one entity, into a [GraphML](https://en.wikipedia.org/wiki/GraphML) file.

![Acme Corp ego network](demos/carter-strategy/carter-strategy-acme-graph.png)

The [carter-strategy demo graph](demos/carter-strategy/carter-strategy-acme.graphml) shows the neighborhood around Acme Corp: linked contacts, proposals, invoices, projects, and bridging notes derived from plain markdown.

### Operational guarantees

These are product constraints, not conventions:

- **No surprise tool writes.** Tool-initiated mutations require explicit calls.
- **No hidden execution.** Tool usage is visible and scoped.
- **No required cloud service.** Core indexing, search, and graph features run locally.
- **Auditable changes.** Git commits are optional, but supported directly.
- **Configurable background behavior.** Proactive linking is auditable and can be disabled.

---

## Benchmarks

Latest checked-in benchmark artifacts:

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

2,760 defined tests across 142 test files and about 54.7k lines of test code. CI runs focused jobs on Ubuntu, plus a full matrix on Ubuntu and Windows across Node 22 and 24.

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
