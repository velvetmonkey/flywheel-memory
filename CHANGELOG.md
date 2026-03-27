# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.146-150] - 2026-03-26
*Context engineering & uber search*

### Added
- **Uber search** — decision surface framing, recall tool removed, agent preset merged into unified search surface
- **Section-aware snippets** — entity bridging across note sections with date extraction from snippet text (P38)
- **Sandwich ordering** — search results reordered for optimal context placement
- **Learning report & calibration export** — custom categories for targeted knowledge review
- **MCP transport before vault boot** — eliminates boot latency by wiring transport before vault initialization

### Changed
- **Scoring bloat stripped** — expansion gated, outlinks reduced for leaner ranking
- **Custom categories** wired into entity scanning and scoring pipeline

### Fixed
- **`flywheel_config get`** returned `{}` due to stale fallback scope
- **Dynamic `require('crypto')`** replaced with static ESM import

## [2.0.136-145] - 2026-03-26
*Security, decomposition & wikilink quality*

### Added
- **Security remediation** — all advisories resolved, SECURITY.md published, unified vitest harness
- **P37 wikilink quality** — alias hygiene + common word filtering, suggestion diversity + hub dampening, per-alias feedback tracking (schema v35)
- **Stemmed entity matching** — wikilink insertion uses stemmed forms for broader recall
- **Agent memory extensions** — session history, entity timeline, type scoring (P15)
- **P35 trust invariants** — sovereignty tests, singleton hardening, trust report, Node 24 CI
- **Backup rotation** — WAL-safe backups, integrity checks, feedback salvage on missing/corrupt state.db
- **Folder-based entity categorization** — benchmark pre-warm + build frontmatter for folder-aware entity types

### Changed
- **God-file decomposition** — `index.ts` (1,861 LOC) split into config + tool-registry modules; `sqlite.ts` (1,717 LOC) split into 4 focused modules
- **Autolink quality** — sanitizer, tighter implicit detection, alias collision guard
- **FTS5 query reformulation** — implicit AND replaced with OR + BM25 ranking
- **Incremental FTS5 updates** — watcher pipeline applies FTS5 diffs instead of full rebuilds
- **Title-match boost** — search ranking elevated for exact title matches
- **Proactive queue** — mtime guard replaces batch-path guard

### Fixed
- **State.db recovery** — smarter corruption detection, `entity_changes` dedup
- **Pure-punctuation implicit entities** rejected from entity index

## [2.0.126-135] - 2026-03-24
*Launch: search/recall parity, LoCoMo & graph export*

### Added
- **LoCoMo benchmark** — 200q balanced E2E: 55% answer accuracy, 70% single-hop, 90.4% Recall@10 on conversational memory
- **Search/recall parity** — graph re-ranking, query expansion, improved snippets (v2.0.128). LoCoMo multi-hop 15% to 27.5%, overall 55% to 58.5%
- **`export_graph` tool** — ego-network filtering, Gephi-compatible GraphML output, watcher pipeline extraction
- **Deferred proactive linking queue** — schema v31 for async link suggestion processing
- **Multi-hop search backfill** — top results' outlink targets included automatically for second-hop retrieval
- **FTS5 query sanitization** — strips FTS5 operators from natural-language queries instead of silently failing

### Changed
- **Wikilink noise reduction** — proactive insertion with tighter thresholds (P29)
- **Default `suggestOutgoingLinks`** set to `false` to reduce write-path overhead
- **Score timeline** aggregated by day (show trend not noise)

### Fixed
- **Multi-vault state propagation** — mirror index/config to VaultContext, per-vault boot pipeline

## [2.0.116-125] - 2026-03-22
*Vault isolation, retrieval quality & benchmarks*

### Added
- **Per-request vault isolation** — `AsyncLocalStorage` ensures vault contexts never bleed across requests (P27)
- **Token economics tracking** — `response_tokens` and `baseline_tokens` columns on `tool_invocations` (schema v30). `getTokenEconomics()` for per-tool and aggregate savings ratios
- **Retrieval co-occurrence** — note pairs co-retrieved across sessions linked via Adamic-Adar weighting with 7-day decay half-life. Integrated into Layer 4 scoring
- **HotpotQA benchmark** — 50 hard questions, 500 documents, real Claude + Flywheel: 87% document recall, 78% full recall, 96% partial recall
- **Retrieval benchmark** — 15-question multi-document test (31 docs): 100% Recall@5, 0.97 MRR, Precision@K, NDCG@10
- **Eigenvector centrality** — graph centrality/cycles modes, vault health score
- **Compact enrichment + 2-hop multi-hop retrieval** — P29 retrieval depth increase with lighter response payloads
- **StateDb backup & recovery** — env validation, corruption detection, auto-recovery (P28)

