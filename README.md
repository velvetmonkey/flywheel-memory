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

61 tools. 6-line config. Zero cloud.

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
  query: "Acme Corp billing invoice"
  → clients/Acme Corp.md
      frontmatter: { total_billed: 156000, rate: 300, status: "active" }
      backlinks: INV-2025-047.md, INV-2025-048.md, Acme Data Migration.md, +28
      outlinks: Sarah Mitchell, INV-2025-047, INV-2025-048, Acme Analytics Add-on, +25
    invoices/INV-2025-048.md
      frontmatter: { amount: 12000, status: "pending", period: "December 2025" }
    invoices/INV-2025-047.md
      frontmatter: { amount: 15000, status: "paid", period: "November 2025" }

┌─ RESULT ──────────────────────────────────────────────┐
│ Acme Corp: $156K total billed                         │
│                                                       │
│   Paid:    $15,000 — Acme Data Migration (Nov 2025)   │
│   Pending: $12,000 — Acme Data Migration (Dec 2025)   │
│                                                       │
│ Also: $35K pending proposal (Analytics Add-on)        │
└───────────────────────────────────────────────────────┘
```

One search call returned everything -- frontmatter with amounts and status, backlink lists, outlink lists. Zero file reads needed. Without Flywheel, Claude would grep for "Acme" and scan every matching file.

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

### 1. Enriched Search

Most tools return file paths. Flywheel returns the answer.

Every search result includes the note's frontmatter, every note that links to it, every note it links to, its heading outline, and the matching text snippet — all from an in-memory index, zero file reads. That's why the example above answers a billing question from a single call: the client's frontmatter has the totals, the backlinks surface every invoice, and the outlinks show related projects.

Matching combines three channels: title/entity name matching, full-text search (BM25 with stemming), and entity database lookup (aliases, categories). With semantic embeddings (via `init_semantic`), results are fused via Reciprocal Rank Fusion — "login security" finds notes about authentication even without that keyword. Everything runs locally. Nothing leaves your machine.

This is what makes `search` the only tool most questions need. You don't search, then read backlinks, then read metadata — it's all in the first result.

### 2. Every Suggestion Has a Receipt

Ask why Flywheel suggested `[[Marcus Johnson]]`:

```
Entity              Score  Match  Co-oc  Type  Context  Recency  Cross  Hub  Feedback  Semantic  Edge
──────────────────────────────────────────────────────────────────────────────────────────────────────
Marcus Johnson        34    +10     +3    +5     +5       +5      +3    +1     +2         0       0
```

10 scoring dimensions, every number traceable to vault usage. Recency came from what you last wrote. Co-occurrence came from notes you've written before. Hub came from how many other notes link there. The score learns as you use it.

See [docs/ALGORITHM.md](docs/ALGORITHM.md) for how scoring works.

### 3. Use It and It Gets Smarter

Every auto-wikilink is a graph edge — and every edge makes future queries better.

- **Write** → entities are auto-linked, creating edges
- **Keep** a link through 10 edits → that edge gains weight
- **Remove** a bad link → the system learns what to suppress
- **Co-occurrence** → two entities in 20 notes build a statistical bond that surfaces in suggestions

Static tools give you the same results on day 1 and day 100. Flywheel's suggestions on day 100 are informed by everything you've written and edited since day 1. Usage compounds into structure, structure compounds into intelligence. No retraining, no configuration, no manual curation.

This isn't aspirational — the F1 scores below are measured under realistic noise, and they hold steady after 50 generations of accumulated feedback. See [Graph Quality](#graph-quality) for the numbers.

### 4. Agentic Memory

The system remembers context across sessions. No more starting from scratch.

- **`brief`** assembles startup context: recent sessions, active entities, stored memories, corrections, vault pulse — token-budgeted
- **`recall`** retrieves across all knowledge channels: entities, notes, memories, and semantic search — ranked by the same scoring signals as the wikilink engine
- **`memory`** stores observations with confidence decay, TTL, and lifecycle management

Claude picks up where it left off.

### 5. Deterministic Policies

Complex vault workflows shouldn't be ad-hoc. Describe what you want in plain language — Claude creates the policy, saves it, and executes it on demand. No YAML knowledge required.

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

Under the hood, policies are YAML files that chain vault tools into atomic operations — all steps succeed or all roll back, committed as a single git commit. Variables, conditions (branch on file/frontmatter state), template interpolation (`{{today}}`, `{{steps.prev.output}}`), and rollback on failure — all built in.

Try it yourself: `cd demos/carter-strategy && claude`

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
| Deterministic policies? | No | No | Yes (atomic YAML workflows) |

---

## The Flywheel Effect

The name is literal. A flywheel is hard to start but once spinning, each push adds to the momentum.

### Day 1: Instant Value

Index, extract entities, build graph. First query returns in <10ms. First write auto-links three entities you would have missed.

### Week 1: Connections Appear

Auto-wikilinks create dozens of connections on your first day of writing. You stop reading files and start querying a graph.

### Month 1: Intelligence Emerges

Hub notes surface — "Sarah Mitchell" has 23 backlinks. Co-occurrence tracking knows she's relevant to security projects. You didn't configure this. The vault structure revealed it.

### Month 3: The Graph Is Self-Sustaining

Every query leverages hundreds of accumulated connections. New content auto-links to the right places. You stop thinking about organization.

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
| Tool count | 62 | ~10 | 0 (plugin) | ~5 |

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
| [solo-operator](demos/solo-operator/) | Content creator | "How's revenue looking?" |
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

Defaults to the `default` preset (17 tools). Add bundles as needed. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for all options.

> **Note:** Developed and tested with Claude Code. Other MCP clients may work but are untested.

---

## Tools Overview

| Preset | Tools | What you get |
|--------|-------|--------------|
| `default` | 19 | Note-taking essentials — search, read, write, tasks, policies |
| `agent` | 19 | Autonomous AI agents — search, read, write, memory, policies |
| `full` | 62 | Everything — all 11 categories |

Composable bundles (add to presets or each other):

| Bundle | Tools | What it adds |
|--------|-------|--------------|
| `graph` | 7 | Structural analysis, hubs, shortest paths, connections |
| `schema` | 5 | Schema intelligence, migrations |
| `wikilinks` | 7 | Wikilink suggestions, validation, discovery |
| `corrections` | 4 | Correction recording + resolution |
| `tasks` | 3 | Task queries and mutations |
| `memory` | 3 | Agent working memory + recall + brief |
| `note-ops` | 4 | Delete, move, rename notes, merge entities |
| `diagnostics` | 13 | Vault health, stats, config, activity, merges |

The fewer tools you load, the less context Claude needs to pick the right one. See [docs/TOOLS.md](docs/TOOLS.md) for the full reference.

---

## Documentation

| Doc | Why read this |
|---|---|
| [PROVE-IT.md](docs/PROVE-IT.md) | See it working in 5 minutes |
| [TOOLS.md](docs/TOOLS.md) | All 61 tools documented |
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
