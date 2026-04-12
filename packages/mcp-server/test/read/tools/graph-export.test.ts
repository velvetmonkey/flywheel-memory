import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdir, writeFile } from 'fs/promises';
import {
  openStateDb,
  deleteStateDb,
  scanVaultEntities,
  type StateDb,
} from '@velvetmonkey/vault-core';
import type { VaultIndex, VaultNote } from '../../../src/core/read/types.js';
import {
  buildGraphData,
  toGraphML,
  type GraphData,
} from '../../../src/tools/read/graphExport.js';
import {
  saveCooccurrenceToStateDb,
  type CooccurrenceIndex,
} from '../../../src/core/shared/cooccurrence.js';
import {
  createTempVault,
  cleanupTempVault,
} from '../../helpers/testUtils.js';
import {
  connectTestClient,
  createTestServer,
  type TestClient,
  type TestServerContext,
} from '../helpers/createTestServer.js';
import { buildVaultIndex } from '../../../src/core/read/graph.js';

function makeNote(
  notePath: string,
  title: string,
  outlinks: Array<{ target: string }> = [],
  tags: string[] = [],
): VaultNote {
  return {
    path: notePath,
    title,
    aliases: [],
    frontmatter: {},
    outlinks: outlinks.map((link, index) => ({ target: link.target, line: index + 1 })),
    tags,
    modified: new Date('2026-03-23T00:00:00Z'),
  };
}

function makeIndex(notes: VaultNote[]): VaultIndex {
  const index: VaultIndex = {
    notes: new Map(),
    backlinks: new Map(),
    entities: new Map(),
    tags: new Map(),
    builtAt: new Date(),
  };

  for (const note of notes) {
    index.notes.set(note.path, note);
    index.entities.set(note.title.toLowerCase(), note.path);
    for (const alias of note.aliases) {
      index.entities.set(alias.toLowerCase(), note.path);
    }
  }

  return index;
}

describe('graph export helpers', () => {
  it('creates note nodes and wikilink edges from the vault index', () => {
    const index = makeIndex([
      makeNote('a.md', 'Alpha', [{ target: 'Beta' }], ['project', 'active']),
      makeNote('b.md', 'Beta'),
    ]);

    const data = buildGraphData(index, null, {
      include_cooccurrence: false,
      min_edge_weight: 0,
    });

    expect(data.nodes).toHaveLength(2);
    expect(data.edges).toHaveLength(1);
    expect(data.edges[0].edge_type).toBe('wikilink');
    expect(data.nodes[0].tags).toBe('project, active');
    expect(data.metadata.note_count).toBe(2);
  });

  it('serializes GraphML with proper XML escaping', () => {
    const data: GraphData = {
      nodes: [{ id: 'note:a&b.md', label: 'Alpha & Beta <1>', type: 'note' }],
      edges: [],
      metadata: {
        note_count: 1,
        entity_count: 0,
        edge_count: 0,
        exported_at: '2026-03-23T00:00:00Z',
      },
    };

    const xml = toGraphML(data);

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('id="note:a&amp;b.md"');
    expect(xml).toContain('Alpha &amp; Beta &lt;1&gt;');
    expect(xml).not.toContain('&amp;amp;');
  });
});

