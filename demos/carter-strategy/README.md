# Carter Strategy

> Run a solo consulting practice with an AI back-office that never drops the ball.

---

**You are**: A solo strategy consultant

**Your situation**: You manage 3 clients, 4 active projects, $42K in pending invoices, and 15 open tasks. Your expertise is data strategy and API architecture. Your challenge is keeping everything organized without an assistant.

## Vault Map

```
┌─────────────────────────────────────────────────────────┐
│                   CARTER STRATEGY                       │
│                                                         │
│                   ┌─────────────┐                       │
│                   │ Reference   │ (rates, context)      │
│                   └──────┬──────┘                       │
│                          │                              │
│        ┌─────────────────┼─────────────────┐           │
│        ▼                 ▼                 ▼           │
│  ┌───────────┐    ┌───────────┐    ┌───────────┐       │
│  │ Acme Corp │    │ TechStart │    │GlobalBank │       │
│  └─────┬─────┘    └─────┬─────┘    └─────┬─────┘       │
│        │ project        │                │             │
│        ▼                ▼                ▼             │
│  ┌───────────┐    ┌───────────┐    ┌───────────┐       │
│  │ Project A │    │ Project B │    │ Project C │       │
│  └─────┬─────┘    └─────┬─────┘    └─────┬─────┘       │
│        │ invoice        │                │             │
│        ▼                ▼                ▼             │
│  ┌───────────┐    ┌───────────┐    ┌───────────┐       │
│  │  INV-001  │    │  INV-002  │    │  INV-003  │       │
│  └───────────┘    └───────────┘    └───────────┘       │
└─────────────────────────────────────────────────────────┘
```

## Try it now

Ask Claude:

- "What's overdue this week?"
- "How much have I billed Acme Corp?"
- "Summarize my December"
- "What client work needs follow-up?"
- "Show me my active projects"

## What you'll discover

- See all your deadlines in one place - no more forgotten follow-ups
- Track client revenue and project budgets automatically
- Summarize your week or month instantly for planning

---

## How it works

When you ask Claude questions or request changes, here's the flow:

### Check what's overdue (metadata only)

```
You: "What's overdue this week?"

┌─ CLAUDE INTERPRETS ─────────────────────────────────┐
│ Intent: Find tasks with due dates in the past       │
│ Strategy: Query task index, no content needed       │
│ Tools: mcp__flywheel__get_tasks_with_due_dates      │
└─────────────────────────────────────────────────────┘

┌─ FLYWHEEL READS ────────────────────────────────────┐
│ mcp__flywheel__get_tasks_with_due_dates             │
│   → 3 tasks with due_date < today                   │
│   → clients/acme.md: "Follow up on proposal"        │
│   → projects/beta-api.md: "Send status update"      │
│   → invoices/INV-042.md: "Payment reminder"         │
│                                                     │
│ Total: ~90 tokens (vs ~6,000 reading all files)     │
└─────────────────────────────────────────────────────┘

┌─ CLAUDE SYNTHESIZES ────────────────────────────────┐
│ Metadata sufficient - task text + dates returned    │
│ No file reads needed                                │
└─────────────────────────────────────────────────────┘

Overdue Tasks (3):
- clients/acme.md: Follow up on proposal 📅 Jan 2
- projects/beta-api.md: Send status update 📅 Jan 3
- invoices/INV-042.md: Payment reminder 📅 Jan 3
```

### Client revenue (metadata + aggregation)

```
You: "How much have I billed Acme Corp?"

┌─ CLAUDE INTERPRETS ─────────────────────────────────┐
│ Intent: Sum all invoice amounts for one client      │
│ Strategy: Get backlinks from Acme, sum amounts      │
│ Tools: mcp__flywheel__get_backlinks,                │
│        mcp__flywheel__get_note_metadata (×N)        │
└─────────────────────────────────────────────────────┘

┌─ FLYWHEEL READS ────────────────────────────────────┐
│ mcp__flywheel__get_backlinks("clients/acme.md")     │
│   → invoices/INV-001.md, invoices/INV-007.md        │
│   → projects/data-strategy.md                       │
│                                                     │
│ mcp__flywheel__get_note_metadata("INV-001.md")      │
│   → amount: 16200, status: paid                     │
│                                                     │
│ mcp__flywheel__get_note_metadata("INV-007.md")      │
│   → amount: 12200, status: pending                  │
│                                                     │
│ Total: ~120 tokens (vs ~3,600 reading full files)   │
└─────────────────────────────────────────────────────┘

┌─ CLAUDE SYNTHESIZES ────────────────────────────────┐
│ Aggregates amounts by status from frontmatter       │
│ No file content needed - just metadata              │
└─────────────────────────────────────────────────────┘

Acme Corp Revenue: $28,400
  Paid: $16,200 (Data Strategy Phase 1)
  Outstanding: $12,200 (API Architecture)
```

### Summarize a project (requires file read)

```
You: "What's the status of the Acme API project?"

┌─ CLAUDE INTERPRETS ─────────────────────────────────┐
│ Intent: Get detailed project status + context       │
│ Strategy: Get metadata first, then read for detail  │
│ Tools: mcp__flywheel__get_note_metadata, then Read  │
└─────────────────────────────────────────────────────┘

┌─ FLYWHEEL READS ────────────────────────────────────┐
│ mcp__flywheel__get_note_metadata("projects/acme-..") │
│   → status: active, client: [[Acme Corp]]           │
│   → budget: 12200, hours_remaining: 8               │
│                                                     │
│ Total: ~60 tokens                                   │
└─────────────────────────────────────────────────────┘

┌─ CLAUDE DECIDES: NEED MORE DETAIL ──────────────────┐
│ Metadata shows status, but user wants "what's       │
│ happening" - need to read deliverables/notes        │
└─────────────────────────────────────────────────────┘

┌─ SELECTIVE FILE READ ───────────────────────────────┐
│ Read("projects/acme-api-architecture.md")           │
│   → ## Deliverables, ## Recent Updates sections     │
│                                                     │
│ Total: ~350 tokens (1 targeted file)                │
└─────────────────────────────────────────────────────┘

Claude: "Acme API project is active with 8 hours
remaining. Last update: endpoint spec delivered,
awaiting client review. Next: integration testing
scheduled for next week."
```

### Add a log entry (write operation)

```
You: "/log finished Acme strategy deck"

┌─ CLAUDE INTERPRETS ─────────────────────────────────┐
│ Intent: Append to today's daily note log            │
│ Strategy: Direct write - no reads needed            │
│ Tools: mcp__flywheel__vault_add_to_section    │
└─────────────────────────────────────────────────────┘

┌─ FLYWHEEL WRITES ──────────────────────────────────────┐
│ mcp__flywheel__vault_add_to_section           │
│   path: "daily-notes/2026-01-04.md"                 │
│   section: "Log"                                    │
│   content: "finished Acme strategy deck"            │
│   format: "timestamp-bullet"                        │
└─────────────────────────────────────────────────────┘

## Log
- 10:15 Morning review
- 14:32 finished Acme strategy deck                ← NEW
```

---

*30 notes. Just start asking questions.*

---

**Token savings:** Each note in this vault averages ~150 lines (~2,200 tokens).
With Flywheel, graph queries cost ~50-100 tokens instead of reading full files.
That's **22-44x savings** per query—enabling hundreds of queries in agentic workflows.
