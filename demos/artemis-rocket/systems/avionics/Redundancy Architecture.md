---
type: component
subsystem: avionics
status: testing
owner: "[[Elena Rodriguez]]"
created: 2025-09-22
updated: 2026-01-02
---
# [[Redundancy Architecture]]

## [[Overview]]

The Artemis avionics [[Redundancy]] [[Architecture]] provides [[Fault Tolerance]] through [[Hardware]] and [[Software]] redundancy. The [[Design]] uses a triple-modular [[Redundant]] (TMR) [[Flight Computer]] with [[Majority Voting]] to mask single-point failures.

**[[Key Principles]]**:
- **[[Triple redundancy]]**: 3 independent [[Flight Computers]], sensors, and radios
- **[[Majority voting]]**: 2-of-3 [[Voting]] masks single faults
- **[[Fault Detection]]**: [[Automated]] [[Health Monitoring]] and [[Disagreement Detection]]
- **[[Graceful Degradation]]**: [[System]] continues operation with reduced redundancy [[After]] faults

**[[Target Reliability]]**: 99.9% mission success (single fault tolerance)

## Triple-[[Modular Redundancy]] (TMR)

### Architecture

The [[Avionics System]] consists of **[[Three]] independent, identical [[Processing]] lanes**:

```
┌──────────────────────┐
│  Lane A (Primary)    │
│  - Flight Computer A │
│  - IMU-A             │
│  - GPS-A             │
│  - Radio-A           │
└──────┬───────────────┘
       │
       ├───── CAN Bus Network (voting)
       │
┌──────┴───────────────┐
│  Lane B (Secondary)  │
│  - Flight Computer B │
│  - IMU-B             │
│  - GPS-B             │
│  - Radio-B (standby) │
└──────┬───────────────┘
       │
       ├───── CAN Bus Network
       │
┌──────┴───────────────┐
│  Lane C (Tertiary)   │
│  - Flight Computer C │
│  - IMU-C             │
│  - (no GPS-C)        │
│  - (no Radio-C)      │
└──────────────────────┘
```

**Lane Independence**:
- Each lane has its own power supply (from common battery via separate regulators)
- Physical separation (lanes spaced >10cm apart in electronics bay)
- Minimal cross-coupling (only CAN bus and shared sensor inputs)

**Why Triple Redundancy**:
- Single fault tolerance: System survives any single computer failure
- Majority voting: 2 out of 3 correct outputs wins
- No single point of failure (SPOF) in critical path

## Voting Mechanism

### Voting Protocol

Each flight computer independently:
1. **Computes**: Runs [[Flight Software]] (sensor fusion, guidance, navigation, control)
2. **Exchanges**: Broadcasts outputs to other computers via CAN bus (1000 Hz)
3. **Votes**: Performs majority voting on all three outputs (including its own)
4. **Commands**: Sends winning command to actuators ([[Thrust Vector Control]], [[Engine Controller]])

**Voting Frequency**: 1000 Hz (1ms period, synchronized with control loop)

### Voting Algorithm

**Simple Majority Voting** (for continuous values like TVC angle):

```c
// Example: Voting on TVC-X angle
float TVC_X_A = compute_tvc_angle_A();  // Computer A's output
float TVC_X_B = receive_from_computer_B();  // Computer B's output
float TVC_X_C = receive_from_computer_C();  // Computer C's output

// Median voting (robust to outliers)
float TVC_X_voted = median(TVC_X_A, TVC_X_B, TVC_X_C);

// Send voted command to actuator
send_to_actuator(TVC_X_voted);
```

**Exact Voting** (for discrete values like flight mode):

```c
// Example: Voting on flight mode
enum FlightMode mode_A = ASCENT;
enum FlightMode mode_B = ASCENT;
enum FlightMode mode_C = DESCENT;  // Disagrees!

// Count votes
int votes_ascent = count(mode_A, mode_B, mode_C, ASCENT);  // 2 votes
int votes_descent = count(mode_A, mode_B, mode_C, DESCENT);  // 1 vote

// Majority wins
enum FlightMode mode_voted = (votes_ascent > votes_descent) ? ASCENT : DESCENT;
```

### Disagreement Detection

**Threshold-Based Detection**:

Computers continuously monitor disagreement between their outputs:

