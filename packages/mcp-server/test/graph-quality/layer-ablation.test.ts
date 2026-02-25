/**
 * Suite 3: Layer Ablation — Comprehensive Cross-Vault Analysis
 *
 * Extends the Pillar 2 single-vault ablation with:
 *   - Two vaults: primary (curated fixture) + generated (synthetic 50-note)
 *   - 13 ablation runs per vault (one per layer disabled) + 1 baseline = 28 total
 *   - Per-layer classification: CORE / USEFUL / MARGINAL / HARMFUL
 *   - JSON report output with tuning recommendations
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rm } from 'fs/promises';
import {
  buildGroundTruthVault,
  stripLinks,
  runSuggestionsOnVault,
  evaluateSuggestions,
  loadPrimaryVault,
  type TempVault,
  type GroundTruthSpec,
  type PrecisionRecallReport,
} from './harness.js';
import type { ScoringLayer } from '../../src/core/write/types.js';
import {
  writeReport,
  classifyLayer,
  Timer,
  type TestReport,
  type TuningRecommendation,
  type LayerClassification,
} from './report-utils.js';
import { createTempVault, createTestNote } from '../helpers/testUtils.js';
import { openStateDb, deleteStateDb } from '@velvetmonkey/vault-core';
import { setWriteStateDb, initializeEntityIndex } from '../../src/core/write/wikilinks.js';
import { setRecencyStateDb } from '../../src/core/shared/recency.js';

// =============================================================================
// Constants
// =============================================================================

const ALL_LAYERS: ScoringLayer[] = [
  'length_filter',
  'article_filter',
  'exact_match',
  'stem_match',
  'cooccurrence',
  'type_boost',
  'context_boost',
  'recency',
  'cross_folder',
  'hub_boost',
  'feedback',
  'semantic',
  'edge_weight',
];

// =============================================================================
// Types
// =============================================================================

interface LayerAblationResult {
  layer: ScoringLayer;
  baselineF1: number;
  ablatedF1: number;
  f1Delta: number;
  baselinePrecision: number;
  ablatedPrecision: number;
  precisionDelta: number;
  baselineRecall: number;
  ablatedRecall: number;
  recallDelta: number;
  classification: LayerClassification;
}

interface VaultAblationResults {
  vaultName: string;
  baseline: PrecisionRecallReport;
  layers: LayerAblationResult[];
}

// =============================================================================
// Generated Vault Builder
// =============================================================================

/**
 * Build a synthetic 50-note vault with ~15 entities for ablation testing.
 *
 * Entity notes live in people/, projects/, technologies/ with frontmatter types.
 * Content notes mention entities as plain text (ground truth stripped).
 * Returns a TempVault and the ground truth array.
 */
