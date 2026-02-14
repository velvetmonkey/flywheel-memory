---
type: meeting
date: 2025-12-30
attendees:
  - "[[Sarah Chen]]"
  - "[[Marcus Johnson]]"
  - "[[Elena Rodriguez]]"
  - "[[James Park]]"
  - "All [[Team]] Members"
tags:
  - meeting
  - review
  - retrospective
  - year-end
---
# [[2025-12-30 Year End Review]]

## [[Meeting Info]]

**[[Date]]**: [[December 30]], 2025
**Time**: 14:00-16:00
**[[Location]]**: [[Main Conference Room]] + [[Remote]]
**Facilitator**: [[Sarah Chen]] ([[Chief Engineer]])

**Attendees**:
- [[Sarah Chen]] ([[Chief Engineer]])
- [[Marcus Johnson]] ([[Propulsion Lead]])
- [[Elena Rodriguez]] ([[Avionics Lead]])
- [[James Park]] ([[Structures Lead]])
- [[David Kim]] ([[Senior Propulsion Engineer]])
- [[All]] [[Team]] members (15 [[Total]])

## [[Purpose]]

Year-end review and retrospective for the [[Artemis Program]]. Celebrate accomplishments, review [[Lessons Learned]], and align on 2026 [[Priorities]].

## [[Agenda]]

1. 2025 [[Year in Review]]
2. [[Test Results Celebration]] ([[Tests 1]] & 2)
3. [[Accomplishments by Subsystem]]
4. Lessons [[Learned
5]]. [[Budget & Schedule Review]]
6. 2026 [[Priorities
7]]. [[Team Feedback]] & Retrospective

## 2025 [[Year in Review]]

**Presenter**: [[Sarah Chen]]

**[[Program Timeline]]** (2025 [[Milestones]]):
- **[[June 2025]]**: [[Concept Review]] - Program kickoff ✅
- **[[August 2025]]**: [[ADR-001 Propellant Selection|Propellant selection]] (LOX/RP-1) ✅
- **[[October 2025]]**: Component procurement 80% [[Complete]] ✅
- **[[November 2025]]**: [[ADR-002 Flight Computer|Flight computer architecture]] [[Defined]] ✅
- **[[December 2025]]**: [[2025-12-18 PDR Review|PDR]] approved (with conditions) ✅
- **December 2025**: [[Test 1]] & [[Test 2]] [[Hot]] fires successful! ✅

**[[Sarah Chen]]**: "[[When]] we started [[This]] program in June, [[Building]] a [[Launch]] vehicle in 18 months seemed ambitious. Six months later, I'm proud to say we're [[On Track]], [[On Budget]], and ahead on [[Some]] milestones. Let's take a [[Moment]] to celebrate [[What]] we've [[Accomplished]]."

## [[Test Results Celebration]] (Tests 1 & 2)

**Presenter**: [[Marcus Johnson]]

### [[Test 1]] - [[December 28]], 2025 (30-[[Second Burn]])

**[[Results]]**:
- ✅ Ignition: Clean start, 420ms delay ([[Excellent]])
- ✅ Thrust: 44.2 kN (98% of 45 kN [[Target]])
- ✅ ISP: 287s (99% of 290s target)
- ✅ [[Chamber Pressure]]: 8.2 MPa (96% of 8.5 MPa target)
- ✅ [[Cooling System]]: 580°C peak (70°C margin below limit)
- ✅ [[Turbopump]]: 32,100 RPM, smooth operation

**[[Marcus Johnson]]**: "[[Test 1]] was a complete success. The [[Engine]] lit on [[First]] attempt, ran smoothly for 30 seconds, and shut down cleanly. Every [[Performance]] parameter was within spec. Post-[[Test Inspection]] showed minimal wear - the engine is in excellent condition for [[Test 2]]."

**[[Team Reaction]]**: *Applause and cheers*

### [[Test 2]] - December 30, 2025 (60-second burn)

