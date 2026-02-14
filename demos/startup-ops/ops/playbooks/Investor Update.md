---
type: playbook
automation: ai-managed
frequency: monthly
trigger: "first Monday of month"
version: "1.0"
owner: Jamie Patel
tags:
  - playbook
  - investors
  - reporting
---
# [[Investor Update

Monthly]] email to angel investors and advisors

Owner: [[Jamie Patel]]
[[Frequency]]: [[First]] Monday of [[Each]] [[Month]]
Recipients: 5 angel investors + 2 advisors

## [[Email Template]]

```
Subject: MetricFlow Update - {Month Year}

Hi everyone,

Quick monthly update on MetricFlow:

📈 **Metrics**
- MRR: ${current} ({change}% MoM)
- Customers: {count} ({change} vs last month)
- Runway: {months} months

🎯 **Progress This Month**
- {Accomplishment 1}
- {Accomplishment 2}
- {Accomplishment 3}

🚀 **Next Month Goals**
- {Goal 1}
- {Goal 2}
- {Goal 3}

🤔 **Where We Need Help**
- {Ask 1 - e.g., intro to prospect}
- {Ask 2 - e.g., advice on pricing}
- {Ask 3 - e.g., hiring referrals}

📊 **Dashboard:** {link to metrics dashboard}

Thanks for your support!

- Jamie & Alex
```

## Data Sources

Pull from:
- [[MRR Tracker]] - revenue metrics
- [[Runway Calculator]] - cash and burn
- [[Hiring Plan]] - team growth
- [[Q1 2026 Roadmap]] - product progress
- Weekly notes (sum up accomplishments)

## What to Include

**Always include:**
- MRR (current + change)
- Customer count
- Runway remaining
- 3 wins this month
- 3 goals next month
- Specific asks

**Sometimes include:**
- Customer win stories (e.g., [[DataDriven Co]] expansion)
- Product launches
- Team hires
- Fundraising updates

**Never include:**
- Internal drama
- Overly detailed financials
- Complaints without solutions

## Tone Guidelines

- **Be honest:** Good and bad news
- **Be concise:** <300 words
- **Be specific:** Numbers, not vague progress
- **Ask for help:** Investors want to help

## Example (January 2026)

```
Subject: MetricFlow Update - January 2026

Hi everyone,

Quick monthly update on MetricFlow:

📈 **Metrics**
- MRR: $499 (flat MoM, first paying customer retained!)
- Customers: 1 paid, 1 trial (GrowthStack evaluating)
- Runway: 12 months

🎯 **Progress This Month**
- Landed first paying customer (DataDriven Co, manufacturing analytics)
- 8 demos booked, 2 trials started
- Shipped API integration feature (top request)

🚀 **Next Month Goals**
- Close GrowthStack trial (decision Jan 20)
- 10+ demos to hit 3 trials in Feb
- Start seed fundraise conversations

🤔 **Where We Need Help**
- Intros to SaaS companies (50-200 employees, analytics-heavy)
- Pricing feedback: $499 vs $999 tiers make sense?
- Seed fund intros (targeting $500K at $3M post)

📊 **Dashboard:** [link]

Thanks for your support!

- Jamie & Alex
```

## Recipients

| Name | Role | Interest | [[Last Response]] |
|------|------|----------|---------------|
| [[Tom Chen]] | Angel ($50K) | Product feedback | Always replies |
| Maria Rodriguez | Angel ($25K) | Sales intros | Intro'd 2 prospects |
| [[David Park]] | Angel ($15K) | Advisor | Quiet |
| Lisa Nguyen | Angel ($10K) | [[Technical]] | Code reviews |
| [[Sam Thompson]] | Advisor | GTM [[Strategy]] | Weekly calls |

## [[Related]]

- [[Data]]: [[MRR Tracker]], [[Runway Calculator]], [[Hiring Plan]]
- Fundraising: [[Investor Pipeline]]
- Product: [[Q1 2026 Roadmap]]
