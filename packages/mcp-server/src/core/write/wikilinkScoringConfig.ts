/**
 * Wikilink scoring configuration + pure helpers (arch-review G5, part F2)
 *
 * Tokenizers, entity-name filters, and the static per-layer boost tables
 * used by the suggestion scoring engine (wikilinkSuggest.ts) and the
 * write pipeline (wikilinkPipeline.ts). Pure functions only — no module
 * state, no SQL.
 */

import {
  IMPLICIT_EXCLUDE_WORDS,
  COMMON_ENGLISH_WORDS,
  type EntityCategory,
} from '@velvetmonkey/vault-core';
import type { NoteContext } from './types.js';
import { stem, tokenize } from '../shared/stemmer.js';
import { getInferredCategory } from '../read/embeddings.js';

/**
 * Tokenize content into significant words for matching
 * Uses the shared stemmer module for consistent tokenization
 * @param content - Content to tokenize
 * @returns Array of significant words (lowercase, 4+ chars, no stopwords)
 */
export function tokenizeContent(content: string): string[] {
  return tokenize(content);
}

/**
 * Tokenize content and compute stems for matching
 * @param content - Content to tokenize
 * @returns Object with tokens set and stems set
 */
export function tokenizeForMatching(content: string): {
  tokens: Set<string>;
  stems: Set<string>;
} {
  const tokens = tokenize(content);
  const tokenSet = new Set(tokens);
  const stems = new Set(tokens.map(t => stem(t)));
  return { tokens: tokenSet, stems };
}

/**
 * Maximum entity name length for suggestions
 * Filters out article titles, clippings, and other long names
 */
export const MAX_ENTITY_LENGTH = 25;

/**
 * Maximum word count for entity names
 * Concepts are typically 1-3 words; longer names are article titles
 */
const MAX_ENTITY_WORDS = 3;

/**
 * Patterns that indicate an entity is an article title, not a concept
 * Case-insensitive matching
 */
const ARTICLE_PATTERNS = [
  /\bguide\s+to\b/i,
  /\bhow\s+to\b/i,
  /\bcomplete\s+/i,
  /\bultimate\s+/i,
  /\bchecklist\b/i,
  /\bcheatsheet\b/i,
  /\bcheat\s+sheet\b/i,
  /\bbest\s+practices\b/i,
  /\bintroduction\s+to\b/i,
  /\btutorial\b/i,
  /\bworksheet\b/i,
];

/**
 * Check if an entity name looks like an article title rather than a concept
 *
 * Heuristics:
 * - Matches known article patterns ("Guide to", "How to", etc.)
 * - Has more than 3 words (concepts are usually 1-3 words)
 *
 * @param name - Entity name to check
 * @returns true if this looks like an article title
 */
export function isLikelyArticleTitle(name: string): boolean {
  // Check against article patterns
  if (ARTICLE_PATTERNS.some(pattern => pattern.test(name))) {
    return true;
  }

  // Count words (split on whitespace, filter empty)
  const words = name.split(/\s+/).filter(w => w.length > 0);
  if (words.length > MAX_ENTITY_WORDS) {
    return true;
  }

  return false;
}

/**
 * Type-based score boost per entity category
 *
 * People and projects are typically more useful to link than
 * common technologies (which may over-saturate links).
 */
const TYPE_BOOST: Record<string, number> = {
  people: 5,         // Names are high value for connections
  animals: 3,        // Pets and animals are personal and specific
  projects: 3,       // Projects provide context
  organizations: 2,  // Companies/teams relevant
  events: 2,         // Meetings, trips, milestones
  media: 2,          // Movies, books, shows
  health: 2,         // Medical, fitness — personal relevance
  vehicles: 2,       // Cars, bikes — specific items
  locations: 1,      // Geographic context
  concepts: 1,       // Abstract concepts
  documents: 1,      // Reports, guides
  food: 1,           // Recipes, restaurants
  hobbies: 1,        // Crafts, sports
  finance: 2,        // Accounts, budgets
  periodical: 1,     // Daily/weekly/monthly notes — low boost
  technologies: 0,   // Common, avoid over-suggesting
  acronyms: 0,       // Acronyms may be ambiguous
  other: 0,          // Unknown category
};

/** Get type boost for a category, checking custom config overrides first */
export function getTypeBoost(
  category: string,
  customCategories?: Record<string, { type_boost?: number }>,
  entityName?: string,
): number {
  if (customCategories?.[category]?.type_boost != null) {
    return customCategories[category].type_boost!;
  }
  if (category === 'other' && entityName) {
    const inferred = getInferredCategory(entityName);
    if (inferred) {
      return TYPE_BOOST[inferred.category] || 0;
    }
  }
  return TYPE_BOOST[category] || 0;
}

export function isCommonWordFalsePositive(
  entityName: string,
  rawContent: string,
  category: string,
): boolean {
  const nameTokens = tokenize(entityName);
  if (nameTokens.length !== 1) return false;

  const EXEMPT_CATEGORIES = new Set(['people', 'animals', 'projects', 'organizations']);
  if (EXEMPT_CATEGORIES.has(category)) return false;

  const lowerName = entityName.toLowerCase();
  if (!IMPLICIT_EXCLUDE_WORDS.has(lowerName) && !COMMON_ENGLISH_WORDS.has(lowerName)) return false;

  return !rawContent.includes(entityName);
}

