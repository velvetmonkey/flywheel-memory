---
type: test-plan
status: ongoing
owner: "[[Sarah Chen]]"
created: 2025-08-01
updated: 2026-01-02
tags:
  - testing
  - planning
---
# [[Test Campaign Overview]]

## [[Overview]]

[[This]] document provides the master [[Test Plan]] for the [[Artemis Rocket]] program. The [[Test Campaign]] validates [[All]] vehicle [[Systems]] from component level through integrated vehicle, culminating in [[First]] [[Flight Readiness]].

[[Program Timeline]]: 18 months ([[June 2025]] → [[December 2026]])
[[Test Budget]]: $800K (5.7% of $14M [[Total]] budget)
[[Test Philosophy]]: Incremental build-up, fail early, learn fast

## [[Test Strategy

Per]] [[ADR-004 Test Campaign]], the program uses an **[[Incremental Test Approach]]** with [[Hardware]]-in-[[Loop Simulation]]:

```
Component Tests → Subsystem Tests → Hardware-in-Loop → Hot Fire → Integrated → Flight
     ↓                 ↓                  ↓              ↓           ↓          ↓
   Validate        Validate         Virtual        Propulsion   Full Vehicle  Mission
  individuals     integration       flights         system      environment   success
```

**[[Key Principles]]**:
1. **[[Test]] early, test often** - Catch issues before expensive [[Integration]]
2. **Incremental complexity** - Simple tests first, build up to complex
3. **Accept failures in [[Testing]]** - Learn from [[Data]], iterate designs
4. **Hardware validates simulation** - [[Use]] real hardware to prove models
5. **[[Full]]-duration final test** - Demonstrate flight-like operation before flight

## [[Test Phases]]

### [[Phase 1]]: [[Component Testing]] ([[Months 1]]-6, Jun-[[Nov 2025]])

**Objective**: Validate individual [[Components]] meet specifications

[[Propulsion Components]]:
- [[Turbopump]]: Spin test, bearing [[Validation]], seal [[Performance]]
- [[Fuel Tanks]]: Pressure test (leak, burst), structural validation
- [[Oxidizer System]]: Cryogenic test (LOX compatibility, boiloff)
- [[Cooling System]]: Flow test ([[Pressure Drop]], thermal capacity)
- [[Thrust Vector Control]]: Actuator test (stroke, force, bandwidth)
- [[Engine Controller]]: Bench test (I/O, [[Voting]], fault [[Injection]])

[[Avionics Components]]:
- [[Flight Computer]]: Functional test (triple redundancy, voting)
- [[IMU Selection]]: Accuracy test (gyro drift, accelerometer bias)
- [[GPS Receivers]]: Acquisition time, accuracy, multipath rejection
- [[Sensor Suite]]: Calibration (pressure, temperature, [[Flow Sensors]])

[[Structures Components]]:
- [[Airframe Design]]: Coupon test (material properties, fatigue)
- [[Landing Legs]]: Deployment test (mechanism, shock absorption)
- [[Stage Separation]]: Pyrotechnic test (timing, [[Reliability]])

[[GNC Components]]:
- Grid fins: Aerodynamic test (wind tunnel, [[Control Authority]])
- [[Radar Altimeter]]: Accuracy test (altitude measurement)

**[[Status]]**: ✅ [[Complete]] (all components [[Validated]] by [[Dec 2025]])

### [[Phase 2]]: [[Subsystem Testing]] ([[Months 7]]-10, [[Dec]] 2025-[[Mar 2026]])

**Objective**: Validate integrated subsystems function correctly

[[Propulsion Subsystem]]:
- Cold flow test (no combustion, validate flow paths)
- [[Pressurization System]] test (tank pressure control, ullage)
- Valve sequencing test ([[Ignition Sequence]] timing)
- **Status**: ✅ Complete (Dec 2025)

[[Avionics Subsystem]]:
- Integration test ([[CAN Bus]], [[Power Distribution]], redundancy)
- Triple-[[Redundant]] [[Flight Computer]] test (cross-channel voting)
- [[Sensor Fusion]] test (IMU + GPS integration)
- **Status**: 🔄 [[In Progress]] (Jan-[[Feb 2026]])

