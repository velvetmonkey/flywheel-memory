#!/usr/bin/env node
/**
 * Build a vault from HotpotQA dev-distractor subset.
 *
 * Usage:
 *   node demos/hotpotqa/build-vault.js [--count 50] [--seed 42]
 *
 * Outputs vault to demos/hotpotqa/vault/ and ground truth to demos/hotpotqa/ground-truth.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(process.env.HOME || '/tmp', '.cache', 'flywheel-bench');
const CACHE_FILE = path.join(CACHE_DIR, 'hotpot_dev_distractor_v1.json');
const VAULT_DIR = path.join(__dirname, 'vault');
const GROUND_TRUTH_FILE = path.join(__dirname, 'ground-truth.json');

// Parse args
const args = process.argv.slice(2);
const count = parseInt(args[args.indexOf('--count') + 1] || '50', 10);
const seed = parseInt(args[args.indexOf('--seed') + 1] || '42', 10);

// Seeded PRNG
function mulberry32(s) {
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  // 1. Ensure dataset is cached
  if (!fs.existsSync(CACHE_FILE)) {
    console.log('Downloading HotpotQA dev-distractor (~85MB)...');
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const resp = await fetch('http://curtis.ml.cmu.edu/datasets/hotpot/hotpot_dev_distractor_v1.json');
    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
    const buf = await resp.arrayBuffer();
    fs.writeFileSync(CACHE_FILE, Buffer.from(buf));
    console.log(`Cached (${Math.round(buf.byteLength / 1024 / 1024)}MB)`);
  }

  // 2. Load and sample
  console.log('Loading dataset...');
  const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  console.log(`${raw.length} questions available`);

  const rng = mulberry32(seed);
  const indices = Array.from({ length: raw.length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const selected = indices.slice(0, count).map(i => raw[i]);
  console.log(`Selected ${selected.length} questions (seed=${seed})`);

  // 3. Build vault
  if (fs.existsSync(VAULT_DIR)) {
    fs.rmSync(VAULT_DIR, { recursive: true });
  }
  fs.mkdirSync(path.join(VAULT_DIR, 'docs'), { recursive: true });

  const docPathMap = new Map();
  const groundTruth = [];

  /** Infer entity type from Wikipedia content patterns */
  function inferType(text) {
    const first = text.slice(0, 500).toLowerCase();
    if (/\b(born|died)\b.*\bis an?\b|\bis an?\b.*\b(singer|actor|actress|writer|politician|player|coach|artist|musician|author|poet|director|journalist|scientist|professor|engineer|general|admiral|bishop|philosopher)\b/.test(first)) return 'person';
    if (/\bis an?\b.*\b(city|town|village|municipality|commune|district|county|province|region|state|island|river|mountain|lake|peninsula)\b/.test(first)) return 'location';
    if (/\bis an?\b.*\b(album|film|movie|song|single|novel|book|series|show|episode|documentary|musical|opera|play|poem|magazine|newspaper|journal)\b/.test(first)) return 'media';
    if (/\bis an?\b.*\b(company|corporation|organization|institution|university|school|college|agency|foundation|association|team|club|band|group)\b/.test(first)) return 'organization';
    return 'document';
  }

  for (const entry of selected) {
    // Write context docs
    for (const [title, sentences] of entry.context) {
      if (docPathMap.has(title)) continue;
      const safeName = title.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
      const filePath = `docs/${safeName}.md`;
      const body = sentences.join('\n\n');
      const type = inferType(body);
      const content = `---\ntype: ${type}\n---\n# ${title}\n\n${body}`;
      fs.writeFileSync(path.join(VAULT_DIR, filePath), content, 'utf-8');
      docPathMap.set(title, filePath);
    }

    // Record ground truth
    const supportingDocs = [...new Set(entry.supporting_facts.map(([t]) => t))];
    groundTruth.push({
      id: entry._id,
      question: entry.question,
      answer: entry.answer,
      type: entry.type,
      level: entry.level,
      supporting_docs: supportingDocs,
      supporting_paths: supportingDocs.map(t => docPathMap.get(t)).filter(Boolean),
    });
  }

  // Write ground truth
  fs.writeFileSync(GROUND_TRUTH_FILE, JSON.stringify({
    generated: new Date().toISOString(),
    count: groundTruth.length,
    seed,
    total_docs: docPathMap.size,
    questions: groundTruth,
  }, null, 2));

  console.log(`Vault: ${VAULT_DIR} (${docPathMap.size} docs)`);
  console.log(`Ground truth: ${GROUND_TRUTH_FILE} (${groundTruth.length} questions)`);
}

main().catch(err => { console.error(err); process.exit(1); });
