---
title: Protein-Ligand Docking - EGFR Inhibitor Screening
date: 2024-11-22
type: experiment
status: completed
tags: [docking, molecular-dynamics, structure-based-design]
methods: [AMBER-Force-Field, Molecular-Dynamics]
related_experiments: [Experiment-2024-11-20, Experiment-2024-10-28]
builds_on: [Experiment-2024-10-28, Experiment-2024-11-20]
---

# [[Protein-Ligand Docking]] - EGFR [[Inhibitor Screening]]

## [[Objective

Validate]] [[Top]] 10 drug candidates from [[Experiment-2024-11-20]] [[ML]] predictions [[Using]] molecular docking and MD simulations.

## Methods

### [[Protein Structure]]
- EGFR kinase domain from [[Experiment-2024-10-28]] [[AlphaFold]] prediction
- [[Validated]] against PDB 1M17 (RMSD 0.8 Å)
- Prepared with Schrödinger [[Protein Preparation Wizard]]

### Docking
- **[[Software]]**: [[AutoDock]] Vina
- **Search space**: ATP binding [[Site]] (15 Å box)
- **Exhaustiveness**: 32
- 10 drug candidates from [[Experiment-2024-11-20]]

### MD [[Refinement
Following]] [[Karplus2002-Molecular-Dynamics]] with [[AMBER Force Field]]:
```bash
# Production MD
pmemd.cuda -O -i prod.in -p complex.prmtop -c min.rst
# 100 ns simulation per complex
```

**Force field**: ff19SB for protein, GAFF2 for ligands
**Solvation**: TIP3P water, 12 Å buffer
**Production**: 100 ns, NPT ensemble

## Results

### Docking Scores
**Top 3 candidates**:
1. **Compound_472**: -11.2 kcal/mol (osimertinib analog)
2. **Compound_089**: -10.8 kcal/mol (novel scaffold)
3. **Compound_203**: -10.3 kcal/mol (erlotinib derivative)

### MD Stability
**RMSD analysis** (protein backbone):
- Compound_472: 1.2 ± 0.3 Å (stable)
- Compound_089: 2.8 ± 0.7 Å (moderate fluctuation)
- Compound_203: 1.5 ± 0.4 Å (stable)

**Binding free energy** (MM-GBSA):
- Compound_472: -48.3 ± 4.1 kcal/mol
- Compound_089: -35.2 ± 6.8 kcal/mol
- Compound_203: -42.7 ± 3.9 kcal/mol

### Key Interactions (Compound_472)
- H-bond: Met793 (kinase hinge)
- H-bond: Asp855 (DFG motif)
- Pi-stacking: Phe856
- Hydrophobic: Leu718, Val726

## Discussion

Compound_472 shows best binding profile - validates [[Experiment-2024-11-20]] ML prediction. Novel scaffold Compound_089 less stable but interesting for optimization.

AlphaFold structure from [[Experiment-2024-10-28]] performed well in docking - validates computational structure prediction for drug discovery.

## Related Work

- Structure from [[Experiment-2024-10-28]] (AlphaFold)
- Candidates from [[Experiment-2024-11-20]] (ML prediction)
- Methods from [[Karplus2002-Molecular-Dynamics]]
- Uses [[AMBER Force Field]] methodology
- Built on [[Jumper2021-AlphaFold]]
- Contributes to [[Protein-Ligand Docking]] project

## Next Steps

- Experimental validation (IC50 assays)
- Co-crystal structure determination
- Lead optimization of Compound_472

## Data Location

`/[[Data]]/experiments/2024-11-22_EGFR_docking/`
