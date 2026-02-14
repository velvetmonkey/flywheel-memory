/**
 * Temporal primitives - time-based vault intelligence
 *
 * Answer: "What happened when?"
 */

import type { VaultIndex } from '../../core/read/types.js';
import { getBacklinksForNote } from '../../core/read/graph.js';

/**
 * Get notes modified on a specific date
 */
export function getNotesModifiedOn(
  index: VaultIndex,
  date: string  // YYYY-MM-DD format
): Array<{
  path: string;
  title: string;
  created: Date | undefined;
  modified: Date;
}> {
  const targetDate = new Date(date);
  const targetDay = targetDate.toISOString().split('T')[0];

  const results: Array<{
    path: string;
    title: string;
    created: Date | undefined;
    modified: Date;
  }> = [];

  for (const note of index.notes.values()) {
    const noteDay = note.modified.toISOString().split('T')[0];
    if (noteDay === targetDay) {
      results.push({
        path: note.path,
        title: note.title,
        created: note.created,
        modified: note.modified,
      });
    }
  }

  // Sort by modified time (most recent first)
  return results.sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

/**
 * Get notes modified within a date range
 */
export function getNotesInRange(
  index: VaultIndex,
  startDate: string,  // YYYY-MM-DD
  endDate: string     // YYYY-MM-DD
): Array<{
  path: string;
  title: string;
  created: Date | undefined;
  modified: Date;
}> {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  const results: Array<{
    path: string;
    title: string;
    created: Date | undefined;
    modified: Date;
  }> = [];

  for (const note of index.notes.values()) {
    if (note.modified >= start && note.modified <= end) {
      results.push({
        path: note.path,
        title: note.title,
        created: note.created,
        modified: note.modified,
      });
    }
  }

  return results.sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

/**
 * Find stale notes - important but not recently touched
 */
export function getStaleNotes(
  index: VaultIndex,
  days: number,
  minBacklinks: number = 0
): Array<{
  path: string;
  title: string;
  backlink_count: number;
  days_since_modified: number;
  modified: Date;
}> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const results: Array<{
    path: string;
    title: string;
    backlink_count: number;
    days_since_modified: number;
    modified: Date;
  }> = [];

  for (const note of index.notes.values()) {
    if (note.modified < cutoff) {
      const backlinkCount = getBacklinksForNote(index, note.path).length;

      if (backlinkCount >= minBacklinks) {
        const daysSince = Math.floor(
          (Date.now() - note.modified.getTime()) / (1000 * 60 * 60 * 24)
        );

        results.push({
          path: note.path,
          title: note.title,
          backlink_count: backlinkCount,
          days_since_modified: daysSince,
          modified: note.modified,
        });
      }
    }
  }

  // Sort by backlink count (most important first), then by staleness
  return results.sort((a, b) => {
    if (b.backlink_count !== a.backlink_count) {
      return b.backlink_count - a.backlink_count;
    }
    return b.days_since_modified - a.days_since_modified;
  });
}

/**
 * Find notes edited around the same time as a given note
 */
export function getContemporaneousNotes(
  index: VaultIndex,
  path: string,
  hours: number = 24
): Array<{
  path: string;
  title: string;
  modified: Date;
  time_diff_hours: number;
}> {
  const targetNote = index.notes.get(path);
  if (!targetNote) {
    return [];
  }

  const targetTime = targetNote.modified.getTime();
  const windowMs = hours * 60 * 60 * 1000;

  const results: Array<{
    path: string;
    title: string;
    modified: Date;
    time_diff_hours: number;
  }> = [];

  for (const note of index.notes.values()) {
    if (note.path === path) continue;  // Skip the target note itself

    const timeDiff = Math.abs(note.modified.getTime() - targetTime);

    if (timeDiff <= windowMs) {
      results.push({
        path: note.path,
        title: note.title,
        modified: note.modified,
        time_diff_hours: Math.round(timeDiff / (1000 * 60 * 60) * 10) / 10,
      });
    }
  }

  // Sort by time difference (closest first)
  return results.sort((a, b) => a.time_diff_hours - b.time_diff_hours);
}

/**
 * Get activity summary for a period
 */
export function getActivitySummary(
  index: VaultIndex,
  days: number
): {
  period_days: number;
  notes_modified: number;
  notes_created: number;
  most_active_day: string | null;
  daily_counts: Record<string, number>;
} {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  cutoff.setHours(0, 0, 0, 0);

  const dailyCounts: Record<string, number> = {};
  let notesModified = 0;
  let notesCreated = 0;

  for (const note of index.notes.values()) {
    if (note.modified >= cutoff) {
      notesModified++;
      const day = note.modified.toISOString().split('T')[0];
      dailyCounts[day] = (dailyCounts[day] || 0) + 1;
    }

    if (note.created && note.created >= cutoff) {
      notesCreated++;
    }
  }

  // Find most active day
  let mostActiveDay: string | null = null;
  let maxCount = 0;
  for (const [day, count] of Object.entries(dailyCounts)) {
    if (count > maxCount) {
      maxCount = count;
      mostActiveDay = day;
    }
  }

  return {
    period_days: days,
    notes_modified: notesModified,
    notes_created: notesCreated,
    most_active_day: mostActiveDay,
    daily_counts: dailyCounts,
  };
}
