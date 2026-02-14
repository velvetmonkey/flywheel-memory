---
type: test-results
subsystem: propulsion
status: ongoing
owner: "[[Marcus Johnson]]"
created: 2025-12-28
updated: 2026-01-02
tags:
  - testing
  - propulsion
  - hot-fire
---
# [[Engine Hot Fire Results]]

## [[Overview]]

[[This]] document summarizes [[Results]] from the [[Artemis Engine]] [[Hot Fire Test]] campaign. Tests validate the [[Propulsion System]] [[Performance]], [[Thermal Management]], and operational [[Reliability]] before [[First]] flight.

[[Test Facility]]: [[University Rocket Test Stand]]
[[Test Engineer]]: [[David Kim]] ([[Senior Propulsion Engineer]])
[[Status]]: 3 tests [[Complete]], [[Test 4]] [[Scheduled]] [[January 15]], 2026

## [[Test Summary]]

| [[Test]] | [[Date]] | Duration | Thrust | ISP | [[Chamber Pressure]] | [[Status]] |
|------|------|----------|--------|-----|---------------------|--------|
| [[Test 1]] | 2025-12-28 | 30s | 44.2 kN | 287s | 8.2 MPa | ✅ Success |
| [[Test 2]] | 2025-12-30 | 60s | 44.1 kN | 286s | 8.15 MPa | ✅ Success |
| [[Test 3]] | 2026-01-02 | 120s | 44.2 kN | 287s | 8.2 MPa | ✅ Success |
| Test 4 | 2026-01-15 | Restart | TBD | TBD | TBD | ⏳ Scheduled |

**[[Key Achievements]]**:
- ✅ Clean [[Ignition Sequence]] ([[All 3]] tests)
- ✅ [[Stable]] combustion (no pressure oscillations)
- ✅ [[Cooling System]] [[Validated]] (wall temps <650°C)
- ✅ [[Full]] mission duration [[Achieved]] (120s burn)
- ⏳ [[Engine]] restart pending (Test 4)

## Test 1: 30-[[Second Burn]] (2025-12-28)

### Objectives

**Primary**:
- Validate [[Ignition Sequence]] (T-5s through T+2s)
- Achieve stable combustion ([[Chamber Pressure]] 8.2 MPa)
- Verify [[Turbopump]] operation (32,000 RPM [[Target]])
- Confirm [[Thrust Vector Control]] functionality

**Secondary**:
- [[Cooling System]] [[Thermal Performance]] (wall temps)
- Propellant flow rates ([[Mixture Ratio]] 2.4:1 target)
- [[Data]] acquisition [[Systems]] ([[All]] channels functional)

### [[Test Configuration]]

[[Engine Design]]:
- Mounted horizontally on test stand
- [[Fuel Tanks]] (95L RP-1) and [[Oxidizer System]] (145L LOX) vertical
- [[Turbopump]] instrumented (speed, vibration, temperatures)
- [[Cooling System]] with 12× thermocouples on chamber wall
- [[Thrust Vector Control]] actuators installed ([[Gimbal Range]] ±5°)

**Instrumentation**:
- Chamber pressure sensor (0-15 MPa range)
- Thrust load cell (0-60 kN range)
- [[Turbopump Speed]] sensor (optical encoder)
- Fuel flow meter (0-10 kg/s range)
- [[LOX Flow]] meter (0-20 kg/s range)
- 12× thermocouples on [[Combustion Chamber]] wall
- 2× [[High]]-speed cameras (1000 fps, exhaust visualization)
- Data acquisition: 10 kHz sampling (all channels)

**Propellants**:
- RP-1 fuel: 76 kg loaded (30s burn + margin)
- LOX oxidizer: 165 kg loaded (30s burn + margin)
- GN2 pressurization: 3 kg (tank pressurization)

### [[Test Execution]]

**Pre-[[Test Checklist]]**:
- ✅ Propellant tanks filled and pressurized
- ✅ All instrumentation calibrated and verified
- ✅ Control room personnel briefed on abort [[Criteria]]
- ✅ Test stand area [[Cleared]] (500m exclusion zone)
- ✅ Fire suppression [[System]] armed

