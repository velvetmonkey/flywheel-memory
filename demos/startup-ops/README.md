# Startup Ops

> Let AI handle operations while you focus on building the product.

---

**You are**: Co-founder of MetricFlow, a B2B SaaS analytics startup

**Your situation**: Pre-Series A with 3 customers and 2 co-founders doing everything. You need to run ops (onboarding, support, metrics, investor updates) without hiring yet. You've got playbooks, customer records, and decisions scattered across 30 notes.

## Vault Map

```
┌─────────────────────────────────────────────────────────┐
│                     STARTUP OPS                         │
│                                                         │
│           ┌──────────────────────────┐                 │
│           │        Roadmap           │                 │
│           └────────────┬─────────────┘                 │
│                        │ drives                        │
│     ┌──────────────────┼──────────────────┐           │
│     ▼                  ▼                  ▼           │
│ ┌─────────┐      ┌─────────┐      ┌─────────┐         │
│ │DataDrive│      │TechStart│      │MetricsP │         │
│ │   Co    │      │   Inc   │      │   lus   │         │
│ └────┬────┘      └────┬────┘      └────┬────┘         │
│      │                │                │               │
│      └────────────────┼────────────────┘               │
│                       │ follows                        │
│                       ▼                                │
│  ┌───────────────────────────────────────────────┐    │
│  │ PLAYBOOKS  Onboard ─► Support ─► Renew ─► Upsell│    │
│  └───────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## Try it now

Ask Claude:

- "Walk me through onboarding a new customer"
- "What's our current MRR?"
- "What decisions need my review this week?"
- "Show me the support escalation process"
- "Summarize what happened with DataDriven Co"

## What you'll discover

- Run operational playbooks step-by-step with AI guidance
- Keep customer, product, and finance information connected
- Separate routine ops from strategic decisions that need your brain

---

## How it works

When you ask Claude questions or request changes, here's the flow:

### Check MRR (metadata aggregation)

```
You: "What's our current MRR?"

┌─ CLAUDE INTERPRETS ─────────────────────────────────┐
│ Intent: Sum MRR across all active customers         │
│ Strategy: Query customer frontmatter, aggregate     │
│ Tools: mcp__flywheel__get_field_values              │
└─────────────────────────────────────────────────────┘

┌─ FLYWHEEL READS ────────────────────────────────────┐
│ mcp__flywheel__get_field_values                     │
│   folder: "customers/"                              │
│   field: "mrr"                                      │
│   → datadriven-co.md: 1500, status: active          │
│   → techstart-inc.md: 1200, status: active          │
│   → metrics-plus.md: 1500, status: active           │
│   → newclient.md: 2000, status: trial               │
│                                                     │
│ Total: ~80 tokens (vs ~4,600 reading all files)     │
└─────────────────────────────────────────────────────┘

┌─ CLAUDE SYNTHESIZES ────────────────────────────────┐
│ Filter by status=active, sum MRR values             │
│ No file reads needed - frontmatter sufficient       │
└─────────────────────────────────────────────────────┘

MRR Dashboard: $4,200/mo (3 active customers)
  DataDriven Co: $1,500/mo
  TechStart Inc: $1,200/mo
  Metrics Plus: $1,500/mo
Pipeline: $2,000/mo (1 in trial)
```

### Run a playbook (requires file read)

```
You: "Walk me through onboarding a new customer"

┌─ CLAUDE INTERPRETS ─────────────────────────────────┐
│ Intent: Get step-by-step onboarding instructions    │
│ Strategy: Find playbook, read full content          │
│ Tools: mcp__flywheel__search_notes, then Read       │
└─────────────────────────────────────────────────────┘

┌─ FLYWHEEL READS ────────────────────────────────────┐
│ mcp__flywheel__search_notes("onboarding playbook")  │
│   → ops/playbooks/customer-onboarding.md            │
│                                                     │
│ Total: ~40 tokens (search result only)              │
└─────────────────────────────────────────────────────┘

┌─ CLAUDE DECIDES: NEED FULL PLAYBOOK ────────────────┐
│ Search found the file, but "walk me through"        │
│ requires reading all steps and instructions         │
└─────────────────────────────────────────────────────┘

