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

export interface FlywheelConfig {
  vault_name?: string;
  paths?: FlywheelPaths;
  exclude_task_tags?: string[];
}

/** Default config for new vaults */
const DEFAULT_CONFIG: FlywheelConfig = {
  exclude_task_tags: [],
};

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
        return { ...DEFAULT_CONFIG, ...dbConfig as FlywheelConfig };
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
    exclude_task_tags: [],
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

  // Find tags that match recurring patterns
  for (const tag of index.tags.keys()) {
    const lowerTag = tag.toLowerCase();
    if (RECURRING_TAG_PATTERNS.some((pattern) => lowerTag.includes(pattern))) {
      inferred.exclude_task_tags!.push(tag);
    }
  }

  return inferred;
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
    // Deep merge paths object so existing path values override inferred
    const mergedPaths: FlywheelPaths = {
      ...inferred.paths,
      ...existing?.paths,
    };
    const merged: FlywheelConfig = {
      ...DEFAULT_CONFIG,
      ...inferred,
      ...existing,
      // Only include paths if there are any detected values
      ...(Object.keys(mergedPaths).length > 0 ? { paths: mergedPaths } : {}),
    };
    saveFlywheelConfigToDb(stateDb, merged as Record<string, unknown>);
    console.error('[Flywheel] Saved config to StateDb');
  } catch (err) {
    console.error('[Flywheel] Failed to save config to StateDb:', err);
  }
}
