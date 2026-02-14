---
type: component
subsystem: propulsion
status: testing
owner: "[[Marcus Johnson]]"
created: 2025-06-25
updated: 2026-01-02
tags:
  - propulsion
  - engine
  - design
---
# [[Engine Design]]

## [[Overview]]

The Artemis main [[Engine]] is a [[Gas Generator]] cycle liquid rocket engine burning LOX/RP-1 propellants. The [[Design]] prioritizes simplicity and flight-proven [[Technology]] for rapid development and [[High]] [[Reliability]].

**[[Component Owner]]**: [[David Kim]] ([[Senior Propulsion Engineer]])
**[[Report To]]**: [[Marcus Johnson]] ([[Propulsion System]] [[Lead]])
**[[Status]]**: 🟡 [[Hot]] fire [[Testing]] in progress

## Specifications

| Parameter | Value | Units | Status |
|-----------|-------|-------|--------|
| **Thrust (sea level)** | 44.2 | kN | ✅ Demonstrated |
| **Thrust (vacuum)** | 48.5 | kN | 📊 Calculated |
| **[[Specific Impulse]] (sea level)** | 287 | s | ✅ Measured |
| **[[Specific]] Impulse (vacuum)** | 315 | s | 📊 Calculated |
| **[[Chamber Pressure]]** | 8.2 | MPa | ✅ Measured |
| **[[Expansion Ratio]]** | 16:1 | - | ✅ As-designed |
| **[[Mixture Ratio]] (O/F)** | 2.38:1 | - | ✅ [[Optimized]] |
| **[[Mass Flow Rate]]** | 15.6 | kg/s | ✅ Measured |
| **[[Throttle Range]]** | 60-100 | % | 🔄 [[Validated]] to 60% |
| **[[Engine Mass]] (dry)** | 185 | kg | ✅ As-[[Built]] |

## [[Engine Cycle]]: Gas Generator

**[[Cycle Selection]]**: Gas generator cycle ([[See]] [[ADR-001 Propellant Selection]] for rationale)

**Advantages**:
- [[Simpler]] than staged combustion (fewer turbopumps, lower chamber pressure [[Requirements]])
- Flight-proven heritage (Merlin, RS-27, RD-107)
- Lower development cost and [[Risk]]
- Adequate [[Performance]] for mission (ISP ~290s sea level)

**[[Flow Schematic]]**:
```
LOX Tank → [[Oxidizer System]] → [[Turbopump]] (oxidizer side) → Main Injector → Combustion Chamber
                                                                   ↓
RP-1 Tank → [[Fuel Tanks]] → [[Turbopump]] (fuel side) ────────→ Main Injector → Combustion Chamber
                                     ↓
                              Gas Generator → Turbine → Exhaust
                                     ↑
                              LOX + RP-1 (propellant tap)
```

**[[Key Feature]]**: Turbine [[Driven]] by hot gas from gas generator (small pre-burner), which is exhausted overboard ([[Not]] recovered).

## [[Major Subcomponents]]

### [[Combustion Chamber]]
- **Type**: Regeneratively cooled copper-alloy chamber
- **Cooling**: RP-1 fuel flow through chamber walls before [[Injection]]
- **[[Chamber Length]]**: 0.45 meters
- **[[Throat Diameter]]**: 0.12 meters
- **[[Cooling Channels]]**: 360 machined channels, 2mm x 3mm cross-section
- **Material**: OFHC copper with electroformed nickel jacket
- **Status**: 🔴 **Broken [[Link]]** - [[Combustion Chamber]] [[Note]] missing (intentional for demo)

### Injector
- **Type**: Pintle injector (single element, variable flow)
- **[[Propellant Distribution]]**: [[Central]] LOX post, annular RP-1 sleeve
- **Throttling**: Pintle position varies mixture ratio and [[Total]] flow
- **Atomization**: Impinging jets for fine mixing
- **[[Design Heritage]]**: TRW [[Lunar Module Descent Engine]]
- **Benefits**: Simple, robust, [[Good]] combustion stability, throttle-capable

### Nozzle
- **Expansion Ratio**: 16:1 (optimized for sea level + vacuum)
- **Material**: [[Carbon]]-carbon composite (high-temperature capability)
- **Cooling**: Radiation cooling (no [[Active]] cooling in expansion section)
- **[[Gimbal Mount]]**: 4-point gimbal for [[Thrust Vector Control]]
- **[[Gimbal Range]]**: ±5° (pitch and yaw)

### [[Turbopump
See]] [[Turbopump]] for [[Full]] details.

- **Type**: Single-shaft, centrifugal pump (LOX and RP-1 on same shaft)
- **Drive**: Gas generator turbine (single-stage)
- **LOX [[Pump Pressure Rise]]**: 12 MPa
- **RP-1 Pump Pressure Rise**: 15 MPa
- **[[Shaft Speed]]**: 32,000 RPM
- **Status**: 🔴 Flight unit delivery delayed (see [[Risk Register]] R-003)

