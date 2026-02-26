/**
 * Shared fictional entity pools for test fixture generation.
 *
 * All names are fictional — no overlap with production vault data.
 * Generators import from here to ensure consistent naming across fixtures.
 *
 * Naming conventions:
 * - People: Diverse fictional names (no real production vault people)
 * - Projects: Codename-style (Prism, Helix, Nexus, SkyBridge)
 * - Organizations: Fictional companies (Meridian Labs, Apex Systems)
 * - Technologies: Real tech names (TypeScript, React, etc.) — generic, not personal
 * - Health/habits: Different set from production (Yoga, Swim vs Stretch, Walk)
 * - Animals: Different names from production (Luna, Rex vs Bella, Max)
 * - Locations: Different cities from production (Portland, Zurich vs SF, London)
 */

// =============================================================================
// Types
// =============================================================================

export interface EntityDef {
  name: string;
  category: string;
  aliases: string[];
  hubScore: number;
  folder: string;
}

// =============================================================================
// People (16 — enough for all fixtures)
// =============================================================================

export const PEOPLE: EntityDef[] = [
  { name: 'Nadia Reyes', category: 'people', aliases: ['Nadia', 'NR'], hubScore: 120, folder: 'people' },
  { name: 'Owen Park', category: 'people', aliases: ['Owen', 'OP'], hubScore: 95, folder: 'people' },
  { name: 'Leo Vasquez', category: 'people', aliases: ['Leo'], hubScore: 60, folder: 'people' },
  { name: 'Mira Okonkwo', category: 'people', aliases: ['Mira'], hubScore: 45, folder: 'people' },
  { name: 'Tessa Liu', category: 'people', aliases: ['Tessa'], hubScore: 180, folder: 'people' },
  { name: 'Freya Nakamura', category: 'people', aliases: ['Freya'], hubScore: 30, folder: 'people' },
  { name: 'Dmitri Sokolov', category: 'people', aliases: ['Dmitri'], hubScore: 15, folder: 'people' },
  { name: 'Amara Diallo', category: 'people', aliases: ['Amara'], hubScore: 8, folder: 'people' },
  { name: 'Zara Whitfield', category: 'people', aliases: ['Zara'], hubScore: 3, folder: 'people' },
  { name: 'Kai Lindgren', category: 'people', aliases: ['Kai'], hubScore: 25, folder: 'people' },
  { name: 'Rosa Vega', category: 'people', aliases: ['Rosa', 'RV'], hubScore: 40, folder: 'people' },
  { name: 'Hiroshi Tanaka', category: 'people', aliases: ['Hiroshi'], hubScore: 70, folder: 'people' },
  { name: 'Ines Dufresne', category: 'people', aliases: ['Ines'], hubScore: 25, folder: 'people' },
  { name: 'Soren Eriksson', category: 'people', aliases: ['Soren'], hubScore: 35, folder: 'people' },
  { name: 'Yuki Tanabe', category: 'people', aliases: ['Yuki'], hubScore: 50, folder: 'people' },
  { name: 'Priya Mehta', category: 'people', aliases: ['Priya'], hubScore: 55, folder: 'people' },
];

// =============================================================================
// Projects (20 — codename-style)
// =============================================================================

