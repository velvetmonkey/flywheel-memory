---
type: component
subsystem: gnc
status: complete
owner: "[[Elena Rodriguez]]"
created: 2025-08-15
updated: 2026-01-02
---
# [[Autopilot Software]]

## [[Overview]]

The **Autopilot [[Software]]** is the [[Core]] [[Control]] algorithm that maintains vehicle stability and executes [[Guidance]] commands during [[All]] [[Flight Phases]]. Running on the [[Flight Computer]] at 1000 Hz, the autopilot translates desired trajectory from [[Landing Algorithm]] into actuator commands for [[Thrust Vector Control]] and [[Engine]] throttle.

**[[Control Architecture]]**: Cascaded PID (Proportional-Integral-Derivative) control
- **[[Outer Loop]]** (10 Hz): Position/[[Velocity]] control → desired attitude
- **[[Inner Loop]]** (1000 Hz): Attitude/[[Rate]] control → actuator commands

**Flight Phases**:
1. **Boost** (T+0 to T+120s): [[Ascent Guidance]], max-Q throttle-back
2. **Coast** (T+120s to T+400s): Ballistic arc to 80 km apogee
3. **Descent** (T+400s to T+480s): [[Powered]] descent, [[Landing Guidance]]

**[[Key Performance]]**:
- **[[Attitude Accuracy]]**: ±1° (during boost and descent)
- **[[Thrust Vector Authority]]**: ±5° (engine [[Gimbal Range]])
- **[[Control Loop Rate]]**: 1000 Hz (1 ms cycle time)

[[See]] [[Flight Software]] for [[Software Architecture]] and [[GNC System]] for overall guidance [[Strategy]].

---

## [[Control Modes]]

### [[Mode 1]]: [[Boost Phase]] (T+0 to T+120s)

**Objective**: Follow ascent trajectory, maximize altitude while limiting aerodynamic loads

**[[Guidance Law]]**: Pitch-over maneuver (gravity turn)
```
t = 0-10s:    Vertical ascent (pitch = 90°)
t = 10-30s:   Pitch-over (pitch decreases from 90° to 60°)
t = 30-120s:  Gravity turn (follow velocity vector, minimize angle of attack)
```

**Throttle Control**: Max-Q throttle-back
```python
# Dynamic pressure: q = 0.5 * rho * V^2
if q > q_max (30 kPa):
    throttle = 0.6  # Reduce thrust to 60% during max-Q
else:
    throttle = 1.0  # Full thrust otherwise
```

**Attitude Control**: PID controller maintains desired pitch angle
```python
# Outer loop: Compute desired pitch from trajectory
pitch_desired = get_trajectory_pitch(time)

# Inner loop: PID controller
pitch_error = pitch_desired - pitch_actual
pitch_rate_cmd = Kp * pitch_error + Ki * integral(pitch_error) + Kd * pitch_rate

# Actuator command: Convert pitch rate to TVC angle
tvc_angle = pitch_rate_cmd / tvc_gain
```

**PID Gains** (tuned via simulation):
```
Kp = 2.5    (proportional gain)
Ki = 0.1    (integral gain, eliminates steady-state error)
Kd = 0.8    (derivative gain, damping)
```

### Mode 2: Coast Phase (T+120s to T+400s)

**Objective**: Ballistic coast to apogee, minimal control authority

**Control**: Reaction Control System (RCS) thrusters (future upgrade, not implemented on Artemis-1)
- Current design: Passive coast (no active control)
- Vehicle naturally stable (CG forward of CP)

**Telemetry**: Continuous state estimation via [[IMU Selection]] + GPS

### Mode 3: Descent Phase (T+400s to T+480s)