```c
// Example: Detect disagreement in TVC angle
float threshold = 0.5;  // 0.5° disagreement threshold

float diff_AB = abs(TVC_X_A - TVC_X_B);
float diff_AC = abs(TVC_X_A - TVC_X_C);
float diff_BC = abs(TVC_X_B - TVC_X_C);

if (diff_AB > threshold || diff_AC > threshold || diff_BC > threshold) {
    // Disagreement detected!
    log_event("VOTING_DISAGREEMENT");

    // Identify outlier
    if (diff_BC < threshold) {
        // A is outlier (B and C agree)
        flag_computer_A_fault();
    }
}
```

**Persistent Disagreement**:
- If computer disagrees for >100ms (100 consecutive voting cycles), mark as failed
- Failed computer continues running but outputs ignored
- Mission continues with 2 remaining computers (reduced redundancy)

### Tie-Breaking

**Scenario**: Two computers disagree, third computer must decide

**Tie-Breaking Strategy**:
1. **Sensor health**: Prefer computer with healthier sensors (more GPS satellites, lower IMU noise)
2. **Historical reliability**: Prefer computer with fewer past faults
3. **Deterministic default**: If tie persists, default to Computer A (primary)

**Example**:
```c
// Computer A and B disagree, Computer C must tie-break
if (TVC_X_A != TVC_X_B) {
    if (sensor_health_A > sensor_health_B) {
        TVC_X_voted = TVC_X_A;  // Prefer A (healthier sensors)
    } else if (sensor_health_B > sensor_health_A) {
        TVC_X_voted = TVC_X_B;  // Prefer B
    } else {
        TVC_X_voted = TVC_X_A;  // Default to A (deterministic)
    }
}
```

**Bug Fixed** (v1.5.0): Initial implementation crashed if sensor health equal → Added deterministic default

## Sensor Redundancy

### IMU Redundancy (Triple)

**Configuration**:
- **IMU-A**: Connected to Flight Computer A (primary)
- **IMU-B**: Connected to Flight Computer B (secondary)
- **IMU-C**: Connected to Flight Computer C (tertiary)

**Cross-Strapping**: Each computer can read all three IMUs (via shared SPI bus)
- Allows computers to compare IMU readings
- Detects IMU failures via disagreement detection

**Voting**:
```c
// Each computer reads all 3 IMUs
gyro_A = read_imu_A();
gyro_B = read_imu_B();
gyro_C = read_imu_C();

// Median voting (rejects single outlier)
gyro_voted = median(gyro_A, gyro_B, gyro_C);

// Use voted value for sensor fusion
update_attitude(gyro_voted);
```

**Fault Detection**:
- If one IMU differs from other two by >10% (normalized), mark failed
- Failed IMU excluded from voting (use median of two remaining)
- If two IMUs fail, use single remaining IMU (no voting, degraded accuracy)

See [[Sensor Suite]] for IMU specifications and mounting

### GPS Redundancy (Dual)

**Configuration**:
- **GPS-A**: Primary antenna (fairing apex), connected to Flight Computer A
- **GPS-B**: Backup antenna (side-mounted), connected to Flight Computer B

**Failover Logic**:
```c
// Health check
bool gps_a_healthy = (sats_A > 6) && (hdop_A < 2.0);
bool gps_b_healthy = (sats_B > 6) && (hdop_B < 2.0);

// Select GPS
if (gps_a_healthy) {
    gps_position = gps_A;  // Use primary
} else if (gps_b_healthy) {
    gps_position = gps_B;  // Failover to backup
} else {
    gps_position = INVALID;  // Both failed, enter dead reckoning
    trigger_dead_reckoning();
}
```

**Why Dual (Not Triple)**:
- GPS receivers rarely fail (solid-state, no moving parts)
- Antenna placement more critical than receiver redundancy
- Cost/mass savings (GPS receivers + antennas expensive/heavy)

### Pressure Sensor Redundancy (Triple)

**Configuration**:
- **3× chamber pressure sensors** at 120° spacing around combustion chamber dome
- All sensors read by all three flight computers (shared analog outputs)

