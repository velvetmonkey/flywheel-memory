---
title: Gene Regulatory Network Construction - Embryonic Development
date: 2024-11-12
type: experiment
status: completed
tags: [grn, network-inference, development]
methods: [Centrality-Measures, Network-Inference]
---

# [[Gene Regulatory Network Construction]] - [[Embryonic Development]]

## [[Objective

Infer]] gene regulatory network for mouse early embryonic development [[Using]] single-cell RNA-Seq time course.

## Methods

### Dataset
- **Source**: Mouse embryonic development (E3.5 - E6.5)
- **Cells**: 12,482 cells across 8 time points
- **Genes**: 2,500 highly variable genes
- **Platform**: 10x Genomics

### [[Network Inference]]
- **Algorithm**: SCENIC (Single-Cell regulatory network Inference and Clustering)
- **Motif discovery**: [[RcisTarget]]
- **Regulon activity**: AUCell [[Scoring]]

Applied [[Centrality Measures]] to inferred network:
- [[Identify]] [[Master Regulators]] ([[High]] degree)
- Find [[Regulatory Bottlenecks]] (high betweenness)

## [[Results]]

### [[Network Statistics]]
- **Nodes**: 2,500 genes
- **Edges**: 8,947 regulatory interactions
- **Regulons**: 142 transcription factors
- **Average degree**: 3.6

### Master Regulators
**[[Top]] TFs by degree centrality** (from [[Centrality Measures]]):
1. **Oct4** (degree=247, pluripotency)
2. **Sox2** (degree=198, neural fate)
3. **Nanog** (degree=156, ICM specification)
4. **Gata6** (degree=134, primitive endoderm)
5. **Cdx2** (degree=112, trophectoderm)

[[All]] known [[Key]] developmental regulators ✓

### Regulatory Bottlenecks
**High betweenness centrality**:
- **Eomes**: Bridges pluripotent and differentiated states
- **Otx2**: [[Controls]] fate transitions
- **Tfap2c**: Trophectoderm commitment

### [[Network Modules]]
- [[Module 1]]: Pluripotency [[Maintenance]] (Oct4, Sox2, Nanog)
- [[Module 2]]: ICM specification (Nanog, Gata3)
- [[Module 3]]: Trophectoderm (Cdx2, Tfap2c)
- [[Module 4]]: Primitive endoderm (Gata6, Sox17)

## [[Discussion

Network]] inference [[Successfully]] identifies known developmental regulators. [[Centrality Measures]] from [[Barabasi2004-Network-Biology]] predict biological importance.

## [[Related Work]]

- Uses [[Centrality Measures]]
- Methods from [[Barabasi2004-Network-Biology]]
- Contributes to [[Gene Regulatory Networks]]

## [[Data Location]]

`/data/experiments/2024-11-12_dev_GRN/`
