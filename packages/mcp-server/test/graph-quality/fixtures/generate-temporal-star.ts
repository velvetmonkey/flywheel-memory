#!/usr/bin/env npx tsx
/**
 * Generate the temporal-star fixture — a production-representative test vault.
 *
 * Key characteristics modeled from actual production vault:
 * - Star topology: daily notes hub to many entities
 * - Skewed entity distribution (30% "other", habit hubs with 500+ score)
 * - Short cryptic codes (stg, prd, uat, api) for FP collision pressure
 * - 50% daily notes, 30% content notes, 20% entity notes
 * - ~97% link-orphan rate (only a few notes have outbound wikilinks)
 * - 80+ ground truth links across 3 tiers
 *
 * Usage: npx tsx generate-temporal-star.ts > temporal-star.json
 */

// Seeded PRNG (mulberry32)
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function shuffle<T>(rng: () => number, arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// =============================================================================
// Entity definitions (production-like distribution)
// =============================================================================

interface EntityDef {
  name: string;
  category: string;
  aliases: string[];
  hubScore: number;
  folder: string;
}

const entities: EntityDef[] = [
  // --- People (8) ---
  { name: 'Sarah Kim', category: 'people', aliases: ['Sarah'], hubScore: 120, folder: 'people' },
  { name: 'David Chen', category: 'people', aliases: ['David', 'DC'], hubScore: 95, folder: 'people' },
  { name: 'Marcus Johnson', category: 'people', aliases: ['Marcus', 'MJ'], hubScore: 60, folder: 'people' },
  { name: 'Elena Torres', category: 'people', aliases: ['Elena'], hubScore: 45, folder: 'people' },
  { name: 'James Franklin', category: 'people', aliases: ['James'], hubScore: 180, folder: 'people' },
  { name: 'Aisha Patel', category: 'people', aliases: ['Aisha'], hubScore: 30, folder: 'people' },
  { name: 'Carlos Rivera', category: 'people', aliases: ['Carlos'], hubScore: 15, folder: 'people' },
  { name: 'Lisa Wong', category: 'people', aliases: ['Lisa'], hubScore: 8, folder: 'people' },

  // --- Projects (15) ---
  { name: 'ESGHub', category: 'projects', aliases: ['ESG Hub'], hubScore: 200, folder: 'projects' },
  { name: 'DataPipeline', category: 'projects', aliases: ['Data Pipeline', 'data-pipeline'], hubScore: 150, folder: 'projects' },
  { name: 'CloudMigration', category: 'projects', aliases: ['Cloud Migration'], hubScore: 80, folder: 'projects' },
  { name: 'DevPortal', category: 'projects', aliases: ['Dev Portal', 'Developer Portal'], hubScore: 60, folder: 'projects' },
  { name: 'MobileApp', category: 'projects', aliases: ['Mobile App'], hubScore: 45, folder: 'projects' },
  { name: 'AuthService', category: 'projects', aliases: ['Auth Service', 'authentication'], hubScore: 70, folder: 'projects' },
  { name: 'APIGateway', category: 'projects', aliases: ['API Gateway', 'APIG'], hubScore: 90, folder: 'projects' },
  { name: 'MonitoringStack', category: 'projects', aliases: ['Monitoring Stack'], hubScore: 55, folder: 'projects' },
  { name: 'ConfigManager', category: 'projects', aliases: ['Config Manager'], hubScore: 25, folder: 'projects' },
  { name: 'UserOnboarding', category: 'projects', aliases: ['User Onboarding'], hubScore: 35, folder: 'projects' },
  { name: 'PaymentProcessor', category: 'projects', aliases: ['Payment Processor'], hubScore: 40, folder: 'projects' },
  { name: 'SearchEngine', category: 'projects', aliases: ['Search Engine'], hubScore: 30, folder: 'projects' },
  { name: 'WorkflowEngine', category: 'projects', aliases: ['Workflow Engine'], hubScore: 20, folder: 'projects' },
  { name: 'TeamDashboard', category: 'projects', aliases: ['Team Dashboard'], hubScore: 15, folder: 'projects' },
  { name: 'ReleaseManager', category: 'projects', aliases: ['Release Manager'], hubScore: 10, folder: 'projects' },

  // --- Technologies (12) ---
  { name: 'React', category: 'technologies', aliases: ['ReactJS', 'React.js'], hubScore: 100, folder: 'technologies' },
  { name: 'TypeScript', category: 'technologies', aliases: ['TS'], hubScore: 130, folder: 'technologies' },
  { name: 'Python', category: 'technologies', aliases: ['python3', 'py'], hubScore: 80, folder: 'technologies' },
  { name: 'Docker', category: 'technologies', aliases: ['docker', 'container'], hubScore: 70, folder: 'technologies' },
  { name: 'Kubernetes', category: 'technologies', aliases: ['k8s', 'K8s'], hubScore: 65, folder: 'technologies' },
  { name: 'PostgreSQL', category: 'technologies', aliases: ['Postgres', 'psql'], hubScore: 55, folder: 'technologies' },
  { name: 'Redis', category: 'technologies', aliases: ['redis'], hubScore: 40, folder: 'technologies' },
  { name: 'GraphQL', category: 'technologies', aliases: ['graphql', 'GQL'], hubScore: 35, folder: 'technologies' },
  { name: 'Node.js', category: 'technologies', aliases: ['NodeJS', 'node'], hubScore: 90, folder: 'technologies' },
  { name: 'Terraform', category: 'technologies', aliases: ['TF', 'terraform'], hubScore: 50, folder: 'technologies' },
  { name: 'AWS', category: 'technologies', aliases: ['Amazon Web Services'], hubScore: 110, folder: 'technologies' },
  { name: 'Kafka', category: 'technologies', aliases: ['Apache Kafka', 'kafka'], hubScore: 45, folder: 'technologies' },

  // --- Organizations (5) ---
  { name: 'Acme Corp', category: 'organizations', aliases: ['Acme', 'Acme Corporation'], hubScore: 160, folder: 'organizations' },
  { name: 'TechVentures', category: 'organizations', aliases: ['Tech Ventures', 'TV'], hubScore: 40, folder: 'organizations' },
  { name: 'DataCo', category: 'organizations', aliases: ['Data Co', 'dataco'], hubScore: 25, folder: 'organizations' },
  { name: 'CloudFirst', category: 'organizations', aliases: ['Cloud First'], hubScore: 15, folder: 'organizations' },
  { name: 'NetOps Inc', category: 'organizations', aliases: ['NetOps'], hubScore: 10, folder: 'organizations' },

  // --- Locations (4) ---
  { name: 'San Francisco', category: 'locations', aliases: ['SF', 'Bay Area'], hubScore: 60, folder: 'locations' },
  { name: 'London', category: 'locations', aliases: ['LDN'], hubScore: 35, folder: 'locations' },
  { name: 'Berlin', category: 'locations', aliases: [], hubScore: 20, folder: 'locations' },
  { name: 'Singapore', category: 'locations', aliases: ['SG'], hubScore: 15, folder: 'locations' },

  // --- Concepts (6) ---
  { name: 'Microservices', category: 'concepts', aliases: ['microservice', 'micro-services'], hubScore: 50, folder: 'concepts' },
  { name: 'DevOps', category: 'concepts', aliases: ['devops'], hubScore: 70, folder: 'concepts' },
  { name: 'Agile', category: 'concepts', aliases: ['agile methodology'], hubScore: 45, folder: 'concepts' },
  { name: 'Clean Architecture', category: 'concepts', aliases: ['clean arch'], hubScore: 20, folder: 'concepts' },
  { name: 'Observability', category: 'concepts', aliases: ['o11y'], hubScore: 55, folder: 'concepts' },
  { name: 'API-First', category: 'concepts', aliases: ['API First', 'api-first design'], hubScore: 25, folder: 'concepts' },

  // --- Health/Habits (6) — daily-note hub entities ---
  { name: 'Stretch', category: 'health', aliases: ['stretching', 'morning stretch'], hubScore: 520, folder: 'health' },
  { name: 'Walk', category: 'health', aliases: ['walking', 'daily walk'], hubScore: 480, folder: 'health' },
  { name: 'Water', category: 'health', aliases: ['hydration', 'water intake'], hubScore: 450, folder: 'health' },
  { name: 'Meditation', category: 'health', aliases: ['meditate', 'mindfulness'], hubScore: 300, folder: 'health' },
  { name: 'Exercise', category: 'health', aliases: ['workout', 'gym'], hubScore: 350, folder: 'health' },
  { name: 'Journaling', category: 'health', aliases: ['journal', 'morning pages'], hubScore: 200, folder: 'health' },

  // --- Acronyms / Short codes (8) — high FP collision pressure ---
  { name: 'Staging', category: 'acronyms', aliases: ['stg', 'STG'], hubScore: 30, folder: 'acronyms' },
  { name: 'Production', category: 'acronyms', aliases: ['prd', 'PRD', 'prod'], hubScore: 35, folder: 'acronyms' },
  { name: 'UAT', category: 'acronyms', aliases: ['uat', 'User Acceptance Testing'], hubScore: 20, folder: 'acronyms' },
  { name: 'MCP', category: 'acronyms', aliases: ['mcp', 'Model Context Protocol'], hubScore: 40, folder: 'acronyms' },
  { name: 'SDK', category: 'acronyms', aliases: ['sdk', 'software development kit'], hubScore: 15, folder: 'acronyms' },
  { name: 'SLA', category: 'acronyms', aliases: ['sla', 'Service Level Agreement'], hubScore: 25, folder: 'acronyms' },
  { name: 'JWT', category: 'acronyms', aliases: ['jwt', 'JSON Web Token'], hubScore: 10, folder: 'acronyms' },
  { name: 'RAG', category: 'acronyms', aliases: ['rag', 'Retrieval Augmented Generation'], hubScore: 30, folder: 'acronyms' },

  // --- Other (20) — largest uncategorizable bucket ---
  { name: 'standup', category: 'other', aliases: ['daily standup', 'stand-up'], hubScore: 400, folder: 'other' },
  { name: 'retro', category: 'other', aliases: ['retrospective', 'sprint retro'], hubScore: 180, folder: 'other' },
  { name: 'one-on-one', category: 'other', aliases: ['1:1', '1-on-1'], hubScore: 150, folder: 'other' },
  { name: 'code review', category: 'other', aliases: ['CR', 'code-review', 'PR review'], hubScore: 250, folder: 'other' },
  { name: 'architecture decision', category: 'other', aliases: ['ADR', 'arch decision'], hubScore: 40, folder: 'other' },
  { name: 'tech debt', category: 'other', aliases: ['technical debt', 'tech-debt'], hubScore: 60, folder: 'other' },
  { name: 'on-call', category: 'other', aliases: ['oncall', 'on call'], hubScore: 80, folder: 'other' },
  { name: 'incident', category: 'other', aliases: ['outage', 'SEV'], hubScore: 70, folder: 'other' },
  { name: 'deployment', category: 'other', aliases: ['deploy', 'release deploy'], hubScore: 120, folder: 'other' },
  { name: 'sprint', category: 'other', aliases: ['sprint cycle', 'iteration'], hubScore: 200, folder: 'other' },
  { name: 'backlog', category: 'other', aliases: ['product backlog', 'backlog grooming'], hubScore: 90, folder: 'other' },
  { name: 'demo', category: 'other', aliases: ['sprint demo', 'showcase'], hubScore: 100, folder: 'other' },
  { name: 'planning', category: 'other', aliases: ['sprint planning', 'capacity planning'], hubScore: 130, folder: 'other' },
  { name: 'documentation', category: 'other', aliases: ['docs', 'technical docs'], hubScore: 50, folder: 'other' },
  { name: 'onboarding', category: 'other', aliases: ['new hire', 'ramp-up'], hubScore: 30, folder: 'other' },
  { name: 'postmortem', category: 'other', aliases: ['post-mortem', 'incident review'], hubScore: 35, folder: 'other' },
  { name: 'feature flag', category: 'other', aliases: ['feature toggle', 'FF'], hubScore: 20, folder: 'other' },
  { name: 'canary release', category: 'other', aliases: ['canary deploy', 'canary'], hubScore: 15, folder: 'other' },
  { name: 'load test', category: 'other', aliases: ['load testing', 'perf test'], hubScore: 25, folder: 'other' },
  { name: 'chaos engineering', category: 'other', aliases: ['chaos monkey', 'chaos test'], hubScore: 10, folder: 'other' },
];

// =============================================================================
// Note templates
// =============================================================================

interface NoteDef {
  path: string;
  title: string;
  frontmatter?: Record<string, unknown>;
  content: string;
  links: string[];
  folder: string;
}

interface GroundTruthEntry {
  notePath: string;
  entity: string;
  tier: 1 | 2 | 3;
  reason: string;
}

const rng = mulberry32(2026);

// Templates for daily notes. Each template uses {ENTITY} placeholders
// that get filled with specific entity names. Only some entities get
// wikilink brackets — modeling the 97% orphan pattern.
const dailyHabitLines = [
  'Did my morning {Stretch} routine',
  'Went for a {Walk} around the block',
  'Drank plenty of {Water} today',
  '{Meditation} session before work',
  '{Exercise} at the gym this evening',
  'Wrote in my {Journaling} notebook',
];

const dailyWorkSnippets = [
  'Reviewed PR for {project}. {person} had some good feedback on the {tech} migration.',
  'Deployed {project} to {env}. {person} confirmed it looks good in {env}.',
  '{person} and I discussed the {concept} approach for {project}.',
  'Sprint {event} went well. Prioritized {project} tickets for next week.',
  'Fixed a bug in {project} related to {tech} connection pooling.',
  'Paired with {person} on {project} {tech} refactoring.',
  'Attended {event} with the team. {person} presented {project} roadmap.',
  'Updated {docs} for {project} deployment process.',
  '{person} flagged an {incident} in {project}. Quick {tech} fix applied.',
  'Ran {test} on {project} before the {env} deployment.',
];

function generateDailyNote(
  dayOffset: number,
  habitEntities: EntityDef[],
  workEntities: { projects: EntityDef[]; people: EntityDef[]; techs: EntityDef[]; envs: EntityDef[]; events: EntityDef[]; concepts: EntityDef[]; docs: EntityDef[]; tests: EntityDef[] },
  linkedEntities: Set<string>,
): { note: NoteDef; groundTruth: GroundTruthEntry[] } {
  const date = new Date(2026, 0, 1 + dayOffset);
  const dateStr = date.toISOString().split('T')[0];
  const path = `daily-notes/${dateStr}.md`;

  const lines: string[] = [];
  const links: string[] = [];
  const gt: GroundTruthEntry[] = [];

  // Habits section (3-5 habits per day)
  const numHabits = 3 + Math.floor(rng() * 3);
  const todayHabits = shuffle(rng, habitEntities).slice(0, numHabits);
  lines.push('## Habits');
  for (const habit of todayHabits) {
    const line = dailyHabitLines.find(l => l.includes(`{${habit.name}}`));
    if (line) {
      // Only ~3% of notes have wikilinks (modeling 97% orphan rate)
      const useLink = linkedEntities.has(habit.name);
      if (useLink) {
        lines.push(`- ${line.replace(`{${habit.name}}`, `[[${habit.name}]]`)}`);
        links.push(habit.name);
      } else {
        lines.push(`- ${line.replace(`{${habit.name}}`, habit.name)}`);
        // Ground truth: entity name appears verbatim
        gt.push({ notePath: path, entity: habit.name, tier: 1, reason: `Entity name ${habit.name} appears verbatim in daily habit` });
      }
    }
  }

  // Work section (2-4 work items)
  const numWork = 2 + Math.floor(rng() * 3);
  lines.push('');
  lines.push('## Work');
  for (let i = 0; i < numWork; i++) {
    const template = pick(rng, dailyWorkSnippets);
    const project = pick(rng, workEntities.projects);
    const person = pick(rng, workEntities.people);
    const tech = pick(rng, workEntities.techs);
    const env = pick(rng, workEntities.envs);
    const event = pick(rng, workEntities.events);
    const concept = pick(rng, workEntities.concepts);
    const docs = pick(rng, workEntities.docs);
    const test = pick(rng, workEntities.tests);

    let line = template
      .replace('{project}', project.name)
      .replace('{person}', person.name)
      .replace('{tech}', tech.name)
      .replace('{env}', pick(rng, env.aliases.length > 0 ? env.aliases : [env.name]))
      .replace('{event}', pick(rng, event.aliases.length > 0 ? [event.name, ...event.aliases] : [event.name]))
      .replace('{concept}', concept.name)
      .replace('{docs}', docs.name)
      .replace('{incident}', 'incident')
      .replace('{test}', test.name);

    lines.push(line);

    // Add ground truth for entities mentioned in this line (tier 1 = verbatim match)
    if (line.includes(project.name) && !links.includes(project.name)) {
      gt.push({ notePath: path, entity: project.name, tier: 1, reason: `Entity ${project.name} appears verbatim in work section` });
    }
    if (line.includes(person.name) && !links.includes(person.name)) {
      gt.push({ notePath: path, entity: person.name, tier: 1, reason: `Entity ${person.name} appears verbatim in work section` });
    }
  }

  return {
    note: { path, title: dateStr, frontmatter: { type: 'daily' }, content: lines.join('\n'), links, folder: 'daily-notes' },
    groundTruth: gt,
  };
}

function generateContentNote(
  index: number,
  noteType: 'meeting' | 'project-doc' | 'tech-guide' | 'runbook',
  relevantEntities: EntityDef[],
  linkedEntities: Set<string>,
): { note: NoteDef; groundTruth: GroundTruthEntry[] } {
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  const templates: Record<string, { folder: string; titlePrefix: string; bodyTemplate: (ents: EntityDef[]) => string }> = {
    meeting: {
      folder: 'meetings',
      titlePrefix: 'Meeting Notes',
      bodyTemplate: (ents) => {
        const [p1, p2] = ents.filter(e => e.category === 'people');
        const project = ents.find(e => e.category === 'projects');
        const tech = ents.find(e => e.category === 'technologies');
        return [
          `# Meeting: ${project?.name || 'Team Sync'}`,
          '',
          `Attendees: ${p1?.name || 'team'}, ${p2?.name || 'stakeholders'}`,
          '',
          '## Discussion',
          `Discussed progress on ${project?.name || 'the project'}. The team is evaluating ${tech?.name || 'new tooling'} for the backend migration.`,
          '',
          `${p1?.name || 'Lead'} raised concerns about the ${ents.find(e => e.category === 'concepts')?.name || 'architecture'} approach.`,
          `${p2?.name || 'PM'} confirmed the timeline aligns with the ${ents.find(e => e.category === 'other')?.name || 'sprint'} goals.`,
          '',
          '## Action Items',
          `- ${p1?.name || 'Team'} to prototype ${tech?.name || 'solution'} integration`,
          `- Review ${ents.find(e => e.category === 'acronyms')?.name || 'SLA'} requirements`,
        ].join('\n');
      },
    },
    'project-doc': {
      folder: 'projects',
      titlePrefix: 'Project Doc',
      bodyTemplate: (ents) => {
        const project = ents.find(e => e.category === 'projects');
        const techs = ents.filter(e => e.category === 'technologies').slice(0, 3);
        const person = ents.find(e => e.category === 'people');
        return [
          `# ${project?.name || 'Project'} Technical Overview`,
          '',
          `## Stack`,
          `Built on ${techs.map(t => t.name).join(', ') || 'modern tools'}. Deployed to ${ents.find(e => e.category === 'acronyms')?.aliases[0] || 'production'}.`,
          '',
          `## Architecture`,
          `Uses ${ents.find(e => e.category === 'concepts')?.name || 'microservices'} pattern. ${person?.name || 'Lead'} designed the initial ${ents.find(e => e.category === 'other')?.name || 'deployment'} pipeline.`,
          '',
          `Integrates with ${ents.find(e => e.category === 'organizations')?.name || 'partner'} APIs via ${ents.find(e => e.category === 'projects' && e !== project)?.name || 'gateway'}.`,
        ].join('\n');
      },
    },
    'tech-guide': {
      folder: 'tech-guides',
      titlePrefix: 'Guide',
      bodyTemplate: (ents) => {
        const tech = ents.find(e => e.category === 'technologies');
        const tech2 = ents.filter(e => e.category === 'technologies')[1];
        return [
          `# ${tech?.name || 'Technology'} Best Practices`,
          '',
          `## Overview`,
          `${tech?.name || 'This technology'} is used across several projects including ${ents.find(e => e.category === 'projects')?.name || 'our main app'}.`,
          '',
          `## Integration with ${tech2?.name || 'Other Tools'}`,
          `When combining ${tech?.name || 'this'} with ${tech2?.name || 'that'}, follow the ${ents.find(e => e.category === 'concepts')?.name || 'established'} patterns.`,
          '',
          `${ents.find(e => e.category === 'people')?.name || 'The team'} documented the ${ents.find(e => e.category === 'other')?.name || 'setup'} process.`,
        ].join('\n');
      },
    },
    runbook: {
      folder: 'runbooks',
      titlePrefix: 'Runbook',
      bodyTemplate: (ents) => {
        const project = ents.find(e => e.category === 'projects');
        const env = ents.find(e => e.category === 'acronyms');
        return [
          `# ${project?.name || 'Service'} Runbook`,
          '',
          `## Deployment`,
          `Deploy to ${env?.aliases[0] || 'staging'} first, then promote to ${ents.find(e => e.category === 'acronyms' && e !== env)?.aliases[0] || 'production'}.`,
          '',
          `## Monitoring`,
          `Check ${ents.find(e => e.category === 'technologies')?.name || 'dashboards'} for ${ents.find(e => e.category === 'concepts')?.name || 'metrics'}.`,
          `Contact ${ents.find(e => e.category === 'people')?.name || 'on-call'} for escalations.`,
          '',
          `## Recovery`,
          `If ${ents.find(e => e.category === 'other')?.name || 'incident'} occurs, follow ${ents.find(e => e.category === 'other')?.name || 'postmortem'} process.`,
        ].join('\n');
      },
    },
  };

  const tmpl = templates[noteType];
  const shuffled = shuffle(rng, relevantEntities);
  const title = `${tmpl.titlePrefix} ${index + 1}`;
  const path = `${tmpl.folder}/${slugify(title)}.md`;
  let content = tmpl.bodyTemplate(shuffled);

  const links: string[] = [];
  const gt: GroundTruthEntry[] = [];

  // Add wikilinks for a few entities (only in linked notes — ~3%)
  for (const ent of shuffled.slice(0, 6)) {
    if (content.includes(ent.name)) {
      if (linkedEntities.has(ent.name) && rng() < 0.3) {
        content = content.replace(ent.name, `[[${ent.name}]]`);
        links.push(ent.name);
      } else {
        gt.push({ notePath: path, entity: ent.name, tier: 1, reason: `Entity ${ent.name} mentioned verbatim` });
      }
    }
  }

  // Add tier 2 ground truth for alias matches
  for (const ent of shuffled) {
    for (const alias of ent.aliases) {
      if (content.includes(alias) && !content.includes(`[[${alias}]]`) && !content.includes(`[[${ent.name}]]`)) {
        gt.push({ notePath: path, entity: ent.name, tier: 2, reason: `Alias "${alias}" matches entity ${ent.name}` });
        break;
      }
    }
  }

  return {
    note: { path, title, content, links, folder: tmpl.folder },
    groundTruth: gt,
  };
}

function generateEntityNote(entity: EntityDef, relatedEntities: EntityDef[]): NoteDef {
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const related = shuffle(rng, relatedEntities).slice(0, 3);

  const lines = [
    `# ${entity.name}`,
    '',
  ];

  if (entity.category === 'people') {
    lines.push(`${entity.name} is a team member at ${related.find(e => e.category === 'organizations')?.name || 'Acme Corp'}.`);
    lines.push(`Works on ${related.find(e => e.category === 'projects')?.name || 'various projects'} using ${related.find(e => e.category === 'technologies')?.name || 'modern tech'}.`);
  } else if (entity.category === 'projects') {
    lines.push(`${entity.name} is an internal project.`);
    lines.push(`Built with ${related.filter(e => e.category === 'technologies').map(e => e.name).join(', ') || 'various technologies'}.`);
  } else if (entity.category === 'health') {
    lines.push(`Daily habit: ${entity.name}.`);
    if (entity.aliases.length > 0) {
      lines.push(`Also known as: ${entity.aliases.join(', ')}.`);
    }
  } else {
    lines.push(`${entity.name} — ${entity.category}.`);
  }

  const frontmatter: Record<string, unknown> = { type: entity.category };
  if (entity.aliases.length > 0) {
    frontmatter.aliases = entity.aliases;
  }

  return {
    path: `${entity.folder}/${slugify(entity.name)}.md`,
    title: entity.name,
    frontmatter,
    content: lines.join('\n'),
    links: [],
    folder: entity.folder,
  };
}

// =============================================================================
// Generate fixture
// =============================================================================

function generate() {
  const notes: NoteDef[] = [];
  const groundTruth: GroundTruthEntry[] = [];

  // Decide which entities get wikilinks (only ~3% of notes have links)
  // We make 3 "well-linked" daily notes and 2 "well-linked" content notes
  const linkedEntityNames = new Set<string>();
  // A few habit entities get links in 2-3 daily notes
  linkedEntityNames.add('Stretch');
  linkedEntityNames.add('Walk');
  // A couple of project/tech entities get links in content notes
  linkedEntityNames.add('ESGHub');
  linkedEntityNames.add('TypeScript');

  // Entity pools for content generation
  const byCategory = (cat: string) => entities.filter(e => e.category === cat);
  const workEntities = {
    projects: byCategory('projects'),
    people: byCategory('people'),
    techs: byCategory('technologies'),
    envs: byCategory('acronyms').filter(e => ['Staging', 'Production', 'UAT'].includes(e.name)),
    events: byCategory('other').filter(e => ['standup', 'retro', 'demo', 'planning', 'sprint'].includes(e.name)),
    concepts: byCategory('concepts'),
    docs: byCategory('other').filter(e => ['documentation', 'postmortem'].includes(e.name)),
    tests: byCategory('other').filter(e => ['load test', 'chaos engineering'].includes(e.name)),
  };

  // --- Daily notes (50) ---
  for (let i = 0; i < 50; i++) {
    // Only first 2 daily notes have any wikilinks
    const linkedForThisNote = i < 2 ? linkedEntityNames : new Set<string>();
    const result = generateDailyNote(i, byCategory('health'), workEntities, linkedForThisNote);
    notes.push(result.note);
    groundTruth.push(...result.groundTruth);
  }

  // --- Content notes (30) ---
  const contentTypes: Array<'meeting' | 'project-doc' | 'tech-guide' | 'runbook'> = [
    'meeting', 'meeting', 'meeting', 'meeting', 'meeting',
    'meeting', 'meeting', 'meeting', 'meeting', 'meeting',
    'project-doc', 'project-doc', 'project-doc', 'project-doc', 'project-doc',
    'project-doc', 'project-doc', 'project-doc',
    'tech-guide', 'tech-guide', 'tech-guide', 'tech-guide', 'tech-guide',
    'tech-guide',
    'runbook', 'runbook', 'runbook', 'runbook', 'runbook', 'runbook',
  ];

  for (let i = 0; i < contentTypes.length; i++) {
    // Only content note #0 and #5 get any wikilinks
    const linked = (i === 0 || i === 5) ? linkedEntityNames : new Set<string>();
    const result = generateContentNote(i, contentTypes[i], entities, linked);
    notes.push(result.note);
    groundTruth.push(...result.groundTruth);
  }

  // --- Entity notes (one per entity) ---
  for (const entity of entities) {
    const related = entities.filter(e => e !== entity);
    notes.push(generateEntityNote(entity, related));
  }

  // Deduplicate ground truth (same notePath + entity)
  const gtKey = (g: GroundTruthEntry) => `${g.notePath}::${g.entity.toLowerCase()}`;
  const seen = new Set<string>();
  const uniqueGt = groundTruth.filter(g => {
    const k = gtKey(g);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Limit ground truth to entries where the entity actually appears in the note
  const noteContentMap = new Map(notes.map(n => [n.path, n.content]));
  const validGt = uniqueGt.filter(g => {
    const content = noteContentMap.get(g.notePath);
    if (!content) return false;
    const entity = entities.find(e => e.name.toLowerCase() === g.entity.toLowerCase());
    if (!entity) return false;
    // Check entity name or any alias appears in content
    if (content.includes(entity.name)) return true;
    return entity.aliases.some(a => content.includes(a));
  });

  const fixture = {
    seed: 2026,
    description: 'Production-representative temporal-star vault. 50% daily notes, skewed entity distribution, short codes, habit hubs, high orphan rate.',
    archetype: 'temporal-star',
    entities: entities.map(e => ({
      name: e.name,
      category: e.category,
      path: `${e.folder}/${e.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}.md`,
      aliases: e.aliases,
      hubScore: e.hubScore,
    })),
    notes,
    groundTruth: validGt,
  };

  console.log(JSON.stringify(fixture, null, 2));
}

generate();
