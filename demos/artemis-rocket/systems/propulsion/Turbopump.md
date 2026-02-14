---
type: component
subsystem: propulsion
status: delayed
owner: "[[Marcus Johnson]]"
supplier: "[[Acme Aerospace]]"
created: 2025-07-10
updated: 2026-01-02
tags:
  - propulsion
  - turbopump
  - supplier
  - critical-path
---
# [[Turbopump]]

## [[Overview]]

The Artemis turbopump is a single-shaft centrifugal pump assembly that pressurizes [[Both]] LOX and RP-1 propellants for [[Injection]] into the main [[Combustion Chamber]]. The turbopump is [[Driven]] by a [[Gas Generator]] turbine.

**[[Component Owner]]**: [[Rachel Martinez]] ([[Fluids Engineer]])
**Supplier**: [[Acme Aerospace]] (primary), [[Precision Components Inc]] (backup evaluation)
**[[Report To]]**: [[Marcus Johnson]] ([[Propulsion System]] [[Lead]])
**[[Status]]**: 🔴 CRITICAL - Flight unit delivery delayed

## Specifications

| Parameter | Value | Units | Status |
|-----------|-------|-------|--------|
| **[[Shaft Speed]]** | 32,000 | RPM | ✅ [[Design]] [[Validated]] |
| **LOX [[Pump Pressure Rise]]** | 12 | MPa | ✅ [[Prototype]] tested |
| **RP-1 Pump [[Pressure Rise]]** | 15 | MPa | ✅ Prototype tested |
| **LOX [[Mass Flow]]** | 10.8 | kg/s | ✅ Design point |
| **RP-1 Mass Flow** | 4.8 | kg/s | ✅ Design point |
| **[[Turbine Inlet Temperature]]** | 850 | °C | ✅ Within limits |
| **[[Turbine Inlet Pressure]]** | 4.5 | MPa | ✅ Gas generator output |
| **[[Power Required]]** | 650 | kW | ✅ Turbine sized |
| **Mass (dry)** | 42 | kg | ✅ Meets budget |
| **[[Design Life]]** | 10 | flights | 🔄 Qualification pending |

## [[Design Architecture]]

### Single-[[Shaft Configuration]]

**Concept**: Both LOX and RP-1 pumps on same shaft, driven by single turbine

**Advantages**:
- [[Simpler]] than dual-shaft design (fewer bearings, seals)
- Lower part count and cost
- Proven concept (SpaceX Merlin, [[Rocket Lab Rutherford]] heritage)
- Easier to balance and control

**Challenges**:
- LOX and RP-1 pumps [[Must]] operate at same RPM
- Pump sizing constrained by shared shaft speed
- Seal between LOX and RP-1 sides critical (propellant mixing hazard)

### [[Component Layout]]

```
┌────────────────────────────────────────┐
│          Turbopump Assembly             │
├────────────────────────────────────────┤
│                                         │
│  RP-1 Pump → Shaft → LOX Pump          │
│  (fuel side)   ↕      (oxidizer side)  │
│                ↓                        │
│            Turbine                      │
│  (driven by gas generator hot gas)     │
│                                         │
│  Bearings: Ball bearings (2x)          │
│  Seals: Mechanical face seals (3x)     │
│                                         │
└────────────────────────────────────────┘
```

**[[Flow Path]]**:
1. LOX enters oxidizer-side pump inlet (low pressure)
2. Centrifugal pump accelerates LOX, increases pressure to 12 MPa
3. LOX exits to [[Engine Design]] main injector
4. RP-1 enters fuel-side pump inlet (low pressure)
5. Centrifugal pump accelerates RP-1, increases pressure to 15 MPa
6. RP-1 exits to [[Cooling System]] [[Regenerative Cooling]] channels
7. Turbine receives [[Hot]] gas from gas generator
8. Turbine drives shaft at 32,000 RPM

## [[Major Subcomponents]]

### [[LOX Pump]] ([[Oxidizer Side]])

