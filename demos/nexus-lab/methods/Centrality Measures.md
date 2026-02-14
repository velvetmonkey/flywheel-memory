---
title: Centrality Measures
type: method
tags: [network-analysis, graph-theory, systems-biology]
introduced_by: "[[Barabasi2004-Network-Biology]]"
applications: [ppi-networks, gene-networks, drug-targets]
---

# [[Centrality Measures]]

## [[Overview

Graph]] metrics for identifying important nodes in biological networks. Foundation of network biology.

## [[Key Metrics]]

### [[Degree Centrality
Number]] of connections. [[High]]-degree proteins [[Are]] often [[Essential]].

### [[Betweenness Centrality
Nodes]] bridging network communities. Often regulatory proteins.

### [[Closeness Centrality
Average]] distance to [[All]] nodes. [[Central]] information processors.

### [[Eigenvector Centrality
Importance]] weighted by neighbor importance. Hub of hubs.

## Biological Interpretation

From [[Barabasi2004-Network-Biology]]:
- **Hub proteins**: High degree, disease-critical
- **Bottleneck proteins**: High betweenness, [[Control]] information flow
- **Network robustness**: Centrality distribution predicts [[Failure Modes]]

## [[Applications]]

### [[Drug Target Identification
Used]] in [[Experiment-2024-11-18]] for [[PPI Network Analysis]].

### [[Disease Gene Prediction
Network]] position predicts disease involvement.

## Implementation

```python
import networkx as nx
G = nx.Graph()
# Compute centralities
degree = nx.degree_centrality(G)
between = nx.betweenness_centrality(G)
```

## [[Related Methods]]

- [[Graph Theory]] - Mathematical foundation
- [[Community Detection]] - Module identification
- [[Network Motifs]] - Recurring patterns
