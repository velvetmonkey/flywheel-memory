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
