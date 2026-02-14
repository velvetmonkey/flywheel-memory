---
type: meeting
date: 2025-12-18
attendees:
  - "[[Sarah Chen]]"
  - "[[Marcus Johnson]]"
  - "[[Elena Rodriguez]]"
  - "[[James Park]]"
  - "External Reviewer: Dr. Lisa Anderson"
  - "External Reviewer: Tom Mitchell"
tags:
  - meeting
  - milestone
  - pdr
  - review
---
# [[2025-12-18 PDR Review]] - [[Preliminary Design Review]]

## [[Meeting Info]]

**[[Date]]**: [[December 18]], 2025
**Time**: 09:00-16:00 ([[Full]] day)
**[[Location]]**: [[Conference Room]] A + [[Remote]]
**Facilitator**: [[Sarah Chen]] ([[Chief Engineer]])

**Attendees**:
- [[Sarah Chen]] ([[Chief Engineer]])
- [[Marcus Johnson]] ([[Propulsion Lead]])
- [[Elena Rodriguez]] ([[Avionics Lead]])
- [[James Park]] ([[Structures Lead]])
- Dr. [[Lisa Anderson]] ([[External Reviewer]] - [[Propulsion Systems]])
- [[Tom Mitchell]] (External Reviewer - [[Flight Software]])

**[[External Reviewers]]**:
- Dr. [[Lisa]] Anderson: 20+ years experience in rocket propulsion (previously SpaceX, [[Blue Origin]])
- Tom Mitchell: 15+ years in aerospace flight [[Software]] (previously [[NASA JPL]], [[Rocket Lab]])

## [[Purpose]]

[[Formal Preliminary Design Review]] (PDR) to assess whether the [[Artemis Program]] [[Design]] is mature enough to proceed to [[Critical Design Review]] (CDR) [[Phase]].

**PDR [[Exit Criteria]]**:
- [[All]] subsystem designs at >60% maturity
- Major [[Technical Risks]] [[Identified]] and mitigated
- Cost and schedule confidence >80%
- External reviewers approve [[Design Approach]]
- No [[Show]]-stopper issues

## [[Agenda]]

1. [[Program Overview]] ([[Sarah Chen]]) - 30 min
2. [[Propulsion System Design]] ([[Marcus Johnson]]) - 90 min
3. [[Avionics System Design]] ([[Elena Rodriguez]]) - 90 min
4. [[Structures System Design]] ([[James Park]]) - 60 min
5. [[GNC System Design]] (Elena Rodriguez) - 60 min
6. [[Test Campaign Overview]] (Sarah Chen) - 45 min
7. [[Risk Assessment]] (Sarah Chen) - 45 min
8. [[Budget & Schedule Review]] (Sarah Chen) - 30 min
9. [[External Reviewer Q&A]] - 60 min
10. Go/No-[[Go Decision]] - 30 min

## [[Program Overview]]

**Presenter**: [[Sarah Chen]]

**[[Program Status]]**:
- [[Timeline]]: [[Month 6]] of 18 (33% [[Complete]])
- Budget: $8.4M spent of $14M (60% spent, [[On Budget]])
- [[Team]]: 15 people (12 full-time, 3 contractors)
- Phase: Transitioning from preliminary design to critical design

**[[Key Milestones Achieved]]**:
- ✅ [[Concept Review]] ([[June 2025]])
- ✅ [[Propellant Selection]] complete (LOX/RP-1, [[See]] [[ADR-001 Propellant Selection]])
- ✅ [[Flight Computer]] [[Architecture]] [[Defined]] ([[Triple redundancy]], see [[ADR-002 Flight Computer]])
- ✅ [[Landing Strategy]] approved ([[Propulsive landing]], see [[ADR-003 Landing Strategy]])
- ✅ [[Test Campaign]] [[Planned]] (see [[ADR-004 Test Campaign]])
- ✅ Component procurement 80% complete

