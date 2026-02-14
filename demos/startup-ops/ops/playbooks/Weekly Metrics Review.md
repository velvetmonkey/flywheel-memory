---
type: playbook
automation: ai-managed
frequency: weekly
trigger: "every Monday 9am"
version: "1.0"
owner: system
tags:
  - playbook
  - metrics
  - reporting
---
# [[Weekly Metrics Review

Weekly]] business metrics check

Automation: [[Run]] every Monday 9am
Duration: 15 minutes
Attendees: [[Alex Chen]], [[Jamie Patel]]

## Metrics to Review

### 1. Revenue ([[MRR Tracker]])

- [ ] [[Current]] MRR
- [ ] Week-over-week change
- [ ] New customers
- [ ] Churned customers
- [ ] Trials → Paid conversion

**[[Quick Check]]:**
```
Current MRR: ${get from MRR Tracker}
Last Week: ${compare}
Change: ${calculate %}
```

### 2. Sales Pipeline

- [ ] Demos booked this week
- [ ] Trials started
- [ ] Deals in negotiation
- [ ] Expected closures this month

### 3. Product Usage

- [ ] Daily active users (DAU)
- [ ] Dashboards created
- [ ] Data sources connected
- [ ] API calls (usage intensity)

### 4. Customer Health

- [ ] Green customers: Active, engaged
- [ ] Yellow customers: At risk
- [ ] Red customers: Churn danger

**Action:** Proactive outreach for yellow/red

### 5. Support & Bugs

- [ ] Open P0/P1 tickets
- [ ] Average resolution time
- [ ] Customer satisfaction (CSAT)

### 6. Cash & Runway

From [[Runway Calculator]]:
- [ ] Current cash balance
- [ ] Burn rate this month
- [ ] Months of runway remaining

**Alert:** If runway <9 months, escalate fundraising

### 7. Hiring Progress

From [[Hiring Plan]]:
- [ ] Progress toward $10K MRR trigger
- [ ] Timeline to first hire
- [ ] Candidate pipeline (if active)

## Output: Weekly Summary

Template:
```markdown
# Week of {date}

## Revenue
- MRR: ${current} ({change}% vs last week)
- New: {count} customers
- Churned: {count} customers
- Trials: {count} active

## Sales
- Demos: {count}
- Pipeline value: ${amount}
- Expected close: {deals}

## Product
- DAU: {count}
- New dashboards: {count}
- Engagement: {high/medium/low}

## Health
- Green: {count}
- Yellow: {count}
- Red: {count}

## Actions
- [ ] {action item 1}
- [ ] {action item 2}
- [ ] {action item 3}
```

Save to: [[2026-W01]] (or current week note)

## Actions Based on Metrics

| Scenario | [[Action]] |
|----------|--------|
| MRR flat or declining | Review churn reasons, accelerate sales |
| Low trial conversion | Improve onboarding ([[Customer Onboarding]]) |
| Customer goes yellow/red | Immediate check-in call |
| Runway <9 months | Start fundraising ([[Investor Pipeline]]) |
| $10K MRR reached | Execute [[Hiring Plan]] |

## [[Related]]

- Revenue: [[MRR Tracker]]
- Cash: [[Runway Calculator]]
- Hiring: [[Hiring Plan]]
- Customers: [[DataDriven Co]], [[GrowthStack]]
- Weekly [[Notes]]: [[2026-W01]], [[2026-W02]]
