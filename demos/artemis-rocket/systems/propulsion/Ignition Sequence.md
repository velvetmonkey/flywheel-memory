---
type: procedure
subsystem: propulsion
status: validated
owner: "[[Marcus Johnson]]"
created: 2025-08-15
updated: 2026-01-02
tags:
  - propulsion
  - ignition
  - startup
  - procedures
---
# [[Ignition Sequence]]

## [[Overview]]

The Artemis [[Engine]] ignition sequence is the critical [[Startup]] procedure that safely transitions the [[Propulsion System]] from idle to [[Full Thrust]]. The sequence ensures propellant flows, cooling is [[Established]], and ignition occurs in the correct order to [[Prevent]] hard starts, backfires, or thermal damage.

**[[Procedure Owner]]**: [[David Kim]] ([[Senior Propulsion Engineer]])
**[[Report To]]**: [[Marcus Johnson]] ([[Propulsion System]] [[Lead]])
**[[Status]]**: ✅ [[Validated]] in [[Tests 1]]-3, [[Refined]] procedure established

## [[Sequence Overview]]

**Duration**: T-5s to T+2s (7 seconds [[Total]])
**Phases**: Pre-ignition (T-5 to T-0) → Ignition (T+0) → Ramp-up (T+0 to T+2)

**[[Key Principle]]**: Fuel flow starts before ignition to ensure [[Cooling System]] is [[Active]]. [[This]] prevents chamber burnthrough during the ignition transient.

## [[Detailed Sequence]]

### T-5s: [[Pressurization Start]]

**Actions**:
- Open pressurant valves on [[Fuel Tanks]] and [[Oxidizer System]]
- GN2/GOX pressurant begins filling tank ullage
- [[Target]] pressure: 0.3 MPa (tank [[Operating Pressure]])

**[[Verification]]**:
- Tank [[Pressure Sensors]] confirm [[Rising]] pressure
- Target reached within 3 seconds (by T-2s)

**Rationale**:
- Ensures adequate tank pressure for [[Turbopump]] inlet
- Prevents cavitation during pump startup

### T-3s: [[Turbopump Spin]]-Up

**Actions**:
- [[Turbopump]] [[Gas Generator]] propellant valves open (small flow)
- Gas generator ignites (pyrotechnic igniter)
- Turbine spins up to idle speed (10,000 RPM)

**Verification**:
- [[Turbopump]] speed sensor confirms rotation
- Gas generator [[Chamber Pressure]] rises to 1 MPa (idle)
- Target speed reached within 2 seconds (by T-1s)

**Rationale**:
- Turbopump [[Must]] be spinning before main propellant valves open
- Idle speed provides initial fuel flow for cooling

### T-2s: [[Fuel Flow Start]] ([[Cooling Established]])

**Actions**:
- [[Main Fuel Valve]] (MFV) opens
- RP-1 fuel flows through [[Cooling System]] channels
- Fuel exits to [[Engine Design]] main injector ([[Not]] yet [[Injected]] - LOX not flowing)

**Verification**:
- Fuel flow sensor confirms 4.8 kg/s flow
- Cooling circuit pressure rises to 15 MPa
- Chamber wall thermocouples confirm fuel cooling (wall temp [[Stable]])

**Rationale**:
- **CRITICAL**: Cooling must be active BEFORE ignition
- Fuel flow prevents chamber burnthrough during startup thermal spike
- 2-second lead time ensures cooling established

### T-1s: LOX [[Flow Start]]

**Actions**:
- [[Main Oxidizer Valve]] (MOV) opens
- LOX flows through [[Oxidizer System]] feedline to [[Turbopump]]
- [[LOX Pump]] spins up, delivers LOX to main injector
- Turbopump ramps from idle (10,000 RPM) to [[Run]] speed (32,000 RPM)

**Verification**:
- [[LOX Flow]] sensor confirms 10.8 kg/s flow
- LOX pump [[Outlet Pressure]] rises to 12 MPa
- Turbopump speed reaches 32,000 RPM

**Rationale**:
- LOX and fuel [[Now]] flowing to injector (not yet ignited)
- Propellants mixing at injector, [[Ready]] for ignition
- Turbopump at [[Full]] speed for stable combustion

### T-0s: Ignition

**Actions**:
- Pyrotechnic igniter fires ([[Spark]] or pyro charge)
- Propellant mixture at injector ignites
- [[Combustion Chamber]] pressure rises rapidly
- Thrust builds to full power

