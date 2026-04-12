import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { openStateDb, deleteStateDb, type StateDb } from '@velvetmonkey/vault-core';
import { registerNoteTool } from '../../../src/tools/write/note.js';
import { registerEntityTool } from '../../../src/tools/write/entity.js';
import { setProspectStateDb, recordProspectSightings, refreshProspectSummaries, resetCleanupCooldown } from '../../../src/core/shared/prospects.js';
import { connectMcpTestClient, type McpTestClient } from '../../helpers/mcpClient.js';

describe('prospect lifecycle tools', () => {
  let vaultPath: string;
  let stateDb: StateDb;
  let server: McpServer;
  let client: McpTestClient;

  beforeEach(async () => {
    vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'prospect-lifecycle-'));
    stateDb = openStateDb(vaultPath);
    setProspectStateDb(stateDb);
    resetCleanupCooldown();

    server = new McpServer({ name: 'flywheel-test', version: '1.0.0-test' });
    registerNoteTool(server, () => vaultPath);
    registerEntityTool(server, () => vaultPath, () => stateDb);
    client = await connectMcpTestClient(server);
  });

  afterEach(async () => {
    setProspectStateDb(null);
    await client.close();
    deleteStateDb(vaultPath);
    await fs.rm(vaultPath, { recursive: true, force: true });
  });

  it('note(action:create) resolves matching active prospects by title and aliases', async () => {
    recordProspectSightings([
      { term: 'machine learning', displayName: 'Machine Learning', notePath: 'daily/2026-04-12.md', source: 'dead_link', confidence: 'medium', backlinkCount: 2 },
      { term: 'ml', displayName: 'ML', notePath: 'daily/2026-04-12.md', source: 'implicit', confidence: 'low' },
    ]);
    refreshProspectSummaries(['machine learning', 'ml']);

    const result = await client.callTool('note', {
      action: 'create',
      path: 'concepts/machine-learning.md',
      frontmatter: { aliases: ['ML'] },
      content: '# Machine Learning',
      skipWikilinks: true,
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.prospect_resolution.status).toBe('entity_created');
    expect(data.prospect_resolution.resolved_entity_path).toBe('concepts/machine-learning.md');
    expect(data.prospect_resolution.resolved_terms).toHaveLength(2);
    expect(data.prospect_resolution.resolved_terms).toEqual(expect.arrayContaining(['machine learning', 'ml']));
  });

  it('entity(action:alias) resolves matching active prospects as merged', async () => {
    await fs.mkdir(path.join(vaultPath, 'people'), { recursive: true });
    await fs.writeFile(
      path.join(vaultPath, 'people', 'Alice.md'),
      '---\ntype: person\n---\n# Alice\n',
      'utf8',
    );

    recordProspectSightings([
      { term: 'ally', displayName: 'Ally', notePath: 'daily/2026-04-12.md', source: 'implicit', confidence: 'low' },
    ]);
    refreshProspectSummaries(['ally']);

    const result = await client.callTool('entity', {
      action: 'alias',
      entity: 'people/Alice.md',
      alias: 'Ally',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.prospect_resolution.status).toBe('merged');
    expect(data.prospect_resolution.resolved_entity_path).toBe('people/Alice.md');
    expect(data.prospect_resolution.resolved_terms).toEqual(['ally']);
  });

  it('entity(action:dismiss_prospect) rejects an active prospect', async () => {
    recordProspectSightings([
      { term: 'noise item', displayName: 'Noise Item', notePath: 'daily/2026-04-12.md', source: 'implicit', confidence: 'low' },
    ]);
    refreshProspectSummaries(['noise item']);

    const result = await client.callTool('entity', {
      action: 'dismiss_prospect',
      prospect: 'Noise Item',
      reason: 'not useful',
      note_path: 'daily/2026-04-12.md',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.dismissed).toBe(true);
    expect(data.status).toBe('rejected');

    const summary = stateDb.db.prepare(
      'SELECT status FROM prospect_summary WHERE term = ?'
    ).get('noise item') as { status: string };
    expect(summary.status).toBe('rejected');
  });
});
