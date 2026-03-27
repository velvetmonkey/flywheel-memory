# Carter Strategy Demo Video Script (~5 minutes)

Single demo showing the learning loop: write notes, get link suggestions, accept/reject feedback, watch the graph improve, see smarter suggestions on the next write. Three-panel layout, six beats, voice-native via Wispr Flow.

**Tagline:** "Cognitive sovereignty for your Obsidian vault."

**Key framing:** This demo sells what the vault *learns*, not just what it stores. Flywheel-engine handles the Telegram interaction — the bot layer is hand-waved. The viewer sees natural voice input on the left, structured notes with auto-wikilinks and suggestions in the centre, and a graph reflecting learned relationships on the right. They think: "My vault would actually get smarter over time."

**Centre panel insight:** The daily note shows two kinds of markup: **blue wikilinks** (auto-applied, high confidence) and **`→` suggestions** (algorithm thinks these are related, pending human judgment). The distinction is the visual hook — it sets up the feedback beats.

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
- **Do NOT delete `.flywheel/state.db`** — it contains pre-seeded feedback history (~30 records) that makes suggestions realistic from Beat 1
- Run `./run-demo-test.sh --seed-only` to ensure feedback is seeded (or manually verify)
- Restart flywheel-demo service: `sudo systemctl restart flywheel-demo`
- Open Obsidian with carter-strategy vault visible
- Open Crank graph panel on right sidebar
- Open Telegram with bot chat visible (clear history for clean start)
- Wispr Flow active for voice input
- Dark mode on Telegram (better contrast on camera)

### Pre-seeded state

The vault has been "in use for weeks." The state.db contains feedback history:

| Entity | Feedback | Effect |
|--------|----------|--------|
| Sarah Mitchell | 90% accuracy (10 samples) | +10 boost — high-confidence suggestion |
| Acme Data Migration | 85% accuracy (8 samples) | +10 boost |
| Acme Corp | 95% accuracy (12 samples) | +10 boost |
| Marcus Webb | 80% accuracy (6 samples) | +5 boost |
| GlobalBank | 30% accuracy (25 samples) | Suppressed — won't appear in suggestions |
| Meridian Financial | 50% accuracy (4 samples) | Marginal — still suggested but borderline |
| Discovery Workshop Template | 55% accuracy (3 samples) | Marginal — still suggested but borderline |

This means Beat 1 suggestions already reflect prior learning (GlobalBank suppressed, core Acme entities boosted). The live feedback in Beats 2-3 then demonstrably improves Beat 4.

---

## Beat 1: "Morning capture" (0:00-0:50)

**Hero panel: CENTRE (daily note filling up)**

**Voice (crisp, consultant morning energy):**
> "Had a quick sync with Sarah Mitchell about the Acme cutover timeline. Marcus Webb confirmed the Airflow pipelines are solid and rollback procedures are documented in the Playbook. Cutover still locked for March 28-29. Sarah wants to schedule a scoping call for the Analytics Add-on after cutover wraps."

| Panel | What the viewer sees |
|-------|---------------------|
| LEFT | Message appears in Telegram via Wispr, bot processes and responds |
| CENTRE | Daily note created. Entry appears with **auto-wikilinks**: `[[Sarah Mitchell]]`, `[[Acme Corp]]`, `[[Marcus Webb]]`, `[[Data Migration Playbook]]`, `[[Acme Analytics Add-on]]`. PLUS **suggestion suffix**: `→ [[Acme Data Migration]], [[Discovery Workshop Template]], [[Meridian Financial]], [[Rate Card]]` |
| RIGHT | Graph panel shows entity constellation — connections light up for linked entities |

**What this proves:** Auto-wikilinks fire on known entities. The `→` suggestions go beyond what was explicitly mentioned — the scoring algorithm found related entities. But two suggestions look wrong...

**Voiceover annotation (lower third):**
> "Blue links: auto-applied. Arrow suggestions: the algorithm's best guesses."

**Editor:** Slow down when the `→` suffix appears. Hold for 2-3 seconds so the viewer can read the suggestions. This sets up the next two beats.

