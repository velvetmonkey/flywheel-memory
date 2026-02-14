---
type: component
subsystem: structures
status: fabrication
owner: "[[James Park]]"
created: 2025-08-20
updated: 2026-01-02
---
# [[Airframe Design]]

## [[Overview]]

The **Artemis-1 Airframe** is the primary load-bearing structure of the vehicle, housing [[All]] subsystems and providing aerodynamic stability during ascent and descent. The airframe is a monocoque cylindrical shell constructed from **aluminum-lithium (Al-Li) alloy 2195**, selected for its [[High]] strength-to-weight ratio and proven spaceflight heritage.

The airframe is designed to withstand:
- **Axial loads**: 180 kN (thrust from [[Propulsion System]])
- **Lateral loads**: 35 kN (aerodynamic forces at max-Q)
- **[[Internal Pressure]]**: 150 kPa ([[Ullage Pressurization]] of [[Fuel Tanks]] and [[Oxidizer System]])
- **Thermal extremes**: -65°C (cryogenic propellant) to +120°C (aerodynamic heating)

**[[Key Design Features]]**:
- Diameter: 1.5 m (standard rocket diameter for cost-effective tooling)
- Length: 12 m (single-stage configuration)
- [[Wall Thickness]]: 3 mm (constant thickness for manufacturability)
- Mass: 285 kg ([[Dry Mass]], no propellant)
- Factor of [[Safety]]: 1.4 (per NASA-STD-5001 human-rating standard)

The airframe integrates mounting provisions for:
- [[Propulsion System]] ([[Aft Bulkhead Thrust Structure]])
- [[Avionics System]] ([[Equipment Bay]] with vibration isolation)
- [[GNC System]] ([[Sensor Mounting Points]])
- [[Landing System]] (landing leg attachment points)
- [[Fairing Design]] ([[Payload Section]] interface)

[[This]] [[Design]] [[Balances]] structural efficiency, manufacturability, and [[Integration]] complexity. The monocoque construction minimizes part count and assembly time compared to [[Traditional]] stringer-frame designs.

[[See]] [[Material Selection]] for detailed material trade study and [[Stage Separation]] for structural discontinuity analysis.

---

## [[Design Philosophy]]

### Monocoque vs. Semi-Monocoque

**[[Selected Approach]]**: **Monocoque** (stressed-skin construction)

**Rationale**:
- **Simplicity**: Fewer parts → [[Faster]] fabrication, lower cost
- **Manufacturing**: Single welded cylinder vs. complex stringer-frame assembly
- **Schedule**: Fabrication time reduced by ~40% (critical for 18-[[Month]] program)
- **Cost**: Tooling costs 60% lower (simple mandrel vs. complex jigs)

**Trade-off**:
- Slightly heavier than [[Optimized]] semi-monocoque ([[But]] acceptable for payload [[Requirements]])
- Less flexibility for cutouts (but few [[Required]] for this design)

**Semi-monocoque** (skin + stringers + frames) was considered but rejected due to:
- Longer fabrication time (stringer welding, frame [[Alignment]])
- Higher tooling costs (precision jigs for stringer placement)
- Increased part count (120+ stringers, 18 frames)

**[[Reference]]**: [[ADR-006 Airframe Construction Method]] (if [[Created]] - this was the decision)

### [[Constant Thickness Philosophy]]

**Wall Thickness**: 3 mm (constant along entire airframe length)

**Rationale**:
- **Manufacturability**: Single thickness simplifies [[Material Procurement]] and rolling
- **Weldability**: Consistent thickness enables optimized weld parameters
- **Inspectability**: Uniform thickness for ultrasonic inspection acceptance [[Criteria]]
- **Cost**: No stepped thickness transitions (no secondary machining)

**Trade-off**:
- ~15 kg heavier than variable-thickness [[Optimization]]
- Acceptable mass penalty for schedule/cost benefits

**[[Structural Margins]]**:
```
                     Allowable   Applied    Margin
Axial Load (thrust)   240 kN     180 kN     +33%
Lateral Load (max-Q)   49 kN      35 kN     +40%
Internal Pressure      210 kPa    150 kPa    +40%
Buckling (axial)      320 kN     180 kN     +78%
```