**Median Voting**:
```c
pressure_1 = read_pressure_sensor_1();
pressure_2 = read_pressure_sensor_2();
pressure_3 = read_pressure_sensor_3();

// Median voting (rejects single outlier)
pressure_voted = median(pressure_1, pressure_2, pressure_3);

// Use voted pressure for engine control
update_throttle(pressure_voted);
```

**Critical for Safety**:
- Overpressure detection (>10 MPa) triggers emergency shutdown
- Underpressure detection ((7 MPa) indicates incomplete combustion
- Triple redundancy ensures reliable fault detection

## Communications Redundancy

### Dual Transceiver Configuration

**Radios**:
- **Radio-A** (Primary): Actively transmitting telemetry (100 Hz)
- **Radio-B** (Hot Standby): Powered but silent (ready for immediate failover)

**Antenna Diversity**:
- **Primary antenna**: Top-mounted whip (omnidirectional)
- **Secondary antenna**: Side-mounted patch (hemispherical coverage)

**Failover Logic**:
```c
// Monitor Radio-A health
bool radio_a_healthy = (rssi_A > -100 dBm) && (packet_loss_A < 5%);

if (!radio_a_healthy) {
    // Switch to Radio-B
    disable_radio_A();
    enable_radio_B();
    log_event("RADIO_FAILOVER");
}
```

**Failover Time**: <500ms (detected within 5 voting cycles, switched within 100ms)

See [[Communications]] for radio specifications and link budget

## Fault Detection and Isolation (FDI)

### Health Monitoring

Each flight computer runs a **Health Monitor module** (10 Hz) that checks:

**Self-Checks**:
- CPU temperature (<80°C)
- Memory usage (<90%)
- Disk space ()10% free)
- Process watchdog (all modules responding)

**Sensor Checks**:
- IMU: Gyroscope/accelerometer within range, no saturated readings
- GPS: >6 satellites visible, HDOP (2.0, [[Velocity]] residual <1 m/s
- Pressure: [[Chamber Pressure]] 0-15 MPa, tank pressures 0-3 MPa

**[[Actuator Checks]]**:
- [[TVC]]: Gimbal angle [[Matches]] [[Command]] (±0.5°)
- Throttle: [[Engine]] throttle matches command (±2%)
- Valves: Position sensors indicate correct state (open/closed)

**[[Voting Checks]]**:
- Disagreement with other computers (<0.5° for TVC, <2% for throttle)
- [[Persistent Disagreement]] ()100ms) flags fault

### [[Fault Isolation]]

**Identifying the [[Faulty Component]]**:

1. **Self-Diagnosis**: Computer detects own fault (CPU overtemp, memory leak)
   - Computer marks itself failed
   - Broadcasts fault [[Status]] to other computers
   - Other computers exclude faulty computer from voting

2. **[[Peer Diagnosis]]**: Other computers detect fault (persistent disagreement)
   - Majority identifies outlier (e.g., A and B agree, C disagrees → C is faulty)
   - Faulty computer marked failed by consensus
   - Faulty computer's outputs ignored in voting

3. **[[Sensor Diagnosis]]**: Sensor disagreement detected
   - [[Median Voting]] identifies outlier sensor
   - Faulty sensor excluded from voting
   - Mission continues with remaining sensors

### Graceful Degradation

**[[Fault Progression]]**:

| State | [[Redundancy Level]] | Fault Tolerance | [[Action]] |
|-------|------------------|-----------------|--------|
| Nominal | 3 computers, 3 IMUs, 2 [[GPS]] | Single fault tolerant | Normal operation |
| 1 Fault | 2 computers, 2-3 IMUs, 1-2 GPS | No fault tolerance | [[Log]] warning, continue mission |
| 2 Faults | 1 computer, 1-2 IMUs, 0-1 GPS | No redundancy | Initiate emergency landing |
| 3 Faults | 0 computers | [[Total]] failure | Deploy parachute (if [[Available]]) |

**[[Example]]: [[First Fault]]**:
- Computer A fails (CPU overheated)
- Computers B and C continue (vote between themselves)
- Mission continues with reduced redundancy
- **Warning**: [[Next]] fault will cause loss of redundancy

**Example: [[Second Fault]]**:
- Computer B fails (in addition to A)
- Computer C is sole remaining computer (no voting)
- Mission continues [[But]] **no fault tolerance**
- **Action**: Initiate emergency landing (engine shutdown, coast to apogee, deploy parachute)

