# Carter Strategy Demo Video Script (~5 minutes)

Single demo combining voice input + ambient capture + graph growth. Three-panel layout, five beats, voice-native via Wispr Flow.

**Tagline:** "Just talk. Your vault remembers."

**Key framing:** This demo sells what happens in the vault, not the Telegram bot. Flywheel-engine handles the interaction — the bot layer is hand-waved. The viewer sees natural conversation on the left, structured knowledge accumulating in the centre, and a graph growing on the right. They think: "I could plug this into my workflow."

**Centre panel insight:** The daily note shows ambient capture. Every Q&A exchange is automatically logged in the engine's structured format (timestamps, tool metadata, auto-wikilinks). Nobody says "save this" or "log that." It just accumulates.

---

## Layout

```
+--------------+------------------+-------------+
|   TELEGRAM   |   OBSIDIAN NOTE  |   CRANK     |
|   + Wispr    |   (daily note)   |   GRAPH     |
|              |                  |   PANEL     |
|  Left 30%   |   Centre 40%     |  Right 30%  |
+--------------+------------------+-------------+
```

---

## Setup

- Delete `daily-notes/` contents if any exist from previous runs
- Restart flywheel-demo service: `sudo systemctl restart flywheel-demo`
- Open Obsidian with carter-strategy vault visible
- Open Crank graph panel on right sidebar
- Open Telegram with bot chat visible (clear history for clean start)
- Wispr Flow active for voice input
- Dark mode on Telegram (better contrast on camera)

---

## Beat 1: "Wake up" (0:00-0:30)

**Hero panel: RIGHT (graph)**

**Voice (crisp, casual):**
> "Brief me on what's happening"

| Panel | What the viewer sees |
|-------|---------------------|
| LEFT | Message appears in Telegram, bot response streams back with vault pulse + active entities |
| CENTRE | Daily note appears with first Q&A entry auto-logged — timestamps, wikilinks already rendered |
| RIGHT | Graph panel loads entity constellation from brief context — shows existing knowledge base |

**What this proves:** The agent already has context. No warmup. No "let me read your files." The graph shows a pre-existing knowledge base.

**Editor:** Speed through the brief response. Show just enough that viewers can see entity names and stats, then cut. Ambient intro music begins.

---

## Beat 2: "What's outstanding?" (0:30-1:15)

**Hero panel: LEFT (Telegram response)**

**Voice:**
> "What's outstanding on billing? Any overdue invoices I should be chasing?"

| Panel | What the viewer sees |
|-------|---------------------|
| LEFT | Bot response rolls in — invoice list with amounts, overdue flags, Acme Corp pattern detected (3 invoices, $45K total overdue) |
| CENTRE | Second Q&A entry auto-logged — question + billing response with wikilinked invoice references (INV-2025-048, INV-2026-001, etc.) |
| RIGHT | Context cloud subtly highlights billing-related entities |

**Expected response covers:**
- INV-2025-048: $12K, Acme Corp, 64 days overdue
- INV-2026-001: $18K, Acme Corp, 33 days overdue
- INV-2026-002: $15K, Acme Corp, 5 days overdue
- INV-2026-006: $7.5K, TechStart Inc, due today
- Total outstanding: ~$52.5K across 2 clients
- Flags Acme Corp pattern

**What this proves:** Recall synthesises from 8 invoice notes + 2 client notes without being told where to look. The agent spots patterns.

**Editor:** Let this response play at a readable pace — it's the first "wow, it knows things" moment. Maybe 60-70% speed.

---

## Beat 3: "Take action" (1:15-2:00)

**Hero panel: CENTRE (daily note comes alive)**

**Voice:**
> "Add tasks to chase Sarah Mitchell at Acme about those three overdue invoices, and separately remind me to check in with Mike Chen at TechStart about today's invoice. Both due Wednesday."

| Panel | What the viewer sees |
|-------|---------------------|
| LEFT | Bot confirms task creation |
| CENTRE | Third Q&A entry auto-logged, PLUS tasks appear in Tasks section — all wikilinked: [[Sarah Mitchell]], [[Acme Corp]], [[Mike Chen]], [[TechStart Inc]] |
| RIGHT | Graph updates — new connections appear (Sarah Mitchell <-> Acme Corp <-> invoices) |

**What this proves:** Voice command -> structured tasks with auto-wikilinks. The daily note goes from sparse to structured. The graph grows.