### Changed
- **better-sqlite3 v12** — Node 20-24 support
- **Policy executor** aligned with `validatePathSecure` for consistent path validation
- **Vault isolation refactor** — write path unification across single/multi-vault modes

### Fixed
- **`health_check`** reported index state `building` when index was ready

## [2.0.108-115] - 2026-03-21
*Policy, temporal tools & test hardening*

### Added
- **Policy schema v1** — map-format conditions, policy hints in write error messages, MCP instructions for policy-first writes
- **Temporal tool category** — extracted as standalone category with policy search step
- **Tool adoption test suite** — 69/69 tool coverage + MCP write/config integration tests + doc contract checks
- **P25 T4/T5/T6** — protected zone merging, doctor metrics, union regexp
- **CRLF frontmatter test coverage** for Windows line-ending edge cases
- **serverLog ring buffer** — replaces fallback logging (P25/T2)

### Changed
- **Relicensed from Apache-2.0 to AGPL-3.0-only**
- **Multi-vault entity cache isolation** — per-vault caches prevent cross-contamination
- **Pre-launch polish** — honest `total_results` counts, synced baselines, version bumps
- **Incremental index entity reconciliation** + clustering threshold tuning

## [2.0.107] - 2026-03-20

### Changed
- Entity scan performance: targeted WHERE IN replaces full table scan
- Hub connection count caching via WeakMap (auto-invalidates on index rebuild)
- 60s TTL entity cache for memory entity detection
- Binary search insert for Dijkstra priority queue
- Co-occurrence matching tightened (both tokens for 2-token, 75% for 3+)
- MD5 replaced with SHA-256 truncated in embeddings content hash

### Fixed
- Template `resolveExpression` recursion guard (MAX_FILTER_DEPTH=10)
- Stale git lock removal (>30s age) instead of retrying against them
- AST fallback logging when parse fails in protectedZones

## [2.0.106] - 2026-03-19

### Added
- `flywheel_doctor` diagnostic tool (11 checks with ok/warning/error status)
- `temporal_summary` tool (composes temporal reasoning tools into period overview)
- Policy examples documentation (`docs/POLICY_EXAMPLES.md`)
- Performance benchmarks documentation (`docs/BENCHMARKS.md`)
- Suppression stats in `suggest_wikilinks` output (posteriorMean, totalObservations)

### Changed
- Semantic embedding UX: estimated build time, progress %, elapsed time on completion

## [2.0.105] - 2026-03-19

### Added
- Temporal reasoning tools: `get_context_around_date` (vault activity around a date), `predict_stale_notes` (multi-signal staleness prediction), `track_concept_evolution` (entity timeline + link durability)

### Changed
- Suffix link cap reduced from unlimited to 3 per note

## [2.0.104] - 2026-03-19

### Added
- Multi-client setup guides (Cursor, Windsurf, VS Code, Continue)
- Multi-vault documentation overhaul
- HTTP server env vars (port, host, transport) surfaced in SETUP.md and README

## [2.0.103] - 2026-03-19

### Fixed
- CI failures: notes.ts type error + flaky AST perf test

## [2.0.102] - 2026-03-19

### Added
- Cross-vault search: `search` with no `vault` param iterates all vault contexts and merges results
- HTTP and multi-vault docs

## [2.0.101] - 2026-03-19

### Changed
- Daily note rotation + graph quality reports

## [2.0.100] - 2026-03-18

### Added
- HTTP transport (`FLYWHEEL_TRANSPORT=http/both`, `FLYWHEEL_HTTP_PORT`, `FLYWHEEL_HTTP_HOST`)
- Multi-vault support (`FLYWHEEL_VAULTS` env var, `vault` param on all tools)
- Quoted-terms in search (exact phrase matching)
- Windows path fixes

