---
title: Drug-Target Prediction - Machine Learning Approach
date: 2024-11-20
type: experiment
status: completed
tags: [machine-learning, drug-discovery, random-forest]
methods: [Random-Forests, Feature-Engineering]
related_experiments: [Experiment-2024-11-18, Experiment-2024-11-22]
---

# [[Drug-Target Prediction]] - [[Machine Learning Approach]]

## [[Objective

Build]] [[Machine Learning]] model to predict drug-protein binding. [[Use]] [[Validated]] hub proteins from [[Experiment-2024-11-18]] as [[High]]-[[Priority]] targets.

## Methods

### Dataset
- **Positive examples**: 15,000 drug-[[Target]] pairs (BindingDB, Kd < 100nM)
- **Negative examples**: 15,000 [[Random]] pairs (no known interaction)
- **[[Validation]] set**: Hub proteins from [[Experiment-2024-11-18]]

### [[Features
Following]] [[Libbrecht2015-ML-Genomics]] [[Feature Engineering]]:

**Protein [[Features]]** (1,024 dim):
- Sequence-[[Based]]: [[Composition]], motifs, domains
- Structure-based: secondary structure, [[Surface]] accessibility
- Network-based: degree, betweenness from [[Centrality Measures]]

**Drug features** (512 dim):
- Molecular fingerprints (Morgan, MACCS)
- Physicochemical properties
- 3D conformer descriptors

### Model
[[Random Forests]] classifier from [[Libbrecht2015-ML-Genomics]]:
```python
from sklearn.ensemble import RandomForestClassifier
rf = RandomForestClassifier(
    n_estimators=500,
    max_depth=20,
    min_samples_split=10
)
rf.fit(X_train, y_train)
```

## Results

### Model Performance
- **AUC-ROC**: 0.89 (test set)
- **Precision@100**: 0.76 (top predictions)
- **Recall**: 0.82 (sensitivity)

### Feature Importance
Top features:
1. Protein binding pocket properties (0.18)
2. Drug lipophilicity (0.14)
3. Network degree centrality (0.12) ← validates network analysis
4. Molecular weight (0.09)
5. Protein domain composition (0.08)

### Hub Protein Predictions
Predicted 47 drug candidates for [[Experiment-2024-11-18]] hub proteins. Top 10 advanced to docking in [[Experiment-2024-11-22]].

## Discussion

Network centrality from [[Experiment-2024-11-18]] is predictive feature - validates systems biology approach.

## Related Work

- Methods from [[Libbrecht2015-ML-Genomics]]
- Uses [[Random Forests]] methodology
- Hub proteins from [[Experiment-2024-11-18]]
- Predictions validated in [[Experiment-2024-11-22]]
- Contributes to [[Drug-Target Prediction]] project

## Data Location

`/[[Data]]/experiments/2024-11-20_ML_drug_target/`
