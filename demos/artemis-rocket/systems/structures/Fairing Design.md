---
type: component
subsystem: structures
status: design
owner: "[[James Park]]"
created: 2025-09-05
updated: 2026-01-02
---
# [[Fairing Design]]

## [[Overview]]

The **payload fairing** is the protective aerodynamic shell that encloses the payload during ascent through the atmosphere. The fairing serves [[Three]] critical functions:

1. **[[Aerodynamic Protection]]**: Streamlined nose cone reduces drag and aerodynamic heating
2. **[[Environmental Protection]]**: Shields payload from acoustic noise, vibration, and contamination
3. **[[Load Distribution]]**: Transfers aerodynamic loads to [[Airframe Design]] structure

The Artemis-1 fairing is a **2.5-meter tall ogive-shaped fairing** with a **1.5-meter diameter** base ([[Matching]] the airframe diameter). The fairing separates at **100 km altitude** (above 99.99% of atmosphere) [[Via]] **pyrotechnic linear shaped charges** and **spring-loaded hinges**.

**[[Key Design Features]]**:
- **Material**: [[Carbon]] [[Fiber]] composite ([[High]] stiffness, [[Low Mass]])
- **Mass**: 18 kg ([[Both]] halves combined)
- **[[Payload Volume]]**: 3.2 m³ ([[Usable Volume]] for payload [[Integration]])
- **[[Acoustic Attenuation]]**: 15 dB reduction (protects payload from [[Launch]] acoustics)
- **[[Separation Mechanism]]**: Pyrotechnic linear shaped charges + spring-loaded hinges

The fairing [[Design]] is [[Optimized]] for:
- **[[Low Drag]]**: Ogive shape minimizes drag during max-Q (maximum [[Dynamic Pressure]])
- **Low Mass**: Carbon fiber construction saves 12 kg vs. aluminum (critical for [[Payload Capacity]])
- **Reusability**: Spring-loaded hinges allow fairing halves to [[Return]] intact (parachute recovery [[Planned]] for future)

[[See]] [[Airframe Design]] for fairing/airframe interface and [[Stage Separation]] for [[Separation]] mechanism heritage.

---

## [[Aerodynamic Design]]

### [[Fairing Geometry]]

**Shape**: **Ogive** (tangent ogive, 3:1 fineness ratio)

**[[Ogive Definition]]**:
```
Fineness ratio: λ = L / D
Where:
  L = 2.5 m (fairing length)
  D = 1.5 m (base diameter)
  λ = 2.5 / 1.5 = 1.67

Note: Industry standard is 2:1 to 4:1 (Artemis is 1.67:1, slightly blunter)
```

**Why Ogive?**
- Lower drag than conical nose (10-15% drag reduction vs. cone)
- Lower heating than sharp cone (blunt nose increases nose radius → lowers stagnation heating)
- Proven heritage: Falcon 9, Electron, Antares all use ogive fairings

**Nose Radius**: 0.6 m (blunt nose reduces peak heating)
- **Stagnation Point Heating**: q̇ ∝ 1/√R (heating inversely proportional to nose radius)
- Larger radius → lower heating → simpler thermal protection

**Base Diameter**: 1.5 m (matches airframe)
- **Interface**: 24× M8 bolts on 1.40 m bolt circle diameter
- **Load Transfer**: Aerodynamic loads transfer through bolted joint to airframe

**Payload Envelope**:
```
Usable Diameter:  1.35 m (allowing 75 mm clearance from fairing inner wall)
Usable Height:    2.2 m (allowing clearance for separation springs and payload adapter)
Usable Volume:    3.2 m³ (cylindrical approximation)
```

**Payload Clearance**:
- **Radial Clearance**: 75 mm (minimum clearance between payload and fairing inner wall)
- **Purpose**: Prevents contact during launch vibrations and fairing flex
- **Verification**: Payload CAD model checked for clearance in all flight attitudes

### Drag Analysis

**Drag Coefficient** (Cd):
```
C_d = Drag Force / (½ ρ V² A)

Where:
  ρ = air density (kg/m³)
  V = velocity (m/s)
  A = reference area = π D² / 4 = π (1.5)² / 4 = 1.77 m²
```

**Drag vs. Mach Number** (from CFD analysis):

