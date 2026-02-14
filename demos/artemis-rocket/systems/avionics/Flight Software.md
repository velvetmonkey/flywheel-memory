---
type: component
subsystem: avionics
status: testing
owner: "[[Elena Rodriguez]]"
created: 2025-09-20
updated: 2026-01-02
---
# [[Flight Software]]

## [[Overview]]

The Artemis flight [[Software]] is the embedded software running on the [[Flight Computer]] that [[Controls]] the vehicle throughout its mission. It implements [[Guidance]], [[Navigation]], [[Control]] (GNC), [[System]] [[Health Monitoring]], fault [[Management]], and [[Telemetry]].

**[[Key Responsibilities]]**:
- [[Sensor fusion]] (combining [[IMU]], [[GPS]], pressure [[Sensor Data]])
- Guidance (computing desired trajectory)
- Navigation (estimating [[Vehicle State]])
- Control (commanding actuators to [[Track]] trajectory)
- Health [[Monitoring]] (detecting faults, triggering safeguards)
- Telemetry (formatting and transmitting [[Data]] to [[Ground]])

**[[Design Philosophy]]**: Modular, testable, deterministic real-time [[Execution]]

## [[Software Architecture]]

### Module Overview

The flight software is organized into **8 independent modules**, [[Each]] running as a separate process or thread:

1. **[[Sensor Drivers]]** (400 Hz): Reads IMU, GPS, [[Pressure Sensors]]
2. **[[Sensor Fusion]]** (100 Hz): Estimates vehicle state (position, [[Velocity]], attitude)
3. **Guidance** (10 Hz): Computes desired trajectory
4. **Navigation** (100 Hz): Updates state estimate with GPS corrections
5. **Control** (1000 Hz): Computes actuator commands ([[TVC]], throttle)
6. **[[Health Monitor]]** (10 Hz): Detects faults, triggers safeguards
7. **[[Telemetry]] Formatter** (100 Hz): Formats and transmits telemetry
8. **[[Command Handler]]** (10 Hz): Processes ground commands

### [[Process Scheduling]]

**[[Operating System]]**: PREEMPT_RT [[Linux 5.15]]

**[[Scheduling Policy]]**: Fixed-[[Priority]] preemptive multitasking
- Higher priority processes preempt lower priority
- Deterministic latency ((100μs)
- [[Priorities]] assigned [[Based]] on criticality and [[Frequency]]

**[[Priority Assignment]]**:
| Module | Priority | Frequency | [[CPU Time]] | Jitter |
|--------|----------|-----------|----------|--------|
| Sensor Drivers | 99 (highest) | 400 Hz | 1ms | <50μs |
| Control | 95 | 1000 Hz | 0.5ms | <100μs |
| Sensor Fusion | 90 | 100 Hz | 2ms | <200μs |
| Navigation | 85 | 100 Hz | 2ms | <200μs |
| Telemetry Formatter | 80 | 100 Hz | 3ms | <500μs |
| Guidance | 70 | 10 Hz | 5ms | <1ms |
| Health Monitor | 60 | 10 Hz | 2ms | <1ms |
| Command Handler | 50 (lowest) | 10 Hz | 1ms | <1ms |

**CPU Utilization**:
- Total CPU time per second: ~500ms (across all modules)
- Available CPU: 6400 DMIPS (quad-core ARM Cortex-A72)
- Utilization: ~50% (50% margin for transients)

### Inter-Process Communication

**Shared Memory**:
- Modules communicate via shared memory (POSIX shared memory)
- Read-write synchronization using mutex locks
- Example: Sensor Fusion writes state estimate → Control reads state estimate

**Message Queues**:
- Used for event-driven communication (e.g., ground commands)
- POSIX message queues (priority-based FIFO)
- Example: Command Handler receives command → sends to Guidance module

**Data Flow Diagram**:
```
Sensor Drivers → Sensor Fusion → Navigation → Control → Actuators
                        ↓              ↓           ↓
                   Telemetry ←────────┴───────────┘
                        ↓
                 Communications Radio

Ground Commands → Command Handler → Guidance / Control
```

## Sensor Drivers

**Purpose**: Read raw sensor data and make it available to other modules

**Implementation**:
- Language: C (low-level hardware access)
- Interface: SPI (IMU, pressure sensors), UART (GPS), I2C (voltage/current monitors)
- Execution: 400 Hz (triggered by timer interrupt)

**Data Acquisition**:
1. Read IMU-A, IMU-B, IMU-C via SPI (3× parallel reads)
2. Read GPS-A, GPS-B via UART (NMEA parsing)
3. Read chamber pressure sensors (3× ADC channels)
4. Read temperature sensors (12× thermocouples)
5. Write data to shared memory (timestamp + sensor values)

**Fault Detection**:
- SPI timeout: If IMU read takes )10ms, mark sensor failed
- GPS dropout: If no NMEA message for 2 seconds, mark GPS failed
- Pressure sensor disagreement: If 3 sensors differ by >0.5 MPa, mark one failed (median filter)

