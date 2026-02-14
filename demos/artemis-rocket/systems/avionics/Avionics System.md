---
type: subsystem
status: on-track
owner: "[[Elena Rodriguez]]"
phase: integration
created: 2025-07-05
updated: 2026-01-02
tags:
  - avionics
  - electronics
  - flight-computer
---
# [[Avionics System]]

## [[Overview]]

The Artemis Avionics [[System]] provides [[All]] electronics, computing, [[Communications]], and electrical power for the [[Launch]] vehicle. The [[Architecture]] [[Features]] triple-[[Redundant]] [[Flight Computers]] for mission-critical fault tolerance.

**[[System Lead]]**: [[Elena Rodriguez]]
**[[Team Size]]**: 5 (3 [[Hardware]], 2 [[Software]])
**[[Status]]**: 🟢 [[On Track]] - [[Integration Phase]]

## [[Key Specifications]]

| Parameter | Specification | Status |
|-----------|---------------|--------|
| [[Flight Computer]] | Triple redundant | ✅ [[Design]] [[Complete]] |
| CPU | Rad-hard [[ARM Cortex]]-A53 | ✅ Procured |
| Memory | 8GB RAM, 64GB flash (per computer) | ✅ [[Validated]] |
| [[Update Rate]] | 1kHz control loop | ✅ Validated in HIL |
| Communications | S-band primary, C-band backup | ✅ [[Link Budget]] complete |
| [[Data Rate]] | 10 Mbps downlink | ✅ Verified |
| Power | 28V DC bus, 500W avg, 1kW peak | ✅ Sized |
| Redundancy | Triple-triple (compute, power, comms) | ✅ Architecture validated |

## [[System Architecture]]

```
┌──────────────────────────────────────────────┐
│            Avionics System                    │
├──────────────────────────────────────────────┤
│                                               │
│  [[Flight Computer]] (3x redundant)          │
│       ↓                                       │
│  [[Sensor Suite]]:                           │
│    - IMU (3x)                                │
│    - GPS (2x)                                │
│    - Altimeters (3x)                         │
│    - Rate Gyros (3x)                         │
│       ↓                                       │
│  [[Communications]]:                         │
│    - S-band (primary)                        │
│    - C-band (backup)                         │
│       ↓                                       │
│  [[Telemetry]] downlink (10 Mbps)           │
│       ↓                                       │
│  [[Power Distribution]] (28V bus)            │
│                                               │
└──────────────────────────────────────────────┘
```

## [[Major Components]]

### Computing
- [[Flight Computer]] - Triple redundant flight computer (FDR-2000 series)
- [[Flight Software]] - Real-time operating system + [[Applications]]
- [[Redundancy Architecture]] - Voter-[[Based]] fault tolerance

### Sensors
- [[Sensor Suite]] - Complete sensor complement
- [[IMU Selection]] - Inertial measurement units (3x)
- [[GPS Receivers]] (2x) - Position/[[Velocity]]
- Altimeters (3x barometric + 1x radar) - Altitude sensing
- [[Rate Gyros]] (3x) - Backup to IMU

### Communications
- [[Communications]] - S-band and C-band radios
- [[Telemetry]] - Downlink formatting and transmission
- Antennas - Patch array (S-band), horn (C-band)
- Encryption - AES-256 for [[Command]] uplink

### Power
- [[Power Distribution]] - 28V DC [[Power Distribution Unit]]
- Battery - Li-ion, 5 kWh capacity
- Solar panels - Boost [[Phase]] power augmentation (optional)
- Converters - DC-DC for subsystem power [[Rails]]

## [[Current Status]]

### [[Integration]] Phase

**[[Phase Goal]]**: Integrate all avionics [[Components]] into testable [[Engineering]] unit

**Progress**:
- ✅ [[Flight Computer]] units received ([[All 3]])
- ✅ [[Sensor Suite]] selection complete, units ordered
- ✅ [[Communications]] radios received and benchtop tested
- ✅ [[Power Distribution]] unit fabricated and tested
- 🔄 Cable harness fabrication (80% complete)
- 🔄 Avionics [[Stack]] assembly ([[Scheduled]] [[Jan 15]]-31)
- ⏳ [[Avionics Integration Test]] ([[July 2026]])

### [[Hardware Status]]

| Component | Qty | Status | Delivery |
|-----------|-----|--------|----------|
| [[Flight Computer]] (FDR-2000) | 3 | ✅ Received | [[Dec 15]], 2025 |
| IMU ([[IMU Selection]]) | 3 | 🔄 In transit | [[Jan 20]], 2026 |
| [[GPS Receiver]] | 2 | ✅ Received | [[Dec 20]], 2025 |
| [[Barometric Altimeter]] | 3 | ✅ Received | [[Jan 5]], 2026 |
| [[Radar Altimeter]] | 1 | 🔄 In transit | [[Jan 25]], 2026 |
| S-band Radio | 1 | ✅ Received | [[Dec 10]], 2025 |
| C-band Radio | 1 | ✅ Received | [[Dec]] 10, 2025 |
| [[Power Distribution]] Unit | 1 | ✅ Fabricated | [[Dec 28]], 2025 |
| [[Battery Pack]] | 1 | 🔄 In fabrication | [[Feb 5]], 2026 |

