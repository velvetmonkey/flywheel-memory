---
type: component
subsystem: structures
status: fabrication
owner: "[[James Park]]"
created: 2025-08-25
updated: 2026-01-02
---
# [[Landing System]]

## [[Overview]]

The **Artemis-1 Landing [[System]]** enables [[Powered]] [[Vertical Landing]] and reusability of the [[First]] stage. The system consists of four deployable [[Carbon]] [[Fiber]] [[Landing Legs]] that extend 60 seconds before touchdown and absorb landing impact loads up to 3g.

**[[Powered Landing Capability]]**:
- **[[Descent Mode]]**: Powered descent from 80 km apogee ([[Engine]] throttles to 25%)
- **[[Touchdown Velocity]]**: (5 m/s vertical ([[Soft]] landing)
- **[[Maximum Lateral Velocity]]**: 2 m/s (crosswind tolerance)
- **[[Landing Accuracy]]**: ±50 m from [[Target]] ([[GPS]]-guided descent)

**[[Landing Leg Design]]**:
- **Quantity**: 4 legs (90° spacing around airframe circumference)
- **Material**: Carbon fiber composite ([[High]] strength-to-weight ratio)
- **Deployment**: Pneumatic actuators (gaseous nitrogen, 200 psi)
- **Locking**: Over-center mechanism (mechanically locked [[When]] deployed)
- **Mass**: 32 kg [[Total]] (8 kg per leg assembly)

The landing system [[Design]] is inspired by **SpaceX [[Falcon 9]]** heritage (proven 200+ times) [[But]] scaled for the smaller Artemis vehicle. [[Key]] innovations include carbon fiber legs (vs. Falcon 9's aluminum) for mass savings and simplified pneumatic deployment (vs. hydraulic).

[[See]] [[Airframe Design]] for [[Landing Leg Attachment Fittings]] and [[GNC System]] for landing [[Guidance Algorithms]].

---

## [[Design Requirements]]

### [[Landing Conditions]]

**[[Nominal Landing]]**:
```
Touchdown velocity (vertical):   2.5 m/s (ideal soft landing)
Touchdown velocity (lateral):    0.5 m/s (minimal crosswind)
Landing surface:                 Concrete pad (launch site, prepared surface)
Surface slope:                   <2° (flat pad)
Vertical load:                   3× vehicle dry mass = 3 × 1200 kg = 36 kN
```

**Off-Nominal Landing** (worst-case design loads):
```
Touchdown velocity (vertical):   5.0 m/s (hard landing, 2× nominal)
Touchdown velocity (lateral):    2.0 m/s (crosswind, gusts)
Landing surface:                 Gravel (unprepared surface, compacted soil)
Surface slope:                   5° (uneven terrain)
Vertical load:                   6× vehicle dry mass = 72 kN (hard landing spike)
Lateral load:                    18 kN (lateral impact + wind)
```

**Factors of Safety**:
- **Ultimate Load**: 1.5× design limit load (FAA requirement for reusable launch vehicles)
- **Yield Load**: 1.25× design limit load (no permanent deformation below this load)

### Environmental Requirements

**Temperature Range**:
- **Pre-Launch**: -20°C to +50°C (seasonal extremes at launch site)
- **Ascent**: -65°C (cryogenic propellant exposure) to +120°C (aerodynamic heating)
- **Descent**: +200°C (re-entry heating at leg attachment points)

**Corrosion Protection**:
- **Environment**: Coastal launch site (salt spray, humidity)
- **Protection**: Anodize (aluminum components), corrosion-resistant coatings (steel components)

**Reusability Target**:
- **Design Life**: 10 flights (reflightable with inspection between flights)
- **Inspection Interval**: Visual inspection after each landing, NDT (non-destructive testing) after 5 flights

---

## Leg Design

### Geometry and Configuration

**Leg Layout** (4 legs, 90° spacing):
```
        ┌─────┐
        │  N  │ (Leg 1, 0°)
    ┌───┴─────┴───┐
    │      |      │
W ──┤  4   +   2  ├── E (Legs 2 & 4, 90° and 270°)
    │      |      │
    └───┬─────┬───┘
        │  S  │ (Leg 3, 180°)
        └─────┘

Side view (leg deployed):
        ┌──── Airframe
        │
        ├──── Attachment fitting (1 m from aft bulkhead)
        │
        └─┐
          │ Landing leg (2.5 m length)
          │ (60° deployment angle from vertical)
          │
          └─── Foot pad (contact surface)

Footprint:
  Deployed leg span: 4.3 m (wingtip to wingtip)
  Stability margin: 2.9× (ratio of footprint to CG height)
```

**Leg Dimensions**:
- **Stowed Length**: 2.2 m (folded against airframe during ascent)
- **Deployed Length**: 2.5 m (extension during deployment)
- **Deployment Angle**: 60° from vertical (provides wide stability footprint)
- **Foot Pad Diameter**: 0.4 m (distributes load over soil)

### Structural Design

**Leg Construction**:
```
Primary Strut (main load-bearing member):
  Material:       Carbon fiber composite (T700S/8552 epoxy, same as [[Fairing Design]])
  Layup:          [0°/±45°/90°]ₛ (quasi-isotropic, 12 plies)
  Cross-section:  Tubular (100 mm outer diameter, 3 mm wall thickness)
  Length:         2.2 m (stowed), 2.5 m (deployed, telescoping section)
  Mass:           3.2 kg per leg

Secondary Strut (diagonal bracing):
  Material:       Aluminum-lithium 2195 (same as [[Airframe Design]])
  Cross-section:  Rectangular tube (40 mm × 60 mm, 2 mm wall)
  Length:         1.8 m
  Mass:           1.5 kg per leg

Foot Pad:
  Material:       Aluminum 6061-T6 (impact-resistant, repairable)
  Diameter:       0.4 m (circular pad)
  Thickness:      10 mm (withstands soil bearing pressure)
  Crushing Material: Aluminum honeycomb (energy absorption during landing)
  Mass:           2.1 kg per leg

Attachment Fitting:
  Material:       Titanium Ti-6Al-4V (high strength, corrosion-resistant)
  Configuration:  8× M8 bolts to airframe doubler plate (see [[Airframe Design]])
  Mass:           1.2 kg per leg

Total Mass per Leg: 3.2 + 1.5 + 2.1 + 1.2 = 8.0 kg
Total System Mass: 4 legs × 8.0 kg = 32 kg
```

### Structural Analysis

**Finite Element Model**:
- **Tool**: ANSYS Mechanical 2024 R1
- **Mesh**: 42,000 elements (composite shell + beam + solid elements)
- **Boundary Conditions**: Fixed at attachment fitting, contact at foot pad (ground surface)

**Load Cases**:

**LC-1: Vertical Landing (3g nominal)**
- **Vertical Load**: 3 × 1200 kg × 9.81 m/s² = 35.3 kN (distributed across 4 legs)
- **Load per Leg**: 35.3 / 4 = 8.8 kN
- **Max Stress**: 125 MPa (primary strut, axial compression)
- **Margin**: 600 MPa (CFRP compressive strength) / 125 MPa = **4.8×** ✅

**LC-2: Hard Landing (6g worst-case)**
- **Vertical Load**: 6 × 1200 kg × 9.81 m/s² = 70.6 kN
- **Load per Leg**: 70.6 / 4 = 17.7 kN
- **Max Stress**: 285 MPa (primary strut, peak load)
- **Margin**: 600 / 285 = **2.1×** ✅ (exceeds 1.5× ultimate factor of safety)

**LC-3: Lateral Wind Load (landing in crosswind)**
- **Lateral Load**: 18 kN (2 m/s lateral velocity + 10 m/s wind gust)
- **Load Distribution**: 2 windward legs take majority of load (12 kN each)
- **Max Stress**: 210 MPa (secondary strut, bending + compression)
- **Margin**: 520 MPa (Al-Li yield) / 210 MPa = **2.5×** ✅

**LC-4: Uneven Terrain (5° slope)**
- **Load Distribution**: 3 legs contact ground, 1 leg airborne
- **Max Load per Leg**: 35.3 × 3 / 2 = 23.5 kN (two downhill legs share load)
- **Max Stress**: 320 MPa (primary strut, asymmetric loading)
- **Margin**: 600 / 320 = **1.9×** ✅

**Buckling Analysis**:
- **Critical Load**: 95 kN per leg (Euler column buckling of primary strut)
- **Actual Load**: 17.7 kN (hard landing case)
- **Buckling Margin**: 95 / 17.7 = **5.4×** (no buckling risk)

---

## Deployment System

### Pneumatic Actuation

**Deployment Mechanism**: Pneumatic linear actuators (gas-powered cylinders)

**Pneumatic System**:
```
Gas Storage:
  Gas:              Gaseous Nitrogen (GN₂, inert, non-corrosive)
  Pressure:         3000 psi (20.7 MPa, stored in composite overwrapped pressure vessel)
  Volume:           2 liters (COPV tank volume)
  Mass (stored):    50 g (nitrogen gas mass at 3000 psi)

Regulator:
  Input Pressure:   3000 psi (from COPV)
  Output Pressure:  200 psi (1.38 MPa, regulated for actuators)
  Type:             Spring-loaded dome regulator (mechanical, no electronics)

Actuators (4× cylinders, one per leg):
  Bore Diameter:    40 mm (piston area = π × 0.02² = 0.00126 m²)
  Stroke:           300 mm (extends leg from stowed to deployed position)
  Force:            200 psi × 0.00126 m² = 1750 N (sufficient to overcome leg mass + friction)
  Deployment Time:  2 seconds (gas fills cylinder, extends piston)

Solenoid Valves (4× valves, one per leg):
  Type:             Normally-closed (fail-safe, legs stay stowed if no power)
  Actuation:        28V DC, 2A (from [[Power Distribution]])
  Response Time:    50 ms (valve opens rapidly when commanded)
```

**Deployment Sequence**:
```
T-60s (60 seconds before touchdown):
  1. [[Flight Software]] commands deployment (altitude < 1000 m trigger)
  2. Solenoid valves energize (open gas flow to actuators)
  3. GN₂ flows from COPV → regulator → actuators
  4. Actuator pistons extend, pushing legs outward (T-60s to T-58s, 2-second deployment)
  5. Legs reach deployed position, over-center locks engage (mechanical lock, no power required)
  6. Solenoid valves de-energize (gas flow stops, pressure holds legs deployed)

T-10s to T-0 (final descent):
  - Legs remain deployed and locked (no additional commands)
  - [[Autopilot Software]] guides vehicle to landing pad
  - Touchdown at T-0 (5 m/s vertical velocity, nominal)
```

### Locking Mechanism

**Over-Center Lock** (mechanical latch, self-locking):

**Operating Principle**:
```
Stowed Position:
  ┌──── Airframe
  │
  ├─ Hinge pin
  │ \
  │  \ Leg (folded up, 20° from vertical)
  │   \_____ Spring preload (holds leg against airframe)

Deploying:
  ┌──── Airframe
  │
  ├─ Hinge pin (rotates as pneumatic actuator extends)
  │  \
  │   \
  │    \ Leg (rotating outward, 45°)

Deployed & Locked:
  ┌──── Airframe
  │
  ├─ Hinge pin (passed center, lock engaged)
  │   \
  │    \_____ Leg (60° from vertical, over-center position)
  │
  Lock mechanism: Hinge geometry creates over-center condition
  - Deployment force pushes leg past 90° (center)
  - Gravity + spring pulls leg into locked position (60°)
  - Axial loads compress lock (can't unlock under compression)
```

**Lock Features**:
- **Self-Locking**: Over-center geometry prevents leg from retracting under load
- **No Power Required**: Mechanical lock (stays locked even if power fails)
- **Release**: Manual ground crew operation (unlock via release pin, retract leg for transport)

**Lock Verification**:
- Static load test: Leg loaded to 25 kN (1.4× design load) while locked
- No movement detected (<0.1 mm deflection at hinge)
- Lock mechanism reliable ✅

---

## Energy Absorption

### Foot Pad Design

**Aluminum Honeycomb Crush Core** (energy absorber at foot pad):

**Design**:
```
Honeycomb Core:
  Material:         Aluminum 5052 (lightweight, high energy absorption)
  Cell Size:        6 mm (hexagonal cells)
  Core Thickness:   50 mm (crushes during landing impact)
  Density:          80 kg/m³ (relative density 8% - mostly air, highly crushable)
  Crush Strength:   3 MPa (stress at which honeycomb crushes)

Foot Pad (top and bottom face sheets):
  Material:         Aluminum 6061-T6 (10 mm thick)
  Function:         Distribute load into honeycomb core
```

**Energy Absorption Analysis**:

**Hard Landing (5 m/s vertical velocity)**:
```
Kinetic Energy (per leg):
  Mass per leg:     1200 kg / 4 = 300 kg
  Velocity:         5 m/s (vertical touchdown velocity)
  KE:               ½ m v² = ½ × 300 × 5² = 3750 J

Energy Absorbed by Honeycomb:
  Crush force:      3 MPa × (π × 0.2²) = 377 N (per leg, assuming 0.4 m diameter foot pad crushes uniformly)
  Wait, this is wrong. Let me recalculate.

  Foot pad area:    π × 0.2² = 0.126 m²
  Crush stress:     3 MPa (constant during crushing)
  Crush force:      3 × 10⁶ Pa × 0.126 m² = 378 kN (force during crushing)

  Crush distance:   KE / Force = 3750 J / 378000 N = 0.01 m = 10 mm

  Available crush:  50 mm (honeycomb thickness)
  Margin:           50 / 10 = 5× (sufficient energy absorption capacity)
```

**Acceleration Limit**:
```
Peak deceleration during crush:
  F = m × a
  a = F / m = 378000 N / 300 kg = 1260 m/s² = 128 g

This exceeds 6g design limit! Issue found.
```

**Revised Design** (softer honeycomb, lower crush strength):
```
Corrected honeycomb crush strength: 0.5 MPa (lower density honeycomb)
Crush force: 0.5 × 10⁶ × 0.126 = 63 kN
Peak deceleration: 63000 / 300 = 210 m/s² = 21 g

Still high. Let's increase foot pad area.

Foot pad diameter increased to 0.6 m (was 0.4 m):
  Area: π × 0.3² = 0.283 m²
  Crush force: 0.5 × 10⁶ × 0.283 = 141 kN
  Peak deceleration: 141000 / 300 = 470 m/s² = 48 g

Still too high for avionics survival. Need different approach.
```

**Final Design** (progressive crush with spring preload):
```
Approach: Dual-stage energy absorption
  1. Spring (initial impact, low force)
  2. Honeycomb crush (final arrest, higher force)

Spring Stage:
  Spring rate: 50 kN/m (stiff compression spring in foot pad)
  Compression: 100 mm (spring compresses first)
  Energy absorbed: ½ k x² = ½ × 50000 × 0.1² = 250 J
  Peak force: k × x = 50000 × 0.1 = 5 kN
  Peak deceleration: 5000 / 300 = 16.7 m/s² = 1.7 g (gentle initial deceleration)

Honeycomb Stage:
  Remaining energy: 3750 - 250 = 3500 J
  Honeycomb crush strength: 1.5 MPa (medium density)
  Foot pad area: 0.126 m² (0.4 m diameter, original size works with spring)
  Crush force: 1.5 × 10⁶ × 0.126 = 189 kN
  Crush distance: 3500 / 189000 = 0.0185 m = 18.5 mm
  Available crush: 50 mm (adequate margin)
  Peak deceleration: 189000 / 300 = 630 m/s² = 64 g (short duration spike, acceptable)

Total crush travel: 100 mm (spring) + 18.5 mm (honeycomb) = 118.5 mm
Landing gear stroke: 150 mm (available stroke)
Margin: 150 / 118.5 = 1.27× (adequate)
```

**Revised Foot Pad Design**:
- **Spring**: 50 kN/m compression spring (100 mm travel)
- **Honeycomb**: Aluminum honeycomb crush core (50 mm thick, 1.5 MPa crush strength)
- **Peak Deceleration**: 64 g (short duration, acceptable for structure - avionics protected by isolation mounts)

---

## Landing Gear Stroke and Damping

### Stroke Analysis

**Stroke Budget** (vertical travel during landing):
```
Component                   Travel    Notes
Spring compression          100 mm    Initial impact (absorbs 250 J)
Honeycomb crush             19 mm     Final arrest (absorbs 3500 J)
Tire deflection             10 mm     Foot pad deformation (minor)
Structural deflection       5 mm      Leg bending (elastic, minor)
────────────────────────────────────────────────────────
Total stroke required       134 mm    (at 5 m/s hard landing)

Available stroke            150 mm    (design margin)
Margin                      16 mm     (12% margin, adequate)
```

**Damping** (prevent bounce):
- **Problem**: Spring-only system will bounce vehicle after landing (spring rebounds)
- **Solution**: Oleo damper (hydraulic shock absorber)
  - Oleo strut: Oil-filled cylinder with piston (restricts oil flow during compression)
  - Damping coefficient: 5000 N·s/m (critical damping)
  - Effect: Dissipates energy as heat (prevents bounce, vehicle settles in <1 second)

**Oleo Strut Design**:
```
Cylinder:
  Material:         Steel 4340 (high strength, corrosion-resistant coating)
  Bore Diameter:    60 mm
  Stroke:           150 mm
  Oil:              MIL-PRF-5606 hydraulic fluid (aerospace standard)
  Gas Charge:       Nitrogen (30 psi precharge, prevents cavitation)

Piston:
  Orifice Diameter: 3 mm (restricts oil flow, creates damping)
  Seal:             Viton O-ring (high-temperature, chemical-resistant)
```

### Ground Clearance

**Vehicle Ground Clearance** (deployed legs):
```
Airframe ground clearance:  0.6 m (bottom of airframe to ground)
Engine nozzle clearance:    0.8 m (nozzle exit plane to ground)
Plume impingement:          No ground contact (plume expands beyond footprint)
```

**Clearance Requirements**:
- **Minimum Engine Clearance**: 0.5 m (prevent debris ingestion during landing burn)
- **Actual Clearance**: 0.8 m (60% margin) ✅
- **Rough Terrain**: 0.6 m clearance allows 5° slope landing (see LC-4 analysis)

---

## Testing and Validation

### Component Testing

**Leg Drop Test** (single leg test):
- **Objective**: Validate energy absorption and structural strength
- **Test Setup**: Leg assembly mounted to drop tower, released from height
- **Drop Height**: 1.3 m (equivalent to 5 m/s impact velocity)
- **Instrumentation**:
  - Load cell at foot pad (measure impact force)
  - Accelerometer at attachment fitting (measure deceleration)
  - High-speed camera (film crush behavior)
- **Results**:
  - Peak force: 141 kN (close to 189 kN prediction, test used lower drop mass)
  - Peak deceleration: 52 g (within 64 g prediction)
  - Honeycomb crush: 22 mm (close to 19 mm prediction)
  - No structural damage ✅

**Deployment Test** (pneumatic system):
- **Objective**: Verify reliable deployment and locking
- **Test Setup**: Leg assembly with pneumatic actuator, suspended vertically
- **Test Matrix**: 50 deployments (statistical reliability test)
- **Results**:
  - 50/50 successful deployments (100% reliability)
  - Deployment time: 1.8 ± 0.2 seconds (within 2-second spec)
  - Lock engagement: 50/50 successful (over-center lock reliable)

### Full-Scale Landing Test

**Soft Landing Test** (2.5 m/s vertical, nominal):
- **Test Article**: Full-scale mockup (1200 kg mass, representative CG)
- **Test Setup**: Suspended from crane, released from 0.3 m height (2.5 m/s impact)
- **Results**:
  - All 4 legs contacted simultaneously (within 10 ms)
  - Spring compression: 48 mm (energy absorbed as predicted)
  - No honeycomb crush (spring sufficient for soft landing)
  - Vehicle stable, no tip-over ✅

**Hard Landing Test** (5.0 m/s vertical, off-nominal):
- **Test Setup**: Released from 1.3 m height (5.0 m/s impact)
- **Results**:
  - Peak deceleration: 58 g (within 64 g prediction)
  - Honeycomb crush: 21 mm (close to 19 mm prediction)
  - Structural inspection: No cracks, no permanent deformation ✅
  - Vehicle stable after landing ✅

**Lateral Load Test** (crosswind landing):
- **Test Setup**: Pendulum test (swing mockup into landing legs at 2 m/s lateral velocity)
- **Results**:
  - Lateral force: 16 kN (close to 18 kN prediction)
  - Leg deflection: 25 mm (elastic, fully recovered)
  - No tip-over (vehicle stable under lateral load) ✅

**Uneven Terrain Test** (5° slope):
- **Test Setup**: Landing pad tilted 5°, mockup released from 0.3 m height
- **Results**:
  - 3 legs contacted (1 leg airborne as predicted)
  - Load distribution asymmetric (2 downhill legs took majority of load)
  - Vehicle stable, no tip-over ✅

---

## Stability Analysis

### Static Stability

**Tip-Over Criteria**:
```
Stability Margin = Footprint Radius / CG Height

Where:
  Footprint Radius = 2.15 m (half of 4.3 m leg span)
  CG Height = 6.2 m (empty vehicle CG, measured from ground)

Stability Margin = 2.15 / 6.2 = 0.347 (34.7%)
```

**Industry Standard**: 25% minimum stability margin (Artemis exceeds this) ✅

**Tip-Over Wind Speed**:
```
Worst-case: Maximum wind that vehicle can withstand without tipping

Overturning Moment (wind):
  Wind Force = ½ ρ V² A C_D
  Where:
    ρ = 1.225 kg/m³ (air density at sea level)
    V = wind speed (unknown, solving for this)
    A = 12 m × 1.5 m = 18 m² (side area of vehicle)
    C_D = 1.2 (drag coefficient, cylindrical shape)

  Wind Force = ½ × 1.225 × V² × 18 × 1.2 = 13.23 V² (Newtons)

  Moment Arm = 6.2 m (CG height)
  Overturning Moment = 13.23 V² × 6.2 = 82.0 V² (N·m)

Restoring Moment (vehicle weight):
  Weight = 1200 kg × 9.81 m/s² = 11,772 N
  Moment Arm = 2.15 m (footprint radius)
  Restoring Moment = 11,772 × 2.15 = 25,310 N·m

Tip-Over Condition (when overturning moment = restoring moment):
  82.0 V² = 25,310
  V² = 309
  V = 17.6 m/s = 63 km/h (39 mph wind speed required to tip over)
```

**Operational Wind Limit**: 10 m/s (36 km/h, 22 mph) - conservative limit for safe landing
- **Margin**: 17.6 / 10 = **1.76×** (76% margin above operational limit)

### Dynamic Stability

**Landing Dynamics Simulation** (6-DOF model):
- **Tool**: MATLAB/Simulink (multibody dynamics simulation)
- **Inputs**: Touchdown velocity (vertical + lateral), landing leg stiffness, CG location
- **Outputs**: Vehicle motion after touchdown (rotation, translation, settling time)

**Nominal Landing Simulation** (2.5 m/s vertical, 0.5 m/s lateral):
- Vehicle settles in 0.8 seconds (single bounce, damped out)
- Maximum tilt angle: 3° (minimal, vehicle nearly vertical)
- Lateral displacement: 0.2 m (stays within landing pad)

**Off-Nominal Simulation** (5.0 m/s vertical, 2.0 m/s lateral):
- Vehicle settles in 1.5 seconds (two bounces, damped out)
- Maximum tilt angle: 8° (larger but stable, no tip-over)
- Lateral displacement: 0.6 m (stays within 10 m landing pad)

**Worst-Case Simulation** (5.0 m/s vertical, 2.0 m/s lateral, 5° slope, 1 leg fails to deploy):
- Vehicle lands on 3 legs (asymmetric loading)
- Maximum tilt angle: 15° (large tilt, but recovers)
- Vehicle settles in 2.5 seconds (heavy damping from oleo struts)
- **No Tip-Over** ✅ (still within stability margin)

---

## Reusability and Inspection

### Post-Landing Inspection

**Level 1 Inspection** (after every landing):
```
Visual Inspection:
  - Leg structure (look for cracks, deformation, corrosion)
  - Foot pads (check honeycomb crush depth, spring compression)
  - Hinges and locks (verify proper engagement, no wear)
  - Pneumatic actuators (check for leaks, damage)

Functional Test:
  - Deploy/retract legs (verify pneumatic system operation)
  - Load test (apply 1.1× design load, measure deflection)

Acceptance Criteria:
  - No visible cracks or damage
  - Honeycomb crush <30 mm (60% of available crush, remaining margin for next flight)
  - Deployment time <2.5 seconds (within tolerance)
```

**Level 2 Inspection** (after 5 landings):
```
Non-Destructive Testing (NDT):
  - Ultrasonic inspection (detect internal delamination in CFRP legs)
  - X-ray inspection (detect cracks in titanium fittings)
  - Dye penetrant inspection (surface cracks in aluminum components)

Dimensional Inspection:
  - Measure leg lengths (check for permanent deformation)
  - Measure hinge clearances (check for wear)

Pneumatic System Service:
  - Replace solenoid valve seals (prevent gas leaks)
  - Recharge COPV (if pressure dropped below 2500 psi)
```

**Component Replacement**:
- **Honeycomb Crush Core**: Replace if crushed )30 mm (reusable up to this limit)
- **Oleo Seals**: Replace every 10 flights (preventive maintenance)
- **Springs**: Replace if permanent set >5 mm (indicates fatigue)

### Refurbishment Cost

**Per-Flight Consumables**:
```
Honeycomb replacement (if crushed):   $2,500 (4 foot pads × $625 each)
Oleo seal replacement (every 10 flights): $400 (prorated: $40/flight)
Inspection labor (2 technicians, 4 hours): $800
────────────────────────────────────────────────────────
Total refurbishment cost per flight:   ~$3,340
```

**Comparison**:
- New landing legs (if [[Not]] reusable): $80,000 (4 legs × $20K [[Each]])
- Reusability savings: $80,000 - $3,340 = **$76,660 per flight**
- **ROI**: Landing system pays for itself after ~1 flight

---

## Current Status

**Fabrication Status**: 🟢 **On Track**
- Primary struts (CFRP): Fabrication complete (4/4 delivered 2025-11-30)
- Secondary struts (Al-Li): Fabrication complete (4/4 delivered 2025-12-05)
- Foot pads: Fabrication in progress (2/4 complete, 2/4 scheduled for 2026-01-10)
- Pneumatic actuators: Procured (4/4 delivered 2025-12-15)

**Testing Status**:
- Leg drop test: ✅ Complete (passed 2025-11-10)
- Deployment test: ✅ Complete (passed 2025-12-01)
- Full-scale landing test: ✅ Complete (all scenarios passed 2025-12-20)

**Integration Status**: ⏳ **Scheduled**
- Integration to airframe: Scheduled 2026-02-01
- Pneumatic system integration: Scheduled 2026-02-05
- Final functional test: Scheduled 2026-02-10

**Open Issues**:
1. **Foot pad honeycomb sourcing** (minor supply chain delay)
   - Issue: Preferred supplier (Hexcel) has 6-week lead time
   - Mitigation: Ordered early, delivery expected 2026-01-08
   - Impact: None (on schedule)
2. **Oleo strut seal leak** (detected during deployment test #37)
   - Issue: Viton O-ring leaked hydraulic fluid during high-pressure stroke
   - Root Cause: O-ring groove too deep (0.1 mm tolerance stack-up)
   - Fix: Replace O-ring with larger cross-section (AS568-224 instead of AS568-222)
   - Verification: Re-test successful (no leaks in 13 subsequent tests) ✅

**Upcoming Milestones**:
- 2026-01-10: Final foot pad delivery
- 2026-02-01: Landing leg integration to airframe
- 2026-02-10: Full system functional test (deployment + retraction cycle)
- 2026-03-01: Final acceptance for [[Critical Design Review|CDR]]

---

## Lessons Learned

### Design Phase

**Lesson 1**: Carbon fiber legs saved 18 kg vs. aluminum
- **Observation**: CFRP primary struts 45% lighter than Al-Li equivalent
- **Benefit**: 18 kg mass savings → 18 kg additional payload capacity
- **Trade-off**: CFRP more expensive ($12K vs. $4K material cost), but worth it for reusability

**Lesson 2**: Dual-stage energy absorption required for hard landings
- **Observation**: Initial design (honeycomb only) caused 128 g peak deceleration (unacceptable)
- **Solution**: Added spring stage (gentle initial deceleration, followed by honeycomb arrest)
- **Result**: Peak deceleration reduced to 64 g (acceptable)

**Lesson 3**: Stability margin critical for tip-over prevention
- **Observation**: Early design had 3.5 m leg span (0.27 stability margin, marginal)
- **Change**: Increased span to 4.3 m (0.35 stability margin, comfortable)
- **Impact**: 3 kg mass penalty (longer legs), but improved safety significantly

### Fabrication Phase

**Lesson 4**: CFRP leg layup requires precision
- **Observation**: First leg fabrication had ±15° fiber misalignment (exceeded ±5° tolerance)
- **Root Cause**: Hand layup technique inconsistent
- **Fix**: Implemented automated fiber placement (AFP machine, ±1° tolerance)
- **Cost**: $8K AFP setup cost, but improved quality (no scrap)

### [[Test Phase]]

**[[Lesson 5]]**: [[Hard Landing]] [[Test]] crushed more honeycomb than predicted
- **Observation**: [[Predicted 19]] mm crush, measured 21 mm crush (11% higher)
- **[[Root cause]]**: Honeycomb crush strength lower than datasheet (manufacturing variation)
- **Impact**: [[None]] (50 mm [[Available]] crush, adequate margin)
- **Future**: Test honeycomb samples before finalizing design (validate datasheet values)

**[[Lesson 6]]**: [[Uneven Terrain]] landing is critical [[Failure Mode]]
- **Observation**: 5° slope test almost caused tip-over (15° tilt observed)
- **Mitigation**: Operational procedure limits landing to <2° slope surfaces
- **Future**: [[Consider]] [[Active]] stabilization ([[Thrust Vector Control]] during touchdown to level vehicle)

---

## [[Related Notes]]

**[[Subsystem Integration]]**:
- [[Structures System]] - Parent overview [[Note]]
- [[Airframe Design]] - Landing leg attachment fittings and load path
- [[Propulsion System]] - Engine plume [[Clearance]] and landing burn

**GNC and [[Control]]**:
- [[GNC System]] - [[Landing Guidance]] and [[Trajectory Optimization]]
- [[Autopilot Software]] - Powered descent control laws
- [[Sensor Suite]] - GPS and [[IMU]] for landing [[Navigation]]

**[[Decisions]] and [[Requirements]]**:
- [[ADR-003 Landing Strategy]] - [[Propulsive landing]] vs. parachute recovery decision
- [[System Requirements]] - Landing [[System Requirements]] (touchdown [[Velocity]], reusability)

**[[Testing]]**:
- [[Test Campaign Overview]] - Landing system test schedule
- [[Acme Aerospace]] - Landing [[Test Facility]] ([[Drop]] tower, mockup testing)

**[[Project Management]]**:
- [[Project Roadmap]] - Landing system [[Integration]] schedule
- [[Risk Register]] - Landing failure [[Risk]] (vehicle loss if legs fail)
- [[James Park]] - [[Structures Lead]] (owner of landing system design)

**[[Team]]**:
- [[Sarah Chen]] - [[Chief Engineer]] (landing system oversight)
- [[Elena Rodriguez]] - [[Avionics Lead]] (landing [[Guidance]] algorithms)
- [[Marcus Johnson]] - [[Propulsion Lead]] (landing burn engine operation)
