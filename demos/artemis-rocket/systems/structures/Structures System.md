---
type: subsystem
status: on-track
owner: "[[James Park]]"
phase: fabrication
created: 2025-07-20
updated: 2026-01-02
tags:
  - structures
  - airframe
  - composites
---
# [[Structures System]]

## [[Overview]]

The Artemis Structures [[System]] provides the primary load-bearing airframe, [[Stage Separation]] mechanisms, payload fairing, and [[Landing System]] for the [[Launch]] vehicle. The [[Design]] uses advanced [[Carbon]] [[Fiber]] composites for [[High]] strength-to-weight ratio.

**[[System Lead]]**: [[James Park]]
**[[Team Size]]**: 7 (3 engineers + 4 [[Fabrication Technicians]])
**[[Status]]**: 🟢 [[On Track]] - Fabrication in progress

## [[Key Specifications]]

| Parameter | Specification | Status |
|-----------|---------------|--------|
| [[Airframe Material]] | Carbon fiber composite | ✅ Selected |
| [[Overall Length]] | 18 meters | ✅ Design [[Complete]] |
| Diameter | 1.3 meters | ✅ Design complete |
| [[Dry Mass]] | 1,200 kg | 🟡 1,240 kg [[Current]] estimate |
| [[Payload Capacity]] | 250 kg to LEO | ✅ Design [[Validated]] |
| [[Stage Sep Mechanism]] | Pneumatic + pyrotechnic | ✅ Design complete |
| [[Landing Legs]] | 4-leg hydraulic | 🔄 Design in progress |
| [[Safety Factor]] | 1.4 (ultimate), 1.25 (yield) | ✅ Met in analysis |

## [[System Architecture]]

```
┌─────────────────────────────────────────┐
│         Structures System                │
├─────────────────────────────────────────┤
│                                          │
│  [[Fairing Design]] (Payload Protection)│
│       ↓                                  │
│  [[Airframe Design]] (Upper Stage)      │
│       ↓                                  │
│  [[Stage Separation]] Mechanism         │
│       ↓                                  │
│  [[Airframe Design]] (Lower Stage)      │
│       ↓                                  │
│  [[Landing System]] (4 Legs)            │
│                                          │
│  [[Material Selection]] - Carbon Fiber  │
│                                          │
└─────────────────────────────────────────┘
```

## [[Major Components]]

### [[Primary Structure]]
- [[Airframe Design]] - Carbon fiber composite monocoque
- Thrust structure - [[Engine]] mount interface to [[Propulsion System]]
- Inter-tank structure - LOX and RP-1 tank [[Separation]]
- Equipment bay - [[Avionics System]] mounting

### [[Separation Systems]]
- [[Stage Separation]] - Pneumatic actuators + pyrotechnic bolts
- [[Fairing Design]] - Clamshell fairing with pyrotechnic separation
- Interstage adapter - Structural coupling between stages

### Landing System
- [[Landing System]] - Propulsive landing gear (4 legs)
- Hydraulic shock absorption - Energy dissipation
- Deployment mechanism - Pneumatic actuators
- [[Ground]] contact pads - Crushable honeycomb

### Materials
- [[Material Selection]] - Carbon fiber prepreg (IM7/8552)
- Aluminum alloys - Fittings, attachments, mechanisms
- Titanium - High-temperature areas (engine mount)
- Honeycomb [[Core]] - Sandwich panels (non-critical areas)

## [[Current Status]]

### [[Fabrication Phase]]

**[[Phase Goal]]**: Manufacture airframe sections and validate assembly processes

**Progress**:
- ✅ [[Material Selection]] complete - IM7/8552 carbon fiber
- ✅ Tooling fabrication complete (layup mandrels, curing fixtures)
- ✅ [[First]] article upper section - fabricated and inspected
- 🔄 First article lower section - layup in progress (80% complete)
- 🔄 Thrust structure - machining aluminum fittings
- ⏳ Stage separation mechanism - parts procurement
- ⏳ [[Landing System]] - design review [[Jan 15]]
- ⏳ [[Fairing Design]] - tooling fabrication [[Feb 2026]]

### [[Manufacturing Status]]

| Component | Status | Completion |
|-----------|--------|------------|
| Upper airframe section | ✅ Complete | 100% |
| Lower airframe section | 🔄 In layup | 80% |
| Thrust structure fittings | 🔄 Machining | 60% |
| Inter-tank structure | ⏳ [[Planned]] | 0% |
| Stage separation [[Hardware]] | ⏳ Procurement | 20% |
| Fairing molds | 🔄 Fabrication | 40% |
| Landing legs | 🔄 Design | 70% |

### [[Active Issues]]