### Gas Generator
- **Function**: Produce hot gas to drive [[Turbopump]] turbine
- **Propellants**: LOX + RP-1 (fuel-rich mixture for lower temperature)
- **Chamber Pressure**: 4.5 MPa
- **[[Gas Temperature]]**: 850°C (fuel-rich to [[Prevent]] turbine overheating)
- **Exhaust**: Overboard (not recovered in gas generator cycle)

### Valves & Plumbing
- **[[Main Oxidizer Valve]] (MOV)**: Pneumatically actuated ball valve, 75mm diameter
- **[[Main Fuel Valve]] (MFV)**: Pneumatically actuated ball valve, 75mm diameter
- **[[Gas Generator Valves]]**: Small solenoid valves for GG propellant flow
- **Feedlines**: Stainless steel flex hoses (vibration isolation)
- **[[Purge System]]**: GN2 purge for post-shutdown inert environment

## [[Performance Analysis]]

### [[Thrust Profile]]

**[[Sea Level Performance]]** (demonstrated in [[Engine Hot Fire Results]]):
- Thrust: 44.2 kN ([[Target]]: 45 kN, 98% of target)
- ISP: 287s (target: 290s, 99% of target)
- Chamber pressure: 8.2 MPa (target: 8.5 MPa, 96%)

**[[Vacuum Performance]]** (calculated):
- Thrust: 48.5 kN
- ISP: 315s
- Expansion ratio 16:1 slightly underexpanded for vacuum (ideal ~25:1)

**[[Performance Gap Analysis]]**:
- [[Current]] ISP: 287s
- Target ISP: 290s
- Gap: 3s (1% below target)
- [[Root Cause]]: Mixture ratio not yet optimized (currently 2.38:1, target 2.40:1)
- Plan: Adjust mixture ratio in [[Test 4]] ([[Jan 8]])

### [[Throttling Capability]]

**[[Demonstrated Range]]**: 60-100% thrust
- [[Achieved]] through pintle injector position control
- Mixture ratio [[Maintained]] across throttle range
- Chamber pressure scales linearly with throttle

**[[Deep Throttle]]** (50-60%, not yet validated):
- [[Required]] for propulsive landing (final descent [[Phase]])
- Testing deferred to post-CDR (not mission-critical for [[First]] flight)
- Combustion stability [[Concerns]] at low throttle (may [[Need]] injector tuning)

## [[Thermal Management]]

### [[Cooling System
See]] [[Cooling System]] for full details.

**[[Regenerative Cooling]]**:
- RP-1 fuel flows through chamber wall channels before injection
- Heat absorption: ~800 kW (at full thrust)
- Fuel temperature rise: 50°C (from 15°C to 65°C)
- Chamber wall temperature: <600°C (copper limit: 650°C)

**[[Thermal Validation]]**:
- ✅ [[Test 1]] (30s): Thermal [[Startup]] transient characterized
- ✅ [[Test 2]] (60s): Steady-state temperatures [[Stable]]
- ✅ [[Test 3]] (120s): [[Extended Duration]], no thermal issues
- ⏳ [[Test]] 4-5: Full mission duration thermal [[Validation]]

### [[Hot Gas Path]]
- **Chamber wall**: Regeneratively cooled (RP-1 coolant)
- **Throat**: Highest heat flux area, copper alloy with enhanced cooling
- **Nozzle expansion**: Radiation-cooled carbon-carbon composite
- **Gas generator**: Fuel-rich combustion (lower temperature, no active cooling)

## [[Integration]]

### With [[Propulsion System]]
- Primary propulsion unit within [[Propulsion System]]
- Propellant feed from [[Fuel Tanks]] and [[Oxidizer System]]
- Commands from [[Engine Controller]]
- TVC actuation [[Via]] [[Thrust Vector Control]] gimbal

### With [[Avionics System]]
- [[Engine Controller]] interfaces with [[Flight Computer]]
- [[Telemetry]]: Chamber pressure, TVC position, valve states, temperatures
- Commands: Start sequence, throttle level, shutdown, TVC gimbal angle
- Interface: CAN bus, 1kHz [[Update Rate]]

### With [[Structures System]]
- Engine mounts to [[Airframe Design]] thrust structure via 4-point gimbal mount
- TVC gimbal provides ±5° pitch/yaw control
- Vibration environment: 5g RMS during firing
- Thermal protection: Heat shield between engine and airframe

### With [[GNC System]]
- [[Autopilot Software]] commands throttle and TVC for trajectory control
- Engine startup transient [[Coordinated]] with [[Flight Software]]
- Shutdown sequence triggered by GNC or abort logic

## [[Testing Status]]

### [[Completed Tests
See]] [[Engine Hot Fire Results]] for full [[Data]] and analysis.

**Test 1** (2025-12-28): 30s burn - [[Ignition Sequence]] validation
- [[Focus]]: [[Ignition Sequence]] reliability, startup transient
- Result: ✅ Nominal ignition, smooth ramp to full thrust
- [[Key]] data: Chamber pressure rise time 2.1s, no pressure oscillations

**Test 2** (2025-12-30): 60s burn - Thermal stability
- Focus: [[Cooling System]] performance, thermal equilibrium
- Result: ✅ Temperatures stable, regenerative cooling effective
- Key data: Chamber wall temp peaked at 580°C, stable [[After]] 15s

