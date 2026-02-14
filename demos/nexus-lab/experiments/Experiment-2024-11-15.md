---
title: Single-Cell RNA-Seq - Mouse Embryonic Stem Cells
date: 2024-11-15
type: experiment
status: completed
tags: [scrna-seq, stem-cells, transcriptomics]
methods: [RPKM-Normalization, Single-Cell-Isolation]
related_experiments: [Experiment-2024-11-16]
---

# Single-Cell RNA-Seq - [[Mouse Embryonic Stem Cells]]

## [[Objective

Profile]] transcriptional heterogeneity in mESC culture. [[Identify]] subpopulations and marker genes.

## Methods

### [[Cell Preparation]]
- Used [[Single-Cell Isolation]] [[Protocol]] from [[Tang2009-Single-Cell-RNA-Seq]]
- 10x Chromium platform, [[Target]] 5000 cells
- Cell viability: 92%

### [[Library Prep]] & Sequencing
- [[Chromium Single Cell]] 3' v3.1
- [[NovaSeq]] 6000, 50K reads/cell
- [[RPKM Normalization]] from [[Mortazavi2008-RNA-Seq]]

### [[Analysis Pipeline]]
```bash
cellranger count --id=mESC_sample1
seurat_analysis.R # Clustering, marker detection
```

## Results

### Quality Metrics
- 4,842 cells passed QC
- Median genes/cell: 2,341
- Doublet rate: 3.2%

### Cell Populations
- **Cluster 0** (2,103 cells): Pluripotent core (Nanog+, Oct4+)
- **Cluster 1** (1,421 cells): Early differentiation (Fgf5+)
- **Cluster 2** (892 cells): Cell cycle active (Mki67+)
- **Cluster 3** (426 cells): Rare primed state (Otx2+)

## Discussion

Identified 4 distinct subpopulations consistent with culture heterogeneity. Rare primed state cluster (8.8%) matches previous observations.

**Next steps**: [[Experiment-2024-11-16]] will validate marker genes and characterize differentiation trajectories.

## Related Work

- Built on [[Tang2009-Single-Cell-RNA-Seq]] methodology
- Informs [[Single-Cell RNA-Seq Analysis]] project
- Feeds into [[Cell-Type-Classification]]

## Data Location

`/[[Data]]/experiments/2024-11-15_mESC_scRNAseq/`
