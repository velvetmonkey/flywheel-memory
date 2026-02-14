/**
 * Main vault generator - creates complete test vaults
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { VaultConfig, GeneratedVault, GeneratedNote, GeneratedEntity } from '../types.js';
import { SeededRandom, generateNoteTitle, generateNoteContent, titleToFilename } from './notes.js';
import { generateEntities, generateEntityNotes } from './entities.js';
import { generateFrontmatter, wrapWithFrontmatter } from './frontmatter.js';
import { generateFolderStructure, pickFolderForNote } from './structure.js';
import { simpleGit, SimpleGit } from 'simple-git';

/**
 * Default vault configuration presets
 */
export const VAULT_PRESETS: Record<string, Omit<VaultConfig, 'outputDir' | 'seed'>> = {
  '1k': {
    noteCount: 1000,
    avgLinksPerNote: 3,
    entityTypes: ['person', 'project', 'topic'],
    entityCount: { person: 50, project: 20, topic: 30, location: 0, company: 0 },
    folderDepth: 3,
    avgNoteLength: 400,
    frontmatterProbability: 0.7
  },
  '10k': {
    noteCount: 10000,
    avgLinksPerNote: 3.5,
    entityTypes: ['person', 'project', 'topic', 'location'],
    entityCount: { person: 200, project: 50, topic: 100, location: 30, company: 0 },
    folderDepth: 4,
    avgNoteLength: 500,
    frontmatterProbability: 0.7
  },
  '50k': {
    noteCount: 50000,
    avgLinksPerNote: 4,
    entityTypes: ['person', 'project', 'topic', 'location', 'company'],
    entityCount: { person: 500, project: 150, topic: 300, location: 80, company: 50 },
    folderDepth: 5,
    avgNoteLength: 450,
    frontmatterProbability: 0.65
  },
  '100k': {
    noteCount: 100000,
    avgLinksPerNote: 4.5,
    entityTypes: ['person', 'project', 'topic', 'location', 'company'],
    entityCount: { person: 1000, project: 300, topic: 500, location: 150, company: 100 },
    folderDepth: 5,
    avgNoteLength: 400,
    frontmatterProbability: 0.6
  }
};

/**
 * Generate a complete test vault
 */
export async function generateVault(config: VaultConfig): Promise<GeneratedVault> {
  const startTime = Date.now();
  const rng = new SeededRandom(config.seed);

  console.log(`Generating vault with ${config.noteCount} notes (seed: ${config.seed})...`);

  // Create output directory
  await fs.mkdir(config.outputDir, { recursive: true });

  // Generate entities
  console.log('  Generating entities...');
  const entities = generateEntities(rng, config.entityTypes, config.entityCount);
  const entityNotes = generateEntityNotes(rng, entities);

  // Generate folder structure
  console.log('  Generating folder structure...');
  const folders = generateFolderStructure(rng, config.folderDepth, config.noteCount);

  // Create folders
  for (const folder of folders) {
    if (folder.path) {
      await fs.mkdir(path.join(config.outputDir, folder.path), { recursive: true });
    }
  }

  // Track generated notes and links
  let totalLinks = 0;
  const generatedNotes: GeneratedNote[] = [];
  const usedFilenames = new Set<string>();

  // Generate regular notes
  console.log('  Generating notes...');
  const progressInterval = Math.max(1, Math.floor(config.noteCount / 10));

  for (let i = 0; i < config.noteCount; i++) {
    if (i > 0 && i % progressInterval === 0) {
      console.log(`    ${Math.round((i / config.noteCount) * 100)}% (${i}/${config.noteCount})`);
    }

    const note = generateNote(rng, entities, config, folders, usedFilenames, i);
    generatedNotes.push(note);
    totalLinks += note.wikilinks.length;

    // Write note file
    const filePath = path.join(config.outputDir, note.folder, `${note.path}.md`);
    await fs.writeFile(filePath, note.content, 'utf-8');
    usedFilenames.add(note.path.toLowerCase());
  }

  // Write entity notes
  console.log('  Writing entity notes...');
  for (const [name, content] of entityNotes) {
    const filename = titleToFilename(name);
    if (!usedFilenames.has(filename.toLowerCase())) {
      const filePath = path.join(config.outputDir, `${filename}.md`);
      await fs.writeFile(filePath, content, 'utf-8');
      usedFilenames.add(filename.toLowerCase());
    }
  }

  // Initialize git if requested
  if (config.initGit) {
    console.log('  Initializing git repository...');
    await initializeGit(config.outputDir);
  }

  const duration = Date.now() - startTime;
  console.log(`Vault generated in ${(duration / 1000).toFixed(1)}s`);

  return {
    path: config.outputDir,
    noteCount: config.noteCount + entityNotes.size,
    entityCount: entities.length,
    totalLinks,
    folderCount: folders.length,
    seed: config.seed,
    generatedAt: new Date().toISOString()
  };
}

