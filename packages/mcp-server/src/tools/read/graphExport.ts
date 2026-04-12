import type { StateDb } from '@velvetmonkey/vault-core';
import { getAllEntitiesFromDb } from '@velvetmonkey/vault-core';
import type { VaultIndex } from '../../core/read/types.js';
import { resolveTarget } from '../../core/read/graph.js';
import { loadCooccurrenceFromStateDb } from '../../core/shared/cooccurrence.js';

/** Escape special XML characters. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Build a stable node/edge ID. Escaping happens during GraphML serialization. */
function xmlId(prefix: string, value: string): string {
  return `${prefix}:${value}`;
}

function dataTag(key: string, value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) return '';
  return `      <data key="${key}">${escapeXml(String(value))}</data>\n`;
}

export interface GraphNode {
  id: string;
  label: string;
  type: 'note' | 'entity';
  category?: string;
  hub_score?: number;
  modified?: string;
  tags?: string;
  aliases?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  edge_type: 'wikilink' | 'weighted' | 'cooccurrence';
  weight: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    note_count: number;
    entity_count: number;
    edge_count: number;
    exported_at: string;
  };
}

export interface GraphExportOptions {
  include_cooccurrence: boolean;
  min_edge_weight: number;
  center_entity?: string;
  depth?: number;
}

/**
 * Build graph export data from the vault index and StateDb.
 * Exported separately so the merged graph tool can reuse it and tests can hit
 * the core logic directly.
 */
export function buildGraphData(
  index: VaultIndex,
  stateDb: StateDb | null,
  options: GraphExportOptions,
): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const noteIds = new Set<string>();
  const entityIds = new Set<string>();

  for (const [notePath, note] of index.notes) {
    const id = xmlId('note', notePath);
    noteIds.add(id);
    nodes.push({
      id,
      label: note.title,
      type: 'note',
      category: typeof note.frontmatter?.type === 'string' ? note.frontmatter.type : undefined,
      modified: note.modified?.toISOString(),
      tags: note.tags.length > 0 ? note.tags.join(', ') : undefined,
    });
  }

  if (stateDb) {
    const entities = getAllEntitiesFromDb(stateDb);
    for (const entity of entities) {
      const id = xmlId('entity', entity.name);
      if (entityIds.has(id)) continue;
      entityIds.add(id);
      nodes.push({
        id,
        label: entity.name,
        type: 'entity',
        category: entity.category,
        hub_score: entity.hubScore,
        aliases: entity.aliases.length > 0 ? entity.aliases.join(', ') : undefined,
      });
    }
  }

  const seenWikilinks = new Set<string>();
  for (const [notePath, note] of index.notes) {
    const sourceId = xmlId('note', notePath);
    for (const link of note.outlinks) {
      const resolved = resolveTarget(index, link.target);
      if (!resolved) continue;
      const targetId = xmlId('note', resolved);
      const edgeKey = `${sourceId}→${targetId}`;
      if (seenWikilinks.has(edgeKey)) continue;
      seenWikilinks.add(edgeKey);
      edges.push({
        source: sourceId,
        target: targetId,
        edge_type: 'wikilink',
        weight: 1,
      });
    }
  }

  if (stateDb) {
    const rows = stateDb.db.prepare(
      'SELECT note_path, target, weight FROM note_links WHERE weight >= ?',
    ).all(options.min_edge_weight) as Array<{ note_path: string; target: string; weight: number }>;

    for (const row of rows) {
      const sourceId = xmlId('note', row.note_path);
      // Skip stale learned edges whose source note no longer exists.
      if (!noteIds.has(sourceId)) continue;

      const targetLower = row.target.toLowerCase();
      let targetId: string | undefined;

      if (entityIds.has(xmlId('entity', row.target))) {
        targetId = xmlId('entity', row.target);
      } else {
        for (const node of nodes) {
          if (node.type !== 'entity') continue;
          if (node.label.toLowerCase() === targetLower) {
            targetId = node.id;
            break;
          }
          if (node.aliases) {
            const aliases = node.aliases.split(', ').map((alias) => alias.toLowerCase());
            if (aliases.includes(targetLower)) {
              targetId = node.id;
              break;
            }
          }
        }
      }

      if (!targetId) continue;
      edges.push({
        source: sourceId,
        target: targetId,
        edge_type: 'weighted',
        weight: row.weight,
      });
    }
  }

  if (options.include_cooccurrence && stateDb) {
    const cached = loadCooccurrenceFromStateDb(stateDb);
    if (cached) {
      const seenCooccurrence = new Set<string>();
      for (const [entityName, associations] of Object.entries(cached.index.associations)) {
        const sourceId = xmlId('entity', entityName);
        if (!entityIds.has(sourceId)) continue;
        for (const [relatedName, count] of associations) {
          const targetId = xmlId('entity', relatedName);
          if (!entityIds.has(targetId)) continue;
          const pairKey = [entityName, relatedName].sort().join('↔');
          if (seenCooccurrence.has(pairKey)) continue;
          seenCooccurrence.add(pairKey);
          edges.push({
            source: sourceId,
            target: targetId,
            edge_type: 'cooccurrence',
            weight: count,
          });
        }
      }
    }
  }

  if (options.center_entity) {
    const centerLower = options.center_entity.toLowerCase();
    const maxDepth = options.depth ?? 1;
    const centerNode = nodes.find((node) => node.label.toLowerCase() === centerLower);

    if (centerNode) {
      const adjacency = new Map<string, Set<string>>();
      for (const edge of edges) {
        if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
        if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
        adjacency.get(edge.source)!.add(edge.target);
        adjacency.get(edge.target)!.add(edge.source);
      }

      const reachable = new Set<string>([centerNode.id]);
      const queue: Array<{ id: string; depth: number }> = [{ id: centerNode.id, depth: 0 }];

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.depth >= maxDepth) continue;
        for (const neighbor of adjacency.get(current.id) ?? []) {
          if (reachable.has(neighbor)) continue;
          reachable.add(neighbor);
          queue.push({ id: neighbor, depth: current.depth + 1 });
        }
      }

      const filteredNodes = nodes.filter((node) => reachable.has(node.id));
      const filteredEdges = edges.filter(
        (edge) => reachable.has(edge.source) && reachable.has(edge.target),
      );

      return {
        nodes: filteredNodes,
        edges: filteredEdges,
        metadata: {
          note_count: filteredNodes.filter((node) => node.type === 'note').length,
          entity_count: filteredNodes.filter((node) => node.type === 'entity').length,
          edge_count: filteredEdges.length,
          exported_at: new Date().toISOString(),
        },
      };
    }
  }

  return {
    nodes,
    edges,
    metadata: {
      note_count: index.notes.size,
      entity_count: entityIds.size,
      edge_count: edges.length,
      exported_at: new Date().toISOString(),
    },
  };
}

