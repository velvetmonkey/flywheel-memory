---
type: subsystem
status: at-risk
owner: "[[Elena Rodriguez]]"
phase: algorithm-development
created: 2025-07-10
updated: 2026-01-02
tags:
  - gnc
  - guidance
  - navigation
  - control
  - software
---
# [[GNC System]]

## [[Overview]]

The Artemis Guidance, Navigation, and Control (GNC) [[System]] provides [[Autonomous]] flight control from liftoff through landing. The system integrates with [[Avionics System]] [[Hardware]] to execute guidance algorithms, process sensor [[Data]], and [[Command]] vehicle actuation.

**[[System Lead]]**: [[Elena Rodriguez]] (shared with [[Avionics System]])
**[[Team Size]]**: 3 ([[GNC Specialists]] within [[Avionics Team]])
**[[Status]]**: 🟡 [[At Risk]] - Algorithm [[Validation]] [[Timeline]] tight

## [[Key Specifications]]

| Parameter | Specification | Status |
|-----------|---------------|--------|
| [[Navigation Accuracy]] | ±10 meters (landing) | ✅ [[Design]] [[Validated]] in sim |
| [[Control Loop Rate]] | 1 kHz | ✅ Validated in HIL |
| [[Attitude Control]] | ±0.5° (ascent), ±2° (landing) | ✅ Sim validated |
| [[Guidance Algorithm]] | Optimal ascent, [[Powered]] descent | 🔄 Development in progress |
| [[Sensor Fusion]] | IMU + GPS + altimeters | ✅ Kalman filter [[Implemented]] |
| [[Autonomy Level]] | Fully autonomous (no [[Ground]] loop) | ✅ Design requirement |

## [[System Architecture]]

```
┌──────────────────────────────────────────┐
│             GNC System                    │
├──────────────────────────────────────────┤
│                                           │
│  Sensors ([[Sensor Suite]]):            │
│    - IMU (state estimation)              │
│    - GPS (position/velocity)             │
│    - Altimeters (altitude)               │
│       ↓                                   │
│  Navigation (State Estimation):          │
│    - Extended Kalman Filter              │
│    - Sensor fusion                       │
│       ↓                                   │
│  Guidance (Trajectory Generation):       │
│    - [[Autopilot Software]] (ascent)    │
│    - [[Landing Algorithm]] (descent)    │
│       ↓                                   │
│  Control (Actuation):                    │
│    - [[Thrust Vector Control]] (TVC)    │
│    - Engine throttle                     │
│                                           │
└──────────────────────────────────────────┘
```

## [[Major Components]]

### Navigation ([[State Estimation]])
- [[IMU Selection]] - Inertial measurement (3x [[Redundant]])
- [[GPS Receivers]] (2x) - Position and [[Velocity]]
- Barometric altimeters (3x) - Altitude during ascent
- [[Radar Altimeter]] (1x) - Precision altitude during landing
- [[Extended Kalman Filter]] - Sensor fusion and state estimation

### Guidance ([[Trajectory Planning]])
- [[Autopilot Software]] - [[Ascent Guidance]] (gravity turn)
- [[Landing Algorithm]] - Powered descent guidance (propulsive landing)
- [[Trajectory Optimization]] - Optimal trajectory generation (descoped from v1.0)

### Control (Actuation)
- [[Thrust Vector Control]] - Gimbal control (pitch, yaw)
- [[Engine]] throttle control - Thrust magnitude
- PID controllers - Attitude control loops
- Control allocation - [[Multi]]-axis coordination

## [[Current Status]]

### [[Algorithm Development Phase]]

**[[Phase Goal]]**: [[Complete]] and validate GNC algorithms for CDR demonstration

**Progress**:
- ✅ Navigation (EKF) - Implemented and validated in sim
- ✅ Ascent guidance - Gravity turn algorithm complete
- 🔄 [[Autopilot Software]] - [[Core]] algorithms 75% complete
- 🔄 [[Landing Algorithm]] - Powered descent 60% complete (schedule [[Risk]])
- ⏳ [[Trajectory Optimization]] - Descoped from v1.0
- ⏳ Hardware-in-loop (HIL) [[Testing]] - [[Starts Feb]] 1

### [[Algorithm Status]]

**Navigation (State Estimation)**:
- ✅ Extended Kalman Filter (EKF) implementation complete
- ✅ IMU [[Integration]] (9-axis: accel, gyro, mag)
- ✅ GPS integration (position, velocity)
- ✅ Altimeter integration (barometric, radar)
- ✅ Simulation validation ([[Monte Carlo]] analysis)
- 🔄 Hardware-in-loop testing (starts [[Feb 1]])

**Ascent Guidance**:
- ✅ Gravity turn algorithm implemented
- ✅ Closed-loop guidance (PEG - [[Powered Explicit Guidance]])
- ✅ [[Target]] orbit insertion (500 km circular)
- ✅ [[Trajectory Optimization]] (offline, pre-computed)
- 🔄 Wind [[Compensation]] logic
- 🔄 Abort [[Mode]] guidance

