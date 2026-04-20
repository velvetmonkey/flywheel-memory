import { describe, expect, it } from 'vitest';

import {
  extractQueryContext,
  extractSearchMethod,
  unionSignalsByCategory,
} from '../../src/tool-registry/activation.js';
import { shouldSuppressMemoryTool } from '../../src/tool-registry/clientSuppressions.js';
import { buildCrossVaultPayload } from '../../src/tool-registry/crossVault.js';
import {
  getDirectCallPromotion,
  shouldEnableTieredTool,
} from '../../src/tool-registry/tiering.js';

describe('tool-registry helper coverage', () => {
  it('keeps only the highest activation tier per category', () => {
    expect(unionSignalsByCategory([
      { category: 'graph', tier: 2 },
      { category: 'graph', tier: 3 },
      { category: 'memory', tier: 1 },
    ])).toEqual([
      { category: 'graph', tier: 3 },
      { category: 'memory', tier: 1 },
    ]);
  });

  it('extracts only allowlisted query context fields', () => {
    const context = extractQueryContext({
      query: 'alpha',
      entity: 'Project Alpha',
      content: 'sensitive markdown body',
      yaml: 'ignored',
    });

    expect(context).toBe('alpha | Project Alpha');
    expect(context).not.toContain('sensitive markdown body');
  });

  it('parses search method from MCP text payloads', () => {
    expect(extractSearchMethod({
      content: [{ type: 'text', text: JSON.stringify({ method: 'hybrid' }) }],
    })).toBe('hybrid');
    expect(extractSearchMethod({
      content: [{ type: 'text', text: 'not json' }],
    })).toBeUndefined();
  });

  it('computes tier visibility and direct-call promotion consistently', () => {
    const baseState = {
      categories: new Set(['graph', 'diagnostics'] as const),
      tierMode: 'tiered' as const,
      tierOverride: 'auto' as const,
      activatedCategoryTiers: new Map(),
    };

    expect(shouldEnableTieredTool('doctor', baseState)).toBe(true);
    expect(shouldEnableTieredTool('graph', baseState)).toBe(false);

    const promotedState = {
      ...baseState,
      activatedCategoryTiers: new Map([['graph', 2]]),
    };
    expect(shouldEnableTieredTool('graph', promotedState)).toBe(true);

    const minimalState = {
      ...promotedState,
      tierOverride: 'minimal' as const,
    };
    expect(shouldEnableTieredTool('graph', minimalState)).toBe(false);

    expect(getDirectCallPromotion('graph', new Set(['graph']), 'tiered')).toEqual({
      category: 'graph',
      tier: 2,
    });
    expect(getDirectCallPromotion('graph', new Set(['graph']), 'off')).toBeNull();
    expect(getDirectCallPromotion('graph', new Set(['memory']), 'tiered')).toBeNull();
  });

  it('suppresses memory only for Claude Code without the override', () => {
    expect(shouldSuppressMemoryTool({
      applyClientSuppressions: true,
      claudeCodeEnv: '1',
      enableMemoryForClaudeEnv: '0',
    })).toBe(true);
    expect(shouldSuppressMemoryTool({
      applyClientSuppressions: true,
      claudeCodeEnv: '1',
      enableMemoryForClaudeEnv: '1',
    })).toBe(false);
    expect(shouldSuppressMemoryTool({
      applyClientSuppressions: false,
      claudeCodeEnv: '1',
    })).toBe(false);
  });

  it('merges cross-vault payloads with partial-failure metadata and llm ordering', () => {
    const payload = buildCrossVaultPayload(
      [
        {
          vault: 'alpha',
          data: {
            query: 'project alpha',
            results: [
              { title: 'A', rrf_score: 10, in_fts5: true },
              { title: 'B', rrf_score: 7 },
            ],
            entities: [{ name: 'Shared Entity' }, { name: 'Alpha Entity' }],
            memories: [{ key: 'memory.alpha' }],
          },
        },
        {
          vault: 'beta',
          data: {
            results: [
              { title: 'C', rrf_score: 9, in_semantic: true },
              { title: 'D', rrf_score: 8 },
            ],
            entities: [{ name: 'Shared Entity' }, { name: 'Beta Entity' }],
            memories: [{ key: 'memory.alpha' }, { key: 'memory.beta' }],
          },
        },
      ],
      [{ vault: 'gamma', error: 'watcher unavailable' }],
      'llm',
      4,
    );

    expect(payload.method).toBe('cross_vault');
    expect(payload.query).toBe('project alpha');
    expect(payload.vaults_searched).toEqual(['alpha', 'beta']);
    expect(payload.partial_failure).toBe(true);
    expect(payload.vault_errors).toEqual([{ vault: 'gamma', error: 'watcher unavailable' }]);
    expect((payload.results as Array<{ title: string }>).map((result) => result.title)).toEqual(['A', 'D', 'B', 'C']);
    expect((payload.results as Array<Record<string, unknown>>)[0]).not.toHaveProperty('rrf_score');
    expect(payload.entities).toEqual([
      { vault: 'alpha', name: 'Shared Entity' },
      { vault: 'alpha', name: 'Alpha Entity' },
      { vault: 'beta', name: 'Beta Entity' },
    ]);
    expect(payload.memories).toEqual([
      { vault: 'alpha', key: 'memory.alpha' },
      { vault: 'beta', key: 'memory.beta' },
    ]);
  });

  it('truncates large merged result sets after cross-vault sorting', () => {
    const alphaResults = Array.from({ length: 8 }, (_, index) => ({
      title: `alpha-${index}`,
      rrf_score: 100 - index,
    }));
    const betaResults = Array.from({ length: 8 }, (_, index) => ({
      title: `beta-${index}`,
      rrf_score: 80 - index,
    }));

    const payload = buildCrossVaultPayload(
      [
        { vault: 'alpha', data: { results: alphaResults } },
        { vault: 'beta', data: { results: betaResults } },
      ],
      [],
      'human',
      5,
    );

    expect(payload.total_results).toBe(16);
    expect(payload.returned).toBe(5);
    expect((payload.results as Array<{ title: string }>).map((result) => result.title)).toEqual([
      'alpha-0',
      'alpha-1',
      'alpha-2',
      'alpha-3',
      'alpha-4',
    ]);
  });
});
