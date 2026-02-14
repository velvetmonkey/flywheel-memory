---
type: decision
id: DEC-001
status: "approved"
decided_date: 2025-12-15
stakeholder: "Alex Chen"
automation: human-review
tags:
  - decision
  - pricing
  - strategy
---
# [[Dec]]-001: [[Pricing Model

Decision]] on pricing tiers and structure

**[[Status]]:** Approved
**Decided:** 2025-12-15
**Owner:** [[Alex Chen]] + [[Jamie Patel]]
**Impact:** Revenue [[Strategy]], customer segmentation

## [[Context

Pre]]-[[Launch]], we [[Need]] to define pricing before [[First]] customer signs up.

**[[Key]] questions:**
1. Usage-[[Based]] or seat-based pricing?
2. How many tiers?
3. [[Price]] points for [[Each]] tier?
4. [[What]] [[Features]] differentiate tiers?

## [[Options Considered]]

### Option A: Usage-Based ([[Data Volume]])

**Tiers:**
- Starter: $99/mo (<100K rows)
- Professional: $499/mo (<1M rows)
- Enterprise: $1,999/mo (<10M rows)
- Custom: $5K+/mo (unlimited)

**Pros:**
- Fair - pay for what [[You]] [[Use]]
- [[Natural]] upsell path (as customer grows)
- Industry standard (similar to Snowflake, [[BigQuery]])

**Cons:**
- Hard to predict revenue
- Complex to communicate
- [[Risk]]: Customers optimize to reduce costs

### Option B: Seat-Based

**Tiers:**
- [[Team]]: $49/user/mo (5 users min = $245)
- Business: $99/user/mo (10 users min = $990)
- Enterprise: $199/user/mo (custom)

**Pros:**
- Predictable revenue
- Easy to understand
- Natural expansion (add users)

**Cons:**
- Penalizes small teams with large data needs
- Less aligned with value delivered

### Option C: Hybrid (Value-Based)

**Tiers:**
- Professional: $499/mo (unlimited users, <1M rows, 10 dashboards)
- Enterprise: $1,999/mo (unlimited users, <10M rows, unlimited dashboards, SSO)
- Custom: Quote (huge datasets, white-label, SLAs)

**Pros:**
- Simple to communicate
- Aligned with customer value
- Easy upsells (more data, more features)

**Cons:**
- Leaves money on table for high-user-count customers
- "Unlimited users" could be abused

## Decision

**✓ Option C: Hybrid (Value-Based)** with one modification:

### Final Pricing Tiers

| Tier | Price | Users | Data Limit | Dashboards | Features |
|------|-------|-------|------------|------------|----------|
| **Professional** | $499/mo | Unlimited | 1M rows | 20 | [[Core]] features, email support |
| **Enterprise** | $1,999/mo | Unlimited | 10M rows | Unlimited | + SSO, alerts, SLAs, phone support |
| **Custom** | Quote | Unlimited | Unlimited | Unlimited | + White-label, dedicated infra, custom integrations |

### Rationale

1. **$499 Professional:** Sweet spot for SMBs (competitive vs $1K+ alternatives, higher than $99 low-end)
2. **$1,999 Enterprise:** 4x markup justified by advanced features (SSO, unlimited dashboards)
3. **Unlimited users:** Removes adoption friction - whole team can use it
4. **Data limits:** Clear differentiator, natural upsell path

### Learnings from [[InsightHub]] Churn

InsightHub hit our data limits (~10M rows) and experienced slow performance. They were on Professional plan.

**Adjustment:** Add "Contact us for enterprise plan" messaging when approaching data limits, instead of hard cutoff.

## Implementation

**Pricing page copy:**
```
Professional: $499/month
Perfect for growing teams analyzing up to 1M rows

Enterprise: $1,999/month
For larger datasets (10M+ rows) with advanced security and SLAs

Custom: Let's talk
White-label, dedicated infrastructure, unlimited scale
```

**Trial:** 14 days free, no credit card required

## Success Metrics

**By Mar 2026:**
- 80% of customers on Professional
- 20% on Enterprise
- Average deal size: $599 ([[Target]] $500+)

## Alternatives Considered & Rejected

- **Freemium:** Too early, would dilute focus
- **Annual-only:** Too high commitment for unproven product
- **Per-dashboard pricing:** Confusing, hard to enforce

## Related

- Revenue tracking: [[MRR Tracker]]
- Customer feedback: [[DataDriven Co]] ($499 felt "fair"), [[GrowthStack]] (negotiating $800)
- Competitor research: [[Competitor Analysis]]
- Roadmap: [[Q1 2026 Roadmap]] (SSO enables Enterprise tier)
