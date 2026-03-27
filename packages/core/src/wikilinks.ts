/**
 * Wikilink application logic
 *
 * Applies [[wikilinks]] to known entities in content while
 * respecting protected zones (code, frontmatter, existing links, etc.)
 *
 * Also supports:
 * - Pattern-based detection for implicit entities (proper nouns, acronyms, CamelCase)
 * - Alias resolution for existing wikilinks (resolves [[alias]] to [[Entity|alias]])
 */

import type {
  WikilinkOptions,
  WikilinkResult,
  Entity,
  ExtendedWikilinkOptions,
  ImplicitEntityMatch,
  ImplicitEntityConfig,
  ResolveAliasOptions,
} from './types.js';
import { getProtectedZones, rangeOverlapsProtectedZone } from './protectedZones.js';
import { stem } from './stemmer.js';

/**
 * Get all search terms for an entity (name + aliases)
 * Returns tuples of [searchTerm, entityName] for proper linking
 */
function getSearchTerms(entity: Entity): Array<{ term: string; entityName: string; isAlias: boolean }> {
  if (typeof entity === 'string') {
    return [{ term: entity, entityName: entity, isAlias: false }];
  }

  // Include the entity name and all aliases
  const terms: Array<{ term: string; entityName: string; isAlias: boolean }> = [
    { term: entity.name, entityName: entity.name, isAlias: false }
  ];

  for (const alias of entity.aliases) {
    terms.push({ term: alias, entityName: entity.name, isAlias: true });
  }

  return terms;
}

/**
 * Base set of common words to exclude from wikilink matching.
 * Extended by IMPLICIT_EXCLUDE_WORDS to form the full EXCLUDE_WORDS set.
 */
const EXCLUDE_WORDS_BASE = new Set([
  // Day names
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  // Month names
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  // Temporal words
  'today', 'tomorrow', 'yesterday', 'week', 'month', 'year',
  // Periodic review compounds
  'month end', 'month start', 'year end', 'year start',
  'quarter end', 'quarter start', 'quarterly review',
  'weekly review', 'monthly review', 'annual review',
  'christmas', 'holiday', 'break',

  // --- Two-char common words (pronouns, prepositions, conjunctions) ---
  'me', 'us', 'we', 'he', 'it', 'am', 'is', 'be', 'do', 'go',
  'no', 'so', 'up', 'if', 'or', 'as', 'at', 'by', 'on', 'in', 'to',
  'of', 'an', 'my', 'oh', 'ok',

  // --- Pronouns (personal, possessive, reflexive, relative, demonstrative) ---
  'she', 'her', 'him', 'his', 'they', 'them', 'their', 'its', 'our', 'ours',
  'who', 'whom', 'whose', 'what', 'which', 'mine', 'yours', 'hers', 'theirs',
  'myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'themselves',

  // --- Stop words & determiners ---
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'these', 'those',
  'some', 'any', 'each', 'both', 'few', 'many', 'most', 'such',

  // --- Prepositions ---
  'about', 'above', 'across', 'after', 'against', 'along', 'among', 'around',
  'before', 'behind', 'below', 'beneath', 'beside', 'between', 'beyond',
  'despite', 'down', 'during', 'except', 'inside', 'into', 'near',
  'off', 'onto', 'outside', 'over', 'past', 'since', 'through',
  'toward', 'towards', 'under', 'underneath', 'until', 'upon', 'within', 'without',

  // --- Conjunctions ---
  'although', 'because', 'however', 'therefore', 'moreover', 'furthermore',
  'nevertheless', 'otherwise', 'meanwhile', 'whereas', 'whenever', 'wherever',
  'whether', 'while', 'unless', 'though', 'hence',

  // --- Common adverbs ---
  'again', 'already', 'always', 'almost', 'also', 'away',
  'back', 'certainly', 'clearly', 'completely', 'currently',
  'directly', 'effectively', 'enough', 'especially', 'essentially',
  'eventually', 'ever', 'exactly', 'fairly', 'finally', 'frequently',
  'fully', 'generally', 'gradually', 'greatly', 'hardly', 'here',
  'highly', 'immediately', 'indeed', 'instead',
  'just', 'largely', 'later', 'likely', 'mainly', 'maybe',
  'merely', 'mostly', 'naturally', 'nearly', 'necessarily',
  'never', 'normally', 'now', 'obviously', 'occasionally', 'often',
  'only', 'originally', 'particularly', 'perhaps',
  'personally', 'possibly', 'potentially', 'practically', 'precisely',
  'presumably', 'previously', 'primarily', 'probably', 'properly',
  'quickly', 'quite', 'rarely', 'rather', 'readily', 'really',
  'recently', 'relatively', 'roughly', 'significantly', 'simply',
  'slightly', 'slowly', 'sometimes', 'somewhat', 'soon', 'specifically',
  'still', 'strongly', 'subsequently', 'successfully', 'suddenly',
  'surely', 'then', 'there', 'thoroughly', 'together',
  'too', 'truly', 'typically', 'ultimately', 'unfortunately', 'usually',
  'very', 'well', 'widely', 'yet',

  // --- Common adjectives ---
  'able', 'actual', 'additional', 'alternative', 'appropriate', 'available',
  'basic', 'broad', 'certain', 'clear', 'close', 'common', 'complete',
  'comprehensive', 'considerable', 'consistent', 'correct', 'critical',
  'current', 'deep', 'different', 'difficult', 'direct', 'due', 'early',
  'effective', 'entire', 'essential', 'exact', 'excellent', 'existing',
  'extensive', 'extra', 'fair', 'familiar', 'final', 'fine', 'first',
  'fixed', 'flat', 'formal', 'former', 'free', 'fresh', 'full', 'further',
  'future', 'general', 'given', 'global', 'good', 'great', 'hard', 'heavy',
  'high', 'huge', 'ideal', 'important', 'independent', 'individual',
  'initial', 'internal', 'key', 'large', 'last', 'late', 'latest', 'least',
  'less', 'light', 'limited', 'little', 'local', 'long', 'loose', 'low',
  'main', 'major', 'massive', 'minor', 'missing', 'modern', 'much',
  'narrow', 'native', 'natural', 'necessary', 'negative', 'new', 'nice',
  'normal', 'obvious', 'old', 'only', 'open', 'original', 'overall', 'own',
  'particular', 'perfect', 'personal', 'plain', 'poor', 'popular',
  'positive', 'possible', 'potential', 'powerful', 'practical', 'present',
  'previous', 'primary', 'prime', 'private', 'proper', 'public', 'pure',
  'quick', 'quiet', 'random', 'rapid', 'rare', 'raw', 'ready', 'real',
  'reasonable', 'recent', 'regular', 'related', 'relevant', 'remote',
  'required', 'responsible', 'rich', 'right', 'rough', 'round', 'safe',
  'secure', 'separate', 'serious', 'sharp', 'short', 'significant',
  'silent', 'similar', 'simple', 'single', 'slight', 'slow', 'small',
  'smart', 'smooth', 'soft', 'solid', 'special', 'specific', 'stable',
  'standard', 'steep', 'straight', 'strict', 'strong', 'sudden',
  'sufficient', 'suitable', 'sure', 'sweet', 'tall', 'thick', 'thin',
  'tight', 'tiny', 'total', 'tough', 'true', 'typical', 'unique',
  'unusual', 'useful', 'usual', 'valid', 'valuable', 'various', 'vast',
  'warm', 'weak', 'whole', 'wide', 'wild', 'worth', 'wrong',

  // --- Common verbs ---
  'accept', 'achieve', 'add', 'admit', 'agree', 'allow', 'announce', 'appear',
  'apply', 'approach', 'argue', 'arrange', 'arrive', 'assume', 'attempt', 'avoid',
  'begin', 'believe', 'belong', 'break', 'bring', 'build', 'burn', 'buy',
  'call', 'carry', 'catch', 'cause', 'change', 'charge', 'check', 'choose',
  'claim', 'clean', 'climb', 'close', 'collect', 'come', 'commit',
  'compare', 'complain', 'confirm', 'connect', 'consider', 'contain',
  'continue', 'contribute', 'control', 'convert', 'cook', 'copy', 'correct',
  'cost', 'count', 'cover', 'create', 'cross', 'cry', 'cut',
  'deal', 'decide', 'declare', 'define', 'deliver', 'demand', 'deny', 'depend',
  'describe', 'design', 'destroy', 'determine', 'develop', 'die', 'discover',
  'discuss', 'divide', 'double', 'doubt', 'draw', 'dress', 'drink', 'drive',
  'drop', 'earn', 'eat', 'enable', 'encourage', 'enjoy', 'ensure', 'enter',
  'establish', 'examine', 'exist', 'expand', 'expect', 'experience',
  'explain', 'express', 'extend', 'face', 'fail', 'fall', 'feed', 'feel',
  'fight', 'fill', 'find', 'finish', 'fit', 'fix', 'fly', 'focus', 'force',
  'forget', 'form', 'gain', 'gather', 'generate', 'get', 'give', 'go', 'grab',
  'grant', 'grow', 'guess', 'handle', 'happen', 'hate', 'head', 'hear',
  'help', 'hide', 'hit', 'hold', 'hope', 'hurt', 'identify', 'ignore',
  'imagine', 'improve', 'include', 'increase', 'indicate', 'influence',
  'inform', 'insist', 'install', 'intend', 'introduce', 'invest', 'invite',
  'involve', 'issue', 'join', 'judge', 'jump', 'justify', 'keep', 'kick',
  'kill', 'knock', 'land', 'last', 'laugh', 'launch', 'lay', 'lead', 'learn',
  'leave', 'lend', 'let', 'lie', 'lift', 'limit', 'link', 'listen', 'live',
  'look', 'lose', 'love', 'maintain', 'make', 'manage', 'mark', 'match',
  'matter', 'mean', 'measure', 'meet', 'mention', 'mind', 'miss', 'mix',
  'monitor', 'move', 'need', 'note', 'notice', 'obtain', 'occur', 'offer',
  'open', 'operate', 'order', 'organise', 'organize', 'own',
  'pass', 'pay', 'perform', 'permit', 'pick', 'place', 'plan', 'plant',
  'play', 'point', 'pour', 'practice', 'prefer', 'prepare', 'present',
  'press', 'prevent', 'produce', 'promise', 'promote', 'propose', 'protect',
  'prove', 'provide', 'publish', 'pull', 'push', 'put', 'raise', 'reach',
  'read', 'realize', 'receive', 'recognize', 'recommend', 'record',
  'reduce', 'reflect', 'refuse', 'regard', 'reject', 'relate', 'release',
  'rely', 'remain', 'remember', 'remove', 'repeat', 'replace', 'report',
  'represent', 'request', 'require', 'respond', 'rest', 'restore', 'result',
  'retain', 'retire', 'return', 'reveal', 'review', 'ring', 'rise', 'risk',
  'roll', 'run', 'rush', 'save', 'say', 'search', 'seek', 'seem',
  'select', 'sell', 'send', 'serve', 'set', 'settle', 'shake', 'shape',
  'share', 'shift', 'shoot', 'shut', 'sign', 'sing', 'sit', 'skip', 'sleep',
  'slip', 'smile', 'solve', 'sort', 'sound', 'speak', 'spend', 'split',
  'spread', 'stand', 'start', 'state', 'stay', 'steal', 'step', 'stick',
  'stop', 'store', 'strike', 'struggle', 'study', 'submit', 'succeed',
  'suffer', 'suggest', 'suit', 'supply', 'support', 'suppose', 'survive',
  'suspect', 'switch', 'take', 'talk', 'target', 'teach', 'tear', 'tell',
  'tend', 'test', 'thank', 'think', 'throw', 'touch', 'track', 'trade',
  'train', 'travel', 'treat', 'trust', 'try', 'turn', 'understand', 'use',
  'visit', 'vote', 'wait', 'wake', 'walk', 'want', 'warn', 'wash', 'watch',
  'wear', 'weigh', 'win', 'wish', 'wonder', 'work', 'worry', 'wrap', 'write',

  // --- Common nouns (generic, not entity-like) ---
  'access', 'account', 'act', 'action', 'activity', 'addition', 'address',
  'age', 'air', 'amount', 'analysis', 'answer', 'area', 'argument', 'arm',
  'article', 'aspect', 'attention', 'authority', 'balance', 'base', 'basis',
  'bed', 'benefit', 'bit', 'blood', 'board', 'body', 'book', 'bottom',
  'box', 'business', 'capacity', 'capital', 'card', 'care', 'case',
  'centre', 'challenge', 'chance', 'character', 'choice',
  'circle', 'class', 'club', 'code', 'collection', 'colour',
  'comment', 'commission', 'community', 'company', 'comparison', 'competition',
  'concern', 'condition', 'connection', 'content', 'context', 'contract',
  'contribution', 'corner', 'country', 'couple', 'course', 'credit', 'cup',
  'damage', 'danger', 'data', 'date', 'death', 'debate', 'decision',
  'demand', 'department', 'detail', 'development', 'difference', 'direction',
  'discussion', 'disease', 'display', 'distance', 'document', 'door',
  'doubt', 'duty', 'earth', 'edge', 'education', 'effect',
  'effort', 'element', 'end', 'energy', 'engine', 'environment', 'error',
  'event', 'evidence', 'exchange', 'exercise', 'expression',
  'extent', 'eye', 'fact', 'failure', 'family', 'feature',
  'field', 'figure', 'film', 'floor', 'food', 'foot',
  'force', 'foundation', 'front', 'fund', 'game', 'garden', 'gas',
  'glass', 'goal', 'gold', 'grade', 'ground', 'growth', 'guide', 'hair',
  'hall', 'hand', 'heart', 'heat', 'hill', 'history',
  'hole', 'home', 'horse', 'hotel', 'hour', 'house', 'image', 'impact',
  'income', 'index', 'industry', 'information',
  'instance', 'interest', 'investment', 'island', 'item',
  'job', 'kitchen', 'knee', 'knowledge', 'lack', 'language',
  'law', 'league', 'length', 'lesson', 'letter', 'level',
  'library', 'life', 'line', 'list', 'living', 'loss',
  'machine', 'management', 'manner', 'map', 'market', 'mass', 'master',
  'material', 'meeting', 'member', 'memory', 'message', 'metal',
  'method', 'middle', 'minute', 'model', 'moment', 'money',
  'morning', 'mouth', 'movement', 'music', 'name', 'nature',
  'network', 'news', 'night', 'node', 'noise', 'north', 'number',
  'object', 'office', 'officer', 'operation', 'opinion', 'opportunity',
  'option', 'output', 'owner', 'package', 'pair', 'paper',
  'parent', 'part', 'party', 'passage', 'path', 'pattern',
  'performance', 'period', 'person', 'picture', 'player',
  'pleasure', 'pocket', 'position', 'post', 'pound',
  'power', 'pressure', 'price', 'principle', 'problem',
  'procedure', 'process', 'product', 'production', 'programme', 'progress',
  'proof', 'property', 'proposal', 'protection', 'purpose',
  'quality', 'quarter', 'question', 'race', 'range', 'rate', 'reason',
  'reference', 'reform', 'region', 'relation', 'relationship',
  'request', 'research', 'resource', 'response',
  'road', 'role', 'roof', 'room', 'route', 'row', 'rule',
  'safety', 'sale', 'sample', 'scale', 'scene', 'scheme', 'school',
  'science', 'screen', 'season', 'seat', 'section', 'security', 'sense',
  'series', 'service', 'session', 'setting', 'sex',
  'shop', 'shot', 'shoulder', 'show', 'side', 'sight', 'signal',
  'site', 'situation', 'size', 'skin', 'society',
  'software', 'solution', 'song', 'source', 'south',
  'space', 'speech', 'speed', 'spirit', 'sport', 'spring', 'square',
  'staff', 'stage', 'star', 'statement', 'station',
  'status', 'stock', 'stone', 'story', 'strategy',
  'street', 'strength', 'structure', 'student', 'stuff',
  'style', 'subject', 'success', 'summer', 'supply', 'surface',
  'surprise', 'survey', 'system', 'task', 'team', 'technique',
  'technology', 'term', 'text', 'theory', 'thing', 'thought',
  'threat', 'time', 'title', 'tool', 'top', 'tour', 'town',
  'training', 'transfer', 'transport',
  'treatment', 'trial', 'trouble', 'truth', 'type',
  'union', 'unit', 'user', 'valley', 'value', 'variety', 'version',
  'view', 'village', 'voice', 'volume', 'wall', 'war', 'waste', 'water',
  'wave', 'way', 'weather', 'weight', 'west', 'wind', 'window',
  'winter', 'wood', 'word', 'worker', 'world', 'writing',

  // Nationalities / demonyms
  'american', 'british', 'french', 'german', 'chinese', 'japanese',
  'indian', 'russian', 'australian', 'canadian', 'italian', 'spanish',
  'dutch', 'swiss', 'irish', 'scottish', 'welsh', 'english',
  'european', 'african', 'asian', 'brazilian', 'mexican', 'korean',
  'turkish', 'polish', 'swedish', 'norwegian', 'danish', 'finnish',

  // Multi-word production false positives
  'front door', 'back door', 'side door',
]);