[[GNC Subsystem]]:
- Hardware-in-loop test (control loops with real actuators)
- [[Autopilot Software]] validation (flight modes, state [[Machine]])
- [[Landing Algorithm]] simulation ([[Powered Descent Guidance]])
- **Status**: 🔄 In Progress (Jan-Mar 2026)

[[Structures Subsystem]]:
- Landing leg load test (crush [[Core]] validation)
- [[Stage Separation]] mechanism test (full vehicle mass simulator)
- **Status**: ⏳ [[Planned]] (Feb 2026)

### [[Phase 3]]: Hardware-in-Loop Simulation ([[Months 8]]-12, Jan-[[May 2026]])

**Objective**: Virtual [[Flight Testing]] with real flight computer and sensors

**[[Simulation Environment]]**:
- **[[Physics]]**: 6-DOF flight dynamics, atmosphere, gravity
- **Propulsion model**: Thrust, ISP, [[Mass Flow]] (validated from [[Hot Fire]] data)
- **Real hardware**: [[Flight Computer]], [[Engine Controller]], IMU, GPS
- **Simulated hardware**: [[Engine]] thrust, vehicle motion, sensor inputs

**[[Test Scenarios]]**:
1. **Nominal ascent** - Validate guidance, control, stage [[Separation]]
2. **Off-nominal ascent** - Engine throttle variations, wind gusts
3. **Abort scenarios** - Engine failure, sensor failures, GNC faults
4. **Landing approach** - [[Powered]] descent, precision touchdown
5. **Edge cases** - Low propellant, [[High]] winds, GPS loss

**[[Success Criteria]]**: 100 simulated flights, >95% success [[Rate]]

**Status**: 🔄 In Progress (Jan-May 2026)
- Flights [[Completed]]: 47/100
- Success rate: 96% (45 nominal, 2 aborts)

### [[Phase 4]]: [[Hot Fire Testing]] ([[Months 11]]-14, Dec 2025-Mar 2026)

**Objective**: Validate [[Propulsion System]] performance with live engine firing

**[[Test Facility]]**: [[University Rocket Test Stand]]
**[[Test Configuration]]**: Horizontal engine mount, vertical propellant tanks

**[[Test Series]]**:

**[[Test 1]]: 30-[[Second Burn]]** ([[Dec 28]], 2025)
- Objectives: Validate ignition, [[Stable]] combustion, cooling
- [[Result]]: ✅ **Success** - All objectives met
- Data: [[Thrust 44.2]] kN, ISP 287s, [[Chamber Pressure]] 8.2 MPa

**[[Test 2]]: 60-Second Burn** ([[Dec 30]], 2025)
- Objectives: [[Thermal Validation]], steady-[[State Operation]]
- Result: ✅ **Success** - Thermal equilibrium at 595°C
- Data: Performance consistent with Test 1 (thrust within 0.2%)

**[[Test 3]]: 120-Second Burn** ([[Jan 2]], 2026)
- Objectives: Full mission duration, endurance
- Result: ✅ **Success** - No degradation over 120s
- Data: Stable operation, all subsystems nominal

**[[Test 4]]: [[Restart Test]]** ([[Jan 15]], 2026, [[Scheduled]])
- Objectives: Cold restart [[After]] coast, landing burn simulation
- Sequence: 30s burn → 5min shutdown → restart → 20s burn
- Success [[Criteria]]: Clean ignition, stable combustion
- **Status**: ⏳ Scheduled

**[[Detailed Results]]**: [[See]] [[Engine Hot Fire Results]]

**Status**: 3/4 tests complete, 100% success rate to [[Date]]

### [[Phase 5]]: [[Integrated Vehicle Testing]] ([[Months 15]]-17, Jun-[[Aug 2026]])

**Objective**: Validate full vehicle survives flight environment

**[[Environmental Testing]]**:

**[[Thermal Cycling]]** ([[Jun 2026]])
- Temperature range: -40°C to +85°C (flight extremes)
- Cycles: 10 thermal cycles (qualify all components)
- Success criteria: No failures, all systems functional
- **Status**: ⏳ Planned

**[[Vibration Testing]]** ([[Jul 2026]])
- Load profile: [[Launch]] vibration spectrum (0-100 Hz)
- Duration: 2 minutes per axis (X, Y, Z)
- Success criteria: Structural integrity [[Maintained]]
- **Status**: ⏳ Planned

