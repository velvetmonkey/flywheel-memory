/**
 * Folder structure generation for realistic vault layouts
 */

import { SeededRandom } from './notes.js';

// Common folder name patterns
const FOLDER_PATTERNS = {
  top: [
    'Notes', 'Projects', 'Areas', 'Resources', 'Archive',
    'Daily', 'Weekly', 'Monthly', 'Meetings', 'People',
    'Work', 'Personal', 'Learning', 'References', 'Templates'
  ],
  project: [
    'Planning', 'Design', 'Development', 'Testing', 'Deployment',
    'Docs', 'Research', 'Assets', 'Reviews', 'Archive'
  ],
  temporal: [
    '2024', '2025', '2026',
    'Q1', 'Q2', 'Q3', 'Q4',
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ],
  category: [
    'Active', 'Completed', 'On Hold', 'Backlog',
    'High Priority', 'Medium Priority', 'Low Priority',
    'Internal', 'External', 'Shared'
  ]
};

export interface FolderStructure {
  path: string;
  depth: number;
  noteCapacity: number;
}

/**
 * Generate folder structure for a vault
 */
export function generateFolderStructure(
  rng: SeededRandom,
  maxDepth: number,
  noteCount: number
): FolderStructure[] {
  const folders: FolderStructure[] = [];

  // Always have root
  folders.push({ path: '', depth: 0, noteCapacity: 0 });

  // Calculate target folder count based on note count
  // Rule of thumb: sqrt(noteCount) folders, spread across depths
  const targetFolderCount = Math.ceil(Math.sqrt(noteCount) * 1.5);

  // Distribute folders by depth (more at lower depths)
  const depthDistribution = calculateDepthDistribution(maxDepth, targetFolderCount);

  // Generate top-level folders
  const topFolders = rng.pickN(FOLDER_PATTERNS.top, depthDistribution[1] || 5);
  for (const name of topFolders) {
    folders.push({ path: name, depth: 1, noteCapacity: 0 });
  }

  // Generate nested folders
  for (let depth = 2; depth <= maxDepth; depth++) {
    const parentFolders = folders.filter(f => f.depth === depth - 1);
    const targetCount = depthDistribution[depth] || 0;

    let created = 0;
    while (created < targetCount && parentFolders.length > 0) {
      const parent = rng.pick(parentFolders);
      const subfolderName = generateSubfolderName(rng, parent.path, depth);

      const newPath = parent.path ? `${parent.path}/${subfolderName}` : subfolderName;

      // Avoid duplicates
      if (!folders.some(f => f.path === newPath)) {
        folders.push({ path: newPath, depth, noteCapacity: 0 });
        created++;
      }
    }
  }

  // Distribute note capacity across folders
  distributeNoteCapacity(rng, folders, noteCount);

  return folders;
}

function calculateDepthDistribution(maxDepth: number, targetTotal: number): Record<number, number> {
  const distribution: Record<number, number> = {};

  // More folders at lower depths
  // depth 1: 40%, depth 2: 30%, depth 3: 20%, depth 4+: 10%
  const weights = [0, 0.4, 0.3, 0.2, 0.1];

  let remaining = targetTotal;
  for (let depth = 1; depth <= maxDepth; depth++) {
    const weight = weights[Math.min(depth, weights.length - 1)];
    const count = Math.floor(targetTotal * weight);
    distribution[depth] = Math.min(count, remaining);
    remaining -= distribution[depth];
  }

  // Assign remaining to depth 1
  distribution[1] = (distribution[1] || 0) + remaining;

  return distribution;
}