**[[Ignition Sequence]] [[Execution]]** (per [[Ignition Sequence]] procedure):
```
T-5s: Pressurization start (tank ullage pressurization)
  → Tank pressures: Fuel 0.31 MPa, LOX 0.29 MPa ✅

T-3s: Turbopump spin-up (gas generator ignition)
  → Gas generator pressure: 1.05 MPa ✅
  → Turbopump speed: 10,200 RPM (idle) ✅

T-2s: Fuel flow start (cooling established)
  → Fuel flow rate: 4.9 kg/s ✅
  → Cooling circuit pressure: 15.2 MPa ✅
  → Chamber wall temps stable at 25°C ✅

T-1s: LOX flow start (full propellant flow)
  → LOX flow rate: 10.9 kg/s ✅
  → Turbopump ramp: 10,200 → 32,100 RPM ✅

T+0s: Ignition (pyrotechnic igniter fired)
  → Ignition delay: 450ms (T+0 to chamber pressure rise)
  → Chamber pressure rise: 0 → 8.2 MPa in 2.1s ✅

T+2s: Full thrust achieved
  → Thrust: 44.2 kN (99% of 45 kN target) ✅
  → Chamber pressure: 8.2 MPa (steady-state) ✅
  → Turbopump speed: 32,100 RPM (stable) ✅
```

**Steady-[[State Operation]]** (T+2s to T+30s):
- Thrust: 44.2 ± 0.3 kN (stable, <1% variation)
- Chamber pressure: 8.2 ± 0.05 MPa (no oscillations)
- [[Turbopump]] speed: 32,100 ± 50 RPM (smooth operation)
- Mixture ratio: 2.38:1 (O/F, 99% of 2.4:1 target)
- Fuel flow: 4.8 kg/s (stable)
- LOX flow: 10.8 kg/s (stable)
- Chamber wall temps: 580-620°C range (peak 620°C at T+15s)
- No anomalies detected

**[[Shutdown Sequence]]** (T+30s):
- Throttle to idle (1s ramp)
- Cut LOX flow (immediate combustion stop)
- Cut fuel flow (2s purge)
- Purge activation (GN2 flow through engine)
- Turbopump coast down (10s to [[Zero]] RPM)

### Results

[[Performance Metrics]]:
| Parameter | Target | Measured | Status |
|-----------|--------|----------|--------|
| Thrust (sea level) | 45 kN | 44.2 kN | ✅ 98% |
| [[Specific Impulse]] | 290s | 287s | ✅ 99% |
| Chamber Pressure | 8.5 MPa | 8.2 MPa | ✅ 96% |
| Mixture Ratio | 2.4:1 | 2.38:1 | ✅ 99% |
| Turbopump Speed | 32,000 RPM | 32,100 RPM | ✅ 100% |
| [[Ignition Delay]] | <1s | 450ms | ✅ |
| [[Combustion Stability]] | No oscillations | Stable | ✅ |

[[Thermal Performance]]:
- Chamber wall temperature peak: 620°C ([[Below 650]]°C limit) ✅
- Thermal spike duration: 15s (settled to 595°C steady-state)
- [[Cooling System]] effective: Wall temps controlled throughout burn
- No hotspots detected ([[All 12]] thermocouples within 30°C range)

**[[Turbopump]] Performance**:
- Spin-up time: 3.2s (10,000 → 32,000 RPM)
- Vibration levels: Normal (no resonances detected)
- Bearing temperatures: 85°C (normal operating range)
- Seal performance: No leaks detected

**[[TVC Performance]]**:
- Gimbal range verified: ±5° (actuators functional)
- [[Response Time]]: 50ms ([[Command]] to motion)
- No mechanical issues during test

### Issues and Anomalies

**[[None Detected]]** - Test 1 was fully nominal

**[[Minor Observations]]**:
- Chamber pressure 3.5% below target (8.2 vs 8.5 MPa)
  - [[Root Cause]]: Slightly low mixture ratio (2.38 vs 2.4)
  - Impact: Negligible (thrust within 2% of target)
  - Corrective [[Action]]: Adjust LOX [[Flow Rate]] for Test 2
