---
type: decision
status: accepted
date: 2025-09-10
updated: 2025-09-10
decision_makers:
  - "[[Elena Rodriguez]]"
  - "[[Sarah Chen]]"
tags:
  - adr
  - avionics
  - decision
---
# ADR-002: [[Flight Computer]] [[Architecture]]

## [[Status]]

**Accepted** - 2025-09-10

## [[Context]]

The [[Artemis Rocket]] requires a [[Flight Computer]] to manage [[All]] vehicle [[Systems]] during flight. The computer [[Must]] [[Orchestrate]] the [[Propulsion System]], [[GNC System]], [[Avionics System]], and [[Structures System]] while ensuring vehicle [[Safety]] and mission success.

[[Key Constraints]]:
- Budget: $14M total program budget
- Timeline: 18-month development schedule
- Team size: 15 people (limited software expertise)
- Mission criticality: Single point of failure requires high reliability
- Flight environment: Vibration, thermal extremes, radiation exposure

**Mission Requirements**:
- Flight duration: 240 seconds (ascent) + 60 seconds (landing)
- Control loop rate: 1 kHz (real-time control)
- Sensor inputs: 50+ channels (IMU, pressure, temperature, GPS)
- Actuator outputs: 20+ channels (valves, TVC, separation systems)
- Data logging: Full flight telemetry (10 kHz sampling)
- Fault tolerance: Detect and respond to failures <100ms

## Decision

**Selected: Triple-Redundant Flight Computer with Majority Voting**

The [[Flight Computer]] will use three independent processor boards running identical software, with real-time cross-channel comparison and majority voting for fault tolerance.

**Architecture**:
- 3× ARM Cortex-A53 single-board computers (Raspberry Pi Compute Module 4 or similar)
- Real-time Linux (PREEMPT_RT kernel) for deterministic control
- CAN bus interconnect for cross-channel communication
- Independent power supplies per channel (fault isolation)
- Watchdog timers on each channel (autonomous reboot)
- Voting logic implemented in software (2-of-3 agreement required)

## Alternatives Considered

### Option 1: Single Flight Computer (Commercial Off-The-Shelf)

**Advantages**:
- Lowest cost (~$5K for industrial single-[[Board]] computer)
- Simplest [[Software]] (no redundancy [[Management]])
- Fastest development (minimal [[Integration]])
- Proven [[Hardware]] ([[Raspberry Pi]], [[BeagleBone]], etc.)

**Disadvantages**:
- Single point of failure ([[One]] failure = mission loss)
- No fault tolerance (any hardware fault causes abort)
- Unacceptable [[Risk]] for $14M program
- Insurance/safety concerns for crewed flights later

**Conclusion**: Rejected - insufficient reliability for launch vehicle

### Option 2: Dual-Redundant with Hot Backup

**Advantages**:
- Fault tolerance (survives single failure)
- Moderate cost (~$15K for [[Two]] systems)
- [[Simpler]] than triple redundancy
- Automatic failover to backup

**Disadvantages**:
- Cannot detect which computer failed (no [[Voting]])
- Assumes backup is fault-free (might [[Not]] be)
- Ambiguous failure [[Detection]] (was it primary or sensor?)
- Still risky for safety-critical application

**[[Conclusion]]**: Rejected - insufficient fault detection confidence

### [[Option 3]]: Triple-[[Redundant]] with [[Majority Voting]] (Selected)

**Advantages**:
- Survives single failure with [[High]] confidence
- Majority voting detects faulty channel (2-of-3 agreement)
- Can [[Identify]] and isolate failed computer
- Industry standard for safety-critical systems (aircraft, medical)
- Enables graceful degradation (continue on 2 channels if 1 fails)

**Disadvantages**:
- Higher cost (~$25K for three systems)
- Complex software (voting logic, cross-channel communication)
- Increased integration effort (3× the wiring)
- Higher power consumption (3× computers)

