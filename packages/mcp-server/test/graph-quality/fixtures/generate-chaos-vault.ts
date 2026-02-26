#!/usr/bin/env npx tsx
/**
 * Generate the chaos-vault fixture — an adversarial/fuzzy test vault.
 *
 * Key characteristics:
 * - 25 entities across 11 categories
 * - 54 notes (daily notes, project notes, stubs, orphans, hub notes)
 * - 96 ground truth links (T1=39, T2=33, T3=24)
 * - Typos, partial names, ambiguous entities, orphan notes
 * - Hub notes with 5+ entity mentions
 * - Stub notes with < 50 chars content
 * - Mixed domains (tech + food + health + animals)
 * - Inconsistent frontmatter
 *
 * Usage: npx tsx generate-chaos-vault.ts > chaos-vault.json
 */

import {
  type EntityDef,
  mulberry32,
  pick,
  shuffle,
  slugify,
  toEntitySpec,
  PEOPLE,
  PROJECTS,
  TECHNOLOGIES,
  ORGANIZATIONS,
  LOCATIONS,
  CONCEPTS,
  ANIMALS,
  HEALTH,
  MEDIA,
  FOOD,
  ACRONYMS,
} from './entity-pools.js';

import {
  type GroundTruthEntry,
  deduplicateGroundTruth,
} from './content-templates.js';

// =============================================================================
// Entity selection — 25 entities across 11 categories
// =============================================================================

function findEntity(pool: EntityDef[], name: string): EntityDef {
  const e = pool.find(p => p.name === name);
  if (!e) throw new Error(`Entity ${name} not found in pool`);
  return e;
}

function withHubScore(e: EntityDef, hubScore: number): EntityDef {
  return { ...e, hubScore };
}

const entities: EntityDef[] = [
  // People (5)
  withHubScore(findEntity(PEOPLE, 'Nadia Reyes'), 55),
  withHubScore(findEntity(PEOPLE, 'Owen Park'), 90),
  withHubScore(findEntity(PEOPLE, 'Rosa Vega'), 40),
  withHubScore(findEntity(PEOPLE, 'Ines Dufresne'), 25),
  withHubScore(findEntity(PEOPLE, 'Hiroshi Tanaka'), 70),

  // Projects (3)
  withHubScore(findEntity(PROJECTS, 'Project Zenith'), 110),
  withHubScore(findEntity(PROJECTS, 'Bluebird'), 60),
  withHubScore(findEntity(PROJECTS, 'Saturn Platform'), 45),

  // Technologies (4)
  withHubScore(findEntity(TECHNOLOGIES, 'Kubernetes'), 80),
  withHubScore(findEntity(TECHNOLOGIES, 'Terraform'), 50),
  withHubScore(findEntity(TECHNOLOGIES, 'PostgreSQL'), 55),
  withHubScore(findEntity(TECHNOLOGIES, 'React'), 65),

  // Organizations (3)
  withHubScore(findEntity(ORGANIZATIONS, 'Neptune Insurance'), 75),
  withHubScore(findEntity(ORGANIZATIONS, 'Apex Systems'), 40),
  withHubScore(findEntity(ORGANIZATIONS, 'GridPoint Inc'), 10),

  // Locations (2)
  withHubScore(findEntity(LOCATIONS, 'Seoul'), 25),
  withHubScore(findEntity(LOCATIONS, 'Toronto'), 15),

  // Concepts (2)
  withHubScore(findEntity(CONCEPTS, 'Machine Learning'), 70),
  withHubScore(findEntity(CONCEPTS, 'Event Sourcing'), 30),

  // Animals (1)
  withHubScore(findEntity(ANIMALS, 'Luna'), 20),

  // Health (1)
  withHubScore(findEntity(HEALTH, 'Running'), 35),

  // Media (1)
  withHubScore(findEntity(MEDIA, 'Signal Patterns'), 20),

  // Food (1)
  withHubScore(findEntity(FOOD, 'Pho Bowl'), 10),

  // Acronyms (2)
  withHubScore(findEntity(ACRONYMS, 'MCP'), 40),
  withHubScore(findEntity(ACRONYMS, 'JWT'), 10),
];

// =============================================================================
// Types
// =============================================================================

interface NoteDef {
  path: string;
  title: string;
  frontmatter?: Record<string, unknown>;
  content: string;
  links: string[];
  folder: string;
}

const rng = mulberry32(200);
const notes: NoteDef[] = [];
const groundTruth: GroundTruthEntry[] = [];

// =============================================================================
// Project notes (3) — well-linked hub notes
// =============================================================================

notes.push({
  path: 'projects/project-zenith.md',
  title: 'Project Zenith',
  frontmatter: { type: 'project', status: 'active', lead: 'Owen Park' },
  content: [
    'Project Zenith is our flagship infrastructure overhaul at [[Neptune Insurance]].',
    'The goal is to modernize the entire backend stack using [[Kubernetes]] and [[Terraform]].',
    '[[Owen Park]] is the tech lead, with [[Ines Dufresne]] handling the data migration from Oracle to [[PostgreSQL]].',
    'The dashboards are built in [[React]] and consumed internally.',
    '',
    'Key milestones:',
    '- Q1: Core infra on k8s',
    '- Q2: Database cutover',
    '- Q3: Frontend consolidation',
    '',
    'The project spans both [[Seoul]] and [[Toronto]] offices.',
    '[[Hiroshi Tanaka]] consults on the Machine Learning integration.',
    'We use JWT tokens for service auth and MCP for the AI-driven parts.',
  ].join('\n'),
  links: ['Neptune Insurance', 'Kubernetes', 'Terraform', 'Owen Park', 'Ines Dufresne', 'PostgreSQL', 'React', 'Seoul', 'Toronto'],
  folder: 'projects',
});

groundTruth.push(
  { notePath: 'projects/project-zenith.md', entity: 'Hiroshi Tanaka', tier: 1, reason: 'Entity Hiroshi Tanaka appears verbatim' },
  { notePath: 'projects/project-zenith.md', entity: 'Machine Learning', tier: 1, reason: 'Entity Machine Learning appears verbatim' },
  { notePath: 'projects/project-zenith.md', entity: 'MCP', tier: 1, reason: 'Entity MCP appears verbatim' },
  { notePath: 'projects/project-zenith.md', entity: 'JWT', tier: 1, reason: 'Entity JWT appears verbatim' },
);

notes.push({
  path: 'projects/bluebird.md',
  title: 'Bluebird',
  frontmatter: { type: 'project', status: 'active' },
  content: [
    'Bluebird is an internal health monitoring tool for [[Neptune Insurance]] employees.',
    'The system tracks wellness metrics. [[Rosa Vega]] designed the privacy-first architecture.',
    '',
    'The backend runs on [[Kubernetes]] with [[PostgreSQL]].',
    'Event Sourcing is used for the audit trail.',
    'Not to be confused with [[Saturn Platform]] which handles external analytics.',
  ].join('\n'),
  links: ['Neptune Insurance', 'Rosa Vega', 'Kubernetes', 'PostgreSQL', 'Saturn Platform'],
  folder: 'projects',
});

groundTruth.push(
  { notePath: 'projects/bluebird.md', entity: 'Event Sourcing', tier: 1, reason: 'Entity Event Sourcing appears verbatim' },
);

notes.push({
  path: 'projects/saturn-platform.md',
  title: 'Saturn Platform',
  frontmatter: { type: 'project', status: 'beta' },
  content: [
    'Saturn Platform is the client-facing analytics product at [[Neptune Insurance]].',
    '[[Owen Park]] architected it and [[Nadia Reyes]] maintains the frontend.',
    '',
    'Uses [[React]] for UI and [[PostgreSQL]] for storage.',
    'Deployed on [[Kubernetes]] with [[Terraform]] automation.',
    '',
    'Note: "Saturn" sometimes gets confused with the planet in casual notes.',
  ].join('\n'),
  links: ['Neptune Insurance', 'Owen Park', 'Nadia Reyes', 'React', 'PostgreSQL', 'Kubernetes', 'Terraform'],
  folder: 'projects',
});

// =============================================================================
// People notes (5) — entity notes
// =============================================================================

notes.push({
  path: 'people/owen-park.md',
  title: 'Owen Park',
  frontmatter: { type: 'person', role: 'Principal Engineer' },
  content: [
    'Owen Park is a Principal Engineer at [[Neptune Insurance]], based in the [[Seoul]] office.',
    'He leads [[Project Zenith]] and architected [[Saturn Platform]].',
    'Owen specializes in Kubernetes and Terraform.',
    '',
    'He mentors [[Ines Dufresne]] on infrastructure topics.',
    'Runs a morning jogging routine.',
    'Enjoys pho for lunch.',
  ].join('\n'),
  links: ['Neptune Insurance', 'Seoul', 'Project Zenith', 'Saturn Platform', 'Ines Dufresne'],
  folder: 'people',
});

