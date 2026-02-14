---
type: test-plan
status: draft
created: 2025-12-20
updated: 2026-01-02
owner: "[[Sarah Chen]]"
tags:
  - test
  - planning
  - draft
---
# [[Upcoming Tests]] - [[Draft Planning]]

## [[Overview]]

[[This]] document tracks upcoming [[Test]] activities for the [[Artemis Program]] as we progress from [[Subsystem Validation]] to [[Integrated Vehicle Testing]] and [[Flight Readiness]].

**[[Status]]**: 🔄 Draft - Under development
**[[Last Updated]]**: [[January 2]], 2026

## [[Test 4]]: [[Restart Test]] ([[Next]] - [[Jan 15]], 2026)

**Objective**: Validate [[Engine]] cold restart capability for [[Propulsive landing]] [[Scenario]]

**[[Test Configuration]]**:
- Initial burn: 30s (establish baseline)
- Coast [[Phase]]: 5 minutes (engine cold, propellants settle)
- Ullage burn: 2s GN2 thruster (settle propellants)
- Restart: Cold start ignition
- [[Second Burn]]: 20s (landing [[Burn Duration]])

**[[Success Criteria]]**:
- Clean restart ((1s [[Ignition Delay]])
- [[Stable]] combustion on second burn
- Thrust/ISP within 5% of initial burn
- No cavitation or [[Turbopump]] issues

**Risks**:
- [[LOX Boiloff]] during coast (2-5% loss expected)
- Turbopump cold restart (longer spin-up time)
- [[Propellant Ullage]] [[Management]]

**[[Preparation Status]]**:
- Test stand booking: ✅ Confirmed
- Propellants ordered: ⏳ [[Delivery Jan]] 12
- Instrumentation: 🔄 [[Adding 4]] ullage [[Pressure Sensors]]
- Procedure: 🔄 Finalize by [[Jan 8]]

**[[Action Items]]**:
- [[Marcus Johnson]]: Finalize procedure document (Jan 8)
- [[David Kim]]: Coordinate [[Test Facility]] ([[Jan 5]])
- Marcus Johnson: Order extra LOX for boiloff margin ([[Jan 6]])

## Integrated Vehicle [[Testing]] (Feb-[[May 2026]])

### [[Mechanical Integration Tests]]

**[[Timeline]]**: [[February 2026]]

**[[Tests Planned]]**:
1. **Engine/[[Airframe Mating Test]]**
   - Verify thrust structure interface
   - Check [[Alignment]] (engine gimbal travel)
   - Validate load paths
   - Test [[TVC]] actuator installation

2. **[[Landing Leg Deployment Test]]**
   - Verify pneumatic deployment mechanism
   - Check leg lock [[Engagement]]
   - Test crush [[Core]] shock absorbers
   - Validate [[Ground]] [[Clearance]]

3. **[[Stage Separation Test]]**
   - Pyrotechnic [[Separation]] mechanism
   - Verify clean separation (no re-contact)
   - Check debris trajectory

4. **[[Mass Properties Measurement]]**
   - Center of gravity (empty, fueled)
   - Moments of inertia
   - Propellant slosh dynamics

**Status**: ⏳ Awaiting structures completion (Jan 15)

### [[Electrical Integration Tests]]

**Timeline**: [[March 2026]]

**Tests [[Planned]]**:
1. **[[Integrated Avionics Test]]**
   - [[Full]] electrical harness checkout
   - [[CAN Bus]] end-to-end [[Validation]]
   - Ground station [[Communication]]
   - [[Power Distribution]] under load

2. **[[Sensor Calibration]]**
   - [[IMU]] alignment to vehicle axes
   - Pressure sensor zeroing
   - Thermocouple calibration
   - [[GPS]] antenna [[Verification]]

3. **[[Pyrotechnic Circuit Test]]**
   - Continuity [[Checks]] (no fire)
   - Firing circuit validation (dummy squibs)
   - [[Redundancy]] verification

4. **[[Telemetry Range Test]]**
   - Transmitter/receiver [[Link]] testing
   - [[Frequency]] hopping validation
   - Encryption end-to-end
   - [[Multi]]-station handoff

**Status**: ⏳ Awaiting avionics [[Integration]] ([[Feb 2026]])

### [[Propulsion Integration Tests]]

**Timeline**: [[April 2026]]

**Tests Planned**:
1. **[[Integrated Propulsion Test]]**
   - Full vehicle on test stand
   - Propellant [[Loading]] procedures
   - [[Engine Controller]] + [[Flight Computer]] integration
   - TVC gimbal under thrust

2. **[[Propellant Loading Rehearsal]]**
   - Loading procedures timeline
   - [[Safety]] protocols
   - Emergency drain procedures
   - Leak checks

3. **[[Engine Gimbal Calibration]]**
   - TVC actuator range of motion
   - Thrust vector alignment
   - [[Control Loop]] tuning (flight computer → actuators)

**Status**: ⏳ [[Awaiting Test]] 4 completion (Jan 15)

## [[Environmental Testing]] (Jun-[[Aug 2026]])

### [[Vibration Testing]]

**Timeline**: [[June 2026]]

**Test Facility**: Commercial vibration lab (booked)

**[[Test Profile]]**:
- [[Launch]] vibration: 0-2000 Hz, 10g peak
- Steady-state: 30s per axis (3 axes)
- [[Random]] vibration: 120s per axis
- Shock: Pyro separation simulation

**Instrumentation**:
- 50+ accelerometers (airframe, [[Components]])
- Strain gauges (critical joints)
- [[High]]-speed [[Video]] (failure [[Detection]])

**Success [[Criteria]]**:
- No structural damage
- [[All]] fasteners retain preload
- Electrical connections intact
- Components function post-test

**Status**: ⏳ Test facility booked for [[Jun 15]]-20

### [[Thermal Vacuum Testing]]

**Timeline**: [[July 2026]]

**Test Facility**: University thermal vacuum chamber (booked)

**[[Test Conditions]]**:
- Vacuum: <10^-6 torr
- Temperature: -40°C to +85°C
- Duration: 48 hours (4 thermal cycles)

**Systems Under Test**:
- Avionics thermal performance
- Battery performance (cold/hot)
- Propellant tank insulation
- Component survival

**Success Criteria**:
- All electronics functional throughout
- Battery capacity )80% at -40°C
- Propellant tanks hold vacuum
- No condensation issues

