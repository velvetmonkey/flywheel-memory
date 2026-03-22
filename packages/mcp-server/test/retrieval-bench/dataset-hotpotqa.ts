/**
 * HotpotQA Dataset Loader
 *
 * Downloads the HotpotQA distractor dev set (~85MB, 7405 questions)
 * and caches it locally. Each question has 10 context documents
 * (2 supporting + 8 distractors).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { BenchmarkQuestion } from './adapter.js';

const HOTPOTQA_URL = 'http://curtis.ml.cmu.edu/datasets/hotpot/hotpot_dev_distractor_v1.json';
const CACHE_DIR = path.join(process.env.HOME || '/tmp', '.cache', 'flywheel-bench');
const CACHE_FILE = path.join(CACHE_DIR, 'hotpot_dev_distractor_v1.json');

interface HotpotQAEntry {
  _id: string;
  question: string;
  answer: string;
  type: string;
  level: string;
  supporting_facts: Array<[string, number]>;
  context: Array<[string, string[]]>;
}

/**
 * Seeded PRNG (Mulberry32) for deterministic shuffling.
 */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Download file to local cache if not already present.
 */
async function ensureCached(): Promise<string> {
  if (fs.existsSync(CACHE_FILE)) {
    return CACHE_FILE;
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });

  console.log(`Downloading HotpotQA dev-distractor (~85MB)...`);
  const response = await fetch(HOTPOTQA_URL);
  if (!response.ok) {
    throw new Error(`Failed to download HotpotQA: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  fs.writeFileSync(CACHE_FILE, Buffer.from(buffer));
  console.log(`Cached at ${CACHE_FILE} (${Math.round(buffer.byteLength / 1024 / 1024)}MB)`);

  return CACHE_FILE;
}

/**
 * Load HotpotQA dev-distractor set.
 *
 * @param opts.count - Number of questions to sample (default: 200)
 * @param opts.seed - Random seed for deterministic sampling (default: 42)
 */
export async function loadHotpotQA(opts?: {
  count?: number;
  seed?: number;
}): Promise<BenchmarkQuestion[]> {
  const count = opts?.count ?? 200;
  const seed = opts?.seed ?? 42;

  const cachePath = await ensureCached();
  const raw: HotpotQAEntry[] = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));

  console.log(`Loaded ${raw.length} HotpotQA questions from cache`);

  // Deterministic shuffle
  const rng = mulberry32(seed);
  const indices = Array.from({ length: raw.length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  // Take subset
  const selected = indices.slice(0, Math.min(count, raw.length));

  return selected.map(idx => {
    const entry = raw[idx];
    // Derive supporting doc titles from supporting_facts
    const supportingDocs = [...new Set(entry.supporting_facts.map(([title]) => title))];

    return {
      question: entry.question,
      answer: entry.answer,
      supporting_docs: supportingDocs,
      supporting_facts: entry.supporting_facts,
      context: entry.context,
      type: entry.type as 'bridge' | 'comparison',
      level: entry.level as 'easy' | 'medium' | 'hard',
    };
  });
}
