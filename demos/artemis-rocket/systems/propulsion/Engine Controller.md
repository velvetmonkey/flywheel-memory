---
type: component
subsystem: propulsion
status: integration
owner: "[[Marcus Johnson]]"
created: 2025-08-20
updated: 2026-01-02
tags:
  - propulsion
  - controller
  - avionics
  - software
---
# [[Engine Controller]]

## [[Overview]]

The [[Artemis Engine]] Controller is the dedicated embedded computer that manages [[All]] [[Propulsion System]] operations. It executes the [[Ignition Sequence]], [[Controls]] propellant valves, monitors [[Engine]] health, and provides [[Thrust Vector Control]] commands, operating autonomously with oversight from the [[Flight Computer]].

**[[Component Owner]]**: [[Elena Rodriguez]] ([[Avionics System]] [[Lead]])
**[[Report To]]**: [[Marcus Johnson]] ([[Propulsion System]] Lead)
**[[Status]]**: 🟡 [[Integration]] - [[Hardware]] [[Validated]], [[Software]] [[Testing]] [[In Progress]]

## Specifications

| Parameter | Value | Units | Status |
|-----------|-------|-------|--------|
| **Processor** | [[ARM Cortex]]-M7 | - | ✅ 400 MHz clock |
| **Memory (RAM)** | 1 | MB | ✅ Adequate for control loops |
| **Memory (Flash)** | 8 | MB | ✅ Firmware + flight [[Data]] logs |
| **[[Control Loop Rate]]** | 1000 | Hz | ✅ 1ms update cycle |
| **I/O Channels** | 32 | - | ✅ Sensors + actuators |
| **[[Communication]]** | [[CAN Bus]] | - | ✅ Interface to [[Flight Computer]] |
| **Power** | 5 | W | ✅ Nominal operation |
| **[[Operating Temp]]** | -40 to +85 | °C | ✅ Industrial rated |
| **Mass** | 0.4 | kg | ✅ Compact packaging |
| **Redundancy** | Watchdog + failsafe | - | ✅ [[Autonomous]] abort logic |

## [[Design Architecture]]

### [[Hardware Platform]]

**Processor**: ARM Cortex-M7 microcontroller (STM32H7 series)
- 400 MHz clock ([[High]]-speed control loops)
- Floating-point unit (FPU) for real-time calculations
- Dual-[[Core]] capable (control + [[Monitoring]] separate cores)

**Memory**:
- 1 [[MB RAM]] (control variables, [[Telemetry]] buffers)
- 8 [[MB Flash]] (firmware, flight data [[Logging]])
- EEPROM for persistent configuration

**I/O Interfaces**:
- 16× Analog inputs (sensor readings: pressure, temperature, flow)
- 8× Digital outputs (valve commands, igniter control)
- 4× PWM outputs ([[Thrust Vector Control]] actuators)
- 4× Digital inputs (limit switches, fault signals)

**Communication**:
- CAN bus to [[Flight Computer]] (commands + telemetry)
- UART debug port ([[Ground]] testing and diagnostics)
- SPI interface for sensor daisy-chain

**Power**:
- 12V input from [[Avionics System]] power bus
- Internal 5V/3.3V regulators for microcontroller
- Power monitoring and brownout protection

### [[Software Architecture]]

**Real-[[Time Operating System]]**: FreeRTOS (open-source RTOS)
- Task scheduling (control loops, monitoring, communication)
- Deterministic timing (1ms [[Control Loop]] guaranteed)

**[[Control Software Components]]**:

1. **[[Ignition Sequencer]]** (implements [[Ignition Sequence]])
   - State [[Machine]]: IDLE → PRESSURIZE → SPIN-UP → IGNITION → [[Run]] → SHUTDOWN
   - Timing control: T-5s through T+2s sequencing
   - Abort logic on sequence failures

