---
title: Single-Cell RNA-Seq Analysis Project
start_date: 2024-10-01
status: active
pi: Dr. Maria Rodriguez
collaborators: [Stem Cell Core, Bioinformatics Core]
funding: NIH R21 HD123456
tags: [scrna-seq, stem-cells, development]
---

# [[Single-Cell RNA-Seq Analysis]] [[Project]]

## [[Overview

Characterize]] cellular heterogeneity in mouse embryonic stem cell cultures [[Using]] single-cell transcriptomics. Map differentiation trajectories and [[Identify]] regulatory programs.

## Hypothesis

mESC cultures contain distinct subpopulations with different differentiation potentials. Single-cell analysis reveals transition states and regulatory networks.

## Approach

### Experimental
- [[Experiment-2024-11-15]]: scRNA-Seq profiling (10x Genomics)
  - 4,842 cells passed QC
  - 4 distinct clusters [[Identified]]
  - Marker genes for [[Each]] population

### [[Validation]]
- [[Experiment-2024-11-16]]: [[Marker Validation]] and [[Trajectory Analysis]]
  - qPCR and immunofluorescence
  - Pseudotime reconstruction
  - RNA [[Velocity]] analysis

## [[Key Findings]]

### [[Cell Populations]]

**Pluripotent [[Core]]** (43%):
- Markers: Nanog, Oct4, Sox2
- [[High]] expression of pluripotency genes
- [[Stable]] in culture

**Early differentiation** (29%):
- Markers: Fgf5, Otx2, Utf1
- Transitioning toward primed state
- Upregulation of lineage markers

**Cell cycle [[Active]]** (18%):
- Markers: Mki67, Top2a, Cdk1
- Transient state across populations
- Normal proliferative cells

**Primed state** (9%):
- Markers: Otx2, Fgf5, Dnmt3b
- Poised for differentiation
- Resembles post-implantation epiblast

### Differentiation Trajectory

```
Pluripotent Core → Early Differentiation → Primed State
        ↓
   Cell Cycle (transient)
```

Linear progression with cell cycle as orthogonal axis.

### Validated Biology

All major markers confirmed by:
- qPCR (quantitative)
- Immunofluorescence (spatial)
- FACS-sorted bulk RNA-Seq (population-level)

## Impact

- Defines mESC culture heterogeneity at single-cell resolution
- Identifies rare primed state population (9%)
- Maps differentiation trajectories with directionality
- Provides markers for cell state isolation

## Publications

**In prep**:
- "Single-cell atlas of mouse embryonic stem cell heterogeneity"
- Target: Cell Stem Cell

## Milestones

- [x] Single-cell profiling
- [x] Clustering and marker identification
- [x] Experimental validation
- [x] Trajectory inference
- [ ] Regulatory network analysis (Dec 2024)
- [ ] Perturbation experiments (Q1 2025)
- [ ] Manuscript submission (Q2 2025)

## Team

- **PI**: Dr. Maria Rodriguez
- **Postdoc**: Jennifer Wu (cell culture, validation)
- **PhD student**: Me (computational analysis)
- **Collaborator**: Dr. Lisa Zhang (Stem Cell Core, FACS)

## Resources

- **Platform**: 10x Genomics Chromium
- **Analysis**: Seurat, Monocle 3, scVelo
- **Code**: `github.com/nexus-lab/mESC-scrna`
- **Data**: `/[[Data]]/projects/scrna-mesc/`

## [[Next Steps]]

1. Gene regulatory [[Network Inference]] (SCENIC)
2. Perturbation of [[Key]] regulators (Nanog, Otx2)
3. Compare to in vivo development
4. [[Multi]]-omics [[Integration]] (scATAC-Seq)