## Cross-[[Lane Communication]]

### CAN [[Bus Network]]

**Topology**: Dual redundant [[CAN Bus]] (primary + backup)

**Primary CAN Bus**:
- Connects [[All]] three flight computers
- 1 Mbps [[Data Rate]]
- 120Ω terminators at [[Both]] ends

**Backup CAN Bus**:
- Separate physical bus (redundant path)
- Same configuration as primary
- Automatically used if primary bus fails

**[[Message Priority]]**:
| [[Message Type]] | [[Priority]] (ID) | [[Frequency]] | Size |
|--------------|---------------|-----------|------|
| Voting outputs | 0x00-0x0F (highest) | 1000 Hz | 16 bytes |
| [[Sensor Data]] | 0x10-0x1F | 400 Hz | 32 bytes |
| Health status | 0x20-0x2F | 10 Hz | 8 bytes |
| Commands | 0x30-0x3F (lowest) | 1 Hz | 16 bytes |

**Fault [[Detection]]**:
- CAN bus errors [[Monitored]] (error counters, bus-off condition)
- If primary bus fails, switch to backup bus (automatic, (10ms)

### [[Timing Synchronization]]

**Challenge**: Voting requires synchronized [[Execution]] across all three computers

**Solution**: Time-[[Triggered Architecture]]
- All computers boot from common power-on reset
- Execution synchronized to 1ms timer tick (1000 Hz)
- Voting messages transmitted at same time slot [[Each]] cycle (deterministic)

**[[Clock Drift Compensation]]**:
- Computers exchange timestamp with each message
- Detect clock drift ()1ms difference)
- Periodically resynchronize ([[Once]] per second)

**[[Maximum Drift]]**: (1ms (well within 10ms voting period)

## [[Testing]]

### [[Fault Injection Testing]]

**[[Purpose]]**: Validate fault detection, voting, and graceful degradation

**[[Test Scenarios]]** (47 total):

1. **[[Computer Failures]]** (9 scenarios):
   - Computer A crash, Computer B crash, Computer C crash
   - Computer A hangs, Computer B hangs, Computer C hangs
   - All combinations of dual failures

2. **[[Sensor Failures]]** (15 scenarios):
   - [[IMU]]-A fail, IMU-B fail, IMU-C fail (each with bias, saturation, dropout)
   - GPS-A fail, GPS-B fail, both GPS fail
   - Pressure sensor disagreement (1 outlier, 2 outliers)

3. **[[Communication Failures]]** (6 scenarios):
   - Radio-A fail, Radio-B fail, both radios fail
   - Primary CAN bus fail, backup CAN bus fail

4. **[[Actuator Failures]]** (8 scenarios):
   - TVC-X stuck, TVC-Y stuck
   - Throttle valve stuck open, stuck closed
   - Propellant valve failures

5. **[[Compound Failures]]** (9 scenarios):
   - Computer A + IMU-A fail simultaneously
   - Computer A + GPS-A fail simultaneously
   - Various dual/triple fault combinations

**[[Results]]** (from [[Avionics Integration Test]]):
- 45 / 47 scenarios passed (96% [[Success Rate]])
- 2 failures due to software bugs ([[GPS Dropout]], voting tie) - **[[Now]] fixed**

**[[Success Criteria]]**:
- System detects fault within 100ms
- Faulty component isolated correctly (no false [[Positives]])
- Mission continues with reduced redundancy
- No [[Undetected]] faults (0 false negatives)

### [[HIL Testing]]

**Setup**:
- Three flight computers (actual hardware)
- Simulated sensors ([[Inject]] faults [[Via]] software)
- 100 flight profiles (nominal + off-nominal)

**[[Test Coverage]]**:
- [[All 47]] fault scenarios tested in HIL
- Voting latency measured (<3ms, within requirement)
- Disagreement detection [[Validated]] (100% detection [[Rate]])

**[[Bug Found]]**: Voting tie condition ([[Two]] computers disagree, third crashes)
- [[Root cause]]: No tie-breaking logic
- Fix: [[Added]] sensor health tie-breaker (v1.5.0)
- [[Validation]]: Retested all 47 scenarios → 100% pass rate

## [[Lessons Learned]]

### [[What Worked Well]]

1. **[[Triple Redundancy Highly Effective]]**
   - Masked all single faults (100% success rate in HIL testing)
   - Voting latency <3ms (well within 10ms budget)
   - No undetected faults (0 false negatives)

2. **[[Median Voting Robust]] to Outliers**
   - Simple algorithm (easy to [[Implement]] and verify)
   - Automatically rejects single outlier (no complex logic)
   - Works for both continuous values (TVC angle) and discrete values (flight [[Mode]])

3. **[[Fault Injection Testing Critical]]**
   - [[Caught 2]] critical bugs (GPS dropout, voting tie)
   - Validated graceful degradation (system survives dual faults)
   - Increased confidence in fault tolerance

### [[Challenges Encountered]]

1. **[[Clock Synchronization Difficult]]**
   - Initial design: No [[Explicit]] synchronization (relied on power-on reset)
   - Problem: Clock drift )10ms after 5 minutes (voting out of sync)
   - Solution: Periodic resynchronization via CAN bus timestamp exchange
   - [[Result]]: Drift reduced to (1ms (acceptable)

2. **CAN [[Bus Congestion]]**
   - Voting messages at 1000 Hz overwhelmed CAN bus (1 Mbps bandwidth)
   - Impact: Message delays )5ms (voting latency exceeded budget)
   - Solution: Reduced non-voting messages to 10 Hz, [[Prioritized]] voting messages
   - Result: Voting latency <3ms (within budget)

