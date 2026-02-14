---
title: Transcription Factor Binding Site Prediction - CTCF Motifs
date: 2024-11-01
type: experiment
status: completed
tags: [tfbs, motif-discovery, genomics]
methods: [Convolutional-Neural-Networks, Position-Weight-Matrices]
---

# [[Transcription Factor Binding Site]] Prediction - [[CTCF Motifs]]

## [[Objective

Train]] CNN to predict CTCF binding sites from DNA sequence. Compare to [[Traditional]] PWM-[[Based]] methods.

## Methods

### Dataset
- **ChIP-Seq**: [[ENCODE CTCF]] (K562 cells)
- **Positive**: 50,000 peak summits ± 50bp
- **Negative**: 50,000 [[Random]] genomic regions
- **[[Validation]]**: [[Chromosome 1]] held out

### [[Model Architecture]]
[[Convolutional Neural Networks]] for sequence motifs (inspired by [[Libbrecht2015-ML-Genomics]]):
```python
# 1D CNN for DNA sequences
Conv1D(filters=320, kernel_size=26, activation='relu')
MaxPooling1D(pool_size=13)
Flatten()
Dense(512, activation='relu')
Dense(1, activation='sigmoid')
```

### Baseline
Position Weight Matrix from JASPAR database.

## Results

### Model Performance
**CNN**:
- AUC-ROC: 0.94
- Precision@1000: 0.88
- Learned de novo CTCF motif (highly similar to known)

**PWM baseline**:
- AUC-ROC: 0.82
- Precision@1000: 0.71

CNN outperforms PWM by capturing sequence context beyond core motif.

### Learned Motifs
Filter visualization shows:
- Core CTCF motif (CCGCGANGGGCGG)
- Flanking GC-rich context
- Spacing constraints

## Discussion

Deep learning captures richer sequence features than traditional PWMs. CNN learns motif de novo without prior knowledge.

## Related Work

- Methods from [[Libbrecht2015-ML-Genomics]]
- Uses [[Convolutional Neural Networks]]
- Contributes to [[Regulatory Element Discovery]]

## Data Location

`/[[Data]]/experiments/2024-11-01_CTCF_prediction/`
