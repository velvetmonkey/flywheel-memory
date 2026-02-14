---
title: Bidirectional Test Note
type: project
client: Acme Corp
status: active
attendees:
  - Alex Johnson
  - Sarah Johnson
tags:
  - test
  - bidirectional
---

# Bidirectional Test Note

This note tests the bidirectional bridge between frontmatter and prose patterns.

## Prose Patterns (should be detected)

Client: [[Acme Corp]]
Status: Active
Owner: [[Alex Johnson]]
Related: [[Another Note]]

Some text here.

Priority: High
Due Date: 2024-01-15

## Frontmatter Values That Match Entities

The frontmatter has `client: Acme Corp` but "Acme Corp" doesn't exist as a note.
The frontmatter has `attendees: [Alex Johnson, Sarah Johnson]` - these could be wikilinks if notes exist.

## Existing Wikilinks

This section has explicit wikilinks like [[normal-note]] and [[Another Note]].

## Code Block (should be ignored)

```yaml
# This should not match
Client: [[Fake Pattern]]
Status: [[Not Real]]
```

Inline code: `Owner: [[Not Detected]]`

## Edge Cases

Multi-line value - not a pattern:
This is just normal text that continues
on multiple lines.

Key With Spaces: Some Value
Key-With-Dashes: Another Value
key_with_underscores: third value
