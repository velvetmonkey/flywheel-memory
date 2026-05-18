<div align="center">
  <img src="header.png" alt="Flywheel" width="256"/>
  <h1>Flywheel</h1>
  <p><strong>Persistent knowledge graph memory for AI agents. Structured vault with semantic search, read, and write tools. Works with Obsidian.</strong></p>
</div>

[![npm version](https://img.shields.io/npm/v/@velvetmonkey/flywheel-memory.svg)](https://www.npmjs.com/package/@velvetmonkey/flywheel-memory)
[![CI](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)

**[Get Started](#get-started)** · **[What It Does](#what-it-does)** · **[Benchmarks](#benchmarks)** · **[Testing](#testing)** · **[Documentation](#documentation)** · **[License](#license)**

## What it does

- Stores notes, entities, and memories in a local Obsidian vault
- Exposes search, read, write, and memory tools via MCP (Model Context Protocol)
- Maintains backlinks, outlinks, frontmatter, and entity relationships
- Supports session-scoped and persistent memory across conversations
- Works with any MCP-compatible AI client (Claude Code, etc.)

## What it is not

- Not a cloud service
- Not a general-purpose database
- Not a productivity app

## Who it's for

Developers building AI agents that need persistent, structured memory over a local knowledge base.

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

Ready to use Flywheel against your own notes instead of the demo? Install on your vault:

### Your Vault in 2 Minutes

Install Flywheel as an [Agent Skill](https://github.com/vercel-labs/skills) (the standard onboarding for AI tooling — `npx skills` uses GitHub as a registry):

1. **Install the skill.** From any directory:
   ```bash
   npx -y skills add velvetmonkey/flywheel-memory -g
   ```
   Drop `-g` to install at project scope (`<vault>/.claude/skills/`) instead of global (`~/.claude/skills/`). The skill teaches an agent when to use Flywheel and walks the user through the next two steps automatically.

2. **Wire the MCP server.** From your vault directory:
   ```bash
   bash <(curl -fsSL https://raw.githubusercontent.com/velvetmonkey/flywheel-memory/main/skills/flywheel/scripts/install.sh)
   ```
   Merges Flywheel into `<vault>/.mcp.json`. Windows users: [`install.ps1`](skills/flywheel/scripts/install.ps1) — same idempotent merge for PowerShell.

3. **Restart your client** (`claude` / `codex`) from the vault directory. MCP servers register at startup only.

Then ask a question. Flywheel watches the vault, maintains local indexes, and serves structured context to MCP clients. Your source of truth stays in Markdown. If you delete `.flywheel/state.db`, Flywheel rebuilds note indexes from the vault — learned state (memories, link feedback) regenerates with use.

<details>
<summary><strong>Manual install (no installers — for Cursor, Windsurf, VS Code, Continue.dev, etc.)</strong></summary>

If you'd rather hand-edit `.mcp.json` (e.g. integrating with a non-Claude-Code client), add this block to your client's MCP config:

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

The skill itself is optional in this path — clients without a skills surface still get the full MCP tool set. Skill source: [`skills/flywheel/`](skills/flywheel/).
</details>

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

If you ran [`install.ps1`](skills/flywheel/scripts/install.ps1) in step 2 above, the Windows-specific config (`cmd /c npx` and `FLYWHEEL_WATCH_POLL: "true"`) is already written into your `.mcp.json` automatically — no further action needed.

If you're hand-editing `.mcp.json` instead, three things differ from macOS and Linux:

1. Use **`cmd /c npx`** instead of `npx`. On Windows, `npx` is installed as a `.cmd` script and cannot be spawned directly.
2. Set **`VAULT_PATH`** to your vault's Windows path.
3. Set **`FLYWHEEL_WATCH_POLL: "true"`**. Without polling, Flywheel will not reliably pick up changes made from Obsidian on Windows.

See [docs/CONFIGURATION.md#windows](docs/CONFIGURATION.md#windows) for the full example.
</details>

If you use Cursor, Windsurf, VS Code, OpenClaw, or another client, see [docs/SETUP.md](docs/SETUP.md) for client-specific configuration. For OpenClaw, use the dedicated [OpenClaw integration guide](docs/OPENCLAW.md).

---

## The Flywheel Suite

- **flywheel-memory** *(this repo)* — local-first MCP server. Hybrid BM25 + semantic search, knowledge graph, safe writes over an Obsidian vault.
- **[flywheel-crank](https://github.com/velvetmonkey/flywheel-crank)** — Obsidian plugin. Visual layer over Memory's graph: sidebar, vault health, semantic search UI.
- **[flywheel-ideas](https://github.com/velvetmonkey/flywheel-ideas)** — falsifiable decision ledger. Pre-registered assumptions, multi-model AI council dissent, outcome-driven refutation propagation.
- **[flywheel-geometry](https://github.com/velvetmonkey/flywheel-geometry)** — geodesic retrieval extension. v0.1 pre-registered falsifier **resolved FAIL 2026-05-10** ([postmortem](https://github.com/velvetmonkey/flywheel-geometry/blob/main/docs/trial2-postmortem.md)); successor research lane at [flywheel-concept](https://github.com/velvetmonkey/flywheel-concept).
- **[flywheel-concept](https://github.com/velvetmonkey/flywheel-concept)** — research programme on whether cross-model activations reveal structured concept geometry.

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

## License

Apache-2.0. See [LICENSE](./LICENSE) for details.