**Status**: ⏳ Chamber booking confirmed Jul 10-15

### Acoustic Testing

**Timeline**: August 2026

**Test Facility**: Acoustic test facility (to be booked)

**Test Profile**:
- Sound pressure level: 140 dB (launch acoustic environment)
- Frequency range: 20-2000 Hz
- Duration: 60s

**Success Criteria**:
- No structural resonance issues
- Fairings remain sealed
- Electrical connections intact

**Status**: ⏳ Facility booking in progress

## Flight Readiness Testing (Sep-Nov 2026)

### Dress Rehearsal

**Timeline**: September 2026

**Objective**: Full launch countdown simulation (wet dress rehearsal)

**Activities**:
- Vehicle transport to launch site
- Vertical integration on pad
- Propellant loading (full)
- Countdown to T-10s (abort before ignition)
- Emergency safing procedures
- Post-test inspection

**Success Criteria**:
- Countdown completes without holds
- All systems nominal
- Propellant loading within timeline
- Emergency procedures validated

**Status**: ⏳ Launch site coordination needed

### Flight Readiness Review (FRR)

**Timeline**: October 2026

**Objective**: Final go/no-go decision for first flight

**Review Scope**:
- All test results (component → integrated → environmental)
- Risk assessment (all risks closed or accepted)
- Safety analysis (hazard reports, range safety)
- Flight plan approval
- Weather constraints
- Abort scenarios

**Attendees**:
- Full team + external reviewers
- Safety board
- Range safety officer
- Regulators (FAA/AST waiver)

**Deliverables**:
- Test campaign summary
- Failure modes analysis
- Flight readiness certification

**Status**: ⏳ Review scheduled for Oct 15

### Range Readiness Review

**Timeline**: November 2026

**Objective**: Validate launch range infrastructure ready for flight

**Review Scope**:
- Ground support equipment
- Telemetry ground stations (3 stations)
- Flight termination system
- Range safety systems
- Emergency response procedures

**Status**: ⏳ Pending launch site selection

## First Flight (Dec 2026)

### Flight Profile

**Mission**: Suborbital demonstration flight

