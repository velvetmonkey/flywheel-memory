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
import { COMMON_ENGLISH_WORDS } from './common-words.js';

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

/** Entities that should never be indexed regardless of vault files */
export const STOP_ENTITIES = new Set([
  'me', 'my', 'i',
  'ok', 'no', 'yes', 'hi', 'hey',
  'mcp', 're', 'cc', 'id',
  'am', 'pm', 'vs', 'etc',
]);

/**
 * Default patterns for filtering out periodic notes and system files
 */
const DEFAULT_EXCLUDE_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}/,            // ISO dates: 2025-01-01, 2025-01-01 Meeting Notes
  /^\d{1,2}\/\d{1,2}\/\d{4}$/,     // UK dates: 1/10/2024
  /^\d{4}-W\d{2}/,                  // Week dates: 2025-W17, 2025-W17 Sprint Review
  /^\d{4}-\d{2}/,                   // Month format: 2025-01, 2025-01 Monthly Review
  /^\d{4}-Q\d/,                     // Quarter dates: 2025-Q4, 2025-Q4 Quarterly Report
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
/** Stringified YAML/JS primitives that appear as aliases due to parsing artifacts */
const YAML_PRIMITIVES = new Set(['null', 'undefined', 'true', 'false', 'none', 'nil']);

function isValidAlias(alias: string): boolean {
  if (typeof alias !== 'string' || alias.length === 0) {
    return false;
  }

  // Reject stringified YAML/JS primitives (e.g., aliases: [null] → "null")
  if (YAML_PRIMITIVES.has(alias.toLowerCase())) {
    return false;
  }

  // Reject single-word aliases that are common English words (top 10K by frequency).
  // Multi-word aliases like "Azure Front Door" pass — only single words are checked.
  // Short all-uppercase aliases (≤4 chars) are exempt — they're intentional acronyms (JS, TS, AI, ML, PR).
  // Entity NAMES are not affected (isValidAlias only runs on frontmatter aliases).
  if (!alias.includes(' ') &&
      !(alias.length <= 4 && alias === alias.toUpperCase()) &&
      COMMON_ENGLISH_WORDS.has(alias.toLowerCase())) {
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
 * Union of all exclude patterns, compiled once at module load for performance
 */
const EXCLUDE_UNION = new RegExp(
  DEFAULT_EXCLUDE_PATTERNS.map(p => `(?:${p.source})`).join('|'),
  'i'
);

/**
 * Check if entity name matches any exclude pattern
 */
function matchesExcludePattern(name: string): boolean {
  return EXCLUDE_UNION.test(name);
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
  cat: 'animals', bird: 'animals', fish: 'animals', insect: 'animals',
  reptile: 'animals', species: 'animals', breed: 'animals',

  // people
  person: 'people', contact: 'people', friend: 'people',
  colleague: 'people', family: 'people', employee: 'people',
  manager: 'people', author: 'people', speaker: 'people',
  creator: 'people', stakeholder: 'people', contractor: 'people',
  consultant: 'people', member: 'people', character: 'people',
  prospect: 'people', lead: 'people', expert: 'people',

  // organizations
  company: 'organizations', organization: 'organizations', org: 'organizations',
  team: 'organizations', client: 'organizations', customer: 'organizations',
  vendor: 'organizations', partner: 'organizations', supplier: 'organizations',
  agency: 'organizations', startup: 'organizations', enterprise: 'organizations',
  business: 'organizations', department: 'organizations', division: 'organizations',
  group: 'organizations', committee: 'organizations', institution: 'organizations',
  school: 'organizations', university: 'organizations', studio: 'organizations',
  account: 'organizations',

  // media
  movie: 'media', book: 'media', show: 'media', game: 'media',
  music: 'media', album: 'media', film: 'media', podcast: 'media',
  series: 'media', episode: 'media', video: 'media', song: 'media',
  playlist: 'media', artwork: 'media', photo: 'media', article: 'media',
  post: 'media', blog: 'media', channel: 'media', publication: 'media',
  newsletter: 'media',

  // events
  event: 'events', meeting: 'events', conference: 'events',
  trip: 'events', holiday: 'events', milestone: 'events',
  interview: 'events', appointment: 'events', session: 'events',
  workshop: 'events', webinar: 'events', call: 'events',
  summit: 'events', meetup: 'events', vacation: 'events',
  festival: 'events', ceremony: 'events',

  // documents
  document: 'documents', report: 'documents', guide: 'documents',
  reference: 'documents', template: 'documents', note: 'documents',
  checklist: 'documents', playbook: 'documents', spec: 'documents',
  specification: 'documents', roadmap: 'documents', review: 'documents',
  decision: 'documents', manual: 'documents', contract: 'documents',
  policy: 'documents', procedure: 'documents', log: 'documents',
  journal: 'documents', transcript: 'documents', minutes: 'documents',
  summary: 'documents', brief: 'documents', proposal: 'documents',
  presentation: 'documents', deck: 'documents', memo: 'documents',
  letter: 'documents', resource: 'documents', rfc: 'documents',
  architecture: 'documents', draft: 'documents', manuscript: 'documents',
  snippet: 'documents',

  // vehicles
  vehicle: 'vehicles', car: 'vehicles', bike: 'vehicles',
  boat: 'vehicles', motorcycle: 'vehicles', truck: 'vehicles',
  plane: 'vehicles', aircraft: 'vehicles', ship: 'vehicles',

  // health
  health: 'health', medical: 'health', fitness: 'health',
  condition: 'health', wellness: 'health', exercise: 'health',
  treatment: 'health', medication: 'health', workout: 'health',
  therapy: 'health', nutrition: 'health',

  // finance
  finance: 'finance', investment: 'finance',
  budget: 'finance', transaction: 'finance', bank: 'finance',
  expense: 'finance', income: 'finance', revenue: 'finance',
  tax: 'finance', payment: 'finance', invoice: 'finance',
  receipt: 'finance', portfolio: 'finance', equity: 'finance',

  // food
  food: 'food', recipe: 'food', restaurant: 'food',
  meal: 'food', ingredient: 'food', drink: 'food',
  beverage: 'food', cuisine: 'food',

  // hobbies
  hobby: 'hobbies', sport: 'hobbies', craft: 'hobbies',
  activity: 'hobbies', collection: 'hobbies', gaming: 'hobbies',
  photography: 'hobbies',

  // technologies
  tool: 'technologies', technology: 'technologies', framework: 'technologies',
  library: 'technologies', language: 'technologies', app: 'technologies',
  software: 'technologies', hardware: 'technologies', device: 'technologies',
  equipment: 'technologies', server: 'technologies', database: 'technologies',
  platform: 'technologies', plugin: 'technologies', extension: 'technologies',
  api: 'technologies', service: 'technologies', package: 'technologies',

  // projects
  project: 'projects', initiative: 'projects', campaign: 'projects',
  program: 'projects', product: 'projects', release: 'projects',
  sprint: 'projects', epic: 'projects', feature: 'projects',
  goal: 'projects', objective: 'projects', deliverable: 'projects',
  deal: 'projects', opportunity: 'projects',

  // locations
  place: 'locations', location: 'locations', city: 'locations',
  country: 'locations', region: 'locations', state: 'locations',
  town: 'locations', building: 'locations', office: 'locations',
  venue: 'locations', facility: 'locations',

  // concepts
  concept: 'concepts', idea: 'concepts', topic: 'concepts',
  theory: 'concepts', principle: 'concepts', model: 'concepts',
  pattern: 'concepts', methodology: 'concepts', strategy: 'concepts',
  technique: 'concepts', algorithm: 'concepts', definition: 'concepts',
  knowledge: 'concepts', domain: 'concepts', discipline: 'concepts',
  subject: 'concepts', course: 'concepts', lesson: 'concepts',
  tutorial: 'concepts',

  // periodical notes
  periodical: 'periodical', daily: 'periodical', weekly: 'periodical',
  monthly: 'periodical', quarterly: 'periodical', yearly: 'periodical',

  // identity categories (for reverse-mapping)
  acronym: 'acronyms',
  media: 'media',
  other: 'other',
};

function mapFrontmatterType(
  type: string,
  customCategories?: Record<string, { type_boost?: number }>,
): EntityCategory | undefined {
  const lower = type.toLowerCase();
  // Custom categories take priority — frontmatter type becomes the category name
  if (customCategories?.[lower]) return lower;
  return FRONTMATTER_TYPE_MAP[lower];
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
// Folder names that imply entity categories
const FOLDER_CATEGORY_MAP: Record<string, EntityCategory> = {
  // people
  'people': 'people', 'person': 'people', 'contacts': 'people',
  'team': 'people', 'members': 'people', 'employees': 'people',
  'colleagues': 'people', 'contractors': 'people', 'consultants': 'people',

  // organizations
  'companies': 'organizations', 'organizations': 'organizations', 'orgs': 'organizations',
  'clients': 'organizations', 'customers': 'organizations', 'vendors': 'organizations',
  'partners': 'organizations', 'agencies': 'organizations', 'institutions': 'organizations',
  'accounts': 'organizations',

  // projects
  'projects': 'projects', 'project': 'projects', 'initiatives': 'projects',
  'campaigns': 'projects', 'products': 'projects', 'goals': 'projects',
  'deliverables': 'projects', 'work': 'projects',

  // locations
  'locations': 'locations', 'places': 'locations',

  // concepts
  'concepts': 'concepts', 'topics': 'concepts', 'knowledge': 'concepts',
  'research': 'concepts', 'learning': 'concepts',

  // technologies
  'tools': 'technologies', 'software': 'technologies', 'equipment': 'technologies',
  'tech': 'technologies', 'apps': 'technologies', 'platforms': 'technologies',

  // media
  'media': 'media', 'books': 'media', 'films': 'media',
  'movies': 'media', 'music': 'media', 'podcasts': 'media',
  'reading': 'media', 'articles': 'media',

  // events
  'events': 'events', 'meetings': 'events', 'conferences': 'events',

  // documents
  'documents': 'documents', 'docs': 'documents', 'templates': 'documents',
  'guides': 'documents', 'references': 'documents', 'proposals': 'documents',
  'admin': 'documents', 'archive': 'documents', 'resources': 'documents',

  // vehicles
  'vehicles': 'vehicles',

  // health
  'health': 'health', 'fitness': 'health', 'medical': 'health',

  // finance
  'finance': 'finance', 'invoices': 'finance', 'billing': 'finance',

  // food
  'food': 'food', 'recipes': 'food',

  // hobbies
  'hobbies': 'hobbies', 'sports': 'hobbies',

  // animals
  'animals': 'animals', 'pets': 'animals',

  // periodical
  'daily-notes': 'periodical', 'weekly-notes': 'periodical',
  'monthly-notes': 'periodical',
};

function categorizeEntity(
  name: string,
  techKeywords: string[],
  frontmatterType?: string,
  notePath?: string,
  customCategories?: Record<string, { type_boost?: number }>,
): EntityCategory {
  // 0. Frontmatter type takes priority (custom categories checked first)
  if (frontmatterType) {
    const mapped = mapFrontmatterType(frontmatterType, customCategories);
    if (mapped) return mapped;
  }

  // 0.5. Folder-based inference (e.g., people/Andrew.md → person)
  if (notePath) {
    const segments = notePath.toLowerCase().split('/');
    for (const segment of segments) {
      const mapped = FOLDER_CATEGORY_MAP[segment];
      if (mapped) return mapped;
    }
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
 * Extract a short description for an entity note.
 * Uses frontmatter `description:` if present, else the first non-empty paragraph (≥10 chars).
 * Strips heading markers and wikilinks, truncates to 200 chars.
 */
export function extractEntityDescription(content: string): string | null {
  if (content.startsWith('---')) {
    const fmEnd = content.indexOf('\n---', 3);
    if (fmEnd !== -1) {
      const fm = content.slice(3, fmEnd);
      const descMatch = fm.match(/^description:\s*['"]?(.+?)['"]?\s*$/m);
      if (descMatch?.[1]?.trim()) return descMatch[1].trim().slice(0, 200);
      const body = content.slice(fmEnd + 4).trim();
      const firstPara = body.split(/\n\s*\n/)[0]?.trim() ?? '';
      if (firstPara.length >= 10) {
        return firstPara.replace(/^#+\s+/gm, '').replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1').trim().slice(0, 200) || null;
      }
      return null;
    }
  }
  const firstPara = content.trim().split(/\n\s*\n/)[0]?.trim() ?? '';
  if (firstPara.length >= 10) {
    return firstPara.replace(/^#+\s+/gm, '').replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1').trim().slice(0, 200) || null;
  }
  return null;
}

/**
 * Entity info collected during scanning
 */
interface ScannedEntity {
  name: string;
  relativePath: string;
  aliases: string[];
  frontmatterType?: string;
  description?: string;
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

        // Read file content to extract aliases, type, and description
        let aliases: string[] = [];
        let frontmatterType: string | undefined;
        let description: string | undefined;
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          const fields = extractFrontmatterFields(content);
          aliases = fields.aliases;
          frontmatterType = fields.type;
          description = extractEntityDescription(content) ?? undefined;
        } catch {
          // Skip if can't read file - just use empty aliases
        }

        entities.push({
          name: stem,
          relativePath,
          aliases,
          frontmatterType,
          description,
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
  const customCategories = options.customCategories;

  // Scan vault for all markdown files
  const allEntities = await scanDirectory(vaultPath, vaultPath, excludeFolders);

  // Filter out periodic notes, invalid entries, and stop-listed entities
  const validEntities = allEntities.filter(entity =>
    entity.name.length >= 2
    && !matchesExcludePattern(entity.name)
    && !STOP_ENTITIES.has(entity.name.toLowerCase())
  );

  // Deduplicate by name, preferring entity whose name matches its filename stem
  const casingMap = new Map<string, typeof validEntities[0]>();
  for (const entity of validEntities) {
    const key = entity.name.toLowerCase();
    const existing = casingMap.get(key);
    if (!existing) {
      casingMap.set(key, entity);
      continue;
    }
    // Prefer entity whose name matches its filename stem exactly
    const existingStemMatch = existing.name === path.basename(existing.relativePath, '.md');
    const newStemMatch = entity.name === path.basename(entity.relativePath, '.md');
    if (newStemMatch && !existingStemMatch) {
      casingMap.set(key, entity);
    }
  }
  const uniqueEntities = Array.from(casingMap.values());

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
    periodical: [],
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
    const category = categorizeEntity(entity.name, techKeywords, entity.frontmatterType, entity.relativePath, customCategories);
    // Store as EntityWithAliases object
    const entityObj: EntityWithAliases = {
      name: entity.name,
      path: entity.relativePath,
      aliases: entity.aliases,
      description: entity.description,
    };
    // Initialize custom category array if needed
    if (!index[category]) {
      (index as Record<string, unknown>)[category] = [];
    }
    (index[category] as Entity[]).push(entityObj);
  }

  // Sort each category by name (including custom categories)
  const sortByName = (a: Entity, b: Entity) => {
    const nameA = typeof a === 'string' ? a : a.name;
    const nameB = typeof b === 'string' ? b : b.name;
    return nameA.localeCompare(nameB);
  };
  const allCategoryKeys = Object.keys(index).filter(k => k !== '_metadata');
  for (const cat of allCategoryKeys) {
    (index[cat] as Entity[]).sort(sortByName);
  }

  // Update metadata
  index._metadata.total_entities = allCategoryKeys.reduce(
    (sum, cat) => sum + (index[cat] as Entity[]).length, 0
  );

  return index;
}

/**
 * Get all entities as a flat array (for wikilink matching)
 * Handles both legacy string format and new EntityWithAliases format
 */
/** Get all category keys from an index (includes custom categories, excludes _metadata) */
function getIndexCategories(index: EntityIndex): string[] {
  return Object.keys(index).filter(k => k !== '_metadata');
}

export function getAllEntities(index: EntityIndex): Entity[] {
  const result: Entity[] = [];
  for (const cat of getIndexCategories(index)) {
    const entities = index[cat];
    if (Array.isArray(entities)) result.push(...entities);
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

  for (const category of getIndexCategories(index)) {
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
