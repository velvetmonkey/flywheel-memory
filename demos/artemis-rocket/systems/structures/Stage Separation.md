---
type: component
subsystem: structures
status: design
owner: "[[James Park]]"
created: 2025-09-10
updated: 2026-01-02
---
# [[Stage Separation]]

## [[Overview]]

**[[Note]]**: The Artemis-1 vehicle is a **single-stage** [[Design]] with no stage [[Separation]]. [[This]] note [[Documents]] the separation [[System]] design for **future [[Multi]]-stage variants** (Artemis-2 and beyond).

Stage separation is [[One]] of the [[Most]] critical events in a multi-stage [[Launch]] vehicle. Reliable separation ensures:
- **Structural integrity**: [[Prevent]] collision between stages during separation
- **Trajectory accuracy**: Minimize disturbance to upper stage trajectory
- **[[Safety]]**: Prevent catastrophic failure from separation-induced loads

The baseline Artemis-2 [[Two]]-[[Stage Design]] will [[Use]]:
- **[[Separation Mechanism]]**: [[Pyrotechnic Bolt Cutters]] (Ensign-Bickford EBW-42)
- **[[Separation Impulse]]**: Cold-gas thrusters (gaseous nitrogen)
- **[[Separation Velocity]]**: 2 m/s (relative [[Velocity]] between stages)
- **[[Separation Altitude]]**: 80 km (above dense atmosphere)

This design is [[Based]] on proven SpaceX [[Falcon 9]] and [[Rocket Lab Electron]] heritage, adapted for Artemis vehicle constraints.

---

## Single-[[Stage Baseline]] (Artemis-1)

**[[Current Design]]**: Artemis-1 is **single-stage-to-orbit** (actually [[Sub]]-orbital, 250 kg to LEO requires expendable upper stage in future)

**[[Why Single]]-Stage?**:
- **[[Program Risk]]**: Lower complexity for [[First Flight]] (no separation events to fail)
- **Schedule**: [[Faster]] development (no separation system to design/[[Test]])
- **Cost**: Lower recurring cost (no expendable upper stage)

**Limitation**:
- [[Payload Capacity]]: 250 kg to LEO ([[Limited]] by single-stage [[Performance]])
- No orbital missions (sub-orbital demonstration flights [[Only]])

**[[Upgrade Path]]** (Artemis-2):
- Add expendable second stage (solid motor or pressure-fed liquid)
- Increases payload to 500 kg LEO (2× improvement)
- Requires separation system (this design)

**[[Related Decision]]**: [[ADR-003 Landing Strategy]] discusses single-stage reusability [[Strategy]]

---

## Multi-Stage Design (Artemis-2 Concept)

### [[Vehicle Configuration]]

**Two-[[Stage Architecture]]**:
```
┌─────────────────────┐
│   Payload Fairing   │  ← Fairing separation at 100 km
├─────────────────────┤
│   Second Stage      │  ← Solid motor (Star 30BP equivalent)
│   - Propellant: HTPB│     250 kg propellant
│   - Burn time: 60s  │     Thrust: 35 kN
├─────────────────────┤  ← STAGE SEPARATION at 80 km, Mach 8
│                     │
│   First Stage       │  ← Artemis-1 vehicle (booster)
│   - Propulsion      │     LOX/RP-1 liquid engine
│   - Landing System  │     Returns to launch site
│                     │
└─────────────────────┘
```

**Separation Event Sequence**:
1. **T+120s**: First stage main engine cutoff (MECO)
2. **T+121s**: Pyrotechnic bolt cutters fire (72 bolts cut simultaneously)
3. **T+121.1s**: Cold-gas thrusters fire (push stages apart, 2 m/s Δv)
4. **T+121.5s**: Second stage ignition (after 0.5s coast for clearance)
5. **T+125s**: First stage begins boost-back maneuver (returns to launch site)

**Key Parameters**:
- **Separation Altitude**: 80 km (above 99.9% of atmosphere)
- **Separation Velocity**: 2400 m/s (Mach 8 at 80 km)
- **Relative Separation Velocity**: 2 m/s (low-shock separation)
- **Separation Dynamics**: Axial separation (stages separate along longitudinal axis)

### Structural Interface

