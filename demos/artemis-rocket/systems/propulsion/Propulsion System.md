---
type: subsystem
status: testing
owner: "[[Marcus Johnson]]"
phase: hot-fire-campaign
created: 2025-06-20
updated: 2026-01-02
tags:
  - propulsion
  - engine
  - testing
---
# [[Propulsion System]]

## [[Overview]]

The Artemis Propulsion [[System]] is a liquid-fueled rocket [[Engine]] designed to deliver 250kg payloads to low Earth orbit. The system uses a gas generator cycle burning LOX/RP-1 propellants.

**[[System Lead]]**: [[Marcus Johnson]]
**[[Team Size]]**: 6 (4 engineers + 2 technicians)
**[[Status]]**: 🟡 [[Testing Phase]] - [[Hot Fire Campaign]] underway

## [[Key Specifications]]

| Parameter | [[Target]] | [[Current Status]] |
|-----------|--------|----------------|
| Thrust (sea level) | 45 kN | 44.2 kN ✅ |
| [[Specific Impulse]] | 290s | 287s 🟡 |
| [[Chamber Pressure]] | 8.5 MPa | 8.2 MPa ✅ |
| [[Mixture Ratio]] (O/F) | 2.4:1 | 2.38:1 ✅ |
| [[Mass Flow Rate]] | 15.8 kg/s | 15.6 kg/s ✅ |
| [[Throttle Range]] | 50-100% | [[Validated]] to 60-100% 🟡 |
| [[Burn Time]] (mission) | 240s | [[Testing]] up to 180s 🔄 |

## [[System Architecture]]

```
┌─────────────────────────────────────────┐
│           Propulsion System              │
├─────────────────────────────────────────┤
│                                          │
│  [[Fuel Tanks]] (RP-1)                  │
│       ↓                                  │
│  [[Turbopump]] → [[Engine Design]]      │
│       ↑                                  │
│  [[Oxidizer System]] (LOX)              │
│                                          │
│  [[Engine Controller]] → [[Thrust Vector Control]]
│                                          │
│  [[Cooling System]] (Regenerative)      │
│  [[Ignition Sequence]]                  │
│                                          │
└─────────────────────────────────────────┘
```

## [[Major Components]]

### [[Engine Core]]
- [[Engine Design]] - Gas generator cycle main engine
- [[Combustion Chamber]] - Regeneratively cooled chamber (MISSING - intentional broken [[Link]])
- [[Cooling System]] - RP-1 regenerative cooling
- [[Ignition Sequence]] - Pyrotechnic igniter system

### [[Feed System]]
- [[Fuel Tanks]] - RP-1 storage and pressurization
- [[Oxidizer System]] - LOX tanks and feed lines
- [[Turbopump]] - Single-shaft [[Turbopump]] assembly
- Plumbing & Valves - Propellant feed and control

### [[Control Systems]]
- [[Engine Controller]] - Digital engine control unit
- [[Thrust Vector Control]] - Electromechanical TVC (±5°)
- Sensors & Instrumentation - Pressure, temperature, flow

## [[Current]] Status

### Testing [[Phase]]: [[Hot]] Fire Campaign

**[[Campaign Goal]]**: Validate engine [[Performance]] from ignition through [[Full]] mission duration (240s)

**Progress**:
- ✅ [[Test 1]] ([[Dec 28]]): 30s burn - [[Ignition Sequence]] [[Validation]]
- ✅ [[Test 2]] ([[Dec 30]]): 60s burn - Thermal stability check
- ✅ [[Test 3]] ([[Jan 2]]): 120s burn - [[Extended Duration]] performance
- 🔄 [[Test 4]] ([[Jan 8]]): 180s burn - Approaching mission duration
- ⏳ [[Test 5]] ([[Jan 15]]): 240s burn - Full duration qualification

[[See]] [[Engine Hot Fire Results]] for detailed [[Test]] [[Data]].

### [[Active Issues]]

**[[Medium Priority]]:**
1. **[[Turbopump Delivery Delay]]** (See [[Risk Register]] R-003)
   - Primary supplier ([[Acme Aerospace]]) delayed from [[Jan 5]] → [[Jan 20]]
   - [[Using]] [[Prototype]] unit for [[Tests 1]]-3
   - Flight unit needed for Test 4+
   - Mitigation: Expedited shipping, dual-sourcing evaluation

