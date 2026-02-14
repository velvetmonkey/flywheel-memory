---
title: Cell Type Marker Validation & Trajectory Analysis
date: 2024-11-16
type: experiment
status: completed
tags: [scrna-seq, validation, trajectory-analysis]
methods: [dimensionality-reduction, pseudotime]
related_experiments: [Experiment-2024-11-15]
builds_on: [Experiment-2024-11-15]
---

# [[Cell Type Marker Validation]] & [[Trajectory Analysis]]

## [[Objective

Validate]] marker genes from [[Experiment-2024-11-15]] and reconstruct differentiation trajectories.

## Methods

### [[Marker Validation]]
- qPCR [[Validation]] of [[Top]] 5 markers per cluster
- Immunofluorescence for protein confirmation
- [[Bulk]] RNA-Seq of FACS-sorted populations

### [[Trajectory Inference]]
- [[Monocle 3]] for pseudotime analysis
- PAGA for trajectory topology
- RNA [[Velocity]] with velocyto

## [[Results]]

### [[Validated Markers]]
- **Pluripotent [[Core]]**: Nanog, Pou5f1, Sox2 ✓
- **Early diff**: Fgf5, Otx2, Utf1 ✓
- **Cell cycle**: Mki67, Top2a, Cdk1 ✓
- **Primed state**: Otx2, Fgf5, Dnmt3b ✓

### Trajectory Analysis
```
Pluripotent Core → Early Differentiation → Primed State
        ↓
   Cell Cycle (transient)
```

Pseudotime correctly ordered cells. RNA velocity confirmed differentiation direction.

## Discussion

Strong validation of clusters from [[Experiment-2024-11-15]]. Trajectory reveals linear differentiation path with cell cycle as transient state.

Bidirectional relationship with [[Experiment-2024-11-15]]: provides biological validation, receives computational predictions.

## Related Work

- Validates [[Experiment-2024-11-15]] findings
- Methods from [[Tang2009-Single-Cell-RNA-Seq]]
- Contributes to [[Cell-Type-Classification]] project

## Data Location

`/[[Data]]/experiments/2024-11-16_mESC_validation/`
