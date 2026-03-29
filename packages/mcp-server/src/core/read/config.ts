import * as fs from 'fs';
import * as path from 'path';
import type { VaultIndex } from './types.js';
import {
  loadFlywheelConfigFromDb,
  saveFlywheelConfigToDb,
  type StateDb,
} from '@velvetmonkey/vault-core';

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

/** Folders excluded from entity scanning when exclude_entity_folders is empty */
export const DEFAULT_ENTITY_EXCLUDE_FOLDERS = ['node_modules', 'templates', 'attachments', 'tmp'];

/** Default config for new vaults — opinionated: aggressive linking by default, opt out to dial back */
const DEFAULT_CONFIG: FlywheelConfig = {
  exclude: [],
  exclude_entity_folders: [],
  wikilink_strictness: 'balanced',
  implicit_detection: true,
  adaptive_strictness: true,
};

/**
 * Migrate legacy exclude fields into unified `exclude` array.
 * Tags get prefixed with # if not already, entity names stay as-is.
 * Deduplicates and removes the old fields.
 */
function migrateExcludeConfig(config: FlywheelConfig): FlywheelConfig {
  const oldTags = [
    ...(config.exclude_task_tags ?? []),
    ...(config.exclude_analysis_tags ?? []),
  ];
  const oldEntities = config.exclude_entities ?? [];

  if (oldTags.length === 0 && oldEntities.length === 0) return config;

  // Normalize tags to #-prefixed
  const normalizedTags = oldTags.map(t => t.startsWith('#') ? t : `#${t}`);

  // Merge with existing exclude list
  const merged = new Set([
    ...(config.exclude ?? []),
    ...normalizedTags,
    ...oldEntities,
  ]);

  return {
    ...config,
    exclude: Array.from(merged),
    // Clear deprecated fields
    exclude_task_tags: undefined,
    exclude_analysis_tags: undefined,
    exclude_entities: undefined,
  };
}

/**
 * Load config from SQLite StateDb.
 * Returns defaults if StateDb unavailable or empty.
 *
 * @param stateDb - StateDb for SQLite storage
 */
export function loadConfig(stateDb?: StateDb | null): FlywheelConfig {
  if (stateDb) {
    try {
      const dbConfig = loadFlywheelConfigFromDb(stateDb);
      if (dbConfig && Object.keys(dbConfig).length > 0) {
        console.error('[Flywheel] Loaded config from StateDb');
        return migrateExcludeConfig({ ...DEFAULT_CONFIG, ...dbConfig as FlywheelConfig });
      }
    } catch (err) {
      console.error('[Flywheel] Failed to load config from StateDb:', err);
    }
  }

  return DEFAULT_CONFIG;
}

/** Common tags that indicate recurring/habit tasks users may want to exclude */
const RECURRING_TAG_PATTERNS = [
  'habit',
  'habits',
  'daily',
  'weekly',
  'monthly',
  'recurring',
  'routine',
  'template',
];

/** Patterns for detecting periodic note folders */
const FOLDER_PATTERNS = {
  daily_notes: ['daily', 'dailies', 'journal', 'journals', 'daily-notes', 'daily_notes'],
  weekly_notes: ['weekly', 'weeklies', 'weekly-notes', 'weekly_notes'],
  monthly_notes: ['monthly', 'monthlies', 'monthly-notes', 'monthly_notes'],
  quarterly_notes: ['quarterly', 'quarterlies', 'quarterly-notes', 'quarterly_notes'],
  yearly_notes: ['yearly', 'yearlies', 'annual', 'yearly-notes', 'yearly_notes'],
  templates: ['template', 'templates'],
};

/**
 * Extract unique folder paths from the vault index.
 * Returns folders sorted by depth (root-level first).
 */
