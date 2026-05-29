/**
 * CallerScope — per-request caller attribution via AsyncLocalStorage.
 *
 * A consumer of the retrieval observer side-channel (the Mega Monkey engine)
 * runs ONE shared flywheel-memory HTTP instance for many callers: the warm
 * Claude of each chat scope, the conductor, ad-hoc sessions, roundtable seats.
 * `session_id` is process-wide, so it cannot tell those callers apart.
 *
 * The caller tags its requests with an `X-Flywheel-Caller` header (e.g.
 * `tg:12345` — the engine's conversation scope key). The HTTP transport binds
 * that value to the current async context for the duration of the request, so
 * the observer wrapper (deep inside the tool handler) can read it and stamp the
 * observation with `caller_id`. The consumer then maps caller → its serial
 * current turn deterministically — surviving concurrent callers.
 *
 * No-op outside an HTTP request (stdio is single-client; no header) — getter
 * returns undefined and the observation simply carries no caller_id.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const callerAls = new AsyncLocalStorage<string>();

/**
 * Run `fn` within an async context tagged with `callerId`. When `callerId` is
 * absent/empty the function runs unwrapped (no caller attribution).
 */
export function runWithCaller<T>(callerId: string | undefined, fn: () => T): T {
  if (!callerId) return fn();
  return callerAls.run(callerId, fn);
}

/** The current request's caller tag, or undefined when none is bound. */
export function getCurrentCaller(): string | undefined {
  return callerAls.getStore();
}