All margins exceed 1.4 factor of safety. No over-stressed regions.

---

## Structural Analysis

### Finite Element Model

**Analysis Tool**: ANSYS Mechanical 2024 R1
- **Element Type**: SHELL181 (4-node quadrilateral shell elements)
- **Element Size**: 10 mm (mesh convergence study verified)
- **Total Elements**: 142,400
- **Total Nodes**: 144,560
- **Solver**: Direct sparse solver (ANSYS default)

**Material Properties** (Al-Li 2195-T8):
```
Density:              2700 kg/m³
Young's Modulus:      78 GPa
Poisson's Ratio:      0.33
Yield Strength:       520 MPa
Ultimate Strength:    570 MPa
Fracture Toughness:   35 MPa·√m
```

**Boundary Conditions**:
- **Aft Bulkhead**: Fixed constraint (thrust structure attachment to [[Engine Design]])
- **Forward Bulkhead**: Free (payload interface, no constraint)
- **Loads Applied**:
  - Axial thrust: 180 kN (distributed over aft bulkhead)
  - Lateral aerodynamic: 35 kN (distributed pressure field at max-Q)
  - Internal pressure: 150 kPa (ullage gas pressure)
  - Thermal gradient: -65°C (propellant tank walls) to +20°C (external skin)

### Load Cases Analyzed

**LC-1: Liftoff** (thrust + gravity + no aerodynamics)
- Axial load: 180 kN (thrust) - 80 kN (vehicle weight) = 100 kN net
- Max stress: 142 MPa (aft bulkhead attachment ring)
- Margin: +266% (yield stress 520 MPa)

**LC-2: Max-Q** (maximum dynamic pressure at Mach 1.2, 11 km altitude)
- Axial load: 180 kN thrust
- Lateral load: 35 kN aerodynamic (side load due to angle of attack)
- Max stress: 198 MPa (lateral bending + axial compression)
- Margin: +163% (yield stress 520 MPa)

**LC-3: Staging** (future multi-stage variant - not current design)
- Not applicable (single-stage design)

**LC-4: Landing** (powered descent, worst-case landing gear load)
- Axial load: 45 kN (engine throttled to 25%)
- Lateral load: 18 kN (crosswind during descent)
- Landing gear reaction: 120 kN (3g landing impact, 4 legs)
- Max stress: 167 MPa (landing leg attachment fittings)
- Margin: +211% (yield stress 520 MPa)

**LC-5: Internal Pressure** (ullage pressurization)
- Pressure: 150 kPa (tank ullage gas)
- Hoop stress: 56 MPa (thin-wall pressure vessel formula: σ = PR/t)
- Axial stress: 28 MPa (half of hoop stress for cylindrical vessel)
- Max combined stress: 61 MPa (von Mises)
- Margin: +752% (yield stress 520 MPa)

**LC-6: Thermal Gradient** (cryogenic propellant + aerodynamic heating)
- Temperature range: -65°C (LOX tank wall) to +120°C (nose cone aerodynamic heating)
- Thermal expansion: ΔL = αLΔT = (23×10⁻⁶)(12000)(185) = 51 mm
- Thermal stress: 85 MPa (constrained expansion at bulkhead interfaces)
- Max combined stress: 127 MPa (thermal + pressure + thrust)
- Margin: +309% (yield stress 520 MPa)

### Buckling Analysis

**Critical Load**: Axial compression buckling (most likely failure mode for thin-wall cylinders)

**Classical Buckling Load** (Euler column buckling):
```
P_cr = (π²EI) / (KL)²

Where:
E = 78 GPa (Young's modulus)
I = πR³t = π(0.75)³(0.003) = 0.00133 m⁴ (moment of inertia)
L = 12 m (column length)
K = 1.0 (pinned-pinned boundary condition, conservative)

P_cr = (π² × 78×10⁹ × 0.00133) / (1.0 × 12)² = 7.1 MN
```

**Actual Applied Load**: 180 kN (thrust)
**Buckling Margin**: 7100 / 180 = **39×** (extremely high margin - no buckling risk)

