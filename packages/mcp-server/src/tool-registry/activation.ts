import type { ToolCategory, ToolTier } from '../config.js';
import {
  getSemanticActivations,
  getToolRoutingMode,
  hasToolRouting,
  type SemanticActivation,
} from '../core/read/toolRouting.js';

export interface ActivationSignal {
  category: ToolCategory;
  tier: ToolTier;
}

const ACTIVATION_PATTERNS: Array<{ category: ToolCategory; tier: ToolTier; patterns: RegExp[] }> = [
  {
    category: 'memory',
    tier: 1,
    patterns: [/\b(remember|recall|forget|memory|memories|preference|setting|store|stored|brief(ing)?|session context|note to self|what do you know)\b/i],
  },
  {
    category: 'graph',
    tier: 2,
    patterns: [/\b(backlinks?|forward links?|connections?|link path|paths?|hubs?|orphans?|dead ends?|clusters?|bridges?)\b/i],
  },
  {
    category: 'wikilinks',
    tier: 2,
    patterns: [/\b(wikilinks?|link suggestions?|stubs?|unlinked mentions?|aliases?)\b/i],
  },
  {
    category: 'corrections',
    tier: 2,
    patterns: [/\b(corrections?|wrong links?|bad links?|mistakes?|fix(es|ing)?|errors?)\b/i],
  },
  {
    category: 'temporal',
    tier: 2,
    patterns: [/\b(history|timeline|timelines|evolution|stale notes?|around date|weekly review|monthly review|quarterly review)\b/i],
  },
  {
    category: 'diagnostics',
    tier: 2,
    patterns: [/\b(health|doctor|diagnostics?|status|config|configuration|pipeline|refresh index|reindex|logs?|insights?|intelligence|analyze note|quality score|audit|staleness|growth trends?)\b/i],
  },
  {
    category: 'schema',
    tier: 3,
    patterns: [/\b(schema|schemas|frontmatter|metadata|conventions?|rename field|rename tag|migrate|folder structure|folder tree|note counts)\b/i],
  },
  {
    category: 'note-ops',
    tier: 3,
    patterns: [/\b(create note|delete note|move note|rename note|merge entit(y|ies)|merge notes?|deduplicate|also known as|aka|nickname)\b/i],
  },
];

const MAX_QUERY_CONTEXT_LENGTH = 500;
const QUERY_CONTEXT_FIELDS = ['query', 'focus', 'analysis', 'entity', 'heading', 'field', 'date', 'concept'] as const;

export function getPatternSignals(raw: string): ActivationSignal[] {
  if (!raw) return [];
  return ACTIVATION_PATTERNS
    .filter(({ patterns }) => patterns.some((pattern) => pattern.test(raw)))
    .map(({ category, tier }) => ({ category, tier }));
}

export function unionSignalsByCategory(signals: ActivationSignal[]): ActivationSignal[] {
  const best = new Map<ToolCategory, ToolTier>();
  for (const { category, tier } of signals) {
    const existing = best.get(category);
    if (!existing || tier > existing) best.set(category, tier);
  }
  return Array.from(best.entries()).map(([category, tier]) => ({ category, tier }));
}

export async function getActivationSignals(
  toolName: string,
  params: unknown,
  searchMethod?: string,
  isFullToolset: boolean = false,
): Promise<ActivationSignal[]> {
  const isBriefAction = toolName === 'memory' && (params as Record<string, unknown>)?.action === 'brief';
  if (toolName !== 'search' && toolName !== 'brief' && !isBriefAction) return [];
  if (!params || typeof params !== 'object') return [];

  const raw = [
    typeof (params as Record<string, unknown>).query === 'string' ? (params as Record<string, string>).query : '',
    typeof (params as Record<string, unknown>).focus === 'string' ? (params as Record<string, string>).focus : '',
  ].filter(Boolean).join(' ');

  if (!raw) return [];

  const routingMode = getToolRoutingMode(isFullToolset);
  const patternSignals = routingMode !== 'semantic' ? getPatternSignals(raw) : [];

  let semanticSignals: SemanticActivation[] = [];
  if (
    routingMode !== 'pattern' &&
    searchMethod === 'hybrid' &&
    hasToolRouting()
  ) {
    semanticSignals = await getSemanticActivations(raw);
  }

  if (routingMode === 'semantic' && searchMethod !== 'hybrid') {
    return getPatternSignals(raw);
  }

  return unionSignalsByCategory([...patternSignals, ...semanticSignals]);
}

export function extractSearchMethod(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const content = (result as { content?: unknown[] }).content;
  if (!Array.isArray(content) || content.length === 0) return undefined;
  const first = content[0] as { type?: string; text?: string };
  if (first?.type !== 'text' || typeof first.text !== 'string') return undefined;
  try {
    const parsed = JSON.parse(first.text);
    if (typeof parsed.method === 'string') return parsed.method;
  } catch {
    // Not JSON or no method field.
  }
  return undefined;
}

export function extractQueryContext(params: unknown): string | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const p = params as Record<string, unknown>;
  const parts: string[] = [];
  for (const field of QUERY_CONTEXT_FIELDS) {
    const value = p[field];
    if (typeof value === 'string' && value.trim()) {
      parts.push(value.trim());
    }
  }
  if (parts.length === 0) return undefined;
  const joined = parts.join(' | ').replace(/\s+/g, ' ');
  return joined.length > MAX_QUERY_CONTEXT_LENGTH
    ? joined.slice(0, MAX_QUERY_CONTEXT_LENGTH)
    : joined;
}
