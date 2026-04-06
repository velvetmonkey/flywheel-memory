/**
 * Shared enrichment functions for search and recall results.
 *
 * Extracted from query.ts so that recall.ts can reuse the same
 * metadata enrichment without duplicating logic.
 */

import type { VaultIndex, VaultNote } from '../shared/types.js';
import {
  getEntityByName,
  type StateDb,
} from '@velvetmonkey/vault-core';
import { getInboundTargetsForNote } from './identity.js';
import { getContentPreview } from './fts5.js';

export const TOP_LINKS = 10;
const RECALL_TOP_LINKS = 5;

/** Time decay — 180-day half-life for edge weight recency */
export function recencyDecay(modifiedDate: Date | undefined): number {
  if (!modifiedDate) return 0.5; // unknown → neutral
  const daysSince = (Date.now() - modifiedDate.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0.1, 1.0 - daysSince / 180);
}

/**
 * Look up linked-item metadata for a note path.
 * Returns type, status, tags from VaultNote + category, description from entity table.
 */
function getLinkedItemMeta(
  notePath: string,
  index: VaultIndex,
  stateDb: StateDb | null,
): Record<string, unknown> | null {
  const note = index.notes.get(notePath);
  if (!note) return null;

  const meta: Record<string, unknown> = {};
  const fm = note.frontmatter;
  if (fm.type) meta.type = fm.type;
  if (fm.status) meta.status = fm.status;
  if (note.tags.length > 0) meta.tags = note.tags;

  // Entity metadata (category + description)
  if (stateDb) {
    try {
      const entity = getEntityByName(stateDb, note.title);
      if (entity) {
        meta.category = entity.category;
        if (entity.description) meta.description = entity.description;
      }
    } catch { /* best-effort */ }
  }

  // Content preview fallback when no entity description available
  if (!meta.description) {
    const preview = getContentPreview(notePath, 150);
    if (preview) meta.preview = preview;
  }

  return Object.keys(meta).length > 0 ? meta : null;
}

/**
 * Resolve a link target (entity name) to a note path via the index.
 */
function resolveTargetPath(target: string, index: VaultIndex): string | null {
  const entityPath = index.entities.get(target.toLowerCase());
  return entityPath ?? null;
}

export function rankOutlinks(
  outlinks: Array<{ target: string; line: number; alias?: string }>,
  notePath: string,
  index: VaultIndex,
  stateDb: StateDb | null,
  maxLinks: number = TOP_LINKS,
): Array<Record<string, unknown>> {
  const weightMap = new Map<string, number>();
  if (stateDb) {
    try {
      const rows = stateDb.db.prepare(
        'SELECT target, weight, weight_updated_at FROM note_links WHERE note_path = ?'
      ).all(notePath) as Array<{ target: string; weight: number; weight_updated_at: number | null }>;
      for (const row of rows) {
        const daysSince = row.weight_updated_at
          ? (Date.now() - row.weight_updated_at) / (1000 * 60 * 60 * 24)
          : 0;
        const decay = Math.max(0.1, 1.0 - daysSince / 180);
        weightMap.set(row.target, row.weight * decay);
      }
    } catch { /* best-effort */ }
  }

  return outlinks
    .map(l => {
      const targetLower = l.target.toLowerCase();
      const exists = index.entities.has(targetLower);
      const weight = weightMap.get(targetLower) ?? 1.0;
      const out: Record<string, unknown> = { target: l.target, exists };
      if (weight > 1.0) out.weight = Math.round(weight * 100) / 100;
      if (l.alias) out.alias = l.alias;

      // Linked-item metadata
      if (exists) {
        const targetPath = resolveTargetPath(l.target, index);
        if (targetPath) {
          const meta = getLinkedItemMeta(targetPath, index, stateDb);
          if (meta) Object.assign(out, meta);
        }
      }

      return out;
    })
    .sort((a, b) => ((b.weight as number) ?? 1) - ((a.weight as number) ?? 1))
    .slice(0, maxLinks);
}

