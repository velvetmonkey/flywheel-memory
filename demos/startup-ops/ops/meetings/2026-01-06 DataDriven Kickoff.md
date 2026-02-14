# [[2026-01-06 DataDriven Kickoff]]

[[Customer Onboarding]] kickoff call

[[Date]]: 2026-01-06 10:00am [[PST
Duration]]: 45 minutes
Client: [[DataDriven Co]]
Attendees: [[Alex Chen]], [[Sarah Johnson]] (Head of Analytics), [[Tom Wilson]] ([[IT Lead]])

## [[Agenda

1]]. Introductions (5 min)
2. [[DataDriven]]'s [[Use Case]] and goals (10 min)
3. Live walkthrough: Connect [[First]] [[Data]] source (15 min)
4. Create starter dashboard together (10 min)
5. [[Next Steps]] and [[Timeline]] (5 min)

## [[Meeting Notes]]

### Introductions

- Sarah: Head of Analytics, former BI analyst at manufacturing companies
- Tom: IT [[Lead]], manages data [[Infrastructure]]
- Us: Alex (CEO, [[Technical]]), Jamie (COO, customer success) - Jamie couldn't make it

### [[Use]] Case

DataDriven manufactures industrial sensors (vibration, temperature, pressure).

**[[Current Pain]]:**
- 3 legacy [[Systems]]: ERP (SAP), [[Quality Control]] ([[Custom]]), [[Production]] [[Monitoring]] (Siemens)
- No unified view
- Spreadsheet hell - Sarah spends 10 [[Hours]]/week manually pulling reports
- CEO asks for metrics → takes 2 days to compile

**Goals with [[MetricFlow]]:**
1. Real-time production dashboard (units/hour, yield %, downtime)
2. Quality [[Control]] [[Trends]] (defect rates by product line)
3. Predictive [[Maintenance]] (sensor [[Data Analysis]])
4. Executive dashboard ([[Top 5]] KPIs at-a-glance)

### [[Technical Setup]] ([[Live Demo]])

Connected first data source: Postgres warehouse (already has data from [[All 3]] systems!)

**[[What]] we did:**
1. [[Added]] connection credentials (read-[[Only]] user)
2. Tested connection ✓
3. Selected `production_metrics` table
4. [[Created]] first dashboard: "[[Daily Production Overview]]"
   - [[Chart 1]]: Units produced by hour (today)
   - [[Chart 2]]: Yield % by product line ([[This]] week)
   - [[Chart 3]]: [[Top]] 5 downtime reasons (this [[Month]])

Sarah's reaction: "This is amazing - we just created in 15 minutes what [[Would]] take me 2 days in Excel!"

### Questions & [[Concerns]]

**Q:** Can we schedule [[Automated]] reports?
**A:** [[Not]] yet - on roadmap for Q2. For [[Now]], we can manually export.

**Q:** Can we set up alerts (e.g., yield drops below 95%)?
**A:** Coming in Q1 (Feb [[Release]]). I'll add them to beta [[Testing]] list.

**Q:** [[Integration]] with Slack?
**A:** [[Yes]]! We [[Have]] a Slack bot for sharing dashboards. I'll set that up.

**Q:** Data refresh [[Frequency]]?
**A:** [[Every 5]] minutes by default. Can be real-time for enterprise plan ($1,999/mo).

### Next Steps

**This Week:**
- [ ] Alex: Set up Slack integration
- [ ] Sarah: Connect quality control data source
- [ ] Sarah: Invite 3 more users (production managers)
- [ ] Alex: Schedule follow-up call (Jan 14)

**Next 2 Weeks:**
- [ ] Sarah: Create 2 more dashboards (quality, maintenance)
- [ ] Tom: Review security/compliance requirements
- [ ] Alex: Add to beta list for alerts feature

**Month 1 Goal:**
- 5 dashboards live
- All 3 data sources connected
- 5 users actively using
- Saving Sarah 8+ hours/week

## Action Items

| Task | Owner | Due Date | Status |
|------|-------|----------|--------|
| Set up Slack integration | Alex | Jan 7 | Open |
| Invite 3 users | Sarah | Jan 9 | Open |
| Schedule follow-up call | Alex | Jan 14 | Open |
| Review security reqs | Tom | Jan 20 | Open |

## Upsell Potential

Sarah mentioned they have 3 other facilities that could use this. If this goes well, could expand from $499/mo → $1,999/mo (4 facilities).

**Timeline:** Q2 2026 expansion conversation

## [[Health Assessment]]

🟢 **Green** - Extremely engaged, clear use case, technical setup went smoothly

**Positive signals:**
- Sarah very excited
- Tom engaged and asking [[Good]] questions
- Already thinking about expansion
- Use case is perfect fit for our product

## [[Related]]

- Customer profile: [[DataDriven Co]]
- Playbook: [[Customer Onboarding]]
- Finance: Update [[MRR Tracker]] with expansion potential
- Product: [[Add Sarah]] to beta list for alerts [[Feature]]
