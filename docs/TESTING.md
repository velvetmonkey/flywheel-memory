# Testing

Your vault is your second brain. You don't hand it to software you can't trust.

**2,541 tests | 124 test files | 47,000+ lines of test code**

---

## Test Philosophy

Three principles guide every test in this project:

1. **Prove it at scale.** Not with 5 notes in a toy vault -- with 100,000-line files and 2,500-entity indexes. If it works at scale, it works everywhere.

2. **Break it before users do.** The test suite is adversarial by design: property-based fuzzing with randomized inputs, injection attacks against every input surface, race conditions under concurrent load.

3. **Document with tests.** README examples run against demo vaults. Tool counts, config keys, and category mappings are cross-checked against source in CI. Coverage is strongest for read-side MCP flows, write-side logic, security boundaries, and concurrency. Write-side MCP integration covers core mutation, config, and safety flows.

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

The concurrency suite verifies that parallel and sequential operations never corrupt vault state.

- **100 parallel mutations** to different files -- zero corruption, all entries verified.
- **100 sequential mutations** to the same file -- all entries preserved, ordering maintained.
- **Sustained load:** 4 batches of 25 mutations, performance ratio stays below 10x first-batch time.
- **Mixed operations:** 5 rounds of parallel mutations across 20 files interleaved with sequential writes to a single file.
- **Frontmatter integrity:** complex YAML (nested objects, arrays, tags) survives 10 consecutive mutations unchanged.
- **Unicode/emoji preservation:** special characters (Japanese, Greek, emoji) round-trip through write cycles without loss.

Source: [`packages/mcp-server/test/write/stress/concurrency.test.ts`](../packages/mcp-server/test/write/stress/concurrency.test.ts)

---

## Battle-Hardening (Fuzzing)

