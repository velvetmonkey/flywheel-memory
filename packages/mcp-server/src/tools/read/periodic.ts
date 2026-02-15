/**
 * Periodic note detection - zero-config vault convention discovery
 *
 * Answer: "Where does this vault keep daily/weekly/monthly notes?"
 *
 * Note: detect_periodic_notes tool was absorbed into health_check output.
 * These functions are exported for internal use by health.ts and mutations.ts.
 */

import type { VaultIndex } from '../../core/read/types.js';

/**
 * Date pattern regexes for different note types
 */
const DATE_PATTERNS = {
  daily: [
    { name: 'YYYY-MM-DD', regex: /^\d{4}-\d{2}-\d{2}\.md$/, format: 'YYYY-MM-DD' },
    { name: 'YYYY-MM-DD-*', regex: /^\d{4}-\d{2}-\d{2}-.+\.md$/, format: 'YYYY-MM-DD-*' },
    { name: 'DD-MM-YYYY', regex: /^\d{2}-\d{2}-\d{4}\.md$/, format: 'DD-MM-YYYY' },
  ],
  weekly: [
    { name: 'YYYY-WXX', regex: /^\d{4}-W\d{2}\.md$/, format: 'YYYY-WXX' },
    { name: 'YYYY-[W]XX', regex: /^\d{4}-\[W\]\d{2}\.md$/, format: 'YYYY-[W]XX' },
  ],
  monthly: [
    { name: 'YYYY-MM', regex: /^\d{4}-\d{2}\.md$/, format: 'YYYY-MM' },
  ],
  quarterly: [
    { name: 'YYYY-QX', regex: /^\d{4}-Q[1-4]\.md$/, format: 'YYYY-QX' },
  ],
  yearly: [
    { name: 'YYYY', regex: /^\d{4}\.md$/, format: 'YYYY' },
  ],
};

/**
 * Common folder names for periodic notes
 */
const COMMON_FOLDERS = {
  daily: ['daily-notes', 'Daily', 'journal', 'Journal', 'dailies'],
  weekly: ['weekly-notes', 'Weekly', 'weeklies'],
  monthly: ['monthly-notes', 'Monthly', 'monthlies'],
  quarterly: ['quarterly-notes', 'Quarterly', 'quarterlies'],
  yearly: ['yearly-notes', 'Yearly', 'yearlies'],
};

/**
 * Get current date/period path for a type
 */
export function getCurrentPeriodPath(type: string, folder: string, pattern: string): string {
  const now = new Date();
  let filename = '';

  switch (pattern) {
    case 'YYYY-MM-DD':
      filename = now.toISOString().split('T')[0]; // 2026-01-02
      break;
    case 'YYYY-WXX': {
      const week = getISOWeek(now);
      filename = `${now.getFullYear()}-W${week.toString().padStart(2, '0')}`;
      break;
    }
    case 'YYYY-[W]XX': {
      const week = getISOWeek(now);
      filename = `${now.getFullYear()}-[W]${week.toString().padStart(2, '0')}`;
      break;
    }
    case 'YYYY-MM':
      filename = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
      break;
    case 'YYYY-QX': {
      const quarter = Math.floor(now.getMonth() / 3) + 1;
      filename = `${now.getFullYear()}-Q${quarter}`;
      break;
    }
    case 'YYYY':
      filename = now.getFullYear().toString();
      break;
    default:
      filename = now.toISOString().split('T')[0]; // fallback to daily
  }

  return `${folder}/${filename}.md`;
}

/**
 * Get ISO week number
 */
export function getISOWeek(date: Date): number {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
}

/**
 * Detect periodic note conventions for a given type
 */
export function detectPeriodicNotes(
  index: VaultIndex,
  type: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'
): {
  type: string;
  detected: boolean;
  folder: string | null;
  pattern: string | null;
  confidence: number;
  evidence: {
    note_count: number;
    recent_notes: number;
    pattern_consistency: number;
  };
  today_path: string | null;
  today_exists: boolean;
  candidates: Array<{
    folder: string;
    pattern: string;
    score: number;
  }>;
} {
  const patterns = DATE_PATTERNS[type];
  const commonFolders = COMMON_FOLDERS[type];
  const candidates: Array<{ folder: string; pattern: string; score: number }> = [];

  // Scan all notes and group by folder + pattern
  const folderPatternCounts = new Map<string, {
    pattern: string;
    count: number;
    recentCount: number;
    notes: string[];
  }>();

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  for (const note of index.notes.values()) {
    // Extract folder
    const parts = note.path.split('/');
    const filename = parts[parts.length - 1];
    const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';

    // Check against patterns
    for (const patternDef of patterns) {
      if (patternDef.regex.test(filename)) {
        const key = `${folder}::${patternDef.format}`;
        const existing = folderPatternCounts.get(key);

        if (existing) {
          existing.count++;
          if (note.modified >= thirtyDaysAgo) {
            existing.recentCount++;
          }
          existing.notes.push(note.path);
        } else {
          folderPatternCounts.set(key, {
            pattern: patternDef.format,
            count: 1,
            recentCount: note.modified >= thirtyDaysAgo ? 1 : 0,
            notes: [note.path],
          });
        }
      }
    }
  }

  // Score each folder/pattern combo
  for (const [key, data] of folderPatternCounts.entries()) {
    const [folder, pattern] = key.split('::');

    // Base score from count (more notes = higher confidence)
    let score = Math.min(data.count / 30, 1.0) * 0.4; // max 0.4 from count

    // Boost for recent activity
    score += Math.min(data.recentCount / 7, 1.0) * 0.3; // max 0.3 from recency

    // Boost if folder name is in common list
    const folderName = folder.split('/').pop() || '';
    if (commonFolders.some(cf => folderName.toLowerCase() === cf.toLowerCase())) {
      score += 0.2;
    }

    // Pattern consistency (all notes in folder match pattern)
    const folderNotes = Array.from(index.notes.values()).filter(n =>
      n.path.startsWith(folder + '/')
    );
    const consistency = folderNotes.length > 0 ? data.count / folderNotes.length : 0;
    score += consistency * 0.1;

    candidates.push({
      folder: folder || '.',
      pattern,
      score,
    });
  }

  // Sort candidates by score (descending)
  candidates.sort((a, b) => b.score - a.score);

  // Best candidate
  const best = candidates[0];

  if (!best) {
    return {
      type,
      detected: false,
      folder: null,
      pattern: null,
      confidence: 0,
      evidence: {
        note_count: 0,
        recent_notes: 0,
        pattern_consistency: 0,
      },
      today_path: null,
      today_exists: false,
      candidates: [],
    };
  }

  // Calculate evidence for best candidate
  const bestData = folderPatternCounts.get(`${best.folder}::${best.pattern}`)!;
  const folderNotes = Array.from(index.notes.values()).filter(n =>
    n.path.startsWith(best.folder === '.' ? '' : best.folder + '/')
  );
  const patternConsistency = folderNotes.length > 0 ? bestData.count / folderNotes.length : 0;

  // Generate today's path
  const todayPath = getCurrentPeriodPath(type, best.folder, best.pattern);
  const todayExists = index.notes.has(todayPath);

  return {
    type,
    detected: true,
    folder: best.folder,
    pattern: best.pattern,
    confidence: best.score,
    evidence: {
      note_count: bestData.count,
      recent_notes: bestData.recentCount,
      pattern_consistency: patternConsistency,
    },
    today_path: todayPath,
    today_exists: todayExists,
    candidates: candidates.slice(0, 3), // top 3
  };
}