| Mach | Altitude (km) | Cd | Drag (kN) | Notes |
|------|---------------|----|-----------| ------|
| 0.3 | 2 km | 0.35 | 2.1 kN | Subsonic, low drag |
| 0.9 | 8 km | 0.42 | 4.8 kN | Transonic drag rise |
| 1.2 | 11 km | 0.48 | 8.5 kN | **Max-Q** (peak dynamic pressure) |
| 2.0 | 25 km | 0.38 | 3.2 kN | Supersonic, drag decreases |
| 4.0 | 50 km | 0.35 | 0.8 kN | High altitude, low density |

**Max-Q Conditions** (worst-case aerodynamic load):
- **Altitude**: 11 km
- **Velocity**: 420 m/s (Mach 1.2)
- **Dynamic Pressure**: q = ½ ρ V² = ½ (0.35) (420)² = **30.9 kPa**
- **Drag Force**: 8.5 kN (axial load on fairing)

**Drag Penalty**:
- Fairing adds 8.5 kN drag at max-Q (vs. 5.2 kN for bare airframe)
- **Net Drag Increase**: 3.3 kN (38% higher drag with fairing)
- **Payload Mass Penalty**: ~5 kg (reduced payload capacity due to drag)
- **Acceptable Trade**: Payload protection worth 5 kg penalty

### CFD Analysis

**Tool**: ANSYS Fluent 2024 R1 (Computational Fluid Dynamics)
- **Mesh**: 2.4 million cells (tetrahedral elements, refined near nose and boundary layer)
- **Turbulence Model**: k-ω SST (good for external aerodynamics and transonic flow)
- **Solver**: Density-based solver (compressible flow, Mach 0.3 to 4.0)

**Boundary Conditions**:
- **Inlet**: Freestream velocity (Mach number), altitude (density, temperature from U.S. Standard Atmosphere)
- **Outlet**: Pressure outlet (ambient pressure)
- **Wall**: No-slip boundary condition (viscous flow at fairing surface)

**Results** (Mach 1.2, max-Q case):
```
Drag coefficient:           0.48 (matches empirical data within 5%)
Stagnation pressure:        95 kPa (nose tip)
Base pressure:              22 kPa (fairing base, separated flow)
Pressure distribution:      Peak at nose (95 kPa), decreases to base (22 kPa)
Heat flux (stagnation):     85 kW/m² (nose tip, highest heating)
Heat flux (cylindrical):    12 kW/m² (fairing body, lower heating)
```

**Thermal Analysis**:
- **Peak Heating**: 85 kW/m² at nose tip (Mach 1.2, 11 km)
- **Heat Soak**: Total energy absorbed = 85 kW/m² × 30s (duration at high-q) = 2.55 MJ/m²
- **Temperature Rise**: ΔT = Q / (ρ c t) = 2.55×10⁶ / (1600 × 1000 × 0.003) = **531°C**
  - ρ = 1600 kg/m³ (CFRP density)
  - c = 1000 J/(kg·K) (specific heat of carbon fiber)
  - t = 3 mm (fairing wall thickness)
- **Peak Temperature**: 20°C (ambient) + 531°C = **551°C**

**Material Limit**:
- CFRP epoxy resin degrades at 250°C (matrix softens, loses strength)
- **Peak Temperature**: 551°C **EXCEEDS** material limit ❌

**Mitigation Required**: Thermal Protection System (see below)

---

## Structural Design

### Material Selection

**Selected Material**: **Carbon Fiber Reinforced Polymer (CFRP)**
- **Fiber**: Toray T700S carbon fiber (standard modulus, 12K tow)
- **Matrix**: Hexcel 8552 epoxy resin (toughened, aerospace-grade)
- **Layup**: Quasi-isotropic [0°/+45°/-45°/90°]ₛ (symmetric, 8 plies)

**Material Properties**:
```
Density:                1600 kg/m³ (40% lighter than aluminum)
Tensile Strength:       600 MPa (fiber direction)
Compressive Strength:   450 MPa (fiber direction)
Young's Modulus:        70 GPa (similar to aluminum)
Poisson's Ratio:        0.3
Coefficient of Thermal Expansion: 1×10⁻⁶ /°C (very low, dimensionally stable)
Maximum Service Temp:   120°C (continuous), 250°C (short-term)
```