/**
 * Cross-folder boost - prioritize cross-cutting connections
 *
 * Entities from different top-level folders are more valuable for
 * building cross-cutting connections in the knowledge graph.
 * A person note linking to a project note is more valuable than
 * project notes linking to other project notes.
 */
/**
 * Generic folders that shouldn't penalize cross-folder suggestions
 * (these folders contain notes that naturally reference all domains)
 */
const GENERIC_FOLDERS = new Set(['daily-notes', 'weekly-notes', 'clippings', 'templates', 'new']);

/**
 * Hub note boost - logarithmic scaling
 *
 * Notes with many backlinks (hub notes) are more central to the knowledge graph,
 * but tiered scoring gave mega-hubs (hubScore 100+) the same +8 as hubScore 700,
 * letting ~6 entities dominate 60-90% of all suffix lines regardless of content.
 *
 * Log₂ scaling gives a smooth curve: 5→1.4, 20→2.6, 50→3.4, 100→4.0, 200→4.6, 700→5.7
 * Capped at 6 (down from 8). The gap between hub=100 and hub=700 is now 1.7 instead of 0.
 */

/**
 * Semantic similarity constants for Layer 11
 */
export const SEMANTIC_MIN_SIMILARITY = 0.30;
export const SEMANTIC_MAX_BOOST = 12;

/**
 * Get domain affinity boost/penalty for an entity relative to the current note.
 *
 * Replaces the old flat CROSS_FOLDER_BOOST=3 with bidirectional scoring:
 * - Same top-level folder: +2 (same domain, encouraged)
 * - Same second-level folder: +3 (strong same-domain)
 * - Cross-folder from generic folders: 0 (neutral)
 * - Cross-folder into daily notes: -1 (daily notes are inherently cross-domain)
 * - Cross-folder, other: -3 (cross-domain penalty)
 */
export function getCrossFolderBoost(entityPath: string, notePath: string): number {
  if (!entityPath || !notePath) return 0;

  const entityParts = entityPath.split('/');
  const noteParts = notePath.split('/');
  const entityFolder = entityParts[0];
  const noteFolder = noteParts[0];

  if (!entityFolder || !noteFolder) return 0;

  // Same top-level folder
  if (entityFolder === noteFolder) {
    // Same second-level folder = strong affinity
    if (entityParts[1] && noteParts[1] && entityParts[1] === noteParts[1]) {
      return 3;
    }
    return 2;
  }

  // Cross-folder: entity comes from a generic folder (neutral)
  if (GENERIC_FOLDERS.has(entityFolder)) return 0;

  // Cross-folder: target is a daily note (mild penalty — daily notes are cross-domain by nature)
  if (GENERIC_FOLDERS.has(noteFolder)) return -1;

  // Cross-folder: different domains (penalty)
  return -3;
}

/**
 * Get hub score boost for an entity using logarithmic scaling
 *
 * @param entity - Entity object with optional hubScore
 * @returns Boost value based on log₂(hubScore), capped at 6
 */
export function getHubBoost(entity: { hubScore?: number }): number {
  const hubScore = entity.hubScore ?? 0;
  if (hubScore <= 0) return 0;

  // Dampened log scaling: 5→0.8, 20→1.6, 50→2.1, 100→2.4, 200→2.8, 700→3.4
  // Max cap 4 (down from 6). Slope factor 0.6 prevents mega-hubs from dominating.
  return Math.min(Math.round(Math.log2(hubScore) * 6) / 10, 4);
}

/**
 * Context-aware boost per note type and entity category
 *
 * Boosts entity types that are more relevant to specific note contexts:
 * - Daily notes: people are most relevant (who did I interact with?)
 * - Project notes: projects and technologies are most relevant
 * - Tech docs: technologies and acronyms are most relevant
 */
export const CONTEXT_BOOST: Record<NoteContext, Partial<Record<EntityCategory, number>>> = {
  daily: {
    people: 5,       // Daily notes often mention people
    animals: 3,      // Pets in daily life
    events: 3,       // Daily events and meetings
    projects: 2,     // Work updates reference projects
    food: 2,         // Meals and recipes in daily logs
    health: 2,       // Fitness and wellness tracking
  },
  project: {
    projects: 5,     // Project docs reference other projects
    technologies: 2, // Technical dependencies
    documents: 2,    // Reference documents
  },
  tech: {
    technologies: 5, // Tech docs reference technologies
    acronyms: 3,     // Technical acronyms
  },
  general: {},       // No context-specific boost
};

/**
 * Detect note context from path
 *
 * Analyzes path segments to determine note type for context-aware boosting.
 *
 * @param notePath - Path to the note (vault-relative)
 * @returns Detected note context
 */
export function getNoteContext(notePath: string): NoteContext {
  const lower = notePath.toLowerCase();

  // Daily notes, journals, logs
  if (
    lower.includes('daily-notes') ||
    lower.includes('daily/') ||
    lower.includes('journal') ||
    lower.includes('logs/') ||
    lower.includes('/log/')
  ) {
    return 'daily';
  }

  // Project and systems documentation
  if (
    lower.includes('projects/') ||
    lower.includes('project/') ||
    lower.includes('systems/') ||
    lower.includes('initiatives/')
  ) {
    return 'project';
  }

  // Technical documentation
  if (
    lower.includes('tech/') ||
    lower.includes('code/') ||
    lower.includes('engineering/') ||
    lower.includes('docs/') ||
    lower.includes('documentation/')
  ) {
    return 'tech';
  }

  return 'general';
}
