/**
 * Retrieval observation side-channel.
 *
 * When FLYWHEEL_OBSERVER_URL is set, every tool call emits a compact
 * observation (tool, input summary, result summary, char count, latency)
 * to that URL via a fire-and-forget POST. This lets an external surface
 * (the Mega Monkey cockpit) show what the vault is being asked and what
 * comes back — WITHOUT putting the observer in the vault's data path.
 *
 * Invariants (load-bearing — see Stage 1b roundtable):
 *   - If FLYWHEEL_OBSERVER_URL is unset, every export here is a no-op.
 *     flywheel-memory behaves exactly as a standalone server.
 *   - emitObservation NEVER awaits the fetch and NEVER throws. A slow or
 *     dead observer cannot block, error, or back-pressure a tool call.
 *   - The summarisers only scan capped slices of the result — no
 *     full-payload retention, negligible cost.
 */

const MAX_RESULT_SUMMARY = 280;
const MAX_INPUT_SUMMARY = 280;
const OBSERVER_TIMEOUT_MS = 1500;

/** Fields we surface as the "what was asked" summary, in priority order. */
const INPUT_FIELDS = [
  'query',
  'focus',
  'analysis',
  'entity',
  'heading',
  'path',
  'note_path',
  'source',
  'target',
  'field',
  'date',
  'concept',
  'key',
  'action',
] as const;

/** One scored hit from a search-family tool, captured BEFORE the llm strip. */
export interface ScoredHit {
  path: string;
  title?: string;
  score: number | null;        // _combined_score ?? rrf_score ?? null (null = unscored branch)
  method?: string;             // hybrid | fts5 | entity | ...
  backlink_count?: number;
  in_fts5?: boolean;
  in_semantic?: boolean;
  in_entity?: boolean;
}

export interface Observation {
  tool: string;
  input_summary?: string;
  result_summary?: string;
  result_chars?: number;
  is_error?: boolean;
  duration_ms?: number;
  session_id?: string;
  results?: ScoredHit[];
  /**
   * "Considered but discarded" candidates: items the ranker scored just BELOW
   * the returned cutoff (ranks limit+1..limit+K). Same ScoredHit shape as
   * `results`. Lets the cockpit show pulled-vs-near-miss — the retrieval
   * boundary — without changing what the LLM receives. Hybrid search only.
   */
  near_miss?: ScoredHit[];
}

const MAX_OBSERVED_HITS = 8;
const MAX_OBSERVED_BYTES = 8_000; // keep the side-channel POST well under the engine's 16KB cap

/**
 * In-process bridge from a tool's returned result object to the scored hits a
 * search-family handler captured BEFORE applying the llm-consumer strip (which
 * deletes rrf_score/_combined_score). The observer wrapper reads this by result
 * identity. A WeakMap so entries vanish when the result is GC'd; it is never
 * serialized and never reaches the MCP client.
 */
export const observedHits = new WeakMap<object, ScoredHit[]>();

/**
 * Parallel bridge for the "considered but discarded" near-miss candidates
 * (ranks just below the returned cutoff). Same identity-keyed WeakMap pattern
 * as observedHits; read by the observer wrapper, never serialized to the client.
 */
export const observedNearMisses = new WeakMap<object, ScoredHit[]>();

/**
 * Map ranked result rows → a capped, size-guarded ScoredHit[]. Returns undefined
 * when no observer is configured (preserving the standalone no-op invariant) or
 * on any fault. Call this with the rows still in PRE-strip / relevance order.
 */
export function extractObservedHits(
  rows: Array<Record<string, unknown>>,
  method: string,
): ScoredHit[] | undefined {
  if (!process.env.FLYWHEEL_OBSERVER_URL || !Array.isArray(rows)) return undefined;
  try {
    let hits: ScoredHit[] = rows.slice(0, MAX_OBSERVED_HITS).map((r) => {
      const combined = typeof r._combined_score === 'number' ? (r._combined_score as number) : undefined;
      const rrf = typeof r.rrf_score === 'number' ? (r.rrf_score as number) : undefined;
      const score = combined ?? rrf ?? null;
      return {
        path: String(r.path ?? '').slice(0, 200),
        title: r.title ? String(r.title).slice(0, 200) : undefined,
        score: score == null ? null : Math.round(score * 1000) / 1000,
        method,
        backlink_count: typeof r.backlink_count === 'number' ? (r.backlink_count as number) : undefined,
        in_fts5: r.in_fts5 ? true : undefined,
        in_semantic: r.in_semantic ? true : undefined,
        in_entity: r.in_entity ? true : undefined,
      };
    });
    // Size guard — drop trailing hits rather than risk a 413 on the whole POST.
    while (hits.length > 1 && Buffer.byteLength(JSON.stringify(hits)) > MAX_OBSERVED_BYTES) {
      hits = hits.slice(0, -1);
    }
    return hits;
  } catch {
    return undefined;
  }
}