### Changed
- Removed `scope` param from search (use `vault` instead)
- Fixed folder filter in search

## [2.0.99] - 2026-03-18

### Added
- Filename sanitization in `vault_create_note` (strips invalid characters)

## [2.0.98] - 2026-03-18

### Fixed
- Multi-line `vault_replace_in_section` now works correctly
- Tightened implicit entity detection (fewer false positives)

## [2.0.97] - 2026-03-18

### Added
- Graph signals (hub score, backlinks, edge weight) applied to `recall` note scoring
- Linked items enriched with graph metadata in recall results

## [2.0.96] - 2026-03-18

### Fixed
- Auto-link entities independently per entry in daily notes (previously treated as one block)

## [2.0.95] - 2026-03-18

### Changed
- Increased wikilink suggestion recall without increasing noise (improved scoring thresholds)

## [2.0.94] - 2026-03-18

### Changed
- README improvements: intro rewrite, Windows callout
- Safe writes documentation expanded with AST protection and correction loop details
- Reduced Windows CI flakiness in package-startup test

## [2.0.93] - 2026-03-18

### Added

- Tiered search enrichment — top N results get full metadata, rest lightweight (`detail_count` param, default 5)
- Ranked backlinks/outlinks — top 10 per result scored by edge weight × recency decay (~4x context reduction)
- AST-based protected zone detection (replaces regex)
- `semantic_analysis` tool (extracted from `graph_analysis`)
- `vault_init` multi-mode (enrich, health, doctor)
- `dry_run` on all write tools
- Provenance flags (`in_fts5`, `in_semantic`, `in_entity`) + `rrf_score` on search results
- Auto-recovery from corrupted StateDb and ONNX model cache
- `bin/flywheel-memory.js` wrapper for npx permission fix on WSL

### Changed

- Search default limit 20 → 10
- Hub boost: tiered → log scaling with content relevance gate
- `graph_analysis` and `vault_schema` split into focused tools
- Tool parameter surface area reduced
- Discover thresholds raised (stub 2→5, cooc 3→10)
- `full` preset now excludes `memory` category (61 tools; add `,memory` for all 64)
- Headings removed from search results (use `get_note_structure`)

### Fixed

- Windows/WSL: `cmd /c npx`, postinstall chmod, `FLYWHEEL_WATCH_POLL`

## [2.0.20] - 2026-02-16

### Added

- Tool invocation tracking: every tool call is recorded with tool name, session
  ID, accessed note paths, duration, and success/failure (schema v7,
  `tool_invocations` table)
- `vault_activity` tool (health category) with 4 modes: session (current
  session summary), sessions (recent list), note_access (most-queried notes),
  tool_usage (tool usage patterns)
- `find_similar` tool (schema category): FTS5 BM25 content similarity to
  discover related notes, with optional linked-note exclusion
- `graph_analysis({ analysis: "immature" })`: note maturity scoring based on
  word count, outlinks, frontmatter completeness, and backlinks
- `graph_analysis({ analysis: "evolution" })`: graph topology metrics over time
  (avg_degree, cluster_count, largest_cluster_size, max_degree)
- `graph_analysis({ analysis: "emerging_hubs" })`: entities growing fastest in
  connection count
- `vault_schema({ analysis: "contradictions" })`: detect conflicting
  frontmatter values across notes referencing the same entity
- Graph topology snapshots: records avg_degree, max_degree, cluster_count,
  largest_cluster_size, and top 10 hubs on every index rebuild (schema v8,
  `graph_snapshots` table)
- `init_semantic` tool for on-demand semantic search initialization
- Hybrid search: automatic BM25 + semantic via Reciprocal Rank Fusion when
  embeddings exist
- `@huggingface/transformers` dependency for local embedding generation
- **Entity Embeddings**: `entity_embeddings` table (schema v10),
  `init_semantic` now builds note + entity embeddings, incremental updates via
  file watcher
- **Layer 9 Semantic Scoring**: `suggestRelatedLinks()` async with semantic
  similarity layer, conceptual link discovery (e.g., "deployment pipeline" →
  `[[CI/CD]]`), graceful degradation when embeddings unavailable
