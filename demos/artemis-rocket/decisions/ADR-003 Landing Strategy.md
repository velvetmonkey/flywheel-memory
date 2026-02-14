---
type: decision
status: accepted
date: 2025-11-15
updated: 2025-11-15
decision_makers:
  - "[[Sarah Chen]]"
  - "[[Marcus Johnson]]"
  - "[[Elena Rodriguez]]"
tags:
  - adr
  - landing
  - decision
---
# ADR-003: [[Landing Strategy]]

## [[Status]]

**Accepted** - 2025-11-15

## [[Context]]

The [[Artemis Rocket]] is designed as a reusable [[Launch]] vehicle to reduce mission costs. The [[First]] stage [[Must]] [[Return]] to the launch [[Site]] and land safely for [[Reuse]]. The choice of [[Landing Strategy]] drives significant [[Design Decisions]] across [[Propulsion System]], [[GNC System]], [[Structures System]], and [[Avionics System]].

[[Key Constraints]]:
- Budget: $14M total program budget (limits exotic landing systems)
- Payload capacity: 250kg to LEO (landing system mass reduces payload)
- Timeline: 18-month development (favors proven approaches)
- Reusability target: 10 flights per stage (landing must be gentle)
- Safety: Must fail safe (abort to ocean if landing impossible)

**Mission Profile**:
- Ascent: 240 seconds to stage separation at 80 km altitude
- Boostback: Return trajectory to launch site
- Descent: Re-entry and terminal descent
- Landing: Vertical touchdown at launch pad

## Decision

**Selected: Propulsive Landing with Vertical Touchdown**

The first stage will perform a powered descent using the main [[Engine Design]], gimbaling for steering via [[Thrust Vector Control]], and touchdown vertically on deployable landing legs.

**Architecture**:
- Engine restart capability (cold-start after coast phase)
- Propellant reserves: 15% of total capacity for landing burn
- Landing legs: 4 deployable legs with crush core shock absorbers
- Guidance: [[Autopilot Software]] with [[IMU Selection]] and GPS navigation
- Landing zone: Concrete pad at launch site (0.5 km² target area)

## Alternatives Considered

### Option 1: Parachute Recovery (Ocean Splashdown)

**Advantages**:
- Simplest system (proven technology)
- Lowest development cost (~$50K for parachute [[System]])
- No propellant reserves needed (maximizes payload)
- No guidance complexity (passive descent)

**Disadvantages**:
- Ocean recovery expensive ($200K+ per mission for ship + crew)
- Saltwater corrosion damages rocket (extensive refurbishment)
- Parachute landing rough (5-10 m/s impact velocity)
- Weather-dependent (unsafe in high winds/seas)
- Recovery time delays turnaround (days to weeks)

**Conclusion**: Rejected - operational costs exceed development savings

### Option 2: Parachute Recovery (Land Touchdown)

**Advantages**:
- Moderate complexity (parachute + landing legs)
- No propellant reserves needed (maximizes payload)
- Land recovery faster than ocean (hours vs days)
- Proven heritage (Soyuz, Starliner capsules)

**Disadvantages**:
- Landing zone imprecise (10 km² dispersion with parachutes)
- High impact velocity (3-5 m/s even with retro-rockets)
- Landing legs heavy (must withstand hard impact)
- Requires large recovery area (logistics/land use)
- Refurbishment still needed after hard landing

**Conclusion**: Rejected - dispersion and impact velocity unacceptable

### Option 3: Helicopter Catch (Mid-Air Recovery)

**Advantages**:
- Zero-impact landing (gentlest recovery possible)
- Rocket Lab Electron heritage (proven concept)
- No landing legs needed (saves mass)
- Immediate inspection (still attached to helicopter)

**Disadvantages**:
- Extremely complex coordination (helicopter + falling rocket)
- Helicopter charter expensive ($50K+ per mission)
- Weather-dependent (winds >15 mph unsafe)
- Requires [[Specialized]] helicopter + crew training
- Single-point failure ([[Drop]] = mission loss)
- [[Rocket Lab]] took 3 years to perfect [[This]]

**[[Conclusion]]**: Rejected - too complex and risky for 18-[[Month]] program

### [[Option 4]]: [[Propulsive Landing]] (SpaceX-Style) - Selected

