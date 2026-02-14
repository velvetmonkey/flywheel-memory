---
paths: "literature/**/*.md"
alwaysApply: false
---

# Literature Notes Format

## Naming Convention

`Author-Year-ShortTitle.md`

Examples:
- `Smith-2024-CRISPR.md`
- `Chen-2023-ProteinFolding.md`
- `Johnson-2025-MachineLearning.md`

## Required Frontmatter

```yaml
---
type: paper
authors:
  - "Smith, J."
  - "Chen, L."
date: 2024
doi: "10.1234/example.2024.001"
journal: "Nature Methods"
tags:
  - CRISPR
  - gene-editing
---
```

## Sections

### Summary
Brief overview of the paper's main contribution

### Key Findings
Bullet points of most important results

### Methods of Interest
Link to methods this paper describes or uses:
- `[[Method Name]]` - how it relates to your work

### Relevance
How this paper informs your research

### Quotes
Important quotes with page numbers

## Citations

When referencing in other notes, use: `[[Author-Year-ShortTitle]]`
