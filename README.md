# Flywheel Memory

> **ARCHIVED** - This project was an experimental attempt to unify Flywheel and Flywheel-Crank into a single package for AI agent memory. After market research and competitive analysis, we've decided to focus Flywheel and Flywheel-Crank on their core strength: **deterministic AI workflows for personal knowledge management (PKM)**.

---

## Why Archived?

| Factor | AI Agent Memory | PKM Focus |
|--------|-----------------|-----------|
| Competition | Mem0 ($50M, 47k stars), LangMem | Minimal |
| Technical fit | SQLite/git concurrency challenges | Works great for single-user |
| Market | Crowded, consolidating | Underserved, growing |
| Differentiation | Hard to defend | Git audit trail, determinism |

The PKM market has minimal competition and is better suited to Flywheel's architecture (single-user, local-first, git-integrated).

---

## Use Instead

For personal knowledge management with AI assistance, use the original packages:

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-mcp"],
      "env": { "PROJECT_PATH": "/path/to/vault" }
    },
    "flywheel-crank": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-crank"],
      "env": { "PROJECT_PATH": "/path/to/vault" }
    }
  }
}
```

- [Flywheel](https://github.com/velvetmonkey/flywheel) - 51 read-only tools for search, backlinks, and graph queries
- [Flywheel-Crank](https://github.com/velvetmonkey/flywheel-crank) - 22 write tools for deterministic vault mutations

---

## What This Code Contains

This repository contains the scaffolding for a unified MCP server that would have merged:
- 51 read tools from Flywheel
- 22 write tools from Flywheel-Crank
- New `memory_*` tools for AI agent workflows

The code is incomplete and should not be used in production.

---

## License

Apache-2.0
