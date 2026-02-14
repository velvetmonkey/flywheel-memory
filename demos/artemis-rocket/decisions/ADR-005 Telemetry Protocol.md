---
type: decision
status: accepted
date: 2025-10-20
updated: 2025-10-20
decision_makers:
  - "[[Elena Rodriguez]]"
  - "[[Sarah Chen]]"
tags:
  - adr
  - telemetry
  - avionics
  - decision
---
# ADR-005: [[Telemetry Protocol]]

## [[Status]]

**Accepted** - 2025-10-20

## [[Context]]

The [[Artemis Rocket]] requires a [[Telemetry]] [[System]] to transmit flight [[Data]] from the vehicle to [[Ground]] stations during ascent and landing. The [[Telemetry Protocol]] [[Must]] balance data richness (comprehensive [[Monitoring]]) with bandwidth limitations (radio [[Link]] constraints).

[[Key Constraints]]:
- Radio bandwidth: 1 Mbps max (licensed [[Frequency]] allocation)
- Range: 80 km max (ascent to [[Stage Separation]] altitude)
- Flight duration: 300 seconds (ascent + descent + landing)
- Data [[Requirements]]: 50+ sensor channels at 1-10 kHz
- Budget: $14M total program (limits custom radio hardware)
- Reliability: Must work with packet loss (radio link interruptions)

**Mission Requirements**:
- Real-time monitoring (abort decisions based on telemetry)
- Post-flight analysis (full data reconstruction)
- Redundancy (multiple ground stations)
- Security (prevent unauthorized access/jamming)

## Decision

**Selected: Custom Binary Protocol with Forward Error Correction**

The telemetry system will use a custom binary protocol optimized for rocket flight data, with Reed-Solomon forward error correction to handle packet loss. Data will be transmitted at variable rates (1-10 kHz) depending on criticality.

**Protocol Architecture**:
- Binary packet format (compact, efficient encoding)
- Forward error correction (Reed-Solomon, 25% overhead)
- Priority-based transmission (critical data sent more frequently)
- Ground station redundancy (3 stations for coverage)
- AES-128 encryption (prevent unauthorized access)

## Alternatives Considered

### Option 1: COTS Telemetry System (iNet-X Standard)

**Advantages**:
- Off-the-shelf hardware (transmitter $15K, receivers $5K each)
- Proven standard (used by test ranges, aviation)
- Plug-and-play integration (minimal software development)
- Ground station software available (commercial vendors)

