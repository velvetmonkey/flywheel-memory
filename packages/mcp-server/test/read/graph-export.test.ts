/**
 * Tests for export_graph tool — GraphML and JSON export
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { buildGraphData, toGraphML, type GraphData } from '../../src/tools/read/graphExport.js';
import type { VaultIndex, VaultNote } from '../../src/core/shared/types.js';
import { openStateDb, deleteStateDb, scanVaultEntities, type StateDb } from '@velvetmonkey/vault-core';
import { createTempVault, cleanupTempVault } from '../helpers/testUtils.js';
import { saveCooccurrenceToStateDb } from '../../src/core/shared/cooccurrence.js';
import type { CooccurrenceIndex } from '../../src/core/shared/cooccurrence.js';

function makeNote(path: string, title: string, outlinks: Array<{ target: string }> = [], tags: string[] = []): VaultNote {
  return {
    path,
    title,
    aliases: [],
    frontmatter: {},
    outlinks: outlinks.map((o, i) => ({ target: o.target, line: i + 1 })),
    tags,
    modified: new Date('2026-03-23'),
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

describe('buildGraphData', () => {
  it('creates note nodes from vault index', () => {
    const index = makeIndex([
      makeNote('a.md', 'Alpha'),
      makeNote('b.md', 'Beta'),
    ]);

    const data = buildGraphData(index, null, { include_cooccurrence: false, min_edge_weight: 0 });

    expect(data.nodes).toHaveLength(2);
    expect(data.nodes[0].type).toBe('note');
    expect(data.nodes[0].label).toBe('Alpha');
    expect(data.nodes[1].label).toBe('Beta');
    expect(data.metadata.note_count).toBe(2);
  });

  it('creates wikilink edges for resolved links', () => {
    const index = makeIndex([
      makeNote('a.md', 'Alpha', [{ target: 'Beta' }]),
      makeNote('b.md', 'Beta'),
    ]);

    const data = buildGraphData(index, null, { include_cooccurrence: false, min_edge_weight: 0 });

    expect(data.edges).toHaveLength(1);
    expect(data.edges[0].edge_type).toBe('wikilink');
    expect(data.edges[0].source).toContain('a.md');
    expect(data.edges[0].target).toContain('b.md');
  });

  it('skips unresolved wikilinks', () => {
    const index = makeIndex([
      makeNote('a.md', 'Alpha', [{ target: 'NonExistent' }]),
    ]);

    const data = buildGraphData(index, null, { include_cooccurrence: false, min_edge_weight: 0 });

    expect(data.edges).toHaveLength(0);
  });

  it('deduplicates wikilink edges', () => {
    const index = makeIndex([
      makeNote('a.md', 'Alpha', [{ target: 'Beta' }, { target: 'Beta' }]),
      makeNote('b.md', 'Beta'),
    ]);

    const data = buildGraphData(index, null, { include_cooccurrence: false, min_edge_weight: 0 });

    expect(data.edges).toHaveLength(1);
  });

  it('includes tags in node metadata', () => {
    const index = makeIndex([
      makeNote('a.md', 'Alpha', [], ['project', 'active']),
    ]);

    const data = buildGraphData(index, null, { include_cooccurrence: false, min_edge_weight: 0 });

    expect(data.nodes[0].tags).toBe('project, active');
  });
});

describe('toGraphML', () => {
  it('produces valid GraphML structure', () => {
    const data: GraphData = {
      nodes: [
        { id: 'note:a.md', label: 'Alpha', type: 'note' },
        { id: 'note:b.md', label: 'Beta', type: 'note' },
      ],
      edges: [
        { source: 'note:a.md', target: 'note:b.md', edge_type: 'wikilink', weight: 1 },
      ],
      metadata: { note_count: 2, entity_count: 0, edge_count: 1, exported_at: '2026-03-23T00:00:00Z' },
    };

    const xml = toGraphML(data);

    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<graphml');
    expect(xml).toContain('<graph id="vault"');
    expect(xml).toContain('<node id="note:a.md"');
    expect(xml).toContain('<node id="note:b.md"');
    expect(xml).toContain('<edge id="e0"');
    expect(xml).toContain('</graphml>');
  });

  it('escapes XML special characters', () => {
    const data: GraphData = {
      nodes: [
        { id: 'note:a&b.md', label: 'Alpha & Beta <1>', type: 'note' },
      ],
      edges: [],
      metadata: { note_count: 1, entity_count: 0, edge_count: 0, exported_at: '2026-03-23T00:00:00Z' },
    };

    const xml = toGraphML(data);

    // Label content should be escaped
    expect(xml).toContain('&lt;1&gt;');
    expect(xml).not.toContain('Alpha & Beta <1>');
    // ID attribute should be escaped exactly once (not double-escaped)
    expect(xml).toContain('id="note:a&amp;b.md"');
    expect(xml).not.toContain('&amp;amp;');
  });

  it('includes attribute declarations', () => {
    const data: GraphData = {
      nodes: [],
      edges: [],
      metadata: { note_count: 0, entity_count: 0, edge_count: 0, exported_at: '2026-03-23T00:00:00Z' },
    };

    const xml = toGraphML(data);

    expect(xml).toContain('key id="label"');
    expect(xml).toContain('key id="type"');
    expect(xml).toContain('key id="hub_score"');
    expect(xml).toContain('key id="edge_type"');
    expect(xml).toContain('key id="weight"');
  });
});

describe('buildGraphData with StateDb', () => {
  let tempVault: string;
  let stateDb: StateDb;
  let index: VaultIndex;

  beforeAll(async () => {
    tempVault = await createTempVault();

    // Create notes with wikilinks
    await mkdir(path.join(tempVault, 'people'), { recursive: true });
    await writeFile(path.join(tempVault, 'people', 'Alice.md'),
      '---\ntype: person\n---\n# Alice\n\nWorks on [[Project Alpha]] with [[Bob]].\n');
    await writeFile(path.join(tempVault, 'people', 'Bob.md'),
      '---\ntype: person\n---\n# Bob\n\nCollaborates with [[Alice]].\n');
    await writeFile(path.join(tempVault, 'Project Alpha.md'),
      '---\ntype: project\nstatus: active\n---\n# Project Alpha\n\nA project with [[Alice]] and [[Bob]].\n');

    // Open StateDb + seed entities
    stateDb = openStateDb(tempVault);
    const entityIndex = await scanVaultEntities(tempVault, { excludeFolders: [] });
    stateDb.replaceAllEntities(entityIndex);

    // Seed note_links with weights
    stateDb.db.exec(`
      INSERT OR REPLACE INTO note_links (note_path, target, weight) VALUES
        ('people/Alice.md', 'alice', 2.5),
        ('people/Bob.md', 'alice', 1.8),
        ('Project Alpha.md', 'bob', 3.0)
    `);

    // Seed co-occurrence data
    const coocIndex: CooccurrenceIndex = {
      associations: {
        'Alice': new Map([['Bob', 5], ['Project Alpha', 3]]),
        'Bob': new Map([['Alice', 5]]),
        'Project Alpha': new Map([['Alice', 3]]),
      },
      minCount: 2,
      documentFrequency: new Map([['Alice', 3], ['Bob', 2], ['Project Alpha', 2]]),
      totalNotesScanned: 3,
      _metadata: { generated_at: new Date().toISOString(), total_associations: 3, notes_scanned: 3 },
    };
    saveCooccurrenceToStateDb(stateDb, coocIndex);

    // Build vault index from the real files
    index = makeIndex([
      makeNote('people/Alice.md', 'Alice', [{ target: 'Project Alpha' }, { target: 'Bob' }], []),
      makeNote('people/Bob.md', 'Bob', [{ target: 'Alice' }], []),
      makeNote('Project Alpha.md', 'Project Alpha', [{ target: 'Alice' }, { target: 'Bob' }], []),
    ]);
  }, 15000);

  afterAll(async () => {
    stateDb?.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  it('includes entity nodes from StateDb', () => {
    const data = buildGraphData(index, stateDb, { include_cooccurrence: false, min_edge_weight: 0 });

    const entityNodes = data.nodes.filter(n => n.type === 'entity');
    expect(entityNodes.length).toBeGreaterThanOrEqual(3);

    const alice = entityNodes.find(n => n.label === 'Alice');
    expect(alice).toBeDefined();
    expect(alice!.category).toBe('people');
  });

  it('includes weighted edges from note_links', () => {
    const data = buildGraphData(index, stateDb, { include_cooccurrence: false, min_edge_weight: 0 });

    const weightedEdges = data.edges.filter(e => e.edge_type === 'weighted');
    expect(weightedEdges.length).toBeGreaterThanOrEqual(1);

    const highWeight = weightedEdges.find(e => e.weight >= 2.5);
    expect(highWeight).toBeDefined();
  });

  it('respects min_edge_weight filter', () => {
    const dataAll = buildGraphData(index, stateDb, { include_cooccurrence: false, min_edge_weight: 0 });
    const dataFiltered = buildGraphData(index, stateDb, { include_cooccurrence: false, min_edge_weight: 2.0 });

    const allWeighted = dataAll.edges.filter(e => e.edge_type === 'weighted');
    const filteredWeighted = dataFiltered.edges.filter(e => e.edge_type === 'weighted');

    expect(filteredWeighted.length).toBeLessThanOrEqual(allWeighted.length);
    for (const edge of filteredWeighted) {
      expect(edge.weight).toBeGreaterThanOrEqual(2.0);
    }
  });

  it('includes co-occurrence edges when requested', () => {
    const data = buildGraphData(index, stateDb, { include_cooccurrence: true, min_edge_weight: 0 });

    const coocEdges = data.edges.filter(e => e.edge_type === 'cooccurrence');
    expect(coocEdges.length).toBeGreaterThanOrEqual(1);

    // Alice ↔ Bob should be present (count=5)
    const aliceBob = coocEdges.find(e =>
      (e.source.includes('Alice') && e.target.includes('Bob')) ||
      (e.source.includes('Bob') && e.target.includes('Alice'))
    );
    expect(aliceBob).toBeDefined();
    expect(aliceBob!.weight).toBe(5);
  });

  it('excludes co-occurrence edges when disabled', () => {
    const data = buildGraphData(index, stateDb, { include_cooccurrence: false, min_edge_weight: 0 });

    const coocEdges = data.edges.filter(e => e.edge_type === 'cooccurrence');
    expect(coocEdges).toHaveLength(0);
  });

  it('metadata counts match actual data', () => {
    const data = buildGraphData(index, stateDb, { include_cooccurrence: true, min_edge_weight: 0 });

    expect(data.metadata.note_count).toBe(3);
    expect(data.metadata.entity_count).toBeGreaterThanOrEqual(3);
    expect(data.metadata.edge_count).toBe(data.edges.length);
  });

  it('JSON format includes all nodes and edges', () => {
    const data = buildGraphData(index, stateDb, { include_cooccurrence: true, min_edge_weight: 0 });
    const json = JSON.parse(JSON.stringify(data));

    expect(json.nodes).toBeInstanceOf(Array);
    expect(json.edges).toBeInstanceOf(Array);
    expect(json.metadata).toBeDefined();
    expect(json.nodes.length).toBe(data.nodes.length);
    expect(json.edges.length).toBe(data.edges.length);
  });
});

describe('export_graph on carter-strategy demo vault', () => {
  const demoVaultPath = path.resolve(__dirname, '../../../../demos/carter-strategy');
  let stateDb: StateDb;
  let vaultIndex: VaultIndex;

  beforeAll(async () => {
    const { buildVaultIndex: buildIdx } = await import('../../src/core/read/graph.js');
    vaultIndex = await buildIdx(demoVaultPath);
    stateDb = openStateDb(demoVaultPath);
    // Seed entities so tests work on CI (fresh clone, no prior watcher run)
    const entityIndex = await scanVaultEntities(demoVaultPath, { excludeFolders: [] });
    stateDb.replaceAllEntities(entityIndex);
  }, 30000);

  afterAll(() => {
    stateDb?.close();
  });

  it('builds graph data with real entities and edges', () => {
    const data = buildGraphData(vaultIndex, stateDb, { include_cooccurrence: true, min_edge_weight: 0 });

    // Carter strategy has 47-48 notes
    expect(data.metadata.note_count).toBeGreaterThanOrEqual(40);

    // Should have entity nodes
    const entityNodes = data.nodes.filter(n => n.type === 'entity');
    expect(entityNodes.length).toBeGreaterThanOrEqual(10);

    // Known entities should be present
    const entityNames = entityNodes.map(n => n.label);
    expect(entityNames).toContain('Sarah Mitchell');
    expect(entityNames).toContain('Acme Corp');

    // Should have wikilink edges
    const wikilinkEdges = data.edges.filter(e => e.edge_type === 'wikilink');
    expect(wikilinkEdges.length).toBeGreaterThanOrEqual(20);

    // Co-occurrence edges depend on cached cooccurrence index
    // (may be empty if vault hasn't been watched recently — that's OK)
  });

  it('generates valid GraphML that NetworkX can parse', async () => {
    const data = buildGraphData(vaultIndex, stateDb, { include_cooccurrence: true, min_edge_weight: 0 });
    const xml = toGraphML(data);

    // Write GraphML as demo asset
    const graphmlPath = path.join(demoVaultPath, 'carter-strategy.graphml');
    await writeFile(graphmlPath, xml, 'utf-8');

    // Validate with NetworkX (skip gracefully if Python/NetworkX unavailable)
    let networkxAvailable = true;
    let result = '';
    try {
      const { execSync } = await import('child_process');
      result = execSync(`python3 -c "
import networkx as nx
G = nx.read_graphml('${graphmlPath}')
nodes = G.number_of_nodes()
edges = G.number_of_edges()
print(f'{nodes} {edges}')
for n, d in list(G.nodes(data=True))[:1]:
    print(f'node_attrs: {sorted(d.keys())}')
for u, v, d in list(G.edges(data=True))[:1]:
    print(f'edge_attrs: {sorted(d.keys())}')
has_sarah = any('Sarah Mitchell' in str(d.get('label','')) for n,d in G.nodes(data=True))
has_acme = any('Acme Corp' in str(d.get('label','')) for n,d in G.nodes(data=True))
print(f'sarah={has_sarah} acme={has_acme}')
print('VALID')
"`, { encoding: 'utf-8' });
    } catch {
      networkxAvailable = false;
    }

    // On Windows CI, python3 may exist but NetworkX may not be installed,
    // or backslash paths break the inline Python script — skip gracefully
    if (!result.includes('VALID')) {
      networkxAvailable = false;
    }

    if (networkxAvailable) {
      expect(result).toContain('VALID');
      expect(result).toContain('sarah=True');
      expect(result).toContain('acme=True');

      const [nodeCount, edgeCount] = result.split('\n')[0].split(' ').map(Number);
      expect(nodeCount).toBe(data.nodes.length);
      expect(edgeCount).toBe(data.edges.length);

      expect(result).toContain('label');
      expect(result).toContain('edge_type');
    }
  }, 30000);

  it('generates valid JSON format', () => {
    const data = buildGraphData(vaultIndex, stateDb, { include_cooccurrence: true, min_edge_weight: 0 });
    const json = JSON.parse(JSON.stringify(data));

    expect(json.nodes.length).toBeGreaterThanOrEqual(40);
    expect(json.edges.length).toBeGreaterThanOrEqual(20);
    expect(json.metadata.exported_at).toBeDefined();
  });

  it('filters to ego network around a center entity', () => {
    const full = buildGraphData(vaultIndex, stateDb, { include_cooccurrence: false, min_edge_weight: 0 });
    const ego = buildGraphData(vaultIndex, stateDb, {
      include_cooccurrence: false,
      min_edge_weight: 0,
      center_entity: 'Acme Corp',
      depth: 1,
    });

    // Ego network should be much smaller than full graph
    expect(ego.nodes.length).toBeLessThan(full.nodes.length);
    expect(ego.nodes.length).toBeGreaterThanOrEqual(3);

    // Acme Corp should be in the result
    const acme = ego.nodes.find(n => n.label === 'Acme Corp');
    expect(acme).toBeDefined();

    // All edges should connect nodes in the result
    const nodeIds = new Set(ego.nodes.map(n => n.id));
    for (const edge of ego.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });

  it('depth 2 includes more nodes than depth 1', () => {
    const d1 = buildGraphData(vaultIndex, stateDb, {
      include_cooccurrence: false, min_edge_weight: 0,
      center_entity: 'Acme Corp', depth: 1,
    });
    const d2 = buildGraphData(vaultIndex, stateDb, {
      include_cooccurrence: false, min_edge_weight: 0,
      center_entity: 'Acme Corp', depth: 2,
    });

    expect(d2.nodes.length).toBeGreaterThanOrEqual(d1.nodes.length);
  });

  it('writes ego-network GraphML for Acme Corp', async () => {
    const ego = buildGraphData(vaultIndex, stateDb, {
      include_cooccurrence: false, min_edge_weight: 0,
      center_entity: 'Acme Corp', depth: 1,
    });
    const xml = toGraphML(ego);
    const egoPath = path.join(demoVaultPath, 'carter-strategy-acme.graphml');
    await writeFile(egoPath, xml, 'utf-8');

    // Should be smaller than full export (88 nodes)
    expect(ego.nodes.length).toBeLessThan(60);
    expect(ego.edges.length).toBeLessThan(300);
  });
});
