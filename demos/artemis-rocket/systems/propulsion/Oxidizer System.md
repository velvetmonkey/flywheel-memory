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
  - oxidizer
  - lox
  - cryogenic
---
# [[Oxidizer System]]

## [[Overview]]

The Artemis LOX (liquid oxygen) oxidizer [[System]] stores and delivers cryogenic propellant to the [[Propulsion System]]. The system manages the unique challenges of cryogenic fluids: boiloff, [[Thermal Protection]], and pressure control.

**[[Component Owner]]**: [[James Park]] ([[Structures System]] [[Lead]])
**[[Report To]]**: [[Marcus Johnson]] ([[Propulsion System]] Lead)
**[[Status]]**: 🟢 Fabrication [[Complete]], cryogenic [[Testing]] passed

## Specifications

| Parameter | Value | Units | Status |
|-----------|-------|-------|--------|
| **[[Oxidizer Type]]** | LOX (liquid oxygen) | - | ✅ Per [[ADR-001 Propellant Selection]] |
| **[[Usable Volume]]** | 145 | liters | ✅ Meets mission [[Requirements]] |
| **[[Total Volume]]** | 160 | liters | ✅ [[Includes 10]]% ullage |
| **[[Propellant Mass]]** | 165 | kg | ✅ 240s burn at 10.8 kg/s |
| **[[Tank Dry Mass]]** | 12 | kg | ✅ Within 14kg budget |
| **[[Design Pressure]]** | 0.5 | MPa | ✅ [[Validated]] in cryo [[Test]] |
| **[[Proof Pressure]]** | 0.75 | MPa | ✅ 1.5× [[Safety Factor]] |
| **[[Operating Pressure]]** | 0.3 | MPa | ✅ Adequate for [[Turbopump]] inlet |
| **Material** | [[Aluminum 2219]]-T87 | - | ✅ Cryogenic-rated |
| **[[LOX Temperature]]** | -183 | °C | ✅ Boiling point at 0.1 MPa |
| **[[Tank Length]]** | 1.15 | meters | ✅ Fits [[Airframe Design]] |
| **[[Tank Diameter]]** | 0.38 | meters | ✅ [[Matches]] [[Fuel Tanks]] diameter |
| **[[Boiloff Rate]]** | <2 | % per hour | ✅ Acceptable for mission |

## [[Design Features]]

### [[Cryogenic Tank Architecture]]

**Configuration**: Cylindrical barrel with domed ends
- Forward dome: 2:1 elliptical (efficient packing)
- Aft dome: Hemispherical (propellant outlet)
- Cylindrical section: 0.8m length (larger than fuel tank)

**[[Cryogenic Construction]]**:
- Friction stir welded aluminum 2219-T87 (cryogenic-rated)
- Minimum wall thickness: 3.0mm (thicker than fuel tank - thermal stress)
- Welded in clean room (oxygen cleanliness critical)
- [[Full]] penetrant dye inspection ([[Oxygen Compatibility]])

**Thermal Protection**:
- Spray-on foam insulation (SOFI) - 25mm thick
- Reduces boiloff to <2% per hour
- Painted white (solar reflection)
- Cork thermal protection at [[Engine]] interface

### [[Oxygen Cleaning]]

**[[Oxygen Service Requirements]]**:
- [[All]] [[Components]] [[Must]] be oxygen-clean (ASTM G93 standard)
- No hydrocarbons, oils, or organics (fire/explosion hazard)
- [[Cleaning]] process: Solvent degrease → aqueous clean → passivate
- White glove assembly in clean room

**[[Critical Safety]]**:
- LOX + contamination = [[Explosion Risk]]
- All fittings, valves, seals oxygen-compatible
- Teflon seals ([[Not]] rubber - incompatible with LOX)
- Stainless steel or aluminum [[Only]] (no organics)

### [[Pressurization System]]

**Pressurant**: Gaseous oxygen (GOX) - autogenous pressurization
**Source**: Heat exchanger on [[Cooling System]] (vaporizes LOX)
**[[Flow Path]]**:
1. Small LOX bleed from tank → Heat exchanger on engine
2. LOX vaporizes to GOX ([[Hot]] gas)
3. GOX returns to tank ullage → [[Maintains 0.3]] MPa

**Advantages**:
- No separate pressurant gas needed (saves mass)
- Propellant is oxygen - compatible with LOX
- Heat exchanger scavenges waste heat from engine

**Components**:
- Heat exchanger coil on [[Engine Design]] nozzle
- Pressure regulator ([[Maintains 0]].3 MPa)
- Relief valve: 0.4 MPa burst disc ([[Safety]])
- Fill/drain valve: [[Ground Operations]] only

### [[Propellant Feed]]

**[[Outlet Location]]**: Aft dome center (lowest point)
**[[Feed Line]]**: Stainless steel vacuum-jacketed line (prevents boiloff)
**Filtering**: 50-micron screen (finer than fuel - LOX cleanliness)
**[[Flow Rate]]**: 10.8 kg/s (nominal engine operation)

