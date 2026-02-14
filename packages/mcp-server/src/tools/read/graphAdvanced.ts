/**
 * Advanced graph primitives - path finding and relationship analysis
 *
 * Answer: "How do notes connect?"
 */

import type { VaultIndex, Backlink } from '../../core/read/types.js';
import { getBacklinksForNote, resolveTarget } from '../../core/read/graph.js';

/**
 * Find shortest path between two notes using BFS
 */
export function getLinkPath(
  index: VaultIndex,
  fromPath: string,
  toPath: string,
  maxDepth: number = 10
): {
  exists: boolean;
  path: string[];
  length: number;
} {
  // Normalize paths
  const from = index.notes.has(fromPath) ? fromPath : resolveTarget(index, fromPath);
  const to = index.notes.has(toPath) ? toPath : resolveTarget(index, toPath);

  if (!from || !to) {
    return { exists: false, path: [], length: -1 };
  }

  if (from === to) {
    return { exists: true, path: [from], length: 0 };
  }

  // BFS to find shortest path
  const visited = new Set<string>();
  const queue: { path: string[]; current: string }[] = [{ path: [from], current: from }];

  while (queue.length > 0) {
    const { path: currentPath, current } = queue.shift()!;

    if (currentPath.length > maxDepth) {
      continue;
    }

    const note = index.notes.get(current);
    if (!note) continue;

    // Get all outlinks from current note
    for (const link of note.outlinks) {
      const targetPath = resolveTarget(index, link.target);
      if (!targetPath) continue;

      if (targetPath === to) {
        const fullPath = [...currentPath, targetPath];
        return {
          exists: true,
          path: fullPath,
          length: fullPath.length - 1,
        };
      }

      if (!visited.has(targetPath)) {
        visited.add(targetPath);
        queue.push({
          path: [...currentPath, targetPath],
          current: targetPath,
        });
      }
    }
  }

  return { exists: false, path: [], length: -1 };
}

/**
 * Find notes that both A and B link to (common neighbors)
 */
export function getCommonNeighbors(
  index: VaultIndex,
  noteAPath: string,
  noteBPath: string
): Array<{
  path: string;
  title: string;
  linked_from_a_line: number;
  linked_from_b_line: number;
}> {
  const noteA = index.notes.get(noteAPath);
  const noteB = index.notes.get(noteBPath);

  if (!noteA || !noteB) return [];

  // Get targets from A
  const aTargets = new Map<string, number>();
  for (const link of noteA.outlinks) {
    const resolved = resolveTarget(index, link.target);
    if (resolved) {
      aTargets.set(resolved, link.line);
    }
  }

  // Find overlap with B
  const common: Array<{
    path: string;
    title: string;
    linked_from_a_line: number;
    linked_from_b_line: number;
  }> = [];

  for (const link of noteB.outlinks) {
    const resolved = resolveTarget(index, link.target);
    if (resolved && aTargets.has(resolved)) {
      const targetNote = index.notes.get(resolved);
      if (targetNote) {
        common.push({
          path: resolved,
          title: targetNote.title,
          linked_from_a_line: aTargets.get(resolved)!,
          linked_from_b_line: link.line,
        });
      }
    }
  }

  return common;
}

/**
 * Find bidirectional links (A links to B AND B links to A)
 */
export function findBidirectionalLinks(
  index: VaultIndex,
  notePath?: string
): Array<{
  noteA: string;
  noteB: string;
  a_to_b_line: number;
  b_to_a_line: number;
}> {
  const results: Array<{
    noteA: string;
    noteB: string;
    a_to_b_line: number;
    b_to_a_line: number;
  }> = [];

  const seen = new Set<string>();

  const notesToCheck = notePath
    ? [index.notes.get(notePath)].filter(Boolean)
    : Array.from(index.notes.values());

  for (const noteA of notesToCheck) {
    if (!noteA) continue;

    for (const linkFromA of noteA.outlinks) {
      const targetPath = resolveTarget(index, linkFromA.target);
      if (!targetPath) continue;

      const noteB = index.notes.get(targetPath);
      if (!noteB) continue;

      // Check if B links back to A
      for (const linkFromB of noteB.outlinks) {
        const backTarget = resolveTarget(index, linkFromB.target);
        if (backTarget === noteA.path) {
          // Found bidirectional link
          const pairKey = [noteA.path, noteB.path].sort().join('|');
          if (!seen.has(pairKey)) {
            seen.add(pairKey);
            results.push({
              noteA: noteA.path,
              noteB: noteB.path,
              a_to_b_line: linkFromA.line,
              b_to_a_line: linkFromB.line,
            });
          }
        }
      }
    }
  }

  return results;
}

/**
 * Find notes with only inbound links (dead ends - consume but don't contribute)
 */