**Type**: Single-stage centrifugal pump
**[[Impeller Diameter]]**: 95 mm
**[[Inlet Pressure]]**: 0.3 MPa (tank pressure)
**[[Outlet Pressure]]**: 12.3 MPa ([[Chamber Pressure]] + margin)
**Pressure Rise**: 12 MPa
**[[Flow Rate]]**: 10.8 kg/s (71% of [[Total]] propellant flow by mass)
**Material**: Titanium alloy (LOX-compatible)

**[[Key Features]]**:
- Titanium construction (LOX cleanliness [[Requirements]])
- Inducer upstream of impeller (prevents cavitation)
- Close-[[Clearance]] labyrinth seal (minimize leakage)

### RP-1 Pump ([[Fuel Side]])

**Type**: Single-stage centrifugal pump
**Impeller Diameter**: 82 mm
**Inlet Pressure**: 0.3 MPa (tank pressure)
**Outlet Pressure**: 15.3 MPa ([[Cooling System]] + injector pressure [[Drop]])
**Pressure Rise**: 15 MPa
**Flow [[Rate]]**: 4.8 kg/s (29% of total propellant flow)
**Material**: Stainless steel (RP-1 compatible)

**[[Key]] [[Features]]**:
- Higher pressure rise than LOX pump (cooling circuit pressure drop)
- Smaller impeller diameter (lower density fluid, same shaft speed)
- Fuel-lubricated bearings (RP-1 provides lubrication)

### Turbine

**Type**: Single-stage axial-flow impulse turbine
**[[Inlet Temperature]]**: 850°C (fuel-rich gas generator exhaust)
**Inlet Pressure**: 4.5 MPa
**[[Power Output]]**: 650 kW
**Efficiency**: 68% (typical for small single-stage turbine)
**Material**: [[Inconel 718]] ([[High]]-temperature superalloy)

**Key Features**:
- Uncooled blades (temperature within material limits)
- Impulse design (simple, robust)
- Exhaust to atmosphere (gas generator cycle)

### Bearings & Seals

**Bearings**:
- 2x [[Angular]] contact ball bearings (ceramic balls, steel races)
- RP-1 lubricated (fuel-side pump provides lubrication flow)
- Axial preload to control shaft position
- DN number: 2.4 million (shaft dia. × RPM)

**Seals**:
- Mechanical face seal between LOX and RP-1 pumps (critical [[Safety]] item)
- Labyrinth seals at pump outlets (minimize leakage)
- [[Carbon]] face seal at turbine ([[Prevent]] hot gas backflow)

**Safety**: Face seal between LOX/RP-1 is dual-barrier design ([[See]] [[Safety Requirements]] SAF-001)

## [[Current Status]] & [[Critical Issue]]

### [[Delivery Delay]] (CRITICAL [[Risk]])

**[[Original Schedule]]**: Flight unit delivery [[Jan 5]], 2026
**[[Current]] Status**: Delayed to [[Jan 20]], 2026 (potentially longer)
**Impact**: Threatens [[Engine Hot Fire Results]] [[Test 4]] schedule ([[Jan 8]])

**[[Root Cause]]** (per [[Vendor Meeting Acme Aerospace]]):
- [[Primary Supplier]] [[Machine]] shop equipment failure (5-axis CNC mill)
- Impeller machining requires [[Specialized]] equipment
- Repair estimated 2 [[Weeks]], no spare capacity at other facilities
- Alternative suppliers [[Have]] 16-week lead time ([[Custom]] turbopumps)

**[[This]] is [[Risk Register]] R-003** (Score: 15, [[High Priority]])

### [[Mitigation Actions]]

**Immediate** ([[In Progress]]):
1. ✅ Expedited shipping arranged (+$15K cost, saves 2-3 days)
2. 🔄 Dual-sourcing evaluation with [[Precision Components Inc]]
   - Technical package delivered Dec 30
   - Quote expected Jan 10
   - Delivery estimate: 12 weeks (backup for future flights)
