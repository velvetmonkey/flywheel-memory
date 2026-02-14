---
type: component
subsystem: avionics
status: testing
owner: "[[Elena Rodriguez]]"
created: 2025-09-18
updated: 2026-01-02
---
# [[Telemetry]]

## [[Overview]]

The Artemis [[Telemetry System]] collects, formats, logs, and transmits [[Vehicle State]] [[Data]] to [[Ground]] [[Control]]. The [[Design]] prioritizes real-time downlink for flight [[Monitoring]] while maintaining onboard logs for post-[[Flight Analysis]].

**[[Key Functions]]**:
- Real-time data acquisition from [[All]] subsystems
- Binary telemetry packetization for radio transmission
- Onboard [[Data Logging]] to [[SD Card]] (backup [[If Radio]] [[Link]] fails)
- [[Ground Station Software]] for telemetry display and recording

**[[Data Flow]]**: Sensors → [[Flight Computer]] → [[Telemetry Formatter]] → [[Communications]] → [[Ground Station]]

## [[Telemetry Architecture]]

### [[Data Sources]]

**[[Flight Computer Outputs]]**:
- Vehicle state estimate (position, [[Velocity]], attitude) from [[Sensor Suite]] fusion
- Actuator commands ([[Thrust Vector Control]], throttle)
- Flight [[Mode]] [[Status]] (pre-[[Launch]], ascent, coast, descent, landed)
- [[System Health]] (CPU usage, memory, temperature)

**[[Sensor Data]]** (raw measurements):
- [[IMU]]-A, IMU-B, IMU-C: Gyroscope and accelerometer (400 Hz)
- [[GPS]]-A, GPS-B: Position, velocity, satellites, HDOP (25 Hz)
- [[Pressure Sensors]]: Chamber, [[LOX Tank]], RP-1 tank (100 Hz)
- Thermocouples: 12× [[Engine]] cooling temperatures (10 Hz)
- Voltage/[[Current Monitors]]: 6× power buses (10 Hz)

**[[Propulsion Data]]**:
- [[Engine Controller]]: Throttle [[Command]], [[TVC]] angles, valve positions
- [[Turbopump]]: Speed (RPM), bearing temperature
- [[Ignition Sequence]]: Igniter status, [[Chamber Pressure]]

### [[Telemetry Packet Structure

See]] [[ADR-005 Telemetry Protocol]] for [[Full]] specification

**[[Packet Format]]** (128 bytes [[Total]]):
```
Header (6 bytes):
  - Sync word: 0xAA55 (2 bytes)
  - Packet ID: 0-255 rolling counter (1 byte)
  - Timestamp: Milliseconds since T-0 (3 bytes, range 0-16777 seconds)

Payload (120 bytes):
  State Vector (36 bytes):
    - Position: Latitude, longitude, altitude (12 bytes)
    - Velocity: Vx, Vy, Vz (12 bytes)
    - Attitude: Quaternion q0, q1, q2, q3 (12 bytes)

  Sensor Data (40 bytes):
    - IMU-A: Gyro XYZ, Accel XYZ (12 bytes)
    - GPS-A: Lat, Lon, Alt, Vel (8 bytes)
    - Pressure: Chamber, LOX, RP-1 (6 bytes)
    - Temperature: Max of 12 thermocouples (2 bytes)
    - Battery: Voltage, current (4 bytes)
    - Spare (8 bytes)

  Actuator Commands (12 bytes):
    - Throttle: 0-100% (2 bytes)
    - TVC-X angle: -5° to +5° (2 bytes)
    - TVC-Y angle: -5° to +5° (2 bytes)
    - Valve positions: LOX, RP-1 (4 bytes)
    - Spare (2 bytes)

  System Health (20 bytes):
    - Flight mode: Enum (1 byte)
    - CPU temperature: °C (1 byte)
    - Memory usage: % (1 byte)
    - Link quality: RSSI, packet loss (2 bytes)
    - Event flags: Bitfield (2 bytes)
    - Spare (13 bytes)

  Reserved (12 bytes): Future use

Checksum (2 bytes):
  - CRC-16 (CCITT polynomial)
```

### Data Rates

**Downlink Telemetry**:
- Packet size: 128 bytes
- Transmission rate: 100 packets/second (100 Hz)
- Downlink bandwidth: 128 bytes × 100 Hz = 12.8 kB/s
- Radio capacity: 115.2 kbps = 14.4 kB/s
- Margin: 14.4 - 12.8 = 1.6 kB/s (11% margin for protocol overhead)

**Onboard Logging**:
- Same packet format as downlink
- Logging rate: 100 Hz (matches downlink)
- Mission duration: 600 seconds
- Log file size: 128 bytes × 100 Hz × 600s = 7.68 MB
- SD card capacity: 32 GB (ample margin)