export function rankBacklinks(
  backlinks: Array<{ source: string; line: number }>,
  notePath: string,
  index: VaultIndex,
  stateDb: StateDb | null,
  maxLinks: number = TOP_LINKS,
): Array<Record<string, unknown>> {
  const targets = getInboundTargetsForNote(stateDb, notePath);

  const weightMap = new Map<string, number>();
  if (stateDb && targets.length > 0) {
    try {
      const placeholders = targets.map(() => '?').join(',');
      const rows = stateDb.db.prepare(
        `SELECT note_path, weight FROM note_links WHERE target IN (${placeholders})`
      ).all(...targets) as Array<{ note_path: string; weight: number }>;
      for (const row of rows) {
        const existing = weightMap.get(row.note_path) ?? 0;
        weightMap.set(row.note_path, Math.max(existing, row.weight));
      }
    } catch { /* best-effort */ }
  }

  return backlinks
    .map(bl => {
      const edgeWeight = weightMap.get(bl.source) ?? 1.0;
      const sourceNote = index.notes.get(bl.source);
      const decay = recencyDecay(sourceNote?.modified);
      const score = edgeWeight * decay;
      const out: Record<string, unknown> = { source: bl.source };
      if (score > 1.0) out.weight = Math.round(score * 100) / 100;

      // Linked-item metadata
      const meta = getLinkedItemMeta(bl.source, index, stateDb);
      if (meta) Object.assign(out, meta);

      return out;
    })
    .sort((a, b) => ((b.weight as number) ?? 1) - ((a.weight as number) ?? 1))
    .slice(0, maxLinks);
}

export const COMPACT_OUTLINK_NAMES = 5;

/**
 * Compact enrichment for all results (primary + multi-hop).
 * Returns: path, title, snippet, category, hub_score, modified, backlink_count,
 * outlink_names[] (just names, sorted by edge weight), tags.
 *
 * Compared to enrichResult(): removes full backlinks[]/outlinks[] arrays with
 * per-link metadata, frontmatter object, and aliases. Saves ~75% tokens per result.
 * Every result gets a snippet (FTS5 match, content preview, or entity description).
 */
export function enrichResultCompact(
  result: { path: string; title: string; snippet?: string },
  index: VaultIndex,
  stateDb: StateDb | null,
  opts?: { via?: string; hop?: number },
): Record<string, unknown> {
  const note = index.notes.get(result.path);
  const normalizedPath = result.path.toLowerCase().replace(/\.md$/, '');
  const backlinks = index.backlinks.get(normalizedPath) || [];

  const enriched: Record<string, unknown> = {
    path: result.path,
    title: result.title,
  };

  // Snippet: FTS5 match > content preview > entity description
  if (result.snippet) {
    enriched.snippet = result.snippet;
  } else {
    const preview = getContentPreview(result.path);
    if (preview) enriched.snippet = preview;
  }

  // From VaultIndex (in-memory)
  if (note) {
    if (Object.keys(note.frontmatter).length > 0) enriched.frontmatter = note.frontmatter;
    enriched.backlink_count = backlinks.length;
    enriched.modified = note.modified.toISOString();
    if (note.tags.length > 0) enriched.tags = note.tags;

    // Outlink names only (sorted by edge weight if available)
    if (note.outlinks.length > 0) {
      enriched.outlink_names = getOutlinkNames(note.outlinks, result.path, index, stateDb, COMPACT_OUTLINK_NAMES);
    }
  }

  // From StateDb entity table (single row lookup)
  if (stateDb) {
    try {
      const entity = getEntityByName(stateDb, result.title);
      if (entity) {
        enriched.category = entity.category;
        enriched.hub_score = entity.hubScore;
        // Use entity description as fallback snippet
        if (!enriched.snippet && entity.description) {
          enriched.snippet = entity.description;
        }
      }
    } catch { /* entity lookup is best-effort */ }
  }

  // Multi-hop provenance
  if (opts?.via) enriched.via = opts.via;
  if (opts?.hop) enriched.hop = opts.hop;

  return enriched;
}

/**
 * Get outlink target names sorted by edge weight (descending).
 * Returns just string[] — no per-link metadata, no DB lookups per link.
 */