/** Join the text blocks of an MCP result into one string (capped scan). */
function joinContent(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    const b = block as { type?: string; text?: string };
    if (b?.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    if (parts.length >= 8) break; // cap — never walk an enormous result
  }
  return parts.join('\n');
}

function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

/**
 * Tool-aware one-line summary of a result. Best-effort: the leading text
 * block of most flywheel tools is JSON, so we try to read structured
 * shape first and fall back to a truncated text snippet.
 */
export function summariseResult(tool: string, content: unknown): string | undefined {
  const text = joinContent(content);
  if (!text) return undefined;

  // Parse the FULL text — slicing first would truncate large results into
  // invalid JSON. Skip the parse only for pathologically huge payloads.
  let parsed: any;
  if (text.length <= 2_000_000) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }

  if (parsed && typeof parsed === 'object') {
    switch (tool) {
      case 'search':
      case 'find_notes': {
        const results = parsed.results ?? parsed.notes ?? parsed.matches;
        if (Array.isArray(results)) {
          const count = parsed.total_results ?? parsed.total ?? results.length;
          const titles = results
            .slice(0, 2)
            .map((r: any) => r?.title ?? r?.path ?? r?.name)
            .filter(Boolean);
          const head = `${count} result${count === 1 ? '' : 's'}`;
          return truncate(titles.length ? `${head}: ${titles.join(', ')}` : head, MAX_RESULT_SUMMARY);
        }
        break;
      }
      case 'read': {
        const wc = parsed.word_count ?? parsed.words;
        const p = parsed.path ?? parsed.note_path ?? parsed.title;
        if (p) return truncate(wc != null ? `${p} (${wc} words)` : String(p), MAX_RESULT_SUMMARY);
        break;
      }
      case 'memory': {
        const bits = [parsed.action, parsed.key, parsed.count != null ? `${parsed.count} items` : undefined]
          .filter(Boolean)
          .join(' ');
        if (bits) return truncate(bits, MAX_RESULT_SUMMARY);
        break;
      }
      case 'graph':
      case 'link':
      case 'insights': {
        const arr = parsed.results ?? parsed.suggestions ?? parsed.links ?? parsed.nodes ?? parsed.items;
        if (Array.isArray(arr)) return truncate(`${arr.length} ${tool} items`, MAX_RESULT_SUMMARY);
        break;
      }
    }
  }

  return truncate(text, MAX_RESULT_SUMMARY);
}

/** One-line summary of the tool input from its params. */
export function summariseInput(params: unknown): string | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const p = params as Record<string, unknown>;
  const parts: string[] = [];
  for (const field of INPUT_FIELDS) {
    const v = p[field];
    if (typeof v === 'string' && v.trim()) parts.push(`${field}=${v.trim()}`);
    else if (Array.isArray(v) && v.length) parts.push(`${field}=[${v.length}]`);
    if (parts.length >= 3) break;
  }
  if (!parts.length) return undefined;
  return truncate(parts.join(' '), MAX_INPUT_SUMMARY);
}

const MAX_OBSERVED_DETAILS = 8;

/**
 * For non-search tools, extract meaningful detail line items from the result
 * content so the cockpit Retrieval panel can expand them the same way it
 * expands search hits. Uses the same ScoredHit shape; no method badges or
 * scores are set unless the tool naturally produces them.
 *
 * Called as a fallback in tool-registry when observedHits is empty — only
 * when FLYWHEEL_OBSERVER_URL is set (same standalone no-op invariant).
 */