**Interstage Adapter** (connects first stage to second stage):
- **Material**: Aluminum-lithium 2195 (same as [[Airframe Design]])
- **Geometry**: Cylindrical shell, 1.5 m diameter, 1.2 m height
- **Wall Thickness**: 2.5 mm (thinner than main airframe, weight optimization)
- **Mass**: 22 kg (including separation hardware)

**Separation Plane** (bolt pattern):
- **Bolt Circle Diameter**: 1.40 m (70 mm inboard from outer diameter)
- **Bolt Quantity**: 72 bolts (5° spacing around circumference)
- **Bolt Size**: M8 × 25 mm (8 mm diameter, 25 mm grip length)
- **Bolt Material**: 4340 steel (high strength, fractures cleanly when cut)
- **Torque**: 20 N·m (preload ensures load distribution)

**Load Transfer**:
- First stage thrust (180 kN) transfers through 72 bolts to second stage
- Load per bolt: 180,000 / 72 = **2500 N** (well below bolt strength)
- Bolt tensile strength: 120 kN (48× safety margin)

---

## Separation Mechanism

### Pyrotechnic Bolt Cutters

**Selected Device**: **Ensign-Bickford EBW-42** (Exploding Bridgewire bolt cutter)
- Proven flight heritage: SpaceX Falcon 9, Rocket Lab Electron, Northrop Grumman PSLV
- High reliability: 0.9998 (failure rate: 2 per 10,000 firings)
- Simultaneous firing: All 72 cutters fire within 1 millisecond (synchronized separation)

**Operating Principle**:
1. Electrical pulse (2 kV, 10 μs duration) sent to bridgewire
2. Bridgewire explodes (vaporizes), creating shock wave
3. Shock wave drives piston through bolt shank (shears bolt in tension)
4. Bolt fragments contained in cutter housing (no debris ejection)
5. Separation occurs in <5 milliseconds (nearly instantaneous)

**Physical Specifications**:
```
Mass per cutter:        85 g
Dimensions:             40 mm diameter × 25 mm height
Electrical input:       28V DC (vehicle power bus)
Firing current:         5 A (peak), 50 mA (holding current)
Bridgewire resistance:  1.0 Ω ± 0.1 Ω
All-fire energy:        250 mJ (guaranteed to fire)
No-fire energy:         50 mJ (guaranteed NOT to fire, safety)
```

**Redundancy**:
- **Dual-redundant firing circuits** (two independent paths to each cutter)
- Either circuit can fire all 72 cutters (single-fault tolerant)
- Cross-strapping: Circuit A fires cutters 1-36, Circuit B fires cutters 37-72
  - If Circuit A fails, Circuit B can fire all 72 cutters (slower, but functional)

**Safety**:
- **Safing pins** installed during ground operations (mechanically prevents firing)
- **Arm/Safe switch** in [[Flight Software]] (software interlock, requires explicit arming command)
- **Continuity check**: Pre-flight test verifies all 72 cutters have continuity (1.0 Ω ±10%)

### Separation Springs

**Purpose**: Provide initial separation impulse (push stages apart after bolts cut)

**Type**: Compression springs (8× springs, 45° spacing around interstage)
- **Spring Material**: 17-7 PH stainless steel (high strength, corrosion resistant)
- **Free Length**: 200 mm (uncompressed length)
- **Compressed Length**: 50 mm (when stages are mated, spring preloaded)
- **Spring Rate**: 15 N/mm (force increases linearly with compression)
- **Preload Force**: (200 - 50) × 15 = **2250 N per spring** (18,000 N total)

**Energy Storage**:
- **Potential Energy**: ½ k x² = ½ × 15 × (150)² = 168,750 J per spring (1.35 MJ total)
- **Released Energy**: Converts to kinetic energy of stages (accelerates stages apart)

**Separation Velocity Calculation**:
```
Total separation impulse: F × Δt = 18,000 N × 0.1 s = 1800 N·s
Second stage mass: 500 kg (dry) + 250 kg (propellant) = 750 kg
Separation Δv: 1800 / 750 = 2.4 m/s

First stage mass: 1200 kg (dry, no propellant remaining)
First stage recoil: -1800 / 1200 = -1.5 m/s (opposite direction)

Relative velocity: 2.4 - (-1.5) = 3.9 m/s
```

**Note**: Spring separation alone provides 3.9 m/s relative velocity. Cold-gas thrusters are backup/fine-tuning (not primary separation mechanism).

---

## Separation Dynamics Analysis