**Objective**: Powered descent to landing pad, soft touchdown at (5 m/s

**Guidance**: Powered Descent Guidance (PDG) algorithm (see [[Landing Algorithm]])
- Computes desired position, velocity, attitude at each timestep
- Autopilot tracks these commands

**Throttle Control**: Variable throttle (25% to 100%)
```python
# Vertical velocity control (outer loop)
v_z_error = v_z_desired - v_z_actual
thrust_cmd = m * g + Kp_vz * v_z_error + Kd_vz * a_z_actual

# Throttle command (normalized to engine capability)
throttle = thrust_cmd / thrust_max  # thrust_max = 180 kN
throttle = clamp(throttle, 0.25, 1.0)  # Engine throttle range 25-100%
```

**Attitude Control**: Same PID structure as boost, higher gains for responsive landing
```
Kp = 4.0    (2× boost gains, more aggressive)
Ki = 0.2
Kd = 1.5
```

**Landing Transition** (final 10 seconds):
```
Altitude < 10 m:
  - Reduce horizontal velocity to <1 m/s (center over landing pad)
  - Maintain vertical descent at 2.5 m/s (constant descent rate)
  - Level attitude (pitch/roll = 0°, vehicle vertical)

Altitude < 1 m:
  - Engine cutoff trigger: Ground contact detected (landing leg sensors)
  - Throttle to zero, allow vehicle to settle on legs
```

---

## Software Implementation

### Real-Time Loop (1000 Hz)

**Main Control Loop** (running on [[Flight Computer]], PREEMPT_RT Linux):

```python
def autopilot_loop():
    """
    Main autopilot control loop - runs at 1000 Hz (1 ms cycle)
    """
    while True:
        start_time = get_time_us()

        # 1. Read sensors (IMU, GPS, pressure sensors)
        imu_data = read_imu()  # 400 Hz IMU data (latest sample)
        state = sensor_fusion.get_state()  # EKF state estimate (position, velocity, attitude)

        # 2. Determine flight mode
        mode = get_flight_mode(time, altitude, velocity)

        # 3. Compute guidance commands
        if mode == BOOST:
            pitch_cmd, throttle_cmd = boost_guidance(time, state)
        elif mode == COAST:
            pitch_cmd, throttle_cmd = coast_guidance(state)
        elif mode == DESCENT:
            pitch_cmd, throttle_cmd = landing_guidance(state)

        # 4. Attitude control (inner loop PID)
        pitch_error = pitch_cmd - state.pitch
        pitch_rate_error = 0 - state.pitch_rate  # Desired rate = 0 (hold attitude)

        tvc_angle = Kp * pitch_error + Kd * pitch_rate_error
        tvc_angle = clamp(tvc_angle, -5.0, 5.0)  # Limit to ±5° gimbal range

        # 5. Send actuator commands
        send_tvc_command(tvc_angle)
        send_throttle_command(throttle_cmd)

        # 6. Telemetry (send to ground at 100 Hz, every 10th iteration)
        if iteration % 10 == 0:
            send_telemetry(state, pitch_cmd, tvc_angle, throttle_cmd)

        # 7. Ensure 1 ms loop time (sleep remainder)
        elapsed_us = get_time_us() - start_time
        sleep_us(1000 - elapsed_us)  # Sleep to maintain 1000 Hz rate
```

**Execution Time Profiling**:
```
Sensor read:        50 μs
State estimation:   200 μs (EKF update)
Guidance:           100 μs
Control (PID):      20 μs
Actuator commands:  30 μs
──────────────────────────
Total:              400 μs (40% CPU utilization at 1000 Hz)
```

**Real-Time Performance**:
- Loop jitter: <50 μs (PREEMPT_RT kernel ensures deterministic timing)
- Worst-case execution: 450 μs (within 1 ms deadline)

---

## PID Tuning

### Tuning Process

**Step 1: Simulation** (6-DOF vehicle dynamics model)
- Implement autopilot in MATLAB/Simulink
- Tune PID gains using Ziegler-Nichols method
- Validate stability margins (gain margin )6 dB, phase margin >45°)