**Results** (preliminary, tested this [[Morning]]):
- ✅ Ignition: 445ms delay (consistent with [[Test]] 1)
- ✅ Thrust: 44.1 kN (sustained for [[Full]] 60s)
- ✅ ISP: 286s (consistent)
- ✅ Chamber pressure: 8.15 MPa (slightly lower, investigating)
- ✅ Cooling [[System]]: 590°C peak (60°C margin)
- ✅ Turbopump: No vibration, smooth throughout
- ✅ Endurance: No degradation over 60s burn

**Marcus Johnson**: "Test 2 this morning was equally successful. We doubled the [[Burn Duration]] to 60 seconds and the engine performed flawlessly. The slight [[Drop]] in chamber pressure (8.15 vs 8.2 MPa) is likely due to [[Mixture Ratio]] variation - we're analyzing the [[Data]] [[Now]]."

**[[David Kim]]**: "[[One]] observation: [[Ignition Delay]] is very consistent (420ms vs 445ms, [[Only]] 25ms variation). This [[Shows]] our ignition system is highly repeatable."

**Sarah Chen**: "[[Two]] successful hot fires in [[Three]] days. Outstanding work, [[Propulsion Team]]. This gives us tremendous confidence going into [[Test 3]] (120s burn) and [[Test 4]] ([[Restart Test]]) in January."

**Team Reaction**: *Standing ovation*

## [[Accomplishments by Subsystem]]

### [[Propulsion System]] (Marcus Johnson)

**[[Major Achievements]]**:
1. ✅ [[ADR-001 Propellant Selection|Propellant selected]]: LOX/RP-1 (August 2025)
2. ✅ [[Engine Design]] complete: [[Gas Generator]] cycle, pintle injector (October 2025)
3. ✅ [[Turbopump]] delivered 3 days early ([[December 20]])
4. ✅ [[Test 1]] & [[Test 2]] successful (December 28 & 30)
5. ✅ [[Engine Controller]] [[Software]] 90% complete (ahead of schedule)
6. ✅ [[Cooling System]] [[Validated]] in [[Hot Fire Testing]]

**[[Performance Metrics]]**:
- Component tests: 23/23 passed (100% [[Success Rate]])
- [[Hot Fire]] tests: 2/2 successful (100% success [[Rate]])
- Engine performance: 98-99% of target specs

**Marcus Johnson**: "The propulsion team delivered on every commitment this year. We're ahead of schedule on [[Engine Controller]] software and exceeded [[Expectations]] on hot fire [[Testing]]. I'm particularly proud of the team's [[Holiday]] [[Coverage]] - testing on [[Dec 28]] and [[Dec 30]] [[Required]] dedication."

**[[Challenge Overcome]]**: Turbopump single-source supplier [[Risk]] mitigated (backup supplier [[Identified]])

### [[Avionics System]] ([[Elena Rodriguez]])

**Major [[Achievements]]**:
1. ✅ [[ADR-002 Flight Computer|Flight computer architecture]] defined: [[Triple redundancy]] (November 2025)
2. ✅ [[Flight Software]] 85% complete (met PDR condition!)
3. ✅ [[Hardware-in-Loop]] testing: 47 flights, 96% success rate
4. ✅ [[ADR-005 Telemetry Protocol|Telemetry protocol]] designed (December 2025)
5. ✅ [[CAN Bus]] wiring harness complete and tested
6. ✅ All sensors procured and integrated

**Performance Metrics**:
- HIL success rate: 96% (45/47 successful flights)
- [[Flight Software]] maturity: 85% (exceeded PDR target of 85%)
- [[Control Loop]] jitter: 3.2ms (within <5ms requirement)

**Elena Rodriguez**: "Avionics started the year with a blank slate and ended with a flight-[[Ready]] [[Architecture]]. We met the conditional PDR [[Approval]] requirement (85% software maturity) and our HIL success rate is outstanding. The two HIL failures were valuable - we [[Found]] and fixed critical bugs in [[Sensor Fusion]] and [[Voting Logic]]."

**Challenge Overcome**: Accelerated software development from 60% (PDR) to 85% (year-end) in 2 [[Weeks]]

### [[Structures System]] ([[James Park]])

