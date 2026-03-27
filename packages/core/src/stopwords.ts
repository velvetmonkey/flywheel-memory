/**
 * Canonical English stopwords for search tokenization
 *
 * Single source of truth — imported by flywheel-memory (stemmer, similarity,
 * wikilink suggestions). Union of all previously separate stopword sets.
 *
 * Categories:
 * - Function words (articles, pronouns, prepositions, conjunctions)
 * - Common verbs with inflections (go/went/gone, make/made/making)
 * - Time words (today, daily, week, month)
 * - Generic/filler words (thing, stuff, something)
 * - Domain-specific PKM terms (vault, wikilink, frontmatter)
 */
export const STOPWORDS_EN = new Set([
  'a', 'about', 'above', 'accordingly', 'actual', 'actually', 'add', 'added',
  'adding', 'additionally', 'adds', 'after', 'afternoon', 'again', 'all', 'almost',
  'already', 'also', 'alternatively', 'although', 'always', 'an', 'and', 'annually',
  'another', 'any', 'anyone', 'anything', 'anyway', 'anywhere', 'archive', 'are',
  'as', 'at', 'back', 'bad', 'basically', 'be', 'because', 'been',
  'before', 'began', 'begin', 'beginning', 'begins', 'begun', 'being', 'below',
  'besides', 'best', 'better', 'between', 'big', 'both', 'bring', 'bringing',
  'brings', 'brought', 'build', 'building', 'builds', 'built', 'but', 'by',
  'call', 'called', 'calling', 'calls', 'came', 'can', 'case', 'cases',
  'certainly', 'change', 'changed', 'changes', 'changing', 'close', 'closed', 'closes',
  'closing', 'come', 'coming', 'complete', 'completed', 'completes', 'completing', 'continue',
  'continued', 'continues', 'continuing', 'could', 'create', 'created', 'creates', 'creating',
  'currently', 'daily', 'date', 'day', 'days', 'definitely', 'did', 'different',
  'do', 'does', 'doing', 'done', 'draft', 'during', 'each', 'earlier',
  'easily', 'either', 'empty', 'end', 'ended', 'ending', 'ends', 'essentially',
  'even', 'evening', 'ever', 'every', 'everyone', 'everything', 'everywhere', 'example',
  'examples', 'except', 'false', 'feel', 'feeling', 'feels', 'felt', 'few',
  'file', 'files', 'find', 'finding', 'finds', 'fine', 'finish', 'finished',
  'finishes', 'finishing', 'first', 'fix', 'fixed', 'fixes', 'fixing', 'folder',
  'folders', 'follow', 'followed', 'following', 'follows', 'for', 'found', 'from',
  'frontmatter', 'full', 'further', 'furthermore', 'gave', 'get', 'gets', 'getting',
  'give', 'given', 'gives', 'giving', 'go', 'going', 'gone', 'good',
  'got', 'gotten', 'great', 'had', 'happen', 'happened', 'happening', 'happens',
  'has', 'have', 'he', 'heading', 'headings', 'held', 'help', 'helped',
  'helping', 'helps', 'hence', 'her', 'here', 'high', 'him', 'his',
  'hold', 'holding', 'holds', 'hour', 'how', 'however', 'i', 'if',
  'important', 'in', 'inbox', 'include', 'included', 'includes', 'including', 'info',
  'information', 'instead', 'into', 'is', 'issue', 'issues', 'it', 'item',
  'items', 'its', 'just', 'keep', 'keeping', 'keeps', 'kept', 'knew',
  'know', 'knowing', 'known', 'knows', 'large', 'last', 'later', 'leave',
  'leaves', 'leaving', 'left', 'length', 'level', 'levels', 'like', 'likely',
  'line', 'lines', 'link', 'links', 'list', 'lists', 'little', 'long',
  'look', 'looked', 'looking', 'looks', 'lot', 'lots', 'low', 'made',
  'main', 'make', 'makes', 'making', 'many', 'markdown', 'may', 'maybe',
  'me', 'meanwhile', 'message', 'messages', 'might', 'minute', 'mode', 'modes',
  'month', 'monthly', 'months', 'more', 'moreover', 'morning', 'most', 'move',
  'moved', 'moves', 'moving', 'much', 'must', 'my', 'name', 'names',
  'nearly', 'need', 'neither', 'never', 'nevertheless', 'new', 'next', 'nice',
  'night', 'no', 'nonetheless', 'noone', 'not', 'note', 'notes', 'nothing',
  'now', 'nowhere', 'number', 'numbers', 'object', 'objects', 'of', 'off',
  'often', 'okay', 'old', 'on', 'once', 'one', 'only', 'open',
  'opened', 'opening', 'opens', 'option', 'options', 'or', 'other', 'otherwise',
  'our', 'out', 'over', 'own', 'page', 'pages', 'part', 'particularly',
  'path', 'paths', 'pending', 'people', 'perhaps', 'play', 'played', 'playing',
  'plays', 'point', 'points', 'possibly', 'pretty', 'primarily', 'probably', 'problem',
  'problems', 'put', 'puts', 'putting', 'quickly', 'quite', 'ran', 'rarely',
  'rather', 'read', 'reading', 'reads', 'real', 'really', 'receive', 'received',
  'receives', 'receiving', 'recently', 'release', 'released', 'releases', 'releasing', 'remove',
  'removed', 'removes', 'removing', 'result', 'results', 'right', 'run', 'running',
  'runs', 'same', 'say', 'second', 'section', 'sections', 'see', 'seem',
  'seemed', 'seeming', 'seems', 'send', 'sending', 'sends', 'sent', 'set',
  'sets', 'setting', 'several', 'shall', 'she', 'short', 'should', 'show',
  'showed', 'showing', 'shown', 'shows', 'similar', 'simply', 'since', 'size',
  'slowly', 'small', 'so', 'some', 'someone', 'something', 'sometimes', 'somewhere',
  'soon', 'specifically', 'start', 'started', 'starting', 'starts', 'still', 'stop',
  'stopped', 'stopping', 'stops', 'string', 'strings', 'stuff', 'such', 'take',
  'taken', 'takes', 'taking', 'task', 'tasks', 'tell', 'telling', 'tells',
  'template', 'templates', 'test', 'tested', 'testing', 'tests', 'text', 'than',
  'that', 'the', 'their', 'them', 'then', 'there', 'therefore', 'these',
  'they', 'thing', 'things', 'think', 'thinking', 'thinks', 'third', 'this',
  'those', 'though', 'thought', 'through', 'thus', 'time', 'to', 'today',
  'todo', 'todos', 'told', 'tomorrow', 'too', 'took', 'tried', 'tries',
  'true', 'truly', 'try', 'trying', 'turn', 'turned', 'turning', 'turns',
  'two', 'type', 'types', 'under', 'unless', 'unlikely', 'until', 'up',
  'update', 'updated', 'updates', 'updating', 'us', 'use', 'used', 'uses',
  'using', 'usually', 'value', 'values', 'various', 'vault', 'very', 'want',
  'wanted', 'wanting', 'wants', 'was', 'way', 'we', 'week', 'weekly',
  'weeks', 'well', 'went', 'were', 'what', 'when', 'where', 'whether',
  'which', 'while', 'who', 'whole', 'whom', 'why', 'wikilink', 'wikilinks',
  'will', 'with', 'work', 'worked', 'working', 'works', 'worse', 'worst',
  'would', 'write', 'writes', 'writing', 'written', 'wrong', 'wrote', 'year',
  'yearly', 'years', 'yesterday', 'yet', 'you', 'your',
]);

/**
 * Check if a word is a stopword
 */
export function isStopword(word: string): boolean {
  return STOPWORDS_EN.has(word.toLowerCase());
}
