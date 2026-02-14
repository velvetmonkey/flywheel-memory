---
type: roadmap
automation: human-review
quarter: Q1
year: 2026
status: in-progress
owner: Alex Chen
tags:
  - roadmap
  - product
  - strategy
---
# Q1 2026 [[Roadmap

Product]] [[Priorities]] for January - [[March 2026]]

Owner: [[Alex Chen]]
[[Review Frequency]]: Weekly (at [[Monday Standup Prep]])

## Q1 Theme: "Foundation & Scale"

**Goal:** Build [[Infrastructure]] to support 10+ customers while maintaining speed

**[[Key Metrics]]:**
- [[Support 5]] paying customers (currently 1)
- 10M+ row datasets (vs [[Current]] 1M limit)
- <5s dashboard load times (vs current 10-30s)
- 99.9% uptime

## [[Features]]

### P0: [[Must Ship]] (Critical for Growth)

#### 1. [[Caching Layer]]
**Why:** [[InsightHub]] churned due to slow [[Performance]] on large datasets
**Impact:** Enable customers with 10M+ rows
**Due:** [[Jan 31]]
**[[Status]]:** In [[Dev]]

**[[Technical]]:**
- Redis caching for query [[Results]]
- [[Smart]] invalidation on [[Data]] refresh
- 10x performance improvement expected

**Dependencies:**
- AWS [[ElastiCache]] setup
- Query fingerprinting logic

**Success metric:** <3s load time for 10M row dashboards

#### 2. Alerts & Notifications
**Why:** [[Top]] [[Feature]] request from [[DataDriven Co]] and 3 other prospects
**Impact:** Increases stickiness (daily [[Engagement]])
**Due:** [[Feb 28]]
**Status:** [[Design]] [[Complete]], dev [[Starts Feb]] 1

**Features:**
- Threshold alerts (e.g., "notify if revenue <$10K")
- Slack/email delivery
- Alert history & management UI

**Beta testers:**
- [[DataDriven Co]] (committed)
- [[GrowthStack]] (if they convert)

**Success metric:** 50%+ of paying customers create at least 1 alert

#### 3. Scheduled Reports
**Why:** Requested by [[DataDriven Co]], common in competitor tools
**Impact:** Reduces manual export work
**Due:** Mar 31
**Status:** Not started

**Features:**
- Daily/weekly/monthly schedules
- Email PDF delivery
- Dashboard snapshot functionality

**Success metric:** 30%+ adoption among paying customers

### P1: Should Ship (Competitive)

#### 4. SSO / SAML Auth
**Why:** Blocker for [[GrowthStack]] and other enterprise trials
**Impact:** Unlock enterprise deals ($999+ plans)
**Due:** Q2 (moved from Q1)
**Status:** Spec'd, [[But]] delayed

**Decision:** Prioritize caching & alerts over SSO
**Rationale:** More customers [[Need]] performance than enterprise auth

#### 5. [[API]] [[Rate Limiting]]
**Why:** [[Prevent]] abuse, prepare for scale
**Impact:** Platform stability
**Due:** [[Mar 15]]
**Status:** [[Not Started]]

**Technical:**
- Per-customer [[Rate]] limits
- [[Graceful Degradation]]
- Usage dashboards

### P2: Nice to [[Have]] (Backlog)

- Dashboard templates library
- [[Custom]] branding (white-label)
- Mobile app
- Advanced permissions (role-[[Based]] access)

## [[Technical Debt]]

**[[Must]] address in Q1:**
1. [[Database]] connection pooling (performance)
2. Error [[Monitoring]] improvements (Sentry [[Integration]])
3. [[Automated]] [[Testing]] [[Coverage]] (currently 40%, [[Target]] 70%)

## Resourcing

**Current:** Alex ([[Full]]-time), Jamie (10% for product input)
**Needs:** 1 [[Engineer]] by April ([[Hiring Plan]] - pending seed round)

**Q1 allocation:**
- 60% new features (caching, alerts, reports)
- 20% customer support / bug fixes
- 10% [[Tech]] debt
- 10% infrastructure / [[DevOps]]

## [[Risk]] & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Alex capacity (solo eng) | Can't ship [[All]] P0s | Cut [[Scheduled]] reports to Q2 |
| AWS costs spike | Burn rate increases | [[Implement]] caching to reduce queries |
| Customer churn | MRR declines | Prioritize perf fixes (caching [[First]]) |
| SSO delay loses [[GrowthStack]] | Miss $999 MRR | Negotiate custom pricing without SSO |

## Success Criteria

**Q1 is successful if:**
- [ ] Caching shipped & live in production
- [ ] Alerts shipped & 50%+ adoption
- [ ] 3+ paying customers (from current 1)
- [ ] Zero churn (retain [[DataDriven Co]])
- [ ] No P0 production incidents

## Related

- Customers: [[DataDriven Co]], [[GrowthStack]]
- Hiring: [[Hiring Plan]] (eng hire depends on $10K MRR)
- Finance: [[MRR Tracker]] (revenue impact)
- [[Decisions]]: [[DEC-001 Pricing Model]] (pricing tiers), [[DEC-002 Target Market]]