groundTruth.push(
  { notePath: 'people/owen-park.md', entity: 'Kubernetes', tier: 1, reason: 'Entity Kubernetes appears verbatim' },
  { notePath: 'people/owen-park.md', entity: 'Terraform', tier: 1, reason: 'Entity Terraform appears verbatim' },
  { notePath: 'people/owen-park.md', entity: 'Running', tier: 2, reason: 'Alias "jogging" matches entity Running' },
  { notePath: 'people/owen-park.md', entity: 'Pho Bowl', tier: 2, reason: 'Alias "pho" matches entity Pho Bowl' },
);

notes.push({
  path: 'people/nadia-reyes.md',
  title: 'Nadia Reyes',
  frontmatter: { type: 'person' },
  content: [
    'Nadia Reyes is a Senior Frontend Engineer at [[Neptune Insurance]].',
    'She specializes in React and design systems.',
    'Nadia maintains the frontend for [[Saturn Platform]] and [[Bluebird]].',
    '',
    'She has a cat named Luna who often appears in her daily notes.',
    'Listens to Signal Patterns podcast during commutes.',
  ].join('\n'),
  links: ['Neptune Insurance', 'Saturn Platform', 'Bluebird'],
  folder: 'people',
});

groundTruth.push(
  { notePath: 'people/nadia-reyes.md', entity: 'React', tier: 1, reason: 'Entity React appears verbatim' },
  { notePath: 'people/nadia-reyes.md', entity: 'Luna', tier: 1, reason: 'Entity Luna appears verbatim' },
  { notePath: 'people/nadia-reyes.md', entity: 'Signal Patterns', tier: 1, reason: 'Entity Signal Patterns appears verbatim' },
);

notes.push({
  path: 'people/hiroshi-tanaka.md',
  title: 'Hiroshi Tanaka',
  frontmatter: { type: 'person', aliases: ['Hiroshi'] },
  content: [
    'Hiroshi Tanaka is the Machine Learning lead at [[Apex Systems]].',
    'He consults for [[Neptune Insurance]] on [[Project Zenith]].',
    '',
    'Hiroshi specializes in event-sourcing patterns and PostgreSQL optimization.',
    'Based in [[Toronto]].',
  ].join('\n'),
  links: ['Apex Systems', 'Neptune Insurance', 'Project Zenith', 'Toronto'],
  folder: 'people',
});

groundTruth.push(
  { notePath: 'people/hiroshi-tanaka.md', entity: 'Machine Learning', tier: 1, reason: 'Entity Machine Learning appears verbatim' },
  { notePath: 'people/hiroshi-tanaka.md', entity: 'Event Sourcing', tier: 2, reason: 'Alias "event-sourcing" matches entity Event Sourcing' },
  { notePath: 'people/hiroshi-tanaka.md', entity: 'PostgreSQL', tier: 1, reason: 'Entity PostgreSQL appears verbatim' },
);

notes.push({
  path: 'people/rosa-vega.md',
  title: 'Rosa Vega',
  frontmatter: { type: 'person' },
  content: [
    'Rosa Vega is a backend engineer at [[Neptune Insurance]].',
    'She designed the [[Bluebird]] privacy architecture.',
    '',
    'Rosa works with Kubernetes and Terraform daily.',
    'She runs in the evenings and tracks her progress.',
  ].join('\n'),
  links: ['Neptune Insurance', 'Bluebird'],
  folder: 'people',
});

groundTruth.push(
  { notePath: 'people/rosa-vega.md', entity: 'Kubernetes', tier: 1, reason: 'Entity Kubernetes appears verbatim' },
  { notePath: 'people/rosa-vega.md', entity: 'Terraform', tier: 1, reason: 'Entity Terraform appears verbatim' },
);

notes.push({
  path: 'people/ines-dufresne.md',
  title: 'Ines Dufresne',
  frontmatter: { type: 'person' },
  content: [
    'Ines Dufresne is a junior infrastructure engineer.',
    'She works on [[Project Zenith]] under Owen Park.',
    '',
    'Ines is learning Terraform and Kubernetes.',
    'She keeps a cat named Luna in her apartment.',
  ].join('\n'),
  links: ['Project Zenith'],
  folder: 'people',
});

groundTruth.push(
  { notePath: 'people/ines-dufresne.md', entity: 'Owen Park', tier: 1, reason: 'Entity Owen Park appears verbatim' },
  { notePath: 'people/ines-dufresne.md', entity: 'Terraform', tier: 1, reason: 'Entity Terraform appears verbatim' },
  { notePath: 'people/ines-dufresne.md', entity: 'Kubernetes', tier: 1, reason: 'Entity Kubernetes appears verbatim' },
  { notePath: 'people/ines-dufresne.md', entity: 'Luna', tier: 1, reason: 'Entity Luna appears verbatim' },
);

// =============================================================================
// Organization notes (3)
// =============================================================================

notes.push({
  path: 'organizations/neptune-insurance.md',
  title: 'Neptune Insurance',
  frontmatter: { type: 'organization', aliases: ['Neptune Ins'] },
  content: [
    '# Neptune Insurance',
    '',
    'Neptune Insurance is a mid-size insurer headquartered in Seoul.',
    'Engineering offices in Seoul and Toronto.',
    '',
    'Key projects: Project Zenith, Bluebird, Saturn Platform.',
    'Technology stack includes Kubernetes, Terraform, PostgreSQL, and React.',
  ].join('\n'),
  links: [],
  folder: 'organizations',
});

groundTruth.push(
  { notePath: 'organizations/neptune-insurance.md', entity: 'Seoul', tier: 1, reason: 'Entity Seoul appears verbatim' },
  { notePath: 'organizations/neptune-insurance.md', entity: 'Toronto', tier: 1, reason: 'Entity Toronto appears verbatim' },
  { notePath: 'organizations/neptune-insurance.md', entity: 'Project Zenith', tier: 1, reason: 'Entity Project Zenith appears verbatim' },
  { notePath: 'organizations/neptune-insurance.md', entity: 'Bluebird', tier: 1, reason: 'Entity Bluebird appears verbatim' },
  { notePath: 'organizations/neptune-insurance.md', entity: 'Saturn Platform', tier: 1, reason: 'Entity Saturn Platform appears verbatim' },
  { notePath: 'organizations/neptune-insurance.md', entity: 'Kubernetes', tier: 1, reason: 'Entity Kubernetes appears verbatim' },
  { notePath: 'organizations/neptune-insurance.md', entity: 'Terraform', tier: 1, reason: 'Entity Terraform appears verbatim' },
  { notePath: 'organizations/neptune-insurance.md', entity: 'PostgreSQL', tier: 1, reason: 'Entity PostgreSQL appears verbatim' },
  { notePath: 'organizations/neptune-insurance.md', entity: 'React', tier: 1, reason: 'Entity React appears verbatim' },
);

notes.push({
  path: 'organizations/apex-systems.md',
  title: 'Apex Systems',
  frontmatter: { type: 'organization' },
  content: [
    '# Apex Systems',
    '',
    'Apex Systems is a consulting firm specializing in ML and infrastructure.',
    'Hiroshi Tanaka is their lead consultant.',
  ].join('\n'),
  links: [],
  folder: 'organizations',
});

groundTruth.push(
  { notePath: 'organizations/apex-systems.md', entity: 'Hiroshi Tanaka', tier: 1, reason: 'Entity Hiroshi Tanaka appears verbatim' },
  { notePath: 'organizations/apex-systems.md', entity: 'Machine Learning', tier: 2, reason: 'Alias "ML" matches entity Machine Learning' },
);

notes.push({
  path: 'organizations/gridpoint-inc.md',
  title: 'GridPoint Inc',
  frontmatter: { type: 'organization', aliases: ['GridPoint'] },
  content: [
    '# GridPoint Inc',
    '',
    'GridPoint is a small energy startup.',
    'Not much documentation available yet.',
  ].join('\n'),
  links: [],
  folder: 'organizations',
});

// =============================================================================
// Daily notes (12) — mix of linked and orphan
// =============================================================================

notes.push({
  path: 'daily-notes/2026-01-05.md',
  title: '2026-01-05',
  frontmatter: { type: 'daily' },
  content: [
    '## Habits',
    '- Morning run around the park',
    '- Fed Luna',
    '',
    '## Work',
    'Reviewed PR for [[Project Zenith]]. Owen had good feedback on the k8s migration.',
    'Deployed Bluebird updates to staging. Rosa confirmed it looks good.',
    '',
    'Grabbed pho for lunch with Ines.',
  ].join('\n'),
  links: ['Project Zenith'],
  folder: 'daily-notes',
});

groundTruth.push(
  { notePath: 'daily-notes/2026-01-05.md', entity: 'Running', tier: 2, reason: 'Alias "morning run" contextually matches Running' },
  { notePath: 'daily-notes/2026-01-05.md', entity: 'Luna', tier: 1, reason: 'Entity Luna appears verbatim' },
  { notePath: 'daily-notes/2026-01-05.md', entity: 'Bluebird', tier: 1, reason: 'Entity Bluebird appears verbatim' },
  { notePath: 'daily-notes/2026-01-05.md', entity: 'Kubernetes', tier: 2, reason: 'Alias "k8s" matches entity Kubernetes' },
  { notePath: 'daily-notes/2026-01-05.md', entity: 'Pho Bowl', tier: 2, reason: 'Alias "pho" matches entity Pho Bowl' },
);

