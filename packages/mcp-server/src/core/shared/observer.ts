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

export interface Observation {
  tool: string;
  input_summary?: string;
  result_summary?: string;
  result_chars?: number;
  is_error?: boolean;
  duration_ms?: number;
  session_id?: string;
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
