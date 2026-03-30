/**
 * Retrieval Scoring Utilities for LanceDB Memory Server
 *
 * Provides scoring functions for ranked retrieval:
 * - Recency decay (exponential, 14-day half-life)
 * - Weighted fusion scoring (similarity + importance + recency + rank + cross-store bonus)
 * - Token budget estimation
 * - Content deduplication
 *
 * @module mcp-servers/lancedb-memory/retrieval
 */

// ============================================================================
// Constants
// ============================================================================

/** Half-life for recency decay in milliseconds (14 days). */
const RECENCY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

/** Natural log of 2, pre-computed for decay formula. */
const LN2 = Math.LN2;

/** Number of leading characters used as a deduplication hash key. */
const DEDUP_PREFIX_LENGTH = 200;

// ============================================================================
// Fusion Score Weights
// ============================================================================

const W_SIMILARITY = 0.35;
const W_IMPORTANCE = 0.25;
const W_RECENCY = 0.20;
const W_RANK = 0.10;
const W_BONUS = 0.10;

// ============================================================================
// Scoring Functions
// ============================================================================

/**
 * Compute a recency score using exponential decay with a 14-day half-life.
 *
 * score = 2^(-(now - createdAt) / halfLife)
 *
 * Returns 1.0 for brand-new items, 0.5 after 14 days, ~0.25 after 28 days, etc.
 * Clamps to [0, 1].
 *
 * @param createdAtMs - Unix timestamp in milliseconds when the item was created.
 * @param nowMs - Current time in milliseconds (defaults to Date.now()).
 * @returns A score in [0, 1] where 1 is most recent.
 */
export function recencyScore(createdAtMs: number, nowMs?: number): number {
  // Guard against NaN/Infinity input — return 0 (no recency signal) for invalid data
  if (!Number.isFinite(createdAtMs)) return 0;

  const now = nowMs ?? Date.now();
  const ageMs = now - createdAtMs;

  // Future timestamps or zero age → maximum recency
  if (ageMs <= 0) return 1.0;

  // Exponential decay: 2^(-age / halfLife) = exp(-age * ln2 / halfLife)
  const score = Math.exp((-ageMs * LN2) / RECENCY_HALF_LIFE_MS);

  // Clamp to [0, 1] for safety (should already be in range)
  return Math.max(0, Math.min(1, score));
}

/**
 * Parameters for the weighted fusion score.
 */
export interface FusionScoreParams {
  /** Cosine similarity score, 0-1 (from vector search). */
  similarity: number;
  /** Importance score, 0-1 (from metadata). */
  importance: number;
  /** Recency score, 0-1 (from recencyScore()). */
  recency: number;
  /** 0-based rank position in the raw results. */
  rankPosition: number;
  /** Cross-store bonus: 0 for single-store, 0.15 for cross-store matches. */
  crossStoreBonus: number;
}

/**
 * Compute a weighted fusion score combining multiple retrieval signals.
 *
 * Formula:
 *   0.35 * similarity
 * + 0.25 * importance
 * + 0.20 * recency
 * + 0.10 * (1 / (rankPosition + 1))
 * + 0.10 * crossStoreBonus
 *
 * @param params - The individual signal scores.
 * @returns A fused relevance score (higher is better).
 */
export function fusionScore(params: FusionScoreParams): number {
  const { similarity, importance, recency, rankPosition, crossStoreBonus } = params;

  const rankScore = 1 / (rankPosition + 1);

  return (
    W_SIMILARITY * similarity +
    W_IMPORTANCE * importance +
    W_RECENCY * recency +
    W_RANK * rankScore +
    W_BONUS * crossStoreBonus
  );
}

/**
 * Estimate the token count for a string using the 4-chars-per-token heuristic.
 *
 * This is a fast approximation suitable for budget enforcement. For exact counts,
 * use a proper tokenizer (tiktoken, etc.).
 *
 * @param text - The text to estimate tokens for.
 * @returns Estimated token count (always >= 1 for non-empty text).
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Deduplicate results by content prefix.
 *
 * Uses the first 200 characters of each item's content as a hash key.
 * When duplicates are found, the first occurrence (by array order) wins.
 *
 * @param results - Array of objects with id and content fields.
 * @returns A new array with duplicates removed, preserving original order.
 */
export function deduplicateByContent<T extends { id: string; content: string }>(
  results: T[],
): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const item of results) {
    const key = item.content.slice(0, DEDUP_PREFIX_LENGTH);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(item);
    }
  }

  return deduped;
}
