# Bootstrap Template: CSV to Knowledge Graph

This demo shows the Flywheel "bootstrap breakthrough" — starting from loose CSV data and building a connected knowledge graph through natural usage.

## The Premise

**You don't HAVE a knowledge graph yet.** Flywheel builds it FOR you.

```
Day 1:   CSV data → Loose markdown files
Week 1:  Add content → Auto-wikilinks create connections
Month 1: Query backlinks → Graph intelligence emerges
Month 3: Self-sustaining knowledge graph
```

## Quick Start

### Option A: Script-Based Bootstrap

```bash
# Generate vault from CSVs
node scripts/bootstrap.js ./my-vault

# Point Flywheel at the vault
export PROJECT_PATH=/path/to/my-vault
```

### Option B: Claude-Native Bootstrap (Dogfooding)

```
You: Here's my client data [attaches clients.csv, contacts.csv]

Claude: [reads CSVs, uses vault_create_note for each row]
        Created:
        - 5 notes in clients/ folder
        - 6 notes in contacts/ folder
        Auto-wikilinks: [[Acme Corp]], [[Sarah Thompson]] now linkable
```

## Seed Data Structure

```
seed-data/
├── clients.csv      # 5 clients (Acme, TechStart, GlobalBank...)
├── contacts.csv     # 6 contacts with company relationships
├── projects.csv     # 5 projects linked to clients
└── invoices.csv     # 4 invoices linked to projects
```

### clients.csv

| Field | Description |
|-------|-------------|
| `name` | Client company name (becomes note title) |
| `industry` | Finance, SaaS, Healthcare, etc. |
| `status` | active, potential, past |
| `contract_type` | retainer, project |
| `monthly_retainer` | Monthly fee (if retainer) |

### contacts.csv

| Field | Description |
|-------|-------------|
| `name` | Person's full name (becomes note title) |
| `company` | Links to client via `[[Company Name]]` |
| `role` | Job title |
| `email` | Contact email |
| `relationship` | champion, decision-maker, technical-contact |

### projects.csv

| Field | Description |
|-------|-------------|
| `name` | Project name (becomes note title) |
| `client` | Links to client via `[[Company Name]]` |
| `status` | active, proposal, completed |
| `start_date` | ISO date |
| `hourly_rate` | Billing rate |
| `type` | consulting, development, audit, sales |

### invoices.csv

| Field | Description |
|-------|-------------|
| `invoice_id` | Invoice number (becomes note title) |
| `client` | Links to client |
| `project` | Links to project |
| `amount` | Invoice amount |
| `status` | draft, sent, paid |
| `due_date` | Payment due date |

## The Bootstrap Journey

### Day 1: Initial State

After running `bootstrap.js`:

```
vault/
├── clients/
│   ├── Acme Corp.md
│   ├── TechStart Inc.md
│   └── ...
├── contacts/
│   ├── Sarah Thompson.md
│   ├── Mike Chen.md
│   └── ...
├── projects/
│   ├── Acme Data Migration.md
│   └── ...
├── invoices/
│   ├── INV-2025-047.md
│   └── ...
└── daily-notes/
    └── 2026-01-28.md
```

**Graph state:** Basic structure exists, minimal cross-linking.

### Week 1: Content + Connections

As you add daily logs via Flywheel-Crank:

```javascript
vault_add_to_section({
  path: 'daily-notes/2026-01-28.md',
  section: 'Log',
  content: 'Call with Sarah Thompson at Acme Corp about the data migration',
  format: 'timestamp-bullet'
})
```

**Result:**
```markdown
## Log
- **14:30** Call with [[Sarah Thompson]] at [[Acme Corp]] about the [[Acme Data Migration]]
  → [[TechStart Inc]] [[INV-2025-047]]
```

**Why "TechStart Inc" suggested?** Co-occurrence pattern — you often work TechStart after Acme calls.

**Why "INV-2025-047" suggested?** Acme work = billable hours. Invoice context captured automatically.

### Month 1: Graph Intelligence

Query your backlinks:

```
"Show me everything connected to [[Acme Corp]]"
```

Results:
- 8 daily log entries (calls, meetings)
- 2 invoices (INV-2025-047, INV-2025-046)
- 1 project (Acme Data Migration)
- 2 contacts (Sarah Thompson, David Kumar)

**Hub emerging:** [[Sarah Thompson]] has 12 backlinks — your champion at Acme.

### Month 3: Self-Sustaining

```
"What's my pipeline looking like?"

Graph intelligence shows:
- Active: [[Acme Data Migration]] (85% complete), [[TechStart API Redesign]]
- Pipeline: [[GlobalBank Discovery]] (proposal stage)
- At risk: [[TechStart Inc]] - no logged contact in 2 weeks
- Action: Follow up with [[Mike Chen]] (decision-maker)
```

## Customizing for Your Domain

### Replace Seed Data

Edit the CSV files with your real data:

1. **clients.csv** → Your actual clients
2. **contacts.csv** → Your contacts with `company` matching client names
3. **projects.csv** → Your projects with `client` matching client names
4. **invoices.csv** → Your invoices linking to projects

### Add New Entity Types

Create additional CSVs and modify `bootstrap.js`:

```javascript
// Add to bootstrap.js
const tasks = parseCSV('tasks.csv');
for (const task of tasks) {
  createNote(outputDir, 'tasks', task.name, {
    type: 'task',
    project: `[[${task.project}]]`,
    status: task.status,
    due_date: task.due_date,
  });
}
```

## Folder Structure Conventions

Flywheel uses folder names to infer entity types:

| Folder | Entity Type | Type Boost |
|--------|-------------|------------|
| `contacts/`, `team/`, `people/` | People | +5 |
| `projects/`, `systems/` | Projects | +3 |
| `clients/`, `companies/` | Organizations | +2 |
| `daily-notes/`, `journal/` | Excluded from entities | — |

See [Flywheel Wikilinks Documentation](../../docs/wikilinks.md) for full details.

## Proof-of-Work Testing

After bootstrapping, run the proof-of-work tests to verify graph integrity:

```bash
npm test -- demos/bootstrap-template/proof-of-work.test.ts
```

See `scripts/proof-of-work.test.ts` for the test suite.