**[[Upcoming Milestones]]**:
- ⏳ Critical Design Review ([[March 2026]])
- ⏳ [[First Hot Fire]] [[Test]] ([[January 2026]])
- ⏳ Integrated vehicle assembly ([[February 2026]])
- ⏳ [[First Flight]] ([[December 2026]])

**[[Program Health]]**: 🟢 GREEN
- Schedule: [[On Track]]
- Budget: On [[Target]]
- [[Technical]]: No major blockers
- [[Team Morale]]: [[High]]

## [[Propulsion System Design]] Review

**Presenter**: [[Marcus Johnson]]

### [[Design Maturity]]: 75%

**[[Engine Specifications]]**:
- Propellant: LOX/RP-1 ([[Liquid Oxygen]] + rocket-[[Grade]] kerosene)
- Cycle: [[Gas Generator]]
- Thrust: 45 kN sea level (target)
- [[Specific Impulse]]: 290s (target)
- [[Chamber Pressure]]: 8.5 MPa (target)
- [[Throttle Range]]: 50-100% (for landing [[Control]])

**[[Subsystem Status]]**:

| Subsystem | Maturity | [[Status]] | [[Notes]] |
|-----------|----------|--------|-------|
| [[Engine Design]] | 80% | 🟢 | Design frozen, [[Ready]] for fabrication |
| [[Fuel Tanks]] | 70% | 🟢 | [[Material Selection]] complete ([[Aluminum 2219]]) |
| [[Oxidizer System]] | 75% | 🟢 | Cryogenic [[Handling]] [[Validated]] in [[Testing]] |
| [[Turbopump]] | 60% | 🟡 | [[Lead]] time concern (vendor delivery [[Feb 2026]]) |
| [[Thrust Vector Control]] | 85% | 🟢 | Actuator selection complete, tested |
| [[Engine Controller]] | 65% | 🟢 | [[Hardware]] design complete, software [[In Progress]] |
| [[Cooling System]] | 80% | 🟢 | [[Regenerative Cooling]] design validated |
| [[Ignition Sequence]] | 90% | 🟢 | Pyrotechnic igniter tested [[Successfully]] |

**[[Key Design Decisions]]**:
1. **Gas generator cycle** (vs expander or staged combustion)
   - [[Simpler]], lower cost, flight-proven
   - Trade: Lower ISP (290s vs 310s for staged combustion)
   - Rationale: Sufficient for mission, reduces development [[Risk]]

2. **Pintle injector** (vs showerhead or swirl)
   - [[Throttling Capability]] (50-100%)
   - Self-impinging, [[Stable]] combustion
   - Heritage: SpaceX Merlin, [[Northrop Grumman]] TR-202

3. **Regenerative cooling** (vs ablative or film)
   - 360 [[Cooling Channels]] machined into chamber walls
   - RP-1 fuel as coolant (before combustion)
   - Validated in [[Thermal Analysis]] ([[ANSYS CFD]])

**[[Test Results]] to Date**:
- Component tests: 100% pass [[Rate]] (all 23 tests passed)
- [[Turbopump]] acceptance test: ✅ Passed (vendor certification)
- Igniter [[Hot Fire]]: ✅ 5 successful ignitions (avg 435ms delay)
- [[TVC]] actuator: ✅ 10,000 cycle endurance test passed

**[[Remaining Work]]**:
- [[First]] integrated [[Hot Fire Test]] ([[Jan 2026]])
- [[Engine Controller]] software [[Integration]] (90% complete)
- Propellant [[Loading]] procedures (draft complete)

**[[External Reviewer Comments]]** (Dr. Lisa Anderson):
- ✅ "Gas generator cycle is appropriate for [[This]] mission [[Class]]"
- ✅ "Pintle injector is [[Excellent]] choice for throttling"
- ⚠️ "Turbopump delivery timeline is [[Aggressive]] - recommend backup supplier"
- ✅ "Regenerative cooling design is sound, thermal margins adequate"

**[[Action Items]]**:
- [ ] [[Marcus Johnson]]: [[Identify]] backup turbopump supplier 📅 2026-01-15
- [ ] [[Marcus Johnson]]: Complete [[Engine]] controller software integration 📅 2026-01-31

