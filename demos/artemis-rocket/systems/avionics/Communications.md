---
type: component
subsystem: avionics
status: testing
owner: "[[Elena Rodriguez]]"
created: 2025-09-14
updated: 2026-01-02
---
# [[Communications]]

## [[Overview]]

The Artemis communications [[System]] provides bidirectional [[Telemetry]] and [[Command]] [[Link]] between the [[Launch]] vehicle and [[Ground]] [[Control]]. The [[Design]] prioritizes real-time [[Telemetry Downlink]] for vehicle [[Health Monitoring]] and allows ground operators to send commands for contingency scenarios.

**[[Key Features]]**:
- S-band radio (2.2-2.3 GHz) for telemetry/command
- Omnidirectional antenna (no pointing [[Required]])
- 100 kbps downlink, 10 kbps uplink [[Data]] rates
- Range: 400 km (sufficient for [[Sub]]-orbital trajectory)
- [[Redundant]] transceivers ([[Hot Standby]])

**[[Design Philosophy]]**: Simple, proven, commercial off-the-shelf (COTS) [[Components]]

## [[Radio Selection]]

### Transceiver

**[[Selected Radio]]**: Microhard pMDDL2450

**Specifications**:
- [[Frequency]]: 2.4 GHz [[ISM Band]] (license-free)
- Transmit power: 1W (30 dBm)
- Receiver sensitivity: -106 dBm
- [[Data Rate]]: 115.2 kbps (downlink), 9.6 kbps (uplink)
- Modulation: FHSS ([[Frequency Hopping Spread Spectrum]])
- Range: Line-of-sight 40 km @ 115 kbps, 80 km @ 9.6 kbps
- Interface: UART (RS-232, 115200 baud)
- Power: 3W transmit, 500mW receive
- Mass: 85g (including enclosure)
- Operating temperature: -40°C to +85°C

**[[Why Microhard]] pMDDL2450**:
- Flight-proven in UAV [[Applications]] (thousands of flight [[Hours]])
- ISM band = no FCC licensing required (saves time and cost)
- FHSS = robust against interference and multipath fading
- Long range with modest transmit power
- Cost: $800 per unit (vs. $20K+ for aerospace-[[Grade]] S-band transceiver)

**Trade-Off**: 2.4 GHz vs. S-band
- S-band (2.2-2.3 GHz) typical for aerospace [[But]] requires FCC license
- ISM band (2.4 GHz) license-free, readily [[Available]] [[Hardware]]
- Decision: [[Use]] ISM band for [[First Flight]], upgrade to licensed S-band if needed for orbital missions

### [[Ground Station Radio]]

**Equipment**: Microhard pMDDL2450 (same model as vehicle radio for compatibility)

**Antenna**: 12 dBi Yagi directional antenna
- Manual tracking by operator during flight
- Azimuth/elevation mount
- Estimated range: 100 km @ 115 kbps (slant range for 50 km apogee)

**Backup**: Second ground station at alternate [[Location]] (10 km [[Separation]])
- Provides diversity if [[One]] station loses line-of-sight
- Automatic switchover in [[Flight Software]] if primary link drops

## [[Antenna Design]]

### [[Vehicle Antenna]]

**Type**: Omnidirectional whip antenna (quarter-wave monopole)

