<div align="center">
  <img src="header.png" alt="Flywheel" width="256"/>
  <h1>Flywheel</h1>
  <p><strong>Persistent knowledge graph memory for AI agents. Structured vault with semantic search, read, and write tools. Works with Obsidian.</strong></p>
</div>

[![CI](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)

## Install

Flywheel runs from a git clone — it is not distributed via npm (the registry
package is frozen; see [docs/local-deploy.md](docs/local-deploy.md)).

```bash
git clone https://github.com/velvetmonkey/flywheel-memory
cd flywheel-memory
npm ci && npm run build
```

Then point your client's MCP config at the built server — e.g. `<vault>/.mcp.json`:

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "node",
      "args": ["/path/to/flywheel-memory/packages/mcp-server/dist/index.js"]
    }
  }
}
```

Windows: set `FLYWHEEL_WATCH_POLL: "true"`. Multi-vault: `FLYWHEEL_VAULTS=name1:/path1,name2:/path2`. Full setup: [docs/SETUP.md](docs/SETUP.md) · [docs/CONFIGURATION.md](docs/CONFIGURATION.md) · versioned deploys: [docs/local-deploy.md](docs/local-deploy.md).

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
