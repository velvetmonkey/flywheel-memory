/**
 * Note content generation with realistic text patterns
 */

import type { GeneratedEntity, EntityType } from '../types.js';

// Domain-specific vocabulary for realistic content
const DOMAIN_VOCAB = {
  verbs: [
    'discussed', 'reviewed', 'analyzed', 'completed', 'started', 'planned',
    'implemented', 'tested', 'deployed', 'documented', 'researched', 'designed',
    'refactored', 'debugged', 'optimized', 'merged', 'released', 'scheduled',
    'organized', 'presented', 'coordinated', 'evaluated', 'prototyped', 'validated'
  ],
  topics: [
    'architecture', 'performance', 'security', 'testing', 'deployment',
    'documentation', 'refactoring', 'optimization', 'integration', 'migration',
    'monitoring', 'scaling', 'reliability', 'automation', 'infrastructure',
    'API design', 'data model', 'user experience', 'accessibility', 'compliance'
  ],
  connectors: [
    'regarding', 'about', 'concerning', 'related to', 'for', 'with respect to',
    'in context of', 'as part of', 'following up on', 'building on'
  ],
  outcomes: [
    'Action items captured', 'Decision recorded', 'Next steps identified',
    'Follow-up scheduled', 'Requirements clarified', 'Dependencies mapped',
    'Risks identified', 'Timeline updated', 'Resources allocated',
    'Stakeholders aligned', 'Blockers resolved', 'Progress tracked'
  ]
};

// Lorem ipsum paragraphs for content padding
const LOREM_PARAGRAPHS = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident.',
  'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis.',
  'Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.',
  'Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam.',
  'Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam, nisi ut aliquid ex ea commodi consequatur.',
  'At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint.',
  'Nam libero tempore, cum soluta nobis est eligendi optio cumque nihil impedit quo minus id quod maxime placeat facere possimus.',
];

/**
 * Seeded random number generator for reproducibility
 */