**[[Acoustic Testing]]** (Jul 2026)
- Sound pressure level: 140 dB (launch environment)
- Duration: 2 minutes (simulated launch acoustics)
- Success criteria: No acoustic fatigue, avionics functional
- **Status**: ⏳ Planned

**[[Integrated Systems Tests]]**:

**[[Full Vehicle Power]]-On** (Jun 2026)
- Test: Energize all systems, verify functionality
- Success criteria: All systems communicate, no shorts/faults
- **Status**: ⏳ Planned

**[[Flight Simulation]]** (Jul 2026)
- Test: Execute full mission [[Timeline]] (T-60min to T+300s)
- Includes: Countdown, ignition, stage separation, landing
- Success criteria: All sequences execute correctly
- **Status**: ⏳ Planned

**[[Separation Test]]** (Aug 2026)
- Test: Stage separation mechanism with full vehicle mass
- Success criteria: Clean separation, no hang-ups
- **Status**: ⏳ Planned

**[[Landing Leg Deployment]]** (Aug 2026)
- Test: Deploy landing legs under full vehicle weight
- Success criteria: Legs deploy, lock, support vehicle
- **Status**: ⏳ Planned

### [[Phase 6]]: [[Flight Readiness Review]] ([[Month 18]], [[Sep 2026]])

**Objective**: Final [[Approval]] for first flight

**[[Review Objectives]]**:
1. Verify all test objectives met
2. Review anomalies and resolutions
3. Assess residual risks (go/no-go decision)
4. Obtain [[Stakeholder Approval]] for first flight

**Deliverables**:
- Test campaign [[Summary]] [[Report]]
- Performance [[Verification]] matrix ([[Requirements]] vs test [[Results]])
- [[Risk Assessment]] (residual risks [[Identified]] and mitigated)
- [[Flight Operations]] plan (countdown procedures, abort criteria)
- Flight [[Safety]] review (range safety, emergency procedures)

**[[Decision Makers]]**:
- [[Sarah Chen]] ([[Chief Engineer]])
- [[Marcus Johnson]] ([[Propulsion Lead]])
- [[Elena Rodriguez]] ([[Avionics Lead]])
- [[James Park]] ([[Structures Lead]])
- External reviewer (aerospace safety consultant)

**Success Criteria**: All stakeholders approve first flight attempt

**[[Target Date]]**: [[September 15]], 2026
**Status**: ⏳ Pending (review scheduled after integrated testing)

## [[Test Facilities]]

### University Rocket Test Stand

**[[Location]]**: 50 km from headquarters (safety distance)
**[[Capabilities]]**:
- Horizontal engine test stand (0-100 kN thrust capacity)
- Propellant storage: LOX (500L), RP-1 (500L)
- Data acquisition: 64 channels, 20 kHz sampling
- High-speed cameras: 2× 1000 fps cameras
- Control room: [[Remote]] operation (500m standoff)

**Availability**:
- Cost: $10K/day rental
- Lead time: 2 weeks advance booking
- Slots used: 4 slots (Dec 2025 - Jan 2026)
- Remaining slots: 1 slot reserved (Feb 2026 contingency)

**Usage**:
- ✅ Test 1: Dec 28, 2025
- ✅ Test 2: Dec 30, 2025
- ✅ Test 3: Jan 2, 2026
- ⏳ Test 4: Jan 15, 2026 (scheduled)

### Environmental Test Chamber

**Location**: Commercial test facility (local)
**Capabilities**:
- Temperature range: -60°C to +150°C
- Chamber size: 3m × 3m × 4m (fits full vehicle)
- Vacuum capability: 10^-3 torr (space simulation)
- Thermal cycling: 10 cycles/day

**Availability**:
- Cost: $5K/day rental
- [[Lead]] time: 1 week advance booking
- **Status**: Booked for [[June 2026]] (1 week)

### [[Vibration Test Facility]]

**Location**: Commercial test facility (local)
**Capabilities**:
- Shake table size: 2m × 2m
- [[Frequency]] range: 0-100 Hz
- Load capacity: 500 kg (full vehicle mass)
- 3-axis simultaneous testing

**Availability**:
- Cost: $3K/day rental
- Lead time: 2 weeks advance booking
- **Status**: Booked for July 2026 (3 days)