notes.push({
  path: 'daily-notes/2026-01-06.md',
  title: '2026-01-06',
  frontmatter: { type: 'daily' },
  content: [
    '## Work',
    'Paired with Hiroshi Tanaka on the ML model deployment.',
    'Saturn Platform dashboard has a React rendering bug.',
    'Neptune Ins sent over the Q1 requirements.',
    '',
    '## Evening',
    'Went jogging. Luna was waiting at the door.',
    'Listened to Signal Patterns while cooking.',
  ].join('\n'),
  links: [],
  folder: 'daily-notes',
});

groundTruth.push(
  { notePath: 'daily-notes/2026-01-06.md', entity: 'Hiroshi Tanaka', tier: 1, reason: 'Entity Hiroshi Tanaka appears verbatim' },
  { notePath: 'daily-notes/2026-01-06.md', entity: 'Machine Learning', tier: 2, reason: 'Alias "ML" matches entity Machine Learning' },
  { notePath: 'daily-notes/2026-01-06.md', entity: 'Saturn Platform', tier: 1, reason: 'Entity Saturn Platform appears verbatim' },
  { notePath: 'daily-notes/2026-01-06.md', entity: 'React', tier: 1, reason: 'Entity React appears verbatim' },
  { notePath: 'daily-notes/2026-01-06.md', entity: 'Neptune Insurance', tier: 2, reason: 'Alias "Neptune Ins" matches entity Neptune Insurance' },
  { notePath: 'daily-notes/2026-01-06.md', entity: 'Running', tier: 2, reason: 'Alias "jogging" matches entity Running' },
  { notePath: 'daily-notes/2026-01-06.md', entity: 'Luna', tier: 1, reason: 'Entity Luna appears verbatim' },
  { notePath: 'daily-notes/2026-01-06.md', entity: 'Signal Patterns', tier: 1, reason: 'Entity Signal Patterns appears verbatim' },
);

notes.push({
  path: 'daily-notes/2026-01-07.md',
  title: '2026-01-07',
  frontmatter: { type: 'daily' },
  content: [
    '## Work',
    'Project Zenith standup — Owen Park raised concerns about Terraform drift.',
    'Ines Dufresne is working on the PostgreSQL replication setup.',
    '',
    'MCP integration meeting with Apex Systems.',
    'JWT token rotation policy needs review.',
  ].join('\n'),
  links: [],
  folder: 'daily-notes',
});

groundTruth.push(
  { notePath: 'daily-notes/2026-01-07.md', entity: 'Project Zenith', tier: 1, reason: 'Entity Project Zenith appears verbatim' },
  { notePath: 'daily-notes/2026-01-07.md', entity: 'Owen Park', tier: 1, reason: 'Entity Owen Park appears verbatim' },
  { notePath: 'daily-notes/2026-01-07.md', entity: 'Terraform', tier: 1, reason: 'Entity Terraform appears verbatim' },
  { notePath: 'daily-notes/2026-01-07.md', entity: 'Ines Dufresne', tier: 1, reason: 'Entity Ines Dufresne appears verbatim' },
  { notePath: 'daily-notes/2026-01-07.md', entity: 'PostgreSQL', tier: 1, reason: 'Entity PostgreSQL appears verbatim' },
  { notePath: 'daily-notes/2026-01-07.md', entity: 'MCP', tier: 1, reason: 'Entity MCP appears verbatim' },
  { notePath: 'daily-notes/2026-01-07.md', entity: 'Apex Systems', tier: 1, reason: 'Entity Apex Systems appears verbatim' },
  { notePath: 'daily-notes/2026-01-07.md', entity: 'JWT', tier: 1, reason: 'Entity JWT appears verbatim' },
);

notes.push({
  path: 'daily-notes/2026-01-08.md',
  title: '2026-01-08',
  frontmatter: { type: 'daily' },
  content: [
    '## Habits',
    '- Running in the morning, 5k',
    '',
    '## Work',
    'Rosa Vega demoed the Bluebird event-sourcing pipeline.',
    'Nadia reviewed React component library updates.',
  ].join('\n'),
  links: [],
  folder: 'daily-notes',
});

groundTruth.push(
  { notePath: 'daily-notes/2026-01-08.md', entity: 'Running', tier: 1, reason: 'Entity Running appears verbatim' },
  { notePath: 'daily-notes/2026-01-08.md', entity: 'Rosa Vega', tier: 1, reason: 'Entity Rosa Vega appears verbatim' },
  { notePath: 'daily-notes/2026-01-08.md', entity: 'Bluebird', tier: 1, reason: 'Entity Bluebird appears verbatim' },
  { notePath: 'daily-notes/2026-01-08.md', entity: 'Event Sourcing', tier: 2, reason: 'Alias "event-sourcing" matches entity Event Sourcing' },
  { notePath: 'daily-notes/2026-01-08.md', entity: 'React', tier: 1, reason: 'Entity React appears verbatim' },
);

notes.push({
  path: 'daily-notes/2026-01-09.md',
  title: '2026-01-09',
  // Chaos: missing frontmatter entirely
  content: [
    'Quick note: Owen mentioned Zenith deadline moved to March.',
    'Need to check Terraform modules.',
    'Hiroshi flying back from Toronto tomorrow.',
  ].join('\n'),
  links: [],
  folder: 'daily-notes',
});

groundTruth.push(
  { notePath: 'daily-notes/2026-01-09.md', entity: 'Project Zenith', tier: 2, reason: 'Alias "Zenith" matches entity Project Zenith' },
  { notePath: 'daily-notes/2026-01-09.md', entity: 'Terraform', tier: 1, reason: 'Entity Terraform appears verbatim' },
  { notePath: 'daily-notes/2026-01-09.md', entity: 'Toronto', tier: 1, reason: 'Entity Toronto appears verbatim' },
);

notes.push({
  path: 'daily-notes/2026-01-10.md',
  title: '2026-01-10',
  frontmatter: { type: 'daily' },
  content: [
    '## Work',
    'Machine Learning model training on the new GPU cluster.',
    'Kubernetes cluster autoscaling broke again. Owen Park is debugging.',
    '',
    'Listened to Signal Patterns ep. 42 on event sourcing.',
  ].join('\n'),
  links: [],
  folder: 'daily-notes',
});

groundTruth.push(
  { notePath: 'daily-notes/2026-01-10.md', entity: 'Machine Learning', tier: 1, reason: 'Entity Machine Learning appears verbatim' },
  { notePath: 'daily-notes/2026-01-10.md', entity: 'Kubernetes', tier: 1, reason: 'Entity Kubernetes appears verbatim' },
  { notePath: 'daily-notes/2026-01-10.md', entity: 'Owen Park', tier: 1, reason: 'Entity Owen Park appears verbatim' },
  { notePath: 'daily-notes/2026-01-10.md', entity: 'Signal Patterns', tier: 1, reason: 'Entity Signal Patterns appears verbatim' },
  { notePath: 'daily-notes/2026-01-10.md', entity: 'Event Sourcing', tier: 2, reason: 'Alias "event sourcing" matches entity Event Sourcing' },
);

notes.push({
  path: 'daily-notes/2026-01-12.md',
  title: '2026-01-12',
  // Chaos: wrong frontmatter type
  frontmatter: { type: 'meeting' },
  content: [
    '## Work',
    'GridPoint Inc wants to integrate with Saturn Platform.',
    'Nadia Reyes is handling the frontend integration.',
    'Need to set up JWT auth tokens for the GridPoint API.',
  ].join('\n'),
  links: [],
  folder: 'daily-notes',
});

groundTruth.push(
  { notePath: 'daily-notes/2026-01-12.md', entity: 'GridPoint Inc', tier: 1, reason: 'Entity GridPoint Inc appears verbatim' },
  { notePath: 'daily-notes/2026-01-12.md', entity: 'Saturn Platform', tier: 1, reason: 'Entity Saturn Platform appears verbatim' },
  { notePath: 'daily-notes/2026-01-12.md', entity: 'Nadia Reyes', tier: 1, reason: 'Entity Nadia Reyes appears verbatim' },
  { notePath: 'daily-notes/2026-01-12.md', entity: 'JWT', tier: 1, reason: 'Entity JWT appears verbatim' },
);

notes.push({
  path: 'daily-notes/2026-01-13.md',
  title: '2026-01-13',
  frontmatter: { type: 'daily' },
  content: [
    '## Work',
    'Reviewed Bluebird Postgres performance reports with Rosa.',
    'MCP model context improvements deployed.',
    '',
    '## Habits',
    '- morning run',
    '- pho from the new place on Queen St.',
  ].join('\n'),
  links: [],
  folder: 'daily-notes',
});

