/**
 * Doctor action-shape pins (arch-review S7, written BEFORE the health.ts
 * extraction). Shape/field-presence assertions only — no value pins
 * (council R11). Complements health.test.ts, which covers health/diagnosis
 * deeply but leaves stats/config/log/pipeline shapes unpinned.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');

let context: TestServerContext;
let client: TestClient;

beforeAll(async () => {
  context = await createTestServer(FIXTURES_PATH);
  client = connectTestClient(context.server);
});

const doctor = async (args: Record<string, unknown>) => {
  const result = await client.callTool('doctor', args);
  return JSON.parse(result.content[0].text);
};

describe('doctor action shapes', () => {
  it('stats: vault statistics contract fields', async () => {
    const data = await doctor({ action: 'stats' });
    for (const field of [
      'total_notes', 'total_links', 'total_tags', 'orphan_notes', 'broken_links',
      'average_links_per_note', 'most_linked_notes', 'top_tags', 'folders', 'recent_activity',
    ]) {
      expect(data, `missing stats field ${field}`).toHaveProperty(field);
    }
    expect(data.orphan_notes).toHaveProperty('total');
    expect(data.orphan_notes).toHaveProperty('periodic');
    expect(data.orphan_notes).toHaveProperty('content');
    expect(data.recent_activity).toHaveProperty('period_days');
    expect(Array.isArray(data.top_tags)).toBe(true);
    expect(Array.isArray(data.folders)).toBe(true);
  });

  it('pipeline: status contract fields', async () => {
    const data = await doctor({ action: 'pipeline' });
    for (const field of [
      'busy', 'trigger', 'started_at', 'age_ms', 'current_step', 'progress',
      'pending_events', 'boot_state', 'integrity_state', 'integrity_check_in_progress',
      'last_completed',
    ]) {
      expect(data, `missing pipeline field ${field}`).toHaveProperty(field);
    }
  });

  it('config get returns the current config object', async () => {
    const data = await doctor({ action: 'config' });
    expect(typeof data).toBe('object');
  });

  it('config set: unknown key → exact error contract listing valid keys', async () => {
    const data = await doctor({ action: 'config', mode: 'set', key: 'no_such_key', value: 1 });
    expect(data.error).toContain('Unknown config key: "no_such_key". Valid keys:');
    expect(data.error).toContain('wikilink_strictness');
  });

  it('config set: missing key → exact error', async () => {
    const data = await doctor({ action: 'config', mode: 'set' });
    expect(data.error).toBe('key is required for set mode');
  });

  it('config set: valid key returns the reloaded config containing the new value', async () => {
    // (A follow-up config GET reads the harness's static getConfig getter, so
    // cross-call persistence is not observable here — the SET response carrying
    // the reloaded persisted config is the pinned contract.)
    const data = await doctor({
      action: 'config', mode: 'set', key: 'wikilink_strictness', value: 'conservative',
    });
    expect(data.wikilink_strictness).toBe('conservative');
  });

  it('config set: invalid value → validation error naming the key', async () => {
    const data = await doctor({
      action: 'config', mode: 'set', key: 'wikilink_strictness', value: 'bogus-level',
    });
    expect(data.error).toContain('Invalid value for "wikilink_strictness"');
  });

  it('log: entries + uptime contract', async () => {
    const data = await doctor({ action: 'log', limit: 5 });
    expect(Array.isArray(data.entries)).toBe(true);
    expect(data).toHaveProperty('server_uptime_ms');
    if (data.entries.length > 0) {
      expect(data.entries[0]).toHaveProperty('ts');
      expect(data.entries[0]).toHaveProperty('component');
      expect(data.entries[0]).toHaveProperty('message');
      expect(data.entries[0]).toHaveProperty('level');
    }
  });
});
