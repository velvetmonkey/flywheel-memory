# Vision

Flywheel Memory exists because AI agents shouldn't need to read your entire vault to answer a question.

---

## The Problem

Claude can read files. But reading files is not understanding a vault.

A 500-note Obsidian vault is ~250,000 tokens of raw markdown. Dumping that into context is expensive, slow, and imprecise. Worse, it misses the structure that makes a vault useful: which notes link to which, what's changed recently, what's orphaned, what's a hub.

File access gives Claude your content. Flywheel gives it your knowledge graph.

---

## The Flywheel Effect

The name is literal. Every interaction makes the next one better.

1. **Claude reads** your vault through indexed queries instead of raw file scans
2. **Claude writes** to your vault with auto-wikilinks, connecting new content to existing notes
3. **The graph grows** -- more links mean better search results, hub detection, and path finding
4. **Queries get richer** -- backlinks surface related context that raw search would miss
5. **Repeat** -- each write strengthens the graph, each read leverages it

This is the flywheel: use compounds into structure, structure compounds into intelligence. A vault that's been worked with Flywheel for a month has a denser, more navigable graph than one that hasn't.

---

## Design Principles

### Local-First

Everything runs on your machine. No cloud services, no API keys (beyond Claude itself), no data leaving your disk. The SQLite databases live inside your vault directory. Delete them and they rebuild from your markdown files.

### Markdown Is the Source of Truth

Flywheel never creates proprietary formats. It reads `.md` files and writes `.md` files. The indexes (SQLite FTS5, entity maps, backlink graphs) are derived from your markdown and can be fully regenerated at any time.

### Zero Configuration

Drop a `.mcp.json` file in your vault. That's it. Flywheel auto-detects your periodic note folders, template directories, and vault conventions. No schema definitions, no config files, no setup wizards.

### Token Efficiency

A vault is 250K tokens. A Flywheel query returns 100-500 tokens of precisely targeted information: metadata, links, structure, and snippets. The FTS5 index answers in under 10ms. The backlink map is O(1) lookup. Claude gets the answer without reading the files.

---

## Architecture Philosophy

### One Server, Many Tools

36 tools across 15 categories might sound like a lot. But each tool does one thing well, and the tool preset system lets you load only what you need. The `minimal` preset gives you 24 tools in ~5,200 tokens. The `full` preset gives you all 36 tools at ~11,100 tokens. Custom category sets let you tune the exact tradeoff.

This design means Claude can pick the right tool for each subtask: `search` for finding content, `get_backlinks` for navigating the graph, `vault_add_to_section` for writing. No giant multipurpose tools with complex parameter matrices.

### Index Everything, Query Anything

At startup, Flywheel builds an in-memory index of every note: titles, aliases, frontmatter, tags, outlinks, backlinks. This index enables instant graph traversal without touching the filesystem. A separate FTS5 index handles full-text search with BM25 ranking and Porter stemming.

The cost is a few seconds of startup time (or ~100ms with cache hit). The benefit is sub-millisecond queries for the rest of the session.

### Writes Build the Graph

Every mutation tool (add content, create note, toggle task) runs through the auto-wikilink engine. When Claude writes "Met with Alex about the React migration", Flywheel checks the entity index and produces "Met with [[Alex Chen]] about the [[React Migration]]". The knowledge graph builds itself as a side effect of normal use.

---

## The Ecosystem

### Flywheel Memory (This Project)

The MCP server. Gives Claude structured access to Obsidian vaults: search, graph queries, frontmatter analysis, content mutations, task management, and policy automation. Published as `@velvetmonkey/flywheel-memory`.

### Vault-Core

Shared library used by Flywheel Memory and other tools in the ecosystem. Handles SQLite state management, entity scanning, wikilink application, and protected zone detection. Published as `@velvetmonkey/vault-core`.

---

## Who This Is For

Flywheel Memory is for anyone who uses an Obsidian vault as their working memory and wants Claude to understand it, not just read it.

- **Consultants** tracking clients, projects, invoices, and meetings
- **Researchers** navigating literature notes, experiment logs, and citation networks
- **Engineers** maintaining project documentation, decision logs, and architecture notes
- **Content creators** managing editorial calendars, drafts, and publication workflows
- **Teams** running support desks, onboarding playbooks, and knowledge bases

The demo vaults in this repo cover these personas with production-realistic data.