groundTruth.push(
  { notePath: 'daily-notes/2026-01-13.md', entity: 'Bluebird', tier: 1, reason: 'Entity Bluebird appears verbatim' },
  { notePath: 'daily-notes/2026-01-13.md', entity: 'PostgreSQL', tier: 2, reason: 'Alias "Postgres" matches entity PostgreSQL' },
  { notePath: 'daily-notes/2026-01-13.md', entity: 'MCP', tier: 1, reason: 'Entity MCP appears verbatim' },
  { notePath: 'daily-notes/2026-01-13.md', entity: 'Running', tier: 2, reason: 'Alias "morning run" matches entity Running' },
  { notePath: 'daily-notes/2026-01-13.md', entity: 'Pho Bowl', tier: 2, reason: 'Alias "pho" matches entity Pho Bowl' },
);

// Typo note — chaos feature
notes.push({
  path: 'daily-notes/2026-01-14.md',
  title: '2026-01-14',
  frontmatter: { type: 'daily' },
  content: [
    '## Work',
    'Hirosi Tnaka sent over the ML report — lots of good insights.',
    'Need to sync with Nadia on the Rreact components.',
    'Terrraform modules need updating for the Seoul datacenter.',
    '',
    'Luna knocked over my coffee again.',
  ].join('\n'),
  links: [],
  folder: 'daily-notes',
});

groundTruth.push(
  { notePath: 'daily-notes/2026-01-14.md', entity: 'Hiroshi Tanaka', tier: 3, reason: 'Typo "Hirosi Tnaka" is contextually Hiroshi Tanaka' },
  { notePath: 'daily-notes/2026-01-14.md', entity: 'Machine Learning', tier: 2, reason: 'Alias "ML" matches entity Machine Learning' },
  { notePath: 'daily-notes/2026-01-14.md', entity: 'React', tier: 3, reason: 'Typo "Rreact" is contextually React' },
  { notePath: 'daily-notes/2026-01-14.md', entity: 'Terraform', tier: 3, reason: 'Typo "Terrraform" is contextually Terraform' },
  { notePath: 'daily-notes/2026-01-14.md', entity: 'Seoul', tier: 1, reason: 'Entity Seoul appears verbatim' },
  { notePath: 'daily-notes/2026-01-14.md', entity: 'Luna', tier: 1, reason: 'Entity Luna appears verbatim' },
);

notes.push({
  path: 'daily-notes/2026-01-17.md',
  title: '2026-01-17',
  // Chaos: frontmatter with extra fields
  frontmatter: { type: 'daily', mood: 'productive', weather: 'sunny' },
  content: [
    '## Toronto Offsite Day 1',
    'Met with Neptune Insurance leadership about Project Zenith roadmap.',
    'Apex Systems presenting their ML consulting proposal.',
    '',
    'Dinner at a great pho place downtown. Owen, Nadia, and Hiroshi joined.',
  ].join('\n'),
  links: [],
  folder: 'daily-notes',
});

groundTruth.push(
  { notePath: 'daily-notes/2026-01-17.md', entity: 'Neptune Insurance', tier: 1, reason: 'Entity Neptune Insurance appears verbatim' },
  { notePath: 'daily-notes/2026-01-17.md', entity: 'Project Zenith', tier: 1, reason: 'Entity Project Zenith appears verbatim' },
  { notePath: 'daily-notes/2026-01-17.md', entity: 'Apex Systems', tier: 1, reason: 'Entity Apex Systems appears verbatim' },
  { notePath: 'daily-notes/2026-01-17.md', entity: 'Machine Learning', tier: 2, reason: 'Alias "ML" matches entity Machine Learning' },
  { notePath: 'daily-notes/2026-01-17.md', entity: 'Pho Bowl', tier: 2, reason: 'Alias "pho" matches entity Pho Bowl' },
);

notes.push({
  path: 'daily-notes/2026-01-18.md',
  title: '2026-01-18',
  frontmatter: { type: 'daily' },
  content: [
    '## Toronto Offsite Day 2',
    'Deep dive on Event Sourcing architecture with Hiroshi Tanaka.',
    'Rosa Vega presented Bluebird privacy audit results.',
    '',
    'Afternoon: Kubernetes workshop led by Owen Park.',
    'JWT rotation policy finalized.',
  ].join('\n'),
  links: [],
  folder: 'daily-notes',
});

groundTruth.push(
  { notePath: 'daily-notes/2026-01-18.md', entity: 'Event Sourcing', tier: 1, reason: 'Entity Event Sourcing appears verbatim' },
  { notePath: 'daily-notes/2026-01-18.md', entity: 'Hiroshi Tanaka', tier: 1, reason: 'Entity Hiroshi Tanaka appears verbatim' },
  { notePath: 'daily-notes/2026-01-18.md', entity: 'Rosa Vega', tier: 1, reason: 'Entity Rosa Vega appears verbatim' },
  { notePath: 'daily-notes/2026-01-18.md', entity: 'Bluebird', tier: 1, reason: 'Entity Bluebird appears verbatim' },
  { notePath: 'daily-notes/2026-01-18.md', entity: 'Kubernetes', tier: 1, reason: 'Entity Kubernetes appears verbatim' },
  { notePath: 'daily-notes/2026-01-18.md', entity: 'Owen Park', tier: 1, reason: 'Entity Owen Park appears verbatim' },
  { notePath: 'daily-notes/2026-01-18.md', entity: 'JWT', tier: 1, reason: 'Entity JWT appears verbatim' },
);

notes.push({
  path: 'daily-notes/2026-01-21.md',
  title: '2026-01-21',
  frontmatter: { type: 'daily' },
  content: [
    '## Habits',
    '- morning run, 4k',
    '',
    '## Work',
    'ReactJS component library v3 release. Nadia Reyes spearheaded it.',
    'Saturn Platform getting GridPoint integration this sprint.',
    'Postgres migration scripts need review.',
    'Listened to Signal Patterns podcast on the commute.',
    'Grabbed pho for lunch near the Seoul office.',
  ].join('\n'),
  links: [],
  folder: 'daily-notes',
});

groundTruth.push(
  { notePath: 'daily-notes/2026-01-21.md', entity: 'Running', tier: 2, reason: 'Alias "morning run" matches entity Running' },
  { notePath: 'daily-notes/2026-01-21.md', entity: 'React', tier: 2, reason: 'Alias "ReactJS" matches entity React' },
  { notePath: 'daily-notes/2026-01-21.md', entity: 'Nadia Reyes', tier: 1, reason: 'Entity Nadia Reyes appears verbatim' },
  { notePath: 'daily-notes/2026-01-21.md', entity: 'Saturn Platform', tier: 1, reason: 'Entity Saturn Platform appears verbatim' },
  { notePath: 'daily-notes/2026-01-21.md', entity: 'GridPoint Inc', tier: 2, reason: 'Alias "GridPoint" matches entity GridPoint Inc' },
  { notePath: 'daily-notes/2026-01-21.md', entity: 'PostgreSQL', tier: 2, reason: 'Alias "Postgres" matches entity PostgreSQL' },
  { notePath: 'daily-notes/2026-01-21.md', entity: 'Signal Patterns', tier: 1, reason: 'Entity Signal Patterns appears verbatim' },
  { notePath: 'daily-notes/2026-01-21.md', entity: 'Pho Bowl', tier: 2, reason: 'Alias "pho" matches entity Pho Bowl' },
  { notePath: 'daily-notes/2026-01-21.md', entity: 'Seoul', tier: 1, reason: 'Entity Seoul appears verbatim' },
);

// =============================================================================
// Meeting notes (4)
// =============================================================================

notes.push({
  path: 'meetings/zenith-standup.md',
  title: 'Zenith Standup',
  frontmatter: { type: 'meeting', project: 'Project Zenith' },
  content: [
    '# Zenith Standup',
    '',
    'Attendees: Owen Park, Ines Dufresne, Rosa Vega',
    '',
    '## Updates',
    '- Kubernetes cluster migration 70% done',
    '- Terraform modules refactored for multi-region',
    '- PostgreSQL replication lag reduced to < 50ms',
    '',
    '## Blockers',
    '- JWT token expiry too aggressive in staging',
    '- MCP model serving latency spikes',
  ].join('\n'),
  links: [],
  folder: 'meetings',
});

groundTruth.push(
  { notePath: 'meetings/zenith-standup.md', entity: 'Owen Park', tier: 1, reason: 'Entity Owen Park appears verbatim' },
  { notePath: 'meetings/zenith-standup.md', entity: 'Ines Dufresne', tier: 1, reason: 'Entity Ines Dufresne appears verbatim' },
  { notePath: 'meetings/zenith-standup.md', entity: 'Rosa Vega', tier: 1, reason: 'Entity Rosa Vega appears verbatim' },
  { notePath: 'meetings/zenith-standup.md', entity: 'Kubernetes', tier: 1, reason: 'Entity Kubernetes appears verbatim' },
  { notePath: 'meetings/zenith-standup.md', entity: 'Terraform', tier: 1, reason: 'Entity Terraform appears verbatim' },
  { notePath: 'meetings/zenith-standup.md', entity: 'PostgreSQL', tier: 1, reason: 'Entity PostgreSQL appears verbatim' },
  { notePath: 'meetings/zenith-standup.md', entity: 'JWT', tier: 1, reason: 'Entity JWT appears verbatim' },
  { notePath: 'meetings/zenith-standup.md', entity: 'MCP', tier: 1, reason: 'Entity MCP appears verbatim' },
  { notePath: 'meetings/zenith-standup.md', entity: 'Project Zenith', tier: 2, reason: 'Alias "Zenith" matches entity Project Zenith' },
);