function generateSubfolderName(rng: SeededRandom, parentPath: string, depth: number): string {
  // Context-aware subfolder naming
  const parentName = parentPath.split('/').pop() || '';

  // If parent is a project folder, use project subfolders
  if (parentName === 'Projects' || FOLDER_PATTERNS.project.includes(parentName)) {
    return rng.pick(FOLDER_PATTERNS.project);
  }

  // If parent is Daily/Weekly/Monthly, use temporal subfolders
  if (['Daily', 'Weekly', 'Monthly'].includes(parentName)) {
    return rng.pick(FOLDER_PATTERNS.temporal);
  }

  // If parent is a year, use quarters or months
  if (/^\d{4}$/.test(parentName)) {
    return rng.pick(['Q1', 'Q2', 'Q3', 'Q4', ...FOLDER_PATTERNS.temporal.filter(t => t.length > 2)]);
  }

  // Default: mix of categories and projects
  if (rng.chance(0.5)) {
    return rng.pick(FOLDER_PATTERNS.category);
  }
  return rng.pick(FOLDER_PATTERNS.project);
}

function distributeNoteCapacity(
  rng: SeededRandom,
  folders: FolderStructure[],
  totalNotes: number
): void {
  // Zipf-like distribution: some folders have many notes, most have few
  const nonRootFolders = folders.filter(f => f.depth > 0);

  if (nonRootFolders.length === 0) {
    // All notes in root
    folders[0].noteCapacity = totalNotes;
    return;
  }

  // 20% of notes in root
  const rootNotes = Math.floor(totalNotes * 0.2);
  folders[0].noteCapacity = rootNotes;

  let remainingNotes = totalNotes - rootNotes;

  // Sort folders randomly then assign with decreasing amounts
  const shuffled = [...nonRootFolders].sort(() => rng.next() - 0.5);

  // First 20% of folders get 60% of remaining notes
  // Rest get distributed more evenly
  const hotFolders = shuffled.slice(0, Math.ceil(shuffled.length * 0.2));
  const coldFolders = shuffled.slice(Math.ceil(shuffled.length * 0.2));

  const hotNotes = Math.floor(remainingNotes * 0.6);
  const coldNotes = remainingNotes - hotNotes;

  // Distribute hot notes
  let hotRemaining = hotNotes;
  for (const folder of hotFolders) {
    const share = Math.floor(hotRemaining / Math.max(hotFolders.indexOf(folder) + 1, 1) * rng.next() * 2);
    folder.noteCapacity = Math.min(share, hotRemaining);
    hotRemaining -= folder.noteCapacity;
  }
  // Give remainder to last hot folder
  if (hotFolders.length > 0) {
    hotFolders[hotFolders.length - 1].noteCapacity += hotRemaining;
  }

  // Distribute cold notes more evenly
  let coldRemaining = coldNotes;
  const perFolder = Math.floor(coldNotes / Math.max(coldFolders.length, 1));
  for (const folder of coldFolders) {
    const jitter = Math.floor(perFolder * 0.5 * (rng.next() - 0.5));
    folder.noteCapacity = Math.min(perFolder + jitter, coldRemaining);
    coldRemaining -= folder.noteCapacity;
  }
  // Give remainder to last cold folder
  if (coldFolders.length > 0) {
    coldFolders[coldFolders.length - 1].noteCapacity += coldRemaining;
  }
}

/**
 * Get a random folder for placing a note
 */
export function pickFolderForNote(
  rng: SeededRandom,
  folders: FolderStructure[]
): string {
  // Weight by remaining capacity
  const withCapacity = folders.filter(f => f.noteCapacity > 0);

  if (withCapacity.length === 0) {
    // Fallback to any folder
    return rng.pick(folders).path;
  }

  // Pick weighted by capacity
  const totalCapacity = withCapacity.reduce((sum, f) => sum + f.noteCapacity, 0);
  let roll = rng.next() * totalCapacity;

  for (const folder of withCapacity) {
    roll -= folder.noteCapacity;
    if (roll <= 0) {
      folder.noteCapacity--; // Consume capacity
      return folder.path;
    }
  }

  // Fallback
  const folder = withCapacity[withCapacity.length - 1];
  folder.noteCapacity--;
  return folder.path;
}
