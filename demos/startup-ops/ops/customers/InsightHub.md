---
type: customer
status: churned
owner: "Alex Chen"
mrr: "$0"
priority: "high"
churned_date: 2025-12-28
original_mrr: 499
tags:
  - customer
  - churned
  - learning
---
# InsightHub

Churned customer - learning opportunity

## Company Info

Industry: E-commerce Analytics
Size: 30 employees
Website: www.insighthub.example.com

## Contact

Primary: David Kim (CTO)
Email: david@insighthub.example.com

## Timeline

| Date | Event |
|------|-------|
| 2025-11-15 | Trial started |
| 2025-11-29 | Converted to paid ($499/mo) |
| 2025-12-20 | Cancellation notice |
| 2025-12-28 | Churned |

**Lifetime: 29 days paid**

## [[Churn Reason

Primary]]: [[Performance]] issues with large datasets

David's feedback:
> "[[MetricFlow]] is great for small datasets, [[But]] our 10M+ row tables caused query timeouts. We [[Need]] [[Sub]]-second response times for our dashboards, and we were seeing 30+ second loads. Had to switch to a more robust solution."

Secondary factors:
- Lack of caching layer (we [[Have]] [[This]] on roadmap)
- Missing [[Scheduled]] reports [[Feature]]
- Support [[Response Time]] (24h vs needed <4h)

## [[What We Learned]]

1. **[[Technical Gap]]**: Need to handle larger datasets better
   - [[Action]]: [[DEC-001 Pricing Model]] [[Should]] tier by [[Data]] volume
   - Action: Add caching to Q1 roadmap ([[Q1 2026 Roadmap]])

2. **Product-[[Market Fit]]**: We're better suited for <1M rows currently
   - Action: [[DEC-002 Target Market]] should clarify ideal customer size

3. **Support**: Enterprise customers need [[Faster]] support
   - Action: [[Consider]] support SLA tiers

## Win-[[Back Potential]]: Low (3 months+)

David was gracious but firm. Said "maybe revisit in 6 months [[After]] [[You]]'ve scaled the [[Infrastructure]]."

## [[Related]]

- Owner: [[Alex Chen]]
- [[Decisions]]: [[DEC-001 Pricing Model]], [[DEC-002 Target Market]]
- Roadmap: [[Q1 2026 Roadmap]] (caching feature)
- Finance: [[MRR Tracker]] (churn impact)