## Sensor Fusion

**Purpose**: Combine redundant sensor measurements to produce optimal state estimate

**Algorithm**: Extended Kalman Filter (EKF)
- Prediction: Integrate IMU accelerometer/gyroscope (400 Hz)
- Correction: Update with GPS position/velocity (25 Hz)

**State Vector** (15 elements):
```
Position (3):         X, Y, Z (ECEF coordinates, meters)
Velocity (3):         Vx, Vy, Vz (m/s)
Attitude (4):         Quaternion q0, q1, q2, q3
Gyroscope Bias (3):   Bx, By, Bz (rad/s)
Accelerometer Bias (3): Ax, Ay, Az (m/s²)
```

**Process Model** (prediction step):
```c
// Integrate gyroscope → update attitude quaternion
q_new = q_old + 0.5 * dt * Omega(gyro - bias) * q_old

// Integrate accelerometer → update velocity
v_new = v_old + dt * (R(q) * (accel - bias) + gravity)

// Integrate velocity → update position
p_new = p_old + dt * v_new
```

**Measurement Model** (correction step):
```c
// GPS measurement: position and velocity
z_gps = [lat, lon, alt, vx, vy, vz]

// Innovation (difference between predicted and measured)
y = z_gps - h(x_predicted)

// Kalman gain
K = P * H^T * (H * P * H^T + R)^-1

// State update
x_new = x_predicted + K * y

// Covariance update
P_new = (I - K * H) * P
```

**Tuning Parameters**:
- Process noise: Q = diag([0.01, 0.01, 0.01, ...]) (tuned empirically)
- Measurement noise: R = diag([10, 10, 20, ...]) (from GPS datasheet)

See [[Sensor Suite]] for sensor fusion performance results

## Guidance

**Purpose**: Compute desired trajectory from current state to target

**Algorithm**: Proportional Navigation (PN) for ascent, Powered Descent Guidance (PDG) for landing

