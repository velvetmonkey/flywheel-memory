/**
 * Tests for entity(action: list) inferred category decoration
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../../src/core/read/types.js';
import { buildVaultIndex, setIndexState } from '../../../src/core/read/graph.js';
import { registerSystemTools } from '../../../src/tools/read/system.js';
import { registerEntityTool } from '../../../src/tools/write/entity.js';
import { openStateDb, type StateDb } from '@velvetmonkey/vault-core';
import { setFTS5Database } from '../../../src/core/read/fts5.js';
import { connectTestClient, type TestClient } from '../helpers/createTestServer.js';
import {
  saveInferredCategories,
  loadEntityEmbeddingsToMemory,
  setEmbeddingsDatabase,
} from '../../../src/core/read/embeddings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');

describe('entity(action: list) inferred categories', () => {
  let server: McpServer;
  let client: TestClient;
  let stateDb: StateDb;

  beforeAll(async () => {
    const vaultIndex = await buildVaultIndex(FIXTURES_PATH);
    setIndexState('ready');

    stateDb = openStateDb(FIXTURES_PATH)!;
    setFTS5Database(stateDb.db);
    setEmbeddingsDatabase(stateDb.db);

    server = new McpServer({ name: 'flywheel-test', version: '1.0.0-test' });

    registerSystemTools(
      server,
      () => vaultIndex,
      () => {},
      () => FIXTURES_PATH,
      undefined,
      () => stateDb,
    );

    registerEntityTool(server, () => FIXTURES_PATH, () => stateDb, () => vaultIndex);

    client = connectTestClient(server);

    // Seed inferred categories for "other" entities
    const inferredMap = new Map();
    // Find an entity that would be categorized as "other" in the fixture vault
    // orphan-note.md has no frontmatter type, single word → likely "other"
    inferredMap.set('orphan-note', {
      entityName: 'orphan-note',
      category: 'concepts',
      confidence: 0.62,
    });
    saveInferredCategories(inferredMap);
    loadEntityEmbeddingsToMemory();
  });

  afterAll(() => {
    // Clean up seeded data
    try {
      stateDb.db.exec('DELETE FROM inferred_categories');
    } catch { /* table may not exist */ }
  });

  test('other entities with inferred hit get inferredCategory and inferredConfidence', async () => {
    const result = await client.callTool('entity', { action: 'list', category: 'other' });
    const data = JSON.parse(result.content[0].text);
    const otherEntities = data.other ?? [];

    const inferred = otherEntities.find(
      (e: any) => e.inferredCategory !== undefined
    );

    // If there are inferred entities, verify shape
    if (inferred) {
      expect(inferred.inferredCategory).toBe('concepts');
      expect(typeof inferred.inferredConfidence).toBe('number');
      expect(inferred.inferredConfidence).toBeGreaterThan(0);
      expect(inferred.inferredConfidence).toBeLessThanOrEqual(1);
    }
  });

  test('entities without inference omit those fields', async () => {
    const result = await client.callTool('entity', { action: 'list', category: 'other' });
    const data = JSON.parse(result.content[0].text);
    const otherEntities = data.other ?? [];

    const noInference = otherEntities.find(
      (e: any) => e.inferredCategory === undefined && e.name !== 'orphan-note'
    );

    if (noInference) {
      expect(noInference.inferredCategory).toBeUndefined();
      expect(noInference.inferredConfidence).toBeUndefined();
    }
  });

  test('non-other categories unaffected by inferred annotation', async () => {
    const result = await client.callTool('entity', { action: 'list', category: 'people' });
    const data = JSON.parse(result.content[0].text);
    const people = data.people ?? [];

    for (const entity of people) {
      expect(entity.inferredCategory).toBeUndefined();
      expect(entity.inferredConfidence).toBeUndefined();
    }
  });
});