**Conclusion**: **SELECTED** - best balance of reliability and cost

### Option 4: Quad-Redundant (2-of-4 Voting)

**Advantages**:
- Survives two simultaneous failures
- Even higher reliability than triple
- Can isolate two failed channels

**Disadvantages**:
- Excessive cost (~$35K, 40% of avionics budget)
- Overkill for 18-[[Month]] development program
- More complex voting logic (combinatorial explosion)
- Diminishing returns vs triple redundancy

**Conclusion**: Rejected - cost and complexity not justified

## Rationale

### 1. [[Reliability Requirements]]

**Mission failure cost**: $14M (entire program budget)
**Acceptable failure rate**: <1% per flight (industry standard for experimental rockets)

**Single computer reliability**: 99% (1% failure rate per flight)
- Failure modes: Processor hang, memory corruption, sensor interface failure, power supply fault

**Triple-redundant reliability**: 99.97% (0.03% failure rate per flight)
- Calculation: 1 - (3 failures OR 2+ simultaneous failures)
- Assumes independent failures (no common-mode faults)
- 30× improvement in reliability

**Verdict**: Triple redundancy meets reliability requirement with margin

### 2. Fault Detection Confidence

**Single computer**: Cannot detect own failure
- Watchdog timer helps but doesn't catch all faults
- Software bugs appear identical on single system

**Dual redundancy**: Can detect disagreement but not fault location
- If computers disagree, which is correct?
- Requires additional decision logic (unreliable)

**Triple redundancy**: Majority voting identifies faulty channel
- 2-of-3 agreement = high confidence in majority
- Failed channel isolated and disabled
- Mission continues on 2 healthy channels

**Verdict**: Triple redundancy provides unambiguous fault detection

### 3. Cost-Benefit Analysis

**Development Cost**:
- Single: $5K hardware, $50K software
- Dual: $15K hardware, $80K software (failover logic)
- Triple: $25K hardware, $120K software (voting + isolation)

**Risk Reduction Value**:
- Single → Dual: Prevents 1% mission loss ($140K expected value)
- Dual → Triple: [[Prevents 0.67]]% mission loss ($94K expected value)
- Triple → Quad: Prevents 0.03% mission loss ($4K expected value)

**[[Optimal Choice]]**: Triple redundancy (marginal cost $40K vs dual, marginal benefit $94K)

**Verdict**: Triple redundancy maximizes expected value

### 4. [[Development Timeline]]

**[[Software Complexity]]**:
- Voting logic: 3 [[Weeks]] (deterministic algorithm)
- Cross-channel [[Communication]]: 2 weeks ([[CAN Bus]] interface)
- Fault isolation: 2 weeks (disable failed channel)
- [[Testing]]: 4 weeks (fault [[Injection]], edge cases)
- **[[Total]]**: 11 weeks additional effort vs single computer

**[[Hardware Integration]]**:
- Triple wiring harness: 1 week
- Independent power supplies: 1 week
- [[Environmental Testing]]: 2 weeks (thermal, vibration for 3 units)
- **Total**: 4 weeks additional effort

**[[Schedule Impact]]**: +15 weeks vs single computer (acceptable for 18-month program)

**Verdict**: Triple redundancy fits development [[Timeline]]

## Implications

### [[Hardware Architecture]]

**[[Processor Selection]]**:
- [[ARM Cortex]]-A53 quad-[[Core]] (1.5 GHz)
- 4 [[GB RAM]] (ample for real-time OS + [[Flight Software]])
- 32 GB eMMC storage (flight software + [[Data Logging]])
- Industrial temperature range (-40°C to +85°C)
- Vibration qualified for [[Launch]] loads

**Per-[[Channel Components]]**:
- Flight computer board (Raspberry Pi CM4 or equivalent)
- Power [[Supply]] module (12V input, 5V/3.3V outputs, isolated)
- Watchdog timer IC (external, independent of processor)
- CAN bus transceiver (cross-channel communication)
- I/O expansion (GPIO, ADC, PWM for sensors/actuators)

