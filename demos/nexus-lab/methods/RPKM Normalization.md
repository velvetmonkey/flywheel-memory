---
title: RPKM Normalization
type: method
tags: [rna-seq, normalization, gene-expression]
introduced_by: "[[Mortazavi2008-RNA-Seq]]"
alternatives: [TPM, FPKM, DESeq2-normalization]
---

# [[RPKM Normalization]]

## [[Overview

Reads Per Kilobase]] Million - normalization method for RNA-Seq [[Data]] enabling cross-[[Sample]] comparison.

## Formula

```
RPKM = (reads mapped to gene × 10^9) / (total reads × gene length in bp)
```

## Advantages

- **Length correction**: Accounts for gene length bias
- **Depth correction**: Normalizes for sequencing depth
- **Cross-sample**: Enables comparison between experiments

## Limitations

- [[Not]] recommended for differential expression ([[Use]] DESeq2)
- Within-sample comparison biased by [[Composition]]

## [[Applications]]

### Single-Cell RNA-[[Seq
Used]] in [[Tang2009-Single-Cell-RNA-Seq]] and [[Experiment-2024-11-15]].

### [[Bulk]] RNA-[[Seq
Standard]] normalization in [[Mortazavi2008-RNA-Seq]] [[Protocol]].

## [[Related Methods]]

- [[TPM Normalization]] - More appropriate for cross-sample
- [[DESeq2 Normalization]] - For differential expression
- [[Quantile Normalization]] - Microarray method