**Shell Buckling** (local buckling of cylindrical shell):
```
σ_cr = 0.605 × E × (t/R)

Where:
t/R = 0.003 / 0.75 = 0.004 (thickness-to-radius ratio)

σ_cr = 0.605 × 78×10⁹ × 0.004 = 188 MPa
```

**Actual Applied Stress**: 142 MPa (max stress from LC-1)
**Shell Buckling Margin**: 188 / 142 = **1.32×** (32% margin, acceptable)

**Note**: Shell buckling margin is lowest of all load cases. This drives the 3 mm wall thickness requirement. Thinner walls (2.5 mm) would fail buckling criteria.

---

## Manufacturing Process

### Material Procurement

**Selected Supplier**: Alcoa (U.S. domestic supplier for Al-Li 2195)
- **Material Form**: Rolled plate (3 mm × 1500 mm × 12000 mm)
- **Material Cost**: $42/kg × 310 kg = **$13,020** (includes 8% scrap allowance)
- **Lead Time**: 12 weeks (long-lead item - procured early in program)
- **Quality Requirements**: MIL-HDBK-5J certified material test reports

**Material Traceability**:
- Heat lot number stamped on each plate
- Material test reports archived (tensile strength, fracture toughness, chemistry)
- Chain of custody documentation (ITAR-controlled material)

### Rolling and Welding

**Step 1: Plate Rolling** (form flat plate into cylinder)
- **Process**: 3-roll plate bending (pyramid roller)
- **Tooling**: Custom mandrel (1.5 m diameter, 12 m length)
- **Spring-back Compensation**: Roll to 1.48 m diameter (2% under-size to account for spring-back)
- **Inspection**: Diameter measurement at 10 locations (tolerance: ±2 mm)

**Step 2: Longitudinal Seam Weld** (join plate edges to form cylinder)
- **Process**: Tungsten Inert Gas (TIG) welding (automated)
- **Filler Material**: ER2319 Al-Li filler wire (compatible with 2195 base metal)
- **Welding Parameters**:
  - Current: 180 A (DCEN - Direct Current Electrode Negative)
  - Voltage: 14 V
  - Travel speed: 250 mm/min
  - Shielding gas: Argon (99.999% purity, 15 L/min flow rate)
- **Weld Geometry**:
  - Full-penetration butt weld (weld penetrates entire 3 mm thickness)
  - Single-pass weld (sufficient for 3 mm thickness)
  - Weld bead width: 8 mm
  - Weld reinforcement: ±0.5 mm (minimal weld bead above surface)
- **Inspection**:
  - Visual inspection (100% of weld length)
  - Ultrasonic inspection (UT) (100% of weld length)
  - Radiographic inspection (X-ray) (10% sample, random locations)
  - Acceptance criteria: No cracks, no porosity >1 mm, no lack of fusion

**Step 3: Circumferential Bulkhead Welds** (attach forward and aft bulkheads)
- **Bulkhead Material**: Al-Li 2195 (machined from plate)
- **Bulkhead Thickness**: 6 mm (thicker than skin for load distribution)
- **Welding Parameters**: Same as longitudinal seam weld
- **Fit-Up**: Bulkhead inserted into cylinder, tack-welded at 4 locations, then continuous weld
- **Inspection**: 100% UT inspection (critical load path)

### Post-Weld Heat Treatment

