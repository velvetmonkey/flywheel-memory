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
│   └── planning/
│       ├── Feature Priorities.md     # P0-P3 backlog
│       └── Q1 2026 Priorities.md     # Caching, alerts, reports
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

> Claude's exact tool path varies between runs. These traces show representative sessions.

### Check MRR (search + one read)

```
You: "What's our current MRR?"

  ● flywheel › search
    query: "MRR revenue customers"
    → finance/MRR Tracker.md
        frontmatter: { type: "tracker", current_mrr: 499, active_customers: 1,
                       trial_customers: 1, churned_this_month: 0 }
        outlinks: DataDriven Co, GrowthStack, InsightHub, Hiring Plan, +12

      ops/customers/DataDriven Co.md
        frontmatter: { health_score: 9, next_renewal: "2026-04-01" }

      ops/customers/InsightHub.md
        frontmatter: { status: "churned", churned_date: "2025-12-28",
                       churn_reason: "Performance issues — 30s query timeouts on 10M+ rows" }

  ┌─ RESULT ────────────────────────────────────────────┐
  │ MRR: $499/mo (1 active customer)                    │
  │   DataDriven Co: $499/mo (health 9/10, renews Apr)  │
  │ Pipeline: GrowthStack trial (1 trial customer)      │
  │ Churned: InsightHub (performance issues on 10M+ rows)│
  └─────────────────────────────────────────────────────┘

Enriched frontmatter shows MRR, health scores, and churn reasons
in a single search call.
```

### Trace a churn reason (search + read)

```
You: "What caused InsightHub to churn?"

  ● flywheel › search
    query: "InsightHub churn"
    → ops/customers/InsightHub.md
        frontmatter: { status: "churned", health_score: 0,
                       churn_reason: "Performance issues — 30s query timeouts on 10M+ rows",
                       churned_date: "2025-12-28", original_mrr: 499 }
        outlinks: Alex Chen, DEC-001 Pricing Model, DEC-002 Target Market, Q1 2026 Roadmap


  ● read_file("ops/customers/InsightHub.md")
    → David Kim: "30+ second loads, need sub-second response times"
    → Actions: tier pricing by data volume, add caching to Q1 roadmap

  ┌─ RESULT ────────────────────────────────────────────┐
  │ InsightHub churned Dec 28 after 29 days paid.       │
  │ Primary: Performance issues on 10M+ row datasets.   │
  │ David Kim: "30+ second loads, need sub-second."     │
  │ Actions taken:                                      │
  │   - DEC-001 updated to tier by data volume          │
  │   - Caching added to Q1 2026 Roadmap                │
  │   - DEC-002 Target Market narrowed to <1M rows      │
  └─────────────────────────────────────────────────────┘

churn_reason in frontmatter gives the headline;
read provides David's quote and action items.
```

### Run the onboarding playbook (search + read)

```
You: "Walk me through onboarding a new customer"

  ● flywheel › search
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
```

---

*30 notes. Just start asking questions.*

---

**Token savings:** Enriched search returns MRR, health scores, churn reasons, and renewal dates from frontmatter — operational metrics without file reads.