3. 🔄 Using prototype turbopump for Tests 1-3 (completed)
   - Prototype limited to 60% thrust, 120s duration
   - Flight unit required for higher-thrust, longer-duration testing

**Contingency Plan**:
- Compress [[Critical Design Review]] schedule by 1 week if needed
- Parallel path: Validate engine design with prototype data
- Budget impact: $40K for expediting + dual-source qualification

### [[Test Status]]

**[[Prototype Unit Testing]]** ([[Dec 2025]]):
- ✅ Spin [[Test]] to 35,000 RPM (110% of design speed)
- ✅ Cold flow test (water and kerosene simulants)
- ✅ [[Hot Fire Test]] 1 (30s, 100% thrust) - Nominal [[Performance]]
- ✅ Hot fire [[Test 2]] (60s, 100% thrust) - No degradation observed
- ✅ Hot fire [[Test 3]] (120s, 100% thrust) - Seal wear within limits

**[[Flight Unit Qualification]]** ([[Pending Delivery]]):
- ⏳ Acceptance [[Testing]] at [[Acme Aerospace]] (visual inspection, spin test)
- ⏳ Hot fire Test 4 (180s, 100% thrust) - [[First]] flight unit test
- ⏳ Hot fire [[Test 5]] (240s, 100% thrust) - [[Full Qualification]]

## [[Integration]]

### With [[Engine Design]]

**[[LOX Flow]] Path**:
1. [[Oxidizer System]] → Turbopump LOX inlet
2. Turbopump LOX outlet → [[Engine Design]] main injector
3. Small bleed to gas generator

**RP-1 Flow Path**:
1. [[Fuel Tanks]] → Turbopump RP-1 inlet
2. Turbopump RP-1 outlet → [[Cooling System]] regenerative [[Cooling Channels]]
3. Cooling channels → [[Engine Design]] main injector
4. Small bleed to gas generator

**[[Turbine Drive]]**:
- Gas generator hot gas → Turbine inlet
- Turbine exhaust → Overboard ([[Not]] recovered)
- Power transmission [[Via]] shaft to pumps

### With [[Propulsion System]]

- Mounted to [[Engine Design]] assembly via flange interface
- Propellant feedlines from [[Fuel Tanks]] and [[Oxidizer System]]
- Turbine exhaust ducting (routes hot gas overboard)
- Instrumentation: Speed sensor, pump outlet pressures, temperatures

## [[Requirements Verification]]

### [[Performance Requirements]]
- Pressure rise (LOX): ✅ 12 MPa demonstrated (prototype)
- Pressure rise (RP-1): ✅ 15 MPa demonstrated (prototype)
- Flow rate: ✅ 15.6 kg/s total demonstrated
- Speed: ✅ 32,000 RPM nominal, tested to 35,000 RPM
- Efficiency: ✅ 68% ([[Matches]] design prediction)

### [[Safety Requirements]]
- SAF-001: Dual barrier propellant isolation ✅
  - Mechanical face seal between LOX and RP-1
  - Secondary labyrinth seal provides backup
  - Tested with helium leak check (<1e-6 std-cc/s)

### Design Life
- SR-002: Reusable for 10 flights 🔄 Qualification pending
  - Prototype: 3 hot fires [[Completed]], no significant wear
  - Flight unit: [[Full]] life testing post-first-flight

## [[Supplier Management]]

### Primary Supplier: [[Acme Aerospace]]

**Contact**: [[Steve Morrison]] ([[VP Engineering]])
**[[Contract]]**: Fixed-[[Price]], $600K for flight unit + 2 spares
**History**: Reputable supplier, 15+ years in aerospace turbomachinery
**Current Issue**: Machine shop equipment failure causing delay

**Relationship Status**: 🟡 Strained due to delay
- Weekly status calls (see [[Vendor Meeting Acme Aerospace]])
- Negotiating contractual penalties for further delays
- Considering expedite fees for future orders