**Process**: Stress relief heat treatment (reduce residual weld stresses)
- **Temperature**: 170°C (below solutionizing temperature to preserve T8 temper)
- **Hold Time**: 4 hours (sufficient for stress relief in 3 mm section)
- **Cooling**: Air cool to room temperature
- **Purpose**: Reduce weld residual stresses from ~200 MPa to (50 MPa

**Furnace**: Large horizontal tube furnace (1.6 m diameter × 13 m length)
- **Temperature Uniformity**: ±5°C (verified with thermocouple survey)

### Machining and Finishing

**Machining Operations**:
1. **Mounting Holes** (attachment points for subsystems):
   - Quantity: 48 holes (12 per quadrant)
   - Diameter: 6 mm (M6 threaded inserts)
   - Tolerance: ±0.1 mm (close tolerance for vibration isolation mounts)
   - Locations: Drilled per CAD model (coordinate inspection)
2. **Landing Gear Fittings** (4 attachment points for [[Landing System]]):
   - Machined pockets (20 mm deep) for titanium fittings
   - Bolt holes: 8× M8 bolts per fitting (32 holes total)
   - Countersunk holes (flush-head bolts for aerodynamics)
3. **Forward Interface** (payload attachment ring):
   - 24× M8 bolt holes (precision drilled on bolt circle diameter 1400 mm)
   - Interface flatness: <0.5 mm (to ensure load distribution)

**Surface Finishing**:
- **Deburr**: All holes and edges deburred (no sharp edges)
- **Anodize**: Type II anodizing (25 μm coating thickness)
  - Purpose: Corrosion protection (coastal launch environment)
  - Color: Clear (natural aluminum appearance)
  - MIL-A-8625 Type II specification

**Final Inspection**:
- Dimensional inspection (CMM - Coordinate Measuring Machine)
- Surface finish inspection (Ra < 3.2 μm)
- Anodize thickness verification (eddy current gauge)

---

## Integration Points

### Propulsion System Interface

**Aft Bulkhead Thrust Structure**:
- **Load Path**: [[Engine Design]] thrust → engine mount → aft bulkhead → airframe
- **Engine Mount**: 4× titanium brackets (Ti-6Al-4V) bolted to aft bulkhead
  - Bolt pattern: 16× M10 bolts (4 bolts per bracket)
  - Torque: 45 N·m (lubricated threads)
- **Load Distribution**: Aft bulkhead thickness 6 mm (2× skin thickness) to distribute thrust load
- **Thermal Barrier**: Ceramic insulation blanket (25 mm thick) protects aft bulkhead from exhaust plume
  - Material: Silica fiber insulation (Cotronics Rescor 780)
  - Temperature rating: 1200°C continuous

**Propellant Tank Interface**:
- [[Fuel Tanks]] (RP-1): Welded to aft bulkhead (integral tank design)
- [[Oxidizer System]] (LOX): Welded to mid bulkhead (forward of fuel tank)
- **Tank Walls**: Part of airframe structure (monocoque design means skin = tank wall)
- **Ullage Pressurization**: 150 kPa (gaseous nitrogen stored in composite overwrapped pressure vessel)

### Avionics System Interface

**Equipment Bay** (forward section, above propellant tanks):
- **Location**: 2 m from forward bulkhead (accessible for pre-flight servicing)
- **Volume**: 0.4 m³ (sufficient for 3× [[Flight Computer]], [[Sensor Suite]], [[Power Distribution]])
- **Mounting**: Vibration isolation mounts (LORD J-8159 isolators, 50 Hz cutoff frequency)
  - Isolation efficiency: 90% at 100 Hz (protects avionics from engine vibration)
- **Thermal Control**: Passive cooling (aluminum cold plates conduct heat to airframe skin)
  - Heat dissipation: 50 W average (from avionics)
  - Skin temperature rise: <10°C (acceptable)

**Cable Routing**:
- **Umbilical Connector**: 61-pin Glenair connector (hermetic, IP67 rated)
  - Located at equipment bay (side-mounted, 90° from weld seam)
  - Provides power, telemetry, command during ground testing
  - Disconnects automatically at liftoff (spring-loaded separation)
- **Internal Wiring**: Shielded twisted-pair cables routed through cable trays
  - Cable protection: Aluminum conduit (protects from mechanical damage)

### GNC System Interface

**Sensor Mounting Points**:
- **IMUs**: 3× mounting pads (welded studs) inside equipment bay
  - Alignment: IMUs aligned to vehicle reference frame (±0.1° tolerance)
  - Vibration isolation: Elastomeric mounts (isolate from airframe vibrations)
- **GPS Antennas**: 2× mounting patches on exterior skin (top of equipment bay)
  - Antenna type: Patch antenna (hemispherical coverage)
  - Ground plane: Airframe skin acts as ground plane
- **Pressure Sensors**: 3× pressure taps through airframe wall
  - Located at nose cone, mid-body, aft body (measure dynamic pressure during ascent)

**Actuator Mounting**:
- [[Thrust Vector Control]] actuators: Mounted to aft bulkhead (near engine mount)
- **Valve Actuators**: Mounted to propellant feed lines (inside equipment bay)

### Landing System Interface

**Landing Leg Attachment Fittings** (4× fittings, 90° spacing around airframe):
- **Location**: 1 m from aft bulkhead (structural reinforcement required)
- **Fitting Material**: Titanium Ti-6Al-4V (high strength-to-weight, corrosion resistant)
- **Attachment**: 8× M8 bolts per fitting (32 bolts total)
  - Bolt material: A286 stainless steel (high strength, corrosion resistant)
  - Torque: 28 N·m (lubricated threads)
- **Local Reinforcement**: Doubler plate (6 mm thick) welded to inside of airframe
  - Distributes landing loads over larger area (prevents local buckling)
- **Load Path**: Landing leg → titanium fitting → doubler plate → airframe skin

**Deployment Mechanism**:
- Legs stowed during ascent (folded against airframe)
- Pneumatic actuators deploy legs at T-60 seconds before landing
- See [[Landing System]] for deployment sequence and locking mechanism

### Fairing Interface

**Payload Section** (forward 2 m of airframe):
- **Fairing Diameter**: 1.5 m (same as airframe, no diameter step)
- **Fairing Length**: 2.5 m (3:1 fineness ratio for low drag)
- **Attachment**: 24× M8 bolts on bolt circle (shared with payload interface)
- **Separation**: Pyrotechnic bolt cutters (redundant, 2× per bolt for reliability)
  - Separation velocity: <1 m/s (low shock, protects payload)
- See [[Fairing Design]] for aerodynamic fairing shape and separation system

---

## Testing and Validation

### Structural Test Article

**Objective**: Validate airframe strength and buckling resistance under flight loads

**Test Article**:
- Full-scale airframe (12 m length, 1.5 m diameter)
- Same material, same manufacturing process as flight article
- Designated "STA-001" (Structural Test Article 001)

**Test Setup**:
- **Facility**: Acme Aerospace test facility (40-ton test frame)
- **Load Application**:
  - Axial load: Hydraulic ram applies compression (simulates thrust)
  - Lateral load: Hydraulic actuators apply side load (simulates aerodynamics)
  - Internal pressure: Gaseous nitrogen pressurization (simulates ullage pressure)
- **Instrumentation**:
  - 120× strain gauges (measure stress distribution)
  - 24× displacement transducers (measure deflection and buckling)
  - 12× thermocouples (monitor temperature during thermal cycling)

**Test Matrix** (6 load cases tested):

| Test | Load Description | Applied Load | Pass/Fail | Notes |
|------|------------------|--------------|-----------|-------|
| ST-1 | Axial compression (liftoff) | 252 kN (1.4× limit) | ✅ Pass | Max stress 198 MPa, no yielding |
| ST-2 | Lateral bending (max-Q) | 49 kN lateral (1.4× limit) | ✅ Pass | Max stress 277 MPa, no yielding |
| ST-3 | Internal pressure | 210 kPa (1.4× limit) | ✅ Pass | Max stress 85 MPa, no yielding |
| ST-4 | Thermal cycling | -80°C to +150°C (10 cycles) | ✅ Pass | No cracking, no delamination |
| ST-5 | Combined loads (worst-case) | Axial + lateral + pressure | ✅ Pass | Max stress 312 MPa, no yielding |
| ST-6 | Ultimate load (failure test) | Axial load to failure | ✅ Pass | Failed at 420 kN (2.3× limit) |

**Test Results**:
- All tests passed acceptance criteria (no yielding below ultimate load)
- Failure mode: Symmetric buckling at aft bulkhead (expected failure mode)
- Failure load: 420 kN (2.3× design limit load, exceeds 1.4× requirement)
- Structural test completed 2025-11-15 (on schedule)

**Lessons Learned**:
1. Strain gauges near welds showed 15% higher stress than FEA predictions
   - Root cause: Weld residual stresses not fully captured in model
   - Action: Added weld stress concentration factor (1.15×) to analysis
2. Thermal cycling revealed minor anodize cracking near weld heat-affected zones
   - Root cause: Anodize coating brittle in HAZ (heat-affected zone)
   - Action: Mask welds during anodizing (leave welds bare, no coating)

See [[Test Campaign Overview]] for full test program and [[Acme Aerospace]] for test facility capabilities.

---

## Vibration Analysis

### Modal Analysis

**Objective**: Determine natural frequencies and mode shapes (avoid resonance with engine vibration)

**Analysis Tool**: ANSYS Modal Analysis
- **Boundary Condition**: Free-free (vehicle in flight, no ground contact)
- **Mass**: 285 kg (airframe) + 150 kg (avionics/payload) + 800 kg (propellant, half-full)
- **Total Mass**: 1235 kg (conservative mid-burn mass)

**Natural Frequencies** (first 5 modes):

| Mode | Frequency | Mode Shape | Comments |
|------|-----------|------------|----------|
| 1 | 12.3 Hz | Lateral bending (1st mode) | Avoid engine harmonics at 10 Hz, 20 Hz |
| 2 | 18.7 Hz | Torsional (1st mode) | Well-separated from engine |
| 3 | 35.2 Hz | Lateral bending (2nd mode) | Above engine harmonics |
| 4 | 42.8 Hz | Axial (longitudinal) | POGO instability risk (see below) |
| 5 | 67.3 Hz | Lateral bending (3rd mode) | High frequency, no concern |

**Engine Vibration Spectrum** (measured during [[Engine Hot Fire Results]]):
- **Fundamental**: 10 Hz (combustion instability frequency)
- **Harmonics**: 20 Hz, 30 Hz, 40 Hz (multiples of fundamental)
- **Broadband**: 50-200 Hz (turbopump noise)

**Resonance Avoidance**:
- Mode 1 (12.3 Hz) is sufficiently separated from 10 Hz and 20 Hz ()20% margin)
- Mode 4 (42.8 Hz) near 40 Hz harmonic → potential POGO risk (see below)