### Tip-Off Analysis

**Tip-Off**: Unwanted angular velocity imparted to second stage during separation (causes trajectory dispersion)

**Causes**:
1. **Asymmetric spring release**: Springs don't release simultaneously (manufacturing tolerance)
2. **CG offset**: Second stage CG not perfectly aligned with separation plane
3. **Aerodynamic forces**: Residual atmospheric drag at 80 km (small but non-zero)

**Analysis Method**: 6-DOF simulation (MATLAB/Simulink model)

**Inputs**:
- Spring release timing tolerance: ±2 milliseconds (worst-case manufacturing variation)
- CG offset: 5 mm lateral, 10 mm axial (measured tolerance)
- Atmospheric density at 80 km: 1.8×10⁻⁵ kg/m³ (U.S. Standard Atmosphere)
- Separation velocity: 2400 m/s (Mach 8)

**Results** (Monte Carlo simulation, 1000 runs):
```
Tip-off rate (pitch/yaw):
  Mean:               0.5 deg/s
  Standard deviation: 0.3 deg/s
  Maximum (3σ):       1.4 deg/s

Tip-off rate (roll):
  Mean:               0.2 deg/s
  Standard deviation: 0.1 deg/s
  Maximum (3σ):       0.5 deg/s
```

**Impact on Mission**:
- Second stage [[Autopilot Software]] can correct tip-off up to 5 deg/s (adequate margin)
- Tip-off contributes ~50 m dispersion to orbit injection (negligible for 250 kg payload)

**Mitigation**:
- Tight spring manufacturing tolerance (±1% force variation, requires precision manufacturing)
- CG measurement before flight (verify <5 mm offset)
- No active tip-off control required (passive separation sufficient)

### Collision Avoidance

**Risk**: Second stage re-contacts first stage after separation (causes catastrophic failure)

**Analysis**: Trajectory simulation (relative motion between stages)

**Assumptions**:
- Separation at 80 km altitude, Mach 8
- First stage begins boost-back burn 4 seconds after separation
- Worst-case: Spring failure (only 7 of 8 springs fire)

**Separation Trajectory** (relative motion):
```
Time    Separation Distance    Notes
T+0     0 m                    Bolt cutters fire
T+0.1s  0.2 m                  Springs push stages apart
T+0.5s  1.0 m                  Second stage ignition (clearance achieved)
T+1.0s  2.5 m                  Second stage thrust accelerates away
T+4.0s  12 m                   First stage boost-back begins (diverging trajectory)
```

**Clearance Margin**: 1.0 m at T+0.5s (second stage ignition)
- **Requirement**: 0.5 m minimum clearance (no re-contact risk)
- **Margin**: 100% (2× required clearance)

**Worst-Case (Spring Failure)**:
- If only 7 springs fire: Separation velocity reduced to 3.4 m/s (vs. 3.9 m/s nominal)
- Clearance at T+0.5s: 0.85 m (still exceeds 0.5 m requirement)
- **Conclusion**: Single spring failure is tolerable (no mission impact)

---

## Environmental Analysis

### Shock Environment

**Shock Source**: Pyrotechnic bolt cutters firing (sudden release of stored energy)

**Shock Spectrum** (measured on similar vehicles):
- **Peak Acceleration**: 500 g (at bolt cutter location, rapidly attenuates with distance)
- **Frequency Content**: 100 Hz - 10 kHz (high-frequency transient)
- **Duration**: <10 milliseconds (short-duration shock)

**Shock Attenuation**:
```
Location                  Distance from Cutters    Shock Level
Interstage structure      0.2 m                    500 g (peak)
Second stage base         0.5 m                    120 g (attenuated 4×)
Second stage avionics     2.0 m                    15 g (attenuated 33×)
Payload                   4.0 m                    3 g (attenuated 167×)
```

**[[Payload Protection]]**:
- Payload mounting uses elastomeric isolators (LORD J-8159, same as [[Avionics System]])
- Isolation efficiency: 90% above 100 Hz (reduces 3g to 0.3g at payload)
- **[[Payload Shock Requirement]]**: 10 g (industry standard for small satellites)
- **[[Actual Shock]]**: 0.3 g (33× margin) ✅

**[[Avionics Survival]]**:
- [[Flight Computer]] shock-qualified to 50 g (tested per MIL-STD-810)
- Actual shock: 15 g (3.3× margin) ✅