export function findDeadEnds(
  index: VaultIndex,
  folder?: string,
  minBacklinks: number = 1
): Array<{
  path: string;
  title: string;
  backlink_count: number;
}> {
  const results: Array<{
    path: string;
    title: string;
    backlink_count: number;
  }> = [];

  for (const note of index.notes.values()) {
    if (folder && !note.path.startsWith(folder)) continue;

    // Has no outlinks
    if (note.outlinks.length === 0) {
      const backlinkCount = getBacklinksForNote(index, note.path).length;

      // But has backlinks
      if (backlinkCount >= minBacklinks) {
        results.push({
          path: note.path,
          title: note.title,
          backlink_count: backlinkCount,
        });
      }
    }
  }

  return results.sort((a, b) => b.backlink_count - a.backlink_count);
}

/**
 * Find notes with only outbound links (sources - contribute but aren't referenced)
 */
export function findSources(
  index: VaultIndex,
  folder?: string,
  minOutlinks: number = 1
): Array<{
  path: string;
  title: string;
  outlink_count: number;
}> {
  const results: Array<{
    path: string;
    title: string;
    outlink_count: number;
  }> = [];

  for (const note of index.notes.values()) {
    if (folder && !note.path.startsWith(folder)) continue;

    const backlinkCount = getBacklinksForNote(index, note.path).length;

    // Has outlinks but no backlinks
    if (note.outlinks.length >= minOutlinks && backlinkCount === 0) {
      results.push({
        path: note.path,
        title: note.title,
        outlink_count: note.outlinks.length,
      });
    }
  }

  return results.sort((a, b) => b.outlink_count - a.outlink_count);
}

/**
 * Get link context - the paragraph containing a specific link
 */
export async function getLinkContext(
  index: VaultIndex,
  sourcePath: string,
  targetPath: string,
  vaultPath: string
): Promise<Array<{
  line: number;
  context: string;
}>> {
  const note = index.notes.get(sourcePath);
  if (!note) return [];

  const fs = await import('fs');
  const path = await import('path');

  const absolutePath = path.join(vaultPath, sourcePath);
  let content: string;

  try {
    content = await fs.promises.readFile(absolutePath, 'utf-8');
  } catch {
    return [];
  }

  const lines = content.split('\n');
  const results: Array<{ line: number; context: string }> = [];

  // Find links to the target
  for (const link of note.outlinks) {
    const resolved = resolveTarget(index, link.target);
    if (resolved === targetPath || link.target.toLowerCase() === targetPath.toLowerCase().replace(/\.md$/, '')) {
      // Get surrounding lines for context
      const startLine = Math.max(0, link.line - 2);
      const endLine = Math.min(lines.length - 1, link.line + 1);
      const context = lines.slice(startLine, endLine + 1).join('\n');

      results.push({
        line: link.line,
        context,
      });
    }
  }

  return results;
}

/**
 * Calculate connection strength between two notes
 * Based on: mutual links, shared tags, shared outlinks, proximity in hierarchy
 */
export function getConnectionStrength(
  index: VaultIndex,
  noteAPath: string,
  noteBPath: string
): {
  score: number;
  factors: {
    mutual_link: boolean;
    shared_tags: string[];
    shared_outlinks: number;
    same_folder: boolean;
  };
} {
  const noteA = index.notes.get(noteAPath);
  const noteB = index.notes.get(noteBPath);

  if (!noteA || !noteB) {
    return {
      score: 0,
      factors: {
        mutual_link: false,
        shared_tags: [],
        shared_outlinks: 0,
        same_folder: false,
      },
    };
  }

  let score = 0;
  const factors = {
    mutual_link: false,
    shared_tags: [] as string[],
    shared_outlinks: 0,
    same_folder: false,
  };

  // Check mutual link (+3)
  const aLinksToB = noteA.outlinks.some(l => {
    const resolved = resolveTarget(index, l.target);
    return resolved === noteBPath;
  });
  const bLinksToA = noteB.outlinks.some(l => {
    const resolved = resolveTarget(index, l.target);
    return resolved === noteAPath;
  });

  if (aLinksToB && bLinksToA) {
    factors.mutual_link = true;
    score += 3;
  } else if (aLinksToB || bLinksToA) {
    score += 1;
  }

  // Shared tags (+1 each)
  const tagsA = new Set(noteA.tags);
  for (const tag of noteB.tags) {
    if (tagsA.has(tag)) {
      factors.shared_tags.push(tag);
      score += 1;
    }
  }

  // Shared outlinks (+0.5 each)
  const common = getCommonNeighbors(index, noteAPath, noteBPath);
  factors.shared_outlinks = common.length;
  score += common.length * 0.5;

  // Same folder (+1)
  const folderA = noteAPath.split('/').slice(0, -1).join('/');
  const folderB = noteBPath.split('/').slice(0, -1).join('/');
  if (folderA === folderB && folderA !== '') {
    factors.same_folder = true;
    score += 1;
  }

  return { score, factors };
}