2. **[[ISP Performance]] Gap**
   - Target: 290s | Current: 287s (1% below target)
   - Likely cause: Mixture ratio [[Optimization]] needed
   - Plan: Adjust O/F ratio in Test 4
   - Impact: Minimal - within margin

3. **[[Throttling Range]]**
   - Target: 50-100% | Validated: 60-100%
   - [[Deep]] throttle (50-60%) testing delayed
   - Schedule: Post-CDR ([[Not]] mission-critical)

**[[LOW Priority]]:**
4. Instrumentation noise on chamber pressure sensor
5. TVC actuator backlash (within spec [[But]] higher than expected)

## [[Design Decisions]]

### [[ADR-001 Propellant Selection]]
**Decision**: LOX/RP-1 (liquid oxygen / rocket-[[Grade]] kerosene)
**[[Date]]**: 2025-08-20
**Rationale**:
- Flight-proven propellant combination
- [[Good]] ISP (290s) with [[High]] density
- Non-toxic, easier [[Ground]] [[Handling]] than hypergolics
- Lower cost than LH2/LOX cryogenic system

**[[Alternatives Considered]]**:
- Pressure-fed NTO/MMH (rejected: toxicity, lower ISP)
- LOX/LH2 (rejected: complexity, cost, tank volume)
- [[Hybrid]] (rejected: performance variability)

### [[Engine Cycle Selection]]
**Decision**: Gas generator cycle
**Rationale**:
- [[Simpler]] than staged combustion
- Flight-proven [[Design]] approach
- Adequate performance for mission (ISP ~290s)
- Lower development [[Risk]] vs expander or full-flow

## [[Integration Status]]

### With Other [[Systems]]

[[Avionics System]]:
- [[Engine Controller]] interfaces with [[Flight Computer]]
- [[Telemetry]]: Chamber pressure, TVC position, valve states
- Commands: Start sequence, throttle, shutdown, TVC gimbal
- Interface: CAN bus, 1kHz update [[Rate]]

[[Structures System]]:
- Engine mounts to [[Airframe Design]] thrust structure
- [[Thrust Vector Control]] gimbal envelope: ±5° cone
- Propellant lines route through [[Stage Separation]] interface
- Thermal protection for airframe from engine plume

[[GNC System]]:
- TVC provides pitch/yaw control authority
- [[Autopilot Software]] commands TVC for trajectory control
- Engine throttle provides thrust magnitude control
- [[Startup]] transient [[Coordinated]] with [[Flight Software]]

## [[Test Campaign]]

### [[Completed Tests
See]] [[Engine Hot Fire Results]] for full data.

**Test 1** (2025-12-28): [[Ignition Validation]]
- Duration: 30s
- Objectives: [[Ignition Sequence]] [[Reliability]], startup transient
- Result: ✅ Nominal ignition, smooth startup

**Test 2** (2025-12-30): [[Thermal Soak]]
- Duration: 60s
- Objectives: [[Cooling System]] performance, thermal equilibrium
- Result: ✅ Temperatures [[Stable]], regenerative cooling effective

**Test 3** (2026-01-02): Extended Duration
- Duration: 120s
- Objectives: Performance stability, vibration environment
- Result: ✅ Steady-state performance validated

### [[Upcoming Tests
See]] [[Upcoming Tests]] for schedule.

**Test 4** (2026-01-08): Mission-[[Like Duration]]
- Duration: 180s
- Objectives: Approaching mission duration, mixture ratio optimization
- Flight turbopump [[Required]] ([[Turbopump]] delivery critical path)

**Test 5** (2026-01-15): [[Full Qualification]]
- Duration: 240s
- Objectives: Full mission duration, qualification for flight
- Success [[Criteria]]: [[All]] parameters nominal for 240s continuous burn

### [[Test Infrastructure]]
- Test stand: [[Mojave Test Range]] (primary)
- Backup: [[Vandenberg Test Site]] (see [[Risk Register]] R-012)
- Data acquisition: 100+ channels, 1kHz sampling
- [[Safety]]: [[Remote]] control, [[Automated]] abort sequences

## [[Requirements Traceability]]

### [[System Requirements]]
- SR-001: Deliver 250kg to 500km LEO ✅
- SR-002: Reusable [[Engine Design]] (10 flights) 🔄 Not yet validated
- SR-003: [[Launch]] [[Window]] ±30 minutes ✅

