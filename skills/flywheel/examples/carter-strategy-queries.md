# Example queries that exercise the Flywheel skill

These prompts are taken from the [carter-strategy demo vault](../../../demos/carter-strategy/) — a battle-tested fixture for verifying Flywheel works end-to-end. Each shows the natural-language ask and the Flywheel tool path the agent should follow.

> Run them from `flywheel-memory/demos/carter-strategy/` after installing the skill (`bash ../../skills/flywheel/scripts/install.sh` from that directory) and restarting your client.

## Read-only: search-and-cite

### 1. Cross-note billing total

```
How much have I billed Acme Corp?
```

Expected path: `search` (query: "Acme Corp billing invoice") → returns the client note plus invoice backlinks → answer cites the invoice paths and the running total. No file reads required.

### 2. Task triage across the vault

```
What's overdue this week?
```

Expected path: `tasks(action: list)` filtered by due date → answer lists task lines with their source notes.

### 3. Team availability cross-reference

```
Who's available to staff the Beta Corp Dashboard?
```

Expected path: `search` against project + team notes → cross-reference utilization frontmatter → cite candidates with their current load.

### 4. Period summary

```
Summarize my Q4 2025.
```

Expected path: `search` ("Q4 2025") → `read(action: structure)` on the Quarterly Review note → cite top wins, blockers, and revenue.

## Bounded write — proves `edit_section`

### 5. Append a status under a known section

```
Append "Status: paid" under the Billing section of clients/Acme Corp.md.
```

Expected path: `read(action: structure, path: "clients/Acme Corp.md")` to confirm the heading text → `edit_section(action: add, path: "clients/Acme Corp.md", section: "Billing", content: "Status: paid")` → confirm by re-reading the section.

This is the recommended *first* write any new user runs. Single section target, single line, deterministic — if it works, the bounded-write path is healthy.

## What to check after running these

- `search` returns ranked results with `path`, `snippet`, `frontmatter`, `backlinks`, `outlinks`, and `section_content`.
- `edit_section(action: add)` appends the line to the correct section without disturbing surrounding content.
- The vault's Git mirror at `.flywheel/.git/` records the write as a commit, so the user can `git diff` to inspect or `git revert` to undo.

If any of these break, see [Troubleshooting in SKILL.md](../SKILL.md#troubleshooting).
