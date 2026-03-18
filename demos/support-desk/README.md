# Support Desk

> Three users, five tickets, and a knowledge base -- support with full customer context.

---

**You are**: A support agent for a SaaS API company

**Your situation**: You handle tickets for 3 customers across trial, developer, and premium tiers. Sarah Chen (premium, $99/mo) has an escalated double-charge ticket and is threatening to churn. Bob Wilson (developer, $29/mo) needs rate limit guidance for his growing integration. Alice Martinez (trial) is evaluating for a team of 10. Your knowledge base covers billing, API rate limits, and onboarding. You need an AI partner that remembers every customer interaction and surfaces the right context instantly.

## Vault Map

```
support-desk/
├── users/
│   ├── sarah-chen.md               # Premium ($99/mo), frustrated, churn risk
│   ├── bob-wilson.md               # Developer ($29/mo), building SaaS integration
│   └── alice-martinez.md           # Trial, evaluating for team of 10
├── tickets/
│   ├── TKT-2024-001.md             # Resolved: Sarah, payment failed
│   ├── TKT-2024-002.md             # Resolved: Bob, API auth (401 errors)
│   ├── TKT-2024-003.md             # Escalated: Sarah, double charged $99
│   ├── TKT-2024-004.md             # Open: Bob, rate limit question
│   └── TKT-2024-005.md             # Open: Alice, onboarding help
├── knowledge/
│   ├── billing.md                   # FAQ, pricing tiers, double charge bug
│   ├── api-rate-limits.md           # Limits by tier, 429 handling
│   └── onboarding.md               # Quick start guide, first API call
└── daily-notes/
    └── 2026-02-12.md                # Activity log and tasks
```

## Try it now

Ask Claude:

- **"What's Sarah Chen's situation?"** -- pulls profile, sentiment, and ticket history via backlinks
- **"How do I resolve TKT-2024-003?"** -- surfaces the double charge context and knowledge base fix
- **"What tier does Bob need for 100 users?"** -- cross-references his ticket with rate limit docs
- **"Help Alice get started"** -- finds the onboarding guide and her open ticket
- **"What tickets are still open?"** -- scans ticket frontmatter for status: open or escalated

## What you'll discover

- Pull full customer context (tier, sentiment, ticket history) from frontmatter
- Cross-reference tickets with knowledge base articles automatically
- Track customer sentiment and churn risk across interactions

---

## How it works

When you ask Claude questions or request changes, here's the flow:

> Claude's exact tool path varies between runs. These traces show representative sessions.

### Customer context (search + one read)

```
You: "What's Sarah Chen's situation?"

● flywheel › search
  query: "Sarah Chen"
  → users/sarah-chen.md
      frontmatter: { tier: "premium", sentiment: "frustrated", churn_risk: "high",
                     open_tickets: 1, total_spent: 594,
                     last_issue: "Double-charged $99 (TKT-2024-003, escalated)" }
      backlinks: TKT-2024-001.md, TKT-2024-003.md, 2026-02-12.md
      outlinks: Billing, TKT-2024-003, TKT-2024-001

    tickets/TKT-2024-003.md
      frontmatter: { status: "escalated", priority: "urgent", category: "billing",
                     resolution: "Refund initiated, awaiting processing",
                     root_cause: "Stripe retry logic during partial outage" }
      backlinks: sarah-chen.md, TKT-2024-001.md
    tickets/TKT-2024-001.md
      frontmatter: { status: "resolved", resolution: "Card updated, 1-week credit applied",
                     resolution_time_hours: 18 }

┌─ RESULT ──────────────────────────────────────────────┐
│ Sarah Chen — Premium ($99/mo)                          │
│ Sentiment: frustrated | Churn risk: HIGH               │
│                                                        │
│ Open issues:                                           │
│   TKT-2024-003: Double charged $99 (ESCALATED)        │
│   - Root cause: Stripe retry logic during outage       │
│   - Refund initiated, awaiting processing              │
│   - "If this happens again, I'm switching providers"   │
│                                                        │
│ History:                                               │
│   TKT-2024-001: Payment failed (resolved in 18 hrs)   │
└────────────────────────────────────────────────────────┘

Frontmatter now includes churn_risk, resolution, and root_cause.
One search returned everything — zero file reads needed.
```

### Ticket + knowledge base (search + read)

```
You: "What tier does Bob need for 100 users?"

● flywheel › search
  query: "Bob Wilson rate limit tier"
  → users/bob-wilson.md
      frontmatter: { tier: "developer", churn_risk: "low", open_tickets: 1,
                     last_issue: "API rate limit questions (TKT-2024-004, open)" }
      outlinks: API Rate Limits, TKT-2024-004, TKT-2024-002
    tickets/TKT-2024-004.md
      frontmatter: { status: "open", category: "technical" }
    knowledge/api-rate-limits.md


┌─ CLAUDE THINKS ───────────────────────────────────────┐
│ Bob's on Developer (1000 req/min). 100 users at        │
│ 1 req/sec = 6000 req/min. Need the tier table.         │
└────────────────────────────────────────────────────────┘

● read_file("knowledge/api-rate-limits.md")
  → Developer: 1000 req/min, Premium: 5000, Enterprise: 10000+

┌─ RESULT ──────────────────────────────────────────────┐
│ Bob Wilson (Developer tier, $29/mo)                    │
│                                                        │
│ For 100 concurrent users at 1 req/sec:                 │
│   Needed: 6,000 req/min                                │
│   Developer (1,000): not enough                        │
│   Premium (5,000): not enough                          │
│   Enterprise (10,000+): sufficient                      │
│                                                        │
│ Recommendation: Enterprise tier or client-side         │
│ caching to reduce API calls.                            │
└────────────────────────────────────────────────────────┘
```

### Log an interaction (write with auto-wikilinks)

```
You: "Log that I called Sarah about the refund status"

┌─ CLAUDE THINKS ───────────────────────────────────┐
│ Write to today's daily note. "Sarah" will auto-    │
│ link to [[Sarah Chen]] via entity matching.         │
└────────────────────────────────────────────────────┘

● flywheel › vault_add_to_section
  path: "daily-notes/2026-02-12.md"
  section: "Log"
  content: "Called Sarah about refund status for TKT-2024-003"

┌─ RESULT ──────────────────────────────────────────┐
│ ## Log                                             │
│ - 14:30 - Called [[Sarah Chen]] about refund       │
│   status for [[TKT-2024-003]]                 NEW  │
│                                                    │
│ "Sarah" and "TKT-2024-003" auto-linked to          │
│ existing notes -- no manual wikilinks needed.       │
└────────────────────────────────────────────────────┘
```

---

*12 notes. Just start asking questions.*

---

**Token savings:** Enriched search returns frontmatter (including churn_risk, resolution), backlinks, outlinks, and headings — customer context in a single call.
