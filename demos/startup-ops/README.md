# Startup Ops

> Two co-founders, one paying customer, and 30 notes holding everything together.

---

**You are**: Co-founder of MetricFlow, a B2B SaaS analytics startup

**Your situation**: Pre-seed with $100K in the bank, $499 MRR from one customer, and 12 months of runway. You and your co-founder do everything -- sales, product, support, fundraising. Your playbooks, customer records, and financial trackers are scattered across 30 notes. You need an AI ops partner that keeps the business running while you build product.

## Vault Map

```
startup-ops/
├── finance/
│   ├── Investor Pipeline.md         # $500K seed round, 4 investors
│   ├── MRR Tracker.md               # $499 MRR, 1 active customer
│   └── Runway Calculator.md         # $100K cash, 12 months runway
├── ops/
│   ├── customers/
│   │   ├── DataDriven Co.md          # Active, $499/mo, health 9/10
│   │   ├── GrowthStack.md            # Trial, decision pending
│   │   └── InsightHub.md             # Churned (performance issues)
│   ├── meetings/
│   │   ├── 2026-01-06 DataDriven Kickoff.md
│   │   └── 2026-01-07 Investor Call.md
│   ├── playbooks/
│   │   ├── Customer Onboarding.md    # 5-step onboarding process
│   │   ├── Investor Update.md        # Monthly investor email
│   │   ├── Support Escalation.md     # P0-P3 severity levels
│   │   └── Weekly Metrics Review.md  # Monday metrics checklist
│   └── recurring/
│       ├── Friday Wrap-up.md
│       └── Monday Standup Prep.md
├── product/
│   ├── decisions/
│   │   ├── DEC-001 Pricing Model.md  # $499 Pro, $1999 Enterprise
│   │   └── DEC-002 Target Market.md  # 50-200 employee SMBs
│   ├── research/
│   │   ├── Competitor Analysis.md    # vs Tableau, PowerBI, Looker
│   │   └── User Interview Synthesis.md  # 12 interviews
│   └── roadmap/
│       ├── Feature Priorities.md     # P0-P3 backlog
│       └── Q1 2026 Roadmap.md        # Caching, alerts, reports
├── team/
│   ├── Alex Chen.md                  # Co-Founder & CEO, engineering
│   ├── Jamie Patel.md               # Co-Founder & COO, sales
│   └── Hiring Plan.md               # First hire at $10K MRR
├── daily-notes/                      # 5 daily operations logs
└── weekly-notes/
    └── 2026-W01.md                   # Week 1 summary
```

## Try it now

Ask Claude:

- "What's our current MRR and who's paying?"
- "Walk me through onboarding a new customer"
- "What caused InsightHub to churn?"
- "How much runway do we have left?"
- "Prep this month's investor update"

## What you'll discover

- Run operational playbooks step-by-step with AI guidance
- Track MRR, runway, and customer health from frontmatter
- Trace how decisions connect to customers, roadmap, and revenue

---

## How it works

When you ask Claude questions or request changes, here's the flow:

### Check MRR (metadata only)

```
You: "What's our current MRR?"

  ● flywheel › get_note_metadata
    path: "ops/customers/DataDriven Co.md"
    → Status: Active, MRR: $499, Plan: Professional

  ● flywheel › get_note_metadata
    path: "ops/customers/GrowthStack.md"
    → status: trial, trial_end: 2026-01-20

  ● flywheel › get_note_metadata
    path: "ops/customers/InsightHub.md"
    → status: churned, original_mrr: 499

  ┌─ CLAUDE THINKS ─────────────────────────────────────┐
  │ Filter by active status, sum MRR values.            │
  │ Only DataDriven Co is paying. GrowthStack is trial. │
  │ InsightHub churned Dec 28.                          │
  └─────────────────────────────────────────────────────┘

  ┌─ RESULT ────────────────────────────────────────────┐
  │ MRR: $499/mo (1 active customer)                    │
  │   DataDriven Co: $499/mo (Professional)             │
  │ Pipeline: GrowthStack trial ends Jan 20 ($999 if    │
  │   converted to Enterprise)                          │
  │ Churned: InsightHub ($499, Dec 28 - performance)    │
  └─────────────────────────────────────────────────────┘

  ~80 tokens (vs ~4,600 reading all 3 customer files)
```

### Trace a churn reason (metadata + selective read)

```
You: "What caused InsightHub to churn?"

  ● flywheel › get_note_metadata
    path: "ops/customers/InsightHub.md"
    → status: churned, churned_date: 2025-12-28, original_mrr: 499

  ┌─ CLAUDE THINKS ─────────────────────────────────────┐
  │ Metadata confirms churn but "what caused" needs     │
  │ the full churn analysis from the file.              │
  └─────────────────────────────────────────────────────┘

  ● read_file
    path: "ops/customers/InsightHub.md"
    → Churn Reason: Performance issues with 10M+ rows
    → David: "query timeouts on 30+ second loads"
    → Lessons: DEC-001 should tier by data volume,
    →   add caching to Q1 roadmap

  ┌─ RESULT ────────────────────────────────────────────┐
  │ InsightHub churned Dec 28 after 29 days paid.       │
  │ Primary: Performance issues on 10M+ row datasets.   │
  │ David Kim: "30+ second loads, need sub-second."     │
  │ Actions taken:                                      │
  │   - DEC-001 updated to tier by data volume          │
  │   - Caching added to Q1 2026 Roadmap                │
  │   - DEC-002 Target Market narrowed to <1M rows      │
  └─────────────────────────────────────────────────────┘

  ~350 tokens (1 targeted file read)
```

### Run the onboarding playbook (file read)

```
You: "Walk me through onboarding a new customer"

  ● flywheel › search_notes
    query: "onboarding playbook"
    → ops/playbooks/Customer Onboarding.md

  ● read_file
    path: "ops/playbooks/Customer Onboarding.md"
    → 5 phases: Day 1 (welcome), Day 2-3 (setup),
    →   Day 7 (check-in), Day 14 (check-in), Day 30 (review)

  ┌─ RESULT ────────────────────────────────────────────┐
  │ Customer Onboarding Playbook (5 phases):            │
  │                                                     │
  │ Day 1: Welcome & Setup                              │
  │   - Send welcome email, create Slack channel        │
  │   - Add to MRR Tracker, schedule kickoff            │
  │   Owner: System + Alex Chen                         │
  │                                                     │
  │ Day 2-3: Technical Setup                            │
  │   - Connect first data source, create dashboards    │
  │   Owner: Alex Chen                                  │
  │                                                     │
  │ Day 7: First Check-in                               │
  │   - Review usage, proactive outreach if low         │
  │   Owner: Jamie Patel                                │
  │                                                     │
  │ Day 14: Check-in #2                                 │
  │   - "What's working? What's not?"                   │
  │                                                     │
  │ Day 30: Month Review                                │
  │   - Usage summary, upsell, request testimonial      │
  └─────────────────────────────────────────────────────┘

  ~300 tokens (1 playbook file)
```

---

*30 notes. Just start asking questions.*

---

**Token savings:** Each note in this vault averages ~150 lines (~2,200 tokens).
With Flywheel, graph queries cost ~50-100 tokens instead of reading full files.
That's **22-44x savings** per query--enabling hundreds of queries in agentic workflows.
