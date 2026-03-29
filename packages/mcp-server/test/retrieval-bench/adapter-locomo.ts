/**
 * LoCoMo Vault Builder
 *
 * Converts LoCoMo conversation entries into a temporary vault
 * for retrieval benchmarking. Supports three vault modes:
 *
 * - dialog:      Raw conversation turns as note content
 * - observation:  Per-session observations from LoCoMo annotations
 * - summary:     Session summaries from LoCoMo annotations
 */

import * as os from 'os';
import * as path from 'path';
import { mkdir, writeFile, rm } from 'fs/promises';
import { mkdtemp } from 'fs/promises';
import { openStateDb, deleteStateDb } from '@velvetmonkey/vault-core';
import type { StateDb } from '@velvetmonkey/vault-core';
import { buildFTS5Index, searchFTS5, setFTS5Database } from '../../src/core/read/fts5.js';
import {
  setEmbeddingsDatabase,
  initEmbeddings,
  buildEmbeddingsIndex,
  semanticSearch,
  hasEmbeddingsIndex,
  reciprocalRankFusion,
} from '../../src/core/read/embeddings.js';
import { setWriteStateDb } from '../../src/core/write/wikilinks.js';
import { setRecencyStateDb } from '../../src/core/shared/recency.js';
import type { LoCoMoEntry, LoCoMoSession } from './dataset-locomo.js';
import { extractSessions, parseDiaId } from './dataset-locomo.js';

export type VaultMode = 'dialog' | 'observation' | 'summary';

export interface LoCoMoVault {
  vaultPath: string;
  stateDb: StateDb;
  /** Map from dia_id (e.g. "D5:3") to note path for each conversation */
  diaIdToPath: Map<string, string>;
  /** Map from "convIdx:session_num" to note path */
  sessionToPath: Map<string, string>;
  /** Total number of session notes written */
  totalSessions: number;
  cleanup: () => Promise<void>;
}

/**
 * Slugify two speaker names into a folder name.
 */