**Advantages**:
- Precise landing (<100m accuracy, demonstrated by [[Falcon 9]])
- Gentle touchdown (0.5-1 m/s vertical [[Velocity]])
- Rapid turnaround (inspect + refuel = [[Hours]], [[Not]] days)
- No refurbishment needed ([[Soft]] landing preserves [[Hardware]])
- Proven heritage (Falcon 9, Starship, [[Blue Origin]])
- Enables landing at launch site ([[Zero]] recovery logistics)

**Disadvantages**:
- Requires [[Engine]] restart capability (complexity)
- Propellant reserves reduce payload (~15% capacity for landing)
- Guidance complexity (real-time [[Trajectory Optimization]])
- [[Landing Legs]] needed (deployable mechanism)
- Higher [[Development Cost]] (~$300K for landing system)

**Conclusion**: **SELECTED** - operational savings justify higher development cost

### Option 5: Flyback with Wings (Airplane-Style)

**Advantages**:
- Horizontal landing (airplane runway)
- Minimal propellant for landing (glide approach)
- Proven heritage (Space Shuttle)

**Disadvantages**:
- Wings add significant mass (~20% of dry mass)
- Thermal protection needed for re-entry (tiles/blanket)
- Long runway required (3+ km)
- Complex aerodynamic design (wind tunnel testing)
- **Cost**: $2M+ for wings + TPS ([[Thermal Protection]] system)

**Conclusion**: Rejected - mass and cost penalties too [[High]]

## Rationale

### 1. [[Operational Cost Analysis]]

**[[Mission Cost Comparison]]** (per flight):

| [[Landing Method]] | Development Cost | Per-[[Flight Recovery]] | Refurbishment | [[Total]] (10 flights) |
|----------------|------------------|---------------------|---------------|--------------------|
| Ocean parachute | $50K | $200K | $100K | $3.05M |
| Land parachute | $150K | $50K | $50K | $1.15M |
| Helicopter catch | $200K | $50K | $20K | $0.90M |
| **Propulsive** | **$300K** | **$5K** | **$10K** | **$450K** |
| Flyback wings | $2.5M | $10K | $50K | $3.1M |

**Verdict**: Propulsive landing has highest upfront cost [[But]] lowest [[Total Cost]] over 10 flights

### 2. [[Payload Impact Analysis]]

**[[Propellant Budget]]**:
- Total propellant capacity: 241 kg (165 kg LOX + 76 kg RP-1)
- Landing burn propellant: 36 kg (15% of total)
- [[Available]] for ascent: 205 kg (85% of total)

**[[Payload Impact]]**:
- Without landing reserves: 250 kg payload to LEO
- With landing reserves: 210 kg payload to LEO
- **Payload reduction: 40 kg (16%)**

**Cost-Benefit**:
- Payload loss: $400/kg (launch service market rate) × 40 kg = $16K per mission
- Recovery savings: $295K per mission (vs ocean recovery)
- **Net savings: $279K per mission**

**Verdict**: 16% payload reduction acceptable for $279K per-mission savings

### 3. Turnaround Time Analysis

**Recovery Timelines**:

| Method | Recovery Time | Refurbishment | Total Turnaround |
|--------|---------------|---------------|------------------|
| Ocean parachute | 2-5 days | 2-4 weeks | 3-5 weeks |
| Land parachute | 4-8 hours | 1-2 weeks | 1-2 weeks |
| Helicopter catch | 1-2 hours | 2-5 days | 3-7 days |
| **Propulsive** | **Immediate** | **1-2 days** | **2-3 days** |

**Flight Rate Impact**:
- 2-week turnaround: 26 flights/year maximum
- 3-day turnaround: 120 flights/year maximum

**Verdict**: Propulsive landing enables rapid reuse (critical for high flight rate)

### 4. Landing Precision Requirements

**Landing Zone Comparison**:

| Method | Landing Precision | Recovery Area | Logistics |
|--------|-------------------|---------------|-----------|
| Ocean parachute | ±50 km | Ocean (ship patrol) | High (ship + crew) |
| Land parachute | ±5 km | 100 km² land area | Medium (ground crew) |
| Helicopter catch | ±1 km | 10 km² airspace | High (helicopter + pilot) |
| **Propulsive** | **±100m** | **Launch pad** | **Minimal** |

**Verdict**: Propulsive landing enables return to launch site (zero logistics overhead)

### 5. Reusability and Hardware Life

**Impact Velocity Comparison**:

