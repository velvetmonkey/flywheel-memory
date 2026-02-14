---
paths: "experiments/**/*.md"
alwaysApply: false
---

# Experiment Format

## Naming Convention

`Experiment-YYYY-MM-DD.md` or `Experiment-YYYY-MM-DD-Description.md`

Example: `Experiment-2026-01-15.md`, `Experiment-2026-01-15-PCR-Optimization.md`

## Required Frontmatter

```yaml
---
type: experiment
status: running
date: 2026-01-15
methods:
  - "[[PCR Protocol]]"
  - "[[Gel Electrophoresis]]"
project: "[[Project Alpha]]"
---
```

## Status Values

- `planned` - Designed but not started
- `running` - Currently in progress
- `complete` - Finished successfully
- `failed` - Did not produce expected results

## Required Sections

### Objective
What question is this experiment trying to answer?

### Methods
Link to method notes: `[[Method Name]]`

### Results
Data, observations, measurements

### Conclusions
Interpretation and next steps

## Metrics

Include quantitative results when applicable:
- Sample sizes
- Statistical values
- Key measurements
