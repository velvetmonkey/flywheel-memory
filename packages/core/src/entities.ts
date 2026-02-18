/**
 * Entity scanning and discovery for vault wikilinks
 *
 * Scans vault for .md files and extracts valid entities (file stems)
 * that can be wikilinked. Filters out periodic notes and categorizes
 * entities by type.
 */

import fs from 'fs/promises';
import path from 'path';
import type { EntityIndex, EntityCategory, ScanOptions, EntityWithAliases, Entity, EntityWithType } from './types.js';

/**
 * Current cache version - bump when schema changes
 */
export const ENTITY_CACHE_VERSION = 3;

/**
 * Maximum entity name/alias length for suggestions
 * Filters out article titles, clippings, and other long names
 */
const MAX_ENTITY_LENGTH = 25;

/**
 * Maximum word count for entity names/aliases
 * Concepts are typically 1-3 words; longer names are article titles
 */
const MAX_ENTITY_WORDS = 3;

/**
 * Default patterns for filtering out periodic notes and system files
 */
const DEFAULT_EXCLUDE_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}$/,           // ISO dates: 2025-01-01
  /^\d{1,2}\/\d{1,2}\/\d{4}$/,     // UK dates: 1/10/2024
  /^\d{4}-W\d{2}$/,                 // Week dates: 2025-W17
  /^\d{4}-\d{2}$/,                  // Month format: 2025-01
  /^\d{4}-Q\d$/,                    // Quarter dates: 2025-Q4
  /^\d+$/,                          // Pure numbers
  /^@/,                             // Twitter handles
  /^</,                             // XML/HTML tags
  /^\{\{/,                          // Template placeholders
  /\\$/,                            // Paths ending in backslash
  /\.(?:md|js|py|json|jpg|png|pdf|csv)$/i, // File extensions
  /^[a-z0-9_-]+\.[a-z]+$/i,         // File names with extensions
];

/**
 * Default tech keywords for categorization
 */
const DEFAULT_TECH_KEYWORDS = [
  // Core technologies (28 original)
  'databricks', 'api', 'code', 'azure', 'sql', 'git',
  'node', 'react', 'powerbi', 'excel', 'copilot',
  'fabric', 'apim', 'endpoint', 'synology', 'tailscale',
  'obsidian', 'claude', 'powershell', 'mcp', 'typescript',
  'javascript', 'python', 'docker', 'kubernetes',
  'adf', 'adb', 'net', 'aws', 'gcp', 'terraform',

  // AI/ML (16 new - target audience)
  'chatgpt', 'langchain', 'openai', 'huggingface', 'pytorch', 'tensorflow',
  'anthropic', 'llm', 'embedding', 'vector', 'rag', 'prompt', 'agent',
  'transformer', 'ollama', 'gemini',

  // Languages (10 new)
  'swift', 'kotlin', 'rust', 'golang', 'elixir', 'scala', 'julia',
  'ruby', 'php', 'csharp',

  // Infrastructure (8 new)
  'ansible', 'nginx', 'redis', 'postgres', 'mongodb', 'graphql', 'grpc', 'kafka',
];

/**
 * Check if an alias passes the length and word count filters
 * Uses same rules as entity names: ≤25 chars, ≤3 words
 */
function isValidAlias(alias: string): boolean {
  if (typeof alias !== 'string' || alias.length === 0) {
    return false;
  }

  // Length filter
  if (alias.length > MAX_ENTITY_LENGTH) {
    return false;
  }

  // Word count filter
  const words = alias.split(/\s+/).filter(w => w.length > 0);
  if (words.length > MAX_ENTITY_WORDS) {
    return false;
  }

  return true;
}

/**
 * Frontmatter fields extracted from note content
 */
interface FrontmatterFields {
  aliases: string[];
  type?: string;
}

/**
 * Parse frontmatter from markdown content and extract aliases and type
 * Handles YAML array format: aliases: [Alias1, Alias2]
 * And YAML list format:
 *   aliases:
 *     - Alias1
 *     - Alias2
 */
function extractFrontmatterFields(content: string): FrontmatterFields {
  // Check for frontmatter delimiter
  if (!content.startsWith('---')) {
    return { aliases: [] };
  }

  // Find end of frontmatter
  const endIndex = content.indexOf('\n---', 3);
  if (endIndex === -1) {
    return { aliases: [] };
  }

  const frontmatter = content.substring(4, endIndex);

  // Extract type field
  const typeMatch = frontmatter.match(/^type:\s*["']?([^"'\n]+?)["']?\s*$/m);
  const type = typeMatch ? typeMatch[1].trim() : undefined;

  // Try inline array format: aliases: [Alias1, Alias2]
  const inlineMatch = frontmatter.match(/^aliases:\s*\[([^\]]*)\]/m);
  if (inlineMatch) {
    return {
      aliases: inlineMatch[1]
        .split(',')
        .map(s => s.trim().replace(/^["']|["']$/g, '')) // Remove quotes
        .filter(s => s.length > 0 && isValidAlias(s)),
      type,
    };
  }

  // Try multiline list format
  const lines = frontmatter.split('\n');
  const aliasIdx = lines.findIndex(line => /^aliases:\s*$/.test(line));
  if (aliasIdx === -1) {
    // Check for single value format: aliases: SingleAlias
    const singleMatch = frontmatter.match(/^aliases:\s+(.+)$/m);
    if (singleMatch && !singleMatch[1].startsWith('[')) {
      const alias = singleMatch[1].trim().replace(/^["']|["']$/g, '');
      return { aliases: isValidAlias(alias) ? [alias] : [], type };
    }
    return { aliases: [], type };
  }

  // Parse list items following "aliases:"
  const aliases: string[] = [];
  for (let i = aliasIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    // Stop at next top-level key (letter/underscore at start of line followed by colon)
    if (/^[a-z_]+:/i.test(line)) {
      break;
    }
    // Skip empty lines but continue parsing (YAML lists can have blank lines)
    if (line.trim() === '') {
      continue;
    }
    // Match list item: - Alias or - "Alias"
    const listMatch = line.match(/^\s*-\s*["']?(.+?)["']?\s*$/);
    if (listMatch) {
      const alias = listMatch[1].trim();
      if (isValidAlias(alias)) {
        aliases.push(alias);
      }
    }
  }

  return { aliases, type };
}

/**
 * Check if a file/folder name should be skipped (dot-prefixed)
 */
function isDotPath(pathStr: string): boolean {
  return path.basename(pathStr).startsWith('.');
}

/**
 * Check if entity name matches any exclude pattern
 */
function matchesExcludePattern(name: string): boolean {
  return DEFAULT_EXCLUDE_PATTERNS.some(pattern => pattern.test(name));
}

/**
 * Organization suffixes for company/team detection
 */
const ORG_SUFFIXES = ['inc', 'corp', 'llc', 'ltd', 'team', 'group', 'co', 'company'];

/**
 * Location keywords for place detection
 */
const LOCATION_KEYWORDS = ['city', 'county', 'region', 'district', 'province'];

/**
 * Known region patterns (geographic regions)
 */
const REGION_PATTERNS = ['eu', 'apac', 'emea', 'latam', 'amer'];

/**
 * Map frontmatter `type` values to EntityCategory
 * Returns undefined if the type doesn't map to a known category
 */
const FRONTMATTER_TYPE_MAP: Record<string, EntityCategory> = {
  // animals
  animal: 'animals', pet: 'animals', horse: 'animals', dog: 'animals',
  cat: 'animals', bird: 'animals', fish: 'animals',
  // people
  person: 'people', contact: 'people', friend: 'people',
  colleague: 'people', family: 'people',
  // media
  movie: 'media', book: 'media', show: 'media', game: 'media',
  music: 'media', album: 'media', film: 'media', podcast: 'media', series: 'media',
  // events
  event: 'events', meeting: 'events', conference: 'events',
  trip: 'events', holiday: 'events', milestone: 'events',
  // documents
  document: 'documents', report: 'documents', guide: 'documents',
  reference: 'documents', template: 'documents', note: 'documents',
  // vehicles
  vehicle: 'vehicles', car: 'vehicles', bike: 'vehicles',
  boat: 'vehicles', motorcycle: 'vehicles',
  // health
  health: 'health', medical: 'health', fitness: 'health',
  condition: 'health', wellness: 'health', exercise: 'health',
  // finance
  finance: 'finance', account: 'finance', investment: 'finance',
  budget: 'finance', transaction: 'finance', bank: 'finance',
  // food
  food: 'food', recipe: 'food', restaurant: 'food',
  meal: 'food', ingredient: 'food', drink: 'food',
  // hobbies
  hobby: 'hobbies', sport: 'hobbies', craft: 'hobbies',
  activity: 'hobbies', collection: 'hobbies',
  // identity categories (for reverse-mapping)
  acronym: 'acronyms',
  media: 'media',
  other: 'other',
  // existing categories
  project: 'projects',
  tool: 'technologies', technology: 'technologies', framework: 'technologies',
  library: 'technologies', language: 'technologies',
  company: 'organizations', organization: 'organizations', org: 'organizations', team: 'organizations',
  place: 'locations', location: 'locations', city: 'locations',
  country: 'locations', region: 'locations',
  concept: 'concepts', idea: 'concepts', topic: 'concepts',
};

function mapFrontmatterType(type: string): EntityCategory | undefined {
  return FRONTMATTER_TYPE_MAP[type.toLowerCase()];
}

/**
 * Categorize an entity based on its name and optional frontmatter type
 *
 * Detection order (most specific first):
 * 0. Frontmatter type - explicit declaration takes priority
 * 1. Technologies - matches tech keyword
 * 2. Acronyms - all uppercase 2-6 chars
 * 3. Organizations - ends with company/team suffixes
 * 4. Locations - city/country patterns or known regions
 * 5. People - exactly 2 capitalized words
 * 6. Concepts - multi-word lowercase patterns
 * 7. Projects - multi-word (fallback)
 * 8. Other - single word default
 */
function categorizeEntity(
  name: string,
  techKeywords: string[],
  frontmatterType?: string,
): EntityCategory {
  // 0. Frontmatter type takes priority
  if (frontmatterType) {
    const mapped = mapFrontmatterType(frontmatterType);
    if (mapped) return mapped;
  }
  const nameLower = name.toLowerCase();
  const words = name.split(/\s+/);

  // 1. Technology check (keyword match)
  if (techKeywords.some(tech => nameLower.includes(tech))) {
    return 'technologies';
  }

  // 2. Acronym check (all uppercase, 2-6 chars)
  if (name === name.toUpperCase() && name.length >= 2 && name.length <= 6) {
    return 'acronyms';
  }

  // 3. Organization check (company/team suffixes)
  if (words.length >= 2 && ORG_SUFFIXES.includes(words[words.length - 1].toLowerCase())) {
    return 'organizations';
  }

  // 4. Location check (city/country patterns or known regions)
  if (words.length >= 2 && LOCATION_KEYWORDS.includes(words[words.length - 1].toLowerCase())) {
    return 'locations';
  }
  if (REGION_PATTERNS.includes(nameLower)) {
    return 'locations';
  }

  // 5. People check (exactly 2 words, both capitalized)
  if (words.length === 2) {
    const [first, last] = words;
    if (first[0] === first[0].toUpperCase() && last[0] === last[0].toUpperCase()) {
      return 'people';
    }
  }

  // 6. Concepts check (multi-word lowercase patterns like "machine learning")
  if (words.length >= 2 && name === name.toLowerCase()) {
    return 'concepts';
  }

  // 7. Projects (multi-word, capitalized, not people)
  if (name.includes(' ')) {
    return 'projects';
  }

  return 'other';
}

/**
 * Entity info collected during scanning
 */
interface ScannedEntity {
  name: string;
  relativePath: string;
  aliases: string[];
  frontmatterType?: string;
}

/**
 * Recursively scan a directory for markdown files
 * @param dirPath - Absolute path to scan
 * @param basePath - Vault root path (for relative path calculation)
 * @param excludeFolders - Folders to skip
 */
async function scanDirectory(
  dirPath: string,
  basePath: string,
  excludeFolders: string[]
): Promise<ScannedEntity[]> {
  const entities: ScannedEntity[] = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      // Skip dot directories
      if (entry.isDirectory() && isDotPath(entry.name)) {
        continue;
      }

      // Skip excluded folders
      if (entry.isDirectory() && excludeFolders.some(f =>
        entry.name.toLowerCase() === f.toLowerCase()
      )) {
        continue;
      }

      if (entry.isDirectory()) {
        // Recurse into subdirectory
        const subEntities = await scanDirectory(fullPath, basePath, excludeFolders);
        entities.push(...subEntities);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Extract file stem (without .md extension)
        const stem = path.basename(entry.name, '.md');
        const relativePath = path.relative(basePath, fullPath);

        // Read file content to extract aliases and type
        let aliases: string[] = [];
        let frontmatterType: string | undefined;
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          const fields = extractFrontmatterFields(content);
          aliases = fields.aliases;
          frontmatterType = fields.type;
        } catch {
          // Skip if can't read file - just use empty aliases
        }

        entities.push({
          name: stem,
          relativePath,
          aliases,
          frontmatterType,
        });
      }
    }
  } catch (error) {
    // Skip directories we can't read
    console.error(`[vault-core] Error scanning ${dirPath}:`, error);
  }

  return entities;
}

/**
 * Scan vault for entities (markdown file stems) that can be wikilinked
 */
export async function scanVaultEntities(
  vaultPath: string,
  options: ScanOptions = {}
): Promise<EntityIndex> {
  const excludeFolders = options.excludeFolders ?? [];
  const techKeywords = options.techKeywords ?? DEFAULT_TECH_KEYWORDS;

  // Scan vault for all markdown files
  const allEntities = await scanDirectory(vaultPath, vaultPath, excludeFolders);

  // Filter out periodic notes and invalid entries
  const validEntities = allEntities.filter(entity =>
    entity.name.length >= 2 && !matchesExcludePattern(entity.name)
  );

  // Remove duplicates by name (keep first occurrence)
  const seenNames = new Set<string>();
  const uniqueEntities = validEntities.filter(entity => {
    if (seenNames.has(entity.name.toLowerCase())) {
      return false;
    }
    seenNames.add(entity.name.toLowerCase());
    return true;
  });

  // Categorize entities
  const index: EntityIndex = {
    technologies: [],
    acronyms: [],
    people: [],
    projects: [],
    organizations: [],
    locations: [],
    concepts: [],
    animals: [],
    media: [],
    events: [],
    documents: [],
    vehicles: [],
    health: [],
    finance: [],
    food: [],
    hobbies: [],
    other: [],
    _metadata: {
      total_entities: 0,
      generated_at: new Date().toISOString(),
      vault_path: vaultPath,
      source: 'vault-core scanVaultEntities',
      version: ENTITY_CACHE_VERSION,
    },
  };

  for (const entity of uniqueEntities) {
    const category = categorizeEntity(entity.name, techKeywords, entity.frontmatterType);
    // Store as EntityWithAliases object
    const entityObj: EntityWithAliases = {
      name: entity.name,
      path: entity.relativePath,
      aliases: entity.aliases,
    };
    index[category].push(entityObj);
  }

  // Sort each category by name
  const sortByName = (a: Entity, b: Entity) => {
    const nameA = typeof a === 'string' ? a : a.name;
    const nameB = typeof b === 'string' ? b : b.name;
    return nameA.localeCompare(nameB);
  };
  const allCategories: (keyof Omit<EntityIndex, '_metadata'>)[] = [
    'technologies', 'acronyms', 'people', 'projects', 'organizations',
    'locations', 'concepts', 'animals', 'media', 'events', 'documents',
    'vehicles', 'health', 'finance', 'food', 'hobbies', 'other',
  ];
  for (const cat of allCategories) {
    index[cat].sort(sortByName);
  }

  // Update metadata
  index._metadata.total_entities = allCategories.reduce(
    (sum, cat) => sum + index[cat].length, 0
  );

  return index;
}

/**
 * Get all entities as a flat array (for wikilink matching)
 * Handles both legacy string format and new EntityWithAliases format
 */
/** All entity category keys (excludes _metadata) */
const ALL_ENTITY_CATEGORIES: EntityCategory[] = [
  'technologies', 'acronyms', 'people', 'projects', 'organizations',
  'locations', 'concepts', 'animals', 'media', 'events', 'documents',
  'vehicles', 'health', 'finance', 'food', 'hobbies', 'other',
];

export function getAllEntities(index: EntityIndex): Entity[] {
  const result: Entity[] = [];
  for (const cat of ALL_ENTITY_CATEGORIES) {
    if (index[cat]) result.push(...index[cat]);
  }
  return result;
}

/**
 * Get all entities with their category type preserved
 * Used for scoring algorithms that need type-based boosts
 *
 * Unlike getAllEntities() which flattens entities into a single array,
 * this function preserves the category information for each entity.
 *
 * @param index - The entity index to extract from
 * @returns Array of EntityWithType objects preserving category info
 */
export function getAllEntitiesWithTypes(index: EntityIndex): EntityWithType[] {
  const result: EntityWithType[] = [];
  const categories = ALL_ENTITY_CATEGORIES;

  for (const category of categories) {
    const entities = index[category];
    // Skip undefined or empty categories
    if (!entities || !Array.isArray(entities)) {
      continue;
    }
    for (const entity of entities) {
      // Convert legacy string format to EntityWithAliases
      const entityObj: EntityWithAliases = typeof entity === 'string'
        ? { name: entity, path: '', aliases: [] }
        : entity;
      result.push({ entity: entityObj, category });
    }
  }

  return result;
}

/**
 * Get entity name from an Entity (handles both string and object formats)
 */
export function getEntityName(entity: Entity): string {
  return typeof entity === 'string' ? entity : entity.name;
}

/**
 * Get entity aliases from an Entity (returns empty array for strings)
 */
export function getEntityAliases(entity: Entity): string[] {
  return typeof entity === 'string' ? [] : entity.aliases;
}

/**
 * Filter periodic notes from a list of entities
 * Useful when loading from external sources
 */
export function filterPeriodicNotes(entities: string[]): string[] {
  return entities.filter(entity => !matchesExcludePattern(entity));
}

/**
 * Load entity index from a cache file (JSON format)
 */
export async function loadEntityCache(cachePath: string): Promise<EntityIndex | null> {
  try {
    const content = await fs.readFile(cachePath, 'utf-8');
    return JSON.parse(content) as EntityIndex;
  } catch {
    return null;
  }
}

/**
 * Save entity index to a cache file
 */
export async function saveEntityCache(
  cachePath: string,
  index: EntityIndex
): Promise<void> {
  const dir = path.dirname(cachePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(index, null, 2), 'utf-8');
}
