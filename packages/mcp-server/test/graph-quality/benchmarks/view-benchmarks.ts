/**
 * View benchmark history from history.jsonl
 *
 * Run: npx tsx test/graph-quality/benchmarks/view-benchmarks.ts
 */

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = typeof globalThis.__dirname !== 'undefined'
  ? globalThis.__dirname
  : path.dirname(fileURLToPath(import.meta.url));

const historyPath = path.join(__dirname, 'history.jsonl');

interface HistoryEntry {
  timestamp: string;
  git_sha: string;
  suite: string;
  summary: Record<string, number>;
  duration_ms: number;
}

function main(): void {
  if (!existsSync(historyPath)) {
    console.log('No benchmark history found. Run graph-quality tests first.');
    return;
  }

  const lines = readFileSync(historyPath, 'utf-8')
    .split('\n')
    .filter(l => l.trim().length > 0);

  if (lines.length === 0) {
    console.log('Benchmark history is empty.');
    return;
  }

  const entries: HistoryEntry[] = lines.map(l => JSON.parse(l));

  // Group by suite
  const bySuite = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const list = bySuite.get(entry.suite) || [];
    list.push(entry);
    bySuite.set(entry.suite, list);
  }

  for (const [suite, suiteEntries] of bySuite) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Suite: ${suite}`);
    console.log('='.repeat(60));

    // Print header
    const summaryKeys = Object.keys(suiteEntries[0].summary);
    const header = ['Timestamp', 'SHA', 'Duration', ...summaryKeys].map(h => h.padEnd(16)).join('');
    console.log(header);
    console.log('-'.repeat(header.length));

    for (const entry of suiteEntries) {
      const ts = entry.timestamp.slice(0, 19).replace('T', ' ');
      const dur = `${(entry.duration_ms / 1000).toFixed(1)}s`;
      const vals = summaryKeys.map(k => {
        const v = entry.summary[k];
        return (typeof v === 'number' ? v.toFixed(4) : String(v)).padEnd(16);
      });
      console.log(`${ts.padEnd(16)}${entry.git_sha.padEnd(16)}${dur.padEnd(16)}${vals.join('')}`);
    }

    // Show F1 trend if available
    const f1Key = summaryKeys.find(k => k.toLowerCase().includes('f1'));
    if (f1Key && suiteEntries.length >= 2) {
      const first = suiteEntries[0].summary[f1Key];
      const last = suiteEntries[suiteEntries.length - 1].summary[f1Key];
      const delta = last - first;
      const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
      console.log(`\n  ${f1Key} trend: ${first.toFixed(4)} → ${last.toFixed(4)} (${arrow} ${(delta * 100).toFixed(1)}pp over ${suiteEntries.length} runs)`);
    }
  }

  console.log(`\nTotal entries: ${entries.length}`);
}

main();
