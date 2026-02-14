/**
 * Index guard - ensures tools fail fast when index isn't ready
 *
 * Used by tools that require a fully built index.
 * Provides clear error messages with progress info.
 */

import { getIndexState, getIndexProgress, getIndexError } from './graph.js';

/**
 * Check that the index is ready before proceeding.
 * Throws an error with progress info if still building or failed.
 *
 * @throws Error if index is building or failed
 */
export function requireIndex(): void {
  const state = getIndexState();

  if (state === 'building') {
    const { parsed, total } = getIndexProgress();
    const progress = total > 0 ? ` (${parsed}/${total} files)` : '';
    throw new Error(`Index building${progress}... try again shortly`);
  }

  if (state === 'error') {
    const error = getIndexError();
    throw new Error(`Index failed to build: ${error?.message || 'unknown error'}`);
  }

  // state === 'ready' - proceed normally
}

/**
 * Check if index is ready (non-throwing version)
 */
export function isIndexReady(): boolean {
  return getIndexState() === 'ready';
}
