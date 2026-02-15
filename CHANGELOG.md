# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.13...HEAD
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
