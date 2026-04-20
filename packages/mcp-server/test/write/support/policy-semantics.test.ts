import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';

describe('policy execution semantics wording', () => {
  it('documents rollback semantics instead of atomic staging', async () => {
    const executorSource = await fs.readFile(
      new URL('../../../src/core/write/policy/executor.ts', import.meta.url),
      'utf-8',
    );
    const gitSource = await fs.readFile(
      new URL('../../../src/core/write/git.ts', import.meta.url),
      'utf-8',
    );

    expect(executorSource).toContain('compensating rollback semantics');
    expect(executorSource).toContain('best-effort recovery');
    expect(executorSource).not.toContain('Create atomic commit');
    expect(gitSource).not.toContain('Staging file helpers for atomic policy execution');
    expect(gitSource).not.toContain('.flywheel-staging');
  });
});
