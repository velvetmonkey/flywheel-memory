/**
 * Architecture Ratchet Test (arch-review S0 — bars B2/B3/B4)
 *
 * Computes the static import graph of packages/mcp-server/src and
 * packages/core/src and enforces three ratchets against the committed
 * baseline (test/arch/arch-baseline.json):
 *
 *   B2 cycles      — no import cycle may exist that is not in the baseline.
 *   B3 layering    — no forbidden-direction edge (core/→tools/, core/read→
 *                    core/write, anything→index.ts) outside the baseline.
 *   B4 sql         — no file outside the baseline list may contain raw
 *                    SQLite statements (.prepare( call sites).
 *
 * The baseline is a RATCHET: refactor slices shrink it (S1 empties cycles),
 * and nothing may grow it. Regenerate after a slice intentionally removes
 * entries: FW_UPDATE_ARCH=1 npx vitest run test/arch/dependency-rules.test.ts
 * — then review the diff: it must only DELETE lines.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { join, dirname, normalize, relative } from 'path';

const REPO_ROOT = join(__dirname, '../../../..');
const SRC_ROOTS = [
  join(REPO_ROOT, 'packages/mcp-server/src'),
  join(REPO_ROOT, 'packages/core/src'),
];
const BASELINE_PATH = join(__dirname, 'arch-baseline.json');

interface ArchBaseline {
  cycles: string[];
  layeringViolations: string[];
  sqlFiles: string[];
}

function listSourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) {
        files.push(p);
      }
    }
  };
  for (const root of SRC_ROOTS) walk(root);
  return files;
}

function rel(p: string): string {
  return relative(REPO_ROOT, p).replace(/\\/g, '/');
}

/** file -> resolved relative-import targets (within the two src roots) */
function buildImportGraph(files: string[]): Map<string, string[]> {
  const fileSet = new Set(files);
  const graph = new Map<string, string[]>();
  const importRe = /(?:from\s+|import\s*\(|require\s*\()\s*['"](\.[^'"]+)['"]/g;

  for (const file of files) {
    const src = readFileSync(file, 'utf-8');
    const deps = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(src))) {
      let resolved = normalize(join(dirname(file), m[1])).replace(/\.js$/, '.ts');
      if (!resolved.endsWith('.ts')) {
        if (fileSet.has(resolved + '.ts')) resolved = resolved + '.ts';
        else if (fileSet.has(join(resolved, 'index.ts'))) resolved = join(resolved, 'index.ts');
      }
      if (fileSet.has(resolved)) deps.add(resolved);
    }
    graph.set(file, [...deps]);
  }
  return graph;
}

/** All elementary cycles found by DFS, canonicalized for stable comparison. */
function findCycles(graph: Map<string, string[]>): string[] {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];
  const cycles = new Set<string>();

  const canonical = (cycle: string[]): string => {
    const relCycle = cycle.map(rel);
    let minIdx = 0;
    for (let i = 1; i < relCycle.length; i++) {
      if (relCycle[i] < relCycle[minIdx]) minIdx = i;
    }
    return [...relCycle.slice(minIdx), ...relCycle.slice(0, minIdx)].join(' -> ');
  };

  const dfs = (node: string) => {
    color.set(node, GREY);
    stack.push(node);
    for (const dep of graph.get(node) ?? []) {
      const c = color.get(dep) ?? WHITE;
      if (c === GREY) {
        cycles.add(canonical(stack.slice(stack.indexOf(dep))));
      } else if (c === WHITE) {
        dfs(dep);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  };

  for (const node of graph.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE) dfs(node);
  }
  return [...cycles].sort();
}

/** Forbidden-direction edges per bar B3. */
function findLayeringViolations(graph: Map<string, string[]>): string[] {
  const violations = new Set<string>();
  const inDir = (p: string, dir: string) => rel(p).startsWith(dir);

  for (const [from, deps] of graph) {
    for (const to of deps) {
      const edge = `${rel(from)} -> ${rel(to)}`;
      // core/ (or anything outside tools/) must not import tools/
      if (
        inDir(to, 'packages/mcp-server/src/tools/') &&
        !inDir(from, 'packages/mcp-server/src/tools/')
      ) {
        violations.add(edge);
      }
      // core/read must not import core/write
      if (
        inDir(from, 'packages/mcp-server/src/core/read/') &&
        inDir(to, 'packages/mcp-server/src/core/write/')
      ) {
        violations.add(edge);
      }
      // nothing imports the entry file
      if (rel(to) === 'packages/mcp-server/src/index.ts') {
        violations.add(edge);
      }
    }
  }
  return [...violations].sort();
}

/** Files containing raw SQLite statement preparation (bar B4). */
function findSqlFiles(files: string[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf-8');
    if (/\.prepare\s*\(/.test(src)) hits.push(rel(file));
  }
  return hits.sort();
}

function loadBaseline(): ArchBaseline {
  expect(
    existsSync(BASELINE_PATH),
    'arch-baseline.json missing — generate with FW_UPDATE_ARCH=1'
  ).toBe(true);
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as ArchBaseline;
}

describe('Architecture ratchet (arch-review S0)', () => {
  const files = listSourceFiles();
  const graph = buildImportGraph(files);
  const current: ArchBaseline = {
    cycles: findCycles(graph),
    layeringViolations: findLayeringViolations(graph),
    sqlFiles: findSqlFiles(files),
  };

  if (process.env.FW_UPDATE_ARCH === '1') {
    writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + '\n');
  }

  const baseline = loadBaseline();

  it('B2: no import cycle outside the baseline', () => {
    const allowed = new Set(baseline.cycles);
    const newCycles = current.cycles.filter((c) => !allowed.has(c));
    expect(newCycles, 'NEW import cycles introduced').toEqual([]);
  });

  it('B3: no forbidden-direction import outside the baseline', () => {
    const allowed = new Set(baseline.layeringViolations);
    const newViolations = current.layeringViolations.filter((v) => !allowed.has(v));
    expect(newViolations, 'NEW layering violations introduced').toEqual([]);
  });

  it('B4: no raw SQL outside the baseline file list', () => {
    const allowed = new Set(baseline.sqlFiles);
    const newSql = current.sqlFiles.filter((f) => !allowed.has(f));
    expect(newSql, 'NEW files with raw SQL introduced').toEqual([]);
  });

  it('baseline is not stale (entries that no longer occur should be ratcheted out)', () => {
    // Informational ratchet hygiene: a baseline entry that no longer exists
    // means a slice fixed it — regenerate the baseline (delete-only diff) in
    // that slice's commit. Tolerated (no failure), but reported.
    const currentCycles = new Set(current.cycles);
    const gone = baseline.cycles.filter((c) => !currentCycles.has(c));
    if (gone.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[arch-ratchet] ${gone.length} baseline cycles no longer present — ratchet the baseline down.`);
    }
    expect(true).toBe(true);
  });
});