### [[Propulsion System]] [[PDR Assessment]]: ✅ **PASS**

## [[Avionics System Design]] Review

**Presenter**: [[Elena Rodriguez]]

### Design Maturity: 70%

**Architecture**: Triple-[[Redundant]] flight computer with [[Majority Voting]] (see [[ADR-002 Flight Computer]])

**[[Hardware Specifications]]**:
- [[Flight Computers]]: 3× [[Raspberry Pi Compute Module 4]] ([[ARM Cortex]]-A72, 4GB RAM)
- Operating [[System]]: Real-time [[Linux]] ([[PREEMPT_RT kernel]])
- [[Communication]]: Redundant [[CAN Bus]] (1 Mbps)
- Sensors: Triple-redundant [[IMU]], [[GPS]], [[Pressure Sensors]] (50+ channels)
- Power: 42W average, 500 Wh battery (300s flight duration)

**Subsystem Status**:

| Subsystem | Maturity | Status | Notes |
|-----------|----------|--------|-------|
| [[Flight Computer]] | 80% | 🟢 | Hardware delivered, software 85% complete |
| [[Sensor Suite]] | 75% | 🟢 | All sensors selected and ordered |
| [[CAN Bus]] | 90% | 🟢 | Wiring harness complete, tested |
| [[Flight Software]] | 60% | 🟡 | [[Core]] loops complete, integration ongoing |
| [[Telemetry]] | 65% | 🟢 | [[Protocol]] defined (see [[ADR-005 Telemetry Protocol]]) |
| [[Power Distribution]] | 80% | 🟢 | Battery selected, power [[Board]] fabricated |

**[[Software Architecture]]**:

**[[Core Modules]]**:
- **[[Guidance]]**: [[Trajectory Optimization]], waypoint [[Navigation]]
- **Navigation**: [[Sensor Fusion]] ([[Kalman filter]]), [[State Estimation]]
- **Control**: [[PID controllers]] for attitude, altitude, [[Velocity]]
- **[[Voting Logic]]**: 2-of-3 consensus for redundant sensors/computers
- **[[Fault Detection]]**: [[Watchdog]], [[BIT]] ([[Built]]-[[In Test]]), anomaly [[Detection]]
- **[[Telemetry]]**: [[Data Logging]], transmission to [[Ground]]

**[[Control Loop Performance]]**:
- Guidance loop: 10 Hz (trajectory updates)
- Navigation loop: 100 Hz (state estimation)
- [[Control Loop]]: 1000 Hz (actuator commands)
- Real-time determinism: 100% (no missed deadlines in [[HIL Testing]])

**[[Hardware-in-Loop]] Testing**:
- Flights [[Completed]]: 15 of 100 planned (as of PDR)
- [[Success Rate]]: 93% (14/15 successful)
- Fault [[Injection]]: 5 tests, 100% pass rate
- Remaining: 85 flights ([[Scheduled]] Jan-[[May 2026]])

