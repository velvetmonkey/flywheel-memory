#!/usr/bin/env npx tsx
/**
 * Generate the primary-vault fixture — the main test vault for graph quality tests.
 *
 * Key characteristics:
 * - 61 entities across 15 categories
 * - 96 notes (15 daily, 20 inbox/content, 61 entity notes)
 * - 60 ground truth links: T1=24, T2=21, T3=15
 * - Folder structure: daily-notes/, inbox/project-docs/, inbox/tech-guides/, people/, projects/, etc.
 * - Uses seeded PRNG (seed: 42) for determinism
 *
 * Usage: npx tsx generate-primary-vault.ts > primary-vault.json
 */

import {
  type EntityDef,
  PEOPLE,
  PROJECTS,
  TECHNOLOGIES,
  CONCEPTS,
  ORGANIZATIONS,
  LOCATIONS,
  HEALTH,
  ACRONYMS,
  ANIMALS,
  MEDIA,
  EVENTS,
  DOCUMENTS,
  FINANCE,
  FOOD,
  HOBBIES,
  mulberry32,
  shuffle,
  slugify,
  toEntitySpec,
} from './entity-pools.js';

import {
  type GroundTruthEntry,
  entityNoteBody,
} from './content-templates.js';

// =============================================================================
// Entity selection (matching exact counts from current fixture)
// =============================================================================

// 8 people
const people = PEOPLE.slice(0, 8); // Nadia Reyes, Owen Park, Leo Vasquez, Mira Okonkwo, Tessa Liu, Freya Nakamura, Dmitri Sokolov, Amara Diallo

// 6 projects
const projects: EntityDef[] = [
  PROJECTS[0], // NovaSpark
  PROJECTS[1], // DataForge
  PROJECTS[2], // Prism Core
  PROJECTS[3], // Project Meridian
  PROJECTS[4], // CloudShift
  PROJECTS[5], // DevHub
];

// 8 technologies
const technologies = TECHNOLOGIES.slice(0, 8); // React, TypeScript, Python, Docker, Kubernetes, PostgreSQL, Redis, GraphQL

// 10 concepts (drop Domain Driven Design and Zero Trust)
const concepts = CONCEPTS.slice(0, 10);

// 4 organizations
const organizations = ORGANIZATIONS.slice(0, 4); // Meridian Labs, Apex Systems, Quantum Data, SkyForge

// 3 locations
const locations = LOCATIONS.slice(0, 3); // Portland, Zurich, Melbourne

// 3 health
const health = HEALTH.slice(0, 3); // Yoga, Swim, Supplements

// 4 acronyms
const acronyms = ACRONYMS.slice(0, 4); // Staging, Production, UAT, MCP

// 2 animals
const animals = ANIMALS.slice(0, 2); // Luna, Rex

// 3 media (all)
const media = [...MEDIA]; // Signal Patterns, Code Breakers, The Daily Build

// 2 events (both)
const events = [...EVENTS]; // DevCon 2026, Hackathon Spring

// 2 documents
const documents = DOCUMENTS.slice(0, 2); // Q1 Review, Architecture RFC

// 2 finance (both)
const finance = [...FINANCE]; // Q1 Budget, Expense Report

// 2 food (both)
const food = [...FOOD]; // Pho Bowl, Matcha Latte

// 2 hobbies (both)
const hobbies = [...HOBBIES]; // Rock Climbing, Board Games

// =============================================================================
// Adjust hubScores to match the range/distribution of the old fixture
// (old fixture range: 0-200)
// =============================================================================

// Override specific hub scores to match old fixture's pattern
// People: range 3-120 in old fixture -> keep similar
people[0].hubScore = 120; // Nadia Reyes (was 120 = David Chen)
people[1].hubScore = 60;  // Owen Park (was 60 = James Franklin)
people[2].hubScore = 45;  // Leo Vasquez (was 45 = Marcus Johnson)
people[3].hubScore = 35;  // Mira Okonkwo (was 35 = Elena Torres)
people[4].hubScore = 25;  // Tessa Liu (was 25 = Sarah O'Brien)
people[5].hubScore = 15;  // Freya Nakamura (was 15 = Aisha Patel)
people[6].hubScore = 8;   // Dmitri Sokolov (was 8 = Tom Williams)
people[7].hubScore = 3;   // Amara Diallo (was 3 = Priya Sharma)

// Projects: range 0-200 in old fixture
projects[0].hubScore = 200; // NovaSpark (= ESGHub)
projects[1].hubScore = 80;  // DataForge (= Vault Core)
projects[2].hubScore = 55;  // Prism Core (= DataPipeline)
projects[3].hubScore = 40;  // Project Meridian (= Project Atlas)
projects[4].hubScore = 30;  // CloudShift (= MobileFirst)
projects[5].hubScore = 0;   // DevHub (= Quantum Leap)

// Technologies: range 25-90
technologies[0].hubScore = 90;  // React
technologies[1].hubScore = 80;  // TypeScript
technologies[2].hubScore = 75;  // Python
technologies[3].hubScore = 65;  // Docker
technologies[4].hubScore = 70;  // Kubernetes
technologies[5].hubScore = 50;  // PostgreSQL
technologies[6].hubScore = 30;  // Redis
technologies[7].hubScore = 25;  // GraphQL

// Concepts: range 10-85
concepts[0].hubScore = 45;  // Microservices
concepts[1].hubScore = 60;  // DevOps
concepts[2].hubScore = 35;  // Agile
concepts[3].hubScore = 20;  // Clean Architecture
concepts[4].hubScore = 30;  // Observability
concepts[5].hubScore = 25;  // API-First
concepts[6].hubScore = 60;  // Machine Learning
concepts[7].hubScore = 50;  // Continuous Integration
concepts[8].hubScore = 20;  // Technical Debt
concepts[9].hubScore = 85;  // Event Sourcing (high score like Apple in old fixture)

// Organizations: range 15-55
organizations[0].hubScore = 55;  // Meridian Labs
organizations[1].hubScore = 40;  // Apex Systems
organizations[2].hubScore = 20;  // Quantum Data
organizations[3].hubScore = 15;  // SkyForge

