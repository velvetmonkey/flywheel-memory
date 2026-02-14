# Flywheel Memory - Claude Code Instructions

**Flywheel Memory** is an MCP server that gives Claude full read/write access to Obsidian vaults. 76 tools for search, backlinks, graph queries, tasks, frontmatter, and note mutations — all local, all markdown.

---

## Architecture

### Source Structure

```
src/
├── index.ts                 # MCP server entry point + tool preset gating
├── tools/
│   ├── read/                # 54 read tools
│   │   ├── search.ts        # search_notes, search_by_tag, etc.
│   │   ├── sections.ts      # get_section_content, list_sections
│   │   ├── backlinks.ts     # get_backlinks, get_outlinks
│   │   ├── frontmatter.ts   # get_frontmatter, get_all_tags
│   │   └── graph.ts         # get_related_notes, find_hub_notes, get_shortest_path
│   └── write/               # 22 write tools
│       ├── mutations.ts     # add/remove/replace in sections
│       ├── tasks.ts         # toggle/add tasks
│       ├── notes.ts         # create/delete/move/rename
│       ├── frontmatter.ts   # update frontmatter
│       └── policies.ts      # workflow orchestration
├── core/
│   ├── vault.ts             # Vault operations (from vault-core)
│   ├── wikilinks.ts         # Auto-linking (from vault-core)
│   └── git.ts               # Git integration
└── search/
    └── fts5.ts              # SQLite FTS5 keyword search
```

### Dependencies

- `@velvetmonkey/vault-core` - Shared utilities (entity scanning, wikilinks, SQLite)
- `@modelcontextprotocol/sdk` - MCP protocol
- `better-sqlite3` - SQLite with FTS5
- `gray-matter` - Frontmatter parsing
- `simple-git` - Git operations
- `chokidar` - File watching

---

## Tool Presets

Controlled by `FLYWHEEL_TOOLS` env var:

- **`full`** (default) — All 76 tools
- **`minimal`** — ~30 tools for search, backlinks, tasks, and note editing

Per-tool category gating in `index.ts` via monkey-patched `server.tool()` and `server.registerTool()`.

Categories: `search`, `backlinks`, `orphans`, `hubs`, `paths`, `temporal`, `periodic`, `schema`, `structure`, `tasks`, `health`, `wikilinks`, `append`, `frontmatter`, `sections`, `notes`, `git`, `policy`

---

## Search

### FTS5 (Built-in)

SQLite Full-Text Search 5:
- BM25 ranking
- Stemming (Porter)
- Phrase matching, prefix search
- <10ms queries on 10k+ notes

---

## Development

```bash
npm run build    # Build both packages
npm test         # Run tests (packages/mcp-server)
npm run dev      # Watch mode
npm run lint     # Type check
```

---

## Migration Notes

This project consolidates:
- `@velvetmonkey/flywheel-mcp` (read tools)
- `@velvetmonkey/flywheel-crank` (write tools)

Old packages will be deprecated with notice pointing to flywheel-memory.

---

## License

Apache-2.0
