---
type: hub
status: active
owner: "[[Sarah Chen]]"
created: 2025-07-01
updated: 2026-01-02
tags:
  - risk-management
  - project-management
---
# [[Risk Register]]

## [[Overview]]

[[This]] register tracks [[All]] [[Identified]] risks to the [[Artemis Program]] across [[Technical]], schedule, and business domains. Risks [[Are]] scored [[Using]] Impact (1-5) × Probability (1-5) = [[Risk Score]].

**[[Risk Appetite]]**: Maximum acceptable score = 15 ([[High Impact]] × [[Medium Probability]])

**[[Review Cadence]]**:
- Weekly review in [[weekly-notes]]
- [[Monthly]] [[Deep]]-[[Dive]] in all-hands
- Continuous [[Monitoring]] by [[System]] leads

## [[Risk Matrix]]

| Score | Category | Count | [[Action Required]] |
|-------|----------|-------|-----------------|
| 20-25 | CRITICAL | 0 | Immediate escalation, mitigation plan within 24h |
| 15-19 | [[High]] | 2 | [[Active]] mitigation, weekly review |
| 10-14 | MEDIUM | 5 | Monitor, mitigation plan [[Documented]] |
| 5-9 | LOW | 8 | Monitor, accept or mitigate |
| 1-4 | MINIMAL | 12 | Accept, [[Quarterly]] review |

## [[Active Risks]] (Score ≥ 10)

### R-003: [[Turbopump Delivery Delay]]
**Category**: [[Supply Chain]]
**Impact**: 5 (HIGH) | **Probability**: 3 (MEDIUM) | **Score**: 15
**Owner**: [[Marcus Johnson]]
**[[Status]]**: 🔴 Active

**Description**: Primary supplier ([[Acme Aerospace]]) [[Turbopump]] delivery delayed from [[Jan 5]] to potentially [[Jan 20]], threatening [[Engine Hot Fire Results]] campaign schedule.

**[[Impact Analysis]]**:
- Delays [[Propulsion System]] [[Testing]] by 2-4 [[Weeks]]
- Cascades to [[Critical Design Review]] [[Date]] ([[March 10]])
- Jeopardizes [[December 2026]] [[First]] flight [[Target]]
- [[See]] [[Project Roadmap]] for schedule dependencies

**[[Root Cause]]**:
- Supplier [[Machine]] shop equipment failure
- [[Limited]] alternative suppliers for this specification
- Long [[Lead]] time (16 weeks) for [[Custom]] turbopumps

**[[Mitigation Strategy]]**:
1. ✅ Expedited shipping arranged (+$15K cost)
2. 🔄 Dual-sourcing evaluation with [[Precision Components Inc]]
3. 🔄 Parallel development of test stand for interim testing
4. ⏳ Negotiate contractual penalties for further delays

**Contingency Plan**:
- Use existing prototype turbopump for initial low-thrust tests
- Compress CDR schedule by 1 week if needed
- Budget impact: $40K for expediting + dual sourcing

**[[Related]]**:
- [[Engine Design]] - Turbopump specifications
- [[Turbopump]] - Technical details
- [[Vendor Meeting Acme Aerospace]] - Supplier negotiations
- [[ADR-001 Propellant Selection]] - Original selection rationale

**History**:
- 2025-12-28: [[Risk]] identified during supplier call
- 2025-12-30: Escalated to HIGH in [[2025-12-30 Year End Review]]
- 2026-01-02: Mitigation plan approved in [[2026-01-02 Sprint Planning]]

---

### R-007: [[Flight Software Schedule]]
**Category**: Technical/Schedule
**Impact**: 3 (MEDIUM) | **Probability**: 4 (HIGH) | **Score**: 12
**Owner**: [[Elena Rodriguez]]
**Status**: 🟡 Monitoring

**Description**: [[Flight Software]] development complexity underestimated. [[Current]] [[Velocity]] suggests completion in April vs March target, risking [[Critical Design Review]].

**Impact Analysis**:
- [[Autopilot Software]] [[Core]] algorithms taking longer than estimated
- [[Landing Algorithm]] requires additional [[Validation]] cycles
- [[Integration]] with [[Flight Computer]] [[Hardware]] delayed
- May delay [[Avionics Integration Test]] (July target)

**Root Cause**:
- Initial estimates assumed commercial-off-the-shelf guidance package
- [[ADR-003 Landing Strategy]] decision for propulsive landing [[Added]] [[Scope]]
- [[GNC System]] [[Requirements]] more complex than early spec
- Team [[Learning]] curve on flight-critical real-time [[Systems]]

**Mitigation [[Strategy]]**:
1. ✅ Additional contractor support secured (2 developers, starts [[Jan 6]])
2. ✅ Descoped [[Trajectory Optimization]] from v1.0 (can add post-first-flight)
3. 🔄 Daily standups with [[Elena Rodriguez]] + [[Software]] team
4. 🔄 Parallel algorithm development ([[Multiple]] approaches)

