#!/usr/bin/env tsx
/**
 * BYOV (Bring Your Own Vault) evaluation CLI
 *
 * Evaluates flywheel-memory search quality against a user's vault.
 *
 * Usage:
 *   tsx src/cli/byov.ts --questions questions.jsonl
 *   tsx src/cli/byov.ts --questions questions.jsonl --url http://localhost:3111 --output results.json
 */
import fs from 'fs/promises';
import path from 'path';

interface Question { question: string; expected_notes: string[]; expected_keywords?: string[] }
interface QuestionResult {
  question: string; expected_notes: string[]; found_notes: string[]; note_recall: number;
  expected_keywords: string[]; found_keywords: string[]; keyword_recall: number;
}
interface Report {
  summary: { total_questions: number; evidence_recall: number; keyword_recall: number; timestamp: string };
  questions: QuestionResult[];
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let questions = '', output: string | null = null, url = 'http://localhost:3111', timeout = 30000;
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--questions': questions = args[++i]; break;
      case '--output':    output = args[++i]; break;
      case '--url':       url = args[++i]; break;
      case '--timeout':   timeout = parseInt(args[++i], 10); break;
    }
  }
  if (!questions) {
    console.error('Usage: byov --questions <path> [--output <path>] [--url <url>] [--timeout <ms>]');
    process.exit(1);
  }
  return { questions, output, url, timeout };
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) {
        const body = await res.json() as Record<string, unknown>;
        if (body.ready) return;
      }
    } catch { /* server not up yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

async function callSearch(url: string, query: string, id: number): Promise<{ paths: string[]; text: string }> {
  const res = await fetch(`${url}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id, method: 'tools/call',
      params: { name: 'search', arguments: { query } },
    }),
  });
  if (!res.ok) throw new Error(`MCP request failed: ${res.status} ${res.statusText}`);

  const body = await res.json() as Record<string, unknown>;
  const result = body.result as { content?: Array<{ type: string; text: string }> } | undefined;
  const fullText = (result?.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n');

  const pathPattern = /(?:^|\s|path:\s*|file:\s*|note:\s*)([^\s]+\.md)/gim;
  const paths: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pathPattern.exec(fullText)) !== null) paths.push(match[1]);
  return { paths, text: fullText };
}

function scoreNotes(expected: string[], foundPaths: string[]): string[] {
  return expected.filter(exp => {
    const el = exp.toLowerCase();
    const isPrefix = el.endsWith('/');
    return foundPaths.some(p => {
      const pl = p.toLowerCase();
      return isPrefix ? pl.includes(el.slice(0, -1)) : pl.includes(el) || pl.endsWith(el);
    });
  });
}

function scoreKeywords(expected: string[], text: string): string[] {
  const tl = text.toLowerCase();
  return expected.filter(kw => tl.includes(kw.toLowerCase()));
}

async function main(): Promise<void> {
  const { questions: qPath, output, url, timeout } = parseArgs(process.argv);

  const raw = await fs.readFile(path.resolve(qPath), 'utf-8');
  const questions: Question[] = raw.split('\n').map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l));
  if (!questions.length) { console.error('No questions found in file'); process.exit(1); }

  console.error(`Loaded ${questions.length} questions from ${qPath}`);
  console.error(`Waiting for server at ${url}...`);
  await waitForServer(url, timeout);
  console.error('Server ready. Running evaluation...');

  const results: QuestionResult[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i], expectedKw = q.expected_keywords ?? [];
    try {
      const { paths, text } = await callSearch(url, q.question, i + 1);
      const foundNotes = scoreNotes(q.expected_notes, paths);
      const foundKw = scoreKeywords(expectedKw, text);
      results.push({
        question: q.question, expected_notes: q.expected_notes, found_notes: foundNotes,
        note_recall: q.expected_notes.length > 0 ? foundNotes.length / q.expected_notes.length : 1,
        expected_keywords: expectedKw, found_keywords: foundKw,
        keyword_recall: expectedKw.length > 0 ? foundKw.length / expectedKw.length : 1,
      });
      console.error(`  [${i + 1}/${questions.length}] "${q.question}" - notes: ${foundNotes.length}/${q.expected_notes.length}, keywords: ${foundKw.length}/${expectedKw.length}`);
    } catch (err) {
      console.error(`  [${i + 1}/${questions.length}] "${q.question}" - ERROR: ${err}`);
      results.push({
        question: q.question, expected_notes: q.expected_notes, found_notes: [], note_recall: 0,
        expected_keywords: expectedKw, found_keywords: [], keyword_recall: 0,
      });
    }
  }

  const avg = (fn: (r: QuestionResult) => number) => results.reduce((s, r) => s + fn(r), 0) / results.length;
  const report: Report = {
    summary: {
      total_questions: results.length,
      evidence_recall: Math.round(avg(r => r.note_recall) * 1000) / 1000,
      keyword_recall: Math.round(avg(r => r.keyword_recall) * 1000) / 1000,
      timestamp: new Date().toISOString(),
    },
    questions: results,
  };

  const json = JSON.stringify(report, null, 2);
  if (output) {
    await fs.writeFile(path.resolve(output), json, 'utf-8');
    console.error(`Report written to ${output}`);
  } else {
    process.stdout.write(json + '\n');
  }
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
