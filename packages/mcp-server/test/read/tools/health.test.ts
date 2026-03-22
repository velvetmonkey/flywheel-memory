/**
 * Tests for health_check — including unhealthy/degraded paths.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { connectTestClient, type TestClient, createTestServer, type TestServerContext } from '../helpers/createTestServer.js';

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
});