notes.push({
  path: 'meetings/ml-review.md',
  title: 'ML Review',
  frontmatter: {},
  content: [
    '# ML Review',
    '',
    'Attendees: Hiroshi Tanaka, Owen Park',
    '',
    'Discussed Machine Learning model performance.',
    'Event Sourcing pipeline integration with the ML inference layer.',
    '',
    'Action: Hiroshi to prepare Apex Systems proposal for Q2.',
    'MCP context window optimization next sprint.',
  ].join('\n'),
  links: [],
  folder: 'meetings',
});

groundTruth.push(
  { notePath: 'meetings/ml-review.md', entity: 'Hiroshi Tanaka', tier: 1, reason: 'Entity Hiroshi Tanaka appears verbatim' },
  { notePath: 'meetings/ml-review.md', entity: 'Owen Park', tier: 1, reason: 'Entity Owen Park appears verbatim' },
  { notePath: 'meetings/ml-review.md', entity: 'Machine Learning', tier: 1, reason: 'Entity Machine Learning appears verbatim' },
  { notePath: 'meetings/ml-review.md', entity: 'Event Sourcing', tier: 1, reason: 'Entity Event Sourcing appears verbatim' },
  { notePath: 'meetings/ml-review.md', entity: 'Apex Systems', tier: 1, reason: 'Entity Apex Systems appears verbatim' },
  { notePath: 'meetings/ml-review.md', entity: 'MCP', tier: 1, reason: 'Entity MCP appears verbatim' },
);

notes.push({
  path: 'meetings/neptune-quarterly.md',
  title: 'Neptune Quarterly Review',
  frontmatter: { type: 'meeting' },
  content: [
    '# Neptune Insurance Quarterly Review',
    '',
    'Neptune Insurance leadership reviewed all active projects.',
    'Project Zenith is on track. Saturn Platform needs more resources.',
    'Bluebird pilot expanded to 500 users.',
    '',
    'Nadia Reyes presenting frontend roadmap.',
    'Owen Park presenting infrastructure roadmap.',
    'Rosa Vega presenting privacy compliance.',
  ].join('\n'),
  links: [],
  folder: 'meetings',
});

groundTruth.push(
  { notePath: 'meetings/neptune-quarterly.md', entity: 'Neptune Insurance', tier: 1, reason: 'Entity Neptune Insurance appears verbatim' },
  { notePath: 'meetings/neptune-quarterly.md', entity: 'Project Zenith', tier: 1, reason: 'Entity Project Zenith appears verbatim' },
  { notePath: 'meetings/neptune-quarterly.md', entity: 'Saturn Platform', tier: 1, reason: 'Entity Saturn Platform appears verbatim' },
  { notePath: 'meetings/neptune-quarterly.md', entity: 'Bluebird', tier: 1, reason: 'Entity Bluebird appears verbatim' },
  { notePath: 'meetings/neptune-quarterly.md', entity: 'Nadia Reyes', tier: 1, reason: 'Entity Nadia Reyes appears verbatim' },
  { notePath: 'meetings/neptune-quarterly.md', entity: 'Owen Park', tier: 1, reason: 'Entity Owen Park appears verbatim' },
  { notePath: 'meetings/neptune-quarterly.md', entity: 'Rosa Vega', tier: 1, reason: 'Entity Rosa Vega appears verbatim' },
);

notes.push({
  path: 'meetings/gridpoint-integration.md',
  title: 'GridPoint Integration Kickoff',
  frontmatter: {},
  content: [
    '# GridPoint Integration Kickoff',
    '',
    'GridPoint Inc wants API access to Saturn Platform analytics.',
    'JWT-based authentication. React SDK for their developers.',
    '',
    'Nadia Reyes to lead frontend SDK development.',
    'Ines Dufresne to handle infrastructure provisioning.',
  ].join('\n'),
  links: [],
  folder: 'meetings',
});

groundTruth.push(
  { notePath: 'meetings/gridpoint-integration.md', entity: 'GridPoint Inc', tier: 1, reason: 'Entity GridPoint Inc appears verbatim' },
  { notePath: 'meetings/gridpoint-integration.md', entity: 'Saturn Platform', tier: 1, reason: 'Entity Saturn Platform appears verbatim' },
  { notePath: 'meetings/gridpoint-integration.md', entity: 'React', tier: 1, reason: 'Entity React appears verbatim' },
  { notePath: 'meetings/gridpoint-integration.md', entity: 'Nadia Reyes', tier: 1, reason: 'Entity Nadia Reyes appears verbatim' },
  { notePath: 'meetings/gridpoint-integration.md', entity: 'Ines Dufresne', tier: 1, reason: 'Entity Ines Dufresne appears verbatim' },
);

// =============================================================================
// Tech guides / content notes (5)
// =============================================================================

notes.push({
  path: 'tech-guides/kubernetes-runbook.md',
  title: 'Kubernetes Runbook',
  frontmatter: { type: 'guide' },
  content: [
    '# Kubernetes Runbook',
    '',
    'Kubernetes is deployed across Seoul and Toronto datacenters.',
    'Managed via Terraform. PostgreSQL databases run as StatefulSets.',
    '',
    'On-call: Owen Park (primary), Rosa Vega (secondary).',
    'Escalation: Hiroshi Tanaka for ML workloads.',
    '',
    'Related projects: Project Zenith, Saturn Platform, Bluebird.',
  ].join('\n'),
  links: [],
  folder: 'tech-guides',
});

groundTruth.push(
  { notePath: 'tech-guides/kubernetes-runbook.md', entity: 'Kubernetes', tier: 1, reason: 'Entity Kubernetes appears verbatim' },
  { notePath: 'tech-guides/kubernetes-runbook.md', entity: 'Seoul', tier: 1, reason: 'Entity Seoul appears verbatim' },
  { notePath: 'tech-guides/kubernetes-runbook.md', entity: 'Toronto', tier: 1, reason: 'Entity Toronto appears verbatim' },
  { notePath: 'tech-guides/kubernetes-runbook.md', entity: 'Terraform', tier: 1, reason: 'Entity Terraform appears verbatim' },
  { notePath: 'tech-guides/kubernetes-runbook.md', entity: 'PostgreSQL', tier: 1, reason: 'Entity PostgreSQL appears verbatim' },
  { notePath: 'tech-guides/kubernetes-runbook.md', entity: 'Owen Park', tier: 1, reason: 'Entity Owen Park appears verbatim' },
  { notePath: 'tech-guides/kubernetes-runbook.md', entity: 'Rosa Vega', tier: 1, reason: 'Entity Rosa Vega appears verbatim' },
  { notePath: 'tech-guides/kubernetes-runbook.md', entity: 'Hiroshi Tanaka', tier: 1, reason: 'Entity Hiroshi Tanaka appears verbatim' },
  { notePath: 'tech-guides/kubernetes-runbook.md', entity: 'Project Zenith', tier: 1, reason: 'Entity Project Zenith appears verbatim' },
  { notePath: 'tech-guides/kubernetes-runbook.md', entity: 'Saturn Platform', tier: 1, reason: 'Entity Saturn Platform appears verbatim' },
  { notePath: 'tech-guides/kubernetes-runbook.md', entity: 'Bluebird', tier: 1, reason: 'Entity Bluebird appears verbatim' },
  { notePath: 'tech-guides/kubernetes-runbook.md', entity: 'Machine Learning', tier: 2, reason: 'Alias "ML" matches entity Machine Learning' },
);

notes.push({
  path: 'tech-guides/react-patterns.md',
  title: 'React Component Patterns',
  frontmatter: { type: 'guide' },
  content: [
    '# React Component Patterns',
    '',
    'Our React component library follows atomic design.',
    'Used in Saturn Platform and Bluebird dashboards.',
    '',
    'Nadia Reyes maintains the shared design system.',
    'TypeScript strict mode is enforced.',
  ].join('\n'),
  links: [],
  folder: 'tech-guides',
});

groundTruth.push(
  { notePath: 'tech-guides/react-patterns.md', entity: 'React', tier: 1, reason: 'Entity React appears verbatim' },
  { notePath: 'tech-guides/react-patterns.md', entity: 'Saturn Platform', tier: 1, reason: 'Entity Saturn Platform appears verbatim' },
  { notePath: 'tech-guides/react-patterns.md', entity: 'Bluebird', tier: 1, reason: 'Entity Bluebird appears verbatim' },
  { notePath: 'tech-guides/react-patterns.md', entity: 'Nadia Reyes', tier: 1, reason: 'Entity Nadia Reyes appears verbatim' },
);

