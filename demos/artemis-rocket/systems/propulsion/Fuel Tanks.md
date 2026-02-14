---
type: component
subsystem: propulsion
status: fabrication
owner: "[[Marcus Johnson]]"
created: 2025-07-15
updated: 2026-01-02
tags:
  - propulsion
  - tanks
  - structures
  - fabrication
---
# [[Fuel Tanks]]

## [[Overview]]

The Artemis RP-1 (rocket-[[Grade]] kerosene) fuel tank stores and delivers propellant to the [[Propulsion System]]. The tank is designed for [[Both]] ascent burn and [[Propulsive Landing]], with [[Ullage Management]] for [[Engine]] restart in microgravity.

**[[Component Owner]]**: [[James Park]] ([[Structures System]] [[Lead]])
**[[Report To]]**: [[Marcus Johnson]] ([[Propulsion System]] Lead)
**[[Status]]**: 🟢 Fabrication [[Complete]], leak [[Testing]] passed

## Specifications

| Parameter | Value | Units | Status |
|-----------|-------|-------|--------|
| **[[Fuel Type]]** | RP-1 (kerosene) | - | ✅ Per [[ADR-001 Propellant Selection]] |
| **[[Usable Volume]]** | 95 | liters | ✅ Meets mission [[Requirements]] |
| **[[Total Volume]]** | 105 | liters | ✅ [[Includes 10]]% ullage |
| **[[Propellant Mass]]** | 76 | kg | ✅ 240s burn at 4.8 kg/s |
| **[[Tank Dry Mass]]** | 8.5 | kg | ✅ Within 9kg budget |
| **[[Design Pressure]]** | 0.5 | MPa | ✅ [[Validated]] in pressure [[Test]] |
| **[[Proof Pressure]]** | 0.75 | MPa | ✅ 1.5× [[Safety Factor]] |
| **[[Operating Pressure]]** | 0.3 | MPa | ✅ Adequate for [[Turbopump]] inlet |
| **Material** | [[Aluminum 2219]]-T87 | - | ✅ Flight-proven alloy |
| **[[Tank Length]]** | 0.95 | meters | ✅ Fits [[Airframe Design]] |
| **[[Tank Diameter]]** | 0.38 | meters | ✅ [[Matches]] [[Oxidizer System]] diameter |

## [[Design Features]]

### [[Tank Architecture]]

**Configuration**: Cylindrical barrel with domed ends
- Forward dome: 2:1 elliptical (efficient packing)
- Aft dome: Hemispherical (propellant [[Outlet Location]])
- Cylindrical section: 0.6m length

**Construction**:
- Friction stir welded aluminum segments
- Minimum wall thickness: 2.5mm (pressure vessel)
- Reinforced outlet boss ([[Turbopump]] interface)
- Internal baffles for slosh damping

**[[Propellant Management]]**:
- Capillary vanes for ullage settling
- Gaseous nitrogen (GN2) pressurant
- Pressure regulator maintains 0.3 MPa
- Vent valve for [[Ground]] [[Loading]]/safing

### [[Pressurization System]]

**Pressurant**: Gaseous nitrogen (GN2)
**Storage**: Composite overwrapped pressure vessel (COPV) - 6 MPa storage
**[[Flow Path]]**:
1. GN2 COPV (6 MPa) → Pressure regulator → Fuel tank ullage (0.3 MPa)
2. Maintains constant pressure during engine burn
3. Prevents [[Turbopump]] cavitation (requires 0.3 MPa inlet)

**[[Components]]**:
- COPV bottle: 3 liter volume, 1.2 kg propellant
- Pressure regulator: Mechanical (dome-loaded)
- Relief valve: 0.4 MPa burst disc ([[Safety]])
- Fill/vent valve: Ground operations

### [[Propellant Feed]]

**Outlet [[Location]]**: Aft dome center (lowest point [[When]] vertical)
**[[Feed Line]]**: Flexible bellows (vibration isolation)
**Filtering**: 100-micron screen (protects [[Turbopump]] from debris)
**[[Flow Rate]]**: 4.8 kg/s (nominal engine operation)

**Ullage [[Management]]** (Propulsive Landing):
- Capillary vanes ensure propellant settles during coast
- GN2 pressurant pushes propellant to outlet
- Critical for engine restart in microgravity

## [[Integration]]

### With [[Propulsion System]]

**[[Propellant Flow Path]]**:
1. Fuel tank → Feedline → [[Turbopump]] RP-1 inlet
2. [[Turbopump]] → [[Cooling System]] regenerative channels
3. [[Cooling System]] → [[Engine Design]] main injector
4. Small bleed to [[Gas Generator]]

**[[Pressurization Dependency]]**:
- Tank pressure (0.3 MPa) [[Must]] exceed turbopump inlet requirement
- Insufficient pressure → cavitation → turbopump failure
- Over-pressure → tank rupture (relief valve prevents)

### With [[Structures System]]

**Mounting**:
- Tank mounts to [[Airframe Design]] thrust structure [[Via]] 4 support brackets
- Isolators dampen vibration from [[Engine Design]]
- Thermal protection layer (prevents RP-1 heating from engine)

**[[Mass Distribution]]**:
- [[Full]] tank: 84.5 kg (76 kg propellant + 8.5 kg tank)
- Empty tank: 8.5 kg
- Center of gravity shifts during burn (accounted for in [[GNC System]])

