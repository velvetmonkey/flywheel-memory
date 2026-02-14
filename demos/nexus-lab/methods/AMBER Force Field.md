---
title: AMBER Force Field
type: method
tags: [molecular-dynamics, force-field, protein-simulation]
introduced_by: "Cornell et al. 1995"
version: ff19SB
alternatives: [CHARMM, GROMOS, OPLS]
---

# [[AMBER Force Field]]

## [[Overview

Assisted Model Building]] with [[Energy Refinement]] - empirical [[Force Field]] for biomolecular simulations.

## [[Energy Function]]

```
E_total = E_bond + E_angle + E_dihedral + E_vdw + E_elec
```

## [[Components]]

- **Bond stretching**: Harmonic potential
- **Angle bending**: Harmonic potential
- **Dihedral rotation**: Fourier series
- **Van der Waals**: Lennard-[[Jones 12]]-6
- **Electrostatics**: Coulomb with dielectric

## Parameterization

From [[Karplus2002-Molecular-Dynamics]]:
- Parameters fit to quantum mechanics calculations
- Tested on protein structures and dynamics
- Regular updates (ff14SB, ff19SB)

## [[Applications]]

### [[Protein-Ligand Docking]]
[[Used In]] [[Experiment-2024-11-22]] for binding affinity refinement.

### [[Protein Folding
Simulating]] conformational changes and stability.

## [[Software]]

- **AMBER**: Native implementation
- **GROMACS**: Ported parameters
- **OpenMM**: [[Python]] interface

## [[Related Methods]]

- [[CHARMM Force Field]] - Alternative parameterization
- [[Molecular Dynamics]] - Simulation technique
- [[Free Energy Calculations]] - Binding affinity prediction