notes.push({
  path: 'tech-guides/event-sourcing-intro.md',
  title: 'Event Sourcing Introduction',
  frontmatter: { type: 'concept' },
  content: [
    '# Event Sourcing Introduction',
    '',
    'Event Sourcing stores state changes as immutable events.',
    'Used in Bluebird for audit trails.',
    '',
    'Pairs well with PostgreSQL for event storage and Machine Learning for pattern detection.',
  ].join('\n'),
  links: [],
  folder: 'tech-guides',
});

groundTruth.push(
  { notePath: 'tech-guides/event-sourcing-intro.md', entity: 'Event Sourcing', tier: 1, reason: 'Entity Event Sourcing appears verbatim' },
  { notePath: 'tech-guides/event-sourcing-intro.md', entity: 'Bluebird', tier: 1, reason: 'Entity Bluebird appears verbatim' },
  { notePath: 'tech-guides/event-sourcing-intro.md', entity: 'PostgreSQL', tier: 1, reason: 'Entity PostgreSQL appears verbatim' },
  { notePath: 'tech-guides/event-sourcing-intro.md', entity: 'Machine Learning', tier: 1, reason: 'Entity Machine Learning appears verbatim' },
);

notes.push({
  path: 'tech-guides/ml-ops.md',
  title: 'ML Ops Guide',
  // Chaos: no frontmatter
  content: [
    '# ML Ops',
    '',
    'Machine Learning operations at Neptune Insurance.',
    'Model serving via MCP protocol on Kubernetes.',
    '',
    'Hiroshi Tanaka owns the ML pipeline.',
    'Models deployed via Terraform. JWT tokens for API auth.',
  ].join('\n'),
  links: [],
  folder: 'tech-guides',
});

groundTruth.push(
  { notePath: 'tech-guides/ml-ops.md', entity: 'Machine Learning', tier: 1, reason: 'Entity Machine Learning appears verbatim' },
  { notePath: 'tech-guides/ml-ops.md', entity: 'Neptune Insurance', tier: 1, reason: 'Entity Neptune Insurance appears verbatim' },
  { notePath: 'tech-guides/ml-ops.md', entity: 'MCP', tier: 1, reason: 'Entity MCP appears verbatim' },
  { notePath: 'tech-guides/ml-ops.md', entity: 'Kubernetes', tier: 1, reason: 'Entity Kubernetes appears verbatim' },
  { notePath: 'tech-guides/ml-ops.md', entity: 'Hiroshi Tanaka', tier: 1, reason: 'Entity Hiroshi Tanaka appears verbatim' },
  { notePath: 'tech-guides/ml-ops.md', entity: 'Terraform', tier: 1, reason: 'Entity Terraform appears verbatim' },
  { notePath: 'tech-guides/ml-ops.md', entity: 'JWT', tier: 1, reason: 'Entity JWT appears verbatim' },
);

notes.push({
  path: 'tech-guides/mixed-domains.md',
  title: 'Mixed Domains Note',
  frontmatter: { type: 'note' },
  content: [
    '# Random Thoughts',
    '',
    'Took Luna to the vet. She needs vaccines.',
    'On the way back, grabbed pho and listened to Signal Patterns.',
    'Had an idea about Event Sourcing for tracking pet health records.',
    '',
    'Running helps clear my head for architecture decisions.',
    'Need to look into MCP for the vet clinic app idea.',
  ].join('\n'),
  links: [],
  folder: 'tech-guides',
});

groundTruth.push(
  { notePath: 'tech-guides/mixed-domains.md', entity: 'Luna', tier: 1, reason: 'Entity Luna appears verbatim' },
  { notePath: 'tech-guides/mixed-domains.md', entity: 'Pho Bowl', tier: 2, reason: 'Alias "pho" matches entity Pho Bowl' },
  { notePath: 'tech-guides/mixed-domains.md', entity: 'Signal Patterns', tier: 1, reason: 'Entity Signal Patterns appears verbatim' },
  { notePath: 'tech-guides/mixed-domains.md', entity: 'Event Sourcing', tier: 1, reason: 'Entity Event Sourcing appears verbatim' },
  { notePath: 'tech-guides/mixed-domains.md', entity: 'Running', tier: 1, reason: 'Entity Running appears verbatim' },
  { notePath: 'tech-guides/mixed-domains.md', entity: 'MCP', tier: 1, reason: 'Entity MCP appears verbatim' },
);

// =============================================================================
// Stub notes (5) — < 50 chars
// =============================================================================

notes.push({
  path: 'stubs/seoul-office.md',
  title: 'Seoul Office',
  content: 'Office in Seoul. Details TBD.',
  links: [],
  folder: 'stubs',
});

groundTruth.push(
  { notePath: 'stubs/seoul-office.md', entity: 'Seoul', tier: 1, reason: 'Entity Seoul appears verbatim' },
);

notes.push({
  path: 'stubs/toronto-office.md',
  title: 'Toronto Office',
  content: 'Office in Toronto.',
  links: [],
  folder: 'stubs',
});

groundTruth.push(
  { notePath: 'stubs/toronto-office.md', entity: 'Toronto', tier: 1, reason: 'Entity Toronto appears verbatim' },
);

notes.push({
  path: 'stubs/neptune-contact.md',
  title: 'Neptune Contact',
  content: 'Neptune Insurance main contact.',
  links: [],
  folder: 'stubs',
});

groundTruth.push(
  { notePath: 'stubs/neptune-contact.md', entity: 'Neptune Insurance', tier: 1, reason: 'Entity Neptune Insurance appears verbatim' },
);

notes.push({
  path: 'stubs/mcp-notes.md',
  title: 'MCP Notes',
  content: 'MCP integration TODO.',
  links: [],
  folder: 'stubs',
});

groundTruth.push(
  { notePath: 'stubs/mcp-notes.md', entity: 'MCP', tier: 1, reason: 'Entity MCP appears verbatim' },
);

notes.push({
  path: 'stubs/jwt-policy.md',
  title: 'JWT Policy',
  content: 'JWT rotation policy draft.',
  links: [],
  folder: 'stubs',
});

groundTruth.push(
  { notePath: 'stubs/jwt-policy.md', entity: 'JWT', tier: 1, reason: 'Entity JWT appears verbatim' },
);

// =============================================================================
// Orphan notes (5) — no outlinks
// =============================================================================

notes.push({
  path: 'orphans/grocery-list.md',
  title: 'Grocery List',
  content: [
    '# Grocery List',
    '',
    '- Rice',
    '- Soy sauce',
    '- Cat food for Luna',
    '- Eggs',
    '- Milk',
  ].join('\n'),
  links: [],
  folder: 'orphans',
});

groundTruth.push(
  { notePath: 'orphans/grocery-list.md', entity: 'Luna', tier: 1, reason: 'Entity Luna appears verbatim' },
);

notes.push({
  path: 'orphans/book-notes.md',
  title: 'Book Notes',
  content: [
    '# Book: Clean Code',
    '',
    'Good insights on reducing technical debt.',
    'Reminds me of the refactoring we need to do on Zenith.',
  ].join('\n'),
  links: [],
  folder: 'orphans',
});

groundTruth.push(
  { notePath: 'orphans/book-notes.md', entity: 'Project Zenith', tier: 2, reason: 'Alias "Zenith" matches entity Project Zenith' },
);

notes.push({
  path: 'orphans/random-ideas.md',
  title: 'Random Ideas',
  content: [
    'What if we used Event Sourcing for the pet health tracker?',
    'Could combine Machine Learning with vet records.',
    'Luna would be the first test subject.',
  ].join('\n'),
  links: [],
  folder: 'orphans',
});

groundTruth.push(
  { notePath: 'orphans/random-ideas.md', entity: 'Event Sourcing', tier: 1, reason: 'Entity Event Sourcing appears verbatim' },
  { notePath: 'orphans/random-ideas.md', entity: 'Machine Learning', tier: 1, reason: 'Entity Machine Learning appears verbatim' },
  { notePath: 'orphans/random-ideas.md', entity: 'Luna', tier: 1, reason: 'Entity Luna appears verbatim' },
);

notes.push({
  path: 'orphans/conference-notes.md',
  title: 'Conference Notes',
  content: [
    '# KubeCon Notes',
    '',
    'Great talk on k8s multi-tenancy.',
    'Terraform Cloud session was informative.',
    'Met someone from Apex who mentioned GridPoint partnership.',
  ].join('\n'),
  links: [],
  folder: 'orphans',
});

groundTruth.push(
  { notePath: 'orphans/conference-notes.md', entity: 'Kubernetes', tier: 2, reason: 'Alias "k8s" matches entity Kubernetes' },
  { notePath: 'orphans/conference-notes.md', entity: 'Terraform', tier: 1, reason: 'Entity Terraform appears verbatim' },
  { notePath: 'orphans/conference-notes.md', entity: 'Apex Systems', tier: 2, reason: 'Alias "Apex" matches entity Apex Systems' },
  { notePath: 'orphans/conference-notes.md', entity: 'GridPoint Inc', tier: 2, reason: 'Alias "GridPoint" matches entity GridPoint Inc' },
);

