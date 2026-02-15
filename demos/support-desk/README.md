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

### Customer context (backlinks + metadata)

```
You: "What's Sarah Chen's situation?"

● flywheel › get_note_metadata
  path: "users/sarah-chen.md"
  → tier: premium, sentiment: frustrated, last_contact: 2026-02-11

● flywheel › get_backlinks
  path: "users/sarah-chen.md"
  ← tickets/TKT-2024-001.md (payment failed, resolved)
    tickets/TKT-2024-003.md (double charged, escalated)
    knowledge/billing.md

● flywheel › get_note_metadata (x2)
  TKT-2024-001: status: resolved, priority: high
  TKT-2024-003: status: escalated, priority: urgent

┌─ RESULT ──────────────────────────────────────────┐
│ Sarah Chen - Premium ($99/mo)                      │
│ Sentiment: frustrated | Last contact: Feb 11       │
│                                                    │
│ Open issues:                                       │
│   TKT-2024-003: Double charged $99 (ESCALATED)    │
│   - Refund initiated, 3-5 days to process          │
│   - Said "if this happens again, I'm switching"    │
│                                                    │
│ History:                                           │
│   TKT-2024-001: Payment failed (resolved Jan 29)  │
│                                                    │
│ Risk: HIGH churn -- 2 billing issues in 2 weeks    │
└────────────────────────────────────────────────────┘

~120 tokens (backlinks + metadata, no file reads)
```

### Ticket + knowledge base (cross-reference)

```
You: "What tier does Bob need for 100 users?"

● flywheel › get_note_metadata
  path: "users/bob-wilson.md"
  → tier: developer, sentiment: neutral

● flywheel › get_note_metadata
  path: "tickets/TKT-2024-004.md"
  → status: open, category: api

● flywheel › get_forward_links
  path: "tickets/TKT-2024-004.md"
  → [[API Rate Limits]], [[Bob Wilson]]

● flywheel › get_note_metadata
  path: "knowledge/api-rate-limits.md"
  → category: api

┌─ CLAUDE THINKS ───────────────────────────────────┐
│ Bob's on Developer (1000 req/min). 100 users at    │
│ 1 req/sec = 6000 req/min. Need the rate limit      │
│ tier table from the knowledge base.                 │
└────────────────────────────────────────────────────┘

● read_file
  path: "knowledge/api-rate-limits.md"
  → Developer: 1000 req/min, Premium: 5000, Enterprise: 10000+

┌─ RESULT ──────────────────────────────────────────┐
│ Bob Wilson (Developer tier, $29/mo)                │
│                                                    │
│ For 100 concurrent users at 1 req/sec:             │
│   Needed: 6,000 req/min                            │
│   Developer (1,000): not enough                    │
│   Premium (5,000): not enough                      │
│   Enterprise (10,000+): sufficient                  │
│                                                    │
│ Recommendation: Enterprise tier or client-side     │
│ caching to reduce API calls.                        │
└────────────────────────────────────────────────────┘

~300 tokens (metadata + 1 knowledge article)
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

**Token savings:** Each note in this vault averages ~50 lines (~750 tokens).
With Flywheel, graph queries cost ~50-100 tokens instead of reading full files.
That's **8-15x savings** per query--enabling hundreds of queries in agentic workflows.
