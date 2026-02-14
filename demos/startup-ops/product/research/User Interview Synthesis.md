---
type: research
category: customer-development
interviews_conducted: 12
date_range: "2025-11 to 2025-12"
owner: Jamie Patel
tags:
  - research
  - interviews
  - customer-development
---
# [[User Interview Synthesis

Customer]] development interviews (Nov-[[Dec 2025]])

Owner: [[Jamie Patel]]
Interviews: 12 (8 prospects, 2 customers, 2 churned)
Period: Nov-[[Dec]] 2025

## [[Interview Goals]]

1. Validate problem hypothesis (analytics pain for SMBs)
2. Understand [[Current]] [[Tools]] and workarounds
3. [[Identify]] [[Feature Priorities]]
4. [[Test]] pricing sensitivity

## [[Key Insights]]

### 1. The Spreadsheet Breaking Point

**Pattern:** Companies hit a wall at 50-100 employees

**Quote (Sarah, [[DataDriven Co]]):**
> "I was spending 10 [[Hours]] every week pulling [[Data]] from 3 different [[Systems]] into Excel. The CEO [[Would]] ask for a metric and it would take me 2 days to compile. I knew we needed [[Something]] better [[But]] Tableau felt like [[Learning]] a new programming [[Language]]."

Interviewee: [[DataDriven Co]]

**Insight:** SMBs outgrow spreadsheets but find [[Traditional]] BI too complex

**Implication:** Our "30 minutes to [[First]] dashboard" positioning resonates

### 2. The Data [[Team]] Gap

**Pattern:** SMBs [[Don]]'t [[Have]] data engineers, won't hire [[One]] for analytics

**Quote (Michael, [[GrowthStack]]):**
> "We're a 120-person [[Company]] but [[Only]] 8 engineers, [[All]] focused on product. I can't spare anyone to set up analytics [[Infrastructure]]. I [[Need]] something that just works."

**Insight:** Self-serve is critical - can't rely on IT/data teams

**Implication:** No-code, no SQL, wizard-[[Based]] setup is differentiator

### 3. The "$1K/mo Threshold"

**Pattern:** $500-$1K/mo feels right, $2K+ needs executive [[Approval]]

**Quote ([[Operations Manager]], 80-person logistics company):**
> "At $500, I can expense this on my company card. At $2,000, I need to go through procurement and [[Get]] CFO approval. For an unproven tool, that's [[Not]] happening."

**Insight:** $499 Professional tier hits sweet spot for manager-level buyers

**Implication:** Validate [[DEC-001 Pricing Model]] - $499 is well-positioned

### 4. Alerts [[Are]] [[Table Stakes]]

**Pattern:** 8/12 [[Mentioned]] needing alerts/notifications

**Quote (Sarah, [[DataDriven Co]]):**
> "I don't want to check dashboards every [[Morning]]. I want to be notified [[When]] something's wrong - like if our [[Production]] yield drops below 95%."

**Insight:** Passive dashboards ( Proactive alerts

**Implication:** Q1 alerts [[Feature]] is critical (already on [[Q1 2026 Roadmap]])

### 5. The Mobile Myth

**Pattern:** Everyone says [[They]] want mobile, no one actually uses it

**Quote ([[Multiple]] interviews):**
) "Mobile would be nice to have..." [when asked: do [[You]] make [[Decisions]] on mobile?] "No, I always pull up my laptop."

**Insight:** Responsive web is enough, native app not urgent

**Implication:** Deprioritize mobile app (confirmed in [[Feature Priorities]])

### 6. Trust is Earned, [[Not Assumed]]

**Pattern:** Trials convert when they [[See]] immediate [[Value]] (first [[Session]])

**Quote ([[DataDriven Co]] [[After]] first call):**
> "We just [[Created]] a dashboard in 15 minutes that would've taken me 2 days in Excel. I'm sold."

**Insight:** Fast time-to-value in first call = conversion

**Implication:** Optimize onboarding for "aha [[Moment]]" in first 30 min ([[Customer Onboarding]])

## [[Interview Breakdown]]

### [[By Company Size]]

| Size | Count | Conversion | [[Notes]] |
|------|-------|------------|-------|
| 20-50 employees | 2 | 0% | Too small, [[Price]]-sensitive |
| 50-200 employees | 7 | 43% (3/7) | **Sweet spot** |
| 200-500 employees | 3 | 33% (1/3) | Need enterprise [[Features]] (SSO) |