## Telemetry Formatter

### Implementation

**Software Module**: Running on [[Flight Computer]]
- Language: C (compiled with -O2 optimization)
- Thread: Dedicated real-time thread (priority 90)
- Scheduling: 100 Hz (10ms period, triggered by timer interrupt)

**Data Collection Process**:
1. Read sensor data from shared memory (written by sensor drivers)
2. Read state estimate from navigation module
3. Read actuator commands from control module
4. Pack data into binary telemetry packet
5. Compute CRC-16 checksum
6. Write packet to UART (transmit to [[Communications]] radio)
7. Write packet to SD card (onboard log)

**Latency Budget**:
- Sensor read: (1ms
- Packet formatting: <2ms
- CRC computation: <1ms
- UART write: <1ms
- SD card write: <3ms (buffered, async)
- **Total**: <8ms (within 10ms budget)

### Data Encoding

**Binary Encoding** (not ASCII):
- Integers: Little-endian (LSB first)
- Floats: IEEE 754 single-precision (4 bytes)
- Fixed-point: Scaled integers (e.g., throttle 0-100% stored as uint16 0-10000)

**Why Binary**:
- Compact: 128 bytes vs. 500+ bytes for ASCII/JSON
- Fast: No string formatting overhead
- Deterministic: Fixed packet size, predictable timing

**Data Scaling Examples**:
- Throttle: 0-100% → uint16 (0-10000) → Resolution: 0.01%
- TVC angle: -5° to +5° → int16 (-500 to +500) → Resolution: 0.01°
- Pressure: 0-15 MPa → uint16 (0-15000) → Resolution: 1 kPa

### Error Detection

**CRC-16 Checksum**:
- Polynomial: 0x1021 (CCITT standard)
- Initial value: 0xFFFF
- Computed over header + payload (126 bytes)
- Appended as final 2 bytes

**Error Handling**:
- Ground station validates CRC on each received packet
- Invalid packets discarded (not displayed, not logged)
- Packet loss tracked via Packet ID counter (gaps indicate missing packets)
- Packet loss rate displayed to operator (warning if )5%)

## Onboard Data Logger

### Hardware

**Storage**: SanDisk 32GB microSD card (industrial-grade)
- Temperature range: -40°C to +85°C
- Write endurance: >100,000 cycles
- Read/write speed: 20 MB/s (class 10)

**Interface**: SPI (20 MHz clock)
- Connected to [[Flight Computer]] via SPI bus
- Shared with other peripherals (IMU uses same SPI bus)
- Chip select: Dedicated GPIO pin per device

### Logging Strategy

**Circular Buffer**:
- Telemetry packets buffered in RAM (1000 packets = 128 kB buffer)
- Background thread writes buffer to SD card (async, non-blocking)
- If buffer fills (e.g., SD card write slow), oldest packets overwritten

**File Format**:
- Single binary file: `flight-YYYYMMDD-HHMMSS.bin`
- Header: Metadata (flight date, configuration, sensor calibration)
- Body: Continuous stream of 128-byte telemetry packets
- Footer: Summary (total packets, mission duration, max altitude)

