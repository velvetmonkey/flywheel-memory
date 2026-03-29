#!/usr/bin/env node
/**
 * Build a vault from the LoCoMo-10 dataset.
 *
 * Usage:
 *   node demos/locomo/build-vault.js [--mode dialog|observation|summary] [--conversations 3]
 *
 * Outputs vault to demos/locomo/vault/ and ground truth to demos/locomo/ground-truth.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(process.env.HOME || '/tmp', '.cache', 'flywheel-bench');
const CACHE_FILE = path.join(CACHE_DIR, 'locomo10.json');
const LOCOMO_URL = 'https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json';
const VAULT_DIR = path.join(__dirname, 'vault');
const GROUND_TRUTH_FILE = path.join(__dirname, 'ground-truth.json');

const CATEGORY_MAP = { 1: 'multi_hop', 2: 'single_hop', 3: 'temporal', 4: 'commonsense', 5: 'adversarial' };

// Parse args
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal;
}
const mode = getArg('mode', 'dialog');
const maxConversations = parseInt(getArg('conversations', '10'), 10);

function parseDiaId(diaId) {
  const m = diaId.match(/^D(\d+):(\d+)$/);
  if (!m) return null;
  return { session: parseInt(m[1], 10), turn: parseInt(m[2], 10) };
}

function slugify(a, b) {
  const s = str => str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${s(a)}-${s(b)}`;
}

function extractSessions(conversation) {
  const sessions = [];
  const keys = Object.keys(conversation).filter(k => /^session_\d+$/.test(k)).sort((a, b) => {
    return parseInt(a.replace('session_', ''), 10) - parseInt(b.replace('session_', ''), 10);
  });
  for (const key of keys) {
    const num = parseInt(key.replace('session_', ''), 10);
    sessions.push({
      session_num: num,
      date_time: conversation[`${key}_date_time`] || '',
      turns: conversation[key] || [],
    });
  }
  return sessions;
}

function parseDateTime(str) {
  if (!str) return { date: '', time: '' };
  const m = str.match(/(\d{1,2}):(\d{2})\s*(am|pm)\s+on\s+(\d{1,2})\s+(\w+),?\s*(\d{4})/i);
  if (!m) return { date: '', time: '' };
  const months = { january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',
                    july:'07',august:'08',september:'09',october:'10',november:'11',december:'12' };
  let hour = parseInt(m[1], 10);
  if (m[3].toLowerCase() === 'pm' && hour !== 12) hour += 12;
  if (m[3].toLowerCase() === 'am' && hour === 12) hour = 0;
  return {
    date: `${m[6]}-${months[m[5].toLowerCase()] || '01'}-${m[4].padStart(2, '0')}`,
    time: `${String(hour).padStart(2, '0')}:${m[2]}`,
  };
}

function formatSessionDateText(isoDate) {
  if (!isoDate) return '';
  const months = {
    '01':'January','02':'February','03':'March','04':'April',
    '05':'May','06':'June','07':'July','08':'August',
    '09':'September','10':'October','11':'November','12':'December',
  };
  const [year, month, day] = isoDate.split('-');
  const monthName = months[month] || month;
  const dayNum = parseInt(day, 10);
  return `Session date: ${monthName} ${dayNum}, ${year} (${isoDate}, ${monthName} ${year})`;
}


function buildDialogNote(session, speakerA, speakerB) {
  const { date, time } = parseDateTime(session.date_time);
  const pad = String(session.session_num).padStart(2, '0');
  const lines = ['---'];
  if (date) lines.push(`date: ${date}`);
  if (time) lines.push(`time: "${time}"`);
  lines.push(`speakers: [${speakerA}, ${speakerB}]`, `session: ${session.session_num}`, '---', '');
  lines.push(`# Session ${pad} — ${speakerA} & ${speakerB}`, '');
  if (session.date_time) lines.push(`*${session.date_time}*`, '');
  const dateText = formatSessionDateText(date);
  if (dateText) lines.push(dateText, '');
  for (const turn of session.turns) {
    lines.push(`**${turn.speaker}:** ${turn.text}`, '');
  }
  return lines.join('\n');
}

function buildObservationNote(session, speakerA, speakerB, entry) {
  const { date, time } = parseDateTime(session.date_time);
  const pad = String(session.session_num).padStart(2, '0');
  const sessionKey = `session_${session.session_num}`;
  const lines = ['---'];
  if (date) lines.push(`date: ${date}`);
  if (time) lines.push(`time: "${time}"`);
  lines.push(`speakers: [${speakerA}, ${speakerB}]`, `session: ${session.session_num}`, 'type: observation', '---', '');
  lines.push(`# Session ${pad} — Observations`, '');
  const dateText = formatSessionDateText(date);
  if (dateText) lines.push(dateText, '');

  const obs = entry.observation;
  const obsKey = `${sessionKey}_observation`;
  let hasContent = false;
  if (obs && obs[obsKey]) {
    const sessionObs = obs[obsKey];
    for (const speaker of [speakerA, speakerB]) {
      if (sessionObs[speaker]) {
        lines.push(`## ${speaker}`, '');
        const items = sessionObs[speaker];
        if (Array.isArray(items)) {
          for (const item of items) {
            const text = Array.isArray(item) ? item[0] : item;
            lines.push(`- ${text}`);
          }
        }
        lines.push('');
        hasContent = true;
      }
    }
  }
  if (!hasContent) {
    // Fallback to dialog
    for (const turn of session.turns) {
      lines.push(`**${turn.speaker}:** ${turn.text}`, '');
    }
  }
  return lines.join('\n');
}

function buildSummaryNote(session, speakerA, speakerB, entry) {
  const { date, time } = parseDateTime(session.date_time);
  const pad = String(session.session_num).padStart(2, '0');
  const sessionKey = `session_${session.session_num}`;
  const lines = ['---'];
  if (date) lines.push(`date: ${date}`);
  if (time) lines.push(`time: "${time}"`);
  lines.push(`speakers: [${speakerA}, ${speakerB}]`, `session: ${session.session_num}`, 'type: summary', '---', '');
  lines.push(`# Session ${pad} Summary`, '');
  const dateText = formatSessionDateText(date);
  if (dateText) lines.push(dateText, '');

  const summaries = entry.session_summary;
  if (summaries && summaries[sessionKey]) {
    lines.push(summaries[sessionKey], '');
  } else {
    for (const turn of session.turns) {
      lines.push(`**${turn.speaker}:** ${turn.text}`, '');
    }
  }
  return lines.join('\n');
}

async function main() {
  // 1. Ensure cached
  if (!fs.existsSync(CACHE_FILE)) {
    console.log('Downloading LoCoMo-10 dataset (~2MB)...');
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const resp = await fetch(LOCOMO_URL);
    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
    const buf = await resp.arrayBuffer();
    fs.writeFileSync(CACHE_FILE, Buffer.from(buf));
    console.log(`Cached (${Math.round(buf.byteLength / 1024)}KB)`);
  }

  // 2. Load
  const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  const entries = raw.slice(0, maxConversations);
  console.log(`Loaded ${entries.length}/${raw.length} conversations (mode=${mode})`);

  // 3. Build vault
  if (fs.existsSync(VAULT_DIR)) {
    fs.rmSync(VAULT_DIR, { recursive: true });
  }

  const groundTruth = [];
  const allSpeakers = new Set();
  let totalSessions = 0;

  for (let convIdx = 0; convIdx < entries.length; convIdx++) {
    const entry = entries[convIdx];
    const conv = entry.conversation;
    const speakerA = conv.speaker_a;
    const speakerB = conv.speaker_b;
    const slug = slugify(speakerA, speakerB);
    allSpeakers.add(speakerA);
    allSpeakers.add(speakerB);

    const sessions = extractSessions(conv);
    const convDir = path.join(VAULT_DIR, 'conversations', slug);
    fs.mkdirSync(convDir, { recursive: true });

    // Build dia_id -> path map for this conversation
    const diaIdToPath = new Map();

    for (const session of sessions) {
      const pad = String(session.session_num).padStart(2, '0');
      const filePath = `conversations/${slug}/session-${pad}.md`;

      let content;
      if (mode === 'observation') {
        content = buildObservationNote(session, speakerA, speakerB, entry);
      } else if (mode === 'summary') {
        content = buildSummaryNote(session, speakerA, speakerB, entry);
      } else {
        content = buildDialogNote(session, speakerA, speakerB);
      }

      fs.writeFileSync(path.join(VAULT_DIR, filePath), content, 'utf-8');

      for (const turn of session.turns) {
        diaIdToPath.set(turn.dia_id, filePath);
      }
      totalSessions++;
    }

    // Record ground truth for QA pairs
    for (const qa of entry.qa) {
      const category = CATEGORY_MAP[qa.category] || `cat_${qa.category}`;
      const answer = qa.category === 5 ? 'no information available' : (qa.answer || '');
      const evidencePaths = [...new Set(
        qa.evidence
          .map(diaId => diaIdToPath.get(diaId))
          .filter(Boolean)
      )];

      groundTruth.push({
        question: qa.question,
        answer,
        category,
        category_num: qa.category,
        evidence_dia_ids: qa.evidence,
        evidence_paths: evidencePaths,
        conversation_idx: convIdx,
      });
    }
  }

  // Write people stubs
  const peoplePath = path.join(VAULT_DIR, 'people');
  fs.mkdirSync(peoplePath, { recursive: true });
  for (const speaker of allSpeakers) {
    const safeName = speaker.replace(/[/\\:*?"<>|]/g, '_');
    fs.writeFileSync(
      path.join(peoplePath, `${safeName}.md`),
      `---\ntype: person\n---\n# ${speaker}\n\nPerson in conversations.\n`,
      'utf-8',
    );
  }

  // Write ground truth
  fs.writeFileSync(GROUND_TRUTH_FILE, JSON.stringify({
    generated: new Date().toISOString(),
    dataset: 'locomo10',
    vault_mode: mode,
    count: groundTruth.length,
    total_conversations: entries.length,
    total_sessions: totalSessions,
    questions: groundTruth,
  }, null, 2));

  console.log(`Vault: ${VAULT_DIR} (${totalSessions} session notes, ${allSpeakers.size} people)`);
  console.log(`Ground truth: ${GROUND_TRUTH_FILE} (${groundTruth.length} questions)`);
}

main().catch(err => { console.error(err); process.exit(1); });
