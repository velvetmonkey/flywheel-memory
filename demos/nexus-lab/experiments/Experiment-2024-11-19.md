---
title: Hub Protein Validation - CRISPR Knockout Screen
date: 2024-11-19
type: experiment
status: completed
tags: [crispr, validation, functional-genomics]
methods: [Guide-RNA-Design, High-Throughput-Screening]
related_experiments: [Experiment-2024-11-18]
builds_on: [Experiment-2024-11-18]
---

# [[Hub Protein Validation]] - [[CRISPR Knockout]] Screen

## [[Objective

Experimentally]] validate hub proteins from [[Experiment-2024-11-18]] [[PPI Network Analysis]]. [[Test]] essentiality in cancer [[Cell Lines]].

## Methods

### sgRNA [[Design]]
- [[Guide RNA Design]] [[Using]] [[Tools]] from [[Haeussler2016-CRISPR-Tools]]
- 4 sgRNAs per gene ([[Top]] 15 hub proteins)
- CFD [[Scoring]] for off-[[Target]] prediction

### Cell Lines
- HCC827 (EGFR-[[Driven]] NSCLC)
- MDA-MB-231 (triple-negative breast cancer)
- [[Control]]: non-[[Essential]] genes + non-targeting

### [[Screen Protocol]]
- Lentiviral pooled library
- 14-day growth assay
- MAGeCK analysis for depletion

## [[Results]]

### [[Essential Hub Proteins]]
**[[Strong]] depletion (log2FC < -2)**:
- EGFR ✓ (expected, oncogene addiction)
- GRB2 ✓ (adapter, synthetic lethal)
- SRC ✓ (kinase, druggable)
- PIK3CA ✓ (pathway driver)

**Moderate depletion (log2FC -1 to -2)**:
- MAPK1, GAB1, SHC1

**Non-essential**:
- STAT3 ([[Context]]-dependent)

### Correlation with Network Metrics
```
Essentiality vs Degree: r = 0.73 (p < 0.001)
Essentiality vs Betweenness: r = 0.68 (p < 0.01)
```

Strong correlation validates network-based prediction.

## Discussion

Network [[Centrality Measures]] from [[Experiment-2024-11-18]] successfully predict functional essentiality. High-degree proteins are preferentially essential.

Bidirectional validation: [[Experiment-2024-11-18]] predicts hubs → this experiment validates → informs future network analysis.

## Related Work

- Validates [[Experiment-2024-11-18]] predictions
- Methods from [[Haeussler2016-CRISPR-Tools]]
- Contributes to [[Drug-Target Prediction]] project
- Feeds into [[Gene Knockout Validation]]

## Data Location

`/[[Data]]/experiments/2024-11-19_CRISPR_validation/`