describe('graph export helpers with StateDb', () => {
  let tempVault: string;
  let stateDb: StateDb;
  let index: VaultIndex;

  beforeAll(async () => {
    tempVault = await createTempVault();
    await mkdir(path.join(tempVault, 'people'), { recursive: true });
    await writeFile(
      path.join(tempVault, 'people', 'Alice.md'),
      '---\ntype: person\naliases:\n  - Ally\n---\n# Alice\n\nWorks with [[Bob]] on [[Project Alpha]].\n',
      'utf-8',
    );
    await writeFile(
      path.join(tempVault, 'people', 'Bob.md'),
      '---\ntype: person\n---\n# Bob\n\nCollaborates with [[Alice]].\n',
      'utf-8',
    );
    await writeFile(
      path.join(tempVault, 'Project Alpha.md'),
      '---\ntype: project\n---\n# Project Alpha\n\nA project with [[Alice]] and [[Bob]].\n',
      'utf-8',
    );

    stateDb = openStateDb(tempVault);
    const entityIndex = await scanVaultEntities(tempVault, { excludeFolders: [] });
    stateDb.replaceAllEntities(entityIndex);

    stateDb.db.exec(`
      INSERT OR REPLACE INTO note_links (note_path, target, weight) VALUES
        ('people/Alice.md', 'ally', 2.5),
        ('Project Alpha.md', 'bob', 3.0),
        ('ghost.md', 'bob', 9.0)
    `);

    const cooccurrenceIndex: CooccurrenceIndex = {
      associations: {
        Alice: new Map([['Bob', 5], ['Project Alpha', 3]]),
        Bob: new Map([['Alice', 5]]),
        'Project Alpha': new Map([['Alice', 3]]),
      },
      minCount: 2,
      documentFrequency: new Map([
        ['Alice', 3],
        ['Bob', 2],
        ['Project Alpha', 2],
      ]),
      totalNotesScanned: 3,
      _metadata: {
        generated_at: new Date().toISOString(),
        total_associations: 3,
        notes_scanned: 3,
      },
    };
    saveCooccurrenceToStateDb(stateDb, cooccurrenceIndex);

    index = await buildVaultIndex(tempVault);
  });

  afterAll(async () => {
    stateDb.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  it('includes entity nodes and resolves weighted edges through aliases', () => {
    const data = buildGraphData(index, stateDb, {
      include_cooccurrence: false,
      min_edge_weight: 0,
    });

    const aliceNode = data.nodes.find((node) => node.type === 'entity' && node.label === 'Alice');
    expect(aliceNode).toBeDefined();

    const weightedEdges = data.edges.filter((edge) => edge.edge_type === 'weighted');
    expect(weightedEdges.some((edge) => edge.target === aliceNode?.id && edge.weight === 2.5)).toBe(
      true,
    );
  });

  it('skips stale weighted edges whose source note no longer exists', () => {
    const data = buildGraphData(index, stateDb, {
      include_cooccurrence: false,
      min_edge_weight: 0,
    });

    expect(data.edges.some((edge) => edge.source === 'note:ghost.md')).toBe(false);
  });

  it('includes co-occurrence edges and supports scoped ego-network export', () => {
    const full = buildGraphData(index, stateDb, {
      include_cooccurrence: true,
      min_edge_weight: 0,
    });
    const scoped = buildGraphData(index, stateDb, {
      include_cooccurrence: true,
      min_edge_weight: 0,
      center_entity: 'Alice',
      depth: 1,
    });

    expect(full.edges.some((edge) => edge.edge_type === 'cooccurrence' && edge.weight === 5)).toBe(
      true,
    );
    expect(scoped.nodes.length).toBeLessThan(full.nodes.length);
    expect(scoped.nodes.some((node) => node.label === 'Alice')).toBe(true);
  });
});

describe('graph export through merged graph tool', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const fixturesPath = path.join(__dirname, '..', 'fixtures');
  let context: TestServerContext;
  let client: TestClient;

  beforeAll(async () => {
    context = await createTestServer(fixturesPath);
    client = connectTestClient(context.server);
  });

  afterAll(() => {
    context.stateDb?.close();
  });

  it('returns GraphML for graph(action=export)', async () => {
    const result = await client.callTool('graph', {
      action: 'export',
      format: 'graphml',
      center_entity: 'Acme Corp',
      depth: 1,
    });

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain('<graphml');
    expect(result.content[0].text).toContain('<graph id="vault"');
  });

  it('returns JSON for graph(action=export)', async () => {
    const result = await client.callTool('graph', {
      action: 'export',
      format: 'json',
      center_entity: 'Acme Corp',
      depth: 1,
    });

    const data = JSON.parse(result.content[0].text);
    expect(Array.isArray(data.nodes)).toBe(true);
    expect(Array.isArray(data.edges)).toBe(true);
    expect(data.metadata).toBeDefined();
  });

  it('guards large full-vault exports with max_nodes', async () => {
    const demoVaultPath = path.resolve(
      __dirname,
      '../../../../../demos/carter-strategy',
    );
    const demoContext = await createTestServer(demoVaultPath);
    const demoClient = connectTestClient(demoContext.server);

    const result = await demoClient.callTool('graph', {
      action: 'export',
      format: 'json',
      max_nodes: 10,
    });

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toContain('exceeding max_nodes=10');
    demoContext.stateDb?.close();
  });
});
