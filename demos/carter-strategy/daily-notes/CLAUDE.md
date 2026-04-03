# Daily Notes Rules

## Creating daily notes

Always use the `create-daily-note` policy: `policy action=execute name=create-daily-note variables={"target_date":"YYYY-MM-DD"}`

This creates the note from the template with the correct sections.

## Writing to daily notes

- Always write new entries to the **Log** section using `vault_add_to_section`
- Each entry is a timestamped bullet: `- HH:MM - content here`
- Use 24-hour time format
- Apply auto-wikilinks and suggest outgoing links (`suggestOutgoingLinks: true`)
- Never write to the Notes section for logged activity — Notes is for standalone observations only

### Example Log entry

```
- 18:00 - Call with [[Sarah Mitchell]] and [[James Rodriguez]] ([[Acme Corp]]) — [[UAT]] complete, [[Marcus Webb]]'s validation scripts passed, hitting 3x performance target. Cutover locked for March 28-29.
```
