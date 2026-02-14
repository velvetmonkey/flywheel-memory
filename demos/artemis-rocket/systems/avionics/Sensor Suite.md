---
type: component
subsystem: avionics
status: testing
owner: "[[Elena Rodriguez]]"
created: 2025-09-12
updated: 2026-01-02
---
# [[Sensor Suite]]

## [[Overview]]

The Artemis sensor [[Suite]] provides comprehensive vehicle state measurement for [[Guidance]], [[Navigation]], and [[Control]] (GNC). The suite includes [[Inertial Measurement Units]] (IMUs), [[GPS Receivers]], [[Pressure Sensors]], [[Temperature Sensors]], and voltage/[[Current Monitors]].

**[[Design Philosophy]]**: [[Redundant]] sensors with dissimilar [[Hardware]] for [[Fault Detection]] and isolation

**[[Key Sensors]]**:
- 3× IMUs (Inertial Measurement Units) - [[One]] per [[Flight Computer]]
- 2× [[GPS]] receivers (dual [[Redundancy]])
- 3× [[Chamber Pressure]] sensors ([[Triple Redundancy]])
- 12× thermocouples ([[Cooling System]] wall temperatures)
- 6× voltage/[[Current]] monitors ([[Power Distribution]])

## [[Inertial Measurement Unit]] ([[IMU]])

### Selection

**Selected IMU**: [[VectorNav]] VN-100 Rugged

**Specifications**:
- 3-axis gyroscope: ±2000°/s range, 0.035°/s/√Hz noise density
- 3-axis accelerometer: ±16g range, 220 μg/√Hz noise density
- 3-axis magnetometer: ±2.5 Gauss range (used for [[Ground]] calibration [[Only]])
- Output [[Rate]]: 400 Hz
- Interface: SPI (10 Mbps)
- Power: 160 mW
- Mass: 30g (including enclosure)

**Why VectorNav VN-100**:
- Flight-proven heritage (used in rockets, UAVs, marine vehicles)
- Factory-calibrated (no field calibration [[Required]])
- Wide operating temperature: -40°C to +85°C
- Industrial-[[Grade]] shock resistance: 40g
- Cost: $600 per unit (vs. $5000+ for aerospace-grade IMU)

[[See]] [[IMU Selection]] decision record for [[Full]] selection rationale

### [[Mounting Configuration]]

**[[Triple redundancy]]**:
- **IMU-A**: Mounted near [[Flight Computer]] A (forward electronics bay)
- **IMU-B**: Mounted near [[Flight Computer]] B (aft electronics bay)
- **IMU-C**: Mounted near Flight Computer C (center electronics bay)

**Mounting**:
- [[Each]] IMU hard-mounted to vehicle frame (4× M3 screws)
- No vibration isolation (IMU internal filters handle vibration)
- [[Alignment]]: [[All]] [[Three]] IMUs aligned to vehicle [[Reference]] frame (±0.5° accuracy)
- Alignment [[Verification]]: Optical alignment jig during assembly