notes.push({
  path: 'orphans/travel-planning.md',
  title: 'Travel Planning',
  content: [
    '# Travel Planning',
    '',
    'Seoul trip: flights from Toronto, hotel near Gangnam.',
    'Check if Neptune Ins covers travel insurance.',
    'Pho restaurants in Seoul to try.',
  ].join('\n'),
  links: [],
  folder: 'orphans',
});

groundTruth.push(
  { notePath: 'orphans/travel-planning.md', entity: 'Seoul', tier: 1, reason: 'Entity Seoul appears verbatim' },
  { notePath: 'orphans/travel-planning.md', entity: 'Toronto', tier: 1, reason: 'Entity Toronto appears verbatim' },
  { notePath: 'orphans/travel-planning.md', entity: 'Neptune Insurance', tier: 2, reason: 'Alias "Neptune Ins" matches entity Neptune Insurance' },
  { notePath: 'orphans/travel-planning.md', entity: 'Pho Bowl', tier: 2, reason: 'Alias "Pho" matches entity Pho Bowl' },
);

// =============================================================================
// Hub notes (2) — 5+ entity mentions
// =============================================================================

notes.push({
  path: 'hub/infrastructure-overview.md',
  title: 'Infrastructure Overview',
  frontmatter: { type: 'hub' },
  content: [
    '# Infrastructure Overview',
    '',
    'All infrastructure at Neptune Insurance runs on Kubernetes managed by Terraform.',
    'Databases: PostgreSQL for structured, Redis for caching.',
    'Frontend: React component library shared across projects.',
    '',
    'Key people:',
    '- Owen Park (Principal, Seoul)',
    '- Rosa Vega (Backend, Toronto)',
    '- Ines Dufresne (Junior Infra)',
    '- Hiroshi Tanaka (ML Consultant, Apex Systems)',
    '- Nadia Reyes (Frontend Lead)',
    '',
    'Projects: Project Zenith, Bluebird, Saturn Platform.',
    'Auth: JWT, MCP for AI features.',
    'Machine Learning workloads on dedicated GPU nodes.',
    'Event Sourcing for audit trails.',
  ].join('\n'),
  links: [],
  folder: 'hub',
});

groundTruth.push(
  { notePath: 'hub/infrastructure-overview.md', entity: 'Neptune Insurance', tier: 1, reason: 'Entity Neptune Insurance appears verbatim' },
  { notePath: 'hub/infrastructure-overview.md', entity: 'Kubernetes', tier: 1, reason: 'Entity Kubernetes appears verbatim' },
  { notePath: 'hub/infrastructure-overview.md', entity: 'Terraform', tier: 1, reason: 'Entity Terraform appears verbatim' },
  { notePath: 'hub/infrastructure-overview.md', entity: 'PostgreSQL', tier: 1, reason: 'Entity PostgreSQL appears verbatim' },
  { notePath: 'hub/infrastructure-overview.md', entity: 'React', tier: 1, reason: 'Entity React appears verbatim' },
  { notePath: 'hub/infrastructure-overview.md', entity: 'Owen Park', tier: 1, reason: 'Entity Owen Park appears verbatim' },
  { notePath: 'hub/infrastructure-overview.md', entity: 'Seoul', tier: 1, reason: 'Entity Seoul appears verbatim' },
  { notePath: 'hub/infrastructure-overview.md', entity: 'Rosa Vega', tier: 1, reason: 'Entity Rosa Vega appears verbatim' },
  { notePath: 'hub/infrastructure-overview.md', entity: 'Toronto', tier: 1, reason: 'Entity Toronto appears verbatim' },
  { notePath: 'hub/infrastructure-overview.md', entity: 'Ines Dufresne', tier: 1, reason: 'Entity Ines Dufresne appears verbatim' },
  { notePath: 'hub/infrastructure-overview.md', entity: 'Hiroshi Tanaka', tier: 1, reason: 'Entity Hiroshi Tanaka appears verbatim' },
  { notePath: 'hub/infrastructure-overview.md', entity: 'Apex Systems', tier: 1, reason: 'Entity Apex Systems appears verbatim' },
  { notePath: 'hub/infrastructure-overview.md', entity: 'Nadia Reyes', tier: 1, reason: 'Entity Nadia Reyes appears verbatim' },
  { notePath: 'hub/infrastructure-overview.md', entity: 'Project Zenith', tier: 1, reason: 'Entity Project Zenith appears verbatim' },
  { notePath: 'hub/infrastructure-overview.md', entity: 'Bluebird', tier: 1, reason: 'Entity Bluebird appears verbatim' },
  { notePath: 'hub/infrastructure-overview.md', entity: 'Saturn Platform', tier: 1, reason: 'Entity Saturn Platform appears verbatim' },
  { notePath: 'hub/infrastructure-overview.md', entity: 'JWT', tier: 1, reason: 'Entity JWT appears verbatim' },
  { notePath: 'hub/infrastructure-overview.md', entity: 'MCP', tier: 1, reason: 'Entity MCP appears verbatim' },
  { notePath: 'hub/infrastructure-overview.md', entity: 'Machine Learning', tier: 1, reason: 'Entity Machine Learning appears verbatim' },
  { notePath: 'hub/infrastructure-overview.md', entity: 'Event Sourcing', tier: 1, reason: 'Entity Event Sourcing appears verbatim' },
);

notes.push({
  path: 'hub/team-directory.md',
  title: 'Team Directory',
  frontmatter: { type: 'hub' },
  content: [
    '# Team Directory',
    '',
    '| Name | Role | Office | Projects |',
    '|------|------|--------|----------|',
    '| Owen Park | Principal Engineer | Seoul | Project Zenith, Saturn Platform |',
    '| Nadia Reyes | Senior Frontend | Seoul | Saturn Platform, Bluebird |',
    '| Hiroshi Tanaka | ML Consultant | Toronto | Project Zenith |',
    '| Rosa Vega | Backend Engineer | Toronto | Bluebird |',
    '| Ines Dufresne | Junior Infra | Seoul | Project Zenith |',
  ].join('\n'),
  links: [],
  folder: 'hub',
});

groundTruth.push(
  { notePath: 'hub/team-directory.md', entity: 'Owen Park', tier: 1, reason: 'Entity Owen Park appears verbatim' },
  { notePath: 'hub/team-directory.md', entity: 'Seoul', tier: 1, reason: 'Entity Seoul appears verbatim' },
  { notePath: 'hub/team-directory.md', entity: 'Project Zenith', tier: 1, reason: 'Entity Project Zenith appears verbatim' },
  { notePath: 'hub/team-directory.md', entity: 'Saturn Platform', tier: 1, reason: 'Entity Saturn Platform appears verbatim' },
  { notePath: 'hub/team-directory.md', entity: 'Nadia Reyes', tier: 1, reason: 'Entity Nadia Reyes appears verbatim' },
  { notePath: 'hub/team-directory.md', entity: 'Bluebird', tier: 1, reason: 'Entity Bluebird appears verbatim' },
  { notePath: 'hub/team-directory.md', entity: 'Hiroshi Tanaka', tier: 1, reason: 'Entity Hiroshi Tanaka appears verbatim' },
  { notePath: 'hub/team-directory.md', entity: 'Toronto', tier: 1, reason: 'Entity Toronto appears verbatim' },
  { notePath: 'hub/team-directory.md', entity: 'Rosa Vega', tier: 1, reason: 'Entity Rosa Vega appears verbatim' },
  { notePath: 'hub/team-directory.md', entity: 'Ines Dufresne', tier: 1, reason: 'Entity Ines Dufresne appears verbatim' },
);

// =============================================================================
// Entity notes (10) — for remaining non-people/non-project/non-org entities
// =============================================================================

notes.push({
  path: 'technologies/kubernetes.md',
  title: 'Kubernetes',
  frontmatter: { type: 'technologies', aliases: ['k8s', 'K8s'] },
  content: [
    '# Kubernetes',
    '',
    'Container orchestration platform.',
    'Used across all Neptune Insurance projects.',
  ].join('\n'),
  links: [],
  folder: 'technologies',
});

groundTruth.push(
  { notePath: 'technologies/kubernetes.md', entity: 'Neptune Insurance', tier: 1, reason: 'Entity Neptune Insurance appears verbatim' },
);

notes.push({
  path: 'technologies/terraform.md',
  title: 'Terraform',
  frontmatter: { type: 'technologies', aliases: ['TF', 'terraform'] },
  content: '# Terraform\n\nInfrastructure as code tool by HashiCorp.',
  links: [],
  folder: 'technologies',
});

notes.push({
  path: 'technologies/postgresql.md',
  title: 'PostgreSQL',
  frontmatter: { type: 'technologies', aliases: ['Postgres', 'psql'] },
  content: [
    '# PostgreSQL',
    '',
    'Relational database. Used in Bluebird and Saturn Platform.',
  ].join('\n'),
  links: [],
  folder: 'technologies',
});

groundTruth.push(
  { notePath: 'technologies/postgresql.md', entity: 'Bluebird', tier: 1, reason: 'Entity Bluebird appears verbatim' },
  { notePath: 'technologies/postgresql.md', entity: 'Saturn Platform', tier: 1, reason: 'Entity Saturn Platform appears verbatim' },
);

