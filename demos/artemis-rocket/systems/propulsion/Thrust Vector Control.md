---
type: component
subsystem: propulsion
status: testing
owner: "[[Marcus Johnson]]"
created: 2025-08-10
updated: 2026-01-02
tags:
  - propulsion
  - tvc
  - actuators
  - control
---
# [[Thrust Vector Control]]

## [[Overview]]

The Artemis Thrust [[Vector Control]] (TVC) [[System]] provides pitch and yaw control by gimbaling the main [[Engine]]. [[Two]] [[Electromechanical Actuators]] move the engine ±5°, enabling trajectory control and stabilization without requiring separate [[Attitude Control]] thrusters.

**[[Component Owner]]**: [[Rachel Martinez]] ([[Fluids Engineer]])
**[[Report To]]**: [[Marcus Johnson]] ([[Propulsion System]] [[Lead]])
**[[Status]]**: 🟡 [[Testing]] - Actuators delivered, [[Bench Testing]] [[In Progress]]

## Specifications

| Parameter | Value | Units | Status |
|-----------|-------|-------|--------|
| **[[Gimbal Range]]** | ±5 | degrees | ✅ [[Design]] [[Validated]] |
| **[[Gimbal Rate]] (max)** | 10 | deg/s | ✅ Actuator spec |
| **[[Actuator Type]]** | Electromechanical | - | ✅ Commercial units |
| **[[Actuator Count]]** | 2 | - | ✅ Pitch + yaw |
| **[[Actuator Force]]** | 15 | kN | ✅ Per actuator |
| **[[Control Bandwidth]]** | 5 | Hz | ✅ Adequate for GNC |
| **Power** | 2 | kW | ✅ Peak per actuator |
| **[[Actuator Mass]]** | 6 | kg | ✅ Per actuator (12 kg [[Total]]) |
| **[[Mount Type]]** | 4-point gimbal | - | ✅ Designed |
| **[[Response Time]]** | 100 | ms | ✅ [[Command]] to motion |

## [[Design Architecture]]

### [[Gimbal Mount]]

**Configuration**: 4-point gimbal bearing
- Two orthogonal pivot axes (pitch and yaw)
- Engine mounts to gimbal [[Via]] 4 spherical bearings
- Actuators push/pull gimbal to deflect engine
- Gimbal center aligned with engine center of gravity

**[[Thrust Loads]]**:
- Engine thrust: 44.2 kN nominal (up to 60 kN during throttle transients)
- Thrust transmitted through gimbal bearings to [[Airframe Design]]
- Side loads during gimbaling: Up to 3.9 kN (5° × 44.2 kN)
- Bearings sized for 2× design loads ([[Safety Factor]])

**[[Thermal Protection]]**:
- Gimbal located above nozzle (minimal thermal exposure)
- Actuators thermally isolated from [[Hot]] engine
- Heat shield between engine and actuators

### Electromechanical Actuators

**Type**: Ball screw linear actuators with brushless DC motors
**Supplier**: Commercial aerospace-[[Grade]] units (qualified for spaceflight)
**Specifications**:
- Stroke: ±100mm (achieves ±5° gimbal at 0.6m [[Moment]] arm)
- Force: 15 kN max (sized for side loads + margin)
- Speed: 50 mm/s (10 deg/s gimbal [[Rate]])
- Position feedback: Encoder (0.01° resolution)
- Power: 2 kW peak, 0.5 kW average

**[[Actuator Arrangement]]**:
- **Pitch actuator**: Pushes/pulls engine vertically (up/down)
- **Yaw actuator**: Pushes/pulls engine laterally (left/right)
- Actuators mounted 90° apart for independent axis control
- [[Both]] actuators can operate simultaneously (combined pitch/yaw)

### [[Control System]]

**[[Control Loop]]**:
1. [[GNC System]] [[Autopilot Software]] computes desired thrust vector angle
2. [[Flight Computer]] sends commanded angle to TVC controller (CAN bus)
3. TVC controller drives actuators to achieve commanded angle
4. Encoder feedback confirms position (closed-loop control)
5. Loop rate: 100 Hz (10ms update)

**[[Control Authority]]**:
- ±5° gimbal provides ±7.6% of thrust as side force
- [[Example]]: [[At 44.2]] kN thrust, ±5° = ±3.9 kN side force
- Adequate for [[Ascent Guidance]], trajectory correction, landing