- Ignition delay 450ms (slightly longer than expected 400ms)
  - Root cause: Pyrotechnic igniter timing
  - Impact: Acceptable (well within 1s requirement)
  - Corrective action: [[None]] (450ms is [[Excellent]] performance)

### Post-[[Test Inspection]]

**[[Engine Condition]]**:
- Combustion chamber: No damage, slight [[Carbon]] deposits (normal)
- Nozzle: Clean, no erosion detected
- [[Turbopump]]: No abnormal wear, bearings smooth
- [[Cooling Channels]]: No blockages, flow verified

**[[Propellant System]]**:
- [[Fuel Tanks]]: No leaks, welds intact
- [[Oxidizer System]]: No leaks, LOX compatibility confirmed
- Feedlines: No damage, flexible bellows functional

**Verdict**: Engine cleared for Test 2 (60s burn)

## Test 2: 60-Second Burn (2025-12-30)

### Objectives

**Primary**:
- [[Thermal Validation]] (chamber wall temps <650°C for 60s)
- Steady-state operation (demonstrate endurance)
- [[Propellant Consumption]] [[Validation]] (120 kg [[Total]] for 60s)

**Secondary**:
- Ignition repeatability (compare to Test 1)
- Performance consistency (thrust, ISP stable over time)
- [[Cooling System]] endurance (validate thermal equilibrium)

### Test Execution

[[Ignition Sequence]]:
- Ignition delay: 420ms (30ms [[Faster]] than Test 1) ✅
- [[Pressure Rise]] time: 2.0s (0.1s faster than Test 1) ✅
- Smooth ramp to [[Full Thrust]]

**Steady-State Operation** (T+2s to T+60s):
- Thrust: 44.1 kN (stable, consistent with Test 1)
- Chamber pressure: 8.15 MPa (adjusted LOX flow, closer to target)
- Mixture ratio: 2.39:1 (improved from Test 1)
- Chamber wall temps: Settled at 595°C by T+30s (steady-state)

### Results

**[[Performance Metrics]]**:
| Parameter | Test 1 | Test 2 | Change |
|-----------|--------|--------|--------|
| Thrust | 44.2 kN | 44.1 kN | -0.2% |
| ISP | 287s | 286s | -0.3% |
| Chamber Pressure | 8.2 MPa | 8.15 MPa | -0.6% |
| Mixture Ratio | 2.38:1 | 2.39:1 | +0.4% |
| Ignition Delay | 450ms | 420ms | -6.7% |

**Thermal Performance**:
- Peak [[Chamber Wall Temp]]: 610°C (T+20s) ✅
- Steady-state temp: 595°C (T+30s onward) ✅
- Thermal equilibrium achieved: [[Yes]] (temps stable [[After]] 30s)
- [[Cooling System]] effective throughout 60s burn

**[[Key Findings]]**:
- ✅ Ignition repeatability excellent (420ms vs 450ms, [[Both]] <1s)
- ✅ Performance consistent between tests (thrust within 0.2%)
- ✅ Thermal equilibrium achieved (595°C steady-state)
- ✅ No degradation over 60s burn (stable operation)

### Issues and Anomalies

**None Detected** - Test 2 was fully nominal

**Post-Test Inspection**:
- Engine condition: [[Good]], minimal carbon buildup
- All systems functional
- Cleared for Test 3 (120s burn)

## Test 3: 120-Second Burn (2026-01-02)

### Objectives

**Primary**:
- Full mission duration validation (240s ascent = 120s burn per stage)
- Endurance [[Testing]] (demonstrate flight-like operation)
- Performance stability (no degradation over full duration)

**Secondary**:
- Propellant consumption (241 kg total, validate capacity)
- Thermal endurance ([[Cooling System]] for full burn)
- TVC operation under sustained thrust

### Test Execution

**[[Ignition Sequence]]**:
- Ignition delay: 435ms (consistent with [[Tests 1]]-2) ✅
- Pressure rise time: 2.1s (nominal) ✅
- Smooth [[Startup]], identical to previous tests

