import { getActiveScopeOrNull } from '../../../vault-scope.js';
import { serverLog } from '../../shared/serverLog.js';

export interface PolicyWatcherGuard {
  registerPath(path: string): void;
  finish(): Promise<string | undefined>;
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/');
}

/**
 * Mute watcher-driven reprocessing for policy-touched paths until the policy
 * finishes, then reconcile the final filesystem state exactly once.
 */
export function createPolicyWatcherGuard(): PolicyWatcherGuard {
  const scope = getActiveScopeOrNull();
  const mutedPaths = scope?.mutedWatcherPaths;
  const dirtyPaths = scope?.dirtyMutedWatcherPaths;
  const reconcile = scope?.reconcileMutedWatcherPaths;
  const touchedPaths = new Set<string>();

  return {
    registerPath(pathValue: string): void {
      if (!pathValue || !mutedPaths) return;
      const normalized = normalizePath(pathValue);
      touchedPaths.add(normalized);
      mutedPaths.add(normalized);
    },

    async finish(): Promise<string | undefined> {
      if (!mutedPaths || !dirtyPaths || touchedPaths.size === 0) {
        return undefined;
      }

      const affectedPaths = new Set<string>(touchedPaths);
      for (const filePath of touchedPaths) {
        mutedPaths.delete(filePath);
      }

      for (const filePath of Array.from(dirtyPaths)) {
        if (touchedPaths.has(filePath)) {
          affectedPaths.add(filePath);
          dirtyPaths.delete(filePath);
        }
      }

      if (!reconcile || affectedPaths.size === 0) {
        return undefined;
      }

      try {
        await reconcile(Array.from(affectedPaths));
        return undefined;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        serverLog('policy', `Watcher reconciliation failed: ${detail}`, 'error');
        return detail;
      }
    },
  };
}
