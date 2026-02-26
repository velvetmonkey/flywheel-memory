#!/usr/bin/env npx tsx
/**
 * Generate archetype vault fixtures.
 *
 * Usage:
 *   npx tsx generate-archetypes.ts hub-and-spoke > archetypes/hub-and-spoke.json
 *   npx tsx generate-archetypes.ts dense-mesh > archetypes/dense-mesh.json
 *   npx tsx generate-archetypes.ts hierarchical > archetypes/hierarchical.json
 *   npx tsx generate-archetypes.ts bridge-network > archetypes/bridge-network.json
 *   npx tsx generate-archetypes.ts small-world > archetypes/small-world.json
 *   npx tsx generate-archetypes.ts sparse-orphan > archetypes/sparse-orphan.json
 */

import {
  type EntityDef,
  PEOPLE, PROJECTS, TECHNOLOGIES, ORGANIZATIONS, LOCATIONS, CONCEPTS,
  HEALTH, ACRONYMS, ANIMALS, MEDIA, DOCUMENTS,
  slugify, mulberry32, pick, shuffle, toEntitySpec,
} from './entity-pools.js';

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

interface GroundTruthEntry {
  notePath: string;
  entity: string;
  tier: 1 | 2 | 3;
  reason: string;
}

interface Fixture {
  archetype: string;
  seed: number;
  description: string;
  entities: ReturnType<typeof toEntitySpec>[];
  notes: NoteDef[];
  groundTruth: GroundTruthEntry[];
}

// =============================================================================
// Extended entity pools for archetypes needing many entities
// =============================================================================

function makeExtraConcepts(count: number, startIndex: number): EntityDef[] {
  const names = [
    'Design Patterns', 'SOLID Principles', 'Code Reviews', 'Pair Programming',
    'TDD', 'BDD', 'CI/CD Pipeline', 'Load Balancing', 'Caching Strategy',
    'Database Sharding', 'Message Queue', 'Service Discovery', 'Circuit Breaker',
    'Rate Limiting', 'Blue-Green Deploy', 'A/B Testing', 'Feature Flags',
    'Canary Deploy', 'Rollback Strategy', 'Health Checks', 'Log Aggregation',
    'Distributed Tracing', 'API Versioning', 'Schema Migration', 'Data Lake',
    'ETL Pipeline', 'Stream Processing', 'Batch Processing', 'Edge Computing',
    'Serverless', 'Container Orchestration', 'Infrastructure as Code', 'GitOps',
    'ChatOps', 'Platform Engineering', 'Site Reliability', 'Chaos Engineering',
    'Performance Tuning', 'Memory Management', 'Garbage Collection',
    'Thread Safety', 'Async Patterns', 'Event Loop', 'Pub/Sub', 'CQRS',
    'Saga Pattern', 'Outbox Pattern', 'Idempotency', 'Eventual Consistency',
    'CAP Theorem', 'Dependency Injection', 'Observer Pattern', 'Strategy Pattern',
    'Factory Method', 'Singleton Pattern', 'Adapter Pattern', 'Proxy Pattern',
    'Decorator Pattern', 'Command Pattern', 'State Machine', 'Builder Pattern',
    'Template Method', 'Iterator Pattern', 'Mediator Pattern', 'Flyweight Pattern',
    'Composite Pattern', 'Chain of Responsibility', 'Visitor Pattern',
    'Interpreter Pattern', 'Memento Pattern', 'Bridge Pattern',
  ];
  const result: EntityDef[] = [];
  for (let i = 0; i < count && i + startIndex < names.length; i++) {
    const name = names[i + startIndex] || `Concept ${i + startIndex}`;
    result.push({
      name,
      category: 'concepts',
      aliases: [slugify(name)],
      hubScore: 10 + ((i * 7 + startIndex * 3) % 30),
      folder: 'concepts',
    });
  }
  return result;
}

function makeExtraProjects(count: number, startIndex: number): EntityDef[] {
  const names = [
    'LogStream', 'MetricDash', 'AlertHub', 'PipeRunner', 'DataSync',
    'QueryForge', 'SchemaGuard', 'TokenVault', 'RateShield', 'CacheWarm',
    'TaskRunner', 'EventBridge', 'NotifyPush', 'FileVault', 'IndexBuilder',
    'BatchWorker', 'StreamMerge', 'ApiProxy', 'AuthGate', 'AuditTrail',
    'BillingCore', 'FeatureStore', 'ModelServe', 'DataCleaner', 'ReportGen',
    'BackupSync', 'MigrateKit', 'TestHarness', 'DeployBot', 'MonitorPulse',
  ];
  const result: EntityDef[] = [];
  for (let i = 0; i < count && i + startIndex < names.length; i++) {
    const name = names[i + startIndex] || `Project${i + startIndex}`;
    result.push({
      name,
      category: 'projects',
      aliases: [slugify(name)],
      hubScore: 5 + ((i * 11 + startIndex * 5) % 40),
      folder: 'projects',
    });
  }
  return result;
}

function makeExtraOrgs(count: number, startIndex: number): EntityDef[] {
  const names = [
    'Engineering Department', 'Product Department', 'Research Department',
    'Operations Department', 'Frontend Team', 'Backend Team', 'Platform Team',
    'Data Team', 'Security Team', 'QA Team', 'DevOps Team', 'ML Team',
    'Analytics Team', 'Mobile Team', 'Infrastructure Team', 'Release Team',
    'Design Team', 'Documentation Team', 'Support Team', 'Architecture Board',
  ];
  const result: EntityDef[] = [];
  for (let i = 0; i < count && i + startIndex < names.length; i++) {
    const name = names[i + startIndex] || `Team ${i + startIndex}`;
    result.push({
      name,
      category: 'organizations',
      aliases: [slugify(name)],
      hubScore: 5 + ((i * 7) % 20),
      folder: 'organizations',
    });
  }
  return result;
}

function makeExtraTechs(count: number, startIndex: number): EntityDef[] {
  const names = [
    'Prometheus', 'Grafana', 'Elasticsearch', 'Nginx', 'RabbitMQ',
    'MongoDB', 'Cassandra', 'Jenkins', 'ArgoCD', 'Istio',
    'Vault', 'Consul', 'Ansible', 'Puppet', 'Chef',
    'Datadog', 'Splunk', 'PagerDuty', 'Sentry', 'NewRelic',
  ];
  const result: EntityDef[] = [];
  for (let i = 0; i < count && i + startIndex < names.length; i++) {
    const name = names[i + startIndex] || `Tech${i + startIndex}`;
    result.push({
      name,
      category: 'technologies',
      aliases: [slugify(name)],
      hubScore: 10 + ((i * 13) % 50),
      folder: 'technologies',
    });
  }
  return result;
}