export function slugifyConversation(speakerA: string, speakerB: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug(speakerA)}-${slug(speakerB)}`;
}

/**
 * Parse LoCoMo datetime strings like "1:56 pm on 8 May, 2023"
 * or "10:30 am on 15 June, 2023" into structured date/time.
 */
export function parseSessionDateTime(dateTimeStr: string): { date: string; time: string } {
  if (!dateTimeStr) return { date: '', time: '' };

  // Pattern: "H:MM am/pm on D Month, YYYY"
  const match = dateTimeStr.match(
    /(\d{1,2}):(\d{2})\s*(am|pm)\s+on\s+(\d{1,2})\s+(\w+),?\s*(\d{4})/i
  );

  if (!match) return { date: '', time: '' };

  const [, hourStr, min, ampm, day, monthName, year] = match;
  let hour = parseInt(hourStr, 10);
  if (ampm.toLowerCase() === 'pm' && hour !== 12) hour += 12;
  if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0;

  const months: Record<string, string> = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12',
  };

  const monthNum = months[monthName.toLowerCase()] || '01';
  const date = `${year}-${monthNum}-${day.padStart(2, '0')}`;
  const time = `${String(hour).padStart(2, '0')}:${min}`;

  return { date, time };
}

/**
 * Format an ISO date and raw datetime string into a human-readable
 * session date line with multiple search-friendly forms.
 * E.g. "Session date: May 8, 2023 (2023-05-08, May 2023)"
 */
function formatSessionDateText(isoDate: string, rawDateTime: string): string {
  if (!isoDate) return '';
  const months: Record<string, string> = {
    '01': 'January', '02': 'February', '03': 'March', '04': 'April',
    '05': 'May', '06': 'June', '07': 'July', '08': 'August',
    '09': 'September', '10': 'October', '11': 'November', '12': 'December',
  };
  const [year, month, day] = isoDate.split('-');
  const monthName = months[month] || month;
  const dayNum = parseInt(day, 10);
  return `Session date: ${monthName} ${dayNum}, ${year} (${isoDate}, ${monthName} ${year})`;
}


/**
 * Build a session note in dialog mode (raw conversation turns).
 */
function buildDialogNote(
  session: LoCoMoSession,
  speakerA: string,
  speakerB: string,
): string {
  const { date, time } = parseSessionDateTime(session.date_time);
  const padded = String(session.session_num).padStart(2, '0');

  const lines: string[] = [];
  lines.push('---');
  if (date) lines.push(`date: ${date}`);
  if (time) lines.push(`time: "${time}"`);
  lines.push(`speakers: [${speakerA}, ${speakerB}]`);
  lines.push(`session: ${session.session_num}`);
  lines.push('---');
  lines.push('');
  lines.push(`# Session ${padded} — ${speakerA} & ${speakerB}`);
  lines.push('');
  if (session.date_time) {
    lines.push(`*${session.date_time}*`);
    lines.push('');
  }

  const dateText = formatSessionDateText(date, session.date_time);
  if (dateText) {
    lines.push(dateText);
    lines.push('');
  }

  for (const turn of session.turns) {
    lines.push(`**${turn.speaker}:** ${turn.text}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Build a session note in observation mode.
 * Uses per-session observations from LoCoMo annotations.
 */
function buildObservationNote(
  session: LoCoMoSession,
  speakerA: string,
  speakerB: string,
  entry: LoCoMoEntry,
): string {
  const { date, time } = parseSessionDateTime(session.date_time);
  const padded = String(session.session_num).padStart(2, '0');
  const sessionKey = `session_${session.session_num}`;

  const lines: string[] = [];
  lines.push('---');
  if (date) lines.push(`date: ${date}`);
  if (time) lines.push(`time: "${time}"`);
  lines.push(`speakers: [${speakerA}, ${speakerB}]`);
  lines.push(`session: ${session.session_num}`);
  lines.push('type: observation');
  lines.push('---');
  lines.push('');
  lines.push(`# Session ${padded} — Observations`);
  lines.push('');

  const dateText = formatSessionDateText(date, session.date_time);
  if (dateText) {
    lines.push(dateText);
    lines.push('');
  }

  // Try to find observations for this session
  // LoCoMo keys observations as session_N_observation -> speaker -> [items]
  const obs = entry.observation;
  const obsKey = `${sessionKey}_observation`;
  if (obs && obs[obsKey]) {
    const sessionObs = obs[obsKey];
    for (const speaker of [speakerA, speakerB]) {
      if (sessionObs[speaker]) {
        lines.push(`## ${speaker}`);
        lines.push('');
        const items = sessionObs[speaker];
        if (Array.isArray(items)) {
          for (const item of items) {
            // Items can be [observation, evidence] tuples or just strings
            const text = Array.isArray(item) ? item[0] : item;
            lines.push(`- ${text}`);
          }
        }
        lines.push('');
      }
    }
  }

  // Fallback: if no observations found, use dialog turns
  if (lines.length <= 9) {
    lines.push('*No observations available for this session.*');
    lines.push('');
    for (const turn of session.turns) {
      lines.push(`**${turn.speaker}:** ${turn.text}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Build a session note in summary mode.
 * Uses session summaries from LoCoMo annotations.
 */
function buildSummaryNote(
  session: LoCoMoSession,
  speakerA: string,
  speakerB: string,
  entry: LoCoMoEntry,
): string {
  const { date, time } = parseSessionDateTime(session.date_time);
  const padded = String(session.session_num).padStart(2, '0');
  const sessionKey = `session_${session.session_num}`;

  const lines: string[] = [];
  lines.push('---');
  if (date) lines.push(`date: ${date}`);
  if (time) lines.push(`time: "${time}"`);
  lines.push(`speakers: [${speakerA}, ${speakerB}]`);
  lines.push(`session: ${session.session_num}`);
  lines.push('type: summary');
  lines.push('---');
  lines.push('');
  lines.push(`# Session ${padded} Summary`);
  lines.push('');

  const dateText = formatSessionDateText(date, session.date_time);
  if (dateText) {
    lines.push(dateText);
    lines.push('');
  }

  // Try to find summary for this session
  const summaries = entry.session_summary;
  if (summaries && summaries[sessionKey]) {
    lines.push(summaries[sessionKey]);
    lines.push('');
  } else {
    // Fallback: build a simple summary from dialog
    lines.push('*No summary available for this session.*');
    lines.push('');
    for (const turn of session.turns) {
      lines.push(`**${turn.speaker}:** ${turn.text}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Build a temporary vault from LoCoMo entries.
 */
export async function buildLoCoMoVault(
  entries: LoCoMoEntry[],
  opts?: {
    mode?: VaultMode;
    includeEntityNotes?: boolean;
    semantic?: boolean;
  },
): Promise<LoCoMoVault> {
  const mode = opts?.mode ?? 'dialog';
  const includeEntityNotes = opts?.includeEntityNotes ?? true;
  const buildSemantic = opts?.semantic ?? false;

  const vaultPath = await mkdtemp(path.join(os.tmpdir(), 'flywheel-locomo-'));
  const diaIdToPath = new Map<string, string>();
  const sessionToPath = new Map<string, string>();
  const allSpeakers = new Set<string>();
  let totalSessions = 0;

  for (let convIdx = 0; convIdx < entries.length; convIdx++) {
    const entry = entries[convIdx];
    const conv = entry.conversation;
    const speakerA = conv.speaker_a;
    const speakerB = conv.speaker_b;
    const slug = slugifyConversation(speakerA, speakerB);
    allSpeakers.add(speakerA);
    allSpeakers.add(speakerB);

    const sessions = extractSessions(conv);

    for (const session of sessions) {
      const padded = String(session.session_num).padStart(2, '0');
      const filePath = `conversations/${slug}/session-${padded}.md`;
      const fullPath = path.join(vaultPath, filePath);

      await mkdir(path.dirname(fullPath), { recursive: true });

      let content: string;
      switch (mode) {
        case 'observation':
          content = buildObservationNote(session, speakerA, speakerB, entry);
          break;
        case 'summary':
          content = buildSummaryNote(session, speakerA, speakerB, entry);
          break;
        default:
          content = buildDialogNote(session, speakerA, speakerB);
      }

      await writeFile(fullPath, content, 'utf-8');

      // Map all dia_ids in this session to this note path
      for (const turn of session.turns) {
        diaIdToPath.set(`${convIdx}:${turn.dia_id}`, filePath);
      }

      sessionToPath.set(`${convIdx}:${session.session_num}`, filePath);
      totalSessions++;
    }
  }

  // Write people stub notes
  if (includeEntityNotes) {
    const peoplePath = path.join(vaultPath, 'people');
    await mkdir(peoplePath, { recursive: true });

    for (const speaker of allSpeakers) {
      const safeName = speaker.replace(/[/\\:*?"<>|]/g, '_');
      const content = `# ${speaker}\n\nPerson in conversations.\n`;
      await writeFile(path.join(peoplePath, `${safeName}.md`), content, 'utf-8');
    }
  }

  // Initialize StateDb and FTS5
  const stateDb = openStateDb(vaultPath);
  setWriteStateDb(stateDb);
  setRecencyStateDb(stateDb);
  setFTS5Database(stateDb.db);
  await buildFTS5Index(vaultPath);

  // Optional: build semantic embeddings for hybrid search
  if (buildSemantic) {
    setEmbeddingsDatabase(stateDb.db);
    await initEmbeddings();
    await buildEmbeddingsIndex(vaultPath);
  }

  const cleanup = async () => {
    setWriteStateDb(null);
    setRecencyStateDb(null);
    setFTS5Database(null);
    setEmbeddingsDatabase(null as any);
    stateDb.close();
    deleteStateDb(vaultPath);
    await rm(vaultPath, { recursive: true, force: true });
  };

  return { vaultPath, stateDb, diaIdToPath, sessionToPath, totalSessions, cleanup };
}

/**
 * Get the set of relevant note paths for a benchmark question.
 * Deduplicates across dia_ids from the same session.
 */
export function getRelevantPaths(
  question: { evidence_dia_ids: string[]; conversation_idx: number },
  vault: LoCoMoVault,
): Set<string> {
  const paths = new Set<string>();
  for (const diaId of question.evidence_dia_ids) {
    const key = `${question.conversation_idx}:${diaId}`;
    const notePath = vault.diaIdToPath.get(key);
    if (notePath) paths.add(notePath);
  }
  return paths;
}

/**
 * Run a retrieval query against the vault. Same logic as adapter.ts runQuery.
 */
export function runQuery(vaultPath: string, query: string, maxResults: number = 20): string[] {
  const words = query.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length >= 3)
    .filter(w => !STOP_WORDS.has(w));

  if (words.length === 0) return [];

  const fts5Query = words.join(' OR ');

  try {
    const results = searchFTS5(vaultPath, fts5Query, maxResults);
    return results.map(r => r.path);
  } catch {
    return [];
  }
}

/**
 * Run a multi-hop retrieval query: initial FTS5, then search within the
 * same conversation folders for additional evidence.
 *
 * Multi-hop LoCoMo questions typically reference a person and a topic.
 * Evidence is often spread across sessions in the same conversation folder.
 * After the first FTS5 pass, we extract the conversation folder(s) from
 * top results and run a second FTS5 pass restricted to those folders.
 */
export function runMultiHopQuery(vaultPath: string, query: string, maxResults: number = 20): string[] {
  // First hop: standard FTS5
  const words = query.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length >= 3)
    .filter(w => !STOP_WORDS.has(w));

  if (words.length === 0) return [];

  const fts5Query = words.join(' OR ');
  let firstResults: Array<{ path: string; snippet?: string; title?: string }>;
  try {
    firstResults = searchFTS5(vaultPath, fts5Query, maxResults);
  } catch {
    return [];
  }

  const firstPaths = firstResults.map(r => r.path);
  if (firstResults.length === 0) return firstPaths;

  // Extract conversation folders from top results
  const convFolders = new Set<string>();
  for (const r of firstResults.slice(0, 5)) {
    const match = r.path.match(/^(conversations\/[^/]+)\//);
    if (match) convFolders.add(match[1]);
  }

  if (convFolders.size === 0) return firstPaths;

  // Build a broader query: use all content words (not just FTS5-filtered)
  // plus try individual key terms to catch sessions that discuss the topic
  // without using the exact question phrasing
  const keyTerms = words.filter(w => w.length >= 4);
  if (keyTerms.length === 0) return firstPaths;

  // Second hop: search each conversation folder with individual key terms
  // This catches sessions where the topic is discussed but the person name
  // might not appear (e.g., the other speaker recounts what they said)
  const seen = new Set(firstPaths);
  const merged = [...firstPaths];

  for (const folder of convFolders) {
    for (const term of keyTerms.slice(0, 4)) {
      try {
        const results = searchFTS5(vaultPath, term, maxResults * 2);
        for (const r of results) {
          if (!seen.has(r.path) && r.path.startsWith(folder + '/')) {
            merged.push(r.path);
            seen.add(r.path);
          }
        }
      } catch {
        // ignore
      }
    }
  }

  return merged.slice(0, maxResults);
}

/**
 * Run a hybrid retrieval query: FTS5 + semantic search merged via RRF.
 * Requires the vault to have been built with { semantic: true }.
 */
export async function runHybridQuery(vaultPath: string, query: string, maxResults: number = 20): Promise<string[]> {
  // FTS5 leg
  const words = query.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length >= 3)
    .filter(w => !STOP_WORDS.has(w));

  let fts5Results: Array<{ path: string }> = [];
  if (words.length > 0) {
    const fts5Query = words.join(' OR ');
    try {
      fts5Results = searchFTS5(vaultPath, fts5Query, maxResults * 2);
    } catch {
      // FTS5 failure — proceed with semantic only
    }
  }

  // Semantic leg
  let semResults: Array<{ path: string }> = [];
  if (hasEmbeddingsIndex()) {
    try {
      semResults = await semanticSearch(query, maxResults * 2);
    } catch {
      // Semantic failure — proceed with FTS5 only
    }
  }

  if (fts5Results.length === 0 && semResults.length === 0) return [];

  // Merge via Reciprocal Rank Fusion
  const rrfScores = reciprocalRankFusion(fts5Results, semResults);

  // Sort by RRF score descending
  const sorted = Array.from(rrfScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxResults)
    .map(([path]) => path);

  return sorted;
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her',
  'was', 'one', 'our', 'out', 'has', 'have', 'been', 'many', 'some', 'them',
  'than', 'its', 'over', 'such', 'that', 'this', 'what', 'with', 'will',
  'each', 'make', 'like', 'from', 'when', 'who', 'which', 'their', 'how',
  'did', 'does', 'more', 'other',
]);
