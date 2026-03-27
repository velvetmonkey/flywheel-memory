# Carter Strategy Demo Video Script (~5 minutes)

Single demo showing the learning loop: write notes, Flywheel suggests links, accept/reject feedback, graph improves, future suggestions get smarter. Three-panel layout, five beats, voice-native via Wispr Flow.

**Tagline:** "Just talk. Your vault remembers."

**Key framing:** This demo sells the flywheel effect -- the system learning from your edits, not just storing them. The viewer sees: write something casual, watch links appear, accept some, reject others, then write something else and see the suggestions already improved. By the end, the graph is visibly denser and the system knows which connections matter.

**Centre panel insight:** Every mutation shows auto-wikilinks firing in real time. The viewer sees blue links materialise as words are written. When a link is kept, it silently strengthens future scoring. When a link is edited out, it silently suppresses. Nobody explains this -- it just happens, and the graph tells the story.

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

## Beat 1: "Log a call" -- suggestions appear (0:00-1:00)

**Hero panel: CENTRE (daily note)**

**Voice (casual, post-call energy):**
> "Log that I just wrapped a call with Sarah Mitchell and James Rodriguez at Acme. UAT is fully complete, Marcus Webb's validation scripts passed, and we're hitting the 3x performance target. Cutover locked for March 28-29."

| Panel | What the viewer sees |
|-------|---------------------|
| LEFT | Message appears in Telegram, bot confirms it's logging the entry |
| CENTRE | Daily note entry appears with auto-wikilinks: [[Sarah Mitchell]], [[James Rodriguez]], [[Acme Corp]], [[Marcus Webb]], [[Acme Data Migration]]. PLUS suggested outgoing links appear: -> [[Discovery Workshop Template]], [[Data Migration Playbook]] |
| RIGHT | Graph shows existing connections lighting up -- Sarah, James, Marcus all connected to Acme Data Migration |

**What this proves:** One voice command, five entities auto-linked. The system recognised names, projects, and relationships without being told where anything lives. Two extra suggestions appeared -- entities the system thinks are relevant based on co-occurrence patterns.

**Editor:** Let the wikilinks render at real speed. The viewer needs to see them appear. Brief pause on the suggested links (arrow notation) -- these are the learning loop's input.

---

## Beat 2: "Accept and reject" -- feedback captured (1:00-1:45)

**Hero panel: CENTRE (editing the note)**

**No voice -- hands-on-keyboard moment.**