function extractFolders(index: VaultIndex): string[] {
  const folders = new Set<string>();
  for (const notePath of index.notes.keys()) {
    const dir = path.dirname(notePath);
    if (dir && dir !== '.') {
      // Add the folder and all parent folders
      const parts = dir.split(/[/\\]/);
      for (let i = 1; i <= parts.length; i++) {
        folders.add(parts.slice(0, i).join('/'));
      }
    }
  }
  // Sort by depth (fewer slashes = higher in hierarchy)
  return Array.from(folders).sort((a, b) => {
    const depthA = (a.match(/\//g) || []).length;
    const depthB = (b.match(/\//g) || []).length;
    return depthA - depthB;
  });
}

/**
 * Find a folder matching one of the given patterns.
 * Prefers root-level matches over nested folders.
 */
function findMatchingFolder(folders: string[], patterns: string[]): string | undefined {
  const lowerPatterns = patterns.map((p) => p.toLowerCase());
  for (const folder of folders) {
    const folderName = path.basename(folder).toLowerCase();
    if (lowerPatterns.includes(folderName)) {
      return folder;
    }
  }
  return undefined;
}

/**
 * Infer config values by analyzing the vault.
 * Returns smart defaults based on vault contents.
 */
export function inferConfig(index: VaultIndex, vaultPath?: string): FlywheelConfig {
  const inferred: FlywheelConfig = {
    exclude: [],
    paths: {},
  };

  // Infer vault_name from folder name
  if (vaultPath) {
    inferred.vault_name = path.basename(vaultPath);
  }

  // Extract folders from note paths
  const folders = extractFolders(index);

  // Detect periodic note folders
  const detectedPath = findMatchingFolder(folders, FOLDER_PATTERNS.daily_notes);
  if (detectedPath) inferred.paths!.daily_notes = detectedPath;

  const weeklyPath = findMatchingFolder(folders, FOLDER_PATTERNS.weekly_notes);
  if (weeklyPath) inferred.paths!.weekly_notes = weeklyPath;

  const monthlyPath = findMatchingFolder(folders, FOLDER_PATTERNS.monthly_notes);
  if (monthlyPath) inferred.paths!.monthly_notes = monthlyPath;

  const quarterlyPath = findMatchingFolder(folders, FOLDER_PATTERNS.quarterly_notes);
  if (quarterlyPath) inferred.paths!.quarterly_notes = quarterlyPath;

  const yearlyPath = findMatchingFolder(folders, FOLDER_PATTERNS.yearly_notes);
  if (yearlyPath) inferred.paths!.yearly_notes = yearlyPath;

  // Detect templates folder
  const templatesPath = findMatchingFolder(folders, FOLDER_PATTERNS.templates);
  if (templatesPath) inferred.paths!.templates = templatesPath;

  // Scan templates folder for periodic note templates
  if (templatesPath && vaultPath) {
    inferred.templates = scanTemplatesFolder(vaultPath, templatesPath);
  }

  // Find tags that match recurring patterns → add to unified exclude list
  for (const tag of index.tags.keys()) {
    const lowerTag = tag.toLowerCase();
    if (RECURRING_TAG_PATTERNS.some((pattern) => lowerTag.includes(pattern))) {
      inferred.exclude!.push(tag.startsWith('#') ? tag : `#${tag}`);
    }
  }

  return inferred;
}

/**
 * Extract excluded tags from the unified exclude list.
 * Tags are entries starting with '#'. Returns without the '#' prefix.
 */
export function getExcludeTags(config: FlywheelConfig): string[] {
  return (config.exclude ?? [])
    .filter(e => e.startsWith('#'))
    .map(e => e.slice(1));
}

/**
 * Extract excluded entity names from the unified exclude list.
 * Entities are entries NOT starting with '#'.
 */
export function getExcludeEntities(config: FlywheelConfig): string[] {
  return (config.exclude ?? []).filter(e => !e.startsWith('#'));
}

/** Template filename patterns (case-insensitive) mapped to periodic types */
const TEMPLATE_PATTERNS: Record<keyof FlywheelTemplates, RegExp> = {
  daily: /^daily[\s._-]*(note|template)?\.md$/i,
  weekly: /^weekly[\s._-]*(note|template)?\.md$/i,
  monthly: /^monthly[\s._-]*(note|template)?\.md$/i,
  quarterly: /^quarterly[\s._-]*(note|template)?\.md$/i,
  yearly: /^yearly[\s._-]*(note|template|review)?\.md$/i,
};

/**
 * Scan the templates folder for periodic note templates.
 * Matches files like daily.md, weekly-note.md, etc.
 */
function scanTemplatesFolder(vaultPath: string, templatesFolder: string): FlywheelTemplates {
  const templates: FlywheelTemplates = {};
  const absFolder = path.join(vaultPath, templatesFolder);

  try {
    const files = fs.readdirSync(absFolder);
    for (const file of files) {
      for (const [type, pattern] of Object.entries(TEMPLATE_PATTERNS)) {
        if (pattern.test(file) && !templates[type as keyof FlywheelTemplates]) {
          templates[type as keyof FlywheelTemplates] = `${templatesFolder}/${file}`;
        }
      }
    }
  } catch {
    // Templates folder not readable - skip
  }

  return templates;
}

/**
 * Save config to SQLite StateDb.
 * Merges inferred values with existing config (existing wins).
 *
 * @param stateDb - StateDb for SQLite storage
 * @param inferred - Inferred config from vault analysis
 * @param existing - Existing config (takes precedence over inferred)
 */
export function saveConfig(
  stateDb: StateDb,
  inferred: FlywheelConfig,
  existing?: FlywheelConfig
): void {
  try {
    // Existing config values take precedence over inferred
    // Deep merge paths and templates so existing values override inferred
    const mergedPaths: FlywheelPaths = {
      ...inferred.paths,
      ...existing?.paths,
    };
    const mergedTemplates: FlywheelTemplates = {
      ...inferred.templates,
      ...existing?.templates,
    };
    const merged: FlywheelConfig = {
      ...DEFAULT_CONFIG,
      ...inferred,
      ...existing,
      // Only include paths if there are any detected values
      ...(Object.keys(mergedPaths).length > 0 ? { paths: mergedPaths } : {}),
      ...(Object.keys(mergedTemplates).length > 0 ? { templates: mergedTemplates } : {}),
    };
    saveFlywheelConfigToDb(stateDb, merged as Record<string, unknown>);
    console.error('[Flywheel] Saved config to StateDb');
  } catch (err) {
    console.error('[Flywheel] Failed to save config to StateDb:', err);
  }
}