**Verification**:
- Chamber pressure sensor confirms rapid rise (0 → 8.2 MPa in (500ms)
- Thrust measurement confirms rising force
- Turbopump speed stable at 32,000 RPM
- [[Cooling System]] thermocouples [[Show]] wall temp spike then stabilize

**Rationale**:
- Propellants already flowing - igniter [[Only]] triggers combustion
- Smooth ignition (no hard start) because propellant flow pre-established

### T+0 to T+2s: Ramp-Up to Full Thrust

**Actions**:
- Combustion stabilizes
- Chamber pressure reaches 8.2 MPa (full thrust)
- Thrust reaches 44.2 kN (full power)
- [[Cooling System]] in steady-state (wall temp 595°C)
- [[Thrust Vector Control]] becomes active (gimbal control enabled)

**Verification**:
- Chamber pressure stable at 8.2 MPa
- Thrust stable [[At 44.2]] kN
- No pressure oscillations (combustion stability)
- Cooling [[System]] wall temp [[Below 650]]°C

**Rationale**:
- 2-second ramp allows smooth transition to full power
- [[Avoids]] sudden thermal or pressure spikes
- [[GNC System]] takes over control [[Once]] thrust stable

## [[Timing Diagram]]

```
T-5s  ┌──────────────────────────────────────────┐
      │ Pressurization Start (tanks)              │
T-3s  ├──────────────────────────────────────────┤
      │ Turbopump Spin-Up (gas generator)         │
T-2s  ├──────────────────────────────────────────┤
      │ Fuel Flow Start (cooling active)          │
T-1s  ├──────────────────────────────────────────┤
      │ LOX Flow Start (full propellant flow)     │
T+0s  ├──────────────────────────────────────────┤ IGNITION
      │ Combustion Starts                          │
T+2s  ├──────────────────────────────────────────┤
      │ Full Thrust Achieved                       │
      └──────────────────────────────────────────┘
```

## [[Shutdown Sequence]]

**Duration**: T+0s to T+5s (5 seconds total)
**Purpose**: Safely stop combustion and purge engine

### T+0s: Throttle to Idle

**Actions**:
- [[Flight Computer]] commands throttle to 20% thrust
- Propellant flow reduced (1 kg/s RP-1, 2.2 kg/s LOX)
- Chamber pressure drops to 1.6 MPa

**Rationale**:
- Gentle transition prevents pressure spike
- Reduces thermal shock on engine [[Components]]

### T+1s: Cut LOX Flow

**Actions**:
- Main oxidizer valve (MOV) closes
- LOX flow stops (combustion stops)
- Chamber pressure drops rapidly (no combustion)
- Fuel still flowing (purges combustion chamber)

**Verification**:
- Chamber pressure drops to near [[Zero]] (<0.1 MPa)
- LOX flow sensor confirms zero flow

**Rationale**:
- Stopping LOX kills combustion immediately
- Fuel flow continues to cool chamber and purge residual gases

### T+2s: Cut Fuel Flow

**Actions**:
- Main fuel valve (MFV) closes
- RP-1 flow stops
- Cooling system drains
- Turbopump coasts down

**Verification**:
- Fuel flow sensor confirms zero flow
- Turbopump speed decaying (coast down to zero in ~10s)

**Rationale**:
- 2-second fuel-only flow purges hot gases from chamber
- Prevents residual propellant from igniting post-shutdown

### T+3s: Gas Generator Shutdown

**Actions**:
- Gas generator propellant valves close
- Turbine coasts down to zero

**Verification**:
- Gas generator chamber pressure drops to zero
- Turbopump speed decaying to zero

### T+5s: Purge System Activation

**Actions**:
- GN2 purge gas flows through engine
- Purges residual propellant vapors
- Inert atmosphere prevents accidental ignition

**Verification**:
- Purge gas flow confirmed
- All propellant lines and chambers purged

## Test Results

### Test 1 (30s burn, 2025-12-28)

**Ignition Performance**:
- Ignition delay: 450ms (T+0 command to chamber pressure rise)
- Pressure rise time: 2.1s (0 → 8.2 MPa)
- No pressure oscillations during startup
- Smooth ramp to full thrust

**Key Learnings**:
- Ignition sequence timing validated
- 2-second fuel flow pre-start adequate for cooling
- No hard start or backfire observed

### Test 2 (60s burn, 2025-12-30)

**Ignition Performance**:
- Ignition delay: 420ms (slightly faster, turbopump warm)
- Pressure rise time: 2.0s
- Identical startup profile to Test 1 (good repeatability)

**Key Learnings**:
- Consistent ignition performance
- Procedure repeatable and reliable

### Test 3 (120s burn, 2026-01-02)

**Ignition Performance**:
- Ignition delay: 435ms
- Pressure rise time: 2.1s
- Wall temperature spike: 620°C (peak during ignition), settled to 595°C

**Key Learnings**:
- Cooling system handles ignition thermal spike well
- Peak wall temp 620°C during startup transient (still below 650°C limit)
- Thermal spike duration <5 seconds (acceptable)

### Shutdown Performance (All Tests)

**Shutdown Characteristics**:
- Throttle to idle: 1 second (smooth)
- LOX cutoff: Immediate combustion stop (<200ms)
- Fuel purge: 2 seconds (complete chamber purge)
- No residual combustion or post-shutdown anomalies

## Failure Modes & Aborts

### Hard Start

**Symptom**: Chamber pressure spike )12 MPa during ignition
**Cause**: Propellant accumulation before ignition, sudden release
**Detection**: Chamber pressure sensor, >10 MPa rise in <100ms
**Response**: Immediate shutdown, abort sequence

