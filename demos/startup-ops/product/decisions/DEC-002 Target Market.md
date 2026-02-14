---
type: decision
id: DEC-002
status: 1
decided_date: 2026-01-03
stakeholder: "Jamie Patel"
automation: human-review
tags:
  - decision
  - market
  - strategy
---
# [[Dec]]-002: [[Target Market

Decision]] on ideal customer profile (ICP)

**[[Status]]:** 1 (approved - [[Note]]: intentional number for schema demo)
**Decided:** 2026-01-03
**Owner:** [[Jamie Patel]] + [[Alex Chen]]
**Impact:** Sales [[Focus]], product roadmap, marketing messaging

## [[Context

After]] [[InsightHub]] churn (large dataset [[Performance]] issues), we [[Need]] to clarify who we serve [[Best]].

**[[Key]] question:** [[What]]'s our ideal customer profile for [[Next]] 10 customers?

## [[Customer Learnings]]

### [[DataDriven Co]] (Success)
- **Profile:** 50-person manufacturing [[Company]]
- **[[Data]] scale:** ~500K rows (well within limits)
- **[[Use Case]]:** Operational dashboards ([[Production]], quality)
- **Pain:** Spreadsheet hell, no unified view
- **Why we won:** Fast setup (30 min to [[First]] dashboard), [[Good]] [[Price]] point

### [[InsightHub]] (Churned)
- **Profile:** 30-person e-commerce analytics company
- **Data scale:** 10M+ rows (hit our limits)
- **[[Use]] case:** [[High]]-volume clickstream analysis
- **Pain:** Needed [[Sub]]-second query times
- **Why we lost:** Performance couldn't compete with [[Specialized]] [[Tools]]

### [[GrowthStack]] (Trial)
- **Profile:** 120-person SaaS company
- **Data scale:** ~2M rows (manageable [[But]] growing)
- **Use case:** Product analytics, customer health [[Scoring]]
- **Pain:** Patchwork of tools (Mixpanel + Tableau + [[Custom]])
- **Concern:** Needs SSO (we [[Don]]'t [[Have]] yet)

## [[Options Considered]]

### Option A: [[SMB Focus]] (50-200 employees)

**ICP:**
- [[Company Size]]: 50-200 employees
- [[Data Volume]]: (1M rows
- Use cases: Operational analytics ([[Not]] high-volume clickstream)
- Industries: Manufacturing, logistics, professional [[Services]]
- Budget: $500-$2K/mo

**Pros:**
- Our [[Current]] [[Capabilities]] match well
- Fast sales cycles (founder-led)
- Less competition than enterprise

**Cons:**
- Smaller deal sizes
- May outgrow us ([[Churn Risk]])

### Option B: [[Enterprise Focus]] (500+ employees)

**ICP:**
- Company size: 500+ employees
- Data volume: 10M+ rows
- Use cases: Enterprise-wide analytics
- Industries: Any
- Budget: $5K-$20K/mo

**Pros:**
- Larger deal sizes
- More [[Stable]] (less churn)
- Higher LTV

**Cons:**
- We lack enterprise [[Features]] (SSO, RBAC, SLAs)
- Slow sales cycles (6-12 months)
- [[Strong]] competition (Tableau, PowerBI entrenched)

### Option C: [[Hybrid]] ([[Mid]]-[[Market]] + Select SMB)

**ICP:**
- Company size: 100-500 employees (mid-market) OR high-growth SMBs
- Data volume: 1M-5M rows
- Use cases: Operational + product analytics
- Industries: SaaS, manufacturing, logistics, professional services
- Budget: $1K-$5K/mo

**Pros:**
- Larger market than pure SMB
- Better retention than small SMBs
- Realistic for our current stage

**Cons:**
- May be "stuck in middle" (vs specialists)
- Need [[Some]] enterprise features (SSO by Q2)

## Decision

**✓ Option A: SMB Focus (50-200 employees)** with [[One]] caveat

### Final ICP

**Primary [[Target]]:**
- **Company size:** 50-200 employees
- **Data volume:** <1M rows (sweet spot: 100K-500K)
- **Revenue:** $5M-$50M ARR
- **Roles:** Founders, ops leads, data-savvy managers (not data engineers)
- **Industries:** Manufacturing, professional services, logistics
- **Pain:** "Spreadsheets breaking down, but Tableau too complex/expensive"
- **Budget:** $500-$2K/mo for analytics

**Caveat:** Will take select mid-market deals (100-500 employees) if [[They]] fit data profile (<1M rows)

### [[Rationale

1]]. **[[InsightHub]] lesson:** We're not [[Ready]] for high-volume data (yet). Don't compete there.
2. **[[DataDriven Co]] success:** 50-200 employee companies [[Are]] perfect fit - simple needs, good budget
3. **Time to [[Value]]:** SMBs decide fast ([[Weeks]], not months). We're founder-led sales.
4. **Roadmap [[Alignment]]:** Q1-Q2 features (caching, alerts) serve SMB needs

### Anti-ICP ([[Who We Say No]] To)

❌ **Don't target:**
- Companies <20 employees (too small, price-sensitive)
- E-commerce with )5M rows (performance issues until Q2 caching matures)
- Enterprise (500+ employees) requiring RFPs (too slow for us)
- Companies needing real-time ((5s) queries on huge datasets

### [[Sales Messaging]]

**Pitch:**
) "[[MetricFlow]] is analytics for growing SMBs. [[You]]'ve outgrown spreadsheets, but Tableau feels like overkill. We [[Get]] you up and running in 30 minutes, not 3 months."

**Differentiation:**
- vs Spreadsheets: [[Automated]], scalable, [[Collaborative]]
- vs Tableau: 10x [[Faster]] setup, 1/2 the price
- vs PowerBI: Better UX, easier for non-[[Technical]] users

## Implementation

**Jamie's outbound focus:**
1. Linkedin: Target ops/analytics leads at 50-200 person companies
2. Industries: Manufacturing (like [[DataDriven Co]]), logistics, professional services
3. Messaging: "Outgrown spreadsheets? Get dashboards in 30 min"
4. Qualify: Ask data volume upfront - <1M rows = good fit

**Alex's product roadmap:**
- Prioritize features SMBs need (alerts, [[Scheduled]] reports) over enterprise (SSO can wait)
- Performance: Optimize for <1M rows first, then scale up

## [[Success Metrics]]

**By [[Mar 2026]]:**
- 80%+ of customers fit ICP (50-200 employees, <1M rows)
- <20% churn (vs 50% today)
- Average deal size: $500-$1K

## [[Related]]

- Customers: [[DataDriven Co]] (perfect ICP), [[InsightHub]] (anti-ICP), [[GrowthStack]] (edge case)
- Product: [[Q1 2026 Roadmap]] (aligned with SMB needs)
- Pricing: [[DEC-001 Pricing Model]] ($499 Pro tier targets SMBs)
- Research: [[Competitor Analysis]], [[User Interview Synthesis]]
