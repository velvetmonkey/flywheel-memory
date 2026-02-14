---
type: component
subsystem: gnc
status: complete
owner: "[[Elena Rodriguez]]"
created: 2025-08-10
updated: 2026-01-02
---
# [[IMU Selection]]

## [[Overview]]

The **[[Inertial Measurement Unit]] ([[IMU]])** is the primary sensor for vehicle [[State Estimation]] during [[All]] flight phases. The Artemis-1 program selected the **[[VectorNav]] VN-100** tactical-[[Grade]] IMU for its combination of [[Performance]], cost, and flight heritage.

**[[Key Requirements]]**:
- **[[Gyroscope Bias Stability]]**: <10 deg/hr (accurate attitude determination)
- **Accelerometer Bias Stability**: <0.05 mg (accurate velocity estimation)
- **Update Rate**: ≥400 Hz (real-time control loops in [[Autopilot Software]])
- **Operating Range**: ±300 deg/s (gyro), ±16 g (accel) - covers all flight dynamics
- **Redundancy**: Triple-redundant (3× IMUs, fault-tolerant via voting)

**Selected IMU**: VectorNav VN-100 Rugged
- **Mass**: 28 g per unit (84 g total for 3 units)
- **Cost**: $1,800 per unit ($5,400 total)
- **Heritage**: Proven in small launch vehicles (Rocket Lab Electron, Virgin Orbit LauncherOne)

The IMU integrates with the [[Sensor Suite]] for sensor fusion (Extended Kalman Filter combines IMU + GPS) and provides high-rate inertial data to [[Flight Software]] for guidance and control.

---

## Trade Study

### IMU Candidates

#### 1. VectorNav VN-100 (SELECTED) ✅

**Specifications**:
```
Gyroscope:
  Range:                 ±2000 deg/s (configurable: ±250, ±500, ±1000, ±2000)
  Bias Stability:        10 deg/hr (in-run, Allan variance)
  Angle Random Walk:     0.0035 deg/√hr (noise density)
  Scale Factor Error:    <0.3% (linearity)

Accelerometer:
  Range:                 ±16 g (configurable: ±2, ±4, ±8, ±16)
  Bias Stability:        0.04 mg (40 μg, in-run)
  Velocity Random Walk:  0.0025 m/s/√hr (noise density)
  Scale Factor Error:    <0.5%

Magnetometer:
  Range:                 ±8 Gauss
  Resolution:            0.3 mGauss
  (Not used for Artemis - magnetic field unreliable near launch pad)

Data Output:
  Update Rate:           800 Hz maximum (configurable: 1, 2, 5, 10, 20, 40, 50, 100, 200, 400, 800 Hz)
  Latency:               <2 ms (sensor-to-output delay)
  Interface:             UART (serial), SPI (high-speed)
  Baudrate:              921600 bps (UART), 1 MHz (SPI)

Onboard Processing:
  Attitude Filter:       Internal EKF (quaternion output)
  Calibration:           Factory-calibrated (temperature compensation)
  Filtering:             Configurable low-pass filter (10 Hz to 256 Hz cutoff)

Physical:
  Mass:                  28 g
  Dimensions:            24 mm × 22 mm × 3 mm (compact PCB module)
  Power:                 80 mW typical (28 mA @ 3.3V)
  Operating Temp:        -40°C to +85°C
  Shock Rating:          2000 g (11 ms half-sine pulse, tested)
  Vibration Rating:      20 grms random (20 Hz to 2000 Hz)

Cost & Availability:
  Unit Cost:             $1,800 (quantity 1-10), $1,500 (quantity 10+)
  Lead Time:             2 weeks (stock item)
  Supplier:              VectorNav Technologies (Dallas, Texas, U.S.)
  ITAR Status:           Non-ITAR (export-friendly, no restrictions)
```

**Advantages**:
- ✅ **Best performance-to-cost ratio** ($1,800 for 10 deg/hr gyro bias)
- ✅ **Flight-proven** (Rocket Lab Electron, Virgin Orbit LauncherOne)
- ✅ **High update rate** (800 Hz maximum, use 400 Hz for Artemis)
- ✅ **Compact and lightweight** (28 g, fits in [[Avionics System]] equipment bay)
- ✅ **Factory-calibrated** (temperature compensation, no field calibration required)
- ✅ **Shock/vibration qualified** (2000 g shock, 20 grms vibration - exceeds launch environment)

**Disadvantages**:
- ❌ Not navigation-grade (10 deg/hr vs. 0.01 deg/hr for mil-spec inertial nav systems)
- ❌ Requires GPS for long-duration accuracy (IMU drifts, needs GPS updates)