**[[Medium Priority]]:**
1. **[[Dry Mass Estimate]]** (40 kg over [[Target]])
   - Current estimate: 1,240 kg | Target: 1,200 kg
   - Primary contributors: Landing system complexity, avionics bay reinforcement
   - Impact: Reduces payload capacity by ~40 kg (still within margin)
   - Plan: Review for mass reduction [[Opportunities]] in detail design
   - [[Risk]]: [[Not]] yet registered - [[Monitoring]]

2. **[[Material Selection]] Certification** ([[See]] [[Risk Register]] R-008)
   - Carbon fiber composite qualification taking longer than expected
   - Certification [[Testing]]: thermal cycling, moisture effects
   - May delay lower section fabrication by 2 [[Weeks]]
   - Mitigation: Parallel path [[Using]] pre-qualified material (lower [[Performance]])

3. **[[Landing System]] Complexity** (See [[Risk Register]] R-021)
   - Propulsive landing gear more complex than initially estimated
   - Design review [[Scheduled]] Jan 15
   - Hydraulic system design challenging
   - [[Related]] to [[ADR-003 Landing Strategy]] decision

**[[LOW Priority]]:**
4. Fairing mold fabrication schedule (within margin)
5. Thrust structure attachment bolt pattern (minor design iteration)

## [[Design Decisions]]

### [[ADR-003 Landing Strategy]]
**Decision**: Propulsive landing with deployable landing gear
**[[Date]]**: 2025-11-10
**Rationale**:
- Enables vehicle reusability (10+ flights per vehicle)
- Propulsive touchdown allows precision landing
- 4-leg hydraulic system provides stability on uneven surfaces
- [[Technology]] demonstration for future larger vehicles

**[[Architecture]]**:
- 4 deployable legs (90° spacing)
- Hydraulic shock absorbers (200 kN capacity [[Each]])
- Pneumatic deployment system
- Crushable honeycomb ground contact pads
- Integrated with [[GNC System]] [[Landing Algorithm]]

**[[Alternatives Considered]]**:
- Ocean splashdown (rejected: salt water corrosion, recovery cost)
- Parachute landing (rejected: less precision, wind drift)
- Fixed landing gear (rejected: aerodynamic drag penalty)

### [[Material Selection]]
**Decision**: IM7/8552 carbon fiber prepreg
**Rationale**:
- High strength-to-weight ratio (tensile strength: 5,700 MPa)
- Aerospace flight-proven (F-35, 787 heritage)
- [[Good]] environmental resistance
- [[Available]] from qualified suppliers

**Properties**:
- Fiber: IM7 (intermediate modulus carbon)
- Resin: 8552 (toughened epoxy)
- Cure: 350°F, autoclave process
- Density: 1.58 g/cm³

## [[Integration Status]]

### With Other [[Systems]]

[[Propulsion System]]:
- Thrust structure mounts [[Engine Design]] to airframe
- Propellant tank interfaces (LOX and RP-1 [[Fuel Tanks]])
- Thermal protection from engine plume
- Vibration loads during engine firing

[[Avionics System]]:
- Avionics bay in upper airframe section
- Vibration isolation mounts (attenuate launch loads)
- Cable routing through airframe
- Thermal control (heaters, insulation)

[[GNC System]]:
- [[Landing System]] coordinates with [[Landing Algorithm]]
- Landing gear deployment commanded by [[Flight Software]]
- Touchdown sensors [[Provide]] ground contact indication
- Hydraulic system provides shock absorption for controlled landing

**[[Payload Interface]]**:
- [[Fairing Design]] protects payload during ascent
- Payload adapter ring (standard interface)
- Separation system for payload deployment
- Thermal control during ascent

## [[Test Campaign]]

### [[Completed Tests]]

**[[Material Characterization]]** (Aug-[[Oct 2025]]):
- ✅ Tensile testing (IM7/8552 coupons)
- ✅ Compression testing (open-hole, filled-hole)
- ✅ Bearing strength (bolt joint design)
- ✅ Environmental conditioning (moisture, thermal cycles)

**[[First Article Inspection]]** ([[Dec 2025]]):
- ✅ Upper airframe section - dimensional inspection, ultrasonic NDT
- ✅ Ply thickness measurements
- ✅ Cure quality [[Verification]] (glass transition temperature)

### [[Upcoming Tests]]

**[[Structural Testing]]** (Feb-[[May 2026]]):
- Thrust structure load [[Test]] (2x limit load)
- Airframe bending test (cantilever loads)
- Stage separation mechanism qualification
- [[Fairing Design]] separation test (pyrotechnics)

**[[Environmental Testing]]** (Jun-[[Aug 2026]]):
- Vibration testing (launch environment)
- Thermal-vacuum testing (flight environment)
- Acoustic testing (launch acoustics)

**[[Landing System Testing]]** (Mar-[[Sep 2026]]):
- [[Drop]] tests (landing impact)
- Hydraulic system qualification
- Deployment mechanism [[Validation]]
- Integrated landing tests with [[GNC System]]

See [[Test Campaign Overview]] and [[Upcoming Tests]] for [[Full]] schedule.