**[[Success Metrics]]**:
- [[Complete]] core autopilot: [[Jan 31]] (was [[Jan 15]])
- [[Landing Algorithm]] validation: [[Feb 28]] (was [[Feb 15]])
- Hardware-in-loop testing: [[March 15]] (was [[March 1]])
- CDR software demo: March 10 (unchanged)

**Related**:
- [[Avionics System]] - System [[Architecture]]
- [[Autopilot Software]] - Core guidance and control
- [[Landing Algorithm]] - Propulsive landing logic
- [[GNC System]] - Overall G&C system
- [[ADR-002 Flight Computer]] - Triple redundancy adds complexity

**History**:
- 2025-11-15: Velocity [[Concerns]] [[Raised]] by [[Elena Rodriguez]]
- 2025-12-05: Risk added to register
- 2025-12-18: Mitigation plan presented at [[Preliminary Design Review]]
- 2026-01-02: Contractor support confirmed

---

### R-012: [[Test Facility Availability]]
**Category**: Schedule/External
**Impact**: 3 (MEDIUM) | **Probability**: 3 (MEDIUM) | **Score**: 9
**Owner**: [[Sarah Chen]]
**Status**: 🟡 Monitoring

**Description**: Primary [[Test]] facility ([[Mojave Test Range]]) has scheduling conflicts with other [[Launch]] programs during our peak testing period (May-[[September 2026]]).

**Impact Analysis**:
- [[Test Campaign Overview]] assumes 12 test [[Windows]] over 5 months
- Conflicts could reduce to 8 windows, compressing schedule
- Risk to [[Avionics Integration Test]] and static fire test schedule
- See [[Upcoming Tests]] for detailed test plan

**Root Cause**:
- Facility shared with 3 other programs
- Booking windows [[Only]] 90 days in advance
- Peak season (May-Sept) has highest [[Demand]]

**Mitigation Strategy**:
1. ✅ Reserved all [[Available]] primary windows through [[March
2]]. 🔄 Identified backup facility ([[Vandenberg Test Site]])
3. 🔄 Front-load critical tests to Jan-April [[When]] facility access guaranteed
4. ⏳ Negotiate [[Priority]] access ([[Premium]] pricing)

**[[Contingency Plan]]**:
- Backup facility costs +$120K but guaranteed availability
- Some tests can be done at our own facility (limited capability)
- [[ADR-004 Test Campaign]] allows for test consolidation if needed

**Related**:
- [[Test Campaign Overview]] - Master test schedule
- [[Engine Hot Fire Results]] - Propulsion testing
- [[Upcoming Tests]] - Near-term test plan

**History**:
- 2025-10-20: Initial concern raised during test planning
- 2025-11-30: Backup facility identified
- 2025-12-15: Risk formalized in register

---

### R-015: Fairing Separation
**Category**: Technical
**Impact**: 5 (HIGH) | **Probability**: 2 (LOW) | **Score**: 10
**Owner**: [[James Park]]
**Status**: 🟢 Mitigated

**Description**: [[Fairing Design]] uses pyrotechnic separation system which is a single point failure mode. If fairing fails to separate, payload cannot be deployed.

**Impact Analysis**:
- Mission failure if fairing doesn't separate
- [[Structures System]] design has no redundancy for this mechanism
- Industry standard but still represents mission-critical risk
- Customer confidence issue if not thoroughly demonstrated

**Root Cause**:
- Design constraint: mass budget doesn't allow redundant system
- Pyrotechnics are standard but inherently single-use/single-test
- Cannot fully test actual flight units (destructive test)

**Mitigation Strategy**:
1. ✅ [[ADR-004 Test Campaign]] includes 5 separation tests with flight-like units
2. ✅ Using flight-proven pyrotechnic components (heritage from other programs)
3. ✅ Triple redundancy on electrical firing circuits
4. 🔄 Qual testing at 2x expected loads

**Test Plan**:
- Structural separation test: Feb 2026
- Pyro circuit validation: March 2026
- Full fairing ejection test: April 2026
- Vibration qualification: May 2026
- Final flight-readiness demo: October 2026

**Related**:
- [[Fairing Design]] - Technical design
- [[Stage Separation]] - Separation mechanisms
- [[Structures System]] - Overall structural design
- [[Safety Requirements]] - Mission success criteria

**History**:
- 2025-08-10: Identified during design review
- 2025-09-01: Mitigation plan approved
- 2025-12-05: Test campaign detailed in [[ADR-004 Test Campaign]]

---

### R-019: Funding Runway
**Category**: Business/Financial
**Impact**: 5 (HIGH) | **Probability**: 2 (LOW) | **Score**: 10
**Owner**: [[Sarah Chen]]
**Status**: 🟢 Monitored

**Description**: Current funding ($14M Series A) sufficient for first flight only if schedule maintains. Any delays >2 months risk running out of capital before flight.

**Impact Analysis**:
- Current burn [[Rate]]: $1.2M/month
- Runway through December 2026 (first flight month)
- Schedule delays consume contingency buffer
- See [[Budget Tracker]] for detailed financial model

**Sensitivity Analysis**:
- 1 month delay = consume $600K from $1.2M contingency
- 2 month delay = consume all contingency + $200K overrun
- 3 [[Month]] delay = require additional capital raise