### [[Acoustic Environment]]

**[[Noise Source]]**: Second stage solid motor ignition (0.5 seconds [[After]] separation)

**[[Sound Pressure Level]]**: 155 dB (at second stage motor nozzle exit)
- **[[Frequency]]**: 20 Hz - 2000 Hz (broadband combustion noise)
- **Duration**: 60 seconds (motor [[Burn Time]])

**[[First Stage Exposure]]**:
- [[First]] stage is 2 m away [[When]] second stage ignites (rapidly increasing distance)
- Sound pressure attenuates with distance: SPL decreases 6 dB per doubling of distance
- [[At 10]] m separation (T+2s): 155 - 6×log₂(10/2) = 155 - 14 = **141 dB**

**[[Equipment Survival]]**:
- [[Avionics System]] rated to 145 dB (tested during [[Engine Hot Fire Results]])
- Actual exposure: 141 dB (within rating) ✅
- No additional acoustic protection [[Required]]

---

## [[Testing Strategy]]

### [[Ground Testing]]

**Component-[[Level Test]]** (bolt cutter qualification):
- **Objective**: Verify bolt cutters reliably cut bolts in flight-like conditions
- **[[Test Matrix]]**: 20 cutters tested (statistical [[Sample]])
  - Temperature extremes: -40°C (cold soak) and +80°C ([[Hot]] case)
  - Vibration pre-conditioning: 10 grms [[Random]] vibration, 60 seconds
  - Shock pre-conditioning: 100g shock pulse (simulate launch loads)
- **[[Results]]**: 20/20 successful cuts (100% [[Reliability]])
  - Cut time: 3.2 ms ± 0.5 ms ([[All]] within spec)
  - Bolt fragments contained (no debris ejection)

**[[Interstage Separation Test]]** ([[Full]]-scale [[Ground]] test):
- **[[Test Article]]**: Full-scale [[Interstage Adapter]] with 72 bolt cutters
- **Setup**: Suspended from crane (simulates [[Zero]]-g separation)
- **Instrumentation**:
  - [[High]]-speed camera (1000 fps, captures separation sequence)
  - Accelerometers (measure [[Shock Environment]], 6 locations)
  - Load cells (measure separation force vs. time)
- **[[Test Sequence]]**:
  1. Preload [[Separation Plane]] with hydraulic ram (simulate flight loads)
  2. Fire [[All 72]] bolt cutters simultaneously
  3. Measure separation velocity (springs push mass simulator)
  4. Inspect bolt cutter performance (verify all 72 cut [[Successfully]])

**[[Test Results]]** (conducted 2025-10-18):
- ✅ All 72 bolts cut successfully (100% reliability)
- ✅ Separation velocity: 2.1 m/s (within 10% of prediction)
- ✅ Shock levels: 480 g peak (close to 500 g prediction)
- ✅ No debris ejection, no secondary collisions

**[[Lessons Learned]]**:
1. One bolt cutter fired 2 ms late (electrical noise on firing circuit)
   - [[Root Cause]]: Insufficient shielding on firing harness
   - Fix: Add ferrite beads to firing circuit (filters high-frequency noise)
2. [[Separation Springs]] released asymmetrically (one spring bound in [[Guide]])
   - [[Root cause]]: Guide bore too tight (0.1 mm interference)
   - Fix: Increase guide bore by 0.2 mm (provides [[Clearance]])

### [[Flight Testing]]

**Artemis-1 (Single-Stage)**: No separation system, skip flight test

**Artemis-2 (Two-Stage)**: First flight with separation system
- **[[Test Objectives]]**:
  1. Verify clean separation (no stage re-contact)
  2. Measure tip-off rates (validate analysis)
  3. Verify second stage ignition after separation
  4. Confirm first stage survives separation environment (returns safely)

**Instrumentation**:
- High-speed camera on first stage (films separation event, 500 fps)
- Accelerometers on interstage (measure shock, 10 kHz sampling)
- [[GPS]] on [[Both]] stages (measure separation velocity and trajectory)
- [[Telemetry]] downlink from both stages (real-time [[Monitoring]])

**[[Success Criteria]]**:
1. All 72 bolt cutters fire (verified by accelerometer signature)
2. Separation velocity 2.0 ± 0.5 m/s (within prediction)
3. Tip-off [[Rate]] <2 deg/s (controllable by second stage autopilot)
4. Second stage ignition at T+0.5s (nominal [[Timeline]])
5. First stage returns safely (survives separation shock)

