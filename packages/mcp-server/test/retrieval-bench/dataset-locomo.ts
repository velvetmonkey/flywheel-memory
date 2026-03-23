/**
 * LoCoMo Dataset Loader
 *
 * Downloads the LoCoMo-10 dataset (~2MB, 10 conversations, ~1986 QA pairs)
 * from snap-research/locomo on GitHub and caches locally.
 *
 * Each conversation has 19-32 sessions spanning weeks/months, with QA pairs
 * across 5 categories: single_hop, multi_hop, temporal, commonsense, adversarial.
 */

import * as fs from 'fs';
import * as path from 'path';

const LOCOMO_URL = 'https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json';
const CACHE_DIR = path.join(process.env.HOME || '/tmp', '.cache', 'flywheel-bench');
const CACHE_FILE = path.join(CACHE_DIR, 'locomo10.json');

// --- Raw dataset types ---

export interface LoCoMoDialog {
  speaker: string;
  dia_id: string;       // "D{session}:{turn}" e.g. "D1:3"
  text: string;
  img_url?: string[];
  blip_caption?: string;
  query?: string;
}

export interface LoCoMoQA {
  question: string;
  answer?: string;                // Present for categories 1-4
  adversarial_answer?: string;    // Present for category 5
  evidence: string[];             // ["D1:3", "D2:8"]
  category: number;               // 1-5
}

export interface LoCoMoConversation {
  speaker_a: string;
  speaker_b: string;
  [key: string]: any;  // session_N: LoCoMoDialog[], session_N_date_time: string
}

export interface LoCoMoEntry {
  qa: LoCoMoQA[];
  conversation: LoCoMoConversation;
  observation?: Record<string, any>;
  session_summary?: Record<string, string>;
  event_summary?: Record<string, any>;
}

// --- Benchmark types ---

export const CATEGORY_MAP: Record<number, string> = {
  1: 'multi_hop',
  2: 'single_hop',
  3: 'temporal',
  4: 'commonsense',
  5: 'adversarial',
};

export type LoCoMoCategory = 'multi_hop' | 'single_hop' | 'temporal' | 'commonsense' | 'adversarial';

export interface LoCoMoBenchmarkQuestion {
  question: string;
  answer: string;
  category: LoCoMoCategory;
  category_num: number;
  evidence_dia_ids: string[];
  /** Unique session numbers derived from evidence dia_ids */
  evidence_sessions: number[];
  /** Index of the conversation this question belongs to */
  conversation_idx: number;
}

export interface LoCoMoSession {
  session_num: number;
  date_time: string;
  turns: LoCoMoDialog[];
}

/**
 * Parse a dia_id like "D5:3" into session number and turn number.
 */
export function parseDiaId(diaId: string): { session: number; turn: number } {
  const match = diaId.match(/^D(\d+):(\d+)$/);
  if (!match) throw new Error(`Invalid dia_id format: ${diaId}`);
  return { session: parseInt(match[1], 10), turn: parseInt(match[2], 10) };
}

/**
 * Extract numbered sessions from a conversation object.
 * Sessions are stored as session_1, session_2, etc.
 */
export function extractSessions(conversation: LoCoMoConversation): LoCoMoSession[] {
  const sessions: LoCoMoSession[] = [];
  const keys = Object.keys(conversation);

  // Find all session_N keys (but not session_N_date_time or session_N_observation etc)
  const sessionKeys = keys
    .filter(k => /^session_\d+$/.test(k))
    .sort((a, b) => {
      const numA = parseInt(a.replace('session_', ''), 10);
      const numB = parseInt(b.replace('session_', ''), 10);
      return numA - numB;
    });

  for (const key of sessionKeys) {
    const num = parseInt(key.replace('session_', ''), 10);
    const dateTime = conversation[`${key}_date_time`] || '';
    const turns: LoCoMoDialog[] = conversation[key] || [];
    sessions.push({ session_num: num, date_time: dateTime, turns });
  }

  return sessions;
}

/**
 * Download LoCoMo dataset if not cached.
 */
async function ensureCached(): Promise<string> {
  if (fs.existsSync(CACHE_FILE)) {
    return CACHE_FILE;
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });

  console.log('Downloading LoCoMo-10 dataset (~2MB)...');
  const response = await fetch(LOCOMO_URL);
  if (!response.ok) {
    throw new Error(`Failed to download LoCoMo: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  fs.writeFileSync(CACHE_FILE, Buffer.from(buffer));
  console.log(`Cached at ${CACHE_FILE} (${Math.round(buffer.byteLength / 1024)}KB)`);

  return CACHE_FILE;
}

/**
 * Load the LoCoMo-10 dataset.
 *
 * @param opts.conversations - Filter by conversation indices (0-9). Default: all 10.
 * @param opts.categories - Filter QA by category number (1-5). Default: all.
 * @param opts.maxPerCategory - Cap questions per category per conversation.
 */
export async function loadLoCoMo(opts?: {
  conversations?: number[];
  categories?: number[];
  maxPerCategory?: number;
}): Promise<LoCoMoEntry[]> {
  const cachePath = await ensureCached();
  const raw: LoCoMoEntry[] = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));

  console.log(`Loaded ${raw.length} LoCoMo conversations from cache`);

  let entries = raw;

  // Filter by conversation index
  if (opts?.conversations) {
    entries = opts.conversations
      .filter(i => i >= 0 && i < raw.length)
      .map(i => raw[i]);
  }

  // Filter QA by category
  if (opts?.categories) {
    const cats = new Set(opts.categories);
    entries = entries.map(e => ({
      ...e,
      qa: e.qa.filter(q => cats.has(q.category)),
    }));
  }

  // Cap per category per conversation
  if (opts?.maxPerCategory) {
    const max = opts.maxPerCategory;
    entries = entries.map(e => {
      const counts: Record<number, number> = {};
      return {
        ...e,
        qa: e.qa.filter(q => {
          counts[q.category] = (counts[q.category] || 0) + 1;
          return counts[q.category] <= max;
        }),
      };
    });
  }

  return entries;
}

/**
 * Flatten all QA pairs from entries into benchmark questions.
 */
export function flattenQuestions(entries: LoCoMoEntry[]): LoCoMoBenchmarkQuestion[] {
  const questions: LoCoMoBenchmarkQuestion[] = [];

  for (let convIdx = 0; convIdx < entries.length; convIdx++) {
    const entry = entries[convIdx];

    for (const qa of entry.qa) {
      const category = CATEGORY_MAP[qa.category] as LoCoMoCategory;
      if (!category) continue;

      // Normalize answer: adversarial questions use "no information available"
      const answer = qa.category === 5
        ? 'no information available'
        : (qa.answer ?? '');

      // Extract unique session numbers from evidence
      const sessionSet = new Set<number>();
      for (const diaId of qa.evidence) {
        try {
          sessionSet.add(parseDiaId(diaId).session);
        } catch {
          // Skip malformed dia_ids
        }
      }

      questions.push({
        question: qa.question,
        answer,
        category,
        category_num: qa.category,
        evidence_dia_ids: qa.evidence,
        evidence_sessions: [...sessionSet].sort((a, b) => a - b),
        conversation_idx: convIdx,
      });
    }
  }

  return questions;
}