/**
 * Unified EXCLUDE_WORDS: base set (300+) merged with IMPLICIT_EXCLUDE_WORDS (1100+).
 * This ensures shouldExcludeEntity() checks all 1200+ common English words,
 * not just the smaller base set. Fixes words like "phase", "tier", "recall"
 * that were in IMPLICIT but not in the explicit matching path.
 *
 * Note: IMPLICIT_EXCLUDE_WORDS is defined later in this file.
 * We use a lazy getter to avoid forward-reference issues.
 */
let _mergedExcludeWords: Set<string> | null = null;

function getMergedExcludeWords(): Set<string> {
  if (!_mergedExcludeWords) {
    _mergedExcludeWords = new Set([...EXCLUDE_WORDS_BASE, ...IMPLICIT_EXCLUDE_WORDS]);
  }
  return _mergedExcludeWords;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check if an entity should be excluded from wikilikning
 */
function shouldExcludeEntity(entity: string, isAlias = false): boolean {
  // Skip single-char terms (e.g. alias "I" for Ben)
  if (entity.length < 2) return true;
  if (getMergedExcludeWords().has(entity.toLowerCase())) return true;
  // Skip lowercase hyphenated descriptors (e.g., self-improving, local-first, Claude-native)
  if (entity.includes('-') && entity === entity.toLowerCase()) return true;
  // Short aliases (≤3 chars) must be ALL-UPPERCASE to survive (e.g., "CI", "ML" ok, "api", "tF" blocked)
  // Entity names like "Ben" (3 chars, mixed case) are unaffected since isAlias=false for names.
  if (isAlias && entity.length <= 3 && entity !== entity.toUpperCase()) return true;
  return false;
}

/**
 * Find all matches of an entity in content with word boundaries
 */
const BRACKET_CHARS = new Set(['(', ')', '[', ']', '{', '}']);

export function findEntityMatches(
  content: string,
  entity: string,
  caseInsensitive: boolean
): Array<{ start: number; end: number; matched: string }> {
  const pattern = `\\b${escapeRegex(entity)}\\b`;
  const flags = caseInsensitive ? 'gi' : 'g';
  const regex = new RegExp(pattern, flags);

  const matches: Array<{ start: number; end: number; matched: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const charBefore = start > 0 ? content[start - 1] : '';
    const charAfter = end < content.length ? content[end] : '';
    if (BRACKET_CHARS.has(charBefore) || BRACKET_CHARS.has(charAfter)) continue;

    matches.push({
      start,
      end,
      matched: match[0],
    });
  }

  return matches;
}

/**
 * Apply wikilinks to entities in content
 *
 * @param content - The markdown content to process
 * @param entities - List of entity names or Entity objects to look for
 * @param options - Wikilink options
 * @returns Result with updated content and statistics
 */
export function applyWikilinks(
  content: string,
  entities: Entity[],
  options: WikilinkOptions = {}
): WikilinkResult {
  const {
    firstOccurrenceOnly = true,
    caseInsensitive = true,
    alreadyLinked,
  } = options;

  if (!entities.length) {
    return {
      content,
      linksAdded: 0,
      linkedEntities: [],
    };
  }

  // Detect ambiguous aliases — aliases claimed by multiple entities
  // Skip these to avoid wrong entity resolution (same pattern as resolveAliasWikilinks)
  const aliasCounts = new Map<string, Set<string>>();
  for (const entity of entities) {
    if (typeof entity === 'string') continue;
    for (const alias of entity.aliases) {
      const key = alias.toLowerCase();
      const owners = aliasCounts.get(key) ?? new Set();
      owners.add(entity.name);
      aliasCounts.set(key, owners);
    }
  }
  const ambiguousAliases = new Set<string>();
  for (const [key, owners] of aliasCounts) {
    if (owners.size > 1) ambiguousAliases.add(key);
  }

  // Build search terms from all entities (names + aliases)
  // Each term maps back to its canonical entity name
  const allSearchTerms: Array<{ term: string; entityName: string; isAlias: boolean }> = [];
  for (const entity of entities) {
    const terms = getSearchTerms(entity);
    for (const t of terms) {
      // Skip ambiguous aliases (shared by multiple entities)
      if (t.isAlias && ambiguousAliases.has(t.term.toLowerCase())) continue;
      if (!shouldExcludeEntity(t.term, t.isAlias)) {
        allSearchTerms.push(t);
      }
    }
  }

  // Sort by term length (longest first) to avoid partial matches
  allSearchTerms.sort((a, b) => b.term.length - a.term.length);

  // Get protected zones
  let zones = getProtectedZones(content);

  let result = content;
  let linksAdded = 0;
  const linkedEntities: string[] = [];

  if (firstOccurrenceOnly) {
    // For firstOccurrenceOnly mode, we need to find the earliest match across
    // all terms (name + aliases) for each entity, then link that one
    // Also need to handle overlapping matches between different entities

    // First, collect ALL valid matches for each entity (name + aliases combined)
    const entityAllMatches = new Map<string, Array<{ term: string; match: { start: number; end: number; matched: string } }>>();

    for (const { term, entityName, isAlias } of allSearchTerms) {
      const entityKey = entityName.toLowerCase();

      // Short uppercase aliases (≤4 chars, all-caps) match case-sensitively
      // so "CI" matches "CI" but not "ci" or "Ci"
      const useCaseInsensitive = !(isAlias && term.length <= 4 && term === term.toUpperCase());
      const matches = findEntityMatches(result, term, useCaseInsensitive ? caseInsensitive : false);

      // Filter out matches in protected zones
      const validMatches = matches.filter(
        match => !rangeOverlapsProtectedZone(match.start, match.end, zones)
      );

      if (validMatches.length === 0) {
        continue;
      }

      // Add to entity's matches
      const existingMatches = entityAllMatches.get(entityKey) || [];
      for (const match of validMatches) {
        existingMatches.push({ term, match });
      }
      entityAllMatches.set(entityKey, existingMatches);
    }

    // Sort each entity's matches by position
    for (const [_entityKey, matches] of entityAllMatches.entries()) {
      matches.sort((a, b) => a.match.start - b.match.start);
    }

    // Build final list: for each entity, pick the earliest non-overlapping match
    // Process entities in order of their earliest match length (longest first for same position)
    let allCandidates: Array<{ entityName: string; term: string; match: { start: number; end: number; matched: string } }> = [];

    for (const [entityKey, matches] of entityAllMatches.entries()) {
      // Find the original entityName (with correct casing)
      const entityName = allSearchTerms.find(t => t.entityName.toLowerCase() === entityKey)?.entityName || entityKey;
      for (const m of matches) {
        allCandidates.push({ entityName, ...m });
      }
    }

    // Sort by position, then by match length (descending), then by term length (ascending)
    // The term length tiebreaker ensures "API" wins over "API Management" when both match "api"
    allCandidates.sort((a, b) => {
      // Primary: earliest position first
      if (a.match.start !== b.match.start) return a.match.start - b.match.start;
      // Secondary: longest matched text first
      if (a.match.matched.length !== b.match.matched.length)
        return b.match.matched.length - a.match.matched.length;
      // Tertiary: shorter entity term first (more exact match)
      return a.term.length - b.term.length;
    });

    // Select non-overlapping matches, preferring longer ones at same position
    // Each entity gets at most one match.
    // Pre-seed with any entities already linked by a prior step (e.g. resolveAliasWikilinks)
    // so firstOccurrenceOnly skips them in this pass.
    const selectedMatches: typeof allCandidates = [];
    const selectedEntityNames = new Set<string>(alreadyLinked ?? []);

    for (const candidate of allCandidates) {
      const entityKey = candidate.entityName.toLowerCase();

      // Skip if this entity already has a selected match
      if (selectedEntityNames.has(entityKey)) {
        continue;
      }

      // Check if this overlaps with any already selected match
      const overlaps = selectedMatches.some(
        existing =>
          (candidate.match.start >= existing.match.start && candidate.match.start < existing.match.end) ||
          (candidate.match.end > existing.match.start && candidate.match.end <= existing.match.end) ||
          (candidate.match.start <= existing.match.start && candidate.match.end >= existing.match.end)
      );

      if (!overlaps) {
        selectedMatches.push(candidate);
        selectedEntityNames.add(entityKey);
      }
    }

    // Sort by position from end to start to preserve offsets when inserting
    selectedMatches.sort((a, b) => b.match.start - a.match.start);

    for (const { entityName, term: _term, match } of selectedMatches) {
      // Use display text format when matched text differs from entity name
      const matchedTextLower = match.matched.toLowerCase();
      const entityNameLower = entityName.toLowerCase();
      const wikilink = matchedTextLower === entityNameLower
        ? `[[${entityName}]]`
        : `[[${entityName}|${match.matched}]]`;

      result = result.slice(0, match.start) + wikilink + result.slice(match.end);

      // Update protected zones (shift positions after insertion)
      const shift = wikilink.length - match.matched.length;
      zones = zones.map(zone => ({
        ...zone,
        start: zone.start <= match.start ? zone.start : zone.start + shift,
        end: zone.end <= match.start ? zone.end : zone.end + shift,
      }));

      // Add new wikilink as protected zone
      zones.push({
        start: match.start,
        end: match.start + wikilink.length,
        type: 'wikilink',
      });
      zones.sort((a, b) => a.start - b.start);

      linksAdded++;
      if (!linkedEntities.includes(entityName)) {
        linkedEntities.push(entityName);
      }
    }

    // Stemmed matching pass: for single-word entities (≥4 chars) that didn't match
    // exactly, find content words with the same Porter stem and link them.
    // This eliminates the need for explicit morphological aliases
    // (e.g., Pipelines matches "Pipeline", Sprint matches "Sprinting").
    for (const entity of entities) {
      if (typeof entity === 'string') continue;
      const entityName = entity.name;
      if (selectedEntityNames.has(entityName.toLowerCase())) continue;
      // Only single-word entities ≥4 chars — multi-word needs exact matching
      if (entityName.includes(' ') || entityName.length < 4) continue;
      if (shouldExcludeEntity(entityName)) continue;

      const entityStem = stem(entityName);
      // Find word-boundary matches in content for words with same stem
      const wordPattern = /\b[A-Za-z]{4,}\b/g;
      let wordMatch: RegExpExecArray | null;
      let bestStemMatch: { start: number; end: number; matched: string } | null = null;

      while ((wordMatch = wordPattern.exec(result)) !== null) {
        const word = wordMatch[0];
        if (stem(word) !== entityStem) continue;
        // Skip if same as entity name (already tried in exact pass)
        if (word.toLowerCase() === entityName.toLowerCase()) continue;
        const start = wordMatch.index;
        const end = start + word.length;
        // Must not be in a protected zone
        if (rangeOverlapsProtectedZone(start, end, zones)) continue;
        // Check bracket chars
        const charBefore = start > 0 ? result[start - 1] : '';
        const charAfter = end < result.length ? result[end] : '';
        if ('()[]{}' .includes(charBefore) || '()[]{}' .includes(charAfter)) continue;
        bestStemMatch = { start, end, matched: word };
        break; // First occurrence only
      }

      if (bestStemMatch) {
        const wikilink = `[[${entityName}|${bestStemMatch.matched}]]`;
        result = result.slice(0, bestStemMatch.start) + wikilink + result.slice(bestStemMatch.end);
        const shift = wikilink.length - bestStemMatch.matched.length;
        zones = zones.map(zone => ({
          ...zone,
          start: zone.start <= bestStemMatch!.start ? zone.start : zone.start + shift,
          end: zone.end <= bestStemMatch!.start ? zone.end : zone.end + shift,
        }));
        zones.push({ start: bestStemMatch.start, end: bestStemMatch.start + wikilink.length, type: 'wikilink' });
        zones.sort((a, b) => a.start - b.start);
        linksAdded++;
        if (!linkedEntities.includes(entityName)) {
          linkedEntities.push(entityName);
        }
      }
    }
  } else {
    // For all occurrences mode, process each term
    for (const { term, entityName } of allSearchTerms) {
      // Find all matches of the search term
      const matches = findEntityMatches(result, term, caseInsensitive);

      // Filter out matches in protected zones
      const validMatches = matches.filter(
        match => !rangeOverlapsProtectedZone(match.start, match.end, zones)
      );

      if (validMatches.length === 0) {
        continue;
      }

      // Process from end to start to preserve positions
      const matchesToProcess = [...validMatches].reverse();

      for (const match of matchesToProcess) {
        // Use display text format when matched text differs from entity name
        const matchedTextLower = match.matched.toLowerCase();
        const entityNameLower = entityName.toLowerCase();
        const wikilink = matchedTextLower === entityNameLower
          ? `[[${entityName}]]`
          : `[[${entityName}|${match.matched}]]`;

        result = result.slice(0, match.start) + wikilink + result.slice(match.end);

        // Update protected zones (shift positions after insertion)
        const shift = wikilink.length - match.matched.length;
        zones = zones.map(zone => ({
          ...zone,
          start: zone.start <= match.start ? zone.start : zone.start + shift,
          end: zone.end <= match.start ? zone.end : zone.end + shift,
        }));

        // Add new wikilink as protected zone
        zones.push({
          start: match.start,
          end: match.start + wikilink.length,
          type: 'wikilink',
        });
        zones.sort((a, b) => a.start - b.start);

        linksAdded++;
        if (!linkedEntities.includes(entityName)) {
          linkedEntities.push(entityName);
        }
      }
    }
  }

  return {
    content: result,
    linksAdded,
    linkedEntities,
  };
}

/**
 * Suggest wikilinks without applying them
 * Returns a list of potential links with their positions
 *
 * Supports both entity names and aliases - if content matches an alias,
 * the suggestion will contain the canonical entity name.
 */
export function suggestWikilinks(
  content: string,
  entities: Entity[],
  options: WikilinkOptions = {}
): Array<{ entity: string; start: number; end: number; context: string }> {
  const {
    firstOccurrenceOnly = true,
    caseInsensitive = true,
  } = options;

  const suggestions: Array<{
    entity: string;
    start: number;
    end: number;
    context: string;
  }> = [];

  if (!entities.length) {
    return suggestions;
  }

  // Build search terms from all entities (names + aliases)
  // Each term maps back to its canonical entity name
  const allSearchTerms: Array<{ term: string; entityName: string; isAlias: boolean }> = [];
  for (const entity of entities) {
    const terms = getSearchTerms(entity);
    for (const t of terms) {
      if (!shouldExcludeEntity(t.term, t.isAlias)) {
        allSearchTerms.push(t);
      }
    }
  }

  // Sort by term length (longest first) to prioritize longer matches
  allSearchTerms.sort((a, b) => b.term.length - a.term.length);

  // Get protected zones
  const zones = getProtectedZones(content);

  if (firstOccurrenceOnly) {
    // For firstOccurrenceOnly mode, find the earliest match across all terms
    // for each entity, similar to applyWikilinks behavior
    const entityAllMatches = new Map<string, Array<{ match: { start: number; end: number }; entityName: string }>>();

    for (const { term, entityName, isAlias } of allSearchTerms) {
      const entityKey = entityName.toLowerCase();
      const useCaseInsensitive = !(isAlias && term.length <= 4 && term === term.toUpperCase());
      const matches = findEntityMatches(content, term, useCaseInsensitive ? caseInsensitive : false);

      // Filter out matches in protected zones
      const validMatches = matches.filter(
        match => !rangeOverlapsProtectedZone(match.start, match.end, zones)
      );

      if (validMatches.length === 0) continue;

      // Add to entity's matches
      const existingMatches = entityAllMatches.get(entityKey) || [];
      for (const match of validMatches) {
        existingMatches.push({ match, entityName });
      }
      entityAllMatches.set(entityKey, existingMatches);
    }

    // For each entity, pick the earliest match
    const selectedSuggestions: Array<{ entity: string; start: number; end: number; context: string }> = [];

    for (const [_entityKey, matches] of entityAllMatches.entries()) {
      // Sort by position and pick the earliest
      matches.sort((a, b) => a.match.start - b.match.start);
      const earliest = matches[0];

      const contextStart = Math.max(0, earliest.match.start - 20);
      const contextEnd = Math.min(content.length, earliest.match.end + 20);
      const context = content.slice(contextStart, contextEnd);

      selectedSuggestions.push({
        entity: earliest.entityName,
        start: earliest.match.start,
        end: earliest.match.end,
        context: contextStart > 0 ? '...' + context : context,
      });
    }

    // Sort suggestions by position
    selectedSuggestions.sort((a, b) => a.start - b.start);
    return selectedSuggestions;
  }

  // For all occurrences mode, process each term
  for (const { term, entityName } of allSearchTerms) {
    const matches = findEntityMatches(content, term, caseInsensitive);

    for (const match of matches) {
      // Skip if in protected zone
      if (rangeOverlapsProtectedZone(match.start, match.end, zones)) {
        continue;
      }

      // Extract context (surrounding text)
      const contextStart = Math.max(0, match.start - 20);
      const contextEnd = Math.min(content.length, match.end + 20);
      const context = content.slice(contextStart, contextEnd);

      // Return the canonical entity name, not the matched term
      suggestions.push({
        entity: entityName,
        start: match.start,
        end: match.end,
        context: contextStart > 0 ? '...' + context : context,
      });
    }
  }

  return suggestions;
}

/**
 * Resolve wikilinks that target aliases to their canonical entity names
 *
 * When a user types [[model context protocol]], and "Model Context Protocol"
 * is an alias for entity "MCP", this function transforms it to:
 * [[MCP|model context protocol]]
 *
 * This preserves the user's original text as display text while resolving
 * to the canonical entity target.
 *
 * @param content - The markdown content to process
 * @param entities - List of entity names or Entity objects to look for
 * @param options - Resolution options
 * @returns Result with updated content and statistics
 */
export function resolveAliasWikilinks(
  content: string,
  entities: Entity[],
  options: ResolveAliasOptions = {}
): WikilinkResult {
  const { caseInsensitive = true } = options;

  if (!entities.length) {
    return {
      content,
      linksAdded: 0,
      linkedEntities: [],
    };
  }

  // Build alias → entity lookup map
  // Key: alias (lowercase if caseInsensitive)
  // Value: { entityName: canonical name, aliasText: original alias casing }
  const aliasMap = new Map<string, { entityName: string; aliasText: string }>();
  // Track ambiguous aliases (shared by multiple entities) — skip these to avoid wrong resolution
  const ambiguousAliases = new Set<string>();

  for (const entity of entities) {
    if (typeof entity === 'string') continue;

    for (const alias of entity.aliases) {
      const key = caseInsensitive ? alias.toLowerCase() : alias;
      const existing = aliasMap.get(key);
      if (existing && existing.entityName !== entity.name) {
        // Two different entities claim this alias — mark as ambiguous
        ambiguousAliases.add(key);
      }
      aliasMap.set(key, { entityName: entity.name, aliasText: alias });
    }

    // Also map the entity name itself so we can detect if target already points to entity
    const nameKey = caseInsensitive ? entity.name.toLowerCase() : entity.name;
    // Don't overwrite if name happens to be an alias of another entity
    if (!aliasMap.has(nameKey)) {
      aliasMap.set(nameKey, { entityName: entity.name, aliasText: entity.name });
    }
  }

  // Find wikilinks: [[target]] or [[target|display]]
  const wikilinkRegex = /\[\[([^\]|]+)(\|[^\]]+)?\]\]/g;
  let result = content;
  let linksResolved = 0;
  const resolvedEntities: string[] = [];

  // Collect all matches first, then process from end to preserve positions
  const matches: Array<{
    fullMatch: string;
    target: string;
    displayPart: string | undefined;
    index: number;
  }> = [];

  let match: RegExpExecArray | null;
  while ((match = wikilinkRegex.exec(content)) !== null) {
    matches.push({
      fullMatch: match[0],
      target: match[1],
      displayPart: match[2], // includes | if present
      index: match.index,
    });
  }

  // Process from end to start to preserve positions
  for (let i = matches.length - 1; i >= 0; i--) {
    const { fullMatch, target, displayPart, index } = matches[i];
    const targetKey = caseInsensitive ? target.toLowerCase() : target;

    // Check if target matches an alias
    const aliasInfo = aliasMap.get(targetKey);
    if (!aliasInfo) {
      // Target doesn't match any alias or entity name - leave unchanged
      continue;
    }

    // Skip ambiguous aliases — multiple entities claim this alias, resolution would be arbitrary
    if (ambiguousAliases.has(targetKey)) {
      continue;
    }

    // Check if already pointing to the entity name (no resolution needed)
    const entityNameKey = caseInsensitive ? aliasInfo.entityName.toLowerCase() : aliasInfo.entityName;
    if (targetKey === entityNameKey) {
      // Already pointing to entity name, no change needed
      continue;
    }

    // Target matches an alias! Resolve to canonical entity
    let newWikilink: string;
    if (displayPart) {
      // Has existing display text: [[alias|display]] → [[Entity|display]]
      newWikilink = `[[${aliasInfo.entityName}${displayPart}]]`;
    } else {
      // No display text: [[alias]] → [[Entity|alias]]
      // Preserve the user's original casing of the alias
      newWikilink = `[[${aliasInfo.entityName}|${target}]]`;
    }

    result = result.slice(0, index) + newWikilink + result.slice(index + fullMatch.length);
    linksResolved++;
    if (!resolvedEntities.includes(aliasInfo.entityName)) {
      resolvedEntities.push(aliasInfo.entityName);
    }
  }

  return {
    content: result,
    linksAdded: linksResolved,
    linkedEntities: resolvedEntities,
  };
}