// Locations: range 20-40
locations[0].hubScore = 40;  // Portland
locations[1].hubScore = 35;  // Zurich
locations[2].hubScore = 20;  // Melbourne

// Health: range 120-150
health[0].hubScore = 150; // Yoga
health[1].hubScore = 130; // Swim
health[2].hubScore = 120; // Supplements

// Acronyms: keep or adjust for old range
acronyms[0].hubScore = 100; // Staging (like API=100)
acronyms[1].hubScore = 60;  // Production (like CI/CD=60)
acronyms[2].hubScore = 45;  // UAT (like REST=45)
acronyms[3].hubScore = 15;  // MCP (like SLA=15)

// Animals: range 20-25
animals[0].hubScore = 25;  // Luna
animals[1].hubScore = 20;  // Rex

// Media: range 10-20
media[0].hubScore = 20;  // Signal Patterns (=The Matrix)
media[1].hubScore = 15;  // Code Breakers (=Dune)
media[2].hubScore = 10;  // The Daily Build (=Blade Runner)

// Events: range 18-22
events[0].hubScore = 22;  // DevCon 2026 (=Hackathon 2026)
events[1].hubScore = 18;  // Hackathon Spring (=Q1 Planning Offsite)

// Documents: range 25-30
documents[0].hubScore = 30;  // Q1 Review (=Onboarding Guide)
documents[1].hubScore = 25;  // Architecture RFC (=Architecture RFC Template)

// Finance: range 10-20
finance[0].hubScore = 20;  // Q1 Budget (=Budget Review Q1)
finance[1].hubScore = 10;  // Expense Report (=Stock Options)

// Food: range 15-40
food[0].hubScore = 40;  // Pho Bowl (=Espresso)
food[1].hubScore = 15;  // Matcha Latte (=Sourdough)

// Hobbies: range 12-30
hobbies[0].hubScore = 30;  // Rock Climbing (=Running)
hobbies[1].hubScore = 12;  // Board Games (=Photography)

// =============================================================================
// Combine all entities
// =============================================================================

