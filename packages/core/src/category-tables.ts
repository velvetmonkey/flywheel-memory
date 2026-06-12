/**
 * Static categorization tables for entity scanning (entities.ts).
 *
 * Pure data — no logic. Extracted verbatim from entities.ts so the
 * scanning + categorization pipeline stays under the file-size cap.
 */

import type { EntityCategory } from './types.js';

/**
 * Default tech keywords for categorization
 */
export const DEFAULT_TECH_KEYWORDS = [
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
 * Map frontmatter `type` values to EntityCategory
 * Returns undefined if the type doesn't map to a known category
 */
export const FRONTMATTER_TYPE_MAP: Record<string, EntityCategory> = {
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

// Folder names that imply entity categories
export const FOLDER_CATEGORY_MAP: Record<string, EntityCategory> = {
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