2. **[[Valve Controller]]**
   - [[Main Fuel Valve]] (MFV) control
   - [[Main Oxidizer Valve]] (MOV) control
   - [[Gas Generator Valves]]
   - [[Purge System]] valves

3. **[[TVC Controller]]** (interfaces with [[Thrust Vector Control]])
   - Receives gimbal angle commands from [[Flight Computer]]
   - Drives actuators [[Via]] PWM signals
   - Closed-loop control with encoder feedback
   - Fault [[Detection]] (jam, mismatch)

4. **[[Health Monitoring]]**
   - Sensor data acquisition (pressure, temperature, flow)
   - Limit [[Checking]] (abort on out-of-range values)
   - Fault detection and isolation
   - Watchdog timer (resets on software hang)

5. **Telemetry & Logging**
   - Real-time telemetry to [[Flight Computer]] (100 Hz)
   - Flight data logging to Flash (1 kHz, all sensors)
   - Post-flight data retrieval for analysis

### [[Control Modes]]

**[[Mode 1]]: IDLE**
- All valves closed
- Engine [[Safe]], no propellant flow
- Monitoring sensors, [[Ready]] for ignition [[Command]]

**[[Mode 2]]: [[Ignition Sequence]]**
- Executes [[Ignition Sequence]] state machine
- T-5s: [[Pressurization Start]]
- T-3s: [[Turbopump]] spin-up
- T-2s: [[Fuel Flow Start]] (cooling)
- T-1s: LOX [[Flow Start]]
- T+0s: Ignition
- T+2s: Transition to RUN [[Mode]]

**[[Mode 3]]: RUN**
- Engine at [[Full Thrust]], combustion [[Stable]]
- TVC [[Active]] ([[Following]] [[GNC System]] commands)
- Health monitoring active (abort on faults)
- Telemetry streaming to [[Flight Computer]]

**[[Mode 4]]: [[Shutdown Sequence]]**
- Executes shutdown sequence
- T+0s: Throttle to idle
- T+1s: Cut [[LOX Flow]]
- T+2s: Cut fuel flow
- T+5s: Purge activation
- Returns to IDLE mode

**[[Mode 5]]: ABORT**
- Emergency shutdown triggered by fault
- Immediate valve closure (all propellant valves)
- Purge activation
- Fault code logged for post-flight analysis

## Integration

### With [[Propulsion System]]

**[[Controlled Components]]**:
- [[Turbopump]] [[Gas Generator]] valves
- Main fuel valve (MFV) on [[Fuel Tanks]] feedline
- Main oxidizer valve (MOV) on [[Oxidizer System]] feedline
- [[Thrust Vector Control]] actuators (pitch + yaw)
- Purge [[System]] valves (GN2 post-shutdown)
- Pyrotechnic igniter ([[Startup]])

**[[Monitored Sensors]]**:
- [[Chamber Pressure]] (combustion monitoring)
- [[Turbopump]] speed (RPM sensor)
- Fuel [[Flow Rate]] ([[Fuel Tanks]] outlet)
- Oxidizer flow [[Rate]] ([[Oxidizer System]] outlet)
- [[Cooling System]] wall temperatures (12× thermocouples)
- Tank pressures (fuel + oxidizer)
- TVC gimbal angles (encoder feedback)

### With [[Avionics System]]

**[[Command Interface]]** (from [[Flight Computer]]):
- Ignition command (start engine)
- Shutdown command (stop engine)
- Throttle command (thrust level 50-100%)
- TVC gimbal angle command (pitch + yaw)
- Abort command (emergency shutdown)

**[[Telemetry Output]]** (to [[Flight Computer]]):
- Engine state (IDLE, IGNITION, RUN, SHUTDOWN, ABORT)
- Chamber pressure, thrust estimate
- [[Turbopump]] speed, propellant flow rates
- Valve positions, TVC gimbal angles
- Fault status, health monitoring flags
- [[Update Rate]]: 100 Hz (decimated from 1 kHz internal)