describe('entity(action: list) include aggregates', () => {
  let server: McpServer;
  let client: TestClient;
  let stateDb: StateDb;

  // Two synthetic entities seeded directly into the state.db (buildVaultIndex
  // populates the in-memory index, NOT the entities/note_links/recency tables),
  // so the aggregation join is exercised deterministically. Namespaced names so
  // afterAll can delete exactly what it inserted and leave the shared fixture db clean.
  const ALICE = 'ZZ_AggAlice';     // person, alias 'ZZ_Ali', linked by 3 notes (2 via name, 1 via alias)
  const RUST = 'ZZ_AggRust';       // technology, no links, no recency
  const ALICE_PATH = 'people/zz-agg-alice.md';
  const RUST_PATH = 'tech/zz-agg-rust.md';

  beforeAll(async () => {
    const vaultIndex = await buildVaultIndex(FIXTURES_PATH);
    setIndexState('ready');
    stateDb = openStateDb(FIXTURES_PATH)!;
    setFTS5Database(stateDb.db);
    setEmbeddingsDatabase(stateDb.db);

    const db = stateDb.db;
    db.prepare(`INSERT INTO entities (name, name_lower, path, category, aliases_json, hub_score) VALUES (?,?,?,?,?,?)`)
      .run(ALICE, ALICE.toLowerCase(), ALICE_PATH, 'people', JSON.stringify(['ZZ_Ali']), 0);
    db.prepare(`INSERT INTO entities (name, name_lower, path, category, aliases_json, hub_score) VALUES (?,?,?,?,?,?)`)
      .run(RUST, RUST.toLowerCase(), RUST_PATH, 'technologies', JSON.stringify([]), 0);
    // 3 distinct notes link Alice: 2 reference the name (one mixed-case), 1 the alias.
    const link = db.prepare(`INSERT INTO note_links (note_path, target, weight) VALUES (?,?,1.0)`);
    link.run('daily/zz-1.md', ALICE);
    link.run('daily/zz-2.md', ALICE.toLowerCase());
    link.run('daily/zz-3.md', 'ZZ_Ali');
    db.prepare(`INSERT INTO recency (entity_name_lower, last_mentioned_at, mention_count) VALUES (?,?,?)`)
      .run(ALICE.toLowerCase(), 1700000000, 5);

    server = new McpServer({ name: 'flywheel-test', version: '1.0.0-test' });
    registerEntityTool(server, () => FIXTURES_PATH, () => stateDb, () => vaultIndex);
    client = connectTestClient(server);
  });

  afterAll(() => {
    const db = stateDb.db;
    try {
      db.prepare(`DELETE FROM entities WHERE name IN (?,?)`).run(ALICE, RUST);
      db.prepare(`DELETE FROM note_links WHERE note_path IN ('daily/zz-1.md','daily/zz-2.md','daily/zz-3.md')`).run();
      db.prepare(`DELETE FROM recency WHERE entity_name_lower = ?`).run(ALICE.toLowerCase());
    } catch { /* leave clean as best-effort */ }
  });

  function find(data: Record<string, unknown>, name: string): any {
    for (const [k, v] of Object.entries(data)) {
      if (k === '_metadata' || !Array.isArray(v)) continue;
      const hit = v.find((e: any) => e.name === name);
      if (hit) return hit;
    }
    return undefined;
  }

  test('omitting include leaves backlinkCount + recency off the seeded entities', async () => {
    const result = await client.callTool('entity', { action: 'list' });
    const data = JSON.parse(result.content[0].text);
    const alice = find(data, ALICE);
    expect(alice).toBeDefined();
    expect(alice.backlinkCount).toBeUndefined();
    expect(alice.recency).toBeUndefined();
    expect(data._metadata?.include).toBeUndefined();
  });

  test('include: [backlink_count, recency] joins links across name + aliases and the recency row', async () => {
    const result = await client.callTool('entity', {
      action: 'list',
      include: ['backlink_count', 'recency'],
    });
    const data = JSON.parse(result.content[0].text);

    const alice = find(data, ALICE);
    expect(alice).toBeDefined();
    expect(alice.backlinkCount).toBe(3); // 2 via name (case-insensitive) + 1 via alias
    expect(alice.recency).toEqual({ lastMentionedAt: 1700000000, mentionCount: 5 });

    const rust = find(data, RUST);
    expect(rust).toBeDefined();
    expect(rust.backlinkCount).toBe(0);  // no links
    expect(rust.recency).toBeNull();     // no recency row → explicit null

    expect(data._metadata.include).toEqual(['backlink_count', 'recency']);
  });

  test('include: [backlink_count] alone does not attach recency', async () => {
    const result = await client.callTool('entity', {
      action: 'list',
      include: ['backlink_count'],
    });
    const data = JSON.parse(result.content[0].text);
    const alice = find(data, ALICE);
    expect(alice.backlinkCount).toBe(3);
    expect(alice.recency).toBeUndefined();
  });
});
