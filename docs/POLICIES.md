# Policies

[← Back to docs](README.md)

Policies are saved, deterministic workflows composed from Flywheel's tools. They can search the vault, branch on conditions, and drive write steps — all as a single atomic operation.

- [When to use policies](#when-to-use-policies)
- [How policies work](#how-policies-work)
- [Safety](#safety)
- [Walkthrough: Overdue invoice chaser](#walkthrough-overdue-invoice-chaser)
- [Walkthrough: Weekly review from vault state](#walkthrough-weekly-review-from-vault-state)
- [Next steps](#next-steps)

---

## When to use policies

| Situation | Use |
|-----------|-----|
| One-off edit to a note | Direct write tools (`vault_add_to_section`, `vault_create_note`, etc.) |
| Repeatable, structured workflow | **Policy** |
| Workflow that needs to read vault state before writing | **Policy** with `vault_search` steps |
| Parameterized template (same structure, different inputs) | **Policy** with variables |

Direct write tools are the lower-level primitives. Policies compose them into workflows that can inspect the vault and act on the results safely.

---

## How policies work

A policy is a YAML file saved in `.flywheel/policies/`. It defines:

1. **Variables** — parameters that change per execution (dates, names, filters)
2. **Conditions** — checks against vault state (does this file exist? does this section contain text?)
3. **Steps** — an ordered sequence of tool calls, each with access to variables, conditions, builtins, and prior step outputs

### Read→write data flow

Policies can search the vault mid-execution and feed results into later steps:

```
vault_search (read step)
    ↓ results available as {{steps.find_overdue.results}}
vault_add_to_section (write step, uses search results)
    ↓
vault_update_frontmatter (write step)
```

The policy schema uses the internal step name `vault_search` for read steps. Later steps reference outputs via `{{steps.<step_id>.results}}`, `{{steps.<step_id>.summary}}`, and `{{steps.<step_id>.count}}`.

### Step types

**Read:** `vault_search` — query the vault index. Results are exposed to subsequent steps. No vault modifications.

**Write:** `vault_add_to_section`, `vault_remove_from_section`, `vault_replace_in_section`, `vault_create_note`, `vault_delete_note`, `vault_toggle_task`, `vault_add_task`, `vault_update_frontmatter`, `vault_add_frontmatter_field`

### Template syntax

- `{{variables.name}}` — variable values
- `{{builtins.today}}` — current date (YYYY-MM-DD)
- `{{builtins.now}}` — current datetime
- `{{conditions.cond_id}}` — boolean condition result
- `{{steps.step_id.field}}` — output from a previous step

---

## Safety

Policies are designed for safe, auditable execution:

| Mechanism | What it does |
|-----------|-------------|
| **Validate** | `policy action=validate` checks YAML syntax and step references before anything runs |
| **Preview** | `policy action=preview` dry-runs every step, showing what would happen without modifying the vault |
| **Conditions** | Steps can be skipped based on vault state (`when` clauses), so a policy adapts without failing |
| **Atomic commits** | All steps in a policy execute as a single git commit — if any step fails, all changes roll back |
| **Undo** | `vault_undo_last_mutation` reverses the entire policy execution in one step |

The recommended workflow: **author → validate → preview → execute**.

---

## Walkthrough: Overdue invoice chaser

A policy that searches for overdue invoices and logs follow-up tasks in today's daily note.

```yaml
version: "1.0"
name: overdue-invoice-chaser
description: Find overdue invoices and create follow-up tasks

steps:
  - id: find_overdue
    tool: vault_search
    params:
      query: "type:invoice status:sent"
      folder: "invoices"

  - id: log_followups
    tool: vault_add_to_section
    params:
      path: "daily-notes/{{builtins.today}}.md"
      heading: "Tasks"
      content: |
        ## Invoice follow-ups ({{steps.find_overdue.count}} found)
        {{steps.find_overdue.summary}}
```

**What happens:**
1. `find_overdue` searches the vault for invoices with `status: sent`
2. `log_followups` appends a summary to today's daily note, including the count and details from the search

Run it:
```
> Preview the overdue-invoice-chaser policy
> Execute the overdue-invoice-chaser policy
```

---

## Walkthrough: Weekly review from vault state

A policy that gathers recent activity and open tasks, then creates a structured review note.

```yaml
version: "1.0"
name: weekly-review
description: Generate a weekly review from vault state

variables:
  week:
    type: string
    required: true
    description: "ISO week, e.g. 2026-W14"

conditions:
  - id: review_exists
    check: file_exists
    path: "reviews/{{variables.week}}.md"

steps:
  - id: find_activity
    tool: vault_search
    params:
      query: "modified this week"
      folder: "daily-notes"

  - id: find_open_tasks
    tool: vault_search
    params:
      query: "status:open has:due_date"

  - id: create_review
    tool: vault_create_note
    when: "{{conditions.review_exists | negate}}"
    params:
      path: "reviews/{{variables.week}}.md"
      content: |
        ---
        type: weekly-review
        week: "{{variables.week}}"
        created: "{{builtins.today}}"
        ---
        # {{variables.week}} Review

        ## Activity
        {{steps.find_activity.summary}}

        ## Open tasks ({{steps.find_open_tasks.count}})
        {{steps.find_open_tasks.summary}}

        ## Reflections
```

**What happens:**
1. Searches for recent daily note activity
2. Searches for open tasks with due dates
3. Creates a review note (only if it doesn't already exist) populated with the search results

---

## Next steps

- [Policy examples catalog](POLICY_EXAMPLES.md) — ready-to-run YAML for common workflows
- [Tools reference](TOOLS.md) — full list of direct write tools and the `policy` tool actions
- [Cookbook](COOKBOOK.md) — example prompts including policy workflows