## [[Requirements Traceability]]

### [[System Requirements]]
- SR-007: Reusable airframe (10 flights) ✅ Design for [[Reuse]]
- SR-008: Payload fairing (1.2m diameter) ✅ Design complete
- SR-009: Propulsive landing capability ✅ [[Landing System]] in design

### [[Performance Requirements]]
- [[PR]]-008: Dry mass ≤ 1,200 kg 🟡 1,240 kg current (reviewing)
- PR-009: Payload capacity ≥ 250 kg ✅ Met (with margin)
- PR-010: Landing precision ±10 meters ✅ Design validated in sim

### [[Safety Requirements]]
- SAF-007: Stage separation [[Reliability]] > 0.999 ✅
- SAF-008: Fairing separation reliability > 0.999 ✅
- SAF-009: Landing gear deployment reliability > 0.99 🔄 In verification

## Team

**[[Lead]]**: [[James Park]]
- Structures system [[Architect]]
- Composite structures specialist
- Risk owner: R-015 (fairing separation), R-021 ([[Landing Gear Complexity]])

**Engineers**:
- [[Christopher Lee]] - Lead structures, stress analysis
- [[Amanda Foster]] - Composites [[Engineering]], fabrication
- [[Brian Scott]] - Mechanisms (stage sep, fairing, landing gear)

**Fabrication Technicians** (4):
- Carbon fiber layup
- Autoclave curing operations
- Machining (aluminum, titanium fittings)
- Assembly and inspection

See [[Team Roster]] for full team details.

## Schedule & Milestones

| Milestone | Date | Status |
|-----------|------|--------|
| [[Preliminary Design Review]] | 2025-12-18 | ✅ Complete |
| [[Material Selection]] certification | 2026-01-31 | 🔄 In testing |
| [[Landing System]] design review | 2026-01-15 | ⏳ Planned |
| First article lower section complete | 2026-02-01 | 🔄 In layup |
| [[Fairing Design]] tooling complete | 2026-02-28 | 🔄 In fabrication |
| [[Critical Design Review]] | 2026-03-10 | ⏳ Planned |
| Structural testing complete | 2026-05-31 | ⏳ Planned |
| First stage assembly | 2026-06-01 | ⏳ Planned |
| Structures delivery to [[Integration]] | 2026-07-01 | ⏳ Planned |

See [[Project Roadmap]] for overall program schedule.

## [[Risks

See]] [[Risk Register]] for complete risk analysis.

**[[MEDIUM Priority]]**:
- R-008: [[Material Selection]] certification delays (Score: 6)
  - Mitigation: Parallel path with pre-qualified material
- R-015: [[Fairing Design]] separation (Score: 10)
  - Mitigation: Extensive testing per [[ADR-004 Test Campaign]]
- R-021: [[Landing System]] complexity (Score: 6)
  - Mitigation: Design review, early testing

**Monitoring**:
- Dry mass growth (40 kg over target)
- Fabrication schedule adherence

## Budget

**[[Structures System Budget]]**: $2.4M (of $14M [[Total]])

| Category | Budget | Spent | Remaining |
|----------|--------|-------|-----------|
| Materials (carbon fiber, metals) | $0.8M | $0.5M | $0.3M |
| Tooling (molds, fixtures) | $0.4M | $0.3M | $0.1M |
| [[Fabrication Labor]] | $0.6M | $0.2M | $0.4M |
| Testing (structural, environmental) | $0.4M | $0.05M | $0.35M |
| Hardware (mechanisms, landing gear) | $0.2M | $0.08M | $0.12M |

See [[Budget Tracker]] for program-level budget.

## [[Documentation]]

**[[Design Documentation]]**:
- [[Airframe Design]] - Primary structure design
- [[Material Selection]] - Material properties and qualification
- [[Stage Separation]] - Separation mechanisms
- [[Fairing Design]] - Payload [[Fairing Design]]
- [[Landing System]] - Landing gear and hydraulics

**[[Analysis Documentation]]**:
- Stress analysis reports (FEA models)
- Mass properties (current: 1,240 kg)
- Loads analysis (flight loads, landing loads)

**Manufacturing**:
- Layup procedures (ply schedules, cure cycles)
- Inspection procedures (NDT, dimensional)
- Assembly procedures (bonding, fastening)

**Decisions**:
- [[ADR-003 Landing Strategy]]
- [[ADR-004 Test Campaign]] (structural tests)

**[[Project Management]]**:
- [[Project Roadmap]]
- [[Risk Register]]
- [[Team Roster]]

## [[Meeting Notes

Recent]] discussions:
- [[2025-12-18 PDR Review]] - Structures design review
- [[2026-01-02 Sprint Planning]] - Q1 fabrication plan

---

*[[Last]] [[Updated]]: 2026-01-02 by [[James Park]]*
*[[Next]] review: Weekly [[Project Roadmap]] review*
