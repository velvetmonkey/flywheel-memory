# Beta Testing Protocol

How to test the graph quality engine against any Obsidian vault.

---

## 1. Generate a Fixture from Your Vault

Run against a live vault directory to produce a JSON fixture:

```bash
npx tsx test/graph-quality/generate-fixture.ts ~/obsidian/MyVault > fixture.json
```

Or manually build the fixture JSON:

```json
{
  "description": "My vault — 500 notes, personal knowledge",
  "seed": 42,
  "notes": [
    {
      "path": "projects/ProjectAlpha.md",
      "title": "Project Alpha",
      "content": "# Project Alpha\n\nWorking with [[Bob]] on [[React]] integration...",
      "frontmatter": { "type": "project", "tags": ["active"] }
    }
  ],
  "entities": [
    { "name": "Project Alpha", "path": "projects/ProjectAlpha.md", "category": "projects", "aliases": ["Alpha"] }
  ],
  "groundTruth": [
    { "notePath": "daily/2026-02-20.md", "entity": "Project Alpha", "tier": 1 }
  ]
}
```

### Fields

- **notes**: All notes with full content (wikilinks intact).
- **entities**: All entities the engine should know about.
- **groundTruth**: The links you expect the engine to find. Each entry is a (notePath, entity) pair with a difficulty tier:
  - **Tier 1 (Easy)**: Entity name appears verbatim in note content.
  - **Tier 2 (Medium)**: Entity is referenced by alias, stem, or partial match.
  - **Tier 3 (Hard)**: Entity is only discoverable via co-occurrence, semantic similarity, or graph structure.

## 2. Curate Ground Truth

This is the critical step. Ground truth must be **manually verified**.

### Process

1. **Select 20-30 representative notes** spanning different folders, topics, and note sizes.
2. For each note, **list every entity that should be linked** (not just obvious ones).
3. Assign difficulty tiers honestly — most links should be Tier 1 or 2.
4. **Validate**: for each ground truth entry, confirm the entity exists in the entities array and the note exists in notes.

### What Makes Good Ground Truth

- Diverse note types (daily notes, project notes, reference notes, meeting notes).
- Mix of obvious links (entity name in text) and subtle links (co-occurrence, context).
- Include negative examples: notes where an entity is mentioned but should NOT be linked (e.g., the entity's own note).
- At least 5 Tier 3 links to test graph-aware scoring.

### Anti-patterns

- Don't include every possible link — focus on the ones a human would want.
- Don't bias toward easy links — include ambiguous cases.
- Don't use the engine's output to define truth (that's circular).

## 3. Run the Evaluation

```bash
# Place fixture in test/graph-quality/fixtures/
cp fixture.json packages/mcp-server/test/graph-quality/fixtures/my-vault.json

# Run via harness (add a test file or use the REPL)
npx tsx -e "
import { buildGroundTruthVault, stripLinks, runSuggestionsOnVault, evaluateResults, loadFixture } from './packages/mcp-server/test/graph-quality/harness.js';

const spec = await loadFixture('my-vault');
const vault = await buildGroundTruthVault(spec);
await stripLinks(vault, spec.groundTruth);
const runs = await runSuggestionsOnVault(vault, { strictness: 'balanced' });
const metrics = evaluateResults(runs, spec.groundTruth);
console.log(JSON.stringify(metrics, null, 2));
await vault.cleanup();
"
```

## 4. Metrics to Collect

| Metric | Target | Notes |
|--------|--------|-------|
| Precision (conservative) | > 90% | False positives should be rare |
| Recall (balanced) | > 60% | Most ground truth links found |
| F1 (balanced) | > 65% | Harmonic mean |
| Tier 1 recall | > 80% | Obvious links must be found |
| Tier 2 recall | > 50% | Aliases/stems should work |
| Tier 3 recall | > 20% | Graph layers add value |
| MRR | > 0.3 | Correct suggestions ranked highly |
| Chaos delta | < 15pp | Resilient to messy input |

## 5. Report Results

Create a report with:

1. **Vault profile**: note count, entity count, folder structure, average note length.
2. **Precision/recall table** by strictness mode.
3. **Tier breakdown** — recall per difficulty tier.
4. **Layer ablation** — which layers contributed on this vault.
5. **Failure analysis** — list false positives and missed links with explanations.
6. **Comparison to synthetic** — how do real-vault metrics compare to the primary fixture?

### Template

```markdown
## Vault: [Name]
- Notes: N, Entities: N, Ground truth: N links
- Structure: [description of folder layout and content types]

### Results
| Mode | P | R | F1 |
|------|---|---|---|
| conservative | X% | X% | X% |
| balanced | X% | X% | X% |

### Tier Breakdown
| Tier | Recall |
|------|--------|
| 1 | X% |
| 2 | X% |
| 3 | X% |

### Layer Impact
[Which layers contributed non-zero delta on this vault]

### Notable Failures
- [Entity X not found in Note Y because...]
- [False positive: Entity Z suggested for Note W because...]
```

## 6. Iterate

After testing against 3+ vaults:

1. Identify systematic failure patterns (e.g., "short entity names always false-positive").
2. File issues for engine improvements.
3. Update `baselines.json` if new fixtures reveal tighter/looser thresholds.
4. Add the fixture to the test suite if it covers a topology not yet represented.
