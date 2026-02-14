---
type: knowledge
category: playbook
last_reviewed: 2024-06-15
used_in:
  - "[[Acme Data Migration]]"
  - "[[GlobalBank API Audit]]"
version: "2.1"
tags:
  - knowledge
  - reusable
  - data-migration
  - methodology
---
# [[Data Migration Playbook]]

## [[Overview

Standard]] methodology for enterprise data migration projects. This playbook has been refined through 8+ client engagements and covers the full lifecycle from discovery to post-migration support.

[[Last Reviewed]]: [[June 2024]] (needs update)
**Version**: 2.1
[[Used In]]: [[Acme Data Migration]], [[GlobalBank API Audit]]

## When to Use

This playbook applies when:
- Moving data between systems (legacy to modern, on-prem to cloud)
- Data volume exceeds 1TB or 10M+ records
- Multiple source systems involved
- Production downtime must be minimized

## [[Phase 1]]: Discovery ([[Week 1]]-2)

### Objectives
- Understand [[Current State]] data landscape
- Identify data owners and stakeholders
- Document data quality issues
- Establish success criteria

### Deliverables
- [ ] Source system inventory
- [ ] Data dictionary (existing + gaps)
- [ ] Stakeholder map
- [ ] Risk register

### [[Workshop Agenda
Use]] [[Discovery Workshop Template]] for structured sessions:
1. Current state walkthrough (2 hours)
2. Pain points and goals (1 hour)
3. Data flow mapping (2 hours)
4. Success criteria definition (1 hour)

## [[Phase 2]]: Design ([[Week 3]]-4)

### Objectives
- Define target architecture
- Map source to target schemas
- Design ETL pipelines
- Plan testing strategy

### Deliverables
- [ ] Target data model
- [ ] Mapping specifications
- [ ] ETL architecture diagram
- [ ] Test plan

### [[Key Decisions]]

| Decision | Options | Recommendation |
|----------|---------|----------------|
| [[ETL Tool]] | Airflow, Fivetran, Custom | Airflow for complex transforms |
| Cutover | Big bang vs Phased | Phased for >5TB |
| Validation | Sampling vs Full | Full for financial data |

## [[Phase 3]]: Development ([[Week 5]]-8)

### Objectives
- Build ETL pipelines
- Implement data validation
- Set up monitoring
- Prepare rollback procedures

### [[Sprint Structure]]
- [[Sprint 1]]: Core tables, happy path
- [[Sprint 2]]: Edge cases, [[Error Handling]]
- [[Sprint 3]]: Performance optimization
- [[Sprint 4]]: Integration, documentation

### [[Code Standards]]
- Version control all scripts (Git)
- Parameterize environment configs
- Log all transformations
- Implement idempotency

## [[Phase 4]]: Testing ([[Week 9]]-11)

### [[Test Types]]

| Test | Purpose | Coverage |
|------|---------|----------|
| Unit | Individual transforms | All functions |
| Integration | End-to-end pipelines | All flows |
| Performance | Load and timing | Production volumes |
| UAT | Business validation | Sample records |

### [[Validation Checklist]]
- [ ] Row counts match (source vs target)
- [ ] Key fields validated (checksums)
- [ ] Referential integrity maintained
- [ ] Date/time formats correct
- [ ] Null handling as specified

## [[Phase 5]]: Cutover ([[Week 12]])

### Pre-Cutover
- [ ] Final backup of source system
- [ ] Stakeholder communication sent
- [ ] Support team on standby
- [ ] Rollback procedure tested

### [[Cutover Sequence]]
1. Freeze source system (if applicable)
2. Run final extraction
3. Execute migration scripts
4. Run validation suite
5. Enable target system access
6. Monitor for 24 hours

### [[Rollback Triggers]]
- >1% data validation failures
- Performance degradation >20%
- Critical business process blocked

## [[Phase 6]]: Support ([[Week 13]]-16)

### Post-[[Migration Activities]]
- Daily validation reports ([[Week 1]])
- Issue triage and resolution
- Knowledge transfer to client team
- Documentation handover

### [[Success Metrics]]
- Data accuracy: >99.9%
- Performance: Within SLA
- User adoption: >80% within 2 weeks
- Support tickets: <5 critical issues

## [[Lessons Learned]]

### From [[Acme Data Migration]]
- Start data quality assessment earlier
- Involve IT operations in design phase
- Document tribal knowledge in source systems

### From [[GlobalBank API Audit]]
- Security review adds 2 weeks minimum
- Financial data requires full validation (no sampling)
- Regulatory documentation is significant effort

## Tools & Resources

### [[Recommended Stack]]
- **ETL**: [[Apache Airflow]], dbt
- **Validation**: [[Great Expectations]], custom Python
- **Monitoring**: Datadog, [[CloudWatch]]
- **Documentation**: Markdown, Draw.io

### Templates
- [[Discovery Workshop Template]]
- [[Data Mapping Template]] ([[Google Sheets]])
- [[Test Case Template]] (Markdown)
- [[Runbook Template]] (Markdown)

## [[Version History]]

| Version | Date | Changes |
|---------|------|---------|
| 2.1 | 2024-06-15 | Added lessons from [[GlobalBank]] |
| 2.0 | 2024-01-10 | Restructured phases |
| 1.0 | 2023-06-01 | Initial version |

## Tasks

- [ ] Update with Acme [[Lessons Learned]] 📅 2026-01-10
- [ ] Add section on cloud-native patterns 📅 2026-01-31
- [ ] Review with peer consultant 📅 2026-02-15

---

*This playbook needs review - last updated [[June 2024]]*
