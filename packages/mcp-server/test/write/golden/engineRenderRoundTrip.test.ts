/**
 * Golden round-trip (mega-monkey migration test 8j, flywheel side).
 *
 * The mega-monkey engine reconcile pass depends on this invariant:
 *
 *   normalizeBody(flywheelWrite(engineRender)) === normalizeBody(engineRender)
 *
 * — i.e. everything the flywheel write path adds to engine-rendered
 * markdown (wikilinks, thread-marker links, trailing-newline/EOL
 * normalization, frontmatter re-serialization) must be invisible to the
 * engine's normalizeBody. If a flywheel change breaks this, the engine
 * re-renders the same note every reconcile pass forever (the circuit
 * breaker pages, but CI should catch it first).
 *
 * This test runs in FLYWHEEL's CI because the engine vendors flywheel via a
 * file: workspace link — engine-side coverage tracks workspace HEAD, not
 * the deployed release. Running here closes the version blind spot.
 *
 * normalizeBody below is a PINNED COPY of mega-monkey
 * packages/engine/src/plans/wikilinks.ts#normalizeBody — keep in sync.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { executeCreateNote } from '../../../src/core/write/mutation-helpers.js';

/** PINNED COPY of engine normalizeBody — display-side unwrap, suggestion strip, EOL/trailing-ws. */
function normalizeBody(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/ → \[\[[^\n]*$/gm, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
}

/** Realistic engine plan-note render (renderPlanBody shape). */
const ENGINE_RENDER = [
  '# Witness theory paper sprint',
  '',
  'Sprint to draft sections 3-4 with the new hypothesis framing.',
  '',
  '## Current Understanding',
  '',
  '**Current hypothesis:** witnesses fold across the API boundary.',
  '',
  '_consolidated 2026-06-08T00:00:00Z_',
  '',
  '## Current hypothesis',
  '',
  'The kuramoto coupling explains the fold. See 🧵#thr-a1b2c3d4e5 for the open question.',
  '',
  '_(2026-06-08 00:12, ckpt `ckpt-deadbeef00`)_',
  '',
  '## Checkpoints',
  '',
  '### 2026-06-08 00:12 — hypothesis (system, load-bearing)',
  'The kuramoto coupling explains the fold.',
  '',
  '### 2026-06-08 00:05 — evidence (user)',
  'Numerics from the Lean run support the bound.',
  '',
].join('\n');

describe('engine render round-trip (golden, test 8j)', () => {
  let vaultPath: string;

  beforeEach(() => { vaultPath = mkdtempSync(join(tmpdir(), 'golden-rt-')); });
  afterEach(() => { rmSync(vaultPath, { recursive: true, force: true }); });

  it('flywheel write path (links ON) round-trips through normalizeBody', async () => {
    const outcome = await executeCreateNote({
      vaultPath,
      notePath: 'plans/2026-06/witness-theory-paper-sprint.md',
      content: ENGINE_RENDER,
      frontmatter: {
        id: 'plan-1', status: 'active', checkpoint_count: 2,
        current_hypothesis_checkpoint_id: 'ckpt-deadbeef00', type: 'plan',
      },
      overwrite: false,
      skipWikilinks: false, // engine renders write with linking ON
    });
    expect(outcome.success).toBe(true);

    const onDisk = readFileSync(join(vaultPath, 'plans/2026-06/witness-theory-paper-sprint.md'), 'utf-8');
    // Strip frontmatter the way the engine reconcile does (gray-matter parse
    // equivalent: body after the closing ---).
    const body = onDisk.replace(/^---[\s\S]*?---\r?\n/, '');

    expect(normalizeBody(body)).toBe(normalizeBody(ENGINE_RENDER));
  });

  it('overwrite re-render (CAS path) also round-trips', async () => {
    await executeCreateNote({
      vaultPath, notePath: 'plans/2026-06/p.md', content: ENGINE_RENDER,
      frontmatter: { type: 'plan' }, skipWikilinks: false,
    });
    const v1 = readFileSync(join(vaultPath, 'plans/2026-06/p.md'), 'utf-8');
    const { computeContentHash } = await import('../../../src/core/write/file-io.js');

    const outcome = await executeCreateNote({
      vaultPath, notePath: 'plans/2026-06/p.md', content: ENGINE_RENDER,
      frontmatter: { type: 'plan' }, overwrite: true, skipWikilinks: false,
      expectedHash: computeContentHash(v1),
    });
    expect(outcome.success).toBe(true);

    const v2 = readFileSync(join(vaultPath, 'plans/2026-06/p.md'), 'utf-8');
    const body = v2.replace(/^---[\s\S]*?---\r?\n/, '');
    expect(normalizeBody(body)).toBe(normalizeBody(ENGINE_RENDER));
  });
});