**[[Why Distributed Mounting]]**:
- Physical [[Separation]] increases fault independence (localized damage doesn't affect all IMUs)
- Each IMU close to its corresponding flight computer (short SPI cable = lower EMI susceptibility)
- Trade-off: Different vibration environments require [[Sensor Fusion]] to reconcile measurements

### Calibration

**[[Factory Calibration]]** (by VectorNav):
- Gyroscope bias: (0.5°/hour
- Accelerometer bias: <10 mg
- Scale factor accuracy: <0.5%
- Alignment error: <0.1°

**Field Calibration** (pre-flight):
- 24-hour static bias measurement (gyroscope drift characterization)
- 6-position tumble test (accelerometer calibration)
- Magnetometer calibration (hard-iron/soft-iron correction)
- Results stored in [[Flight Software]] configuration file

**In-Flight Calibration**:
- Gyroscope bias estimated by [[Sensor Suite#Sensor Fusion]] Kalman filter
- Updated every 100ms during flight based on GPS velocity
- Accelerometer bias assumed constant (too short flight time for estimation)

### Interface to Flight Computer

**SPI Bus**:
- Clock frequency: 1 MHz (well below 10 MHz maximum)
- Data format: 16-bit words, big-endian
- Message rate: 400 Hz (2.5ms period)
- Latency: <1ms (SPI transfer time + processing)

**Data Packet** (sent by IMU):
```
Timestamp (32-bit) - microseconds since power-on
Gyroscope X (16-bit) - deg/s
Gyroscope Y (16-bit) - deg/s
Gyroscope Z (16-bit) - deg/s
Accelerometer X (16-bit) - g
Accelerometer Y (16-bit) - g
Accelerometer Z (16-bit) - g
Temperature (16-bit) - °C
CRC (16-bit) - error detection
```

## GPS Receiver

### Selection

**Selected GPS**: u-blox NEO-M9N

**Specifications**:
- Channels: 92 (concurrent GPS, GLONASS, Galileo, BeiDou)
- Position accuracy: 1.5m CEP (Circular Error Probable)
- Velocity accuracy: 0.05 m/s
- Update rate: 25 Hz (configurable)
- Time-to-first-fix: <25s (cold start), <1s (hot start)
- Interface: UART (115200 baud)
- Power: 60 mW
- Mass: 15g (including antenna)

**Why u-blox NEO-M9N**:
- Multi-constellation support (improves availability and accuracy)
- High update rate (25 Hz) for velocity estimation during ascent
- UBX protocol provides velocity and position in single message
- Automotive-grade reliability (used in millions of cars)
- Cost: $40 per unit

### Dual Redundancy Configuration

**GPS-A** (Primary):
- Antenna mounted on top of vehicle (payload fairing apex)
- Clear sky view during entire ascent
- Connected to [[Flight Computer]] A via UART

**GPS-B** (Backup):
- Antenna mounted on side of vehicle (between fins)
- Partial sky view (blocked by vehicle body during some attitudes)
- Connected to Flight Computer B via UART

**Failover Logic** (in Flight Software):
- Continuously monitor both GPS receivers
- Health criteria: )6 satellites, HDOP (2.0, velocity residual <1 m/s
- If GPS-A unhealthy for )2 seconds, switch to GPS-B
- If both unhealthy, enter dead reckoning mode (IMU-only navigation)

### Antenna Placement

**GPS-A Antenna**: Fairing apex
- Optimal placement (unobstructed 180° hemisphere)
- Protected by fairing during ascent
- Exposed after fairing separation (50km altitude)

**GPS-B Antenna**: Side-mounted (between fins)
- Trade-off: Partially obstructed but protected during entire flight
- 120° sky view (60° blocked by vehicle body)
- Useful if GPS-A antenna damaged during fairing separation

### GPS Dropout Handling

**Scenario**: GPS signal lost during ascent (ionospheric scintillation, antenna damage, jamming)

**Mitigation** (implemented in Flight Software v1.5.0):
1. Detect GPS dropout: No valid NMEA messages for 2 seconds
2. Switch to dead reckoning mode:
   - Integrate IMU acceleration to estimate velocity
   - Integrate IMU angular velocity to estimate attitude
   - Propagate position from last known GPS fix
3. Accuracy degrades over time (IMU bias drift):
   - 10 seconds without GPS: ±5m position error
   - 30 seconds without GPS: ±20m position error
   - 60 seconds without GPS: ±50m position error (acceptable for ascent)
4. Resume GPS when signal returns

**Validation**: Tested in [[Avionics Integration Test]] with 20 GPS dropout scenarios (all passed)

## Pressure Sensors

### Chamber Pressure Sensors

**Purpose**: Measure combustion chamber pressure for [[Engine Controller]] feedback and health monitoring

**Sensor**: Kulite XTL-190M
- Range: 0-15 MPa (0-2175 psi)
- Accuracy: ±0.1% full scale
- Response time: (1ms
- Output: 0-5V analog (ratiometric to 5V supply)
- Temperature compensated: -55°C to +150°C
- Interface: 12-bit ADC on [[Flight Computer]]

**Triple Redundancy**:
- Three sensors at 120° spacing around [[Combustion Chamber]] dome
- Each sensor hard-mounted via 1/4" NPT threaded port
- Sensors read by all three flight computers (shared analog outputs)

**Voting Logic**:
- Flight computers exchange pressure readings via [[CAN Bus]]
- Median of three readings used for control (rejects single outlier)
- Disagreement threshold: 0.3 MPa (outlier flagged if differs by more)
- If outlier persists for )100ms, sensor marked failed

**Critical for Safety**:
- Detects combustion instability (pressure oscillations)
- Detects overpressure (>10 MPa triggers emergency shutdown)
- Detects underpressure ((7 MPa indicates incomplete combustion)

### Tank Pressure Sensors

**LOX Tank**: Omega PX409 (0-3 MPa range)
- Purpose: Monitor tank pressurization for propellant expulsion
- Location: LOX tank ullage (top of tank)

**RP-1 Tank**: Omega PX409 (0-3 MPa range)
- Purpose: Monitor tank pressurization for propellant expulsion
- Location: RP-1 tank ullage (top of tank)

**Autogenous Pressurization**:
- Gaseous oxygen from [[Engine]] heat exchanger pressurizes LOX tank
- Helium pressurizes RP-1 tank (stored in high-pressure bottles)
- Tank pressure sensors provide feedback to pressure control valves

## Temperature Sensors

### Engine Cooling System

**Purpose**: Monitor [[Cooling System]] wall temperatures to detect thermal runaway

**Sensor**: K-type thermocouples (Omega 5TC series)
- Range: -200°C to +1250°C
- Accuracy: ±1°C (0-400°C range)
- Response time: 50ms
- Interface: Cold junction compensation + 16-bit ADC

**Placement** (12 thermocouples):
- 6× around combustion chamber throat (highest heat flux region)
- 3× on nozzle diverging section
- 3× on chamber dome (near injector)

**Thermal Limits**:
- Normal operating temperature: 150-300°C (regenerative cooling effective)
- Warning threshold: 350°C (reduced cooling effectiveness)
- Critical threshold: 400°C (thermal runaway imminent, emergency shutdown)

**Logged in [[Engine Hot Fire Results]]**:
- Test 1 (30s): Max temp 245°C (safe)
- Test 2 (60s): Max temp 280°C (safe)
- Test 3 (120s): Max temp 310°C (safe, within margin)

### Electronics Bay Temperature

**Purpose**: Monitor avionics temperature to prevent overheating

**Sensor**: Analog Devices TMP36 (semiconductor temperature sensor)
- Range: -40°C to +125°C
- Accuracy: ±2°C
- Output: 10 mV/°C (linear)

**Placement**:
- One sensor per flight computer (3 total)
- Mounted on carrier board near processors

**Thermal Management**:
- Passive cooling via aluminum enclosure
- Heat dissipated to vehicle structure
- Normal operating temperature: 35-50°C
- Warning threshold: 70°C (reduce processor load if possible)
- Critical threshold: 80°C (computers auto-throttle to prevent shutdown)

## Voltage and Current Monitors

**Purpose**: Monitor [[Power Distribution]] system health

**Locations**:
- Battery voltage (28V bus)
- 12V regulator output
- 5V regulator output
- 3.3V regulator output
- Engine controller power
- Propellant valve power

**Sensors**: INA219 (I2C current/voltage monitor)
- Voltage range: 0-26V
- Current range: ±3.2A (via 0.1Ω shunt resistor)
- Accuracy: ±0.5%
- Interface: I2C (400 kHz)

**Fault Detection**:
- Under-voltage: Triggers warning if <90% nominal
- Over-current: Detects short circuit or component failure
- Logged for post-flight analysis

## Sensor Fusion

**Purpose**: Combine redundant sensor measurements to produce optimal state estimate

**Algorithm**: Extended Kalman Filter (EKF) running in Flight Software

**Inputs**:
- 3× IMU measurements (gyroscope, accelerometer)
- 2× GPS measurements (position, velocity)
- Pressure sensors (altitude estimation via barometric formula)

**State Vector** (15 elements):
```
Position (3): X, Y, Z (ECEF coordinates)
Velocity (3): Vx, Vy, Vz
Attitude (4): Quaternion q0, q1, q2, q3
Gyroscope bias (3): Bx, By, Bz
Accelerometer bias (3): Ax, Ay, Az
```

**Update Rate**: 400 Hz (driven by IMU data rate)

**Prediction Step** (every 2.5ms):
1. Integrate gyroscope → update attitude quaternion
2. Integrate accelerometer → update velocity
3. Integrate velocity → update position

**Correction Step** (when GPS available, 25 Hz):
1. Compare predicted position/velocity to GPS measurement
2. Compute Kalman gain based on sensor noise models
3. Update state estimate to reduce error

**Outlier Rejection**:
- If GPS measurement differs from prediction by )10m, reject (likely GPS glitch)
- If IMU measurement differs from other two IMUs by >10% normalized, reject

**[[Performance]]** (from [[Avionics Integration Test]]):
- Position accuracy: ±1.5m (GPS [[Available]]), ±5m (10s [[GPS Dropout]])
- [[Velocity]] accuracy: ±0.1 m/s (GPS available), ±0.5 m/s (10s GPS dropout)
- Attitude accuracy: ±0.5° (all phases of flight)

## [[Testing]]

### [[Sensor Characterization]]

**[[Benchtop Testing]]**:
- IMU: 24-hour static [[Test]] (gyroscope bias measurement)
- GPS: Sky view test (time-to-[[First]]-fix, position accuracy)
- Pressure sensors: Deadweight tester calibration (±0.05% accuracy)
- Thermocouples: Ice bath + boiling water calibration

### [[Environmental Testing]]

**Vibration**: 14.1 Grms [[Random]] vibration (see [[Avionics Integration Test]])
- [[Result]]: All sensors functional during and [[After]] vibration
- No resonances, no mounting hardware loosening

**[[Thermal Vacuum]]**:
- Chamber: -40°C to +70°C, (1×10⁻⁵ Torr
- Duration: 8 [[Hours]] (4 thermal cycles)
- Result: All sensors within specification across temperature range

### [[Hardware-in-Loop]] (HIL) Testing

**[[Sensor Simulation]]**:
- IMU: Simulated gyroscope and accelerometer outputs [[Based]] on vehicle trajectory
- GPS: Simulated NMEA messages based on position/velocity
- Pressure: Simulated chamber pressure profile for [[Engine]] firing

**[[Validation]]**:
- [[Sensor fusion]] algorithm produces correct state estimate
- GPS [[Dropout Handling]] verified (20 scenarios)
- [[Sensor Failure]] [[Detection]] verified (47 fault [[Injection]] scenarios)

**[[Success Rate]]**: 96% (45/47 scenarios passed)

## [[Lessons Learned]]

### [[What Worked Well]]

1. **COTS [[Sensors Exceeded Expectations]]**
   - VectorNav IMU performed flawlessly in [[Vibration Testing]]
   - u-blox GPS locked 12+ satellites consistently (even GPS-B with partial sky view)
   - Kulite pressure sensors: [[Zero]] failures in 4 [[Hot Fire]] tests

2. **Distributed [[IMU Mounting]]**
   - Physical separation increased fault independence
   - Different vibration environments helped [[Identify]] mounting resonances
   - No cross-coupling failures (damage to one IMU didn't affect [[Others]])

3. **[[Sensor Fusion Robustness]]**
   - [[Kalman filter]] gracefully handled GPS dropouts (dead reckoning [[Mode]])
   - Outlier rejection caught GPS glitches without manual intervention
   - Gyroscope bias estimation improved accuracy over time

### [[Challenges Encountered]]

1. **GPS [[Antenna Placement]]**
   - Initial [[Design]]: Single [[GPS Antenna]] on side of vehicle
   - Problem: Obstructed during certain attitudes ()30° angle of attack)
   - Solution: [[Added]] second GPS antenna on fairing apex (primary), kept side antenna as backup
   - Validation: Dual-GPS configuration tested in HIL with 100 attitude profiles

2. **[[Thermocouple Noise]]**
   - Initial measurements showed ±20°C noise spikes during engine firing
   - [[Root Cause]]: Electromagnetic interference from igniter [[Spark]]
   - Solution: Shielded thermocouple wires, twisted pairs, common-mode choke on ADC inputs
   - Result: Noise reduced to ±2°C (acceptable)

3. **[[IMU Alignment]]**
   - Manual alignment during assembly resulted in 2° misalignment (IMU-C)
   - Impact: Sensor fusion showed persistent disagreement between IMUs
   - Solution: Optical alignment jig (±0.5° accuracy) used for IMU-C remounting
   - Lesson [[Learned]]: Alignment jig mandatory for all future vehicles

## [[Current Status]]

**[[Design Maturity]]**: 95% ([[Ready]] for CDR)

**[[Completed]]**:
- ✅ Sensor selection and procurement
- ✅ Benchtop characterization and calibration
- ✅ Environmental testing (thermal vacuum, vibration)
- ✅ [[HIL Testing]] with sensor fusion validation
- ✅ Sensor mounting and alignment procedures [[Documented]]

**[[Remaining Work]]**:
- Final calibration of flight sensors (IMU bias, thermocouple)
- [[Integrated Vehicle Testing]] (all sensors operating simultaneously)
- [[Flight Readiness Review]] (verify sensor health before [[Launch]])

**Risks**:
- **R-016**: GPS antenna damage during fairing separation - Mitigation: Dual GPS (GPS-B backup)
- **R-017**: IMU failure due to vibration - Mitigation: Triple redundancy, vibration [[Qualification Testing]]

## [[Related Notes]]

**[[Avionics Subsystem]]**:
- [[Avionics System]] - Subsystem overview
- [[Flight Computer]] - Processes [[Sensor Data]]
- [[Flight Software]] - Sensor fusion algorithm
- [[Redundancy Architecture]] - Sensor redundancy design

**[[GNC Subsystem]]**:
- [[GNC System]] - Uses sensor [[Data]] for guidance, navigation, control
- [[IMU Selection]] - Detailed [[IMU Selection]] rationale
- [[Autopilot Software]] - Control laws [[Use]] sensor fusion state estimate
- [[Landing Algorithm]] - Relies on GPS for [[Powered]] descent

**[[Propulsion Subsystem]]**:
- [[Engine Controller]] - Uses chamber pressure sensors for feedback
- [[Cooling System]] - [[Monitored]] by thermocouples
- [[Fuel Tanks]] / [[Oxidizer System]] - [[Tank Pressure Sensors]]

**Testing**:
- [[Avionics Integration Test]] - HIL testing [[Results]]
- [[Engine Hot Fire Results]] - Thermocouple validation during firing
- [[Test Campaign Overview]] - Overall test [[Strategy]]

**[[Project Management]]**:
- [[Project Roadmap]] - Sensor [[Integration]] [[Milestones]]
- [[Risk Register]] - R-016, R-017
- [[Team Roster]] - [[Elena Rodriguez]] ([[Avionics Lead]])

---

*[[Component Specification]] by [[Elena Rodriguez]] - [[Last Updated]] 2026-01-02*