const allEntities: EntityDef[] = [
  ...people,
  ...projects,
  ...technologies,
  ...concepts,
  ...organizations,
  ...locations,
  ...health,
  ...acronyms,
  ...animals,
  ...media,
  ...events,
  ...documents,
  ...finance,
  ...food,
  ...hobbies,
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
// PRNG
// =============================================================================

const rng = mulberry32(42);

// =============================================================================
// Note generation
// =============================================================================

/**
 * Hand-crafted daily notes with rich, interwoven narrative content.
 * Each note has a mix of wikilinked entities and unlinked entity mentions
 * to create natural ground truth links.
 */
function generateDailyNotes(): { notes: NoteDef[] } {
  const notes: NoteDef[] = [];

  // 15 daily notes from 2026-01-01 to 2026-01-15
  const dailyNoteData: Array<{
    date: string;
    links: string[];
    content: string;
  }> = [
    // Day 1
    {
      date: '2026-01-01',
      links: ['Yoga', 'Swim', 'Rex', 'NovaSpark', 'Nadia Reyes', 'Supplements', 'DevOps'],
      content: `Happy New Year! Started the day with a long [[Yoga]] session and a [[Swim]] at the local pool with [[Rex]] waiting outside. The fresh air was exactly what I needed after last night. Spent the afternoon reviewing the [[NovaSpark]] roadmap for Q1. [[Nadia Reyes]] sent over her architecture proposals for the new reporting module. Need to review them before the Monday standup. Also took my [[Supplements]] and feel energized for the year ahead. Thinking about how to improve our [[DevOps]] process for the sprint cycle.`,
    },
    // Day 2
    {
      date: '2026-01-02',
      links: ['Leo Vasquez', 'React', 'NovaSpark', 'Mira Okonkwo', 'Kubernetes', 'Meridian Labs', 'Yoga'],
      content: `First working day of the new year. Kicked off with a team standup where [[Leo Vasquez]] presented the updated [[React]] component library for [[NovaSpark]]. The new components look clean and well-documented. [[Mira Okonkwo]] flagged some concerns about the [[Kubernetes]] cluster memory usage over the holiday period. Scheduled a deep-dive with [[Meridian Labs]] engineering for tomorrow. Did my morning [[Yoga]] routine and felt good going into the day.`,
    },
    // Day 3
    {
      date: '2026-01-03',
      links: ['Mira Okonkwo', 'Meridian Labs', 'Kubernetes', 'DataForge', 'Python', 'Owen Park', 'Luna', 'Swim', 'Signal Patterns'],
      content: `Deep-dive session with [[Mira Okonkwo]] and [[Meridian Labs]] engineering on [[Kubernetes]] memory issues. Turns out one of the [[DataForge]] workers had a memory leak in its [[Python]] process. [[Owen Park]] helped identify the root cause in the streaming parser. Fixed and deployed by end of day. Took [[Luna]] for a walk in the afternoon to decompress. Listened to [[Signal Patterns]] podcast in the evening.`,
    },
    // Day 4
    {
      date: '2026-01-04',
      links: ['DataForge', 'TypeScript', 'Prism Core', 'Nadia Reyes', 'PostgreSQL', 'Docker', 'Luna'],
      content: `Productive day on [[DataForge]]. Migrated two services from JavaScript to [[TypeScript]] which caught several type errors. Also reviewed [[Prism Core]] pull requests. [[Nadia Reyes]] and I paired on the database schema changes. The [[PostgreSQL]] migration went smoothly. Containerized everything with [[Docker]] for consistency. [[Luna]] kept me company while I worked from home.`,
    },
    // Day 5
    {
      date: '2026-01-05',
      links: ['Yoga', 'Supplements', 'NovaSpark', 'React', 'Tessa Liu'],
      content: `Morning [[Yoga]] and [[Supplements]] routine. Spent most of the day on the [[NovaSpark]] frontend using [[React]]. The dashboard widgets are coming together nicely. [[Tessa Liu]] helped review the accessibility improvements. The uat environment is ready for stakeholder demos next week. Had some matcha at the new cafe and it was excellent. The tech debt discussion with the team focused on the legacy API First approach.`,
    },
    // Day 6
    {
      date: '2026-01-06',
      links: ['Owen Park', 'CloudShift', 'Docker', 'Kubernetes'],
      content: `Focused day on infrastructure. [[Owen Park]] and I worked on the [[CloudShift]] migration plan. Moving everything to [[Docker]] containers orchestrated by [[Kubernetes]]. The continuous integration pipeline needs updating for the new build targets. Freya Nakamura sent some useful o11y dashboards for monitoring the migration. Went for a swimming session after work. The dog was excited when I got home.`,
    },
    // Day 7
    {
      date: '2026-01-07',
      links: ['NovaSpark', 'GraphQL', 'Redis', 'Nadia Reyes', 'PostgreSQL'],
      content: `Architecture review for [[NovaSpark]] API layer. Debated [[GraphQL]] vs REST for the new endpoints. Added [[Redis]] caching for the frequently-accessed reporting data. [[Nadia Reyes]] pushed back on the caching strategy — valid concerns about cache invalidation. The [[PostgreSQL]] query optimizer is doing well with the new indexes.`,
    },
    // Day 8
    {
      date: '2026-01-08',
      links: ['Swim', 'Leo Vasquez', 'Prism Core', 'TypeScript'],
      content: `Good morning [[Swim]] session. [[Leo Vasquez]] and I spent the afternoon on [[Prism Core]] refactoring in [[TypeScript]]. The module system is much cleaner now. Apex sent over their integration requirements — need to review with the team. Had a prod deployment scare but it was just a monitoring false alarm. Took my vitamins and did some tabletop games in the evening.`,
    },
    // Day 9
    {
      date: '2026-01-09',
      links: ['Yoga', 'NovaSpark', 'Machine Learning', 'Tessa Liu'],
      content: `Morning [[Yoga]] then straight into work. [[NovaSpark]] sprint planning went well. The [[Machine Learning]] feature is getting prioritized for Q2. [[Tessa Liu]] presented the data pipeline architecture. Quantum Data offered to help with the ML model training infrastructure. Went for a run in the evening — Rock Climbing at the gym was too crowded.`,
    },
    // Day 10
    {
      date: '2026-01-10',
      links: ['DataForge', 'Python', 'Mira Okonkwo'],
      content: `Full day on [[DataForge]] optimization. The [[Python]] batch processing is now 3x faster with the new streaming approach. [[Mira Okonkwo]] set up the benchmarks and the results look great. The tech debt in the legacy ingestion code is piling up. Took vitamins and did some yoga practice at home. PDX weather was nice enough for a walk.`,
    },
    // Day 11
    {
      date: '2026-01-11',
      links: ['Supplements', 'NovaSpark', 'React', 'TypeScript'],
      content: `Took my [[Supplements]] with breakfast. Big push on [[NovaSpark]] dashboard — the [[React]] + [[TypeScript]] stack is working beautifully. Nova Spark demo scheduled for Friday. Code Breakers book club at lunch — interesting chapter on debugging strategies. Freya suggested using event-sourcing for the audit trail. ZRH office asked about the Dev Hub integration timeline.`,
    },
    // Day 12
    {
      date: '2026-01-12',
      links: ['Yoga', 'Swim', 'CloudShift', 'Docker'],
      content: `Double workout day — [[Yoga]] in the morning and [[Swim]] at lunch. [[CloudShift]] migration hit a snag with [[Docker]] networking configuration. Had to debug container DNS resolution for an hour. Dmitri helped with the k8s network policies. The agile methodology retrospective surfaced some good points about our deployment process. Looked into the expenses for Q1 travel.`,
    },
    // Day 13
    {
      date: '2026-01-13',
      links: ['Owen Park', 'Project Meridian', 'Python', 'PostgreSQL'],
      content: `Productive session with [[Owen Park]] on [[Project Meridian]]. The [[Python]] data transformation layer is solid. [[PostgreSQL]] partitioning strategy is paying off — query times down 40%. Mira mentioned the APAC team needs access to our stg environment. The agile methodology standup revealed some blockers on the Cloud Shift front. Had some pho for lunch from the new place.`,
    },
    // Day 14
    {
      date: '2026-01-14',
      links: ['NovaSpark', 'React', 'Nadia Reyes'],
      content: `[[NovaSpark]] demo prep. The [[React]] components are looking polished. [[Nadia Reyes]] ran through the presentation deck. Model Context Protocol integration tests are all passing. The prod deploy is scheduled for next week. The CI pipeline caught a regression in the api-first design module. The arch RFC needs final review. Grabbed lunch at the noodle shop again.`,
    },
    // Day 15
    {
      date: '2026-01-15',
      links: ['Yoga', 'NovaSpark', 'Owen Park'],
      content: `Morning [[Yoga]] session. [[NovaSpark]] demo went great — stakeholders are impressed. [[Owen Park]] presented the infrastructure improvements. Microservices refactoring is on track. Dev Hub integration will land next sprint. The hackathon planning committee met to discuss themes. The quarterly review document is due next week. The clean arch talk by Freya was insightful. The APAC trip is confirmed for March.`,
    },
  ];

  for (const day of dailyNoteData) {
    const path = `daily-notes/${day.date}.md`;
    notes.push({
      path,
      title: day.date,
      frontmatter: { type: 'daily' },
      content: day.content,
      links: day.links,
      folder: 'daily-notes',
    });

  }

  return { notes };
}

/**
 * Hand-crafted content notes in inbox/ subdirectories.
 * These are project docs, tech guides, and other reference material.
 */
function generateContentNotes(): { notes: NoteDef[] } {
  const notes: NoteDef[] = [];

  const contentNoteData: Array<{
    path: string;
    title: string;
    frontmatter: Record<string, unknown>;
    links: string[];
    content: string;
  }> = [
    // --- Project docs (9) ---
    {
      path: 'inbox/project-docs/novaspark-architecture.md',
      title: 'NovaSpark Architecture Overview',
      frontmatter: { type: 'project-doc', project: 'NovaSpark' },
      links: ['NovaSpark', 'Microservices', 'Nadia Reyes', 'React', 'TypeScript', 'Python', 'PostgreSQL', 'Redis', 'Docker', 'Kubernetes', 'Meridian Labs', 'Observability'],
      content: `This document describes the high-level architecture of [[NovaSpark]]. The platform follows a [[Microservices]] architecture designed by [[Nadia Reyes]]. The frontend is built with [[React]] and [[TypeScript]], served via a CDN. The backend consists of multiple [[Python]] services communicating through REST APIs and an event bus. Data is stored in [[PostgreSQL]] with [[Redis]] as a caching layer. All services are containerized with [[Docker]] and deployed to [[Kubernetes]] clusters managed by [[Meridian Labs]] engineering. Authentication uses OAuth 2.0 with JWT tokens. Deploy to stg first, then promote to prd. The API gateway handles rate limiting and request routing. [[Observability]] is achieved through distributed tracing and structured logging. Service Level Agreements define 99.9% uptime targets.`,
    },
    {
      path: 'inbox/project-docs/novaspark-api-guide.md',
      title: 'NovaSpark API Guide',
      frontmatter: { type: 'project-doc', project: 'NovaSpark' },
      links: ['NovaSpark', 'Nadia Reyes', 'GraphQL', 'CloudShift', 'Freya Nakamura'],
      content: `The [[NovaSpark]] API follows REST conventions established by [[Nadia Reyes]]. All endpoints are versioned (currently v2) and return JSON responses. Authentication is via Bearer tokens. The API supports pagination, filtering, and field selection. Key endpoints include: /api/v2/reports (report management), /api/v2/metrics (performance metrics), /api/v2/compliance (governance checks). Rate limiting is set to 1000 requests per minute per client, enforced at the API gateway level. [[GraphQL]] was considered but REST was chosen for simplicity and broader client compatibility. The [[CloudShift]] team uses the bulk import endpoint. [[Freya Nakamura]] contributed the webhook notification system.`,
    },
    {
      path: 'inbox/project-docs/dataforge-runbook.md',
      title: 'DataForge Runbook',
      frontmatter: { type: 'project-doc', project: 'DataForge' },
      links: ['DataForge', 'PostgreSQL', 'Microservices', 'Docker', 'Kubernetes', 'Mira Okonkwo', 'Meridian Labs', 'Observability', 'Nadia Reyes'],
      content: `Operational runbook for the [[DataForge]] system. The pipeline ingests data from 15+ sources into [[PostgreSQL]] through a series of transformation stages. Each stage runs as a [[Microservices]] worker in a [[Docker]] container on [[Kubernetes]]. Common issues include: memory leaks in python3 workers (restart the pod), stale connections to Postgres (check connection pool settings), and failed transformations (check the dead letter queue). [[Mira Okonkwo]] and [[Meridian Labs]] engineering are the primary on-call contacts. Deploy to stg first, then promote to prd. Monitoring dashboards are available in the [[Observability]] platform. Escalation path: on-call engineer, then [[Nadia Reyes]]. Service Level Agreement targets: 99.95% uptime, p99 latency under 500ms.`,
    },
    {
      path: 'inbox/project-docs/cloudshift-spec.md',
      title: 'CloudShift Migration Spec',
      frontmatter: { type: 'project-doc', project: 'CloudShift' },
      links: ['CloudShift', 'Docker', 'Kubernetes', 'Owen Park', 'Apex Systems'],
      content: `Migration specification for [[CloudShift]]. All legacy services will be containerized using [[Docker]] and orchestrated with [[Kubernetes]]. [[Owen Park]] is leading the infrastructure migration. Phase 1 covers the core API services. Phase 2 handles the data layer migration. [[Apex Systems]] provides the cloud infrastructure. Timeline: 3 months with bi-weekly checkpoints. Risk factors include network latency and data consistency during cutover.`,
    },
    {
      path: 'inbox/project-docs/prism-core-readme.md',
      title: 'Prism Core README',
      frontmatter: { type: 'project-doc', project: 'Prism Core' },
      links: ['Prism Core', 'TypeScript', 'Leo Vasquez', 'React'],
      content: `[[Prism Core]] is the shared component library used across all frontend projects. Built with [[TypeScript]] for type safety. [[Leo Vasquez]] is the primary maintainer. The library exports reusable UI components, hooks, and utilities. Compatible with [[React]] 18+. Testing uses Vitest with 95% coverage target. Published as an npm package with semantic versioning.`,
    },
    {
      path: 'inbox/project-docs/project-meridian-postmortem.md',
      title: 'Project Meridian Postmortem',
      frontmatter: { type: 'project-doc', project: 'Project Meridian' },
      links: ['Project Meridian', 'Owen Park', 'Python', 'PostgreSQL', 'Mira Okonkwo'],
      content: `Postmortem for the [[Project Meridian]] data migration incident on Dec 15. [[Owen Park]] identified a race condition in the [[Python]] migration script. The [[PostgreSQL]] transaction isolation level was set too low, causing duplicate records. [[Mira Okonkwo]] implemented the fix with proper locking. Lessons learned: always test migrations with production-scale data, use advisory locks for concurrent operations.`,
    },
    {
      path: 'inbox/project-docs/devhub-proposal.md',
      title: 'DevHub Proposal',
      frontmatter: { type: 'project-doc', project: 'DevHub' },
      links: ['DevHub', 'React', 'TypeScript', 'Tessa Liu'],
      content: `Proposal for [[DevHub]], a unified developer portal. Built with [[React]] and [[TypeScript]]. [[Tessa Liu]] is the project sponsor. Features include: API documentation browser, SDK download center, interactive API playground, and developer community forum. Expected timeline: MVP in 6 weeks.`,
    },
    {
      path: 'inbox/project-docs/novaspark-testing-strategy.md',
      title: 'NovaSpark Testing Strategy',
      frontmatter: { type: 'project-doc', project: 'NovaSpark' },
      links: ['NovaSpark', 'TypeScript', 'Docker', 'Leo Vasquez', 'Continuous Integration'],
      content: `Testing strategy for [[NovaSpark]]. All code is written in [[TypeScript]] with strict mode enabled. Unit tests use Vitest, integration tests run in [[Docker]] containers. [[Leo Vasquez]] established the testing patterns. The [[Continuous Integration]] pipeline runs all tests on every PR. Coverage threshold is 80% for new code. E2E tests use Playwright for the dashboard flows.`,
    },
    {
      path: 'inbox/project-docs/novaspark-security-review.md',
      title: 'NovaSpark Security Review',
      frontmatter: { type: 'project-doc', project: 'NovaSpark' },
      links: ['NovaSpark', 'Nadia Reyes', 'Redis', 'PostgreSQL'],
      content: `Security review for [[NovaSpark]] conducted by the platform security team. [[Nadia Reyes]] addressed all critical findings. Authentication tokens are stored in [[Redis]] with appropriate TTLs. [[PostgreSQL]] connections use TLS and parameterized queries prevent SQL injection. CORS policy is properly configured. Rate limiting prevents abuse. Secrets management uses environment variables, never hardcoded.`,
    },

    // --- Tech guides (5) ---
    {
      path: 'inbox/tech-guides/typescript-best-practices.md',
      title: 'TypeScript Best Practices',
      frontmatter: { type: 'tech-guide' },
      links: ['TypeScript', 'React', 'NovaSpark'],
      content: `Best practices for [[TypeScript]] development across our projects. Use strict mode in all tsconfig files. Prefer interfaces over type aliases for object shapes. Use [[React]] functional components with proper typing. Applied extensively in [[NovaSpark]] and other projects. Avoid any type — use unknown with type guards instead. Leo Vasquez maintains the shared ESLint config that enforces these rules.`,
    },
    {
      path: 'inbox/tech-guides/kubernetes-operations.md',
      title: 'Kubernetes Operations Guide',
      frontmatter: { type: 'tech-guide' },
      links: ['Kubernetes', 'Docker', 'CloudShift'],
      content: `Operational guide for [[Kubernetes]] clusters. All deployments use [[Docker]] images built in CI. The [[CloudShift]] project established our cluster management patterns. Use namespaces for environment isolation. Resource limits are mandatory for all pods. Owen Park wrote the initial runbook. Observability dashboards monitor cluster health. Microservices communicate via internal DNS.`,
    },
    {
      path: 'inbox/tech-guides/rest-api-conventions.md',
      title: 'REST API Conventions',
      frontmatter: { type: 'tech-guide' },
      links: ['NovaSpark', 'Nadia Reyes'],
      content: `REST API design conventions for all [[NovaSpark]] services. Established by [[Nadia Reyes]] and the platform team. Use plural nouns for resource endpoints. Support pagination with cursor-based tokens. Return consistent error responses with error codes. Version all APIs in the URL path. Microservices should expose health check endpoints. API-First design ensures contracts are defined before implementation.`,
    },
    {
      path: 'inbox/tech-guides/docker-standards.md',
      title: 'Docker Standards',
      frontmatter: { type: 'tech-guide' },
      links: ['Docker', 'Python', 'Kubernetes'],
      content: `[[Docker]] containerization standards. Use multi-stage builds for all [[Python]] and Node services. Base images should be pinned to specific versions. Security scanning runs on every image push. Deployed to [[Kubernetes]] clusters via Helm charts. Mira Okonkwo maintains the base image library. DataForge uses custom images for the data processing workers.`,
    },
    {
      path: 'inbox/tech-guides/graphql-patterns.md',
      title: 'GraphQL Patterns',
      frontmatter: { type: 'tech-guide' },
      links: ['GraphQL', 'TypeScript', 'React'],
      content: `[[GraphQL]] integration patterns for our frontend applications. Use code generation with [[TypeScript]] for type-safe queries. [[React]] components use Apollo Client for data fetching. Schema-first design with SDL definitions. Nadia Reyes evaluated GraphQL for NovaSpark but chose REST for the initial release. DataForge exposes a GraphQL endpoint for internal analytics queries.`,
    },

    // --- Other content notes (6) ---
    {
      path: 'inbox/weekly-review-w1.md',
      title: 'Weekly Review W1',
      frontmatter: { type: 'review' },
      links: ['NovaSpark', 'DataForge', 'CloudShift'],
      content: `Week 1 review. Major progress on [[NovaSpark]] dashboard. [[DataForge]] memory leak fixed. [[CloudShift]] migration planning kicked off. Team velocity is up 15% from last quarter. Nadia Reyes presented Q1 goals at the all-hands. Owen Park onboarded two new infrastructure engineers. Next week: DevHub kickoff meeting.`,
    },
    {
      path: 'inbox/weekly-review-w2.md',
      title: 'Weekly Review W2',
      frontmatter: { type: 'review' },
      links: ['NovaSpark', 'Prism Core', 'Project Meridian'],
      content: `Week 2 review. [[NovaSpark]] demo was a success. [[Prism Core]] component library released v2.1. [[Project Meridian]] postmortem completed. Team morale is high after the successful demo. Leo Vasquez led the Prism Core release. Mira Okonkwo completed the DataForge benchmarks. DevCon 2026 talk submissions are due next month.`,
    },
    {
      path: 'inbox/architecture-decisions.md',
      title: 'Architecture Decision Log',
      frontmatter: { type: 'reference' },
      links: ['NovaSpark', 'Microservices', 'React', 'TypeScript', 'PostgreSQL'],
      content: `Architecture decisions for the platform. ADR-001: [[NovaSpark]] uses [[Microservices]] (decided Jan 2025). ADR-002: Frontend stack is [[React]] + [[TypeScript]] (decided Mar 2025). ADR-003: Primary database is [[PostgreSQL]] (decided Jan 2025). ADR-004: Event Sourcing for audit trail (proposed, pending review). ADR-005: Clean Architecture for service boundaries (decided Nov 2025). Owen Park and Nadia Reyes are the architecture review board.`,
    },
    {
      path: 'inbox/team-retro-jan.md',
      title: 'Team Retrospective January',
      frontmatter: { type: 'meeting' },
      links: ['NovaSpark', 'CloudShift', 'Mira Okonkwo'],
      content: `January retrospective. What went well: [[NovaSpark]] demo was great, team collaboration improved. What could improve: [[CloudShift]] migration communication, Code Review turnaround time. [[Mira Okonkwo]] facilitated. Action items: establish Agile standup format for CloudShift, create Architecture RFC template for proposals, improve Continuous Integration feedback loop.`,
    },
    {
      path: 'inbox/reading-list.md',
      title: 'Reading List',
      frontmatter: { type: 'reference' },
      links: [],
      content: `Current reading list and recommendations. Code Breakers book — excellent on debugging methodology. Signal Patterns podcast episode on o11y was insightful. Daily Build newsletter covers industry trends. Books to read: clean arch by Robert Martin, Domain-Driven Design by Eric Evans. The agile methodology retrospective formats from the Meridian Corp engineering blog.`,
    },
    {
      path: 'inbox/project-docs/cloudshift-testing.md',
      title: 'CloudShift Testing Plan',
      frontmatter: { type: 'project-doc', project: 'CloudShift' },
      links: ['CloudShift', 'Docker', 'Kubernetes', 'Owen Park'],
      content: `Testing plan for [[CloudShift]] migration. All services tested in [[Docker]] containers before [[Kubernetes]] deployment. [[Owen Park]] designed the integration test suite. Staging environment mirrors production topology. UAT testing with stakeholder sign-off required. Load testing covers 2x expected traffic. Dmitri Sokolov handles the performance benchmarks.`,
    },
  ];

  for (const note of contentNoteData) {
    notes.push({
      path: note.path,
      title: note.title,
      frontmatter: note.frontmatter,
      content: note.content,
      links: note.links,
      folder: note.path.split('/').slice(0, -1).join('/'),
    });

  }

  return { notes };
}

/**
 * Generate entity notes — one per entity, in category folders.
 */
/**
 * Select category-appropriate related entities for entity note body generation.
 * Ensures animals get people+health, health gets people+animals, etc.
 */
function selectRelatedEntities(entity: EntityDef, all: EntityDef[]): EntityDef[] {
  const others = all.filter(e => e !== entity);

  // Category-specific priorities for better co-occurrence graph
  const priorityCategories: Record<string, string[]> = {
    animals: ['people', 'health', 'locations'],
    health: ['people', 'animals', 'locations'],
    food: ['locations', 'people', 'organizations'],
    people: ['organizations', 'projects', 'technologies'],
    projects: ['technologies', 'people', 'organizations'],
    hobbies: ['people', 'locations', 'health'],
    media: ['people', 'technologies', 'concepts'],
    events: ['people', 'organizations', 'projects'],
    documents: ['projects', 'people', 'organizations'],
    finance: ['projects', 'organizations', 'people'],
  };

  const priorities = priorityCategories[entity.category];
  if (priorities) {
    const result: EntityDef[] = [];
    for (const cat of priorities) {
      const candidates = others.filter(e => e.category === cat);
      if (candidates.length > 0) {
        result.push(shuffle(rng, candidates)[0]);
      }
      if (result.length >= 3) break;
    }
    // Fill remaining slots with random others
    if (result.length < 3) {
      const remaining = shuffle(rng, others.filter(e => !result.includes(e)));
      result.push(...remaining.slice(0, 3 - result.length));
    }
    return result;
  }

  // Default: random selection
  return shuffle(rng, others).slice(0, 3);
}

function generateEntityNotes(): NoteDef[] {
  const notes: NoteDef[] = [];

  for (const entity of allEntities) {
    const related = selectRelatedEntities(entity, allEntities);
    const content = entityNoteBody(entity, related);

    const frontmatter: Record<string, unknown> = { type: entity.category };
    if (entity.aliases.length > 0) {
      frontmatter.aliases = entity.aliases;
    }

    notes.push({
      path: `${entity.folder}/${slugify(entity.name)}.md`,
      title: entity.name,
      frontmatter,
      content,
      links: [],
      folder: entity.folder,
    });
  }

  return notes;
}

// =============================================================================
// Curated ground truth (exactly 60 entries: T1=24, T2=21, T3=15)
// =============================================================================

/**
 * Hand-curated ground truth entries. Each entry is verified to match actual
 * content in the generated notes above.
 *
 * T1 = entity name appears verbatim in note content (not wikilinked)
 * T2 = an alias appears verbatim in note content (not wikilinked)
 * T3 = entity is semantically related but not mentioned verbatim
 */
function generateCuratedGroundTruth(): GroundTruthEntry[] {
  return [
    // =========================================================================
    // T1 — entity name appears verbatim in note content, NOT wikilinked (24)
    // =========================================================================

    // Daily notes T1 (5 entries)
    { notePath: 'daily-notes/2026-01-06.md', entity: 'Freya Nakamura', tier: 1, reason: 'Entity name Freya Nakamura appears verbatim in content' },
    { notePath: 'daily-notes/2026-01-09.md', entity: 'Quantum Data', tier: 1, reason: 'Entity name Quantum Data appears verbatim in content' },
    { notePath: 'daily-notes/2026-01-09.md', entity: 'Rock Climbing', tier: 1, reason: 'Entity name Rock Climbing appears verbatim in content' },
    { notePath: 'daily-notes/2026-01-11.md', entity: 'Code Breakers', tier: 1, reason: 'Entity name Code Breakers appears verbatim in content' },
    { notePath: 'daily-notes/2026-01-15.md', entity: 'Microservices', tier: 1, reason: 'Entity name Microservices appears verbatim in content' },

    // Inbox notes T1 (19 entries)
    { notePath: 'inbox/tech-guides/rest-api-conventions.md', entity: 'Microservices', tier: 1, reason: 'Entity name Microservices appears verbatim in content' },
    { notePath: 'inbox/tech-guides/rest-api-conventions.md', entity: 'API-First', tier: 1, reason: 'Entity name API-First appears verbatim in content' },
    { notePath: 'inbox/team-retro-jan.md', entity: 'Agile', tier: 1, reason: 'Entity name Agile appears verbatim in content' },
    { notePath: 'inbox/team-retro-jan.md', entity: 'Architecture RFC', tier: 1, reason: 'Entity name Architecture RFC appears verbatim in content' },
    { notePath: 'inbox/team-retro-jan.md', entity: 'Continuous Integration', tier: 1, reason: 'Entity name Continuous Integration appears verbatim in content' },
    { notePath: 'inbox/tech-guides/graphql-patterns.md', entity: 'NovaSpark', tier: 1, reason: 'Entity name NovaSpark appears verbatim in content' },
    { notePath: 'inbox/tech-guides/graphql-patterns.md', entity: 'Nadia Reyes', tier: 1, reason: 'Entity name Nadia Reyes appears verbatim in content' },
    { notePath: 'inbox/tech-guides/graphql-patterns.md', entity: 'DataForge', tier: 1, reason: 'Entity name DataForge appears verbatim in content' },
    { notePath: 'inbox/weekly-review-w2.md', entity: 'DevCon 2026', tier: 1, reason: 'Entity name DevCon 2026 appears verbatim in content' },
    { notePath: 'inbox/weekly-review-w2.md', entity: 'Mira Okonkwo', tier: 1, reason: 'Entity name Mira Okonkwo appears verbatim in content' },
    { notePath: 'inbox/weekly-review-w2.md', entity: 'Leo Vasquez', tier: 1, reason: 'Entity name Leo Vasquez appears verbatim in content' },
    { notePath: 'inbox/weekly-review-w2.md', entity: 'DataForge', tier: 1, reason: 'Entity name DataForge appears verbatim in content' },
    { notePath: 'inbox/weekly-review-w1.md', entity: 'Nadia Reyes', tier: 1, reason: 'Entity name Nadia Reyes appears verbatim in content' },
    { notePath: 'inbox/weekly-review-w1.md', entity: 'Owen Park', tier: 1, reason: 'Entity name Owen Park appears verbatim in content' },
    { notePath: 'inbox/weekly-review-w1.md', entity: 'DevHub', tier: 1, reason: 'Entity name DevHub appears verbatim in content' },
    { notePath: 'inbox/tech-guides/typescript-best-practices.md', entity: 'Leo Vasquez', tier: 1, reason: 'Entity name Leo Vasquez appears verbatim in content' },
    { notePath: 'inbox/tech-guides/kubernetes-operations.md', entity: 'Owen Park', tier: 1, reason: 'Entity name Owen Park appears verbatim in content' },
    { notePath: 'inbox/tech-guides/kubernetes-operations.md', entity: 'Observability', tier: 1, reason: 'Entity name Observability appears verbatim in content' },
    { notePath: 'inbox/tech-guides/docker-standards.md', entity: 'Mira Okonkwo', tier: 1, reason: 'Entity name Mira Okonkwo appears verbatim in content' },

    // =========================================================================
    // T2 — alias appears in content, entity name does NOT appear (21)
    // =========================================================================

    // Day 5: "uat" -> UAT, "matcha" -> Matcha Latte, "tech debt" -> Technical Debt, "API First" -> API-First
    { notePath: 'daily-notes/2026-01-05.md', entity: 'UAT', tier: 2, reason: 'Alias "uat" matches entity UAT' },
    { notePath: 'daily-notes/2026-01-05.md', entity: 'Matcha Latte', tier: 2, reason: 'Alias "matcha" matches entity Matcha Latte' },
    { notePath: 'daily-notes/2026-01-05.md', entity: 'Technical Debt', tier: 2, reason: 'Alias "tech debt" matches entity Technical Debt' },

    // Day 6: "CI" -> Continuous Integration, "o11y" -> Observability, "swimming" -> Swim, "Rex the dog" -> Rex
    { notePath: 'daily-notes/2026-01-06.md', entity: 'Continuous Integration', tier: 2, reason: 'Alias "CI" matches entity Continuous Integration' },
    { notePath: 'daily-notes/2026-01-06.md', entity: 'Observability', tier: 2, reason: 'Alias "o11y" matches entity Observability' },
    { notePath: 'daily-notes/2026-01-06.md', entity: 'Swim', tier: 2, reason: 'Alias "swimming" matches entity Swim' },

    // Day 8: "Apex" -> Apex Systems, "prod" -> Production, "vitamins" -> Supplements, "tabletop games" -> Board Games
    { notePath: 'daily-notes/2026-01-08.md', entity: 'Apex Systems', tier: 2, reason: 'Alias "Apex" matches entity Apex Systems' },
    { notePath: 'daily-notes/2026-01-08.md', entity: 'Production', tier: 2, reason: 'Alias "prod" matches entity Production' },
    { notePath: 'daily-notes/2026-01-08.md', entity: 'Supplements', tier: 2, reason: 'Alias "vitamins" matches entity Supplements' },
    { notePath: 'daily-notes/2026-01-08.md', entity: 'Board Games', tier: 2, reason: 'Alias "tabletop games" matches entity Board Games' },

    // Day 10: "tech debt" -> Technical Debt, "PDX" -> Portland
    { notePath: 'daily-notes/2026-01-10.md', entity: 'Technical Debt', tier: 2, reason: 'Alias "tech debt" matches entity Technical Debt' },
    { notePath: 'daily-notes/2026-01-10.md', entity: 'Portland', tier: 2, reason: 'Alias "PDX" matches entity Portland' },

    // Day 11: "event-sourcing" -> Event Sourcing, "ZRH" -> Zurich, "Dev Hub" -> DevHub
    { notePath: 'daily-notes/2026-01-11.md', entity: 'Event Sourcing', tier: 2, reason: 'Alias "event-sourcing" matches entity Event Sourcing' },
    { notePath: 'daily-notes/2026-01-11.md', entity: 'Zurich', tier: 2, reason: 'Alias "ZRH" matches entity Zurich' },
    { notePath: 'daily-notes/2026-01-11.md', entity: 'DevHub', tier: 2, reason: 'Alias "Dev Hub" matches entity DevHub' },

    // Day 12: "k8s" -> Kubernetes, "agile methodology" -> Agile, "expenses" -> Expense Report
    { notePath: 'daily-notes/2026-01-12.md', entity: 'Kubernetes', tier: 2, reason: 'Alias "k8s" matches entity Kubernetes' },
    { notePath: 'daily-notes/2026-01-12.md', entity: 'Agile', tier: 2, reason: 'Alias "agile methodology" matches entity Agile' },
    { notePath: 'daily-notes/2026-01-12.md', entity: 'Expense Report', tier: 2, reason: 'Alias "expenses" matches entity Expense Report' },

    // Day 13: "Cloud Shift" -> CloudShift, "pho" -> Pho Bowl
    { notePath: 'daily-notes/2026-01-13.md', entity: 'CloudShift', tier: 2, reason: 'Alias "Cloud Shift" matches entity CloudShift' },
    { notePath: 'daily-notes/2026-01-13.md', entity: 'Pho Bowl', tier: 2, reason: 'Alias "pho" matches entity Pho Bowl' },

    // Inbox: "stg" -> Staging (dataforge-runbook)
    { notePath: 'inbox/project-docs/dataforge-runbook.md', entity: 'Staging', tier: 2, reason: 'Alias "stg" matches entity Staging in runbook' },

    // =========================================================================
    // T3 — semantic/graph-only, entity not mentioned verbatim (15)
    // =========================================================================

    { notePath: 'daily-notes/2026-01-01.md', entity: 'Luna', tier: 3, reason: 'co-occurrence with Rex in pet/outdoor activity context' },
    { notePath: 'daily-notes/2026-01-03.md', entity: 'Rex', tier: 3, reason: 'co-occurrence with Luna and outdoor activity context' },
    { notePath: 'daily-notes/2026-01-03.md', entity: 'Code Breakers', tier: 3, reason: 'co-occurrence with evening leisure and debugging themes' },
    { notePath: 'daily-notes/2026-01-04.md', entity: 'Rex', tier: 3, reason: 'co-occurrence with home office context and pet presence' },
    { notePath: 'daily-notes/2026-01-06.md', entity: 'Rex', tier: 3, reason: 'co-occurrence with Swim in after-work activity context' },
    { notePath: 'daily-notes/2026-01-08.md', entity: 'Yoga', tier: 3, reason: 'co-occurrence with Swim in daily health routine context' },
    { notePath: 'daily-notes/2026-01-08.md', entity: 'Luna', tier: 3, reason: 'co-occurrence with Swim in daily pet/activity context' },
    { notePath: 'daily-notes/2026-01-09.md', entity: 'Luna', tier: 3, reason: 'co-occurrence with Yoga and evening park activity context' },
    { notePath: 'daily-notes/2026-01-10.md', entity: 'Luna', tier: 3, reason: 'co-occurrence with Yoga and home pet context' },
    { notePath: 'daily-notes/2026-01-10.md', entity: 'Swim', tier: 3, reason: 'co-occurrence with health routine in daily context' },
    { notePath: 'daily-notes/2026-01-12.md', entity: 'Luna', tier: 3, reason: 'co-occurrence with Yoga and Swim in daily routine context' },
    { notePath: 'daily-notes/2026-01-13.md', entity: 'Melbourne', tier: 3, reason: 'co-occurrence with Mira Okonkwo and CloudShift in office context' },
    { notePath: 'daily-notes/2026-01-14.md', entity: 'Pho Bowl', tier: 3, reason: 'co-occurrence with morning routine and lunch context' },
    { notePath: 'daily-notes/2026-01-15.md', entity: 'Melbourne', tier: 3, reason: 'co-occurrence with trip planning and office context' },
    { notePath: 'daily-notes/2026-01-15.md', entity: 'Hackathon Spring', tier: 3, reason: 'co-occurrence with planning and event context' },
  ];
}

// =============================================================================
// Generate fixture
// =============================================================================

function generate() {
  const { notes: dailyNotes } = generateDailyNotes();
  const { notes: contentNotes } = generateContentNotes();
  const entityNotes = generateEntityNotes();

  const allNotes = [...entityNotes, ...dailyNotes, ...contentNotes];

  // Use hand-curated ground truth (exactly 60 entries: T1=24, T2=21, T3=15)
  const curatedGt = generateCuratedGroundTruth();

  // Build content map for validation
  const noteContentMap = new Map(allNotes.map(n => [n.path, n.content]));

  // Validate all ground truth entries
  const errors: string[] = [];
  for (const g of curatedGt) {
    const content = noteContentMap.get(g.notePath);
    if (!content) {
      errors.push(`GT entry notePath not found: ${g.notePath} -> ${g.entity}`);
      continue;
    }
    const entity = allEntities.find(e => e.name === g.entity);
    if (!entity) {
      errors.push(`GT entry entity not found: ${g.entity}`);
      continue;
    }
    // For T1/T2, verify the entity name or alias actually appears
    if (g.tier <= 2) {
      const nameInContent = content.includes(entity.name);
      const aliasInContent = entity.aliases.some(a => a.length >= 3 && content.includes(a));
      if (!nameInContent && !aliasInContent) {
        errors.push(`GT T${g.tier} entry: entity "${g.entity}" (or aliases) not found in note ${g.notePath}`);
      }
    }
  }

  if (errors.length > 0) {
    console.error('Ground truth validation errors:');
    for (const err of errors) {
      console.error(`  ${err}`);
    }
    process.exit(1);
  }

  // Sort ground truth: T1 first, then T2, then T3 (for stable output)
  curatedGt.sort((a, b) => a.tier - b.tier || a.notePath.localeCompare(b.notePath) || a.entity.localeCompare(b.entity));

  const fixture = {
    seed: 42,
    description: 'Primary synthetic vault for graph quality testing',
    entities: allEntities.map(e => toEntitySpec(e)),
    notes: allNotes,
    groundTruth: curatedGt,
  };

  console.log(JSON.stringify(fixture, null, 2));
}

generate();
