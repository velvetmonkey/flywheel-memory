# Contributing to Flywheel Memory

## Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0

## Development Setup

Flywheel is an npm workspaces monorepo. Install everything from the root:

```bash
git clone https://github.com/velvetmonkey/flywheel-memory.git
cd flywheel-memory
npm install
```

Build all packages:

```bash
npm run build
```

Run all tests:

```bash
npm test
```

## Project Structure

```
packages/
  core/         # @velvetmonkey/vault-core -- shared utilities (entity scanning, wikilinks, SQLite)
  mcp-server/   # @velvetmonkey/flywheel-memory -- the MCP server (42 tools)
  bench/        # @velvetmonkey/flywheel-bench -- benchmark infrastructure and vault generation
  demos/        # Demo vault fixtures (also used as test fixtures in CI)
```

## Per-Package Commands

### vault-core (`packages/core`)

```bash
npm test -w @velvetmonkey/vault-core
npm run lint -w @velvetmonkey/vault-core
```

### mcp-server (`packages/mcp-server`)

```bash
npm test -w @velvetmonkey/flywheel-memory         # All tests
npm run test:read -w @velvetmonkey/flywheel-memory  # Read tool tests only
npm run test:write -w @velvetmonkey/flywheel-memory # Write tool tests only
npm run test:security -w @velvetmonkey/flywheel-memory
npm run test:stress -w @velvetmonkey/flywheel-memory
npm run dev -w @velvetmonkey/flywheel-memory        # Watch mode (esbuild)
```

### bench (`packages/bench`)

```bash
npm run bench -w @velvetmonkey/flywheel-bench
npm run bench:all -w @velvetmonkey/flywheel-bench
```

## Code Style

- **TypeScript** throughout. Type checking via `npm run lint` (runs `tsc --noEmit`).
- **Vitest** for all tests.
- **esbuild** for the MCP server bundle; **tsc** for vault-core and bench.

## Known Platform Issues

`better-sqlite3` can segfault on Node 20 + macOS in some configurations. CI runs the full matrix on Node 22 (ubuntu) with a Node 20 cross-platform matrix (ubuntu + windows). If you hit native module issues on macOS, try Node 22.

## Submitting a Pull Request

1. Fork the repo and create a branch from `main`.
2. Make your changes. Add or update tests as appropriate.
3. Run `npm run build && npm test` from the root to verify everything passes.
4. Run `npm run lint` to confirm type checking passes.
5. Open a PR against `main`. CI will run lint, build, and the full test suite automatically.

Keep PRs focused -- one logical change per PR.

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 License](LICENSE).