**[[Failure Modes]]**:
- [[Single Actuator Failure]]: Reduced control authority (1-axis [[Only]])
- Both actuator failure: Direct [[Mode]] (no TVC, relies on [[Autopilot Software]] abort)
- Jam [[Detection]]: Encoder mismatch triggers abort

## [[Integration]]

### With [[Engine Design]]

**[[Engine Attachment]]**:
- [[Engine Design]] mounts to gimbal via 4-point spherical bearing interface
- Gimbal allows rotation in pitch and yaw
- Propellant feedlines [[Use]] flexible bellows (accommodate gimbal motion)
- Electrical harnesses routed through gimbal (flex cables)

**[[Thrust Transmission]]**:
- Engine thrust → Gimbal bearings → Airframe thrust structure
- TVC gimbal is primary load path for [[All]] engine thrust
- Gimbal bearings carry thrust + bending moments + side loads

### With [[GNC System]]

**[[Command Interface]]**:
- [[Flight Computer]] sends TVC commands via CAN bus
- Command format: Pitch angle (degrees), Yaw angle (degrees)
- [[Update Rate]]: 100 Hz (synchronous with GNC loop at 1 kHz, decimated)

**Feedback**:
- TVC controller reports actual gimbal angles to [[Flight Computer]]
- Used by [[GNC System]] for trajectory control and stability augmentation
- Encoder resolution: 0.01° (fine position feedback)

**[[Control Modes]]**:
- **[[Active]] mode**: TVC follows GNC commands (normal operation)
- **Direct mode**: TVC holds 0° (engine aligned with airframe) - used during abort or [[TVC Failure]]
- **[[Test]] mode**: TVC accepts [[Ground]] commands for bench testing

### With [[Avionics System]]

**Power**:
- Actuators [[Powered]] from [[Avionics System]] 48V bus
- Peak power: 4 kW (both actuators max), Average: 1 kW
- Dedicated circuit breaker for TVC (fault isolation)

**[[Data Interface]]**:
- CAN bus to [[Flight Computer]] (commands + [[Telemetry]])
- Telemetry: Gimbal angles, actuator currents, fault status
- [[Sample]] rate: 100 Hz

### With [[Structures System]]

**Mounting**:
- Gimbal mounts to [[Airframe Design]] thrust structure via 4 hard points
- Thrust structure sized for 2× max thrust ([[Safety]] factor)
- Vibration isolation between gimbal and airframe (reduces [[High]]-[[Frequency]] loads)

## [[Testing Status]]

### [[Actuator Acceptance Testing]]

**[[Supplier Testing]]** ([[Nov 2025]]):
- ✅ Functional test (stroke, force, speed verified)
- ✅ Thermal vacuum test (-40°C to +80°C operating range)
- ✅ Vibration test ([[Launch]] loads qualification)
- ✅ Life test (10,000 cycles, no degradation)

**[[Delivered Units]]** ([[Dec 2025]]):
- 2× flight actuators delivered on schedule
- 2× spare actuators for testing and qualification

### Bench Testing (In Progress)

**[[Gimbal Assembly Test]]** ([[Dec]] 2025):
- ✅ Gimbal bearings installed, friction measured (within spec)
- ✅ Actuators mounted, stroke verified (±100mm [[Achieved]])
- 🔄 Control loop tuning in progress (targeting 5 Hz bandwidth)

**[[Cold Fire Test]]** ([[Planned Jan]] 2026):
- Static test with non-firing engine (mass simulator)
- Verify actuator force adequate for [[Engine Mass]]
- Test control loop response and stability
- Success [[Criteria]]: ±5° achieved in <200ms

**[[Hot Fire]] [[TVC Test]]** ([[Planned]] [[Jan 2026]]):
- [[First]] test with live engine firing ([[Test 4]] or 5)
- Verify [[TVC Control]] authority during thrust
- Validate [[GNC System]] interface
- Success criteria: Gimbal tracks commanded angle within 0.1°

### [[Current Status]]

**[[Gimbal Assembly]]**: ✅ [[Complete]]
**Actuators**: ✅ Delivered and installed
**[[Control Software]]**: 🔄 Tuning in progress
**Cold Fire Test**: ⏳ Planned [[Mid]]-Jan
**[[Hot Fire Test]]**: ⏳ Planned late-Jan

## [[Requirements Verification]]