### [[Software Status]]

**Challenge**: [[Flight Software]] development complexity ([[See]] [[Risk Register]] R-007)

**[[Current Focus]]**:
- [[Autopilot Software]] - [[Core]] guidance and control algorithms
- [[Landing Algorithm]] - Propulsive landing guidance
- Integration with [[GNC System]] - G&C coordination

**Progress**:
- ✅ Boot loader and RTOS port complete
- ✅ Sensor drivers complete (IMU, GPS, altimeters)
- ✅ Communications drivers complete (S/C-band)
- 🔄 Autopilot core algorithms (75% complete)
- 🔄 [[Landing Algorithm]] (60% complete - schedule [[Risk]])
- ⏳ Hardware-in-loop [[Testing]] (starts [[Feb 1]])
- ⏳ Software CDR demo ([[March 10]])

**Mitigation** (R-007):
- [[Added 2]] contractor software developers (start [[Jan 6]])
- Descoped [[Trajectory Optimization]] from v1.0
- [[Daily Standup]] with software team
- Parallel algorithm development approaches

## [[Design Decisions]]

### [[ADR-002 Flight Computer]]
**Decision**: Triple redundant flight computers with voter-based fault tolerance
**[[Date]]**: 2025-09-15
**Rationale**:
- Mission-critical fault tolerance for crewed-like [[Reliability]]
- Proven architecture ([[Space Shuttle]], [[Falcon 9]] heritage)
- Handles single-point failures with graceful degradation
- Commercial rad-hard processors [[Available]] (FDR-2000 series)

**Architecture**:
- 3 independent flight computers running identical software
- Cross-channel [[Data]] [[Links]] (1 kHz update [[Rate]])
- [[Mid]]-value select [[Voting]] for sensor inputs
- 2-of-3 agreement for control outputs
- Automatic failover if [[One]] computer fails

**[[Alternatives Considered]]**:
- Single computer (rejected: no fault tolerance)
- Dual redundant (rejected: can't resolve disagreement)
- Cold spare (rejected: slower failover)

### [[ADR-005 Telemetry Protocol]]
**Decision**: S-band primary with C-band backup
**Date**: 2025-12-20
**Rationale**:
- S-band (2.2-2.3 GHz) is standard for launch vehicles
- C-band (5.0-5.2 GHz) provides higher bandwidth backup
- Dual-band diversity mitigates [[Link]] failures
- [[Both]] bands [[Have]] flight-proven hardware available

**Link Budget**:
- S-band: 10 Mbps downlink, 100 kbps uplink
- C-band: 50 Mbps downlink (backup/enhanced)
- Range: 2000 km (covers [[Full]] trajectory)
- Margin: 6 dB (S-band), 9 dB (C-band)

## [[Integration Status]]

### With Other [[Systems]]

[[Propulsion System]]:
- [[Engine Controller]] interface [[Via]] CAN bus
- Commands: Start, throttle, shutdown, TVC gimbal
- [[Telemetry]]: [[Chamber Pressure]], TVC position, valve states
- Update rate: 1 kHz

[[Structures System]]:
- Avionics bay in [[Airframe Design]] upper section
- Vibration isolation mounts (attenuate [[Engine]] vibration)
- Thermal control (heaters + insulation)
- Cable routing through [[Stage Separation]] interface

[[GNC System]]:
- [[Sensor Suite]] provides state estimation inputs
- [[Flight Software]] executes [[Autopilot Software]] and [[Landing Algorithm]]
- Control outputs to [[Propulsion System]] TVC and throttle
- Closed-loop control at 1 kHz

**[[Ground Systems]]**:
- Pre-flight: Ethernet interface for software load
- In-flight: S-band/C-band for telemetry and commands
- Post-flight: Data download via C-band [[High]]-rate link

## [[Test Campaign]]

### [[Completed Tests]]

**[[Benchtop Testing]]** (Nov-[[Dec 2025]]):
- ✅ [[Flight Computer]] power-on, boot, [[Basic]] I/O
- ✅ [[Communications]] radio RF [[Performance]]
- ✅ [[Power Distribution]] load testing, voltage regulation
- ✅ Sensor interfaces (IMU, GPS, altimeters)

**[[Redundancy Validation]]** (Dec 2025):
- ✅ 3x flight computer cross-channel links [[Working]]
- ✅ Voter algorithm validated in simulation
- ✅ Failover scenarios tested (simulated computer failure)

### [[Upcoming Tests]]

[[Avionics Integration Test]] (July 2026):
- Objective: Integrate full avionics stack, validate interfaces
- Configuration: 3x flight computers + all sensors + radios + power
- Duration: 4 [[Weeks]]
- Environment: Lab bench, then thermal-vac chamber

**Hardware-in-Loop (HIL) Testing** (Feb-[[June 2026]]):
- [[Flight Software]] running on real hardware
- Simulated vehicle dynamics and sensor inputs
- Validate [[Autopilot Software]] and [[Landing Algorithm]]
- Closed-loop control [[Verification]]

**[[Electromagnetic Compatibility]] (EMC)** ([[Aug 2026]]):
- Radiated emissions testing
- Susceptibility to external RF
- Power quality (conducted emissions)

**[[Environmental Qualification]]** ([[Sep 2026]]):
- Vibration (launch loads)
- Thermal-vacuum (flight environment)
- Shock ([[Stage Separation]], landing)

See [[Test Campaign Overview]] for full schedule.

## [[Requirements Traceability]]

### [[System Requirements]]
- SR-004: [[Autonomous]] flight capability ✅
- SR-005: Telemetry downlink ≥ 1 Mbps ✅ (10 Mbps provided)
- SR-006: Command uplink capability ✅

### [[Performance Requirements]]
- [[PR]]-005: Control loop ≥ 100 Hz ✅ (1 kHz provided)
- PR-006: State estimation accuracy ±1% ✅ (validated in sim)
- PR-007: Communications range ≥ 1000 km ✅ (2000 km link budget)

### [[Safety Requirements]]
- SAF-004: Triple redundancy on flight-critical systems ✅
- SAF-005: Command [[Authentication]] (encryption) ✅
- SAF-006: Flight termination system ✅ (via [[Flight Software]])

## Team

**[[Lead]]**: [[Elena Rodriguez]]
- Avionics system [[Architect]]
- Software development lead
- Risk owner: R-007 ([[Flight Software Schedule]])

**[[Hardware Engineers]]**:
- [[Michelle Torres]] - Embedded systems, [[Flight Computer]] integration
- Kevin O'Brien - Sensors, [[IMU Selection]]
- [[Lisa Anderson]] - RF, [[Communications]] and [[Telemetry]]

**[[Software Engineers]]**:
- [[Robert Zhang]] (Contractor) - [[Flight Software]] lead
- 2x Contractors ([[Starting Jan]] 6) - [[Autopilot Software]], [[Landing Algorithm]]

See [[Team Roster]] for full team details.

## Schedule & Milestones

| Milestone | Date | Status |
|-----------|------|--------|
| [[Preliminary Design Review]] | 2025-12-18 | ✅ Complete |
| Flight computer delivery | 2026-01-20 | ✅ Complete (early) |
| Cable harness complete | 2026-01-31 | 🔄 In progress |
| HIL testing start | 2026-02-01 | ⏳ [[Planned]] |
| [[Critical Design Review]] | 2026-03-10 | ⏳ Planned |
| [[Avionics Integration Test]] | 2026-07-15 | ⏳ Planned |
| Avionics delivery to integration | 2026-09-01 | ⏳ Planned |

See [[Project Roadmap]] for overall program schedule.

## [[Risks

See]] [[Risk Register]] for complete risk analysis.