**Interconnect**:
- CAN bus (1 Mbps, triple-redundant physical layer)
- Sensor inputs distributed across [[All 3]] channels
- Actuator outputs [[Use]] voted commands (2-of-3 agreement)
- [[GPS Receivers]] (3 independent units, one per channel)

**[[Physical Layout]]**:
- 3 computer boards in separate enclosures (fault isolation)
- Separated by 20cm (vibration isolation, [[Thermal Management]])
- Independent mounting points (no shared [[Failure Modes]])
- EMI shielding per board ([[Prevent]] cross-interference)

### [[Software Architecture]]

**Real-[[Time Operating System]]**:
- [[Linux]] with PREEMPT_RT patch (hard real-time guarantees)
- 1 kHz [[Control Loop]] scheduling (deterministic timing)
- Task [[Priorities]]: Control (highest) → [[Monitoring]] → [[Logging]] → Housekeeping

**[[Voting Algorithm]]**:
```
Every control cycle (1ms):
1. Each channel computes control outputs independently
2. Channels exchange outputs via CAN bus (100μs)
3. Each channel receives 2 peer outputs
4. Voting logic:
   - If all 3 agree (within tolerance): Use consensus
   - If 2 agree, 1 disagrees: Use majority, flag disagreeing channel
   - If all 3 disagree: Abort (catastrophic fault)
5. After 10 consecutive disagreements: Disable faulty channel
6. Continue on 2 healthy channels (2-of-2 agreement required)
```

**[[Fault Injection Testing]]**:
- Software faults: [[Inject]] [[Random]] bit flips, corrupt outputs
- Hardware faults: Disconnect sensors, power supplies
- Timing faults: Delay CAN messages, miss deadlines
- Success [[Criteria]]: [[System]] detects and isolates fault within 100ms

**[[Software Components]]**:
- [[Autopilot Software]] (GNC control loops)
- [[Ignition Sequence]] controller (propulsion [[Startup]])
- [[Engine Controller]] interface (CAN bus to propulsion)
- [[Sensor Fusion]] (IMU, GPS, pressure, temperature)
- [[Telemetry]] system ([[Data]] logging + [[Ground]] transmission)
- [[Health Monitoring]] (fault detection + isolation)

### Integration with [[Other Systems]]

**With [[Propulsion System]]**:
- [[Command Interface]]: Ignition, shutdown, throttle, TVC gimbal
- Telemetry: [[Chamber Pressure]], [[Turbopump]] speed, valve positions
- Redundant [[Command]] paths (all 3 channels send commands, [[Engine Controller]] uses voted result)

**With [[GNC System]]**:
- [[IMU Selection]]: 3 independent IMUs (one per channel)
- GPS receivers: 3 independent units (one per channel)
- Sensor fusion: [[Each]] channel fuses its own sensors, voting on final state estimate
- [[Control Authority]]: [[Autopilot Software]] runs on all 3 channels

**With [[Avionics System]]**:
- Power: 3 independent 12V supplies from battery bus
- Data: CAN bus to other avionics (telemetry, [[Communications]])
- Redundant data paths for critical telemetry

**With [[Structures System]]**:
- [[Separation]] commands: [[Stage Separation]], fairing jettison (voted)
- Landing gear deployment (voted command)
- Pyrotechnic firing (2-of-3 vote [[Required]] for safety)

### [[Performance Estimates]]

**[[Computational Performance]]**:
- [[Control Loop Rate]]: 1 kHz (1ms update cycle)
- Sensor sampling: 10 kHz (IMU, [[Pressure Sensors]])
- Voting latency: <100μs (CAN bus communication)
- Fault detection time: <10ms (10 control cycles to confirm fault)

**Data Logging**:
- [[Sample]] [[Rate]]: 10 kHz (all sensors)
- Storage capacity: 32 GB per channel (96 GB total)
- Flight duration: 300 seconds (5 minutes)
- Data volume: ~50 MB per flight per channel

