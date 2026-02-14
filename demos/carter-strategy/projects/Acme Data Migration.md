---
type: project
status: active
client: "[[Acme Corp]]"
start_date: 2025-10-01
end_date: 2026-03-31
budget: 75000
billed_to_date: 42000
priority: high
phase: testing
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
**Sponsor**: [[Sarah Mitchell]], [[VP Technology]]
**Timeline**: 6 months ([[Oct 2025]] - [[Mar 2026]])
**Budget**: $75,000 | **Billed**: $42,000 (56%)

## [[Current Status]]

**Phase**: Testing ([[Phase 2]] of 3)
**Health**: [[On Track]]
**[[Risk Level]]**: Medium

### [[Recent Progress]]
- Completed data extraction from legacy Oracle system
- Validation scripts running on 80% of tables
- Performance testing shows 3x improvement over baseline

### Blockers
- Waiting on IT to provision production environment access
- One data quality issue in supplier records (under investigation)

## [[Project Phases]]

### [[Phase 1]]: Discovery & Design (Complete)
- [x] Legacy system audit
- [x] Data model mapping
- [x] Migration architecture design
- [x] Stakeholder signoff

### Phase 2: Development & Testing (Current)
- [x] ETL pipeline development
- [x] Initial data extraction
- [ ] Data validation (80% complete)
- [ ] Performance testing
- [ ] User acceptance testing

### [[Phase 3]]: Cutover & Support
- [ ] Production deployment
- [ ] Data verification
- [ ] Training sessions
- [ ] 30-day support period

## Tasks

- [ ] Complete data validation for remaining tables 📅 2026-01-10
- [ ] Review performance test results with James 📅 2026-01-08
- [ ] Prepare UAT test cases 📅 2026-01-15
- [ ] Schedule cutover window with IT 📅 2026-01-20

## Milestones

| Milestone | Target | Status |
|-----------|--------|--------|
| [[Discovery Complete]] | 2025-10-31 | ✅ Done |
| [[Design Approved]] | 2025-11-15 | ✅ Done |
| [[Development Complete]] | 2025-12-20 | ✅ Done |
| [[Testing Complete]] | 2026-01-31 | 🔄 [[In Progress]] |
| [[Production Cutover]] | 2026-02-28 | ⏳ Planned |
| [[Support Complete]] | 2026-03-31 | ⏳ Planned |

## Financial

| Period | Hours | Amount | Status |
|--------|-------|--------|--------|
| [[October 2025]] | 50 | $15,000 | Paid |
| November 2025 | 50 | $15,000 | Paid |
| [[December 2025]] | 40 | $12,000 | Invoiced |
| January 2026 | Est. 40 | $12,000 | Pending |
| [[February 2026]] | Est. 35 | $10,500 | Pending |
| March 2026 | Est. 35 | $10,500 | Pending |

## [[Key Decisions]]

1. **[[Cloud Platform]]**: AWS (vs Azure) - lower cost for data workloads
2. **[[ETL Tool]]**: [[Apache Airflow]] (vs commercial) - client IT team familiarity
3. **[[Cutover Strategy]]**: Big bang (vs phased) - reduced complexity

## Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Data quality issues | Medium | Medium | Validation scripts, cleanup sprints |
| IT resource availability | High | Low | Early booking, escalation path |
| Scope creep | Medium | Medium | Change control process |

## Knowledge Applied

This project leverages:
- [[Data Migration Playbook]] - Standard methodology
- [[API Security Checklist]] - For new API layer
- [[Discovery Workshop Template]] - Used in Phase 1

## Related

- Client: [[Acme Corp]]
- Invoices: [[INV-2025-047]], [[INV-2025-048]]
- Proposal (upsell): [[Acme Analytics Add-on]]
- Daily logs: [[2025-12-30]], [[2026-01-02]]

---

*Last updated: 2026-01-02*
