/**
 * Tests for health_check — including unhealthy/degraded paths.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { connectTestClient, type TestClient, createTestServer, type TestServerContext } from '../helpers/createTestServer.js';
import { recordIndexEvent } from '../../../src/core/shared/indexActivity.js';
import { setEmbeddingsDatabase, setEmbeddingsBuildState } from '../../../src/core/read/embeddings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');

describe('health_check', () => {
  let context: TestServerContext;
  let client: TestClient;

  beforeAll(async () => {
    context = await createTestServer(FIXTURES_PATH);
    client = connectTestClient(context.server);
  });

  afterAll(() => {
    const flywheelDir = path.join(FIXTURES_PATH, '.flywheel');
    try {
      if (fs.existsSync(flywheelDir)) {
        fs.rmSync(flywheelDir, { recursive: true });
      }
    } catch { /* cleanup best-effort */ }
  });

  test('returns healthy status on valid vault', async () => {
    const result = await client.callTool('health_check', {});
    expect(result.content).toBeDefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBeDefined();
    expect(['healthy', 'degraded']).toContain(data.status);
    expect(data.recommendations).toBeDefined();
    expect(Array.isArray(data.recommendations)).toBe(true);
  });

  test('returns structured output with expected fields', async () => {
    const result = await client.callTool('health_check', {});
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('recommendations');
    expect(data).toHaveProperty('note_count');
    expect(data).toHaveProperty('entity_count');
  });

  test('does not throw ReferenceError on database integrity check', async () => {
    // This test verifies the fix for the `overall` variable bug.
    // The health_check handler should never throw a ReferenceError —
    // even if the database integrity check fails, it should return
    // a structured response with status 'unhealthy'.
    //
    // We can't easily mock the SQLite pragma in this test setup,
    // but we verify the handler completes without throwing.
    const result = await client.callTool('health_check', {});
    expect(result.content).toBeDefined();
    expect(result.isError).toBeFalsy();

    const data = JSON.parse(result.content[0].text);
    // Status should be a valid enum value, not undefined
    expect(['healthy', 'degraded', 'unhealthy']).toContain(data.status);
  });

  test('database integrity section exists in response', async () => {
    const result = await client.callTool('health_check', {});
    const data = JSON.parse(result.content[0].text);
    // The database check ran without error (dbIntegrityFailed = false)
    // so status should NOT be 'unhealthy' on a valid test vault
    expect(data.status).not.toBe('unhealthy');
  });

  test('summary mode omits full-scan dead-link fields', async () => {
    const result = await client.callTool('health_check', { mode: 'summary' });
    const data = JSON.parse(result.content[0].text);

    expect(data).not.toHaveProperty('dead_link_count');
    expect(data).not.toHaveProperty('top_dead_link_targets');
  });

  test('full mode includes dead-link fields', async () => {
    const result = await client.callTool('health_check', { mode: 'full' });
    const data = JSON.parse(result.content[0].text);

    expect(data).toHaveProperty('dead_link_count');
    expect(data).toHaveProperty('top_dead_link_targets');
    expect(Array.isArray(data.top_dead_link_targets)).toBe(true);
  });

  test('uses the last full rebuild for freshness instead of watcher activity', async () => {
    expect(context.stateDb).toBeTruthy();
    const stateDb = context.stateDb!;
    const now = Date.now();
    const rebuildAgoSeconds = 800;
    const watcherAgoSeconds = 30;

    stateDb.db.prepare('DELETE FROM index_events').run();

    recordIndexEvent(stateDb, {
      trigger: 'startup_build',
      duration_ms: 1200,
      success: true,
      note_count: context.vaultIndex.notes.size,
    });
    stateDb.db.prepare('UPDATE index_events SET timestamp = ? WHERE trigger = ?')
      .run(now - rebuildAgoSeconds * 1000, 'startup_build');

    recordIndexEvent(stateDb, {
      trigger: 'watcher',
      duration_ms: 80,
      success: true,
      files_changed: 1,
      changed_paths: ['daily/2026-01-01.md'],
    });
    stateDb.db.prepare('UPDATE index_events SET timestamp = ? WHERE trigger = ?')
      .run(now - watcherAgoSeconds * 1000, 'watcher');

    const result = await client.callTool('health_check', {});
    const data = JSON.parse(result.content[0].text);

    expect(data.index_age_seconds).toBeGreaterThanOrEqual(rebuildAgoSeconds - 5);
    expect(data.index_age_seconds).toBeLessThanOrEqual(rebuildAgoSeconds + 5);
    expect(data.last_rebuild.trigger).toBe('startup_build');
    expect(data.last_rebuild.ago_seconds).toBeGreaterThanOrEqual(rebuildAgoSeconds - 5);
    expect(data.last_rebuild.ago_seconds).toBeLessThanOrEqual(rebuildAgoSeconds + 5);
    expect(Math.abs(data.last_rebuild.ago_seconds - data.index_age_seconds)).toBeLessThanOrEqual(1);
  });
});