**Editor:** This is the first "all three panels moving" moment. Let it breathe for a beat after the tasks appear. The viewer needs a second to process that all three panels just changed from one voice command.

---

## Beat 4: "The voice dump" -- SHOWSTOPPER (2:00-3:30)

**Hero panel: ALL THREE**

**Voice (natural, stream-of-consciousness -- this should sound like someone debriefing after a call, not reading a script):**

> "Just got off a really productive call with Sarah Mitchell and James Rodriguez at Acme about the data migration cutover. UAT is fully complete -- Marcus Webb's validation scripts passed across every table and we're hitting the 3x performance target from the Discovery Workshop. Marcus confirmed the Airflow pipelines are solid and rollback procedures are documented in the Playbook.
>
> We've locked March 28-29 for cutover. Sarah's getting sign-off from Emily Chen on production access. One risk -- James says the legacy Oracle decommission timeline hasn't been confirmed by IT. I've asked him to escalate. If we don't get a date by next Friday we might need to run parallel, which would push costs beyond the 75K budget, probably an extra 8 to 10K.
>
> Good news though -- Sarah mentioned the Analytics Add-on proposal is circulating with their finance team. She wants to scope it with Emily after cutover. I said Priya Kapoor would be ideal for that.
>
> Oh, and update the Rate Card -- Marcus is going up to 220 an hour from April. Leila's rates need adding too for the Nexus Health engagement. Tom Huang confirmed Nexus wants to proceed with the Cloud Assessment once Leila's available. Need to check her April schedule.
>
> Last thing -- Dan Oliveira pinged about the Beta Corp Dashboard. Pipeline module's done, wants to demo to Stacy Thompson before the client presentation Wednesday."

| Panel | What the viewer sees |
|-------|---------------------|
| LEFT | Long message appears via Wispr transcription, bot processes and responds with structured summary of actions taken |
| CENTRE | Massive Q&A entry auto-logged — 15+ blue wikilinks appear in the transcript: Sarah Mitchell, James Rodriguez, Acme Corp, Acme Data Migration, Marcus Webb, Discovery Workshop Template, Data Migration Playbook, Emily Chen, Acme Analytics Add-on, Priya Kapoor, Rate Card, Leila Farouk, Nexus Health, Tom Huang, Mike Chen, TechStart Inc, Dan Oliveira, Beta Corp Dashboard, Stacy Thompson |
| RIGHT | Graph EXPLODES — new nodes appear, connections multiply. The contextual cloud fills with entity names. |

**What this proves:** One natural voice dump -> 15-20 auto-linked entities, structured logging, graph growth. The system understood names, projects, money, risks, and relationships from casual speech.

**Voice delivery tips:**
- Natural pace, consultant-talking-to-assistant cadence, not reading
- Pause naturally. Say "um" once if it feels right
- Say "Oh, and" before the Rate Card bit — conversational pivot
- "Last thing" signals the close — slightly faster, wrapping up

**Editor:** This is the money shot. Three phases:
1. Show the voice input at real speed (or 80%) — the viewer needs to feel the naturalness
2. Speed up the processing (2-3x) — never show dead air
3. SLOW DOWN for the reveal — the daily note filling up and the graph expanding should play at real speed or even slightly slower. Let the viewer count the blue wikilinks. Let the graph animation complete. Hold for 2-3 seconds after.

---

## Beat 5: "Show me everything" (3:30-4:40)

**Hero panel: CENTRE then RIGHT (the grand tour)**

**Voice (relaxed, leaning back):**
> "Give me a full pipeline overview -- active projects, pending proposals, outstanding billing, and team utilization."

| Panel | What the viewer sees |
|-------|---------------------|
| LEFT | Comprehensive synthesis response streams in |
| CENTRE | Daily note is now a rich audit trail of the entire session — scroll to show all content accumulated |
| RIGHT | Full graph in all its glory. All connections visible. |

**Expected response synthesises:**
- **Active engagements:**
  - Acme Data Migration -- cutover March 28, $75K budget, 60% billed
  - Beta Corp Dashboard -- 60% dev, demo next week, $28K budget, 76% billed
  - TechStart Phase 2 -- multi-tenant 70% done, $45K budget, 28% billed
- **Pending proposals:**
  - Nexus Health Cloud Assessment -- $22K, team assigned, starting April
  - Acme Analytics Add-on -- $35K, gaining traction post-cutover
  - Meridian Financial API Modernization -- $60K, intro meeting March 25
