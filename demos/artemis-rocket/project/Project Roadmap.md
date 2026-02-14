---
type: hub
status: active
owner: "[[Sarah Chen]]"
created: 2025-06-15
updated: 2026-01-02
tags:
  - project-management
  - roadmap
  - milestones
---
# [[Artemis Rocket]] - [[Project Roadmap]]

## [[Overview]]

The Artemis Program is developing a small [[Launch]] vehicle capable of delivering 250kg to low Earth orbit. [[This]] roadmap tracks our 18-[[Month]] development [[Timeline]] from concept to [[First]] flight.

**Mission**: [[Provide]] affordable, reliable access to space for small satellite operators.

**[[Key Specs]]**:
- Payload capacity: 250kg to LEO (500km circular orbit)
- [[Target]] orbit: Sun-synchronous, polar
- Launch cadence: 12 flights per year at [[Full]] operations
- Cost target: <$5M per launch

## Current Phase

**Phase 2: Critical Design** (Month 8 of 18)
- [[Preliminary Design Review]] completed December 2025
- [[Critical Design Review]] scheduled March 2026
- First flight target: December 2026
- Current burn rate: On budget

## Key Milestones

| Milestone | Target Date | Status | Owner | Notes |
|-----------|-------------|--------|-------|-------|
| Concept Review | 2025-06-15 | ✅ Complete | [[Sarah Chen]] | [[Phase 1 Milestones]] |
| [[Preliminary Design Review]] | 2025-12-18 | ✅ Complete | [[Sarah Chen]] | [[2025-12-18 PDR Review]] |
| Engine Hot Fire #1 | 2026-01-08 | 🔄 In Progress | [[Marcus Johnson]] | 3 tests complete |
| Engine Hot Fire #2 | 2026-01-15 | ⏳ Planned | [[Marcus Johnson]] | Full duration burn |
| [[Critical Design Review]] | 2026-03-10 | ⏳ Planned | [[Sarah Chen]] | Go/no-go for fabrication |
| First Stage Assembly | 2026-06-01 | ⏳ Planned | [[James Park]] | Structures complete |
| Avionics Integration | 2026-07-15 | ⏳ Planned | [[Elena Rodriguez]] | [[Avionics Integration Test]] |
| Propulsion Integration | 2026-08-01 | ⏳ Planned | [[Marcus Johnson]] | Mating engine to airframe |
| Vehicle Integration | 2026-09-15 | ⏳ Planned | Team | Full stack assembly |
| Static Fire Test | 2026-10-15 | ⏳ Planned | Team | Fully integrated test |
| Flight Readiness Review | 2026-11-15 | ⏳ Planned | [[Sarah Chen]] | Final go/no-go |
| First Flight | 2026-12-15 | ⏳ Planned | Team | Orbital insertion attempt |

## System Status

| System | Lead | Status | Phase | Next Milestone | Risk Level |
|--------|------|--------|-------|----------------|------------|
| [[Propulsion System]] | [[Marcus Johnson]] | 🟡 Testing | Hot fire campaign | Full duration burn (Jan 15) | MEDIUM |
| [[Avionics System]] | [[Elena Rodriguez]] | 🟢 On Track | Integration | Flight computer delivery (Jan 20) | LOW |
| [[Structures System]] | [[James Park]] | 🟢 On Track | Fabrication | Airframe sections complete (Feb 1) | LOW |
| [[GNC System]] | [[Elena Rodriguez]] | 🟡 At Risk | Algorithm dev | Landing algorithm validation (Jan 30) | MEDIUM |

### Propulsion System Details
- Engine: [[Engine Design]] - Gas generator cycle, LOX/RP-1
- Current: [[Engine Hot Fire Results]] - 3 successful tests
- Risk: [[Turbopump]] delivery delay (see [[Risk Register]] R-003)
- Decision: [[ADR-001 Propellant Selection]] - LOX/RP-1 selected
- Testing: [[Test Campaign Overview]]

### Avionics System Details
- Architecture: [[Avionics System]] - Triple redundant flight computer
- Components: [[Flight Computer]], [[Sensor Suite]], [[Communications]]
- Decision: [[ADR-002 Flight Computer]] - Triple redundancy approved
- Integration: [[Avionics Integration Test]] scheduled July 2026
- Status: On schedule, all components in procurement

### Structures System Details
- Design: [[Structures System]] - Carbon fiber airframe
- Components: [[Airframe Design]], [[Stage Separation]], [[Fairing Design]]
- Material: [[Material Selection]] - Carbon fiber composite
- Landing: [[Landing System]] - Propulsive landing gear
- Status: Fabrication started, tooling complete

### GNC System Details
- Architecture: [[GNC System]] - Hybrid guidance with AI-assisted landing
- Components: [[IMU Selection]], [[Autopilot Software]], [[Landing Algorithm]]
- Challenge: [[Trajectory Optimization]] for landing phase
- Risk: Algorithm validation timeline tight
- Decision: [[ADR-003 Landing Strategy]] - Propulsive landing approved

## Active Risks

See [[Risk Register]] for full analysis. Top 5 risks by impact:

1. **R-003: Turbopump Delivery Delay**
   - Impact: HIGH | Probability: MEDIUM
   - Could delay hot fire campaign by 4-6 weeks
   - Owner: [[Marcus Johnson]]
   - Mitigation: Dual sourcing in progress

2. **R-007: Flight Software Schedule**
   - Impact: MEDIUM | Probability: HIGH
   - [[Flight Software]] complexity underestimated
   - Owner: [[Elena Rodriguez]]
   - Mitigation: Additional contractor support secured

3. **R-012: Test Facility Availability**
   - Impact: MEDIUM | Probability: MEDIUM
   - [[Test Campaign Overview]] conflicts with other programs
   - Owner: [[Sarah Chen]]
   - Mitigation: Reserve backup dates, secondary facility identified

4. **R-015: Fairing Separation**
   - Impact: HIGH | Probability: LOW
   - [[Fairing Design]] pyrotechnic system single point failure
   - Owner: [[James Park]]
   - Mitigation: [[ADR-004 Test Campaign]] includes separation tests

5. **R-019: Funding Runway**
   - Impact: HIGH | Probability: LOW
   - Budget assumes no major delays
   - Owner: [[Sarah Chen]]
   - Mitigation: Series A extension discussions ongoing

## Recent Decisions

- [[ADR-001 Propellant Selection]]: Selected LOX/RP-1 over pressure-fed (2025-08-20)
- [[ADR-002 Flight Computer]]: Triple redundancy architecture (2025-09-15)
- [[ADR-003 Landing Strategy]]: Propulsive landing vs ocean recovery (2025-11-10)
- [[ADR-004 Test Campaign]]: Incremental test approach approved (2025-12-05)
- [[ADR-005 Telemetry Protocol]]: S-band with redundant C-band (2025-12-20)

## Requirements Traceability

- [[System Requirements]] - Top-level mission requirements
- [[Performance Requirements]] - Delta-v, payload, orbit
- [[Safety Requirements]] - Range safety, flight termination
- [[Interface Requirements]] - Payload adapter, ground systems

## Budget Summary

| Category | Budget | Spent | Remaining | % Used | Status |
|----------|--------|-------|-----------|--------|--------|
| Engineering | $2.5M | $1.8M | $0.7M | 72% | 🟢 |
| [[Hardware]] | $8.0M | $4.2M | $3.8M | 53% | 🟢 |
| Testing | $1.5M | $0.6M | $0.9M | 40% | 🟢 |
| Facilities | $0.8M | $0.5M | $0.3M | 63% | 🟢 |
| Contingency | $1.2M | $0.1M | $1.1M | 8% | 🟢 |
| **[[Total]]** | **$14.0M** | **$7.2M** | **$6.8M** | **51%** | **🟢** |

[[See]] [[Budget Tracker]] for detailed breakdown.

## [[Team Organization

See]] [[Team Roster]] for [[Complete]] org chart and contact info.

**[[Leadership]]**:
- [[Chief Engineer]]: [[Sarah Chen]]
- [[Propulsion Lead]]: [[Marcus Johnson]]
- [[Avionics Lead]]: [[Elena Rodriguez]]
- [[Structures Lead]]: [[James Park]]

**[[Team Size]]**: 15 full-time + 8 contractors

**[[Key Contractors]]**:
- [[Acme Aerospace]] - [[Turbopump]] manufacturing
- [[Precision Components Inc]] - Machined parts
- See [[Supplier Directory]] for complete list

## [[Meeting Cadence]]

- **[[Daily Standup]]**: 9:00 [[AM]], 15 minutes (logged in [[daily-notes]])
- **[[Weekly Review]]**: [[Mondays 2]]:00 PM (see [[weekly-notes]])
- **[[Monthly All]]-Hands**: First [[Friday]] (see [[meetings]])
- **[[Quarterly Board Update]]**: End of quarter

[[Recent]] [[Key]] meetings:
- [[2025-12-18 PDR Review]] - PDR completion
- [[2025-12-23 Propulsion Standup]] - [[Hot]] fire planning
- [[2025-12-30 Year End Review]] - 2025 retrospective
- [[2026-01-02 Sprint Planning]] - Q1 2026 kickoff

## [[Links]] & Resources

**[[Project Management]]**:
- [[Budget Tracker]] | [[Change Log]] | [[Lessons Learned]]
- [[Project Charter]] | [[Stakeholder Map]] | [[RACI Matrix]]

**[[Technical Documentation]]**:
- [[System Requirements]] | [[Performance Requirements]]
- [[Test Campaign Overview]] | [[Upcoming Tests]]

**Team & External**:
- [[Team Roster]] | [[Onboarding Guide]]
- [[Supplier Directory]] | [[Vendor Meeting Acme Aerospace]]

**[[Decision History]]**:
- [[ADR-001 Propellant Selection]]
- [[ADR-002 Flight Computer]]
- [[ADR-003 Landing Strategy]]
- [[ADR-004 Test Campaign]]
- [[ADR-005 Telemetry Protocol]]

---

*[[Last]] [[Updated]]: 2026-01-02 by [[Sarah Chen]]*
*[[Next]] review: 2026-01-09 (Weekly review)*
