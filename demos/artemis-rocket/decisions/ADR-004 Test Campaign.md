---
type: decision
status: accepted
date: 2025-12-10
updated: 2025-12-10
decision_makers:
  - "[[Sarah Chen]]"
  - "[[Marcus Johnson]]"
tags:
  - adr
  - testing
  - decision
---
# ADR-004: [[Test Campaign]] [[Strategy]]

## [[Status]]

**Accepted** - 2025-12-10

## [[Context]]

The [[Artemis Rocket]] program requires a comprehensive [[Test Campaign]] to validate [[All]] [[Systems]] before [[First]] flight. The [[Test]] strategy [[Must]] balance thoroughness (reduce [[Risk]]) with schedule (18-[[Month]] [[Timeline]]) and budget ($14M total program).

[[Key Constraints]]:
- Budget: $14M [[Total]] program budget (test [[Hardware]] expensive)
- Timeline: 18-month development (first flight [[December 2026]])
- Test facilities: [[Limited]] access to rocket test stands (scheduling conflicts)
- [[Team Size]]: 15 people (limited hands for [[Testing]])
- Risk tolerance: Experimental rocket (acceptable to [[Have]] failures in testing)

**Systems to Validate**:
- [[Propulsion System]] ([[Engine]], [[Turbopump]], tanks, valves)
- [[Avionics System]] ([[Flight Computer]], sensors, redundancy)
- [[Structures System]] (airframe, [[Landing Legs]], [[Stage Separation]])
- [[GNC System]] (guidance, navigation, control algorithms)
- Integrated vehicle (all systems [[Working]] together)

## Decision

**Selected: [[Incremental Test Approach]] with Hardware-in-[[Loop Simulation]]**

The test campaign will [[Use]] an incremental build-up approach, starting with component tests and culminating in [[Full]]-duration [[Hot Fire]] tests. Hardware-in-loop simulation will validate integrated systems before live testing.

**[[Test Philosophy]]**:
- Test early, test often (catch issues before [[Integration]])
- Incremental complexity (simple → complex)
- Accept failures (learn from [[Test Data]], iterate)
- Hardware-in-loop for integration (reduce live test risk)
- Full-duration final test (build confidence before flight)

**[[Test Phases]]**:
1. **[[Component Testing]]** ([[Months 1]]-6): Individual [[Components]] [[Validated]]
2. **[[Subsystem Testing]]** ([[Months 7]]-10): Integrated subsystems validated
3. **Hardware-in-Loop Simulation** ([[Months 8]]-12): Virtual flight tests
4. **[[Hot Fire Testing]]** ([[Months 11]]-14): Engine firing campaign
5. **[[Integrated Vehicle Testing]]** ([[Months 15]]-17): Full vehicle [[Validation]]
6. **[[Flight Readiness Review]]** ([[Month 18]]): Final [[Approval]] for flight

## [[Alternatives Considered]]

### [[Option 1]]: [[Big Bang Testing]] ([[Test Once]], [[Fly Once]])

**Approach**: Build entire vehicle, minimal component testing, single integrated test before flight

**Advantages**:
- Fastest development (minimal test iterations)
- Lowest test cost ($50K - single integrated test)
- Simplest planning (one test, one go/no-go decision)

**Disadvantages**:
- Extremely high risk (first test is also first flight)
- No iteration opportunity (failures discovered too late)
- Single failure causes mission loss
- Unacceptable for $14M [[Investment]]

**[[Conclusion]]**: Rejected - unacceptable risk

### [[Option 2]]: [[Exhaustive Testing]] ([[Test Everything Twice]])

**Approach**: Test every component, every subsystem, every integration point [[Multiple]] times

**Advantages**:
- Highest confidence (thorough validation)
- Multiple iterations (catch all edge cases)
- [[Redundant]] [[Verification]] (cross-check [[Results]])

**Disadvantages**:
- Expensive ($3M+ in test hardware and facilities)
- Slow (24+ month timeline, misses deadline)
- Diminishing returns (over-testing low-risk items)

**Conclusion**: Rejected - exceeds budget and timeline

### Option 3: Simulation-Only Testing

**Approach**: Validate all systems in software simulation, minimal hardware testing

**Advantages**:
- Low cost ($100K for simulation [[Software]])
- Fast iteration (no hardware [[Lead]] times)
- [[Safe]] (no risk of hardware damage)

**Disadvantages**:
- Simulation accuracy unknown (models may be wrong)
- Real-world effects missed (thermal, vibration, etc.)
- No [[Hardware Validation]] (unproven before flight)
- Unacceptable for [[Safety]]-critical rocket