| Method | Impact Velocity | Hardware Stress | Reuse Potential |
|--------|-----------------|-----------------|-----------------|
| Ocean parachute | 5-10 m/s | High (+ saltwater) | 1-2 flights |
| Land parachute | 3-5 m/s | Medium-high | 3-5 flights |
| Helicopter catch | 0 m/s | Minimal | 10+ flights |
| **Propulsive** | **0.5-1 m/s** | **Minimal** | **10+ flights** |

**Refurbishment Cost**:
- Hard landing (parachute): Structural inspection, tank re-certification, engine overhaul
- Soft landing (propulsive): Visual inspection, minor repairs, refuel

**Verdict**: Propulsive landing minimizes wear, enabling true reusability

## Implications

### [[Propulsion System]] Modifications

**Engine Restart Capability**:
- [[Engine Design]] must support cold restart after 3-5 minute coast
- [[Ignition Sequence]] modified for in-flight restart:
  - Ullage burn to settle propellants (small RCS thrusters)
  - Spin-up [[Turbopump]] with stored GN2 (gas generator bypass)
  - Standard ignition sequence (T-2s fuel flow → T-0s ignition)
- Restart testing required (validate reliability)

**Propellant Management**:
- [[Fuel Tanks]]: Ullage management system (capillary vanes + pressurant)
- [[Oxidizer System]]: LOX boiloff during coast phase (accept 2-5% loss)
- Propellant reserves: 15% of total capacity reserved for landing
- Tank pressurization: Maintain positive pressure during coast (prevent sloshing)

**Throttle Capability**:
- Engine must throttle 50-100% thrust (landing burn throttle-down)
- Implemented via [[Thrust Vector Control]] and propellant valve control
- Throttle response time: <200ms (for closed-loop guidance)

### [[GNC System]] Enhancements

**Landing Guidance Algorithm**:
- Powered descent guidance (PDG) algorithm
- Real-time trajectory optimization (minimize fuel use)
- Convex optimization solver (runs on [[Flight Computer]])
- Update rate: 10 Hz (re-plan trajectory every 100ms)

**Sensor Requirements**:
- [[IMU Selection]]: High-accuracy IMU (0.1 deg/hr gyro drift)
- GPS: Dual-frequency GPS for precise position (<1m accuracy)
- Radar altimeter: Precision altitude measurement (0-100m range)
- Grid fins: Deployable aerodynamic surfaces for atmospheric steering

**[[Autopilot Software]] Modes**:
- Boostback burn: Reverse velocity, target launch site
- Coast phase: Maintain attitude, monitor trajectory
- Re-entry: Grid fin control, manage descent rate
- Landing burn: Powered descent, precision touchdown
- Abort: Divert to ocean if landing impossible

### [[Structures System]] Additions

**Landing Legs**:
- 4 deployable legs (90° spacing around base)
- Crush core shock absorbers (aluminum honeycomb)
- Deployment mechanism: Pneumatic or spring-loaded
- Leg length: 3 meters (ground clearance for engine)
- Leg mass: 50 kg total (12.5 kg per leg)

**Grid Fins**:
- 4 fins (orthogonal pairs for pitch/yaw control)
- Titanium construction (survives re-entry heating)
- Deployment: Pneumatic actuators (stowed during ascent)
- Fin area: 0.5 m² per fin (sufficient control authority)
- Fin mass: 20 kg total (5 kg per fin)

**Structural Reinforcement**:
- Base structure reinforced for landing loads (2× thrust)
- Engine mount beefed up (off-axis landing loads)
- Tank supports reinforced (sloshing during descent)

### [[Avionics System]] Integration

**Sensor Suite**:
- Radar altimeter (0-100m precision altitude)
- Grid fin actuators (4× electric actuators)
- Landing leg deployment sensors (confirm locked position)
- Crush core load cells (touchdown detection)

**Data Logging**:
- Full telemetry during descent (10 kHz sampling)
- Landing video (onboard camera for post-flight analysis)
- GPS trajectory log (validate guidance performance)

### Performance Estimates

**Landing Burn Profile**:
- Ignition altitude: 2 km AGL (above ground level)
- Ignition velocity: 60 m/s (terminal velocity with grid fins)
- Burn duration: 20 seconds (decelerate to 0.5 m/s)
- Propellant consumption: 36 kg (15% of total)
- Final approach: Vertical descent at 0.5 m/s

**Landing Accuracy**:
- Target: Launch pad center (GPS coordinates)
- Dispersion: ±100m (3-sigma, 99.7% within circle)
- Success criteria: Land within 0.5 km² pad area

