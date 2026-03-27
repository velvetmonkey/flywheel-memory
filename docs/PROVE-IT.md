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
- [Reproduce Our Numbers](#reproduce-our-numbers)
  - [1. Unit Tests (2,712 passed)](#1-unit-tests-2712-passed)
  - [2. HotpotQA Retrieval Benchmark (91.7% recall, 500 questions)](#2-hotpotqa-retrieval-benchmark-917-recall-500-questions)
  - [3. LoCoMo E2E Benchmark (65% single-hop, 759 questions)](#3-locomo-e2e-benchmark-65-single-hop-759-questions)
- [What You Just Proved](#what-you-just-proved)
- [Why It's Efficient](#why-its-efficient)
- [Next Steps](#next-steps)

---

## Prerequisites

- **Node.js 22–24** -- check with `node --version`.
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

**What happened:** Flywheel's enriched search returned frontmatter (amounts, status), backlinks, and outlinks for every hit -- all in one call. Zero file reads needed. The answer was in the search result itself.

Without Flywheel, Claude would grep for "Acme" and scan matching files. The real win shows in structural queries like "what are the hub notes?" or "what's the shortest path between X and Y?" — those need a graph, not file reads.

---

## Phase 3: Watch Auto-Wikilinks

Still in carter-strategy, tell Claude:

> Log that Stacy Thompson is starting on the Beta Corp Dashboard and reviewed the API Security Checklist

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

- MCP config for Claude Code and Claude Desktop
- Tool preset recommendations
- Semantic search enablement

Quick version:

1. Add `.mcp.json` to your vault root with the Flywheel server config
2. `cd /path/to/your/vault && claude`
3. Start asking questions

See [SETUP.md](SETUP.md) for the complete walkthrough.

---

## Reproduce Our Numbers

Three headline benchmarks, three sets of instructions. Each is self-contained and copy-pasteable.

### 1. Unit Tests (2,712 passed)

**What it proves:** Every tool handler, search index, graph traversal, mutation engine, security boundary, and concurrency path works correctly against real vaults and real SQLite databases. No external service mocks.

**Prerequisites:**
- Node.js 22+ (`node --version`)
- git

**Run:**

```bash
git clone https://github.com/velvetmonkey/flywheel-memory.git
cd flywheel-memory
npm install
npm test
```

**Expected output:**

```
Test Suites: 129 passed, 129 total
Tests:       2,712 passed, 2,712 total
Snapshots:   0 total
Time:        ~18s
```

`npm test` runs `vitest run` across all three workspace packages (vault-core, flywheel-memory, flywheel-bench). The mcp-server package contains the vast majority of tests. No network access, no API keys, no Docker -- just Node and SQLite.

**Estimated time:** ~1 minute (install) + ~18 seconds (tests).

---

### 2. HotpotQA Retrieval Benchmark (91.7% recall, 500 questions)

**What it proves:** Flywheel's search finds 92% of supporting documents on a standard multi-hop QA dataset from CMU/Stanford -- beating BM25 baselines by +17pp and exceeding purpose-built neural retrievers that were trained on the dataset.

**Prerequisites:**
- Everything from step 1 (repo cloned, `npm install` done)
- MCP server built: `npm run build`
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI authenticated (`claude --version`)
- Python 3 (for analysis script)
- Anthropic API credits (~$0.058/question)

**Step 1: Build the benchmark vault**

The vault builder downloads the HotpotQA dev-distractor dataset (~85 MB, cached in `~/.cache/flywheel-bench/`), samples 500 questions with seed 42, and writes each Wikipedia context paragraph as a markdown note with heuristic-inferred `type:` frontmatter.

```bash
cd flywheel-memory
node demos/hotpotqa/build-vault.js --count 500 --seed 42
```

This creates `demos/hotpotqa/vault/` (~4,960 docs) and `demos/hotpotqa/ground-truth.json`.

**Step 2: Run the benchmark**

```bash
COUNT=500 demos/hotpotqa/run-benchmark.sh
```

What happens under the hood:

1. **Pre-warm** (1 Claude Haiku session): `health_check` -> `vault_init` (auto-link) -> `refresh_index` -> `init_semantic` (embeddings) -> `health_check`. This matches production usage -- Flywheel indexes and links the vault before questions start.
2. **500 questions** (500 individual Claude Sonnet sessions): Each question gets its own `claude -p` session with `--strict-mcp-config` (no filesystem access, vault tools only). Claude decides which tools to call. Non-MCP tools (Bash, Grep, Read, etc.) are stripped via `--disallowedTools`.
3. **Analysis**: Python script parses JSONL output, computes document recall against ground truth.

Results land in `demos/hotpotqa/results/run-<timestamp>/`.

**Step 3: Read the report**

```bash
cat demos/hotpotqa/results/run-*/report.md
```

**Expected results:**

| Metric | Expected |
|---|---|
| Document Recall | ~92% (917/1000 supporting docs found) |
| Full Recall (both docs) | ~84% (418/500) |
| Partial Recall (at least 1 doc) | ~99.8% (499/500) |

Exact numbers vary by a few percentage points between runs due to LLM non-determinism. The 91.7% headline is from seed 42 with Sonnet.

**Estimated time:** ~2-3 hours for 500 questions (each question is a separate Claude session).
**Estimated cost:** ~$29 (500 questions x ~$0.058/question).

**Smaller test run:** To verify the pipeline works before committing to the full 500:

```bash
COUNT=20 demos/hotpotqa/run-benchmark.sh
```

This runs 20 questions in ~10 minutes for ~$1.25.

---

### 3. LoCoMo E2E Benchmark (65% single-hop, 759 questions)

**What it proves:** Flywheel retrieves evidence and answers questions about long-term conversational memory better than Mem0, Zep, LangMem, and MemGPT -- all measured on the same LoCoMo dataset from Snap Research (ACL 2024).

**Prerequisites:**
- Everything from step 1 (repo cloned, `npm install` done)
- MCP server built: `npm run build`
- Claude Code CLI authenticated
- Python 3
- Anthropic API credits (~$0.085/question for answers, plus ~$0.01/question for LLM-as-judge)

**Step 1: Build the benchmark vault**

The vault builder downloads the LoCoMo-10 dataset (~2 MB, cached in `~/.cache/flywheel-bench/`). Each conversation session becomes a markdown note with frontmatter dates, speaker arrays, and dialog turns. People get stub notes in a `people/` folder.

```bash
cd flywheel-memory
node demos/locomo/build-vault.js --mode dialog
```

This creates `demos/locomo/vault/` (~290 notes: 272 session notes + 18 people stubs) and `demos/locomo/ground-truth.json` (~1,986 QA pairs across 5 categories).

**Step 2: Run the benchmark**

```bash
COUNT=759 SEED=42 demos/locomo/run-benchmark.sh
```

What happens under the hood:

1. **Pre-warm** (1 Claude Haiku session with `full,memory` preset): `health_check` -> `vault_init` (auto-link) -> `refresh_index` -> `init_semantic` (embeddings) -> `health_check`.
2. **Stratified sampling**: Python selects 759 questions balanced across all 5 categories (commonsense, single-hop, multi-hop, temporal, adversarial) and all 10 conversations.
3. **759 questions** (759 individual Claude Sonnet sessions): Each question gets its own `claude -p` session. Claude is told notes are conversation sessions and uses search + read tools to find evidence and answer.
4. **Analysis**: Python script computes evidence recall and token F1 per category.

Results land in `demos/locomo/results/run-<timestamp>/`.

**Step 3: Run LLM-as-judge scoring**

The headline accuracy numbers use LLM-as-judge (Claude Haiku scoring each answer as CORRECT/WRONG), matching the Mem0 paper methodology:

```bash
python3 demos/locomo/analyze-benchmark.py \
  demos/locomo/results/run-<timestamp> \
  demos/locomo/ground-truth.json \
  --judge
```

Replace `<timestamp>` with the actual run directory name.

**Step 4: Read the report**

```bash
cat demos/locomo/results/run-*/report.md
```

**Expected results (answer accuracy, LLM-as-judge):**

| Category | Questions | Expected Accuracy | 95% CI |
|---|---|---|---|
| Overall | 759 | ~58.8% | [55.2%, 62.2%] |
| Single-hop | 130 | ~65.4% | [56.9%, 73.0%] |
| Commonsense | 311 | ~75.6% | [70.5%, 80.0%] |
| Adversarial | 173 | ~46.8% | [39.5%, 54.2%] |
| Multi-hop | 113 | ~28.3% | [20.8%, 37.2%] |
| Temporal | 32 | ~40.6% | [25.5%, 57.7%] |

**Expected results (evidence recall):**

| Category | Expected Recall |
|---|---|
| Overall | ~84.9% |
| Single-hop | ~93.9% |
| Commonsense | ~94.2% |
| Multi-hop | ~67.5% |
| Temporal | ~63.3% |

**Estimated time:** ~4-6 hours for 759 questions + ~1 hour for judge scoring.
**Estimated cost:** ~$65 for answer sessions (759 x ~$0.085) + ~$8 for judge scoring. Total ~$73.

**Smaller test run:** To verify the pipeline:

```bash
COUNT=30 demos/locomo/run-benchmark.sh
```

This runs 30 questions in ~15 minutes for ~$2.50.

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
- **[TOOLS.md](TOOLS.md)** -- Reference for all 75 tools
- **[ALGORITHM.md](ALGORITHM.md)** -- How scoring, ranking, and wikilink suggestion work
- **[COOKBOOK.md](COOKBOOK.md)** -- Example prompts by use case