export class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /** Returns a number between 0 and 1 */
  next(): number {
    // Mulberry32 PRNG
    let t = (this.seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns an integer between min and max (inclusive) */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Pick a random element from an array */
  pick<T>(arr: readonly T[]): T {
    return arr[this.nextInt(0, arr.length - 1)];
  }

  /** Pick multiple unique elements from an array */
  pickN<T>(arr: readonly T[], n: number): T[] {
    const shuffled = [...arr].sort(() => this.next() - 0.5);
    return shuffled.slice(0, Math.min(n, arr.length));
  }

  /** Returns true with given probability (0-1) */
  chance(probability: number): boolean {
    return this.next() < probability;
  }
}

/**
 * Generate a realistic note title
 */
export function generateNoteTitle(
  rng: SeededRandom,
  entities: GeneratedEntity[],
  index: number
): string {
  const patterns = [
    // Date-based titles
    () => {
      const date = new Date(2024, rng.nextInt(0, 11), rng.nextInt(1, 28));
      return date.toISOString().split('T')[0];
    },
    // Entity reference titles
    () => {
      const entity = rng.pick(entities);
      return entity ? `${entity.name} Notes` : `Note ${index}`;
    },
    // Topic titles
    () => rng.pick(DOMAIN_VOCAB.topics),
    // Action titles
    () => `${rng.pick(DOMAIN_VOCAB.verbs)} ${rng.pick(DOMAIN_VOCAB.topics)}`,
    // Meeting titles
    () => {
      const entity = rng.pick(entities.filter(e => e.type === 'person'));
      return entity ? `Meeting with ${entity.name}` : `Team Meeting`;
    },
    // Project titles
    () => {
      const project = rng.pick(entities.filter(e => e.type === 'project'));
      return project ? `${project.name} - ${rng.pick(DOMAIN_VOCAB.topics)}` : `Project ${index}`;
    },
  ];

  return rng.pick(patterns)();
}

/**
 * Generate realistic note content with embedded wikilinks
 */
export function generateNoteContent(
  rng: SeededRandom,
  title: string,
  entities: GeneratedEntity[],
  targetLinks: number,
  avgLength: number
): { content: string; wikilinks: string[] } {
  const wikilinks: string[] = [];
  const sections: string[] = [];

  // Header
  sections.push(`# ${title}\n`);

  // Determine content structure
  const hasOverview = rng.chance(0.7);
  const hasTasks = rng.chance(0.4);
  const hasLog = rng.chance(0.5);
  const hasNotes = rng.chance(0.6);

  // Select entities to link
  const linkedEntities = rng.pickN(entities, targetLinks);

  if (hasOverview) {
    const overview = generateOverviewSection(rng, linkedEntities.slice(0, 2));
    sections.push(overview.content);
    wikilinks.push(...overview.links);
  }

  if (hasTasks) {
    const tasks = generateTaskSection(rng, linkedEntities.slice(2, 4));
    sections.push(tasks.content);
    wikilinks.push(...tasks.links);
  }

  if (hasLog) {
    const log = generateLogSection(rng, linkedEntities.slice(4, 7));
    sections.push(log.content);
    wikilinks.push(...log.links);
  }

  if (hasNotes) {
    const notes = generateNotesSection(rng, linkedEntities.slice(7), avgLength);
    sections.push(notes.content);
    wikilinks.push(...notes.links);
  }

  // Pad content if too short
  let content = sections.join('\n');
  while (content.length < avgLength * 0.7) {
    content += '\n\n' + rng.pick(LOREM_PARAGRAPHS);
  }

  return { content, wikilinks: [...new Set(wikilinks)] };
}

function generateOverviewSection(
  rng: SeededRandom,
  entities: GeneratedEntity[]
): { content: string; links: string[] } {
  const links: string[] = [];
  const lines: string[] = ['## Overview\n'];

  const verb = rng.pick(DOMAIN_VOCAB.verbs);
  const topic = rng.pick(DOMAIN_VOCAB.topics);

  if (entities.length > 0) {
    const entity = entities[0];
    links.push(entity.name);
    lines.push(`${verb.charAt(0).toUpperCase() + verb.slice(1)} ${topic} ${rng.pick(DOMAIN_VOCAB.connectors)} [[${entity.name}]].`);
  } else {
    lines.push(`${verb.charAt(0).toUpperCase() + verb.slice(1)} ${topic}.`);
  }

  lines.push('');
  lines.push(rng.pick(DOMAIN_VOCAB.outcomes) + '.');

  return { content: lines.join('\n'), links };
}

function generateTaskSection(
  rng: SeededRandom,
  entities: GeneratedEntity[]
): { content: string; links: string[] } {
  const links: string[] = [];
  const lines: string[] = ['## Tasks\n'];

  const taskCount = rng.nextInt(2, 5);
  for (let i = 0; i < taskCount; i++) {
    const done = rng.chance(0.3);
    const checkbox = done ? '[x]' : '[ ]';
    const verb = rng.pick(DOMAIN_VOCAB.verbs);
    const topic = rng.pick(DOMAIN_VOCAB.topics);

    let task = `- ${checkbox} ${verb.charAt(0).toUpperCase() + verb.slice(1)} ${topic}`;

    if (entities[i % entities.length]) {
      const entity = entities[i % entities.length];
      links.push(entity.name);
      task += ` for [[${entity.name}]]`;
    }

    lines.push(task);
  }

  return { content: lines.join('\n'), links };
}

function generateLogSection(
  rng: SeededRandom,
  entities: GeneratedEntity[]
): { content: string; links: string[] } {
  const links: string[] = [];
  const lines: string[] = ['## Log\n'];

  const entryCount = rng.nextInt(2, 6);
  for (let i = 0; i < entryCount; i++) {
    const hour = rng.nextInt(8, 18);
    const minute = rng.nextInt(0, 59).toString().padStart(2, '0');
    const verb = rng.pick(DOMAIN_VOCAB.verbs);
    const topic = rng.pick(DOMAIN_VOCAB.topics);

    let entry = `- ${hour}:${minute} ${verb} ${topic}`;

    if (entities[i % Math.max(entities.length, 1)] && rng.chance(0.7)) {
      const entity = entities[i % entities.length];
      links.push(entity.name);
      entry += ` with [[${entity.name}]]`;
    }

    lines.push(entry);
  }

  return { content: lines.join('\n'), links };
}

function generateNotesSection(
  rng: SeededRandom,
  entities: GeneratedEntity[],
  avgLength: number
): { content: string; links: string[] } {
  const links: string[] = [];
  const lines: string[] = ['## Notes\n'];

  // Add some lorem paragraphs
  const paragraphCount = Math.ceil(avgLength / 300);
  for (let i = 0; i < paragraphCount; i++) {
    let paragraph = rng.pick(LOREM_PARAGRAPHS);

    // Occasionally insert entity references
    if (entities[i % Math.max(entities.length, 1)] && rng.chance(0.5)) {
      const entity = entities[i % entities.length];
      links.push(entity.name);
      // Insert entity reference at a random position
      const words = paragraph.split(' ');
      const insertPos = rng.nextInt(3, words.length - 3);
      words.splice(insertPos, 0, `See [[${entity.name}]] for details.`);
      paragraph = words.join(' ');
    }

    lines.push(paragraph);
    lines.push('');
  }

  return { content: lines.join('\n'), links };
}

/**
 * Generate file-safe note filename from title
 */
export function titleToFilename(title: string): string {
  return title
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid chars
    .replace(/\s+/g, ' ')         // Normalize whitespace
    .trim()
    .slice(0, 200);               // Limit length
}