**Conclusion**: Rejected - insufficient hardware validation

### [[Option 4]]: [[Incremental Testing]] with HIL (Selected)

**Approach**: [[Progressive]] component → subsystem → integrated testing with hardware-in-loop simulation

**Advantages**:
- Balanced risk/cost/schedule (validates critical items)
- Early issue [[Detection]] (catch problems before integration)
- Simulation supplements hardware (reduce live test risk)
- Flexible (can adjust [[Based]] on early results)
- Industry standard (SpaceX, [[Blue Origin]] approach)

**Disadvantages**:
- Moderate cost ($800K for test campaign)
- Requires planning (test sequence must be optimized)
- Some redundancy (test same item at multiple levels)

**Conclusion**: **SELECTED** - best balance of risk, cost, and schedule

## Rationale

### 1. Risk Reduction Strategy

**Failure Cost vs Test Cost**:
- Flight failure: $14M (entire program budget)
- [[Hot Fire Test]] failure: $50K (replace damaged components)
- Component test failure: $5K (replace single component)

**Test ROI**:
- Catch [[Critical Issue]] in component test: Save $13.995M
- Catch critical issue in hot fire: Save $13.95M
- Miss issue, [[Discover]] in flight: Lose $14M

**Verdict**: Testing reduces catastrophic risk at acceptable cost

### 2. Schedule Optimization

**Test Campaign Timeline**:
```
Months 1-6:   Component testing (parallel across subsystems)
Months 7-10:  Subsystem testing (sequential, dependencies)
Months 8-12:  Hardware-in-loop simulation (parallel with subsystems)
Months 11-14: Hot fire testing (incremental engine burns)
Months 15-17: Integrated vehicle testing (full systems)
Month 18:     Flight readiness review
```

**Critical Path**: Hot fire testing (4 tests, 1 week between tests)
- Test 1: 30-second burn (validate ignition, basic operation)
- Test 2: 60-second burn (thermal validation, steady-state)
- Test 3: 120-second burn (full mission duration)
- Test 4: Restart test (validate landing burn capability)

**Verdict**: Incremental approach fits 18-month timeline

### 3. Budget Allocation

**Test Campaign Budget**: $800K (5.7% of $14M total)

| Test Phase | Cost | Rationale |
|------------|------|-----------|
| Component testing | $150K | Off-the-shelf test equipment |
| Subsystem testing | $200K | Custom test fixtures |
| Hardware-in-loop simulation | $100K | Software licenses + workstations |
| [[Hot]] fire testing | $200K | Test stand rental, propellants, instrumentation |
| Integrated vehicle testing | $100K | Environmental chamber, shake table |
| Contingency | $50K | Unplanned tests, repairs |

**Verdict**: Test budget justified by risk reduction

### 4. Test Facility Constraints

**Available Facilities**:
- University test stand (rocket engine testing): $10K/day rental
- Environmental chamber (thermal/vacuum): $5K/day rental
- Shake table (vibration testing): $3K/day rental
- [[Company]] warehouse (assembly/integration): Owned (no rental cost)

**Scheduling**:
- University test stand: 2-week lead time, 4 slots [[Available]] ([[Dec]]-Jan)
- Environmental chamber: 1-week lead time, flexible availability
- Shake table: 2-week lead time, 3 slots available (Nov-Dec)

**[[Test Plan Optimization]]**:
- Book test stand slots early (critical path)
- Schedule environmental/shake tests around hot fire [[Windows]]
- Use company warehouse for subsystem [[Integration Testing]]

**Verdict**: Incremental approach optimizes facility usage

## Implications

### [[Test Campaign Roadmap]]

**[[Phase 1]]: Component Testing (Months 1-6)**

**[[Propulsion Components]]**:
- [[Turbopump]] spin test ([[Gas Generator]], bearings, seals)
- [[Fuel Tanks]] pressure test (leak check, burst test)
- [[Oxidizer System]] cryo test (LOX compatibility, boiloff)
- [[Cooling System]] flow test (channel [[Pressure Drop]], thermal)
- [[Thrust Vector Control]] actuator test (stroke, force, speed)
- [[Engine Controller]] bench test (I/O, [[CAN Bus]], watchdog)

**[[Avionics Components]]**:
- [[Flight Computer]] functional test ([[Voting]], fault [[Injection]])
- [[IMU Selection]] accuracy test (gyro drift, accel bias)
- [[GPS Receiver]] test (acquisition time, accuracy)
- [[Sensor Suite]] calibration (pressure, temperature, flow)