**[[Landing Guidance]]** ([[Challenge Area]]):
- ✅ Powered descent initiation (PDI) logic
- 🔄 Convex [[Optimization]] for fuel-optimal trajectory (70% complete)
- 🔄 Obstacle avoidance logic (60% complete)
- 🔄 [[Terminal]] descent guidance (final 100m) (50% complete)
- ⏳ Hardware-in-loop validation (Feb-March)

### [[Active Issues]]

**[[Medium Priority]]:**
1. **[[Landing Algorithm]] Schedule** ([[See]] [[Risk Register]] R-007)
   - Algorithm complexity underestimated
   - Convex optimization solver integration challenging
   - [[Contractor Support]] secured (2 developers start [[Jan 6]])
   - Validation timeline tight for CDR ([[March 10]])

2. **[[Trajectory Optimization]] Complexity**
   - [[Full]] trajectory optimization descoped from v1.0
   - Pre-computed nominal trajectories will be used
   - Closed-loop guidance provides robustness
   - Can be [[Added]] post-[[First]]-flight

3. **[[Sensor Latency Management]]**
   - GPS [[Update Rate]]: 10 Hz (vs 1 kHz control loop)
   - Extrapolation algorithms needed
   - Validated in simulation, needs HIL confirmation

**[[LOW Priority]]:**
4. IMU calibration procedures
5. Magnetometer interference from vehicle structure

## [[Design Decisions]]

### [[Autonomous Flight Requirement]]
**Decision**: Fully autonomous GNC (no ground-in-the-loop)
**Rationale**:
- [[Launch]] vehicle [[Must]] operate independently of ground stations
- [[Communications]] latency (up to 2s) unacceptable for control
- Abort scenarios require immediate autonomous response
- Reduces ground operations complexity

**Approach**:
- [[All]] guidance, navigation, control onboard
- Ground provides mission [[Approval]], [[Not]] [[Active]] control
- [[Telemetry]] downlink for [[Monitoring]] [[Only]]
- Command uplink for mission abort only

### [[Landing Algorithm Architecture]]
**Decision**: Convex optimization for powered descent
**Rationale**:
- Fuel-optimal trajectories (maximizes margin)
- Handles constraints (no-fly zones, landing pad [[Location]])
- Real-time computation feasible on [[Flight Computer]]
- Flight-proven approach (SpaceX, [[Blue Origin]] heritage)

**Algorithm**:
- [[Phase 1]]: Powered descent initiation (deorbit burn)
- [[Phase 2]]: Vertical descent (convex optimization)
- [[Phase 3]]: Terminal descent (constant velocity, final 100m)
- Integrated with [[Landing System]] deployment

## [[Integration Status]]

### With Other [[Systems]]

[[Avionics System]]:
- Executes on [[Flight Computer]] (triple redundant)
- Uses [[Sensor Suite]] for state estimation
- Runs on real-time operating system (1 kHz loop)
- [[Flight Software]] integrates all GNC algorithms

[[Propulsion System]]:
- Commands [[Thrust Vector Control]] gimbal (±5°)
- Commands engine throttle (50-100% thrust)
- Coordinates with [[Engine Controller]]
- [[Startup]]/shutdown sequencing

[[Structures System]]:
- Coordinates [[Landing System]] deployment
- Landing gear [[Extension]] at 1,000m altitude
- Touchdown [[Detection]] [[Via]] sensors
- Shock absorption during landing

**[[Ground Systems]]**:
- Pre-flight: Upload mission parameters (target orbit, landing zone)
- In-flight: Monitor only (no active control)
- Post-flight: Telemetry download for analysis

## [[Test Campaign]]

### [[Completed Tests]]

**[[Simulation Testing]]** (Aug-[[Dec 2025]]):
- ✅ 6-DOF trajectory simulations (1,000+ runs)
- ✅ Monte Carlo dispersions (winds, sensor errors, engine [[Performance]])
- ✅ Guidance algorithm performance validation
- ✅ Control system stability analysis (root locus, Bode plots)

**[[Software]]-in-Loop (SIL)** (Nov-[[Dec]] 2025):
- ✅ [[Autopilot Software]] [[Execution]] on development hardware
- ✅ Navigation filter timing validation
- ✅ Control loop stability with flight code

### [[Upcoming Tests]]

**Hardware-in-Loop (HIL)** (Feb-[[June 2026]]):
- [[Flight Software]] on real [[Flight Computer]] hardware
- Simulated vehicle dynamics, sensor inputs
- Real sensor interfaces (IMU, GPS, altimeters)
- Validate [[Landing Algorithm]] on target hardware
- Closed-loop GNC performance validation

**[[Integrated System Testing]]** (July-[[Sep 2026]]):
- Integration with [[Avionics System]] (full avionics [[Stack]])
- Integration with [[Propulsion System]] (TVC commands)
- End-to-end mission scenarios
- Failure mode testing (sensor failures, abort scenarios)

**[[Flight Testing]]** ([[Dec 2026]]):
- First flight: Orbital insertion + propulsive landing
- GNC performance [[Monitored]] via telemetry
- Post-flight data analysis and algorithm tuning