---

## Beat 2: "Teach it what's wrong" (0:50-1:40)

**Hero panel: LEFT (feedback interaction)**

**Voice (thoughtful, evaluating):**
> "Hmm — Meridian Financial? That's a completely different client, nothing to do with the Acme cutover. And Discovery Workshop Template — that was months ago during the discovery phase. Neither of those belong here. Reject both."

| Panel | What the viewer sees |
|-------|---------------------|
| LEFT | Two feedback reports sent. Bot confirms: "Recorded: Meridian Financial — rejected. Discovery Workshop Template — rejected." |
| CENTRE | The `→` suggestion line updates — `Meridian Financial` and `Discovery Workshop Template` visually fade or strike through (editorial effect in post) |
| RIGHT | Graph: connection lines to those entities dim slightly |

**What this proves:** The user evaluates suggestions and corrects the algorithm. Human judgment matters — the vault doesn't just guess, it listens.

**Why these entities are wrong:**
- **Meridian Financial** — a separate prospect (API modernization). Co-occurrence false positive: both clients appear in weekly planning notes and pipeline overviews, so the algorithm sees correlation. But in the context of an Acme cutover update, it's noise.
- **Discovery Workshop Template** — was relevant 5 months ago during Acme's discovery phase. The recency boost has decayed, but co-occurrence with Acme-related entities still pushes it above threshold. In a cutover context, it's irrelevant.

**Voiceover annotation:**
> "Negative feedback suppresses the entity immediately. It won't appear in future suggestions."

**Editor:** Show the first rejection at full speed. Speed through the second (same pattern). The viewer gets it.

---

## Beat 3: "Teach it what's right" (1:40-2:20)

**Hero panel: CENTRE then LEFT**

**Voice (approving):**
> "But Acme Data Migration and Rate Card — yes, both spot on. The migration IS what we're cutting over, and Marcus's new rate needs updating. Accept both."

| Panel | What the viewer sees |
|-------|---------------------|
| LEFT | Two positive feedback reports. Bot confirms: "Recorded: Acme Data Migration — confirmed. Rate Card — confirmed." |
| CENTRE | The remaining suggestions (`[[Acme Data Migration]]`, `[[Rate Card]]`) get promoted — editorial effect: they become inline wikilinks (the `→` prefix disappears and they turn blue) |
| RIGHT | Graph: connections to Acme Data Migration and Rate Card brighten/thicken |

**What this proves:** Feedback is bidirectional — not just punishment but reward. Good suggestions get boosted for next time. The viewer has now seen a natural curation pattern: 2 rejected, 2 accepted.

**Editor:** This beat should feel satisfying — the user just trained their knowledge graph. Keep it brief. The payoff is Beat 4.

---

## Beat 4: "The second capture" -- THE PAYOFF (2:20-3:20)

**Hero panel: ALL THREE**

**Voice (natural, post-call energy):**
> "Just got off a call about Nexus Health. They're confirmed to proceed with the Cloud Assessment once Leila Farouk is available in April. Need to finalise the proposal and get Priya Kapoor looped in for the compliance review. Their board wants the audit complete before the fundraise."

| Panel | What the viewer sees |
|-------|---------------------|
| LEFT | Message appears via Wispr, bot processes |
| CENTRE | Second entry appears with auto-wikilinks: `[[Nexus Health]]`, `[[Leila Farouk]]`, `[[Priya Kapoor]]`. Suggestion suffix: `→ [[Nexus Health Cloud Assessment]], [[API Security Checklist]]`. **Crucially: NO `[[Meridian Financial]]` and NO `[[Discovery Workshop Template]]` in the suggestions.** |
| RIGHT | Graph grows — Nexus Health cluster forms with new connections |

**What this proves — THE FLYWHEEL EFFECT:**
1. **Meridian Financial** was suggested 2 minutes ago in Beat 1. After rejection in Beat 2, it's gone. The system learned.
2. **Discovery Workshop Template** was rejected and doesn't reappear either.
3. **Nexus Health Cloud Assessment** IS suggested — strong co-occurrence with Nexus Health + Leila Farouk, plus positive feedback history from pre-seeded state.
4. **API Security Checklist** appears — relevant to compliance/security work and Leila's cloud expertise.

