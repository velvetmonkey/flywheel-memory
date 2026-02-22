/**
 * Event queue with per-path debouncing and event coalescing
 *
 * Features:
 * - Per-path debounce: Each path has its own debounce timer
 * - Event coalescing: Multiple events on same path merge into one
 * - Batch flush: Events are batched for efficient processing
 */

import * as path from 'path';
import type {
  WatchEvent,
  WatchEventType,
  CoalescedEvent,
  CoalescedEventType,
  EventBatch,
  RenameEvent,
  WatcherConfig,
} from './types.js';
import { normalizePath } from './pathFilter.js';

/**
 * Pending events for a single path
 */
interface PendingPath {
  events: WatchEvent[];
  timer: NodeJS.Timeout | null;
  lastEvent: number;
}

/**
 * Coalesce multiple events on the same path into a single action
 *
 * Rules:
 * - add + change = upsert (file created and modified)
 * - change + change = upsert (file modified multiple times)
 * - add + unlink = nothing (file created then deleted - net zero)
 * - unlink = delete
 * - unlink + add = upsert (file deleted then recreated - treat as update)
 */
function coalesceEvents(events: WatchEvent[]): CoalescedEventType | null {
  if (events.length === 0) return null;

  // Get the sequence of event types
  const types = events.map(e => e.type);

  // Check if we end with unlink and no add after
  const lastUnlink = types.lastIndexOf('unlink');
  const lastAdd = types.lastIndexOf('add');
  const lastChange = types.lastIndexOf('change');

  // If the last significant event is unlink (and no add/change after), it's a delete
  if (lastUnlink > lastAdd && lastUnlink > lastChange) {
    return 'delete';
  }

  // If we have any add or change, and don't end with unlink, it's an upsert
  if (lastAdd >= 0 || lastChange >= 0) {
    return 'upsert';
  }

  // Edge case: only unlink events
  if (types.every(t => t === 'unlink')) {
    return 'delete';
  }

  return null;
}

/** Maximum milliseconds between a delete and add to be considered a rename pair */
const RENAME_PROXIMITY_MS = 5000;

/**
 * Get the file stem (basename without extension)
 */
function fileStem(p: string): string {
  return path.basename(p).replace(/\.[^.]+$/, '');
}

/**
 * Detect rename pairs within a batch of coalesced events.
 *
 * A rename = one 'delete' event + one 'upsert' event where:
 * - Both have the same file stem (basename without extension)
 * - The timestamps of their latest raw events are within RENAME_PROXIMITY_MS
 *
 * When multiple deletes or upserts share the same stem, the pair with the
 * closest timestamp delta is chosen.
 *
 * Returns matched renames and the remaining non-rename events.
 */