**[[Structures Components]]**:
- [[Airframe Design]] coupon test (material properties)
- Landing leg deployment test (mechanism, load capacity)
- Stage [[Separation]] mechanism test (pyro, timing)

**[[Success Criteria]]**: All components meet specifications individually

**[[Phase 2]]: Subsystem Testing (Months 7-10)**

**[[Propulsion Subsystem]]**:
- [[Propulsion System]] cold flow test (no combustion, flow paths)
- [[Pressurization System]] test (tank pressure control)
- Valve sequencing test ([[Ignition Sequence]] timing)

**[[Avionics Subsystem]]**:
- [[Avionics System]] integration test (CAN bus, power, redundancy)
- Triple-redundant flight computer test (voting, fault isolation)
- [[Sensor Fusion]] test (IMU + GPS integration)

**[[GNC Subsystem]]**:
- [[GNC System]] hardware-in-loop test (control loops, actuators)
- [[Autopilot Software]] validation (flight modes, state [[Machine]])
- [[Landing Algorithm]] simulation ([[Powered Descent Guidance]])

**Success [[Criteria]]**: Subsystems function correctly as integrated units

**[[Phase 3]]: Hardware-in-Loop Simulation (Months 8-12)**

**[[Simulation Environment]]**:
- [[Physics]] simulator (6-DOF dynamics, atmosphere, gravity)
- Propulsion model (thrust, ISP, [[Mass Flow]])
- Real hardware: [[Flight Computer]], [[Engine Controller]], sensors
- Simulated hardware: Engine thrust, IMU motion, GPS position

**[[Test Scenarios]]**:
- Nominal ascent (validate guidance, control)
- Engine out (validate abort logic)
- Sensor failures (validate redundancy)
- Landing approach (validate [[Powered]] descent guidance)

**Success Criteria**: 100 simulated flights with >95% success [[Rate]]

**[[Phase 4]]: Hot Fire Testing (Months 11-14)**

**[[Test Configuration]]**:
- Engine mounted horizontally on test stand
- Propellant tanks vertical (flight-like configuration)
- [[Fuel Tanks]] and [[Oxidizer System]] connected [[Via]] feedlines
- [[Turbopump]] and [[Engine Design]] instrumented (50+ sensors)
- [[High]]-speed cameras (combustion visualization)
- [[Data]] acquisition: 10 kHz sampling (all channels)

**[[Test Sequence]]**:

**[[Test 1]]: 30-[[Second Burn]]** (Late [[December 2025]])
- Objectives: Validate [[Ignition Sequence]], achieve [[Stable]] combustion
- Success criteria: Clean ignition, [[Chamber Pressure]] 8.2 MPa, no anomalies
- [[Result]]: ✅ Successful ([[See]] [[Engine Hot Fire Results]])

**[[Test 2]]: 60-Second Burn** (Late December 2025)
- Objectives: [[Thermal Validation]], steady-state operation
- Success criteria: Wall temps (650°C, no pressure oscillations
- [[Result]]: ✅ Successful

**[[Test 3]]: 120-Second Burn** (Early [[January 2026]])
- Objectives: Full mission duration, endurance
- Success criteria: Stable operation, no degradation
- Result: ✅ Successful

**[[Test 4]]: [[Restart Test]]** ([[Mid]] January 2026, [[Planned]])
- Objectives: Cold restart [[After]] coast (landing burn simulation)
- Success criteria: Ignition after 5-minute shutdown, stable combustion
- Result: ⏳ [[Scheduled]] for [[January 15]], 2026

**Success Criteria**: 4/4 tests successful, all [[Performance Requirements]] met

**[[Phase 5]]: Integrated Vehicle Testing (Months 15-17)**

**[[Environmental Testing]]**:
- Thermal cycling (flight temperature extremes)
- Vibration testing ([[Launch]] loads, flight dynamics)
- Acoustic testing (launch noise exposure)

**[[Integrated Systems Test]]**:
- Full vehicle power-on test (all systems energized)
- Flight simulation (mission timeline, all sequences)
- Separation test (stage separation mechanism)
- Landing leg deployment test (full vehicle mass)

**Success Criteria**: Vehicle survives flight environment, all systems functional

**[[Phase 6]]: [[Flight Readiness]] Review (Month 18)**

**[[Review Objectives]]**:
- Verify all test objectives met
- Review anomalies and resolutions
- Assess flight risk (go/no-go decision)
- Obtain [[Stakeholder Approval]] for first flight

**Deliverables**:
- Test campaign [[Summary]] [[Report]]
- [[Performance]] verification matrix ([[Requirements]] vs test results)
- [[Risk Assessment]] (residual risks [[Identified]])
- [[Flight Operations]] plan (countdown, procedures)

**Success Criteria**: All stakeholders approve first flight attempt

### [[Test Data Management]]

**[[Data Collection]]**:
- All tests instrumented (pressure, temperature, flow, thrust)
- High-speed [[Video]] (combustion, deployment mechanisms)
- [[Flight Software]] logs (state machine, [[Health Monitoring]])
- 10 kHz sampling rate (critical measurements)

**[[Data Analysis]]**:
- Real-time [[Monitoring]] (abort on out-of-limits)
- Post-test analysis (performance characterization)
- Model correlation (update simulations with test data)
- [[Trending]] (detect degradation over test series)

**[[Data Archival]]**:
- Test reports (objectives, setup, results, analysis)
- Raw data [[Files]] (10 kHz time-series data)
- Video archives (high-speed, standard cameras)
- [[Lessons Learned]] (issues discovered, resolutions)

### [[Cost Impact]]

**[[Test Campaign Budget]]**: $800K

**Breakdown**:
- Component tests: $150K (test equipment, instrumentation)
- Subsystem tests: $200K (custom fixtures, integration hardware)
- Hardware-in-loop: $100K (simulation software, workstations)
- Hot fire tests: $200K (test stand, propellants, instrumentation)
- Integrated tests: $100K (environmental chamber, shake table)
- Contingency: $50K (unplanned tests, repairs, re-tests)

**Cost Justification**:
- Test cost: $800K (5.7% of budget)
- Risk reduction: Prevents $14M loss (flight failure)
- Expected value: $800K investment prevents )$1M expected loss