**[[Medium Priority]]**:
- R-007: [[Flight Software]] schedule (Score: 12)
  - Mitigation: Contractor support, [[Scope]] reduction
- R-002: [[IMU Selection]] [[Supplier Quality]] (Score: 6)
  - Mitigation: Backup IMU [[Identified]]
- R-018: [[Communications]] bandwidth at max-Q (Score: 6)
  - Mitigation: C-band backup per [[ADR-005 Telemetry Protocol]]

**[[Monitoring]]**:
- Battery delivery schedule
- Radar altimeter delivery schedule

## Budget

**[[Avionics System Budget]]**: $2.8M (of $14M [[Total]])

| Category | Budget | Spent | Remaining |
|----------|--------|-------|-----------|
| Flight Computers (3x) | $0.9M | $0.9M | $0 |
| Sensors & GPS | $0.6M | $0.5M | $0.1M |
| Radios (S/C-band) | $0.4M | $0.4M | $0 |
| Power System | $0.3M | $0.2M | $0.1M |
| Cable & Integration | $0.2M | $0.1M | $0.1M |
| Software Development | $0.4M | $0.2M | $0.2M |

See [[Budget Tracker]] for program-level budget.

## [[Documentation]]

**[[Design Documentation]]**:
- [[Flight Computer]] - Computer architecture
- [[Redundancy Architecture]] - Fault tolerance design
- [[Sensor Suite]] - Sensor selection and integration
- [[Communications]] - Radio design and link budget
- [[Telemetry]] - Data formatting and protocols
- [[Power Distribution]] - Electrical power architecture

**[[Software Documentation]]**:
- [[Flight Software]] - [[Software Architecture]]
- [[Autopilot Software]] - Guidance and control algorithms
- [[Landing Algorithm]] - Propulsive landing guidance

**Decisions**:
- [[ADR-002 Flight Computer]]
- [[ADR-005 Telemetry Protocol]]

**[[Project Management]]**:
- [[Project Roadmap]]
- [[Risk Register]]
- [[Team Roster]]

## [[Meeting Notes

Recent]] discussions:
- [[2025-12-18 PDR Review]] - Avionics design review
- [[2026-01-02 Sprint Planning]] - Q1 integration plan

---

*[[Last]] [[Updated]]: 2026-01-02 by [[Elena Rodriguez]]*
*[[Next]] review: Weekly [[Project Roadmap]] review*
