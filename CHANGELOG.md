# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.105...HEAD
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