**[[Boiloff Management]]**:
- Pre-[[Launch]]: [[Ground]]-supplied LOX maintains full level
- Launch: Tank topped off at T-5 minutes
- Flight: Autogenous pressurization uses boiloff for pressurization
- Landing: Sufficient margin for [[Propulsive Landing]]

## [[Integration]]

### With [[Propulsion System]]

**[[Propellant Flow Path]]**:
1. [[LOX Tank]] → Vacuum-jacketed feedline → [[Turbopump]] LOX inlet
2. [[Turbopump]] → [[Engine Design]] main injector
3. Small bleed to heat exchanger → GOX pressurant

**[[Pressurization Dependency]]**:
- Tank pressure (0.3 MPa) prevents [[Turbopump]] cavitation
- Heat exchanger must operate whenever engine fires
- Insufficient pressure → cavitation → mission failure

### With [[Structures System]]

**Mounting**:
- Tank mounts to [[Airframe Design]] thrust structure [[Via]] 6 support brackets
- Allows thermal contraction (LOX is -183°C, airframe is ambient)
- Sliding mounts accommodate 5mm thermal shrinkage
- Cork thermal break prevents airframe icing

**[[Mass Distribution]]**:
- Full tank: 177 kg (165 kg LOX + 12 kg tank)
- Empty tank: 12 kg
- Center of gravity shifts during burn ([[GNC System]] accounts for [[This]])

### With [[Avionics System]]

**Instrumentation**:
- Tank pressure sensor (cryogenic-rated, 0-0.5 MPa) → [[Flight Computer]]
- LOX level sensor (capacitance type) → remaining oxidizer mass
- Temperature sensor (cryogenic thermocouple) → LOX temperature
- All [[Telemetry]] via CAN bus

**[[Autonomous Monitoring]]**:
- [[Flight Software]] monitors pressure and level
- Abort trigger if pressure or level out of range
- Low-oxidizer warning at 10% remaining
- Pre-launch boiloff [[Monitoring]]

## [[Fabrication Status]]

### Manufacturing

**Fabricator**: In-house ([[Structures Team]])
**Process**: Friction stir welding (FSW) in clean room
**[[Timeline]]**:
- Manufacturing: Sep-[[Nov 2025]] (3 months)
- Oxygen cleaning: Nov 2025
- Cryogenic testing: [[Dec 2025]]
- Insulation application: [[Dec]] 2025
- [[Completed]] on schedule

**[[Oxygen Cleaning Process]]**:
- Solvent degrease (removes oils)
- Aqueous clean (alkaline detergent)
- Acid passivation (removes [[Surface]] contamination)
- Final rinse (deionized water)
- Nitrogen purge and white-glove seal
- Visual inspection under UV light (detects organics)

**[[Quality Control]]**:
- ✅ Dimensional inspection (all tolerances met)
- ✅ Radiographic weld inspection (no defects)
- ✅ Oxygen cleanliness [[Verification]] (UV inspection passed)
- ✅ Cryogenic [[Proof Pressure Test]] (0.75 MPa at -183°C)
- ✅ [[Leak Test]] (helium mass spec, <1e-6 std-cc/s)
- ✅ [[Boiloff Test]] (<2% per hour measured)

### Testing

**[[Cryogenic Proof Test]]** (Dec 2025):
- Filled with liquid nitrogen (-196°C, colder than LOX)
- Pressurized to 0.75 MPa (1.5× [[Design]] pressure)
- Held for 10 minutes, no leaks detected
- Thermal cycling: 5 fill/drain cycles (validates weld fatigue)

**Boiloff Test** (Dec 2025):
- Filled with liquid nitrogen (LN2 safer than LOX for testing)
- Measured mass loss over 4 [[Hours]]
- Result: 1.8% per hour (below 2% requirement)
- Insulation performing well

**Oxygen Compatibility** (Dec 2025):
- All wetted components tested for oxygen compatibility
- GOX impact test ([[High]]-[[Velocity]] GOX on samples)
- No ignition observed ([[Safe]] for LOX service)

## [[Current Status]]

**Fabrication**: ✅ Complete
**Oxygen Cleaning**: ✅ Verified clean
**Testing**: ✅ All cryo tests passed
**Integration**: ✅ Installed in [[Airframe Design]]
**[[Flight Readiness]]**: ✅ [[Cleared]] for flight

**[[Outstanding Items]]**: [[None]]

## [[Requirements Verification]]

### [[System Requirements]]
- SR-005: Propellant capacity ≥240s burn ✅ (165 kg LOX, 240s at 10.8 kg/s)
- SR-006: Engine restart capability ✅ (autogenous pressurization validated)
- SR-008: Safe abort capability ✅ (relief valve, pressure monitoring)

### [[Performance Requirements]]
- [[PR]]-005: Tank pressure 0.3 MPa ±10% ✅ (regulator validated)
- PR-006: Propellant delivery [[Rate]] ≥11 kg/s ✅ (outlet sized for 12 kg/s max)
- PR-009: Boiloff rate <3% per hour ✅ (1.8% measured)

