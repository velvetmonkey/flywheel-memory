# Nexus Lab

> A PhD student's second brain for computational biology -- 7 papers, 10 experiments, and the connections between them.

---

**You are**: A PhD student in computational biology

**Your situation**: You're working on drug-target prediction and single-cell RNA-Seq analysis. Your vault holds 7 foundational papers, 6 methods, 10 experiments, and 2 active projects. The challenge is tracing how ideas flow from Jumper2021's AlphaFold paper through your methods to last Friday's docking results. You need an AI lab partner that remembers every citation chain.

## Vault Map

```
nexus-lab/
├── literature/
│   ├── Barabasi2004-Network-Biology.md    # Network analysis foundations
│   ├── Haeussler2016-CRISPR-Tools.md      # Guide RNA design
│   ├── Jumper2021-AlphaFold.md            # Protein structure prediction
│   ├── Karplus2002-Molecular-Dynamics.md  # MD simulation foundations
│   ├── Libbrecht2015-ML-Genomics.md       # ML for genomics review
│   ├── Mortazavi2008-RNA-Seq.md           # RPKM normalization
│   └── Tang2009-Single-Cell-RNA-Seq.md    # First single-cell RNA-Seq
├── methods/
│   ├── AMBER Force Field.md               # MD force field (ff19SB)
│   ├── Centrality Measures.md             # Degree, betweenness, eigenvector
│   ├── Random Forests.md                  # ML classifier for drug prediction
│   ├── RPKM Normalization.md              # RNA-Seq normalization
│   ├── Single-Cell Isolation.md           # 10x Genomics, FACS protocols
│   └── Transformer Architecture.md        # AlphaFold's attention mechanism
├── experiments/
│   ├── Experiment-2024-10-28.md   # AlphaFold EGFR prediction (pLDDT 94.2)
│   ├── Experiment-2024-11-01.md   # CTCF binding site CNN (AUC 0.94)
│   ├── Experiment-2024-11-08.md   # GPCR membrane MD equilibration
│   ├── Experiment-2024-11-12.md   # Gene regulatory network (2500 genes)
│   ├── Experiment-2024-11-15.md   # scRNA-Seq mESC (4842 cells, 4 clusters)
│   ├── Experiment-2024-11-16.md   # Marker validation & trajectory
│   ├── Experiment-2024-11-18.md   # PPI network EGFR (324 proteins)
│   ├── Experiment-2024-11-19.md   # CRISPR knockout validation
│   ├── Experiment-2024-11-20.md   # ML drug-target model (AUC 0.89)
│   └── Experiment-2024-11-22.md   # EGFR docking (Compound_472: -11.2 kcal/mol)
├── projects/
│   ├── Drug-Target Prediction.md  # NIH R01, AUC 0.89 model
│   └── Single-Cell RNA-Seq Analysis.md  # NIH R21, 4 cell populations
└── daily/                         # 5 research log entries
```

## Try it now

Ask Claude:

- "How does the AlphaFold paper connect to my docking experiment?"
- "Which experiments used Centrality Measures?"
- "What were the key results from the drug-target prediction project?"
- "Summarize my November experiments"
- "What papers informed the scRNA-Seq analysis?"

## What you'll discover

- Trace citation chains from papers through methods to experiments
- Find which experiments build on each other
- See how data flows across your two active projects

---

## How it works

When you ask Claude questions or request changes, here's the flow:

### Trace a citation chain (graph traversal)