**Test 3** (2026-01-02): 120s burn - Extended duration
- Focus: Steady-state performance, wear/erosion assessment
- Result: ✅ Performance stable, no degradation observed
- Key data: [[Thrust 44.2]] kN ±0.3 kN throughout burn, ISP 287s

### [[Upcoming Tests
See]] [[Upcoming Tests]] for schedule.

**Test 4** (2026-01-08): 180s burn - Mission-[[Like Duration]]
- Focus: Approaching mission duration (240s target)
- Mixture ratio [[Optimization]] (target 2.40:1 to close ISP gap)
- Flight [[Turbopump]] required (delivery critical path item)
- Success [[Criteria]]: ISP ≥289s, thrust ≥44.5 kN

**[[Test 5]]** (2026-01-15): 240s burn - [[Full Qualification]]
- Focus: Full mission duration qualification
- Validates [[All]] [[Performance Requirements]] for flight
- Final acceptance test for [[Critical Design Review]]
- Success criteria: All parameters nominal for 240s continuous burn

## [[Requirements Verification]]

### [[Performance Requirements]]
- [[PR]]-001: Thrust ≥ 45kN (sea level) 🟡 44.2kN demonstrated (98%, acceptable)
- PR-002: ISP ≥ 285s (vacuum) ✅ 315s calculated (exceeds requirement)
- PR-003: [[Burn Time]] ≥ 240s 🔄 In test - 120s validated, 240s [[Planned]] [[Jan 15]]
- PR-004: Throttle range 50-100% 🟡 60-100% validated ([[Deep]] throttle deferred)

### [[Safety Requirements]]
- SAF-001: Dual barrier propellant isolation ✅ [[Two]] valves in series
- SAF-002: Engine shutdown < 200ms ✅ Demonstrated at 150ms
- SAF-003: TVC failure [[Safe]] [[Mode]] ✅ Direct mode (no gimbal)

## Risks & Issues

### [[Active Risks
See]] [[Risk Register]] for full analysis.

**R-003: [[Turbopump]] [[Delivery Delay]]** (Score: 15, HIGH)
- Flight turbopump delivery delayed from [[Jan 5]] → [[Jan 20]]
- [[Impacts Test]] 4 schedule (needed for higher-duration testing)
- Mitigation: Expedited shipping, dual-sourcing evaluation with [[Precision Components Inc]]

### [[Open Issues]]
1. **ISP [[Performance Gap]]** (1% below target)
   - Current: 287s | Target: 290s
   - Plan: Mixture ratio adjustment in Test 4
   - Impact: Minimal - within mission margin

2. **[[Deep Throttle Validation]]** (50-60% range)
   - Deferred to post-CDR testing
   - Not required for first flight (landing uses 60%+ thrust)
   - May require injector tuning for combustion stability

## Design Heritage

**[[Similar Engines]]**:
- SpaceX Merlin 1D (gas generator cycle, LOX/RP-1, ~845 kN thrust)
- [[Firefly Alpha]] engine (gas generator, LOX/RP-1, ~75 kN thrust)
- [[TRW Lunar]] Module [[Descent Engine]] (pintle injector heritage)

**[[Technology Reuse]]**:
- Pintle injector design pattern from Apollo [[LM Descent]] Engine
- Regenerative cooling approach from Merlin heritage
- Gas generator cycle widely used in industry

## [[Documentation]]

**[[Design Documentation]]**:
- [[Engine Design Specification]] ([[This]] document)
- Flow schematic and P&ID diagrams
- Performance analysis and trade studies
- [[Propellant Selection]] - Trade study (see [[ADR-001 Propellant Selection]])

**Analysis**:
- Thermodynamic cycle analysis (CEA2 modeling)
- CFD analysis (combustion chamber, injector)
- FEA structural analysis (chamber, nozzle, gimbal)
- Thermal analysis ([[Cooling System]] design)

**[[Test Data]]**:
- [[Engine Hot Fire Results]] - All test data and analysis
- [[Test Campaign Overview]] - Master test plan
- [[Upcoming Tests]] - Future [[Test Planning]]

**[[Related Components]]**:
- [[Turbopump]] - Propellant pumping [[System]]
- [[Fuel Tanks]] - RP-1 storage and feed
- [[Oxidizer System]] - LOX storage and feed
- [[Engine Controller]] - Engine control unit
- [[Thrust Vector Control]] - Gimbal actuation
- [[Ignition Sequence]] - Engine start sequence
- [[Cooling System]] - Thermal [[Management]]

**[[Project Management]]**:
- [[Project Roadmap]] - Schedule and milestones
- [[Risk Register]] - Risk R-003 (turbopump delay)
- [[Team Roster]] - [[Propulsion Team]] members

**Decisions**:
- [[ADR-001 Propellant Selection]] - LOX/RP-1 selection
- [[ADR-004 Test Campaign]] - Test [[Strategy]]

---

*[[Last]] [[Updated]]: 2026-01-02 by David Kim*
*[[Next]] review: Weekly propulsion standup, post-test analysis*
