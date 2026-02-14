---
type: recurring
automation: ai-managed
schedule: "every Monday 8:00am"
duration: 15min
owner: system
tags:
  - recurring
  - standup
  - team
---
# Monday Standup Prep

[[Automated]] prep for weekly founder standup

Schedule: Every [[Monday 8]]:00am
Duration: 15 minutes
Participants: [[Alex Chen]], [[Jamie Patel]]

## [[Auto]]-Checklist

- [ ] Pull [[Last]] week's [[MRR Tracker]] numbers
- [ ] Check open customer tickets (any P0/P1?)
- [ ] Review [[Feature Priorities]] - [[What]] shipped last week?
- [ ] Check [[Runway Calculator]] - any alerts?
- [ ] List customer calls [[Scheduled]] [[This]] week

## [[Output Format

Add]] to today's daily [[Note]]:

```markdown
## Standup (auto-generated)

**Last Week:**
- MRR: ${current} (${change}%)
- Customers: ${active_count} active, ${trial_count} trials
- Shipped: ${features_shipped}
- Support: ${p0_count} P0, ${p1_count} P1

**This Week:**
- Priority 1: ${top_priority}
- Priority 2: ${second_priority}
- Priority 3: ${third_priority}
- Customer calls: ${calls_list}

**Blockers:**
- ${blocker_1}
- ${blocker_2}
```

## [[Discussion Items

Auto]]-detected [[Based]] on metrics:

| Trigger | [[Discussion Item]] |
|---------|-----------------|
| MRR flat 2+ [[Weeks]] | Sales [[Acceleration]] needed? |
| Trial → Paid <25% | Onboarding improvements? |
| Customer goes red | Immediate [[Action]] plan |
| Runway <9 months | Fundraise [[Timeline]] |
| [[Feature]] request volume [[High]] | Roadmap [[Priority]] review |

## [[Actions Template

Based]] on last week's [[Performance]]:

**If sales slowed:**
- [ ] [[Book 10]]+ demos this week
- [ ] Follow up with warm leads
- [ ] Review pricing [[Page]] conversion

**If product issues:**
- [ ] Review support tickets
- [ ] Prioritize bug fixes
- [ ] Update affected customers

**If cash alert:**
- [ ] Update [[Investor Pipeline]]
- [ ] Review burn reduction options
- [ ] Set fundraise deadline

## [[Related]]

- Weekly planning: [[Weekly Metrics Review]]
- [[Data Sources]]: [[MRR Tracker]], [[Runway Calculator]]
- Output: [[Daily Notes]] (e.g., [[2026-01-06]])
