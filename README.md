<div align="center">
  <img src="header.png" alt="Flywheel" width="256"/>
  <h1>Flywheel</h1>
  <p><strong>A knowledge graph engine that reads, writes, and learns.</strong><br/>Graph intelligence. Safe writes. A feedback loop that learns from every interaction.<br/>Zero cloud. Your Obsidian vault becomes a queryable second brain.</p>
</div>

[![npm version](https://img.shields.io/npm/v/@velvetmonkey/flywheel-memory.svg)](https://www.npmjs.com/package/@velvetmonkey/flywheel-memory)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blueviolet.svg)](https://modelcontextprotocol.io/)
[![CI](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Clients](https://img.shields.io/badge/clients-Claude%20Code%20%7C%20Desktop%20%7C%20Cursor%20%7C%20Windsurf%20%7C%20VS%20Code-blue.svg)](docs/SETUP.md)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue.svg)](https://github.com/velvetmonkey/flywheel-memory)
[![Scale](https://img.shields.io/badge/scale-100k--line%20files%20%7C%202.5k%20entities-brightgreen.svg)](docs/TESTING.md#performance-benchmarks)
[![Tests](https://img.shields.io/badge/tests-2,482%20passed-brightgreen.svg)](docs/TESTING.md)

**If you use AI with an Obsidian vault**, this is for you. By default, AI agents reach for the filesystem — reading files one at a time, writing raw text, losing context between sessions. Flywheel is an MCP server that runs locally alongside your vault, giving any MCP-compatible AI a pre-indexed knowledge graph, enriched search, safe writes with auto-wikilinks, and persistent memory — so it can answer questions about your notes in milliseconds instead of reading every file.

Six lines of JSON config. No cloud. Your data never leaves your machine. Primarily tested with Claude (Code + Desktop), also works with Cursor, Windsurf, VS Code + Copilot, Continue, and any MCP client.

| | Without Flywheel | With Flywheel |
|---|---|---|
| "What's overdue?" | Read every file | Indexed query, <10ms |
| "What links here?" | Grep for name, flat list | Backlink graph, pre-indexed |
| "Add a meeting note" | Raw write, no linking | Auto-wikilinks on every mutation |
| "What should I link?" | Not possible | 10-dimension scoring + semantic search |
| Token cost | ~800-2,000 per query | ~50-200 per query |

72 tools. 6-line config. Zero cloud.

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

<video src="carter-strategy-demo.mp4" controls autoplay loop muted playsinline width="100%"></video>

One search call returned everything -- frontmatter with amounts and status, backlink lists, outlink lists. Zero file reads needed. Without Flywheel, the AI would grep for "Acme" and scan every matching file.

### Write: Auto-wikilinks on every mutation

```
❯ Log that I finished the Acme strategy deck

● flywheel › vault_add_to_section
  path: "daily-notes/2026-01-04.md"
  section: "Log"
  content: "finished the [[Acme Corp|Acme]] strategy deck"
            ↑ "Acme" auto-linked to [[Acme Corp]] (alias match, no brackets typed)
```

You typed a plain sentence. Flywheel recognized "Acme" as an alias for `Acme Corp.md` and linked it — no brackets, no lookup, no manual work. That link is now a graph edge — it's why the read example above works. The `section: "Log"` wasn't hardcoded either — "Log" was inferred from the verb. Flywheel prefers structured notes with sections, but works fine with unstructured vaults too — it'll append to the note body if there are no headings to target.

Three layers fire on every write:

**Known entity linking** — Flywheel scans every entity name and alias in the vault index. Matching is deterministic — same input always produces the same links. That's the `[[Acme Corp|Acme]]` above.

**Implicit entity detection** — When `implicit_detection` is enabled (default), Flywheel also detects potential entities that don't have backing notes yet: proper nouns, CamelCase, quoted terms, acronyms. These become dead wikilinks — signals that "this could be a note." They're future graph edges: if you later create `Marcus Johnson.md`, every note that mentioned him is already linked.

**Contextual suggestions** — After linking, Flywheel appends `→ [[Entity1]], [[Entity2]]` — entities the scoring engine thinks are relevant based on how your vault is structured right now. An audit note gets linked to a related client project because they co-occur across your past notes. Six months later, those `→` links are a snapshot of what was contextually relevant when you wrote that entry — context that would otherwise be lost. Suggestions evolve: links you keep strengthen future scoring, links you edit out get suppressed, and recency decay fades stale connections. What gets suggested reflects your vault as it is, not as it was.

Here's a richer write that triggers all three layers:

```
❯ Log that Stacy reviewed the security checklist before the Beta Corp kickoff

● flywheel › vault_add_to_section
  path: "daily-notes/2026-01-04.md"
  section: "Log"
  content: "[[Stacy Thompson|Stacy]] reviewed the [[API Security Checklist|security checklist]]
            before the [[Beta Corp Dashboard|Beta Corp]] kickoff
            → [[GlobalBank API Audit]], [[Acme Data Migration]]"
            ↑ 3 known entities auto-linked ("Stacy" resolved via alias)
            → 2 suggested links: entities co-occurring with Stacy + security across past notes
```

Try it yourself: `cd demos/carter-strategy && claude`

---

## What Makes Flywheel Different

### 1. Enriched Search

Every search result comes back enriched — frontmatter, ranked backlinks, ranked outlinks, and content snippets, all from an in-memory index. That's how one call answers a billing question: the search finds `Acme Corp.md` with its frontmatter totals, and the backlinks surface every invoice and project that wikilinks to it — each with its own frontmatter. The graph did the joining, not the AI reading files one by one.

With semantic embeddings enabled, "login security" finds notes about authentication without that exact keyword. Everything runs locally.

### 2. Every Suggestion Has a Receipt

Those `→` suggestions aren't random. Ask why Flywheel suggested `[[Marcus Johnson]]`:

```
Entity              Score  Match  Co-oc  Type  Context  Recency  Cross  Hub  Feedback  Semantic  Edge
──────────────────────────────────────────────────────────────────────────────────────────────────────
Marcus Johnson        34    +10     +3    +5     +5       +5      +3    +1     +2         0       0
```

10 scoring dimensions, every number traceable to vault usage. Recency came from what you last wrote. Co-occurrence came from notes you've written before. Hub came from how many other notes link there. The score learns as you use it.

See [docs/ALGORITHM.md](docs/ALGORITHM.md) for how scoring works.

### 3. Use It and It Gets Smarter

The links and suggestions above aren't static — they learn from how you interact with them.

- **Co-occurrence** builds over time — two entities appearing in 20 notes form a statistical bond
- **Edge weights** accumulate — links that survive edits gain influence
- **Suppression** learns — connections you repeatedly break stop being suggested

Static tools give you the same results on day 1 and day 100. Flywheel's suggestions on day 100 are informed by everything you've written and edited since day 1. No retraining, no configuration, no manual curation.

This isn't aspirational — the F1 scores below are measured under realistic noise, and they hold steady after 50 generations of accumulated feedback. See [Graph Quality](#graph-quality) for the numbers.

### 4. Agentic Memory

Your AI knows what you were working on yesterday without you re-explaining it.

- **`brief`** — startup context: what happened recently, what's active, what needs attention
- **`recall`** — retrieves across notes, entities, memories, and semantic search in one call
- **`memory`** — stores observations that persist across sessions, with automatic decay

No session is a blank slate.

### 5. Deterministic Policies

Complex vault workflows shouldn't be ad-hoc. Describe what you want in plain language — the AI creates the policy, saves it, and executes it on demand. No YAML knowledge required.

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

Policies chain vault tools into atomic operations — all steps succeed or all roll back, committed as a single git commit. Describe the workflow once, run it whenever.

Try it yourself: `cd demos/carter-strategy && claude`

---

## Battle-Tested

**2,482 tests. 122 test files. 47,000+ lines of test code.** See [docs/TESTING.md](docs/TESTING.md).

### Performance

| Operation | Threshold | Typical |
|---|---|---|
| 1k-line mutation | <100ms | ~15ms |
| 10k-line mutation | <500ms | -- |
| 100k-line mutation | <2s | -- |

- **100 parallel writes, zero corruption** -- concurrent mutations verified under stress
- **Property-based fuzzing** -- 700+ randomized scenarios
- **SQL injection prevention** -- parameterized queries throughout
- **Path traversal blocking** -- all file paths validated against vault root
- **Deterministic output** -- same input, same result

See [docs/PROVE-IT.md](docs/PROVE-IT.md) for a 5-minute walkthrough.

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
- **Conflict-detected** — SHA-256 content hash checked before every write; if the file changed since it was read, the mutation is rejected with a diagnostic showing exactly what changed and how to recover
- **Policy-governed** — configurable guardrails with warn/strict/off modes
- **Dry-run preview** — every write tool supports `dry_run: true` to see exactly what would change before touching disk
- **Precise** — auto-wikilinks have 1.0 precision in production (never inserts a wrong link)

**AST-protected wikilinks.** Before inserting any link, Flywheel parses the Markdown AST to identify protected zones where links must never go — code blocks, inline code, YAML frontmatter, existing `[[wikilinks]]` and `[markdown](links)`, bare URLs, HTML tags and comments, Obsidian callouts (including nested callouts), pipe tables, math expressions, and hashtags. Pure regex can't reliably handle nested callouts or multi-line HTML; the AST parser does, with a transparent regex fallback if parsing fails.

**Correction loop suppression.** If you mark a suggested wikilink as wrong, that correction is checked before any future auto-link attempt on the same entity — the same wrong link is never re-suggested. Deleted notes are also handled cleanly: they don't generate false negative feedback against the entity.

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
| Tool count | 72 | ~10 | 0 (plugin) | ~5 |

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

Defaults to the `default` preset (19 tools). Add bundles as needed. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for all options.

> **Windows users — read this before you start.** Three things differ from macOS/Linux:
> 1. **`cmd /c npx`** instead of `npx` — Windows installs npx as a `.cmd` batch script that can't be spawned directly
> 2. **`VAULT_PATH`** — set this to your vault's Windows path
> 3. **`FLYWHEEL_WATCH_POLL: "true"`** — **required**. Without this, Flywheel won't pick up changes you make in Obsidian. Your search results go stale the moment you edit a note outside Claude. This is the most common source of Windows issues.
>
> See [docs/CONFIGURATION.md#windows](docs/CONFIGURATION.md#windows) for the full config example.

**Using Cursor, Windsurf, VS Code, or another editor?** See [docs/SETUP.md](docs/SETUP.md) for your client's config.

> **Clients:** Works with any MCP-compatible client. Primarily tested with Claude (Code + Desktop) via stdio. Cursor, Windsurf, VS Code + Copilot, and Continue connect via HTTP transport (`FLYWHEEL_TRANSPORT=http`, port `3111` by default). See [docs/SETUP.md](docs/SETUP.md) for setup guides.

---

## Tools Overview

| Preset | Tools | What you get |
|--------|-------|--------------|
| `default` | 19 | Note-taking essentials — search, read, write, tasks |
| `agent` | 19 | Autonomous AI agents — search, read, write, memory |
| `full` | 69 | Everything — all 11 categories |

Composable bundles add capabilities to any preset. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for all bundles and fine-grained categories.

The fewer tools you load, the less context the AI needs to pick the right one. See [docs/TOOLS.md](docs/TOOLS.md) for the full reference.

---

## Documentation

| Doc | Why read this |
|---|---|
| [PROVE-IT.md](docs/PROVE-IT.md) | See it working in 5 minutes |
| [TOOLS.md](docs/TOOLS.md) | All 72 tools documented |
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
