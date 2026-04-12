# Flywheel Documentation

[← Back to main README](../README.md)

Flywheel has three layers of documentation:

- Start here if you are setting up a client or choosing a preset.
- Use the tools guide when you know the job you want done but not the right tool.
- Drop into architecture, testing, and prove-it docs when you need implementation detail or evidence.

## Start Here

| Document | Use it for |
|---|---|
| [SETUP.md](SETUP.md) | Install Flywheel in Claude, Codex, Cursor, or other MCP clients |
| [CONFIGURATION.md](CONFIGURATION.md) | Choose a preset, set env vars, and manage runtime config |
| [TOOLS.md](TOOLS.md) | Map a task to the right tool family, then drill into the full reference |
| [COOKBOOK.md](COOKBOOK.md) | See realistic prompts and workflows |

## Technical Reference

| Document | Use it for |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Search pipeline, graph model, watcher flow, and server internals |
| [ALGORITHM.md](ALGORITHM.md) | Wikilink scoring and suggestion mechanics |
| [TESTING.md](TESTING.md) | Coverage, benchmarks, and verification strategy |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Startup, indexing, StateDb, and git recovery |
| [SECURITY.md](SECURITY.md) | Reverse proxy, auth, and network exposure guidance |
| [PROVE-IT.md](PROVE-IT.md) | Hands-on validation with demos and benchmarks |

## Integrations

| Document | Use it for |
|---|---|
| [OPENCLAW.md](OPENCLAW.md) | OpenClaw setup and routing patterns |
| [POLICIES.md](POLICIES.md) | Saved workflows that search and write atomically |
| [POLICY_EXAMPLES.md](POLICY_EXAMPLES.md) | Concrete policy examples |

## Quick Answers

- Want the smallest useful surface? Use `agent`.
- Want link cleanup, schema work, and note ops without the full surface? Use `power`.
- Want everything visible immediately? Use `full`.
- Still using `auto`? It behaves like `full` plus an informational `discover_tools` helper.
- Need runtime settings? Use `doctor(action: "config")`.

## Demos

- [carter-strategy](../demos/carter-strategy/) for the consultant / PKM workflow
- [artemis-rocket](../demos/artemis-rocket/) for engineering/project context
- [nexus-lab](../demos/nexus-lab/) for research-style notes
- [zettelkasten](../demos/zettelkasten/) for dense idea linking
