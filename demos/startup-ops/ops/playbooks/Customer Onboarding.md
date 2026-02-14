---
type: playbook
automation: ai-managed
frequency: on-demand
trigger: new customer signup
version: "1.2"
owner: system
tags:
  - playbook
  - onboarding
  - customer-success
---
# [[Customer Onboarding

Responsible]]: [[Alex Chen]]
Automation: AI-[[Managed]] [[Execution]], human oversight

## [[When]] to [[Use

Trigger]]: New customer converts from trial to paid

## Prerequisites

- [ ] Customer has signed [[Contract]]
- [ ] Payment method confirmed and [[First]] charge successful
- [ ] [[Primary Contact]] [[Identified]]
- [ ] [[Account]] provisioned in [[System]]

## [[Day 1]]: Welcome & Setup

**Timing:** [[Within 2]] [[Hours]] of signup

- [ ] Send welcome email (template: `onboarding-welcome-v2`)
  - Include: Login credentials, [[Getting]] started [[Guide]], cal invite for kickoff
- [ ] Create dedicated Slack channel: `#customer-{company-name}`
- [ ] Add customer to [[MRR Tracker]]
- [ ] Schedule kickoff call within 48 hours

**Owner:** System ([[Automated]]) + [[Alex Chen]] (kickoff scheduling)

## [[Day 2]]-3: [[Technical Setup]]

**Timing:** Kickoff call [[Completed]]

- [ ] Walkthrough: Connect first [[Data]] source
  - [[Most]] common: Postgres, MySQL, [[API]] endpoint
  - Goal: First dashboard live within call
- [ ] Configure user permissions
- [ ] Set up integrations (if needed)
- [ ] [[Create 2]]-3 starter dashboards

**Owner:** [[Alex Chen]] ([[Technical]])

## [[Day 7]]: [[First Check]]-in

**Timing:** [[One]] week post-signup

- [ ] Review usage metrics
  - Logins: Daily? Weekly?
  - Dashboards [[Created]]: At least 1?
  - [[Data Sources]] connected: At least 1?
- [ ] Proactive outreach if low [[Engagement]]
  - Email: "How's it going?" template
  - Offer: Extra training [[Session]]
- [ ] [[Identify]] expansion [[Opportunities]]
  - More users?
  - Additional [[Features]]?

**Owner:** [[Jamie Patel]] (customer success)

## [[Day 14]]: Check-in #2

**Timing:** [[Two]] [[Weeks]] post-signup

- [ ] [[Schedule 15]]-min check-in call
- [ ] Ask: "[[What]]'s [[Working]]? What's [[Not]]?"
- [ ] Capture feedback for product roadmap
- [ ] Update [[Health Score]] in customer [[Note]]

**Owner:** [[Jamie Patel]]

## [[Day 30]]: First [[Month]] Review

**Timing:** End of first billing cycle

- [ ] Send "[[Month 1]] Metrics" [[Summary]]
  - Usage stats
  - [[Value]] delivered (dashboards, [[Insights]])
- [ ] Upsell conversation (if applicable)
  - More users?
  - Enterprise features?
- [ ] Request testimonial/case study (if happy)
- [ ] Update [[MRR Tracker]] with any changes

**Owner:** [[Jamie Patel]]

## [[Success Metrics]]

**Green (Healthy):**
- Daily logins
- 3+ dashboards created
- Positive feedback on calls
- Exploring additional features

**Yellow ([[At Risk]]):**
- Weekly logins (not daily)
- [[Only 1]] dashboard created
- Minimal engagement

**Red ([[Churn Risk]]):**
- No logins in 1 week
- Support tickets unresolved
- Negative feedback

## [[Common Issues]] & [[Solutions]]

| Issue | Solution |
|-------|----------|
| Can't connect data source | Schedule [[Tech]] call with Alex |
| Slow dashboard load times | Check data volume, suggest filters |
| [[Feature]] request (not [[Available]]) | Add to roadmap, set [[Expectations]] |
| [[Price]] concern | Escalate to Jamie for negotiation |

## Output

- Customer [[Successfully]] onboarded
- Health score [[Established]]
- Expansion opportunity identified
- [[Updated]] [[MRR Tracker]] and customer note

## [[Related]]

- Customers: [[DataDriven Co]], [[GrowthStack]]
- Finance: [[MRR Tracker]]
- Product: [[Feature Priorities]] (feature requests)
- [[Team]]: [[Alex Chen]] (technical), [[Jamie Patel]] (success)