**Steady-State Operation** (T+2s to T+120s):
- Thrust: 44.2 kN (stable throughout)
- Chamber pressure: 8.2 MPa (no drift over 120s)
- Turbopump speed: 32,100 RPM (smooth, no vibration)
- Mixture ratio: 2.38:1 (consistent)

**Thermal Performance**:
- Peak [[Wall Temp]]: 620°C (T+15s, same as Test 1)
- Steady-state temp: 595°C (T+30s onward)
- No thermal degradation over 120s burn
- All 12 thermocouples within 30°C range (uniform cooling)

### Results

**[[Performance Summary]]**:
| Parameter | Target | Test 3 | Status |
|-----------|--------|--------|--------|
| [[Burn Duration]] | 120s | 120s | ✅ 100% |
| Thrust | 45 kN | 44.2 kN | ✅ 98% |
| ISP | 290s | 287s | ✅ 99% |
| Chamber Pressure | 8.5 MPa | 8.2 MPa | ✅ 96% |
| Wall Temp (peak) | <650°C | 620°C | ✅ 95% margin |
| Wall Temp (steady) | <650°C | 595°C | ✅ 91% margin |

**Propellant Consumption**:
- Total propellant burned: 241 kg (165 kg LOX + 76 kg RP-1)
- [[Burn Time]]: 120s
- Average [[Mass Flow Rate]]: 15.7 kg/s (consistent with Tests 1-2)

**[[Key]] [[Achievements]]**:
- ✅ **Full mission duration validated** (120s burn successful)
- ✅ **No performance degradation** (thrust/ISP stable throughout)
- ✅ **Thermal equilibrium [[Maintained]]** (595°C steady-state for 90s)
- ✅ **All subsystems nominal** (turbopump, cooling, TVC)

### Issues and Anomalies

**None Detected** - Test 3 was fully nominal

**Minor [[Observations]]**:
- Chamber wall temperature spike: 620°C (T+15s)
  - Expected behavior (startup thermal transient)
  - Settles to 595°C by T+30s (thermal equilibrium)
  - Well below 650°C limit (55°C margin)
  - No corrective action needed

### Post-Test Inspection

**Engine Condition**:
- Combustion chamber: Light carbon deposits (normal for RP-1)
- Nozzle: No erosion, clean condition
- Cooling channels: No blockages, full flow confirmed
- [[Turbopump]]: Bearing temps normal, no unusual wear
- TVC actuators: Functional, no mechanical degradation

**Propellant System**:
- [[Fuel Tanks]]: Structurally sound, no leaks
- [[Oxidizer System]]: LOX compatibility confirmed (no cracking)
- Feedlines: Bellows intact, no fatigue cracks

**Verdict**: Engine [[Ready]] for Test 4 ([[Restart Test]])

## Test 4: Restart Test ([[Scheduled 2026]]-01-15)

### Objectives

**Primary**:
- Validate engine cold restart after coast [[Phase]]
- Simulate landing burn [[Scenario]] (5-minute shutdown, restart, 20s burn)
- Confirm [[Ignition Sequence]] works after [[Thermal Soak]]

**Secondary**:
- Propellant [[Ullage Management]] (validate capillary vanes in [[Fuel Tanks]])
- [[LOX Boiloff]] during coast (measure loss, confirm margin)
- [[Turbopump Restart]] reliability

### [[Test Plan]]

**Sequence**:
1. Initial burn: 30s (establish baseline)
2. Shutdown: Clean shutdown sequence
3. Coast phase: 5 minutes (engine cold, propellants settled)
4. Ullage burn: 2s GN2 thruster (settle propellants)
5. Restart: Execute [[Ignition Sequence]] (cold start)
6. Second burn: 20s (landing burn simulation)

**[[Success Criteria]]**:
- Clean restart ignition (<1s delay)
- Stable combustion on second burn
- Thrust/ISP within 5% of initial burn
- No cavitation or turbopump issues

**[[Risk Mitigation]]**:
- Abort criteria: [[No Ignition]] within 2s → shutdown
- Propellant reserves: Extra LOX loaded ([[Account]] for boiloff)
- Ullage [[Management]]: GN2 thrusters settle propellants before restart

### [[Expected Challenges]]