export const PROJECTS: EntityDef[] = [
  { name: 'NovaSpark', category: 'projects', aliases: ['Nova Spark', 'nova-spark'], hubScore: 200, folder: 'projects' },
  { name: 'DataForge', category: 'projects', aliases: ['Data Forge', 'data-forge'], hubScore: 150, folder: 'projects' },
  { name: 'Prism Core', category: 'projects', aliases: ['prism-core', 'PrismCore'], hubScore: 80, folder: 'projects' },
  { name: 'Project Meridian', category: 'projects', aliases: ['Meridian'], hubScore: 60, folder: 'projects' },
  { name: 'CloudShift', category: 'projects', aliases: ['Cloud Shift'], hubScore: 80, folder: 'projects' },
  { name: 'DevHub', category: 'projects', aliases: ['Dev Hub', 'Developer Hub'], hubScore: 60, folder: 'projects' },
  { name: 'MobileNexus', category: 'projects', aliases: ['Mobile Nexus'], hubScore: 45, folder: 'projects' },
  { name: 'AuthVault', category: 'projects', aliases: ['Auth Vault', 'authentication'], hubScore: 70, folder: 'projects' },
  { name: 'GateKeeper', category: 'projects', aliases: ['Gate Keeper', 'GKPR'], hubScore: 90, folder: 'projects' },
  { name: 'WatchTower', category: 'projects', aliases: ['Watch Tower'], hubScore: 55, folder: 'projects' },
  { name: 'ConfigForge', category: 'projects', aliases: ['Config Forge'], hubScore: 25, folder: 'projects' },
  { name: 'FlowStart', category: 'projects', aliases: ['Flow Start'], hubScore: 35, folder: 'projects' },
  { name: 'PayStream', category: 'projects', aliases: ['Pay Stream'], hubScore: 40, folder: 'projects' },
  { name: 'FinderX', category: 'projects', aliases: ['Finder X'], hubScore: 30, folder: 'projects' },
  { name: 'PipeFlow', category: 'projects', aliases: ['Pipe Flow'], hubScore: 20, folder: 'projects' },
  { name: 'PulseBoard', category: 'projects', aliases: ['Pulse Board'], hubScore: 15, folder: 'projects' },
  { name: 'ShipIt', category: 'projects', aliases: ['Ship It'], hubScore: 10, folder: 'projects' },
  { name: 'Project Zenith', category: 'projects', aliases: ['Zenith'], hubScore: 110, folder: 'projects' },
  { name: 'Bluebird', category: 'projects', aliases: ['Project Bluebird', 'BB'], hubScore: 60, folder: 'projects' },
  { name: 'Saturn Platform', category: 'projects', aliases: ['Saturn'], hubScore: 45, folder: 'projects' },
];

// =============================================================================
// Technologies (12 — real generic names, kept as-is)
// =============================================================================

export const TECHNOLOGIES: EntityDef[] = [
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
];

// =============================================================================
// Organizations (6 — fictional)
// =============================================================================

export const ORGANIZATIONS: EntityDef[] = [
  { name: 'Meridian Labs', category: 'organizations', aliases: ['Meridian', 'Meridian Corp'], hubScore: 160, folder: 'organizations' },
  { name: 'Apex Systems', category: 'organizations', aliases: ['Apex', 'Apex Sys'], hubScore: 40, folder: 'organizations' },
  { name: 'Quantum Data', category: 'organizations', aliases: ['QD', 'quantumdata'], hubScore: 25, folder: 'organizations' },
  { name: 'SkyForge', category: 'organizations', aliases: ['Sky Forge'], hubScore: 15, folder: 'organizations' },
  { name: 'GridPoint Inc', category: 'organizations', aliases: ['GridPoint'], hubScore: 10, folder: 'organizations' },
  { name: 'Neptune Insurance', category: 'organizations', aliases: ['Neptune Ins'], hubScore: 75, folder: 'organizations' },
];

// =============================================================================
// Locations (6 — fictional/different from production)
// =============================================================================

export const LOCATIONS: EntityDef[] = [
  { name: 'Portland', category: 'locations', aliases: ['PDX', 'Rose City'], hubScore: 60, folder: 'locations' },
  { name: 'Zurich', category: 'locations', aliases: ['ZRH'], hubScore: 35, folder: 'locations' },
  { name: 'Melbourne', category: 'locations', aliases: ['MEL'], hubScore: 20, folder: 'locations' },
  { name: 'Toronto', category: 'locations', aliases: ['TO', 'YYZ'], hubScore: 15, folder: 'locations' },
  { name: 'Seoul', category: 'locations', aliases: ['SEL'], hubScore: 25, folder: 'locations' },
  { name: 'Kanto Prefecture', category: 'locations', aliases: ['Kanto'], hubScore: 20, folder: 'locations' },
];

// =============================================================================
// Concepts (12 — generic software/CS concepts)
// =============================================================================

