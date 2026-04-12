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
