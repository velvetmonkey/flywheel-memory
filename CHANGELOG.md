# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Composable tool preset bundles: slim minimal preset to 13 tools with named
  bundles (graph, analysis, tasks, health, ops) that compose with each other

### Fixed

- Export missing functions used by cross-product tests

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

[Unreleased]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.6...HEAD
[2.0.6]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.5...flywheel-memory-v2.0.6
[2.0.5]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.4...flywheel-memory-v2.0.5
[2.0.4]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.3...flywheel-memory-v2.0.4
[2.0.3]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.2...flywheel-memory-v2.0.3
[2.0.2]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.1...flywheel-memory-v2.0.2
[2.0.1]: https://github.com/velvetmonkey/flywheel-memory/compare/flywheel-memory-v2.0.0...flywheel-memory-v2.0.1
[2.0.0]: https://github.com/velvetmonkey/flywheel-memory/releases/tag/flywheel-memory-v2.0.0
