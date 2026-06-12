/**
 * Search structure-contract characterisation tests (arch-review S6 Part A,
 * written BEFORE the search-stack extraction).
 *
 * Structure pins, not score pins (council R11): FTS-only mode (no embeddings
 * index → deterministic BM25 + entity merge), assertions on field shape,
 * channel presence, consumer-mode differences, sandwich-ordering property,
 * and exact-title boost — never on raw score values.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  connectTestClient,
  createTestServer,
  type TestClient,
  type TestServerContext,
} from '../helpers/createTestServer.js';
import { storeMemory } from '../../../src/core/write/memory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');

let context: TestServerContext;
let client: TestClient;

beforeAll(async () => {
  context = await createTestServer(FIXTURES_PATH);
  client = connectTestClient(context.server);

  if (context.stateDb) {
    storeMemory(context.stateDb, {
      key: 'search-contract-fact',
      value: 'Acme Corp acquired the search contract pilot',
      type: 'fact',
      confidence: 0.9,
    });
    storeMemory(context.stateDb, {
      key: 'search-contract-summary',
      value: 'Summary memory about the Acme search contract pilot',
      type: 'summary',
      confidence: 0.9,
    });
  }
});

const search = async (args: Record<string, unknown>) => {
  const result = await client.callTool('search', args);
  return JSON.parse(result.content[0].text);
};

describe('search content branch — structure contract (FTS-only)', () => {
  it('uses method fts5 when no embeddings index exists', async () => {
    const data = await search({ query: 'Acme', limit: 5 });
    expect(data.method).toBe('fts5');
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.total_results).toBeGreaterThan(0);
  });

  it('exact-title query ranks that note first (title boost)', async () => {
    const data = await search({ query: 'Acme Corp', limit: 5, consumer: 'human' });
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0].title).toBe('Acme Corp');
  });

  it('consumer llm strips internal scoring fields; human keeps channel flags', async () => {
    const llm = await search({ query: 'Acme', limit: 5, consumer: 'llm' });
    for (const r of llm.results) {
      expect(r).not.toHaveProperty('rrf_score');
      expect(r).not.toHaveProperty('in_fts5');
      expect(r).not.toHaveProperty('in_entity');
      expect(r).not.toHaveProperty('graph_boost');
      expect(r).not.toHaveProperty('_combined_score');
    }

    const human = await search({ query: 'Acme', limit: 5, consumer: 'human' });
    const hasChannelFlag = human.results.some(
      (r: Record<string, unknown>) => 'in_fts5' in r || 'in_entity' in r,
    );
    expect(hasChannelFlag).toBe(true);
  });

  it('sandwich ordering: llm order is a permutation of human order with best first, runner-up last', async () => {
    const human = await search({ query: 'note', limit: 8, consumer: 'human' });
    const llm = await search({ query: 'note', limit: 8, consumer: 'llm' });

    const humanPaths = human.results.map((r: { path: string }) => r.path);
    const llmPaths = llm.results.map((r: { path: string }) => r.path);

    expect([...llmPaths].sort()).toEqual([...humanPaths].sort());
    if (humanPaths.length >= 3) {
      // U-shape: rank-1 stays at position 1, rank-2 moves to the final slot
      expect(llmPaths[0]).toBe(humanPaths[0]);
      expect(llmPaths[llmPaths.length - 1]).toBe(humanPaths[1]);
    }
  });

  it('memories channel returns scored memories, fact outranking summary at equal confidence', async () => {
    const data = await search({ query: 'search contract pilot', limit: 5 });
    expect(Array.isArray(data.memories)).toBe(true);
    expect(data.memories.length).toBeGreaterThanOrEqual(2);
    const keys = data.memories.map((m: { key?: string; value: string; type: string }) => m.type);
    expect(keys.indexOf('fact')).toBeLessThan(keys.indexOf('summary'));
    // memory entries carry the contract fields
    expect(data.memories[0]).toHaveProperty('value');
    expect(data.memories[0]).toHaveProperty('type');
  });

  it('result entries carry the decision-surface shape (path, title) and llm entries may carry snippets', async () => {
    const data = await search({ query: 'Acme', limit: 3 });
    for (const r of data.results) {
      expect(typeof r.path).toBe('string');
      expect(typeof r.title).toBe('string');
    }
  });
});

describe('search non-content branches — contract', () => {
  it('date window branch returns total_matches/returned/notes shape', async () => {
    const data = await search({ modified_after: '2000-01-01', limit: 3 });
    expect(data).toHaveProperty('total_matches');
    expect(data).toHaveProperty('returned');
    expect(Array.isArray(data.notes)).toBe(true);
  });

  it('no query and no date filters → exact guidance error', async () => {
    const data = await search({});
    expect(data.error).toBe(
      'Provide a query or date filters (modified_after, modified_before). For structural enumeration use find_notes.',
    );
  });

  it('action=similar without path → error with example', async () => {
    const data = await search({ action: 'similar' });
    expect(data.error).toBe('action=similar requires path.');
    expect(data.example).toEqual({ action: 'similar', path: 'projects/alpha.md' });
  });

  it('action=similar with unknown note → not-found error with hint', async () => {
    const data = await search({ action: 'similar', path: 'ghost/none.md' });
    expect(data.error).toBe('Note not found: ghost/none.md');
    expect(data.hint).toContain('full relative path');
  });

  it('action=similar on a real note → bm25 method in FTS-only mode', async () => {
    const data = await search({ action: 'similar', path: 'Acme Corp.md', limit: 3 });
    expect(data.method).toBe('bm25');
    expect(data.source).toBe('Acme Corp.md');
    expect(Array.isArray(data.similar)).toBe(true);
  });
});