### With [[Avionics System]]

**Instrumentation**:
- Tank pressure sensor (0-0.5 MPa range) → [[Flight Computer]]
- Propellant level sensor (capacitive) → remaining fuel mass
- Temperature sensor (RP-1 temperature [[Monitoring]])
- [[All]] [[Telemetry]] via CAN bus to [[Flight Computer]]

**[[Autonomous Monitoring]]**:
- [[Flight Software]] monitors tank pressure
- Abort trigger if pressure out of range
- Low-fuel warning at 10% remaining

## [[Fabrication Status]]

### Manufacturing

**Fabricator**: In-house ([[Structures Team]])
**Process**: Friction stir welding (FSW) of aluminum segments
**[[Timeline]]**:
- Manufacturing: Aug-[[Oct 2025]] (3 months)
- Leak testing: [[Nov 2025]]
- Integration: [[Dec 2025]]
- [[Completed]] on schedule

**[[Quality Control]]**:
- ✅ Dimensional inspection (all tolerances met)
- ✅ Radiographic weld inspection (no defects)
- ✅ Hydrostatic pressure test (0.75 MPa proof pressure)
- ✅ [[Leak Test]] (helium mass spectrometer, <1e-6 std-cc/s)
- ✅ Final acceptance inspection passed

### Testing

**[[Proof Pressure Test]]** (Nov 2025):
- Pressurized to 0.75 MPa (1.5× [[Design]] pressure)
- Held for 5 minutes, no leaks detected
- Visual inspection showed no deformation

**Leak Test** (Nov 2025):
- Helium mass spectrometer leak check
- Leak [[Rate]]: <1e-6 std-cc/s (well below requirement)
- All welds passed

**[[Propellant Compatibility]]** ([[Dec]] 2025):
- Filled with RP-1, soaked for 48 [[Hours]]
- No material degradation observed
- RP-1 analysis showed no contamination

## [[Current Status]]

**Fabrication**: ✅ Complete
**Testing**: ✅ All tests passed
**Integration**: ✅ Installed in [[Airframe Design]]
**[[Flight Readiness]]**: ✅ [[Cleared]] for flight

**[[Outstanding Items]]**: [[None]]

## [[Requirements Verification]]

### [[System Requirements]]
- SR-005: Propellant capacity ≥240s burn ✅ (76 kg RP-1, 240s at 4.8 kg/s)
- SR-006: Engine restart capability ✅ (ullage management validated)
- SR-008: [[Safe]] abort capability ✅ (relief valve, pressure monitoring)

### [[Performance Requirements]]
- [[PR]]-005: Tank pressure 0.3 MPa ±10% ✅ (regulator validated)
- PR-006: Propellant delivery rate ≥5 kg/s ✅ (outlet sized for 6 kg/s max)

### [[Safety Requirements]]
- SAF-004: Pressure relief <1.1× design pressure ✅ (burst disc at 0.4 MPa)
- SAF-005: Leak rate <1e-5 std-cc/s ✅ (<1e-6 measured)
- SAF-006: Material compatibility with RP-1 ✅ (aluminum 2219 qualified)

## [[Design Heritage]]

**[[Similar Tanks]]**:
- [[Falcon 9]] RP-1 tanks (aluminum construction, friction stir welding)
- Atlas V RP-1 tanks (2219 aluminum heritage)
- Electron RP-1 tanks (composite, different approach)

**[[Technology Reuse]]**:
- Friction stir welding widely used in aerospace (NASA, SpaceX)
- Aluminum 2219-T87 flight-proven material
- Capillary vane ullage management from satellite propulsion

## Risks

### [[Active Risks]]

**No [[Active]] risks** - all testing complete, flight-[[Ready]] status

### [[Retired Risks]]

**R-008: [[Tank Fabrication Quality]]** ([[Retired Nov]] 2025)
- Concern: [[First]] in-house FSW tank, quality uncertain
- Mitigation: Extensive NDT (radiography, leak testing)
- [[Outcome]]: All tests passed, [[High]] quality weld
- Status: Retired [[After]] successful proof test

## [[Documentation]]

**[[Design Documentation]]**:
- [[Fuel Tank Design Specification]] ([[This]] document)
- Structural analysis (FEA stress analysis)
- Pressurization [[System]] design
- Propellant management system design

**[[Manufacturing Documentation]]**:
- Friction stir welding procedures
- Quality control plan and inspection [[Criteria]]
- Dimensional drawings and tolerances
- Weld maps and inspection records

**[[Test Documentation]]**:
- Proof pressure test [[Report]]
- Leak test report (helium mass spec)
- Propellant compatibility test report

**[[Related]]**:
- [[Propulsion System]] - System-level integration
- [[Oxidizer System]] - LOX tank (sister component)
- [[Turbopump]] - Propellant pumping system
- [[Engine Design]] - Propellant consumer
- [[Airframe Design]] - Tank mounting structure
- [[Cooling System]] - RP-1 flow path after turbopump

**[[Project Management]]**:
- [[Project Roadmap]] - Schedule milestones
- [[Team Roster]] - Structures team
- [[Budget Tracker]] - Tank fabrication costs

**Decisions**:
- [[ADR-001 Propellant Selection]] - RP-1 selection rationale

---

*[[Last Updated]]: 2026-01-02 by [[James Park]]*
*[[Next]] review: Post-flight inspection*
