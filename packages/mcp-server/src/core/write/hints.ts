/**
 * Mutation hints for Flywheel integration
 *
 * Stores hints in SQLite StateDb so Flywheel can prioritize
 * reindexing of recently mutated files.
 */

import crypto from 'crypto';
import {
  setWriteState,
  getWriteState,
  type StateDb,
} from '@velvetmonkey/vault-core';

/**
 * Module-level StateDb reference for hints storage
 * Set via setHintsStateDb() during initialization
 */
let moduleStateDb: StateDb | null = null;

/**
 * Set the StateDb instance for this module
 * Called during MCP server initialization
 */
export function setHintsStateDb(stateDb: StateDb | null): void {
  moduleStateDb = stateDb;
}

/** Maximum number of hints to keep in the file */
const MAX_HINTS = 100;

/** Hint file version for compatibility */
const HINT_VERSION = 1;

/**
 * Single mutation hint
 */
export interface MutationHint {
  /** ISO timestamp of the mutation */
  timestamp: string;
  /** Vault-relative path of the mutated file */
  path: string;
  /** Type of mutation operation */
  operation: string;
  /** Hash of content before mutation */
  beforeHash: string;
  /** Hash of content after mutation */
  afterHash: string;
}

/**
 * Hints file structure
 */
export interface HintsFile {
  version: number;
  mutations: MutationHint[];
}

/**
 * Compute a short hash of content for change tracking
 */
export function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
}

/**
 * Read the current hints from StateDb
 */
export function readHints(): HintsFile {
  if (!moduleStateDb) {
    return { version: HINT_VERSION, mutations: [] };
  }

  try {
    const data = getWriteState<HintsFile>(moduleStateDb, 'mutation_hints');
    if (data && data.version === HINT_VERSION) {
      return data;
    }
  } catch {
    // StateDb error
  }

  return { version: HINT_VERSION, mutations: [] };
}

/**
 * Write hints to StateDb
 */
export function writeHints(hints: HintsFile): void {
  if (!moduleStateDb) {
    console.error('[Flywheel] No StateDb available for writing hints');
    return;
  }

  try {
    setWriteState(moduleStateDb, 'mutation_hints', hints);
  } catch (e) {
    console.error('[Flywheel] Failed to write hints to StateDb:', e);
  }
}

/**
 * Add a mutation hint
 *
 * @param notePath - Vault-relative path to the mutated file
 * @param operation - Name of the mutation operation
 * @param beforeContent - Content before mutation
 * @param afterContent - Content after mutation
 * @returns true if hint was written successfully
 */
export function addMutationHint(
  notePath: string,
  operation: string,
  beforeContent: string,
  afterContent: string
): boolean {
  try {
    const hints = readHints();

    // Create new hint
    const hint: MutationHint = {
      timestamp: new Date().toISOString(),
      path: notePath,
      operation,
      beforeHash: computeHash(beforeContent),
      afterHash: computeHash(afterContent),
    };

    // Add to front of list
    hints.mutations.unshift(hint);

    // Trim to max size
    if (hints.mutations.length > MAX_HINTS) {
      hints.mutations = hints.mutations.slice(0, MAX_HINTS);
    }

    writeHints(hints);
    return true;
  } catch (error) {
    // Log but don't fail the mutation
    console.error('[Flywheel] Failed to write mutation hint:', error);
    return false;
  }
}

/**
 * Get recent mutations for a specific path
 */
export function getHintsForPath(notePath: string): MutationHint[] {
  const hints = readHints();
  return hints.mutations.filter(h => h.path === notePath);
}

/**
 * Get all mutations since a given timestamp
 */
export function getHintsSince(since: Date): MutationHint[] {
  const hints = readHints();
  const sinceMs = since.getTime();

  return hints.mutations.filter(h => {
    const hintMs = new Date(h.timestamp).getTime();
    return hintMs >= sinceMs;
  });
}

/**
 * Clear all hints (useful for testing or reset)
 */
export function clearHints(): void {
  writeHints({ version: HINT_VERSION, mutations: [] });
}