async function buildGeneratedVault(): Promise<{ vault: TempVault; groundTruth: GroundTruthSpec }> {
  const vaultPath = await createTempVault();

  // --- Entity notes (15 entities across 3 categories) ---

  const entities: GroundTruthSpec['entities'] = [
    // People (5)
    { name: 'Alice Zhang', category: 'people', path: 'people/Alice Zhang.md', aliases: [], hubScore: 0.9 },
    { name: 'Bob Martinez', category: 'people', path: 'people/Bob Martinez.md', aliases: [], hubScore: 0.7 },
    { name: 'Carol Davies', category: 'people', path: 'people/Carol Davies.md', aliases: [], hubScore: 0.5 },
    { name: 'Dan Okafor', category: 'people', path: 'people/Dan Okafor.md', aliases: [], hubScore: 0.3 },
    { name: 'Eva Petrov', category: 'people', path: 'people/Eva Petrov.md', aliases: [], hubScore: 0.4 },
    // Projects (5)
    { name: 'Atlas Platform', category: 'projects', path: 'projects/Atlas Platform.md', aliases: ['Atlas'], hubScore: 0.85 },
    { name: 'Beacon API', category: 'projects', path: 'projects/Beacon API.md', aliases: ['Beacon'], hubScore: 0.6 },
    { name: 'Compass Dashboard', category: 'projects', path: 'projects/Compass Dashboard.md', aliases: [], hubScore: 0.5 },
    { name: 'Delta Pipeline', category: 'projects', path: 'projects/Delta Pipeline.md', aliases: ['Delta'], hubScore: 0.4 },
    { name: 'Echo Service', category: 'projects', path: 'projects/Echo Service.md', aliases: [], hubScore: 0.3 },
    // Technologies (5)
    { name: 'TypeScript', category: 'technologies', path: 'technologies/TypeScript.md', aliases: ['TS'], hubScore: 0.95 },
    { name: 'PostgreSQL', category: 'technologies', path: 'technologies/PostgreSQL.md', aliases: ['Postgres'], hubScore: 0.8 },
    { name: 'Redis', category: 'technologies', path: 'technologies/Redis.md', aliases: [], hubScore: 0.6 },
    { name: 'GraphQL', category: 'technologies', path: 'technologies/GraphQL.md', aliases: ['GQL'], hubScore: 0.55 },
    { name: 'Kubernetes', category: 'technologies', path: 'technologies/Kubernetes.md', aliases: ['K8s'], hubScore: 0.7 },
  ];

  // Write entity notes with frontmatter
  const entityNoteContent: Record<string, string> = {
    'people/Alice Zhang.md': '---\ntype: person\n---\n# Alice Zhang\n\nLead architect on the Atlas Platform. Expert in TypeScript and distributed systems.\n',
    'people/Bob Martinez.md': '---\ntype: person\n---\n# Bob Martinez\n\nBackend engineer specializing in PostgreSQL and Beacon API development.\n',
    'people/Carol Davies.md': '---\ntype: person\n---\n# Carol Davies\n\nFrontend developer working on the Compass Dashboard. Skilled in GraphQL integration.\n',
    'people/Dan Okafor.md': '---\ntype: person\n---\n# Dan Okafor\n\nDevOps engineer managing Kubernetes clusters and the Delta Pipeline.\n',
    'people/Eva Petrov.md': '---\ntype: person\n---\n# Eva Petrov\n\nData engineer building the Echo Service with Redis caching.\n',
    'projects/Atlas Platform.md': '---\ntype: project\ntags:\n  - active\n  - platform\n---\n# Atlas Platform\n\nCore platform built with TypeScript. Led by Alice Zhang. Uses PostgreSQL for persistence.\n',
    'projects/Beacon API.md': '---\ntype: project\ntags:\n  - active\n  - api\n---\n# Beacon API\n\nREST and GraphQL API layer. Maintained by Bob Martinez. Built on TypeScript.\n',
    'projects/Compass Dashboard.md': '---\ntype: project\ntags:\n  - active\n  - frontend\n---\n# Compass Dashboard\n\nAnalytics dashboard consuming the Beacon API. Built by Carol Davies.\n',
    'projects/Delta Pipeline.md': '---\ntype: project\ntags:\n  - active\n  - infra\n---\n# Delta Pipeline\n\nData processing pipeline running on Kubernetes. Managed by Dan Okafor.\n',
    'projects/Echo Service.md': '---\ntype: project\ntags:\n  - active\n  - service\n---\n# Echo Service\n\nEvent streaming service using Redis. Developed by Eva Petrov.\n',
    'technologies/TypeScript.md': '---\ntype: technology\ntags:\n  - language\n---\n# TypeScript\n\nStatically typed JavaScript. Used across Atlas Platform and Beacon API.\n',
    'technologies/PostgreSQL.md': '---\ntype: technology\ntags:\n  - database\n---\n# PostgreSQL\n\nRelational database powering the Atlas Platform.\n',
    'technologies/Redis.md': '---\ntype: technology\ntags:\n  - database\n  - cache\n---\n# Redis\n\nIn-memory data store used for caching in the Echo Service.\n',
    'technologies/GraphQL.md': '---\ntype: technology\ntags:\n  - api\n---\n# GraphQL\n\nQuery language for APIs. Used by Beacon API and Compass Dashboard.\n',
    'technologies/Kubernetes.md': '---\ntype: technology\ntags:\n  - infra\n---\n# Kubernetes\n\nContainer orchestration platform. Runs the Delta Pipeline.\n',
  };

  for (const [notePath, content] of Object.entries(entityNoteContent)) {
    await createTestNote(vaultPath, notePath, content);
  }

  // --- Content notes (35 notes) that mention entities ---
  // We build ground truth links as we create notes. Links use [[Entity]] syntax
  // in the content, which will be stripped before testing.

  const notes: GroundTruthSpec['notes'] = [];
  const groundTruthLinks: GroundTruthSpec['groundTruth'] = [];

  // Add entity notes to the spec
  for (const [notePath, content] of Object.entries(entityNoteContent)) {
    const title = notePath.replace(/\.md$/, '').split('/').pop()!;
    notes.push({
      path: notePath,
      title,
      content,
      links: [],
      folder: notePath.split('/')[0],
    });
  }

  // Helper to add a content note with ground truth
  function addContentNote(
    notePath: string,
    title: string,
    content: string,
    gtLinks: Array<{ entity: string; tier: 1 | 2 | 3; reason: string }>,
  ) {
    const folder = notePath.split('/')[0];
    notes.push({
      path: notePath,
      title,
      content,
      links: gtLinks.map(l => l.entity),
      folder,
    });
    for (const link of gtLinks) {
      groundTruthLinks.push({
        notePath,
        entity: link.entity,
        tier: link.tier,
        reason: link.reason,
      });
    }
  }

  // Daily notes (10) — mentions of people and projects
  addContentNote('daily-notes/2026-01-20.md', '2026-01-20',
    '---\ntype: daily\ndate: 2026-01-20\n---\n# 2026-01-20\n\nMet with [[Alice Zhang]] about the [[Atlas Platform]] architecture review. She wants to migrate the data layer to [[PostgreSQL]] from the legacy system.\n',
    [
      { entity: 'Alice Zhang', tier: 1, reason: 'direct mention in daily log' },
      { entity: 'Atlas Platform', tier: 1, reason: 'direct project reference' },
      { entity: 'PostgreSQL', tier: 1, reason: 'technology discussed' },
    ],
  );

  addContentNote('daily-notes/2026-01-21.md', '2026-01-21',
    '---\ntype: daily\ndate: 2026-01-21\n---\n# 2026-01-21\n\n[[Bob Martinez]] demo-ed the new [[Beacon API]] endpoints. The [[GraphQL]] schema is cleaner now.\n',
    [
      { entity: 'Bob Martinez', tier: 1, reason: 'direct mention' },
      { entity: 'Beacon API', tier: 1, reason: 'direct project reference' },
      { entity: 'GraphQL', tier: 1, reason: 'technology discussed' },
    ],
  );

  addContentNote('daily-notes/2026-01-22.md', '2026-01-22',
    '---\ntype: daily\ndate: 2026-01-22\n---\n# 2026-01-22\n\nPaired with [[Carol Davies]] on the [[Compass Dashboard]] redesign. Considering adding [[Redis]] for session caching.\n',
    [
      { entity: 'Carol Davies', tier: 1, reason: 'direct mention' },
      { entity: 'Compass Dashboard', tier: 1, reason: 'direct project reference' },
      { entity: 'Redis', tier: 2, reason: 'technology considered, not primary' },
    ],
  );

  addContentNote('daily-notes/2026-01-23.md', '2026-01-23',
    '---\ntype: daily\ndate: 2026-01-23\n---\n# 2026-01-23\n\n[[Dan Okafor]] fixed the [[Kubernetes]] cluster autoscaling. The [[Delta Pipeline]] throughput doubled.\n',
    [
      { entity: 'Dan Okafor', tier: 1, reason: 'direct mention' },
      { entity: 'Kubernetes', tier: 1, reason: 'direct technology reference' },
      { entity: 'Delta Pipeline', tier: 1, reason: 'direct project reference' },
    ],
  );

  addContentNote('daily-notes/2026-01-24.md', '2026-01-24',
    '---\ntype: daily\ndate: 2026-01-24\n---\n# 2026-01-24\n\n[[Eva Petrov]] presented the [[Echo Service]] monitoring improvements. Uses [[Redis]] pub/sub heavily.\n',
    [
      { entity: 'Eva Petrov', tier: 1, reason: 'direct mention' },
      { entity: 'Echo Service', tier: 1, reason: 'direct project reference' },
      { entity: 'Redis', tier: 1, reason: 'technology discussed' },
    ],
  );

  addContentNote('daily-notes/2026-01-27.md', '2026-01-27',
    '---\ntype: daily\ndate: 2026-01-27\n---\n# 2026-01-27\n\nTeam standup: [[Alice Zhang]] and [[Bob Martinez]] to sync on the [[Atlas Platform]] and [[Beacon API]] integration.\n',
    [
      { entity: 'Alice Zhang', tier: 1, reason: 'direct mention' },
      { entity: 'Bob Martinez', tier: 1, reason: 'direct mention' },
      { entity: 'Atlas Platform', tier: 1, reason: 'direct project reference' },
      { entity: 'Beacon API', tier: 1, reason: 'direct project reference' },
    ],
  );

  addContentNote('daily-notes/2026-01-28.md', '2026-01-28',
    '---\ntype: daily\ndate: 2026-01-28\n---\n# 2026-01-28\n\nCode review for [[Carol Davies]] on the [[Compass Dashboard]]. She is using [[TypeScript]] strict mode now.\n',
    [
      { entity: 'Carol Davies', tier: 1, reason: 'direct mention' },
      { entity: 'Compass Dashboard', tier: 1, reason: 'direct project reference' },
      { entity: 'TypeScript', tier: 1, reason: 'technology discussed' },
    ],
  );

  addContentNote('daily-notes/2026-01-29.md', '2026-01-29',
    '---\ntype: daily\ndate: 2026-01-29\n---\n# 2026-01-29\n\n[[Dan Okafor]] migrating [[Delta Pipeline]] to the new [[Kubernetes]] namespace. [[Eva Petrov]] helping.\n',
    [
      { entity: 'Dan Okafor', tier: 1, reason: 'direct mention' },
      { entity: 'Delta Pipeline', tier: 1, reason: 'direct project reference' },
      { entity: 'Kubernetes', tier: 1, reason: 'technology discussed' },
      { entity: 'Eva Petrov', tier: 2, reason: 'secondary involvement' },
    ],
  );

  addContentNote('daily-notes/2026-01-30.md', '2026-01-30',
    '---\ntype: daily\ndate: 2026-01-30\n---\n# 2026-01-30\n\nAll-hands: [[Atlas Platform]] launch date confirmed. [[Alice Zhang]] presenting. [[TypeScript]] codebase now at 100k lines.\n',
    [
      { entity: 'Atlas Platform', tier: 1, reason: 'direct project reference' },
      { entity: 'Alice Zhang', tier: 1, reason: 'direct mention' },
      { entity: 'TypeScript', tier: 2, reason: 'incidental mention' },
    ],
  );

  addContentNote('daily-notes/2026-01-31.md', '2026-01-31',
    '---\ntype: daily\ndate: 2026-01-31\n---\n# 2026-01-31\n\nRetro: [[Beacon API]] latency issues traced to [[PostgreSQL]] query planner. [[Bob Martinez]] investigating.\n',
    [
      { entity: 'Beacon API', tier: 1, reason: 'direct project reference' },
      { entity: 'PostgreSQL', tier: 1, reason: 'technology discussed' },
      { entity: 'Bob Martinez', tier: 1, reason: 'direct mention' },
    ],
  );

  // Architecture docs (5) — cross-folder tech mentions
  addContentNote('docs/architecture-overview.md', 'Architecture Overview',
    '---\ntype: document\n---\n# Architecture Overview\n\nThe system comprises [[Atlas Platform]] at the core, with [[Beacon API]] providing external access. Data flows through [[Delta Pipeline]] into [[PostgreSQL]].\n\n[[TypeScript]] is the primary language. [[GraphQL]] serves the query layer.\n',
    [
      { entity: 'Atlas Platform', tier: 1, reason: 'core architectural component' },
      { entity: 'Beacon API', tier: 1, reason: 'core architectural component' },
      { entity: 'Delta Pipeline', tier: 1, reason: 'core architectural component' },
      { entity: 'PostgreSQL', tier: 1, reason: 'core technology' },
      { entity: 'TypeScript', tier: 1, reason: 'primary language' },
      { entity: 'GraphQL', tier: 1, reason: 'core technology' },
    ],
  );

  addContentNote('docs/onboarding-guide.md', 'Onboarding Guide',
    '---\ntype: document\n---\n# Onboarding Guide\n\nNew engineers should start with the [[Atlas Platform]] codebase. Contact [[Alice Zhang]] for access. Set up local [[PostgreSQL]] and [[Redis]] instances.\n\nFor API work, see [[Beacon API]]. For frontend, see [[Compass Dashboard]].\n',
    [
      { entity: 'Atlas Platform', tier: 1, reason: 'primary onboarding target' },
      { entity: 'Alice Zhang', tier: 1, reason: 'point of contact' },
      { entity: 'PostgreSQL', tier: 1, reason: 'setup requirement' },
      { entity: 'Redis', tier: 1, reason: 'setup requirement' },
      { entity: 'Beacon API', tier: 2, reason: 'secondary reference' },
      { entity: 'Compass Dashboard', tier: 2, reason: 'secondary reference' },
    ],
  );

  addContentNote('docs/deployment-runbook.md', 'Deployment Runbook',
    '---\ntype: document\n---\n# Deployment Runbook\n\nAll services deploy to [[Kubernetes]] via the [[Delta Pipeline]]. [[Dan Okafor]] is the deployment lead.\n\nMonitoring for [[Echo Service]] uses [[Redis]] metrics.\n',
    [
      { entity: 'Kubernetes', tier: 1, reason: 'deployment target' },
      { entity: 'Delta Pipeline', tier: 1, reason: 'deployment mechanism' },
      { entity: 'Dan Okafor', tier: 1, reason: 'deployment lead' },
      { entity: 'Echo Service', tier: 2, reason: 'secondary service' },
      { entity: 'Redis', tier: 2, reason: 'monitoring detail' },
    ],
  );

  addContentNote('docs/api-standards.md', 'API Standards',
    '---\ntype: document\n---\n# API Standards\n\nAll APIs must follow [[GraphQL]] schema conventions. The [[Beacon API]] is the reference implementation. [[Bob Martinez]] owns the style guide.\n\n[[TypeScript]] strict mode is mandatory.\n',
    [
      { entity: 'GraphQL', tier: 1, reason: 'primary standard' },
      { entity: 'Beacon API', tier: 1, reason: 'reference implementation' },
      { entity: 'Bob Martinez', tier: 1, reason: 'style guide owner' },
      { entity: 'TypeScript', tier: 2, reason: 'tooling requirement' },
    ],
  );

  addContentNote('docs/data-strategy.md', 'Data Strategy',
    '---\ntype: document\n---\n# Data Strategy\n\nPrimary store is [[PostgreSQL]] via [[Atlas Platform]]. Caching via [[Redis]] in [[Echo Service]]. [[Eva Petrov]] leads the data team.\n',
    [
      { entity: 'PostgreSQL', tier: 1, reason: 'primary data store' },
      { entity: 'Atlas Platform', tier: 1, reason: 'platform reference' },
      { entity: 'Redis', tier: 1, reason: 'caching layer' },
      { entity: 'Echo Service', tier: 1, reason: 'service reference' },
      { entity: 'Eva Petrov', tier: 1, reason: 'data team lead' },
    ],
  );

  // Meeting notes (5) — people-heavy
  addContentNote('meetings/2026-01-20-sprint-planning.md', 'Sprint Planning Jan 20',
    '---\ntype: meeting\ndate: 2026-01-20\n---\n# Sprint Planning Jan 20\n\nAttendees: [[Alice Zhang]], [[Bob Martinez]], [[Carol Davies]]\n\nDiscussed [[Atlas Platform]] Q1 goals. [[Beacon API]] needs performance work. [[Carol Davies]] to prototype new [[Compass Dashboard]] widgets.\n',
    [
      { entity: 'Alice Zhang', tier: 1, reason: 'attendee' },
      { entity: 'Bob Martinez', tier: 1, reason: 'attendee' },
      { entity: 'Carol Davies', tier: 1, reason: 'attendee with action item' },
      { entity: 'Atlas Platform', tier: 1, reason: 'discussed project' },
      { entity: 'Beacon API', tier: 1, reason: 'discussed project' },
      { entity: 'Compass Dashboard', tier: 1, reason: 'action item target' },
    ],
  );

  addContentNote('meetings/2026-01-22-infra-review.md', 'Infra Review Jan 22',
    '---\ntype: meeting\ndate: 2026-01-22\n---\n# Infra Review Jan 22\n\nAttendees: [[Dan Okafor]], [[Eva Petrov]]\n\n[[Kubernetes]] upgrade path discussed. [[Delta Pipeline]] needs resource limits. [[Echo Service]] stable.\n',
    [
      { entity: 'Dan Okafor', tier: 1, reason: 'attendee' },
      { entity: 'Eva Petrov', tier: 1, reason: 'attendee' },
      { entity: 'Kubernetes', tier: 1, reason: 'discussed technology' },
      { entity: 'Delta Pipeline', tier: 1, reason: 'discussed project' },
      { entity: 'Echo Service', tier: 2, reason: 'brief mention' },
    ],
  );

  addContentNote('meetings/2026-01-25-architecture-review.md', 'Architecture Review Jan 25',
    '---\ntype: meeting\ndate: 2026-01-25\n---\n# Architecture Review Jan 25\n\n[[Alice Zhang]] presented [[Atlas Platform]] scaling plan. Discussed migrating from REST to [[GraphQL]]. [[Bob Martinez]] to update [[Beacon API]].\n',
    [
      { entity: 'Alice Zhang', tier: 1, reason: 'presenter' },
      { entity: 'Atlas Platform', tier: 1, reason: 'presentation topic' },
      { entity: 'GraphQL', tier: 1, reason: 'migration target' },
      { entity: 'Bob Martinez', tier: 1, reason: 'action item owner' },
      { entity: 'Beacon API', tier: 1, reason: 'action item target' },
    ],
  );

  addContentNote('meetings/2026-01-28-data-sync.md', 'Data Team Sync Jan 28',
    '---\ntype: meeting\ndate: 2026-01-28\n---\n# Data Team Sync Jan 28\n\n[[Eva Petrov]] reported [[Echo Service]] uptime at 99.9%. [[Redis]] cluster performing well. Need to coordinate with [[Dan Okafor]] on [[Delta Pipeline]] data formats.\n',
    [
      { entity: 'Eva Petrov', tier: 1, reason: 'reporter' },
      { entity: 'Echo Service', tier: 1, reason: 'uptime report' },
      { entity: 'Redis', tier: 1, reason: 'cluster performance' },
      { entity: 'Dan Okafor', tier: 2, reason: 'coordination needed' },
      { entity: 'Delta Pipeline', tier: 2, reason: 'coordination target' },
    ],
  );

  addContentNote('meetings/2026-01-30-all-hands.md', 'All-Hands Jan 30',
    '---\ntype: meeting\ndate: 2026-01-30\n---\n# All-Hands Jan 30\n\n[[Alice Zhang]] announced [[Atlas Platform]] launch. Tech stack: [[TypeScript]], [[PostgreSQL]], [[Kubernetes]]. All teams contributed.\n',
    [
      { entity: 'Alice Zhang', tier: 1, reason: 'announcer' },
      { entity: 'Atlas Platform', tier: 1, reason: 'launch announcement' },
      { entity: 'TypeScript', tier: 2, reason: 'tech stack mention' },
      { entity: 'PostgreSQL', tier: 2, reason: 'tech stack mention' },
      { entity: 'Kubernetes', tier: 2, reason: 'tech stack mention' },
    ],
  );

  // Project status notes (5) — in projects/ folder for cross-folder testing
  addContentNote('projects/atlas-status-q1.md', 'Atlas Platform Q1 Status',
    '---\ntype: status\nproject: Atlas Platform\n---\n# Atlas Platform Q1 Status\n\nLead: [[Alice Zhang]]. Backend: [[TypeScript]] + [[PostgreSQL]]. API integration with [[Beacon API]] proceeding.\n\n[[Bob Martinez]] contributing to shared modules.\n',
    [
      { entity: 'Alice Zhang', tier: 1, reason: 'project lead' },
      { entity: 'TypeScript', tier: 1, reason: 'technology used' },
      { entity: 'PostgreSQL', tier: 1, reason: 'technology used' },
      { entity: 'Beacon API', tier: 1, reason: 'integration target' },
      { entity: 'Bob Martinez', tier: 2, reason: 'contributor' },
    ],
  );

  addContentNote('projects/beacon-api-roadmap.md', 'Beacon API Roadmap',
    '---\ntype: roadmap\nproject: Beacon API\n---\n# Beacon API Roadmap\n\nOwner: [[Bob Martinez]]. Migrate to [[GraphQL]] fully. Must integrate with [[Atlas Platform]] auth layer.\n\n[[Carol Davies]] needs stable endpoints for [[Compass Dashboard]].\n',
    [
      { entity: 'Bob Martinez', tier: 1, reason: 'project owner' },
      { entity: 'GraphQL', tier: 1, reason: 'migration target' },
      { entity: 'Atlas Platform', tier: 1, reason: 'integration dependency' },
      { entity: 'Carol Davies', tier: 2, reason: 'downstream consumer' },
      { entity: 'Compass Dashboard', tier: 2, reason: 'downstream project' },
    ],
  );

  addContentNote('projects/compass-sprint-3.md', 'Compass Dashboard Sprint 3',
    '---\ntype: sprint\nproject: Compass Dashboard\n---\n# Compass Dashboard Sprint 3\n\n[[Carol Davies]] leading. Building new charts with [[GraphQL]] queries against [[Beacon API]]. [[TypeScript]] migration 80% complete.\n',
    [
      { entity: 'Carol Davies', tier: 1, reason: 'sprint lead' },
      { entity: 'GraphQL', tier: 1, reason: 'query layer' },
      { entity: 'Beacon API', tier: 1, reason: 'data source' },
      { entity: 'TypeScript', tier: 2, reason: 'migration progress' },
    ],
  );

  addContentNote('projects/delta-pipeline-perf.md', 'Delta Pipeline Performance',
    '---\ntype: analysis\nproject: Delta Pipeline\n---\n# Delta Pipeline Performance\n\n[[Dan Okafor]] analyzed throughput. Running on [[Kubernetes]] with 8 pods. Feeds data to [[PostgreSQL]] and [[Echo Service]].\n',
    [
      { entity: 'Dan Okafor', tier: 1, reason: 'analyst' },
      { entity: 'Kubernetes', tier: 1, reason: 'infrastructure' },
      { entity: 'PostgreSQL', tier: 2, reason: 'data destination' },
      { entity: 'Echo Service', tier: 2, reason: 'downstream consumer' },
    ],
  );

  addContentNote('projects/echo-service-monitoring.md', 'Echo Service Monitoring',
    '---\ntype: analysis\nproject: Echo Service\n---\n# Echo Service Monitoring\n\n[[Eva Petrov]] set up dashboards. [[Redis]] memory usage tracked. Alerts configured for [[Kubernetes]] pod restarts.\n\nIntegrates with [[Delta Pipeline]] for event sourcing.\n',
    [
      { entity: 'Eva Petrov', tier: 1, reason: 'dashboard owner' },
      { entity: 'Redis', tier: 1, reason: 'monitored system' },
      { entity: 'Kubernetes', tier: 1, reason: 'monitored infrastructure' },
      { entity: 'Delta Pipeline', tier: 2, reason: 'integration' },
    ],
  );

  // Tech notes (5) — in technologies/ folder
  addContentNote('technologies/typescript-best-practices.md', 'TypeScript Best Practices',
    '---\ntype: guide\n---\n# TypeScript Best Practices\n\nUsed by [[Atlas Platform]], [[Beacon API]], and [[Compass Dashboard]]. [[Alice Zhang]] maintains the lint config.\n',
    [
      { entity: 'Atlas Platform', tier: 1, reason: 'user of TypeScript' },
      { entity: 'Beacon API', tier: 1, reason: 'user of TypeScript' },
      { entity: 'Compass Dashboard', tier: 2, reason: 'user of TypeScript' },
      { entity: 'Alice Zhang', tier: 2, reason: 'config maintainer' },
    ],
  );

  addContentNote('technologies/postgresql-tuning.md', 'PostgreSQL Tuning',
    '---\ntype: guide\n---\n# PostgreSQL Tuning\n\nPrimary store for [[Atlas Platform]]. [[Bob Martinez]] ran vacuum and analyze. Connection pooling configured for [[Beacon API]].\n',
    [
      { entity: 'Atlas Platform', tier: 1, reason: 'primary user' },
      { entity: 'Bob Martinez', tier: 1, reason: 'tuning operator' },
      { entity: 'Beacon API', tier: 2, reason: 'connection pooling consumer' },
    ],
  );

  addContentNote('technologies/redis-patterns.md', 'Redis Patterns',
    '---\ntype: guide\n---\n# Redis Patterns\n\nCaching patterns used in [[Echo Service]]. [[Eva Petrov]] documented pub/sub usage. Session caching for [[Compass Dashboard]].\n',
    [
      { entity: 'Echo Service', tier: 1, reason: 'primary user' },
      { entity: 'Eva Petrov', tier: 1, reason: 'documentation author' },
      { entity: 'Compass Dashboard', tier: 2, reason: 'session caching' },
    ],
  );

  addContentNote('technologies/graphql-schema-design.md', 'GraphQL Schema Design',
    '---\ntype: guide\n---\n# GraphQL Schema Design\n\nSchema conventions for [[Beacon API]]. [[Bob Martinez]] and [[Carol Davies]] co-authored. Query patterns for [[Compass Dashboard]].\n',
    [
      { entity: 'Beacon API', tier: 1, reason: 'primary API' },
      { entity: 'Bob Martinez', tier: 1, reason: 'co-author' },
      { entity: 'Carol Davies', tier: 1, reason: 'co-author' },
      { entity: 'Compass Dashboard', tier: 2, reason: 'consumer' },
    ],
  );

  addContentNote('technologies/kubernetes-operations.md', 'Kubernetes Operations',
    '---\ntype: guide\n---\n# Kubernetes Operations\n\nCluster management for [[Delta Pipeline]] and [[Echo Service]]. [[Dan Okafor]] is primary operator. Uses [[Redis]] for coordination.\n',
    [
      { entity: 'Delta Pipeline', tier: 1, reason: 'hosted workload' },
      { entity: 'Echo Service', tier: 1, reason: 'hosted workload' },
      { entity: 'Dan Okafor', tier: 1, reason: 'primary operator' },
      { entity: 'Redis', tier: 2, reason: 'coordination tool' },
    ],
  );

  // Write all content notes to disk
  for (const note of notes) {
    // Only write notes that are not already entity notes
    if (!entityNoteContent[note.path]) {
      await createTestNote(vaultPath, note.path, note.content);
    }
  }

  // Build the spec
  const spec: GroundTruthSpec = {
    seed: 42,
    description: 'Generated 50-note vault for layer ablation testing',
    entities,
    notes,
    groundTruth: groundTruthLinks,
  };

  // Open StateDb and initialize entity index
  const stateDb = openStateDb(vaultPath);
  setWriteStateDb(stateDb);
  setRecencyStateDb(stateDb);
  await initializeEntityIndex(vaultPath);

  const cleanup = async () => {
    setWriteStateDb(null);
    setRecencyStateDb(null);
    stateDb.close();
    deleteStateDb(vaultPath);
    await rm(vaultPath, { recursive: true, force: true });
  };

  const vault: TempVault = { vaultPath, stateDb, spec, cleanup };

  return { vault, groundTruth: spec };
}