**Why CFRP?**
- **Mass Savings**: 12 kg lighter than aluminum (18 kg vs. 30 kg)
- **Stiffness**: High stiffness-to-weight ratio (reduces vibration)
- **Corrosion**: Immune to corrosion (coastal launch environment)

**Trade-off**:
- **Cost**: CFRP is 3× more expensive than aluminum ($12K vs. $4K material cost)
- **Manufacturing**: Requires autoclave curing (specialized equipment, longer lead time)
- **Thermal**: Lower temperature limit than aluminum (requires TPS)

**Alternative Considered**: Aluminum-lithium 2195 (same as [[Airframe Design]])
- **Mass**: 30 kg (12 kg heavier)
- **Cost**: $4K (3× cheaper)
- **Thermal**: 350°C service temperature (better than CFRP)
- **Rejected**: Mass penalty too high (reduces payload capacity by 12 kg)

### Structural Analysis

**Finite Element Model**:
- **Tool**: ANSYS Composite PrepPost (ACP) + ANSYS Mechanical
- **Element Type**: SHELL181 (4-node composite shell element)
- **Element Size**: 15 mm (mesh convergence verified)
- **Total Elements**: 28,400
- **Total Nodes**: 29,100

**Layup Definition**:
```
8-ply quasi-isotropic layup:
  Ply 1: 0° (axial direction, aligned with vehicle axis)
  Ply 2: +45° (resists shear)
  Ply 3: -45° (resists shear, balanced with Ply 2)
  Ply 4: 90° (circumferential direction)
  --- Symmetry Plane ---
  Ply 5: 90° (mirror of Ply 4)
  Ply 6: -45° (mirror of Ply 3)
  Ply 7: +45° (mirror of Ply 2)
  Ply 8: 0° (mirror of Ply 1)

Total thickness: 8 plies × 0.375 mm/ply = 3 mm
```

**Load Cases**:

**LC-1: Aerodynamic Pressure (Max-Q)**
- **Pressure Distribution**: From CFD analysis (95 kPa at nose, decreases to 22 kPa at base)
- **Max Stress**: 42 MPa (tensile, at nose-to-cylinder transition)
- **Margin**: 600 / 42 = **14.3×** (factor of safety) ✅

**LC-2: Acoustic Pressure (Liftoff)**
- **Sound Pressure Level**: 160 dB (at fairing surface, engine exhaust noise)
- **Pressure Fluctuation**: 200 Pa RMS (root-mean-square)
- **Stress**: 3 MPa RMS (low-amplitude, high-frequency vibration)
- **Fatigue**: No concern (single-use vehicle, <2 minutes exposure)

**LC-3: Handling Loads (Ground Operations)**
- **Crane Lift**: 4 lifting lugs (redundant, 3 sufficient)
- **Load per Lug**: 18 kg / 3 = 6 kg (with 2g safety factor = 12 kg per lug)
- **Stress**: 8 MPa (at lug attachment)
- **Margin**: 600 / 8 = **75×** ✅

**LC-4: Separation Shock**
- **Shock Source**: Pyrotechnic linear shaped charge detonation
- **Peak Acceleration**: 800 g (at separation line, measured on similar fairings)
- **Inertial Load**: 18 kg × 800g = 141 kN (dynamic load)
- **Stress**: 95 MPa (peak stress at hinge attachment)
- **Margin**: 600 / 95 = **6.3×** ✅

### Vibration Analysis

**Modal Analysis** (natural frequencies):

| Mode | Frequency | Mode Shape | Comments |
|------|-----------|------------|----------|
| 1 | 28 Hz | Lateral bending (1st mode) | Fairing vibrates like cantilever beam |
| 2 | 45 Hz | Torsional (1st mode) | Twisting motion about longitudinal axis |
| 3 | 82 Hz | Lateral bending (2nd mode) | Higher-frequency bending |
| 4 | 110 Hz | Breathing (circumferential expansion) | Fairing expands/contracts radially |

**Coupled Analysis** (fairing + airframe):
- Fairing modes couple with [[Airframe Design]] modes (12 Hz lateral bending)
- **Risk**: Resonance between fairing mode 1 (28 Hz) and engine harmonics (20 Hz, 30 Hz)
- **Mitigation**: Sufficient frequency separation (28 Hz is between 20 Hz and 30 Hz, no exact resonance)