3. **[[Fault Isolation Ambiguity]]**
   - Dual faults hard to isolate (which component failed [[First]]?)
   - Impact: Sometimes wrong component marked failed
   - Solution: [[Historical]] voting log (replay [[Last]] 1000 votes to [[Identify]] first failure)
   - Result: 100% correct fault isolation (validated in testing)

## [[Current Status]]

**[[Design Maturity]]**: 95% ([[Ready]] for CDR)

**[[Completed]]**:
- ✅ [[Triple Redundancy]] architecture [[Implemented]]
- ✅ Majority [[Voting Algorithm]] validated (HIL testing)
- ✅ Fault [[Injection]] testing (47 scenarios, 96% → 100% after bug fixes)
- ✅ Graceful degradation verified (system survives dual faults)

**[[Remaining Work]]**:
- [[Integrated Vehicle Testing]] (all subsystems together)
- [[Flight Readiness Review]] (final validation before flight)

**Risks**:
- **R-026**: Common-mode failure (all three computers fail simultaneously) - Mitigation: Physical [[Separation]], independent power supplies, EMI shielding
- **R-027**: Voting algorithm bug - Mitigation: Extensive testing (unit, [[Integration]], fault injection), [[Code Review]]

## [[Future Enhancements]] (Post-[[First Flight]])

1. **[[Byzantine Fault Tolerance]]**: Handle malicious faults (computer sends different outputs to different computers)
2. **[[Adaptive Voting]]**: Adjust voting thresholds [[Based]] on flight [[Phase]] (tighter during landing, looser during coast)
3. **[[Software Diversity]]**: [[Run]] different software on each computer (prevents software bugs from affecting all computers)
4. **[[Hardware Diversity]]**: [[Use]] different processor architectures (prevents hardware bugs from affecting all computers)

## [[Related Notes]]

**[[Avionics Subsystem]]**:
- [[Avionics System]] - Subsystem overview
- [[Flight Computer]] - Triple redundant computers
- [[Sensor Suite]] - Redundant sensors (IMU, GPS, pressure)
- [[Communications]] - Redundant radios and antennas
- [[Flight Software]] - Voting algorithm implementation

**Testing**:
- [[Avionics Integration Test]] - Fault injection testing results
- [[Test Campaign Overview]] - Overall [[Test]] [[Strategy]]

**[[Project Management]]**:
- [[Project Roadmap]] - Redundancy [[Milestones]]
- [[Risk Register]] - R-026, R-027
- [[Team Roster]] - [[Elena Rodriguez]] ([[Avionics Lead]])

**[[Decisions]]**:
- [[ADR-002 Flight Computer]] - Triple redundancy architecture decision

---

*[[Component Specification]] by [[Elena Rodriguez]] - [[Last Updated]] 2026-01-02*
