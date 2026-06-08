/**
 * F0–F3 migration primitives (mega-monkey MCP-only vault emission):
 *
 * - per-path keyed mutex (TOCTOU closure for CAS writes)
 * - executeCreateNote expectedHash CAS → WRITE_CONFLICT / FILE_EXISTS codes
 * - 🧵# thread-marker linking (vault-core applyThreadMarkerLinks)
 * - marker-only handle linking (bare "dark-mode" never links)
 * - per-alias suppression (getSuppressedAliasTerms + suppressedTerms)
 * - proactive folder exclusion helpers + drain defensive skip
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, utimesSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  openStateDb,
  applyThreadMarkerLinks,
  applyWikilinks,
  type StateDb,
} from '@velvetmonkey/vault-core';
import { withPathLock, pathLockKey } from '../../../src/core/write/path-lock.js';
import { executeCreateNote } from '../../../src/core/write/mutation-helpers.js';
import { computeContentHash } from '../../../src/core/write/file-io.js';
import { recordFeedback, getSuppressedAliasTerms } from '../../../src/core/write/wikilinkFeedback.js';
import {
  excludedFolderSet,
  isInExcludedFolder,
  enqueueProactiveSuggestions,
  drainProactiveQueue,
} from '../../../src/core/write/proactiveQueue.js';

// ─────────────────────────────────────────────────────────────────────────────
// path-lock
// ─────────────────────────────────────────────────────────────────────────────

describe('withPathLock', () => {
  it('serializes same-key calls in arrival order', async () => {
    const order: number[] = [];
    const key = pathLockKey('/vault', 'plans/a.md');
    await Promise.all([
      withPathLock(key, async () => {
        await new Promise(r => setTimeout(r, 30));
        order.push(1);
      }),
      withPathLock(key, async () => {
        order.push(2);
      }),
    ]);
    expect(order).toEqual([1, 2]);
  });

  it('runs different keys concurrently', async () => {
    let firstStillRunning = false;
    await Promise.all([
      withPathLock(pathLockKey('/vault', 'a.md'), async () => {
        firstStillRunning = true;
        await new Promise(r => setTimeout(r, 30));
        firstStillRunning = false;
      }),
      withPathLock(pathLockKey('/vault', 'b.md'), async () => {
        await new Promise(r => setTimeout(r, 5));
        // a.md's holder should still be inside its critical section
        expect(firstStillRunning).toBe(true);
      }),
    ]);
  });

  it('canonicalizes path variants onto one key', () => {
    const a = pathLockKey('/vault', 'plans/foo.md');
    expect(pathLockKey('/vault', './plans/foo.md')).toBe(a);
    expect(pathLockKey('/vault', 'plans//foo.md')).toBe(a);
    expect(pathLockKey('/vault', '/plans/foo.md')).toBe(a);
    expect(pathLockKey('/vault', 'plans\\foo.md')).toBe(a);
  });

  it('survives a rejecting holder (chain not poisoned)', async () => {
    const key = pathLockKey('/vault', 'c.md');
    await expect(withPathLock(key, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    const result = await withPathLock(key, async () => 'ok');
    expect(result).toBe('ok');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CAS create/overwrite (8k: two concurrent overwrites, one wins)
// ─────────────────────────────────────────────────────────────────────────────

describe('executeCreateNote CAS', () => {
  let vaultPath: string;

  beforeEach(() => { vaultPath = mkdtempSync(join(tmpdir(), 'cas-')); });
  afterEach(() => { rmSync(vaultPath, { recursive: true, force: true }); });

  it('FILE_EXISTS code on create without overwrite', async () => {
    writeFileSync(join(vaultPath, 'note.md'), 'existing');
    const outcome = await executeCreateNote({
      vaultPath, notePath: 'note.md', content: 'new', frontmatter: {}, skipWikilinks: true,
    });
    expect(outcome.success).toBe(false);
    expect(outcome.result.code).toBe('FILE_EXISTS');
  });

  it('overwrite with matching expectedHash succeeds', async () => {
    writeFileSync(join(vaultPath, 'note.md'), 'v1');
    const hash = computeContentHash(readFileSync(join(vaultPath, 'note.md'), 'utf-8'));
    const outcome = await executeCreateNote({
      vaultPath, notePath: 'note.md', content: 'v2', frontmatter: {}, overwrite: true,
      skipWikilinks: true, expectedHash: hash,
    });
    expect(outcome.success).toBe(true);
    expect(readFileSync(join(vaultPath, 'note.md'), 'utf-8')).toContain('v2');
  });

  it('overwrite with stale expectedHash → WRITE_CONFLICT, no clobber', async () => {
    writeFileSync(join(vaultPath, 'note.md'), 'v1');
    const staleHash = computeContentHash('something-else-entirely');
    const outcome = await executeCreateNote({
      vaultPath, notePath: 'note.md', content: 'v2', frontmatter: {}, overwrite: true,
      skipWikilinks: true, expectedHash: staleHash,
    });
    expect(outcome.success).toBe(false);
    expect(outcome.result.code).toBe('WRITE_CONFLICT');
    expect(readFileSync(join(vaultPath, 'note.md'), 'utf-8')).toBe('v1');
  });

  it('8k: two concurrent overwrites with the same valid hash → exactly one wins', async () => {
    writeFileSync(join(vaultPath, 'note.md'), 'base');
    const hash = computeContentHash('base');
    const [a, b] = await Promise.all([
      executeCreateNote({
        vaultPath, notePath: 'note.md', content: 'writer-A', frontmatter: {}, overwrite: true,
        skipWikilinks: true, expectedHash: hash,
      }),
      executeCreateNote({
        vaultPath, notePath: 'note.md', content: 'writer-B', frontmatter: {}, overwrite: true,
        skipWikilinks: true, expectedHash: hash,
      }),
    ]);
    const successes = [a, b].filter(o => o.success);
    const conflicts = [a, b].filter(o => !o.success && o.result.code === 'WRITE_CONFLICT');
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    const final = readFileSync(join(vaultPath, 'note.md'), 'utf-8');
    expect(final.includes('writer-A') !== final.includes('writer-B')).toBe(true);
  });

  it('no-overwrite create race: exactly one creator wins, loser gets FILE_EXISTS', async () => {
    const [a, b] = await Promise.all([
      executeCreateNote({ vaultPath, notePath: 'fresh.md', content: 'A', frontmatter: {}, skipWikilinks: true }),
      executeCreateNote({ vaultPath, notePath: 'fresh.md', content: 'B', frontmatter: {}, skipWikilinks: true }),
    ]);
    const successes = [a, b].filter(o => o.success);
    expect(successes).toHaveLength(1);
    const loser = [a, b].find(o => !o.success)!;
    expect(loser.result.code).toBe('FILE_EXISTS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Thread-marker linking (F1)
// ─────────────────────────────────────────────────────────────────────────────

describe('applyThreadMarkerLinks', () => {
  const resolve = (ref: string) =>
    ref === 'thr-a1b2c3d4e5' || ref === 'amber-anchor' ? `threads/2026-06/${ref}` : null;

  it('links the guid marker form, all occurrences', () => {
    const r = applyThreadMarkerLinks(
      'See 🧵#thr-a1b2c3d4e5 and again 🧵#thr-a1b2c3d4e5 later.',
      resolve,
    );
    expect(r.linksAdded).toBe(2);
    expect(r.content).toBe(
      'See [[threads/2026-06/thr-a1b2c3d4e5|🧵#thr-a1b2c3d4e5]] and again [[threads/2026-06/thr-a1b2c3d4e5|🧵#thr-a1b2c3d4e5]] later.',
    );
  });

  it('links the handle marker form', () => {
    const r = applyThreadMarkerLinks('Re: 🧵#amber-anchor status', resolve);
    expect(r.linksAdded).toBe(1);
    expect(r.content).toContain('[[threads/2026-06/amber-anchor|🧵#amber-anchor]]');
  });

  it('leaves unresolved markers as plain text (no dead links)', () => {
    const r = applyThreadMarkerLinks('Unknown 🧵#thr-ffffffffff here', resolve);
    expect(r.linksAdded).toBe(0);
    expect(r.content).toBe('Unknown 🧵#thr-ffffffffff here');
  });

  it('skips markers inside code fences and existing wikilinks', () => {
    const content = 'Code:\n```\n🧵#thr-a1b2c3d4e5\n```\nInline `🧵#amber-anchor` and [[x|🧵#amber-anchor]].';
    const r = applyThreadMarkerLinks(content, resolve);
    expect(r.linksAdded).toBe(0);
    expect(r.content).toBe(content);
  });

  it('records the full marker as matchedTerm for feedback', () => {
    const r = applyThreadMarkerLinks('🧵#amber-anchor', resolve);
    expect(r.linkedTerms).toEqual([
      { entity: 'threads/2026-06/amber-anchor', matchedTerm: '🧵#amber-anchor' },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// False-positive guard (test 9): handles never bare-link
// ─────────────────────────────────────────────────────────────────────────────

describe('case-preservation (reconcile no-loop)', () => {
  it('linking text "AI" to a lowercase-canonical entity preserves display as [[ai|AI]]', () => {
    const entities = [{ name: 'ai', path: 'entities/ai.md', aliases: [] }];
    const r = applyWikilinks('We use AI/data pipelines daily', entities, {
      firstOccurrenceOnly: true, caseInsensitive: true,
    });
    // MUST keep the original "AI" casing via the piped form — a bare [[ai]]
    // would lose it and break round-trip consumers (mega-monkey reconcile).
    expect(r.content).toContain('[[ai|AI]]');
    expect(r.content).not.toMatch(/\[\[ai\]\]/);
  });

  it('exact-case match still emits the bare form', () => {
    const entities = [{ name: 'AI', path: 'entities/AI.md', aliases: [] }];
    const r = applyWikilinks('We use AI daily', entities, {
      firstOccurrenceOnly: true, caseInsensitive: true,
    });
    expect(r.content).toContain('[[AI]]');
  });

  it('all-occurrences mode also preserves case', () => {
    const entities = [{ name: 'ci', path: 'entities/ci.md', aliases: [] }];
    const r = applyWikilinks('CI here and CI there', entities, {
      firstOccurrenceOnly: false, caseInsensitive: true,
    });
    expect(r.content).toBe('[[ci|CI]] here and [[ci|CI]] there');
  });
});

describe('handle false-positive guard', () => {
  it('"dark-mode" thread handle entity does NOT link bare text', () => {
    const entities = [{ name: 'dark-mode', path: 'threads/2026-06/dark-mode.md', aliases: ['🧵#dark-mode'] }];
    const r = applyWikilinks('we shipped dark mode and dark-mode support', entities, {
      firstOccurrenceOnly: true,
      caseInsensitive: true,
    });
    expect(r.linksAdded).toBe(0);
    expect(r.content).toBe('we shipped dark mode and dark-mode support');
  });

  it('the same handle DOES link via the 🧵# marker pass', () => {
    const r = applyThreadMarkerLinks('toggle 🧵#dark-mode done', ref => (ref === 'dark-mode' ? 'dark-mode' : null));
    expect(r.linksAdded).toBe(1);
    expect(r.content).toBe('toggle [[dark-mode|🧵#dark-mode]] done');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-alias suppression (F2, test 11)
// ─────────────────────────────────────────────────────────────────────────────

describe('per-alias suppression', () => {
  let vaultPath: string;
  let stateDb: StateDb;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), 'alias-sup-'));
    stateDb = openStateDb(vaultPath);
  });
  afterEach(() => {
    stateDb?.close();
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it('getSuppressedAliasTerms flags only the poisoned (entity, term) pair', () => {
    // 20 false positives on alias "Hero" of entity "Hera"; the name itself is fine.
    for (let i = 0; i < 20; i++) {
      recordFeedback(stateDb, 'Hera', 'ctx', `notes/n${i}.md`, false, 1.0, 'Hero');
    }
    recordFeedback(stateDb, 'Hera', 'ctx', 'notes/ok.md', true, 1.0, 'Hera');

    const suppressed = getSuppressedAliasTerms(stateDb);
    expect(suppressed.has('hera||hero')).toBe(true);
    expect(suppressed.has('hera||hera')).toBe(false);
  });

  it('applyWikilinks drops the suppressed alias but keeps the entity name', () => {
    const entities = [{ name: 'Hera', path: 'entities/hera.md', aliases: ['Hero'] }];
    const suppressedTerms = new Set(['hera||hero']);

    const withSuppression = applyWikilinks('Hero saved the day. Hera approved.', entities, {
      firstOccurrenceOnly: true,
      caseInsensitive: true,
      suppressedTerms,
    });
    // "Hero" must NOT link; "Hera" (entity name) must still link.
    expect(withSuppression.content).toContain('Hero saved');
    expect(withSuppression.content).not.toContain('[[Hera|Hero]]');
    expect(withSuppression.content).toContain('[[Hera]]');
  });

  it('applyWikilinks reports linkedTerms with the matched term', () => {
    const entities = [{ name: 'Hera', path: 'entities/hera.md', aliases: ['Hero'] }];
    const r = applyWikilinks('Hero saved the day.', entities, {
      firstOccurrenceOnly: true,
      caseInsensitive: true,
    });
    expect(r.linkedTerms).toEqual([{ entity: 'Hera', matchedTerm: 'Hero' }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Proactive folder exclusion (F3, test 12)
// ─────────────────────────────────────────────────────────────────────────────

describe('proactive_exclude_folders', () => {
  it('defaults to plans/threads/councils', () => {
    const set = excludedFolderSet(undefined);
    expect(isInExcludedFolder('plans/2026-06/x.md', set)).toBe(true);
    expect(isInExcludedFolder('threads/2026-06/thr-1.md', set)).toBe(true);
    expect(isInExcludedFolder('councils/abc/council.md', set)).toBe(true);
    expect(isInExcludedFolder('daily-notes/2026-06-08.md', set)).toBe(false);
    expect(isInExcludedFolder('plansx/decoy.md', set)).toBe(false);
  });

  it('config override replaces the default set', () => {
    const set = excludedFolderSet({ proactive_exclude_folders: ['generated'] });
    expect(isInExcludedFolder('plans/x.md', set)).toBe(false);
    expect(isInExcludedFolder('generated/x.md', set)).toBe(true);
  });

  it('drain defensively rejects queued entries in excluded folders', async () => {
    const vaultPath = mkdtempSync(join(tmpdir(), 'pq-excl-'));
    const stateDb = openStateDb(vaultPath);
    try {
      mkdirSync(join(vaultPath, 'plans'), { recursive: true });
      const full = join(vaultPath, 'plans', 'p.md');
      writeFileSync(full, '# Plan about TypeScript\n');
      const old = new Date(Date.now() - 10 * 60_000);
      utimesSync(full, old, old);

      enqueueProactiveSuggestions(stateDb, [
        { notePath: 'plans/p.md', entity: 'TypeScript', score: 30, confidence: 'high' },
      ]);

      const result = await drainProactiveQueue(
        stateDb,
        vaultPath,
        { minScore: 20, maxPerFile: 5, maxPerDay: 10, excludeFolders: excludedFolderSet(undefined) },
        async () => { throw new Error('applyFn must not run for excluded folders'); },
      );
      expect(result.applied).toHaveLength(0);
      expect(result.rejections.some(r => r.reason === 'excluded_folder')).toBe(true);
    } finally {
      stateDb?.close();
      rmSync(vaultPath, { recursive: true, force: true });
    }
  });
});
