---
type: component
subsystem: avionics
status: testing
owner: "[[Elena Rodriguez]]"
created: 2025-09-10
updated: 2026-01-02
---
# [[Flight Computer]]

## [[Overview]]

The Artemis flight computer is the [[Central]] [[Processing]] unit for the [[Launch]] vehicle, responsible for [[Guidance]], [[Navigation]], [[Control]] (GNC), and vehicle [[Health Monitoring]]. The [[Design]] uses a triple-[[Redundant]] [[Architecture]] with [[Majority Voting]] to achieve [[High]] [[Reliability]] and [[Fault Tolerance]].

**[[Key Features]]**:
- Triple-redundant processors (3× independent computers)
- [[Majority voting]] for fault masking
- Real-[[Time Operating System]] (PREEMPT_RT [[Linux]])
- [[CAN Bus]] interconnects for inter-processor [[Communication]]
- Deterministic latency ((5ms) for [[Control Loop]] [[Execution]]

**Heritage**: Architecture inspired by SpaceX Dragon and [[NASA Orion]] [[Flight Computers]]

## Architecture

### [[Hardware Platform]]

**[[Processor Module]]**: [[Raspberry Pi Compute Module 4]]
- **CPU**: [[ARM Cortex]]-A72 quad-[[Core]] @ 1.5 GHz
- **RAM**: 4 GB LPDDR4
- **Storage**: 32 GB eMMC
- **[[Operating System]]**: [[Linux 5.15]] (PREEMPT_RT real-time kernel)
- **[[Compute Power]]**: ~6400 DMIPS per module

**Why [[Raspberry Pi Compute Module]]**:
- Commercial off-the-shelf (COTS) - cost-effective and readily [[Available]]
- Proven reliability in industrial [[Applications]]
- ARM architecture = low [[Power Consumption]] (~3W per module)
- GPIO and industrial interfaces (CAN, SPI, I2C)
- [[Active]] [[Thermal Management]] [[Via]] carrier [[Board]] heat spreader

### [[Triple redundancy]] Design

The flight computer consists of **3 independent, identical processing modules** arranged in a 2-of-3 majority [[Voting]] configuration:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Computer A  │────▶│              │◀────│  Computer C  │
│  (Primary)   │     │  CAN Bus     │     │  (Tertiary)  │
└──────────────┘     │  Network     │     └──────────────┘
                     │              │
                     └──────▲───────┘
                            │
                     ┌──────┴───────┐
                     │  Computer B  │
                     │  (Secondary) │
                     └──────────────┘
```

**Voting Protocol**:
1. Each computer executes identical flight software
2. All three computers receive identical sensor inputs (via [[Sensor Suite]])
3. Each computer independently computes control commands
4. Computers exchange outputs via CAN bus (1000 Hz)
5. Each computer performs majority voting on all three outputs
6. Winning command is sent to actuators ([[Thrust Vector Control]], [[Engine Controller]])

**Fault Tolerance**:
- **Single fault tolerance**: System continues operation with 1 failed computer
- **Detection time**: <10ms (detected within one voting cycle)
- **Failover time**: <50ms (automatic, no manual intervention)
- **Failure modes covered**: Processor crash, hung process, corrupted output, timing violation

### Power Supply

**Primary Power**: 28V DC from [[Power Distribution]] system
- Input: 28V ± 4V (24-32V operational range)
- Power consumption: 3W per computer × 3 = 9W total
- Surge protection: TVS diodes on input
- Reverse polarity protection: MOSFET-based circuit

**Power Sequencing**:
- T-30s: Power applied to all three computers
- T-25s: Boot sequence complete, health checks passed
- T-20s: Enter pre-flight mode (sensor calibration)
- T-10s: Enter flight-ready mode
- T-0: Transition to active flight control

**Backup Power**: Each computer has a small supercapacitor (5F, 5V) providing 500ms of hold-up time in case of transient power loss

### Interconnects

**CAN Bus Network** (dual redundant):
- **Primary CAN bus**: 1 Mbps, connects all three computers
- **Secondary CAN bus**: 1 Mbps, backup path
- **Topology**: Dual-bus, daisy-chain with 120Ω terminators
- **Protocol**: CAN 2.0B (29-bit extended IDs)
- **Message priority**: Voting messages highest priority (ID 0x00-0x0F)

**External Interfaces**:
- [[Sensor Suite]]: SPI (IMU, pressure sensors), I2C (temperature, voltage monitors)
- [[Engine Controller]]: CAN bus (throttle commands, TVC commands)
- [[Communications]]: UART (telemetry uplink/downlink)
- [[Telemetry]]: Ethernet (ground testing), CAN bus (flight)
- Debug port: USB-C (ground access only, disabled in flight)

## Flight Software

### Operating System

**PREEMPT_RT Linux 5.15**:
- Real-time kernel with deterministic scheduling
- Guaranteed maximum latency: <100μs (typically <50μs)
- Priority-based preemptive multitasking
- Memory locked to prevent page faults during flight

**Why Linux over RTOS**:
- Rich ecosystem (drivers, libraries, debugging tools)
- Easier development and testing
- PREEMPT_RT patch provides hard real-time guarantees
- Cost: $0 (open source) vs. $50K+ for certified RTOS
- Trade-off: Heavier weight (~200MB RAM) but sufficient for our needs

### Software Architecture

The flight software is organized into separate processes communicating via shared memory and message queues:

**Core Processes** (1000 Hz execution):
1. **Sensor Fusion** - Reads IMU, GPS, pressure sensors; estimates vehicle state
2. **Guidance** - Computes desired trajectory based on flight plan
3. **Navigation** - Estimates position, velocity, attitude from sensors
4. **Control** - Computes actuator commands (TVC, throttle) to track trajectory
5. **Voting Manager** - Exchanges outputs with other computers, performs voting

**Support Processes** (lower frequency):
- **Telemetry Handler** (10 Hz) - Formats and transmits data to [[Communications]]
- **Health Monitor** (10 Hz) - Checks CPU temp, memory usage, disk space
- **Command Handler** (10 Hz) - Processes ground commands
- **Fault Manager** (100 Hz) - Detects and responds to anomalies

### Software Qualification

**Testing Approach**: Hardware-in-Loop (HIL) simulation
- Simulated sensors inject flight profile data
- Three flight computers execute in real-time
- Outputs validated against reference simulation
- See [[Avionics Integration Test]] for results

**Test Coverage**:
- 100 simulated flight profiles (nominal + off-nominal)
- 47 fault injection scenarios (sensor failures, computer failures)
- 96% success rate (45/47 scenarios passed, 2 failures due to bugs - now fixed)

**Bugs Found and Fixed**:
1. **GPS dropout handling** - Flight software didn't gracefully degrade to IMU-only navigation (FIXED: added dead reckoning mode)
2. **Voting tie condition** - If two computers disagreed, third computer crashed (FIXED: tie-breaker logic based on sensor health)

### Software Configuration Management

**Version Control**: Git repository on internal server
- Repo: `artemis-flight-[[Software]]`
- Branch strategy: `main` (stable), `develop` ([[Integration]]), [[Feature]] branches
- Tagging: v1.0.0 (PDR), v2.0.0 (CDR [[Target]]), v3.0.0 (flight-[[Ready]])

**[[Build Process]]**:
- Cross-compilation on x86_64 Linux workstation
- Target: ARM 64-bit (aarch64-linux-gnu)
- Build [[System]]: CMake + Make
- Dependencies: [[PREEMPT_RT kernel]] headers, CAN utilities, Eigen (linear algebra)

**[[Flight Software Versions]]**:
| Version | [[Date]] | [[Status]] | [[Notes]] |
|---------|------|--------|-------|
| v1.0.0 | 2025-09-15 | Released | PDR baseline |
| v1.5.0 | 2025-11-20 | Released | [[GPS Dropout]] fix, voting tie fix |
| v2.0.0-rc1 | 2025-12-15 | [[Testing]] | CDR candidate [[Release]] |

## Integration

### Mounting

**[[Location]]**: Electronics bay (middle section of vehicle, below payload)

**Mechanical**:
- Carrier board: [[Custom]] PCB (160mm × 100mm) with [[Three]] CM4 sockets
- Enclosure: Aluminum box with thermal interface to vehicle structure
- Mounting: 4× M4 bolts to vehicle frame with vibration isolators
- Mass: 450g (three CM4 modules + carrier board + enclosure)

**Thermal [[Management]]**:
- Heat spreading via aluminum carrier board
- Thermal interface pad to vehicle structure (acts as heat sink)
- Passive cooling (no fans) - vehicle structure dissipates heat
- Operating temperature: -20°C to +60°C (tested in [[Thermal Vacuum]] chamber)

### [[Vibration Environment]]

**[[Qualification Testing]]**:
- [[Random]] vibration: 14.1 Grms (20-2000 Hz, [[All]] three axes)
- Sine vibration: 10g peak (5-100 Hz sweep)
- Shock: 40g half-sine (6ms duration)

**[[Results]]** (from [[Avionics Integration Test]]):
- ✅ No resonances in critical [[Frequency]] bands
- ✅ All solder joints intact [[After]] vibration
- ✅ eMMC storage verified (no bit errors)
- ✅ Computers continued operation during vibration (functional [[Test]])

### [[Electromagnetic Compatibility]] (EMC)

**Shielding**:
- Aluminum enclosure provides Faraday cage
- CAN bus cables: Twisted-pair with shield
- [[Power Supply]]: Pi filter on input (attenuates high-frequency noise)

**Testing**:
- Conducted emissions: <1V/m @ 1m distance (meets MIL-STD-461)
- Radiated emissions: <30 dBμV/m @ 3m (meets commercial [[Standards]])
- Susceptibility: No upsets up to 200 V/m field strength

## Testing

### [[Unit Testing]] (Benchtop)

**[[Test Setup]]**:
- Three CM4 modules on carrier board
- Bench power [[Supply]] (28V)
- Oscilloscope [[Monitoring]] CAN bus
- Serial console for debug output

**[[Tests Performed]]**:
1. **Boot time**: <5 seconds from power-on to flight-ready
2. **Voting latency**: <3ms (measured via CAN bus analyzer)
3. **CPU temperature**: 45°C @ 25°C ambient, passive cooling
4. **[[Memory Usage]]**: 220MB / 4GB (5.5% utilization)
5. **[[Power consumption]]**: 9.2W (3.1W per computer)

### [[Hardware-in-Loop]] (HIL) Testing

**[[Purpose]]**: Validate [[Flight Software]] in closed-loop with simulated sensors

**Setup**:
- Three flight computers (flight-equivalent [[Hardware]])
- Sensor simulator: [[PC]] running [[Simulink Real]]-Time
- Simulated [[IMU]], [[GPS]], [[Pressure Sensors]] [[Injected]] via SPI/I2C
- Actuator commands logged and [[Validated]]

**Results**: [[See]] [[Avionics Integration Test]] for [[Detailed Results]]
- 100 simulated flights [[Executed]]
- 96% [[Success Rate]] (2 failures due to software bugs, [[Now]] fixed)
- Control loop latency: <5ms (meets requirement)

### [[Environmental Testing]]

**Thermal Vacuum**:
- Chamber: -40°C to +70°C
- Vacuum: <1×10⁻⁵ Torr
- Duration: 8 [[Hours]] (4 thermal cycles)
- [[Result]]: ✅ Passed - No degradation, continued operation

**Vibration** (see Vibration Environment section above):
- Result: ✅ Passed - [[Survived 14.1]] Grms qualification level

## [[Lessons Learned]]

### [[What Worked Well]]

1. **COTS [[Approach Successful]]**
   - [[Raspberry Pi]] CM4 exceeded [[Performance]] [[Expectations]]
   - Cost: $35 per module (vs. $5000+ for aerospace-[[Grade]] computer)
   - Availability: [[Obtained 10]] units within 2 [[Weeks]] (no long [[Lead]] time)

2. **[[Triple Redundancy Simple]] to [[Implement]]**
   - [[Voting logic]]: <500 lines of C code
   - CAN bus well-suited for inter-computer communication
   - [[Fault Injection Testing]] caught edge cases early

3. **[[Linux Ecosystem Accelerated Development]]**
   - Sensor drivers readily available (I2C, SPI)
   - [[Debugging]] [[Tools]] (gdb, valgrind) familiar to [[Team]]
   - Development time: 6 months (vs. estimated 12 months for RTOS)

### [[Challenges Encountered]]

1. **Real-[[Time Kernel Tuning]]**
   - Initial latency spikes )1ms due to kernel background tasks
   - Solution: [[Disabled]] unnecessary [[Services]], isolated CPU cores, tuned scheduler
   - Final latency: <100μs (meets requirement)

2. **CAN [[Bus Timing]]**
   - Voting messages occasionally delayed by lower-[[Priority]] traffic
   - Solution: [[Implemented]] priority-[[Based]] message IDs (voting = highest priority)
   - Result: <3ms voting latency guaranteed

3. **GPS [[Dropout Handling]]**
   - Flight software crashed if GPS signal lost during ascent
   - [[Root Cause]]: No [[Fallback]] navigation [[Mode]]
   - Solution: Implemented dead reckoning [[Using]] IMU integration
   - Validated in [[HIL Testing]] with 20 GPS dropout scenarios

## [[Performance Summary]]

| Metric | Requirement | [[Achieved]] | Status |
|--------|-------------|----------|--------|
| Control loop frequency | 1000 Hz | 1000 Hz | ✅ Met |
| Control loop latency | <10 ms | <5 ms | ✅ Exceeds |
| Voting latency | <10 ms | <3 ms | ✅ Exceeds |
| Single fault tolerance | [[Yes]] | Yes | ✅ Met |
| Power consumption | <15 W | 9.2 W | ✅ Exceeds |
| Boot time | <10 s | 5 s | ✅ Exceeds |
| Operating temperature | -20°C to +60°C | -40°C to +70°C | ✅ Exceeds |
| Vibration survivability | 12 Grms | 14.1 Grms | ✅ Exceeds |

## [[Current Status]]

**[[Design Maturity]]**: 95% (ready for CDR)

**[[Completed]]**:
- ✅ Hardware design and procurement
- ✅ Flight software development (v2.0.0-rc1)
- ✅ HIL testing (96% success [[Rate]])
- ✅ Environmental testing (thermal vacuum, vibration)
- ✅ EMC testing (emissions and susceptibility)

**[[Remaining Work]]**:
- [[Software Qualification]] testing (v2.0.0 final release)
- Flight unit assembly and burn-in (100 hours continuous operation)
- [[Integrated Vehicle Testing]] (post-assembly checkout)

**Risks**:
- **R-014**: Flight software bug escapes to flight - Mitigation: Extensive HIL testing, [[Code Review]], static analysis
- **R-015**: Single event upset (SEU) from cosmic rays - Mitigation: Triple [[Redundancy]] masks SEU, periodic memory scrubbing

## [[Future Enhancements]] (Post-[[First Flight]])

1. **Radiation-[[Hardened Processors]]**: Upgrade to FPGA or rad-hard CPU for orbital missions
2. **[[Redundant Power Supplies]]**: Add battery backup for [[Each]] computer (extends hold-up time to 10 minutes)
3. **[[Vision]]-[[Based Navigation]]**: Add camera for crater-relative landing (lunar missions)
4. **[[Machine Learning]]**: Onboard terrain hazard [[Detection]] for [[Autonomous]] landing [[Site]] selection

## [[Related Notes]]

**[[Avionics Subsystem]]**:
- [[Avionics System]] - Subsystem overview
- [[Sensor Suite]] - IMU, GPS, pressure sensors
- [[Communications]] - [[Telemetry]] uplink/downlink
- [[Power Distribution]] - Power supply and distribution
- [[Telemetry]] - [[Data Logging]] and transmission
- [[Flight Software]] - [[Software Architecture]] details
- [[Redundancy Architecture]] - Detailed redundancy design

**[[GNC Subsystem]]**:
- [[GNC System]] - Guidance, navigation, control overview
- [[IMU Selection]] - Inertial measurement unit selection
- [[Autopilot Software]] - Control laws and algorithms
- [[Landing Algorithm]] - [[Powered descent guidance]]

**Testing**:
- [[Avionics Integration Test]] - HIL testing results
- [[Test Campaign Overview]] - Overall test [[Strategy]]

**[[Project Management]]**:
- [[Project Roadmap]] - Flight computer [[Milestones]]
- [[Risk Register]] - R-014, R-015
- [[Team Roster]] - [[Elena Rodriguez]] ([[Avionics Lead]])

**[[Decisions]]**:
- [[ADR-002 Flight Computer]] - Triple [[Redundancy Architecture]] decision
- [[ADR-005 Telemetry Protocol]] - Telemetry interface design

---

*[[Component Specification]] by [[Elena Rodriguez]] - [[Last Updated]] 2026-01-02*