**Ascent Guidance** (T+0 to T+180s):
- Objective: Maximize altitude while staying on vertical trajectory
- Control: Pitch program (pre-computed pitch angle vs. time)
- Constraints: Max dynamic pressure (Q ( 35 kPa), max acceleration (<5g)

**Coast Guidance** (T+180s to T+450s):
- Objective: Ballistic coast to apogee
- Control: TVC maintains vertical attitude (minimize attitude errors)

**Descent Guidance** (T+450s to T+600s):
- Objective: Soft landing (vertical velocity <2 m/s at touchdown)
- Algorithm: Powered Descent Guidance (PDG) - convex optimization
- Implementation: Iterative solver (10 Hz update rate)

**Powered Descent Guidance** (see [[Landing Algorithm]] for details):
```
Minimize: Fuel consumption
Subject to:
  - Position at touchdown = target (0, 0, altitude=0)
  - Velocity at touchdown = (0, 0, -2 m/s)
  - Thrust within limits (0.5 to 1.0 × max thrust)
  - TVC gimbal within limits (±5°)
  - Glide slope constraint (avoid high horizontal velocity near ground)
```

## Navigation

**Purpose**: Refine state estimate using GPS measurements

**Implementation**: Wrapper around Sensor Fusion module
- Calls Sensor Fusion EKF with GPS measurement
- Monitors GPS health (satellite count, HDOP)
- Switches to dead reckoning if GPS unhealthy

**GPS Health Criteria**:
- Satellites: )6 visible
- HDOP: (2.0 (horizontal dilution of precision)
- Velocity residual: <1 m/s (difference between predicted and measured velocity)

**Dead Reckoning Mode** (GPS dropout):
- Integrate IMU only (no GPS correction)
- Accuracy degrades over time (gyroscope bias drift)
- Estimate error growth: ±5m per 10 seconds without GPS

## Control

**Purpose**: Compute actuator commands to track desired trajectory

**Control Law**: Proportional-Integral-Derivative (PID) control

**Actuators**:
- **Throttle**: 50-100% (controls vertical thrust)
- **TVC-X**: -5° to +5° (controls pitch)
- **TVC-Y**: -5° to +5° (controls yaw)

**PID Control for Attitude**:
```c
// Error = desired_attitude - current_attitude
error = q_desired - q_current

// PID terms
P = Kp * error
I = Ki * integral(error) * dt
D = Kd * (error - error_prev) / dt

// TVC command
TVC_X = P.pitch + I.pitch + D.pitch
TVC_Y = P.yaw + I.yaw + D.yaw
```

**Gain Tuning**:
- Kp (proportional): Aggressive response (fast tracking)
- Ki (integral): Eliminates steady-state error
- Kd (derivative): Damping (prevents overshoot)

**Gains**:
| Mode | Kp | Ki | Kd | Notes |
|------|----|----|-----|-------|
| Ascent | 2.0 | 0.1 | 0.5 | Aggressive (fast response) |
| Coast | 1.0 | 0.05 | 0.3 | Moderate (stability) |
| Descent | 1.5 | 0.1 | 0.4 | Balanced (tracking + damping) |

See [[Autopilot Software]] for detailed control law design

## Health Monitor

**Purpose**: Detect faults and trigger safeguards

**Monitored Systems**:
- [[Sensor Suite]]: IMU failures, GPS dropouts, pressure sensor disagreement
- [[Power Distribution]]: Under-voltage, over-current, battery temperature
- [[Engine Controller]]: Combustion instability, turbopump overspeed
- [[Flight Computer]]: CPU temperature, memory usage, disk space

**Fault Detection Logic**:
```c
// Example: Chamber pressure overpressure detection
if (chamber_pressure > 10.0 MPa) {
    fault_detected = OVERPRESSURE;
    trigger_safeguard(ENGINE_SHUTDOWN);
}

// Example: GPS dropout detection
if (time_since_gps_fix > 5.0 seconds) {
    fault_detected = GPS_DROPOUT;
    trigger_safeguard(DEAD_RECKONING_MODE);
}
```

**Safeguard Actions**:
| Fault | Safeguard | Description |
|-------|-----------|-------------|
| Overpressure | Engine Shutdown | Immediately close propellant valves |
| Underpressure | Engine Restart | Attempt reignition (if altitude )10 km) |
| GPS Dropout | Dead Reckoning | Continue with IMU-only navigation |
| IMU Failure | Switch to Backup IMU | Use IMU-B or IMU-C |
| Battery Low | Load Shedding | Disable non-critical loads |
| CPU Overtemp | Throttle CPU | Reduce processor frequency |

## Telemetry Formatter

**Purpose**: Format and transmit telemetry to ground station

See [[Telemetry]] for detailed telemetry system design

**Implementation**:
- Execution: 100 Hz (triggered by timer interrupt)
- Packet format: 128 bytes (binary)
- Transmission: UART to [[Communications]] radio
- Logging: SD card (backup if radio fails)

**Data Collection**:
1. Read state estimate from Sensor Fusion
2. Read actuator commands from Control
3. Read sensor data from Sensor Drivers
4. Pack into binary packet (header + payload + CRC)
5. Write to UART (radio transmission)
6. Write to SD card (onboard log)

## Command Handler

**Purpose**: Process ground commands and update vehicle behavior

**Command Types**:
- **Abort**: Emergency shutdown (close valves, deploy parachute)
- **Hold**: Pause countdown (pre-launch only)
- **Resume**: Resume countdown after hold
- **Parameter Update**: Change control gains, trajectory, thresholds
- **Mode Change**: Switch flight modes (manual control, autonomous)

**Command Validation**:
- Verify CRC-32 checksum (prevent corruption)
- Verify timestamp (prevent replay attacks)
- Require double confirmation for critical commands (Abort, Mode Change)