The presenter manually edits the daily note entry:
1. **Keeps** the `-> [[Discovery Workshop Template]]` suggestion (it's relevant -- UAT validated patterns from that workshop)
2. **Removes** the `-> [[Data Migration Playbook]]` suggestion (not relevant to this specific update)
3. **Adds** `-> [[Emily Chen]]` manually (she needs to sign off on production access -- the system didn't suggest her because she hasn't co-occurred with cutover conversations yet)

| Panel | What the viewer sees |
|-------|---------------------|
| LEFT | (Static -- Telegram not involved) |
| CENTRE | Two edits visible: one suggestion kept, one removed, one manual link added |
| RIGHT | Graph subtly updates -- Discovery Workshop Template connection strengthens, Emily Chen gains a new edge to Acme Data Migration |

**What this proves:** Every edit is feedback. Keeping a suggestion boosts that connection. Removing one suppresses it. Adding a manual link teaches the system a new relationship. The graph responds in real time.

**Editor:** Show the edits at 70% speed. Highlight the kept vs removed suggestions with a subtle annotation (checkmark/X). This beat is quiet and deliberate -- contrast with the energy of Beat 1.

**Text overlay (optional):** "Every edit teaches the system."

---

## Beat 3: "Write more, better suggestions" -- the loop closes (1:45-2:30)

**Hero panel: CENTRE + RIGHT (split focus)**

**Voice:**
> "Sarah mentioned the Analytics Add-on proposal is circulating with their finance team. She wants to scope it with Emily after cutover. I said Priya Kapoor would be ideal."

| Panel | What the viewer sees |
|-------|---------------------|
| LEFT | Message in Telegram, bot logs it |
| CENTRE | New entry with auto-wikilinks: [[Sarah Mitchell]], [[Acme Analytics Add-on]], [[Emily Chen]], [[Priya Kapoor]]. Suggested links: -> [[Acme Corp]], -> [[Acme Data Migration]]. Notably ABSENT: Data Migration Playbook (suppressed from Beat 2 feedback) |
| RIGHT | Graph grows -- Emily Chen now firmly connected to Acme cluster (the manual link from Beat 2 taught the system). Priya appears for the first time. |

**What this proves:** The learning loop closed. In Beat 2, the presenter removed Data Migration Playbook -- it doesn't appear in Beat 3's suggestions. In Beat 2, the presenter manually added Emily Chen -- she's now auto-linked in Beat 3 because the system learned she co-occurs with Acme context. The suggestions got smarter from one interaction.

**Editor:** This is the "aha" moment. The viewer needs to notice what's NOT there (Playbook) and what IS there (Emily auto-linked). Consider a brief split-screen comparison: Beat 1 suggestions vs Beat 3 suggestions.

---

## Beat 4: "The voice dump" -- SHOWSTOPPER (2:30-3:45)

**Hero panel: ALL THREE**

**Voice (natural, stream-of-consciousness -- consultant debriefing after a call):**

> "One more thing -- James says the legacy Oracle decommission timeline hasn't been confirmed by IT. I've asked him to escalate. If we don't get a date by next Friday we might need to run parallel, which would push costs beyond the 75K budget, probably an extra 8 to 10K.
>
> Oh, and update the Rate Card -- Marcus is going up to 220 an hour from April. Leila's rates need adding too for the Nexus Health engagement. Tom Huang confirmed Nexus wants to proceed with the Cloud Assessment once Leila's available.
>
> Last thing -- Dan Oliveira pinged about the Beta Corp Dashboard. Pipeline module's done, wants to demo to Stacy Thompson before the client presentation Wednesday."

| Panel | What the viewer sees |
|-------|---------------------|
| LEFT | Long message appears via Wispr, bot processes |
| CENTRE | Massive entry with 12+ auto-wikilinks. Suggestions are sharply relevant -- the system has been learning all session. Emily Chen appears in suggestions for budget context (learned from Beat 2-3). Discovery Workshop Template appears where relevant (boosted from Beat 2). |
| RIGHT | Graph EXPLODES -- Nexus Health cluster forms, Beta Corp connections multiply, Rate Card connects to multiple team members |

**What this proves:** After 3 beats of feedback, the system's suggestions are measurably better. Entities that were manually added in Beat 2 now auto-link. Entities that were suppressed stay gone. The voice dump fires 12+ auto-links and relevant suggestions -- the graph is learning in real time.

**Voice delivery tips:**
- Natural pace, consultant-talking-to-assistant cadence
- Pause naturally. "Oh, and" before the Rate Card bit
- "Last thing" signals the close -- slightly faster

**Editor:** Three phases:
1. Voice input at real speed (80%) -- viewer feels the naturalness
2. Processing at 2-3x -- never show dead air
3. SLOW DOWN for the reveal -- daily note filling up and graph expanding at real speed. Hold 2-3 seconds after.

---

## Beat 5: "Prove it improved" (3:45-4:40)

**Hero panel: RIGHT (graph)**

**Voice (relaxed):**
> "Show me what's connected to Sarah Mitchell."

| Panel | What the viewer sees |
|-------|---------------------|
| LEFT | Agent response: Sarah's connections across the vault |
| CENTRE | Scroll the daily note -- full audit trail of the session, 4 entries, dozens of wikilinks |
| RIGHT | Click Sarah Mitchell in graph. Context cloud redraws showing HER connections: Acme Corp, Emily Chen (learned this session!), Data Migration, Analytics Add-on, invoices. Connections are weighted -- thicker lines for stronger relationships. |

**What this proves:** The graph at the end is denser and smarter than the graph at the start. Emily Chen is now firmly in Sarah's orbit -- a connection that didn't exist 5 minutes ago, taught by one manual edit in Beat 2. The flywheel effect is visible: write -> suggest -> feedback -> better suggestions -> denser graph.

**Closing shot (4:40-5:00):**

Hold on Sarah's subgraph for 3-4 seconds. No voiceover. Just the graph.

Fade to repo URL.

**Voiceover (over the graph reveal):**
> "Every edit taught the system. Links you kept got stronger. Links you removed got suppressed. After five minutes, the graph knows which connections matter -- not because you configured anything, but because you just used it."

---

## The Learning Loop (reference for on-screen annotation)

```
   Write a note
       |
       v
  Auto-wikilinks fire
  + suggestions appear
       |
       v
  Accept / reject / add
       |
       v
  Feedback shapes scoring
  (boost / suppress / teach)
       |
       v
  Next write: better suggestions
       |
       '---------> Graph gets denser
```

---

## Centre Panel: Session Progression

| Beat | Centre panel shows | Learning signal |
|------|-------------------|-----------------|
| 1 | Entry with 5 auto-links + 2 suggestions | Baseline -- system's initial suggestions |
| 2 | Manual edits: keep one, remove one, add one | Three feedback signals captured |
| 3 | New entry: improved suggestions (suppressed + boosted) | Loop closed -- suggestions changed |
| 4 | Voice dump: 12+ auto-links, sharp suggestions | Accumulated learning from session |
| 5 | Full audit trail, scroll to show density | Visual proof of graph growth |

---

## Key Difference from Retrieval Demo

The old script showed: "ask questions, get smart answers." That proves recall.

This script shows: "write casually, watch the system learn from your edits." That proves the flywheel effect -- the thing that makes Flywheel different from every other MCP search tool.

The viewer should leave thinking: "I don't need to organize my notes. I just need to keep writing and the system figures out what connects."

---

## Voice Delivery Tips

- **Beat 1:** Post-call energy. Casual, fast. "Just got off a call."
- **Beat 2:** Silent. Hands on keyboard. Let the edits speak.
- **Beat 3:** Casual again, but the viewer is now primed to watch the suggestions.
- **Beat 4:** Stream-of-consciousness, natural pauses. This is the set piece.
- **Beat 5:** Relaxed, satisfied. The reveal.

---

## Recording Breakdown

Record panels separately, sync in post. The daily note format is different from Telegram chat -- three different representations of the same interaction.

### LEFT (Telegram + Wispr)
One recording session. Run Beats 1, 3, 4, 5 sequentially. Beat 2 is keyboard-only (no Telegram).

### CENTRE (Obsidian daily note)
The hero panel for this demo. Key moments:
- Beat 1: Daily note materialises with wikilinks + suggestions
- Beat 2: Manual edits visible (HERO SHOT -- the feedback moment)
- Beat 3: Improved suggestions appear (HERO SHOT -- the loop closing)
- Beat 4: Note fills with 12+ wikilinks
- Beat 5: Full audit trail scroll

### RIGHT (Crank graph panel)
- Beat 1: Existing connections light up
- Beat 2: Subtle edge changes (strengthen/weaken)
- Beat 3: Emily Chen firmly in Acme cluster
- Beat 4: Graph explosion (HERO SHOT)
- Beat 5: Sarah Mitchell click -> subgraph (CLOSING SHOT)

### Audio
AI voiceover for Beats 1, 3, 4, 5. Beat 2 is silent with soft ambient music. Beat 4 should be slower and more natural than Beats 1/3.

---

## Recording Order

```
Session 1: Reset vault. Run all 5 beats via Telegram. Record LEFT panel.
Session 2: Reset vault. Re-run beats. Record CENTRE + RIGHT simultaneously.
Session 3: Generate AI voiceover for Beats 1, 3, 4, 5.
```

---

## Editor Notes

- **Beat 2 (the quiet beat):** This is the emotional pivot. Soft music, deliberate pace. The viewer watches human judgment shape machine behaviour.
- **Beat 3 (the aha):** Consider a brief annotation or split-screen showing "Beat 1 suggestions" vs "Beat 3 suggestions."
- **Processing gaps:** Cut or speed to 3-4x. Never show waiting.
- **Graph animations:** Real speed or slower. Visual payoffs.
- **End card:** Repo URL + "Cognitive sovereignty for your Obsidian vault." 5 seconds.

---

## Entity Checklist

Before filming, verify every entity mentioned exists in the vault:

- [ ] Sarah Mitchell (Beats 1, 2, 3, 5) -- VP Technology, Acme Corp
- [ ] James Rodriguez (Beats 1, 4) -- IT contact, Acme Corp
- [ ] Marcus Webb (Beats 1, 4) -- Senior Data Engineer
- [ ] Emily Chen (Beats 2, 3, 4) -- Acme Corp, production sign-off
- [ ] Priya Kapoor (Beat 3) -- financial modeling
- [ ] Leila Farouk (Beat 4) -- cloud/security
- [ ] Tom Huang (Beat 4) -- Nexus Health contact
- [ ] Dan Oliveira (Beat 4) -- Beta Corp Dashboard
- [ ] Stacy Thompson (Beat 4) -- demo reviewer
- [ ] Acme Corp, TechStart Inc, Nexus Health (clients)
- [ ] Acme Data Migration, Beta Corp Dashboard (projects)
- [ ] Rate Card, Data Migration Playbook, Discovery Workshop Template (knowledge)
- [ ] Acme Analytics Add-on, Nexus Health Cloud Assessment (proposals)

---

## Vault Stats for Reference

| Category | Count |
|----------|-------|
| Team members | 6 |
| Clients | 5 |
| Projects | 6 |
| Proposals | 4 |
| Invoices | 8 |
| Knowledge | 5 |
| **Total entities** | **~47 notes** |

---

## Voice/PKM Philosophy (reference for blog post / X thread)

This section is NOT part of the video. Preserves concepts for future written content.

### The Learning Loop

```
  Interaction 1: Write "call with Sarah about cutover"
    -> System suggests: Data Migration Playbook, Discovery Workshop
    -> User keeps Workshop, removes Playbook
    -> Signal: Workshop relevant to cutover context, Playbook not

  Interaction 2: Write "Sarah wants to scope Analytics with Emily"
    -> System suggests: Acme Corp, Acme Data Migration
    -> Playbook NOT suggested (suppressed)
    -> Emily auto-linked (learned from manual add)
    -> Signal: Feedback from interaction 1 shaped interaction 2
```

### "Wrong" Suggestions Build Context

Week 1: Voice logs mention "Acme call", get suggestion -> GlobalBank
  (Seems wrong -- GlobalBank not directly involved)

Week 2: Consultant starts GlobalBank pilot project
  (GlobalBank opportunity came from Acme referral)

The "imprecise" suggestion captured working context your brain hadn't noticed yet. Over time, wrong suggestions become the connections you accept tomorrow.

### Algorithm Evidence

Co-occurrence boost at work -- when you log "Acme call":
- Sarah Mitchell -- 47 co-occurrences (primary contact)
- Acme Data Migration -- 32 co-occurrences (active project)
- TechStart Inc -- 12 co-occurrences (often worked same week)
- INV-2025-048 -- 8 co-occurrences (pending payment)

### Key Message

"Write casually. The system learns which connections matter."
