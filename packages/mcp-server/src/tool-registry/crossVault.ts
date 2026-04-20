import { applySandwichOrdering } from '../tools/read/query.js';
import { VaultRegistry } from '../vault-registry.js';
import { runInVaultScope } from '../vault-scope.js';
import type { VaultActivationCallbacks } from './types.js';

interface CrossVaultFailure {
  vault: string;
  error: string;
}

interface PerVaultResult {
  vault: string;
  data: Record<string, any>;
}

const INTERNAL_RESULT_FIELDS = ['rrf_score', 'in_fts5', 'in_semantic', 'in_entity', 'graph_boost', '_combined_score'];

function normalizeVaultError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function stripInternalFields(results: Array<Record<string, unknown>>): void {
  for (const result of results) {
    for (const field of INTERNAL_RESULT_FIELDS) {
      delete result[field];
    }
  }
}

export function buildCrossVaultPayload(
  perVault: PerVaultResult[],
  failures: CrossVaultFailure[],
  callerConsumer: string,
  limit: number,
): Record<string, unknown> {
  const mergedResults: any[] = [];
  const mergedEntities: any[] = [];
  const mergedMemories: any[] = [];
  const vaultsSearched: string[] = [];
  let query: string | undefined;

  for (const { vault, data } of perVault) {
    vaultsSearched.push(vault);
    if (data.query) query = data.query;
    if (data.error || data.building) continue;

    for (const item of data.results || data.notes || []) {
      mergedResults.push({ vault, ...item });
    }

    if (Array.isArray(data.entities)) {
      for (const item of data.entities) {
        mergedEntities.push({ vault, ...item });
      }
    }

    if (Array.isArray(data.memories)) {
      for (const item of data.memories) {
        mergedMemories.push({ vault, ...item });
      }
    }
  }

  if (mergedResults.some((result) => result.rrf_score != null)) {
    mergedResults.sort((a, b) => (b.rrf_score ?? 0) - (a.rrf_score ?? 0));
  }

  const seenEntities = new Set<string>();
  const dedupedEntities = mergedEntities.filter((entity) => {
    const key = String(entity.name || '').toLowerCase();
    if (seenEntities.has(key)) return false;
    seenEntities.add(key);
    return true;
  });

  const seenMemories = new Set<string>();
  const dedupedMemories = mergedMemories.filter((memory) => {
    const key = String(memory.key || '');
    if (seenMemories.has(key)) return false;
    seenMemories.add(key);
    return true;
  });

  const truncated = mergedResults.slice(0, limit);
  if (callerConsumer === 'llm') {
    applySandwichOrdering(truncated);
    stripInternalFields(truncated);
  }

  return {
    method: 'cross_vault',
    query,
    vaults_searched: vaultsSearched,
    partial_failure: failures.length > 0,
    ...(failures.length > 0 ? { vault_errors: failures } : {}),
    total_results: mergedResults.length,
    returned: truncated.length,
    results: truncated,
    ...(dedupedEntities.length > 0 ? { entities: dedupedEntities.slice(0, limit) } : {}),
    ...(dedupedMemories.length > 0 ? { memories: dedupedMemories.slice(0, limit) } : {}),
  };
}

export async function runCrossVaultSearch(
  registry: VaultRegistry,
  callbacks: VaultActivationCallbacks,
  handler: (...args: any[]) => any,
  args: any[],
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const perVault: PerVaultResult[] = [];
  const failures: CrossVaultFailure[] = [];
  const callerConsumer = args[0]?.consumer ?? 'llm';
  const crossArgs = [{ ...args[0], consumer: 'human' }, ...args.slice(1)];

  for (const ctx of registry.getAllContexts()) {
    callbacks.activateVault(ctx);
    try {
      const result = await runInVaultScope(callbacks.buildVaultScope(ctx), () => handler(...crossArgs));
      const text = result?.content?.[0]?.text;
      if (!text) continue;
      try {
        perVault.push({ vault: ctx.name, data: JSON.parse(text) });
      } catch (error) {
        failures.push({ vault: ctx.name, error: `Invalid search payload: ${normalizeVaultError(error)}` });
      }
    } catch (error) {
      failures.push({ vault: ctx.name, error: normalizeVaultError(error) });
    }
  }

  const limit = args[0]?.limit ?? 10;
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(
        buildCrossVaultPayload(perVault, failures, callerConsumer, limit),
        null,
        2,
      ),
    }],
  };
}