### POGO Instability Analysis

**POGO**: Longitudinal vibration instability (coupling between propulsion and structure)

**Mechanism**:
1. Engine thrust fluctuates at 40 Hz (combustion harmonic)
2. Airframe vibrates longitudinally at 42.8 Hz (close to engine frequency)
3. Propellant slosh in tanks couples to vibration
4. Positive feedback → growing oscillations → structural failure

**Mitigation**:
- **Propellant Mass Damper**: Baffle plates in [[Fuel Tanks]] (increase damping)
  - Damping ratio increased from 0.5% (no baffles) to 3.5% (with baffles)
  - Sufficient to prevent POGO instability
- **Engine Control**: [[Engine Controller]] has 40 Hz notch filter (attenuates 40 Hz thrust oscillations)
  - Filter depth: -20 dB (reduces amplitude by 10×)
- **Analysis**: Closed-loop stability analysis shows 6 dB gain margin (stable)

**Verification**:
- Tested during hot fire tests (no POGO observed)
- Will monitor during first flight with high-frequency accelerometers (1000 Hz sampling)

### Random Vibration

**Acoustic Loads** (engine exhaust noise during liftoff):
- **Sound Pressure Level**: 145 dB (at liftoff, 50 m from vehicle)
- **Frequency Range**: 20 Hz - 2000 Hz (broadband noise)
- **Power Spectral Density**: 0.05 g²/Hz (measured during hot fire test)

