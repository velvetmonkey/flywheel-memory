/**
 * Graph Export tool — export vault knowledge graph as GraphML or JSON
 *
 * Supports Gephi, yEd, Cytoscape, NetworkX, and any GraphML-compatible tool.
 * Tool: export_graph
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import { getAllEntitiesFromDb } from '@velvetmonkey/vault-core';
import { loadCooccurrenceFromStateDb } from '../../core/shared/cooccurrence.js';
import { requireIndex } from '../../core/read/indexGuard.js';
import { resolveTarget } from '../../core/read/graph.js';

/** Escape special XML characters */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Sanitize a string for use as an XML id attribute (no spaces, special chars) */
function xmlId(prefix: string, value: string): string {
  return `${prefix}:${escapeXml(value)}`;
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

/**
 * Build graph data from vault index and state DB.
 * Exported for testing.
 */
export function buildGraphData(
  index: VaultIndex,
  stateDb: StateDb | null,
  options: { include_cooccurrence: boolean; min_edge_weight: number }
): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const noteIds = new Set<string>();
  const entityIds = new Set<string>();

  // --- Notes as nodes ---
  for (const [notePath, note] of index.notes) {
    const id = xmlId('note', notePath);
    noteIds.add(id);
    nodes.push({
      id,
      label: note.title,
      type: 'note',
      category: note.frontmatter?.type as string | undefined,
      modified: note.modified?.toISOString(),
      tags: note.tags.length > 0 ? note.tags.join(', ') : undefined,
    });
  }

  // --- Entities as nodes (from StateDb) ---
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

  // --- Wikilink edges (note → note, resolved) ---
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

  // --- Weighted edges (from note_links table) ---
  if (stateDb) {
    const rows = stateDb.db.prepare(
      'SELECT note_path, target, weight FROM note_links WHERE weight >= ?'
    ).all(options.min_edge_weight) as Array<{ note_path: string; target: string; weight: number }>;

    for (const row of rows) {
      const sourceId = xmlId('note', row.note_path);
      const targetLower = row.target.toLowerCase();
      // Target is a lowercased entity/note name — try to resolve
      let targetId: string | undefined;
      if (entityIds.has(xmlId('entity', row.target))) {
        targetId = xmlId('entity', row.target);
      } else {
        // Try case-insensitive entity match
        for (const n of nodes) {
          if (n.type === 'entity' && n.label.toLowerCase() === targetLower) {
            targetId = n.id;
            break;
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

  // --- Co-occurrence edges (entity ↔ entity) ---
  if (options.include_cooccurrence && stateDb) {
    const cached = loadCooccurrenceFromStateDb(stateDb);
    if (cached) {
      const cooc = cached.index;
      const seenCooc = new Set<string>();
      for (const [entityName, associations] of Object.entries(cooc.associations)) {
        const sourceId = xmlId('entity', entityName);
        if (!entityIds.has(sourceId)) continue;
        for (const [relatedName, count] of associations) {
          const targetId = xmlId('entity', relatedName);
          if (!entityIds.has(targetId)) continue;
          // Deduplicate bidirectional pairs
          const pairKey = [entityName, relatedName].sort().join('↔');
          if (seenCooc.has(pairKey)) continue;
          seenCooc.add(pairKey);
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

/** Serialize graph data to GraphML XML string */
export function toGraphML(data: GraphData): string {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<graphml xmlns="http://graphml.graphdrawing.org/xmlns"\n`;
  xml += `         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n`;
  xml += `         xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">\n`;

  // Attribute declarations
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

  // Nodes
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

  // Edges
  let edgeIdx = 0;
  for (const edge of data.edges) {
    xml += `    <edge id="e${edgeIdx++}" source="${escapeXml(edge.source)}" target="${escapeXml(edge.target)}">\n`;
    xml += dataTag('edge_type', edge.edge_type);
    xml += dataTag('weight', edge.weight);
    xml += `    </edge>\n`;
  }

  xml += `  </graph>\n`;
  xml += `</graphml>\n`;
  return xml;
}

/**
 * Register graph export tools with the MCP server
 */
export function registerGraphExportTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string,
  getStateDb?: () => StateDb | null
): void {
  server.tool(
    'export_graph',
    'Export the vault knowledge graph as GraphML (for Gephi/yEd/Cytoscape) or JSON. ' +
    'Includes notes, entities, wikilinks, edge weights, and co-occurrence relationships. ' +
    'Use the output with graph visualization tools to explore your vault structure.',
    {
      format: z.enum(['graphml', 'json']).default('graphml')
        .describe('Output format: "graphml" for graph tools (Gephi, yEd, Cytoscape), "json" for programmatic use'),
      include_cooccurrence: z.boolean().default(true)
        .describe('Include co-occurrence edges between entities'),
      min_edge_weight: z.number().default(0)
        .describe('Minimum edge weight threshold (filters weighted edges)'),
    },
    async ({ format, include_cooccurrence, min_edge_weight }) => {
      requireIndex();
      const index = getIndex();
      const stateDb = getStateDb?.() ?? null;

      const data = buildGraphData(index, stateDb, { include_cooccurrence, min_edge_weight });

      let output: string;
      if (format === 'json') {
        output = JSON.stringify(data, null, 2);
      } else {
        output = toGraphML(data);
      }

      return {
        content: [{
          type: 'text' as const,
          text: output,
        }],
      };
    }
  );
}