---

## [[Failure Modes]] and Mitigation

### FMEA (Failure Modes and [[Effects Analysis]])

| [[Failure Mode]] | Probability | Severity | [[Detection]] | Mitigation | [[Residual Risk]] |
|--------------|-------------|----------|-----------|------------|---------------|
| **Bolt cutter fails to fire** | Low (0.0002) | High (stage collision) | Pre-flight continuity check | Dual-[[Redundant]] firing circuits | [[Very Low]] |
| **Premature separation** | Very Low (<0.0001) | Catastrophic (first stage loses thrust) | Safing pins, [[Software]] interlock | Arm/[[Safe]] switch, physical safing | Very Low |
| **Asymmetric separation** | Medium (0.01) | Medium (tip-off) | Post-separation [[IMU]] | Tight spring tolerances, CG [[Control]] | Low |
| **[[Spring Failure]]** | Low (0.001) | Low (reduced Δv) | Visual inspection | 8 springs (7 sufficient) | Very Low |
| **Interstage structural failure** | Very Low (<0.0001) | Catastrophic (stage breakup) | Load [[Testing]], inspection | 1.4× factor of safety | Very Low |

**[[Highest Risk]]**: Asymmetric separation causing excessive tip-off
- **[[Mitigation 1]]**: Tight spring manufacturing tolerance (±1% force variation)
- **[[Mitigation 2]]**: Pre-flight CG measurement (verify <5 mm offset)
- **[[Mitigation 3]]**: Second stage autopilot can handle up to 5 deg/s tip-off (adequate margin)

**[[Catastrophic Risks]]**: All mitigated to "Very Low" [[Via]] [[Redundancy]] and testing

---

## [[Design Evolution]] ([[Future Variants]])

### Artemis-3 ([[Three]]-[[Stage Variant]])

**Concept**: Add third stage for higher performance (500 kg to [[GTO]], geostationary transfer orbit)

**[[Additional Separation Events]]**:
1. First/second separation at 80 km (same as Artemis-2)
2. Second/third separation at 200 km (above atmosphere, [[Simpler]] design)
3. Fairing separation at 100 km (between first and second separation)

**Second/[[Third Separation Differences]]**:
- **No atmosphere**: No aerodynamic drag, no acoustic environment
- **Simpler mechanism**: Can use cold-gas thrusters only (no pyrotechnics required)
- **Lower shock**: No bolt cutters → quieter separation (better for fragile payloads)
- **[[Marman Clamp]]**: Alternative to [[Bolt Pattern]] (easier to integrate)

**[[Marman Clamp Concept]]**:
- Single tensioned band wraps around separation plane (replaces 72 bolts)
- Pyrotechnic cutter severs band (single cut point, simpler than 72 cutters)
- Spring [[Releases]] clamp halves (stages separate)
- Proven heritage: [[Ariane 5]], Atlas V, Delta IV

**[[Trade Study]]** (Artemis-3 separation mechanism):
| Factor | Bolt Pattern | Marman Clamp |
|--------|--------------|--------------|
| Mass | 22 kg | 15 kg ✅ |
| Reliability | 0.9998 | 0.9995 |
| Shock | 500 g | 200 g ✅ |
| Cost | $85K (72 cutters) | $35K (1 cutter + clamp) ✅ |
| Complexity | High (72 cutters) | Medium (1 cutter) ✅ |

**Recommendation**: **Marman clamp** for second/third separation (lighter, quieter, cheaper)

---

## [[Current Status]]

**[[Design Status]]**: 🟡 **Concept** (preliminary design [[Complete]], detailed design pending)

**Applicability**:
- Artemis-1: **[[Not Applicable]]** (single-stage design, no separation)
- Artemis-2: **[[Planned]]** (two-stage variant, pending [[Program Approval]])
- Artemis-3: **Future** (three-stage variant, 3+ years out)

**[[Design Maturity]]**:
- Concept design: ✅ Complete (this document)
- Preliminary design: 🟡 [[In Progress]] (CAD models, FEA analysis)
- Detailed design: ⏳ [[Not Started]] (awaits Artemis-2 program [[Approval]])
- [[Hardware]] procurement: ⏳ [[Not]] Started