**Avionics Survival**:
- [[Flight Computer]] mounted on vibration isolators (LORD J-8159)
  - Isolator cutoff frequency: 50 Hz (attenuates frequencies above 50 Hz)
  - Transmissibility: 0.1 (90% vibration reduction)
- **Random Vibration Test**: Avionics subjected to 0.1 g²/Hz for 60 seconds
  - Result: ✅ Pass (no failures, all computers functional)

---

## Mass Properties

### Mass Breakdown

| Component | Mass (kg) | Percentage | Notes |
|-----------|-----------|------------|-------|
| **Airframe Shell** | 215 | 75.4% | Cylindrical skin (Al-Li 2195, 3 mm thick) |
| **Bulkheads** (2×) | 38 | 13.3% | Forward and aft bulkheads (6 mm thick) |
| **Landing Leg Fittings** (4×) | 18 | 6.3% | Titanium fittings + doubler plates |
| **Welded Joints** | 8 | 2.8% | Weld filler material (ER2319) |
| **Anodize Coating** | 3 | 1.1% | Type II anodizing (25 μm coating) |
| **Miscellaneous** (bolts, inserts) | 3 | 1.1% | Threaded inserts, mounting hardware |
| **TOTAL** | **285 kg** | **100%** | Dry mass (no propellant, no subsystems) |