**Voiceover annotation (this is the key explanatory moment):**
> "Notice what's missing. Meridian Financial was suggested two minutes ago — after the rejection, it's gone. The algorithm penalised it. Meanwhile, confirmed entities now show up with higher confidence."

**Voice delivery tips:**
- Natural pace, not reading
- This isn't the showstopper monologue of the old script — it's shorter and punchier
- The visual reveal does the heavy lifting

**Editor:** This is the money shot. Three phases:
1. Voice input at real speed
2. Speed through processing (2-3x)
3. SLOW DOWN for the reveal — hold on the suggestion suffix for 3-4 seconds so the viewer can see what IS and ISN'T there. Consider a split-screen comparison overlay: "Beat 1 suggestions" vs "Beat 4 suggestions" side by side, with rejected entities crossed out.

---

## Beat 5: "Show me the learning" (3:20-4:20)

**Hero panel: LEFT (dashboard data)**

**Voice (leaning back, curious):**
> "Show me the feedback dashboard — how's the system learning?"

| Panel | What the viewer sees |
|-------|---------------------|
| LEFT | Dashboard response streams in: overall accuracy (e.g., 82%), total feedback entries (34), boost tiers showing Sarah Mitchell and Acme Data Migration at strong (+10), Meridian Financial now suppressed, GlobalBank pre-suppressed. Entity graduation: entities moving from "learning" to "strong" tier. |
| CENTRE | Daily note holds steady — full audit trail of the session visible |
| RIGHT | Graph holds steady |

**What this proves:** The numbers behind the learning. The viewer can see that feedback directly changes scores. The system is transparent — not a black box.

**Optional enhancement:** Follow up with `suggest_wikilinks` in `detail: true` mode on a test sentence to show the per-layer score breakdown:
> "Check the score breakdown for Sarah Mitchell."

This shows: contentMatch +8, cooccurrence +3, typeBoost +3, feedbackAdjustment +10 = total 24. vs. Meridian Financial: contentMatch +6, but suppressionPenalty -15 = total -9 (filtered out). The numbers make the feedback effect visceral.

**Editor:** This is data-heavy. Show the dashboard for 3-4 seconds. If using the score breakdown, overlay a clean table (not raw JSON). Use callout to highlight the `feedbackAdjustment` rows. Don't linger — the viewer needs to grasp "numbers go up for good entities, down for bad ones" and move on.

---

## Beat 6: "The graph remembers" (4:20-5:00)

**Hero panel: RIGHT (graph), then fade**

**Voice (quiet, satisfied):**
> "Show me the Acme cluster."

| Panel | What the viewer sees |
|-------|---------------------|
| LEFT | (faded) |
| CENTRE | (faded) |
| RIGHT | Graph zooms to Acme Corp subgraph. Thick connections to Sarah Mitchell, Marcus Webb, Acme Data Migration, Rate Card (recently confirmed). Thin/absent connection to Meridian Financial (suppressed). The visual weight of edges reflects the feedback — confirmed relationships are thick, rejected ones thin or missing. |

Hold for 3-4 seconds. No voiceover. Just the graph.

**Voice (over the closing shot):**
> "Every suggestion you accept strengthens a connection. Every rejection teaches the algorithm what doesn't belong. Your vault doesn't just store — it learns."

Fade to repo URL.

**Closing card:** "Flywheel Memory — cognitive sovereignty for your Obsidian vault." 5 seconds. Done.

---

## Centre Panel: Learning Loop Summary

The daily note shows the full feedback cycle:

| Beat | Centre panel shows |
|------|-------------------|
| 1 | Entry appears with auto-wikilinks + `→` suggestion suffix (4 suggestions) |
| 2 | Suggestion suffix updates — 2 entities fade (rejected) |
| 3 | Remaining 2 suggestions promoted to full wikilinks (accepted) |
| 4 | Second entry — better suggestions, rejected entities absent |
| 5 | Audit trail of entire session visible |
| 6 | (faded — graph takes focus) |