**Command Execution**:
```c
// Example: Abort command
if (command == ABORT) {
    // Close propellant valves
    close_lox_valve();
    close_rp1_valve();

    // Shutdown engine
    shutdown_engine();

    // Deploy parachute (if altitude >5 km)
    if (altitude > 5000) {
        deploy_parachute();
    }

    // Log event
    log_event("ABORT_COMMANDED");
}
```

## Software Development

### Version Control

**Repository**: Git (internal GitLab server)
- Repo: `artemis-flight-software`
- Branch strategy: `main` (stable), `develop` (integration), feature branches
- Tagging: v1.0.0 (PDR), v2.0.0 (CDR), v3.0.0 (flight-ready)

### Build System

**Cross-Compilation**:
- Host: x86_64 Linux workstation
- Target: ARM 64-bit (aarch64-linux-gnu)
- Toolchain: GCC 11.2 (ARM cross-compiler)
- Build: CMake + Make

**Dependencies**:
- PREEMPT_RT kernel headers
- Eigen (linear algebra library for EKF)
- CAN utilities (libsocketcan)

**Build Configuration**:
```cmake
# CMakeLists.txt
cmake_minimum_required(VERSION 3.16)
project(artemis-flight-software)

set(CMAKE_C_COMPILER aarch64-linux-gnu-gcc)
set(CMAKE_CXX_COMPILER aarch64-linux-gnu-g++)
set(CMAKE_C_FLAGS "-O2 -Wall -Werror -fPIC")

add_executable(flight_software
    src/sensor_drivers.c
    src/sensor_fusion.c
    src/guidance.c
    src/navigation.c
    src/control.c
    src/health_monitor.c
    src/telemetry.c
    src/command_handler.c
    src/main.c
)

target_link_libraries(flight_software pthread rt Eigen3::Eigen)
```

### Testing Strategy

**Unit Tests**:
- Framework: Google Test (C++ test framework)
- Coverage: >80% line coverage (measured with gcov)
- Execution: Automated on every git commit (CI/CD pipeline)

**Integration Tests**:
- Simulated sensor inputs (inject IMU, GPS, pressure data from file)
- Validate outputs (state estimate, actuator commands)
- Execution: Weekly (full test suite runs for 4 hours)

**Hardware-in-Loop (HIL) Tests**:
- Flight computers + sensors + radios (actual hardware)
- Simulated flight profiles (100 scenarios)
- Success rate: 96% (see [[Avionics Integration Test]])

### Code Review

**Process**:
- All code changes require peer review (via GitLab merge requests)
- Reviewer checks: Correctness, style, performance, security
- Approval required from 2 reviewers before merge to `main`

**[[Static Analysis]]**:
- Tool: [[Clang Static Analyzer]]
- [[Checks]]: Memory leaks, null pointer dereferences, buffer overflows
- No warnings allowed (treat warnings as errors)

### [[Documentation]]

**[[Code Documentation]]**:
- Doxygen comments for [[All]] functions
- [[Generated]] HTML documentation (published to internal wiki)

**[[System Documentation]]**:
- [[Software Architecture Document]] (SAD) - [[High]]-level [[Design]]
- [[Interface Control Document]] (ICD) - module interfaces
- [[User Manual]] - ground operator procedures

## [[Flight Software Versions]]

| Version | [[Date]] | [[Status]] | Changes |
|---------|------|--------|---------|
| v1.0.0 | 2025-09-15 | Released (PDR) | Initial [[Release]], [[Basic]] functionality |
| v1.5.0 | 2025-11-20 | Released | [[GPS Dropout]] fix, [[Voting]] tie fix |
| v2.0.0-rc1 | 2025-12-15 | [[Testing]] (CDR candidate) | Emergency shutdown logic, [[Qualification Testing]] |
| v2.0.0 | 2026-01-10 | [[Planned]] | Final CDR release |
| v3.0.0 | 2026-11-01 | Planned | Flight-[[Ready]] ([[After]] [[Integrated Vehicle Testing]]) |

## [[Lessons Learned]]

### [[What Worked Well]]