**Target Mass**: 300 kg (from system requirements)
**Actual Mass**: 285 kg
**Margin**: +15 kg (5.0% under target) ✅

### Center of Gravity

**CG Location** (measured from aft bulkhead):
- **Empty (dry)**: 6.2 m (near geometric center of 12 m length)
- **Propellant Loaded**: 5.8 m (shifted aft due to propellant mass in aft tanks)
- **Burnout**: 7.1 m (shifted forward as propellant depletes)

**CG Travel**: 1.3 m (from propellant-loaded to burnout)
- **Impact**: [[Thrust Vector Control]] must compensate for CG shift during flight
- **Controllability**: [[Autopilot Software]] models CG shift, updates control gains in real-time

**Lateral CG Offset**: <5 mm (all quadrants balanced)
- **Measurement Method**: Suspended from crane at 3 points, measured tilt angle
- **Tolerance**: <10 mm (meets requirement)

### Moment of Inertia

**Principal Axes** (airframe only, no propellant):
```
I_xx (roll):   420 kg·m² (rotation about longitudinal axis)
I_yy (pitch):  3850 kg·m² (rotation about lateral axis)
I_zz (yaw):    3850 kg·m² (rotation about lateral axis, same as pitch due to symmetry)
```

**With Propellant** (800 kg LOX/RP-1, half-full tanks):
```
I_xx (roll):   580 kg·m² (38% increase due to propellant)
I_yy (pitch):  8200 kg·m² (113% increase due to propellant concentrated at aft)
I_zz (yaw):    8200 kg·m²
```

**[[Control Authority]]**:
- [[Thrust Vector Control]] provides ±25 kN·m torque (sufficient for [[Attitude Control]])
- [[Angular]] [[Acceleration]] capability: 25000 / 8200 = **3.0 deg/s²** (adequate for landing maneuvers)

---

## [[Current Status]]

**[[Fabrication Status]]**: 🟢 **[[Complete]]**
- Airframe STA-001 ([[Structural Test Article]]): Tested and retired ([[Data]] archived)
- Airframe FM-001 (flight model): Fabrication complete 2025-12-10
- All structural tests passed (see [[Testing]] section)

**[[Inspection Status]]**: ✅ **Accepted**
- Dimensional inspection: Pass (all dimensions within tolerance)
- Ultrasonic inspection: Pass (no weld defects detected)
- X-ray inspection: Pass (10% [[Sample]], no indications)
- Anodize thickness: Pass (25 μm ±3 μm)

**[[Integration Status]]**: 🟡 **[[In Progress]]**
- [[Propulsion System]] integrated ([[Engine]], tanks, plumbing installed)
- [[Avionics System]] integration [[Scheduled]] for 2026-01-15
- [[GNC System]] integration scheduled for 2026-01-20
- [[Landing System]] integration scheduled for 2026-02-01

**[[Open Issues]]**:
1. **Anodize cracking near welds** (minor cosmetic issue)
   - [[Risk]]: Low (does [[Not]] affect structural integrity)
   - Mitigation: Accept as-is (cosmetic [[Only]], no corrosion risk)
2. **Landing leg fitting bolt torque spec clarification**
   - Issue: Drawing specifies 28 N·m, but analysis used 32 N·m
   - Resolution: Re-analyzed at 28 N·m, margins still positive (update drawing to [[Reflect]] 28 N·m)

**[[Upcoming Milestones]]**:
- 2026-01-15: [[Avionics Integration]] complete
- 2026-02-01: [[Landing System]] integration complete
- 2026-02-15: Integrated vehicle [[Mass Properties Measurement]] (final CG, MOI)
- 2026-03-01: [[Final Inspection]] and acceptance for [[Critical Design Review|CDR]]

