---
title: Molecular Dynamics Equilibration - Membrane Protein System
date: 2024-11-08
type: experiment
status: completed
tags: [molecular-dynamics, membrane-proteins, simulation]
methods: [AMBER-Force-Field, Periodic-Boundary-Conditions]
---

# [[Molecular Dynamics Equilibration]] - [[Membrane Protein System]]

## [[Objective

Equilibrate]] GPCR embedded in lipid bilayer for [[Production]] MD simulations. Validate [[Force Field]] and simulation [[Protocol]].

## Methods

### [[System Preparation]]
- **Protein**: β2-adrenergic receptor (PDB 3SN6)
- **Membrane**: POPC bilayer (200 lipids)
- **Solvent**: TIP3P water, 150 mM NaCl
- **[[System]] size**: ~65,000 atoms

### Force Field
[[AMBER Force Field]] (ff19SB) from [[Karplus2002-Molecular-Dynamics]]:
- **Protein**: ff19SB
- **Lipids**: Lipid21
- **Water**: TIP3P

### [[Equilibration Protocol]]
```bash
# Minimization
pmemd.cuda -O -i min.in -p system.prmtop

# Heating: 0 → 310 K (100 ps)
pmemd.cuda -O -i heat.in -p system.prmtop

# Density equilibration: NPT (1 ns)
pmemd.cuda -O -i equil_npt.in -p system.prmtop

# Production equilibration: NPT (10 ns)
pmemd.cuda -O -i equil_prod.in -p system.prmtop
```

## Results

### System Stability
**RMSD** (protein backbone):
- First 2 ns: Rapid equilibration (0 → 2.5 Å)
- 2-10 ns: Stable (2.5 ± 0.3 Å)
- System equilibrated ✓

**Membrane properties**:
- Area per lipid: 64.2 ± 1.1 Å² (literature: 64.3)
- Bilayer thickness: 38.6 ± 0.4 Å (literature: 38.9)
- Well equilibrated ✓

**Temperature**: 309.8 ± 0.6 K (target: 310 K)
**Pressure**: 0.98 ± 0.12 bar (target: 1 bar)

### Protein Structure
- Transmembrane helices stable
- Extracellular loops show expected flexibility
- Ligand binding pocket preserved
- Ready for production simulations

## Discussion

System well-equilibrated using [[AMBER Force Field]] protocol. Membrane properties match experimental values.

## Related Work

- Methods from [[Karplus2002-Molecular-Dynamics]]
- Uses [[AMBER Force Field]]
- [[Periodic Boundary Conditions]]

## Data Location

`/[[Data]]/experiments/2024-11-08_GPCR_equilibration/`