### [[Performance Requirements]]
- [[PR]]-001: Thrust ≥ 45kN (sea level) ✅ 44.2kN demonstrated
- PR-002: ISP ≥ 285s (vacuum) ✅ 287s current (289s [[Projected]])
- PR-003: Burn time ≥ 240s 🔄 In test - 120s validated
- PR-004: Throttle range 50-100% 🟡 60-100% validated

### [[Safety Requirements]]
- SAF-001: Dual barrier propellant isolation ✅
- SAF-002: Engine shutdown < 200ms ✅ Demonstrated at 150ms
- SAF-003: TVC failure [[Safe]] [[Mode]] ✅ Direct mode [[Implemented]]

## Team

**[[Lead]]**: [[Marcus Johnson]]
- Propulsion system [[Architect]]
- Test campaign [[Director]]
- Risk owner: R-003 (turbopump delay)

**Engineers**:
- [[David Kim]] - Engine design, [[Combustion Chamber]]
- [[Rachel Martinez]] - Feed systems ([[Fuel Tanks]], [[Oxidizer System]])
- [[Alex Thompson]] - Thermal ([[Cooling System]])
- [[Sarah Patel]] - [[Controls]] ([[Engine Controller]], [[Thrust Vector Control]])

**[[Test Engineers]]**:
- [[Tom Wilson]] - Test conductor
- [[Jennifer Lee]] - Data acquisition

See [[Team Roster]] for full team details.

## Schedule & Milestones

| Milestone | Date | Status |
|-----------|------|--------|
| [[Preliminary Design Review]] | 2025-12-18 | ✅ [[Complete]] |
| [[Hot Fire Test]] #3 (120s) | 2026-01-02 | ✅ Complete |
| [[Turbopump]] delivery (flight unit) | 2026-01-08 | 🔄 Delayed from Jan 5 |
| Hot Fire Test #4 (180s) | 2026-01-08 | ⏳ [[Planned]] |
| Hot Fire Test #5 (240s) | 2026-01-15 | ⏳ Planned |
| [[Critical Design Review]] | 2026-03-10 | ⏳ Planned |
| Engine delivery to [[Integration]] | 2026-08-01 | ⏳ Planned |

See [[Project Roadmap]] for overall program schedule.

## [[Risks

See]] [[Risk Register]] for complete risk analysis.

**[[High Priority]]**:
- R-003: [[Turbopump]] delivery delay (Score: 15)

**[[MEDIUM Priority]]**:
- ISP [[Performance Gap]] (not yet registered - [[Monitoring]])
- [[Test Facility Availability]] (R-012, Score: 9)

**Mitigated**:
- [[Propellant Selection]] risk (closed [[Via]] [[ADR-001 Propellant Selection]])

## Budget

**[[Propulsion System Budget]]**: $3.2M (of $14M [[Total]])

| Category | Budget | Spent | Remaining |
|----------|--------|-------|-----------|
| [[Engine Development]] | $1.5M | $0.9M | $0.6M |
| Turbopump (supplier) | $0.8M | $0.6M | $0.2M |
| Testing | $0.7M | $0.3M | $0.4M |
| Hardware (misc) | $0.2M | $0.1M | $0.1M |

See [[Budget Tracker]] for program-level budget.

## [[Documentation]]

**[[Design Documentation]]**:
- [[Engine Design]] - Detailed engine design
- [[Propellant Selection]] - Propellant trade study
- Component specs: [[Turbopump]], [[Fuel Tanks]], [[Oxidizer System]]
- Control systems: [[Engine Controller]], [[Thrust Vector Control]]

**[[Test Documentation]]**:
- [[Test Campaign Overview]] - Overall test [[Strategy]]
- [[Engine Hot Fire Results]] - Test data and analysis
- [[Upcoming Tests]] - Future [[Test Planning]]

**Decisions**:
- [[ADR-001 Propellant Selection]]
- [[ADR-004 Test Campaign]]

**[[Project Management]]**:
- [[Project Roadmap]]
- [[Risk Register]]
- [[Team Roster]]

## [[Meeting Notes

Recent]] discussions:
- [[2025-12-23 Propulsion Standup]] - Test 2 planning
- [[2025-12-30 Year End Review]] - Turbopump risk escalation
- [[2026-01-02 Sprint Planning]] - Q1 test campaign
- [[Vendor Meeting Acme Aerospace]] - Supplier negotiations

---

*[[Last]] [[Updated]]: 2026-01-02 by [[Marcus Johnson]]*
*[[Next]] review: Daily standups, weekly [[Project Roadmap]] review*
