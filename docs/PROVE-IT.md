# Prove It

[← Back to docs](README.md)

> Clone. Run. See. 5 minutes.

No screenshots. No demos on someone else's machine. Clone the repo, run the tests, try the tools. Everything below runs on your hardware in your terminal.

- [Prerequisites](#prerequisites)
- [Phase 1: Clone and Verify](#phase-1-clone-and-verify)
- [Phase 2: First Graph Query](#phase-2-first-graph-query)
- [Phase 3: Watch Auto-Wikilinks](#phase-3-watch-auto-wikilinks)
- [Phase 4: See the Algorithm Think](#phase-4-see-the-algorithm-think)
- [Phase 5: Try a Different Domain](#phase-5-try-a-different-domain)
- [Phase 6: Your Own Vault](#phase-6-your-own-vault)
- [What You Just Proved](#what-you-just-proved)
- [Why It's Efficient](#why-its-efficient)
- [Next Steps](#next-steps)

---

## Prerequisites

- **Node.js 22–24** -- check with `node --version`.
- **[[CLAUDE]] Code** -- authenticated and working (`claude --version`)
- **git** -- to clone the repo

---

## Phase 1: Clone and Verify

```bash
git clone https://github.com/velvetmonkey/flywheel-memory.git
cd flywheel-memory
npm install
npm test
```

Wait for it:

```
Test Suites: 129 passed, 129 total
Tests:       2,712 passed, 2,712 total
Snapshots:   0 total
Time:        ~18s
```

2,712 tests. All passing. No mocks of external services -- these are real SQLite queries, real file parsing, real graph traversals against real vaults. If something is broken, you know in 18 seconds.

---

## Phase 2: First Graph Query

Open the solo-consultant demo vault:

```bash
cd demos/carter-strategy
claude
```

Ask Claude:

> How much have I billed Acme Corp?

Watch the tool trace (Claude's exact path varies between runs):

```
● flywheel › search
  query: "Acme Corp"
  → clients/Acme Corp.md
      frontmatter: { total_billed: 156000, rate: 300, status: "active" }
      backlinks: INV-2025-047.md, INV-2025-048.md, Acme Data Migration.md, +28
      outlinks: Sarah Mitchell, INV-2025-047, INV-2025-048, +25
    invoices/INV-2025-047.md
      frontmatter: { amount: 15000, status: "paid" }
    invoices/INV-2025-048.md
      frontmatter: { amount: 12000, status: "pending" }
```

**What happened:** [[Flywheel]]'s enriched search returned frontmatter (amounts, status), backlinks, and outlinks for every hit -- all in one call. Zero file reads needed. The answer was in the search result itself.

Without Flywheel, Claude would grep for "Acme" and scan matching files. The real win shows in structural queries like "what are the hub notes?" or "what's the shortest path between X and Y?" — those need a graph, not file reads.

---

## Phase 3: Watch Auto-Wikilinks

Still in carter-strategy, tell Claude:

> Log that Stacy Thompson is starting on the Beta Corp Dashboard and reviewed the [[API]] Security Checklist

Watch the output:

```
● flywheel › vault_add_to_section
  path: "daily-notes/2026-01-04.md"
  section: "Log"
  content: "[[Stacy Thompson]] is starting on the [[Beta Corp Dashboard]] and reviewed the [[API Security Checklist]]"
```

"Stacy Thompson", "Beta Corp Dashboard", and "API Security Checklist" were auto-linked to existing notes across team/, projects/, and knowledge/. You typed plain text -- Flywheel scanned every note title and alias in the vault, found matches, and wrapped them in `[[wikilinks]]`.

Every write makes the graph denser. Denser graphs make reads more precise. That's the flywheel.

---

## Phase 4: See the Algorithm Think

Open the Zettelkasten demo:

```bash
cd ../zettelkasten
claude
```

Ask Claude:

> Suggest wikilinks for the note on Elaborative Interrogation, and show me the detail

Watch the score breakdown:

```
● flywheel › suggest_wikilinks
  path: "permanent/Elaborative Interrogation.md"

  Suggested links:
  1. [[Active Recall]]         score: 0.92  (co-occurrence: 3, shared tags: 2)
  2. [[Schema Theory]]         score: 0.87  (co-occurrence: 2, shared tags: 1)
  3. [[Metacognition]]         score: 0.85  (co-occurrence: 2, shared tags: 1)
  4. [[Desirable Difficulties]] score: 0.81  (co-occurrence: 1, shared tags: 2)
```

These are not vibes. Every suggestion has a score built from co-occurrence frequency, shared tags, graph proximity, and recency. You can see why each link was suggested and decide whether to accept it.

---

## Phase 5: Try a Different Domain

Switch to the computational biology vault:

```bash
cd ../nexus-lab
claude
```

Ask Claude:

> How does the AlphaFold paper connect to my docking experiment?

```
● flywheel › search
  query: "AlphaFold docking experiment"
  → literature/Jumper2021-AlphaFold.md
      outlinks: Transformer Architecture, Structure-Based Drug Design
      snippet: "...predicts protein structures with atomic accuracy..."
    experiments/Experiment-2024-10-28.md
      outlinks: Jumper2021-AlphaFold, EGFR, Drug-Target Prediction
      snippet: "...pLDDT 94.2, RMSD 0.8Å vs PDB 1M17..."
    experiments/Experiment-2024-11-22.md
      outlinks: Experiment-2024-10-28, AMBER Force Field
      snippet: "...Compound_472: -11.2 kcal/mol..."
```

**Connection path (3 hops):**
Jumper2021 (AlphaFold) -> Experiment-2024-10-28 (EGFR structure) -> Experiment-2024-11-22 (docking screen, Compound_472: -11.2 kcal/mol)

Same tools, completely different domain. Outlinks in search results trace the citation chain -- AlphaFold paper → structure prediction experiment → docking screen. Flywheel doesn't know biology. It knows graph structure, and graph structure is universal.

---

## Phase 6: Your Own Vault

Ready to point Flywheel at your own vault? See the [full setup guide](SETUP.md) for:

- [[Claude Desktop Config|MCP config]] for [[Claude Code]] and Claude Desktop
- Tool preset recommendations
- Semantic search enablement

Quick version:

1. Add `.mcp.json` to your vault root with the Flywheel server config
2. `cd /path/to/your/vault && claude`
3. Start asking questions

See [SETUP.md](SETUP.md) for the complete walkthrough.

---

## What You Just Proved

1. **Tests pass** -- 2,712 of them, against real data
2. **Graph queries work** -- backlinks + metadata, no file reads
3. **Auto-wikilinks work** -- plain text in, linked text out
4. **The algorithm is transparent** -- scores with explanations, not black boxes
5. **Domain-independent** -- consulting, cognitive science, computational biology, your vault
6. **Zero cloud dependencies** -- everything ran on your machine

---

## Why It's Efficient

Flywheel's enriched search returns frontmatter, ranked backlinks, ranked outlinks, and content snippets in a single call. Most queries that would otherwise need 5-10 file reads can be answered from one search result. Fewer tool calls means less context, faster responses, and lower cost — regardless of which model or pricing tier you use.

---

## Next Steps

- **[SETUP.md](SETUP.md)** -- Full setup guide for your own vault
- **[TOOLS.md](TOOLS.md)** -- Reference for all 74 tools
- **[ALGORITHM.md](ALGORITHM.md)** -- How scoring, ranking, and wikilink suggestion work
- **[COOKBOOK.md](COOKBOOK.md)** -- Example prompts by use case