/**
 * Default configuration for implicit entity detection
 */
const DEFAULT_IMPLICIT_CONFIG: Required<ImplicitEntityConfig> = {
  detectImplicit: false,
  implicitPatterns: ['proper-nouns', 'quoted-terms'],
  excludePatterns: ['^The ', '^A ', '^An ', '^This ', '^That ', '^These ', '^Those '],
  minEntityLength: 3,
};

/**
 * Common words that should not be detected as implicit entities
 */
export const IMPLICIT_EXCLUDE_WORDS = new Set([
  // Days and months
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  // Common sentence starters / determiners
  'this', 'that', 'these', 'those', 'there', 'here', 'when', 'where', 'what',
  'which', 'while', 'since', 'after', 'before', 'during', 'until', 'because',
  'however', 'therefore', 'although', 'though', 'unless', 'whether',
  // Document/structure words
  'note', 'notes', 'example', 'chapter', 'section', 'part', 'item', 'figure',
  'table', 'list', 'step', 'task', 'todo', 'idea', 'thought', 'question',
  'answer', 'summary', 'overview', 'introduction', 'conclusion',
  'project', 'projects', 'top', 'bottom', 'page', 'pages', 'link', 'links',
  'file', 'files', 'folder', 'draft', 'type', 'title', 'tag', 'tags',
  'status', 'priority', 'release', 'ticket', 'essential', 'review',
  // Technical terms that look like proper nouns
  'true', 'false', 'null', 'undefined', 'none', 'class', 'function', 'method',
  // Common short words that appear as ALL-CAPS but aren't entities
  'the', 'and', 'but', 'for', 'not', 'you', 'all', 'can', 'had', 'her',
  'was', 'one', 'our', 'out', 'are', 'has', 'his', 'how', 'its', 'may',
  'new', 'now', 'old', 'see', 'way', 'who', 'did', 'got', 'let', 'say',
  // Common abbreviations
  'etc', 'aka', 'btw', 'fyi', 'imo', 'tldr', 'asap', 'rsvp',
  'url', 'html', 'css', 'http', 'https', 'json', 'xml', 'sql', 'ssh', 'tcp', 'udp', 'dns',

  // --- Common adjectives (capitalized at sentence starts) ---
  'able', 'absolute', 'acceptable', 'accessible', 'accurate', 'actual',
  'additional', 'adequate', 'advanced', 'aggressive', 'alive', 'alternative',
  'amazing', 'ancient', 'angry', 'annual', 'apparent', 'applicable',
  'appropriate', 'approximate', 'arbitrary', 'automatic', 'available',
  'aware', 'awful', 'awkward',
  'bad', 'bare', 'beautiful', 'beneficial', 'best', 'better', 'big',
  'bitter', 'blank', 'blind', 'bold', 'boring', 'brave', 'brief',
  'bright', 'brilliant', 'broad', 'broken', 'busy',
  'calm', 'capable', 'careful', 'casual', 'central', 'certain', 'cheap',
  'clean', 'clear', 'clever', 'close', 'cold', 'comfortable', 'common',
  'comparable', 'compatible', 'competitive', 'complete', 'complex',
  'comprehensive', 'concerned', 'concrete', 'confident', 'confused',
  'conscious', 'conservative', 'considerable', 'consistent', 'constant',
  'content', 'continuous', 'convenient', 'conventional', 'cool', 'correct',
  'corresponding', 'costly', 'crazy', 'creative', 'critical', 'crucial',
  'curious', 'current', 'custom',
  'dangerous', 'dark', 'dead', 'dear', 'decent', 'deep', 'defensive',
  'definite', 'deliberate', 'delicate', 'dense', 'dependent', 'desperate',
  'detailed', 'different', 'difficult', 'digital', 'direct', 'dirty',
  'distinct', 'double', 'dramatic', 'dry', 'due', 'dull', 'dumb',
  'eager', 'early', 'eastern', 'easy', 'economic', 'educational',
  'effective', 'efficient', 'elaborate', 'elderly', 'electric', 'elegant',
  'emotional', 'empty', 'encouraging', 'endless', 'enormous', 'entire',
  'equal', 'equivalent', 'essential', 'even', 'eventual', 'every',
  'everyday', 'evident', 'evil', 'exact', 'excellent', 'exceptional',
  'excessive', 'exciting', 'exclusive', 'existing', 'exotic', 'expensive',
  'experienced', 'experimental', 'explicit', 'extended', 'extensive',
  'external', 'extra', 'extraordinary', 'extreme',
  'fair', 'faithful', 'familiar', 'famous', 'fancy', 'fantastic', 'far',
  'fascinating', 'fast', 'fat', 'fatal', 'favorable', 'favourite', 'federal',
  'fierce', 'final', 'financial', 'fine', 'firm', 'fit', 'fixed', 'flat',
  'flexible', 'fluid', 'foolish', 'foreign', 'formal', 'former', 'forward',
  'fragile', 'free', 'frequent', 'fresh', 'friendly', 'front', 'frozen',
  'full', 'fun', 'functional', 'fundamental', 'funny', 'further', 'future',
  'general', 'generous', 'gentle', 'genuine', 'giant', 'glad', 'global',
  'golden', 'good', 'gorgeous', 'gradual', 'grand', 'grateful', 'grave',
  'great', 'green', 'grey', 'gross', 'growing', 'guilty',
  'half', 'handsome', 'handy', 'happy', 'hard', 'harmful', 'harsh',
  'healthy', 'heavy', 'helpful', 'hidden', 'high', 'historic', 'honest',
  'horrible', 'hostile', 'hot', 'huge', 'humble', 'hungry',
  'ideal', 'identical', 'immediate', 'immense', 'immune', 'implicit',
  'important', 'impossible', 'impressive', 'inadequate', 'inappropriate',
  'incredible', 'independent', 'indirect', 'individual', 'industrial',
  'inevitable', 'infinite', 'informal', 'inherent', 'initial', 'inner',
  'innocent', 'innovative', 'instant', 'insufficient', 'intelligent',
  'intense', 'intensive', 'interactive', 'interesting', 'interim',
  'intermediate', 'internal', 'international', 'invalid', 'invisible',
  'irrelevant', 'isolated',
  'joint', 'junior', 'just',
  'keen', 'key', 'kind',
  'large', 'last', 'late', 'lateral', 'latest', 'lazy', 'lean', 'least',
  'legitimate', 'lengthy', 'less', 'lesser', 'level', 'liberal', 'light',
  'likely', 'limited', 'linear', 'literal', 'little', 'live', 'lively',
  'local', 'logical', 'lone', 'lonely', 'long', 'loose', 'loud', 'lovely',
  'low', 'loyal', 'lucky',
  'mad', 'magic', 'main', 'major', 'male', 'manual', 'many', 'marginal',
  'massive', 'mature', 'maximum', 'mean', 'meaningful', 'mechanical',
  'medical', 'medium', 'mental', 'mere', 'mild', 'military', 'minimal',
  'minimum', 'minor', 'minute', 'missing', 'mixed', 'mobile', 'moderate',
  'modern', 'modest', 'moral', 'more', 'most', 'multiple', 'mutual',
  'naked', 'narrow', 'nasty', 'native', 'natural', 'neat', 'necessary',
  'negative', 'nervous', 'neutral', 'nice', 'noble', 'nominal', 'normal',
  'notable', 'novel', 'numerous',
  'obvious', 'occasional', 'odd', 'offensive', 'official', 'only', 'open',
  'operational', 'opposite', 'optimal', 'optional', 'ordinary', 'organic',
  'original', 'other', 'outer', 'overall', 'overnight', 'own',
  'painful', 'pale', 'parallel', 'partial', 'particular', 'passive', 'past',
  'patient', 'peaceful', 'peculiar', 'perfect', 'permanent', 'personal',
  'physical', 'plain', 'pleasant', 'plenty', 'plus', 'polite', 'political',
  'poor', 'popular', 'portable', 'positive', 'possible', 'potential',
  'powerful', 'practical', 'precise', 'predictable', 'preliminary',
  'premium', 'prepared', 'present', 'pretty', 'previous',
  'primary', 'prime', 'primitive', 'principal', 'prior', 'private',
  'probable', 'productive', 'professional', 'profitable', 'profound',
  'progressive', 'prominent', 'promising', 'proper', 'proportional',
  'proposed', 'prospective', 'protective', 'proud', 'provisional', 'public',
  'pure',
  'quick', 'quiet',
  'radical', 'random', 'rapid', 'rare', 'rational', 'raw', 'ready', 'real',
  'realistic', 'reasonable', 'recent', 'regional', 'regular', 'related',
  'relative', 'relevant', 'reliable', 'reluctant', 'remaining', 'remarkable',
  'remote', 'repeated', 'representative', 'required', 'residential',
  'respective', 'responsible', 'rich', 'rigid', 'right', 'rising', 'robust',
  'rough', 'round', 'royal', 'rude', 'rural',
  'sacred', 'sad', 'safe', 'satisfactory', 'scared', 'scattered', 'secure',
  'selective', 'senior', 'sensitive', 'separate', 'serious', 'severe',
  'shallow', 'sharp', 'sheer', 'short', 'shy', 'sick', 'significant',
  'silent', 'silly', 'similar', 'simple', 'single', 'slight', 'slim',
  'slow', 'small', 'smart', 'smooth', 'sober', 'social', 'soft', 'solar',
  'sole', 'solid', 'sophisticated', 'sorry', 'sound', 'southern', 'spare',
  'spatial', 'special', 'specific', 'spectacular', 'spiritual', 'splendid',
  'spontaneous', 'stable', 'standard', 'static', 'statistical', 'steady',
  'steep', 'sticky', 'stiff', 'straight', 'strange', 'strategic', 'strict',
  'striking', 'strong', 'structural', 'stupid', 'subject', 'substantial',
  'subtle', 'successful', 'successive', 'such', 'sudden', 'sufficient',
  'suitable', 'super', 'superb', 'superior', 'supreme', 'sure', 'surgical',
  'surprised', 'surprising', 'suspicious', 'sweet', 'swift', 'symbolic',
  'sympathetic',
  'tall', 'technical', 'temporary', 'tender', 'terrible', 'thick', 'thin',
  'thorough', 'tight', 'tiny', 'tired', 'top', 'total', 'tough',
  'traditional', 'tremendous', 'tropical', 'true', 'typical',
  'ugly', 'ultimate', 'unable', 'uncertain', 'underlying', 'unfair',
  'unfortunate', 'unhappy', 'uniform', 'unique', 'universal', 'unknown',
  'unlikely', 'unnecessary', 'unpleasant', 'unprecedented', 'unusual',
  'upper', 'upset', 'urban', 'urgent', 'useful', 'useless', 'usual',
  'valid', 'valuable', 'variable', 'various', 'vast', 'verbal', 'vertical',
  'viable', 'violent', 'virtual', 'visible', 'visual', 'vital', 'vivid',
  'voluntary', 'vulnerable',
  'warm', 'weak', 'wealthy', 'weird', 'welcome', 'western', 'wet', 'white',
  'whole', 'wicked', 'wide', 'widespread', 'wild', 'willing', 'wise',
  'wonderful', 'wooden', 'working', 'worried', 'worse', 'worst', 'worth',
  'worthy', 'wrong',
  'young',

  // --- Common verbs / past participles (capitalized at sentence starts) ---
  'accepted', 'achieved', 'acquired', 'added', 'adjusted', 'adopted',
  'affected', 'agreed', 'allowed', 'announced', 'applied', 'appointed',
  'approved', 'argued', 'arranged', 'arrived', 'asked', 'assessed',
  'assigned', 'associated', 'assumed', 'attached', 'attempted', 'attended',
  'based', 'beaten', 'become', 'begun', 'believed', 'belonged', 'blocked',
  'born', 'bought', 'brought', 'built', 'buried', 'burned',
  'called', 'captured', 'carried', 'caught', 'caused', 'challenged',
  'changed', 'charged', 'checked', 'chosen', 'claimed', 'cleaned',
  'cleared', 'closed', 'collected', 'combined', 'compared', 'compiled',
  'completed', 'complicated', 'composed', 'concerned', 'concluded',
  'conducted', 'confirmed', 'connected', 'considered', 'constructed',
  'contained', 'continued', 'contributed', 'controlled', 'converted',
  'convinced', 'cooked', 'copied', 'corrected', 'covered', 'created',
  'crossed', 'crushed', 'customized',
  'damaged', 'dealt', 'decided', 'declared', 'declined', 'dedicated',
  'defeated', 'defined', 'delivered', 'demanded', 'demonstrated', 'denied',
  'deployed', 'derived', 'described', 'designed', 'desired', 'destroyed',
  'detected', 'determined', 'developed', 'devoted', 'directed', 'disabled',
  'disappointed', 'discovered', 'discussed', 'dismissed', 'displayed',
  'distributed', 'divided', 'documented', 'dominated', 'done', 'doubled',
  'downloaded', 'drafted', 'drawn', 'dressed', 'driven', 'dropped',
  'earned', 'edited', 'educated', 'elected', 'eliminated', 'embedded',
  'emerged', 'employed', 'enabled', 'encountered', 'encouraged', 'ended',
  'engaged', 'enhanced', 'enjoyed', 'entered', 'equipped', 'escaped',
  'established', 'estimated', 'evaluated', 'examined', 'exceeded',
  'exchanged', 'excluded', 'executed', 'exercised', 'exhausted', 'expanded',
  'expected', 'experienced', 'explained', 'exposed', 'expressed', 'extended',
  'extracted',
  'faced', 'failed', 'fallen', 'featured', 'fed', 'felt', 'filed',
  'filled', 'filtered', 'finalised', 'finalized', 'finished', 'fired',
  'fixed', 'flagged', 'flipped', 'floated', 'followed', 'forced',
  'forgotten', 'formed', 'formatted', 'found', 'founded', 'freed', 'frozen',
  'fulfilled', 'funded', 'furnished',
  'gained', 'gathered', 'generated', 'given', 'gone', 'grabbed', 'granted',
  'grown', 'guaranteed', 'guided',
  'handled', 'happened', 'heard', 'heated', 'held', 'helped', 'hidden',
  'highlighted', 'hired', 'hosted', 'hurt',
  'identified', 'ignored', 'illustrated', 'imagined', 'implemented',
  'implied', 'imported', 'imposed', 'improved', 'included', 'incorporated',
  'increased', 'indicated', 'influenced', 'informed', 'inherited',
  'initiated', 'injured', 'inserted', 'inspired', 'installed', 'integrated',
  'intended', 'interested', 'interpreted', 'introduced', 'invaded',
  'invested', 'investigated', 'invited', 'involved', 'isolated', 'issued',
  'joined', 'judged', 'jumped', 'justified',
  'kept', 'kicked', 'killed', 'knocked', 'known',
  'labelled', 'lacked', 'laid', 'landed', 'lasted', 'launched', 'learned',
  'learnt', 'left', 'lifted', 'liked', 'lined', 'linked',
  'listed', 'listened', 'lived', 'loaded', 'located', 'locked', 'logged',
  'looked', 'lost', 'loved', 'lowered',
  'made', 'maintained', 'managed', 'manufactured', 'mapped', 'marked',
  'matched', 'meant', 'measured', 'mentioned', 'merged', 'met', 'migrated',
  'minded', 'missed', 'mixed', 'modified', 'monitored', 'motivated',
  'mounted', 'moved', 'multiplied',
  'named', 'needed', 'negotiated', 'nested', 'nominated', 'normalised',
  'noted', 'noticed',
  'observed', 'obtained', 'occupied', 'occurred', 'offered', 'opened',
  'operated', 'opposed', 'ordered', 'organised', 'organized', 'oriented',
  'outlined', 'overcome', 'overlooked', 'owned',
  'packed', 'paid', 'paired', 'parsed', 'passed', 'patched', 'performed',
  'permitted', 'picked', 'pinned', 'placed', 'planned', 'planted', 'played',
  'pleased', 'pointed', 'polished', 'positioned', 'posted', 'poured',
  'powered', 'practised', 'preferred', 'prepared', 'presented', 'preserved',
  'pressed', 'prevented', 'priced', 'printed', 'prioritised', 'processed',
  'produced', 'programmed', 'promised', 'promoted', 'prompted', 'proposed',
  'protected', 'proved', 'proven', 'provided', 'published', 'pulled',
  'purchased', 'pushed', 'put',
  'qualified', 'queried', 'questioned', 'quoted',
  'raised', 'ran', 'ranked', 'rated', 'reached', 'read', 'realised',
  'realized', 'received', 'recognised', 'recognized', 'recommended',
  'recorded', 'recovered', 'reduced', 'referred', 'reflected', 'reformed',
  'refused', 'regarded', 'registered', 'regulated', 'rejected', 'related',
  'released', 'relied', 'remained', 'remembered', 'reminded', 'removed',
  'renamed', 'renewed', 'repaired', 'repeated', 'replaced', 'replied',
  'reported', 'represented', 'requested', 'required', 'rescued', 'reserved',
  'resigned', 'resolved', 'responded', 'restored', 'restricted', 'resulted',
  'retained', 'retired', 'retrieved', 'returned', 'revealed', 'reversed',
  'reviewed', 'revised', 'rewarded', 'rolled', 'rotated', 'rounded', 'ruled',
  'rushed',
  'satisfied', 'saved', 'scaled', 'scanned', 'scattered', 'scheduled',
  'scored', 'searched', 'secured', 'selected', 'sent', 'separated', 'served',
  'settled', 'shaped', 'shared', 'shifted', 'shipped', 'shocked', 'shown',
  'shut', 'signed', 'simplified', 'situated', 'skipped', 'slipped', 'sold',
  'solved', 'sorted', 'sought', 'sourced', 'spent', 'split', 'spoken',
  'sponsored', 'spotted', 'spread', 'staged', 'started', 'stated',
  'stayed', 'stolen', 'stopped', 'stored', 'strengthened', 'stretched',
  'struck', 'structured', 'studied', 'submitted', 'succeeded', 'suffered',
  'suggested', 'suited', 'summarised', 'supplied', 'supported', 'supposed',
  'surprised', 'surrounded', 'survived', 'suspected', 'suspended',
  'sustained', 'switched',
  'taken', 'talked', 'targeted', 'taught', 'tested', 'thanked', 'thought',
  'threatened', 'thrown', 'tied', 'titled', 'told', 'topped', 'torn',
  'touched', 'traced', 'tracked', 'traded', 'trained', 'transferred',
  'transformed', 'translated', 'transmitted', 'transported', 'trapped',
  'travelled', 'treated', 'triggered', 'troubled', 'trusted', 'turned',
  'typed',
  'understood', 'undertaken', 'unified', 'united', 'unlocked', 'updated',
  'upgraded', 'uploaded', 'urged', 'used', 'utilised',
  'validated', 'valued', 'varied', 'verified', 'viewed', 'visited', 'voted',
  'waited', 'walked', 'wanted', 'warned', 'washed', 'watched', 'welcomed',
  'withdrawn', 'witnessed', 'won', 'wondered', 'worked', 'worried',
  'wrapped', 'written',

  // --- Common nouns (non-entity, capitalized at sentence starts) ---
  'absence', 'access', 'account', 'accuracy', 'achievement', 'acquisition',
  'act', 'action', 'activity', 'addition', 'address', 'administration',
  'admission', 'adoption', 'adult', 'advance', 'advantage', 'advice',
  'affair', 'afternoon', 'age', 'agency', 'agenda', 'agreement', 'aid',
  'aim', 'air', 'alarm', 'alternative', 'ambition', 'amendment', 'amount',
  'analysis', 'anger', 'angle', 'announcement', 'anxiety', 'appeal',
  'appearance', 'application', 'appointment', 'approach', 'approval',
  'argument', 'arrangement', 'arrival', 'aspect', 'assembly', 'assessment',
  'asset', 'assignment', 'assistance', 'association', 'assumption',
  'atmosphere', 'attachment', 'attack', 'attempt', 'attendance', 'attention',
  'attitude', 'audience', 'authority', 'average', 'awareness',
  'background', 'balance', 'band', 'barrier', 'base', 'basis', 'battle',
  'beauty', 'bedroom', 'beginning', 'behaviour', 'belief', 'benefit',
  'birth', 'blade', 'blame', 'blast', 'block', 'blow', 'boat', 'bond',
  'bone', 'bonus', 'border', 'boss', 'boundary', 'brain', 'brand', 'breath',
  'brick', 'broadcast', 'brother', 'browser', 'budget', 'bug', 'bulk',
  'burden', 'buyer',
  'cabinet', 'cable', 'calculation', 'campaign', 'candidate', 'capability',
  'captain', 'career', 'cargo', 'carpet', 'carrier', 'cash', 'cast',
  'catalogue', 'category', 'cause', 'ceiling', 'celebration', 'chain',
  'chair', 'chairman', 'champion', 'channel', 'chapter', 'charity', 'chart',
  'check', 'chest', 'child', 'chip', 'chunk', 'circuit', 'citizen', 'city',
  'civilian', 'claim', 'clarity', 'clash', 'clause', 'client', 'climate',
  'clock', 'closure', 'cloth', 'cloud', 'cluster', 'coach', 'coalition',
  'coast', 'collaboration', 'collapse', 'colleague',
  'colony', 'column', 'combination', 'comfort', 'command', 'commander',
  'comment', 'commerce', 'commission', 'commitment', 'committee',
  'companion', 'complaint', 'complexity', 'component', 'composition',
  'compromise', 'concentration', 'concept', 'conclusion', 'confidence',
  'configuration', 'confirmation', 'conflict', 'confusion', 'conjunction',
  'consequence', 'conservation', 'consideration', 'constraint', 'consultant',
  'consultation', 'consumer', 'consumption', 'contact', 'container',
  'contempt', 'continent', 'continuation', 'controversy', 'convention',
  'conversation', 'conviction', 'cooperation', 'coordination', 'core',
  'correction', 'correlation', 'correspondent', 'corridor', 'corruption',
  'counter', 'countryside', 'coverage', 'crash', 'creature',
  'crew', 'crime', 'crisis', 'criterion', 'criticism', 'crop', 'crowd',
  'crown', 'currency', 'curriculum', 'curve', 'customer', 'cycle',

  // --- Common adverbs (capitalized at sentence starts) ---
  'absolutely', 'accordingly', 'accurately', 'actively', 'actually',
  'additionally', 'admittedly', 'allegedly', 'alternatively', 'altogether',
  'amazingly', 'apparently', 'arguably', 'automatically',
  'barely', 'basically', 'briefly', 'broadly',
  'carefully', 'casually', 'cautiously', 'certainly',
  'clearly', 'closely', 'collectively', 'commonly',
  'comparatively', 'completely', 'consequently', 'considerably',
  'consistently', 'constantly', 'continuously', 'conversely', 'correctly',
  'critically', 'crucially', 'curiously', 'currently',
  'definitely', 'deliberately', 'desperately', 'directly', 'distinctly',
  'dramatically',
  'easily', 'effectively', 'efficiently', 'elegantly', 'elsewhere',
  'emotionally', 'enormously', 'entirely', 'equally',
  'especially', 'essentially', 'eventually', 'evidently', 'exactly',
  'exclusively', 'explicitly', 'extensively', 'externally', 'extremely',
  'fairly', 'famously', 'finally', 'firmly', 'firstly', 'formally',
  'formerly', 'fortunately', 'frankly', 'freely', 'frequently',
  'fundamentally',
  'generally', 'gently', 'genuinely', 'gradually', 'greatly',
  'happily', 'hardly', 'heavily', 'hence', 'highly', 'honestly',
  'hopefully', 'hugely',
  'ideally', 'immediately', 'immensely',
  'importantly', 'impressively', 'incidentally',
  'increasingly', 'incredibly', 'independently', 'indirectly',
  'individually', 'inevitably', 'informally', 'inherently', 'initially',
  'intensely', 'intentionally', 'interestingly', 'internally', 'ironically',
  'jointly',
  'kindly',
  'largely', 'lastly', 'lately', 'legally', 'legitimately', 'literally',
  'locally', 'logically', 'loosely',
  'mainly', 'manually', 'marginally', 'meanwhile',
  'merely', 'mildly', 'minimally', 'moderately', 'morally',
  'moreover', 'mostly', 'mutually',
  'namely', 'naturally', 'neatly', 'necessarily', 'negatively',
  'nevertheless', 'newly', 'nicely', 'nominally',
  'nonetheless', 'normally', 'notably', 'noticeably',
  'objectively', 'obviously', 'occasionally', 'oddly',
  'officially', 'openly', 'optimally', 'ordinarily',
  'originally', 'otherwise', 'overall', 'overwhelmingly',
  'partially', 'particularly', 'partly', 'passively',
  'patiently', 'perfectly', 'periodically', 'permanently', 'personally',
  'physically', 'plainly', 'politely', 'politically',
  'poorly', 'positively', 'possibly', 'potentially',
  'practically', 'precisely', 'predominantly', 'preferably', 'presently',
  'presumably', 'pretty', 'previously', 'primarily', 'principally',
  'privately', 'probably', 'professionally', 'profoundly',
  'progressively', 'prominently', 'promptly', 'properly', 'proportionally',
  'publicly', 'purely',
  'quickly', 'quietly', 'quite',
  'radically', 'randomly', 'rapidly', 'rarely', 'rationally', 'readily',
  'realistically', 'really', 'reasonably', 'recently', 'regardless',
  'regularly', 'relatively', 'reliably', 'reluctantly',
  'remarkably', 'remotely', 'repeatedly', 'reportedly', 'respectively',
  'responsibly', 'roughly',
  'sadly', 'safely', 'scarcely', 'secondly', 'secretly', 'seemingly',
  'selectively', 'separately', 'seriously', 'severely', 'sharply',
  'shortly', 'significantly', 'silently', 'similarly', 'simply',
  'simultaneously', 'sincerely', 'slightly', 'slowly', 'smoothly',
  'socially', 'solely', 'somehow', 'sometimes', 'somewhat', 'soon',
  'specifically', 'spontaneously', 'steadily', 'steeply',
  'still', 'strategically', 'strictly', 'strikingly', 'strongly',
  'structurally', 'subsequently', 'substantially', 'subtly', 'successfully',
  'suddenly', 'sufficiently', 'supposedly', 'surely', 'surprisingly',
  'swiftly', 'systematically',
  'technically', 'temporarily', 'terribly', 'thankfully',
  'thoroughly', 'tightly', 'together', 'traditionally', 'tremendously',
  'truly', 'typically',
  'ultimately', 'undoubtedly',
  'unexpectedly', 'unfortunately', 'uniformly', 'universally',
  'unnecessarily', 'unusually', 'urgently',
  'usefully', 'usually', 'utterly',
  'vastly', 'virtually', 'visually',
  'warmly', 'weakly', 'widely', 'wildly', 'willingly', 'wisely',
]);