**Verdict**: **SELECTED** ✅
- **Rationale**: Best balance of performance, cost, and heritage for short-duration flights (<10 minutes)

#### 2. Analog Devices ADIS16505 (Industrial-Grade)

**Specifications**:
```
Gyroscope Bias Stability:    6 deg/hr (better than VN-100)
Accelerometer Bias Stability: 0.02 mg (50% better than VN-100)
Update Rate:                  2000 Hz (5× higher than VN-100)
Mass:                         15 g (lighter)
Cost:                         $450 (4× cheaper)
```

**Advantages**:
- ✅ **Lower cost** ($450 vs. $1,800 per unit)
- ✅ **Lighter** (15 g vs. 28 g)
- ✅ **Higher update rate** (2000 Hz vs. 800 Hz)

**Disadvantages**:
- ❌ **No onboard processing** (requires external attitude algorithm)
- ❌ **No flight heritage** in launch vehicles (used in drones, robotics)
- ❌ **Lower shock rating** (500 g vs. 2000 g VN-100)

**Verdict**: **Rejected**
- **Rationale**: Lack of onboard processing increases [[Flight Computer]] workload
- Better gyro performance (6 vs. 10 deg/hr) not worth integration complexity

#### 3. Honeywell HG1700 (Navigation-Grade)

**Specifications**:
```
Gyroscope Bias Stability:    0.01 deg/hr (1000× better than VN-100!)
Accelerometer Bias Stability: 0.00025 mg (160× better)
Technology:                   Ring Laser Gyro (RLG, not MEMS)
Mass:                         1.8 kg (64× heavier than VN-100)
Cost:                         $120,000 (67× more expensive)
```

**Advantages**:
- ✅ **Best performance** (navigation-grade, 0.01 deg/hr drift)
- ✅ **No GPS required** (can navigate autonomously for hours)
- ✅ **Spaceflight heritage** (Atlas V, Delta IV)

**Disadvantages**:
- ❌ **Extremely expensive** ($120K vs. $1.8K, 67× cost)
- ❌ **Heavy** (1.8 kg vs. 28 g, 64× mass)
- ❌ **Overkill for 10-minute flight** (high precision not needed)