**Payload Isolation**:
- Fairing vibrations transmit to payload through payload adapter
- **Payload Limit**: 10 grms random vibration (typical satellite specification)
- **Predicted Payload Vibration**: 6 grms (within limit, verified by testing) ✅

---

## Thermal Protection System

### TPS Design

**Problem**: Peak fairing temperature (551°C) exceeds CFRP limit (250°C)

**Solution**: **Ablative Thermal Protection System (TPS)**
- **Material**: Avcoat ablative coating (heritage from Apollo capsule)
- **Thickness**: 2 mm (applied to fairing nose, 0.8 m diameter area)
- **Mass**: 1.2 kg (adds minimal mass)

**Ablative Process**:
1. Surface heats to 551°C during max-Q
2. Avcoat resin decomposes (pyrolyzes), absorbs heat
3. Char layer forms (insulates underlying CFRP)
4. Char erodes slowly, carrying heat away
5. CFRP structure remains below 120°C (within limit)

**Thermal Analysis** (1D heat transfer model):
```
Heat flux:              85 kW/m² (from CFD, nose stagnation point)
Exposure time:          30 seconds (duration at high-q)
Total heat absorbed:    2.55 MJ/m²

Ablative material properties:
  Thermal conductivity: 0.3 W/(m·K) (low conductivity, good insulator)
  Heat of ablation:     8 MJ/kg (energy absorbed during pyrolysis)
  Density:              600 kg/m³

Ablation rate:          2.55 MJ/m² / 8 MJ/kg = 0.32 kg/m²
Material consumed:      0.32 kg/m² × (π × 0.8²/4) = 0.16 kg (16% of 1.2 kg applied)
Remaining TPS:          1.0 kg (sufficient margin for uncertainties)

CFRP backface temperature: 95°C (below 120°C limit) ✅
```

**TPS Application**:
- **Coverage Area**: Nose cone (0.8 m diameter circular patch)
- **Application Method**: Hand-applied (paintbrush, 4 coats)
- **Cure**: Room temperature cure (24 hours)
- **Inspection**: Visual (thickness measurement with micrometer, 2 mm ±0.5 mm)

**TPS Mass Budget**:
- TPS material: 1.2 kg
- CFRP fairing: 18 kg
- **Total**: 19.2 kg (still 10.8 kg lighter than aluminum fairing)

---

## Separation System

### Separation Mechanism

**Separation Event**: Fairing separates at **T+80 seconds** (100 km altitude)
- **Trigger**: [[Flight Software]] commands separation based on altitude (100 km ±2 km)
- **Mechanism**: Pyrotechnic linear shaped charge (LSC) + spring-loaded hinges

**Linear Shaped Charge** (LSC):
- **Supplier**: Ensign-Bickford EBW-LSC (exploding bridgewire linear shaped charge)
- **Configuration**: V-shaped explosive ribbon (cuts along separation line)
- **Length**: 4.7 m (full circumference of 1.5 m diameter fairing base)
- **Explosive**: HMX (high-explosive, stable, insensitive to shock)
- **Mass**: 120 g (total explosive mass)

**LSC Operating Principle**:
1. Electrical firing pulse (28V DC, 5A for 10 ms) sent to EBW initiator
2. Bridgewire explodes, initiates HMX explosive
3. Explosive detonates at 7000 m/s (supersonic propagation along LSC)
4. Jet of high-velocity gas cuts through aluminum separation rail (3 mm thick)
5. Fairing halves separate cleanly (cut completes in <1 millisecond)

**Separation Rail**:
- **Material**: Aluminum 6061-T6 (softer than CFRP, easily cut by LSC)
- **Cross-Section**: C-channel (3 mm thick, 20 mm wide)
- **Function**: Provides mechanical joint between fairing halves (transfers loads during ascent)
- **Fracture**: LSC cuts through C-channel, releasing fairing halves

### Hinge Mechanism

**Fairing Halves**: Two clamshell halves (split along vertical plane)

**Hinge Design**:
- **Quantity**: 4 hinges (2 per fairing half, redundant for reliability)
- **Location**: 90° from separation rail (opposite side of fairing)
- **Type**: Spring-loaded piano hinge (continuous hinge along fairing length)
- **Spring**: Torsion spring (stored energy deploys fairing halves)

