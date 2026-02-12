# Flywheel Memory - Claude Code Instructions

**Flywheel Memory** is a unified local-first memory layer for AI agents. It combines the read capabilities of Flywheel with the write capabilities of Flywheel-Crank into a single MCP server.

---

## Vision: The Complete Local Memory Stack

```
┌────────────────────────────────────────────────────────────────┐
│                     Your Markdown Vault                        │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   Flywheel Memory (73 tools)                                   │
│   ══════════════════════════                                   │
│                                                                │
│   READ (51 tools)              WRITE (22 tools)                │
│   • search_notes()             • vault_add_to_section()        │
│   • get_backlinks()            • vault_toggle_task()           │
│   • memory_search()            • memory_add()                  │
│                                                                │
│   + MEMORY (new)                                               │
│   • memory_add()     - Store memories                          │
│   • memory_search()  - FTS5 + optional semantic                │
│   • memory_update()  - Update existing                         │
│   • memory_delete()  - Remove memories                         │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## Competitive Positioning

Flywheel Memory competes with:
- **Mem0** (47k stars) - Cloud memory API
- **LangMem** - LangGraph-specific memory
- **Letta** - Research-focused memory

Our differentiators:
1. **Local-first** - No cloud dependency
2. **Deterministic** - Same input = same output
3. **Debuggable** - Git blame your memories
4. **Standard format** - Plain markdown, no lock-in
5. **73 tools** - More comprehensive than competitors

---

## Architecture

### Source Structure

```
src/
├── index.ts                 # MCP server entry point
├── tools/
│   ├── read/                # From Flywheel (51 tools)
│   │   ├── search.ts        # search_notes, search_by_tag, etc.
│   │   ├── sections.ts      # get_section_content, list_sections
│   │   ├── backlinks.ts     # get_backlinks, get_outlinks
│   │   ├── frontmatter.ts   # get_frontmatter, get_all_tags
│   │   └── graph.ts         # get_related_notes, graph_query
│   ├── write/               # From Flywheel-Crank (22 tools)
│   │   ├── mutations.ts     # add/remove/replace in sections
│   │   ├── tasks.ts         # toggle/add tasks
│   │   ├── notes.ts         # create/delete/move/rename
│   │   ├── frontmatter.ts   # update frontmatter
│   │   └── policies.ts      # workflow orchestration
│   └── memory/              # NEW unified memory tools
│       ├── add.ts           # memory_add
│       ├── search.ts        # memory_search (FTS5 + semantic)
│       ├── update.ts        # memory_update
│       └── delete.ts        # memory_delete
├── core/
│   ├── vault.ts             # Vault operations (from vault-core)
│   ├── wikilinks.ts         # Auto-linking (from vault-core)
│   └── git.ts               # Git integration
└── search/
    ├── fts5.ts              # SQLite FTS5 keyword search
    └── semantic.ts          # Optional vector search (OpenAI/local)
```

### Dependencies

- `@velvetmonkey/vault-core` - Shared utilities (entity scanning, wikilinks, SQLite)
- `@modelcontextprotocol/sdk` - MCP protocol
- `better-sqlite3` - SQLite with FTS5
- `gray-matter` - Frontmatter parsing
- `simple-git` - Git operations
- `chokidar` - File watching

---

## Search Strategy

### FTS5 (Built-in, Default)

SQLite Full-Text Search 5:
- BM25 ranking
- Stemming (Porter)
- Phrase matching
- Prefix search
- <10ms queries on 10k+ notes

```sql
SELECT * FROM notes_fts WHERE notes_fts MATCH 'billing refund'
ORDER BY rank;
```

### Semantic Search (Optional)

When `EMBEDDING_PROVIDER` is set:
1. Embed query using provider (OpenAI or local)
2. Search vector index for similar embeddings
3. Combine with FTS5 results (hybrid ranking)

Providers:
- `openai` - Uses `text-embedding-3-small`
- `local` - Uses sentence-transformers (larger package)

---

## Development

```bash
# Build
npm run build

# Test
npm test

# Watch mode
npm run dev

# Type check
npm run lint
```

---

## Migration Notes

This project consolidates:
- `@velvetmonkey/flywheel-mcp` (read tools)
- `@velvetmonkey/flywheel-crank` (write tools)

Old packages will be deprecated with notice pointing to flywheel-memory.

---

## Roadmap

### v1.0.0 (Launch)
- [ ] Merge all 73 tools from flywheel + flywheel-crank
- [ ] New memory_* tools (add, search, update, delete)
- [ ] FTS5 keyword search
- [ ] Customer support demo vault
- [ ] 4-step quickstart README
- [ ] Migration guide from separate packages

### v1.1.0 (Semantic Search)
- [ ] Optional OpenAI embeddings
- [ ] Optional local embeddings
- [ ] Hybrid search ranking

### v1.2.0 (Memory Types)
- [ ] Episodic memory (conversations)
- [ ] Semantic memory (facts)
- [ ] Procedural memory (instructions)

### v2.0.0 (Enterprise)
- [ ] SOC 2 compliance docs
- [ ] Audit log export
- [ ] Multi-vault support

---

## License

Apache-2.0
