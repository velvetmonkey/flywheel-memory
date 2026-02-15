---
type: meta
tags:
  - demo
  - zettelkasten
---

# Zettelkasten Demo Vault

A demonstration vault for testing [Flywheel Memory](https://github.com/nickarail/flywheel-memory) features using a Zettelkasten-style knowledge management system.

## Topic

**Cognitive science & learning theory** -- covering spaced repetition, active recall, metacognition, cognitive load, dual coding, and related concepts.

## Structure

| Folder | Count | Purpose |
|--------|-------|---------|
| `fleeting/` | 10 | Quick captures and raw ideas |
| `literature/` | 7 | Book and paper summaries |
| `permanent/` | 18 | Atomic, well-developed concept notes |
| `projects/` | 4 | Synthesis hubs that pull many notes together |
| `daily-notes/` | 5 | Dated journal entries |
| `templates/` | 3 | Note templates with placeholders |

## Features Exercised

- **search** -- full-text search across all notes
- **backlinks** -- dense wikilink graph (~150 links, no orphan permanent notes)
- **graph_analysis** -- rich connections for cluster and hub detection
- **vault_schema** -- consistent YAML frontmatter on every note
- **suggest_wikilinks** -- content written to surface natural linking opportunities
- **tags** -- inline `#tags` and frontmatter tag arrays for filtering
- **rename_tag** -- multiple shared tags across folders for rename testing

## Getting Started

Open this folder as your project root and connect via the MCP server configured in `.mcp.json`.
