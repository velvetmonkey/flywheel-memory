/**
 * Frontmatter generation for realistic notes
 */

import { SeededRandom } from './notes.js';

// Common tag pools
const TAG_POOLS = {
  status: ['todo', 'in-progress', 'done', 'blocked', 'review', 'archived'],
  type: ['meeting', 'note', 'task', 'reference', 'daily', 'weekly', 'project'],
  priority: ['high', 'medium', 'low', 'urgent', 'backlog'],
  area: ['work', 'personal', 'learning', 'health', 'finance', 'admin'],
  topic: [
    'engineering', 'design', 'product', 'marketing', 'sales', 'ops',
    'security', 'infrastructure', 'data', 'mobile', 'web', 'api'
  ]
};

export interface FrontmatterOptions {
  probability: number;
  includeCreatedDate: boolean;
  includeModifiedDate: boolean;
  includeTags: boolean;
  includeStatus: boolean;
  includeCustomFields: boolean;
}

const DEFAULT_OPTIONS: FrontmatterOptions = {
  probability: 0.7,
  includeCreatedDate: true,
  includeModifiedDate: true,
  includeTags: true,
  includeStatus: true,
  includeCustomFields: true
};

/**
 * Generate frontmatter for a note
 */
export function generateFrontmatter(
  rng: SeededRandom,
  title: string,
  options: Partial<FrontmatterOptions> = {}
): Record<string, unknown> | undefined {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Check probability
  if (!rng.chance(opts.probability)) {
    return undefined;
  }

  const frontmatter: Record<string, unknown> = {};

  // Created date (usually in the past)
  if (opts.includeCreatedDate) {
    const daysAgo = rng.nextInt(1, 365);
    const created = new Date();
    created.setDate(created.getDate() - daysAgo);
    frontmatter.created = created.toISOString().split('T')[0];
  }

  // Modified date (more recent than created)
  if (opts.includeModifiedDate && frontmatter.created) {
    const daysSinceCreated = rng.nextInt(0, 30);
    const modified = new Date(frontmatter.created as string);
    modified.setDate(modified.getDate() + daysSinceCreated);
    if (modified <= new Date()) {
      frontmatter.modified = modified.toISOString().split('T')[0];
    }
  }

  // Tags
  if (opts.includeTags && rng.chance(0.6)) {
    const tags: string[] = [];

    // Type tag
    if (rng.chance(0.8)) {
      tags.push(rng.pick(TAG_POOLS.type));
    }

    // Area tag
    if (rng.chance(0.5)) {
      tags.push(rng.pick(TAG_POOLS.area));
    }

    // Topic tag
    if (rng.chance(0.4)) {
      tags.push(rng.pick(TAG_POOLS.topic));
    }

    // Priority tag
    if (rng.chance(0.3)) {
      tags.push(`priority/${rng.pick(TAG_POOLS.priority)}`);
    }

    if (tags.length > 0) {
      frontmatter.tags = tags;
    }
  }

  // Status
  if (opts.includeStatus && rng.chance(0.4)) {
    frontmatter.status = rng.pick(TAG_POOLS.status);
  }

  // Custom fields
  if (opts.includeCustomFields) {
    // Due date for some notes
    if (rng.chance(0.2)) {
      const daysAhead = rng.nextInt(1, 60);
      const due = new Date();
      due.setDate(due.getDate() + daysAhead);
      frontmatter.due = due.toISOString().split('T')[0];
    }

    // Assignee for some notes
    if (rng.chance(0.15)) {
      frontmatter.assignee = rng.pick([
        'me', 'team', 'alice', 'bob', 'carol', 'david'
      ]);
    }

    // Project reference
    if (rng.chance(0.25) && !title.includes('Project')) {
      frontmatter.project = rng.pick([
        'Alpha', 'Beta', 'Gamma', 'Main', 'Research'
      ]);
    }

    // Rating/priority number
    if (rng.chance(0.1)) {
      frontmatter.priority = rng.nextInt(1, 5);
    }
  }

  // Only return if we have meaningful content
  return Object.keys(frontmatter).length > 0 ? frontmatter : undefined;
}

/**
 * Convert frontmatter object to YAML string
 */
export function frontmatterToYaml(frontmatter: Record<string, unknown>): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      if (value.length === 1) {
        lines.push(`${key}: [${formatValue(value[0])}]`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${formatValue(item)}`);
        }
      }
    } else {
      lines.push(`${key}: ${formatValue(value)}`);
    }
  }

  return lines.join('\n');
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    // Quote strings with special characters
    if (value.includes(':') || value.includes('#') || value.includes("'") || value.includes('"')) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * Wrap content with frontmatter
 */
export function wrapWithFrontmatter(
  content: string,
  frontmatter: Record<string, unknown> | undefined
): string {
  if (!frontmatter || Object.keys(frontmatter).length === 0) {
    return content;
  }

  const yaml = frontmatterToYaml(frontmatter);
  return `---\n${yaml}\n---\n\n${content}`;
}