**Hinge Spring**:
- **Spring Rate**: 5 N·m/rad (torque increases linearly with angle)
- **Preload Angle**: 170° (spring compressed when fairing closed)
- **Stored Energy**: ½ k θ² = ½ × 5 × (170×π/180)² = 22 J per hinge (88 J total)
- **Deployment**: Spring releases, rotates fairing halves outward (180° rotation)

**Deployment Sequence**:
1. LSC fires (T+80.000s), cuts separation rail
2. Hinge springs release (T+80.001s), rotate fairing halves outward
3. Fairing halves clear vehicle (T+80.200s), separation complete (200 ms total)
4. Fairing halves tumble away (no active control, no parachutes on Artemis-1)

**Separation Velocity**:
```
Kinetic energy imparted: 88 J (from springs)
Fairing half mass: 9 kg (per half)
Velocity: √(2E/m) = √(2 × 88 / 9) = 4.4 m/s (lateral velocity, away from vehicle)
```

**Clearance**:
- Fairing halves clear vehicle by 2 m at T+80.5s (sufficient clearance for payload)
- No re-contact risk (fairing halves diverge from vehicle trajectory)

### Redundancy and Safety

**Dual-Redundant Firing Circuit**:
- Circuit A and Circuit B (independent paths to LSC initiator)
- Either circuit can fire LSC (single-fault tolerant)
- **Safing**: Safing pin installed during ground operations (mechanically prevents LSC firing)

**No-Fire Safety**:
- **All-Fire Energy**: 250 mJ (guaranteed to fire LSC)
- **No-Fire Energy**: 50 mJ (guaranteed NOT to fire)
- **Margin**: 5× (large margin prevents inadvertent firing from electrical noise)

**Premature Separation Risk**:
- **Consequence**: Catastrophic (payload exposed to aerodynamic loads, vehicle unstable)
- **Mitigation**:
  1. Safing pin (physical barrier)
  2. Software arm/safe switch (requires explicit arming command at T-10 seconds)
  3. Altitude interlock (LSC cannot fire below 90 km, prevents ground firing)

---

## Acoustic Attenuation

### Payload Acoustic Environment

**Problem**: Launch acoustics damage sensitive payload electronics

**Acoustic Sources**:
- **Engine Exhaust**: 160 dB at liftoff (reflected noise from launch pad)
- **Aerodynamic Noise**: 145 dB at max-Q (turbulent boundary layer)
- **Transonic Buffet**: 150 dB at Mach 0.9-1.2 (shock wave oscillations)

**Without Fairing**: Payload exposed to 160 dB (damage threshold for electronics: 140 dB)

**With Fairing**: Acoustic attenuation reduces noise by 15 dB
- **Fairing Attenuation**: 15 dB (composite sandwich structure, high stiffness)
- **Interior Noise**: 160 - 15 = **145 dB** (within payload limit of 150 dB) ✅

**Attenuation Mechanism**:
1. **Mass Law**: Fairing mass blocks acoustic transmission (heavier materials attenuate better)
   - Attenuation = 20 log(ρ t f) = 20 log(1600 × 0.003 × 500) = **12 dB**
   - ρ = 1600 kg/m³ (CFRP density)
   - t = 0.003 m (wall thickness)
   - f = 500 Hz (dominant frequency of launch acoustics)
2. **Stiffness**: High stiffness reduces panel vibration (less noise transmitted)
   - Additional 3 dB attenuation from stiffness
3. **Total Attenuation**: 12 + 3 = **15 dB**

**Verification**:
- Acoustic test conducted at Acme Aerospace facility
- Fairing subjected to 160 dB reverberant field (simulates launch environment)
- Microphones inside fairing measure interior noise: **146 dB** (close to 145 dB prediction) ✅

---

## Testing and Validation

### Component Testing

**LSC Qualification Test**:
- **Objective**: Verify LSC reliably cuts separation rail
- **Test Matrix**: 10 LSC samples tested
  - Temperature extremes: -40°C and +80°C
  - Vibration pre-conditioning: 10 grms random, 60 seconds