notes.push({
  path: 'technologies/react.md',
  title: 'React',
  frontmatter: { type: 'technologies', aliases: ['ReactJS', 'React.js'] },
  content: [
    '# React',
    '',
    'Frontend library. Component library maintained by Nadia Reyes.',
  ].join('\n'),
  links: [],
  folder: 'technologies',
});

groundTruth.push(
  { notePath: 'technologies/react.md', entity: 'Nadia Reyes', tier: 1, reason: 'Entity Nadia Reyes appears verbatim' },
);

notes.push({
  path: 'concepts/machine-learning.md',
  title: 'Machine Learning',
  frontmatter: { type: 'concepts', aliases: ['ML', 'machine learning'] },
  content: [
    '# Machine Learning',
    '',
    'ML workloads at Neptune Insurance.',
    'Led by Hiroshi Tanaka via Apex Systems.',
  ].join('\n'),
  links: [],
  folder: 'concepts',
});

groundTruth.push(
  { notePath: 'concepts/machine-learning.md', entity: 'Neptune Insurance', tier: 1, reason: 'Entity Neptune Insurance appears verbatim' },
  { notePath: 'concepts/machine-learning.md', entity: 'Hiroshi Tanaka', tier: 1, reason: 'Entity Hiroshi Tanaka appears verbatim' },
  { notePath: 'concepts/machine-learning.md', entity: 'Apex Systems', tier: 1, reason: 'Entity Apex Systems appears verbatim' },
);

notes.push({
  path: 'concepts/event-sourcing.md',
  title: 'Event Sourcing',
  frontmatter: { type: 'concepts', aliases: ['event-sourcing'] },
  content: '# Event Sourcing\n\nArchitectural pattern. Used in Bluebird audit trail.',
  links: [],
  folder: 'concepts',
});

groundTruth.push(
  { notePath: 'concepts/event-sourcing.md', entity: 'Bluebird', tier: 1, reason: 'Entity Bluebird appears verbatim' },
);

notes.push({
  path: 'locations/seoul.md',
  title: 'Seoul',
  frontmatter: { type: 'locations', aliases: ['SEL'] },
  content: '# Seoul\n\nHeadquarters location for Neptune Insurance.',
  links: [],
  folder: 'locations',
});

groundTruth.push(
  { notePath: 'locations/seoul.md', entity: 'Neptune Insurance', tier: 1, reason: 'Entity Neptune Insurance appears verbatim' },
);

notes.push({
  path: 'animals/luna.md',
  title: 'Luna',
  frontmatter: { type: 'animals', aliases: ['Luna the cat'] },
  content: '# Luna\n\nA rescue cat. Favorite nap spots: keyboard, laundry basket.',
  links: [],
  folder: 'animals',
});

notes.push({
  path: 'health/running.md',
  title: 'Running',
  frontmatter: { type: 'health', aliases: ['morning run', 'jogging'] },
  content: '# Running\n\nMorning running routine. Usually 4-6k.',
  links: [],
  folder: 'health',
});

notes.push({
  path: 'acronyms/mcp.md',
  title: 'MCP',
  frontmatter: { type: 'acronyms', aliases: ['mcp', 'Model Context Protocol'] },
  content: '# MCP\n\nModel Context Protocol for AI integration.',
  links: [],
  folder: 'acronyms',
});

// =============================================================================
// T3 (semantic/graph) ground truth
// =============================================================================

groundTruth.push(
  // Partial name matches (names that appear as aliases in the pool)
  { notePath: 'daily-notes/2026-01-05.md', entity: 'Neptune Insurance', tier: 3, reason: 'Project Zenith and Bluebird are Neptune Insurance projects (graph)' },
  { notePath: 'daily-notes/2026-01-05.md', entity: 'Owen Park', tier: 3, reason: '"Owen" partial name contextually maps to Owen Park' },
  { notePath: 'daily-notes/2026-01-05.md', entity: 'Rosa Vega', tier: 3, reason: '"Rosa" partial name contextually maps to Rosa Vega' },
  { notePath: 'daily-notes/2026-01-05.md', entity: 'Ines Dufresne', tier: 3, reason: '"Ines" partial name contextually maps to Ines Dufresne' },
  { notePath: 'daily-notes/2026-01-08.md', entity: 'Nadia Reyes', tier: 3, reason: '"Nadia" partial name contextually maps to Nadia Reyes' },
  { notePath: 'daily-notes/2026-01-09.md', entity: 'Owen Park', tier: 3, reason: '"Owen" partial name contextually maps to Owen Park' },
  { notePath: 'daily-notes/2026-01-09.md', entity: 'Hiroshi Tanaka', tier: 3, reason: '"Hiroshi" partial name contextually maps to Hiroshi Tanaka' },
  { notePath: 'daily-notes/2026-01-13.md', entity: 'Rosa Vega', tier: 3, reason: '"Rosa" partial name contextually maps to Rosa Vega' },
  { notePath: 'daily-notes/2026-01-14.md', entity: 'Nadia Reyes', tier: 3, reason: '"Nadia" partial name contextually maps to Nadia Reyes' },
  // Graph relationships
  { notePath: 'daily-notes/2026-01-17.md', entity: 'Toronto', tier: 3, reason: 'Offsite context suggests Toronto' },
  { notePath: 'orphans/book-notes.md', entity: 'Event Sourcing', tier: 3, reason: 'Refactoring discussion contextually related to Event Sourcing architecture' },
  { notePath: 'technologies/terraform.md', entity: 'Kubernetes', tier: 3, reason: 'Terraform manages Kubernetes infrastructure (graph relationship)' },
  { notePath: 'concepts/event-sourcing.md', entity: 'PostgreSQL', tier: 3, reason: 'Event Sourcing uses PostgreSQL for event storage (graph relationship)' },
  // Neptune ambiguity (planet vs insurance)
  { notePath: 'daily-notes/2026-01-17.md', entity: 'Owen Park', tier: 3, reason: '"Owen" partial name contextually maps to Owen Park' },
  { notePath: 'daily-notes/2026-01-17.md', entity: 'Nadia Reyes', tier: 3, reason: '"Nadia" partial name contextually maps to Nadia Reyes' },
  { notePath: 'daily-notes/2026-01-17.md', entity: 'Hiroshi Tanaka', tier: 3, reason: '"Hiroshi" partial name contextually maps to Hiroshi Tanaka' },
  // Orphan graph connections
  { notePath: 'orphans/grocery-list.md', entity: 'Pho Bowl', tier: 3, reason: 'Grocery list contextually related to food (Pho Bowl)' },
  { notePath: 'orphans/conference-notes.md', entity: 'Neptune Insurance', tier: 3, reason: 'Conference context connects to Neptune Insurance via Apex Systems' },
  { notePath: 'stubs/seoul-office.md', entity: 'Neptune Insurance', tier: 3, reason: 'Seoul office is Neptune Insurance HQ (graph)' },
  { notePath: 'stubs/toronto-office.md', entity: 'Neptune Insurance', tier: 3, reason: 'Toronto office is Neptune Insurance secondary (graph)' },
  { notePath: 'stubs/mcp-notes.md', entity: 'Project Zenith', tier: 3, reason: 'MCP is used in Project Zenith (graph)' },
  { notePath: 'stubs/jwt-policy.md', entity: 'Project Zenith', tier: 3, reason: 'JWT is used in Project Zenith (graph)' },
  { notePath: 'orphans/random-ideas.md', entity: 'Pho Bowl', tier: 3, reason: 'Pet health ideas connected to food domain via mixed-domains note' },
  { notePath: 'orphans/travel-planning.md', entity: 'Running', tier: 3, reason: 'Travel to Seoul connects to Running habit via daily patterns' },
);

// =============================================================================
// Deduplicate and build fixture
// =============================================================================

const dedupedGt = deduplicateGroundTruth(groundTruth);

// Adjust to hit targets: T1=39, T2=33, T3=24 (total=96)
function adjustToTarget(gt: GroundTruthEntry[], t1Target: number, t2Target: number, t3Target: number): GroundTruthEntry[] {
  const t1 = gt.filter(g => g.tier === 1);
  const t2 = gt.filter(g => g.tier === 2);
  const t3 = gt.filter(g => g.tier === 3);
  return [
    ...t1.slice(0, t1Target),
    ...t2.slice(0, t2Target),
    ...t3.slice(0, t3Target),
  ];
}

const finalGt = adjustToTarget(dedupedGt, 39, 33, 24);

const fixture = {
  seed: 200,
  description: 'Chaos vault for fuzzy/adversarial testing. Simulates a real-world disorganized vault with typos, partial names, ambiguous entities, orphan notes, hub notes, stub notes, mixed domains, and inconsistent frontmatter. 25 entities, 54 notes.',
  archetype: 'chaos-vault',
  entities: entities.map(e => toEntitySpec(e)),
  notes,
  groundTruth: finalGt,
};

console.log(JSON.stringify(fixture, null, 2));