describe('flywheel_doctor', () => {
  let context: TestServerContext;
  let client: TestClient;

  beforeAll(async () => {
    context = await createTestServer(FIXTURES_PATH);
    client = connectTestClient(context.server);
    // Inject embeddings DB handle so getEntityEmbeddingsCount() can query
    setEmbeddingsDatabase(context.stateDb!.db);
    // Mark embeddings as built so the doctor check includes entity_embedding_coverage
    setEmbeddingsBuildState('complete');
  });

  afterAll(() => {
    setEmbeddingsBuildState('none');
    setEmbeddingsDatabase(null as any);
    const flywheelDir = path.join(FIXTURES_PATH, '.flywheel');
    try {
      if (fs.existsSync(flywheelDir)) {
        fs.rmSync(flywheelDir, { recursive: true });
      }
    } catch { /* cleanup best-effort */ }
  });

  test('entity_embedding_coverage denominator uses canonical entity count from DB', async () => {
    const stateDb = context.stateDb!;

    // Seed some canonical entities in the DB so the check has a nonzero denominator.
    // The fixture vault's entities table may be empty since the pipeline hasn't run.
    const insertEntity = stateDb.db.prepare(
      `INSERT OR IGNORE INTO entities (name, name_lower, path, category) VALUES (?, ?, ?, ?)`
    );
    insertEntity.run('Alice', 'alice', 'people/Alice.md', 'person');
    insertEntity.run('Bob', 'bob', 'people/Bob.md', 'person');
    insertEntity.run('Acme', 'acme', 'orgs/Acme.md', 'organization');

    // Get the canonical entity count directly from the DB
    const dbEntityCount = (stateDb.db.prepare('SELECT COUNT(*) as cnt FROM entities').get() as { cnt: number }).cnt;
    expect(dbEntityCount).toBeGreaterThan(0);

    // Get the linkable surface count from the in-memory index
    const indexEntitySize = context.getIndex().entities.size;

    const result = await client.callTool('flywheel_doctor', {});
    const data = JSON.parse(result.content[0].text);
    const check = data.checks.find((c: any) => c.name === 'entity_embedding_coverage');

    // The check should exist (we set embeddings state to 'complete' and seeded entities)
    expect(check).toBeDefined();

    // Parse the denominator from the detail string (format: "N/M canonical entities embedded (P%)")
    const match = check.detail.match(/(\d+)\/(\d+)/);
    expect(match).toBeTruthy();
    const denominator = parseInt(match![2], 10);

    // Denominator must match canonical entity count from DB
    expect(denominator).toBe(dbEntityCount);

    // Denominator must NOT match the linkable target surface (which includes aliases + paths)
    // This only holds when there are aliases/paths expanding the surface beyond canonical count
    if (indexEntitySize !== dbEntityCount) {
      expect(denominator).not.toBe(indexEntitySize);
    }
  });
});