/**
 * Words that commonly start sentences but should not start a proper noun entity.
 * These are checked separately because they might appear capitalized at sentence start.
 */
const SENTENCE_STARTER_WORDS = new Set([
  // Imperative verbs
  'visit', 'see', 'please', 'note', 'check', 'read', 'look', 'find',
  'get', 'set', 'add', 'use', 'try', 'make', 'take', 'give', 'keep', 'let',
  'call', 'run', 'ask', 'tell', 'show', 'help', 'need', 'want', 'like',
  'think', 'know', 'feel', 'seem', 'hear', 'watch', 'wait', 'work',
  'start', 'stop', 'open', 'close', 'move', 'turn', 'bring', 'send', 'leave',
  'meet', 'join', 'follow', 'include', 'consider', 'remember', 'forget',
  'target', 'create', 'build', 'write', 'avoid', 'provide', 'maintain',
  'define', 'ensure', 'place', 'focus', 'track', 'enable', 'apply', 'test',
  'handle', 'load', 'link', 'pass', 'save', 'lead', 'frame', 'point',
  // Greetings / interjections
  'hello', 'hi', 'hey', 'thanks', 'thank', 'sorry',
  // Titles
  'mr', 'mrs', 'ms', 'dr', 'sir',
  // Pronouns, possessives, determiners
  'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'some', 'any', 'every', 'each', 'both', 'few', 'many', 'most',
  // Common starters (conjunctions, adverbs, auxiliaries)
  'so', 'no', 'yes', 'not', 'never', 'always', 'also', 'just', 'only', 'already',
  'here', 'there', 'then', 'now', 'when', 'how', 'even', 'still',
  'go', 'went', 'gone', 'going',
  'had', 'have', 'has', 'having',
  'been', 'being', 'was', 'were',
  'got', 'getting', 'put', 'putting',
  'said', 'told', 'asked', 'called',
  'do', 'did', 'does', 'done',
  // Common adjectives at sentence start
  'poor', 'old', 'new', 'big', 'little', 'great', 'good', 'bad',
  'first', 'last', 'next', 'other', 'more', 'very',
  'clear', 'fixed', 'based', 'using', 'real',
  'safe', 'local', 'native', 'early', 'similar', 'simple', 'basic', 'related',
  'skip', 'don', 'won',
]);