- **Semantic Graph Analysis**: `semantic_clusters` (embedding-based grouping),
  `semantic_bridges` (high similarity + no link path) modes in `graph_analysis`
- **Semantic Note Intelligence**: `semantic_links` mode in `note_intelligence`
- **Preflight Duplicate Detection**: semantic similarity check on note creation
- **Broken Link Semantic Fallback**: resolves broken links via embedding
  similarity
- **Heading Level Bumping**: `bumpHeadingLevels()` auto-nests headings in
  `insertInSection()`, opt-out via `bumpHeadings: false`
- **Diagnostic Errors**: `DiagnosticError` with closest match, per-line
  analysis, actionable suggestions on `MutationResult.diagnostic`

### Changed

- Schema version 6 → 10 (v7: tool_invocations, v8: graph_snapshots, v9:
  note_embeddings, v10: entity_embeddings)
- `suggestRelatedLinks()` is now async with 9-layer scoring (was 8)
- Tool count 41 → 42 (added init_semantic)
- Removed `FLYWHEEL_SEMANTIC` env var — semantic search is now always-on when
  embeddings are built
- Documentation: updated TOOLS.md, ARCHITECTURE.md (schema versioning section),
  CONFIGURATION.md (corrected tool counts), COOKBOOK.md (new examples),
  CLAUDE.md, vault-core README

## [2.0.13] - 2026-02-15

### Changed

- Comprehensive documentation overhaul: added ALGORITHM.md (10-layer scoring
  pipeline), PROVE-IT.md (guided 5-minute walkthrough), expanded zettelkasten
  README, rewrote VISION.md
- Standardized demo configs: added `.mcp.json` to nexus-lab, solo-operator,
  startup-ops; added CLAUDE.md personas to support-desk and zettelkasten;
  added `.claude/rules/` to all demos missing them
- Expanded README with "Why Deterministic", "See How It Thinks", and "The
  Flywheel Effect" sections
- Added "Inspecting the Algorithm" section to COOKBOOK.md

## [2.0.12] - 2026-02-15

### Added

- Implicit feedback via wikilink application tracking: records when wikilinks
  are applied, detects removals on next mutation, records negative feedback
  automatically (`wikilink_applications` table, schema v5)
- Accuracy metrics and feedback-weighted scoring: per-entity accuracy tracking,
  context-stratified accuracy (folder-aware), score explanation in detail mode
- Feedback boost tiers: +5 (>=95% accuracy), +2 (>=80%), 0 (>=60%), -2 (>=40%),
  -4 (<40%)

## [2.0.11] - 2026-02-15

### Added

- Bulk tag rename tool
- Growth metrics (vault_metrics table, schema v4)
- Wikilink feedback system: report correct/incorrect, list feedback, entity
  stats, folder-specific suppression (wikilink_feedback and
  wikilink_suppressions tables)
- Zettelkasten demo vault (47 notes: 10 fleeting, 7 literature, 22 permanent,
  4 project synthesis hubs)

## [2.0.10] - 2026-02-15

### Added

- Weighted path-finding in graph queries
- Tag hierarchy support
- Template-aware note creation

## [2.0.9] - 2026-02-15

### Added

- Tool-use examples in tool descriptions
- MCP resources support
- AI-content attribution

## [2.0.8] - 2026-02-15

### Changed

- Renamed crank → flywheel across entire codebase

## [2.0.7] - 2026-02-15

### Added

- Composable tool preset bundles: slim minimal preset to 13 tools with named
  bundles (graph, analysis, tasks, health, ops) that compose with each other
- CHANGELOG, CONTRIBUTING guide, and onboarding walkthrough
- Token counts to bundle table in README
- CI: split test job into named groups for per-category visibility

### Fixed

- Export missing functions used by cross-product tests
- CI: exclude Node 20 / macOS from test matrix

## [2.0.6] - 2026-02-15

### Changed

- Rewrote README with architecture overview, added TESTING.md and docs hub

## [2.0.5] - 2026-02-15

### Fixed

- Use correct property name `total` in tasks tool response

### Changed

- Removed dead tools and trimmed unused vault-core exports

## [2.0.4] - 2026-02-15

### Changed