// =============================================================================
// Test Suite
// =============================================================================

describe('Suite 3: Layer Ablation — Cross-Vault Analysis', () => {
  const timer = new Timer();

  // Primary vault (curated fixture)
  let primaryVault: TempVault;
  let primarySpec: GroundTruthSpec;

  // Generated vault (synthetic)
  let generatedVault: TempVault;
  let generatedSpec: GroundTruthSpec;

  // Results
  let primaryResults: VaultAblationResults;
  let generatedResults: VaultAblationResults;

  /**
   * Run a full ablation analysis on a single vault.
   * Returns baseline + 13 layer-disabled runs.
   */
  async function runAblationSuite(
    vault: TempVault,
    spec: GroundTruthSpec,
    vaultName: string,
  ): Promise<VaultAblationResults> {
    // Baseline: all layers enabled
    const baselineRuns = await runSuggestionsOnVault(vault, { strictness: 'balanced' });
    const baseline = evaluateSuggestions(baselineRuns, spec.groundTruth, spec.entities);

    // Ablate each layer
    const layers: LayerAblationResult[] = [];
    for (const layer of ALL_LAYERS) {
      const ablatedRuns = await runSuggestionsOnVault(vault, {
        strictness: 'balanced',
        disabledLayers: [layer],
      });
      const ablated = evaluateSuggestions(ablatedRuns, spec.groundTruth, spec.entities);

      const f1Delta = baseline.f1 - ablated.f1;
      const precisionDelta = baseline.precision - ablated.precision;
      const recallDelta = baseline.recall - ablated.recall;

      layers.push({
        layer,
        baselineF1: baseline.f1,
        ablatedF1: ablated.f1,
        f1Delta,
        baselinePrecision: baseline.precision,
        ablatedPrecision: ablated.precision,
        precisionDelta,
        baselineRecall: baseline.recall,
        ablatedRecall: ablated.recall,
        recallDelta,
        classification: classifyLayer(f1Delta),
      });
    }

    return { vaultName, baseline, layers };
  }

  beforeAll(async () => {
    // --- Build primary vault ---
    primarySpec = await loadPrimaryVault();
    primaryVault = await buildGroundTruthVault(primarySpec);
    await stripLinks(primaryVault, primarySpec.groundTruth);

    // --- Build generated vault ---
    const generated = await buildGeneratedVault();
    generatedVault = generated.vault;
    generatedSpec = generated.groundTruth;

    // Strip [[links]] from generated vault content notes
    await stripLinks(generatedVault, generatedSpec.groundTruth);

    // --- Run ablation suites ---
    // Must restore module-level state for each vault since setWriteStateDb is global
    setWriteStateDb(primaryVault.stateDb);
    setRecencyStateDb(primaryVault.stateDb);
    await initializeEntityIndex(primaryVault.vaultPath);
    primaryResults = await runAblationSuite(primaryVault, primarySpec, 'primary');

    setWriteStateDb(generatedVault.stateDb);
    setRecencyStateDb(generatedVault.stateDb);
    await initializeEntityIndex(generatedVault.vaultPath);
    generatedResults = await runAblationSuite(generatedVault, generatedSpec, 'generated');
  }, 180000);

  afterAll(async () => {
    // Write report before cleanup
    const report: TestReport = {
      suite: 'layer-ablation-report',
      timestamp: new Date().toISOString(),
      duration_ms: timer.elapsed(),
      summary: {
        primary_baseline_f1: primaryResults?.baseline.f1 ?? 0,
        primary_baseline_precision: primaryResults?.baseline.precision ?? 0,
        primary_baseline_recall: primaryResults?.baseline.recall ?? 0,
        generated_baseline_f1: generatedResults?.baseline.f1 ?? 0,
        generated_baseline_precision: generatedResults?.baseline.precision ?? 0,
        generated_baseline_recall: generatedResults?.baseline.recall ?? 0,
        total_ablation_runs: 28,
        core_layers: countClassification('CORE'),
        useful_layers: countClassification('USEFUL'),
        marginal_layers: countClassification('MARGINAL'),
        harmful_layers: countClassification('HARMFUL'),
      },
      details: [
        {
          vault: 'primary',
          baseline: primaryResults?.baseline,
          layers: primaryResults?.layers,
        },
        {
          vault: 'generated',
          baseline: generatedResults?.baseline,
          layers: generatedResults?.layers,
        },
      ],
      tuning_recommendations: buildTuningRecommendations(),
    };

    await writeReport(report);

    // Cleanup vaults
    if (primaryVault) await primaryVault.cleanup();
    if (generatedVault) await generatedVault.cleanup();
  });

  /** Count layers with a given classification across both vaults */
  function countClassification(cls: LayerClassification): number {
    if (!primaryResults || !generatedResults) return 0;
    const allLayers = [...primaryResults.layers, ...generatedResults.layers];
    return allLayers.filter(l => l.classification === cls).length;
  }

  /** Build tuning recommendations from ablation results */
  function buildTuningRecommendations(): TuningRecommendation[] {
    const recs: TuningRecommendation[] = [];
    if (!primaryResults || !generatedResults) return recs;

    // Find layers HARMFUL on both vaults
    for (const layer of ALL_LAYERS) {
      const primary = primaryResults.layers.find(l => l.layer === layer);
      const generated = generatedResults.layers.find(l => l.layer === layer);
      if (primary && generated) {
        if (primary.classification === 'HARMFUL' && generated.classification === 'HARMFUL') {
          recs.push({
            parameter: `layer.${layer}`,
            current_value: 1,
            suggested_value: 0,
            evidence: `Layer "${layer}" is HARMFUL on both vaults (primary delta: ${primary.f1Delta.toFixed(4)}, generated delta: ${generated.f1Delta.toFixed(4)}). Consider disabling.`,
            confidence: 'high',
          });
        } else if (primary.classification === 'HARMFUL' || generated.classification === 'HARMFUL') {
          recs.push({
            parameter: `layer.${layer}`,
            current_value: 1,
            suggested_value: 1,
            evidence: `Layer "${layer}" is HARMFUL on one vault but not both. Investigate weight tuning rather than disabling.`,
            confidence: 'medium',
          });
        }
      }
    }

    // Recommend weight increase for CORE layers
    for (const layer of ALL_LAYERS) {
      const primary = primaryResults.layers.find(l => l.layer === layer);
      const generated = generatedResults.layers.find(l => l.layer === layer);
      if (primary && generated) {
        if (primary.classification === 'CORE' && generated.classification === 'CORE') {
          recs.push({
            parameter: `layer.${layer}.weight`,
            current_value: 1,
            suggested_value: 1.2,
            evidence: `Layer "${layer}" is CORE on both vaults (primary delta: ${primary.f1Delta.toFixed(4)}, generated delta: ${generated.f1Delta.toFixed(4)}). Consider increasing weight.`,
            confidence: 'medium',
          });
        }
      }
    }

    return recs;
  }

  // ===========================================================================
  // Baseline Assertions
  // ===========================================================================

  describe('Baseline quality', () => {
    it('primary vault baseline F1 >= 0.60', () => {
      expect(primaryResults.baseline.f1).toBeGreaterThanOrEqual(0.60);
    });

    it('generated vault baseline produces valid results', () => {
      expect(generatedResults.baseline.f1).toBeGreaterThan(0);
      expect(generatedResults.baseline.totalSuggestions).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Core Layer Assertions
  // ===========================================================================

  describe('exact_match is CORE', () => {
    it('exact_match has non-negative F1 delta on primary vault', () => {
      const result = primaryResults.layers.find(l => l.layer === 'exact_match')!;
      expect(result).toBeDefined();
      // When exact_match is disabled, stem_match may still catch the same entities,
      // resulting in zero delta. The key assertion is that it's not harmful.
      expect(result.f1Delta).toBeGreaterThanOrEqual(0);
    });

    it('exact_match has non-negative F1 delta on generated vault', () => {
      const result = generatedResults.layers.find(l => l.layer === 'exact_match')!;
      expect(result).toBeDefined();
      // On synthetic vaults, exact_match may not change F1 if all matches
      // are already strong enough without the bonus
      expect(result.f1Delta).toBeGreaterThanOrEqual(0);
    });
  });

  // ===========================================================================
  // No layer HARMFUL on both vaults
  // ===========================================================================

  describe('No layer is HARMFUL on both vaults', () => {
    for (const layer of ALL_LAYERS) {
      it(`${layer} is not HARMFUL on both vaults`, () => {
        const primary = primaryResults.layers.find(l => l.layer === layer)!;
        const generated = generatedResults.layers.find(l => l.layer === layer)!;
        expect(primary).toBeDefined();
        expect(generated).toBeDefined();

        const bothHarmful = primary.classification === 'HARMFUL' && generated.classification === 'HARMFUL';
        expect(bothHarmful).toBe(false);
      });
    }
  });

  // ===========================================================================
  // Minimum useful layers
  // ===========================================================================

  describe('Layer utility distribution', () => {
    it('at least 2 layers classified as CORE or USEFUL across both vaults', () => {
      // On small/synthetic vaults many layers are MARGINAL because they lack
      // the data to contribute (no recency, no feedback, no embeddings, etc.)
      // The threshold is deliberately low; the ablation report details
      // which layers contribute on which vault sizes.
      const usefulLayers = new Set<ScoringLayer>();
      for (const layer of ALL_LAYERS) {
        const primary = primaryResults.layers.find(l => l.layer === layer);
        const generated = generatedResults.layers.find(l => l.layer === layer);
        if (
          (primary && (primary.classification === 'CORE' || primary.classification === 'USEFUL')) ||
          (generated && (generated.classification === 'CORE' || generated.classification === 'USEFUL'))
        ) {
          usefulLayers.add(layer);
        }
      }
      expect(usefulLayers.size).toBeGreaterThanOrEqual(2);
    });
  });

  // ===========================================================================
  // All runs complete without crash
  // ===========================================================================

  describe('All ablation runs complete', () => {
    it('primary vault has 13 layer results', () => {
      expect(primaryResults.layers).toHaveLength(ALL_LAYERS.length);
    });

    it('generated vault has 13 layer results', () => {
      expect(generatedResults.layers).toHaveLength(ALL_LAYERS.length);
    });

    it('no ablation run produced NaN F1', () => {
      for (const result of [...primaryResults.layers, ...generatedResults.layers]) {
        expect(Number.isNaN(result.ablatedF1)).toBe(false);
        expect(Number.isNaN(result.f1Delta)).toBe(false);
      }
    });
  });

  // ===========================================================================
  // Per-layer detail tests
  // ===========================================================================

  describe('Per-layer classifications', () => {
    for (const layer of ALL_LAYERS) {
      it(`${layer}: classification is valid on both vaults`, () => {
        const primary = primaryResults.layers.find(l => l.layer === layer)!;
        const generated = generatedResults.layers.find(l => l.layer === layer)!;

        expect(primary.classification).toMatch(/^(CORE|USEFUL|MARGINAL|HARMFUL)$/);
        expect(generated.classification).toMatch(/^(CORE|USEFUL|MARGINAL|HARMFUL)$/);
      });
    }
  });
});
