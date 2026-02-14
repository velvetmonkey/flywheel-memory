---
paths: "content/**/*.md"
alwaysApply: false
---

# Content Notes Format

## Required Frontmatter

```yaml
---
type: content
status: draft
due_date: 2026-02-01
platform: newsletter
topic: productivity
---
```

## Status Values

- `idea` - Initial concept, not yet developed
- `draft` - Being written
- `scheduled` - Complete, scheduled for publication
- `published` - Live and published

## Platform Values

- `newsletter` - Email newsletter
- `blog` - Website blog post
- `social` - Social media content
- `video` - YouTube or video content
- `podcast` - Audio content

## Linking

Always link to `[[Content Calendar]]` when scheduling

## Sections

### Outline
Structure and key points

### Draft
The actual content

### Notes
Research, sources, related ideas