**Disadvantages**:
- Inefficient for rocket data (designed for aircraft telemetry)
- Fixed packet format (not optimized for our sensor mix)
- Expensive licensing ($50K for ground station [[Software]])
- Overkill [[Features]] ([[Video]] streaming, time sync we [[Don]]'t [[Need]])

**[[Conclusion]]**: Rejected - cost and inefficiency [[Not]] justified

### [[Option 2]]: MAVLink [[Protocol]] ([[Drone Standard]])

**Advantages**:
- Open-source (no licensing fees)
- Flight-proven (thousands of drones [[Use]] it)
- Rich ecosystem (ground station software, libraries)
- Well-[[Documented]] (easy [[Integration]])

**Disadvantages**:
- Designed for drones (not [[Optimized]] for [[High]]-speed rockets)
- [[Limited]] [[Data Rate]] (assumes slower dynamics)
- Packet [[Overhead]] high (15-20 bytes header per message)
- [[Security]] weak (no encryption in standard)

**Conclusion**: Rejected - not optimized for rocket flight profiles

### [[Option 3]]: Raw [[UDP Packets]] ([[Minimal Protocol]])

**Advantages**:
- Simplest implementation (standard IP [[Stack]])
- No protocol overhead (maximum data efficiency)
- Flexible (easy to change packet structure)

**Disadvantages**:
- No error correction (packet loss = data loss)
- No [[Priority]] ([[All]] data treated equally)
- No encryption (anyone can receive telemetry)
- Unreliable radio link (UDP assumes reliable network)

**Conclusion**: Rejected - insufficient [[Reliability]] for mission-critical data

### [[Option 4]]: [[Custom Binary Protocol]] (Selected)

**Advantages**:
- Optimized for rocket data (sensor types, update rates)
- Compact encoding (maximize data in 1 Mbps link)
- [[Forward Error Correction]] (recovers from packet loss)
- Priority-[[Based]] (critical data sent more frequently)
- Encrypted (AES-128, [[Prevent]] unauthorized access)
- Low overhead (8-byte header, 25% FEC)

**Disadvantages**:
- [[Custom]] development (6 [[Weeks]] software effort)
- Ground station software (must write custom decoder)
- No ecosystem (can't use COTS ground stations)

**Conclusion**: **SELECTED** - [[Best]] [[Performance]] for rocket mission profile

## Rationale

### 1. [[Data Rate Requirements]]

**[[Sensor Data]]**:
- Critical sensors (50 channels): 10 kHz sampling
  - [[Chamber Pressure]], [[Turbopump Speed]], IMU, GPS
  - Data [[Rate]]: 50 channels × 10 kHz × 4 bytes = 2 Mbps (uncompressed)
- Secondary sensors (50 channels): 1 kHz sampling
  - Thermocouples, valve positions, battery voltage
  - Data rate: 50 channels × 1 kHz × 4 bytes = 200 Kbps (uncompressed)

**[[Total Uncompressed]]**: 2.2 Mbps (exceeds 1 Mbps radio link)

**[[Optimization Needed]]**:
- Delta encoding (send changes, not absolute values): 50% reduction
- Priority-based decimation (send critical data more often): 30% reduction
- Binary encoding (vs ASCII/[[JSON]]): 75% reduction

**[[Compressed Data Rate]]**: 2.2 Mbps × 0.5 × 0.7 × 0.25 = 190 Kbps (within 1 Mbps)

**[[Forward Error Correction Overhead]]**: 190 Kbps × 1.25 = 240 Kbps

**Verdict**: Custom protocol achieves [[Required]] data rate within bandwidth

### 2. [[Packet Loss Tolerance]]

**[[Radio Link Quality]]**:
- Line-of-sight: 0-50 km ([[Excellent]], (1% packet loss)
- Over horizon: 50-80 km ([[Poor]], 10-30% packet loss)
- Re-entry plasma: High attenuation (50%+ packet loss possible)

**Forward Error Correction**:
- [[Reed]]-Solomon (255, 223) code: Corrects up to 16 byte errors per 255-byte block
- 25% overhead (223 data bytes + 32 parity bytes = 255 [[Total]])
- Can recover from 30% packet loss (16/255 = 6.3% error rate per block)

**Priority-[[Based Transmission]]**:
- Critical data (IMU, GPS, chamber pressure): Sent every packet (10 Hz effective)
- Important data (temperatures, flow rates): Sent every 5 packets (2 Hz effective)
- Diagnostic data (valve positions, battery voltage): Sent every 10 packets (1 Hz effective)

**Redundancy**:
- 3 ground stations (120° spacing around [[Launch]] [[Site]])
- Probability of [[All 3]] losing signal: <1% (independent fading)
- At least 1 station receives data )99% of flight

**Verdict**: FEC + redundancy + priority ensures data delivery

### 3. Real-Time Monitoring Requirements

**Abort Decision Timeline**:
- Anomaly detected in telemetry (t=0)
- Ground station processes packet (t+10ms)
- Abort command uplinked to vehicle (t+20ms)
- Vehicle executes abort (t+100ms)
- **Total latency: 130ms** (acceptable for real-time abort)

**Telemetry Latency**:
- Packet transmission: 2ms (240 Kbps / 1 Mbps = 24% duty cycle)
- Radio propagation: 0.3ms (80 km / speed of light)
- Ground station decode: 5ms (FEC decoding)
- **Total: 7.3ms one-way** (real-time monitoring feasible)

**Verdict**: Custom protocol meets real-time latency requirements

### 4. Security Requirements

**Threat Model**:
- Unauthorized reception (competitors eavesdropping)
- Jamming (malicious interference)
- Spoofing (fake telemetry injection)

**AES-128 Encryption**:
- Symmetric key (pre-shared between vehicle and ground stations)
- 128-bit key (2^128 brute force attempts, infeasible)
- Adds 12 bytes overhead per packet (16-byte IV + 4-byte MAC)

**Anti-Jamming**:
- Frequency hopping (100 channels, 10 hops/second)
- Spread spectrum (makes signal noise-like, hard to jam)
- Directional antennas (reject off-axis interference)

**Anti-Spoofing**:
- Message Authentication Code (MAC, part of AES)
- Sequence numbers (detect replayed packets)
- Timestamp (reject old packets)

**Verdict**: Encryption + frequency hopping + MAC provides adequate security

## Implications

### Telemetry System Design

**Onboard Hardware**:
- Radio transmitter: 1W power, 900 MHz ISM band
- Antenna: Omnidirectional (hemispherical coverage)
- Encryption accelerator: AES-128 hardware (low latency)
- [[Flight Computer]] interface: Dedicated telemetry task (10 Hz packet rate)

**Ground Station Hardware** (3 stations):
- Radio receivers: 900 MHz, 1 Mbps capability
- Antennas: 10 dBi gain (directional, track vehicle)
- Antenna rotators: Auto-tracking (follow vehicle trajectory)
- Ground computers: Decode, decrypt, log telemetry
- Network: Ethernet link to mission control (real-time display)

**Software Architecture**:

**Onboard ([[Flight Computer]])**:
```
Sensor Data (50+ channels, 1-10 kHz)
         ↓
Priority Queue (critical data first)
         ↓
Delta Encoding (send changes only)
         ↓
Binary Packing (compact format)
         ↓
AES-128 Encryption (secure)
         ↓
Reed-Solomon FEC (error correction)
         ↓
Radio Transmitter (1 Mbps link)
```

**Ground Station**:
```
Radio Receiver (1 Mbps link)
         ↓
Reed-Solomon Decode (error correction)
         ↓
AES-128 Decryption (authenticate)
         ↓
Binary Unpacking (extract data)
         ↓
Delta Decoding (reconstruct values)
         ↓
Data Logging (full-rate storage)
         ↓
Real-Time Display (mission control)
```

### Packet Format

**Header (8 bytes)**:
- Packet type (1 byte): Sensor data, status, heartbeat
- Sequence number (2 bytes): Detect packet loss
- Timestamp (4 bytes): Mission elapsed time (milliseconds)
- Flags (1 byte): Priority, encryption, compression

**Payload (200 bytes)**:
- Sensor data: Variable-length, priority-ordered
- Delta-encoded: Changes from previous packet
- Binary-packed: Optimized for data types (16-bit temp, 32-bit pressure)

**Error Correction (50 bytes)**:
- Reed-Solomon parity: 32 bytes (255, 223) code
- Cyclic Redundancy Check (CRC): 4 bytes (detect corruption)
- Message Authentication Code (MAC): 12 bytes (AES-GCM)

**Total Packet Size**: 258 bytes (8 + 200 + 50)
**Transmission Time**: 2ms @ 1 Mbps
**Effective Data Rate**: 200 bytes @ 10 Hz = 2 KB/s = 16 Kbps (after overhead)

### Priority Assignment

**Priority 1 (Critical, 10 Hz)**:
- Chamber pressure (abort on low pressure)
- IMU (attitude, acceleration, rotation)
- GPS (position, velocity)
- Turbopump speed (abort on overspeed)
- Flight computer health (watchdog, CPU, memory)

**Priority 2 (Important, 2 Hz)**:
- Propellant flow rates (fuel, oxidizer)
- Tank pressures (ullage pressure)
- Chamber wall temperatures (cooling system)
- Battery voltage (power system)
- TVC gimbal angles (control surface positions)

**Priority 3 (Diagnostic, 1 Hz)**:
- Valve positions (open/closed status)
- Thermocouple readings (50+ temperature sensors)
- Actuator currents (motor health)
- Software state machine (flight mode, event log)

### Ground Station Deployment

**Station Locations**:
- Station 1: Launch site (0 km, primary)
- Station 2: 40 km northeast (backup, over-horizon)
- Station 3: 40 km southeast (backup, over-horizon)

**Coverage Analysis**:
- 0-50 km ascent: All 3 stations receive (redundant)
- 50-80 km ascent: Station 1 only (line-of-sight)
- Descent/landing: All 3 stations receive (back in range)

**Antenna Tracking**:
- Predicted trajectory uploaded to stations pre-flight
- Auto-tracking follows predicted path (±5° margin)
- Manual override if trajectory deviates (abort scenario)

### Data Logging and Archival

**Onboard Logging**:
- Full-rate data: 10 kHz, all 100 channels
- Storage: 32 GB flash (300s flight = 100 MB compressed)
- Backup: Vehicle data recovered post-flight (if telemetry lost)

**Ground Station Logging**:
- Received packets: Log all packets (with timestamps)
- Reconstructed data: Full sensor timeseries (1-10 kHz)
- Storage: 100 GB SSD (ample for multiple flights)

**Post-Flight Analysis**:
- Merge ground station logs (redundancy, fill gaps)
- Correlate with onboard logs (if vehicle recovered)
- Export to CSV/HDF5 (analysis tools: MATLAB, Python)

### Cost Impact

**Development Costs**:
- Protocol design and specification: $20K (2 weeks)
- Flight software implementation: $40K (4 weeks)
- Ground station software: $40K (4 weeks)
- Testing and validation: $20K (2 weeks)
- **Total software development**: $120K

**Hardware Costs**:
- Onboard transmitter + encryption: $5K
- Ground receivers (3 stations): $15K ($5K each)
- Antennas + rotators (3 stations): $30K ($10K each)
- Ground computers (3 stations): $15K ($5K each)
- **Total hardware**: $65K

**Total Telemetry System**: $185K (1.3% of $14M budget)

### Performance Estimates

**Data Throughput**:
- Critical data: 50 channels @ 10 Hz = 500 samples/s = 2 KB/s
- Important data: 50 channels @ 2 Hz = 100 samples/s = 400 B/s
- Diagnostic data: 50 channels @ 1 Hz = 50 samples/s = 200 B/s
- **Total**: 2.6 KB/s = 21 Kbps (well within 1 Mbps link)

**Reliability**:
- Packet delivery: >99% (FEC + 3 ground stations)
- Data completeness: >99.9% (critical data [[Redundant]])
- Latency: <10ms (real-time monitoring)

### [[Risk Assessment]]

[[Technical Risks]]:
- ⚠️ Medium - Custom protocol (software bugs possible)
- ✅ Low - FEC proven (Reed-Solomon standard in space)
- ✅ Low - Encryption overhead minimal (<5% data rate)

[[Safety Risks]]:
- ⚠️ Medium - Telemetry loss during critical [[Phase]] (abort decision delayed)
- Mitigation: Onboard [[Autonomous]] abort (doesn't rely on ground [[Command]])
- ✅ Low - [[Multiple]] ground stations (redundancy)

[[Operational Risks]]:
- ✅ Low - 900 MHz ISM band (unlicensed, no frequency coordination)
- ⚠️ Medium - Interference from other transmitters (ISM band crowded)
- Mitigation: Frequency hopping, spread spectrum

## [[Stakeholder Approval]]

**[[Decision Makers]]**:
- [[Elena Rodriguez]] ([[Avionics Lead]]) - **Approved**
- [[Sarah Chen]] ([[Chief Engineer]]) - **Approved**

**Consulted**:
- [[Marcus Johnson]] ([[Propulsion Lead]]) - Supports (adequate data for [[Engine]] monitoring)
- External RF consultant - Recommends frequency hopping for interference rejection
- [[Team Roster]] - [[Avionics Team]] consensus

**Decision [[Date]]**: 2025-10-20
**Review [[Date]]**: Post-[[First]] flight (validate telemetry performance)

## [[Related Decisions]]

- [[ADR-002 Flight Computer]] - Telemetry [[Generated]] by [[Flight Computer]]
- [[ADR-004 Test Campaign]] - Telemetry [[Validated]] in [[Hardware]]-in-loop [[Testing]]
- Future ADR: Ground station network (locations, [[Coverage]])

## [[References]]

- [[Consultative Committee]] for [[Space Data Systems]] (CCSDS) [[Telemetry Standards]]
- Reed-[[Solomon Error Correction]] (NASA [[Deep Space Network]])
- SpaceX [[Falcon 9]] Telemetry (900 MHz ISM band heritage)
- [[Amateur Radio Telemetry Standards]] (APRS, for [[Reference]])

[[Related Notes]]:
- [[Flight Computer]] - Telemetry generation
- [[Avionics System]] - System-level [[Architecture]]
- [[GNC System]] - Telemetry consumers (IMU, GPS data)
- [[Propulsion System]] - Telemetry [[Sources]] (chamber pressure, flow rates)
- [[Engine Controller]] - Telemetry from [[Engine Controller]]
- [[Test Campaign Overview]] - Telemetry [[Validation]] in HIL testing
- [[Project Roadmap]] - Impact on schedule
- [[Risk Register]] - Telemetry-[[Related]] risks
- [[Budget Tracker]] - [[Cost Impact]]

---

*Decision recorded by [[Elena Rodriguez]] - 2025-10-20*
*[[Status]]: Accepted and [[Implemented]]*