---

## [[Lessons Learned]]

### [[Design Phase]]

**[[Lesson 1]]**: Constant-thickness monocoque was the right choice
- **Observation**: Fabrication [[Completed]] 3 [[Weeks]] ahead of schedule (due to simple manufacturing)
- **Benefit**: Saved $45K in labor costs (vs. semi-monocoque estimate)
- **[[Future Application]]**: Continue monocoque approach for future vehicles (unless payload fraction demands optimization)

**[[Lesson 2]]**: FEA underestimated weld stresses by ~15%
- **[[Root Cause]]**: Weld residual stresses not modeled (difficult to predict accurately)
- **Mitigation**: [[Applied 1.15]]× stress concentration factor to all weld zones in analysis
- **Future Application**: Include weld stress concentration in initial design ([[Use]] 1.2× factor for conservatism)

**[[Lesson 3]]**: Material [[Lead Time]] (12 weeks) was [[Critical Path]]
- **Impact**: Nearly delayed structural [[Test Article]] delivery
- **Mitigation**: Procured material immediately [[After]] [[Preliminary Design Review|PDR]]
- **Future Application**: Order long-[[Lead]] materials at PDR ([[Don]]'t wait for final design)

### [[Fabrication Phase]]

**[[Lesson 4]]**: [[Anodize Coating]] cracks in weld heat-affected zones
- **[[Root cause]]**: Anodize coating is brittle, cannot tolerate thermal stresses in HAZ
- **Mitigation**: Masked welds during anodizing (leave welds bare)
- **Impact**: Cosmetic only (welds [[Are]] slightly discolored, but no corrosion risk)

**[[Lesson 5]]**: Ultrasonic inspection detected 2 weld defects early
- **Observation**: UT inspection [[Found]] 2 small porosity indications (1.5 mm diameter)
- **[[Action]]**: Grind out defects, re-weld, re-inspect (passed on re-inspection)
- **Benefit**: Prevented potential failure during structural [[Test]]
- **Future Application**: 100% UT inspection of all welds (already standard practice, [[Validated]] here)

### [[Test Phase]]

**[[Lesson 6]]**: Structural test article failure [[Mode]] matched prediction
- **Observation**: Test article buckled at [[Aft Bulkhead]] at 420 kN (2.3× limit load)
- **Prediction**: FEA predicted buckling at 450 kN (within 7% of test [[Result]])
- **Confidence**: High confidence in FEA model accuracy
- **Future Application**: FEA can be trusted for buckling predictions (with 1.15× [[Safety Factor]])

---

## [[Related Notes]]

**[[Subsystem Integration]]**:
- [[Structures System]] - Parent overview [[Note]]
- [[Propulsion System]] - [[Thrust structure]] interface
- [[Avionics System]] - Equipment bay and mounting
- [[GNC System]] - Sensor mounting and alignment
- [[Landing System]] - [[Landing Leg Attachment Fittings]]

**[[Component Details]]**:
- [[Material Selection]] - Al-[[Li 2195]] trade study
- [[Fairing Design]] - Payload fairing aerodynamics and [[Separation]]
- [[Stage Separation]] - Structural discontinuity analysis (if [[Multi]]-stage)

**[[Decisions]] and Requirements**:
- [[ADR-006 Airframe Construction Method]] - Monocoque vs. semi-monocoque decision (if created)
- [[System Requirements]] - Structural requirements and factors of safety

**Testing**:
- [[Test Campaign Overview]] - Overall test program
- [[Acme Aerospace]] - Structural [[Test Facility]] and [[Capabilities]]

**[[Project Management]]**:
- [[Project Roadmap]] - Program schedule and [[Milestones]]
- [[Risk Register]] - Structural risks (buckling, weld defects)
- [[James Park]] - [[Structures Lead]] (owner of this design)

**[[Team]]**:
- [[Sarah Chen]] - [[Chief Engineer]] (structural oversight and approvals)
- [[Marcus Johnson]] - [[Propulsion Lead]] ([[Thrust Structure]] interface)
- [[Elena Rodriguez]] - [[Avionics Lead]] (equipment bay integration)