function detectRenames(events: CoalescedEvent[]): {
  nonRenameEvents: CoalescedEvent[];
  renames: RenameEvent[];
} {
  const deletes = events.filter(e => e.type === 'delete');
  const upserts = events.filter(e => e.type === 'upsert');
  const others = events.filter(e => e.type !== 'delete' && e.type !== 'upsert');

  const usedDeletes = new Set<string>();
  const usedUpserts = new Set<string>();
  const renames: RenameEvent[] = [];

  // For each delete, find the best matching upsert by stem + timestamp proximity
  for (const del of deletes) {
    const stem = fileStem(del.path);
    const delTimestamp = del.originalEvents.length > 0
      ? Math.max(...del.originalEvents.map(e => e.timestamp))
      : 0;

    // Gather candidate upserts with the same stem not yet used
    const candidates = upserts.filter(u =>
      !usedUpserts.has(u.path) &&
      fileStem(u.path) === stem
    );

    if (candidates.length === 0) continue;

    // Pick the candidate with the smallest timestamp delta within the proximity window
    let bestCandidate: CoalescedEvent | null = null;
    let bestDelta = Infinity;

    for (const candidate of candidates) {
      const addTimestamp = candidate.originalEvents.length > 0
        ? Math.max(...candidate.originalEvents.map(e => e.timestamp))
        : 0;
      const delta = Math.abs(addTimestamp - delTimestamp);
      if (delta <= RENAME_PROXIMITY_MS && delta < bestDelta) {
        bestDelta = delta;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate) {
      usedDeletes.add(del.path);
      usedUpserts.add(bestCandidate.path);
      renames.push({
        type: 'rename',
        oldPath: del.path,
        newPath: bestCandidate.path,
        timestamp: Date.now(),
      });
    }
  }

  // Non-rename events = deletes and upserts not matched + others
  const nonRenameEvents: CoalescedEvent[] = [
    ...deletes.filter(e => !usedDeletes.has(e.path)),
    ...upserts.filter(e => !usedUpserts.has(e.path)),
    ...others,
  ];

  return { nonRenameEvents, renames };
}

/**
 * Event queue that batches and coalesces file events
 */
export class EventQueue {
  private pending: Map<string, PendingPath> = new Map();
  private config: WatcherConfig;
  private flushTimer: NodeJS.Timeout | null = null;
  private onBatch: (batch: EventBatch) => void;

  constructor(config: WatcherConfig, onBatch: (batch: EventBatch) => void) {
    this.config = config;
    this.onBatch = onBatch;
  }

  /**
   * Add a new event to the queue
   */
  push(type: WatchEventType, rawPath: string): void {
    const path = normalizePath(rawPath);
    const now = Date.now();

    const event: WatchEvent = {
      type,
      path,
      timestamp: now,
    };

    let pending = this.pending.get(path);
    if (!pending) {
      pending = {
        events: [],
        timer: null,
        lastEvent: now,
      };
      this.pending.set(path, pending);
    }

    // Add event to path's queue
    pending.events.push(event);
    pending.lastEvent = now;
    console.error(`[flywheel] QUEUE: pushed ${type} for ${path}, pending=${this.pending.size}`);

    // Clear existing per-path timer
    if (pending.timer) {
      clearTimeout(pending.timer);
    }

    // Set new per-path debounce timer
    pending.timer = setTimeout(() => {
      this.flushPath(path);
    }, this.config.debounceMs);

    // Check if we need to force flush due to batch size
    if (this.pending.size >= this.config.batchSize) {
      this.flush();
      return;
    }

    // Ensure flush timer is running
    this.ensureFlushTimer();
  }

  /**
   * Ensure the global flush timer is running
   */
  private ensureFlushTimer(): void {
    if (this.flushTimer) return;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, this.config.flushMs);
  }

  /**
   * Flush a single path's events
   */
  private flushPath(path: string): void {
    const pending = this.pending.get(path);
    if (!pending || pending.events.length === 0) return;
    console.error(`[flywheel] QUEUE: flushing ${path}, events=${pending.events.length}`);

    // Clear the path timer
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }

    // Coalesce events
    const coalescedType = coalesceEvents(pending.events);

    if (coalescedType) {
      const coalesced: CoalescedEvent = {
        type: coalescedType,
        path,
        originalEvents: [...pending.events],
      };

      // Send as single-event batch (no rename detection for single-path flushes)
      this.onBatch({
        events: [coalesced],
        renames: [],
        timestamp: Date.now(),
      });
    }

    // Clear the path
    this.pending.delete(path);
  }

  /**
   * Flush all pending events
   */
  flush(): void {
    // Clear flush timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.pending.size === 0) return;

    const events: CoalescedEvent[] = [];

    for (const [path, pending] of this.pending) {
      // Clear path timer
      if (pending.timer) {
        clearTimeout(pending.timer);
      }

      // Coalesce events
      const coalescedType = coalesceEvents(pending.events);

      if (coalescedType) {
        events.push({
          type: coalescedType,
          path,
          originalEvents: [...pending.events],
        });
      }
    }

    // Clear all pending
    this.pending.clear();

    // Send batch if we have events
    if (events.length > 0) {
      const { nonRenameEvents, renames } = detectRenames(events);
      this.onBatch({
        events: nonRenameEvents,
        renames,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Get the number of pending paths
   */
  get size(): number {
    return this.pending.size;
  }

  /**
   * Get the total number of pending events
   */
  get eventCount(): number {
    let count = 0;
    for (const pending of this.pending.values()) {
      count += pending.events.length;
    }
    return count;
  }

  /**
   * Clear all pending events without processing
   */
  clear(): void {
    // Clear all timers
    for (const pending of this.pending.values()) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pending.clear();
  }

  /**
   * Dispose the queue
   */
  dispose(): void {
    this.clear();
  }
}