/**
 * Detect implicit entities in content using pattern matching
 *
 * This finds potential entities that don't have existing files:
 * - Multi-word proper nouns (e.g., "Marcus Johnson", "Project Alpha")
 * - Single capitalized words after lowercase (e.g., "discussed with Marcus")
 * - CamelCase words (e.g., TypeScript, HuggingFace)
 *
 * @param content - The markdown content to analyze
 * @param config - Configuration for detection patterns
 * @returns Array of detected implicit entity matches
 */
export function detectImplicitEntities(
  content: string,
  config: ImplicitEntityConfig = {}
): ImplicitEntityMatch[] {
  const {
    implicitPatterns = DEFAULT_IMPLICIT_CONFIG.implicitPatterns,
    excludePatterns = DEFAULT_IMPLICIT_CONFIG.excludePatterns,
    minEntityLength = DEFAULT_IMPLICIT_CONFIG.minEntityLength,
  } = config;

  const detected: ImplicitEntityMatch[] = [];
  const seenTexts = new Set<string>();

  // Get protected zones to avoid detecting entities in code/links/etc.
  const zones = getProtectedZones(content);

  // Build exclude regex from patterns
  const excludeRegexes = excludePatterns.map(p => new RegExp(p, 'i'));

  /**
   * Check if detected text should be excluded
   */
  function shouldExclude(text: string): boolean {
    // Length check
    if (text.length < minEntityLength) return true;

    // Must contain at least one letter — pure punctuation/symbols are never entities
    if (!/[a-zA-Z]/.test(text)) return true;

    // Common words
    if (getMergedExcludeWords().has(text.toLowerCase())) return true;

    // Exclude patterns
    for (const regex of excludeRegexes) {
      if (regex.test(text)) return true;
    }

    // Already seen (dedup)
    const normalized = text.toLowerCase();
    if (seenTexts.has(normalized)) return true;

    return false;
  }

  /**
   * Check if match is in a protected zone
   */
  function isProtected(start: number, end: number): boolean {
    return rangeOverlapsProtectedZone(start, end, zones);
  }

  // Pattern 1: Multi-word proper nouns
  // Matches "Marcus Johnson", "Project Alpha", "San Francisco Bay Area"
  if (implicitPatterns.includes('proper-nouns')) {
    const properNounRegex = /\b([A-Z][a-z]+(?:[^\S\n]+[A-Z][a-z]+)+)\b/g;
    let match: RegExpExecArray | null;

    while ((match = properNounRegex.exec(content)) !== null) {
      let text = match[1];
      let start = match.index;
      let end = start + match[0].length;

      // Check if first word is a common sentence starter (e.g., "Visit", "Also", "See")
      // If so, trim it and use the remaining words as the entity
      const firstSpaceIndex = text.indexOf(' ');
      if (firstSpaceIndex > 0) {
        const firstWord = text.substring(0, firstSpaceIndex).toLowerCase();
        if (SENTENCE_STARTER_WORDS.has(firstWord)) {
          // Trim the first word and recalculate positions
          text = text.substring(firstSpaceIndex + 1);
          start = start + firstSpaceIndex + 1;
          // Only keep if remaining text has 2+ words (still a proper noun phrase)
          if (!text.includes(' ')) {
            continue; // Skip single-word remainder
          }
        }
      }

      // Guard: max 4 words — longer phrases are almost always prose, not entity names
      const wordCount = text.split(/\s+/).length;
      if (wordCount > 4) continue;

      // Guard: max 40 chars
      if (text.length > 40) continue;

      // Guard: strip trailing punctuation from match text
      const stripped = text.replace(/[,.:;!?]+$/, '');
      if (stripped.length < minEntityLength) continue;
      if (stripped !== text) {
        end = start + stripped.length;
        text = stripped;
      }

      // Guard: sentence-start capitalization — if match begins at start of line
      // (after list marker or newline), first word cap is positional, not semantic.
      // Require at least 2 capitalized words remaining after the first.
      if (start > 0) {
        const lineStart = content.lastIndexOf('\n', start - 1) + 1;
        const before = content.substring(lineStart, start).trim();
        // After list marker (- * >) or empty (line start), first cap is positional
        if (before === '' || /^[-*>]+$/.test(before) || /^\d+\.$/.test(before)) {
          // Already trimmed sentence starters above; this catches the remaining
          // cases where the first word is capitalized only because of its position
          const wordsArr = text.split(/\s+/);
          if (wordsArr.length <= 2) continue; // Too few words to trust positional cap
        }
      }

      if (!shouldExclude(text) && !isProtected(start, end)) {
        detected.push({ text, start, end, pattern: 'proper-nouns' });
        seenTexts.add(text.toLowerCase());
      }
    }
  }

  // Pattern 2: Single capitalized words after lowercase
  // Matches "discussed with Marcus yesterday" -> "Marcus"
  if (implicitPatterns.includes('single-caps')) {
    // Lookbehind for lowercase letter + space
    const singleCapRegex = /(?<=[a-z]\s)([A-Z][a-z]{3,})\b/g;
    let match: RegExpExecArray | null;

    while ((match = singleCapRegex.exec(content)) !== null) {
      const text = match[1];
      const start = match.index;
      const end = start + match[0].length;

      if (!shouldExclude(text) && !isProtected(start, end)) {
        detected.push({ text, start, end, pattern: 'single-caps' });
        seenTexts.add(text.toLowerCase());
      }
    }
  }

  // Pattern 3: Quoted terms (explicit entity markers)
  // Matches "Turbopump" -> [[Turbopump]]
  if (implicitPatterns.includes('quoted-terms')) {
    const quotedRegex = /"([^"]{3,30})"/g;
    let match: RegExpExecArray | null;
    while ((match = quotedRegex.exec(content)) !== null) {
      const text = match[1];
      const start = match.index;
      const end = start + match[0].length;
      if (!shouldExclude(text) && !isProtected(start, end)) {
        detected.push({ text, start, end, pattern: 'quoted-terms' });
        seenTexts.add(text.toLowerCase());
      }
    }
  }

  // Pattern 4: CamelCase words (TypeScript, YouTube, HuggingFace)
  if (implicitPatterns.includes('camel-case')) {
    const camelRegex = /\b([A-Z][a-z]+[A-Z][a-zA-Z]*)\b/g;
    let match: RegExpExecArray | null;
    while ((match = camelRegex.exec(content)) !== null) {
      const text = match[1];
      const start = match.index;
      const end = start + text.length;
      if (!shouldExclude(text) && !isProtected(start, end)) {
        detected.push({ text, start, end, pattern: 'camel-case' });
        seenTexts.add(text.toLowerCase());
      }
    }
  }

  // Pattern 5: ALL-CAPS acronyms (OBS, ONNX, AGPL, LLM)
  if (implicitPatterns.includes('acronyms')) {
    const acronymRegex = /\b([A-Z]{3,})\b/g;
    let match: RegExpExecArray | null;
    while ((match = acronymRegex.exec(content)) !== null) {
      const text = match[1];
      // Skip long ALL-CAPS words (>5 chars) — likely English words in caps, not acronyms
      // Real acronyms are typically 2-5 chars (API, SQL, LLM, ONNX)
      if (text.length > 5) continue;
      const start = match.index;
      const end = start + text.length;
      if (!shouldExclude(text) && !isProtected(start, end)) {
        detected.push({ text, start, end, pattern: 'acronyms' });
        seenTexts.add(text.toLowerCase());
      }
    }
  }

  // Pattern 6: Ticket/issue references (FW-123, PROJ-456, JIRA-1234)
  if (implicitPatterns.includes('ticket-refs')) {
    const ticketRegex = /\b([A-Z]{2,6}-\d{1,6})\b/g;
    let match: RegExpExecArray | null;
    while ((match = ticketRegex.exec(content)) !== null) {
      const text = match[1];
      const start = match.index;
      const end = start + text.length;
      if (!shouldExclude(text) && !isProtected(start, end)) {
        detected.push({ text, start, end, pattern: 'ticket-refs' });
        seenTexts.add(text.toLowerCase());
      }
    }
  }

  // Sort by position (earliest first; longest first at same position)
  detected.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return (b.end - b.start) - (a.end - a.start);
  });

  // Filter overlapping matches — prefer longer matches (earlier in sorted order at same position)
  const filtered: ImplicitEntityMatch[] = [];
  for (const match of detected) {
    const overlaps = filtered.some(
      existing =>
        (match.start >= existing.start && match.start < existing.end) ||
        (match.end > existing.start && match.end <= existing.end) ||
        (match.start <= existing.start && match.end >= existing.end)
    );
    if (!overlaps) {
      filtered.push(match);
    }
  }

  return filtered;
}