Property-based testing using [fast-check](https://github.com/dubzzz/fast-check). Each property runs 50 randomized iterations by default (configurable).

Properties tested:

- **Mutation safety** -- `vault_add_to_section` never corrupts file structure, regardless of generated input.
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

Six dedicated security test files cover the attack surface:

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

## Retrieval Benchmark (HotpotQA)

End-to-end retrieval quality measured on [HotpotQA](https://hotpotqa.github.io/) — a standard multi-hop question answering benchmark from CMU/Stanford. Real Claude + Flywheel via `claude -p`, no pre-processing, no cherry-picking.

### Results (200 hard questions, 1,993 documents)

| Metric | Score |
|---|---|
| Document Recall | **84.8%** (339/400 supporting docs found) |
| Full Recall (both docs found) | **70.0%** (140/200) |
| Partial Recall (≥1 doc found) | **99.5%** (199/200) |
| Bridge (multi-hop) | 82.1% |
| Comparison | 97.1% |
| Cost | $0.061/question |

### How Flywheel compares

HotpotQA is primarily used as a QA benchmark (answer extraction, measured by EM/F1). The retrieval stage — finding the right documents — is what we measure. Most academic systems are purpose-built ML retrieval models trained specifically on HotpotQA; Flywheel is a general-purpose vault tool.

| System | Type | Retrieval Recall | Approach | Notes |
|---|---|---|---|---|
| **Flywheel** | MCP vault tool | **84.8%** | BM25 + entity search + 2-hop backfill + query expansion | General-purpose, zero training, end-to-end via Claude |
| BM25 baseline | IR baseline | ~70-75% | TF-IDF keyword matching | Standard academic baseline |
| [TF-IDF + Entity](https://arxiv.org/abs/1809.09600) | IR baseline | ~80% | TF-IDF with named entity overlap | Original HotpotQA paper baseline |
| [MDR](https://arxiv.org/abs/2009.12756) | Trained retriever | ~88% | Multi-hop dense retrieval (iterative) | Facebook, 2021. Trained on HotpotQA. Two-hop BERT encoder |
| [Baleen](https://arxiv.org/abs/2101.00436) | Trained retriever | ~85% | Condensed retrieval with hop-aware filtering | Stanford, 2021. Trained on HotpotQA |
| [ColBERTv2](https://arxiv.org/abs/2112.01488) | Trained retriever | ~90%+ | Late interaction dense retrieval | Stanford, 2022. Fine-tuned on MS MARCO |
| [Beam Retrieval](https://arxiv.org/abs/2308.08973) | Trained retriever | ~93% | Beam search over retrieval paths | 2023. Trained end-to-end for multi-hop |

**Key differences:**

- **Trained retrievers** (MDR, Baleen, Beam Retrieval) are neural models fine-tuned on HotpotQA training data. They learn query-document relationships. Flywheel has zero training — it uses BM25 keyword search with structural backfill.
- **Our test setting** is harder than standard distractor (10 docs per question) but easier than fullwiki (5M docs). We pool all 1,993 documents from 200 questions into one vault, so each query searches ~2,000 docs, not 10.
- **Flywheel's 84.8%** beats the standard BM25 baseline (~75%) by +10pp, attributable to 2-hop backfill (outlinks from top results + their outlinks), query expansion, and FTS5 column weighting (title 5x, frontmatter 10x).
- **The gap to trained retrievers** (85% vs 88-93%) is the cost of being general-purpose. These systems iterate: retrieve, read, re-query. Flywheel does one search + backfill.

### Comparison with other MCP/vault tools

As of March 2026, we are not aware of any other MCP memory tool that has published end-to-end retrieval benchmarks on a standard academic dataset. Most tools in this space report feature lists but not measured retrieval quality.

Source: [`demos/hotpotqa/`](../demos/hotpotqa/) | [`packages/mcp-server/test/retrieval-bench/`](../packages/mcp-server/test/retrieval-bench/)

---

## Graph Quality (266 tests, 31 files)

The graph quality suite validates that the wikilink suggestion engine works correctly across every scenario that matters: precision/recall, scoring layers, archetypes, feedback loops, temporal evolution, and regression gates.

**Precision & Scoring:** precision/recall, 13-layer ablation, parameter sweep (+ deep), golden set, strictness differentiation, baselines

**Stability & Evolution:** multi-generation (50 gen), temporal evolution, vault lifecycle, learning curve, flywheel pipeline

**Topology & Resilience:** 7 archetypes, topology resilience, health metrics, health snapshot

**Feedback & Recovery:** regression gate, feedback integration, sparse feedback, agent feedback, cross-vault learning, recovery

**Robustness:** chaos, chaos mutations, alias collision, property-based invariants (7 properties × 100 runs)

**Observability:** pipeline tracing, observability APIs, score breakdowns

### Baselines

Locked in `baselines.json` (2026-02-26). CI fails if any metric regresses >5pp.

| Mode | Precision | Recall | F1 | MRR |
|---|---|---|---|---|
| Conservative | 51.2% | 71.7% | 59.7% | 0.742 |
| Balanced | 27.5% | 76.7% | 40.5% | 0.742 |
| Aggressive | 26.1% | 76.7% | 39.0% | 0.742 |

Measured against a 96-note/61-entity ground truth vault. Links stripped, engine must rediscover them.

### Multi-Generation Stress Test

50 generations of suggest → feedback (85/15 noise) → mutate vault → rebuild index. Proves the Beta-Binomial suppression model prevents F1 death spiral under sustained noisy feedback.

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

Unit tests prove handlers work. **Live AI tests prove the product works** — that an AI agent given a natural-language question and a vault of notes will discover the right tools, call them in the right order, and get the answer.

This is a fundamentally different claim than "the handler returns valid JSON." It tests:
- **Tool descriptions** — is the description clear enough that Claude picks the right tool?
- **Response shapes** — does the AI get enough information to answer without extra calls?
- **Tool composition** — does Claude chain multiple tools correctly in a multi-step workflow?
- **Regression detection** — if a code change makes Claude stop using a tool or pick a worse one, the test catches it

Every test is a real `claude -p` session against a demo vault. Claude gets `--strict-mcp-config` (no filesystem, no web — vault tools only). The output is captured as `stream-json` JSONL, and Python analyzers extract every `tool_use` event to compute adoption rates, tool sequences, and category breakdowns. Clean state between runs: StateDb deleted, write operations git-restored. Nothing is mocked.

We are not aware of any other MCP server that publishes live AI test results.

### Test Suites

| Test Suite | What it proves | Sessions | Result | Script |
|---|---|---|---|---|
| **Per-tool coverage** | Claude discovers and uses each of 69 individual tools | 69 | **100% adoption** | [`run-coverage-test.sh`](../demos/run-coverage-test.sh) |
| **Bundle adoption** | Claude finds the right tools for each of 12 bundles | 36 (12 × 3 runs) | 11/12 at 100% | [`run-bundle-test.sh`](../demos/run-bundle-test.sh) |
| **Sequential workflow** | 7-beat workflow where each beat builds on previous vault state | 7 beats | 7/7 passed | [`run-demo-test.sh`](../demos/run-demo-test.sh) |
| **Retrieval benchmark** | End-to-end retrieval quality on HotpotQA multi-hop questions | 200 questions | 84.8% recall | [`hotpotqa/run-benchmark.sh`](../demos/hotpotqa/run-benchmark.sh) |

### Why This Matters

A tool might work perfectly in isolation but fail in practice because its description is ambiguous, its response is too large, or it overlaps confusingly with another tool. Live AI testing catches these issues:

- If Claude reaches for `search` instead of `graph_analysis` when asked about connections, the tool description needs work
- If Claude makes 5 follow-up calls after a search, the response shape needs more information
- If a write tool consistently gets skipped, the AI doesn't understand when to use it

These are product quality signals that no amount of handler unit testing can detect.

### Design Decisions

- **`--strict-mcp-config`** — prevents Claude from bypassing vault tools with raw filesystem access. If a tool can't answer the question, the test reveals it.
- **`--no-session-persistence`** — each run starts fresh. No cached tool schemas from prior sessions.
- **`--permission-mode bypassPermissions`** — avoids interactive approval for write operations.
- **Seeded RNG** — HotpotQA benchmark uses `SEED=42` and a ground-truth file for reproducible comparisons across runs.
- **Python analyzers** — `analyze-bundle-test.py`, `analyze-coverage-test.py`, `analyze-demo-test.py` parse JSONL and generate markdown reports with per-tool adoption rates, tool sequences, and category breakdowns.

### Tool Adoption Results

Results from live testing (2026-03-22). Claude discovers and uses flywheel tools when enabled.

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
> Category: `diagnostics` (14 tools)

| Run | Target Tools Used | Other Tools | Hit? | Sequence |
|-----|-------------------|-------------|------|----------|
| 1 | get_vault_stats, health_check | builtin:1 | Yes | ToolSearch -> health_check -> get_vault_stats |
| 2 | get_vault_stats, health_check | builtin:1 | Yes | ToolSearch -> health_check -> get_vault_stats |
| 3 | get_vault_stats, health_check | builtin:1 | Yes | ToolSearch -> health_check -> get_vault_stats |

### graph
> Category: `graph` (10 tools)

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
| graph | 10 | 3/3 (100%) | 2/10 | get_backlinks, get_common_neighbors, get_forward_links, get_strong_connections, get_weighted_links, graph_analysis, list_entities, semantic_analysis |
| memory | 3 | 3/3 (100%) | 1/3 | memory, recall |
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
- **Distinct flywheel tools used:** 20/69

<!-- END BUNDLE TEST RESULTS -->

### Per-Tool Coverage

Each of 69 tools tested with a targeted prompt against carter-strategy vault.

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
| get_strong_connections | 0/1 | FAIL | get_connection_strength, get_weighted_links, graph_analysis |
| get_weighted_links | 1/1 | PASS | get_weighted_links, search |
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

### memory (2/3)

| Tool | Hit Rate | Status | Tools Called |
|------|---------|--------|-------------|
| brief | 1/1 | PASS | brief, get_note_structure, recall, search, tasks |
| memory | 0/1 | FAIL | (none) |
| recall | 1/1 | PASS | get_note_structure, recall |

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

**Coverage: 64/69 tools adopted (92%)**

### Tools Never Adopted

- `get_link_path` (graph)
- `get_strong_connections` (graph)
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

7-beat sequential demo with all 69 tools available.

<!-- BEGIN DEMO TEST RESULTS -->
# Demo Beat Analysis

**Date:** 2026-03-20 16:40  
**Results dir:** `demo-20260320T151406`

## Per-Beat Results

| Beat | Status | Expected | Tools Used | Categories |
|------|--------|----------|------------|------------|
| beat1-brief | PASS | brief | ToolSearch, ToolSearch, brief, Read | builtin:3, memory:1 |
| beat2-billing | PASS | recall, search | ToolSearch, search, tasks | builtin:1, search:1, tasks:1 |
| beat3-tasks | PASS | policy, vault_add_task | ToolSearch, ToolSearch, search, search, vault_add_task, vault_add_task, ToolSearch, policy, policy, vault_add_task, vault_add_task | builtin:3, search:2, tasks:4, write:2 |
| beat4-showstopper | PASS | vault_add_to_section | ToolSearch, search, search, search, search, search, search, search, search, get_note_structure, get_note_structure, get_note_structure, TodoWrite, get_section_content, get_note_structure, get_note_structure, ToolSearch, search, get_note_structure, TodoWrite, get_section_content, get_section_content, ToolSearch, Read, Read, Read, vault_add_to_section, vault_add_to_section, vault_add_to_section, policy, refresh_index, vault_add_to_section, get_folder_structure, policy, vault_add_to_section, vault_update_frontmatter, vault_update_frontmatter, TodoWrite, refresh_index, vault_update_frontmatter, search, search, search, vault_create_note, vault_create_note, vault_add_to_section, vault_add_to_section, vault_add_to_section, vault_update_frontmatter, vault_update_frontmatter, TodoWrite | builtin:10, diagnostics:3, read:9, search:12, write:17 |
| beat5-assign | PASS | vault_update_frontmatter | ToolSearch, search, search, search, search, search, search, get_note_structure, vault_update_frontmatter, vault_create_note, vault_create_note, vault_add_task, ToolSearch, vault_create_note, vault_create_note | builtin:2, read:1, search:6, tasks:1, write:5 |
| beat6-meeting | PASS | vault_create_note | ToolSearch, policy, search, search, search, get_folder_structure, vault_create_note | builtin:1, diagnostics:1, search:3, write:2 |
| beat7-pipeline | PASS | policy, recall, search | ToolSearch, search, search, search, search, search, search | builtin:1, search:6 |

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
