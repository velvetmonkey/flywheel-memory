/**
 * Vault statistics (arch-review S7) — doctor(action: stats) engine, moved
 * verbatim from tools/read/health.ts. Pure index computation.
 */

import type { VaultIndex } from '../read/types.js';
import { resolveTarget, getBacklinksForNote, findSimilarEntity } from '../read/graph.js';
import { getActivitySummary } from '../read/temporal.js';

export type VaultStatsOutput = {
  total_notes: number;
  total_links: number;
  total_tags: number;
  orphan_notes: {
    total: number;
    periodic: number;
    content: number;
  };
  broken_links: number;
  average_links_per_note: number;
  most_linked_notes: Array<{ path: string; backlinks: number }>;
  top_tags: Array<{ tag: string; count: number }>;
  folders: Array<{ folder: string; note_count: number }>;
  recent_activity: {
    period_days: number;
    notes_modified: number;
    notes_created: number;
    most_active_day: string | null;
    daily_counts: Record<string, number>;
  };
};

/**
 * Check if a note is a periodic note (daily, weekly, monthly, quarterly, yearly).
 * Periodic notes naturally have fewer backlinks - they're time-based, not topic-based.
 */
export function isPeriodicNote(path: string): boolean {
  const filename = path.split('/').pop() || '';
  const nameWithoutExt = filename.replace(/\.md$/, '');

  // Date patterns for periodic notes
  const patterns = [
    /^\d{4}-\d{2}-\d{2}$/,           // YYYY-MM-DD (daily)
    /^\d{4}-W\d{2}$/,                // YYYY-Wnn (weekly)
    /^\d{4}-\d{2}$/,                 // YYYY-MM (monthly)
    /^\d{4}-Q[1-4]$/,                // YYYY-Qn (quarterly)
    /^\d{4}$/,                       // YYYY (yearly)
  ];

  // Also check common folder names
  const periodicFolders = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'journal', 'journals'];
  const folder = path.split('/')[0]?.toLowerCase() || '';

  return patterns.some(p => p.test(nameWithoutExt)) || periodicFolders.includes(folder);
}

export function computeVaultStats(index: VaultIndex): VaultStatsOutput {

  // Count totals
  const totalNotes = index.notes.size;
  let totalLinks = 0;
  let brokenLinks = 0;
  let orphanTotal = 0;
  let orphanPeriodic = 0;
  let orphanContent = 0;

  // Count links and broken links (only count as broken if similar entity exists)
  for (const note of index.notes.values()) {
    totalLinks += note.outlinks.length;

    for (const link of note.outlinks) {
      if (!resolveTarget(index, link.target)) {
        // Only count as broken if there's a similar entity (typo detection)
        const similar = findSimilarEntity(index, link.target);
        if (similar) {
          brokenLinks++;
        }
      }
    }
  }

  // Count orphans, separating periodic notes from content notes
  for (const note of index.notes.values()) {
    const backlinks = getBacklinksForNote(index, note.path);
    if (backlinks.length === 0) {
      orphanTotal++;
      if (isPeriodicNote(note.path)) {
        orphanPeriodic++;
      } else {
        orphanContent++;
      }
    }
  }

  // Calculate most linked notes
  const linkCounts: Array<{ path: string; backlinks: number }> = [];
  for (const note of index.notes.values()) {
    const backlinks = getBacklinksForNote(index, note.path);
    if (backlinks.length > 0) {
      linkCounts.push({ path: note.path, backlinks: backlinks.length });
    }
  }
  linkCounts.sort((a, b) => b.backlinks - a.backlinks);
  const mostLinkedNotes = linkCounts.slice(0, 10);

  // Calculate top tags
  const tagStats: Array<{ tag: string; count: number }> = [];
  for (const [tag, notes] of index.tags) {
    tagStats.push({ tag, count: notes.size });
  }
  tagStats.sort((a, b) => b.count - a.count);
  const topTags = tagStats.slice(0, 20);

  // Calculate folder distribution
  const folderCounts = new Map<string, number>();
  for (const note of index.notes.values()) {
    const parts = note.path.split('/');
    const folder = parts.length > 1 ? parts[0] : '(root)';

    folderCounts.set(folder, (folderCounts.get(folder) || 0) + 1);
  }

  const folders = Array.from(folderCounts.entries())
    .map(([folder, count]) => ({ folder, note_count: count }))
    .sort((a, b) => b.note_count - a.note_count);

  // Get recent activity summary (last 7 days)
  const recentActivity = getActivitySummary(index, 7);

  const output: VaultStatsOutput = {
    total_notes: totalNotes,
    total_links: totalLinks,
    total_tags: index.tags.size,
    orphan_notes: {
      total: orphanTotal,
      periodic: orphanPeriodic,
      content: orphanContent,
    },
    broken_links: brokenLinks,
    average_links_per_note: totalNotes > 0 ? Math.round((totalLinks / totalNotes) * 100) / 100 : 0,
    most_linked_notes: mostLinkedNotes,
    top_tags: topTags,
    folders,
    recent_activity: recentActivity,
  };

  return output;
}
