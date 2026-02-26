/**
 * Shared markdown content templates for fixture generation.
 *
 * Templates use placeholders like {person}, {project}, {tech} that generators
 * replace with actual entity names from entity-pools.ts.
 */

import type { EntityDef } from './entity-pools.js';

// =============================================================================
// Daily note templates
// =============================================================================

export const DAILY_HABIT_LINES: Record<string, string> = {
  'Yoga': 'Did my morning {entity} session',
  'Swim': 'Went for a {entity} at the pool',
  'Supplements': 'Took my {entity} with breakfast',
  'Breathwork': '{entity} session before work',
  'Running': '{entity} around the neighborhood this evening',
  'Sketching': 'Quick {entity} practice in my notebook',
};

export const DAILY_WORK_SNIPPETS = [
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

// =============================================================================
// Content note body templates
// =============================================================================

export function meetingBody(ents: EntityDef[]): string {
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
}

export function projectDocBody(ents: EntityDef[]): string {
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
}

export function techGuideBody(ents: EntityDef[]): string {
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
}

export function runbookBody(ents: EntityDef[]): string {
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
}

// =============================================================================
// Entity note body templates
// =============================================================================

export function entityNoteBody(entity: EntityDef, related: EntityDef[]): string {
  const lines = [`# ${entity.name}`, ''];

  if (entity.category === 'people') {
    lines.push(`${entity.name} is a team member at ${related.find(e => e.category === 'organizations')?.name || 'Meridian Labs'}.`);
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

  return lines.join('\n');
}

// =============================================================================
// Ground truth generation helpers
// =============================================================================

export interface GroundTruthEntry {
  notePath: string;
  entity: string;
  tier: 1 | 2 | 3;
  reason: string;
}

/**
 * Scan content for entity mentions and generate ground truth entries.
 * Returns T1 for verbatim name match, T2 for alias match.
 */
export function scanContentForGroundTruth(
  notePath: string,
  content: string,
  entities: EntityDef[],
  linkedEntityNames: Set<string>,
): GroundTruthEntry[] {
  const gt: GroundTruthEntry[] = [];

  for (const entity of entities) {
    // Skip entities already linked in this note
    if (linkedEntityNames.has(entity.name)) continue;

    // Skip if entity name appears as [[wikilink]]
    if (content.includes(`[[${entity.name}]]`)) continue;

    // T1: verbatim name match
    if (content.includes(entity.name)) {
      gt.push({
        notePath,
        entity: entity.name,
        tier: 1,
        reason: `Entity ${entity.name} appears verbatim`,
      });
      continue;
    }

    // T2: alias match
    for (const alias of entity.aliases) {
      if (alias.length >= 3 && content.includes(alias) && !content.includes(`[[${alias}]]`)) {
        gt.push({
          notePath,
          entity: entity.name,
          tier: 2,
          reason: `Alias "${alias}" matches entity ${entity.name}`,
        });
        break;
      }
    }
  }

  return gt;
}

/**
 * Deduplicate ground truth entries by notePath + entity (case-insensitive).
 */
export function deduplicateGroundTruth(gt: GroundTruthEntry[]): GroundTruthEntry[] {
  const seen = new Set<string>();
  return gt.filter(g => {
    const key = `${g.notePath}::${g.entity.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