export const CONCEPTS: EntityDef[] = [
  { name: 'Microservices', category: 'concepts', aliases: ['microservice', 'micro-services'], hubScore: 50, folder: 'concepts' },
  { name: 'DevOps', category: 'concepts', aliases: ['devops'], hubScore: 70, folder: 'concepts' },
  { name: 'Agile', category: 'concepts', aliases: ['agile methodology'], hubScore: 45, folder: 'concepts' },
  { name: 'Clean Architecture', category: 'concepts', aliases: ['clean arch'], hubScore: 20, folder: 'concepts' },
  { name: 'Observability', category: 'concepts', aliases: ['o11y'], hubScore: 55, folder: 'concepts' },
  { name: 'API-First', category: 'concepts', aliases: ['API First', 'api-first design'], hubScore: 25, folder: 'concepts' },
  { name: 'Machine Learning', category: 'concepts', aliases: ['ML', 'machine learning'], hubScore: 70, folder: 'concepts' },
  { name: 'Continuous Integration', category: 'concepts', aliases: ['CI', 'continuous integration'], hubScore: 40, folder: 'concepts' },
  { name: 'Technical Debt', category: 'concepts', aliases: ['tech debt'], hubScore: 35, folder: 'concepts' },
  { name: 'Event Sourcing', category: 'concepts', aliases: ['event-sourcing'], hubScore: 30, folder: 'concepts' },
  { name: 'Domain Driven Design', category: 'concepts', aliases: ['DDD'], hubScore: 20, folder: 'concepts' },
  { name: 'Zero Trust', category: 'concepts', aliases: ['zero-trust'], hubScore: 15, folder: 'concepts' },
];

// =============================================================================
// Health / Habits (6 — daily-note hub entities)
// =============================================================================

export const HEALTH: EntityDef[] = [
  { name: 'Yoga', category: 'health', aliases: ['yoga practice', 'morning yoga'], hubScore: 520, folder: 'health' },
  { name: 'Swim', category: 'health', aliases: ['swimming', 'daily swim'], hubScore: 480, folder: 'health' },
  { name: 'Supplements', category: 'health', aliases: ['vitamins', 'daily supplements'], hubScore: 450, folder: 'health' },
  { name: 'Breathwork', category: 'health', aliases: ['breathing exercises', 'mindful breathing'], hubScore: 300, folder: 'health' },
  { name: 'Running', category: 'health', aliases: ['morning run', 'jogging'], hubScore: 350, folder: 'health' },
  { name: 'Sketching', category: 'health', aliases: ['sketch practice', 'drawing'], hubScore: 200, folder: 'health' },
];

// =============================================================================
// Acronyms / Short codes (8 — high FP collision pressure)
// =============================================================================

export const ACRONYMS: EntityDef[] = [
  { name: 'Staging', category: 'acronyms', aliases: ['stg', 'STG'], hubScore: 30, folder: 'acronyms' },
  { name: 'Production', category: 'acronyms', aliases: ['prd', 'PRD', 'prod'], hubScore: 35, folder: 'acronyms' },
  { name: 'UAT', category: 'acronyms', aliases: ['uat', 'User Acceptance Testing'], hubScore: 20, folder: 'acronyms' },
  { name: 'MCP', category: 'acronyms', aliases: ['mcp', 'Model Context Protocol'], hubScore: 40, folder: 'acronyms' },
  { name: 'SDK', category: 'acronyms', aliases: ['sdk', 'software development kit'], hubScore: 15, folder: 'acronyms' },
  { name: 'SLA', category: 'acronyms', aliases: ['sla', 'Service Level Agreement'], hubScore: 25, folder: 'acronyms' },
  { name: 'JWT', category: 'acronyms', aliases: ['jwt', 'JSON Web Token'], hubScore: 10, folder: 'acronyms' },
  { name: 'RAG', category: 'acronyms', aliases: ['rag', 'Retrieval Augmented Generation'], hubScore: 30, folder: 'acronyms' },
];

// =============================================================================
// Other / workflow (20 — largest uncategorizable bucket)
// =============================================================================

