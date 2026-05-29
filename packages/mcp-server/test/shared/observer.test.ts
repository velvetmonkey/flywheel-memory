import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  summariseInput,
  summariseResult,
  emitObservation,
  extractObservedHits,
  extractObservedDetails,
} from '../../src/core/shared/observer.js';

/** Build an MCP-style content array from one JSON-or-text block. */
function content(text: string) {
  return [{ type: 'text', text }];
}

describe('summariseResult', () => {
  it('summarises a search result as "N results" + leading titles', () => {
    const c = content(
      JSON.stringify({ results: [{ title: 'Kuramoto' }, { title: 'Sync' }, { title: 'Third' }] }),
    );
    const s = summariseResult('search', c);
    expect(s).toContain('3 results');
    expect(s).toContain('Kuramoto');
    expect(s).toContain('Sync');
    // only the first two titles, not the third
    expect(s).not.toContain('Third');
  });

  it('prefers total_results over the truncated page length', () => {
    const c = content(JSON.stringify({ total_results: 22, results: [{ title: 'First' }, { title: 'Second' }] }));
    const s = summariseResult('search', c);
    expect(s).toContain('22 results');
    expect(s).toContain('First');
  });

  it('parses a large (>20k char) search result without corrupting the JSON', () => {
    // Regression: slicing the text before JSON.parse truncated big results
    // into invalid JSON and fell back to a raw dump. Must still summarise.
    const results = Array.from({ length: 40 }, (_, i) => ({
      title: `Note ${i}`,
      snippet: 'x'.repeat(800),
    }));
    const big = JSON.stringify({ total_results: 40, results });
    expect(big.length).toBeGreaterThan(20000);
    const s = summariseResult('search', content(big));
    expect(s).toContain('40 results');
    expect(s).toContain('Note 0');
    expect(s!.length).toBeLessThanOrEqual(280);
  });

  it('singularises one result', () => {
    const s = summariseResult('search', content(JSON.stringify({ results: [{ title: 'Solo' }] })));
    expect(s).toContain('1 result');
    expect(s).not.toContain('1 results');
  });

  it('summarises a read result with path + word count', () => {
    const s = summariseResult('read', content(JSON.stringify({ path: 'tech/x.md', word_count: 412 })));
    expect(s).toBe('tech/x.md (412 words)');
  });

  it('summarises a memory result with action + key', () => {
    const s = summariseResult('memory', content(JSON.stringify({ action: 'store', key: 'sprint' })));
    expect(s).toContain('store');
    expect(s).toContain('sprint');
  });

  it('summarises graph/link/insights by item count', () => {
    const s = summariseResult('link', content(JSON.stringify({ suggestions: [1, 2, 3, 4] })));
    expect(s).toBe('4 link items');
  });

  it('falls back to a truncated text snippet for unknown shapes', () => {
    const s = summariseResult('doctor', content('plain non-json health output line'));
    expect(s).toContain('plain non-json health output');
  });

  it('caps very long summaries', () => {
    const s = summariseResult('doctor', content('x'.repeat(5000)));
    expect(s!.length).toBeLessThanOrEqual(280);
    expect(s!.endsWith('…')).toBe(true);
  });

  it('returns undefined for empty content', () => {
    expect(summariseResult('search', [])).toBeUndefined();
    expect(summariseResult('search', undefined)).toBeUndefined();
  });
});

describe('summariseInput', () => {
  it('surfaces query field', () => {
    expect(summariseInput({ query: 'kuramoto sync' })).toBe('query=kuramoto sync');
  });

  it('shows array fields as a count', () => {
    expect(summariseInput({ paths: ['a.md', 'b.md'] })).toBeUndefined(); // paths not an INPUT_FIELD
    expect(summariseInput({ path: 'a.md' })).toBe('path=a.md');
  });

  it('returns undefined when no recognised fields', () => {
    expect(summariseInput({ unrelated: true })).toBeUndefined();
    expect(summariseInput(undefined)).toBeUndefined();
    expect(summariseInput('nope')).toBeUndefined();
  });

  it('caps at three fields', () => {
    const s = summariseInput({ query: 'q', focus: 'f', analysis: 'a', entity: 'e' });
    expect(s!.split(' ').length).toBeLessThanOrEqual(3);
  });
});