**[[Data Interface]]**:
- CAN bus (1 Mbps, standard automotive [[Protocol]])
- [[Redundant]] power [[Supply]] (primary + backup)
- Isolated ground (noise immunity)

### With [[GNC System]]

**[[TVC Authority]]**:
- [[GNC System]] computes desired thrust vector angle
- [[Flight Computer]] sends TVC commands to Engine Controller
- Engine Controller drives TVC actuators
- Closed-loop control maintains commanded angle

**[[Throttle Control]]**:
- [[GNC System]] computes desired thrust level (landing [[Phase]])
- [[Flight Computer]] sends throttle command (50-100%)
- Engine Controller adjusts propellant flow rates
- Thrust scales linearly with throttle

**[[Feedback Loop]]**:
- Engine Controller reports actual thrust and TVC angle
- [[GNC System]] uses feedback for trajectory control
- 100 Hz update rate adequate for flight dynamics

## [[Testing Status]]

### [[Hardware Validation]]

**[[Bench Testing]]** ([[Oct 2025]]):
- ✅ Processor functional [[Test]] (all I/O channels verified)
- ✅ CAN bus communication test (with [[Flight Computer]] simulator)
- ✅ Sensor input test (analog + digital channels)
- ✅ Valve output test (commanding test valves)
- ✅ PWM output test (TVC actuator simulation)

**[[Environmental Testing]]** ([[Nov 2025]]):
- ✅ Thermal cycle test (-40°C to +85°C)
- ✅ Vibration test ([[Launch]] loads qualification)
- ✅ EMI/EMC test ([[Electromagnetic Compatibility]])

### [[Software Validation]]

**[[Unit Testing]]** (Aug-Oct 2025):
- ✅ Ignition sequencer state machine (all transitions tested)
- ✅ Valve controller logic (open/close commands)
- ✅ TVC controller PID tuning (bench test with actuators)
- ✅ Health monitoring limits and abort logic

**[[Integration Testing]]** (Nov-[[Dec 2025]]):
- ✅ Hardware-in-loop (HIL) with [[Propulsion System]] simulator
- ✅ CAN bus interface with [[Flight Computer]]
- 🔄 [[Cold Fire Test]] integration ([[Planned]] [[Mid]]-Jan)
- ⏳ [[Hot Fire Test]] integration (planned late-Jan with [[Test 4]])

**[[Flight Software Certification]]**:
- 🔄 [[Code Review]] and static analysis (in progress)
- ⏳ Software qualification test ([[Planned Jan]] 2026)
- ⏳ [[Flight Readiness]] review (planned [[Feb 2026]])

### [[Current Status]]

**Hardware**: ✅ Qualified (thermal, [[Vibe]], EMI tests passed)
**Firmware**: 🔄 Testing (HIL validated, [[Hot Fire]] pending)
**Integration**: 🔄 In progress (CAN bus interface validated)
**Flight Readiness**: ⏳ Pending software qualification

## [[Requirements Verification]]

