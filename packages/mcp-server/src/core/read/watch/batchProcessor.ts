/**
 * Batch processor for incremental index updates
 *
 * Features:
 * - Time-sliced processing (yield to event loop)
 * - Concurrency control (N files at a time)
 * - Progress reporting
 * - Error isolation (one bad file doesn't break the batch)
 */

import type { VaultIndex } from '../types.js';
import type { CoalescedEvent, EventBatch } from './types.js';
import { upsertNote, deleteNote, type IncrementalUpdateResult } from './incrementalIndex.js';
import { getRelativePath } from './pathFilter.js';

/** Default concurrency for incremental updates (lower than cold start) */
const DEFAULT_CONCURRENCY = 4;

/** Yield interval - process this many files then yield to event loop */
const YIELD_INTERVAL = 10;

/**
 * Options for batch processing
 */
export interface BatchProcessorOptions {
  /** Maximum concurrent file operations */
  concurrency?: number;

  /** Callback for progress updates */
  onProgress?: (processed: number, total: number) => void;

  /** Callback for individual file errors */
  onError?: (path: string, error: Error) => void;
}

/**
 * Result of batch processing
 */
export interface BatchProcessResult {
  /** Total events processed */
  total: number;

  /** Successful operations */
  successful: number;

  /** Failed operations */
  failed: number;

  /** Individual results */
  results: IncrementalUpdateResult[];

  /** Processing time in ms */
  durationMs: number;
}

/**
 * Process a batch of events with time-slicing
 *
 * This processes events in small groups, yielding to the event loop
 * between groups to prevent blocking.
 */
export async function processBatch(
  index: VaultIndex,
  vaultPath: string,
  batch: EventBatch,
  options: BatchProcessorOptions = {}
): Promise<BatchProcessResult> {
  const { concurrency = DEFAULT_CONCURRENCY, onProgress, onError } = options;
  const startTime = Date.now();
  const results: IncrementalUpdateResult[] = [];
  let successful = 0;
  let failed = 0;
  let processed = 0;

  const events = batch.events;
  const total = events.length;

  if (total === 0) {
    return {
      total: 0,
      successful: 0,
      failed: 0,
      results: [],
      durationMs: 0,
    };
  }

  console.error(`[flywheel] Processing ${total} file events`);

  // Process in chunks with concurrency control
  for (let i = 0; i < events.length; i += concurrency) {
    const chunk = events.slice(i, i + concurrency);

    // Process chunk concurrently
    const chunkResults = await Promise.allSettled(
      chunk.map(async (event) => {
        const relativePath = getRelativePath(vaultPath, event.path);

        if (event.type === 'delete') {
          return deleteNote(index, relativePath);
        } else {
          return upsertNote(index, vaultPath, relativePath);
        }
      })
    );

    // Collect results
    for (let j = 0; j < chunkResults.length; j++) {
      const result = chunkResults[j];
      processed++;

      if (result.status === 'fulfilled') {
        results.push(result.value);
        if (result.value.success) {
          successful++;
        } else {
          failed++;
          if (result.value.error && onError) {
            onError(result.value.path, result.value.error);
          }
        }
      } else {
        failed++;
        const event = chunk[j];
        const relativePath = getRelativePath(vaultPath, event.path);
        const error = result.reason instanceof Error
          ? result.reason
          : new Error(String(result.reason));

        results.push({
          success: false,
          action: 'unchanged',
          path: relativePath,
          error,
        });

        onError?.(relativePath, error);
      }
    }

    // Report progress
    onProgress?.(processed, total);

    // Yield to event loop periodically
    if (processed % YIELD_INTERVAL === 0 && processed < total) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  const durationMs = Date.now() - startTime;
  console.error(`[flywheel] Processed ${successful}/${total} files in ${durationMs}ms`);

  return {
    total,
    successful,
    failed,
    results,
    durationMs,
  };
}

/**
 * Create a batch processor with bound options
 */
export function createBatchProcessor(
  index: VaultIndex,
  vaultPath: string,
  options: BatchProcessorOptions = {}
): (batch: EventBatch) => Promise<BatchProcessResult> {
  return (batch: EventBatch) => processBatch(index, vaultPath, batch, options);
}
