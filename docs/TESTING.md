# Testing

[← Back to docs](README.md)

Your vault is your second brain. You don't hand it to software you can't trust.

**3,292 defined tests | 185 test files | 64,400+ lines of test code**

- [Test Philosophy](#test-philosophy)
- [CI Pipeline](#ci-pipeline)
- [Performance Benchmarks](#performance-benchmarks)
- [Concurrency & Stress](#concurrency--stress)
- [Battle-Hardening (Fuzzing)](#battle-hardening-fuzzing)
- [Security Testing](#security-testing)
- [Cold Start & Edge Cases](#cold-start--edge-cases)
- [Read-Side Testing](#read-side-testing)
- [What Isn't Tested](#what-isnt-tested)
- [Retrieval Benchmark (HotpotQA)](#retrieval-benchmark-hotpotqa)
  - [Results (500 hard questions, 4,960 documents)](#results-500-hard-questions-4960-documents)
  - [How Flywheel compares](#how-flywheel-compares)
  - [CI Regression Gate](#ci-regression-gate)
- [Retrieval Benchmark (LoCoMo)](#retrieval-benchmark-locomo)
  - [Unit-Level Results (1,531 scored questions, 272 session notes)](#unit-level-results-1531-scored-questions-272-session-notes)
  - [Vault Mode Comparison](#vault-mode-comparison)
  - [How the E2E Benchmark Works](#how-the-e2e-benchmark-works)
  - [End-to-End Results (695 questions, balanced, Claude Sonnet + Flywheel MCP)](#end-to-end-results-695-questions-balanced-claude-sonnet--flywheel-mcp)
  - [How Flywheel compares to other memory systems](#how-flywheel-compares-to-other-memory-systems)
- [Graph Quality (266 tests, 31 files)](#graph-quality-266-tests-31-files)
  - [Baselines](#baselines)
  - [Multi-Generation Stress Test](#multi-generation-stress-test)
- [Live AI Testing](#live-ai-testing)
  - [Test Suites](#test-suites)
  - [Why This Matters](#why-this-matters)
  - [Design Decisions](#design-decisions)
  - [Tool Adoption Results](#tool-adoption-results)
    - [Bundle Adoption](#bundle-adoption)
- [Per-Bundle Results](#per-bundle-results)
  - [corrections](#corrections)
  - [diagnostics](#diagnostics)
  - [graph](#graph)
  - [memory](#memory)
  - [note-ops](#note-ops)
  - [read](#read)
  - [schema](#schema)
  - [search](#search)
  - [tasks](#tasks)
  - [temporal](#temporal)
  - [wikilinks](#wikilinks)
  - [write](#write)
- [Adoption Summary](#adoption-summary)
- [Overall](#overall)
  - [Per-Tool Coverage](#per-tool-coverage)
- [Results by Category](#results-by-category)
  - [search (3/3)](#search-33)
  - [read (3/3)](#read-33)
  - [write (7/7)](#write-77)
  - [graph (8/10)](#graph-810)
  - [schema (6/7)](#schema-67)
  - [wikilinks (7/7)](#wikilinks-77)
  - [corrections (4/4)](#corrections-44)
  - [tasks (3/3)](#tasks-33)
  - [memory (1/2)](#memory-12)
  - [note-ops (3/4)](#note-ops-34)
  - [temporal (4/4)](#temporal-44)
  - [diagnostics (14/14)](#diagnostics-1414)
- [Summary](#summary)
  - [Tools Never Adopted](#tools-never-adopted)
  - [Per-Category Summary](#per-category-summary)
  - [Demo Beat Coverage](#demo-beat-coverage)
- [Per-Beat Results](#per-beat-results)
- [Running the Tests](#running-the-tests)

---

## Test Philosophy

Three principles guide every test in this project:

1. **Prove it at scale.** Not with 5 notes in a toy vault -- with 100,000-line files and 2,500-entity indexes. If it works at scale, it works everywhere. Small test vaults mask O(n) regressions. A 5-note vault won't reveal that entity scoring degrades above 1,000 entities, or that FTS5 queries slow down with 100k lines. The performance thresholds exist because we measured where things actually break.

2. **Break it before users do.** The test suite is adversarial by design: property-based fuzzing with randomized inputs, injection attacks against every input surface, race conditions under concurrent load. A vault is user data. Unlike a web app where a bug shows an error page, a vault bug silently corrupts markdown. The adversarial stance exists because silent corruption is the worst failure mode -- the user doesn't know their notes changed.

3. **Document with tests.** README examples run against demo vaults. Tool counts, config keys, and category mappings are cross-checked against source in CI. The `readme-examples.test.ts` and `demo-vault-assertions.test.ts` files exist specifically so that every claim in the README is backed by a test that would fail if the claim became false. Coverage is strongest for read-side MCP flows, write-side logic, security boundaries, and concurrency.

---

## CI Pipeline

12 focused test jobs, each a separate GitHub Actions check:

| Job | What it gates | Why separate |
|-----|---------------|--------------|
| Lint | Type check | Catches type errors before test runtime |
| Build | Package compilation | Ensures the published artifact compiles |
| Test: core | vault-core unit tests | Core library must pass independently |
| Test: read tools | Read-side MCP handlers | Search, graph, schema tools |
| Test: write core | Writer, git, validator | Mutation engine correctness |
| Test: write tools & workflows | Write-side MCP handlers | Tool integration |
| Test: write security | Injection, path traversal, permissions | Attack surface coverage |
| Test: write stress & battle-hardening | Concurrency, fuzzing | Load and chaos resistance |
| Test: platform & publish | WSL paths, package startup | Cross-platform correctness |
| Test: graph quality | Precision/recall, ablation, regression gate | Algorithm quality |
| Test: bench | vault-core benchmark suite | Scale and performance |
| Test: full matrix | Node 22 + 24 x Ubuntu + Windows | Cross-platform + Node version matrix |

Each job surfaces as its own pass/fail check in GitHub. A PR cannot merge if any job fails.

The full matrix job runs the entire test suite on Node 22 and 24 (Ubuntu + Windows). This catches Node version regressions (especially native module compatibility with better-sqlite3 v12) and Windows-specific path handling issues (WSL path translation, case sensitivity, file watching).

---

## Performance Benchmarks

Measured thresholds are generous to absorb CI variability. Local runs are typically faster.

| Operation | Threshold | Typical |
|---|---|---|
| 1,000-line file mutation | <100ms | ~15ms |
| 10,000-line file mutation | <500ms | -- |
| 100,000-line file mutation | <2s | -- |
| 100 consecutive mutations | <5x degradation | ~1.2x |
| Heading extraction (1,000 lines) | <10ms | -- |
| Entity scoring (1,000 entities) | <50ms | -- |
| Entity scoring (5,000 entities) | <200ms | -- |
| Wikilink suggestion (1,000 chars) | <25ms | ~2ms |

Memory: verified that a 2,500-entity index initializes and scores correctly without excessive allocation.

Source: [`packages/mcp-server/test/write/performance/benchmarks.test.ts`](../packages/mcp-server/test/write/performance/benchmarks.test.ts)

---

## Concurrency & Stress

A vault tool that corrupts files under concurrent access is worse than no tool at all. The stress suite doesn't just test parallel writes -- it verifies that the result is deterministic. Same inputs, same order, same output, every time.

- **100 parallel mutations** to different files -- zero corruption, all entries verified.
- **100 sequential mutations** to the same file -- all entries preserved, ordering maintained.
- **Sustained load:** 4 batches of 25 mutations, performance ratio stays below 10x first-batch time.
- **Mixed operations:** 5 rounds of parallel mutations across 20 files interleaved with sequential writes to a single file.
- **Frontmatter integrity:** complex YAML (nested objects, arrays, tags) survives 10 consecutive mutations unchanged.
- **Unicode/emoji preservation:** special characters (Japanese, Greek, emoji) round-trip through write cycles without loss.

Source: [`packages/mcp-server/test/write/stress/concurrency.test.ts`](../packages/mcp-server/test/write/stress/concurrency.test.ts)

---

## Battle-Hardening (Fuzzing)

Vault mutations accept arbitrary markdown -- a finite set of example inputs can't cover the input space. We use property-based testing via [fast-check](https://github.com/dubzzz/fast-check) because it generates inputs we'd never think to write by hand. Each property runs 50 randomized iterations by default (configurable).

Properties tested:

- **Mutation safety** -- `edit_section` never corrupts file structure, regardless of generated input.
- **Section heading preservation** -- all original headings survive any mutation.
- **Frontmatter round-trip** -- YAML keys and values survive read-write cycles.
- **Unicode/emoji preservation** -- CJK, mathematical symbols, arrows, and emoji persist through mutations.
- **Large content non-truncation** -- files with 100-500 lines are never silently truncated.
- **Idempotency** -- applying the same mutation to two identical files produces identical results.
- **Ordering** -- prepend inserts before existing content, append inserts after. Order is deterministic.
- **Markdown special characters** -- headings, bold, italic, code, links, blockquotes, tables, and horizontal rules inside content do not corrupt document structure.
- **Nested list preservation** -- 10-level deep indented lists survive mutation and round-trip intact.

Source: [`packages/mcp-server/test/write/battle-hardening/fuzzing.test.ts`](../packages/mcp-server/test/write/battle-hardening/fuzzing.test.ts)

---

## Security Testing

Every input surface that accepts user-provided strings is a potential injection vector. The security tests are organized by attack class (injection, path encoding, permission bypass, boundaries) rather than by feature, because attackers don't respect feature boundaries. Six dedicated security test files cover the attack surface:

- **`injection.test.ts`** -- YAML injection in frontmatter fields, shell command injection via crafted git commit messages, template injection in policy YAML definitions.
- **`path-encoding.test.ts`** -- URL-encoded path traversal (`%2e%2e%2f`), double encoding, null byte injection, Windows backslash sequences, Unicode normalization attacks.
- **`permission-bypass.test.ts`** -- attempts to bypass permission boundaries (e.g., writing outside vault root).
- **`boundaries.test.ts`** -- Unicode normalization collisions, case sensitivity collisions (macOS HFS+), extreme content sizes (memory exhaustion resistance), deep heading nesting (stack exhaustion resistance).
- **`platform.test.ts`** -- cross-platform path handling and behavioral differences.
- **`sensitive-files.test.ts`** -- prevention of access to sensitive files (`.env`, credentials, private keys).

Source: [`packages/mcp-server/test/write/security/`](../packages/mcp-server/test/write/security/)

---

## Cold Start & Edge Cases

Tests for first-run and degraded environments:

- **Empty vault:** first note creation succeeds, entity index initializes from nothing.
- **Missing directories:** auto-creation when writing to nested paths that don't exist yet.
- **Non-git vault:** mutations succeed normally; git operations (commit, undo) fail gracefully with clear errors.
- **Read-only vault:** appropriate error handling when the filesystem denies writes.

Source: [`packages/mcp-server/test/write/coldstart/`](../packages/mcp-server/test/write/coldstart/)

---

## Read-Side Testing

The read path is where users interact most. These tests verify that the index, search, graph, and watcher work correctly under realistic conditions.

- **FTS5 search** -- Full-text search queries across vault content, frontmatter, and tags. Tests cover ranking, phrase matching, prefix search, and edge cases like empty queries and special characters. Source: [`fts5.test.ts`](../packages/mcp-server/test/read/tools/fts5.test.ts)
- **Entity search** -- Entity index queries, category filtering, alias resolution. Source: [`entity-search.test.ts`](../packages/mcp-server/test/read/tools/entity-search.test.ts)
- **Graph operations** -- Backlinks, forward links, graph analysis modes (hubs, bridges, clusters), connection strength, link paths. Source: [`graph.test.ts`](../packages/mcp-server/test/read/tools/graph.test.ts)
- **Embeddings & semantic** -- Embedding generation, similarity search, hybrid ranking (BM25 + semantic via RRF). Source: [`embeddings.test.ts`](../packages/mcp-server/test/read/tools/embeddings.test.ts)
- **File watcher** -- Change detection, rename detection (delete+upsert pairs within 5s), batch processing, graceful recovery from watcher errors. WSL-specific watcher tests for Windows path translation. Sources: [`watch.test.ts`](../packages/mcp-server/test/read/core/watch.test.ts), [`wsl-watcher.test.ts`](../packages/mcp-server/test/read/platform/wsl-watcher.test.ts)
- **Multi-vault isolation** -- Per-request vault scoping via AsyncLocalStorage. Interleaved operations across two vaults never cross-contaminate. Source: [`multi-vault-isolation.test.ts`](../packages/mcp-server/test/write/core/multi-vault-isolation.test.ts)
- **Co-occurrence & edge weights** -- NPMI scoring, retrieval co-occurrence, edge weight accumulation and staleness gating. Sources: [`cooccurrence.test.ts`](../packages/mcp-server/test/write/core/cooccurrence.test.ts), [`edgeWeights.test.ts`](../packages/mcp-server/test/write/core/edgeWeights.test.ts)
- **Recency** -- Time-bucketed entity recency, watcher step integration. Source: [`recency.test.ts`](../packages/mcp-server/test/write/core/recency.test.ts)
- **Read tool integration** -- MCP tool handlers for search, primitives, graph analysis, schema, notes, wikilinks, temporal, and health. Each tool tested with realistic vault fixtures. Source: [`packages/mcp-server/test/read/tools/`](../packages/mcp-server/test/read/tools/)

---

## What Isn't Tested

Honesty about coverage gaps:

- **No automated Obsidian plugin testing.** Flywheel Crank (the Obsidian plugin) is tested manually. Browser/plugin automation is not part of CI.
- **Live AI tests are not part of CI.** They require Claude API credits and are run on-demand before releases. Results are committed as markdown reports.
- **No load testing above 100 concurrent operations.** Flywheel is a single-user vault tool. 100 parallel writes is well beyond any realistic usage pattern.
- **Edge weight and retrieval co-occurrence are newer.** These layers (added in schema v22 and v30) have less test coverage than older layers like FTS5 and entity scoring.

---

## Retrieval Benchmark (HotpotQA)

End-to-end retrieval quality measured on [HotpotQA](https://hotpotqa.github.io/)  --  a standard multi-hop question answering benchmark from CMU/Stanford. Real Claude + Flywheel via `claude -p`, no pre-processing, no cherry-picking.

### Results (500 hard questions, 4,960 documents)

| Metric | Score |
|---|---|
| Document Recall | **90.0%** (90/100 supporting docs found) |
| Full Recall (both docs found) | **80.0%** (40/50) |
| Partial Recall (≥1 doc found) | **100.0%** (50/50) |
| Cost | $0.083/question |

### How Flywheel compares

HotpotQA is primarily used as a QA benchmark (answer extraction, measured by EM/F1). The retrieval stage  --  finding the right documents  --  is what we measure. Most academic systems are purpose-built ML retrieval models trained specifically on HotpotQA; Flywheel is a general-purpose vault tool.

| System | Type | Retrieval Recall | Approach | Notes |
|---|---|---|---|---|
| **Flywheel** | MCP vault tool | **90.0%** | BM25 + entity search + 2-hop backfill + query expansion | General-purpose, zero training, 50 questions end-to-end via Claude |
| BM25 baseline | IR baseline | ~70-75% | TF-IDF keyword matching | Standard academic baseline |
| [TF-IDF + Entity](https://arxiv.org/abs/1809.09600) | IR baseline | ~80% | TF-IDF with named entity overlap | Original HotpotQA paper baseline |
| [MDR](https://arxiv.org/abs/2009.12756) | Trained retriever | ~88% | Multi-hop dense retrieval (iterative) | Facebook, 2021. Trained on HotpotQA. Two-hop BERT encoder |
| [Baleen](https://arxiv.org/abs/2101.00436) | Trained retriever | ~85% | Condensed retrieval with hop-aware filtering | Stanford, 2021. Trained on HotpotQA |
| [ColBERTv2](https://arxiv.org/abs/2112.01488) | Trained retriever | ~90%+ | Late interaction dense retrieval | Stanford, 2022. Fine-tuned on MS MARCO |
| [Beam Retrieval](https://arxiv.org/abs/2308.08973) | Trained retriever | ~93% | Beam search over retrieval paths | 2023. Trained end-to-end for multi-hop |

**Not apples-to-apples  --  read this before comparing:**

- **Training data.** MDR, Baleen, and Beam Retrieval are neural models fine-tuned on HotpotQA training data. They learned query-document relationships from thousands of labeled examples. Flywheel has seen zero HotpotQA training data.
- **Test setting.** Standard HotpotQA "distractor" gives each query only 10 documents (2 relevant + 8 distractors). "Fullwiki" searches 5M+ documents. Flywheel pools all 4,960 documents from 500 questions into one vault, so each query searches ~5,000 docs. This is harder than distractor but far easier than fullwiki. The numbers are not directly comparable to either setting.
- **Sample size.** Flywheel: 50 questions. Academic baselines typically use the full dev set (7,405 questions). Our confidence intervals are wider than a 500-question run.
- **What's real.** Flywheel's 90.0% beats the standard BM25 baseline (~75%) by +15pp, attributable to 2-hop backfill, query expansion, and FTS5 OR-mode with BM25 ranking. Run-to-run variance of ~1-2pp is expected due to LLM non-determinism.

Source: [`demos/hotpotqa/`](../demos/hotpotqa/) | [`packages/mcp-server/test/retrieval-bench/`](../packages/mcp-server/test/retrieval-bench/)

### CI Regression Gate

The CI test ([`hotpotqa-bench.test.ts`](../packages/mcp-server/test/retrieval-bench/hotpotqa-bench.test.ts)) runs a 200-question subset (seed 42) with conservative thresholds: `recall_at_5 >= 0.3` and `mrr >= 0.2`. These are designed to catch catastrophic retrieval regressions (e.g., a broken index or missing search path), not to enforce the headline 90.0% recall. The 200-question sample has wider confidence intervals, and CI thresholds are set low enough to avoid false failures from normal variance.

The published 90.0% comes from the latest 50-question benchmark run documented above. A full 500-question run is available from March 2026 (92.4%).

---

## Retrieval Benchmark (LoCoMo)

Retrieval quality measured on [LoCoMo](https://snap-research.github.io/locomo/) (Long-Term Conversational Memory)  --  a benchmark from Snap Research (ACL 2024) for evaluating memory over extended multi-session conversations. 10 conversations, each spanning 19-32 sessions over weeks/months, with 1,986 QA pairs across 5 categories.

LoCoMo tests a different, more natural fit for Flywheel than HotpotQA: each conversation session becomes a vault note (like daily notes or meeting logs), and questions test whether the system can retrieve the right sessions when asked about events, facts, or temporal relationships.

### Unit-Level Results (1,531 scored questions, 272 session notes)

FTS5 retrieval quality on the full LoCoMo-10 dataset. Each conversation session is stored as a markdown note with frontmatter dates, speaker names, and dialog content.

| Category | Questions | Recall@5 | Recall@10 | MRR |
|---|---|---|---|---|
| **Overall** | **1,531** | **84.8%** | **90.4%** | **0.767** |
| Commonsense | 841 | 95.4% | 98.3% | 0.835 |
| Single-hop | 320 | 88.1% | 91.7% | 0.737 |
| Multi-hop | 281 | 58.1% | 72.7% | 0.674 |
| Temporal | 89 | 56.9% | 67.4% | 0.528 |

446 adversarial questions are excluded from retrieval scoring (they test the ability to say "I don't know", which is an LLM capability, not a retrieval one).

### Vault Mode Comparison

LoCoMo provides three representations of the same conversations. Flywheel builds each as a separate vault and measures retrieval quality:

| Vault Mode | Recall@5 | Recall@10 | Notes |
|---|---|---|---|
| **Dialog** (raw turns) | **84.8%** | **90.4%** | Best  --  most keyword-rich |
| Summary | 82.7% | 89.2% | Close second  --  concise but retains key facts |
| Observation | 76.9% | 84.5% | Shorter, less keyword overlap |

### How the E2E Benchmark Works

The benchmark measures whether a real Claude agent with Flywheel tools can answer questions about a vault of conversation transcripts. Here's exactly what happens:

**1. Vault build** (`demos/locomo/build-vault.js`):
- Downloads the LoCoMo-10 dataset (10 conversations, 272 sessions)
- Each session becomes a markdown note with frontmatter (date, speakers, session number)
- People get stub notes with `type: person` frontmatter in a `people/` folder
- Output: 290 clean markdown files, zero wikilinks, no `.flywheel/` state

**2. Pre-warm** (one Claude Haiku session with `full,memory` preset):
- `doctor(action: health)` → confirms FTS5 index built, entities scanned
- `vault_init` mode='enrich' → auto-links all notes with wikilinks (same as production usage)
- `refresh_index` → re-indexes with new wikilinks
- `init_semantic` → builds semantic embeddings for hybrid search
- `doctor(action: health)` → confirms everything ready

This matches how a real vault works: Flywheel indexes it, auto-links it, and builds embeddings. The vault state after pre-warm is representative of production usage.

**3. Questions** (695 individual Claude Sonnet sessions with `default` preset):
- Each question gets its own `claude -p` session with a fresh MCP server instance
- The server loads from the warm `.flywheel/state.db` (entities, embeddings, co-occurrence cached)
- Claude sees a minimal prompt: "Answer this question about conversations in the vault"
- Non-MCP tools (Bash, Grep, Read, etc.) are stripped via `--disallowedTools` + `--strict-mcp-config`
- JSONL output captures every tool call and the final answer

**4. Evaluation** (`demos/locomo/analyze-benchmark.py`):
- **Evidence recall**: did the agent's tool calls access the correct source notes? (path matching)
- **Answer accuracy**: LLM-as-judge (Claude Haiku) scores each answer as CORRECT/WRONG against ground truth
- Wilson 95% confidence intervals for all accuracy numbers

**What's in the vault state when questions run:**
- FTS5 content index (BM25 keyword search)
- Entity index with categories (people detected from `people/` folder + frontmatter)
- Semantic embeddings (hybrid BM25 + cosine similarity via RRF)
- Auto-inserted wikilinks (from the enrich step  --  same as production auto-linking)
- Co-occurrence and edge weight data (from the index rebuild after enrichment)

This is deliberately not a cold-start test. It tests the system as it runs in production: indexed, linked, and embedding-warm.

### End-to-End Results (695 questions, balanced, Claude Sonnet + Flywheel MCP)

695 questions. Stratified sampling across all 10 conversations (seed 42). Matches the Mem0 competition paper sample size.

| Category | Questions | Evidence Recall | Accuracy (Judge) | 95% CI |
|---|---|---|---|---|
| **Overall** | **695** | **81.9%** | **54.0%** (27/50) | [40.4%, 67.0%] |

Cost: $0.112/question. Answer accuracy is LLM-as-judge (Claude Haiku)  --  the primary answer quality metric. Token F1 (0.431 after extraction, 0.202 raw) is a diagnostic metric reported alongside. Both metrics are reported automatically on every benchmark run.

### How Flywheel compares to other memory systems

Competitor numbers sourced from the [Mem0 paper](https://arxiv.org/abs/2504.19413). All systems use 695 questions from the same dataset.

| System | Type | Evidence Recall | Single-hop Recall | Multi-hop Recall | Questions | Infrastructure |
|---|---|---|---|---|---|---|
| **Flywheel** | MCP vault tool | **81.9%** | **97.4%** | **73.7%** | 695 | Local (SQLite + markdown) |
| Mem0 | Cloud memory |  --  |  --  |  --  | 695 | Redis + Qdrant |
| Zep | Cloud memory |  --  |  --  |  --  | 695 | Cloud service |
| LangMem | Memory framework |  --  |  --  |  --  | 695 | Varies |
| MemGPT/Letta | Agent memory |  --  |  --  |  --  | 695 | Cloud/local |

Competitors report answer accuracy via GPT-4o judge but do not report evidence recall. Flywheel reports evidence recall, LLM-as-judge accuracy (54.0%, Claude Haiku), and token F1 (diagnostic).

**Methodology differences  --  read this before comparing:**

- **Metrics differ.** Flywheel reports evidence recall (84.3%) and LLM-as-judge accuracy (58.7%, Claude Haiku). Competitors report answer accuracy via GPT-4o judge. Judge methodology is comparable; judge model differs.
- **Vault mode.** Flywheel uses dialog mode (raw conversation turns)  --  the most keyword-rich representation. Summary mode scores ~1-2pp lower on retrieval. Competitors may use different representations.
- **Vault enrichment.** HotpotQA notes have minimal frontmatter (heuristic-inferred `type:` only). LoCoMo notes include temporal metadata (`date`, `time`), speaker arrays, session numbers, and entity stubs  --  closer to a real vault. Both are generated by the harness `build-vault.js`, not present in the source datasets. HotpotQA's 92.4% recall with near-zero metadata is closer to pure search engine performance.
- **What each benchmark measures.** HotpotQA measures retrieval only (did the agent's tool calls access the right documents?). LoCoMo measures retrieval *and* answer quality. Each LoCoMo question requires a Sonnet answer session, and conversational questions typically need more tool calls to piece together answers from multi-session dialog. This is why LoCoMo costs roughly double per question ($0.12 vs $0.058).
- **Prompt.** Claude is told the vault structure (notes are conversation sessions) but is not given a retrieval strategy.

**What the numbers suggest:**

- **Single-hop recall: 97.4%**  --  Flywheel finds the right note almost every time for direct questions. 77.0% answer accuracy.
- **Multi-hop recall: 73.7%**  --  harder, requires chaining searches. 38.9% answer accuracy  --  the ceiling here is context assembly, not retrieval.
- **Temporal recall: 69.2%**  --  requires precise date reasoning across sessions. 96 questions. 53.1% answer accuracy.
- **Commonsense recall: 96.4%**  --  strongest category. 78.4% answer accuracy  --  high evidence recall translates well to correct answers.
- **Adversarial recall: 98.9%**  --  system reliably finds relevant context even for trick questions. 47.8% accuracy on correctly refusing unanswerable questions.
- **Infrastructure.** Flywheel runs locally on markdown files with SQLite. Mem0 requires Redis + Qdrant. Zep requires a cloud service.

Source: [`demos/locomo/`](../demos/locomo/) | [`packages/mcp-server/test/retrieval-bench/locomo-bench.test.ts`](../packages/mcp-server/test/retrieval-bench/locomo-bench.test.ts)

---

## Graph Quality (266 tests, 31 files)

The graph quality suite validates that the wikilink suggestion engine works correctly across every scenario that matters: precision/recall, scoring layers, archetypes, feedback loops, temporal evolution, and regression gates.

**Precision & Scoring:** precision/recall, 13-layer ablation, parameter sweep (+ deep), golden set, strictness differentiation, baselines

**Stability & Evolution:** multi-generation (50 gen), temporal evolution, vault lifecycle, learning curve, flywheel pipeline

**Topology & Resilience:** 6 archetypes, topology resilience, health metrics, health snapshot

**Feedback & Recovery:** regression gate, feedback integration, sparse feedback, agent feedback, cross-vault learning, recovery

**Robustness:** chaos, chaos mutations, alias collision, property-based invariants (7 properties × 100 runs)

**Observability:** pipeline tracing, observability APIs, score breakdowns

### Baselines

Locked in `baselines.json` (**2026-02-26**). CI fails if any metric regresses >5pp. These are regression baselines, not the same thing as the latest generated proof report in [QUALITY_REPORT.md](QUALITY_REPORT.md).

| Mode | Precision | Recall | F1 | MRR |
|---|---|---|---|---|
| Conservative | 51.2% | 71.7% | 59.7% | 0.742 |
| Balanced | 27.5% | 76.7% | 40.5% | 0.742 |
| Aggressive | 26.1% | 76.7% | 39.0% | 0.742 |

Measured against a 96-note/61-entity ground truth vault. Links stripped, engine must rediscover them.

The latest generated proof report checked into this repo is [QUALITY_REPORT.md](QUALITY_REPORT.md), generated on **March 27, 2026 21:45 UTC**. Its current balanced-mode headline is **40.2% precision / 71.7% recall / 51.5% F1**.

### Multi-Generation Stress Test

50 generations of suggest -> feedback (85/15 noise) -> mutate vault -> rebuild index. 85/15 noise is deliberately hostile -- real users don't reject 15% of suggestions. But if the algorithm survives 15% noise without F1 collapse, it will handle the 1-5% noise of real usage comfortably. Proves the Beta-Binomial suppression model prevents F1 death spiral under sustained noisy feedback.

**6 CI assertions:**
1. F1 stays within 20pp of baseline across all generations
2. No single generation drops F1 by more than 15pp
3. Trend slope ≥ -0.002 after generation 10
4. At least 3 entity categories maintain F1 > 0
5. Vault note count grows (mutations accumulate)
6. Suppression rate stays below 50%

Source: [`packages/mcp-server/test/graph-quality/multi-generation.test.ts`](../packages/mcp-server/test/graph-quality/multi-generation.test.ts)

For full per-category, per-tier, per-archetype breakdown, see [QUALITY_REPORT.md](QUALITY_REPORT.md).

Sources: [`packages/mcp-server/test/graph-quality/`](../packages/mcp-server/test/graph-quality/)

To regenerate baselines: `npx tsx packages/mcp-server/test/graph-quality/generate-baselines.ts`

---

## Live AI Testing

Unit tests prove handlers work. **Live AI tests prove the product works**  --  that an AI agent given a natural-language question and a vault of notes will discover the right tools, call them in the right order, and get the answer.

This is a fundamentally different claim than "the handler returns valid JSON." It tests:
- **Tool descriptions**  --  is the description clear enough that Claude picks the right tool?
- **Response shapes**  --  does the AI get enough information to answer without extra calls?
- **Tool composition**  --  does Claude chain multiple tools correctly in a multi-step workflow?
- **Regression detection**  --  if a code change makes Claude stop using a tool or pick a worse one, the test catches it

Every test is a real `claude -p` session against a demo vault. Claude gets `--strict-mcp-config` (no filesystem, no web  --  vault tools only). The output is captured as `stream-json` JSONL, and Python analyzers extract every `tool_use` event to compute adoption rates, tool sequences, and category breakdowns. Clean state between runs: StateDb deleted, write operations git-restored. Nothing is mocked.

This kind of test is valuable because it measures actual tool selection and composition, not just handler correctness.

### Test Suites

| Test Suite | What it proves | Sessions | Result | Script |
|---|---|---|---|---|
| **Per-tool coverage** | Claude discovers and uses each tool in the current `full` preset surface | 65 | See [latest results](#per-tool-coverage) | [`run-coverage-test.sh`](../demos/run-coverage-test.sh) |
| **Bundle adoption** | Claude finds the right tools for each of 12 bundles | 36 (12 × 3 runs) | 11/12 at 100% | [`run-bundle-test.sh`](../demos/run-bundle-test.sh) |
| **Sequential workflow** | 9-beat workflow (retrieval + learning loop + operational) where each beat builds on previous vault state | 9 beats |  --  | [`run-demo-test.sh`](../demos/run-demo-test.sh) |
| **HotpotQA benchmark** | End-to-end retrieval quality on HotpotQA multi-hop questions | 500 questions | 92.4% recall | [`hotpotqa/run-benchmark.sh`](../demos/hotpotqa/run-benchmark.sh) |
| **LoCoMo benchmark** | Retrieval + answer accuracy on long-term conversational memory (5 categories) | 695 scored questions | 84.3% evidence recall, 58.7% accuracy | [`locomo/run-benchmark.sh`](../demos/locomo/run-benchmark.sh) |

### Why This Matters

A tool might work perfectly in isolation but fail in practice because its description is ambiguous, its response is too large, or it overlaps confusingly with another tool. Live AI testing catches these issues:

- If Claude reaches for `search` instead of `graph` when asked about connections, the tool description needs work
- If Claude makes 5 follow-up calls after a search, the response shape needs more information
- If a write tool consistently gets skipped, the AI doesn't understand when to use it

These are product quality signals that no amount of handler unit testing can detect.

### Design Decisions

- **`--strict-mcp-config`**  --  prevents Claude from bypassing vault tools with raw filesystem access. If a tool can't answer the question, the test reveals it.
- **`--no-session-persistence`**  --  each run starts fresh. No cached tool schemas from prior sessions.
- **`--permission-mode bypassPermissions`**  --  avoids interactive approval for write operations.
- **Seeded RNG**  --  HotpotQA benchmark uses `SEED=42` and a ground-truth file for reproducible comparisons across runs.
- **Python analyzers**  --  `analyze-bundle-test.py`, `analyze-coverage-test.py`, `analyze-demo-test.py` parse JSONL and generate markdown reports with per-tool adoption rates, tool sequences, and category breakdowns.

### Tool Adoption Results

Results from live testing (2026-03-22). Claude discovers and uses flywheel tools when enabled.

Current tool surface reference from `packages/mcp-server/src/config.ts`:
- Total registered tools: see `packages/mcp-server/src/config.ts` / generated preset docs
- `full` preset surface: full static category surface at startup
- `agent` preset surface: focused default preset

The embedded reports below are historical artifacts from older tool surfaces and older tool names. Keep them as dated evidence only; use the current config and generated docs for the live product surface.

#### Bundle Adoption

Each of 12 tool bundles tested with a targeted prompt against carter-strategy vault.

<!-- BEGIN BUNDLE TEST RESULTS -->
# Bundle Adoption Test Report

**Date:** 2026-03-20 16:40  
**Runs/bundle:** 3  
**Bundles tested:** 12  
**Total runs:** 36  
**Results dir:** `bundle-20260320T151406`

## Per-Bundle Results

### corrections
> Category: `corrections` (4 tools)

| Run | Target Tools Used | Other Tools | Hit? | Sequence |
|-----|-------------------|-------------|------|----------|
| 1 | vault_record_correction | builtin:1 | Yes | ToolSearch -> vault_record_correction |
| 2 | vault_record_correction | builtin:1 | Yes | ToolSearch -> vault_record_correction |
| 3 | vault_record_correction | builtin:1 | Yes | ToolSearch -> vault_record_correction |

### diagnostics
> Category: `diagnostics` (20 tools)

| Run | Target Tools Used | Other Tools | Hit? | Sequence |
|-----|-------------------|-------------|------|----------|
| 1 | get_vault_stats, health_check | builtin:1 | Yes | ToolSearch -> health_check -> get_vault_stats |
| 2 | get_vault_stats, health_check | builtin:1 | Yes | ToolSearch -> health_check -> get_vault_stats |
| 3 | get_vault_stats, health_check | builtin:1 | Yes | ToolSearch -> health_check -> get_vault_stats |

### graph
> Category: `graph` (9 tools)

| Run | Target Tools Used | Other Tools | Hit? | Sequence |
|-----|-------------------|-------------|------|----------|
| 1 | get_connection_strength, get_link_path | builtin:1, search:2 | Yes | ToolSearch -> search -> search -> get_connection_strength -> get_link_path |
| 2 | get_connection_strength, get_link_path | builtin:1, search:2 | Yes | ToolSearch -> search -> search -> get_connection_strength -> get_link_path |
| 3 | get_connection_strength, get_link_path | builtin:1, search:2 | Yes | ToolSearch -> search -> search -> get_link_path -> get_connection_strength |

### memory
> Category: `memory` (3 tools)

| Run | Target Tools Used | Other Tools | Hit? | Sequence |
|-----|-------------------|-------------|------|----------|
| 1 | brief | builtin:2, search:1, write:1 | Yes | ToolSearch -> brief -> ToolSearch -> search -> policy |
| 2 | brief | builtin:3, search:2, tasks:1 | Yes | ToolSearch -> brief -> ToolSearch -> search -> ToolSearch -> tasks -> search |
| 3 | brief | builtin:2, search:3, tasks:1 | Yes | ToolSearch -> brief -> ToolSearch -> search -> search -> search -> tasks |

### note-ops
> Category: `note-ops` (4 tools)

| Run | Target Tools Used | Other Tools | Hit? | Sequence |
|-----|-------------------|-------------|------|----------|
| 1 | vault_rename_note | builtin:1, search:1 | Yes | ToolSearch -> search -> vault_rename_note |
| 2 | vault_rename_note | builtin:1, search:1 | Yes | ToolSearch -> search -> vault_rename_note |
| 3 | vault_rename_note | builtin:2, search:1 | Yes | ToolSearch -> search -> ToolSearch -> vault_rename_note |

### read
> Category: `read` (3 tools)

| Run | Target Tools Used | Other Tools | Hit? | Sequence |
|-----|-------------------|-------------|------|----------|
| 1 | get_note_structure | builtin:3 | Yes | ToolSearch -> get_note_structure -> ToolSearch -> Read |
| 2 | get_note_structure | builtin:3 | Yes | ToolSearch -> get_note_structure -> ToolSearch -> Read |
| 3 | get_note_structure | builtin:3 | Yes | ToolSearch -> get_note_structure -> ToolSearch -> Read |

### schema
> Category: `schema` (7 tools)

| Run | Target Tools Used | Other Tools | Hit? | Sequence |
|-----|-------------------|-------------|------|----------|
| 1 | schema_conventions, vault_schema | builtin:1, search:2 | Yes | ToolSearch -> vault_schema -> vault_schema -> schema_conventions -> schema_conventions -> search -> search |
| 2 | schema_conventions, vault_schema | builtin:1, search:1 | Yes | ToolSearch -> vault_schema -> schema_conventions -> vault_schema -> schema_conventions -> search |
| 3 | schema_conventions, vault_schema | builtin:1, search:1 | Yes | ToolSearch -> vault_schema -> schema_conventions -> vault_schema -> schema_conventions -> search |

### search
> Category: `search` (3 tools)

| Run | Target Tools Used | Other Tools | Hit? | Sequence |
|-----|-------------------|-------------|------|----------|
| 1 | search | builtin:1 | Yes | ToolSearch -> search |
| 2 | search | builtin:1 | Yes | ToolSearch -> search |
| 3 | search | builtin:1 | Yes | ToolSearch -> search |

### tasks
> Category: `tasks` (3 tools)

| Run | Target Tools Used | Other Tools | Hit? | Sequence |
|-----|-------------------|-------------|------|----------|
| 1 | tasks | builtin:1 | Yes | ToolSearch -> tasks |
| 2 | tasks | builtin:1 | Yes | ToolSearch -> tasks |
| 3 | tasks | builtin:1 | Yes | ToolSearch -> tasks |

### temporal
> Category: `temporal` (4 tools)

| Run | Target Tools Used | Other Tools | Hit? | Sequence |
|-----|-------------------|-------------|------|----------|
| 1 | predict_stale_notes, temporal_summary | builtin:1 | Yes | ToolSearch -> temporal_summary -> predict_stale_notes |
| 2 | get_context_around_date, predict_stale_notes, temporal_summary | builtin:1 | Yes | ToolSearch -> temporal_summary -> predict_stale_notes -> predict_stale_notes -> get_context_around_date |
| 3 | predict_stale_notes, temporal_summary | builtin:1 | Yes | ToolSearch -> temporal_summary -> predict_stale_notes -> predict_stale_notes -> predict_stale_notes |

### wikilinks
> Category: `wikilinks` (7 tools)

| Run | Target Tools Used | Other Tools | Hit? | Sequence |
|-----|-------------------|-------------|------|----------|
| 1 | discover_cooccurrence_gaps, unlinked_mentions_report | builtin:1 | Yes | ToolSearch -> unlinked_mentions_report -> discover_cooccurrence_gaps |
| 2 | unlinked_mentions_report | builtin:1 | Yes | ToolSearch -> unlinked_mentions_report |
| 3 | unlinked_mentions_report | builtin:1 | Yes | ToolSearch -> unlinked_mentions_report |

### write
> Category: `write` (7 tools)

| Run | Target Tools Used | Other Tools | Hit? | Sequence |
|-----|-------------------|-------------|------|----------|
| 1 | vault_add_to_section | builtin:1 | Yes | ToolSearch -> vault_add_to_section |
| 2 | vault_add_to_section | builtin:2, search:1 | Yes | ToolSearch -> search -> ToolSearch -> vault_add_to_section |
| 3 | vault_add_to_section | builtin:6, read:3, search:1 | Yes | ToolSearch -> search -> ToolSearch -> get_section_content -> ToolSearch -> get_note_structure -> get_note_structure -> ToolSearch (+3) |

## Adoption Summary

| Bundle | Tools Available | Adoption Rate | Distinct Tools Hit | Tools Never Used |
|--------|---------------|---------------|-------------------|------------------|
| corrections | 4 | 3/3 (100%) | 1/4 | absorb_as_alias, vault_list_corrections, vault_resolve_correction |
| diagnostics | 14 | 3/3 (100%) | 2/14 | dismiss_merge_suggestion, flywheel_config, flywheel_doctor, get_all_entities, get_folder_structure, get_unlinked_mentions, refresh_index, server_log, suggest_entity_merges, vault_activity, vault_growth, vault_init |
| graph | 9 | 3/3 (100%) | 2/9 | get_backlinks, get_common_neighbors, get_forward_links, get_strong_connections, graph_analysis, list_entities, semantic_analysis |
| memory | 2 | 3/3 (100%) | 1/2 | memory |
| note-ops | 4 | 3/3 (100%) | 1/4 | merge_entities, vault_delete_note, vault_move_note |
| read | 3 | 3/3 (100%) | 1/3 | find_sections, get_section_content |
| schema | 7 | 3/3 (100%) | 2/7 | migrate_field_values, note_intelligence, rename_field, rename_tag, schema_validate |
| search | 3 | 3/3 (100%) | 1/3 | find_similar, init_semantic |
| tasks | 3 | 3/3 (100%) | 1/3 | vault_add_task, vault_toggle_task |
| temporal | 4 | 3/3 (100%) | 3/4 | track_concept_evolution |
| wikilinks | 7 | 3/3 (100%) | 2/7 | discover_stub_candidates, suggest_entity_aliases, suggest_wikilinks, validate_links, wikilink_feedback |
| write | 7 | 3/3 (100%) | 1/7 | policy, vault_create_note, vault_remove_from_section, vault_replace_in_section, vault_undo_last_mutation, vault_update_frontmatter |

## Overall

- **Bundles adopted:** 12/12
- **Distinct flywheel tools used:** 20/65

<!-- END BUNDLE TEST RESULTS -->

### Per-Tool Coverage

Each tool tested with a targeted prompt against the carter-strategy vault. The embedded report below is a historical full-surface run from before preset rationalization and merged tool names; rerun `demos/run-coverage-test.sh` if you need a fresh report for the current surface.

<!-- BEGIN COVERAGE TEST RESULTS -->
# Tool Coverage Test Report

**Date:** 2026-03-20 16:40  
**Runs/tool:** 1  
**Tools tested:** 69  
**Total runs:** 69  
**Results dir:** `coverage-20260320T153941`

## Results by Category

### search (3/3)

| Tool | Hit Rate | Status | Tools Called |
|------|---------|--------|-------------|
| find_similar | 1/1 | PASS | find_similar, search |
| init_semantic | 1/1 | PASS | init_semantic |
| search | 1/1 | PASS | search |

### read (3/3)

| Tool | Hit Rate | Status | Tools Called |
|------|---------|--------|-------------|
| find_sections | 1/1 | PASS | find_sections |
| get_note_structure | 1/1 | PASS | get_note_structure, search |
| get_section_content | 1/1 | PASS | get_note_structure, get_section_content, search |

### write (7/7)

| Tool | Hit Rate | Status | Tools Called |
|------|---------|--------|-------------|
| policy | 1/1 | PASS | get_note_structure, policy, search |
| vault_add_to_section | 1/1 | PASS | search, vault_add_to_section |
| vault_create_note | 1/1 | PASS | policy, vault_create_note |
| vault_remove_from_section | 1/1 | PASS | get_note_structure, get_section_content, search, vault_remove_from_section |
| vault_replace_in_section | 1/1 | PASS | get_note_structure, get_section_content, search, vault_replace_in_section |
| vault_undo_last_mutation | 1/1 | PASS | search, vault_add_to_section, vault_undo_last_mutation |
| vault_update_frontmatter | 1/1 | PASS | search, vault_update_frontmatter |

### graph (8/10)

| Tool | Hit Rate | Status | Tools Called |
|------|---------|--------|-------------|
| get_backlinks | 1/1 | PASS | get_backlinks |
| get_common_neighbors | 1/1 | PASS | get_common_neighbors, search |
| get_connection_strength | 1/1 | PASS | get_connection_strength |
| get_forward_links | 1/1 | PASS | get_forward_links |
| get_link_path | 0/1 | FAIL | list_entities, search |
| get_strong_connections | 0/1 | FAIL | get_connection_strength, graph_analysis |
| graph_analysis | 1/1 | PASS | graph_analysis, semantic_analysis |
| list_entities | 1/1 | PASS | list_entities |
| semantic_analysis | 1/1 | PASS | semantic_analysis |

### schema (6/7)

| Tool | Hit Rate | Status | Tools Called |
|------|---------|--------|-------------|
| migrate_field_values | 1/1 | PASS | migrate_field_values |
| note_intelligence | 1/1 | PASS | get_note_structure, note_intelligence, search |
| rename_field | 1/1 | PASS | rename_field |
| rename_tag | 1/1 | PASS | get_note_structure, rename_tag, search |
| schema_conventions | 0/1 | FAIL | vault_schema |
| schema_validate | 1/1 | PASS | schema_conventions, schema_validate, search |
| vault_schema | 1/1 | PASS | vault_schema |

### wikilinks (7/7)

| Tool | Hit Rate | Status | Tools Called |
|------|---------|--------|-------------|
| discover_cooccurrence_gaps | 1/1 | PASS | discover_cooccurrence_gaps, search |
| discover_stub_candidates | 1/1 | PASS | discover_stub_candidates, unlinked_mentions_report |
| suggest_entity_aliases | 1/1 | PASS | suggest_entity_aliases |
| suggest_wikilinks | 1/1 | PASS | get_note_structure, search, suggest_wikilinks |
| unlinked_mentions_report | 1/1 | PASS | unlinked_mentions_report |
| validate_links | 1/1 | PASS | validate_links |
| wikilink_feedback | 1/1 | PASS | wikilink_feedback |

### corrections (4/4)

| Tool | Hit Rate | Status | Tools Called |
|------|---------|--------|-------------|
| absorb_as_alias | 1/1 | PASS | absorb_as_alias, search |
| vault_list_corrections | 1/1 | PASS | vault_list_corrections |
| vault_record_correction | 1/1 | PASS | vault_record_correction |
| vault_resolve_correction | 1/1 | PASS | vault_record_correction, vault_resolve_correction |

### tasks (3/3)

| Tool | Hit Rate | Status | Tools Called |
|------|---------|--------|-------------|
| tasks | 1/1 | PASS | tasks |
| vault_add_task | 1/1 | PASS | get_note_structure, search, vault_add_task |
| vault_toggle_task | 1/1 | PASS | get_note_structure, search, tasks, vault_toggle_task |

### memory (1/2)

| Tool | Hit Rate | Status | Tools Called |
|------|---------|--------|-------------|
| brief | 1/1 | PASS | brief, get_note_structure, search, tasks |
| memory | 0/1 | FAIL | (none) |

### note-ops (3/4)

| Tool | Hit Rate | Status | Tools Called |
|------|---------|--------|-------------|
| merge_entities | 0/1 | FAIL | search |
| vault_delete_note | 1/1 | PASS | search, vault_delete_note |
| vault_move_note | 1/1 | PASS | search, vault_move_note |
| vault_rename_note | 1/1 | PASS | search, vault_rename_note |

### temporal (4/4)

| Tool | Hit Rate | Status | Tools Called |
|------|---------|--------|-------------|
| get_context_around_date | 1/1 | PASS | get_context_around_date, search, temporal_summary |
| predict_stale_notes | 1/1 | PASS | predict_stale_notes |
| temporal_summary | 1/1 | PASS | temporal_summary |
| track_concept_evolution | 1/1 | PASS | get_note_structure, search, track_concept_evolution |

### diagnostics (14/14)

| Tool | Hit Rate | Status | Tools Called |
|------|---------|--------|-------------|
| dismiss_merge_suggestion | 1/1 | PASS | dismiss_merge_suggestion, suggest_entity_merges |
| flywheel_config | 1/1 | PASS | flywheel_config |
| flywheel_doctor | 1/1 | PASS | flywheel_doctor |
| get_all_entities | 1/1 | PASS | get_all_entities, search |
| get_folder_structure | 1/1 | PASS | get_folder_structure |
| get_unlinked_mentions | 1/1 | PASS | get_all_entities, get_unlinked_mentions |
| get_vault_stats | 1/1 | PASS | get_vault_stats |
| health_check | 1/1 | PASS | health_check |
| refresh_index | 1/1 | PASS | refresh_index |
| server_log | 1/1 | PASS | server_log |
| suggest_entity_merges | 1/1 | PASS | suggest_entity_merges |
| vault_activity | 1/1 | PASS | vault_activity, vault_growth |
| vault_growth | 1/1 | PASS | vault_growth |
| vault_init | 1/1 | PASS | get_vault_stats, policy, vault_init |

## Summary

**Historical coverage: 64/69 tools adopted (92%)**  --  from a dated pre-rationalization run. The current default-visible surface is 18 `agent` tools; rerun to get a current coverage number for today's presets.

### Tools Never Adopted

- `get_link_path` (graph)
- `memory` (memory)
- `merge_entities` (note-ops)
- `schema_conventions` (schema)

### Per-Category Summary

| Category | Tools | Adopted | Rate |
|----------|-------|---------|------|
| search | 3 | 3 | 100% |
| read | 3 | 3 | 100% |
| write | 7 | 7 | 100% |
| graph | 10 | 8 | 80% |
| schema | 7 | 6 | 85% |
| wikilinks | 7 | 7 | 100% |
| corrections | 4 | 4 | 100% |
| tasks | 3 | 3 | 100% |
| memory | 3 | 2 | 66% |
| note-ops | 4 | 3 | 75% |
| temporal | 4 | 4 | 100% |
| diagnostics | 14 | 14 | 100% |

<!-- END COVERAGE TEST RESULTS -->

### Demo Beat Coverage

9-beat sequential demo across retrieval, learning loop, and operational beats.

<!-- BEGIN DEMO TEST RESULTS -->
# Demo Beat Analysis

**Date:** 2026-03-20 16:40  
**Results dir:** `demo-20260320T151406`

## Per-Beat Results

| Beat | Status | Expected | Tools Used | Categories |
|------|--------|----------|------------|------------|
| beat1-brief | PASS | brief | ToolSearch, ToolSearch, brief, Read | builtin:3, memory:1 |
| beat2-billing | PASS | search | ToolSearch, search, tasks | builtin:1, search:1, tasks:1 |
| beat3-tasks | PASS | policy, vault_add_task | ToolSearch, ToolSearch, search, search, vault_add_task, vault_add_task, ToolSearch, policy, policy, vault_add_task, vault_add_task | builtin:3, search:2, tasks:4, write:2 |
| beat4-showstopper | PASS | vault_add_to_section | ToolSearch, search, search, search, search, search, search, search, search, get_note_structure, get_note_structure, get_note_structure, TodoWrite, get_section_content, get_note_structure, get_note_structure, ToolSearch, search, get_note_structure, TodoWrite, get_section_content, get_section_content, ToolSearch, Read, Read, Read, vault_add_to_section, vault_add_to_section, vault_add_to_section, policy, refresh_index, vault_add_to_section, get_folder_structure, policy, vault_add_to_section, vault_update_frontmatter, vault_update_frontmatter, TodoWrite, refresh_index, vault_update_frontmatter, search, search, search, vault_create_note, vault_create_note, vault_add_to_section, vault_add_to_section, vault_add_to_section, vault_update_frontmatter, vault_update_frontmatter, TodoWrite | builtin:10, diagnostics:3, read:9, search:12, write:17 |
| beat5-assign | PASS | vault_update_frontmatter | ToolSearch, search, search, search, search, search, search, get_note_structure, vault_update_frontmatter, vault_create_note, vault_create_note, vault_add_task, ToolSearch, vault_create_note, vault_create_note | builtin:2, read:1, search:6, tasks:1, write:5 |
| beat6-meeting | PASS | vault_create_note | ToolSearch, policy, search, search, search, get_folder_structure, vault_create_note | builtin:1, diagnostics:1, search:3, write:2 |
| beat7-pipeline | PASS | policy, search | ToolSearch, search, search, search, search, search, search | builtin:1, search:6 |

**7/7 beats passed. 12 distinct flywheel tools used across all beats.**

<!-- END DEMO TEST RESULTS -->

Source: [`demos/`](../demos/)

---

## Running the Tests

```bash
git clone https://github.com/velvetmonkey/flywheel-memory.git
cd flywheel-memory
npm install
npm test
```