### [[Performance Requirements]]
- [[PR]]-019: Control loop rate ≥100 Hz ✅ (1 kHz internal, 100 Hz telemetry)
- PR-020: Ignition sequence timing accuracy ±50ms ✅ (±20ms measured in HIL)
- PR-021: TVC [[Response Time]] (100ms ✅ (50ms measured in bench test)
- PR-022: Fault detection time <50ms ✅ (10ms sensor sampling + abort logic)

### [[Safety Requirements]]
- SAF-021: Watchdog timer reset <500ms ✅ (100ms watchdog [[Implemented]])
- SAF-022: Failsafe to IDLE on [[Power Loss]] ✅ (valves fail-closed)
- SAF-023: Abort on critical fault <100ms ✅ (immediate shutdown logic)
- SAF-024: Redundant abort paths ✅ (autonomous + [[Flight Computer]] commanded)

## [[Design Heritage]]

**[[Similar Controllers]]**:
- [[Falcon 9]] Merlin engine controller (distributed [[Architecture]])
- RS-25 engine controller (dual-redundant FADEC)
- Electron engine controller (single-[[Board]] [[Design]])

**[[Technology Reuse]]**:
- ARM Cortex-M microcontrollers standard in aerospace
- FreeRTOS widely used in embedded [[Systems]]
- CAN bus automotive-[[Grade]] communication protocol

## Risks

### [[Active Risks]]

**R-015: [[Software Qualification Timeline]]** (Score: 9, MEDIUM)
- Concern: Software certification may delay flight readiness
- Impact: Flight schedule slip if [[Not]] [[Certified]] by Feb 2026
- Mitigation: Parallel code review + static analysis, early testing
- Status: [[On Track]], code review 80% [[Complete]]

### [[Retired Risks]]

**R-016: [[Engine Controller Hardware Delivery]]** ([[Retired Nov]] 2025)
- Concern: [[Custom]] hardware design, [[First]] article delays possible
- Mitigation: Early design freeze, backup COTS option [[Identified]]
- [[Outcome]]: Hardware delivered on schedule, all tests passed
- Status: Retired [[After]] [[Environmental Qualification]]

## [[Failure Modes]]

### [[Controller Failure Scenarios]]

**[[Processor Hang]]**:
- Detection: Watchdog timer expires (no reset within 500ms)
- Response: Automatic controller reset, returns to IDLE
- Recovery: [[Flight Computer]] detects reset, re-issues commands
- Likelihood: LOW (robust firmware, watchdog protection)

**Power Loss**:
- Detection: Brownout [[Detector]] triggers on low voltage
- Response: Valves fail-closed (spring-loaded to closed position)
- Recovery: Power restored → Controller resets to IDLE
- Likelihood: LOW (redundant power supply)

**CAN [[Bus Failure]]**:
- Detection: No messages received from [[Flight Computer]] for )200ms
- Response: Engine holds [[Current]] state, aborts if in critical phase
- Recovery: [[Flight Computer]] re-establishes communication
- Likelihood: LOW (robust CAN bus, EMI hardening)

**[[Sensor Failure]]**:
- Detection: Out-of-range [[Reading]] or signal loss
- Response: Abort if critical sensor (chamber pressure, [[Turbopump]] speed)
- Response: Continue if non-critical sensor ([[Use]] [[Last]] [[Good]] value)
- Likelihood: MEDIUM (redundant sensors for critical measurements)

## [[Documentation]]

**[[Design Documentation]]**:
- [[Engine Controller Design Specification]] ([[This]] document)
- Hardware schematic and PCB layout
- Firmware architecture and state machines
- Control loop design (PID tuning, stability analysis)

**[[Software Documentation]]**:
- Firmware source code (C/C++, ~15K lines)
- Software [[Requirements]] specification
- Unit test reports and code [[Coverage]] analysis
- [[Coding]] [[Standards]] and static analysis reports

**[[Test Documentation]]**:
- Bench test reports (I/O [[Validation]])
- Environmental test reports (thermal, vibe, EMI)
- HIL test reports (integration with simulator)
- Software qualification test plan

**[[Related]]**:
- [[Propulsion System]] - Controlled subsystem
- [[Engine Design]] - [[Monitored]] component
- [[Turbopump]] - Speed monitoring and control
- [[Thrust Vector Control]] - Actuator control
- [[Ignition Sequence]] - Primary software function
- [[Flight Computer]] - Command interface
- [[Avionics System]] - Power supply and communication
- [[GNC System]] - TVC and throttle authority

**[[Project Management]]**:
- [[Project Roadmap]] - Software qualification schedule
- [[Risk Register]] - R-015 (software qualification)
- [[Team Roster]] - [[Avionics Team]] (software developers)

---

*[[Last Updated]]: 2026-01-02 by [[Elena Rodriguez]]*
*[[Next]] review: Post-software qualification ([[Jan 2026]]), pre-flight final validation*