function generateNote(
  rng: SeededRandom,
  entities: GeneratedEntity[],
  config: VaultConfig,
  folders: ReturnType<typeof generateFolderStructure>,
  usedFilenames: Set<string>,
  index: number
): GeneratedNote {
  // Generate title
  let title = generateNoteTitle(rng, entities, index);
  let filename = titleToFilename(title);

  // Ensure unique filename
  let suffix = 0;
  while (usedFilenames.has(filename.toLowerCase())) {
    suffix++;
    filename = `${titleToFilename(title)} ${suffix}`;
  }
  if (suffix > 0) {
    title = `${title} ${suffix}`;
  }

  // Pick folder
  const folder = pickFolderForNote(rng, folders);

  // Calculate target links (Poisson-like distribution around average)
  const targetLinks = Math.max(0, Math.round(
    config.avgLinksPerNote + (rng.next() - 0.5) * config.avgLinksPerNote * 2
  ));

  // Calculate target length
  const targetLength = Math.max(100, Math.round(
    config.avgNoteLength + (rng.next() - 0.5) * config.avgNoteLength
  ));

  // Generate content
  const { content, wikilinks } = generateNoteContent(
    rng,
    title,
    entities,
    targetLinks,
    targetLength
  );

  // Generate frontmatter
  const frontmatter = generateFrontmatter(rng, title, {
    probability: config.frontmatterProbability
  });

  // Combine
  const fullContent = wrapWithFrontmatter(content, frontmatter);

  return {
    path: filename,
    title,
    content: fullContent,
    frontmatter,
    wikilinks,
    folder
  };
}

async function initializeGit(vaultPath: string): Promise<void> {
  const git: SimpleGit = simpleGit(vaultPath);

  await git.init();
  await git.addConfig('user.email', 'bench@flywheel.test');
  await git.addConfig('user.name', 'Flywheel Bench');
  await git.add('.');
  await git.commit('Initial vault generation');
}

/**
 * Load a vault config from a preset or file
 */
export async function loadVaultConfig(
  preset: string,
  outputDir: string,
  seed?: number
): Promise<VaultConfig> {
  const presetConfig = VAULT_PRESETS[preset];

  if (!presetConfig) {
    throw new Error(`Unknown preset: ${preset}. Available: ${Object.keys(VAULT_PRESETS).join(', ')}`);
  }

  return {
    ...presetConfig,
    outputDir,
    seed: seed ?? Date.now()
  };
}

/**
 * Quick vault generation for testing
 */
export async function generateQuickVault(
  outputDir: string,
  noteCount: number,
  seed?: number
): Promise<GeneratedVault> {
  const config: VaultConfig = {
    outputDir,
    noteCount,
    avgLinksPerNote: 2,
    entityTypes: ['person', 'project', 'topic'],
    entityCount: {
      person: Math.ceil(noteCount * 0.05),
      project: Math.ceil(noteCount * 0.02),
      topic: Math.ceil(noteCount * 0.03),
      location: 0,
      company: 0
    },
    folderDepth: Math.min(3, Math.ceil(Math.log10(noteCount))),
    avgNoteLength: 300,
    frontmatterProbability: 0.5,
    seed: seed ?? Date.now(),
    initGit: false
  };

  return generateVault(config);
}