**Specifications**:
- Frequency: 2.4 GHz
- Gain: 2 dBi (omnidirectional pattern)
- Polarization: Vertical
- VSWR: (1.5:1
- Length: 31mm (λ/4 @ 2.4 GHz)

**Mounting**:
- Location: [[Top]] of vehicle (above payload bay)
- Material: Stainless steel whip
- [[Connector]]: SMA male (mates to radio SMA female)
- Ground plane: Vehicle body (aluminum structure acts as counterpoise)

**[[Radiation Pattern]]**:
- Omnidirectional in azimuth (360° [[Coverage]])
- Null along vehicle axis (zenith/nadir)
- Trade-off: Simple antenna, but weak signal [[When]] vehicle pointing directly at/away from ground station

### [[Antenna Redundancy]]

**[[Primary Antenna]]**: Top-mounted whip (described above)

**[[Secondary Antenna]]**: Side-mounted patch antenna
- Type: 2.4 GHz patch antenna (7 dBi gain)
- Location: Side of vehicle (between fins)
- [[Purpose]]: Backup if whip antenna damaged
- Pattern: Hemispherical (covers 180° in azimuth)

**[[Diversity Switching]]**:
- [[Both]] antennas connected to transceivers [[Via]] RF switch (SPDT)
- [[Flight Software]] monitors signal strength (RSSI) on both antennas
- [[Auto]]-switches to antenna with stronger signal
- Switching time: <100ms

## [[Transceiver Redundancy]]

**[[Dual Transceiver Configuration]]**:
- **Radio-A** (Primary): Connected to primary antenna, actively transmitting
- **Radio-B** ([[Hot]] Standby): Connected to secondary antenna, [[Powered]] but silent

**[[Failover Logic]]**:
1. [[Flight Software]] monitors Radio-A health:
   - RSSI ([[Received Signal Strength Indicator]])
   - Link quality (packet [[Success Rate]])
   - TX/RX error counters
2. [[If Radio]]-A fails (no uplink packets for )2 seconds), switch to Radio-B
3. Radio-B takes over transmission, Radio-A powered down
4. Failover time: (500ms

**[[Failure Modes Covered]]**:
- Radio hardware failure (PA burnout, receiver desensitization)
- Antenna damage (whip broken during [[Stage Separation]])
- Ground station link loss (move to backup ground station frequency)

## Telemetry Downlink

### [[Data Format]]

**[[Telemetry Packet Structure]]** (binary format):
```
Header (6 bytes):
  - Sync word (2 bytes): 0xAA55
  - Packet ID (1 byte): Increments each packet
  - Timestamp (3 bytes): Milliseconds since launch

Payload (120 bytes):
  - Vehicle state (36 bytes): Position, velocity, attitude
  - Sensor data (40 bytes): IMU, GPS, pressure, temperature
  - Actuator commands (12 bytes): TVC angles, throttle
  - System health (20 bytes): Battery voltage, CPU temp, link quality
  - Spare (12 bytes): Reserved for future use

Checksum (2 bytes):
  - CRC-16 for error detection
```

**Total Packet Size**: 128 bytes

**Transmission Rate**:
- Downlink bandwidth: 115.2 kbps = 14.4 kB/s
- Telemetry packet: 128 bytes
- Packets per second: 14400 / 128 = 112 packets/sec (9ms period)
- Actual rate: 100 packets/sec (10ms period) to allow for protocol overhead

**Latency**:
- Telemetry generation (Flight Software): <5ms
- Packetization and transmission: <10ms
- Ground station receive and decode: <5ms
- Total latency: ~20ms (ground to vehicle, one-way)

### Telemetry Content

**Vehicle State** (updated 100 Hz):
- Position: Latitude, longitude, altitude (from [[Sensor Suite]] GPS)
- Velocity: Vx, Vy, Vz (from sensor fusion)
- Attitude: Roll, pitch, yaw (quaternion converted to Euler angles)
- Angular rates: Gyroscope X, Y, Z

**Sensor Data** (sampled 100 Hz, transmitted 100 Hz):
- IMU-A, IMU-B, IMU-C: Gyroscope and accelerometer
- GPS-A, GPS-B: Number of satellites, HDOP, position/velocity
- Pressure sensors: Chamber pressure, LOX tank, RP-1 tank
- Thermocouples: 12× engine cooling temperatures

**Actuator Commands** (updated 100 Hz):
- [[Thrust Vector Control]]: TVC-X angle, TVC-Y angle
- [[Engine Controller]]: Throttle command (50-100%)
- Propellant valves: LOX valve position, RP-1 valve position

**System Health** (sampled 10 Hz, transmitted 10 Hz):
- [[Power Distribution]]: Battery voltage, current draw, regulator voltages
- [[Flight Computer]]: CPU temperature, memory usage, disk usage
- Communications: RSSI, link quality, packet loss rate
- Propulsion: [[Turbopump]] speed, [[Ignition Sequence]] status

See [[ADR-005 Telemetry Protocol]] for full protocol specification

## Command Uplink

### Command Types

**Flight Management Commands**:
- **Abort**: Immediate engine shutdown, activate parachute
- **Hold**: Pause countdown (pre-launch only)
- **Resume**: Resume countdown after hold
- **Mode Change**: Switch flight modes (e.g., manual control)

**Parameter Updates**:
- **Trajectory Update**: Upload new target trajectory waypoints
- **Gain Update**: Adjust control loop gains (PID tuning)
- **Threshold Update**: Change fault detection thresholds

**Diagnostic Commands**:
- **Telemetry Rate**: Change telemetry update rate (10-100 Hz)
- **Log Download**: Request log file download
- **Health Query**: Request detailed system health report

### Command Security

**Authentication**:
- Each command includes 32-bit authentication code
- Code = CRC-32 of (command + secret key + timestamp)
- Secret key stored in Flight Software configuration file
- Prevents unauthorized commands from rogue transmitters

**Command Validation**:
- Timestamp must be within 5 seconds of vehicle clock (prevents replay attacks)
- CRC-32 checked before command execution
- Invalid commands logged but ignored

**Critical Command Confirmation**:
- High-risk commands (Abort, Mode Change) require double confirmation
- Ground operator sends command twice within 2 seconds
- Flight Software executes only if both commands match
- Prevents accidental execution due to bit errors

## Link Budget

**Downlink (Vehicle → Ground)**:
```
Transmit power (Radio-A):        +30 dBm (1W)
Vehicle antenna gain:            +2 dBi
Path loss (100 km, 2.4 GHz):    -130 dB
Ground antenna gain (Yagi):      +12 dBi
Receiver sensitivity:            -106 dBm
─────────────────────────────────────────────
Link margin:                     +8 dB
```

**Uplink (Ground → Vehicle)**:
```
Transmit power (Ground radio):   +30 dBm (1W)
Ground antenna gain (Yagi):      +12 dBi
Path loss (100 km, 2.4 GHz):    -130 dB
Vehicle antenna gain:            +2 dBi
Receiver sensitivity:            -106 dBm
─────────────────────────────────────────────
Link margin:                     +8 dB
```

**[[Link Margin Adequacy]]**:
- 8 dB margin covers:
  - Atmospheric attenuation: 1-2 dB
  - Polarization mismatch: 1-3 dB
  - Vehicle body blockage: 2-4 dB
- Minimum acceptable margin: 6 dB
- [[Result]]: **Link closes with 2 dB remaining margin**

**[[Maximum Range]]** (with 8 dB margin):
- Line-of-sight range: 100 km
- Slant range for 50 km apogee: 112 km (vehicle at zenith)
- Margin: 8 dB → adequate for mission profile

## [[Integration]]

### Mounting

**[[Radio Mounting]]**:
- Both radios mounted in electronics bay (temperature controlled)
- Vibration isolators: 4× rubber grommets per radio
- Thermal interface: Radios bolted to aluminum mounting plate (heat spreader)

**[[Antenna Mounting]]**:
- Primary antenna: Through-hole at vehicle apex, SMA bulkhead connector
- Secondary antenna: Flush-mounted patch on vehicle side
- RF cables: SMA male-to-male, semi-rigid coax, 30cm length
- Torque: SMA connectors torqued to 0.5 Nm (prevents loosening during vibration)

### Power

**[[Primary Power]]**: 28V DC from [[Power Distribution]]
- Radio-A: 3W transmit, 0.5W receive (average 2W duty cycle 50%)
- Radio-B: 0.5W standby ([[Not]] transmitting)
- [[Total]] communications power: 2.5W average, 6W peak (both radios transmitting)

**[[Power Sequencing]]**:
- T-30s: Both radios powered on
- T-25s: Radios acquire lock with ground station
- T-20s: Begin [[Telemetry Transmission]] (vehicle on pad)
- T-0: Continue telemetry throughout flight
- T+600s (landing): Radios powered down

### [[Environmental Qualification]]

**Vibration**:
- Qualification level: 14.1 Grms ([[See]] [[Avionics Integration Test]])
- Result: ✅ Radios functional during and [[After]] vibration
- No [[Performance]] degradation, connectors [[Secure]]

**[[Thermal Vacuum]]**:
- Chamber: -40°C to +70°C, <1×10⁻⁵ Torr
- Duration: 8 hours (4 thermal cycles)
- Result: ✅ Radios [[Maintained]] lock with ground station simulator throughout [[Test]]

**EMC ([[Electromagnetic Compatibility]])**:
- Conducted emissions: <1 V/m @ 1m (meets MIL-STD-461)
- Radiated emissions: <30 dBμV/m @ 3m ([[FCC Part]] 15 compliant)
- Susceptibility: No upsets up to 200 V/m field strength

## [[Testing]]

### [[Benchtop Testing]]

**[[Range Test]]**:
- Setup: Vehicle radio on rooftop, ground radio 10 km away (line-of-sight)
- Result: 115.2 kbps link maintained, RSSI -85 dBm, 0% [[Packet Loss]]
- [[Validated]]: [[Link Budget]] model accurate

**[[Failover Test]]**:
- Procedure: Power down Radio-A during transmission
- Result: Radio-B automatically took over within 400ms
- Validated: [[Redundancy]] switching works as designed

**[[Antenna Diversity Test]]**:
- Procedure: Rotate vehicle antenna to null ground station
- Result: RF switch automatically selected secondary antenna within 150ms
- Validated: Diversity improves link robustness

### Flight-[[Like Testing]]

**[[HIL Integration]]** (see [[Avionics Integration Test]]):
- Radios integrated with [[Flight Computer]] and [[Telemetry]] system
- 100 simulated flight profiles [[Executed]]
- Telemetry logged at 100 Hz for entire flight duration
- Result: ✅ 100% packet success [[Rate]] (0 dropped packets)

**[[Field Test]]** (Pre-[[Flight Readiness]]):
- Vehicle on launch pad, ground station 5 km away
- [[Full]] countdown sequence executed (T-30s to T-0)
- Telemetry [[Monitored]] in real-time by ground control
- Commands sent to vehicle (Hold, [[Resume]], Abort test)
- Result: ✅ [[All]] tests passed, link quality [[Excellent]] (RSSI -70 dBm)

## [[Lessons Learned]]

### [[What Worked Well]]

1. **COTS [[Radio Exceeded Expectations]]**
   - Microhard pMDDL2450 performed flawlessly in all tests
   - FHSS modulation robust against interference (Wi-Fi, Bluetooth coexistence)
   - Long range [[Achieved]] with modest transmit power (1W)

2. **ISM [[Band Simplified Operations]]**
   - No FCC licensing delays (saved 3 months)
   - Can use same radios for testing and flight (no special permissions)
   - Wide availability of compatible ground station equipment

3. **[[Omnidirectional Antenna Trade]]-[[Off Acceptable]]**
   - Null along vehicle axis not a problem (vehicle rarely points directly at ground station)
   - Simplicity outweighs minor performance penalty
   - Backup patch antenna covers edge cases

### [[Challenges Encountered]]

1. **Packet Loss at [[High Data Rates]]**
   - Initial design: 230.4 kbps downlink (2× [[Faster]])
   - Problem: 5% packet loss at 100 km range (insufficient margin)
   - Solution: Reduced to 115.2 kbps → 0% packet loss
   - Lesson [[Learned]]: Conservative link budget is critical

2. **[[RF Interference]] from Igniter**
   - Pyrotechnic igniter EMI caused brief telemetry dropout (500ms) at T-0
   - [[Root cause]]: [[High]]-[[Current]] [[Spark]] interfered with 2.4 GHz radio
   - Solution: [[Added]] RF choke on igniter power line, shielded igniter cable
   - Result: Interference [[Eliminated]]

3. **[[Antenna Connector Loosening]]**
   - [[Vibration Testing]] loosened SMA connector (1/4 turn after 14.1 Grms)
   - Impact: VSWR increased, link quality degraded
   - Solution: Torque SMA connectors to 0.5 Nm, verify with torque wrench
   - Lesson learned: Torque specifications critical for RF connections

## [[Current Status]]

**[[Design Maturity]]**: 95% ([[Ready]] for CDR)

**[[Completed]]**:
- ✅ Radio and antenna selection
- ✅ Link budget analysis and [[Validation]]
- ✅ Benchtop range and failover testing
- ✅ [[HIL Testing]] with [[Telemetry System]] integration
- ✅ Environmental qualification (thermal vacuum, vibration, EMC)

**[[Remaining Work]]**:
- Final field test at launch [[Site]] (validate ground station setup)
- [[Flight Readiness Review]] (verify link quality on launch day)

**Risks**:
- **R-018**: [[Communication]] link loss during flight - Mitigation: Dual transceivers, antenna diversity, conservative link budget
- **R-019**: Ground station tracking failure - Mitigation: Backup ground station at alternate location

## [[Future Enhancements]] (Post-[[First]] Flight)

1. **S-[[Band Upgrade]]**: Migrate to licensed S-band (2.2-2.3 GHz) for orbital missions (better atmospheric penetration)
2. **High-[[Gain Antenna]]**: Add deployable high-gain antenna for extended range ()1000 km)
3. **Encryption**: Add AES-256 encryption for telemetry/[[Command Security]] (commercial spaceflight requirement)
4. **[[Video Downlink]]**: Add onboard camera with MPEG-4 compression (requires higher bandwidth radio)

## [[Related Notes]]

**[[Avionics Subsystem]]**:
- [[Avionics System]] - Subsystem overview
- [[Flight Computer]] - Processes telemetry data
- [[Telemetry]] - [[Data Logging]] and formatting
- [[Flight Software]] - Telemetry packetization

**Testing**:
- [[Avionics Integration Test]] - HIL testing [[Results]]
- [[Test Campaign Overview]] - Overall test [[Strategy]]

**[[Project Management]]**:
- [[Project Roadmap]] - Communications [[Milestones]]
- [[Risk Register]] - R-018, R-019
- [[Team Roster]] - [[Elena Rodriguez]] ([[Avionics Lead]])

**[[Decisions]]**:
- [[ADR-005 Telemetry Protocol]] - Telemetry format and content

---

*[[Component Specification]] by [[Elena Rodriguez]] - [[Last Updated]] 2026-01-02*
