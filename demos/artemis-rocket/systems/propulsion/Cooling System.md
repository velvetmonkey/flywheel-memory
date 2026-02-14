---
type: component
subsystem: propulsion
status: validated
owner: "[[Marcus Johnson]]"
created: 2025-08-01
updated: 2026-01-02
tags:
  - propulsion
  - cooling
  - thermal
  - regenerative
---
# [[Cooling System]]

## [[Overview]]

The Artemis [[Engine]] cooling [[System]] protects the [[Combustion Chamber]] from extreme heat [[Using]] [[Regenerative Cooling]]. RP-1 fuel flows through channels in the chamber wall, absorbing heat before [[Injection]], preventing [[Material Failure]] while preheating the propellant for improved combustion.

**[[Component Owner]]**: [[David Kim]] ([[Senior Propulsion Engineer]])
**[[Report To]]**: [[Marcus Johnson]] ([[Propulsion System]] [[Lead]])
**[[Status]]**: ✅ [[Validated]] in [[Hot]] fire [[Testing]] ([[Tests 1]]-3)

## Specifications

| Parameter | Value | Units | Status |
|-----------|-------|-------|--------|
| **[[Cooling Method]]** | Regenerative (RP-1 fuel) | - | ✅ [[Design]] validated |
| **[[Coolant Flow Rate]]** | 4.8 | kg/s | ✅ [[Matches]] fuel flow |
| **[[Heat Absorption]]** | 800 | kW | ✅ Validated in testing |
| **[[Chamber Wall Temp]] (max)** | 595 | °C | ✅ [[Below 650]]°C limit |
| **[[Fuel Temp Rise]]** | 50 | °C | ✅ 15°C → 65°C |
| **[[Channel Count]]** | 360 | - | ✅ As-designed |
| **[[Channel Dimensions]]** | 2mm × 3mm | - | ✅ Machined channels |
| **[[Pressure Drop]]** | 5 | MPa | ✅ [[Turbopump]] sized for [[This]] |
| **Material** | OFHC copper + Ni jacket | - | ✅ Electroformed |
| **[[Thermal Margin]]** | 10 | % | ✅ [[Safe]] operating envelope |

## [[Design Approach]]

### [[Regenerative Cooling Concept]]

**Problem**: Combustion chamber experiences extreme heat flux
- Chamber temperature: 3,200°C (flame temperature)
- Without cooling: Copper melts at 1,085°C → immediate failure
- Heat flux at throat: 40 MW/m² (highest in engine)

**Solution**: Fuel as coolant before injection
1. [[Turbopump]] delivers RP-1 at 15 MPa, 15°C
2. Fuel flows through 360 channels machined in chamber wall
3. Fuel absorbs 800 kW of heat, rises to 65°C
4. Heated fuel exits to [[Engine Design]] main injector
5. Combusts normally (preheating improves efficiency)

**Advantages**:
- No separate coolant system needed (saves mass)
- Fuel [[Must]] flow anyway (dual-purpose)
- Preheating fuel improves combustion efficiency
- Flight-proven approach (Merlin, RS-25, F-1 heritage)

### [[Cooling Channel Design]]

**Geometry**:
- 360 channels milled into copper chamber liner
- Channel cross-section: 2mm wide × 3mm [[Deep]]
- Channel spacing: 1mm wall between channels
- Channels [[Run]] axially (parallel to chamber axis)
- Densest at throat (highest heat flux area)

**[[Flow Pattern]]**:
- Fuel enters at nozzle end (lowest heat flux)
- Flows toward injector (increasing heat flux)
- Exits at injector end (fuel [[Now]] heated)
- Counter-flow design maximizes [[Heat Transfer]]

**[[Material Stack]]**:
1. Inner wall: OFHC copper ([[High]] thermal conductivity)
2. Channels: Machined into copper liner
3. Outer jacket: Electroformed nickel (structural strength)
4. [[Total]] wall thickness: 8mm (3mm channels + 5mm jacket)

### [[Thermal Analysis]]

**Heat Transfer**:
- Convective heat transfer from hot gas to wall
- Conduction through copper wall to fuel
- Convective heat transfer from wall to fuel flow

**[[Critical Parameters]]**:
- Wall temperature: 595°C (measured in [[Test 3]])
- Copper limit: 650°C (material softening threshold)
- Margin: 55°C (10% thermal margin)
- Hot spot: Throat region (highest heat flux)

**[[Validation]]**:
- CFD analysis predicted 580°C max wall temp
- [[Test]] 3 measured 595°C (2.5% above prediction)
- Still well below 650°C limit
- Margin adequate for flight

## [[Integration]]

### With [[Engine Design]]