**[[Pending Decisions]]**:
1. **Artemis-2 Program Approval**: [[Management]] decision to proceed with two-stage variant
   - Decision [[Target]]: 2026-Q2 (after Artemis-1 first flight)
   - Depends on: Artemis-1 flight success, customer [[Demand]] for higher payload capacity
2. **[[Interstage Material]]**: Al-[[Li 2195]] vs. [[Carbon]] [[Fiber]] composite
   - Al-Li: Lower cost, easier manufacturing (heritage from [[Airframe Design]])
   - CFRP: 30% lighter (6 kg mass savings), higher cost (+$50K), longer [[Lead Time]]
   - Decision: Pending trade study completion (2026-Q1)

**[[Risk Assessment]]**:
- **[[Technical Risk]]**: Low (proven pyrotechnic separation heritage)
- **[[Schedule Risk]]**: Medium (long-[[Lead]] procurement for bolt cutters: 6 months)
- **[[Cost Risk]]**: Low (well-understood costs from similar vehicles)

---

## Lessons [[Learned]]

### From Ground Testing

**[[Lesson 1]]**: Firing circuit noise caused delayed cutter firing
- **Observation**: One of 72 cutters fired 2 ms late during [[Separation Test]]
- **Root Cause**: Electrical noise on firing harness (induced voltage spike)
- **Fix**: Add ferrite beads to firing circuit (suppresses high-frequency noise)
- **[[Verification]]**: Re-test with ferrites installed, all cutters fired within 0.5 ms [[Window]] ✅

**[[Lesson 2]]**: Separation spring binding in guide
- **Observation**: One spring released slowly (50 ms vs. 10 ms nominal)
- **Root Cause**: Guide bore too tight (0.1 mm interference, manufacturing tolerance [[Stack]]-up)
- **Fix**: Increase guide bore diameter by 0.2 mm (provides 0.1 mm clearance)
- **[[Future Application]]**: Add clearance to all spring-loaded mechanisms ([[Don]]'t rely on nominal dimensions)

### From Similar Vehicles ([[Industry Experience]])

**[[Lesson 3]]**: Bolt cutter debris can damage equipment
- **[[Example]]**: [[Orbital Sciences Taurus]] XL failure (2001) - fairing separation failure
- **Root Cause**: Bolt fragments jammed fairing deployment mechanism
- **[[Our Mitigation]]**: Ensign-Bickford EBW-42 contains all fragments (no debris ejection)
- **Verification**: Inspected after ground test, zero fragments [[Found]] [[Outside]] cutter housing ✅

**[[Lesson 4]]**: Tip-off rates higher than predicted on early Falcon 9 flights
- **Example**: SpaceX Falcon 9 v1.0 experienced 3-5 deg/s tip-off (vs. 1-2 deg/s predicted)
- **Root Cause**: Spring manufacturing variation (±5% force tolerance)
- **[[Our Approach]]**: Tighter spring tolerance (±1%) and pre-flight CG measurement
- **[[Expected Improvement]]**: Tip-off reduced to <1.5 deg/s (within autopilot capability)

---

## [[Related Notes]]

**[[Subsystem Integration]]**:
- [[Structures System]] - Parent overview note
- [[Airframe Design]] - Interstage adapter structural design
- [[Fairing Design]] - Payload fairing separation (separate event from stage separation)

**Propulsion and GNC**:
- [[Propulsion System]] - Second stage propulsion (solid motor)
- [[GNC System]] - Tip-off correction and autopilot response
- [[Autopilot Software]] - Separation sequence logic and control

**[[Decisions]] and [[Requirements]]**:
- [[ADR-003 Landing Strategy]] - Single-stage reusability (why Artemis-1 has no separation)
- [[System Requirements]] - Separation [[System Requirements]] (shock, reliability)

**Testing**:
- [[Test Campaign Overview]] - Separation ground test schedule
- [[Engine Hot Fire Results]] - Acoustic environment characterization (informs separation shock)

**[[Project Management]]**:
- [[Project Roadmap]] - Artemis-2 program schedule (if approved)
- [[Risk Register]] - Separation system risks (catastrophic if fails)
- [[James Park]] - [[Structures Lead]] (owner of separation system design)

**Suppliers**:
- [[Acme Aerospace]] - Potential supplier for interstage fabrication
- Ensign-[[Bickford Aerospace]] (not a note yet) - Bolt cutter supplier