**Write Performance**:
- Write rate: 100 packets/s × 128 bytes = 12.8 kB/s
- SD card speed: 20 MB/s (1500× faster than needed)
- Latency: (5ms per write (buffered, does not block telemetry loop)

### Post-Flight Analysis

**Data Extraction**:
- SD card removed from vehicle after landing
- Plugged into PC via USB adapter
- Binary log file parsed by Python script (`parse_telemetry.py`)

**Analysis Tools**:
- `plot_trajectory.py`: Plots altitude, velocity, acceleration vs. time
- `plot_control.py`: Plots TVC angles, throttle commands
- `plot_sensors.py`: Plots IMU, GPS, pressure sensor data
- `generate_report.py`: Generates PDF report with key metrics

**Comparison with Downlink**:
- Onboard log = ground truth (no packet loss)
- Downlink log = real-time monitoring (may have gaps)
- Validation: Compare onboard vs. downlink → measure radio packet loss rate

## Ground Station Software

### Architecture

**Platform**: Python 3.10 on Linux (Ubuntu 22.04)

**Libraries**:
- `pyserial`: UART communication with ground radio
- `struct`: Binary packet parsing
- `matplotlib`: Real-time plotting
- `tkinter`: GUI for operator display

**Modules**:
1. **Radio Interface**: Receives telemetry packets from ground radio (115200 baud UART)
2. **Packet Parser**: Validates CRC, decodes binary data to human-readable format
3. **Data Logger**: Writes all received packets to CSV file (for post-flight analysis)
4. **Real-Time Plotter**: Plots altitude, velocity, attitude vs. time (updating at 10 Hz)
5. **Command Uplink**: Sends commands to vehicle (abort, hold, parameter update)

### Operator Display

**Main Window** (divided into panels):

**Panel 1: Vehicle State**
- Position: Latitude, longitude, altitude
- Velocity: Ground speed, vertical speed
- Attitude: Roll, pitch, yaw

**Panel 2: Propulsion Status**
- Throttle command: 0-100%
- Chamber pressure: 0-10 MPa (with warning thresholds)
- Turbopump speed: 0-35000 RPM
- Engine temperature: Max of 12 thermocouples

**Panel 3: System Health**
- Battery: Voltage, current, estimated state-of-charge
- Flight computer: CPU temp, memory usage
- Communications: RSSI, link quality, packet loss rate

**Panel 4: Real-Time Plots**
- Altitude vs. time (with apogee marker)
- Velocity vs. time (with max-Q marker)
- Throttle command vs. time

**Color Coding**:
- Green: Normal operation (within limits)
- Yellow: Caution (approaching limit)
- Red: Warning (exceeded limit, operator action recommended)

### Data Recording

**Ground Station Log**:
- Format: CSV (comma-separated values)
- File name: `ground-YYYYMMDD-HHMMSS.[[CSV]]`
- Columns: Timestamp, packet ID, all telemetry fields (50+ columns)
- Update rate: Every received packet (100 Hz if no packet loss)

**Post-Flight Correlation**:
- Ground log compared to onboard log
- Packet loss analysis (identify gaps in packet ID sequence)
- Radio link quality assessment (RSSI vs. range)

## Testing

### Benchtop Testing

**Loopback Test**:
- Setup: Flight computer → Telemetry formatter → UART loopback → Parser
- Result: ✅ 1 million packets transmitted, 0 CRC errors, 0 packet loss

**SD Card Endurance Test**:
- Procedure: Write 100 GB of telemetry data (simulate 1000 flights)
- Result: ✅ No write errors, card still functional

**Packet Parsing Test**:
- Procedure: Inject corrupted packets (bit flips, truncated data)
- Result: ✅ All corrupted packets detected by CRC, discarded correctly

### Integrated Testing

**HIL Testing** (see [[Avionics Integration Test]]):
- 100 simulated flight profiles executed
- Telemetry logged at 100 Hz for entire mission duration
- Ground station software displayed real-time data
- Result: ✅ 100% packet success rate (0 dropped packets in simulation)

**Field Test**:
- Vehicle on launch pad, ground station 5 km away
- Full countdown sequence executed (T-30s to T-0)
- Telemetry monitored in real-time by operator
- Result: ✅ Link quality excellent (RSSI -70 dBm, 0% packet loss)

### Radio Range Test

**Test Setup**:
- Vehicle radio transmitting telemetry at 100 Hz
- Ground radio receiving, packet loss measured

**Results**:
| Distance | RSSI | Packet Loss | Link Quality |
|----------|------|-------------|--------------|
| 1 km | -60 dBm | 0% | Excellent |
| 10 km | -75 dBm | 0% | Good |
| 50 km | -95 dBm | 0.1% | Acceptable |
| 100 km | -105 dBm | 2% | Marginal |
| 120 km | -110 dBm | 15% | Poor |

**Conclusion**: Link closes reliably up to 100 km (mission requirement)

## Data Products

### Flight Metrics (Auto-Generated)

**Performance Metrics**:
- Max altitude: 52.3 km (from GPS)
- Max velocity: 1840 m/s (from state estimate)
- Max acceleration: 4.2 g (from IMU)
- Apogee time: T+145s
- Flight duration: 612s (T-0 to landing)

**Propulsion Metrics**:
- Total burn time: 180s (3× burns)
- Average thrust: 44.5 kN (from chamber pressure)
- Specific impulse: 288s (calculated from propellant mass flow)
- Turbopump max speed: 32,400 RPM

**Power Metrics**:
- Total energy consumed: 6.8 Wh
- Peak power: 52W (during engine firing)
- Average power: 38W
- Battery SOC at landing: 97% (barely used)

### Anomaly Detection

**Automated Alerts** (during flight):
- **Underpressure**: Chamber pressure <7 MPa → Incomplete combustion
- **Overpressure**: Chamber pressure )10 MPa → Structural risk
- **Overtemperature**: Engine temp >400°C → Thermal runaway imminent
- **GPS dropout**: No GPS fix for >5 seconds → Dead reckoning mode
- **Low battery**: Voltage (21V → Load shedding initiated

**Post-Flight Analysis**:
- Automated scan of telemetry log for anomalies
- Report generated: `anomaly-[[Report]].[[PDF]]`
- Includes: Timestamp, description, severity, recommendation

## [[Lessons Learned]]

### [[What Worked Well]]

1. **[[Binary Telemetry Efficient]] and Reliable**
   - 128-byte packets fit within radio bandwidth with margin
   - CRC-16 caught all corrupted packets (0 false [[Positives]] in [[Testing]])
   - Fixed packet size simplified ground station [[Parsing]]

2. **[[Onboard Logging Critical Backup]]**
   - SD card [[Log]] = ground truth (no [[Packet Loss]])
   - [[Validated]] radio link [[Performance]] (measured packet loss)
   - [[Essential]] for post-flight [[Debugging]] (engine anomalies analyzed from onboard data)

3. **Real-[[Time Plotting Improved Situational]] Awareness**
   - Operator could [[See]] altitude, velocity in real-time
   - Helped [[Identify]] [[GPS Dropout]] during [[Test 2]] (visible in plot)
   - [[Built]] confidence in flight performance

### [[Challenges Encountered]]

1. **SD [[Card Write Latency]]**
   - Initial implementation: Synchronous writes ([[Blocked]] telemetry loop)
   - Impact: Telemetry loop jitter )50ms (unacceptable)
   - Solution: [[Circular Buffer]] + background thread (async writes)
   - [[Result]]: Jitter reduced to <1ms