**[[Power Consumption]]**:
- Per channel: 15W (processor + peripherals)
- Total: 45W (all 3 channels)
- Battery capacity: 1 kWh (flight + margin)
- Flight duration: 300 seconds → 3.75 Wh consumed

### [[Cost Impact]]

**[[Hardware Cost]]**:
- 3× flight computer boards: $15K ($5K each)
- 3× power supplies: $3K
- 3× IMU units: $9K ($3K each)
- 3× GPS receivers: $6K ($2K each)
- CAN bus transceivers, wiring: $2K
- **Total hardware**: $35K

**Software Development**:
- Voting logic: $30K (3 weeks [[Engineer]] time)
- Fault isolation: $20K (2 weeks)
- Cross-channel communication: $20K (2 weeks)
- Testing and [[Validation]]: $50K (5 weeks)
- **Total software**: $120K

**[[Total Cost]]**: $155K (11% of $14M program budget)

### [[Risk Assessment]]

[[Technical Risks]]:
- ✅ Low - Triple redundancy proven in aircraft, medical devices
- ✅ Voting algorithm well-understood (aerospace heritage)
- ⚠️ Medium - Common-[[Mode]] software bugs (all 3 channels [[Run]] same code)
- ⚠️ Medium - Deterministic timing on Linux (PREEMPT_RT validation required)

[[Safety Risks]]:
- ✅ Low - Majority voting prevents single-point failures
- ✅ Fault detection and isolation [[Automated]] (<100ms)
- ⚠️ Medium - All 3 channels disagree = abort (no recovery)

[[Operational Risks]]:
- ✅ Low - Commercial hardware (Raspberry Pi ecosystem)
- ✅ Industrial-[[Grade]] [[Components]] [[Available]]
- ⚠️ Medium - 3× [[Maintenance]] burden (3 boards to [[Test]]/validate)

## [[Stakeholder Approval]]

**Decision makers**:
- [[Elena Rodriguez]] ([[Avionics Lead]]) - **Approved**
- [[Sarah Chen]] ([[Chief Engineer]]) - **Approved**

**Consulted**:
- [[Marcus Johnson]] ([[Propulsion Lead]]) - Supports (reliable command interface)
- [[Team Roster]] - [[Avionics Team]] consensus
- External reviewer (aerospace safety consultant) - Recommends triple redundancy

**Decision [[Date]]**: 2025-09-10
**Review [[Date]]**: Post-flight (validate redundancy effectiveness)

## [[Related Decisions]]

- [[ADR-001 Propellant Selection]] - Propulsion [[Interface Requirements]]
- [[ADR-003 Landing Strategy]] - [[Landing Guidance]] [[Requirements]]
- [[ADR-005 Telemetry Protocol]] - Data transmission architecture
- Future ADR: Real-time OS selection (Linux PREEMPT_RT chosen)

## [[References]]

- NASA [[Human Rating Requirements]] (redundancy [[Standards]])
- DO-178C [[Software Safety Standard]] (avionics certification)
- SpaceX [[Falcon 9]] [[Flight Computer]] (triple redundancy heritage)
- [[Boeing 777]] [[Flight Control Computer]] (triple-triple redundancy)

[[Related Notes]]:
- [[Flight Computer]] - Implementation of [[This]] decision
- [[Avionics System]] - System-level architecture
- [[Autopilot Software]] - Software running on flight computer
- [[GNC System]] - Control algorithms and sensors
- [[Engine Controller]] - Commanded by flight computer
- [[Project Roadmap]] - Impact on schedule
- [[Risk Register]] - Redundancy-[[Related]] risks
- [[Budget Tracker]] - Cost impact

---

*Decision recorded by [[Elena Rodriguez]] - 2025-09-10*
*[[Status]]: Accepted and [[Implemented]]*