- Tool surface rationalization: reduced from 76 to 36 tools (~44% token savings)
  - Unified search tool with scope enum (metadata/content/entities/all)
  - Unified tasks tool with status/path/has_due_date params
  - Consolidated graph analysis, vault schema, and note intelligence into
    single tools with action enums
  - Unified policy tool replacing separate diff/export/import tools
  - Absorbed temporal tools into search and vault stats

## [2.0.3] - 2026-02-15

### Added

- Note creation intelligence: alias collision detection, alias suggestions,
  and preflight similarity checks for `vault_create_note`
- Backlink warnings on `vault_delete_note` for safer deletions
- `getEntitiesByAlias()` query in vault-core

### Changed

- Consolidated FTS5 search database into StateDb, eliminating duplicate
  database files
- Schema upgraded to version 2; removed legacy migration code (~850 lines)

### Fixed

- `suggestRelatedLinks()` staleness gap (missing `checkAndRefreshIfStale`)

## [2.0.2] - 2026-02-15

### Changed

- Rewrote all documentation with verified vault data

## [2.0.1] - 2026-02-14

### Fixed

- Relaxed memory scaling threshold to avoid flaky CI failures
- Windows CI compatibility: use `mkdirSync` instead of `mkdir -p`
- Removed broken tests and fixed blocking chain assertions
- Made malformed YAML test tolerant of gray-matter behavior differences
- Resolved TS2556 spread argument type error in tool gating
- Replaced mcp-testing-kit with custom test transport; fixed tokenizer
  minimum word length (4 to 3 chars) for short entity names

## [2.0.0] - 2026-02-14

### Added

- Unified flywheel-memory project: 73 MCP tools (51 read + 22 write),
  vault-core package, benchmark suite, 4 demo vaults, and comprehensive
  test suite
- CI workflows for linting and testing
- Strategic README with project positioning

[Unreleased]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.150...HEAD
[2.0.146-150]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.145...flywheel-memory-v2.0.150
[2.0.136-145]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.135...flywheel-memory-v2.0.145
[2.0.126-135]: https://github.com/velvetmonkey/flywheel-memory/compare/v2.0.125...flywheel-memory-v2.0.135
[2.0.116-125]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.115...v2.0.125
[2.0.108-115]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.107...flywheel-memory-v2.0.115
[2.0.107]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.106...flywheel-memory-v2.0.107
[2.0.106]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.105...flywheel-memory-v2.0.106
[2.0.105]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.104...flywheel-memory-v2.0.105
[2.0.104]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.103...flywheel-memory-v2.0.104
[2.0.103]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.102...flywheel-memory-v2.0.103
[2.0.102]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.101...flywheel-memory-v2.0.102
[2.0.101]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.100...flywheel-memory-v2.0.101
[2.0.100]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.99...flywheel-memory-v2.0.100
[2.0.99]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.98...flywheel-memory-v2.0.99
[2.0.98]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.97...flywheel-memory-v2.0.98
[2.0.97]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.96...flywheel-memory-v2.0.97
[2.0.96]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.95...flywheel-memory-v2.0.96
[2.0.95]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.94...flywheel-memory-v2.0.95
[2.0.94]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.93...flywheel-memory-v2.0.94
[2.0.93]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.20...flywheel-memory-v2.0.93
[2.0.20]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.13...flywheel-memory-v2.0.20
[2.0.13]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.12...flywheel-memory-v2.0.13
[2.0.12]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.11...flywheel-memory-v2.0.12
[2.0.11]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.10...flywheel-memory-v2.0.11
[2.0.10]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.9...flywheel-memory-v2.0.10
[2.0.9]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.8...flywheel-memory-v2.0.9
[2.0.8]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.7...flywheel-memory-v2.0.8
[2.0.7]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.6...flywheel-memory-v2.0.7
[2.0.6]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.5...flywheel-memory-v2.0.6
[2.0.5]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.4...flywheel-memory-v2.0.5
[2.0.4]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.3...flywheel-memory-v2.0.4
[2.0.3]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.2...flywheel-memory-v2.0.3
[2.0.2]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.1...flywheel-memory-v2.0.2
[2.0.1]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.0...flywheel-memory-v2.0.1
[2.0.0]: https://github.com/velvetmonkey/flywheel-memory/releases/tag/flywheel-memory-v2.0.0