**Prevention**:
- Staggered propellant valve opening (LOX [[Last]])
- Igniter fires immediately [[When]] propellants flowing
- No propellant accumulation possible

### Backfire (Flashback)

**Symptom**: Flame propagates backward into injector or turbopump
**Cause**: Ignition before propellant flow established
**[[Detection]]**: Unexpected [[Pressure Rise]] in feedlines or turbopump
**Response**: Emergency shutdown, close [[All]] valves

**Prevention**:
- Fuel flow starts 2 seconds BEFORE ignition
- Propellant flow direction always toward chamber (no reverse flow)
- Check valves prevent backflow

### [[No Ignition]]

**Symptom**: Propellants flowing, no chamber pressure rise
**Cause**: Igniter failure
**Detection**: Timeout (no pressure rise within 1 second of ignition [[Command]])
**Response**: Emergency shutdown, purge engine, [[Safe]] propellants

**Recovery**:
- Close propellant valves
- [[Purge System]] with GN2
- Inspect and replace igniter
- Retry ignition sequence

### [[Turbopump Failure During Startup]]

**Symptom**: Turbopump fails to [[Reach]] run speed
**Cause**: Gas generator failure, turbine damage, bearing seizure
**Detection**: Turbopump speed sensor, insufficient RPM
**Response**: Abort ignition sequence before propellant valves open

**[[Safety]]**:
- Turbopump speed verified at T-1s (before LOX flow)
- If insufficient speed, abort before main propellant flows
- No combustion without adequate propellant pressure

## [[Requirements Verification]]

### [[Performance Requirements]]
- [[PR]]-016: Ignition delay <1s ✅ (450ms average)
- PR-017: Startup ramp time <3s ✅ (2.1s measured)
- PR-018: Shutdown ramp time <5s ✅ (2s measured)

### [[Safety Requirements]]
- SAF-017: Cooling active before ignition ✅ (2s fuel flow pre-start)
- SAF-018: Hard start detection and abort ✅ (pressure [[Monitoring]])
- SAF-019: No propellant accumulation ✅ (staggered valve opening)
- SAF-020: Post-shutdown purge ✅ (GN2 purge validated)

## [[Documentation]]

**[[Procedure Documentation]]**:
- [[Ignition Sequence Specification]] (this document)
- Startup timing diagram and control logic
- Shutdown sequence and purge procedures
- Abort logic and failure [[Mode]] response

**[[Test Documentation]]**:
- [[Test 1]]-3 ignition [[Performance]] [[Data]]
- Startup pressure/temperature/thrust profiles
- Ignition repeatability analysis

**[[Related]]**:
- [[Engine Design]] - Engine assembly
- [[Propulsion System]] - System-level startup
- [[Turbopump]] - Spin-up and propellant delivery
- [[Fuel Tanks]] - Fuel [[Supply]] and pressurization
- [[Oxidizer System]] - LOX supply and pressurization
- [[Cooling System]] - Pre-ignition cooling critical
- [[Flight Computer]] - Sequence control and timing
- [[Engine Hot Fire Results]] - [[Test Data]] and analysis

**[[Project Management]]**:
- [[Project Roadmap]] - [[Test]] schedule
- [[Risk Register]] - Ignition-related risks (now retired)
- [[Team Roster]] - [[Propulsion Team]]

---

*[[Last Updated]]: 2026-01-02 by [[David Kim]]*
*[[Next]] review: Post-[[Test 4]] (refined timing if needed), pre-flight final [[Validation]]*
