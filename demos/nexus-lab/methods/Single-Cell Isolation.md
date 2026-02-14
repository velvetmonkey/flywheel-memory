---
title: Single-Cell Isolation
type: method
tags: [single-cell, cell-sorting, experimental-technique]
applications: [scrna-seq, single-cell-proteomics, single-cell-genomics]
platforms: [10x-Genomics, FACS, microfluidics]
---

# [[Single-Cell Isolation]]

## [[Overview

Techniques]] for physically separating individual cells for downstream single-cell analysis.

## Methods

### Fluorescence-[[Activated Cell Sorting]] (FACS)
- [[High]] throughput (thousands/second)
- Requires [[Surface]] markers
- [[Used In]] [[Tang2009-Single-Cell-RNA-Seq]]

### Microfluidics (10x Genomics)
- Droplet-[[Based]] partitioning
- High throughput, low cost per cell
- Standard for scRNA-Seq

### [[Manual Picking]]
- Low throughput [[But]] precise
- For rare cells or [[Specific]] morphology

## [[Quality Metrics]]

- **Cell viability**: >85% for [[Good]] [[Results]]
- **Doublet [[Rate]]**: <5% [[Target]]
- **Capture efficiency**: Varies by platform (30-70%)

## [[Applications]]

### Single-Cell RNA-[[Seq
Foundation]] for [[Single-Cell RNA-Seq Analysis]] [[Project]]. [[Protocol]] in [[Experiment-2024-11-15]].

### [[Cell Type Discovery
Enables]] unbiased characterization of cellular heterogeneity.

## Considerations

- **Cell stress**: Minimize time from isolation to analysis
- **Batch effects**: Process samples together [[When]] possible
- **Dead cells**: Filter out to avoid contamination

## [[Related Methods]]

- [[Whole Transcriptome Amplification]] - [[Next]] step [[After]] isolation
- [[Cell Barcoding]] - For multiplexing samples