/** Serialize export data to GraphML for Gephi/yEd/Cytoscape/NetworkX. */
export function toGraphML(data: GraphData): string {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<graphml xmlns="http://graphml.graphdrawing.org/xmlns"\n`;
  xml += `         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n`;
  xml += `         xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">\n`;
  xml += `  <key id="label" for="node" attr.name="label" attr.type="string"/>\n`;
  xml += `  <key id="type" for="node" attr.name="type" attr.type="string"/>\n`;
  xml += `  <key id="category" for="node" attr.name="category" attr.type="string"/>\n`;
  xml += `  <key id="hub_score" for="node" attr.name="hub_score" attr.type="double"/>\n`;
  xml += `  <key id="modified" for="node" attr.name="modified" attr.type="string"/>\n`;
  xml += `  <key id="tags" for="node" attr.name="tags" attr.type="string"/>\n`;
  xml += `  <key id="aliases" for="node" attr.name="aliases" attr.type="string"/>\n`;
  xml += `  <key id="edge_type" for="edge" attr.name="edge_type" attr.type="string"/>\n`;
  xml += `  <key id="weight" for="edge" attr.name="weight" attr.type="double"/>\n`;
  xml += `  <graph id="vault" edgedefault="directed">\n`;

  for (const node of data.nodes) {
    xml += `    <node id="${escapeXml(node.id)}">\n`;
    xml += dataTag('label', node.label);
    xml += dataTag('type', node.type);
    xml += dataTag('category', node.category);
    xml += dataTag('hub_score', node.hub_score);
    xml += dataTag('modified', node.modified);
    xml += dataTag('tags', node.tags);
    xml += dataTag('aliases', node.aliases);
    xml += `    </node>\n`;
  }

  let edgeIndex = 0;
  for (const edge of data.edges) {
    xml += `    <edge id="e${edgeIndex++}" source="${escapeXml(edge.source)}" target="${escapeXml(edge.target)}">\n`;
    xml += dataTag('edge_type', edge.edge_type);
    xml += dataTag('weight', edge.weight);
    xml += `    </edge>\n`;
  }

  xml += `  </graph>\n`;
  xml += `</graphml>\n`;
  return xml;
}
