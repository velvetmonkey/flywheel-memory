---
paths: "**/*.md"
alwaysApply: false
---

# Zettelkasten Note Conventions

## Note Types

- **Fleeting notes** (`fleeting/`): Raw captures, hunches, questions. Write fast, don't polish. These are input for processing, not finished work.
- **Literature notes** (`literature/`): Summaries of a single source (book, paper, talk). Always include `author` and `year` in frontmatter. Link to permanent concepts this source supports.
- **Permanent notes** (`permanent/`): Atomic concept notes. One idea per note. Written in your own words, not quotes. Must link to at least 2 other permanent notes -- isolation means it hasn't been integrated.
- **Project notes** (`projects/`): Synthesis hubs that pull multiple permanent notes into an argument or output. These are where permanent notes become useful.

## Promotion Flow

fleeting → literature → permanent → projects

A fleeting note becomes a literature note when you identify the source and summarize the argument. A literature note feeds permanent notes when you extract atomic concepts. Permanent notes feed projects when you synthesize them into an output.

## Frontmatter Requirements

All notes must have `type` and `status` fields. Literature notes require `author` and `year`. Use `tags` arrays, not inline `#tags` in frontmatter.