**Touchdown Conditions**:
- Vertical velocity: 0.5 m/s (gentle touchdown)
- Horizontal velocity: <0.2 m/s (minimal lateral drift)
- Attitude: <5° from vertical (upright landing)
- Crush core compression: 10-20% (energy absorption)

### Cost Impact

**Development Costs**:
- Landing guidance software: $80K (PDG algorithm, [[Testing]])
- Landing legs [[Design]] + fabrication: $60K
- Grid fins design + fabrication: $40K
- Engine restart testing: $50K (3-4 test campaigns)
- Integration and testing: $70K
- **Total [[Landing System]] development**: $300K (2.1% of $14M budget)

**Per-[[Flight Costs]]**:
- Propellant for landing burn: $150 (36 kg @ $4/kg average)
- Landing pad [[Maintenance]]: $50 (concrete inspection/repair)
- Post-landing inspection: $100 (visual + NDT [[Checks]])
- **Total per-flight landing cost**: $300

**10-Flight Savings vs Ocean Recovery**:
- Propulsive: $300K [[Dev]] + $3K operations = $303K
- Ocean: $50K dev + $3M operations = $3.05M
- **Savings: $2.75M over 10 flights**

### [[Risk Assessment]]

[[Technical Risks]]:
- ⚠️ Medium - Engine restart [[Reliability]] (requires 3-4 [[Test]] campaigns)
- ⚠️ Medium - [[Guidance Algorithm]] convergence ([[Computational]] limits)
- ✅ Low - Landing legs proven (SpaceX heritage)
- ✅ Low - Grid fins proven (Falcon 9 heritage)

[[Safety Risks]]:
- ⚠️ Medium - Propellant remaining for landing (must reserve enough)
- ⚠️ Medium - Guidance failure → abort to ocean (requires [[Safe]] abort trajectory)
- ✅ Low - Touchdown gentle enough to preserve hardware

[[Operational Risks]]:
- ✅ Low - Landing pad simple (concrete, no complex [[Systems]])
- ✅ Low - Weather tolerance (can land in higher winds than parachute)
- ⚠️ Medium - Guidance [[Software]] certification ([[Safety]]-critical code)

## [[Stakeholder Approval]]

**Decision makers**:
- [[Sarah Chen]] ([[Chief Engineer]]) - **Approved**
- [[Marcus Johnson]] ([[Propulsion Lead]]) - **Approved** (confident in restart capability)
- [[Elena Rodriguez]] ([[Avionics Lead]]) - **Approved** (guidance algorithm feasible)

**Consulted**:
- [[James Park]] ([[Structures Lead]]) - Supports (landing legs straightforward)
- External consultant (SpaceX alumni) - Recommends propulsive landing
- [[Team Roster]] - Team consensus

**Decision [[Date]]**: 2025-11-15
**Review [[Date]]**: Post-first landing (validate assumptions)

## [[Related Decisions]]

- [[ADR-001 Propellant Selection]] - Propellant type affects landing burn [[Performance]]
- [[ADR-002 Flight Computer]] - Guidance computation runs on [[Flight Computer]]
- [[ADR-004 Test Campaign]] - Engine restart testing [[Required]]
- Future ADR: Grid fin design ([[Material Selection]], size)

## [[References]]

- SpaceX Falcon 9 [[Landing Data]] ([[Powered Descent Guidance]] heritage)
- NASA [[Apollo Lunar Lander]] ([[Powered]] descent legacy)
- [[Blue Origin New Shepard]] (vertical landing heritage)
- Powered Descent Guidance for [[Mars Landing]] (convex [[Optimization]])

[[Related Notes]]:
- [[Landing Algorithm]] - PDG implementation ([[GNC System]])
- [[Landing System]] - Structures implementation
- [[Propulsion System]] - Engine restart capability
- [[Autopilot Software]] - Flight modes and guidance
- [[Flight Computer]] - Computation platform
- [[Engine Design]] - Restart modifications
- [[Fuel Tanks]] - [[Ullage Management]]
- [[Project Roadmap]] - Landing test schedule
- [[Risk Register]] - Landing-[[Related]] risks
- [[Budget Tracker]] - [[Cost Impact]]

---

*Decision recorded by [[Sarah Chen]] - 2025-11-15*
*[[Status]]: Accepted and [[Implemented]]*