### [[Performance Requirements]]
- [[PR]]-013: TVC gimbal range ±5° ✅ (actuator stroke validated)
- PR-014: TVC bandwidth ≥2 Hz 🔄 (targeting 5 Hz, tuning in progress)
- PR-015: TVC response time <200ms ✅ (100ms measured in bench test)

### [[Safety Requirements]]
- SAF-014: TVC failure detection <100ms ✅ (encoder mismatch detection)
- SAF-015: Direct mode on TVC failure ✅ (failsafe to 0° [[Implemented]])
- SAF-016: TVC jam detection and abort ✅ (force feedback [[Monitoring]])

## [[Design Heritage]]

**[[Similar Systems]]**:
- [[Falcon 9]] TVC (electromechanical actuators, similar gimbal range)
- Atlas V TVC (hydraulic actuators, larger scale)
- Electron TVC (electromechanical, battery-powered)

**[[Technology Reuse]]**:
- Electromechanical actuators standard in modern rockets (replace hydraulics)
- 4-point gimbal mount widely used configuration
- Ball screw actuators proven in aerospace (high [[Reliability]])

## Risks

### [[Active Risks]]

**R-013: TVC Control Bandwidth** (Score: 6, LOW-MEDIUM)
- Concern: Control loop tuning may [[Not]] achieve 5 Hz bandwidth
- Impact: Reduced stability margin, potential coupling with structural modes
- Mitigation: Bench testing and tuning, structural damping if needed
- Status: Tuning in progress, preliminary [[Results]] promising

### [[Retired Risks]]

**R-014: [[Actuator Delivery Schedule]]** ([[Retired Dec]] 2025)
- Concern: Long lead time for aerospace-grade actuators
- Mitigation: Early order placement, [[Identified]] backup supplier
- [[Outcome]]: Delivered on schedule in December
- Status: Retired [[After]] successful delivery

## Failure Modes

### TVC [[Failure Scenarios]]

**Single Actuator Failure**:
- Effect: Loss of control in [[One]] axis (pitch or yaw)
- Detection: Encoder position mismatch, actuator [[Current]] anomaly
- Response: Continue with reduced control authority if [[Stable]], abort if unstable
- Likelihood: LOW ([[Redundant]] control in one axis via RCS thrusters if [[Added]])

**[[Both Actuators Fail]]**:
- Effect: No TVC, engine fixed at 0° (direct mode)
- Detection: Loss of control authority in both axes
- Response: Immediate abort, rely on trajectory for [[Safe]] landing
- Likelihood: [[VERY LOW]] (independent actuator failures)

**[[Actuator Jam]]**:
- Effect: Engine stuck at non-[[Zero]] gimbal angle
- Detection: Force feedback [[Shows]] actuator stalled, encoder not moving
- Response: Immediate engine shutdown, abort
- Likelihood: LOW (jam detection within 100ms)

**[[Gimbal Bearing Seizure]]**:
- Effect: Cannot gimbal, similar to both actuators failing
- Detection: High actuator force, no motion
- Response: Direct mode, abort if unstable
- Likelihood: VERY LOW (redundant bearings, well-lubricated)

## [[Documentation]]

**[[Design Documentation]]**:
- TVC [[System Design Specification]] ([[This]] document)
- Gimbal structural analysis (FEA, bearing sizing)
- Actuator selection trade study
- Control system design (loop tuning, stability analysis)

**[[Supplier Documentation]]**:
- Actuator datasheets and qualification reports
- Acceptance test reports (thermal vac, vibration, life)
- Installation and [[Maintenance]] manuals

**[[Test Documentation]]**:
- Bench test plan and procedures
- Cold fire test plan (mass simulator)
- Hot fire TVC test plan (integrated with [[Engine Hot Fire Results]])

**[[Related]]**:
- [[Engine Design]] - Gimbaled component
- [[Propulsion System]] - System-level integration
- [[GNC System]] - Control authority consumer
- [[Autopilot Software]] - TVC command source
- [[Flight Computer]] - CAN bus interface
- [[Avionics System]] - Power [[Supply]]
- [[Airframe Design]] - Thrust structure mounting

**[[Project Management]]**:
- [[Project Roadmap]] - Schedule milestones
- [[Risk Register]] - R-013 (control bandwidth), R-014 (actuator delivery)
- [[Team Roster]] - [[Propulsion Team]]

---

*[[Last Updated]]: 2026-01-02 by [[Rachel Martinez]]*
*[[Next]] review: Post cold-fire test (mid-Jan), post hot-fire TVC test (late-Jan)*
