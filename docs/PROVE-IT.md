# Prove It

> Clone. Run. See. 5 minutes.

No screenshots. No demos on someone else's machine. Clone the repo, run the tests, try the tools. Everything below runs on your hardware in your terminal.

---

## Prerequisites

- **Node.js 18–22** -- check with `node --version`. Node 24 does not ship prebuilt `better-sqlite3` binaries and will fail to install.
- **Claude Code** -- authenticated and working (`claude --version`)
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
Test Suites: 42 passed, 42 total
Tests:       1,812 passed, 1,812 total
Snapshots:   0 total
Time:        ~18s
```

1,812 tests. All passing. No mocks of external services -- these are real SQLite queries, real file parsing, real graph traversals against real vaults. If something is broken, you know in 18 seconds.

---

## Phase 2: First Graph Query

Open the solo-consultant demo vault:

```bash
cd demos/carter-strategy
claude
```

Ask Claude:

> How much have I billed Acme Corp?

Watch the tool trace:

```
● flywheel › get_backlinks
  path: "clients/Acme Corp.md"
  ← invoices/INV-2025-047.md
    invoices/INV-2025-048.md
    projects/Acme Data Migration.md
    proposals/Acme Analytics Add-on.md

● flywheel › get_note_metadata
  path: "invoices/INV-2025-047.md"
  ← amount: 15000, status: paid

● flywheel › get_note_metadata
  path: "invoices/INV-2025-048.md"
  ← amount: 12000, status: pending
```

**What happened:** Claude didn't read any files. It navigated the knowledge graph -- backlinks to find related notes, metadata to extract the numbers. 4 tool calls. ~160 tokens. 0 files opened.

The same question without Flywheel would require reading every markdown file in the vault to find two invoice amounts.

---

## Phase 3: Watch Auto-Wikilinks

Still in carter-strategy, tell Claude:

> Log that I finished the Acme strategy deck and prepped the TechStart proposal

Watch the output:

```
● flywheel › vault_add_to_section
  path: "daily-notes/2026-01-04.md"
  section: "Log"
  content: "finished the [[Acme Corp]] strategy deck and prepped the [[TechStart Phase 2]] proposal"
```

"Acme Corp" and "TechStart Phase 2" were auto-linked to existing notes. You typed plain text -- Flywheel scanned every note title and alias in the vault, found matches, and wrapped them in `[[wikilinks]]`.

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
● flywheel › get_forward_links
  path: "literature/Jumper2021-AlphaFold.md"
  → [[Transformer Architecture]], [[Structure-Based Drug Design]]

● flywheel › get_backlinks
  path: "literature/Jumper2021-AlphaFold.md"
  → experiments/Experiment-2024-10-28.md (AlphaFold EGFR)
  → experiments/Experiment-2024-11-22.md (docking)

● flywheel › get_note_metadata
  path: "experiments/Experiment-2024-10-28.md"
  → status: completed, pLDDT: 94.2, RMSD: 0.8A
```

**Connection path (3 hops):**
Jumper2021 (AlphaFold) -> Experiment-2024-10-28 (EGFR structure) -> Experiment-2024-11-22 (docking screen, Compound_472: -11.2 kcal/mol)

Same tools, completely different domain. Flywheel doesn't know anything about biology or consulting or Zettelkasten. It knows graph structure, and graph structure is universal.

---

## Phase 6: Your Own Vault

Ready to point Flywheel at your own vault? See the [full setup guide](SETUP.md) for:

- MCP config for Claude Code and Claude Desktop
- Tool preset recommendations
- CLAUDE.md persona file setup
- Semantic search enablement

Quick version:

1. Add `.mcp.json` to your vault root with the Flywheel server config
2. `cd /path/to/your/vault && claude`
3. Start asking questions

See [SETUP.md](SETUP.md) for the complete walkthrough.

---

## What You Just Proved

1. **Tests pass** -- 1,812 of them, against real data
2. **Graph queries work** -- backlinks + metadata, no file reads
3. **Auto-wikilinks work** -- plain text in, linked text out
4. **The algorithm is transparent** -- scores with explanations, not black boxes
5. **Domain-independent** -- consulting, cognitive science, computational biology, your vault
6. **Zero cloud dependencies** -- everything ran on your machine

---

## Next Steps

- **[SETUP.md](SETUP.md)** -- Full setup guide for your own vault
- **[TOOLS.md](TOOLS.md)** -- Reference for all 42 tools
- **[ALGORITHM.md](ALGORITHM.md)** -- How scoring, ranking, and wikilink suggestion work
- **[COOKBOOK.md](COOKBOOK.md)** -- Example prompts by use case