┌─ SELECTIVE FILE READ ───────────────────────────────┐
│ Read("ops/playbooks/customer-onboarding.md")        │
│   → Full playbook with 5 steps and templates        │
│                                                     │
│ Total: ~300 tokens (1 playbook file)                │
└─────────────────────────────────────────────────────┘

Customer Onboarding Playbook
============================
Step 1: Create customer record → /create customer [name]
Step 2: Schedule kickoff call → Check calendar
Step 3: Send welcome email → Use templates/welcome-email.md
Step 4: Set up workspace → Provision API keys, Slack channel
Step 5: Log completion → /log onboarded [customer name]

Ready to start? Tell me the customer name.
```

### Customer summary (metadata + selective read)

```
You: "What's happening with DataDriven?"

┌─ CLAUDE INTERPRETS ─────────────────────────────────┐
│ Intent: Get current status + recent activity        │
│ Strategy: Metadata first, then read if needed       │
│ Tools: mcp__flywheel__get_note_metadata,            │
│        mcp__flywheel__get_backlinks                 │
└─────────────────────────────────────────────────────┘

┌─ FLYWHEEL READS ────────────────────────────────────┐
│ mcp__flywheel__get_note_metadata("customers/data..")│
│   → status: active, mrr: 1500, contract: monthly    │
│   → health: green, next_renewal: 2026-02-01         │
│                                                     │
│ mcp__flywheel__get_backlinks("customers/data...")   │
│   → daily-notes/2026-01-04.md (mentioned today)     │
│   → meetings/2026-01-02-kickoff.md                  │
│                                                     │
│ Total: ~100 tokens                                  │
└─────────────────────────────────────────────────────┘

┌─ CLAUDE DECIDES: NEED RECENT CONTEXT ───────────────┐
│ Metadata shows status, but "what's happening"       │
│ needs recent meeting notes for context              │
└─────────────────────────────────────────────────────┘

┌─ SELECTIVE FILE READ ───────────────────────────────┐
│ Read("daily-notes/2026-01-04.md", section="Log")    │
│   → "call with DataDriven - they want API access"   │
│                                                     │
│ Total: ~150 tokens (1 section read)                 │
└─────────────────────────────────────────────────────┘

DataDriven Co: Active ($1,500/mo)
  Health: Green | Renewal: Feb 1
  Latest: They want API access (discussed today)
  Next step: Send API documentation
```

### Update customer record (write operation)

```
You: "Update DataDriven status to pilot"

┌─ CLAUDE INTERPRETS ─────────────────────────────────┐
│ Intent: Change status field in customer frontmatter │
│ Strategy: Direct frontmatter update                 │
│ Tools: mcp__flywheel__vault_update_frontmatter│
└─────────────────────────────────────────────────────┘

┌─ FLYWHEEL WRITES ──────────────────────────────────────┐
│ mcp__flywheel__vault_update_frontmatter       │
│   path: "customers/datadriven-co.md"                │
│   updates:                                          │
│     status: "pilot"                                 │
│     last_contact: "2026-01-04"                      │
└─────────────────────────────────────────────────────┘

---
status: pilot                    ← CHANGED from 'lead'
last_contact: 2026-01-04         ← UPDATED
mrr: 1500
---
```

### Log customer interaction (write operation)

```
You: "/log call with DataDriven - they want API access"

┌─ CLAUDE INTERPRETS ─────────────────────────────────┐
│ Intent: Append to today's log section               │
│ Strategy: Direct write - no reads needed            │
│ Tools: mcp__flywheel__vault_add_to_section    │
└─────────────────────────────────────────────────────┘

┌─ FLYWHEEL WRITES ──────────────────────────────────────┐
│ mcp__flywheel__vault_add_to_section           │
│   path: "daily-notes/2026-01-04.md"                 │
│   section: "Log"                                    │
│   content: "call with DataDriven - they want API.." │
│   format: "timestamp-bullet"                        │
└─────────────────────────────────────────────────────┘

## Log
- 10:00 Standup with Sarah
- 11:30 call with DataDriven - they want API access ← NEW
```

---

*30 notes. Just start asking questions.*

---

**Token savings:** Each note in this vault averages ~155 lines (~2,300 tokens).
With Flywheel, graph queries cost ~50-100 tokens instead of reading full files.
That's **23-46x savings** per query—enabling hundreds of queries in agentic workflows.
