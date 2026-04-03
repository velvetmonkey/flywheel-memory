# Carter Strategy Demo — OpenScreen Recording Script

Single-take screen recording using [OpenScreen](https://github.com/siddharthvaddem/openscreen). Three-panel layout visible throughout; OpenScreen's zoom highlights the hero panel per beat. ~5 minutes final cut.

**Tagline:** "Cognitive sovereignty for your Obsidian vault."

**Core story:** Write notes, Flywheel suggests links, accept/reject feedback, graph improves, future suggestions get smarter. The viewer sees the learning loop close in real time.

---

## Screen Layout

Arrange these three windows side-by-side before recording. Snap them so they fill the screen:

```
+--------------+------------------+-------------+
|   TELEGRAM   |   OBSIDIAN NOTE  |   CRANK     |
|   + Wispr    |   (daily note)   |   GRAPH     |
|              |                  |   PANEL     |
|  Left ~30%  |   Centre ~40%    |  Right ~30% |
+--------------+------------------+-------------+
```

- **Left:** Telegram desktop, bot chat open, history cleared
- **Centre:** Obsidian with carter-strategy vault, daily note open (empty)
- **Right:** Crank graph panel in Obsidian sidebar

---

## Pre-Recording Setup

### Vault

1. Delete `daily-notes/` contents if any exist from previous runs
2. **Do NOT delete `.flywheel/state.db`** — contains pre-seeded feedback (~30 records)
3. Run `./run-demo-test.sh --seed-only` to ensure feedback is seeded
4. Restart flywheel-demo service: `sudo systemctl restart flywheel-demo`

### Pre-seeded feedback state

The vault has been "in use for weeks." The state.db contains:

| Entity | Feedback | Effect |
|--------|----------|--------|
| Sarah Mitchell | 90% accuracy (10 samples) | +10 boost — high-confidence suggestion |
| Acme Data Migration | 85% accuracy (8 samples) | +10 boost |
| Acme Corp | 95% accuracy (12 samples) | +10 boost |
| Marcus Webb | 80% accuracy (6 samples) | +5 boost |
| GlobalBank | 30% accuracy (25 samples) | **Suppressed** — won't appear |
| Meridian Financial | 50% accuracy (4 samples) | Marginal — borderline |
| Discovery Workshop Template | 55% accuracy (3 samples) | Marginal — borderline |

Beat 1 suggestions already reflect prior learning. Live feedback in Beats 2-3 demonstrably improves Beat 4.

### Apps

- Obsidian open, carter-strategy vault, daily note visible, Crank graph panel on right
- Telegram desktop open, bot chat, dark mode, history cleared
- Wispr Flow active for voice input
- All notifications silenced

### OpenScreen

1. Install from [GitHub Releases](https://github.com/siddharthvaddem/openscreen/releases) (Windows build)
2. Set recording to **full screen**
3. Audio: **microphone on**, system audio off
4. Background: dark solid colour or gradient (for any padding around panels)
5. Resolution: 1920x1080 or native
6. Familiarise yourself with the zoom controls — you'll add zooms in post

---

## Recording

**Record the entire session as one continuous take.** You'll add zooms, speed changes, annotations, and trims in OpenScreen's editor after recording.

### Pre-roll (5 seconds)

Sit on the empty 3-panel layout. Still frame. This gives you a clean opening to trim or add a title card.

---

### Beat 1: "Log a call" — suggestions appear (target: 0:00-1:00)

**Voice (casual, post-call energy):**

> "Log that I just wrapped a call with Sarah Mitchell and James Rodriguez at Acme. UAT is fully complete, Marcus Webb's validation scripts passed, and we're hitting the 3x performance target. Cutover locked for March 28-29."

**What happens on screen:**

| Panel | What the viewer sees |
|-------|---------------------|
| Left (Telegram) | Message appears in Telegram, bot confirms it's logging |
| Centre (Obsidian) | Daily note entry appears with auto-wikilinks: [[Sarah Mitchell]], [[James Rodriguez]], [[UAT]], [[Marcus Webb]]. Suggested outgoing links: → [[Acme Corp]], [[Acme Analytics Add-on]], [[Beta Corp Dashboard]] |
| Right (Crank) | Graph shows existing connections lighting up — Sarah, James, Marcus connected to Acme entities |

**What this proves:** One voice command, four entities auto-linked. Three suggestions appeared based on co-occurrence patterns — the system already knows Acme Corp is the client, and surfaces related projects.

**OpenScreen post-production:**

| Edit | Detail |
|------|--------|
| Zoom | After voice input lands in Telegram, zoom to **centre panel** (~1.5x) as wikilinks appear. Hold 3-4 seconds on the rendered links + suggestions. |
| Speed | If there's a processing delay between Telegram send and Obsidian update, speed that gap to 2-3x. |
| Zoom | Pull back to full 3-panel view to show graph connections on the right. |

---

### Beat 2: "Accept and reject" — feedback captured (target: 1:00-1:45)

**No voice. Hands on keyboard.**

Manually edit the daily note entry:

1. **Keep** the `→ [[Acme Corp]]` suggestion (obviously relevant — it's the client)
2. **Remove** the `→ [[Beta Corp Dashboard]]` suggestion (not relevant to this Acme call)
3. **Add** `→ [[Emily Chen]]` manually (she needs to sign off on production access — system didn't suggest her because she hasn't co-occurred with cutover conversations yet)

**What happens on screen:**

| Panel | What the viewer sees |
|-------|---------------------|
| Left (Telegram) | Static — not involved |
| Centre (Obsidian) | Three edits visible: one suggestion kept, one removed, one manual link added |
| Right (Crank) | Graph subtly updates — Acme Corp connection strengthens, Emily Chen gains new edge to the Acme cluster |

**What this proves:** Every edit is feedback. Keep = boost. Remove = suppress. Manual add = teach. The graph responds in real time.

**OpenScreen post-production:**

| Edit | Detail |
|------|--------|
| Zoom | Zoom to **centre panel** (~1.8x) for the entire beat. This is the hero shot — the viewer needs to see each edit clearly. |
| Speed | Slow to ~70% speed. Deliberate, quiet. |
| Annotation | Add text overlay: **"Every edit teaches the system."** Position bottom-centre, hold for duration of beat. |
| Annotation | Optional: checkmark (✓) on kept suggestion, X on removed suggestion as you edit each one. |

---

### Beat 3: "Write more, better suggestions" — the loop closes (target: 1:45-2:30)

**Voice:**

> "Sarah mentioned the Analytics Add-on proposal is circulating with their finance team. She wants to scope it with Emily after cutover. I said Priya Kapoor would be ideal."

**What happens on screen:**

| Panel | What the viewer sees |
|-------|---------------------|
| Left (Telegram) | Message in Telegram, bot logs it |
| Centre (Obsidian) | New entry with auto-wikilinks: [[Sarah Mitchell]], [[Acme Analytics Add-on]], [[Emily Chen]], [[Priya Kapoor]]. Suggestions appear. **Notably ABSENT:** Beta Corp Dashboard (suppressed from Beat 2). **Notably PRESENT:** Emily Chen auto-linked (learned from Beat 2 manual add). |
| Right (Crank) | Graph grows — Emily Chen now firmly in Acme cluster. Priya appears for the first time. |

**What this proves:** The loop closed. Beta Corp Dashboard suppressed (you rejected it). Emily auto-linked (you taught the system). Suggestions got smarter from one interaction.

**OpenScreen post-production:**

| Edit | Detail |
|------|--------|
| Zoom | After wikilinks render, zoom to **centre panel** (~1.5x). |
| Annotation | Add callout arrow or highlight on Emily Chen's auto-wikilink with text: **"Auto-linked — learned from Beat 2"** |
| Annotation | Optional: ghost/strikethrough annotation where Beta Corp Dashboard would have appeared: **"Suppressed — rejected in Beat 2"** |
| Zoom | Pull back to full view to show graph growth on the right. |
| Speed | Real speed for voice. 2-3x for any processing gap. Slow/pause for the reveal. |

---

### Beat 4: "The voice dump" — showstopper (target: 2:30-3:45)

**Voice (natural, stream-of-consciousness — consultant debriefing):**

> "One more thing — James says the legacy Oracle decommission timeline hasn't been confirmed by IT. I've asked him to escalate. If we don't get a date by next Friday we might need to run parallel, which would push costs beyond the 75K budget, probably an extra 8 to 10K."

*(Brief natural pause)*

> "Oh, and update the [[Rate Card]] — Marcus is going up to 220 an hour from April. [[Leila Farouk|Leila]]'s rates need adding too for the [[Nexus Health]] engagement. [[Tom Huang]] confirmed Nexus wants to proceed with the Cloud Assessment once Leila's available."

*(Slightly faster)*

> "Last thing — Dan Oliveira pinged about the [[Beta Corp Dashboard]]. Pipeline module's done, wants to demo to Stacy Thompson before the client presentation Wednesday."

**What happens on screen:**

| Panel | What the viewer sees |
|-------|---------------------|
| Left (Telegram) | Long message appears via Wispr, bot processes |
| Centre (Obsidian) | Massive entry with 12+ auto-wikilinks. Suggestions are sharply relevant — Emily Chen appears in suggestions for budget context (learned from Beats 2-3). Discovery Workshop Template appears where relevant (boosted from Beat 2). |
| Right (Crank) | Graph **explodes** — Nexus Health cluster forms, Beta Corp connections multiply, Rate Card connects to multiple team members |

**What this proves:** After 3 beats of feedback, suggestions are measurably better. Entities manually added earlier now auto-link. Suppressed entities stay gone.

**Voice delivery tips:**
- Natural pace, consultant-talking-to-assistant cadence
- "Oh, and" before Rate Card — natural pause
- "Last thing" — slightly faster, signals the close

**OpenScreen post-production:**

| Edit | Detail |
|------|--------|
| Speed | Voice input at real speed (~80-100%). Processing gaps at 2-3x. **Slow down** for the daily note filling up and graph expanding — hold 2-3 seconds after. |
| Zoom | Start at full 3-panel view for the voice input. As the daily note populates, zoom to **centre panel** (~1.3x) to show density of wikilinks. Then pull back to full view for the graph explosion. |
| Zoom | Optional: quick zoom to **right panel** (~1.5x) for the graph explosion moment, hold 2-3 seconds. |

---

### Beat 5: "Prove it improved" (target: 3:45-4:40)

**Voice (relaxed):**

> "Show me what's connected to Sarah Mitchell."

**What happens on screen:**

| Panel | What the viewer sees |
|-------|---------------------|
| Left (Telegram) | Agent response: Sarah's connections across the vault |
| Centre (Obsidian) | Scroll the daily note — full audit trail of the session, 4 entries, dozens of wikilinks |
| Right (Crank) | Click Sarah Mitchell in graph. Context cloud redraws showing her connections: Acme Corp, Emily Chen (learned this session!), Data Migration, Analytics Add-on, invoices. Weighted connections — thicker lines for stronger relationships. |

**What this proves:** The graph is denser and smarter than when we started. Emily Chen is in Sarah's orbit — a connection that didn't exist 5 minutes ago, taught by one manual edit in Beat 2.

**OpenScreen post-production:**

| Edit | Detail |
|------|--------|
| Zoom | Start at full view. When Sarah's subgraph renders, zoom to **right panel** (~1.8x). This is the closing shot. |
| Speed | Real speed throughout. Let the graph render. |
| Hold | Hold on Sarah's subgraph for 3-4 seconds. No voiceover. Just the graph. |

---

### Closing (target: 4:40-5:00)

**Voiceover (over the held graph shot):**

> "Every edit taught the system. Links you kept got stronger. Links you removed got suppressed. After five minutes, the graph knows which connections matter — not because you configured anything, but because you just used it."

**OpenScreen post-production:**

| Edit | Detail |
|------|--------|
| Hold | Keep Sarah's subgraph visible throughout voiceover. |
| Annotation | Fade in text: **"Cognitive sovereignty for your Obsidian vault."** Centre of screen. |
| Annotation | Below tagline: repo URL. Hold 5 seconds. |
| Trim | Cut any post-recording dead air. |

---

## OpenScreen Editor Checklist

After recording, open the clip in OpenScreen's editor and apply these in order:

### 1. Trim
- [ ] Cut pre-roll to desired length (or replace with title card)
- [ ] Cut any dead air or mistakes
- [ ] Remove post-recording tail

### 2. Speed adjustments
- [ ] Beat 2 edits: slow to ~70%
- [ ] All processing gaps (Telegram -> Obsidian delays): speed to 2-3x
- [ ] Beat 4 voice input: keep at real speed
- [ ] Beat 4 reveal (note filling + graph): real speed or slightly slow

### 3. Zooms
- [ ] Beat 1: Zoom centre panel after wikilinks appear. Pull back for graph.
- [ ] Beat 2: Zoom centre panel for full beat (~1.8x). Hero shot.
- [ ] Beat 3: Zoom centre panel for suggestion reveal. Pull back for graph.
- [ ] Beat 4: Full view for voice. Zoom centre for note density. Pull back for graph explosion.
- [ ] Beat 5: Zoom right panel for Sarah's subgraph. Hold for closing.

### 4. Annotations
- [ ] Beat 2: "Every edit teaches the system." text overlay
- [ ] Beat 2 (optional): ✓ and ✗ on kept/removed suggestions
- [ ] Beat 3: "Auto-linked — learned from Beat 2" callout on Emily Chen
- [ ] Beat 3 (optional): "Suppressed — rejected in Beat 2" ghost text
- [ ] Closing: "Cognitive sovereignty for your Obsidian vault." + repo URL

### 5. Audio
- [ ] Verify mic audio is clean across all beats
- [ ] Beat 2 should be silent (just keyboard sounds if any)
- [ ] Optional: add subtle ambient music under Beat 2 for contrast
- [ ] Closing voiceover may need to be recorded separately and layered

### 6. Export
- [ ] Aspect ratio: 16:9
- [ ] Resolution: 1920x1080 (or 4K if source supports it)
- [ ] Format: MP4

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

## Entity Checklist

Before recording, verify every entity mentioned exists in the vault:

- [ ] Sarah Mitchell (Beats 1, 2, 3, 5) — VP Technology, Acme Corp
- [ ] James Rodriguez (Beats 1, 4) — IT contact, Acme Corp
- [ ] Marcus Webb (Beats 1, 4) — Senior Data Engineer
- [ ] Emily Chen (Beats 2, 3, 4) — Acme Corp, production sign-off
- [ ] Priya Kapoor (Beat 3) — financial modeling
- [ ] Leila Farouk (Beat 4) — cloud/security
- [ ] Tom Huang (Beat 4) — Nexus Health contact
- [ ] Dan Oliveira (Beat 4) — Beta Corp Dashboard
- [ ] Stacy Thompson (Beat 4) — demo reviewer
- [ ] Acme Corp, [[TechStart Inc]], Nexus Health (clients)
- [ ] [[Acme Data Migration]], Beta Corp Dashboard (projects)
- [ ] Rate Card, Data Migration Playbook, Discovery Workshop Template (knowledge)
- [ ] Acme Analytics Add-on, Nexus Health Cloud Assessment (proposals)

---

## Quick Reference: OpenScreen Features Used

| Feature | Where used |
|---------|-----------|
| Full screen recording | Entire session — captures all 3 panels |
| Manual zoom | Per-beat hero panel highlights (5-6 zooms total) |
| Speed control | 70% for Beat 2 edits, 2-3x for processing gaps |
| Annotations (text) | Beat 2 overlay, Beat 3 callouts, closing tagline + URL |
| Annotations (arrows) | Beat 3 Emily Chen callout (optional) |
| Trim | Pre-roll, post-roll, dead air |
| Crop | Optional — hide taskbar or non-relevant screen edges |
| Motion blur | Enable for zoom transitions (smoother pans between panels) |