### Company Warehouse

**Location**: Headquarters building
**Capabilities**:
- Assembly floor: 500 m² (vehicle integration)
- Crane: 2-ton capacity (vehicle lifting)
- Clean room: Class 10,000 (avionics assembly)
- Storage: Propellant tanks, test equipment

**Availability**: Owned facility (no rental cost)

**Usage**:
- Component assembly and integration
- Subsystem testing (non-firing)
- Hardware-in-loop simulation lab
- Vehicle final assembly

## Test Data Management

### Data Collection

**Instrumentation**:
- 50+ sensor channels (pressure, temperature, flow, thrust, vibration)
- High-speed video (1000 fps, combustion and deployment)
- Flight software logs (state machine, health monitoring, telemetry)
- 10 kHz sampling rate (critical measurements)

**Data Volume**:
- Per hot fire test: ~5 GB (10 kHz × 50 channels × 120s)
- Per simulation flight: ~500 MB (1 kHz × 100 channels × 300s)
- Total campaign: ~200 GB (all tests, simulations, videos)

### Data Analysis

**Real-Time Monitoring**:
- Abort on out-of-limits (chamber pressure, temperatures)
- Live telemetry display (control room)
- Automated fault detection (software watchdog)

**Post-Test Analysis**:
- Performance characterization (thrust, ISP, efficiency)
- Model correlation (update simulations with test data)
- Trending (detect degradation over test series)
- Anomaly investigation (root cause analysis)

**Tools**:
- MATLAB (data processing, plotting)
- Python (automated analysis scripts)
- Excel (summary reports, tables)

### Data Archival

**Storage**:
- Test reports (PDF, objectives/setup/results/analysis)
- Raw data files (HDF5, 10 kHz time-series data)
- Video archives (MP4, high-speed and standard cameras)
- Flight software logs (JSON, state machine traces)

**Backup**:
- Primary: Network-attached storage (NAS, RAID 6)
- Secondary: Cloud backup (AWS S3, encrypted)
- Retention: 10 years (program lifetime + archive)

## Risk Management

### Test-Related Risks

**R-020: Test Stand Availability** (Score: 6, LOW-MEDIUM)
- Risk: Schedule conflicts, facility maintenance delays
- Impact: Hot fire campaign delayed, pushes first flight
- Mitigation: Early booking, backup facility identified
- Status: Mitigated (all slots booked, contingency reserved)

**R-021: Hot Fire Anomaly** (Score: 9, MEDIUM)
- Risk: Engine failure during test, requires re-test
- Impact: 2-4 week delay, additional test cost ($50K)
- Mitigation: Conservative test plan, instrumentation for diagnostics
- Status: [[Active]] (inherent test [[Risk]], acceptable)

**R-022: [[Environmental Test Failure]]** (Score: 6, LOW-MEDIUM)
- Risk: Component failure during thermal/vibration testing
- Impact: [[Design]] iteration, 4-6 week delay
- Mitigation: Component-level pre-qualification, margins
- Status: Active (monitor component tests closely)

**R-023: Hardware-in-[[Loop Fidelity]]** (Score: 4, LOW)
- Risk: Simulation models inaccurate, flight behaves differently
- Impact: Reduced confidence in [[Flight Software]]
- Mitigation: Validate models with [[Test Data]], conservative margins
- Status: Mitigated (models correlated to [[Tests 1]]-3)

### [[Retired Risks]]

**R-024: [[First Hot Fire Failure]]** ([[Retired Jan]] 2026)
- Risk: Test 1 catastrophic failure (engine damage)
- Mitigation: Conservative test plan, abort criteria
- [[Outcome]]: Test 1 fully successful, risk retired
- **Status**: ✅ Retired after Test 1 success

## [[Budget Tracking]]

### [[Test Campaign Budget]]: $800K

**Budget Allocation**:
| Phase | Budgeted | Spent | Remaining | Status |
|-------|----------|-------|-----------|--------|
| Component testing | $150K | $145K | $5K | ✅ Complete |
| Subsystem testing | $200K | $180K | $20K | 🔄 In Progress |
| Hardware-in-loop | $100K | $60K | $40K | 🔄 In Progress |
| [[Hot]] fire testing | $200K | $120K | $80K | 🔄 3/4 complete |
| Integrated testing | $100K | $0 | $100K | ⏳ Planned |
| Contingency | $50K | $15K | $35K | Reserve |
| **Total** | **$800K** | **$520K** | **$280K** | **[[On Budget]]** |