**[[Coolant Flow Path]]**:
1. [[Turbopump]] RP-1 outlet (15 MPa, 15°C) → Cooling manifold
2. Manifold distributes to 360 channels
3. Channels absorb heat (fuel rises to 65°C)
4. Channels merge at injector end → Heated fuel (15 MPa, 65°C)
5. Heated fuel → [[Engine Design]] main injector → Combustion

**[[Thermal Protection Zones]]**:
- **Combustion chamber**: Regeneratively cooled (360 channels)
- **Throat**: [[Most]] channels (highest heat flux)
- **Nozzle expansion ([[First]] 30%)**: Regeneratively cooled
- **Nozzle expansion (outer 70%)**: Radiation-cooled [[Carbon]]-carbon (no [[Active]] cooling)

**[[Critical Dependency]]**:
- Fuel flow MUST start before ignition
- No fuel flow = no cooling = chamber burnthrough
- [[Startup Sequence]] ensures fuel flows for 2 seconds before ignition
- [[Shutdown Sequence]] maintains fuel flow for 3 seconds post-shutdown (purge residual heat)

### With [[Turbopump]]

**[[Pressure Requirements]]**:
- Turbopump must deliver 15 MPa ([[Chamber Pressure]] 8.2 MPa + cooling circuit [[Drop]] 5 MPa + injector drop 1.8 MPa)
- Cooling circuit pressure drop: 5 MPa (narrow channels, high [[Velocity]])
- [[Turbopump]] RP-1 pump designed for 15 MPa delivery

**[[Flow Rate]]**:
- Engine requires 4.8 kg/s RP-1 for combustion
- [[Same 4.8]] kg/s flows through [[Cooling Channels]]
- No separate cooling flow (regenerative design)

### With [[Propulsion System]]

**[[Startup]] Sequence** ([[See]] [[Ignition Sequence]]):
1. T-3s: [[Turbopump]] spin-up
2. T-2s: Fuel flow starts → cooling channels fill
3. T-1s: [[LOX Flow]] starts
4. T-0s: Ignition (chamber already cooled by fuel flow)

**Shutdown Sequence**:
1. T+0s: Throttle to idle (20% thrust)
2. T+1s: Cut LOX flow (combustion stops)
3. T+2s: Cut fuel flow (purges hot gas from chamber)
4. T+3s: [[Turbopump]] spin-down

### With [[Oxidizer System]]

**[[Heat Exchanger]] for [[Autogenous Pressurization]]**:
- Small LOX bleed (0.1 kg/s) from [[Oxidizer System]] tank
- LOX flows through heat exchanger coil on nozzle exterior
- Hot nozzle vaporizes LOX → Gaseous oxygen (GOX)
- GOX returns to oxidizer tank ullage (maintains pressure)

**[[Location]]**: Nozzle expansion section (radiation-cooled zone)
- Nozzle exterior temperature: 400-600°C (ideal for vaporization)
- No impact on regenerative cooling (separate flow paths)

## [[Testing Status]]

### [[Hot Fire Test Results]]

**[[Test 1]]** (30s burn, 2025-12-28):
- [[Focus]]: Ignition transient, startup thermal spike
- Result: ✅ Chamber wall temp peaked at 580°C, [[Stable]] [[After]] 5s
- [[Key]] [[Data]]: No thermal runaway, cooling effective immediately

**[[Test 2]]** (60s burn, 2025-12-30):
- Focus: Steady-state thermal [[Performance]]
- Result: ✅ Chamber wall stable at 575°C after 15s
- Key data: Thermal equilibrium reached, no gradual heating [[Trend]]

**Test 3** (120s burn, 2026-01-02):
- Focus: [[Extended Duration]], thermal margin validation
- Result: ✅ Chamber wall 595°C throughout burn
- Key data: No degradation over time, cooling sustained
- Post-test inspection: No erosion, no hot spots, channels intact

**[[Upcoming Tests]]**:
- **[[Test 4]]** (180s, [[Jan 8]]): Approaching mission duration
- **[[Test 5]]** (240s, [[Jan 15]]): [[Full Qualification]] burn

### [[Thermal Instrumentation]]

**Thermocouples**:
- 12× Type-K thermocouples embedded in chamber wall
- 4× at throat (highest heat flux region)
- 4× at chamber [[Mid]]-section
- 4× at nozzle entrance
- Sampling [[Rate]]: 100 Hz (captures transients)

**[[Pressure Sensors]]**:
- Cooling circuit [[Inlet Pressure]] (turbopump delivery)
- Cooling circuit [[Outlet Pressure]] (injector inlet)
- Pressure drop = 5.2 MPa (consistent with design)