See [[Test Campaign Overview]] for full schedule.

## [[Requirements Traceability]]

### [[System Requirements]]
- SR-010: Autonomous flight (no ground loop) ✅
- SR-011: Target orbit accuracy ±5 km ✅ (validated in sim)
- SR-012: Landing precision ±10 meters ✅ (validated in sim)

### [[Performance Requirements]]
- [[PR]]-011: Navigation accuracy (position) ±50 meters ✅
- PR-012: Navigation accuracy (velocity) ±0.5 m/s ✅
- PR-013: Attitude control ±0.5° (ascent) ✅
- PR-014: Attitude control ±2° (landing) ✅
- PR-015: Control loop [[Rate]] ≥ 100 Hz ✅ (1 kHz provided)

### [[Safety Requirements]]
- SAF-010: Abort detection and execution < 1s ✅
- SAF-011: Redundant state estimation (3x IMU) ✅
- SAF-012: [[Safe]] mode (direct control) if GNC fails ✅

## Team

**[[Lead]]**: [[Elena Rodriguez]]
- GNC system [[Architect]] (shared with [[Avionics System]])
- [[Landing Algorithm]] specialist
- Risk owner: R-007 (software schedule)

**GNC Specialists**:
- [[Robert Zhang]] (Contractor) - [[Flight Software]], [[Autopilot Software]]
- 2x Contractors ([[Starting Jan]] 6) - [[Landing Algorithm]] development
- [[Daniel Wong]] ([[Systems Engineering]]) - Trajectory analysis, [[Trajectory Optimization]]

See [[Team Roster]] for full team details.

## Schedule & Milestones

| Milestone | [[Date]] | Status |
|-----------|------|--------|
| [[Preliminary Design Review]] | 2025-12-18 | ✅ Complete |
| Navigation filter complete | 2026-01-15 | ✅ Complete (early) |
| [[Landing Algorithm]] complete | 2026-02-28 | 🔄 At risk (was [[Feb 15]]) |
| HIL testing start | 2026-02-01 | ⏳ [[Planned]] |
| [[Critical Design Review]] | 2026-03-10 | ⏳ Planned |
| GNC algorithms frozen | 2026-06-01 | ⏳ Planned |
| Integrated testing complete | 2026-09-15 | ⏳ Planned |
| First flight (GNC validation) | 2026-12-15 | ⏳ Planned |

See [[Project Roadmap]] for overall program schedule.

## [[Risks

See]] [[Risk Register]] for complete risk analysis.

**[[MEDIUM Priority]]**:
- R-007: [[Flight Software]] schedule (Score: 12)
  - Includes [[Landing Algorithm]] schedule risk
  - Mitigation: Contractor support, [[Scope]] reduction ([[Trajectory Optimization]] descoped)

**Monitoring**:
- HIL testing schedule (dependent on avionics hardware)
- Sensor latency impacts on control performance

## Budget

**GNC [[System Budget]]**: $0.6M (of $14M [[Total]], subset of [[Avionics System]] budget)

| Category | Budget | Spent | Remaining |
|----------|--------|-------|-----------|
| [[Algorithm Development]] | $0.3M | $0.15M | $0.15M |
| Simulation Tools | $0.1M | $0.08M | $0.02M |
| Contractor Support (software) | $0.2M | $0.05M | $0.15M |

GNC hardware costs [[Are]] included in [[Avionics System]] budget (sensors, computers).

See [[Budget Tracker]] for program-level budget.

## [[Documentation]]

**[[Design Documentation]]**:
- GNC [[System Design Document]] (master [[Reference]])
- Navigation filter design (EKF equations, tuning)
- Guidance algorithms ([[Autopilot Software]], [[Landing Algorithm]])
- Control system design (PID tuning, stability analysis)

**[[Software Documentation]]**:
- [[Flight Software]] - [[Software Architecture]]
- [[Autopilot Software]] - Ascent guidance code
- [[Landing Algorithm]] - Powered descent code
- [[Trajectory Optimization]] - Trajectory planning [[Tools]] (offline)

**[[Analysis Documentation]]**:
- Trajectory simulation [[Results]] (1,000+ runs)
- Monte Carlo analysis (dispersions, sensitivities)
- Control system stability analysis
- Performance budgets (navigation accuracy, control authority)

**[[Test Documentation]]**:
- SIL [[Test]] results
- HIL test plans (upcoming)
- Integration test procedures

**Decisions**:
- [[ADR-002 Flight Computer]] - Triple [[Redundancy Architecture]]
- [[ADR-003 Landing Strategy]] - Propulsive landing approach

**[[Project Management]]**:
- [[Project Roadmap]]
- [[Risk Register]]
- [[Team Roster]]

## [[Meeting Notes

Recent]] discussions:
- [[2025-12-18 PDR Review]] - GNC design review
- [[2026-01-02 Sprint Planning]] - Q1 algorithm development plan

---

*[[Last]] [[Updated]]: 2026-01-02 by [[Elena Rodriguez]]*
*[[Next]] review: Weekly [[Project Roadmap]] review, daily software standups*