**[[Cost Breakdown]] (Spent)**:
- Test facilities: $320K (hot fire stand, environmental chamber bookings)
- Instrumentation: $80K (sensors, data acquisition, cameras)
- Propellants: $20K (LOX, RP-1, GN2 for all tests)
- Test hardware: $60K (fixtures, simulators, mass models)
- Labor: $40K (test engineers, technicians, facility operators)

**Forecast**: On track to complete within $800K budget (35% margin remaining)

## [[Schedule Tracking]]

### [[Critical Path]]: Hot Fire Testing

**Milestones**:
- ✅ Test 1 (30s): Dec 28, 2025 ([[ON TIME]])
- ✅ Test 2 (60s): Dec 30, 2025 (ON TIME)
- ✅ Test 3 (120s): Jan 2, 2026 (ON TIME)
- ⏳ Test 4 (restart): Jan 15, 2026 (SCHEDULED)
- ⏳ Integrated testing: Jun-Aug 2026 ([[ON TRACK]])
- ⏳ Flight readiness review: [[Sep 15]], 2026 ([[On Track]])
- ⏳ First flight: [[Dec 2026]] (ON [[Track]])

**[[Schedule Health]]**: 🟢 GREEN (on schedule, no delays)

**[[Buffer Analysis]]**:
- [[Original Schedule]]: 18 months ([[Jun 2025]] → Dec 2026)
- [[Current]] progress: 8 months elapsed, on track for 18-[[Month]] completion
- Buffer remaining: 2 months (integrated testing has 1-month buffer)

## [[Lessons Learned]]

### [[Successes

1]]. **Incremental approach validated**
   - Component tests caught issues early (fuel tank weld)
   - Subsystem tests validated integration (no surprises)
   - Hot fire tests [[Built]] confidence progressively

2. **Hardware-in-loop highly effective**
   - Caught [[Software]] bugs before live testing
   - Validated flight software without expensive flight tests
   - 96% success rate proves flight software robustness

3. **[[Hot Fire Campaign]] exceeded [[Expectations]]**
   - 3/3 tests fully successful (100% success rate)
   - Performance within 2% of targets ([[Excellent]] agreement)
   - No hardware failures (robust design validated)

4. **Early facility booking critical**
   - Secured all test stand slots by booking 3 months ahead
   - Avoided schedule delays from facility conflicts

### Areas for [[Improvement

1]]. **Component test thoroughness**
   - Fuel tank weld issue [[Found]] in pressure test ([[Good]] catch)
   - Recommend earlier NDT inspection in future programs

2. **Hardware-in-loop setup time**
   - Initial setup took 3 [[Weeks]] (longer than expected)
   - Recommend reusable test harness for future programs

3. **Test [[Data Analysis]] backlog**
   - 2-week delay between test and analysis report
   - Recommend [[Automated]] analysis [[Scripts]] for [[Faster]] turnaround

## [[Related Notes]]

**[[Test Documentation]]**:
- [[Engine Hot Fire Results]] - Detailed [[Hot Fire Test]] data
- [[ADR-004 Test Campaign]] - Test [[Strategy]] decision

**[[Systems Under Test]]**:
- [[Propulsion System]] - Component and hot fire testing
- [[Avionics System]] - Hardware-in-loop testing
- [[GNC System]] - Simulation and HIL testing
- [[Structures System]] - Environmental testing

**[[Program Management]]**:
- [[Project Roadmap]] - Test milestones and schedule
- [[Risk Register]] - Test-[[Related]] risks
- [[Budget Tracker]] - Test campaign costs

**Team**:
- [[Sarah Chen]] - Test campaign oversight
- [[Marcus Johnson]] - Propulsion testing lead
- [[David Kim]] - [[Test Engineer]] (hot fire)
- [[Team Roster]] - Full test team

---

*[[Last Updated]]: 2026-01-02 by [[Sarah Chen]]*
*[[Next Review]]: Post-Test 4 (evaluate integrated testing readiness)*