- **Total pipeline:** $117K in proposals
- **Outstanding billing:** $52.5K (flag overdue)
- **Team utilization:** Marcus 90%, Stacy 80%, Dan 60%, Priya/Leila incoming

**What this proves:** The system didn't just record -- it synthesises across everything it knows. Pipeline, money, people, projects, all connected.

**Closing shot (4:40-5:00):**
Click on Sarah Mitchell in the graph. The context cloud redraws showing HER connections -- Acme Corp, invoices, Data Migration, the Analytics Add-on, Emily Chen.

Hold on this for 3-4 seconds. No voiceover. Just the graph.

Fade to repo URL.

**Voiceover (over the graph reveal):**
> "Every message enriched the knowledge graph. Tasks link to people and invoices. Project updates connect team members to deliverables and knowledge assets. The system learns what matters -- entities you mention together get boosted in future suggestions."

---

## Centre Panel: Ambient Capture Summary

The daily note is NOT showing commanded writes. It's showing ambient capture:

| Beat | Centre panel shows |
|------|-------------------|
| 1 | Daily note appears with first Q&A logged (timestamps, tool metadata, wikilinks) |
| 2 | Second entry -- billing Q&A auto-wikilinked to invoice entities |
| 3 | Third entry logged + tasks created in Tasks section |
| 4 | Big message + response logged, 15+ blue wikilinks in the transcript |
| 5 | Complete audit trail of entire session |

By Beat 5, the viewer realises nobody asked to save anything. It just accumulated.

---

## Voice Delivery Tips

- **Beats 1-3:** Crisp, short commands. Decisive.
- **Beat 4:** Stream-of-consciousness, natural pauses, consultant-after-a-call cadence. This is the set piece -- the contrast with Beats 1-3 makes it hit harder.
- **Beat 5:** Relaxed, satisfied. You've just done the big dump. Now you're leaning back and asking for the overview.

---

## Recording Breakdown

Record panels separately, sync in post. The daily note format (structured audit log with timestamps) is different from the Telegram chat, so cross-panel text won't match word-for-word. This is fine -- they're three different representations of the same interaction, not three copies. Just maintain beat sequence order.

### LEFT (Telegram + Wispr)
One recording session. Run all 5 beats sequentially. Voice through Wispr Flow appears as typed text in Telegram. Can re-record independently if a beat's response is bad.

### CENTRE (Obsidian daily note)
Record the vault responding to mutations. Key moments:
- Beat 1: Daily note materialises (first entry)
- Beat 3: Tasks section populates
- Beat 4: Note fills with 15+ wikilinks (HERO SHOT -- scroll slowly)
- Beat 5: Full audit trail visible

### RIGHT (Crank graph panel)
Record graph state evolving. Key moments:
- Beat 1: Existing entity constellation (baseline)
- Beat 3: First graph growth (task connections)
- Beat 4: Graph explosion (HERO SHOT -- hold on this)
- Beat 5: Sarah Mitchell click -> subgraph redraw (CLOSING SHOT)

### Audio
AI voiceover generated separately for all 5 beats. Beat 4 should be slower and more natural than Beats 1-3. Give the AI voice a slight pause before "Oh, and update the Rate Card" and before "Last thing."

---

## Recording Order

```
Session 1: Reset vault. Run all 5 beats in Telegram. Record LEFT panel.
Session 2: Reset vault. Re-run beats. Record CENTRE + RIGHT simultaneously.
Session 3: Generate AI voiceover for all 5 beats.
```

Or more efficiently: run once, screen-record Obsidian and Crank simultaneously (two capture regions), then record Telegram separately if needed for a cleaner take.

---

## Editor Notes

- **Processing gaps:** Cut or speed to 3-4x. Never show waiting.
- **Graph animations:** Real speed or slower. These are the visual payoffs -- don't rush them.
- **Wikilinks appearing:** If possible, highlight or zoom momentarily when blue links populate. The blue links are the visual proof.
- **Audio:** Light ambient music (lo-fi or ambient), ducked under voice. No music during Beat 4 voice dump -- let the voice carry it alone. Music swells for Beat 5 reveal.
- **End card:** Repo URL + "Flywheel Memory -- just talk, your vault remembers." 5 seconds. Done.

---

## File Handoff