**Verdict**: Test campaign ROI justified

### [[Risk Assessment]]

[[Technical Risks]]:
- ✅ Low - Incremental approach catches issues early
- ⚠️ Medium - Test stand availability (scheduling conflicts)
- ⚠️ Medium - First hot fire may damage engine (acceptable risk)

[[Safety Risks]]:
- ✅ Low - [[Remote]] test stand operation (personnel safety)
- ✅ Low - Propellant quantities limited ([[Explosion Risk]] manageable)
- ⚠️ Medium - LOX [[Handling]] (fire/explosion hazard, training [[Required]])

[[Schedule Risks]]:
- ⚠️ Medium - Hot fire anomalies may delay ([[Need]] re-tests)
- ⚠️ Medium - Test facility scheduling (dependencies on external facilities)
- ✅ Low - Parallel component testing (no critical path)

## [[Stakeholder Approval]]

**Decision makers**:
- [[Sarah Chen]] ([[Chief Engineer]]) - **Approved**
- [[Marcus Johnson]] ([[Propulsion Lead]]) - **Approved** ([[Hot Fire Campaign]] critical)

**Consulted**:
- [[Elena Rodriguez]] ([[Avionics Lead]]) - Supports (HIL testing validates avionics)
- [[James Park]] ([[Structures Lead]]) - Supports (environmental testing validates structures)
- University test facility (confirmed availability)
- [[Team Roster]] - Team consensus

**Decision [[Date]]**: 2025-12-10
**Review [[Date]]**: Post-Test 3 (evaluate if Test 4 needed)

## [[Related Decisions]]

- [[ADR-001 Propellant Selection]] - [[Propellant Selection]] affects hot fire testing
- [[ADR-002 Flight Computer]] - HIL testing validates triple redundancy
- [[ADR-003 Landing Strategy]] - Test 4 validates engine restart capability
- Future ADR: Flight plan (based on test results)

## [[References]]

- [[NASA Test]] and [[Evaluation Guidelines]] (incremental test philosophy)
- SpaceX [[Grasshopper Test Campaign]] (landing test heritage)
- [[Blue Origin New Shepard]] Testing (hot fire incremental approach)

[[Related Notes]]:
- [[Test Campaign Overview]] - Master test plan implementation
- [[Engine Hot Fire Results]] - Hot fire test data and analysis
- [[Propulsion System]] - Component and subsystem tests
- [[Avionics System]] - Hardware-in-loop testing
- [[GNC System]] - [[Simulation Testing]]
- [[Flight Computer]] - [[Fault Injection Testing]]
- [[Autopilot Software]] - [[Software Validation]]
- [[Ignition Sequence]] - Validated in [[Tests 1]]-3
- [[Cooling System]] - Thermal validation
- [[Project Roadmap]] - Test schedule and milestones
- [[Risk Register]] - Test-[[Related]] risks
- [[Budget Tracker]] - Test campaign costs

---

*Decision recorded by [[Sarah Chen]] - 2025-12-10*
*[[Status]]: Accepted and [[Implemented]]*