/**
 * Process wikilinks with support for both existing entities and implicit detection
 *
 * This is the main entry point that combines:
 * 1. applyWikilinks() for known entities from the vault index
 * 2. detectImplicitEntities() for pattern-based detection
 *
 * @param content - The markdown content to process
 * @param entities - List of known entity names or Entity objects
 * @param options - Extended options including implicit entity config
 * @returns Result with updated content and statistics
 */
export function processWikilinks(
  content: string,
  entities: Entity[],
  options: ExtendedWikilinkOptions = {}
): WikilinkResult {
  const {
    detectImplicit = false,
    implicitPatterns,
    excludePatterns,
    minEntityLength,
    notePath,
    ...wikilinkOptions
  } = options;

  // Step 1: Apply wikilinks for known entities
  const result = applyWikilinks(content, entities, wikilinkOptions);

  // If implicit detection is disabled, return the basic result
  if (!detectImplicit) {
    return result;
  }

  // Step 2: Detect implicit entities in the already-processed content
  const implicitMatches = detectImplicitEntities(result.content, {
    detectImplicit: true,
    implicitPatterns,
    excludePatterns,
    minEntityLength,
  });

  if (implicitMatches.length === 0) {
    return result;
  }

  // Step 3: Build set of already-linked entities (case-insensitive)
  const alreadyLinked = new Set(
    result.linkedEntities.map(e => e.toLowerCase())
  );

  // Also add all known entity names to avoid duplicate linking
  for (const entity of entities) {
    const name = typeof entity === 'string' ? entity : entity.name;
    alreadyLinked.add(name.toLowerCase());
  }

  // Get current note name if provided (to avoid self-links)
  const currentNoteName = notePath
    ? notePath.replace(/\.md$/, '').split('/').pop()?.toLowerCase()
    : null;

  // Step 4: Filter implicit matches that don't conflict with existing links
  const newImplicitMatches = implicitMatches.filter(match => {
    const normalized = match.text.toLowerCase();

    // Skip if already linked as known entity
    if (alreadyLinked.has(normalized)) return false;

    // Skip self-links
    if (currentNoteName && normalized === currentNoteName) return false;

    return true;
  });

  if (newImplicitMatches.length === 0) {
    return result;
  }

  // Step 4b: Filter overlapping matches (defense-in-depth)
  const nonOverlapping: typeof newImplicitMatches = [];
  for (const match of newImplicitMatches) {
    const overlaps = nonOverlapping.some(
      existing =>
        (match.start >= existing.start && match.start < existing.end) ||
        (match.end > existing.start && match.end <= existing.end) ||
        (match.start <= existing.start && match.end >= existing.end)
    );
    if (!overlaps) {
      nonOverlapping.push(match);
    }
  }

  if (nonOverlapping.length === 0) {
    return result;
  }

  // Step 5: Apply implicit wikilinks (process from end to preserve positions)
  let processedContent = result.content;
  const implicitEntities: string[] = [];

  // Process from end to start
  for (let i = nonOverlapping.length - 1; i >= 0; i--) {
    const match = nonOverlapping[i];

    // For quoted terms, we replace "Term" with [[Term]]
    // For other patterns, we replace Term with [[Term]]
    let wikilink: string;
    let replaceStart: number;
    let replaceEnd: number;

    if (match.pattern === 'quoted-terms') {
      // Replace "Term" with [[Term]] (remove quotes)
      wikilink = `[[${match.text}]]`;
      replaceStart = match.start;
      replaceEnd = match.end;
    } else {
      // Replace Term with [[Term]]
      wikilink = `[[${match.text}]]`;
      replaceStart = match.start;
      replaceEnd = match.end;
    }

    processedContent =
      processedContent.slice(0, replaceStart) +
      wikilink +
      processedContent.slice(replaceEnd);

    if (!implicitEntities.includes(match.text)) {
      implicitEntities.push(match.text);
    }
  }

  return {
    content: processedContent,
    linksAdded: result.linksAdded + nonOverlapping.length,
    linkedEntities: result.linkedEntities,
    implicitEntities,
  };
}