```
footage/
+-- telegram-beat1.mp4
+-- telegram-beat2.mp4
+-- telegram-beat3.mp4
+-- telegram-beat4.mp4
+-- telegram-beat5.mp4
+-- obsidian-beat1-appears.mp4
+-- obsidian-beat3-tasks.mp4
+-- obsidian-beat4-showstopper.mp4
+-- obsidian-beat5-audit-trail.mp4
+-- graph-beat1-baseline.mp4
+-- graph-beat3-growth.mp4
+-- graph-beat4-explosion.mp4
+-- graph-beat5-sarahclick.mp4
+-- voice-beat1.mp3
+-- voice-beat2.mp3
+-- voice-beat3.mp3
+-- voice-beat4.mp3
+-- voice-beat5.mp3
+-- script.md
```

---

## Entity Checklist

Before filming, verify every entity mentioned in Beats 1-7 exists in the vault with enough frontmatter:

- [ ] Sarah Mitchell (Beat 3, 4) -- VP Technology, Acme Corp
- [ ] James Rodriguez (Beat 4) -- IT contact, Acme Corp
- [ ] Marcus Webb (Beat 4) -- Senior Data Engineer
- [ ] Emily Chen (Beat 4) -- Acme Corp, production sign-off
- [ ] Priya Kapoor (Beat 4) -- financial modeling background
- [ ] Leila Farouk (Beat 4) -- cloud/security, Nexus Health
- [ ] Tom Huang (Beat 4) -- Nexus Health contact
- [ ] Dan Oliveira (Beat 4) -- Beta Corp Dashboard developer
- [ ] Stacy Thompson (Beat 4) -- demo reviewer
- [ ] Mike Chen (Beat 3) -- TechStart Inc
- [ ] Acme Corp, TechStart Inc, Nexus Health, Meridian Financial, GlobalBank (clients)
- [ ] Acme Data Migration, Beta Corp Dashboard, TechStart Phase 2 (projects)
- [ ] All 8 invoices (INV-2025-047 through INV-2026-006)
- [ ] Rate Card, Data Migration Playbook, Discovery Workshop Template (knowledge)
- [ ] Acme Analytics Add-on, Nexus Health Cloud Assessment (proposals)

If any entity is mentioned in a beat but doesn't have a vault note, the auto-wikilink won't fire and the graph won't show the connection.

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

---

## Voice/PKM Philosophy (reference for blog post / X thread)

This section is NOT part of the video. It preserves key concepts from the planning session for future written content.

### The Voice-Native Stack

```
WhisperType (transcription) -> Agent -> Claude Code -> Flywheel Memory -> Obsidian Vault
     |                          |           |              |
Voice memo              Interprets      Executes      Auto-wikilinks
                        intent          mutation      + markup
```

### "Wrong" Suggestions Build Worthy Meaning

Week 1: Voice logs mention "Acme call", get suggestion -> GlobalBank
  (Seems wrong -- GlobalBank not directly involved)

Week 2: Consultant starts GlobalBank pilot project
  (Turns out GlobalBank opportunity came from Acme referral)

Week 3: Agent queries "What was I working on before GlobalBank?"
  -> Context cloud reveals: Acme calls, TechStart work, validation patterns
  -> "Oh right, the GlobalBank opportunity came from Acme's referral"

The "imprecise" suggestion captured working context, not just content. Over time, wrong suggestions create a navigable timeline of professional activity.

### Algorithm Evidence

Co-occurrence boost at work -- when you log "Acme call", the algorithm looks at what entities frequently co-occur with Acme in your vault:
- Sarah Mitchell -- 47 co-occurrences (primary contact)
- Acme Data Migration -- 32 co-occurrences (active project)
- TechStart Inc -- 12 co-occurrences (often worked same week)
- INV-2025-048 -- 8 co-occurrences (pending payment)

### Wow Factor

| Action | Manual PKM | Flywheel Voice Flow |
|--------|------------|---------------------|
| Capture | Type, manually link | Speak, auto-wikilinks |
| Context | Remember to add links | Suggestions capture co-occurrence |
| Client Intel | Forget or lose it | Auto-logged to client note |
| Recall | Grep and pray | Context cloud query |

### Key Message

"Speak your thoughts, build your graph. Zero friction capture, passive relationship intelligence."

### Why This Matters for Solo Consultants

- Client relationships are assets -- graph captures interaction patterns
- Pipeline is scattered -- suggestions surface opportunities from casual mentions
- Billable context matters -- invoice suggestions when logging client work
- Knowledge compounds -- playbook references appear when relevant