**Major Achievements**:
1. ✅ [[ADR-003 Landing Strategy|Landing strategy]] approved: [[Propulsive landing]] (November 2025)
2. ✅ [[Airframe Design]] complete: [[Aluminum 2219]], friction stir welding (December 2025)
3. ✅ [[Thrust structure]] [[Design]] 85% complete (met PDR condition!)
4. ✅ [[Landing System|Landing legs]] designed: 4-leg configuration with crush [[Core]] absorbers
5. ✅ [[Material Selection]] validated: [[Al 2219]] flight-proven
6. ✅ [[Finite Element Analysis]] complete: All load cases analyzed

**Performance Metrics**:
- Structural margin: +40% (excellent [[Safety Factor]])
- [[Design Maturity]]: 75% overall (up from 65% at PDR)
- Landing leg design: 85% (met PDR target)

**[[James]] Park**: "Structures made solid progress this year. We finalized the [[Airframe Design]], met the PDR condition on landing leg maturity, and validated our material selection through FEA. Fabrication starts in January - the [[Next]] 3 months will be intense [[But]] we're ready."

**Challenge Overcome**: Landing leg design accelerated from 55% (PDR concern) to 85% (on [[Track]])

### [[GNC System]] (Elena Rodriguez)

**Major Achievements**:
1. ✅ [[Guidance Algorithms]]: Gravity turn validated in HIL
2. ✅ [[Navigation Algorithms]]: [[Kalman filter]] tuned and tested
3. ✅ [[Control Algorithms]]: [[PID controllers]] tuned to ±0.5° accuracy
4. ✅ [[Landing Algorithm]]: [[Powered Descent Guidance]] 70% complete (up from 50%)
5. ✅ [[Trajectory Optimization]]: [[Integration 80]]% complete

**Performance Metrics**:
- HIL landing accuracy: ±100m (within spec)
- [[Attitude Control]]: ±0.5° (excellent)
- [[Landing Algorithm]] maturity: 70% (still work needed to [[Hit 80]]% by CDR)

**Elena Rodriguez**: "GNC made [[Good]] progress but we're [[Not]] where we [[Need]] to be yet. Landing algorithm is at 70% (target 80% by CDR). We need to accelerate in Q1 2026. The good [[News]] is our core GNC algorithms [[Are]] solid - [[Ascent Guidance]] and [[Control]] are [[Working]] beautifully in HIL."

**[[Challenge Ahead]]**: Landing algorithm needs dedicated [[Focus]] in January-February

## [[Lessons Learned]]

**Presenter**: [[Sarah Chen]]

### [[What Went Well]]

1. **[[Incremental Testing Strategy]]** ([[ADR-004 Test Campaign]])
   - Component tests first → found issues early and cheap
   - [[HIL Testing]] caught 2 critical bugs before [[Hardware Integration]]
   - Hot fire tests 1 & 2 successful because [[Components]] pre-validated

2. **[[Decision Documentation]]** ([[ADRs]])
   - 5 ADRs written: Propellant, [[Flight Computer]], Landing, [[Test Campaign]], [[Telemetry]]
   - Forced us to think through alternatives rigorously
   - [[External Reviewers]] praised decision quality at PDR

3. **[[External Review Early]]** (PDR in [[Month 6]])
   - PDR feedback identified 3 areas needing attention (software, landing leg, landing algorithm)
   - Conditional approval gave us clear targets to hit
   - 2 months to address [[Concerns]] before CDR (adequate time)

4. **[[Team Dedication]]**
   - Holiday coverage for Test 1 & 2 (team worked [[Dec 26]]-30)
   - Weekly standups kept everyone aligned
   - No turnover - all 15 team members still here

**Sarah Chen**: "Our process is working. [[Incremental Testing]], rigorous decision-making, and external review early gave us the structure to succeed."

### [[What Didn]]'t [[Go Well]]

