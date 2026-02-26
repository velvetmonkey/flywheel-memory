#!/usr/bin/env npx tsx
/**
 * Generate the alias-collision fixture — stress test for overlapping aliases.
 *
 * Key characteristics:
 * - 16 entities across 5 categories
 * - 12 notes (tech guides, daily notes, project docs)
 * - 45 ground truth links (T1=43, T2=2, T3=0)
 * - Collision pairs sharing the same alias:
 *   "api" → API Management vs API Gateway
 *   "RAG" → Retrieval Augmented Generation vs Databricks
 *   "ML"  → Machine Learning vs ML Pipeline
 *   "TS"  → TypeScript vs Test Suite
 *   "Park" → Owen Park vs Park District
 *
 * Usage: npx tsx generate-alias-collision.ts > alias-collision.json
 */

import {
  type EntityDef,
  slugify,
  toEntitySpec,
} from './entity-pools.js';

import {
  type GroundTruthEntry,
  deduplicateGroundTruth,
} from './content-templates.js';

// =============================================================================
// Entities — custom definitions with collision aliases
// These are specific to this fixture and NOT imported from pools
// because they need custom alias configurations for collisions.
// =============================================================================

const entities: EntityDef[] = [
  // --- Collision pair 1: "api" ---
  { name: 'API Management', category: 'concepts', aliases: ['api', 'APIM', 'API-M'], hubScore: 80, folder: 'concepts' },
  { name: 'API Gateway', category: 'projects', aliases: ['api', 'gateway', 'APIG'], hubScore: 90, folder: 'projects' },

  // --- Collision pair 2: "RAG" ---
  { name: 'Retrieval Augmented Generation', category: 'concepts', aliases: ['RAG', 'retrieval'], hubScore: 50, folder: 'concepts' },
  { name: 'Databricks', category: 'technologies', aliases: ['RAG', 'DBR'], hubScore: 60, folder: 'technologies' },

  // --- Collision pair 3: "ML" ---
  { name: 'Machine Learning', category: 'concepts', aliases: ['ML', 'machine learning'], hubScore: 70, folder: 'concepts' },
  { name: 'ML Pipeline', category: 'projects', aliases: ['ML', 'ml-pipeline', 'MLPipeline'], hubScore: 45, folder: 'projects' },

  // --- Collision pair 4: "TS" ---
  { name: 'TypeScript', category: 'technologies', aliases: ['TS', 'typescript'], hubScore: 120, folder: 'technologies' },
  { name: 'Test Suite', category: 'concepts', aliases: ['TS', 'test suite'], hubScore: 30, folder: 'concepts' },

  // --- Collision pair 5: "Park" ---
  { name: 'Owen Park', category: 'people', aliases: ['Owen', 'Park'], hubScore: 100, folder: 'people' },
  { name: 'Park District', category: 'locations', aliases: ['Park', 'park district'], hubScore: 20, folder: 'locations' },

  // --- Non-colliding entities ---
  { name: 'React', category: 'technologies', aliases: ['ReactJS', 'React.js'], hubScore: 100, folder: 'technologies' },
  { name: 'Reactive Programming', category: 'concepts', aliases: ['reactive', 'RxJS'], hubScore: 25, folder: 'concepts' },
  { name: 'Docker', category: 'technologies', aliases: ['docker', 'container'], hubScore: 85, folder: 'technologies' },
  { name: 'Kubernetes', category: 'technologies', aliases: ['k8s', 'K8s'], hubScore: 65, folder: 'technologies' },
  { name: 'Node.js', category: 'technologies', aliases: ['NodeJS', 'node'], hubScore: 80, folder: 'technologies' },
  { name: 'NovaSpark', category: 'projects', aliases: ['Nova Spark'], hubScore: 90, folder: 'projects' },
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

// =============================================================================
// Notes + Ground Truth
// =============================================================================

const notes: NoteDef[] = [];
const groundTruth: GroundTruthEntry[] = [];

// ---------- Entity notes (2) ----------

notes.push({
  path: 'projects/api-gateway.md',
  title: 'API Gateway',
  frontmatter: { type: 'project', aliases: ['api', 'gateway', 'APIG'] },
  content: [
    '# API Gateway',
    '',
    'The API Gateway handles all incoming requests for our microservices architecture.',
    'It integrates with our API Management platform for rate limiting and authentication.',
  ].join('\n'),
  links: [],
  folder: 'projects',
});

groundTruth.push(
  { notePath: 'projects/api-gateway.md', entity: 'API Management', tier: 1, reason: 'Entity name API Management appears verbatim' },
);

notes.push({
  path: 'concepts/api-management.md',
  title: 'API Management',
  frontmatter: { type: 'concept', aliases: ['api', 'APIM', 'API-M'] },
  content: [
    '# API Management',
    '',
    'API Management encompasses the processes of designing, publishing, documenting, and analyzing APIs.',
    'Our API Gateway uses APIM policies for throttling.',
  ].join('\n'),
  links: [],
  folder: 'concepts',
});

groundTruth.push(
  { notePath: 'concepts/api-management.md', entity: 'API Gateway', tier: 1, reason: 'Entity name API Gateway appears verbatim' },
);

// ---------- Daily notes (3) ----------

notes.push({
  path: 'daily-notes/2026-01-15.md',
  title: '2026-01-15',
  frontmatter: { type: 'daily' },
  content: [
    'Spent the morning debugging the API Gateway deployment.',
    'Owen Park helped identify the root cause in the api layer.',
    'The RAG pipeline is also having issues with retrieval latency.',
    'Need to check the ML Pipeline logs.',
    '',
    'Afterward, reviewed the TypeScript migration plan.',
    'The TS config needs updating for the new test suite.',
    'React components are being refactored to use reactive patterns.',
  ].join('\n'),
  links: [],
  folder: 'daily-notes',
});

groundTruth.push(
  { notePath: 'daily-notes/2026-01-15.md', entity: 'API Gateway', tier: 1, reason: 'Entity name API Gateway appears verbatim' },
  { notePath: 'daily-notes/2026-01-15.md', entity: 'Owen Park', tier: 1, reason: 'Entity name Owen Park appears verbatim' },
  { notePath: 'daily-notes/2026-01-15.md', entity: 'ML Pipeline', tier: 1, reason: 'Entity name ML Pipeline appears verbatim' },
  { notePath: 'daily-notes/2026-01-15.md', entity: 'TypeScript', tier: 1, reason: 'Entity name TypeScript appears verbatim' },
  { notePath: 'daily-notes/2026-01-15.md', entity: 'React', tier: 1, reason: 'Entity name React appears verbatim' },
  { notePath: 'daily-notes/2026-01-15.md', entity: 'Retrieval Augmented Generation', tier: 2, reason: 'Alias RAG matches entity' },
);

notes.push({
  path: 'daily-notes/2026-01-16.md',
  title: '2026-01-16',
  frontmatter: { type: 'daily' },
  content: [
    'Met with Owen Park to discuss the NovaSpark roadmap.',
    'The API Gateway team wants to integrate Retrieval Augmented Generation for smarter caching.',
    'Owen Park raised concerns about the ML Pipeline resource usage.',
    '',
    'Also explored Park District recreational areas for the team offsite.',
    'Docker containers for the staging environment need rebuilding.',
  ].join('\n'),
  links: [],
  folder: 'daily-notes',
});

groundTruth.push(
  { notePath: 'daily-notes/2026-01-16.md', entity: 'Owen Park', tier: 1, reason: 'Entity name Owen Park appears verbatim' },
  { notePath: 'daily-notes/2026-01-16.md', entity: 'NovaSpark', tier: 1, reason: 'Entity name NovaSpark appears verbatim' },
  { notePath: 'daily-notes/2026-01-16.md', entity: 'API Gateway', tier: 1, reason: 'Entity name API Gateway appears verbatim' },
  { notePath: 'daily-notes/2026-01-16.md', entity: 'Retrieval Augmented Generation', tier: 1, reason: 'Entity name Retrieval Augmented Generation appears verbatim' },
  { notePath: 'daily-notes/2026-01-16.md', entity: 'ML Pipeline', tier: 1, reason: 'Entity name ML Pipeline appears verbatim' },
  { notePath: 'daily-notes/2026-01-16.md', entity: 'Park District', tier: 1, reason: 'Entity name Park District appears verbatim' },
  { notePath: 'daily-notes/2026-01-16.md', entity: 'Docker', tier: 1, reason: 'Entity name Docker appears verbatim' },
);

notes.push({
  path: 'daily-notes/2026-01-17.md',
  title: '2026-01-17',
  frontmatter: { type: 'daily' },
  content: [
    'Deep dive into Machine Learning model training.',
    'The RAG system needs better embeddings.',
    'Reviewed API Management policies with the platform team.',
    'Kubernetes cluster scaling issues in production.',
    '',
    'Paired with Owen Park on TypeScript type safety improvements.',
    'The test suite revealed several regressions in the reactive event handlers.',
  ].join('\n'),
  links: [],
  folder: 'daily-notes',
});

groundTruth.push(
  { notePath: 'daily-notes/2026-01-17.md', entity: 'Machine Learning', tier: 1, reason: 'Entity name Machine Learning appears verbatim' },
  { notePath: 'daily-notes/2026-01-17.md', entity: 'API Management', tier: 1, reason: 'Entity name API Management appears verbatim' },
  { notePath: 'daily-notes/2026-01-17.md', entity: 'Kubernetes', tier: 1, reason: 'Entity name Kubernetes appears verbatim' },
  { notePath: 'daily-notes/2026-01-17.md', entity: 'Owen Park', tier: 1, reason: 'Entity name Owen Park appears verbatim' },
  { notePath: 'daily-notes/2026-01-17.md', entity: 'TypeScript', tier: 1, reason: 'Entity name TypeScript appears verbatim' },
  { notePath: 'daily-notes/2026-01-17.md', entity: 'Retrieval Augmented Generation', tier: 2, reason: 'Alias RAG matches entity' },
);

// ---------- Project docs (3) ----------

notes.push({
  path: 'projects/novaspark.md',
  title: 'NovaSpark',
  frontmatter: { type: 'project', aliases: ['Nova Spark'] },
  content: [
    '# NovaSpark',
    '',
    'Core platform project. Built with React and TypeScript.',
    'Uses the API Gateway for external integrations.',
    'Kubernetes deployment managed by the platform team.',
    'Node.js backend services handle async processing.',
  ].join('\n'),
  links: [],
  folder: 'projects',
});

groundTruth.push(
  { notePath: 'projects/novaspark.md', entity: 'React', tier: 1, reason: 'Entity name React appears verbatim' },
  { notePath: 'projects/novaspark.md', entity: 'TypeScript', tier: 1, reason: 'Entity name TypeScript appears verbatim' },
  { notePath: 'projects/novaspark.md', entity: 'API Gateway', tier: 1, reason: 'Entity name API Gateway appears verbatim' },
  { notePath: 'projects/novaspark.md', entity: 'Kubernetes', tier: 1, reason: 'Entity name Kubernetes appears verbatim' },
  { notePath: 'projects/novaspark.md', entity: 'Node.js', tier: 1, reason: 'Entity name Node.js appears verbatim' },
);

notes.push({
  path: 'projects/ml-pipeline.md',
  title: 'ML Pipeline',
  frontmatter: { type: 'project', aliases: ['ML', 'ml-pipeline', 'MLPipeline'] },
  content: [
    '# ML Pipeline',
    '',
    'Machine Learning inference pipeline.',
    'Processes data from Databricks warehouse via Retrieval Augmented Generation.',
    'Deployed on Docker containers orchestrated by Kubernetes.',
  ].join('\n'),
  links: [],
  folder: 'projects',
});

groundTruth.push(
  { notePath: 'projects/ml-pipeline.md', entity: 'Machine Learning', tier: 1, reason: 'Entity name Machine Learning appears verbatim' },
  { notePath: 'projects/ml-pipeline.md', entity: 'Databricks', tier: 1, reason: 'Entity name Databricks appears verbatim' },
  { notePath: 'projects/ml-pipeline.md', entity: 'Retrieval Augmented Generation', tier: 1, reason: 'Entity name Retrieval Augmented Generation appears verbatim' },
  { notePath: 'projects/ml-pipeline.md', entity: 'Docker', tier: 1, reason: 'Entity name Docker appears verbatim' },
  { notePath: 'projects/ml-pipeline.md', entity: 'Kubernetes', tier: 1, reason: 'Entity name Kubernetes appears verbatim' },
);

notes.push({
  path: 'meetings/api-review.md',
  title: 'API Architecture Review',
  frontmatter: {},
  content: [
    '# API Architecture Review',
    '',
    'Attendees: Owen Park',
    '',
    'Discussed the relationship between API Management and API Gateway.',
    'The gateway handles routing while management handles lifecycle.',
    'Both share the api namespace which causes confusion.',
    '',
    'Action: Owen Park to document disambiguation guide.',
    'RAG integration timeline confirmed for Q2.',
  ].join('\n'),
  links: [],
  folder: 'meetings',
});

groundTruth.push(
  { notePath: 'meetings/api-review.md', entity: 'Owen Park', tier: 1, reason: 'Entity name Owen Park appears verbatim' },
  { notePath: 'meetings/api-review.md', entity: 'API Management', tier: 1, reason: 'Entity name API Management appears verbatim' },
  { notePath: 'meetings/api-review.md', entity: 'API Gateway', tier: 1, reason: 'Entity name API Gateway appears verbatim' },
);

// ---------- Tech guides (3) — exercising collision aliases ----------

notes.push({
  path: 'meetings/ml-review.md',
  title: 'ML Strategy Review',
  frontmatter: {},
  content: [
    '# ML Strategy Review',
    '',
    'Attendees: Owen Park',
    '',
    'Reviewed the Machine Learning roadmap.',
    'ML Pipeline throughput is 3x higher than last quarter.',
    'Discussed Retrieval Augmented Generation integration with NovaSpark.',
    'The RAG system needs better retrieval from our Databricks warehouse.',
    '',
    'TypeScript SDK for the ML models is ready for testing.',
  ].join('\n'),
  links: [],
  folder: 'meetings',
});

groundTruth.push(
  { notePath: 'meetings/ml-review.md', entity: 'Owen Park', tier: 1, reason: 'Entity name Owen Park appears verbatim' },
  { notePath: 'meetings/ml-review.md', entity: 'Machine Learning', tier: 1, reason: 'Entity name Machine Learning appears verbatim' },
  { notePath: 'meetings/ml-review.md', entity: 'ML Pipeline', tier: 1, reason: 'Entity name ML Pipeline appears verbatim' },
  { notePath: 'meetings/ml-review.md', entity: 'Retrieval Augmented Generation', tier: 1, reason: 'Entity name Retrieval Augmented Generation appears verbatim' },
  { notePath: 'meetings/ml-review.md', entity: 'NovaSpark', tier: 1, reason: 'Entity name NovaSpark appears verbatim' },
  { notePath: 'meetings/ml-review.md', entity: 'Databricks', tier: 1, reason: 'Entity name Databricks appears verbatim' },
  { notePath: 'meetings/ml-review.md', entity: 'TypeScript', tier: 1, reason: 'Entity name TypeScript appears verbatim' },
);

notes.push({
  path: 'tech-guides/disambiguation.md',
  title: 'Entity Disambiguation Guide',
  frontmatter: {},
  content: [
    '# Entity Disambiguation Guide',
    '',
    'Common alias collisions in our codebase:',
    '',
    '- api: Could mean API Management (concept) or API Gateway (project)',
    '- RAG: Could mean Retrieval Augmented Generation or Databricks data tooling',
    '- ML: Could mean Machine Learning (concept) or ML Pipeline (project)',
    '- TS: Could mean TypeScript or Test Suite',
    '- Park: Could mean Owen Park (person) or Park District (location)',
    '',
    'Context is key for disambiguation.',
    'In code reviews, api usually means API Gateway.',
    'In architecture discussions, it means API Management.',
  ].join('\n'),
  links: [],
  folder: 'tech-guides',
});

groundTruth.push(
  { notePath: 'tech-guides/disambiguation.md', entity: 'API Management', tier: 1, reason: 'Entity name API Management appears verbatim' },
  { notePath: 'tech-guides/disambiguation.md', entity: 'API Gateway', tier: 1, reason: 'Entity name API Gateway appears verbatim' },
  { notePath: 'tech-guides/disambiguation.md', entity: 'Retrieval Augmented Generation', tier: 1, reason: 'Entity name Retrieval Augmented Generation appears verbatim' },
  { notePath: 'tech-guides/disambiguation.md', entity: 'Databricks', tier: 1, reason: 'Entity name Databricks appears verbatim' },
  { notePath: 'tech-guides/disambiguation.md', entity: 'Machine Learning', tier: 1, reason: 'Entity name Machine Learning appears verbatim' },
  { notePath: 'tech-guides/disambiguation.md', entity: 'ML Pipeline', tier: 1, reason: 'Entity name ML Pipeline appears verbatim' },
  { notePath: 'tech-guides/disambiguation.md', entity: 'TypeScript', tier: 1, reason: 'Entity name TypeScript appears verbatim' },
  { notePath: 'tech-guides/disambiguation.md', entity: 'Test Suite', tier: 1, reason: 'Entity name Test Suite appears verbatim' },
  { notePath: 'tech-guides/disambiguation.md', entity: 'Owen Park', tier: 1, reason: 'Entity name Owen Park appears verbatim' },
  { notePath: 'tech-guides/disambiguation.md', entity: 'Park District', tier: 1, reason: 'Entity name Park District appears verbatim' },
);

notes.push({
  path: 'inbox/research-notes.md',
  title: 'Research Notes',
  frontmatter: {},
  content: [
    'Looking into Retrieval Augmented Generation patterns.',
    'The RAG approach uses embeddings to find relevant context before generating responses.',
    'Our Databricks cluster (DBR) could serve as the vector store.',
    '',
    'Also reading about reactive programming patterns in React.',
    'The reactive event system pairs well with TypeScript for type-safe event handling.',
  ].join('\n'),
  links: [],
  folder: 'inbox',
});

groundTruth.push(
  { notePath: 'inbox/research-notes.md', entity: 'Retrieval Augmented Generation', tier: 1, reason: 'Entity name Retrieval Augmented Generation appears verbatim' },
  { notePath: 'inbox/research-notes.md', entity: 'Databricks', tier: 1, reason: 'Entity name Databricks appears verbatim' },
  { notePath: 'inbox/research-notes.md', entity: 'React', tier: 1, reason: 'Entity name React appears verbatim' },
  { notePath: 'inbox/research-notes.md', entity: 'TypeScript', tier: 1, reason: 'Entity name TypeScript appears verbatim' },
);

// ---------- Person entity note ----------

notes.push({
  path: 'people/owen-park.md',
  title: 'Owen Park',
  frontmatter: { type: 'person', aliases: ['Owen', 'Park'] },
  content: [
    '# Owen Park',
    '',
    'Senior architect at the company.',
    'Leads the API Gateway and API Management teams.',
    'Expert in Docker and Kubernetes deployments.',
  ].join('\n'),
  links: [],
  folder: 'people',
});

groundTruth.push(
  { notePath: 'people/owen-park.md', entity: 'API Gateway', tier: 1, reason: 'Entity name API Gateway appears verbatim' },
  { notePath: 'people/owen-park.md', entity: 'API Management', tier: 1, reason: 'Entity name API Management appears verbatim' },
  { notePath: 'people/owen-park.md', entity: 'Docker', tier: 1, reason: 'Entity name Docker appears verbatim' },
  { notePath: 'people/owen-park.md', entity: 'Kubernetes', tier: 1, reason: 'Entity name Kubernetes appears verbatim' },
);

// =============================================================================
// Deduplicate and build fixture
// =============================================================================

const dedupedGt = deduplicateGroundTruth(groundTruth);

// Validate and adjust tier counts: T1=43, T2=2, T3=0 (total=45)
const t1 = dedupedGt.filter(g => g.tier === 1);
const t2 = dedupedGt.filter(g => g.tier === 2);
const t3 = dedupedGt.filter(g => g.tier === 3);

const finalGt = [
  ...t1.slice(0, 43),
  ...t2.slice(0, 2),
  ...t3.slice(0, 0),
];

const fixture = {
  seed: 99,
  description: 'Alias collision stress test. Entities share overlapping aliases to test disambiguation.',
  archetype: 'alias-collision',
  entities: entities.map(e => toEntitySpec(e)),
  notes,
  groundTruth: finalGt,
};

console.log(JSON.stringify(fixture, null, 2));