**Verdict**: **Rejected**
- **Rationale**: Cost and mass penalties not justified for short-duration missions
- GPS available for position updates (don't need long-term IMU accuracy)

---

## Performance Analysis

### Gyroscope Performance

**Bias Drift** (primary error source for attitude determination):

```
VN-100 Gyro Bias Stability: 10 deg/hr

Attitude Error Growth (without GPS):
  1 minute:   10 deg/hr × (1/60 hr) = 0.17° (negligible)
  5 minutes:  10 deg/hr × (5/60 hr) = 0.83° (acceptable)
  10 minutes: 10 deg/hr × (10/60 hr) = 1.67° (marginal, requires GPS update)

Flight Duration: 8 minutes (boost phase) + 2 minutes (landing)
Maximum Drift: 1.67° (worst-case, no GPS updates)
Requirement: <5° attitude knowledge (VN-100 meets with margin)
```

**GPS Update Frequency**:
- GPS provides position/velocity at 25 Hz (see [[Sensor Suite]])
- [[Flight Software]] EKF corrects IMU drift every 40 ms (GPS update interval)
- With GPS updates: Attitude error <0.1° (bounded by sensor fusion)

**Angle Random Walk** (high-frequency noise):
```
ARW = 0.0035 deg/√hr

Noise @ 400 Hz Update Rate:
  σ_gyro = ARW × √(f) = 0.0035 × √(400/3600) = 0.0012 deg/s RMS

This is negligible compared to vehicle dynamics (rotation rates 1-10 deg/s during ascent)
```

### Accelerometer Performance

**Bias Drift** (velocity error accumulation):

```
VN-100 Accel Bias Stability: 0.04 mg = 0.04 × 9.81 m/s² = 0.392 mm/s²

Velocity Error Growth (integration of bias):
  Δv = bias × time

  1 minute:   0.392 mm/s² × 60 s = 23.5 mm/s (negligible)
  5 minutes:  0.392 mm/s² × 300 s = 118 mm/s (11.8 cm/s, acceptable)
  10 minutes: 0.392 mm/s² × 600 s = 235 mm/s (23.5 cm/s, marginal)

Position Error Growth (double integration):
  Δx = ½ bias × time²

  10 minutes: ½ × 0.392 mm/s² × (600 s)² = 70.6 m

This is unacceptable for landing (requires ±50 m accuracy)!
```

**GPS Correction**:
- GPS updates position every 40 ms (25 Hz)
- EKF resets position error to near-zero every GPS update
- **With GPS**: Position error <5 m (GPS accuracy limits, not IMU drift)
- **Conclusion**: IMU alone insufficient for long-duration flight, GPS essential

### Shock and Vibration Survivability

**Launch Environment**:
```
Shock:       800 g peak (pyrotechnic separation events, see [[Stage Separation]])
Vibration:   14 grms random (engine vibration, see [[Airframe Design]])
```

**VN-100 Rating**:
```
Shock:       2000 g (11 ms half-sine pulse)
  → 2.5× margin above 800 g flight load ✅

Vibration:   20 grms random (20 Hz to 2000 Hz)
  → 1.4× margin above 14 grms flight load ✅
```

**Mounting**:
- IMU mounted on [[Flight Computer]] PCB (rigid mount, no isolation)
- **Rationale**: IMU must measure true vehicle acceleration (isolation would filter real dynamics)
- Vibration transmitted to IMU, but within 20 grms rating

**Lessons from Testing**:
- Initial IMU mounting used adhesive (epoxycyanoacrylate glue)
- Vibration test failed at 18 grms (IMU debonded from PCB)
- **Fix**: Changed to mechanical fastening (4× M2 screws, Loctite threadlocker)
- Re-test passed 20 grms with no failures ✅

---

## Redundancy Architecture

### Triple-Modular Redundancy

**Configuration**: 3× VN-100 IMUs, one per [[Flight Computer]]

```
Computer A: IMU-A
Computer B: IMU-B
Computer C: IMU-C

Each computer reads its own IMU at 400 Hz
Computers exchange IMU data via CAN bus (1000 Hz update)
Voting algorithm selects best IMU data (median voting)
```

**Voting Algorithm** (implemented in [[Flight Software]]):

```python
# Read all 3 IMUs
gyro_x_A = read_imu_A().gyro_x
gyro_x_B = read_imu_B().gyro_x
gyro_x_C = read_imu_C().gyro_x

# Median voting (robust to single outlier)
gyro_x_voted = median(gyro_x_A, gyro_x_B, gyro_x_C)

# Use voted value for attitude integration
attitude_rate = gyro_x_voted
```

**Fault Detection**:
```
Residual Check:
  For each IMU measurement, compute residual from voted value:
  residual_A = gyro_x_A - gyro_x_voted

  If |residual_A| > threshold (5 deg/s for gyro, 2 m/s² for accel):
    Flag IMU-A as faulty
    Exclude from future voting (2-of-3 becomes 2-of-2)

  If 2 IMUs fail:
    Emergency mode (single IMU, no voting, degraded performance)
    Trigger abort sequence (see [[Autopilot Software]])
```

**Fault Scenarios**:

| Faults | Available IMUs | Voting | Performance | Mission Status |
|--------|----------------|--------|-------------|----------------|
| 0 | 3 | Median (2-of-3) | Nominal | Continue |
| 1 | 2 | Average (2-of-2) | Degraded (no fault tolerance) | Continue with caution |
| 2 | 1 | None (single source) | Severely degraded | Abort to safe mode |
| 3 | 0 | N/A | Total loss | Deploy parachute |

---

## Calibration and Alignment

### Factory Calibration

**VN-100 Factory Calibration** (performed by VectorNav):
- **Temperature Compensation**: Bias and scale factor characterized at -40°C to +85°C
- **Cross-Axis Alignment**: Gyro and accel axes aligned to <0.05° (factory spec)
- **Calibration Certificate**: Provided with each IMU (traceable to NIST standards)

**No Field Calibration Required**: Factory calibration sufficient for Artemis accuracy requirements

### IMU-to-Vehicle Alignment

**Alignment Requirement**: IMU axes aligned to vehicle reference frame (X-forward, Y-right, Z-down)

**Alignment Procedure**:
1. **Mechanical Alignment**: IMU mounted on [[Flight Computer]] PCB with precision (±0.5° tolerance)
2. **Measurement**: Place vehicle on precision alignment fixture (laser level, ±0.1° accuracy)
3. **Static Calibration**: Record IMU outputs with vehicle stationary, perfectly level
4. **Compute Alignment Matrix**: Calculate rotation matrix from IMU frame to vehicle frame

```
Measured (vehicle level, stationary):
  accel_z = -9.81 m/s² (should measure gravity in -Z direction)
  accel_x, accel_y = 0 (should be zero if perfectly aligned)

Actual (with 0.5° misalignment):
  accel_x = 0.086 m/s² (due to 0.5° tilt about Y-axis)
  accel_z = -9.80 m/s² (cosine of 0.5° ≈ 1.0)

Alignment Correction:
  Rotation matrix computed to correct 0.5° misalignment
  Applied in [[Flight Software]] before sensor fusion
```

**Alignment Accuracy**: ±0.2° (after correction, sufficient for guidance)

---

## Integration with Sensor Suite

### IMU + GPS Sensor Fusion

**Extended Kalman Filter** (see [[Sensor Suite]] for full EKF details):

**Prediction Step** (IMU-driven, 400 Hz):
```
State vector: [position, velocity, attitude, gyro_bias, accel_bias]

IMU measurements at 400 Hz:
  ω_measured = gyro output (3-axis angular rates)
  a_measured = accel output (3-axis acceleration)

Prediction:
  attitude += ω_measured × dt (integrate gyro for attitude)
  velocity += a_measured × dt (integrate accel for velocity)
  position += velocity × dt (integrate velocity for position)

dt = 1/400 = 2.5 ms (integration timestep)
```

**Correction Step** (GPS-driven, 25 Hz):
```
GPS measurements at 25 Hz:
  position_GPS (latitude, longitude, altitude)
  velocity_GPS (3-axis velocity from Doppler shift)

Kalman Update:
  position_error = position_GPS - position_predicted
  velocity_error = velocity_GPS - velocity_predicted

  Apply Kalman gain (weighted average of prediction and measurement):
    position_corrected = position_predicted + K × position_error
    velocity_corrected = velocity_predicted + K × velocity_error

  Also estimate and correct IMU biases:
    gyro_bias_estimated (slowly varying bias, updated by EKF)
    accel_bias_estimated
```

**Performance**:
- **Position Accuracy**: 5 m (GPS-limited, not IMU-limited)
- **Velocity Accuracy**: 0.1 m/s (GPS-limited)
- **Attitude Accuracy**: 0.5° (IMU-limited, gyro noise + bias)

### IMU-Only Guidance (GPS Denied)

**Scenario**: GPS signal lost during powered descent (urban canyon, RF interference)

**IMU-Only Performance**:
```
Initial Condition (at GPS loss):
  Known position, velocity, attitude (last GPS update)

IMU Integration (no GPS updates):
  Gyro drift: 10 deg/hr → 1.67° attitude error after 10 minutes
  Accel bias: 0.04 mg → 70 m position error after 10 minutes

Landing Accuracy with 10-Minute GPS Outage:
  Position error: 70 m (exceeds ±50 m requirement) ❌

Mitigation:
  - Require GPS lock during descent (abort if GPS lost)
  - Backup: Visual odometry (camera-based navigation, future upgrade)
```

**Conclusion**: GPS essential for landing, IMU alone insufficient for 10-minute autonomy

---

## Testing and Validation

### Component Testing

**Bench Test** (IMU characterization):
- **Objective**: Verify gyro/accel bias stability matches datasheet
- **Setup**: IMU on temperature-controlled turntable (rate table)
- **Test Matrix**:
  - Static test: 8-hour soak, record bias drift
  - Dynamic test: Rotate at known rates (10, 50, 100 deg/s), measure scale factor error
  - Temperature sweep: -20°C to +60°C, characterize temperature drift

**Results**:
```
Gyro Bias Stability:
  Measured: 8.5 deg/hr (better than 10 deg/hr spec) ✅

Accel Bias Stability:
  Measured: 0.038 mg (better than 0.04 mg spec) ✅

Scale Factor Error:
  Gyro: 0.25% (within 0.3% spec) ✅
  Accel: 0.42% (within 0.5% spec) ✅

Temperature Drift:
  Gyro: 0.015 deg/s/°C (factory compensation effective)
  Accel: 0.002 m/s²/°C (negligible for flight environment)
```

### Vibration Test

**Random Vibration Test** (MIL-STD-810):
- **Objective**: Verify IMU survives launch vibration
- **Test Setup**: IMU mounted on shaker table
- **Input**: 14 grms random vibration (20 Hz to 2000 Hz, per [[Airframe Design]] requirement)
- **Duration**: 60 seconds (simulates boost phase vibration)

**Results**:
- ✅ IMU remained functional during and after vibration
- ✅ Gyro bias shift: <0.5 deg/hr (negligible)
- ✅ Accel bias shift: <0.01 mg (negligible)
- ✅ No mechanical damage (M2 screw mounting held securely)

**Lesson Learned**: Adhesive mounting failed (debonded at 18 grms), mechanical fastening required

### Sensor Fusion Validation

**HIL (Hardware-in-the-Loop) Test**:
- **Objective**: Validate IMU + GPS sensor fusion algorithm
- **Setup**: 3× IMUs + 2× GPS receivers connected to [[Flight Computer]], simulated vehicle motion
- **Scenario**: Simulated boost, coast, and descent trajectory (8-minute flight)

**Results**:
```
Position Accuracy (with GPS updates):
  Mean error: 3.2 m (within 5 m requirement) ✅
  Max error: 7.1 m (outlier during GPS multipath, acceptable)

Velocity Accuracy:
  Mean error: 0.08 m/s (within 0.1 m/s requirement) ✅

Attitude Accuracy:
  Mean error: 0.31° (within 0.5° requirement) ✅
  Max error: 0.62° (during high angular rates, acceptable)
```

**IMU Fault Injection**:
- Simulated IMU-A failure (output frozen at T+120s)
- [[Flight Software]] detected fault within 100 ms (residual check)
- Voting switched to 2-of-2 (IMU-B, IMU-C)
- No mission impact (continued with 2 IMUs) ✅

---

## Current Status

**Procurement**: ✅ **Complete**
- 3× VectorNav VN-100 IMUs delivered (2025-09-15)
- Unit cost: $1,800 × 3 = $5,400
- Lead time: 2 weeks (stock item, on-time delivery)

**Testing**: ✅ **Complete**
- Bench test: Passed (bias stability verified)
- Vibration test: Passed (mechanical mounting validated)
- HIL test: Passed (sensor fusion validated)

**Integration**: ✅ **Complete**
- IMUs integrated onto [[Flight Computer]] PCBs (2025-11-20)
- Firmware configured (400 Hz update, SPI interface)
- Alignment calibration performed (±0.2° accuracy)

**Open Issues**: None

**Upcoming Milestones**:
- 2026-01-20: Full vehicle HIL test (integrated avionics test)
- 2026-02-01: First flight (validate IMU performance in actual flight environment)

---

## Lessons Learned

**Lesson 1**: Mechanical mounting more reliable than adhesive for high-vibration environments
- **Observation**: Adhesive mounting failed vibration test at 18 grms
- **Root Cause**: Epoxy not rated for sustained high-frequency vibration
- **Fix**: M2 screw mounting with Loctite threadlocker
- **Benefit**: Passed 20 grms vibration, exceeded requirement

**Lesson 2**: Factory calibration sufficient for tactical-grade IMU
- **Observation**: Considered field calibration (rate table, 6-DOF calibration)
- **Analysis**: VectorNav factory calibration meets requirements (10 deg/hr bias, 0.3% scale factor)
- **Decision**: Skip field calibration (save $8K [[Rate]] table cost, 2 [[Weeks]] schedule)

**[[Lesson 3]]**: [[GPS]] [[Essential]] for [[Landing Accuracy]]
- **Observation**: IMU-[[Only]] [[Navigation]] accumulates 70 m position error in 10 minutes
- **[[Conclusion]]**: GPS [[Required]] for ±50 m landing accuracy (cannot rely on IMU alone)
- **Future**: [[Consider]] higher-grade IMU (1 deg/hr bias) if GPS-denied landing required

---

## [[Related Notes]]

**[[Subsystem Integration]]**:
- [[GNC System]] - Parent overview [[Note]]
- [[Sensor Suite]] - IMU + GPS [[Sensor fusion]] ([[Extended Kalman Filter]])
- [[Avionics System]] - [[IMU Mounting]] on [[Flight Computer]] PCBs

**Algorithms**:
- [[Autopilot Software]] - [[Attitude Control]] [[Using]] IMU [[Angular]] rates
- [[Landing Algorithm]] - [[Landing Guidance]] using IMU + GPS
- [[Flight Software]] - IMU [[Fault Detection]] and [[Voting Logic]]

**[[Testing]]**:
- [[Test Campaign Overview]] - IMU [[Test]] schedule
- [[Avionics Integration]] - HIL test with IMU + GPS + [[Flight Computers]]

**[[Decisions]]**:
- [[ADR-002 Flight Computer]] - Discusses sensor [[Redundancy]] and [[Voting]]

**[[Project Management]]**:
- [[Project Roadmap]] - IMU procurement and [[Integration]] schedule
- [[Risk Register]] - IMU failure [[Risk]] ([[Triple Redundancy]] mitigates)

**[[Team]]**:
- [[Elena Rodriguez]] - [[Avionics Lead]] (IMU selection authority)
- [[Sarah Chen]] - [[Chief Engineer]] (navigation [[Requirements]] [[Approval]])
