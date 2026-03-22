/**
 * Standard IR retrieval metrics.
 */

/**
 * Recall@K: fraction of relevant documents found in top-K results.
 */
export function recallAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 0;
  const topK = retrieved.slice(0, k);
  const found = topK.filter(r => relevant.has(r)).length;
  return found / relevant.size;
}

/**
 * Precision@K: fraction of top-K results that are relevant.
 */
export function precisionAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  const topK = retrieved.slice(0, k);
  if (topK.length === 0) return 0;
  const found = topK.filter(r => relevant.has(r)).length;
  return found / topK.length;
}

/**
 * Mean Reciprocal Rank: 1/rank of first relevant document.
 */
export function mrr(retrieved: string[], relevant: Set<string>): number {
  for (let i = 0; i < retrieved.length; i++) {
    if (relevant.has(retrieved[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * NDCG@K: Normalized Discounted Cumulative Gain.
 */
export function ndcgAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  const topK = retrieved.slice(0, k);

  // DCG: sum of 1/log2(rank+1) for each relevant doc found
  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    if (relevant.has(topK[i])) {
      dcg += 1 / Math.log2(i + 2); // +2 because ranks start at 1
    }
  }

  // Ideal DCG: all relevant docs at top positions
  const idealCount = Math.min(relevant.size, k);
  let idcg = 0;
  for (let i = 0; i < idealCount; i++) {
    idcg += 1 / Math.log2(i + 2);
  }

  return idcg > 0 ? dcg / idcg : 0;
}

/**
 * Aggregate metrics across multiple queries.
 */
export interface AggregateMetrics {
  total_queries: number;
  recall_at_5: number;
  recall_at_10: number;
  precision_at_5: number;
  mrr: number;
  ndcg_at_10: number;
}

export function aggregateMetrics(
  results: Array<{ retrieved: string[]; relevant: Set<string> }>
): AggregateMetrics {
  if (results.length === 0) {
    return { total_queries: 0, recall_at_5: 0, recall_at_10: 0, precision_at_5: 0, mrr: 0, ndcg_at_10: 0 };
  }

  let sumRecall5 = 0, sumRecall10 = 0, sumPrec5 = 0, sumMrr = 0, sumNdcg10 = 0;

  for (const { retrieved, relevant } of results) {
    sumRecall5 += recallAtK(retrieved, relevant, 5);
    sumRecall10 += recallAtK(retrieved, relevant, 10);
    sumPrec5 += precisionAtK(retrieved, relevant, 5);
    sumMrr += mrr(retrieved, relevant);
    sumNdcg10 += ndcgAtK(retrieved, relevant, 10);
  }

  const n = results.length;
  return {
    total_queries: n,
    recall_at_5: Math.round((sumRecall5 / n) * 1000) / 1000,
    recall_at_10: Math.round((sumRecall10 / n) * 1000) / 1000,
    precision_at_5: Math.round((sumPrec5 / n) * 1000) / 1000,
    mrr: Math.round((sumMrr / n) * 1000) / 1000,
    ndcg_at_10: Math.round((sumNdcg10 / n) * 1000) / 1000,
  };
}
