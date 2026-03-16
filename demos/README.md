# Flywheel Demos

> Open any demo folder in Claude Code and start asking questions.

---

## Pick a Demo (ordered by complexity)

| Demo | You Are | Ask Claude |
|------|---------|------------|
| [**Solo Operator**](./solo-operator/) | One-person newsletter business | "How's revenue looking?" |
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

## What Search Actually Returns

When you ask "How much have I billed Acme Corp?", Claude calls `search` with that query. Here's what happens:

**Step 1 — Find matching notes.** Flywheel checks three channels:
- **Title/entity match** — "Acme Corp" matches `clients/Acme Corp.md` by name
- **Full-text search** — "billed" matches invoice notes that contain billing details
- **Entity database** — aliases and alternate names are also checked

**Step 2 — Enrich every result.** For each matching note, Flywheel attaches its full graph context from an in-memory index (no file reads):

```
search("Acme Corp billing")
  → clients/Acme Corp.md
      frontmatter: { total_billed: 156000, rate: 300, status: "active" }
      backlinks:   [INV-2025-047.md, INV-2025-048.md, Acme Data Migration.md]
      outlinks:    [Sarah Mitchell, INV-2025-047, Acme Data Migration]
      headings:    ["Contact", "Projects", "Invoices", "Notes"]
      tags:        ["client"]

  → invoices/INV-2025-048.md
      frontmatter: { amount: 12000, status: "pending", client: "Acme Corp" }
      backlinks:   [Acme Corp.md, Acme Data Migration.md]
      snippet:     "...December 2025 — 40 hours consulting at $300/hr..."
```

That single result tells Claude: Acme Corp has been billed $156K total, there are two invoices ($15K paid, $12K pending), and they're connected to the Acme Data Migration project. All from one call, zero files read.

**Why this matters:**
- **Frontmatter** answers "how much?" and "what status?" questions directly
- **Backlinks** show what *references* this note — invoices, tickets, meeting notes
- **Outlinks** show what this note *talks about* — people, projects, decisions
- **Headings** reveal what sections exist before committing to a full read
- **Snippets** show the matching paragraph in context

The result is that Claude gets the answer *and* the surrounding context in a single call. No need to read the file, then follow links, then read those files too. The quality of these results improves over time — every write adds edges to the graph, and the feedback loop ensures suggestions sharpen with use. See [Graph Quality](../README.md#graph-quality) for the measured F1 scores.

When Claude *does* need full content (explaining "why" or reading detailed prose), it does a **selective read** of just that one section — not the entire vault.

For a guided 5-minute walkthrough, see [Prove It Yourself](../docs/PROVE-IT.md).

---

## No CLAUDE.md Needed

Every demo works with just `.mcp.json` — no CLAUDE.md, no `.claude/rules/`, no pre-taught workflows. Claude discovers vault structure through Flywheel's tools (search, backlinks, metadata) on its own.

---

## Live Tool-Usage Testing

To measure whether Claude uses Flywheel tools vs built-in file tools:

```bash
bash demos/run-tool-test.sh
```

Options:
- `RUNS=5` — runs per demo (default: 3)
- `MODEL=opus` — model to test (default: sonnet)

Results are saved to `demos/test-results/<timestamp>/`:
- `report.md` — aggregate tool-usage metrics
- `raw/*.jsonl` — full stream-json output per run

### What It Measures
- Does Claude call `search` before reading files?
- How many flywheel tools vs built-in file tools per query?
- Which demos (if any) bypass flywheel entirely?

### Baseline
Pre-server-instructions (2026-03-16): 9/17 runs (53%) bypassed flywheel.
