<div align="center">
  <img src="header.png" alt="Flywheel" width="256"/>
  <h1>Flywheel</h1>
  <p><strong>Persistent knowledge graph memory for AI agents. Structured vault with semantic search, read, and write tools. Works with Obsidian.</strong></p>
</div>

[![npm version](https://img.shields.io/npm/v/@velvetmonkey/flywheel-memory.svg)](https://www.npmjs.com/package/@velvetmonkey/flywheel-memory)
[![CI](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)

## Install

```bash
npx -y skills add velvetmonkey/flywheel-memory -g
bash <(curl -fsSL https://raw.githubusercontent.com/velvetmonkey/flywheel-memory/main/skills/flywheel/scripts/install.sh)
```

Or hand-edit `<vault>/.mcp.json`:

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-memory"]
    }
  }
}
```

Windows: use `cmd /c npx` and set `FLYWHEEL_WATCH_POLL: "true"`. Multi-vault: `FLYWHEEL_VAULTS=name1:/path1,name2:/path2`. Full setup: [docs/SETUP.md](docs/SETUP.md) · [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Tool presets

<!-- GENERATED:preset-counts START -->
| Preset | Tools | Categories | Behaviour |
|--------|-------|------------|-----------|
| `agent` (default) | 13 | search, read, write, tasks, memory, diagnostics | Focused tier-1 surface — search, read, write, tasks, memory |
| `power` | 17 | search, read, write, tasks, memory, diagnostics, wikilinks, corrections, note-ops, schema | Tier 1+2 — agent + wikilinks, corrections, note-ops, schema |
| `full` | 19 | search, read, write, tasks, memory, diagnostics, wikilinks, corrections, note-ops, schema, graph, temporal | All categories visible at startup |
| `auto` | 20 | search, read, write, graph, schema, wikilinks, corrections, tasks, memory, note-ops, temporal, diagnostics | Full surface + informational `discover_tools` helper |
<!-- GENERATED:preset-counts END -->

<!-- GENERATED:claude-code-memory-note START -->
> **Claude Code note:** the `memory` merged tool is suppressed under Claude Code
> (`CLAUDECODE=1`) because Claude Code ships its own memory plane. Agent preset
> exposes 12 tools under Claude Code instead of 13;
> the briefing entrypoint still works as `memory(action: "brief")`.
<!-- GENERATED:claude-code-memory-note END -->

Select via `FLYWHEEL_TOOLS=agent|power|full|auto`. Full tool reference: [docs/TOOLS.md](docs/TOOLS.md).

## Benchmarks

[![HotpotQA](https://img.shields.io/badge/HotpotQA-90.0%25%20recall%20(50q)-brightgreen.svg)](docs/TESTING.md#retrieval-benchmark-hotpotqa)
[![LoCoMo](https://img.shields.io/badge/LoCoMo-81.9%25%20evidence%20recall%20(695q)-blue.svg)](docs/TESTING.md#retrieval-benchmark-locomo)

| Benchmark | Result | Sample |
|---|---|---|
| HotpotQA | **90.0%** document recall | 50q / 4,960 docs |
| LoCoMo | **81.9%** evidence recall, **54.0%** answer accuracy | 695q / 272 sessions |

Methodology: [docs/TESTING.md](docs/TESTING.md).

## Documentation

| Doc | Why read it |
|---|---|
| [TOOLS.md](docs/TOOLS.md) | Tool reference |
| [SETUP.md](docs/SETUP.md) | Client setup |
| [CONFIGURATION.md](docs/CONFIGURATION.md) | Env vars and presets |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Indexing and graph design |
| [ALGORITHM.md](docs/ALGORITHM.md) | Scoring details |
| [TESTING.md](docs/TESTING.md) | Benchmarks and methodology |

## License

Apache-2.0.