1. **[[Linux]] + PREEMPT_RT [[Exceeded Expectations]]**
   - Real-time latency (100μs (better than expected)
   - Rich ecosystem ([[Debugging]] [[Tools]], libraries)
   - Development [[Faster]] than [[Custom]] RTOS (6 months vs. estimated 12)

2. **[[Modular Architecture Simplified Testing]]**
   - Each module tested independently (unit tests)
   - Easy to replace modules (e.g., swap [[Guidance Algorithm]])
   - Debugging easier (isolate faults to [[Specific]] module)

3. **HIL [[Testing Caught Critical Bugs]]**
   - GPS [[Dropout Handling]] bug (flight software crashed)
   - Voting tie condition bug (third computer crashed)
   - [[Both]] fixed before flight ([[Would]] [[Have]] been mission-critical failures)

### [[Challenges Encountered]]

1. **Real-[[Time Kernel Tuning]]**
   - Initial latency )1ms due to background kernel tasks
   - Solution: [[Disabled]] unnecessary [[Services]], isolated CPU cores
   - [[Result]]: Latency reduced to (100μs

2. **[[Sensor Fusion Stability]]**
   - EKF diverged during high-g maneuvers ()3g [[Acceleration]])
   - [[Root Cause]]: Process noise too low (didn't [[Account]] for maneuver dynamics)
   - Solution: Increased process noise by 10×
   - Result: EKF [[Stable]] during all maneuvers (tested in HIL)

3. **[[Memory Management]]**
   - Memory leaks detected in [[Telemetry Formatter]] ([[SD Card]] write buffer)
   - Impact: [[Memory Usage]] grew over time (would crash after ~30 minutes)
   - Solution: Fixed buffer allocation (malloc → static buffer)
   - Result: Memory usage constant (220 MB for entire mission)

## [[Current Status]]

**[[Design Maturity]]**: 95% (ready for CDR)

**[[Completed]]**:
- ✅ All modules [[Implemented]] and tested (unit tests, [[Integration Tests]])
- ✅ [[HIL Testing]] (96% [[Success Rate]])
- ✅ GPS dropout and voting tie bugs fixed
- ✅ [[Code Review]] and static analysis (no warnings)

**[[Remaining Work]]**:
- Emergency shutdown logic qualification testing (v2.0.0)
- Integrated vehicle testing (all subsystems together)
- [[Flight Readiness Review]] (final [[Approval]] before flight)

**Risks**:
- **R-024**: Software bug escapes to flight - Mitigation: Extensive testing (unit, [[Integration]], HIL), code review, static analysis
- **R-025**: Timing violation (real-time deadline missed) - Mitigation: Conservative CPU budget (50% utilization), [[Watchdog]] timer

## [[Future Enhancements]] (Post-[[First Flight]])

1. **[[Machine Learning]]**: Onboard [[ML]] for terrain hazard [[Detection]] (crater avoidance for lunar landing)
2. **[[Model Predictive Control]] (MPC)**: Replace PID with MPC for optimal control
3. **Fault-[[Tolerant Guidance]]**: Adapt trajectory in real-time if actuator fails
4. **[[Software Updates]]**: Over-the-air software updates (upload new software [[Via]] radio)

## [[Related Notes]]

**[[Avionics Subsystem]]**:
- [[Avionics System]] - Subsystem overview
- [[Flight Computer]] - [[Hardware Platform]]
- [[Sensor Suite]] - Sensor fusion algorithm
- [[Communications]] - [[Telemetry Transmission]]
- [[Telemetry]] - Telemetry [[Packet Format]]
- [[Redundancy Architecture]] - [[Voting Logic]]

**[[GNC Subsystem]]**:
- [[GNC System]] - GNC overview
- [[Autopilot Software]] - Control law details
- [[Landing Algorithm]] - [[Powered Descent Guidance]]
- [[IMU Selection]] - IMU specifications

**Testing**:
- [[Avionics Integration Test]] - HIL testing [[Results]]
- [[Test Campaign Overview]] - Overall [[Test]] [[Strategy]]

**[[Project Management]]**:
- [[Project Roadmap]] - Software [[Milestones]]
- [[Risk Register]] - R-024, R-025
- [[Team Roster]] - [[Elena Rodriguez]] ([[Avionics Lead]])

**[[Decisions]]**:
- [[ADR-002 Flight Computer]] - Triple [[Redundancy Architecture]]
- [[ADR-005 Telemetry Protocol]] - Telemetry format

---

*[[Component Specification]] by [[Elena Rodriguez]] - [[Last Updated]] 2026-01-02*