function getOutlinkNames(
  outlinks: Array<{ target: string; line: number; alias?: string }>,
  notePath: string,
  index: VaultIndex,
  stateDb: StateDb | null,
  max: number,
): string[] {
  // Load edge weights if available (single query for all outlinks)
  const weightMap = new Map<string, number>();
  if (stateDb) {
    try {
      const rows = stateDb.db.prepare(
        'SELECT target, weight, weight_updated_at FROM note_links WHERE note_path = ?'
      ).all(notePath) as Array<{ target: string; weight: number; weight_updated_at: number | null }>;
      for (const row of rows) {
        const daysSince = row.weight_updated_at
          ? (Date.now() - row.weight_updated_at) / (1000 * 60 * 60 * 24)
          : 0;
        const decay = Math.max(0.1, 1.0 - daysSince / 180);
        weightMap.set(row.target, row.weight * decay);
      }
    } catch { /* best-effort */ }
  }

  return outlinks
    .map(l => ({ name: l.target, weight: weightMap.get(l.target.toLowerCase()) ?? 1.0 }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, max)
    .map(l => l.name);
}

/**
 * Enrich a search result with indexed metadata (zero extra I/O).
 * Looks up VaultNote from index and entity metadata from StateDb.
 */
export function enrichResult(
  result: { path: string; title: string; snippet?: string },
  index: VaultIndex,
  stateDb: StateDb | null
): Record<string, unknown> {
  const note = index.notes.get(result.path);
  const normalizedPath = result.path.toLowerCase().replace(/\.md$/, '');
  const backlinks = index.backlinks.get(normalizedPath) || [];

  const enriched: Record<string, unknown> = {
    path: result.path,
    title: result.title,
  };

  if (result.snippet) enriched.snippet = result.snippet;

  // From VaultIndex (in-memory)
  if (note) {
    enriched.frontmatter = note.frontmatter;
    enriched.tags = note.tags;
    enriched.aliases = note.aliases;
    enriched.backlink_count = backlinks.length;
    enriched.backlinks = rankBacklinks(backlinks, result.path, index, stateDb);
    enriched.outlink_count = note.outlinks.length;
    enriched.outlinks = rankOutlinks(note.outlinks, result.path, index, stateDb);
    enriched.modified = note.modified.toISOString();
    if (note.created) enriched.created = note.created.toISOString();
  }

  // From StateDb entity table (single row lookup)
  if (stateDb) {
    try {
      const entity = getEntityByName(stateDb, result.title);
      if (entity) {
        enriched.category = entity.category;
        enriched.hub_score = entity.hubScore;
        if (entity.description) enriched.description = entity.description;
      }
    } catch { /* entity lookup is best-effort */ }
  }

  // Content preview fallback for non-FTS results (entity/metadata matches)
  if (!result.snippet) {
    const preview = getContentPreview(result.path);
    if (preview) enriched.content_preview = preview;
  }

  return enriched;
}

/**
 * Lightweight enrichment for lower-ranked results.
 * Returns only: path, title, snippet/content_preview, backlink_count, outlink_count, category, hub_score, modified.
 */
export function enrichResultLight(
  result: { path: string; title: string; snippet?: string },
  index: VaultIndex,
  stateDb: StateDb | null
): Record<string, unknown> {
  const note = index.notes.get(result.path);
  const normalizedPath = result.path.toLowerCase().replace(/\.md$/, '');
  const backlinks = index.backlinks.get(normalizedPath) || [];

  const enriched: Record<string, unknown> = {
    path: result.path,
    title: result.title,
  };

  if (result.snippet) enriched.snippet = result.snippet;

  if (note) {
    enriched.backlink_count = backlinks.length;
    enriched.outlink_count = note.outlinks.length;
    enriched.modified = note.modified.toISOString();
  }

  if (stateDb) {
    try {
      const entity = getEntityByName(stateDb, result.title);
      if (entity) {
        enriched.category = entity.category;
        enriched.hub_score = entity.hubScore;
      }
    } catch { /* entity lookup is best-effort */ }
  }

  if (!result.snippet) {
    const preview = getContentPreview(result.path);
    if (preview) enriched.content_preview = preview;
  }

  return enriched;
}

/**
 * Enrich an entity result from recall with vault metadata.
 * Adds: category, hub_score, aliases, path, backlink/outlink counts, top links, tags.
 */
export function enrichEntityResult(
  entityName: string,
  stateDb: StateDb | null,
  index: VaultIndex | null,
): Record<string, unknown> {
  const enriched: Record<string, unknown> = {};

  // Entity table data
  if (stateDb) {
    try {
      const entity = getEntityByName(stateDb, entityName);
      if (entity) {
        enriched.category = entity.category;
        enriched.hub_score = entity.hubScore;
        if (entity.aliases.length > 0) enriched.aliases = entity.aliases;
        enriched.path = entity.path;
      }
    } catch { /* best-effort */ }
  }

  // VaultIndex data (backlinks, outlinks, tags)
  if (index) {
    const entityPath = (enriched.path as string) ?? index.entities.get(entityName.toLowerCase());
    if (entityPath) {
      const note = index.notes.get(entityPath);
      const normalizedPath = entityPath.toLowerCase().replace(/\.md$/, '');
      const backlinks = index.backlinks.get(normalizedPath) || [];

      enriched.backlink_count = backlinks.length;
      if (note) {
        enriched.outlink_count = note.outlinks.length;
        if (note.tags.length > 0) enriched.tags = note.tags;

        // Top links (capped at RECALL_TOP_LINKS for smaller payloads)
        if (backlinks.length > 0) {
          enriched.top_backlinks = rankBacklinks(backlinks, entityPath, index, stateDb, RECALL_TOP_LINKS);
        }
        if (note.outlinks.length > 0) {
          enriched.top_outlinks = rankOutlinks(note.outlinks, entityPath, index, stateDb, RECALL_TOP_LINKS);
        }
      }
    }
  }

  return enriched;
}

/**
 * Enrich a note result from recall with vault metadata.
 * Adds: frontmatter, tags, category, hub_score, backlink/outlink counts, modified.
 */
export function enrichNoteResult(
  notePath: string,
  stateDb: StateDb | null,
  index: VaultIndex | null,
): Record<string, unknown> {
  const enriched: Record<string, unknown> = {};

  if (!index) return enriched;

  const note = index.notes.get(notePath);
  if (!note) return enriched;

  const normalizedPath = notePath.toLowerCase().replace(/\.md$/, '');
  const backlinks = index.backlinks.get(normalizedPath) || [];

  enriched.frontmatter = note.frontmatter;
  if (note.tags.length > 0) enriched.tags = note.tags;
  enriched.backlink_count = backlinks.length;
  enriched.outlink_count = note.outlinks.length;
  enriched.modified = note.modified.toISOString();

  // Top links (capped at RECALL_TOP_LINKS for smaller payloads)
  if (backlinks.length > 0) {
    enriched.top_backlinks = rankBacklinks(backlinks, notePath, index, stateDb, RECALL_TOP_LINKS);
  }
  if (note.outlinks.length > 0) {
    enriched.top_outlinks = rankOutlinks(note.outlinks, notePath, index, stateDb, RECALL_TOP_LINKS);
  }

  if (stateDb) {
    try {
      const entity = getEntityByName(stateDb, note.title);
      if (entity) {
        enriched.category = entity.category;
        enriched.hub_score = entity.hubScore;
      }
    } catch { /* best-effort */ }
  }

  return enriched;
}

/**
 * Compact enrichment for entity results from recall.
 * Returns: category, hub_score, aliases, path, backlink_count, outlink_names[], tags.
 * Removes top_backlinks/top_outlinks full arrays.
 */
export function enrichEntityCompact(
  entityName: string,
  stateDb: StateDb | null,
  index: VaultIndex | null,
): Record<string, unknown> {
  const enriched: Record<string, unknown> = {};

  if (stateDb) {
    try {
      const entity = getEntityByName(stateDb, entityName);
      if (entity) {
        enriched.category = entity.category;
        enriched.hub_score = entity.hubScore;
        if (entity.aliases.length > 0) enriched.aliases = entity.aliases;
        enriched.path = entity.path;
      }
    } catch { /* best-effort */ }
  }

  if (index) {
    const entityPath = (enriched.path as string) ?? index.entities.get(entityName.toLowerCase());
    if (entityPath) {
      const note = index.notes.get(entityPath);
      const normalizedPath = entityPath.toLowerCase().replace(/\.md$/, '');
      const backlinks = index.backlinks.get(normalizedPath) || [];

      enriched.backlink_count = backlinks.length;
      if (note) {
        if (Object.keys(note.frontmatter).length > 0) enriched.frontmatter = note.frontmatter;
        if (note.tags.length > 0) enriched.tags = note.tags;
        if (note.outlinks.length > 0) {
          enriched.outlink_names = getOutlinkNames(note.outlinks, entityPath, index, stateDb, COMPACT_OUTLINK_NAMES);
        }
      }
    }
  }

  return enriched;
}

/**
 * Compact enrichment for note results from recall.
 * Returns: frontmatter, tags, category, hub_score, backlink_count, outlink_names[], modified.
 * Removes top_backlinks/top_outlinks full arrays.
 */
export function enrichNoteCompact(
  notePath: string,
  stateDb: StateDb | null,
  index: VaultIndex | null,
): Record<string, unknown> {
  const enriched: Record<string, unknown> = {};
  if (!index) return enriched;

  const note = index.notes.get(notePath);
  if (!note) return enriched;

  const normalizedPath = notePath.toLowerCase().replace(/\.md$/, '');
  const backlinks = index.backlinks.get(normalizedPath) || [];

  if (Object.keys(note.frontmatter).length > 0) enriched.frontmatter = note.frontmatter;
  if (note.tags.length > 0) enriched.tags = note.tags;
  enriched.backlink_count = backlinks.length;
  enriched.modified = note.modified.toISOString();

  if (note.outlinks.length > 0) {
    enriched.outlink_names = getOutlinkNames(note.outlinks, notePath, index, stateDb, COMPACT_OUTLINK_NAMES);
  }

  if (stateDb) {
    try {
      const entity = getEntityByName(stateDb, note.title);
      if (entity) {
        enriched.category = entity.category;
        enriched.hub_score = entity.hubScore;
      }
    } catch { /* best-effort */ }
  }

  return enriched;
}
