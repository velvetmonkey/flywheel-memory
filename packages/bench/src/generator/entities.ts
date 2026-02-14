/**
 * Entity generation for realistic vault content
 */

import type { GeneratedEntity, EntityType } from '../types.js';
import { SeededRandom } from './notes.js';

// Name pools by entity type
const NAME_POOLS: Record<EntityType, string[]> = {
  person: [
    'Alice Chen', 'Bob Williams', 'Carol Martinez', 'David Kim', 'Emma Thompson',
    'Frank Johnson', 'Grace Lee', 'Henry Brown', 'Isabella Garcia', 'James Wilson',
    'Karen Davis', 'Leo Anderson', 'Maria Rodriguez', 'Nathan Taylor', 'Olivia Moore',
    'Paul Jackson', 'Quinn White', 'Rachel Harris', 'Samuel Clark', 'Tara Lewis',
    'Uma Patel', 'Victor Young', 'Wendy King', 'Xavier Scott', 'Yuki Tanaka',
    'Zara Ahmed', 'Adrian Foster', 'Bianca Murphy', 'Carlos Rivera', 'Diana Brooks',
    'Ethan Cooper', 'Fiona Reed', 'George Hayes', 'Hannah Price', 'Ivan Petrov',
    'Julia Ross', 'Kevin Morgan', 'Laura Sanders', 'Marcus Bell', 'Nina Collins',
    'Oscar Hughes', 'Priya Sharma', 'Quinn O\'Brien', 'Rosa Martinez', 'Steven Park',
    'Tina Chen', 'Ulrich Weber', 'Vera Novak', 'William Chang', 'Xena Powell'
  ],
  project: [
    'Project Alpha', 'Project Beta', 'Project Gamma', 'Project Delta', 'Project Epsilon',
    'Phoenix Initiative', 'Aurora Platform', 'Nebula Framework', 'Horizon System', 'Atlas Engine',
    'Titan Migration', 'Cosmos Integration', 'Stellar Launch', 'Quantum Leap', 'Vector Analysis',
    'Apex Redesign', 'Summit Dashboard', 'Pulse Monitor', 'Echo Service', 'Nova API',
    'Prism Analytics', 'Orbit Scheduler', 'Fusion Pipeline', 'Vertex Gateway', 'Stream Processor',
    'Core Refactor', 'Edge Computing', 'Cloud Migration', 'Data Platform', 'Security Audit',
    'Performance Optimization', 'Mobile Rewrite', 'API Versioning', 'Database Sharding', 'Cache Layer',
    'Search Enhancement', 'Auth Overhaul', 'Logging System', 'Monitoring Stack', 'CI/CD Pipeline'
  ],
  topic: [
    'Architecture', 'Performance', 'Security', 'Testing', 'Documentation',
    'Deployment', 'Monitoring', 'Scaling', 'Reliability', 'Automation',
    'Code Review', 'Best Practices', 'Technical Debt', 'Refactoring', 'Optimization',
    'API Design', 'Data Modeling', 'Error Handling', 'Logging', 'Caching',
    'Authentication', 'Authorization', 'Rate Limiting', 'Load Balancing', 'Failover',
    'Backup Strategy', 'Disaster Recovery', 'Compliance', 'Accessibility', 'Internationalization',
    'Feature Flags', 'A/B Testing', 'Analytics', 'Metrics', 'Alerting',
    'Incident Response', 'Postmortem', 'Runbook', 'SLA', 'SLO'
  ],
  location: [
    'Conference Room A', 'Conference Room B', 'Meeting Room 101', 'Meeting Room 202',
    'Office HQ', 'Remote Office', 'San Francisco', 'New York', 'London', 'Tokyo',
    'Berlin', 'Sydney', 'Toronto', 'Seattle', 'Austin', 'Boston', 'Chicago',
    'Denver', 'Miami', 'Portland', 'Vancouver', 'Amsterdam', 'Singapore', 'Dublin',
    'Main Campus', 'North Building', 'South Building', 'Innovation Lab', 'Design Studio',
    'Engineering Floor', 'Executive Suite', 'Training Center', 'Cafeteria', 'Rooftop'
  ],
  company: [
    'Acme Corp', 'TechStart Inc', 'DataFlow Systems', 'CloudNine Solutions', 'InnovateTech',
    'BlueWave Analytics', 'GreenLeaf Software', 'RedRock Ventures', 'SilverLine Media', 'GoldStar Digital',
    'Quantum Computing Co', 'Neural Networks Ltd', 'Blockchain Dynamics', 'AI Frontier', 'ML Pioneers',
    'CyberShield Security', 'DataVault Storage', 'StreamLine Logistics', 'SmartGrid Energy', 'BioTech Labs',
    'FinanceHub', 'HealthTech Systems', 'EduPlatform', 'RetailMax', 'TravelSphere',
    'MediaStream', 'GameForge', 'RoboTech', 'SpaceTech', 'GreenEnergy'
  ]
};