### [[Safety Requirements]]
- SAF-004: Pressure relief <1.1× design pressure ✅ (burst disc at 0.4 MPa)
- SAF-005: Leak rate <1e-5 std-cc/s ✅ (<1e-6 measured)
- SAF-007: Oxygen cleanliness per ASTM G93 ✅ (cleaning verified)
- SAF-009: No ignition [[Sources]] in LOX service ✅ (compatibility tested)

## [[Design Heritage]]

**[[Similar Tanks]]**:
- [[Falcon 9]] LOX tanks (aluminum, autogenous pressurization)
- Atlas V Centaur LOX tanks (stainless steel, similar insulation)
- Electron LOX tanks (composite, different approach)

**[[Technology Reuse]]**:
- Autogenous pressurization widely used (Falcon 9, Merlin engine)
- Spray-on foam insulation ([[Space Shuttle]] external tank heritage)
- Aluminum 2219 cryogenic rating proven (Saturn V heritage)

## Risks

### [[Active Risks]]

**No [[Active]] risks** - all testing complete, flight-[[Ready]] status

### [[Retired Risks]]

**R-009: LOX [[Tank Cryogenic Performance]]** ([[Retired Dec]] 2025)
- Concern: [[First]] cryogenic tank, boiloff uncertain
- Mitigation: LN2 testing, thermal analysis, insulation [[Optimization]]
- [[Outcome]]: [[Boiloff 1.8]]% per hour (below 2% requirement)
- Status: Retired [[After]] successful cryo tests

**R-010: [[Oxygen Cleaning Verification]]** (Retired Dec 2025)
- Concern: Oxygen cleanliness critical for safety
- Mitigation: Clean room assembly, UV inspection, compatibility testing
- Outcome: All inspections passed, GOX impact test successful
- Status: Retired after oxygen compatibility [[Validation]]

## [[Safety Considerations]]

### [[LOX Hazards]]

**Fire/Explosion [[Risk]]**:
- LOX is extremely reactive oxidizer
- Organic materials (oils, rubber, [[Fabric]]) combust spontaneously in LOX
- All components oxygen-clean and oxygen-compatible
- No smoking/open flames within 50 feet of LOX operations

**[[Cryogenic Hazards]]**:
- LOX is -183°C (instant frostbite on contact)
- Thermal shock can crack materials
- Condensed air/ice on exterior surfaces (oxygen [[Enrichment]] hazard)
- Insulation prevents exterior icing

**[[Asphyxiation Hazard]]**:
- LOX vaporizes to gaseous oxygen (displaces air in enclosed spaces)
- Oxygen-enriched atmospheres increase fire risk
- Vent system exhausts GOX overboard during ground operations
- Personnel trained on LOX [[Safety Procedures]]

### Safety Procedures

**Ground Operations**:
- LOX [[Loading]] performed by trained personnel only
- Full face shield, cryogenic gloves, protective clothing
- No organic materials within 10 feet of LOX [[Systems]]
- Continuous oxygen monitoring in work area

**[[Flight Operations]]**:
- [[Autonomous]] monitoring by [[Flight Software]]
- Abort triggers on pressure/level anomalies
- Vent system safes tank post-landing
- [[Remote]] safing procedures for pad emergencies

## [[Documentation]]

**[[Design Documentation]]**:
- [[Oxidizer System Design Specification]] (this document)
- Cryogenic thermal analysis (boiloff calculations)
- Structural analysis (cryogenic stress, thermal contraction)
- Pressurization system design (autogenous GOX system)

**[[Safety Documentation]]**:
- [[Oxygen Cleaning Procedures]] (ASTM G93 [[Compliance]])
- [[LOX Safety]] Procedures (ground and flight operations)
- Hazard analysis (FMEA for LOX system)
- Emergency response procedures

**[[Manufacturing Documentation]]**:
- Friction stir welding procedures (clean room protocols)
- Oxygen cleaning records and verification
- Quality control plan and inspection [[Criteria]]
- Dimensional drawings and tolerances

**[[Test Documentation]]**:
- Cryogenic proof pressure test [[Report]]
- Boiloff test report (LN2 testing)
- Leak test report (helium mass spec)
- Oxygen compatibility test report (GOX impact test)

**[[Related]]**:
- [[Propulsion System]] - System-level integration
- [[Fuel Tanks]] - RP-1 tank (sister component)
- [[Turbopump]] - Propellant pumping system
- [[Engine Design]] - Propellant consumer, heat exchanger [[Location]]
- [[Airframe Design]] - Tank mounting structure
- [[Cooling System]] - Heat exchanger for autogenous pressurization

**[[Project Management]]**:
- [[Project Roadmap]] - Schedule milestones
- [[Team Roster]] - Structures team
- [[Budget Tracker]] - Tank fabrication costs
- [[Risk Register]] - R-009 (boiloff), R-010 (oxygen cleaning)

**Decisions**:
- [[ADR-001 Propellant Selection]] - LOX selection rationale

---

*[[Last Updated]]: 2026-01-02 by [[James Park]]*
*[[Next]] review: Post-flight inspection, boiloff analysis*
