---
paths: "**/*.md"
alwaysApply: false
---

# Obsidian Markdown Syntax

## Wikilinks

- Use bare wikilinks: `[[Note Name]]`
- Never wrap wikilinks in markdown links: `[text]([[note]])` is wrong
- For display text, use pipe: `[[Note Name|display text]]`

## Angle Brackets

- Never use angle brackets `<text>` outside code blocks
- They render as broken HTML in Obsidian
- Use backticks for code: `` `<example>` ``

## Code Blocks

- Always close code blocks with matching backticks
- Use language identifiers: ```yaml, ```json, ```javascript
- Indent code blocks in lists by 4 spaces
