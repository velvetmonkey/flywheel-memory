Use flywheel search before reading files. Search returns frontmatter, backlinks, outlinks, headings, and snippets — often enough to answer without file reads.

This vault has saved policies in `.flywheel/policies/`. Use `policy action=list` to see them, `policy action=preview` to dry-run, and `policy action=execute` to run. Policies automate multi-step vault operations atomically.

## Daily Notes — CRITICAL FORMAT RULES

**ALWAYS follow these rules when creating or writing to daily notes.**

### Creating daily notes

If the daily note does not exist, create it using `vault_create_note` with `template: "templates/daily-note.md"`. Set `frontmatter.date` to the target date (YYYY-MM-DD).

### Writing entries to daily notes

**Default section: Log** — always append with `format="timestamp-bullet"`.

Use `vault_add_to_section` with:
- `section: "Log"`
- `format: "timestamp-bullet"` (auto-inserts current time as `- **HH:MM** `)
- `suggestOutgoingLinks: true`

**NEVER write to the Notes section** for logged activity.

**Log format:** `- **HH:MM** Description` — no `---` separators or headings inside Log. Sub-bullets use 2-space indent.