**Single HIL [[Failure Analysis]]** (Flight #8):
- **Issue**: [[GPS Dropout]] during final approach → landing miss by 300m
- **[[Root Cause]]**: Kalman filter over-weighted GPS vs IMU
- **Fix**: Tuned filter to detect GPS dropout [[Faster]], trust IMU more
- **Retest**: ✅ Passed (landing accuracy ±90m [[After]] GPS dropout)

**External Reviewer Comments** (Tom Mitchell):
- ✅ "Triple [[Redundancy]] is appropriate for mission criticality"
- ✅ "Flight software architecture is well-structured"
- ⚠️ "60% software maturity is low for PDR - recommend [[Accelerating]] development"
- ✅ "HIL testing plan is comprehensive, [[Good]] fault injection [[Coverage]]"
- 💡 "[[Consider]] adding [[Radar Altimeter]] for landing (backup to GPS/IMU)"

**[[Action]] Items**:
- [ ] [[Elena Rodriguez]]: Accelerate flight software development (target 85% by CDR) 📅 2026-03-01
- [ ] [[Elena Rodriguez]]: Evaluate radar altimeter for landing backup 📅 2026-01-31
- [ ] [[Elena Rodriguez]]: Continue HIL testing (target 50/100 by CDR) 📅 2026-03-01

### [[Avionics System]] PDR Assessment: ⚠️ **CONDITIONAL PASS**
- **Condition**: Flight software [[Must]] [[Reach]] 85% maturity by CDR
- **Mitigation**: Weekly progress reviews with Sarah Chen

## [[Structures System Design]] Review

**Presenter**: [[James Park]]

### Design Maturity: 65%

**[[Airframe Specifications]]**:
- Material: Aluminum 2219-T87 (flight-proven, good strength-to-weight)
- Diameter: 1.0m (fuselage)
- Length: 8.5m ([[Total]] vehicle)
- Mass: 450 kg dry, 900 kg fueled
- Fabrication: Friction stir welding (high-strength joints)

**Subsystem Status**:

| Subsystem | Maturity | Status | Notes |
|-----------|----------|--------|-------|
| [[Airframe Design]] | 70% | 🟢 | Design frozen, fabrication [[Starting Jan]] 2026 |
| [[Stage Separation]] | 60% | 🟢 | Pyrotechnic mechanism selected, tested |
| [[Landing System]] | 55% | 🟡 | Landing leg design in progress |
| Material selection | 100% | 🟢 | Aluminum 2219 selected and validated |
| Thrust structure | 75% | 🟢 | Engine mount design complete |

**[[Key]] [[Design Decisions]]**:
1. **Aluminum 2219** (vs [[Carbon]] [[Fiber]] or steel)
   - Flight-proven (Saturn V, [[Space Shuttle]] ET)
   - Good strength-to-weight (yield 400 MPa)
   - Easy to weld (friction stir welding)
   - Trade: Heavier than carbon fiber, [[But]] lower cost and risk

2. **Friction stir welding** (vs TIG welding)
   - Stronger joints (100% parent metal strength)
   - No porosity or cracking
   - Flight heritage (SpaceX, Blue Origin)

3. **4-leg [[Landing System]]** (vs 3-leg or parachute)
   - Stable on uneven terrain
   - Crush core shock absorbers (aluminum honeycomb)
   - Pneumatic deployment (GN2 actuators)

**[[Load Analysis]]**:
- Max axial load: 6g (re-entry deceleration)
- Max lateral load: 3g (wind shear during ascent)
- Landing impact: 2g (0.5 m/s touchdown velocity)
- [[Safety Factor]]: 1.4× (flight-proven for [[Launch]] vehicles)

**[[Finite Element Analysis]]**:
- Tool: [[ANSYS Mechanical]]
- Cases analyzed: Ascent, re-entry, landing, handling
- Maximum stress: 285 MPa (71% of yield strength)
- Margin of [[Safety]]: +40% (excellent)

**Remaining Work**:
- Landing leg fabrication (vendor [[Delivery Jan]] 2026)
- Friction stir welding of [[Primary Structure]] (Jan-Feb 2026)
- [[Environmental Testing]] (vibration, thermal) - Jun-[[Aug 2026]]

**External Reviewer Comments** (Dr. Lisa Anderson):
- ✅ "Aluminum 2219 is solid choice for this mission"
- ✅ "Friction stir welding is appropriate, well-proven"
- ⚠️ "Landing leg design maturity (55%) is low for PDR - [[Critical Path]] item"
- 💡 "Recommend load testing of [[One]] landing leg before fabricating all 4"

**Action Items**:
- [ ] [[James Park]]: Accelerate landing leg design (target 85% by CDR) 📅 2026-03-01
- [ ] [[James Park]]: Conduct load test of landing leg [[Prototype]] 📅 2026-02-15
- [ ] [[James Park]]: Complete friction stir welding qualification 📅 2026-01-31

### [[Structures System]] PDR Assessment: ⚠️ **CONDITIONAL PASS**
- **Condition**: Landing leg design must reach 85% maturity by CDR
- **Mitigation**: Prototype load testing by [[Feb 15]], 2026

## [[GNC System Design]] Review

**Presenter**: [[Elena Rodriguez]]

### Design Maturity: 60%

**GNC = Guidance, Navigation, Control**

**[[Guidance Algorithms]]**:
- [[Ascent Guidance]]: Gravity turn trajectory (fuel-optimal)
- [[Powered descent guidance]]: Convex [[Optimization]] (landing precision)
- Trajectory constraints: Max-Q limit, heating rate, load factor

**[[Navigation Algorithms]]**:
- [[Sensor fusion]]: [[Extended Kalman Filter]] (EKF)
- Inputs: IMU ([[Acceleration]], rotation), GPS (position, velocity), pressure (altitude)
- State estimation: Position, velocity, attitude, rotation rate
- [[Update Rate]]: 100 Hz

**[[Control Algorithms]]**:
- [[Attitude Control]]: PID with gain scheduling (varies with altitude)
- Altitude control: PID with feed-forward (engine thrust)
- Velocity control: PID with trajectory tracking
- [[TVC Control]]: ±5° [[Gimbal Range]], <10ms [[Response Time]]

**Subsystem Status**:

| Subsystem | Maturity | Status | Notes |
|-----------|----------|--------|-------|
| Guidance algorithms | 70% | 🟢 | Gravity turn validated, PDG in progress |
| Navigation algorithms | 75% | 🟢 | Kalman filter tuned and tested |
| Control algorithms | 65% | 🟢 | PID controllers tuned in HIL |
| [[Landing Algorithm]] | 50% | 🟡 | [[Powered Descent Guidance]] needs [[Validation]] |
| [[Trajectory optimization]] | 55% | 🟡 | Convex optimization solver in progress |

**[[Performance Validation]]** (Hardware-in-Loop):
- Ascent accuracy: ±150m apogee (within spec)
- Landing accuracy: ±100m (within spec, after Kalman filter tuning)
- Attitude control: ±0.5° (excellent)
- Max control effort: 60% TVC gimbal range (well within limits)

**Remaining Work**:
- Landing algorithm validation (20 more HIL flights)
- Trajectory optimization integration (completion Jan 2026)
- Sensor fusion tuning (GPS dropout scenarios)

**External Reviewer Comments** (Tom Mitchell):
- ✅ "Kalman filter design is sound, good sensor fusion"
- ⚠️ "Landing algorithm maturity (50%) is concerning for PDR"
- ⚠️ "[[Powered]] descent guidance is critical path - needs immediate attention"
- 💡 "Recommend dedicating resource to landing algorithm (hire consultant?)"

**Action Items**:
- [ ] [[Elena Rodriguez]]: Accelerate landing [[Algorithm Development]] 📅 2026-02-15
- [ ] [[Sarah Chen]]: Evaluate hiring GNC consultant for landing algorithm 📅 2026-01-10
- [ ] [[Elena Rodriguez]]: [[Complete 30]] more HIL flights focused on landing 📅 2026-03-01

### [[GNC System]] PDR Assessment: ⚠️ **CONDITIONAL PASS**
- **Condition**: Landing algorithm must reach 80% maturity by CDR
- **Mitigation**: Consider hiring external consultant, dedicate more HIL flights to landing

## [[Test Campaign Overview]]

**Presenter**: [[Sarah Chen]]

See [[ADR-004 Test Campaign]] and [[Test Campaign Overview]] for full details.

**[[Test Philosophy]]**: Incremental validation (component → subsystem → integrated → flight)

**[[Test Phases]]**:
1. **[[Component Testing]]** (Sep-[[Nov 2025]]) - ✅ Complete (100% pass rate)
2. **[[Subsystem Testing]]** ([[Dec 2025]] - Jan 2026) - 🔄 In Progress (80% complete)
3. **[[Hot Fire Testing]]** (Jan-Feb 2026) - ⏳ First test scheduled Jan 2026
4. **Hardware-in-Loop** ([[Oct 2025]] - May 2026) - 🔄 In Progress (15/100 complete)
5. **[[Integrated Testing]]** (Feb-May 2026) - ⏳ [[Planned
6]]. **Environmental Testing** (Jun-Aug 2026) - ⏳ Facilities booked

**Budget**: $800K total (5.7% of program budget)
- Spent to date: $325K (component + subsystem testing)
- Remaining: $475K (adequate for remaining tests)

**Schedule**: 🟢 On track for first flight Dec 2026

**External Reviewer Comments**:
- ✅ "Incremental test approach is appropriate and reduces risk" (Both reviewers)
- ✅ "HIL testing plan is comprehensive" (Tom Mitchell)
- 💡 "Consider adding more hot fire tests (currently 4 planned)" (Dr. Anderson)

**Action Items**:
- [ ] [[Sarah Chen]]: Evaluate adding 5th hot fire test (throttling validation) 📅 2026-01-15

## [[Risk Assessment]]

**Presenter**: [[Sarah Chen]]

See [[Risk Register]] for full risk tracking.

**Risk Summary**:

| Risk Level | Count | Top Risks |
|------------|-------|-----------|
| HIGH | 2 | R-003 (Turbopump delivery), R-007 (Flight software schedule) |
| MEDIUM | 8 | R-015 (Software qualification), R-021 (Hot fire anomaly), others |
| LOW | 15 | Various component/schedule risks |

**Top 3 Risks**:

1. **R-003: Turbopump Delivery Delay** (Score: 12, HIGH)
   - Impact: 6-month slip if turbopump delayed
   - Likelihood: Medium (vendor has good track record, but single-source)
   - Mitigation: Identify backup supplier (action item from propulsion review)

2. **R-007: Flight Software Schedule** (Score: 10, HIGH)
   - Impact: CDR delay if software not mature enough
   - Likelihood: Medium (currently 60% mature, target 85% by CDR)
   - Mitigation: Accelerate development, weekly progress reviews

3. **R-021: Hot Fire Test Anomaly** (Score: 9, MEDIUM)
   - Impact: Test campaign delay if anomaly requires redesign
   - Likelihood: Medium (first integrated hot fire is always risky)
   - Mitigation: Conservative test plan, extra instrumentation, abort criteria

**Risk Mitigation Progress**:
- 5 risks closed since Concept Review (Jun 2025)
- 3 risks reduced from HIGH to MEDIUM
- No new HIGH risks identified in past 3 months

**External Reviewer Comments**:
- ✅ "Risk register is comprehensive and well-maintained" (Both reviewers)
- ⚠️ "Turbopump single-source is concerning - backup supplier recommended" (Dr. Anderson)
- 💡 "Consider adding risk for FAA/AST licensing timeline" (Tom Mitchell)

**Action Items**:
- [ ] [[Sarah Chen]]: Add risk for FAA/AST launch license timeline 📅 2026-01-05

## [[Budget & Schedule Review]]

**Presenter**: [[Sarah Chen]]

### Budget Status

| Category | Budgeted | Spent | Remaining | % Spent |
|----------|----------|-------|-----------|---------|
| Hardware | $6.5M | $4.2M | $2.3M | 65% |
| Software | $2.0M | $1.1M | $0.9M | 55% |
| Testing | $0.8M | $0.3M | $0.5M | 41% |
| Labor | $3.5M | $2.3M | $1.2M | 66% |
| Facilities | $0.5M | $0.3M | $0.2M | 60% |
| Contingency | $0.7M | $0.2M | $0.5M | 29% |
| **Total** | **$14M** | **$8.4M** | **$5.6M** | **60%** |

**[[Budget Health]]**: 🟢 GREEN
- 60% spent at 33% timeline (slightly ahead, but within plan)
- Contingency reserve still healthy (71% remaining)
- No cost overruns to date

**[[Major Expenditures]] to Date**:
- Turbopump: $1.2M (largest single item)
- Flight computers + sensors: $0.8M
- Aluminum 2219 + fabrication: $0.6M
- Labor (6 months × 15 people): $2.3M

**[[Remaining Major Expenditures]]**:
- [[Landing Legs]]: $0.4M (vendor delivery Jan 2026)
- Environmental testing: $0.3M (Jun-Aug 2026)
- Launch [[Site]] fees: $0.3M (Dec 2026)
- Propellants (4 hot fires + flight): $0.2M

### [[Schedule Status]]

| Milestone | Planned | Forecast | Status |
|-----------|---------|----------|--------|
| Concept Review | [[Jun 2025]] | Jun 2025 | ✅ |
| PDR | [[Dec]] 2025 | Dec 2025 | ✅ (today) |
| First [[Hot]] Fire | Jan 2026 | Jan 2026 | 🟢 |
| CDR | [[Mar 2026]] | Mar 2026 | 🟢 |
| Integrated Testing | May 2026 | May 2026 | 🟢 |
| Environmental Testing | [[Jul 2026]] | Jul 2026 | 🟢 |
| First Flight | [[Dec 2026]] | Dec 2026 | 🟢 |

**[[Schedule Health]]**: 🟢 GREEN
- All milestones on [[Track]]
- 2-week contingency buffer built into [[Each]] phase
- Critical path: Propulsion hot fire testing → Integrated testing

**External Reviewer Comments**:
- ✅ "Budget and schedule [[Are]] realistic and well-tracked" ([[Both]] reviewers)

## [[External Reviewer Q&A]]

### Questions from Dr. Lisa Anderson (Propulsion)

**Q1**: "Why gas generator cycle instead of staged combustion for higher ISP?"
- **A (Marcus)**: "Mission delta-v [[Requirements]] allow 290s ISP. Staged combustion adds 3-6 months development time and $2M cost. Gas generator is lower risk, flight-proven, and adequate."

**Q2**: "[[What]]'s the backup plan if turbopump delivery is delayed?"
- **A (Marcus)**: "We'll identify a backup supplier by [[Jan 15]]. Worst case, we can delay first hot fire by 2 months and still make Dec 2026 flight target."

**Q3**: "[[Have]] [[You]] considered throttle-induced combustion instability?"
- **A (Marcus)**: "[[Yes]] - pintle injector is self-stable across 50-100% throttle range. We'll validate this in hot fire [[Tests 1]]-3 before attempting [[Restart Test]]."

### Questions from Tom Mitchell (Flight Software)

**Q4**: "60% software maturity seems low for PDR. What's the plan to [[Get]] to 85% by CDR?"
- **A (Elena)**: "We're adding 1 additional software [[Engineer]] (Jan start). Weekly progress reviews with Sarah. Prioritizing core flight functions (guidance, navigation, control) over nice-to-have [[Features]]."

**Q5**: "How will you validate the landing algorithm without actual flight?"
- **A (Elena)**: "Hardware-in-[[Loop Simulation]] with high-fidelity landing dynamics. We'll [[Run]] 50+ landing scenarios (nominal + off-nominal) to validate powered descent [[Guidance Algorithm]]."

**Q6**: "What's the fault tolerance [[Strategy]] if one flight computer crashes during flight?"
- **A (Elena)**: "Triple redundancy with [[Majority voting]]. If one computer crashes, remaining [[Two]] continue [[Via]] 2-of-2 consensus. If two crash, single computer continues but mission aborts ([[Safe]] landing without restart)."

## [[PDR Decision]]

### [[Summary of Findings]]

**Strengths**:
- ✅ Propulsion design is mature and well-validated (75% maturity)
- ✅ Hardware procurement is progressing well (80% complete)
- ✅ Budget and schedule are healthy (on track, on budget)
- ✅ [[Risk Management]] is comprehensive and proactive
- ✅ Test campaign is well-planned and incremental

**Areas of Concern**:
- ⚠️ Avionics software maturity (60%) is lower than desired
- ⚠️ Landing algorithm (50%) needs immediate attention
- ⚠️ Structures landing leg design (55%) is critical path
- ⚠️ Turbopump single-source supplier risk

**Conditions for CDR**:
1. Flight software must reach 85% maturity by CDR (Mar 2026)
2. Landing algorithm must reach 80% maturity by CDR
3. Landing leg design must reach 85% maturity by CDR
4. Backup turbopump supplier identified by Jan 15, 2026

### [[External Reviewer Recommendation]]

**Dr. Lisa Anderson (Propulsion)**: ✅ **APPROVE PDR**
- "Propulsion design is sound and ready for critical design phase. Recommend backup turbopump supplier and additional hot fire test for de-risking."

**Tom Mitchell (Flight Software)**: ⚠️ **CONDITIONAL [[Approval]]**
- "Avionics hardware is excellent, but software maturity is concerning. Approve PDR contingent on meeting software maturity conditions by CDR."

### [[Final Decision]]

**Sarah Chen (Chief Engineer)**: ✅ **PDR APPROVED - WITH CONDITIONS**

**Rationale**:
- Design is mature enough to proceed to CDR phase
- Areas of concern have clear mitigation plans
- Team has demonstrated capability to meet conditions
- External reviewers concur with conditional approval

**Conditions**:
1. ✅ Flight software 85% maturity by CDR (weekly reviews)
2. ✅ Landing algorithm 80% maturity by CDR (dedicated HIL flights)
3. ✅ Landing leg design 85% maturity by CDR (prototype load test)
4. ✅ Backup turbopump supplier identified by Jan 15

**[[Next Steps]]**:
- CDR scheduled for [[March 15]], 2026
- Weekly status reviews on software development
- Bi-weekly risk reviews
- First hot fire test scheduled Jan 2026

## [[Action Items Summary]]

**[[Marcus Johnson]] (Propulsion)**:
- [ ] Identify backup turbopump supplier 📅 2026-01-15
- [ ] Complete engine controller software integration 📅 2026-01-31

**[[Elena Rodriguez]] (Avionics)**:
- [ ] Accelerate flight software development (target 85% by CDR) 📅 2026-03-01
- [ ] Evaluate radar altimeter for landing backup 📅 2026-01-31
- [ ] Continue HIL testing (target 50/100 by CDR) 📅 2026-03-01
- [ ] Accelerate landing algorithm development 📅 2026-02-15
- [ ] Complete 30 more HIL flights focused on landing 📅 2026-03-01

**[[James Park]] (Structures)**:
- [ ] Accelerate landing leg design (target 85% by CDR) 📅 2026-03-01
- [ ] Conduct load test of landing leg prototype 📅 2026-02-15
- [ ] Complete friction stir welding qualification 📅 2026-01-31

**[[Sarah Chen]] (Program)**:
- [ ] Evaluate hiring GNC consultant for landing algorithm 📅 2026-01-10
- [ ] Evaluate adding 5th hot fire test (throttling validation) 📅 2026-01-15
- [ ] Add risk for FAA/AST [[Launch License]] timeline 📅 2026-01-05

## [[Related Notes]]

[[Systems]]:
- [[Propulsion System]] - Propulsion design review
- [[Avionics System]] - Avionics design review
- [[Structures System]] - Structures design review
- [[GNC System]] - GNC design review

[[Decisions]]:
- [[ADR-001 Propellant Selection]] - LOX/RP-1 selection
- [[ADR-002 Flight Computer]] - Triple redundancy
- [[ADR-003 Landing Strategy]] - [[Propulsive Landing]]
- [[ADR-004 Test Campaign]] - [[Test Approach]]
- [[ADR-005 Telemetry Protocol]] - Telemetry design

[[Project Management]]:
- [[Project Roadmap]] - [[Next]] milestone: [[CDR Mar]] 2026
- [[Risk Register]] - Risk tracking
- [[Budget Tracker]] - [[Financial]] status
- [[Team Roster]] - Team members

[[Test Documentation]]:
- [[Test Campaign Overview]] - Full [[Test Plan]]
- [[Engine Hot Fire Results]] - Upcoming first hot fire

---

*[[Meeting Notes]] by [[Sarah Chen]] - 2025-12-18*
*[[Outcome]]: PDR APPROVED - WITH CONDITIONS*
*[[Next Review]]: CDR - March 15, 2026*
