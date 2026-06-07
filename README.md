<div align="center">
  <img src="header.png" alt="Flywheel" width="256"/>
  <h1>Flywheel</h1>
  <p><strong>Persistent knowledge graph memory for AI agents. Structured vault with semantic search, read, and write tools. Works with Obsidian.</strong></p>
</div>

[![CI](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/velvetmonkey/flywheel-memory/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)

## Why researchers plug it in

Your AI forgets everything between sessions. Flywheel gives it a persistent,
compounding memory over your own notes, so every conversation builds on the last
instead of starting from zero. Point any MCP client (Claude, Codex, Cursor) at
your vault and the agent reads, searches, and writes it as ground truth.

What you get the moment you plug it in:

- **Memory that compounds.** The more you use it, the sharper retrieval gets. A self-correcting loop, not a static index.
- **One call, a decision surface.** A search returns ranked notes plus entities, backlinks, outlinks, provenance, and confidence. Not a pile of files to wade through.
- **Your graph becomes the reasoning substrate.** The agent thinks in your concepts, your links, your history.

It turns a flat pile of markdown into an exocortex your AI can actually pilot.
That is the difference between an assistant that answers and one that remembers.

## Features

- **Hybrid search, three channels fused.** Full-text (BM25), entity, and semantic vector search combined by Reciprocal Rank Fusion. Keyword precision and meaning recall in a single call.
- **U-shaped result ordering.** Best hits placed at the head and tail where LLMs actually read, beating the "lost in the middle" failure.
- **13-layer wikilink scoring.** Auto-suggests `[[entities]]` with a transparent, ablatable score, then learns from which links survive.
- **Self-correcting flywheel.** Implicit feedback, survival tracking, edge-weight accumulation, and suppression. Day 1 it guesses; month 3 it knows your graph.
- **Gravity ranking.** Surfaces what matters now by pull, not just lexical match (Gravity Basin Protocol companion).
- **Knowledge-graph queries.** Backlinks, forward links, hub detection, shortest path between notes, orphan and dead-end detection.
- **Structured read, safe write.** Section-level reads and outlines; content-hash conflict detection on writes; move and rename that preserve links.
- **Semantic over an open substrate.** Embeddings with contextual prefixes and dual-granularity section expansion, all over plain markdown you own.
- **Multi-vault, local-first, audited.** One vault or many; every mutation logged; no lock-in, because it is just files.

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

## Philosophy

Flywheel is a research platform, not an Obsidian plugin. It writes Obsidian
markdown on purpose: an open, human-readable format means the entire memory is
transparent and inspectable with any third-party tooling (Obsidian, graph
viewers, git, grep, plain text). Obsidian is a viewer, not the product. The
knowledge graph (backlinks and wikilink nodes) is a free dividend of writing to
an open substrate, not the reason the system exists.

The practical consequence: you can open the vault and trace any thread end to
end without Flywheel's code in the loop. Transparency via an open format is the
moat. Wikilinking is a retrieval and provenance mechanism over that open
substrate, not a courtesy to a particular editor.

## License

Apache-2.0.