**Root Cause**:
- Lean [[Startup]] model - optimizing for capital efficiency
- Series A sized for first flight demonstration
- Series B [[Planned]] for post-flight (manufacturing scale-up)
- [[Market]] conditions for space [[Tech]] funding volatile

**Mitigation Strategy**:
1. ✅ Monthly burn rate reviews in all-hands meetings
2. ✅ Series A [[Extension]] discussions started ([[Dec 2025]])
3. 🔄 Contingency budget actively [[Managed]]
4. 🔄 Lead investor committed to $2M bridge if needed

**Contingency Plan**:
- Reduce headcount if delays >1 month (defer post-flight hires)
- Descope non-critical testing (save ~$300K)
- Bridge financing available from lead investor
- [[Strategic]] partner discussions for co-funding

**Related**:
- [[Budget Tracker]] - [[Financial]] details
- [[Stakeholder Map]] - Investor [[Relationships]]
- [[Project Charter]] - Business model
- [[Change Log]] - Scope changes affecting budget

**History**:
- 2025-07-01: Risk identified at program inception
- 2025-11-15: Bridge financing option secured
- 2025-12-30: Reviewed in [[2025-12-30 Year End Review]]

---

## [[Medium Risks]] ([[Score 6]]-9)

### R-002: IMU [[Supplier Quality]]
**Impact**: 2 | **Probability**: 3 | **Score**: 6
**Owner**: [[Elena Rodriguez]]

[[IMU Selection]] - Backup IMU identified from alternate supplier. Qualification testing in progress. Related: [[Sensor Suite]].

### R-008: [[Material Certification Delays]]
**Impact**: 3 | **Probability**: 2 | **Score**: 6
**Owner**: [[James Park]]

[[Material Selection]] - [[Carbon]] [[Fiber]] composite certification taking longer than expected. May delay [[Airframe Design]] fabrication start by 2 weeks.

### R-011: [[Range Safety Approval]]
**Impact**: 3 | **Probability**: 3 | **Score**: 9
**Owner**: [[Sarah Chen]]

[[Safety Requirements]] - Launch range [[Safety]] [[Approval]] process complex. Early [[Engagement]] with range safety officer. Flight termination system [[Design]] in [[ADR-004 Test Campaign]].

### R-018: [[Communications Bandwidth]]
**Impact**: 2 | **Probability**: 3 | **Score**: 6
**Owner**: [[Elena Rodriguez]]

[[Communications]] and [[Telemetry]] - S-band [[Link]] budget tight during max-Q. Added [[Redundant]] C-band per [[ADR-005 Telemetry Protocol]].

### R-021: [[Landing Gear Complexity]]
**Impact**: 3 | **Probability**: 2 | **Score**: 6
**Owner**: [[James Park]]

[[Landing System]] - Propulsive landing gear more complex than initially estimated. Design review [[Scheduled]] Jan 15. Related to [[ADR-003 Landing Strategy]].

## [[Low Risks]] (Score ≤ 5)

_(12 risks - summarized for brevity)_

- R-001: Power system redundancy
- R-004: Sensor calibration
- R-005: [[Ground]] support equipment
- R-006: Weather delays
- R-009: Thermal protection
- R-010: Vibration loads
- R-013: Team retention
- R-014: [[Documentation]] completeness
- R-016: Third-party payload interfaces
- R-017: Environmental [[Compliance]]
- R-020: [[Insurance]] [[Coverage]]
- R-022: Intellectual property

See [[Full]] details in risk [[Database]].

## [[Retired Risks]]

### R-000: [[Propellant Selection]] (CLOSED)
**Closed**: 2025-08-20
**Resolution**: [[ADR-001 Propellant Selection]] - Selected LOX/RP-1. Risk mitigated through decision.

## [[Risk Trends]]

**[[Overall Risk Posture]]**: 🟢 HEALTHY

- [[Total]] active risks: 27
- [[Trending]] down: 8 risks
- Trending up: 2 risks (R-003, R-007)
- [[Stable]]: 17 risks

**[[Monthly Risk Review]]**: See [[weekly-notes]] and [[monthly-notes]] for [[Historical]] [[Trends]].

## [[Related Documents]]

- [[Project Roadmap]] - Schedule and milestone dependencies
- [[Budget Tracker]] - Financial risk impacts
- [[Team Roster]] - Risk ownership assignments
- [[Change Log]] - Risk-[[Driven]] changes
- [[Lessons Learned]] - Risk retrospectives

**[[Decision Records]]**:
- [[ADR-001 Propellant Selection]]
- [[ADR-002 Flight Computer]]
- [[ADR-003 Landing Strategy]]
- [[ADR-004 Test Campaign]]
- [[ADR-005 Telemetry Protocol]]

**[[System Documentation]]**:
- [[System Requirements]] - Requirements at risk
- [[Safety Requirements]] - Safety-related risks
- [[Test Campaign Overview]] - Testing risks

---

*[[Last]] [[Updated]]: 2026-01-02 by [[Sarah Chen]]*
*[[Next]] review: 2026-01-06 (Weekly standup)*
