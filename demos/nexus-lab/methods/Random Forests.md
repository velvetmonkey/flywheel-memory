---
title: Random Forests
type: method
tags: [machine-learning, ensemble-learning, classification]
introduced_by: "Breiman 2001"
applications: [variant-classification, drug-prediction, expression-analysis]
---

# [[Random Forests]]

## [[Overview

Ensemble]] [[Learning]] method [[Building]] [[Multiple]] decision trees. Robust, interpretable, handles [[High]]-dimensional genomic [[Data]] well.

## [[Key Properties]]

- **Bootstrap aggregating**: Trains [[Each]] tree on [[Random]] [[Sample]]
- **[[Feature]] randomness**: Considers random subset of [[Features]] per split
- **[[Voting]]**: Classification by majority vote
- **Feature importance**: Measures predictive [[Value]] of features

## Advantages for Genomics

From [[Libbrecht2015-ML-Genomics]]:
- Handles thousands of features (SNPs, expression values)
- Robust to outliers and missing data
- No assumption of linear [[Relationships]]
- [[Built]]-in feature importance rankings

## [[Applications]]

### Drug-[[Target Prediction
Used]] in [[Experiment-2024-11-20]] for [[Drug-Target Prediction]] [[Project]].

### [[Variant Effect Prediction
Classify]] pathogenic vs benign variants [[Using]] sequence features.

### [[Gene Expression Classification
Predict]] cell types from expression profiles.

## Implementation

```python
from sklearn.ensemble import RandomForestClassifier
rf = RandomForestClassifier(n_estimators=100, max_depth=10)
rf.fit(X_train, y_train)
importances = rf.feature_importances_
```

## [[Related Methods]]

- [[Gradient Boosting]] - Alternative ensemble method
- [[Support Vector Machines]] - Different classifier
- [[Deep Learning]] - More complex models