By Beat 4, the viewer realises the suggestions improved from one write to the next. The system learned in real time.

---

## Voice Delivery Tips

- **Beat 1:** Crisp, morning energy. Business update. Decisive.
- **Beats 2-3:** Evaluative. Thinking out loud. "Hmm — that's not right" into "yes, that's correct." The consultant is curating, not just dictating.
- **Beat 4:** Natural post-call energy. The viewer should feel the contrast — same voice-capture pattern as Beat 1, but the system responds differently.
- **Beat 5:** Curious, data-interested. Leaning back.
- **Beat 6:** Quiet satisfaction. Let the graph speak.

---

## Recording Breakdown

Record panels separately, sync in post. The daily note format (structured audit log with timestamps) is different from the Telegram chat, so cross-panel text won't match word-for-word. Three different representations of the same interaction.

### LEFT (Telegram + Wispr)
One recording session. Run all 6 beats sequentially. Voice through Wispr Flow appears as typed text in Telegram. Can re-record independently if a beat's response is bad.

### CENTRE (Obsidian daily note)
Key moments:
- Beat 1: Daily note materialises with auto-wikilinks + `→` suggestions (FIRST VISUAL)
- Beat 2-3: Suggestion suffix updates as feedback is recorded
- Beat 4: Second entry — cleaner suggestions (THE REVEAL)
- Beat 5: Full audit trail visible

### RIGHT (Crank graph panel)
Key moments:
- Beat 1: Existing entity constellation (baseline from pre-seeded state)
- Beat 2-3: Edge weights shift subtly (rejections dim, confirmations brighten)
- Beat 4: New cluster forms (Nexus Health)
- Beat 6: Acme subgraph click — edge weights reflect feedback (CLOSING SHOT)

### Audio
AI voiceover generated separately for all 6 beats. Beats 2-3 should sound evaluative, not commanding. Beat 4 same energy as Beat 1 — the contrast in system response is what lands, not the voice.

---

## Recording Order

```
Session 1: Seed state.db. Reset daily-notes. Run all 6 beats in Telegram. Record LEFT panel.
Session 2: Reset daily-notes. Re-run beats. Record CENTRE + RIGHT simultaneously.
Session 3: Generate AI voiceover for all 6 beats.
```

Or: run once, screen-record Obsidian and Crank simultaneously (two capture regions), then record Telegram separately if needed for a cleaner take.

---

## Editor Notes

- **Processing gaps:** Cut or speed to 3-4x. Never show waiting.
- **Suggestion suffix:** This is the visual star of the demo. When suggestion lines appear (e.g., `→ [[Acme Data Migration]], [[Rate Card]]`), highlight or zoom momentarily. The arrow prefix distinguishes suggestions from applied links.
- **Beat 4 comparison:** Consider a split overlay — "Beat 1 suggestions" on left, "Beat 4 suggestions" on right. Cross out the rejected entities. This is the single most important editorial moment.
- **Graph animations:** Real speed or slower. Edge weight changes are the visual payoff — don't rush them.
- **Dashboard (Beat 5):** Format as a clean table overlay, not raw JSON. Highlight the feedback adjustment numbers.
- **Audio:** Light ambient music, ducked under voice. No music during Beats 2-3 (the evaluative beats need clarity). Music swells for Beat 4 reveal and Beat 6 graph.
- **End card:** Repo URL + "Flywheel Memory — cognitive sovereignty for your Obsidian vault." 5 seconds. Done.

---

## File Handoff

```
footage/
+-- telegram-beat1-capture.mp4
+-- telegram-beat2-reject.mp4
+-- telegram-beat3-accept.mp4
+-- telegram-beat4-capture2.mp4
+-- telegram-beat5-dashboard.mp4
+-- telegram-beat6-graph.mp4
+-- obsidian-beat1-suggestions.mp4
+-- obsidian-beat2-3-feedback.mp4
+-- obsidian-beat4-reveal.mp4
+-- obsidian-beat5-audit.mp4
+-- graph-beat1-baseline.mp4
+-- graph-beat2-3-edges.mp4
+-- graph-beat4-nexus.mp4
+-- graph-beat6-acme-cluster.mp4
+-- voice-beat1.mp3
+-- voice-beat2.mp3
+-- voice-beat3.mp3
+-- voice-beat4.mp3
+-- voice-beat5.mp3
+-- voice-beat6.mp3
+-- script.md
```

