/**
 * Re-export read types from shared/types.ts (canonical source)
 */
export type { OutLink, VaultNote, Backlink, VaultIndex } from '../shared/types.js';

// =============================================================================
// Index/config/category types (moved from graph.ts, embeddings.ts, config.ts
// so vault-scope.ts and vault-types.ts can type against leaf modules — part
// of the arch-review S1 import-cycle collapse)
// =============================================================================

/** Current build state of the vault index */
export type IndexState = 'building' | 'ready' | 'error';

/** Semantic category inferred for an entity by the centroid classifier */
export interface InferredCategory {
  entityName: string;
  category: string;
  confidence: number;
}

/** Path configuration for periodic notes and templates */
export interface FlywheelPaths {
  daily_notes?: string;
  weekly_notes?: string;
  monthly_notes?: string;
  quarterly_notes?: string;
  yearly_notes?: string;
  templates?: string;
}

/** Discovered template file paths (vault-relative) */
export interface FlywheelTemplates {
  daily?: string;      // e.g. "templates/daily.md"
  weekly?: string;
  monthly?: string;
  quarterly?: string;
  yearly?: string;
}

export interface FlywheelConfig {
  vault_name?: string;
  paths?: FlywheelPaths;
  templates?: FlywheelTemplates;
  /**
   * Unified exclusion list — CSV of #hashtags or entity names/aliases.
   * Excludes from all analysis: tasks, graph, suggestions, hub rankings.
   * Examples: ["#habit", "#daily", "walk", "vitamins"]
   */
  exclude?: string[];
  /** @deprecated Use `exclude` instead. Migrated on config load. */
  exclude_task_tags?: string[];
  /** @deprecated Use `exclude` instead. Migrated on config load. */
  exclude_analysis_tags?: string[];
  /** @deprecated Use `exclude` instead. Migrated on config load. */
  exclude_entities?: string[];
  /** Folders to exclude from entity scanning */
  exclude_entity_folders?: string[];
  /** Wikilink suggestion strictness: conservative, balanced (default), aggressive */
  wikilink_strictness?: 'conservative' | 'balanced' | 'aggressive';
  /** Enable implicit entity detection — dead wikilinks for proper nouns, camelCase, etc. (default: true) */
  implicit_detection?: boolean;
  /** Which implicit patterns to use (default: all 5) */
  implicit_patterns?: string[];
  /** Auto-select aggressive strictness for daily notes (default: true) */
  adaptive_strictness?: boolean;
  /** Enable proactive wikilink insertion via watcher (default: true) */
  proactive_linking?: boolean;
  /** Minimum score for proactive insertion (default: 20) */
  proactive_min_score?: number;
  /** Maximum proactive insertions per file per batch (default: 3) */
  proactive_max_per_file?: number;
  /** Maximum proactive insertions per file per day (default: 10) */
  proactive_max_per_day?: number;
  /**
   * Top-level vault folders excluded from proactive linking AND implicit
   * wikilink-removal feedback (default: ['plans', 'threads', 'councils']).
   * Engine-owned folders are fully re-rendered from DB with links applied at
   * write time — watcher link-writes there would be wiped by the next render
   * and the wipes would cast false implicit-removed votes (suppression churn).
   */
  proactive_exclude_folders?: string[];
  /** Tool exposure override for tiered full preset sessions */
  tool_tier_override?: 'auto' | 'full' | 'minimal';
  /**
   * Custom entity categories. Keys are frontmatter `type:` values.
   * Entities with matching frontmatter types get categorized under that key
   * instead of the default classifier. Optional type_boost overrides the
   * scoring boost for this category (default: 0).
   *
   * Example: { "work-ticket": { type_boost: 2 }, "recipe": { type_boost: 1 } }
   */
  custom_categories?: Record<string, { type_boost?: number }>;
}