```
You: "How does AlphaFold connect to my docking experiment?"

  ● flywheel › get_forward_links
    path: "literature/Jumper2021-AlphaFold.md"
    → [[Transformer Architecture]], [[Structure-Based Drug Design]]

  ● flywheel › get_backlinks
    path: "literature/Jumper2021-AlphaFold.md"
    → experiments/Experiment-2024-10-28.md (AlphaFold EGFR)
    → experiments/Experiment-2024-11-22.md (docking)

  ● flywheel › get_note_metadata
    path: "experiments/Experiment-2024-10-28.md"
    → status: completed, title: AlphaFold EGFR prediction
    → related_experiments: [Experiment-2024-11-22]

  ┌─ CLAUDE THINKS ─────────────────────────────────────┐
  │ Chain: Jumper2021 (AlphaFold paper) informs         │
  │ Experiment-2024-10-28 (EGFR structure, pLDDT 94.2), │
  │ which feeds into Experiment-2024-11-22 (docking).    │
  │ ML predictions from Exp-11-20 also feed docking.    │
  └─────────────────────────────────────────────────────┘

  ┌─ RESULT ────────────────────────────────────────────┐
  │ Connection path (3 hops):                           │
  │                                                     │
  │ Jumper2021-AlphaFold                                │
  │   → Experiment-2024-10-28 (EGFR structure,          │
  │     pLDDT 94.2, RMSD 0.8A vs PDB 1M17)             │
  │   → Experiment-2024-11-22 (docking screen,          │
  │     Compound_472: -11.2 kcal/mol)                   │
  │                                                     │
  │ The AlphaFold-predicted structure was validated      │
  │ against crystal structure, then used as the          │
  │ receptor for virtual screening of 10 candidates.    │
  └─────────────────────────────────────────────────────┘

  ~120 tokens (vs ~9,600 reading 4 full files)
```

### Find experiments using a method (backlinks only)

```
You: "Which experiments used Centrality Measures?"

  ● flywheel › get_backlinks
    path: "methods/Centrality Measures.md"
    → experiments/Experiment-2024-11-18.md (PPI network)
    → experiments/Experiment-2024-11-12.md (gene regulatory network)
    → literature/Barabasi2004-Network-Biology.md

  ● flywheel › get_note_metadata (x2)
    Experiment-2024-11-18: status completed, PPI Network Analysis
    Experiment-2024-11-12: status completed, Gene Regulatory Network

  ┌─ RESULT ────────────────────────────────────────────┐
  │ 2 experiments used Centrality Measures:             │
  │                                                     │
  │ 1. Experiment-2024-11-18 (PPI Network Analysis)     │
  │    324 proteins, EGFR top hub (degree=47)           │
  │    Status: completed                                │
  │                                                     │
  │ 2. Experiment-2024-11-12 (Gene Regulatory Network)  │
  │    2,500 genes, Oct4 top TF (degree=247)            │
  │    Status: completed                                │
  │                                                     │
  │ Source paper: Barabasi2004-Network-Biology           │
  └─────────────────────────────────────────────────────┘

  ~100 tokens (backlinks + metadata only)
```

### Summarize a project (metadata + selective read)

```
You: "What are the key results from drug-target prediction?"

  ● flywheel › get_note_metadata
    path: "projects/Drug-Target Prediction.md"
    → status: active, PI: Dr. Sarah Chen, funding: NIH R01

  ● read_file
    path: "projects/Drug-Target Prediction.md"
    → AUC 0.89, degree centrality in top-3 features,
    → Compound_472: -11.2 kcal/mol binding energy

  ┌─ RESULT ────────────────────────────────────────────┐
  │ Drug-Target Prediction (NIH R01 CA234567)           │
  │ PI: Dr. Sarah Chen | Status: Active                 │
  │                                                     │
  │ Key results:                                        │
  │ 1. ML model AUC-ROC: 0.89 (Random Forest)          │
  │ 2. Network degree centrality is top-3 feature       │
  │ 3. CRISPR confirms hub proteins essential           │
  │ 4. Top compound: Compound_472 (-11.2 kcal/mol)     │
  │                                                     │
  │ Next: IC50 experimental validation, manuscript      │
  └─────────────────────────────────────────────────────┘

  ~400 tokens (1 project file)
```

---

*32 notes. Just start asking questions.*

---

**Token savings:** Each note in this vault averages ~160 lines (~2,400 tokens).
With Flywheel, graph queries cost ~50-100 tokens instead of reading full files.
That's **24-48x savings** per query--enabling hundreds of queries in agentic workflows.