**Insight:** 50-200 employees is ideal (confirms [[DEC-002 Target Market]])

### [[By Industry]]

| Industry | Count | [[Pain Level]] (1-10) | Notes |
|----------|-------|-------------------|-------|
| Manufacturing | 3 | 9/10 | [[High]] complexity, legacy systems |
| SaaS | 4 | 7/10 | Already [[Using]] [[Some]] tools, need consolidation |
| Logistics | 2 | 8/10 | Real-time tracking needs |
| [[Professional Services]] | 2 | 6/10 | Lower urgency |
| E-commerce | 1 | 10/10 | High volume, churned ([[InsightHub]]) |

**Insight:** Manufacturing & logistics feel pain [[Most]] acutely

### [[By Current Tool]]

| [[Current Tool]] | Count | Satisfaction | Notes |
|--------------|-------|--------------|-------|
| Spreadsheets only | 5 | 2/10 | [[Ready]] to buy |
| [[Google Data Studio]] | 3 | 5/10 | Outgrowing free tier |
| PowerBI | 2 | 4/10 | Too complex, need IT help |
| Tableau | 1 | 3/10 | Expensive, slow |
| Metabase | 1 | 6/10 | Self-hosted burden |

**Insight:** Spreadsheet users easiest to convert, PowerBI switchers [[Good]] too

## [[Feature Priority Ranking

Based]] on interview mentions:

| Feature | Mentions | Urgency | [[Status]] |
|---------|----------|---------|--------|
| **Alerts/notifications** | 8/12 | High | Q1 |
| **[[Scheduled]] reports** | 6/12 | Medium | Q1 |
| **Easy data connection** | 12/12 | Critical | ✓ Shipped |
| **SSO/SAML** | 3/12 | Low (enterprise only) | Q2 |
| **Mobile app** | 7/12 | Low (lip service) | Backlog |
| **[[Custom]] branding** | 2/12 | [[Very Low]] | Q3 |

**Insight:** Align with [[Q1 2026 Roadmap]] - alerts & reports [[Top]] [[Priority]]

## [[Churn Risk]] Factors

From churned interviews:

1. **[[Performance]] issues** (InsightHub): Slow queries on large datasets
2. **Missing critical feature** (SSO blocker): Can't proceed without it
3. **Better fit elsewhere** ([[Specialized]] tool): We're too [[General]]-[[Purpose]]

**Implication:** [[Focus]] on performance (Q1 caching), but accept some losses to specialists

## Jobs to [[Be Done]]

**Primary JTBD:**
> "When I need to make a data-[[Driven]] decision, I want instant access to [[Key Metrics]], so I can act quickly without waiting on my team."

**Secondary:**
> "When my CEO asks for a metric, I want to pull it up in seconds, so I look competent and data-savvy."

**Emotional:** Feeling behind, overwhelmed by spreadsheets, wanting to be "data-driven"

## [[Buyer Personas]]

### [[Persona 1]]: "[[Spreadsheet Sarah]]" (Primary)

- **Role:** Operations Manager, Head of Analytics
- **Company:** 50-150 employees, $10M-$30M revenue
- **Pain:** Drowning in Excel, manual data pulls
- **Goal:** Automate [[Reporting]], save 5-10 hrs/week
- **Budget:** $500-$1K/mo (discretionary)
- **Decision:** Can buy without approval
- **[[Example]]:** Sarah at [[DataDriven Co]]

### [[Persona 2]]: "[[Tech]]-[[Savvy Tim]]" (Secondary)

- **Role:** [[Product Manager]], [[VP Engineering]]
- **Company:** 100-300 employees, tech/SaaS
- **Pain:** Patchwork of tools, no single source of truth
- **Goal:** Consolidate analytics [[Stack]]
- **Budget:** $1K-$3K/mo (needs VP approval)
- **Decision:** [[Evaluates 2]]-3 options
- **Example:** Michael at [[GrowthStack]]

## [[Related]]

- [[Target]] [[Market]]: [[DEC-002 Target Market]]
- Pricing: [[DEC-001 Pricing Model]]
- Roadmap: [[Q1 2026 Roadmap]]
- Customers: [[DataDriven Co]] (perfect persona match)
