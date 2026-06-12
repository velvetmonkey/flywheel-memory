/**
 * Hybrid FTS+semantic RRF merge-seam pin (arch-review S6, council residual).
 *
 * The hybrid branch of `search` is golden-blind in FTS-only mode — no
 * existing test exercises the RRF merge of FTS5 × semantic × entity
 * channels. This suite injects a controlled semantic channel (module mock
 * keeps the REAL reciprocalRankFusion and the real merge code; only
 * hasEmbeddingsIndex/semanticSearch are stubbed) and pins the seam BEFORE
 * S6 relocates it:
 *  - method flips to 'hybrid';
 *  - semantic-only hits enter the result set (in_semantic, not in_fts5);
 *  - multi-channel presence outranks single-channel (RRF property);
 *  - exact-title boost still applies;
 *  - a semantic-channel throw falls back to method 'fts5'.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url';

vi.mock('../../../src/core/read/embeddings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/core/read/embeddings.js')>();
  return {
    ...actual,
    hasEmbeddingsIndex: vi.fn(() => mockState.hasIndex),
    semanticSearch: vi.fn(async () => {
      if (mockState.throwOnSearch) throw new Error('simulated semantic failure');
      return mockState.semanticResults;
    }),
    hasEntityEmbeddingsIndex: vi.fn(() => false),
    embedTextCached: vi.fn(async () => {
      throw new Error('no model in seam test');
    }),
  };
});

const mockState = {
  hasIndex: true,
  throwOnSearch: false,
  semanticResults: [] as Array<{ path: string; title: string; similarity: number }>,
};

import {
  connectTestClient,
  createTestServer,
  type TestClient,
  type TestServerContext,
} from '../helpers/createTestServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');

let context: TestServerContext;
let client: TestClient;

beforeAll(async () => {
  context = await createTestServer(FIXTURES_PATH);
  client = connectTestClient(context.server);
});

const search = async (args: Record<string, unknown>) => {
  const result = await client.callTool('search', args);
  return JSON.parse(result.content[0].text);
};

describe('hybrid RRF merge seam', () => {
  it('semantic-only hits enter the merged set with in_semantic provenance', async () => {
    mockState.hasIndex = true;
    mockState.throwOnSearch = false;
    // 'Another Note.md' exists in fixtures but should not FTS-match 'Acme'
    mockState.semanticResults = [
      { path: 'Another Note.md', title: 'Another Note', similarity: 0.9 },
    ];

    const data = await search({ query: 'Acme', limit: 10, consumer: 'human' });
    expect(data.method).toBe('hybrid');

    const semanticOnly = data.results.find((r: any) => r.path === 'Another Note.md');
    expect(semanticOnly, 'semantic-only hit missing from merged results').toBeDefined();
    expect(semanticOnly.in_semantic).toBe(true);
    expect(semanticOnly.in_fts5).toBe(false);
  });

  it('multi-channel presence outranks single-channel at equal title relevance (RRF property)', async () => {
    mockState.hasIndex = true;
    mockState.throwOnSearch = false;
    // Boost a note that ALSO matches FTS for the query so it sits in two channels
    mockState.semanticResults = [
      { path: 'Acme Corp.md', title: 'Acme Corp', similarity: 0.95 },
      { path: 'Another Note.md', title: 'Another Note', similarity: 0.9 },
    ];

    const data = await search({ query: 'Acme', limit: 10, consumer: 'human' });
    const both = data.results.find((r: any) => r.path === 'Acme Corp.md');
    const semOnly = data.results.find((r: any) => r.path === 'Another Note.md');
    expect(both).toBeDefined();
    expect(semOnly).toBeDefined();
    expect(both.in_fts5).toBe(true);
    expect(both.in_semantic).toBe(true);
    expect(both.rrf_score).toBeGreaterThan(semOnly.rrf_score);
    // and ordering reflects it
    const idxBoth = data.results.findIndex((r: any) => r.path === 'Acme Corp.md');
    const idxSem = data.results.findIndex((r: any) => r.path === 'Another Note.md');
    expect(idxBoth).toBeLessThan(idxSem);
  });

  it('exact-title boost applies inside the hybrid merge', async () => {
    mockState.hasIndex = true;
    mockState.throwOnSearch = false;
    mockState.semanticResults = [
      { path: 'Another Note.md', title: 'Another Note', similarity: 0.99 },
    ];

    const data = await search({ query: 'Acme Corp', limit: 10, consumer: 'human' });
    expect(data.method).toBe('hybrid');
    expect(data.results[0].title).toBe('Acme Corp');
  });

  it('semantic-channel failure falls back to method fts5 (catch seam)', async () => {
    mockState.hasIndex = true;
    mockState.throwOnSearch = true;

    const data = await search({ query: 'Acme', limit: 5, consumer: 'human' });
    expect(data.method).toBe('fts5');
    expect(data.results.length).toBeGreaterThan(0);
  });

  it('hasEmbeddingsIndex=false keeps the non-hybrid path entirely', async () => {
    mockState.hasIndex = false;
    mockState.throwOnSearch = false;

    const data = await search({ query: 'Acme', limit: 5 });
    expect(data.method).toBe('fts5');
  });
});