/**
 * Generate a set of entities for a vault
 */
export function generateEntities(
  rng: SeededRandom,
  entityTypes: EntityType[],
  entityCount: Record<EntityType, number>
): GeneratedEntity[] {
  const entities: GeneratedEntity[] = [];

  for (const type of entityTypes) {
    const count = entityCount[type] || 0;
    const pool = NAME_POOLS[type];
    const selected = rng.pickN(pool, count);

    for (const name of selected) {
      entities.push({
        name,
        type,
        aliases: generateAliases(rng, name, type)
      });
    }
  }

  return entities;
}

/**
 * Generate aliases for an entity
 */
function generateAliases(
  rng: SeededRandom,
  name: string,
  type: EntityType
): string[] | undefined {
  // Only some entities have aliases
  if (!rng.chance(0.3)) return undefined;

  const aliases: string[] = [];

  switch (type) {
    case 'person': {
      // First name only
      const firstName = name.split(' ')[0];
      aliases.push(firstName);

      // Initials
      const initials = name.split(' ').map(n => n[0]).join('');
      if (initials.length > 1) {
        aliases.push(initials);
      }
      break;
    }
    case 'project': {
      // Acronym
      const words = name.split(' ');
      if (words.length > 1) {
        const acronym = words.map(w => w[0]).join('');
        aliases.push(acronym);
      }
      // Short form
      if (name.startsWith('Project ')) {
        aliases.push(name.replace('Project ', ''));
      }
      break;
    }
    case 'topic': {
      // No common aliases for topics
      break;
    }
    case 'location': {
      // Abbreviations
      if (name.includes('Room')) {
        aliases.push(name.replace('Conference ', '').replace('Meeting ', ''));
      }
      break;
    }
    case 'company': {
      // Remove common suffixes
      const cleaned = name.replace(/ (Corp|Inc|Ltd|Co|Systems|Solutions|Labs)$/, '');
      if (cleaned !== name) {
        aliases.push(cleaned);
      }
      break;
    }
  }

  return aliases.length > 0 ? aliases : undefined;
}

/**
 * Create note files for entities that don't have dedicated notes
 */
export function generateEntityNotes(
  rng: SeededRandom,
  entities: GeneratedEntity[]
): Map<string, string> {
  const notes = new Map<string, string>();

  for (const entity of entities) {
    // ~30% of entities get their own note
    if (!rng.chance(0.3)) continue;

    const content = generateEntityNoteContent(rng, entity);
    notes.set(entity.name, content);
  }

  return notes;
}

function generateEntityNoteContent(
  rng: SeededRandom,
  entity: GeneratedEntity
): string {
  const lines: string[] = [];

  // Frontmatter
  lines.push('---');
  lines.push(`type: ${entity.type}`);
  if (entity.aliases && entity.aliases.length > 0) {
    lines.push(`aliases: [${entity.aliases.map(a => `"${a}"`).join(', ')}]`);
  }
  lines.push(`created: ${new Date().toISOString().split('T')[0]}`);
  lines.push('---');
  lines.push('');

  // Title
  lines.push(`# ${entity.name}`);
  lines.push('');

  // Type-specific content
  switch (entity.type) {
    case 'person':
      lines.push('## About');
      lines.push('');
      lines.push(`${entity.name} is a team member working on various projects.`);
      lines.push('');
      lines.push('## Notes');
      lines.push('');
      lines.push('_No notes yet._');
      break;

    case 'project':
      lines.push('## Overview');
      lines.push('');
      lines.push(`${entity.name} is an ongoing initiative.`);
      lines.push('');
      lines.push('## Status');
      lines.push('');
      lines.push(`- **Phase**: ${rng.pick(['Planning', 'Development', 'Testing', 'Deployment'])}`);
      lines.push(`- **Priority**: ${rng.pick(['High', 'Medium', 'Low'])}`);
      lines.push('');
      lines.push('## Related');
      lines.push('');
      lines.push('_Links will be added as work progresses._');
      break;

    case 'topic':
      lines.push('## Description');
      lines.push('');
      lines.push(`${entity.name} is a technical area of focus.`);
      lines.push('');
      lines.push('## Resources');
      lines.push('');
      lines.push('- _Add resources here_');
      break;

    case 'location':
      lines.push('## Details');
      lines.push('');
      lines.push(`${entity.name} is a location used for meetings and work.`);
      lines.push('');
      lines.push(`**Capacity**: ${rng.nextInt(4, 20)} people`);
      break;

    case 'company':
      lines.push('## About');
      lines.push('');
      lines.push(`${entity.name} is an organization we work with.`);
      lines.push('');
      lines.push('## Contacts');
      lines.push('');
      lines.push('_Add contacts here_');
      break;
  }

  return lines.join('\n');
}