export const OTHER: EntityDef[] = [
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
// Animals (3)
// =============================================================================

export const ANIMALS: EntityDef[] = [
  { name: 'Luna', category: 'animals', aliases: ['Luna the cat'], hubScore: 20, folder: 'animals' },
  { name: 'Rex', category: 'animals', aliases: ['Rex the dog'], hubScore: 15, folder: 'animals' },
  { name: 'Pepper', category: 'animals', aliases: ['Pepper the parrot'], hubScore: 10, folder: 'animals' },
];

// =============================================================================
// Media (3)
// =============================================================================

export const MEDIA: EntityDef[] = [
  { name: 'Signal Patterns', category: 'media', aliases: ['Signal Patterns podcast'], hubScore: 20, folder: 'media' },
  { name: 'Code Breakers', category: 'media', aliases: ['Code Breakers book'], hubScore: 15, folder: 'media' },
  { name: 'The Daily Build', category: 'media', aliases: ['Daily Build newsletter'], hubScore: 10, folder: 'media' },
];

// =============================================================================
// Events (2)
// =============================================================================

export const EVENTS: EntityDef[] = [
  { name: 'DevCon 2026', category: 'events', aliases: ['DevCon'], hubScore: 30, folder: 'events' },
  { name: 'Hackathon Spring', category: 'events', aliases: ['Spring Hackathon'], hubScore: 20, folder: 'events' },
];

// =============================================================================
// Documents (9)
// =============================================================================

export const DOCUMENTS: EntityDef[] = [
  { name: 'Q1 Review', category: 'documents', aliases: ['quarterly review'], hubScore: 25, folder: 'documents' },
  { name: 'Architecture RFC', category: 'documents', aliases: ['arch RFC'], hubScore: 20, folder: 'documents' },
  { name: 'Onboarding Guide', category: 'documents', aliases: ['onboarding doc'], hubScore: 15, folder: 'documents' },
  { name: 'Security Audit', category: 'documents', aliases: ['sec audit'], hubScore: 18, folder: 'documents' },
  { name: 'Migration Plan', category: 'documents', aliases: ['migration doc'], hubScore: 22, folder: 'documents' },
  { name: 'API Spec', category: 'documents', aliases: ['api specification'], hubScore: 20, folder: 'documents' },
  { name: 'Runbook Template', category: 'documents', aliases: ['runbook tmpl'], hubScore: 12, folder: 'documents' },
  { name: 'Incident Playbook', category: 'documents', aliases: ['incident doc'], hubScore: 16, folder: 'documents' },
  { name: 'Performance Report', category: 'documents', aliases: ['perf report'], hubScore: 14, folder: 'documents' },
];

// =============================================================================
// Finance (2)
// =============================================================================

export const FINANCE: EntityDef[] = [
  { name: 'Q1 Budget', category: 'finance', aliases: ['quarterly budget'], hubScore: 20, folder: 'finance' },
  { name: 'Expense Report', category: 'finance', aliases: ['expenses'], hubScore: 15, folder: 'finance' },
];

// =============================================================================
// Food (2)
// =============================================================================

export const FOOD: EntityDef[] = [
  { name: 'Pho Bowl', category: 'food', aliases: ['pho'], hubScore: 10, folder: 'food' },
  { name: 'Matcha Latte', category: 'food', aliases: ['matcha'], hubScore: 8, folder: 'food' },
];

// =============================================================================
// Hobbies (2)
// =============================================================================

export const HOBBIES: EntityDef[] = [
  { name: 'Rock Climbing', category: 'hobbies', aliases: ['climbing', 'bouldering'], hubScore: 20, folder: 'hobbies' },
  { name: 'Board Games', category: 'hobbies', aliases: ['tabletop games'], hubScore: 15, folder: 'hobbies' },
];

// =============================================================================
// Utility: slugify, pick, shuffle, PRNG
// =============================================================================

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** Seeded PRNG (mulberry32) */
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function shuffle<T>(rng: () => number, arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Build entity path from folder and name.
 */
export function entityPath(entity: EntityDef): string {
  return `${entity.folder}/${slugify(entity.name)}.md`;
}

/**
 * Make a GroundTruthSpec-compatible entity entry.
 */
export function toEntitySpec(entity: EntityDef) {
  return {
    name: entity.name,
    category: entity.category,
    path: entityPath(entity),
    aliases: entity.aliases,
    hubScore: entity.hubScore,
  };
}

// =============================================================================
// All pools indexed by category
// =============================================================================

export const ALL_POOLS: Record<string, EntityDef[]> = {
  people: PEOPLE,
  projects: PROJECTS,
  technologies: TECHNOLOGIES,
  organizations: ORGANIZATIONS,
  locations: LOCATIONS,
  concepts: CONCEPTS,
  health: HEALTH,
  acronyms: ACRONYMS,
  other: OTHER,
  animals: ANIMALS,
  media: MEDIA,
  events: EVENTS,
  documents: DOCUMENTS,
  finance: FINANCE,
  food: FOOD,
  hobbies: HOBBIES,
};
