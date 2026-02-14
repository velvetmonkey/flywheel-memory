---
paths: "automations/**/*.md"
alwaysApply: false
---

# Automation Playbook Format

## Structure

Playbooks document repeatable processes for automation.

## Required Sections

### Trigger
When does this automation run?

```markdown
## Trigger

- Manual: Run every Monday morning
- Auto: When new subscriber joins list
- Scheduled: Daily at 9:00 AM
```

### Steps

Numbered, actionable steps:

```markdown
## Steps

1. Open [[Content Calendar]] and identify scheduled posts
2. Generate social media snippets for each post
3. Schedule in Buffer using [[Social Template]]
4. Update calendar with "scheduled" status
5. Log completion in daily note
```

### Inputs
What notes or data does this playbook read?

### Outputs
What notes or data does this playbook create/update?

## Linking

- Link to notes the playbook operates on
- Link to templates used
- Link to related playbooks

## Tips

- Each step should be a single, clear action
- Include expected duration when helpful
- Note any manual steps vs automated steps