- **Results**: 10/10 successful cuts (100% reliability)
  - Cut time: <1 ms (all samples)
  - Clean cut (no secondary fractures, no jagged edges)

**Hinge Deployment Test**:
- **Objective**: Verify hinges deploy fairing halves cleanly
- **Test Setup**: Half-scale fairing mockup (0.75 m diameter, 1.25 m height)
- **Results**:
  - Deployment time: 180 ms (within 200 ms requirement) ✅
  - Separation velocity: 4.6 m/s (close to 4.4 m/s prediction) ✅
  - No interference (fairing halves clear vehicle cleanly)

### Full-Scale Testing

**Static Pressure Test**:
- **Objective**: Verify fairing withstands max-Q pressure loads
- **Test Setup**: Fairing mounted on test fixture, internal pressure applied
- **Pressure**: 95 kPa (max-Q stagnation pressure)
- **Instrumentation**: 48 strain gauges (measure stress distribution)
- **Results**:
  - Max stress: 45 MPa (close to 42 MPa FEA prediction)
  - No structural failure, no delamination ✅
  - Permanent deformation: <0.5 mm (elastic behavior, fully recovers)

**Acoustic Test**:
- **Objective**: Verify fairing attenuates launch acoustics
- **Test Setup**: Fairing mounted in reverberant chamber (simulates launch environment)
- **Input**: 160 dB broadband noise (20 Hz - 2000 Hz)
- **Instrumentation**: Microphones inside fairing (measure interior noise)
- **Results**:
  - Interior noise: 146 dB (within 145 dB requirement) ✅
  - Attenuation: 14 dB (close to 15 dB prediction)

**Separation Test**:
- **Objective**: Verify clean separation (no re-contact, no debris)
- **Test Setup**: Full-scale fairing suspended from crane (simulates zero-g)
- **Sequence**:
  1. LSC fires (cuts separation rail)
  2. High-speed camera films deployment (1000 fps)
  3. Measure separation velocity and clearance
- **Results**:
  - LSC cut time: 0.8 ms ✅
  - Deployment time: 195 ms ✅
  - Separation velocity: 4.3 m/s (within 10% of prediction) ✅
  - No debris ejection, no secondary fractures ✅

**Lessons Learned**:
1. LSC detonation velocity slower than predicted (7000 m/s predicted, 6200 m/s measured)
   - Impact: Cut time increased from 0.7 ms to 0.8 ms (still acceptable)
   - No design change required
2. Hinge spring force varied by ±8% (manufacturing tolerance)
   - Impact: Separation velocity varied from 4.0 to 4.6 m/s (acceptable variation)
   - No design change required (variation within clearance margins)

---

## Recovery System (Future)

**Artemis-1**: Fairing halves tumble to ocean (not recovered, expendable)

**Future Recovery** (Artemis-2+):
- **Parachute System**: Ram-air parafoil (steerable parachute)
  - Deploys at 10 km altitude (subsonic descent)
  - Targets landing zone (10 km × 10 km recovery area)
  - Splashdown in ocean (buoyant fairing halves float)
- **Recovery Vessel**: Small boat retrieves fairing halves
- **Refurbishment**: Inspect, repair TPS, re-certify for next flight
- **Cost Savings**: $15K per flight (vs. $30K to manufacture new fairing)

**Recovery Feasibility**:
- SpaceX Falcon 9 successfully recovers fairings (Ms. Tree and Ms. Chief recovery vessels)
- Rocket Lab Electron developing fairing recovery (helicopter catch)
- Artemis fairing smaller and lighter (easier to recover)

**Design Changes Required**:
- Add parachute bay (2 kg mass penalty)
- Add GPS tracker (0.5 kg)
- Add floatation bags (1 kg)
- **Total Mass Penalty**: 3.5 kg (acceptable for reusability benefits)

---

## Current Status

**Fabrication Status**: 🟡 **In Progress**
- CFRP layup complete (autoclave curing completed 2025-12-05)
- TPS application in progress (50% complete, target 2026-01-10)
- LSC installation pending (scheduled 2026-01-15)

**Testing Status**:
- Static pressure test: ✅ Complete (passed 2025-11-20)
- Acoustic test: ✅ Complete (passed 2025-12-01)
- Separation test: ✅ Complete (passed 2025-12-10)

