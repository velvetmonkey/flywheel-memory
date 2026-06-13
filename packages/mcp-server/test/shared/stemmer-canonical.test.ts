/**
 * Canonical stemmer pin (D3 unification, 2026-06-13).
 *
 * Two Porter implementations used to exist (vault-core stemmer.ts, 207 LOC,
 * link-time matching; core/shared/stemmer.ts, 390 LOC, scoring/search
 * tokenization). Before unifying they were compared exhaustively: the full
 * google-10k-english corpus (9,988 words), a 94-word morphology stress set,
 * and case/short-word/alphanumeric edge probes — ZERO output differences.
 * core/shared/stemmer.ts now re-exports the single vault-core stem().
 *
 * These tests pin (1) the unification itself — both import paths resolve to
 * the SAME function — and (2) golden stem outputs for a representative set,
 * so any future edit to the canonical stemmer surfaces as a visible,
 * deliberate matching-behaviour change.
 */

import { describe, it, expect } from 'vitest';
import { stem as coreStem } from '@velvetmonkey/vault-core';
import { stem, tokenize, tokenizeAndStem, isStopword } from '../../src/core/shared/stemmer.js';

describe('stemmer unification (D3)', () => {
  it('core/shared/stemmer re-exports the vault-core stem — same function object', () => {
    expect(Object.is(stem, coreStem)).toBe(true);
  });

  it('golden stem outputs for the representative set', () => {
    const golden: Record<string, string> = {
      pipelines: 'pipelin', sprinting: 'sprint', databases: 'databas',
      running: 'run', flies: 'fli', agreed: 'agre', ponies: 'poni',
      relational: 'relat', conditional: 'condit', meetings: 'meet',
      notes: 'note', memories: 'memori', linked: 'link', linking: 'link',
      engineering: 'engin', analysis: 'analysi', studies: 'studi',
      happily: 'happili', classes: 'class', tries: 'tri', tried: 'tri',
      using: 'us', controlled: 'control', adjustment: 'adjust',
      replacement: 'replac', wikilinks: 'wikilink', entities: 'entiti',
      flywheel: 'flywheel', obsidian: 'obsidian', vaults: 'vault',
      projects: 'project', syncing: 'sync', synced: 'sync',
    };
    for (const [word, expected] of Object.entries(golden)) {
      expect(stem(word), `stem(${word})`).toBe(expected);
    }
    // Case + short-word + alphanumeric edge behaviour
    expect(stem('Running')).toBe('run');
    expect(stem('PIPELINES')).toBe('pipelin');
    expect(stem('at')).toBe('at');
    expect(stem('K8s')).toBe('k8');
  });

  it('tokenize layer unchanged: wikilink extraction, stopword filtering, alphanumeric tokens', () => {
    const tokens = tokenize('Pondering about [[Project Alpha|the project]] and k8s pipelines');
    expect(tokens).toContain('pondering');
    expect(tokens).toContain('project');
    expect(tokens).toContain('k8s');
    expect(tokens).toContain('pipelines');
    expect(tokens).not.toContain('the');
    expect(tokens).not.toContain('and');

    const { stems, tokenSet } = tokenizeAndStem('linked linking links');
    expect(stems.has('link')).toBe(true);
    expect(tokenSet.has('linked')).toBe(true);

    expect(isStopword('The')).toBe(true);
    expect(isStopword('flywheel')).toBe(false);
  });
});
