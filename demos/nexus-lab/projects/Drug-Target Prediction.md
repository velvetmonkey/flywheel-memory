---
title: Drug-Target Prediction Project
start_date: 2024-09-15
status: active
pi: Dr. Sarah Chen
collaborators: [Computational Biology Core, Medicinal Chemistry]
funding: NIH R01 CA234567
tags: [drug-discovery, machine-learning, network-biology]
---

# Drug-[[Target Prediction Project]]

## [[Overview

Develop]] [[Machine Learning]] platform for predicting drug-protein interactions by integrating network biology, structural [[Data]], and chemical [[Features]].

## [[Hypothesis

Protein]] network centrality combined with structural and chemical features improves [[Drug-Target Prediction]] accuracy beyond sequence-[[Based]] methods alone.

## Approach

### [[Data Integration]]
- **Network features**: From [[Experiment-2024-11-18]] PPI analysis
- **Structural features**: [[AlphaFold]] structures ([[Experiment-2024-10-28]])
- **Chemical features**: Molecular fingerprints, physicochemical properties
- **Experimental data**: BindingDB, ChEMBL (IC50 < 100nM)

### [[Machine]] [[Learning]]
- [[Experiment-2024-11-20]]: [[Random Forest]] classifier (AUC 0.89)
- [[Feature]] importance analysis validates network contribution
- [[Cross-Validation]] on held-out targets

### [[Experimental Validation]]
- [[Experiment-2024-11-19]]: CRISPR essentiality screens
- [[Experiment-2024-11-22]]: Molecular docking and MD simulations
- [[Planned]]: IC50 assays for [[Top]] predictions

## [[Key Results]]

1. **Network features predictive**: Degree centrality in top-3 features
2. **[[High]] accuracy**: 89% AUC-ROC on [[Test]] set
3. **Experimental [[Validation]]**:
   - CRISPR confirms hub proteins [[Essential]]
   - Docking validates predicted compounds
   - Compound_472: -11.2 kcal/mol binding energy

## Impact

- Reduces experimental screening burden
- Integrates [[Systems]] biology with drug discovery
- Enables [[Computational]] prioritization of compounds

## Publications

**In prep**:
- "Network-informed machine learning for drug-[[Target]] prediction"
- Target: [[Nature Communications]]

**Presentations**:
- Lab meeting ([[Nov 19]], 2024)
- [[RECOMB 2025]] (submitted abstract)

## [[Milestones]]

- [x] PPI [[Network Construction]]
- [x] [[ML]] model development
- [x] Computational validation
- [ ] IC50 experimental validation ([[Dec 2024]])
- [ ] [[Lead]] [[Optimization]] (Q1 2025)
- [ ] Manuscript submission (Q2 2025)

## [[Team]]

- **PI**: Dr. [[Sarah Chen]]
- **Postdoc**: [[Alex Kim]] (ML development)
- **PhD student**: Me (network biology, validation)
- **Collaborator**: Dr. [[James Park]] ([[Medicinal Chem]], IC50 assays)

## Resources

- **Compute**: GPU cluster (NVIDIA A100)
- **Code**: `github.com/nexus-lab/drug-target-ml`
- **Data**: `/data/projects/drug-target-prediction/`

## [[Next Steps]]

1. Experimental IC50 validation for [[Top 10]] compounds
2. Extend to additional kinase families
3. Develop web server for predictions
4. Manuscript writing
