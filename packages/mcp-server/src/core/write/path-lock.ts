/**
 * Per-path keyed mutex for vault file mutations.
 *
 * Closes the TOCTOU window between a content-hash check (CAS) and the
 * subsequent write: without serialization, two concurrent overwrites of the
 * same note can both pass the `expectedHash` check in `writeVaultFile` and
 * then last-writer-wins, losing one update. The lock is held across
 * hash-validation + write (and for read-modify-write mutations, across the
 * read as well).
 *
 * Scope: in-process only. Both stdio and HTTP transports run inside ONE
 * server process per vault (HTTP pools McpServer instances in-process), so a
 * module-level keyed mutex is sufficient — no cross-process locking needed.
 *
 * Key canonicalization: the lock key MUST be derived via `pathLockKey()` so
 * `plans/foo.md`, `./plans/foo.md`, and `plans//foo.md` all serialize on the
 * same key. A key mismatch silently fails to serialize — always go through
 * the helper, never hand-build keys.
 *
 * Performance note: callers should do content-only work (wikilink
 * application, rendering) BEFORE acquiring the lock where possible, so hot
 * notes don't serialize behind O(entities) link passes. Read-modify-write
 * mutations inherently run their operation inside the lock.
 */

/** Canonicalize a vault-relative note path into a lock key. */
export function pathLockKey(vaultPath: string, notePath: string): string {
  const canonical = notePath
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '');
  return `${vaultPath}::${canonical}`;
}

/** Tail of the promise chain per lock key. */
const chains = new Map<string, Promise<unknown>>();

/**
 * Run `fn` while holding the exclusive lock for `key`. Calls with the same
 * key execute strictly in arrival order; different keys run concurrently.
 * The chain entry is cleaned up when the last waiter finishes.
 */
export async function withPathLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  // Chain regardless of the previous holder's outcome.
  const run = prev.then(fn, fn);
  // Park a settled-safe marker so a rejection doesn't break the chain.
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  chains.set(key, tail);
  try {
    return await run;
  } finally {
    // Only delete if we're still the tail (no newer waiter queued behind us).
    if (chains.get(key) === tail) {
      chains.delete(key);
    }
  }
}