describe('emitObservation', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    delete process.env.FLYWHEEL_OBSERVER_URL;
    delete process.env.FLYWHEEL_OBSERVER_TOKEN;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.FLYWHEEL_OBSERVER_URL;
    delete process.env.FLYWHEEL_OBSERVER_TOKEN;
    vi.restoreAllMocks();
  });

  it('no-ops when FLYWHEEL_OBSERVER_URL is unset', () => {
    const spy = vi.fn();
    globalThis.fetch = spy as any;
    emitObservation({ tool: 'search' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('POSTs to the observer url when set', () => {
    process.env.FLYWHEEL_OBSERVER_URL = 'http://localhost:3124/mcp-observed';
    const spy = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = spy as any;
    emitObservation({ tool: 'search', input_summary: 'q=x', result_chars: 10 });
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('http://localhost:3124/mcp-observed');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).tool).toBe('search');
  });

  it('attaches a bearer token when FLYWHEEL_OBSERVER_TOKEN is set', () => {
    process.env.FLYWHEEL_OBSERVER_URL = 'http://localhost:3124/mcp-observed';
    process.env.FLYWHEEL_OBSERVER_TOKEN = 'secret';
    const spy = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = spy as any;
    emitObservation({ tool: 'read' });
    expect(spy.mock.calls[0][1].headers['authorization']).toBe('Bearer secret');
  });

  it('swallows a rejected fetch (never throws)', async () => {
    process.env.FLYWHEEL_OBSERVER_URL = 'http://localhost:3124/mcp-observed';
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connrefused')) as any;
    expect(() => emitObservation({ tool: 'search' })).not.toThrow();
    // let the rejected microtask settle — must not become an unhandled rejection
    await new Promise((r) => setTimeout(r, 5));
  });

  it('swallows a synchronous fetch throw', () => {
    process.env.FLYWHEEL_OBSERVER_URL = 'http://localhost:3124/mcp-observed';
    globalThis.fetch = vi.fn(() => {
      throw new Error('boom');
    }) as any;
    expect(() => emitObservation({ tool: 'search' })).not.toThrow();
  });

  it('serializes near_miss candidates in the POST body', () => {
    process.env.FLYWHEEL_OBSERVER_URL = 'http://localhost:3124/mcp-observed';
    const spy = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = spy as any;
    emitObservation({
      tool: 'search',
      results: [{ path: 'a.md', score: 0.9, method: 'hybrid' }],
      near_miss: [{ path: 'b.md', score: 0.4, method: 'hybrid-near-miss' }],
    });
    const body = JSON.parse(spy.mock.calls[0][1].body);
    expect(body.results).toHaveLength(1);
    expect(body.near_miss).toHaveLength(1);
    expect(body.near_miss[0].path).toBe('b.md');
    expect(body.near_miss[0].method).toBe('hybrid-near-miss');
  });
});

describe('extractObservedHits (shared by pulled results + near-miss)', () => {
  afterEach(() => { delete process.env.FLYWHEEL_OBSERVER_URL; });

  it('returns undefined when the observer is not configured', () => {
    delete process.env.FLYWHEEL_OBSERVER_URL;
    expect(extractObservedHits([{ path: 'a.md', rrf_score: 0.5 }], 'hybrid')).toBeUndefined();
  });

  it('maps ranked rows → ScoredHit with score + method + index flags', () => {
    process.env.FLYWHEEL_OBSERVER_URL = 'http://localhost:3124/mcp-observed';
    const hits = extractObservedHits(
      [{ path: 'a.md', title: 'A', rrf_score: 0.5, in_fts5: true, in_semantic: true, backlink_count: 3 }],
      'hybrid-near-miss',
    );
    expect(hits).toBeDefined();
    expect(hits![0]).toMatchObject({
      path: 'a.md', title: 'A', score: 0.5, method: 'hybrid-near-miss',
      backlink_count: 3, in_fts5: true, in_semantic: true,
    });
  });

  it('caps at 8 hits (so a near-miss slice can never bloat the POST)', () => {
    process.env.FLYWHEEL_OBSERVER_URL = 'http://localhost:3124/mcp-observed';
    const rows = Array.from({ length: 20 }, (_, i) => ({ path: `${i}.md`, rrf_score: 1 - i / 20 }));
    const hits = extractObservedHits(rows, 'hybrid-near-miss');
    expect(hits!.length).toBe(8);
  });
});

describe('extractObservedDetails (non-search tools)', () => {
  beforeEach(() => { process.env.FLYWHEEL_OBSERVER_URL = 'http://localhost:3124/mcp-observed'; });
  afterEach(() => { delete process.env.FLYWHEEL_OBSERVER_URL; });

  const text = (o: unknown) => [{ type: 'text', text: JSON.stringify(o) }];

  it('read action=structure: heading OBJECTS become their .text, not "[object Object]"', () => {
    // Regression: structure returns sections[].heading = { text, level }.
    const hits = extractObservedDetails('read', text({
      sections: [
        { heading: { text: "Open", level: 3 } },
        { heading: { text: "Emerging", level: 3 } },
      ],
    }));
    expect(hits).toBeDefined();
    expect(hits!.map((h) => h.title)).toEqual(["Open", "Emerging"]);
    expect(hits!.every((h) => h.title !== "[object Object]")).toBe(true);
  });

  it('read action=sections: string headings + paths still work', () => {
    const hits = extractObservedDetails('read', text({
      sections: [{ path: "a.md", heading: "Background" }],
    }));
    expect(hits![0]).toMatchObject({ path: "a.md", title: "Background" });
  });

  it('no-ops when observer is unset', () => {
    delete process.env.FLYWHEEL_OBSERVER_URL;
    expect(extractObservedDetails('read', text({ sections: [{ heading: { text: "x" } }] }))).toBeUndefined();
  });
});