---

## Entity Checklist

Before filming, verify every entity mentioned in Beats 1-6 exists in the vault with enough frontmatter for auto-wikilinks to fire:

**Beat 1 (auto-wikilinks):**
- [ ] Sarah Mitchell — VP Technology, Acme Corp
- [ ] Acme Corp — client note
- [ ] Marcus Webb — Senior Data Engineer
- [ ] Data Migration Playbook — knowledge asset
- [ ] Acme Analytics Add-on — proposal

**Beat 1 (suggestions):**
- [ ] Acme Data Migration — project note
- [ ] Discovery Workshop Template — knowledge asset
- [ ] Meridian Financial — client note (will be suppressed after Beat 2)
- [ ] Rate Card — knowledge asset

**Beat 4 (auto-wikilinks):**
- [ ] Nexus Health — client note
- [ ] Leila Farouk — cloud/security contractor
- [ ] Priya Kapoor — financial modeling contractor

**Beat 4 (suggestions):**
- [ ] Nexus Health Cloud Assessment — proposal
- [ ] API Security Checklist — knowledge asset

**Beat 5 (dashboard references):**
- [ ] GlobalBank — client note (pre-suppressed in seeded state)

If any entity is mentioned in a beat but doesn't have a vault note, the auto-wikilink won't fire and the suggestion won't appear.

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

## The Flywheel Effect (reference for blog post / X thread)

This section is NOT part of the video. It preserves the learning-loop concept for future written content.

### The Learning Loop

```
Write content
     |
     v
Auto-wikilinks fire (high confidence)
+ Suggestions appended (algorithm's best guesses)
     |
     v
Human reviews suggestions
     |
     +-- Accept --> Positive feedback --> Entity boosted (+2 to +10)
     |
     +-- Reject --> Negative feedback --> Entity suppressed (-15 penalty)
     |
     v
Next write: better suggestions
     |
     v
Graph densifies with confirmed relationships
     |
     v
Search and context improve
     |
     (loop repeats)
```

### The 13-Layer Scoring Algorithm

Every suggestion is scored through 13 layers:
1. Length/pattern filter
2. Article filter
3. Suppression filter (entities with high false-positive rates blocked here)
4. Exact match (+10 per word)
5. Stem match (+3 to +6)
6. Co-occurrence boost (+3 per relationship, capped at 6)
7. Type boost (people +5, projects +3)
8. Context boost (daily notes boost people, tech docs boost tech)
9. Recency boost (+8 last hour, decays to 0)
10. Cross-folder boost (+3)
11. Hub boost (eigenvector centrality, 0 to +6)
12. **Feedback adjustment (+5 to -4 based on your accept/reject history)**
13. Edge weight (link survival tracking, 0 to +4)

Layer 12 is the hero of this demo. It's the layer that responds to your judgment and changes the algorithm's behaviour over time.

### Why Feedback Matters More Than Precision

A static tool gives the same scores on day 1 and day 100. Flywheel's scores change based on accumulated feedback:

| Timeframe | Sarah Mitchell score | Meridian Financial score |
|-----------|---------------------|------------------------|
| Week 1 | 18 (match + type + context) | 14 (match + co-occurrence) |
| Week 4 | 28 (+10 feedback boost) | 14 (no feedback yet) |
| Week 8 | 28 (stable — consistently correct) | -1 (suppressed — too many false positives) |

The vault doesn't just store — it learns what matters to you.

### Key Message

"Your vault learns what you know. Accept a suggestion, strengthen a connection. Reject one, teach the algorithm what doesn't belong. Over time, your knowledge graph reflects your judgment — not just your words."