### Backup Supplier: [[Precision Components Inc]]

**Contact**: Linda Chen (Sales Engineering)
**Evaluation Status**: 🔄 Quote in progress
**Timeline**: 12-week delivery if order placed today
**Cost**: Estimated $680K (13% higher than [[Acme Aerospace]])

**[[Strategy]]**:
- Qualify as second source for future [[Production]]
- Order prototype unit for testing (spring 2026)
- Reduces single-supplier risk going forward

## Risks

### [[Active Risks]]

**R-003: [[Turbopump Delivery Delay]]** (See [[Risk Register]])
- Score: 15 (Impact: 5 HIGH × Probability: 3 MEDIUM)
- Owner: [[Marcus Johnson]]
- Status: 🔴 [[Active]] - flight unit delayed Jan 5 → Jan 20
- Mitigation: Expedited shipping, dual-sourcing
- Impact: May delay Test 4 (Jan 8) by up to 2 weeks

### [[Future Risks]] ([[Monitoring]])

1. **[[Seal Life Uncertainty]]**
   - Current: 3 hot fires on prototype, minimal wear
   - Concern: 10-flight reusability [[Target]] not yet validated
   - Plan: Post-flight inspection program

2. **[[Bearing Lubrication]]**
   - Current: RP-1 lubrication [[Working]] well in prototype
   - Concern: Long-term coking (carbon buildup) in bearings
   - Plan: Teardown inspection [[After]] 5 flights

3. **[[Supplier Single Point]] of Failure**
   - Current: [[One]] qualified supplier ([[Acme Aerospace]])
   - Concern: Equipment failures, capacity constraints
   - Plan: Qualify [[Precision Components Inc]] as second source

## [[Design Heritage]]

**[[Similar Turbopumps]]**:
- SpaceX Merlin 1D turbopump (single-shaft, LOX/RP-1, ~850 kN thrust [[Engine]])
- [[Rocket Lab]] Rutherford turbopump (electric motor-driven, [[But]] similar pump design)
- Russian RD-107/108 turbopumps (larger scale, similar concept)

**[[Technology Reuse]]**:
- Centrifugal pump [[Architecture]] widely used in industry
- Mechanical face seal design from industrial pump heritage
- Single-shaft configuration proven on Merlin

## [[Documentation]]

**[[Design Documentation]]**:
- [[Turbopump Design Specification]] (this document)
- Impeller geometry (CFD-[[Optimized]])
- Turbine blade design (aerodynamics, stress analysis)
- Bearing selection and life analysis
- Seal design and leakage analysis

**[[Supplier Documentation]]** ([[Acme Aerospace]]):
- Manufacturing drawings and procedures
- Quality control plan and inspection [[Criteria]]
- Test procedures (spin test, cold flow, acceptance)

**[[Test Data]]**:
- Prototype test [[Data]] (3 hot fires completed)
- Spin test [[Results]] (up to 35,000 RPM)
- Post-test inspection reports (wear measurements)

**[[Related]]**:
- [[Engine Design]] - Main engine assembly
- [[Propulsion System]] - [[System]]-level integration
- [[Fuel Tanks]] - RP-1 propellant [[Supply]]
- [[Oxidizer System]] - LOX propellant supply
- [[Cooling System]] - RP-1 flow path after pump

**[[Project Management]]**:
- [[Project Roadmap]] - Schedule impact
- [[Risk Register]] - R-003 (delivery delay)
- [[Team Roster]] - [[Propulsion Team]]
- [[Vendor Meeting Acme Aerospace]] - Supplier discussions
- [[Budget Tracker]] - Cost impact of delays and expedites

**Decisions**:
- [[ADR-001 Propellant Selection]] - LOX/RP-1 drives turbopump design

---

*[[Last]] [[Updated]]: 2026-01-02 by Rachel Martinez*
*[[Next]] review: Daily until flight unit delivered, then weekly*
*Next [[Action]]: Status call with [[Acme Aerospace]] [[Jan 3]]*
