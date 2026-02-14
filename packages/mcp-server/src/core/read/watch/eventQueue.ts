/**
 * Event queue with per-path debouncing and event coalescing
 *
 * Features:
 * - Per-path debounce: Each path has its own debounce timer
 * - Event coalescing: Multiple events on same path merge into one
 * - Batch flush: Events are batched for efficient processing
 */

import type {
  WatchEvent,
  WatchEventType,
  CoalescedEvent,
  CoalescedEventType,
  EventBatch,
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

      // Send as single-event batch
      this.onBatch({
        events: [coalesced],
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
      this.onBatch({
        events,
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
