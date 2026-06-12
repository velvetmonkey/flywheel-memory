/**
 * Shared note filtering helpers (arch-review S6).
 *
 * The modified_after/modified_before date-window filter was duplicated
 * verbatim between tools/read/query.ts and tools/read/find_notes.ts.
 * Single home here; both tools delegate.
 */

import type { VaultNote } from './types.js';

/**
 * Filter notes by a modification-date window. Date filters use the local
 * timezone — correct for Obsidian, which stores file modification times in
 * the local filesystem's timezone. `after` snaps to start-of-day,
 * `before` to end-of-day.
 */
export function filterByDateWindow(
  notes: VaultNote[],
  modifiedAfter?: string,
  modifiedBefore?: string,
): VaultNote[] {
  let matching = notes;
  if (modifiedAfter) {
    const afterDate = new Date(modifiedAfter);
    afterDate.setHours(0, 0, 0, 0); // Start of day, local timezone
    matching = matching.filter((note) => note.modified >= afterDate);
  }
  if (modifiedBefore) {
    const beforeDate = new Date(modifiedBefore);
    beforeDate.setHours(23, 59, 59, 999); // End of day, local timezone
    matching = matching.filter((note) => note.modified <= beforeDate);
  }
  return matching;
}