**Integration Status**: ⏳ **Not Started**
- Integration to airframe scheduled 2026-01-20
- Payload integration scheduled 2026-02-05

**Open Issues**:
1. **TPS application technique** (minor cosmetic issues)
   - Issue: Hand-applied TPS has thickness variation (2 mm ±0.8 mm vs. ±0.5 mm spec)
   - Impact: Low (thermal analysis shows adequate margin even with variation)
   - Resolution: Accept as-is (cosmetic only, no thermal risk)
2. **Hinge spring calibration** (±8% force variation)
   - Issue: Spring manufacturing tolerance causes separation velocity variation
   - Impact: Low (4.0 to 4.6 m/s variation, all within clearance margin)
   - Resolution: Accept as-is (no safety risk, adequate clearance)

**Upcoming Milestones**:
- 2026-01-10: TPS application complete
- 2026-01-15: LSC installation and electrical checkout
- 2026-01-20: Fairing integration to airframe
- 2026-02-05: Payload integration (fairing closeout)

---

## Lessons Learned

### Design Phase

**Lesson 1**: CFRP mass savings (12 kg) justified higher cost
- **Observation**: Fairing mass critical to payload capacity (every kg saved = 1 kg more payload)
- **Benefit**: 12 kg mass savings enables larger payloads
- **Future Application**: Continue CFRP for mass-critical structures

**Lesson 2**: Thermal analysis revealed TPS requirement
- **Observation**: Initial design had no TPS (assumed CFRP could withstand 551°C)
- **Reality**: CFRP degrades at 250°C (required TPS addition)
- **Impact**: 1.2 kg mass penalty (acceptable)
- **Future Application**: Always perform thermal analysis early (avoid late design changes)

### Fabrication Phase

**Lesson 3**: Autoclave curing requires precise temperature control
- **Observation**: Temperature overshoot by 10°C caused resin over-cure (brittle matrix)
- **Action**: Scrapped first fairing half, re-fabricated with tighter temperature control (±2°C)
- **Cost Impact**: $8K scrap cost (within contingency budget)
- **[[Future Application]]**: Invest in better autoclave instrumentation (thermocouples at [[Multiple]] locations)

**[[Lesson 4]]**: TPS hand-application [[Not]] repeatable
- **Observation**: Thickness varies by ±0.8 mm (vs. ±0.5 mm spec)
- **[[Root cause]]**: Manual application (operator technique variation)
- **Mitigation**: Accepted as-is ([[Thermal Margin]] sufficient)
- **Future Application**: [[Consider]] spray application ([[Automated]], more repeatable)

### [[Test Phase]]

**[[Lesson 5]]**: LSC detonation [[Velocity]] lower than datasheet value
- **Observation**: [[Measured 6200]] m/s vs. 7000 m/s datasheet (11% lower)
- **[[Root Cause]]**: Datasheet value from unconstrained [[Test]] (our LSC bonded to separation rail, constrained)
- **Impact**: Cut time increased by 0.1 ms (acceptable)
- **Future Application**: Measure detonation velocity in representative configuration ([[Don]]'t trust datasheet alone)

---

## [[Related Notes]]

**[[Subsystem Integration]]**:
- [[Structures System]] - Parent overview [[Note]]
- [[Airframe Design]] - Fairing/airframe interface and bolted joint
- [[Stage Separation]] - Pyrotechnic separation mechanism heritage (LSC similar to bolt cutters)

**Aerodynamics and Thermal**:
- [[GNC System]] - Aerodynamic coefficients used for trajectory simulation
- [[System Requirements]] - Fairing jettison altitude requirement (100 km)

**[[Testing]]**:
- [[Test Campaign Overview]] - Fairing test schedule
- [[Acme Aerospace]] - Acoustic [[Test Facility]]

**[[Project Management]]**:
- [[Project Roadmap]] - Fairing fabrication and integration schedule
- [[Risk Register]] - Fairing separation [[Risk]] (catastrophic if fails)
- [[James Park]] - [[Structures Lead]] (owner of fairing design)

**Propulsion and Avionics**:
- [[Flight Software]] - Fairing separation [[Command]] logic (altitude trigger)
- [[Telemetry]] - Fairing separation event [[Telemetry]] (verify successful separation)