// =============================================================================
// Entity selection helpers
// =============================================================================

function selectEntities(
  pool: EntityDef[],
  count: number,
  rng: () => number,
  extraFn?: (count: number, startIndex: number) => EntityDef[],
): EntityDef[] {
  const shuffled = shuffle(rng, pool);
  if (shuffled.length >= count) {
    return shuffled.slice(0, count);
  }
  const result = [...shuffled];
  if (extraFn) {
    const extras = extraFn(count - result.length, 0);
    result.push(...extras.slice(0, count - result.length));
  }
  return result;
}

// =============================================================================
// Content helpers
// =============================================================================

function makeContentNote(
  path: string,
  title: string,
  folder: string,
  content: string,
  links: string[],
  frontmatter?: Record<string, unknown>,
): NoteDef {
  return { path, title, frontmatter, content, links, folder };
}

/**
 * Pick a random alias from entity (3+ chars). Returns undefined if none available.
 */
function pickAlias(entity: EntityDef): string | undefined {
  const valid = entity.aliases.filter(a => a.length >= 3);
  return valid.length > 0 ? valid[0] : undefined;
}

// =============================================================================
// Ground truth helpers
// =============================================================================

function collectGroundTruth(
  notePath: string,
  content: string,
  entities: EntityDef[],
  linkedNames: Set<string>,
): GroundTruthEntry[] {
  const gt: GroundTruthEntry[] = [];
  for (const entity of entities) {
    if (linkedNames.has(entity.name)) continue;
    if (content.includes(`[[${entity.name}]]`)) continue;

    // T1: verbatim name match
    if (content.includes(entity.name)) {
      gt.push({
        notePath,
        entity: entity.name,
        tier: 1,
        reason: `Content directly mentions '${entity.name}' as plain text without wikilink`,
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

function dedup(gt: GroundTruthEntry[]): GroundTruthEntry[] {
  const seen = new Set<string>();
  return gt.filter(g => {
    const key = `${g.notePath}::${g.entity.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// =============================================================================
// Hub-and-Spoke Generator
// Target: 49 entities, 71 notes, 24 GT (T1=5, T2=11, T3=8)
// =============================================================================

function generateHubAndSpoke(): Fixture {
  const rng = mulberry32(101);

  const people = selectEntities(PEOPLE, 8, rng);
  const projects = selectEntities(PROJECTS, 6, rng);
  const technologies = selectEntities(TECHNOLOGIES, 8, rng);
  const concepts = selectEntities(CONCEPTS, 8, rng);
  const organizations = selectEntities(ORGANIZATIONS, 4, rng);
  const locations = selectEntities(LOCATIONS, 3, rng);
  const health = selectEntities(HEALTH, 3, rng);
  const acronyms = selectEntities(ACRONYMS, 4, rng);
  const animals = selectEntities(ANIMALS, 2, rng);
  const media = selectEntities(MEDIA, 3, rng);

  const allEntities = [
    ...people, ...projects, ...technologies, ...concepts,
    ...organizations, ...locations, ...health, ...acronyms, ...animals, ...media,
  ];
  // Total: 8+6+8+8+4+3+3+4+2+3 = 49 entities

  const notes: NoteDef[] = [];
  const allGt: GroundTruthEntry[] = [];

  // --- 3 hub notes (linking to 10-15 entities each) ---
  // Hub 1: Main project overview
  const hub1Targets = shuffle(rng, allEntities).slice(0, 15);
  const hub1Links = hub1Targets.map(e => e.name);
  notes.push(makeContentNote(
    `projects/${slugify(projects[0].name)}.md`, projects[0].name, 'projects',
    [
      `# ${projects[0].name} Overview`,
      '',
      `${projects[0].name} is the primary platform for ${organizations[0].name}.`,
      `Built with ${hub1Links.slice(0, 5).map(n => `[[${n}]]`).join(', ')}.`,
      '',
      '## Team',
      `Key contributors: ${hub1Links.slice(5, 8).map(n => `[[${n}]]`).join(', ')}.`,
      '',
      '## Stack',
      `Uses ${hub1Links.slice(8, 12).map(n => `[[${n}]]`).join(', ')}.`,
      '',
      '## Related',
      `Integrates with ${hub1Links.slice(12).map(n => `[[${n}]]`).join(', ')}.`,
    ].join('\n'),
    hub1Links,
  ));

  // Hub 2: Technology ecosystem
  const hub2Targets = shuffle(rng, allEntities).slice(0, 12);
  const hub2Links = hub2Targets.map(e => e.name);
  notes.push(makeContentNote(
    `technologies/${slugify(technologies[0].name)}-ecosystem.md`,
    `${technologies[0].name} Ecosystem`, 'technologies',
    [
      `# ${technologies[0].name} Ecosystem`,
      '',
      `${technologies[0].name} powers many systems.`,
      `Used by ${hub2Links.slice(0, 4).map(n => `[[${n}]]`).join(', ')}.`,
      '',
      '## Integration Points',
      `Connects to ${hub2Links.slice(4, 8).map(n => `[[${n}]]`).join(', ')}.`,
      '',
      '## Resources',
      `Maintained by ${hub2Links.slice(8).map(n => `[[${n}]]`).join(', ')}.`,
    ].join('\n'),
    hub2Links,
  ));

  // Hub 3: Person page
  const hub3Targets = shuffle(rng, allEntities).slice(0, 14);
  const hub3Links = hub3Targets.map(e => e.name);
  notes.push(makeContentNote(
    `people/${slugify(people[0].name)}.md`, people[0].name, 'people',
    [
      `# ${people[0].name}`,
      '',
      `${people[0].name} is a senior engineer at ${organizations[0].name}.`,
      `Leads ${hub3Links.slice(0, 4).map(n => `[[${n}]]`).join(', ')}.`,
      '',
      '## Responsibilities',
      `Oversees ${hub3Links.slice(4, 8).map(n => `[[${n}]]`).join(', ')}.`,
      '',
      '## Expertise',
      `Specializes in ${hub3Links.slice(8, 12).map(n => `[[${n}]]`).join(', ')}.`,
      '',
      '## Notes',
      `Also mentors ${hub3Links.slice(12).map(n => `[[${n}]]`).join(', ')}.`,
    ].join('\n'),
    hub3Links,
  ));

  // --- 15 daily notes (spokes with 1-2 links to hubs) ---
  // Some use aliases for unlinked mentions to generate T2 GT
  const hubNames = [projects[0].name, technologies[0].name, people[0].name];
  for (let i = 0; i < 15; i++) {
    const date = `2025-01-${String(i + 1).padStart(2, '0')}`;
    const hubRef = hubNames[i % 3];
    const spokeLinks = [hubRef];

    // Pick some entities to mention (use aliases sometimes for T2)
    const candidates = shuffle(rng, allEntities.filter(e => !spokeLinks.includes(e.name)));
    const mention1 = candidates[0];
    const mention2 = candidates[1];
    // Use alias for mention2 if available (to generate T2 GT)
    const alias2 = mention2 ? pickAlias(mention2) : undefined;
    const mention2Text = alias2 || mention2?.name || 'plans';

    const content = [
      `# Daily ${date}`,
      '',
      '## Work',
      `Made progress on [[${hubRef}]] today.`,
      '',
      `Discussed ${mention1?.name || 'plans'} with the team.`,
      `Reviewed some ${mention2Text} documentation.`,
    ].join('\n');

    notes.push(makeContentNote(`daily-notes/${date}.md`, `Daily ${date}`, 'daily-notes', content, spokeLinks));
    allGt.push(...collectGroundTruth(`daily-notes/${date}.md`, content, allEntities, new Set(spokeLinks)));
  }

  // --- 8 meeting notes (spokes with 1-3 links) ---
  for (let i = 0; i < 8; i++) {
    const person = people[i % people.length];
    const project = projects[(i + 1) % projects.length];
    const tech = technologies[i % technologies.length];
    const spokeLinks = [project.name];
    if (i % 3 !== 2) spokeLinks.push(person.name);

    // Mention tech by alias for T2
    const techAlias = pickAlias(tech);
    const techMention = techAlias || tech.name;

    const content = [
      `# Meeting ${i + 1}: ${project.name} Sync`,
      '',
      `Attendees: ${spokeLinks.includes(person.name) ? `[[${person.name}]]` : person.name}`,
      '',
      '## Discussion',
      `Reviewed [[${project.name}]] status. The ${techMention} migration is on track.`,
      '',
      `${concepts[i % concepts.length].name} patterns were discussed.`,
    ].join('\n');

    notes.push(makeContentNote(
      `meetings/meeting-${i + 1}.md`, `Meeting ${i + 1}`, 'meetings', content, spokeLinks,
    ));
    allGt.push(...collectGroundTruth(`meetings/meeting-${i + 1}.md`, content, allEntities, new Set(spokeLinks)));
  }

  // --- Entity notes (fill remaining to reach 71 notes) ---
  const usedPaths = new Set(notes.map(n => n.path));
  const entityNotesToMake = 71 - notes.length; // remaining slots
  const entityQueue = shuffle(rng, allEntities);

  for (let i = 0; i < entityQueue.length && notes.length < 71; i++) {
    const entity = entityQueue[i];
    const path = `${entity.folder}/${slugify(entity.name)}.md`;
    if (usedPaths.has(path)) continue;
    usedPaths.add(path);

    const related = shuffle(rng, allEntities.filter(e => e !== entity)).slice(0, 3);
    const links: string[] = [];

    // ~60% of entity notes link back to a hub
    if (rng() < 0.6) {
      const hubRef = pick(rng, hubNames);
      links.push(hubRef);
    }

    // Use alias for a related entity mention to generate T2
    const aliasCandidate = related.find(e => pickAlias(e) && !links.includes(e.name));
    const aliasMention = aliasCandidate ? pickAlias(aliasCandidate) : undefined;

    const content = [
      `# ${entity.name}`,
      '',
      entity.category === 'people'
        ? `${entity.name} is a team member. ${links.length > 0 ? `Works on [[${links[0]}]].` : 'Works on various projects.'}`
        : entity.category === 'projects'
        ? `${entity.name} is an internal project. ${links.length > 0 ? `Part of [[${links[0]}]].` : 'Standalone service.'}`
        : `${entity.name} -- ${entity.category}. ${links.length > 0 ? `Related to [[${links[0]}]].` : ''}`,
      '',
      related[0] && !links.includes(related[0].name) ? `Also relevant: ${related[0].name}.` : '',
      aliasMention ? `Uses ${aliasMention} integration.` : '',
    ].join('\n');

    const fm: Record<string, unknown> = { type: entity.category };
    if (entity.aliases.length > 0) fm.aliases = entity.aliases;

    notes.push(makeContentNote(path, entity.name, entity.folder, content, links, fm));
    allGt.push(...collectGroundTruth(path, content, allEntities, new Set(links)));
  }

  // Add T3 ground truth (contextual/semantic -- entity not mentioned in text)
  const t3Entries: GroundTruthEntry[] = [];
  const t3Candidates = shuffle(rng, allEntities);
  for (const entity of t3Candidates) {
    if (t3Entries.length >= 8) break;
    const targetNote = notes.find(
      n => !n.links.includes(entity.name) && !n.content.includes(entity.name)
        && !entity.aliases.some(a => n.content.includes(a))
    );
    if (targetNote) {
      t3Entries.push({
        notePath: targetNote.path,
        entity: entity.name,
        tier: 3,
        reason: `${entity.name} is contextually related to ${targetNote.title} through shared domain`,
      });
    }
  }

  const finalGt = dedup([...allGt, ...t3Entries]);
  const t1 = finalGt.filter(g => g.tier === 1).slice(0, 5);
  const t2 = finalGt.filter(g => g.tier === 2).slice(0, 11);
  const t3 = finalGt.filter(g => g.tier === 3).slice(0, 8);

  return {
    archetype: 'hub-and-spoke',
    seed: 101,
    description: 'Hub-and-spoke topology with 3 hub notes connecting to 10+ entities each. Peripheral notes link back to hubs. Power-law degree distribution. Tests hub boost (Layer 9) and orphan reduction.',
    entities: allEntities.map(toEntitySpec),
    notes,
    groundTruth: [...t1, ...t2, ...t3],
  };
}

// =============================================================================
// Dense-Mesh Generator
// Target: 63 entities, 63 notes, 15 GT (T1=7, T2=8, T3=0)
// =============================================================================

function generateDenseMesh(): Fixture {
  const rng = mulberry32(103);

  // 63 entities: concepts(52), organizations(2), people(3), projects(2), technologies(4)
  const baseConcepts = selectEntities(CONCEPTS, 12, rng);
  const extraConcepts = makeExtraConcepts(40, 0);
  const concepts = [...baseConcepts, ...extraConcepts];
  const organizations = selectEntities(ORGANIZATIONS, 2, rng);
  const people = selectEntities(PEOPLE, 3, rng);
  const projects = selectEntities(PROJECTS, 2, rng);
  const technologies = selectEntities(TECHNOLOGIES, 4, rng);

  const allEntities = [...concepts, ...organizations, ...people, ...projects, ...technologies];
  // Total: 52+2+3+2+4 = 63

  const notes: NoteDef[] = [];
  const allGt: GroundTruthEntry[] = [];

  // 5 clusters of ~10 concepts each (50 notes)
  const clusterFolders = ['frontend', 'backend', 'devops', 'data', 'leadership'];
  const shuffledConcepts = shuffle(rng, concepts);
  const clusterConcepts: EntityDef[][] = clusterFolders.map((_, i) =>
    shuffledConcepts.slice(i * 10, (i + 1) * 10)
  );
  const remainingConcepts = shuffledConcepts.slice(50);

  for (let ci = 0; ci < clusterFolders.length; ci++) {
    const folder = clusterFolders[ci];
    const clusterEnts = clusterConcepts[ci];

    for (let ni = 0; ni < clusterEnts.length; ni++) {
      const entity = clusterEnts[ni];
      // Link to 4-8 other entities in the same cluster
      const others = clusterEnts.filter(e => e !== entity);
      const linkCount = Math.min(4 + Math.floor(rng() * 5), others.length);
      const linkTargets = shuffle(rng, others).slice(0, linkCount);
      const links = linkTargets.map(e => e.name);

      // Mention non-cluster entities for GT
      const nonCluster = allEntities.filter(e => !clusterEnts.includes(e) && !links.includes(e.name));
      const mentions = shuffle(rng, nonCluster).slice(0, 2);

      // Use alias for one mention to get T2
      const alias0 = mentions[0] ? pickAlias(mentions[0]) : undefined;
      const mention0Text = alias0 || mentions[0]?.name || '';

      const content = [
        `# ${entity.name}`,
        '',
        `${entity.name} is a key ${folder} practice.`,
        `It integrates with ${links.slice(0, 3).map(n => `[[${n}]]`).join(', ')}.`,
        '',
        '## Details',
        `Works alongside ${links.slice(3).map(n => `[[${n}]]`).join(', ') || 'other practices'}.`,
        '',
        mention0Text ? `The ${mention0Text} team follows this pattern closely.` : '',
        mentions[1] ? `See also: ${mentions[1].name}.` : '',
      ].join('\n');

      const path = `${folder}/${slugify(entity.name)}.md`;
      notes.push(makeContentNote(path, entity.name, folder, content, links, { type: entity.category }));
      allGt.push(...collectGroundTruth(path, content, allEntities, new Set(links)));
    }
  }

  // Cross-cluster notes (13 notes)
  const crossEnts = [...remainingConcepts, ...organizations, ...people, ...projects, ...technologies];
  for (let i = 0; i < crossEnts.length && notes.length < 63; i++) {
    const entity = crossEnts[i];
    const fromClusters = shuffle(rng, clusterConcepts).slice(0, 3);
    const crossLinks = fromClusters.map(cc => pick(rng, cc).name);

    // Use alias of a cross-entity for T2
    const aliasEntity = shuffle(rng, allEntities.filter(e => !crossLinks.includes(e.name)))[0];
    const aliasText = aliasEntity ? pickAlias(aliasEntity) : undefined;

    const content = [
      `# ${entity.name}`,
      '',
      `${entity.name} spans multiple areas: ${crossLinks.map(n => `[[${n}]]`).join(', ')}.`,
      '',
      `As a ${entity.category}, it connects different parts of the organization.`,
      aliasText ? `Follows ${aliasText} conventions.` : '',
    ].join('\n');

    const path = `${entity.folder}/${slugify(entity.name)}.md`;
    notes.push(makeContentNote(path, entity.name, entity.folder, content, crossLinks, { type: entity.category }));
    allGt.push(...collectGroundTruth(path, content, allEntities, new Set(crossLinks)));
  }

  const finalGt = dedup(allGt);
  const t1 = finalGt.filter(g => g.tier === 1).slice(0, 7);
  const t2 = finalGt.filter(g => g.tier === 2).slice(0, 8);

  return {
    archetype: 'dense-mesh',
    seed: 103,
    description: '5 clusters of 10 notes each, internally heavily cross-linked. Tests over-connection detection, suggestion restraint, and precision under high density.',
    entities: allEntities.map(toEntitySpec),
    notes,
    groundTruth: [...t1, ...t2],
  };
}

// =============================================================================
// Hierarchical Generator
// Target: 96 entities, 97 notes, 24 GT (T1=19, T2=5, T3=0)
// =============================================================================

function generateHierarchical(): Fixture {
  const rng = mulberry32(102);

  // 96 entities: concepts(22), organizations(21), projects(33), technologies(20)
  const baseConcepts = selectEntities(CONCEPTS, 12, rng);
  const extraConcepts = makeExtraConcepts(10, 12);
  const allConcepts = [...baseConcepts, ...extraConcepts];

  const baseOrgs = selectEntities(ORGANIZATIONS, 6, rng);
  const extraOrgs = makeExtraOrgs(15, 0);
  const allOrgs = [...baseOrgs, ...extraOrgs];

  const baseProjects = selectEntities(PROJECTS, 20, rng);
  const extraProjects = makeExtraProjects(13, 0);
  const allProjects = [...baseProjects, ...extraProjects];

  const baseTechs = selectEntities(TECHNOLOGIES, 12, rng);
  const extraTechs = makeExtraTechs(8, 0);
  const allTechs = [...baseTechs, ...extraTechs];

  const allEntities = [...allConcepts, ...allOrgs, ...allProjects, ...allTechs];
  // Total: 22+21+33+20 = 96

  const notes: NoteDef[] = [];
  const allGt: GroundTruthEntry[] = [];

  // Level 1: Root organization
  const rootOrg = allOrgs[0];
  const l2Depts = allOrgs.slice(1, 5); // 4 departments
  const rootLinks = l2Depts.map(d => d.name);
  notes.push(makeContentNote(
    `company/${slugify(rootOrg.name)}.md`, rootOrg.name, 'company',
    [
      `# ${rootOrg.name}`,
      '',
      `${rootOrg.name} is the parent organization. It has ${l2Depts.length} departments:`,
      `${rootLinks.map(n => `- [[${n}]]`).join('\n')}`,
    ].join('\n'),
    rootLinks, { type: 'organizations' },
  ));

  // Level 2: 4 department notes
  const teamsPerDept = 4;
  const l3Teams = allOrgs.slice(5, 5 + l2Depts.length * teamsPerDept);

  for (let di = 0; di < l2Depts.length; di++) {
    const dept = l2Depts[di];
    const teams = l3Teams.slice(di * teamsPerDept, (di + 1) * teamsPerDept);
    const deptLinks = teams.map(t => t.name);

    const content = [
      `# ${dept.name}`,
      '',
      `${dept.name} is a department under ${rootOrg.name}.`,
      '',
      '## Teams',
      `${deptLinks.map(n => `- [[${n}]]`).join('\n')}`,
    ].join('\n');
    const path = `teams/${slugify(dept.name)}.md`;
    notes.push(makeContentNote(path, dept.name, 'teams', content, deptLinks, { type: 'organizations' }));
    allGt.push(...collectGroundTruth(path, content, allEntities, new Set(deptLinks)));
  }

  // Level 3: 16 team notes linking to projects/techs
  const projectsPerTeam = Math.ceil(allProjects.length / l3Teams.length);
  const techsPerTeam = Math.ceil(allTechs.length / l3Teams.length);

  for (let ti = 0; ti < l3Teams.length; ti++) {
    const team = l3Teams[ti];
    const teamProjects = allProjects.slice(ti * projectsPerTeam, (ti + 1) * projectsPerTeam).slice(0, 4);
    const teamTechs = allTechs.slice(ti * techsPerTeam, (ti + 1) * techsPerTeam).slice(0, 3);
    const teamLinks = [...teamProjects, ...teamTechs].map(e => e.name);

    const parentDept = l2Depts[Math.floor(ti / teamsPerDept)];

    const content = [
      `# ${team.name}`,
      '',
      `${team.name} is part of ${parentDept.name}.`,
      '',
      '## Projects',
      `${teamProjects.map(p => `- [[${p.name}]]`).join('\n')}`,
      '',
      '## Technologies',
      `${teamTechs.map(t => `- [[${t.name}]]`).join('\n')}`,
    ].join('\n');

    const path = `teams/${slugify(team.name)}.md`;
    notes.push(makeContentNote(path, team.name, 'teams', content, teamLinks, { type: 'organizations' }));
    allGt.push(...collectGroundTruth(path, content, allEntities, new Set(teamLinks)));
  }

  // Level 4: Leaf notes (projects, techs, concepts)
  const usedPaths = new Set(notes.map(n => n.path));

  for (const project of allProjects) {
    const path = `projects/${slugify(project.name)}.md`;
    if (usedPaths.has(path)) continue;
    usedPaths.add(path);

    const relatedTech = pick(rng, allTechs);
    const relatedConcept = pick(rng, allConcepts);
    // Use alias for one mention to get T2
    const techAlias = pickAlias(relatedTech);
    const techMention = techAlias || relatedTech.name;

    const content = [
      `# ${project.name}`,
      '',
      `${project.name} is an internal project. Built with ${techMention}.`,
      `Follows ${relatedConcept.name} principles.`,
    ].join('\n');

    notes.push(makeContentNote(path, project.name, 'projects', content, [], { type: 'projects' }));
    allGt.push(...collectGroundTruth(path, content, allEntities, new Set()));
  }

  for (const tech of allTechs) {
    const path = `technologies/${slugify(tech.name)}.md`;
    if (usedPaths.has(path)) continue;
    usedPaths.add(path);

    notes.push(makeContentNote(path, tech.name, 'technologies',
      `# ${tech.name}\n\n${tech.name} is used across the organization.`,
      [], { type: 'technologies' }));
  }

  for (const concept of allConcepts) {
    const path = `concepts/${slugify(concept.name)}.md`;
    if (usedPaths.has(path)) continue;
    usedPaths.add(path);

    notes.push(makeContentNote(path, concept.name, 'concepts',
      `# ${concept.name}\n\n${concept.name} is an engineering concept.`,
      [], { type: 'concepts' }));
  }

  for (const org of allOrgs) {
    const possiblePaths = [
      `company/${slugify(org.name)}.md`,
      `teams/${slugify(org.name)}.md`,
      `organizations/${slugify(org.name)}.md`,
    ];
    if (possiblePaths.some(p => usedPaths.has(p))) continue;
    const path = `organizations/${slugify(org.name)}.md`;
    usedPaths.add(path);

    notes.push(makeContentNote(path, org.name, 'organizations',
      `# ${org.name}\n\n${org.name} is part of the organization.`,
      [], { type: 'organizations' }));
  }

  // If we need one more note to hit 97, add an overview note
  if (notes.length < 97) {
    const overviewContent = [
      '# Organization Overview',
      '',
      `This vault documents the structure of ${rootOrg.name}.`,
      `The organization has ${l2Depts.length} departments and ${l3Teams.length} teams.`,
      `They work on ${allProjects.length} projects using ${allTechs.length} technologies.`,
    ].join('\n');
    notes.push(makeContentNote('overview.md', 'Organization Overview', '.', overviewContent, []));
    allGt.push(...collectGroundTruth('overview.md', overviewContent, allEntities, new Set()));
  }

  const finalGt = dedup(allGt);
  const t1 = finalGt.filter(g => g.tier === 1).slice(0, 19);
  const t2 = finalGt.filter(g => g.tier === 2).slice(0, 5);

  return {
    archetype: 'hierarchical',
    seed: 102,
    description: 'Strict hierarchy: root -> departments -> teams -> leaf notes. Only parent-to-child links. Tests cross-level linking, depth navigation, and bridge discovery.',
    entities: allEntities.map(toEntitySpec),
    notes,
    groundTruth: [...t1, ...t2],
  };
}

// =============================================================================
// Bridge-Network Generator
// Target: 63 entities, 86 notes, 25 GT (T1=6, T2=14, T3=5)
// =============================================================================

function generateBridgeNetwork(): Fixture {
  const rng = mulberry32(105);

  // 63 entities: concepts(37), people(5), projects(6), technologies(9),
  // organizations(2), locations(1), health(2), acronyms(1)
  const baseConcepts = selectEntities(CONCEPTS, 12, rng);
  const extraConcepts = makeExtraConcepts(25, 22);
  const concepts = [...baseConcepts, ...extraConcepts];
  const people = selectEntities(PEOPLE, 5, rng);
  const projects = selectEntities(PROJECTS, 6, rng);
  const technologies = selectEntities(TECHNOLOGIES, 9, rng);
  const organizations = selectEntities(ORGANIZATIONS, 2, rng);
  const locations = selectEntities(LOCATIONS, 1, rng);
  const health = selectEntities(HEALTH, 2, rng);
  const acronyms = selectEntities(ACRONYMS, 1, rng);

  const allEntities = [
    ...concepts, ...people, ...projects, ...technologies,
    ...organizations, ...locations, ...health, ...acronyms,
  ];
  // Total: 37+5+6+9+2+1+2+1 = 63

  const notes: NoteDef[] = [];
  const allGt: GroundTruthEntry[] = [];

  // 4 clusters
  const clusterDefs = [
    { name: 'frontend', folder: 'cluster-frontend', concepts: concepts.slice(0, 9), tech: technologies.slice(0, 2), project: projects[0] },
    { name: 'backend', folder: 'cluster-backend', concepts: concepts.slice(9, 18), tech: technologies.slice(2, 5), project: projects[1] },
    { name: 'infra', folder: 'cluster-infra', concepts: concepts.slice(18, 27), tech: technologies.slice(5, 7), project: projects[2] },
    { name: 'product', folder: 'cluster-product', concepts: concepts.slice(27, 37), tech: technologies.slice(7, 9), project: projects[3] },
  ];

  // Generate cluster notes (each cluster has ~13 notes)
  for (const cluster of clusterDefs) {
    const clusterEnts = [...cluster.concepts, ...cluster.tech, cluster.project];

    for (let ni = 0; ni < clusterEnts.length; ni++) {
      const entity = clusterEnts[ni];
      const others = clusterEnts.filter(e => e !== entity);
      const linkCount = Math.min(3 + Math.floor(rng() * 4), others.length);
      const linkTargets = shuffle(rng, others).slice(0, linkCount);
      const links = linkTargets.map(e => e.name);

      // Mention non-cluster entities for GT (use aliases for T2)
      const nonCluster = allEntities.filter(e => !clusterEnts.includes(e));
      const mentions = shuffle(rng, nonCluster).slice(0, 3);
      const alias0 = mentions[0] ? pickAlias(mentions[0]) : undefined;
      const alias1 = mentions[1] ? pickAlias(mentions[1]) : undefined;

      const content = [
        `# ${entity.name}`,
        '',
        `${entity.name} is a core ${cluster.name} component.`,
        `Integrates with ${links.slice(0, 3).map(n => `[[${n}]]`).join(', ')}.`,
        '',
        links.length > 3 ? `Also connects to ${links.slice(3).map(n => `[[${n}]]`).join(', ')}.` : '',
        '',
        alias0 ? `${alias0} expertise is relevant here.` : (mentions[0] ? `${mentions[0].name} has relevant expertise.` : ''),
        alias1 ? `Uses ${alias1} conventions.` : (mentions[1] ? `See also: ${mentions[1].name}.` : ''),
        mentions[2] ? `Related to ${mentions[2].name}.` : '',
      ].join('\n');

      const path = `${cluster.folder}/${slugify(entity.name)}.md`;
      notes.push(makeContentNote(path, entity.name, cluster.folder, content, links, { type: entity.category }));
      allGt.push(...collectGroundTruth(path, content, allEntities, new Set(links)));
    }
  }

  // 3 bridge notes connecting pairs of clusters
  const bridgePairs: [number, number][] = [[0, 1], [1, 2], [2, 3]];
  for (const [ci1, ci2] of bridgePairs) {
    const c1 = clusterDefs[ci1];
    const c2 = clusterDefs[ci2];
    const bridgePerson = pick(rng, people);
    const bridgeLinks = [
      pick(rng, c1.concepts).name,
      pick(rng, c1.tech).name,
      pick(rng, c2.concepts).name,
      pick(rng, c2.tech).name,
    ];

    // Use aliases for some mentions
    const aliasPerson = pickAlias(bridgePerson);
    const personMention = aliasPerson || bridgePerson.name;

    const content = [
      `# Bridge: ${c1.name} to ${c2.name}`,
      '',
      `${personMention} works across both ${c1.name} and ${c2.name}.`,
      '',
      `## ${c1.name} Side`,
      `Connects to [[${bridgeLinks[0]}]] and [[${bridgeLinks[1]}]].`,
      '',
      `## ${c2.name} Side`,
      `Connects to [[${bridgeLinks[2]}]] and [[${bridgeLinks[3]}]].`,
    ].join('\n');

    const path = `bridges/bridge-${c1.name}-${c2.name}.md`;
    notes.push(makeContentNote(path, `Bridge: ${c1.name}-${c2.name}`, 'bridges', content, bridgeLinks));
    allGt.push(...collectGroundTruth(path, content, allEntities, new Set(bridgeLinks)));
  }

  // Isolated notes: people, orgs, locations, health, acronyms, remaining projects
  const isolatedEnts = [...people, ...organizations, ...locations, ...health, ...acronyms, ...projects.slice(4)];
  const usedPaths = new Set(notes.map(n => n.path));
  for (const entity of isolatedEnts) {
    const path = `${entity.folder}/${slugify(entity.name)}.md`;
    if (usedPaths.has(path)) continue;
    usedPaths.add(path);

    const mention = pick(rng, allEntities.filter(e => e !== entity));
    const mentionAlias = pickAlias(mention);
    const mentionText = mentionAlias || mention.name;

    const content = [
      `# ${entity.name}`,
      '',
      `${entity.name} -- ${entity.category}.`,
      '',
      `Related to ${mentionText}.`,
    ].join('\n');

    notes.push(makeContentNote(path, entity.name, entity.folder, content, [],
      { type: entity.category }));
    allGt.push(...collectGroundTruth(path, content, allEntities, new Set()));
  }

  // Fill remaining notes with daily notes
  let dayIdx = 0;
  while (notes.length < 86) {
    const date = `2025-01-${String(dayIdx + 1).padStart(2, '0')}`;
    const m1 = pick(rng, allEntities);
    const m2 = pick(rng, allEntities.filter(e => e !== m1));
    const alias1 = pickAlias(m1);

    const content = [
      `# Daily ${date}`,
      '',
      `Worked on ${alias1 || m1.name} and ${m2.name} today.`,
    ].join('\n');

    notes.push(makeContentNote(`daily/${date}.md`, `Daily ${date}`, 'daily', content, []));
    allGt.push(...collectGroundTruth(`daily/${date}.md`, content, allEntities, new Set()));
    dayIdx++;
  }

  // T3 contextual links
  const t3Entries: GroundTruthEntry[] = [];
  const t3Candidates = shuffle(rng, allEntities);
  for (const entity of t3Candidates) {
    if (t3Entries.length >= 5) break;
    const targetNote = notes.find(
      n => !n.links.includes(entity.name) && !n.content.includes(entity.name)
        && !entity.aliases.some(a => a.length >= 3 && n.content.includes(a))
    );
    if (targetNote) {
      t3Entries.push({
        notePath: targetNote.path,
        entity: entity.name,
        tier: 3,
        reason: `${entity.name} is contextually related to ${targetNote.title} through domain proximity`,
      });
    }
  }

  const finalGt = dedup([...allGt, ...t3Entries]);
  const t1 = finalGt.filter(g => g.tier === 1).slice(0, 6);
  const t2 = finalGt.filter(g => g.tier === 2).slice(0, 14);
  const t3 = finalGt.filter(g => g.tier === 3).slice(0, 5);

  return {
    archetype: 'bridge-network',
    seed: 105,
    description: '4 clusters of related notes connected by bridge notes. Each cluster internally well-connected. Tests bridge emergence, betweenness centrality, and cluster merging.',
    entities: allEntities.map(toEntitySpec),
    notes,
    groundTruth: [...t1, ...t2, ...t3],
  };
}

// =============================================================================
// Small-World Generator
// Target: 100 entities, 100 notes, 30 GT (T1=12, T2=11, T3=7)
// =============================================================================

function generateSmallWorld(): Fixture {
  const rng = mulberry32(106);

  // 100 entities: concepts(57), people(8), projects(18), technologies(8),
  // locations(3), organizations(6)
  const baseConcepts = selectEntities(CONCEPTS, 12, rng);
  const extraConcepts = makeExtraConcepts(45, 0);
  const concepts = [...baseConcepts, ...extraConcepts];
  const people = selectEntities(PEOPLE, 8, rng);
  const projects = selectEntities(PROJECTS, 18, rng);
  const technologies = selectEntities(TECHNOLOGIES, 8, rng);
  const locations = selectEntities(LOCATIONS, 3, rng);
  const organizations = selectEntities(ORGANIZATIONS, 6, rng);

  const allEntities = [
    ...concepts, ...people, ...projects, ...technologies,
    ...locations, ...organizations,
  ];
  // Total: 57+8+18+8+3+6 = 100

  const notes: NoteDef[] = [];
  const allGt: GroundTruthEntry[] = [];

  // 10 clusters of 10 entities each
  const clusterFolders = [
    'platform', 'frontend', 'backend', 'data-eng', 'ml-research',
    'operations', 'security', 'mobile', 'testing', 'devrel',
  ];

  const shuffledEnts = shuffle(rng, allEntities);
  const clusterEntities: EntityDef[][] = clusterFolders.map((_, i) =>
    shuffledEnts.slice(i * 10, (i + 1) * 10)
  );

  for (let ci = 0; ci < clusterFolders.length; ci++) {
    const folder = clusterFolders[ci];
    const clusterEnts = clusterEntities[ci];

    for (let ni = 0; ni < clusterEnts.length; ni++) {
      const entity = clusterEnts[ni];
      const links: string[] = [];

      // High clustering: link to 2-4 neighbors
      const neighbors = clusterEnts.filter(e => e !== entity);
      const nearLinks = shuffle(rng, neighbors).slice(0, 2 + Math.floor(rng() * 3));
      links.push(...nearLinks.map(e => e.name));

      // ~20% chance of shortcut to another cluster
      if (rng() < 0.2) {
        const otherCI = (ci + 1 + Math.floor(rng() * (clusterFolders.length - 1))) % clusterFolders.length;
        const shortcut = pick(rng, clusterEntities[otherCI]);
        if (!links.includes(shortcut.name)) {
          links.push(shortcut.name);
        }
      }

      // Mention entities for GT (use aliases for T2)
      const unlinked = allEntities.filter(e => !links.includes(e.name) && e !== entity);
      const mentions = shuffle(rng, unlinked).slice(0, 2);
      const alias0 = mentions[0] ? pickAlias(mentions[0]) : undefined;

      const content = [
        `# ${entity.name}`,
        '',
        `${entity.name} handles ${entity.category} at the organization.`,
        `Integrates with ${links.slice(0, 3).map(n => `[[${n}]]`).join(', ')}.`,
        '',
        links.length > 3 ? `Also connected to ${links.slice(3).map(n => `[[${n}]]`).join(', ')}.` : '',
        '',
        alias0 ? `${alias0} has related documentation.` : (mentions[0] ? `${mentions[0].name} has related documentation.` : ''),
        mentions[1] ? `See also: ${mentions[1].name}.` : '',
      ].join('\n');

      const path = `${folder}/${slugify(entity.name)}.md`;
      notes.push(makeContentNote(path, entity.name, folder, content, links, { type: entity.category }));
      allGt.push(...collectGroundTruth(path, content, allEntities, new Set(links)));
    }
  }

  // T3 contextual links
  const t3Entries: GroundTruthEntry[] = [];
  const t3Candidates = shuffle(rng, allEntities);
  for (const entity of t3Candidates) {
    if (t3Entries.length >= 7) break;
    const targetNote = notes.find(
      n => !n.links.includes(entity.name) && !n.content.includes(entity.name)
        && !entity.aliases.some(a => a.length >= 3 && n.content.includes(a))
    );
    if (targetNote) {
      t3Entries.push({
        notePath: targetNote.path,
        entity: entity.name,
        tier: 3,
        reason: `${entity.name} is contextually related to ${targetNote.title} through shared domain`,
      });
    }
  }

  const finalGt = dedup([...allGt, ...t3Entries]);
  const t1 = finalGt.filter(g => g.tier === 1).slice(0, 12);
  const t2 = finalGt.filter(g => g.tier === 2).slice(0, 11);
  const t3 = finalGt.filter(g => g.tier === 3).slice(0, 7);

  return {
    archetype: 'small-world',
    seed: 106,
    description: 'Small-world network with 10 clusters of 10 notes. High clustering within clusters, random shortcut links between clusters. Tests path length maintenance and clustering.',
    entities: allEntities.map(toEntitySpec),
    notes,
    groundTruth: [...t1, ...t2, ...t3],
  };
}

// =============================================================================
// Sparse-Orphan Generator
// Target: 49 entities, 99 notes, 31 GT (T1=23, T2=8, T3=0)
// =============================================================================

function generateSparseOrphan(): Fixture {
  const rng = mulberry32(104);

  // 49 entities: people(8), projects(6), technologies(2), concepts(8),
  // organizations(4), locations(3), health(3), acronyms(1), animals(2), media(3), documents(9)
  const people = selectEntities(PEOPLE, 8, rng);
  const projects = selectEntities(PROJECTS, 6, rng);
  const technologies = selectEntities(TECHNOLOGIES, 2, rng);
  const concepts = selectEntities(CONCEPTS, 8, rng);
  const organizations = selectEntities(ORGANIZATIONS, 4, rng);
  const locations = selectEntities(LOCATIONS, 3, rng);
  const health = selectEntities(HEALTH, 3, rng);
  const acronyms = selectEntities(ACRONYMS, 1, rng);
  const animals = selectEntities(ANIMALS, 2, rng);
  const media = selectEntities(MEDIA, 3, rng);
  const documents = selectEntities(DOCUMENTS, 9, rng);

  const allEntities = [
    ...people, ...projects, ...technologies, ...concepts,
    ...organizations, ...locations, ...health, ...acronyms,
    ...animals, ...media, ...documents,
  ];
  // Total: 8+6+2+8+4+3+3+1+2+3+9 = 49

  const notes: NoteDef[] = [];
  const allGt: GroundTruthEntry[] = [];

  // Entity notes (49 notes, mostly orphans)
  for (const entity of allEntities) {
    const path = `${entity.folder}/${slugify(entity.name)}.md`;
    const related = shuffle(rng, allEntities.filter(e => e !== entity)).slice(0, 3);

    // Only ~20% have links
    const hasLinks = rng() < 0.2;
    const links: string[] = [];
    if (hasLinks && related.length > 0) links.push(related[0].name);

    // Mention related entities (use aliases for T2)
    const unlinked = related.filter(e => !links.includes(e.name));
    const alias0 = unlinked[0] ? pickAlias(unlinked[0]) : undefined;

    const content = [
      `# ${entity.name}`,
      '',
      `${entity.name} -- ${entity.category}.`,
      '',
      hasLinks && links.length > 0 ? `Related to [[${links[0]}]].` : '',
      unlinked[0] ? `Also relevant: ${alias0 || unlinked[0].name}.` : '',
      unlinked[1] ? `See: ${unlinked[1].name}.` : '',
    ].join('\n');

    const fm: Record<string, unknown> = { type: entity.category };
    if (entity.aliases.length > 0) fm.aliases = entity.aliases;

    notes.push(makeContentNote(path, entity.name, entity.folder, content, links, fm));
    allGt.push(...collectGroundTruth(path, content, allEntities, new Set(links)));
  }

  // Daily notes (30 orphan daily notes -- no wikilinks)
  for (let i = 0; i < 30; i++) {
    const month = Math.floor(i / 28) + 1;
    const day = (i % 28) + 1;
    const date = `2025-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    const mentions = shuffle(rng, allEntities).slice(0, 2 + Math.floor(rng() * 3));
    // Use alias for one mention
    const alias0 = mentions.length > 0 ? pickAlias(mentions[0]) : undefined;

    const content = [
      `# Daily ${date}`,
      '',
      '## Notes',
      alias0 ? `- ${alias0}: worked on this today` : (mentions[0] ? `- ${mentions[0].name}: worked on this today` : ''),
      ...mentions.slice(1).map(m => `- ${m.name}: worked on this today`),
    ].join('\n');

    notes.push(makeContentNote(`daily/${date}.md`, `Daily ${date}`, 'daily', content, [], { type: 'daily' }));
    allGt.push(...collectGroundTruth(`daily/${date}.md`, content, allEntities, new Set()));
  }

  // Stub notes (20 completely empty or near-empty notes)
  const stubNames = [
    'scratch-pad', 'todo-list', 'brainstorm', 'quick-note', 'meeting-draft',
    'idea-dump', 'link-collection', 'reading-list', 'reference', 'bookmarks',
    'inbox', 'temp-notes', 'clipboard', 'snippets', 'sandbox',
    'draft-1', 'draft-2', 'untitled-1', 'untitled-2', 'misc',
  ];
  for (let i = 0; i < 20; i++) {
    const stubName = stubNames[i];
    const content = i < 5
      ? `# ${stubName}\n\nNo content yet.`
      : `# ${stubName}`;

    notes.push(makeContentNote(`stubs/${stubName}.md`, stubName, 'stubs', content, []));
  }

  const finalGt = dedup(allGt);
  const t1 = finalGt.filter(g => g.tier === 1).slice(0, 23);
  const t2 = finalGt.filter(g => g.tier === 2).slice(0, 8);

  return {
    archetype: 'sparse-orphan',
    seed: 104,
    description: 'Low connectivity vault with >50% orphan notes. Entity notes exist but rarely referenced. Many stub/empty notes. Tests orphan reduction rate and cold-start scenarios.',
    entities: allEntities.map(toEntitySpec),
    notes,
    groundTruth: [...t1, ...t2],
  };
}

// =============================================================================
// Main
// =============================================================================

const GENERATORS: Record<string, () => Fixture> = {
  'hub-and-spoke': generateHubAndSpoke,
  'dense-mesh': generateDenseMesh,
  'hierarchical': generateHierarchical,
  'bridge-network': generateBridgeNetwork,
  'small-world': generateSmallWorld,
  'sparse-orphan': generateSparseOrphan,
};

function main() {
  const archetype = process.argv[2];
  if (!archetype || !GENERATORS[archetype]) {
    console.error(`Usage: npx tsx generate-archetypes.ts <archetype>`);
    console.error(`Available: ${Object.keys(GENERATORS).join(', ')}`);
    process.exit(1);
  }

  const fixture = GENERATORS[archetype]();
  console.log(JSON.stringify(fixture, null, 2));
}

main();
