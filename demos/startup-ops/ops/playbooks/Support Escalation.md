---
type: playbook
automation: ai-managed
frequency: as-needed
trigger: support ticket received
version: "1.0"
tags:
  - playbook
  - support
  - escalation
---
# [[Support Escalation

When]] and how to escalate customer issues

## [[Severity Levels]]

### P0: Critical - [[System Down]]

**Definition:** Product completely unusable for customer

**[[Response Time]]:** 1 hour
**[[Resolution Target]]:** 4 [[Hours]]

**Examples:**
- [[Authentication]] broken (can't [[Log]] in)
- [[All]] dashboards returning errors
- [[Data]] corruption

**Process:**
1. [ ] [[Auto]]-alert [[Alex Chen]] immediately (Slack + SMS)
2. [ ] Create war room (Slack channel)
3. [ ] [[Customer Communication]] every 30 minutes
4. [ ] Post-mortem [[After]] resolution

### P1: [[High]] - [[Major Feature Broken]]

**Definition:** [[Key Feature]] unavailable [[But]] workarounds exist

**Response Time:** 4 hours
**Resolution [[Target]]:** 24 hours

**Examples:**
- [[Specific]] dashboard type [[Not]] [[Loading]]
- [[Integration]] failing for [[One]] data source
- Slow [[Performance]] (>10s load times)

**Process:**
1. [ ] Notify [[Alex Chen]] [[Via]] [[Slack
2]]. [ ] Acknowledge to customer within 4 hours
3. [ ] [[Provide]] workaround if [[Available]]
4. [ ] Daily updates until resolved

### P2: Medium - [[Minor Issue]]

**Definition:** Non-critical bug or [[Feature]] request

**Response Time:** 24 hours
**Resolution Target:** 1 week

**Examples:**
- UI glitch
- Feature request
- [[Documentation]] question

**Process:**
1. [ ] Add to backlog
2. [ ] Acknowledge to customer
3. [ ] Resolve [[Based]] on [[Priority]]

### P3: Low - Nice to [[Have]]

**Definition:** Enhancement, non-urgent

**Response Time:** 48 hours
**Resolution Target:** Backlog (no commitment)

**Examples:**
- Color scheme customization
- Export format request
- [[General]] question

## [[Escalation Paths]]

| Role | Handles | [[Escalates To]] |
|------|---------|--------------|
| **Jamie** ([[First]] line) | P2, P3, general questions | Alex for [[Technical]] P0/P1 |
| **Alex** (technical) | P0, P1, all technical issues | External consultant (if needed) |
| **Customer** (self-serve) | P3, docs | Jamie for anything complex |

## Templates

### P0 Customer [[Communication]]

```
Subject: [URGENT] Issue with MetricFlow - Working on Fix

Hi {customer_name},

We're aware of the {issue_description} affecting your account. This is our top priority.

Status: Investigating root cause
ETA: Initial fix within 2 hours
Updates: Every 30 minutes

Current workaround: {if any}

- Alex & Jamie
MetricFlow Team
```

### P1 Acknowledgment

```
Subject: Re: {issue_title}

Hi {customer_name},

Thanks for reporting this. We've confirmed the {issue_description} and are working on a fix.

Priority: High
ETA: Fix deployed within 24 hours
Workaround: {if available}

I'll update you by EOD today.

- {owner}
```

## [[SLA Tracking]]

| [[Month]] | P0 Count | [[Avg Resolution]] | P1 Count | Avg Resolution |
|-------|----------|----------------|----------|----------------|
| [[Dec 2025]] | 1 | 3 hours | 2 | 18 hours |
| [[Jan 2026]] | 0 | - | 1 | 12 hours |

**Goal:** <2 P0s per month, <24h average P1 resolution

## [[Related]]

- Customers: All
- Product: [[Feature Priorities]] (bug tracking)
- [[Team]]: [[Alex Chen]] (technical [[Lead]])
