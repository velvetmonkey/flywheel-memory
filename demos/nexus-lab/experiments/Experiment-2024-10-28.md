---
title: AlphaFold Structure Prediction - EGFR Kinase Domain
date: 2024-10-28
type: experiment
status: completed
tags: [alphafold, protein-structure, structural-biology]
methods: [Transformer-Architecture, Multiple-Sequence-Alignment]
related_experiments: [Experiment-2024-11-22]
---

# [[AlphaFold]] [[Structure Prediction]] - EGFR [[Kinase Domain]]

## [[Objective

Generate]] [[High]]-confidence structure prediction for [[EGFR Kinase]] domain (residues 696-1022) for [[Use]] in drug docking studies.

## Methods

### [[Sequence Preparation]]
- **[[Target]]**: Human EGFR kinase domain
- **[[UniProt]]**: P00533
- **Length**: 327 residues
- **Known structures**: PDB 1M17, 2GS7 (for [[Validation]])

### AlphaFold [[Setup
Following]] [[Jumper2021-AlphaFold]] methodology:
- **MSA generation**: JackHMMER (5 iterations, UniRef90)
- **Template search**: HHsearch against PDB70
- **Model**: AlphaFold v2.3
- **Predictions**: 5 models, ranked by pLDDT

Uses [[Transformer Architecture]] for structure module.

## [[Results]]

### [[Model Quality]]
**[[Best]] model (rank_1)**:
- **pLDDT**: 94.2 (very high confidence)
- **pTM score**: 0.87
- **[[Alignment]] [[Coverage]]**: 98.4%

**Validation against PDB 1M17**:
- **RMSD**: 0.8 Å (Cα atoms)
- **TM-score**: 0.96
- [[Excellent]] agreement

### [[Confident Regions]]
- **Kinase N-lobe** (696-812): pLDDT 96.1
- **Kinase C-lobe** (813-1010): pLDDT 95.3
- **C-[[Terminal]] tail** (1011-1022): pLDDT 72.4 (flexible, expected)

### [[Key Structural Features]]
- ATP binding [[Site]] well-[[Defined]]
- DFG motif (Asp855-Phe856-Gly857) in [[Active]] conformation
- Activation loop (858-875) partially disordered

## [[Discussion

High]]-confidence prediction validates AlphaFold for drug discovery [[Applications]]. Structure quality sufficient for molecular docking.

**[[Next Steps]]**: Use in [[Experiment-2024-11-22]] for drug screening.

## [[Related Work]]

- Methods from [[Jumper2021-AlphaFold]]
- Uses [[Transformer Architecture]]
- [[Multiple Sequence Alignment]] [[Processing]]
- Structure [[Used In]] [[Experiment-2024-11-22]]
- Contributes to [[Structure-Based Drug Design]]

## [[Data Location]]

`/data/experiments/2024-10-28_alphafold_EGFR/`