2. **Packet Loss at [[High Data Rates]]**
   - Initial design: 200 Hz telemetry [[Rate]]
   - Problem: 8% packet loss at 100 km range (insufficient margin)
   - Solution: Reduced to 100 Hz → 0% packet loss
   - Trade-off: Lower [[Update Rate]], [[But]] acceptable for mission

3. **Ground Station [[GUI Lag]]**
   - Real-time plotting at 100 Hz caused GUI to freeze ([[Python]] threading issue)
   - Impact: Operator lost visibility during critical phases
   - Solution: Decoupled plotting (update plots at 10 Hz, log data at 100 Hz)
   - Result: Smooth GUI, no freezing

## [[Current Status]]

**[[Design Maturity]]**: 95% ([[Ready]] for CDR)

**[[Completed]]**:
- ✅ Telemetry packet format [[Defined]] and validated
- ✅ Onboard logger [[Implemented]] and tested (SD [[Card Endurance Test]])
- ✅ Ground station [[Software]] [[Developed]] (real-time display + data [[Logging]])
- ✅ [[HIL Testing]] with [[Flight Computers]] and radios
- ✅ Field testing at launch [[Site]] (5 km [[Range Test]])

**[[Remaining Work]]**:
- Final ground station GUI polish (operator training)
- [[Flight Readiness Review]] (verify telemetry link on launch day)

**Risks**:
- **R-022**: Telemetry packet loss during critical flight phases - Mitigation: Onboard SD card backup, conservative [[Link Budget]]
- **R-023**: SD card failure (unable to recover onboard log) - Mitigation: Industrial-[[Grade]] card, pre-flight [[Verification]]

## [[Future Enhancements]] (Post-[[First Flight]])

1. **[[High]]-[[Rate Telemetry]]**: [[Add 1000]] Hz mode for detailed vibration analysis (triggered on-[[Demand]])
2. **Compression**: Add DEFLATE compression to reduce bandwidth (2-3× reduction)
3. **[[Video Downlink]]**: Add onboard camera with MPEG-4 [[Video]] (requires higher bandwidth radio)
4. **Encryption**: Add AES-256 encryption for telemetry/[[Command Security]] (commercial requirement)

## [[Related Notes]]

**[[Avionics Subsystem]]**:
- [[Avionics System]] - Subsystem overview
- [[Flight Computer]] - Runs telemetry formatter
- [[Sensor Suite]] - Provides sensor data
- [[Communications]] - Transmits telemetry packets
- [[Flight Software]] - Telemetry module implementation

**Testing**:
- [[Avionics Integration Test]] - HIL testing [[Results]]
- [[Engine Hot Fire Results]] - Post-flight telemetry analysis (thermocouples validated)
- [[Test Campaign Overview]] - Overall [[Test]] [[Strategy]]

**[[Project Management]]**:
- [[Project Roadmap]] - Telemetry [[Milestones]]
- [[Risk Register]] - R-022, R-023
- [[Team Roster]] - [[Elena Rodriguez]] ([[Avionics Lead]])

**[[Decisions]]**:
- [[ADR-005 Telemetry Protocol]] - Packet format specification

---

*[[Component Specification]] by [[Elena Rodriguez]] - [[Last Updated]] 2026-01-02*