export function extractObservedDetails(
  tool: string,
  content: unknown,
): ScoredHit[] | undefined {
  if (!process.env.FLYWHEEL_OBSERVER_URL) return undefined;
  const text = joinContent(content);
  if (!text || text.length > 2_000_000) return undefined;
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { return undefined; }
  if (!parsed || typeof parsed !== 'object') return undefined;

  try {
    switch (tool) {
      case 'read': {
        // action=sections → array of {path, heading, level, line}
        const sects = parsed.sections;
        if (Array.isArray(sects) && sects.length) {
          return sects.slice(0, MAX_OBSERVED_DETAILS).map((s: any) => ({
            path: String(s.path ?? '').slice(0, 200),
            title: s.heading ? String(s.heading).slice(0, 200) : undefined,
            score: null,
          }));
        }
        // action=structure or action=read → single note metadata
        const p = parsed.path ?? parsed.note_path;
        const t = parsed.title;
        const bc = typeof parsed.backlink_count === 'number' ? (parsed.backlink_count as number) : undefined;
        if (p || t) {
          return [{
            path: String(p ?? t ?? '').slice(0, 200),
            title: t ? String(t).slice(0, 200) : undefined,
            score: null,
            backlink_count: bc,
          }];
        }
        break;
      }
      case 'memory': {
        // action=search → results[]; action=list → memories[]
        const arr = parsed.results ?? parsed.memories;
        if (Array.isArray(arr) && arr.length) {
          return arr.slice(0, MAX_OBSERVED_DETAILS).map((m: any) => ({
            path: String(m.key ?? m.id ?? '').slice(0, 200),
            title: m.value ? truncate(String(m.value), 120) : undefined,
            score: typeof m.confidence === 'number' ? Math.round((m.confidence as number) * 1000) / 1000 : null,
          }));
        }
        // action=store/retrieve/read → single item
        const k = parsed.key;
        const v = parsed.value;
        if (k) {
          return [{
            path: String(k).slice(0, 200),
            title: v ? truncate(String(v), 120) : undefined,
            score: typeof parsed.confidence === 'number' ? Math.round((parsed.confidence as number) * 1000) / 1000 : null,
          }];
        }
        break;
      }
      case 'graph': {
        // get_backlinks → backlinks[] of {source, context}
        const bls = parsed.backlinks;
        if (Array.isArray(bls) && bls.length) {
          return bls.slice(0, MAX_OBSERVED_DETAILS).map((b: any) => ({
            path: String(b.source ?? '').slice(0, 200),
            title: b.context ? truncate(String(b.context), 100) : undefined,
            score: null,
          }));
        }
        // get_forward_links → forward_links[] of {target, alias, resolved_path}
        const fls = parsed.forward_links;
        if (Array.isArray(fls) && fls.length) {
          return fls.slice(0, MAX_OBSERVED_DETAILS).map((f: any) => ({
            path: String(f.resolved_path ?? f.target ?? '').slice(0, 200),
            title: (f.alias ?? f.target) ? String(f.alias ?? f.target).slice(0, 200) : undefined,
            score: null,
          }));
        }
        break;
      }
      case 'link': {
        // suggest_wikilinks → suggestions[] of {entity, target, alias}
        const suggs = parsed.suggestions;
        if (Array.isArray(suggs) && suggs.length) {
          return suggs.slice(0, MAX_OBSERVED_DETAILS).map((s: any) => ({
            path: String(s.target ?? s.entity ?? '').slice(0, 200),
            title: s.entity ? String(s.entity).slice(0, 200) : undefined,
            score: null,
          }));
        }
        // validate_links → broken[] of {source, target, suggestion}
        const broken = parsed.broken ?? parsed.targets;
        if (Array.isArray(broken) && broken.length) {
          return broken.slice(0, MAX_OBSERVED_DETAILS).map((b: any) => ({
            path: String(b.target ?? b.source ?? '').slice(0, 200),
            title: b.source ? String(b.source).slice(0, 200) : undefined,
            score: null,
          }));
        }
        break;
      }
      case 'insights': {
        // staleness/context → notes[] of {path, title}
        const notes = parsed.notes;
        if (Array.isArray(notes) && notes.length) {
          return notes.slice(0, MAX_OBSERVED_DETAILS).map((n: any) => ({
            path: String(n.path ?? '').slice(0, 200),
            title: n.title ? String(n.title).slice(0, 200) : undefined,
            score: null,
          }));
        }
        // evolution → current_state.{path, backlink_count}
        const cs = parsed.current_state;
        if (cs && (cs.path || cs.name)) {
          return [{
            path: String(cs.path ?? '').slice(0, 200),
            title: cs.name ? String(cs.name).slice(0, 200) : undefined,
            score: null,
            backlink_count: typeof cs.backlink_count === 'number' ? (cs.backlink_count as number) : undefined,
          }];
        }
        break;
      }
      case 'entity': {
        const p = parsed.path ?? parsed.note_path;
        const t = parsed.name ?? parsed.title;
        if (p || t) {
          return [{
            path: String(p ?? '').slice(0, 200),
            title: t ? String(t).slice(0, 200) : undefined,
            score: null,
            backlink_count: typeof parsed.backlink_count === 'number' ? (parsed.backlink_count as number) : undefined,
          }];
        }
        break;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Fire-and-forget POST the observation to FLYWHEEL_OBSERVER_URL.
 * No-op when the env var is unset. Never awaited, never throws.
 */
export function emitObservation(obs: Observation): void {
  const url = process.env.FLYWHEEL_OBSERVER_URL;
  if (!url) return;
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const token = process.env.FLYWHEEL_OBSERVER_TOKEN;
    if (token) headers['authorization'] = `Bearer ${token}`;
    void fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(obs),
      signal: AbortSignal.timeout(OBSERVER_TIMEOUT_MS),
    }).catch(() => {
      /* observer down/slow — drop silently, never affect the tool path */
    });
  } catch {
    /* synchronous fetch/JSON/abort error — swallow */
  }
}
