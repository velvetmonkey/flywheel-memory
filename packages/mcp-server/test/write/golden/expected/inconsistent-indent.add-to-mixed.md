---
type: test
---

# Inconsistent Indentation Test

This file has mixed 2-space and 4-space indentation.

## Section A (2-space)
- Item 1
  - Nested with 2-space
  - Another 2-space nested

## Section B (4-space)
- Item 1
    - Nested with 4-space
    - Another 4-space nested

## Mixed Section
- Top level
  - 2-space nested
    - Then 4-space (inconsistent)
  - Back to 2-space
      - Now 6-space (very inconsistent)
- Another top level
- New item added to mixed
## Tab Section
- Item with tabs
	- Tab-indented nested
	- Another tab nested
