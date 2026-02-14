---
title: Bad YAML
tags: [unclosed bracket
nested:
  - item1
  bad indentation
---

# This file has malformed YAML

The parser should gracefully handle this and still extract [[wikilinks]].
