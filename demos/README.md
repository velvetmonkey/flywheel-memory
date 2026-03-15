# Flywheel Demos

> Open any demo folder in Claude Code and start asking questions.

---

## Pick a Demo (ordered by complexity)

| Demo | You Are | Ask Claude |
|------|---------|------------|
| [**Solo Operator**](./solo-operator/) | One-person newsletter business | "What's my revenue this month?" |
| [**Carter Strategy**](./carter-strategy/) | Solo strategy consultant | "What's overdue this week?" |
| [**Support Desk**](./support-desk/) | SaaS support team | "What tickets are escalated?" |
| [**Artemis Rocket**](./artemis-rocket/) | Chief Engineer at a rocket startup | "What's the propulsion system status?" |
| [**Startup Ops**](./startup-ops/) | Co-founder of a SaaS startup | "Walk me through onboarding a customer" |
| [**Nexus Lab**](./nexus-lab/) | PhD researcher in computational biology | "How does AlphaFold connect to my experiment?" |
| [**Zettelkasten**](./zettelkasten/) | Student of cognitive science | "How does spaced repetition connect to active recall?" |

---

## Getting Started

Each demo already includes a pre-configured `.mcp.json` — no setup needed.

```bash
cd demos/carter-strategy
claude
```

Then start asking questions about the business.

---

## Why Flywheel Saves Tokens

**The problem:** LLMs like Claude have no persistent memory between queries. Every time you ask "What's blocking propulsion?", Claude must:

1. **Read the relevant files** into its context window
2. **Process the content** to find the answer
3. **Discard everything** when the response is complete

Ask a follow-up question? Claude reads the files again. Run an agentic workflow with 50 queries? That's 50 file reads.

```
Grep approach (3 related queries):
┌──────────────────────────────────────────────────────────┐
│ Query 1: "What's blocking propulsion?"                   │
│   Read: propulsion.md (2,500 tokens)                     │
│   Read: turbopump.md (1,800 tokens)                      │
│   Read: supplier.md (1,200 tokens)                       │
│   Total: 5,500 tokens                                    │
│                                                          │
│ Query 2: "Who owns the turbopump work?"                  │
│   Read: turbopump.md (1,800 tokens) ← AGAIN              │
│   Read: team-roster.md (900 tokens)                      │
│   Total: 2,700 tokens                                    │
│                                                          │
│ Query 3: "What decisions affect turbopump?"              │
│   Read: turbopump.md (1,800 tokens) ← AGAIN              │
│   Read: decisions/DR-003.md (600 tokens)                 │
│   Read: decisions/DR-007.md (550 tokens)                 │
│   Total: 2,950 tokens                                    │
│                                                          │
│ Session total: 11,150 tokens                             │
└──────────────────────────────────────────────────────────┘

Flywheel (same 3 queries):
┌──────────────────────────────────────────────────────────┐
│ Query 1: flywheel search + targeted reads                │
│   → indexed search finds files, read only what's needed  │
│                                                          │
│ Query 2: flywheel search + get_backlinks                 │
│   → link data only, no file reads                        │
│                                                          │
│ Query 3: flywheel search + get_section_content           │
│   → index results + 1 section, not entire files          │
│                                                          │
│ Key: Flywheel never re-reads files it already indexed.   │
│ Repeated queries hit the index, not the filesystem.      │
└──────────────────────────────────────────────────────────┘
```

**The key insight:** Most queries don't need full file content. Flywheel returns just the metadata, links, and structure—letting Claude answer from the index instead of re-reading files.

When Claude *does* need full content (explaining "why" or reading detailed notes), it does a **selective file read** of just that one file, not the entire vault.

For a guided 5-minute walkthrough, see [Prove It Yourself](../docs/PROVE-IT.md).

---

## No CLAUDE.md Needed

Every demo works with just `.mcp.json` — no CLAUDE.md, no `.claude/rules/`, no pre-taught workflows. Claude discovers vault structure through Flywheel's tools (search, backlinks, metadata) on its own.