**LOX Boiloff**:
- 5-minute coast: [[Expect 2]]-5% LOX loss to boiloff
- Mitigation: Load extra 10 kg LOX (margin)

**Turbopump Restart**:
- Cold turbine: May require longer spin-up time
- Mitigation: Increase [[Gas Generator]] flow for initial spin-up

**[[Propellant Ullage]]**:
- Microgravity simulation: [[Use]] ullage burn to settle propellants
- Validation: Capillary vanes in [[Fuel Tanks]] tested

**Status**: ⏳ Test scheduled for January 15, 2026

## [[Overall Test Campaign Summary]]

### [[Performance Validation]]

**[[All Requirements Met]]**:
| Requirement | Target | Achieved | Margin |
|-------------|--------|----------|--------|
| Thrust (sea level) | 45 kN | 44.2 kN | -2% |
| [[Specific]] Impulse | 290s | 287s | -1% |
| Chamber Pressure | 8.5 MPa | 8.2 MPa | -4% |
| Burn Duration | 120s | 120s | 0% |
| Chamber Wall Temp | <650°C | 620°C peak | +5% margin |
| Ignition Delay | <1s | 435ms avg | +57% margin |
| Combustion Stability | No oscillations | Stable | Pass |

### [[Subsystem Validation]]

[[Propulsion System]]: ✅ Validated
- [[Engine Design]]: Performs to spec
- [[Turbopump]]: Reliable, smooth operation
- [[Fuel Tanks]]: No leaks, structurally sound
- [[Oxidizer System]]: LOX compatible, no issues
- [[Cooling System]]: Effective thermal management
- [[Thrust Vector Control]]: Functional, responsive
- [[Engine Controller]]: All sequences [[Executed]] correctly
- [[Ignition Sequence]]: Repeatable, reliable

### [[Lessons Learned]]

**Successes**:
1. **[[Ignition Sequence]] highly repeatable** (420-450ms delay, all tests)
2. **Thermal equilibrium predictable** (595°C steady-state, 30s to stabilize)
3. **No [[Hardware]] failures** (engine robust, well-designed)
4. **Performance consistent across tests** (thrust variation <0.2%)

**Areas for Improvement**:
1. **Chamber pressure 4% below target**
   - Recommend: Increase mixture ratio to 2.42:1 for flight
   - Expected impact: +3% thrust, +2% ISP
2. **Minor carbon deposits in chamber**
   - Expected for RP-1 fuel ([[Not]] a concern)
   - Post-flight [[Cleaning]] procedures [[Established]]

### [[Flight Readiness Assessment]]

**[[Based]] on Tests 1-3**:
- ✅ Engine meets all [[Performance Requirements]]
- ✅ Thermal management validated for full mission duration
- ✅ All subsystems nominal
- ✅ Ignition sequence reliable and repeatable
- ⏳ Engine restart pending (Test 4 scheduled)

**Recommendation**: Proceed to [[Integrated Vehicle Testing]] pending Test 4 success

## [[Related Notes]]

**Propulsion**:
- [[Engine Design]] - Engine specifications
- [[Propulsion System]] - System-level [[Architecture]]
- [[Turbopump]] - Turbopump performance data
- [[Fuel Tanks]] - Fuel system validation
- [[Oxidizer System]] - LOX system validation
- [[Cooling System]] - Thermal performance data
- [[Thrust Vector Control]] - TVC validation
- [[Engine Controller]] - [[Control System]] performance
- [[Ignition Sequence]] - Sequence validation

**[[Test Campaign]]**:
- [[ADR-004 Test Campaign]] - Test [[Strategy]] decision
- [[Test Campaign Overview]] - Master test plan
- [[Project Roadmap]] - Schedule [[Integration]]
- [[Risk Register]] - Test-[[Related]] risks retired

**Team**:
- [[Marcus Johnson]] - [[Propulsion Lead]]
- [[David Kim]] - [[Test Engineer]]
- [[Team Roster]] - [[Propulsion Team]]

---

*[[Last Updated]]: 2026-01-02 by [[David Kim]]*
*[[Next Review]]: Post-Test 4 (January 15, 2026)*
