# Carter Strategy Demo Video Script (5 minutes)

Filmed from Telegram (phone or desktop split-screen), with Obsidian visible showing the graph sidebar + note content updating. Each beat is a message to @carterstrategybot.

## Setup

- Delete `daily-notes/2026-03-20.md` if it exists
- Restart flywheel-demo service: `sudo systemctl restart flywheel-demo`
- Open Obsidian with carter-strategy vault visible (graph sidebar open)
- Open Telegram with @carterstrategybot chat

---

## Beat 1: "What's my billing situation?" (0:00-0:50)

**Send:**
> What's outstanding on billing? Any overdue invoices I need to chase?

**Expected response covers:**
- INV-2025-048: $12K, Acme Corp, 64 days overdue
- INV-2026-001: $18K, Acme Corp, 33 days overdue
- INV-2026-002: $15K, Acme Corp, 5 days overdue
- INV-2026-006: $7.5K, TechStart Inc, due today
- Total outstanding: ~$52.5K across 2 clients
- Flags Acme Corp pattern (3 invoices, $45K total overdue)

**Why flashy:** Recall synthesizes from 8 invoice notes + 2 client notes without being told where to look.

---

## Beat 2: "Chase Acme + log it" (0:50-1:40)

**Send:**
> Add tasks to chase Sarah Mitchell at Acme about those three overdue invoices, and separately remind me to check in with Mike Chen at TechStart about today's invoice. Both due Wednesday.

**Expected behavior:**
- Creates daily note via `create-daily-note` policy
- Adds 2 tasks to `## Tasks` section
- Auto-wikilinks: [[Sarah Mitchell]], [[Acme Corp]], [[Mike Chen]], [[TechStart Inc]]
- Graph sidebar shows connections

---

## Beat 3: "Project update - THE SHOWSTOPPER" (1:40-3:10)

**Send (long message - paste this):**
> Had a really productive call with Sarah Mitchell and James Rodriguez from Acme Corp this morning about the Data Migration cutover. Great news — UAT is fully complete. All the validation scripts Marcus Webb wrote passed across every table, and the performance benchmarks show we're hitting the 3x improvement target we originally set during the Discovery Workshop back in October. Marcus has confirmed the Airflow pipelines are rock solid and all the rollback procedures are documented in the Data Migration Playbook. We've locked in March 28-29 as the cutover window — Sarah is getting final sign-off from Emily Chen on production environment access. One risk flag: James says the legacy Oracle system decommission timeline still hasn't been confirmed by their IT team. I've asked him to escalate to his director. If we can't get a firm date by next Friday we may need to run both systems in parallel during the support window, which would push costs beyond the original $75K budget — probably an extra $8-10K for Marcus's time. On a more positive note, Sarah mentioned the Acme Analytics Add-on proposal I drafted has been circulating with their finance team and getting good reception. She wants to schedule a scoping call with Emily Chen and their data team right after cutover wraps up. I told her Priya Kapoor would be ideal for the requirements gathering given her financial modeling background. Also need to update the Rate Card — Marcus's rate is going up to $220/hr from April, and we should reflect Leila Farouk's rates for the Nexus Health engagement. Speaking of Nexus Health — Tom Huang emailed back confirming they want to proceed with the Cloud Assessment. He wants to start as soon as Leila is available. I need to check with Leila on her April availability and get the proposal finalized. Mike Chen from TechStart gave them a strong reference which definitely helped close it. Finally, Dan Oliveira pinged me about the Beta Corp Dashboard — he's finished the Pipeline module and wants to demo it to Stacy Thompson before the client presentation next Wednesday.

**Expected behavior:**
- Daily note already exists from Beat 2 (policy idempotent)
- Adds content to `## Notes` section
- Auto-wikilinks fire on 15+ entities: Sarah Mitchell, James Rodriguez, Acme Corp, Acme Data Migration, Marcus Webb, Discovery Workshop Template, Data Migration Playbook, Emily Chen, Acme Analytics Add-on, Priya Kapoor, Rate Card, Leila Farouk, Nexus Health, Tom Huang, Mike Chen, TechStart Inc, Dan Oliveira, Beta Corp Dashboard, Stacy Thompson
- Graph sidebar explodes with connections

**Why flashy:** THE showstopper. 15-20 entities auto-linked from natural prose. Obsidian graph literally grows in real time.

---

## Beat 4: "Assign team to Nexus Health" (3:10-3:50)

**Send:**
> Great, sounds like Nexus Health is a go. Assign Leila Farouk as the cloud and security lead and Priya Kapoor for the HIPAA compliance analysis. Update their profiles and the proposal. Also add a task to finalize the proposal by end of next week.

**Expected behavior:**
- Updates Leila Farouk note (Nexus Health as upcoming project)
- Updates Priya Kapoor note (assigned to Nexus Health)
- Updates Nexus Health Cloud Assessment proposal (team assignments)
- Adds task: finalize Nexus Health proposal by 2026-03-28
- Cross-entity wikilinks connect everything

**Why flashy:** One instruction triggers 3 note updates + 1 task creation.

---

## Beat 5: "Pipeline check" (3:50-4:30)

**Send:**
> /pipeline

**Expected response synthesizes:**
- **Active engagements:**
  - Acme Data Migration — cutover March 28, $75K budget, 60% billed
  - Beta Corp Dashboard — 60% dev, demo next week, $28K budget, 76% billed
  - TechStart Phase 2 — multi-tenant 70% done, $45K budget, 28% billed
- **Pending proposals:**
  - Nexus Health Cloud Assessment — $22K, team assigned, starting April
  - Acme Analytics Add-on — $35K, gaining traction post-cutover
  - Meridian Financial API Modernization — $60K, intro meeting March 25
- **Total pipeline:** $117K in proposals
- **Outstanding billing:** $52.5K (flag overdue)
- **Team utilization:** Marcus 90%, Stacy 80%, Dan 60%, Priya/Leila incoming

---

## Beat 6: "Graph reveal" (4:30-5:00)

**Visual only (no message). Switch focus to Obsidian. Show:**
1. Today's daily note with all wikilinks rendered
2. Graph sidebar context cloud — color-coded pills
3. Native graph view zoomed out — dense web of connections
4. Click an entity (Sarah Mitchell) — sidebar redraws showing HER connections

**Voiceover:**
> "Every message enriched the knowledge graph. Tasks link to people and invoices. Project updates connect team members to deliverables and knowledge assets. The system learns what matters — entities you mention together get boosted in future suggestions."

---

## Vault Stats for Reference

| Category | Count |
|----------|-------|
| Team members | 6 (Sarah Mitchell, Stacy Thompson, Marcus Webb, Priya Kapoor, Dan Oliveira, Leila Farouk) |
| Clients | 5 (Acme Corp, TechStart Inc, GlobalBank, Nexus Health, Meridian Financial) |
| Projects | 6 (Acme Data Migration, Beta Corp Dashboard, TechStart Phase 2, TechStart MVP Build, GlobalBank API Audit, Cloud Strategy Template) |
| Proposals | 4 (Nexus Health Cloud Assessment, Meridian Financial API Modernization, Acme Analytics Add-on, TechStart Phase 2) |
| Invoices | 8 (INV-2025-047, INV-2025-048, INV-2026-001 through INV-2026-006) |
| Knowledge | 5 (Rate Card, Data Migration Playbook, Discovery Workshop Template, API Security Checklist, Subcontractor Management Guide) |
| **Total entities** | **~47 notes** |