**Step 2: Hardware-in-the-Loop (HIL)** Testing
- Connect [[Flight Computer]] to HIL simulator
- Run autopilot on actual hardware, simulated vehicle dynamics
- Fine-tune gains for real-time performance

**Step 3: Flight Test** (iterative)
- Fly with conservative gains (Kp = 1.0, low aggressiveness)
- Analyze telemetry, adjust gains
- Reflights with updated gains until performance meets requirements

**Final Gains** (after 4 test flights):

| Phase | Kp | Ki | Kd | Performance |
|-------|----|----|-----|-------------|
| Boost | 2.5 | 0.1 | 0.8 | ±1° attitude accuracy |
| Descent | 4.0 | 0.2 | 1.5 | ±0.5° accuracy (more responsive) |

**Gain Scheduling**: Gains switch automatically based on flight mode
```python
if mode == BOOST:
    Kp, Ki, Kd = 2.5, 0.1, 0.8
elif mode == DESCENT:
    Kp, Ki, Kd = 4.0, 0.2, 1.5
```

---

## Fault Handling

### Sensor Failures

**IMU Failure** (detected by [[Flight Software]] voting logic):
```python
if imu_fault_detected():
    # Switch to 2-of-2 voting (exclude faulty IMU)
    state = sensor_fusion.get_state_degraded()
    # Continue mission with degraded performance
```

**GPS Failure**:
```python
if gps_signal_lost():
    if altitude > 1000 m:
        # High altitude: Abort mission, deploy parachute
        abort_sequence()
    else:
        # Low altitude: Continue with IMU-only (accept degraded landing accuracy)
        state = sensor_fusion.get_state_imu_only()
```

### Actuator Failures

**TVC Failure** (gimbal stuck or motor failure):
```python
if tvc_position_error > 2.0:  # Gimbal not responding to commands
    # Declare TVC failure
    log_fault("TVC failure detected")

    # Attempt engine shutdown and abort
    engine_shutdown()
    abort_sequence()  # Deploy parachute
```

**Engine Shutdown** (unplanned):
```python
if engine_pressure < threshold:
    # Engine has shut down unexpectedly
    if altitude < 500 m and velocity_z < 50 m/s:
        # Low altitude, low velocity: Deploy parachute
        deploy_parachute()
    else:
        # High altitude or high velocity: Ballistic trajectory, hope for best
        log_fault("Engine shutdown, ballistic descent")
```

---

## Testing Results

### Simulation (1000 Monte Carlo runs)

**Boost Phase Performance**:
```
Attitude tracking error:
  Mean: 0.4° (excellent)
  Max:  1.2° (within ±1° requirement) ✅

Max-Q throttle-back:
  Peak dynamic pressure: 29.8 kPa (within 30 kPa limit) ✅
```

### HIL Testing (50 runs)

**Landing Phase Performance**:
```
Touchdown velocity:
  Mean: 2.8 m/s (within <5 m/s requirement) ✅
  Max:  4.2 m/s (worst-case wind gust)

Landing accuracy:
  Mean: 12 m from target (within ±50 m requirement) ✅
  Max:  38 m (crosswind case)
```

---

## [[Related Notes]]

**[[Subsystem Integration]]**:
- [[GNC System]] - Parent overview
- [[Flight Software]] - Software [[Architecture]]
- [[Landing Algorithm]] - Guidance commands for autopilot

**Sensors and Actuators**:
- [[IMU Selection]] - Attitude sensing
- [[Sensor Suite]] - [[GPS]] + [[Sensor fusion]]
- [[Thrust Vector Control]] - Primary actuation

**[[Testing]]**:
- [[Avionics Integration]] - [[HIL Testing]]
- [[Test Campaign Overview]] - Flight [[Test Results]]

**[[Team]]**:
- [[Elena Rodriguez]] - [[Avionics Lead]] (autopilot [[Design]])
- [[Sarah Chen]] - [[Chief Engineer]] ([[Requirements]] [[Approval]])