**Timeline**:
- T-0: Liftoff
- T+30s: Max-Q (maximum dynamic pressure)
- T+60s: MECO (main engine cutoff) at 25 km altitude
- T+90s: Apogee at 80 km altitude
- T+150s: Re-entry (50 km altitude)
- T+180s: Landing burn ignition (2 km altitude)
- T+200s: Touchdown

**Success Criteria**:
- Clean liftoff (no pad damage)
- Stable ascent (attitude within ±5°)
- Apogee within ±500m of target
- Engine restart successful
- Landing within ±500m of target
- Vehicle recoverable (minimal damage)

**Risks**:
- Engine failure during ascent (abort scenario)
- Re-entry heating (thermal protection)
- Landing burn failure (hard landing)
- GPS loss (navigation degradation)

**Status**: ⏳ Awaiting FRR approval

### Backup Flight Dates

**Primary**: December 15, 2026
**Backup 1**: December 18, 2026
**Backup 2**: December 22, 2026

Weather constraints:
- Wind: (15 m/s surface, <30 m/s aloft
- Precipitation: None within 50 km
- Visibility: )5 km
- Cloud ceiling: >3000m

## [[Test Budget Tracking]]

| Phase | Budgeted | Spent | Remaining | Status |
|-------|----------|-------|-----------|--------|
| [[Component Testing]] | $150K | $145K | $5K | ✅ Complete |
| Subsystem testing | $200K | $180K | $20K | 🔄 [[In Progress]] |
| [[Hot Fire Testing]] | $200K | $120K | $80K | 🔄 3/4 complete |
| Integrated testing | $100K | $0 | $100K | ⏳ Pending |
| Environmental testing | $100K | $0 | $100K | ⏳ Pending |
| Flight readiness | $50K | $0 | $50K | ⏳ Pending |
| **[[Total]]** | **$800K** | **$520K** | **$280K** | 🟢 [[On Budget]] |

## [[Schedule Health]]

| Milestone | Planned | Forecast | Status |
|-----------|---------|----------|--------|
| Test 4 (restart) | Jan 15 | Jan 15 | 🟢 [[On Schedule]] |
| Integrated testing | [[Feb 1]] | Feb 1 | 🟢 On Schedule |
| Environmental testing | [[Jun 1]] | Jun 1 | 🟢 On Schedule |
| [[Flight Readiness Review]] | [[Oct 15]] | Oct 15 | 🟢 On Schedule |
| [[First]] flight | [[Dec 15]] | [[Dec]] 15 | 🟢 On Schedule |

**Overall**: 🟢 GREEN - No [[Schedule Risks]] [[Identified]]

## [[Open Issues]]

1. **[[Launch Site Selection]]** ([[Priority]]: HIGH)
   - [[Need]] to finalize launch range agreement
   - Options: Commercial spaceport vs [[Government]] range
   - Impact: Range readiness review timeline
   - Owner: [[Sarah Chen]]
   - [[Target]]: [[Jan 31]], 2026

2. **[[Environmental Test Facilities]]** (Priority: MEDIUM)
   - Vibration facility booked ✅
   - Thermal vacuum booked ✅
   - Acoustic facility TBD ⏳
   - Owner: [[James Park]]
   - Target: [[Feb 15]], 2026

3. **[[Flight Termination System]]** (Priority: HIGH)
   - [[Required]] by range safety
   - [[Design]]: Explosive cord vs thrust termination
   - Certification: [[Must]] be tested before FRR
   - Owner: [[Elena Rodriguez]]
   - Target: [[Mar 1]], 2026

4. **FAA/AST [[Launch License]]** (Priority: HIGH)
   - Application: Feb 2026
   - Review period: 6 months (typical)
   - Must be approved before first flight
   - Owner: Sarah Chen
   - Target: [[Application Feb]] 1

## [[Notes]]

- This document is a [[Working]] draft and [[Updated]] as [[Test Planning]] progresses
- Test dates subject to change [[Based]] on [[Hardware]] readiness
- Budget assumes no major test failures requiring retests
- Schedule has 2-week contingency buffer [[Built]] into [[Each]] phase

## [[Next Actions]]

1. [[Complete Test]] 4 (Jan 15)
2. Finalize integrated [[Test Plan]] (Jan 31)
3. Book acoustic test facility (Feb 15)
4. Submit FAA/AST application (Feb 1)
5. Select launch [[Site]] (Jan 31)

---

*Draft test plan - [[Not]] for distribution*
*[[Contact Sarah Chen]] with questions*
