/**
 * Answer Quality Metrics for LoCoMo Benchmark
 *
 * Token-level F1 scoring and adversarial detection,
 * matching LoCoMo's evaluation methodology.
 */

const ARTICLES = new Set(['a', 'an', 'the']);

/**
 * Normalize answer text: lowercase, strip articles, punctuation, extra whitespace.
 */
export function normalizeAnswer(text: string): string {
  return String(text)
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // strip punctuation
    .split(/\s+/)
    .filter(w => w.length > 0 && !ARTICLES.has(w))
    .join(' ')
    .trim();
}

/**
 * Compute token-level F1 score between prediction and ground truth.
 * Returns { precision, recall, f1 }.
 */
export function tokenF1(
  prediction: string,
  groundTruth: string,
): { precision: number; recall: number; f1: number } {
  const predTokens = normalizeAnswer(prediction).split(/\s+/).filter(Boolean);
  const truthTokens = normalizeAnswer(groundTruth).split(/\s+/).filter(Boolean);

  if (truthTokens.length === 0 && predTokens.length === 0) {
    return { precision: 1, recall: 1, f1: 1 };
  }
  if (truthTokens.length === 0 || predTokens.length === 0) {
    return { precision: 0, recall: 0, f1: 0 };
  }

  // Count common tokens (with multiplicity)
  const truthCounts = new Map<string, number>();
  for (const t of truthTokens) {
    truthCounts.set(t, (truthCounts.get(t) || 0) + 1);
  }

  let common = 0;
  const predCounts = new Map<string, number>();
  for (const p of predTokens) {
    predCounts.set(p, (predCounts.get(p) || 0) + 1);
  }

  for (const [token, predCount] of predCounts) {
    const truthCount = truthCounts.get(token) || 0;
    common += Math.min(predCount, truthCount);
  }

  const precision = common / predTokens.length;
  const recall = common / truthTokens.length;
  const f1 = precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : 0;

  return { precision, recall, f1 };
}

const NO_INFO_PATTERNS = [
  /no information/i,
  /not (?:enough |sufficient )?information/i,
  /cannot (?:be |find|determine)/i,
  /not (?:mentioned|found|available|specified|stated|provided)/i,
  /(?:doesn't|does not|don't|do not) (?:mention|contain|have|include|provide|specify)/i,
  /unanswerable/i,
  /(?:no|isn't any|is no) (?:relevant )?(?:evidence|data|record)/i,
];

/**
 * Score an adversarial question response.
 * Returns 1 if the response correctly indicates no information is available, 0 otherwise.
 */
export function adversarialScore(prediction: string): number {
  for (const pattern of NO_INFO_PATTERNS) {
    if (pattern.test(prediction)) return 1;
  }
  return 0;
}

/**
 * Score an answer based on its category.
 * - Categories 1-4: token F1
 * - Category 5 (adversarial): binary adversarial detection
 */
export function scoreAnswer(
  categoryNum: number,
  prediction: string,
  groundTruth: string,
): number {
  if (categoryNum === 5) {
    return adversarialScore(prediction);
  }
  return tokenF1(prediction, groundTruth).f1;
}