**[[Flow Sensors]]**:
- RP-1 [[Mass Flow Rate]] (confirms 4.8 kg/s)
- Temperature sensors at inlet/outlet (confirms 50°C rise)

## [[Requirements Verification]]

### [[Performance Requirements]]
- [[PR]]-007: Chamber wall temperature <650°C ✅ (595°C measured)
- PR-008: Fuel temperature rise 40-60°C ✅ (50°C measured)
- PR-010: Burn duration ≥240s 🔄 (120s validated, 240s [[Planned]] Jan 15)

### [[Safety Requirements]]
- SAF-011: Cooling failure [[Detection]] <1s ✅ (thermocouple [[Monitoring]])
- SAF-012: Engine shutdown on cooling failure ✅ (abort logic validated)
- SAF-013: No burnthrough during nominal ops ✅ (3 tests passed)

## [[Design Heritage]]

**[[Similar Cooling Systems]]**:
- SpaceX Merlin 1D (regenerative cooling, RP-1 coolant)
- RS-25 [[Space Shuttle Main Engine]] (regenerative cooling, H2 coolant)
- F-1 Saturn V engine (regenerative cooling, RP-1 coolant)

**[[Technology Reuse]]**:
- Milled channel design widely used in industry
- OFHC copper + electroformed nickel standard construction
- Counter-flow cooling pattern proven approach

## Risks

### [[Active Risks]]

**No active risks** - thermal performance validated in testing

### [[Retired Risks]]

**R-011: [[Cooling Performance Uncertainty]]** ([[Retired Jan]] 2026)
- Concern: First engine, thermal model unvalidated
- Mitigation: Conservative [[Design Margins]], incremental [[Test Campaign]]
- [[Outcome]]: Test 1-3 showed <595°C wall temp (well below 650°C limit)
- Status: Retired after Test 3 success

## [[Failure Modes]]

### [[Cooling Failure Scenarios]]

**[[Fuel Flow Loss]]**:
- Cause: [[Turbopump]] failure, valve failure, line rupture
- Effect: No cooling → chamber burnthrough in <2 seconds
- Detection: Thermocouple spike, pressure drop
- Response: Immediate engine shutdown (abort)

**[[Channel Blockage]]**:
- Cause: Debris in fuel (unlikely - filtered at [[Fuel Tanks]])
- Effect: Local hot spot → potential burnthrough
- Detection: Thermocouple [[Shows]] local temperature spike
- Response: Engine shutdown (abort)

**Material Failure**:
- Cause: Manufacturing defect, fatigue crack
- Effect: Fuel leak into combustion chamber
- Detection: Pressure drop, fuel flow anomaly
- Response: Engine shutdown, propellant valve closure

### Mitigation

**Instrumentation**:
- 12 thermocouples [[Provide]] [[Redundant]] temperature monitoring
- Continuous monitoring at 100 Hz (rapid fault detection)
- [[Automated]] shutdown on temperature exceedance

**Design Margins**:
- 10% thermal margin (595°C operating, 650°C limit)
- Conservative CFD predictions (580°C predicted, 595°C measured)
- [[Material Selection]] (copper, [[Not]] aluminum - higher melting point)

**Testing**:
- Incremental test campaign validates thermal performance
- Post-test inspection confirms no degradation
- Builds confidence for [[Full]]-duration mission

## [[Documentation]]

**[[Design Documentation]]**:
- [[Cooling System Design Specification]] (this document)
- Thermal analysis (CFD, heat transfer calculations)
- Structural analysis (pressure vessel, thermal stress)
- Channel geometry and flow distribution

**Analysis**:
- CFD analysis (heat flux distribution, wall temperature)
- Thermal transient analysis (startup, shutdown)
- Thermal-structural analysis (thermal expansion, stress)

**[[Test Documentation]]**:
- [[Hot Fire Test]] reports (Tests 1-3 data and analysis)
- Thermocouple data plots (temperature vs time)
- Post-test inspection reports (visual, dimensional)

**[[Related]]**:
- [[Engine Design]] - Combustion chamber assembly
- [[Turbopump]] - Fuel delivery and pressure
- [[Fuel Tanks]] - RP-1 propellant source
- [[Propulsion System]] - System-level integration
- [[Ignition Sequence]] - Startup/shutdown sequencing
- [[Oxidizer System]] - Heat exchanger for GOX generation

**[[Project Management]]**:
- [[Project Roadmap]] - Schedule milestones
- [[Risk Register]] - R-011 (cooling performance)
- [[Engine Hot Fire Results]] - [[Test Data]] and analysis

---

*[[Last Updated]]: 2026-01-02 by [[David Kim]]*
*[[Next]] review: Post-Test 4 analysis (Jan 8), full qualification after Test 5*
