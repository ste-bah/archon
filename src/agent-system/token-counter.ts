import { TOTAL_CONTROLLABLE_TOKEN_LIMIT } from './constants.js';

/**
 * Estimate token count using character-based heuristic: ceil(length / 4).
 * Accuracy: ~10% for English text, ~20% for code. Slightly overestimates (safe for budgets).
 */
export function tokenEstimate(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Check if text exceeds a token limit.
 */
export function checkTokenBudget(
  text: string,
  limit: number,
): { within: boolean; estimate: number; limit: number; overage: number } {
  const estimate = tokenEstimate(text);
  return {
    within: estimate <= limit,
    estimate,
    limit,
    overage: Math.max(0, estimate - limit),
  };
}

/**
 * Compute token breakdown for all definition files in an agent directory.
 * Only counts .md files toward the controllable total (JSON metadata excluded).
 */
export function computeTokenBreakdown(
  files: Record<string, string>,
  tokenLimits: Record<string, number>,
): {
  perFile: Record<string, { estimate: number; limit: number; within: boolean }>;
  totalEstimate: number;
  totalLimit: number;
  totalWithin: boolean;
} {
  const perFile: Record<string, { estimate: number; limit: number; within: boolean }> = {};
  let totalEstimate = 0;

  for (const [filename, content] of Object.entries(files)) {
    const limit = tokenLimits[filename] ?? Infinity;
    const estimate = tokenEstimate(content);
    perFile[filename] = { estimate, limit, within: estimate <= limit };
    if (filename.endsWith('.md')) {
      totalEstimate += estimate;
    }
  }

  return {
    perFile,
    totalEstimate,
    totalLimit: TOTAL_CONTROLLABLE_TOKEN_LIMIT,
    totalWithin: totalEstimate <= TOTAL_CONTROLLABLE_TOKEN_LIMIT,
  };
}
