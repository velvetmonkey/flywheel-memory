---
type: project
status: active
client: "[[Acme Corp]]"
start_date: 2025-10-01
end_date: 2026-03-31
budget: 75000
billed_to_date: 45000
priority: high
phase: cutover
tags:
  - project
  - data-migration
  - enterprise
  - active
---
# [[Acme Data Migration]]

## Overview

Migrating [[Acme Corp]]'s legacy ERP data (15 years of manufacturing records) to a cloud-native data platform. This is a strategic initiative to enable real-time analytics and mobile access for field technicians.

**Client**: [[Acme Corp]]
**Sponsor**: [[Sarah Mitchell]], VP Technology
**Timeline**: 6 months (Oct 2025 - Mar 2026)
**Budget**: $75,000 | **Billed**: $45,000 (60%)

## Current Status

**Phase**: Production Cutover (Phase 3 of 3)
**Health**: On Track
**Risk Level**: Medium

### Recent Progress
- UAT fully complete — all validation scripts passed across every table
- Performance benchmarks hitting 3x improvement target (set during [[Discovery Workshop Template|Discovery Workshop]] in October)
- [[Marcus Webb]] confirmed [[Apache Airflow]] pipelines rock solid
- Rollback procedures documented in [[Data Migration Playbook]]
- Cutover window locked: **March 28-29**
- [[Sarah Mitchell]] getting final sign-off from [[Emily Chen]] on production environment access

### Risk Flag
- [[James Rodriguez]] reports legacy Oracle system decommission timeline not confirmed by IT
- If no firm date by March 28, may need to run both systems in parallel during support window
- Parallel running would push costs beyond $75K budget — extra $8-10K for [[Marcus Webb]]'s time

## Project Phases

### Phase 1: Discovery & Design (COMPLETE)
- [x] Legacy system audit
- [x] Data model mapping
- [x] Migration architecture design
- [x] Stakeholder signoff

### Phase 2: Development & Testing (COMPLETE)
- [x] ETL pipeline development
- [x] Initial data extraction
- [x] Data validation — all tables passed
- [x] Performance testing — 3x improvement target met
- [x] User acceptance testing — passed

### Phase 3: Production Cutover (IN PROGRESS)
- [ ] Final production environment access ([[Emily Chen]] granting)
- [ ] Production cutover execution (March 28-29)
- [ ] Data verification
- [ ] 2-week support window
- [ ] Handover documentation

## Tasks

- [x] Complete data validation for remaining tables
- [x] Review performance test results with [[James Rodriguez]]
- [x] Prepare UAT test cases
- [x] Schedule cutover window with IT
- [ ] Confirm legacy Oracle decommission timeline 📅 2026-03-28
- [ ] Execute production cutover 📅 2026-03-28
- [ ] Handover documentation to [[Acme Corp]] team 📅 2026-04-11

## Milestones

| Milestone | Target | Status |
|-----------|--------|--------|
| Discovery Complete | 2025-10-31 | ✅ Done |
| Design Approved | 2025-11-15 | ✅ Done |
| Development Complete | 2025-12-20 | ✅ Done |
| Testing Complete | 2026-02-28 | ✅ Done |
| Production Cutover | 2026-03-28 | 🔄 In Progress |
| Support Complete | 2026-04-11 | ⏳ Planned |

## Financial

| Period | Hours | Amount | Status |
|--------|-------|--------|--------|
| October 2025 | 50 | $15,000 | Paid |
| November 2025 | 50 | $15,000 | Paid ([[INV-2025-047]]) |
| December 2025 | 40 | $12,000 | Pending ([[INV-2025-048]]) |
| January 2026 | 60 | $18,000 | OVERDUE ([[INV-2026-001]]) |
| February 2026 | 50 | $15,000 | OVERDUE ([[INV-2026-002]]) |
| March 2026 | Est. 35 | $10,500 | Pending |

## Team

| Member | Role | Allocation |
|--------|------|------------|
| Carter | Project Lead | 40% |
| [[Marcus Webb]] | ETL Architect / Technical Cutover Lead | 90% |

## Key Decisions

1. **Cloud Platform**: AWS (vs Azure) - lower cost for data workloads
2. **ETL Tool**: [[Apache Airflow]] (vs commercial) - client IT team familiarity
3. **Cutover Strategy**: Big bang (vs phased) - reduced complexity

## Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Oracle decommission timeline unconfirmed | High — parallel running adds $8-10K | Medium | [[James Rodriguez]] escalating to director |
| IT resource availability for cutover | High | Low | Window locked March 28-29 |
| Data quality issues | Medium | Low | All validation passed |

## Knowledge Applied

This project leverages:
- [[Data Migration Playbook]] - Standard methodology
- [[API Security Checklist]] - For new API layer
- [[Discovery Workshop Template]] - Used in Phase 1

## Upsell Opportunity

[[Sarah Mitchell]] mentioned the [[Acme Analytics Add-on]] proposal has been circulating with Acme's finance team and getting good reception. Scoping call with [[Emily Chen]] and data team planned right after cutover. [[Priya Kapoor]] ideal for requirements gathering.

## Related

- Client: [[Acme Corp]]
- Invoices: [[INV-2025-047]], [[INV-2025-048]], [[INV-2026-001]], [[INV-2026-002]]
- Proposal (upsell): [[Acme Analytics Add-on]]
- Team: [[Marcus Webb]]

---

*Last updated: 2026-03-20*