1. **[[Software Schedule Optimism]]**
   - Underestimated flight [[Software Complexity]] at program start
   - Needed to accelerate from 60% → 85% in 2 weeks (stressful for Elena's team)
   - Lesson: Pad software schedules more in future programs

2. **[[Landing Algorithm Late Start]]**
   - Landing algorithm work started too late (October vs June)
   - Now playing catch-up to hit 80% by CDR (March)
   - Lesson: [[Critical Path]] items need earlier focus

3. **Single-[[Source Turbopump Risk]]**
   - Turbopump delivered [[On Time]], but single-source supplier was risky
   - [[Should]] [[Have]] identified backup supplier earlier
   - Lesson: Dual-source critical components from day 1

4. **[[Communication]] with Contractors**
   - Some delays [[Getting]] info from landing leg vendor
   - Weekly check-ins [[Would]] have caught issues earlier
   - Lesson: More frequent vendor touchpoints

**Sarah Chen**: "[[These]] lessons [[Learned]] will make us better in 2026. No major failures, just areas to tighten up our process."

### Team Feedback

**Marcus Johnson** (Propulsion): "Test campaign cadence is intense - 4 hot fires in 6 weeks (Jan-Feb). Team will need support and rest periods."

**Elena Rodriguez** (Avionics): "Software team is [[Stretched]] thin. We need to hire 1 more software [[Engineer]] in Q1 to avoid burnout."

**James Park** (Structures): "Fabrication [[Timeline]] is [[Aggressive]] (Jan-Feb). Need to lock in vendor schedules now to avoid slips."

**David Kim** ([[Test Engineering]]): "Test stand booking conflicts in January. We have slots for [[Tests 3]] & 4 but no buffer. Need backup dates."

**Sarah Chen**: "Noted. [[Action Items]]:
- [ ] Hire additional software engineer (Elena to [[Lead]], target [[Jan 15]] start)
- [ ] Lock in fabrication vendor schedules (James, by [[Jan 5]])
- [ ] Book backup test stand slots (David, by Jan 5)"

## [[Budget & Schedule Review]]

**Presenter**: [[Sarah Chen]]

### [[Budget Status]] (End of 2025)

| Category | Budgeted | Spent (2025) | % Spent |
|----------|----------|--------------|---------|
| [[Hardware]] | $6.5M | $4.8M | 74% |
| Software | $2.0M | $1.3M | 65% |
| Testing | $0.8M | $0.4M | 50% |
| Labor | $3.5M | $1.8M | 51% |
| Facilities | $0.5M | $0.3M | 60% |
| Contingency | $0.7M | $0.2M | 29% |
| **Total** | **$14M** | **$8.8M** | **63%** |

**[[Budget Health]]**: 🟢 GREEN
- 63% spent [[After]] 6 months (on [[Pace]])
- Contingency reserve healthy (71% remaining)
- No major overruns

**Sarah Chen**: "We're 6 months into an 18-[[Month]] program and we've spent 63% of budget. That's slightly ahead of linear pace (50%), but within plan. Propulsion hot fires ($400K spent) are front-loaded, so this is expected."

### [[Schedule Status]]

| Milestone | Target | Actual | [[Status]] |
|-----------|--------|--------|--------|
| [[Concept Review]] | [[Jun 2025]] | Jun 2025 | ✅ On Time |
| PDR | [[Dec 2025]] | [[Dec 18]], 2025 | ✅ On Time |
| Test 1 (30s) | [[Dec]] 2025 | Dec 28, 2025 | ✅ On Time |
| Test 2 (60s) | Dec 2025 | Dec 30, 2025 | ✅ On Time |
| **2026 Milestones** | | | |
| [[Test 3]] (120s) | [[Jan 2026]] | [[Forecasting Jan]] 2 | 🟢 On Track |
| [[Test 4]] (restart) | Jan 2026 | Forecasting Jan 15 | 🟢 On Track |
| CDR | [[Mar 2026]] | [[Forecasting Mar]] 15 | 🟢 On Track |
| [[First Flight]] | [[Dec 2026]] | [[Forecasting Dec]] 15 | 🟢 On Track |

**[[Schedule Health]]**: 🟢 GREEN
- [[All 2025]] milestones met on time
- 2026 forecast on track
- 2-week buffer in [[Each]] [[Phase]]

**Sarah Chen**: "Schedule is healthy. We have delivered every milestone on time in 2025. Looking forward to 2026, I'm confident we'll maintain this pace."

## 2026 [[Priorities]]

**Presenter**: [[Sarah Chen]]

### [[Q1 2026]] (Jan-Mar): [[Critical Design Phase]]

**[[Top Priorities]]**:
1. **[[Complete Hot Fire Testing]]** (Jan-Feb)
   - Test 3: 120-second burn ([[Jan 2]])
   - Test 4: Restart test (Jan 15)
   - Validate engine endurance and restart capability

2. **[[Accelerate Landing Algorithm]]** (Jan-Feb)
   - Dedicated HIL flights (50+ landing scenarios)
   - Hit 80% maturity by CDR ([[March 15]])
   - [[Consider]] external GNC consultant if needed

3. **[[Airframe Fabrication]]** (Jan-Feb)
   - Friction stir welding of [[Primary Structure]]
   - Landing leg delivery and [[Integration]] ([[Jan 20]])
   - [[Thrust structure]] completion (Jan 15)

4. **[[CDR Preparation]]** (Feb-Mar)
   - Address all PDR conditions (software, landing leg, landing algorithm)
   - Finalize [[Design Documentation]]
   - [[External Reviewer]] coordination

5. **[[Flight Software Completion]]** (Jan-Feb)
   - [[Reach 95]]% maturity by CDR
   - Complete landing algorithm integration
   - 100 HIL flights total (53 remaining)

### [[Q2 2026]] (Apr-Jun): Integration & [[Environmental Testing]]

**[[Top]] Priorities**:
1. **[[Integrated Vehicle Assembly]]** (Apr-May)
   - Mate engine to airframe
   - Integrate avionics and flight computer
   - Propellant [[Loading]] rehearsals

2. **Environmental Testing** (Jun)
   - [[Vibration Testing]] ([[Jun 15]]-20)
   - [[Thermal Vacuum Testing]] ([[Jul 10]]-15)
   - [[Acoustic Testing]] (Aug, TBD)

3. **FAA/AST [[Launch License]]** (Apr-Jun)
   - Submit application ([[Feb 1]])
   - Coordinate review process
   - [[Range Safety Approval]]

### [[Q3-Q4 2026]] (Jul-Dec): [[Flight Readiness]]

**Top Priorities**:
1. **[[Flight Readiness Review]]** ([[Oct 15]])
2. **[[Dress Rehearsal]]** (Sep, wet rehearsal)
3. **First Flight** ([[Dec 15]], target)

**Sarah Chen**: "2026 is the year we fly. Q1 is about finishing design and testing subsystems. Q2 is integration. Q3-Q4 is flight readiness. If we execute like we did in 2025, we'll achieve first flight in December."

## [[Team Retrospective]]

**Format**: Anonymous feedback (collected [[Via]] survey before meeting)

### What the [[Team Said]] ([[Aggregated]])

**[[Positives]]**:
- "Clear [[Leadership]] and decision-making" ([[Mentioned]] by 12/15 team members)
- "[[Collaborative]] culture, everyone helps each other" (10/15)
- "Celebrating [[Wins]] (Test 1 & 2 success)" (9/15)
- "Transparent communication (weekly standups, open discussions)" (8/15)

**Areas for Improvement**:
- "Need more rest between intense periods" (6/15)
- "Hire more people - some teams are stretched thin" (5/15)
- "Better work-life balance (holiday testing was tough)" (4/15)
- "More [[Documentation]] time (rushing to write ADRs [[Last]] minute)" (3/15)

**Sarah Chen's Response**:
- ✅ Acknowledge holiday testing was tough - team will [[Get]] comp time in January
- ✅ Hiring: Will add 1 software engineer in Jan, 1 [[Test Engineer]] in Feb
- ✅ Work-life balance: Build in rest weeks after major milestones
- ✅ Documentation: [[Allocate 20]]% time for ADR writing, [[Don]]'t rush it

**Team Reaction**: *Appreciation for Sarah's responsiveness*

## [[Closing Remarks]]

**Sarah Chen**: "Before we close, I want to say thank [[You]]. This team has accomplished [[Something]] remarkable in 2025. We started with an empty spreadsheet in June and ended with a rocket engine that's fired [[Successfully]] twice. We're [[On Schedule]], on budget, and on track to fly in 2026.

I know the pace is intense and 2026 will be even busier. But I have complete confidence in this team. We've proven we can design rigorously ([[ADRs]]), test incrementally ([[test campaign]]), and deliver on time (PDR, Tests 1 & 2).

Enjoy the New Year break - you've earned it. [[See]] you on January 2nd for [[2026-01-02 Sprint Planning|Sprint Planning]]. Let's make 2026 the year we fly."

**Team**: *Applause*

## [[Action Items]]

| Owner | Task | [[Due Date]] |
|-------|------|----------|
| [[Elena Rodriguez]] | Hire additional software engineer | 📅 2026-01-15 |
| [[James Park]] | Lock in fabrication vendor schedules | 📅 2026-01-05 |
| [[David Kim]] | Book backup test stand slots (Tests 3 & 4) | 📅 2026-01-05 |
| [[Sarah Chen]] | Comp time policy for holiday testing team | 📅 2026-01-05 |

## [[2025 Metrics Summary]]

**[[Program Health]]**:
- Budget: 🟢 On target (63% spent, 6 of 18 months)
- Schedule: 🟢 On time (100% milestones met)
- [[Technical]]: 🟢 [[Strong]] (Tests 1 & 2 successful, PDR approved)
- Team: 🟢 Healthy (no turnover, [[High]] morale)

**[[Test Results]]**:
- Component tests: 23/23 passed (100%)
- Hot fire tests: 2/2 successful (100%)
- HIL flights: 47 flights, 96% success rate

**Design Maturity**:
- Propulsion: 75% → 85% (ahead of plan)
- Avionics: 70% → 85% (met PDR condition)
- Structures: 65% → 75% (on track)
- GNC: 60% → 70% (needs [[Acceleration]])

**[[Risk Summary]]**:
- HIGH risks: 2 → 1 ([[Turbopump Risk]] reduced)
- [[Medium Risks]]: 8 ([[Stable]])
- [[Low Risks]]: 15 (stable)

## [[Related Notes]]

[[Milestones]]:
- [[2025-12-18 PDR Review]] - [[Preliminary Design Review]] [[Outcome]]
- [[Test 1]] & [[Test 2]] - [[Hot Fire Test Results]] ([[Documented]] in [[Engine Hot Fire Results]])
- [[Concept Review]] (June 2025) - Program kickoff

[[Decisions]]:
- [[ADR-001 Propellant Selection]] - LOX/RP-1
- [[ADR-002 Flight Computer]] - Triple [[Redundancy]]
- [[ADR-003 Landing Strategy]] - [[Propulsive Landing]]
- [[ADR-004 Test Campaign]] - Incremental testing
- [[ADR-005 Telemetry Protocol]] - [[Custom Binary Protocol]]

[[Systems]]:
- [[Propulsion System]] - 2025 accomplishments
- [[Avionics System]] - Software progress
- [[Structures System]] - Landing leg design
- [[GNC System]] - Landing [[Algorithm Status]]

[[Project Management]]:
- [[Project Roadmap]] - 2026 milestones
- [[Risk Register]] - [[Risk Trends]]
- [[Budget Tracker]] - [[Financial]] status
- [[Team Roster]] - Team [[Composition]]

[[Test Documentation]]:
- [[Engine Hot Fire Results]] - Tests 1 & 2 data
- [[Test Campaign Overview]] - 2026 [[Test Plan]]
- [[Avionics Integration Test]] - HIL results

---

*[[Meeting Notes]] by [[Sarah Chen]] - 2025-12-30*
*[[Next Meeting]]: [[2026-01-02 Sprint Planning]] (Jan 2, 2026)*
*Happy New [[Year 2026]]! 🚀*
