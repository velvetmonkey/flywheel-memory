# Policy Examples

Ready-to-run policy examples for common vault workflows. Save any of these as `.claude/policies/<name>.yaml` in your vault, then use `policy action=execute` to run.

- [Quick Reference](#quick-reference)
- [Template Syntax](#template-syntax)
- [Available Tools](#available-tools)
- [Example 1: Weekly Review](#example-1-weekly-review)
- [Example 2: Project Setup](#example-2-project-setup)
- [Example 3: Daily Standup Log](#example-3-daily-standup-log)
- [Example 4: Inbox Processing](#example-4-inbox-processing)
- [Example 5: Overdue Invoice Chaser](#example-5-overdue-invoice-chaser)
- [Example 6: Team Utilization Report](#example-6-team-utilization-report)

---

## Quick Reference

| Action | What it does |
|--------|-------------|
| `policy action=list` | List saved policies |
| `policy action=validate name=<name>` | Validate YAML syntax |
| `policy action=preview name=<name>` | Dry-run (no changes) |
| `policy action=execute name=<name>` | Run for real |
| `policy action=author description="..."` | AI-generate a policy |
| `policy action=revise name=<name> changes="..."` | Modify existing |

## Template Syntax

- `{{variables.name}}` — Variable values
- `{{builtins.today}}` — Current date (YYYY-MM-DD)
- `{{builtins.now}}` — Current datetime
- `{{builtins.time}}` — Current time (HH:MM)
- `{{builtins.date}}` — Alias for today
- `{{conditions.cond_id}}` — Boolean condition result
- `{{conditions.cond_id | negate}}` — Inverted condition
- `{{steps.step_id.field}}` — Output from a previous step

## Available Tools

**Write:** `vault_add_to_section`, `vault_remove_from_section`, `vault_replace_in_section`, `vault_create_note`, `vault_delete_note`, `vault_toggle_task`, `vault_add_task`, `vault_update_frontmatter`, `vault_add_frontmatter_field`

**Read:** `vault_search` — query the vault index mid-policy. Results are available to subsequent steps via `{{steps.step_id.results}}`. Use this to find notes dynamically, then act on them.

---

## Example 1: Weekly Review

Creates a weekly review note if it doesn't exist, or updates frontmatter if it does.

```yaml
version: "1.0"
name: weekly-review
description: Generate a weekly review note with sections for activity and tasks

variables:
  week:
    type: string
    required: true
    description: "ISO week identifier, e.g. 2026-W12"
  reviewer:
    type: string
    default: "Team"

conditions:
  - id: weekly_note_exists
    check: file_exists
    path: "reviews/{{variables.week}}.md"

steps:
  - id: create_weekly
    tool: vault_create_note
    when: "{{conditions.weekly_note_exists | negate}}"
    params:
      path: "reviews/{{variables.week}}.md"
      content: |
        ---
        type: weekly-review
        week: "{{variables.week}}"
        reviewer: "{{variables.reviewer}}"
        created: "{{builtins.today}}"
        tags:
          - review
          - weekly
        ---
        # {{variables.week}} Review

        ## Highlights

        ## Open Tasks

        ## Decisions Made

        ## Next Week

  - id: update_frontmatter
    tool: vault_update_frontmatter
    when: "{{conditions.weekly_note_exists}}"
    params:
      path: "reviews/{{variables.week}}.md"
      fields:
        reviewed_at: "{{builtins.now}}"
        reviewer: "{{variables.reviewer}}"

output:
  summary: "Weekly review for {{variables.week}} ready"
```

**Run:** `policy action=execute name=weekly-review variables={"week": "2026-W12"}`

---

## Example 2: Project Setup

Creates a new project note with standard frontmatter and linked tracking sections.

```yaml
version: "1.0"
name: project-setup
description: Scaffold a new project with standard structure

variables:
  name:
    type: string
    required: true
    description: "Project name"
  status:
    type: enum
    enum: ["active", "planning", "on-hold"]
    default: "planning"
  owner:
    type: string
    default: ""

conditions:
  - id: project_exists
    check: file_exists
    path: "projects/{{variables.name}}.md"

steps:
  - id: create_project
    tool: vault_create_note
    when: "{{conditions.project_exists | negate}}"
    params:
      path: "projects/{{variables.name}}.md"
      content: |
        ---
        type: project
        status: "{{variables.status}}"
        owner: "{{variables.owner}}"
        created: "{{builtins.today}}"
        tags:
          - project
        ---
        # {{variables.name}}

        ## Overview

        ## Goals

        ## Tasks

        ## Log

        ## References

  - id: add_initial_task
    tool: vault_add_task
    when: "{{conditions.project_exists | negate}}"
    params:
      path: "projects/{{variables.name}}.md"
      section: "## Tasks"
      task: "Define project scope and success criteria"

output:
  summary: "Project {{variables.name}} created with status {{variables.status}}"
```

**Run:** `policy action=execute name=project-setup variables={"name": "Search Redesign", "status": "active"}`

---

## Example 3: Daily Standup Log

Appends a timestamped standup entry to today's daily note.

```yaml
version: "1.0"
name: daily-standup
description: Log a daily standup entry with what was done and what's next

variables:
  date:
    type: string
    default: "{{builtins.today}}"
  done:
    type: string
    required: true
    description: "What was completed"
  next:
    type: string
    required: true
    description: "What's planned next"
  blockers:
    type: string
    default: "None"

steps:
  - id: log_standup
    tool: vault_add_to_section
    params:
      path: "daily/{{variables.date}}.md"
      section: "## Log"
      content: |
        ### Standup — {{builtins.time}}
        **Done:** {{variables.done}}
        **Next:** {{variables.next}}
        **Blockers:** {{variables.blockers}}
      format: append
      suggestOutgoingLinks: true  # opt-in: suggestions useful for standup logs

output:
  summary: "Standup logged for {{variables.date}}"
```

**Run:** `policy action=execute name=daily-standup variables={"done": "Shipped search refactor", "next": "Write tests"}`

---

## Example 4: Inbox Processing

Moves an inbox note to the right folder and sets frontmatter based on triage decision.

```yaml
version: "1.0"
name: triage-note
description: Triage an inbox note — categorize and file it

variables:
  note_path:
    type: string
    required: true
    description: "Path to the inbox note to triage"
  category:
    type: enum
    enum: ["project", "reference", "person", "meeting", "idea"]
    required: true
  status:
    type: enum
    enum: ["active", "archived", "someday"]
    default: "active"

steps:
  - id: set_metadata
    tool: vault_update_frontmatter
    params:
      path: "{{variables.note_path}}"
      fields:
        type: "{{variables.category}}"
        status: "{{variables.status}}"
        triaged_at: "{{builtins.now}}"
        tags:
          - triaged

output:
  summary: "{{variables.note_path}} triaged as {{variables.category}} ({{variables.status}})"
```

**Run:** `policy action=execute name=triage-note variables={"note_path": "inbox/meeting-notes.md", "category": "meeting"}`

---

## Example 5: Overdue Invoice Chaser

Searches for overdue invoices and creates a follow-up task in today's daily note. Demonstrates `vault_search` as a read step — the policy finds notes dynamically, then acts on the results.

```yaml
version: "1.0"
name: chase-overdue
description: Find overdue invoices and create follow-up tasks

variables:
  date:
    type: string
    default: "{{builtins.today}}"

steps:
  - id: find_overdue
    tool: vault_search
    params:
      query: "overdue invoice"
      where:
        type: invoice
        status: pending
      limit: 10

  - id: log_chasers
    tool: vault_add_to_section
    params:
      path: "daily-notes/{{variables.date}}.md"
      section: "## Tasks"
      content: |
        ### Invoice follow-ups — {{builtins.today}}
        {{steps.find_overdue.summary}}
      format: append
      suggestOutgoingLinks: true

output:
  summary: "Found {{steps.find_overdue.count}} overdue invoices, tasks added to {{variables.date}}"
```

**Run:** `policy action=execute name=chase-overdue`

**What happens:** The policy searches the vault for pending invoices, then logs a task list in the daily note with auto-wikilinks to each invoice and client. One command, zero manual lookup.

---

## Example 6: Team Utilization Report

Searches for team members and builds a summary note with current assignments.

```yaml
version: "1.0"
name: team-report
description: Generate a team utilization snapshot from vault data

variables:
  date:
    type: string
    default: "{{builtins.today}}"

conditions:
  - id: report_exists
    check: file_exists
    path: "reports/team-utilization-{{variables.date}}.md"

steps:
  - id: find_team
    tool: vault_search
    params:
      where:
        type: person
        status: active
      limit: 20

  - id: create_report
    tool: vault_create_note
    when: "{{conditions.report_exists | negate}}"
    params:
      path: "reports/team-utilization-{{variables.date}}.md"
      content: |
        ---
        type: report
        category: utilization
        generated: "{{builtins.now}}"
        tags:
          - report
          - team
        ---
        # Team Utilization — {{variables.date}}

        ## Active Team Members

        {{steps.find_team.summary}}

        ## Notes

output:
  summary: "Team report generated with {{steps.find_team.count}} members"
```

**Run:** `policy action=execute name=team-report`
