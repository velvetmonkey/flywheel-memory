---
type: backlog
automation: human-review
last_updated: 2026-01-07
owner: Alex Chen
tags:
  - backlog
  - features
  - product
---
# [[Feature Priorities

Product]] backlog prioritization

Owner: [[Alex Chen]]
[[Updated]]: Weekly [[Based]] on customer feedback

## [[Prioritization Framework]]

| [[Priority]] | [[Criteria]] | [[Decision Owner]] |
|----------|----------|----------------|
| **P0** | Prevents churn OR blocks $5K+ deal | Alex + Jamie (joint) |
| **P1** | Requested by 3+ customers | Alex |
| **P2** | Nice to have, competitive parity | Alex |
| **P3** | Future exploration | Backlog |

## Active Features (Q1 2026)

See [[Q1 2026 Roadmap]] for details

- [x] Caching layer (shipped Jan 25!)
- [ ] Alerts & notifications (Feb 28 target)
- [ ] Scheduled reports (Mar 31 target)

## Backlog (Prioritized)

### P1: High Priority

#### 1. Dashboard Templates Library
**Requested by:** [[DataDriven Co]], [[GrowthStack]], 2 prospects
**Use case:** Faster onboarding - customers start from templates vs blank slate
**Effort:** Medium (2 weeks)
**Impact:** High (reduces time-to-value from 2 days → 30 min)

**Proposed:**
- 10 pre-built templates (sales, finance, product, operations)
- One-click customization
- Community contributions (future)

**Decision:** Ship in Q2

#### 2. Custom Branding / White-Label
**Requested by:** [[GrowthStack]], 1 enterprise prospect
**Use case:** Agencies want to resell MetricFlow under their brand
**Effort:** Medium (3 weeks)
**Impact:** Medium (unlocks new customer segment)

**Proposed:**
- Custom logo upload
- Color scheme customization
- Remove MetricFlow branding

**Decision:** Q3 (lower priority than core features)

#### 3. Advanced Permissions (RBAC)
**Requested by:** [[DataDriven Co]], enterprise prospects
**Use case:** Fine-grained access control (viewer vs editor vs admin)
**Effort:** High (4 weeks)
**Impact:** Medium (required for enterprise, not SMB)

**Proposed:**
- Role-based access (viewer, editor, admin, owner)
- Dashboard-level permissions
- Data source restrictions

**Decision:** Q2 (prerequisite for enterprise plan)

### P2: Medium Priority

#### 4. Mobile App (iOS/Android)
**Requested by:** 1 customer (low urgency)
**Use case:** View dashboards on mobile
**Effort:** Very High (2 months)
**Impact:** Low (web responsive works fine for now)

**Decision:** Not prioritized - responsive web first

#### 5. SQL Query Editor (Advanced)
**Requested by:** Power users (2 requests)
**Use case:** Custom SQL queries for complex analysis
**Effort:** High (6 weeks)
**Impact:** Low (niche use case)

**Decision:** Q3 at earliest

#### 6. Data Catalog / Documentation
**Requested by:** [[DataDriven Co]]
**Use case:** Document what each table/column means
**Effort:** Medium (2 weeks)
**Impact:** Medium (reduces support burden)

**Decision:** Q2

### P3: Future Exploration

- Real-time collaboration (multiple users editing same dashboard)
- AI-powered insights ("anomaly detected in revenue")
- Embedded analytics (iframe integration for customer apps)
- Data warehouse sync (reverse ETL)

## Feature Requests from Customers

| Feature | Customer | Date | Priority | Status |
|---------|----------|------|----------|--------|
| Alerts | [[DataDriven Co]] | Dec 20 | P0 | In dev (Feb ship) |
| Scheduled reports | [[DataDriven Co]] | Jan 6 | P0 | Q1 roadmap |
| SSO/SAML | [[GrowthStack]] | Jan 6 | P1 | Q2 roadmap |
| Templates | [[DataDriven Co]] | Jan 6 | P1 | Q2 |
| Custom branding | [[GrowthStack]] | Jan 3 | P2 | Q3 |
| RBAC | [[DataDriven Co]] | Jan 6 | P1 | Q2 |
| Mobile app | Prospect | Dec 28 | P3 | Backlog |

## Bugs & Tech Debt

| Issue | Severity | Reported By | Status |
|-------|----------|-------------|--------|
| Slow load on 10M+ rows | P0 | [[InsightHub]] | Fixed (caching) |
| Dashboard refresh fails sometimes | P1 | [[DataDriven Co]] | Investigating |
| Export to CSV truncates at 10K rows | P2 | Prospect | Backlog |
| Dark mode UI bugs | P3 | Internal | Backlog |

## Competitive Analysis

| Feature | Us | Tableau | PowerBI | Amplitude |
|---------|----|----|---------|-----------|
| Easy setup | ✓ | ✗ | ✗ | ✓ |
| Custom dashboards | ✓ | ✓ | ✓ | ✓ |
| Alerts | Q1 | ✓ | ✓ | ✓ |
| Scheduled reports | Q1 | ✓ | ✓ | ✓ |
| SSO/SAML | Q2 | ✓ | ✓ | ✓ |
| Mobile app | ✗ | ✓ | ✓ | ✓ |
| Templates | Q2 | ✓ | ✓ | ✗ |
| Pricing | $499 | $1,200+ | $1,000+ | $995 |

**Gap:** SSO, mobile app
**Advantage:** Setup speed, pricing

## [[Decision Log]]

| [[Date]] | Decision | Rationale |
|------|----------|-----------|
| 2026-01-05 | Delay SSO to Q2 | Prioritize [[Performance]] (caching) over enterprise auth |
| 2026-01-03 | Add alerts to Q1 | [[Top]] request, [[High Impact]] on retention |
| 2025-12-28 | Cut mobile app from roadmap | Responsive web sufficient, [[Focus]] on [[Core]] |

## [[Related]]

- Roadmap: [[Q1 2026 Roadmap]]
- Customers: [[DataDriven Co]], [[GrowthStack]]
- [[Decisions]]: [[DEC-001 Pricing Model]], [[DEC-002 Target Market]]
