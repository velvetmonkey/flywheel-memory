# Vision

Your vault is the most valuable dataset you own. It holds your professional memory, your decision history, your relationship map, the accumulated context of every project you've ever worked on. It deserves infrastructure as serious as a production database -- indexed, queryable, and aware of its own structure.

Flywheel Memory is that infrastructure.

---

## The State of Knowledge Work

There's a gap between "I wrote about this somewhere" and actually finding it -- linked to its context, connected to the people and projects it belongs to. The gap isn't in the notes themselves. It's in the lack of structure between them.

You write a meeting note about a client. Two weeks later you write a project update that references the same client. A month later you write a decision record that depends on both. These three notes are deeply related, but nothing connects them. Search gives you keywords. What you need is a graph -- relationships, backlinks, the ability to ask "what connects these things?"

Most knowledge tools solve for capture. Flywheel solves for retrieval, connection, and compound intelligence.

---

## The Vision Stack

The complete picture looks like this:

```
Voice → Transcription → AI Agent → Flywheel → Queryable Knowledge
```

You're walking to lunch after a meeting. You pull out your phone and say: "Log that we agreed to push the launch to March. Sarah owns the migration, and Alex is handling the API contract with Acme." Your voice becomes a transcript. The AI agent sends it to Flywheel. Flywheel recognizes `[[Sarah Mitchell]]`, `[[Alex Chen]]`, `[[Acme Corp]]`, and `[[API Contract]]` from your existing vault. It writes the note, links it to the right entities, and the knowledge graph grows -- all before you've sat down.

The next time you ask "What's the latest on the Acme deal?", the answer is already indexed, linked, and ready in under 10ms.

---

## The Flywheel Effect

The name is literal. Every interaction makes the next one better.

**Use compounds into structure.** Every note you write through Flywheel gets auto-linked to entities it recognizes. More notes means a denser graph.

**Structure compounds into intelligence.** A denser graph means better search results, richer backlink context, stronger hub detection, and more precise path-finding between concepts.

**Intelligence compounds into use.** Better answers mean you use the system more, which feeds more structure, which deepens intelligence.

A vault that has been worked with Flywheel for a month has a fundamentally different character than one that hasn't -- more connected, more navigable, more useful with every query.

See the main [README](../README.md) for the expanded flywheel diagram.

---

## The Principles

### Local-first: your trust guarantee

Everything runs on your machine. No cloud services, no API keys (beyond Claude itself), no data leaving your disk. The SQLite databases live inside your vault directory. Delete them and they rebuild from your markdown. You are always in control.

### Markdown is truth: zero lock-in

Flywheel never creates proprietary formats. It reads `.md` files and writes `.md` files. The indexes -- SQLite FTS5, entity maps, backlink graphs -- are derived from your markdown and can be fully regenerated at any time. Walk away tomorrow and you lose nothing.

### Zero config: using it in 30 seconds

Drop a 6-line `.mcp.json` file in your vault. That's it. Flywheel auto-detects your periodic note folders, template directories, and vault conventions. No schema definitions, no setup wizards.

### Deterministic: every suggestion is verifiable

Auto-wikilinks aren't magic -- they're a 10-layer scoring algorithm you can inspect, trace, and override. Every suggestion has a score breakdown. Every suppression has a reason. See [ALGORITHM.md](ALGORITHM.md) for the full specification.

---

## Who Builds With Flywheel

Flywheel is for anyone who uses a vault as working memory and wants compound returns on the time they invest in it.

**The consultant** who tracks 12 clients, 40 invoices, and 200 meeting notes. Flywheel saves 2 hours a week by answering "What did we agree with Acme last month?" from the graph instead of digging through folders.

**The researcher** navigating 300 literature notes, 50 experiment logs, and a citation network that keeps growing. Flywheel finds citation chains -- "Which papers connect AlphaFold to my CRISPR experiment?" -- that manual search would miss entirely.

**The founder** running a SaaS startup with standups, OKRs, decision records, and onboarding playbooks. Flywheel turns the vault into an operational dashboard: "What's blocking the Q1 launch?" pulls from milestones, meeting notes, and team assignments simultaneously.

**The student** connecting concepts across 5 textbooks and 100 lecture notes. Flywheel surfaces structural connections -- "How does spaced repetition connect to active recall?" -- by traversing the link graph across notebooks, not just matching keywords.

The demo vaults in this repo cover these personas with production-realistic data. See [Demo Vaults](README.md#demo-vaults).

---

## The Ecosystem

### Flywheel Memory

The MCP server. 42 tools across 15 categories give Claude structured access to Obsidian vaults: search, graph queries, frontmatter analysis, content mutations, task management, and policy automation. Published as `@velvetmonkey/flywheel-memory`.

### Vault-Core

Shared library used by Flywheel Memory and other tools in the ecosystem. Handles SQLite state management, entity scanning, wikilink application, scoring algorithms, and protected zone detection. Published as `@velvetmonkey/vault-core`.

### MCP

Flywheel implements the [Model Context Protocol](https://modelcontextprotocol.io/). Any MCP-compatible client -- Claude Code, Claude Desktop, or third-party tools -- can connect and use the full tool surface. The protocol is the integration layer; Flywheel is the intelligence layer.
